import { Application, Container, Graphics, NineSliceSprite, Sprite, Texture, TilingSprite } from "pixi.js";

// ---- tipler (sunucu /api yanıtları) ----
interface Slice { left: number; top: number; right: number; bottom: number }
interface DesignInfo { id: string; kind: "frame9" | "tile" | "sprite"; width: number; height: number; layers: number; hash: string }
interface WidgetInfo { id: string; width: number; height: number; hash: string }
interface Project { designs: DesignInfo[]; widgets: WidgetInfo[] }
interface Layer { id: string; kind: string; hidden?: boolean; fill?: { kind: string; preset?: string; color?: string } }
interface DesignFull { id: string; kind: "frame9" | "tile" | "sprite"; width: number; height: number; slice?: Slice; layers: Layer[] }
interface NodeT { id: string; type: string; text?: string; children: NodeT[] }
interface Rect { x: number; y: number; w: number; h: number }
interface WidgetFull { widget: { id: string; width: number; height: number; root: NodeT }; rects: Record<string, Rect> }
type Sel = { kind: "design" | "widget"; id: string };

// Aynı porttan (bediz sunucusu) sunulunca göreli; Vite geliştirme sunucusunda (5173) sunucuya gider.
const qs = new URLSearchParams(location.search);
const API = qs.get("api") ?? (location.port === "5173" ? "http://127.0.0.1:5757" : "");

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const el = { dot: $("#dot"), status: $("#status"), follow: $<HTMLInputElement>("#follow"), info: $("#info"), designs: $("#designs"), widgets: $("#widgets"),
  stage: $("#stage"), toolbar: $("#toolbar"), mode: $<HTMLSelectElement>("#mode"), modeBox: $("#modeBox"), sw: $<HTMLInputElement>("#sw"), sh: $<HTMLInputElement>("#sh"),
  swv: $("#swv"), shv: $("#shv"), swBox: $("#swBox"), shBox: $("#shBox"), grid: $<HTMLInputElement>("#grid"), gridBox: $("#gridBox"), gridLabel: $("#gridLabel"),
  zoomv: $("#zoomv"), hint: $("#hint"), empty: $("#empty"), panel: $("#panel") };

const getJson = async <T>(path: string): Promise<T> => {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
};
const getTexture = async (path: string): Promise<Texture> => {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return Texture.from(await createImageBitmap(await r.blob()));
};

// ---- Pixi: kamera (pan/zoom) + içerik ----
const app = new Application();
await app.init({ resizeTo: el.stage, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio, autoDensity: true });
el.stage.prepend(app.canvas);
const world = new Container();
const content = new Container();
const overlay = new Graphics();
world.addChild(content, overlay);
app.stage.addChild(world);

let project: Project = { designs: [], widgets: [] };
let sel: Sel | undefined;
let design: DesignFull | undefined;
let wdata: WidgetFull | undefined;
let tex: Texture | undefined;
let contentSize = { w: 1, h: 1 };
const hidden = new Set<string>();
let hover: string | undefined, picked: string | undefined;
let loadToken = 0;

const setZoom = (z: number, cx = app.screen.width / 2, cy = app.screen.height / 2) => {
  const next = Math.min(32, Math.max(0.05, z)), k = next / world.scale.x;
  world.position.set(cx - (cx - world.position.x) * k, cy - (cy - world.position.y) * k);
  world.scale.set(next);
  el.zoomv.textContent = `${Math.round(next * 100)}%`;
  if (tex) tex.source.scaleMode = next >= 3 ? "nearest" : "linear"; // yakınlaşınca piksel net, uzakta yumuşak
};
const fit = () => {
  const s = Math.min((app.screen.width - 60) / contentSize.w, (app.screen.height - 120) / contentSize.h, 8);
  setZoom(s, 0, 0);
  world.position.set((app.screen.width - contentSize.w * s) / 2, (app.screen.height - contentSize.h * s) / 2 + 24);
};

