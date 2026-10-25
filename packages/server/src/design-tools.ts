import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DESIGN_KINDS, DesignSchema, LayerSchema, MATERIAL_PRESETS, STONE_PATTERNS, SliceSchema, WidgetSchema, compileDesign, materialDefaults, presetInfo, toUnrealBrush,
  type Design, type Widget,
} from "@bediz/core";
import { assets, designs, getDesign, notify, projectDir, widgets } from "./state.js";
import { renderDesignPng } from "./design-render.js";
import { renderNineSliceFrom } from "./render.js";
import { renderWidget } from "./render-scene.js";

const text = (v: unknown) => ({ type: "text" as const, text: JSON.stringify(v, null, 2) });
const image = (png: Buffer) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" });
const bg = z.string().regex(/^(#[0-9a-fA-F]{6}|none)$/, "#RRGGBB veya none");
const designId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)");

/** Doğrulayıp (şema + derleme) kaydeder; geçersizse tasarım olduğu gibi kalır. */
function commit(id: string, mutate: (d: Design) => void): Design {
  const next = structuredClone(getDesign(id));
  mutate(next);
  const valid = DesignSchema.parse(next);
  compileDesign(valid); // ring kalınlığı gibi geometri hatalarını kaydetmeden yakala
  designs.set(id, valid);
  notify();
  return valid;
}

async function exportDesign(d: Design) {
  const dir = join(projectDir(), "art");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${d.id}.png`);
  writeFileSync(path, await renderDesignPng(d));
  const a = { id: d.id, path, width: d.width, height: d.height, ...(d.slice && { slice: d.slice }), ...(d.kind === "tile" && { tile: true }) };
  assets.set(a.id, a);
  notify();
  return a;
}

async function flat(png: Buffer, background: string) {
  return background === "none" ? png : sharp(png).flatten({ background }).png().toBuffer();
}

export function registerDesignTools(server: McpServer) {
  server.tool(
    "list_presets",
    "Çizim motorunun yeteneklerini ve tasarım ipuçlarını döndürür. Çizime başlamadan önce oku.",
    {},
    async () => ({
      content: [text({
        designKinds: {
          frame9: "9-slice çerçeve/panel. slice (px) köşe+kenar kalınlığını kapsamalı; ortası genelde şeffaf bırakılır. Ortası gerilir, köşeler gerilmez.",
          tile: "Dikişsiz döşenen doku (arka plan zemini). Tek bir box + texture dolgu yeterli. Bevel/shadow kullanma (kenarlarda iz bırakır).",
          sprite: "Tek parça süs (mücevher, rozet). Gerilmez; widget'ta anchor ile yerleştirilir.",
        },
        materials: { note: "fill {kind:material}: CPU hattı; Voronoi taş/blok, fırçalı metal, ahşap; bevel gerçek kenar eğimi (depth/size px). Önerilen.", ...materialDefaults() },
        textures: { note: "fill {kind:texture}: eski SVG filtre dokuları (basit).", ...presetInfo() },
        layerKinds: {
          box: "inset (tuval kenarından içeri) VEYA x,y,w,h; radius (yuvarlak köşe) veya chamfer (pah).",
          ring: "box gibi + thickness: ortası boş çerçeve halkası (eşit kalınlık).",
          polygon: "points [[x,y],...]", ellipse: "cx,cy,rx,ry",
          gem: "cx,cy,size,color + shape(diamond|round|hex) + setting(gold|none): hazır faset mücevher (altın yuvalı).",
          line: "points [[x,y],...], closed?; stroke ZORUNLU (fill kullanma). Açık uçlu çizgi: tel, oyuk, çatlak.",
          cracks: "x,y,w,h bölgesine count adet dallanan çatlak (koyu iz + parlak kenar); length, seed, direction (rad, bir yöne hizalar), spread. Bölgeyi yüzeyin içinde tut (boşluğa taşan çatlak havada kalır).",
          corners: "style:blade, size (px; slice marjını aşma, yoksa gerilir), inset?, which?:[tl,tr,bl,br], studs? — 4 köşeye kıvrımlı bıçak süsü; fill/stroke/effects her parçaya uygulanır.",
        },
        fills: "solid{color,opacity} · linear{angle,stops} · radial{stops} · material{preset,pattern?,colors?,scale?,seed?,wear?(0..1: kenar aşınması+kir)} · texture{...eski}",
        effects: "bevel{depth,size,azimuth,highlight} · shadow{dx,dy,blur,color,opacity} · innerShadow · glow. Sıra önemli (üstten uygulanır).",
        tips: [
          "Katmanlar alttan üste çizilir (dizideki sıra).",
          "Altın çerçeve: ring + texture gold + bevel + hafif shadow; altına koyu ring ile dış çizgi ekle.",
          "frame9 slice ≥ çerçeve kalınlığı + köşe yarıçapı. Ortada 64px+ düz bölge bırak.",
          "Süs/mücevhere frame9'a koyma: gerilir. Ayrı sprite yap, widget'ta ortala.",
          "Tek çağrıda hazır container için create_container; sonra katmanları update_layer ile inceltebilirsin.",
        ],
      })],
    }),
  );

  server.tool(
    "create_design",
    "Boş bir tasarım (tuval) oluşturur. kind: frame9 (slice gerekli) | tile | sprite. Sonra add_layer ile çiz.",
    { id: designId, kind: z.enum(DESIGN_KINDS), width: z.number().int().min(8).max(2048), height: z.number().int().min(8).max(2048),
      slice: SliceSchema.optional(), layers: z.array(LayerSchema).optional() },
    async ({ id, layers, ...rest }) => {
      if (designs.has(id)) throw new Error(`tasarım zaten var: ${id}`);
      const d = DesignSchema.parse({ id, ...rest, layers: layers ?? [] });
      compileDesign(d);
      designs.set(id, d);
      notify();
      return { content: [text(d)] };
    },
  );

  server.tool(
    "update_design",
    "Tasarımın boyutunu ve/veya slice'ını değiştirir.",
    { design: z.string(), width: z.number().int().min(8).max(2048).optional(), height: z.number().int().min(8).max(2048).optional(), slice: SliceSchema.optional() },
    async ({ design, ...p }) => ({ content: [text(commit(design, (d) => Object.assign(d, p)))] }),
  );

  server.tool(
    "add_layer",
    "Tasarıma katman ekler (üste; index verilirse o sıraya). Katman şeması için list_presets'e bak.",
    { design: z.string(), layer: LayerSchema, index: z.number().int().min(0).optional() },
    async ({ design, layer, index }) => ({
      content: [text(commit(design, (d) => d.layers.splice(index ?? d.layers.length, 0, layer)))],
    }),
  );

  server.tool(
    "update_layer",
    "Katmanın alanlarını günceller. patch: sadece değişen alanlar; fill/effects/stroke bütün olarak değişir; alana null vermek onu siler.",
    { design: z.string(), id: z.string(), patch: z.record(z.string(), z.unknown()) },
    async ({ design, id, patch }) => ({
      content: [text(commit(design, (d) => {
        const i = d.layers.findIndex((l) => l.id === id);
        if (i < 0) throw new Error(`katman yok: ${id}`);
        const l = { ...d.layers[i] } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) v === null ? delete l[k] : (l[k] = v);
        d.layers[i] = l as typeof d.layers[number];
      }))],
    }),
  );

  server.tool(
    "remove_layer",
    "Katmanı siler.",
    { design: z.string(), id: z.string() },
    async ({ design, id }) => ({
      content: [text(commit(design, (d) => {
        if (!d.layers.some((l) => l.id === id)) throw new Error(`katman yok: ${id}`);
        d.layers = d.layers.filter((l) => l.id !== id);
      }))],
    }),
  );

  server.tool(
    "get_design",
    "Tasarımı döndürür. design verilmezse tasarım listesi.",
    { design: z.string().optional() },
    async ({ design }) => ({
      content: [text(design ? getDesign(design) : [...designs.values()].map((d) => ({ id: d.id, kind: d.kind, width: d.width, height: d.height, layers: d.layers.length })))],
    }),
  );

  server.tool(
    "render_design",
    "Tasarımı PNG olarak çizer (kendi boyutunda). Çizdiğini görmek için kullan. scale küçük süsleri büyütür.",
    { design: z.string(), background: bg.default("#2a2a32"), scale: z.number().int().min(1).max(4).default(1) },
    async ({ design, background, scale }) => {
      const d = getDesign(design);
      let img = sharp(await renderDesignPng(d));
      if (scale > 1) img = sharp(await img.resize(d.width * scale, d.height * scale, { kernel: "nearest" }).png().toBuffer());
      return { content: [image(await flat(await img.png().toBuffer(), background))] };
    },
  );

  server.tool(
    "preview_stretch",
    "Tasarımı hedef boyutta gösterir: frame9 → 9-slice gerilmiş, tile → döşenmiş, sprite → ortalanmış. Gerilince bozulup bozulmadığını kontrol et.",
    { design: z.string(), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096), background: bg.default("#2a2a32") },
    async ({ design, width, height, background }) => {
      const d = getDesign(design);
      const png = await renderDesignPng(d);
      const base = { create: { width, height, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
      const out = d.kind === "frame9"
        ? await renderNineSliceFrom(png, { id: d.id, width: d.width, height: d.height, slice: d.slice }, width, height)
        : d.kind === "tile"
          ? await sharp(base).composite([{ input: png, tile: true }]).png().toBuffer()
          : await sharp(base).composite([{ input: png, gravity: "center" }]).png().toBuffer();
      return { content: [image(await flat(out, background))] };
    },
  );

  server.tool(
    "export_design",
    "Tasarımı projenin art/ klasörüne PNG yazar ve asset olarak kaydeder (id = tasarım id'si). Sonra widget tool'larında brush={asset} ile kullanılır. Unreal brush değerlerini döndürür.",
    { design: z.string() },
    async ({ design }) => {
      const a = await exportDesign(getDesign(design));
      return { content: [text({ asset: a, unrealBrush: toUnrealBrush(a) })] };
    },
  );

  server.tool(
    "create_container",
    "Tek çağrıda hazır container: dikişsiz zemin dokusu (tile) + 9-slice çerçeve + üstte ortalanmış mücevher. " +
    "Üç tasarımı (<id>_bg, <id>_frame, <id>_gem) ve <id> widget'ını oluşturup dışa aktarır, önizlemeyi döndürür. Aynı id ile tekrar çağrılırsa üzerine yazar. " +
    "Sonra tasarımları update_layer/add_layer ile inceltip export_design ile yenileyebilirsin.",
    {
      id: designId, width: z.number().int().min(120).max(2048).default(480), height: z.number().int().min(120).max(2048).default(320),
      background: z.enum(MATERIAL_PRESETS).default("stone"), pattern: z.enum(STONE_PATTERNS).optional(), frame: z.enum(MATERIAL_PRESETS).default("gold"),
      thickness: z.number().int().min(10).max(90).default(30), radius: z.number().int().min(0).max(60).default(14),
      chamfer: z.boolean().default(true), cracks: z.boolean().default(true),
      ornaments: z.boolean().default(true), cornerSize: z.number().int().min(24).max(200).default(64), wear: z.number().min(0).max(1).default(0.5),
      gem: z.boolean().default(true), gemColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2fb5c9"),
      gemShape: z.enum(["diamond", "round", "hex"]).default("diamond"), gemSize: z.number().int().min(16).max(160).default(44),
    },
    async (p) => {
      const t = p.thickness, r = p.radius, c0 = Math.max(8, Math.round(r * 1.6));
      // Süs pah kırık köşenin dışına taşmasın diye içeri alınır; slice marjı süsü kapsar (yoksa gerilir).
      const orn = p.chamfer ? Math.round(c0 * 0.5) : 2;
      const m = Math.max(t + 14, p.ornaments ? p.cornerSize + orn + 2 : 0), S = 2 * m + 96;
      const bgD = DesignSchema.parse({ id: `${p.id}_bg`, kind: "tile", width: 256, height: 256, layers: [
        { id: "ground", kind: "box", inset: 0, fill: { kind: "material", preset: p.background, pattern: p.pattern, seed: 5, wear: p.wear * 0.8 } },
      ] });
      // Katmanlar dıştan içe: dış altın bant, koyu arduvaz bant (oyuk), iç altın çıta; toplam kalınlık = thickness.
      const g = Math.round(t * 0.42), rim = Math.max(3, Math.round(t * 0.12)), sl = t - g - rim;
      // Köşe biçimi: pah (chamfer) ya da yuvarlak; iç halkalarda eşit kalınlık için küçülür (inset 2 = dış altın başlangıcı).
      const corner = (inset: number) => (p.chamfer ? { chamfer: Math.max(0, Math.round(c0 - (inset - 2) * 0.586)) } : { radius: Math.max(0, r - (inset - 2)) });
      const gold = (seed: number) => ({ kind: "material" as const, preset: p.frame, seed, wear: p.wear });
      // Çatlaklar sadece bantlarda: her köşede üst/alt bant boyunca yatay, yan bant boyunca dikey birer çatlak.
      const cw = m - 12, b0 = Math.round(t * 0.3), bh = Math.round(t * 0.4), crackLayers: Record<string, unknown>[] = [];
      [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy], k) => {
        const at = (x0: number, y0: number, w: number, h: number) => ({ x: sx > 0 ? x0 : S - x0 - w, y: sy > 0 ? y0 : S - y0 - h, w, h });
        crackLayers.push({ id: `crack_h${k}`, kind: "cracks", ...at(8, b0, cw, bh), count: 1, length: Math.round(m * 0.5), seed: 11 + k, direction: 0 });
        crackLayers.push({ id: `crack_v${k}`, kind: "cracks", ...at(b0, 8, bh, cw), count: 1, length: Math.round(m * 0.5), seed: 21 + k, direction: Math.PI / 2 });
      });
      const frameD = DesignSchema.parse({ id: `${p.id}_frame`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: [
        { id: "outline", kind: "ring", inset: 0, thickness: t + 5, ...corner(0), fill: { kind: "solid", color: "#1a1008" } },
        { id: "gold_outer", kind: "ring", inset: 2, thickness: g, ...corner(2), fill: gold(3),
          effects: [{ kind: "bevel", depth: 6, size: Math.max(3, Math.round(g * 0.5)) }, { kind: "shadow", dx: 0, dy: 2, blur: 2, opacity: 0.5 }] },
        { id: "slate", kind: "ring", inset: 2 + g, thickness: sl, ...corner(2 + g),
          fill: { kind: "material", preset: "slate", pattern: "rough", scale: 2.2, seed: 6, wear: p.wear * 0.4 },
          effects: [{ kind: "innerShadow", blur: 4, dy: 2, opacity: 0.8 }] },
        { id: "gold_rim", kind: "ring", inset: 2 + g + sl, thickness: rim, ...corner(2 + g + sl), fill: gold(5),
          effects: [{ kind: "bevel", depth: 3, size: Math.max(2, rim - 1) }, { kind: "shadow", dx: 0, dy: 1, blur: 1.5, opacity: 0.6 }] },
        // iç dudak: açıklığa yumuşak gölge düşürür
        { id: "lip", kind: "ring", inset: 2 + t, thickness: 3, ...corner(2 + t), fill: { kind: "solid", color: "#0e0905", opacity: 0.9 },
          effects: [{ kind: "shadow", dx: 0, dy: 3, blur: 7, opacity: 0.75 }] },
        ...(p.cracks ? crackLayers : []),
        ...(p.ornaments ? [{ id: "corners", kind: "corners", style: "blade", size: p.cornerSize, inset: orn, fill: gold(4),
          stroke: { color: "#1a1008", width: 1.6 }, effects: [{ kind: "bevel", depth: 5, size: 6 }, { kind: "shadow", dx: 1, dy: 3, blur: 3, opacity: 0.6 }] }] : []),
      ] });
      const G = Math.round(p.gemSize * 2.2);
      const gemD = DesignSchema.parse({ id: `${p.id}_gem`, kind: "sprite", width: G, height: G, layers: [
        { id: "gem", kind: "gem", cx: G / 2, cy: G / 2 + 2, size: p.gemSize, color: p.gemColor, shape: p.gemShape },
      ] });
      for (const d of p.gem ? [bgD, frameD, gemD] : [bgD, frameD]) { compileDesign(d); designs.set(d.id, d); }
      if (!p.gem) designs.delete(gemD.id);
      const exported = await Promise.all((p.gem ? [bgD, frameD, gemD] : [bgD, frameD]).map(exportDesign));

      // Widget: gem'in üst kenardan taşan yarısı için tepeye pay bırakılır.
      const ov = p.gem ? Math.round(G / 2 - 4) : 0;
      const full = { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
      const widget: Widget = WidgetSchema.parse({ id: p.id, width: p.width, height: p.height + ov, root: { id: "Root", type: "CanvasPanel", children: [
        { id: "Background", type: "Image", brush: { asset: bgD.id }, slot: { ...full, offsets: { left: t - 2, top: ov + t - 2, right: t - 2, bottom: t - 2 } }, children: [] },
        { id: "Frame", type: "Image", brush: { asset: frameD.id }, slot: { ...full, offsets: { left: 0, top: ov, right: 0, bottom: 0 } }, children: [] },
        ...(p.gem ? [{ id: "Gem", type: "Image", brush: { asset: gemD.id }, slot: {
          anchors: { minX: 0.5, minY: 0, maxX: 0.5, maxY: 0 }, offsets: { left: 0, top: ov + Math.round(t * 0.45), right: G, bottom: G }, alignment: { x: 0.5, y: 0.5 } }, children: [] }] : []),
      ] } });
      widgets.set(widget.id, widget);
      notify();
      const png = await renderWidget(widget, assets);
      return {
        content: [
          text({
            widget: { id: widget.id, width: widget.width, height: widget.height },
            assets: exported.map((a) => ({ id: a.id, size: `${a.width}x${a.height}`, slice: a.slice, tile: a.tile, unrealBrush: toUnrealBrush(a) })),
          }),
          image(png),
        ],
      };
    },
  );
}