// ---- yan çubuk ----
const sizeOf = (x: { width: number; height: number }) => `${x.width}×${x.height}`;
function renderLists() {
  const fill = (ul: HTMLElement, kind: Sel["kind"], items: { id: string; width: number; height: number; kind?: string }[]) => {
    ul.replaceChildren(...(items.length ? items.map((it) => {
      const li = document.createElement("li");
      li.className = sel?.kind === kind && sel.id === it.id ? "on" : "";
      li.innerHTML = `<span class="badge">${it.kind ?? "widget"}</span><span></span><small>${sizeOf(it)}</small>`;
      (li.children[1] as HTMLElement).textContent = it.id;
      li.onclick = () => void select({ kind, id: it.id });
      return li;
    }) : [Object.assign(document.createElement("div"), { className: "empty", textContent: "—" })]));
  };
  fill(el.designs, "design", project.designs);
  fill(el.widgets, "widget", project.widgets);
}

// ---- görünüm kurulumu ----
let mode = "stretch";
let sw = 300, sh = 200;

function modesFor(d: DesignFull | undefined): [string, string][] {
  if (!d) return [];
  return d.kind === "frame9" ? [["stretch", "Gerilmiş (9-slice)"], ["source", "Kaynak + dilim çizgileri"]]
    : d.kind === "tile" ? [["stretch", "Döşenmiş"], ["source", "Tek tile"]] : [["source", "Sprite"]];
}

function updateToolbar() {
  const showStretch = !!design && mode === "stretch" && design.kind !== "sprite";
  el.toolbar.classList.toggle("hide", !sel);
  el.modeBox.classList.toggle("hide", !design);
  el.swBox.classList.toggle("hide", !showStretch);
  el.shBox.classList.toggle("hide", !showStretch);
  // Kılavuz yalnızca anlamlı olduğunda: widget (node çerçeveleri), 9-slice kaynak (dilim çizgileri), tile (ızgara)
  const hasGuide = !!wdata || (!!design && ((design.kind === "frame9" && mode === "source") || design.kind === "tile"));
  el.gridBox.classList.toggle("hide", !hasGuide);
  el.gridLabel.textContent = wdata ? "Tüm node çerçeveleri" : mode === "source" ? "Dilim çizgileri" : "Tile ızgarası";
  el.swv.textContent = String(sw);
  el.shv.textContent = String(sh);
}

function drawOverlay() {
  overlay.clear();
  const line = (color: number, alpha = 1) => ({ width: 1, color, alpha, pixelLine: true });
  if (wdata) {
    const r = (id: string) => wdata!.rects[id];
    if (el.grid.checked) for (const id of Object.keys(wdata.rects)) overlay.rect(r(id).x, r(id).y, r(id).w, r(id).h).stroke(line(0x4cc2ff, 0.35));
    for (const [id, color] of [[hover, 0xffd166], [picked, 0x4cc2ff]] as const) {
      if (id && r(id)) overlay.rect(r(id).x, r(id).y, r(id).w, r(id).h).stroke(line(color)).rect(r(id).x, r(id).y, r(id).w, r(id).h).fill({ color, alpha: 0.12 });
    }
  } else if (design && el.grid.checked) {
    if (mode === "source" && design.kind === "frame9" && design.slice) {
      const s = design.slice;
      for (const x of [s.left, design.width - s.right]) overlay.moveTo(x, 0).lineTo(x, design.height).stroke(line(0xff4d8d));
      for (const y of [s.top, design.height - s.bottom]) overlay.moveTo(0, y).lineTo(design.width, y).stroke(line(0xff4d8d));
    } else if (mode === "stretch" && design.kind === "tile") {
      for (let x = design.width; x < sw; x += design.width) overlay.moveTo(x, 0).lineTo(x, sh).stroke(line(0xff4d8d));
      for (let y = design.height; y < sh; y += design.height) overlay.moveTo(0, y).lineTo(sw, y).stroke(line(0xff4d8d));
    }
  }
}

function buildContent() {
  content.removeChildren().forEach((c) => c.destroy());
  if (!tex) return;
  if (wdata) {
    content.addChild(new Sprite(tex));
    contentSize = { w: wdata.widget.width, h: wdata.widget.height };
  } else if (design) {
    const d = design;
    if (mode === "stretch" && d.kind === "frame9" && d.slice) {
      const s = d.slice, w = Math.max(sw, s.left + s.right + 1), h = Math.max(sh, s.top + s.bottom + 1);
      content.addChild(new NineSliceSprite({ texture: tex, leftWidth: s.left, topHeight: s.top, rightWidth: s.right, bottomHeight: s.bottom, width: w, height: h }));
      contentSize = { w, h };
    } else if (mode === "stretch" && d.kind === "tile") {
      content.addChild(new TilingSprite({ texture: tex, width: sw, height: sh }));
      contentSize = { w: sw, h: sh };
    } else {
      content.addChild(new Sprite(tex));
      contentSize = { w: d.width, h: d.height };
    }
  }
  drawOverlay();
}

// ---- panel (sağ) ----
function renderPanel() {
  el.panel.replaceChildren();
  const add = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; el.panel.append(d); return d; };
  const text = (s: string) => Object.assign(document.createElement("span"), { textContent: s });
  if (design) {
    const d = design;
    const kv = add(`<h4></h4><div class="kv"></div>`);
    kv.querySelector("h4")!.textContent = d.id;
    const rows: [string, string][] = [["Tür", d.kind], ["Boyut", sizeOf(d)], ["Katman", String(d.layers.length)]];
    if (d.slice) rows.splice(2, 0, ["Dilim", `${d.slice.left} / ${d.slice.top} / ${d.slice.right} / ${d.slice.bottom}`]);
    kv.querySelector(".kv")!.replaceChildren(...rows.flatMap(([k, v]) => [text(k), text(v)]));
    add(`<h3 style="margin:8px 0 4px">Katmanlar <small>(göz: önizlemede gizle)</small></h3>`);
    const ul = document.createElement("ul");
    for (const l of [...d.layers].reverse()) {
      const li = document.createElement("li");
      li.className = hidden.has(l.id) ? "off" : "";
      const hint = l.fill ? (l.fill.preset ?? l.fill.color ?? l.fill.kind) : "";
      li.innerHTML = `<input type="checkbox" ${hidden.has(l.id) ? "" : "checked"} /><span class="badge"></span><span></span><small></small>`;
      (li.children[1] as HTMLElement).textContent = l.kind;
      (li.children[2] as HTMLElement).textContent = l.id;
      (li.children[3] as HTMLElement).textContent = hint;
      (li.firstChild as HTMLInputElement).onchange = (e) => {
        if ((e.target as HTMLInputElement).checked) hidden.delete(l.id); else hidden.add(l.id);
        renderPanel();
        scheduleReload();
      };
      ul.append(li);
    }
    el.panel.append(ul);
  } else if (wdata) {
    const w = wdata.widget;
    const kv = add(`<h4></h4><div class="kv"></div>`);
    kv.querySelector("h4")!.textContent = w.id;
    kv.querySelector(".kv")!.replaceChildren(...[["Boyut", sizeOf(w)], ["Node", String(Object.keys(wdata.rects).length)]].flatMap(([k, v]) => [text(k), text(v)]));
    add(`<h3 style="margin:8px 0 4px">Ağaç <small>(tıkla: seç)</small></h3>`);
    const ul = document.createElement("ul");
    ul.className = "tree";
    const walk = (n: NodeT, depth: number) => {
      const li = document.createElement("li");
      li.dataset.id = n.id;
      li.className = n.id === picked ? "on" : "";
      li.style.paddingLeft = `${4 + depth * 14}px`;
      li.innerHTML = `<span class="badge"></span><span></span><small></small>`;
      (li.children[0] as HTMLElement).textContent = n.type;
      (li.children[1] as HTMLElement).textContent = n.id;
      const r = wdata!.rects[n.id];
      (li.children[2] as HTMLElement).textContent = r ? `${r.w}×${r.h} @${r.x},${r.y}` : "";
      li.onmouseenter = () => { hover = n.id; drawOverlay(); };
      li.onmouseleave = () => { hover = undefined; drawOverlay(); };
      li.onclick = () => { picked = picked === n.id ? undefined : n.id; renderPanel(); drawOverlay(); };
      ul.append(li);
      n.children.forEach((c) => walk(c, depth + 1));
    };
    walk(w.root, 0);
    el.panel.append(ul);
  }
}

// ---- yükleme ----
async function loadView(keepCamera: boolean) {
  if (!sel) return;
  const token = ++loadToken, s = sel, info = s.kind === "design" ? project.designs.find((d) => d.id === s.id) : project.widgets.find((w) => w.id === s.id);
  if (!info) return;
  try {
    let next: Texture;
    if (s.kind === "design") {
      const [d, t] = await Promise.all([
        getJson<DesignFull>(`/api/design/${s.id}`),
        getTexture(`/api/design/${s.id}.png?hide=${[...hidden].map(encodeURIComponent).join(",")}&t=${info.hash}`),
      ]);
      if (token !== loadToken) return t.destroy(true);
      design = d; wdata = undefined; next = t;
    } else {
      const id = encodeURIComponent(s.id);
      const [w, t] = await Promise.all([getJson<WidgetFull>(`/api/widget/${id}`), getTexture(`/api/widget/${id}.png?t=${info.hash}`)]);
      if (token !== loadToken) return t.destroy(true);
      wdata = w; design = undefined; next = t;
    }
    tex?.destroy(true);
    tex = next;
    el.empty.classList.add("hide");
    el.info.textContent = `${s.kind === "design" ? "Tasarım" : "Widget"}: ${s.id}`;
    if (mode !== "source" && !modesFor(design).some(([m]) => m === mode)) mode = "stretch";
    buildContent();
    updateToolbar();
    renderPanel();
    renderLists();
    if (!keepCamera) fit(); else setZoom(world.scale.x, 0, 0), world.position.set(world.position.x, world.position.y);
  } catch (e) {
    el.info.textContent = `yüklenemedi: ${(e as Error).message}`;
  }
}

let reloadTimer: number | undefined;
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = window.setTimeout(() => void loadView(true), 150); };

async function select(next: Sel | undefined, opts: { keepCamera?: boolean } = {}) {
  const same = !!next && !!sel && next.kind === sel.kind && next.id === sel.id;
  if (!same) { hidden.clear(); hover = picked = undefined; mode = "stretch"; }
  sel = next;
  if (!next) {
    content.removeChildren().forEach((c) => c.destroy());
    overlay.clear(); design = wdata = undefined; tex?.destroy(true); tex = undefined;
    el.empty.classList.remove("hide"); el.toolbar.classList.add("hide"); el.info.textContent = ""; renderPanel(); renderLists();
    return;
  }
  if (!same && next.kind === "design") {
    const d = project.designs.find((x) => x.id === next.id)!;
    sw = Math.round(d.width * (d.kind === "tile" ? 3 : 2.2)); sh = Math.round(d.height * (d.kind === "tile" ? 2 : 1.4));
  }
  if (!same) updateModeOptions(next);
  await loadView(!!opts.keepCamera || same);
}

function updateModeOptions(s: Sel) {
  const info = s.kind === "design" ? project.designs.find((d) => d.id === s.id) : undefined;
  const opts = modesFor(info as DesignFull | undefined);
  el.mode.replaceChildren(...opts.map(([v, label]) => Object.assign(document.createElement("option"), { value: v, textContent: label })));
  mode = opts[0]?.[0] ?? "stretch";
  el.mode.value = mode;
  el.sw.value = String(sw); el.sh.value = String(sh);
}

// ---- proje yenileme (SSE ile tetiklenir) ----
// Bir tool çağrısı peş peşe birkaç bildirim yollar; üst üste binen yenilemelerde eski yanıt yeniyi ezmesin diye sıraya konur:
// biri sürerken gelen istekler tek bir "bir tur daha" bayrağına birleşir.
let refreshing = false, again = false;
async function refresh(initial = false): Promise<void> {
  if (refreshing) { again = true; return; }
  refreshing = true;
  try { await refreshOnce(initial); } finally { refreshing = false; }
  if (again) { again = false; return refresh(); }
}

async function refreshOnce(initial: boolean) {
  const next = await getJson<Project>("/api/project");
  const before = new Map<string, string>([...project.designs.map((d) => [`d:${d.id}`, d.hash] as const), ...project.widgets.map((w) => [`w:${w.id}`, w.hash] as const)]);
  project = next;
  const items: { key: string; sel: Sel; hash: string }[] = [
    ...next.designs.map((d) => ({ key: `d:${d.id}`, sel: { kind: "design", id: d.id } as Sel, hash: d.hash })),
    ...next.widgets.map((w) => ({ key: `w:${w.id}`, sel: { kind: "widget", id: w.id } as Sel, hash: w.hash })),
  ];
  const changed = items.filter((i) => before.get(i.key) !== i.hash);
  renderLists();
  if (sel && !items.some((i) => i.sel.kind === sel!.kind && i.sel.id === sel!.id)) return select(undefined);
  if (!initial && changed.length && el.follow.checked) {
    const last = changed[changed.length - 1].sel;
    return select(last, { keepCamera: sel?.kind === last.kind && sel.id === last.id });
  }
  if (sel && changed.some((i) => i.sel.kind === sel!.kind && i.sel.id === sel!.id)) return loadView(true);
  if (!sel && items.length) return select(items[items.length - 1].sel);
}

// ---- etkileşim ----
let drag: { x: number; y: number; moved: boolean } | undefined;
const canvas = app.canvas;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); el.stage.classList.add("drag"); });
canvas.addEventListener("pointerup", (e) => {
  el.stage.classList.remove("drag");
  if (drag && !drag.moved && wdata) { picked = hover === picked ? undefined : hover; renderPanel(); drawOverlay(); }
  drag = undefined;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { world.position.set(world.position.x + dx, world.position.y + dy); drag.x = e.clientX; drag.y = e.clientY; }
    return;
  }
  if (!wdata) return;
  const p = world.toLocal({ x: e.offsetX, y: e.offsetY });
  let found: string | undefined;
  const walk = (n: NodeT) => { const r = wdata!.rects[n.id]; if (r && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) found = n.id; n.children.forEach(walk); };
  walk(wdata.widget.root);
  if (found !== hover) {
    hover = found;
    drawOverlay();
    const r = found && wdata.rects[found];
    el.hint.classList.toggle("hide", !r);
    if (r) el.hint.textContent = `${found} · ${r.w}×${r.h} @ ${r.x},${r.y}`;
    el.panel.querySelectorAll<HTMLElement>(".tree li").forEach((li) => li.classList.toggle("on", li.dataset.id === (picked ?? hover)));
  }
});
canvas.addEventListener("pointerleave", () => { if (hover) { hover = undefined; drawOverlay(); el.hint.classList.add("hide"); } });
canvas.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(world.scale.x * Math.pow(1.0015, -e.deltaY), e.offsetX, e.offsetY); }, { passive: false });
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
  if (e.key === "f" || e.key === "F") fit();
  if (e.key === "1") { setZoom(1, 0, 0); world.position.set((app.screen.width - contentSize.w) / 2, (app.screen.height - contentSize.h) / 2); }
});
$("#fit").onclick = fit;
$("#one").onclick = () => { setZoom(1, 0, 0); world.position.set((app.screen.width - contentSize.w) / 2, (app.screen.height - contentSize.h) / 2); };
el.grid.onchange = drawOverlay;
el.mode.onchange = () => { mode = el.mode.value; buildContent(); updateToolbar(); renderPanel(); fit(); };
el.sw.oninput = () => { sw = +el.sw.value; el.swv.textContent = String(sw); buildContent(); };
el.sh.oninput = () => { sh = +el.sh.value; el.shv.textContent = String(sh); buildContent(); };

// ---- başlat ----
function connect() {
  const es = new EventSource(`${API}/events`);
  es.onopen = () => { el.dot.classList.add("ok"); el.status.textContent = "bağlı"; void refresh(); };
  es.onmessage = () => void refresh();
  es.onerror = () => { el.dot.classList.remove("ok"); el.status.textContent = "bağlantı yok (yeniden deneniyor)"; };
}
await refresh(true).catch(() => { el.status.textContent = "sunucuya ulaşılamıyor"; });
connect();
