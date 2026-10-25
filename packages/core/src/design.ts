import { z } from "zod";
import { SliceSchema, validateSlice } from "./slice.js";
import { MATERIAL_PRESETS, STONE_PATTERNS } from "./material.js";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "renk #RRGGBB olmalı");
const Stops = z.array(z.tuple([z.number().min(0).max(1), Color])).min(2);

export const TEXTURE_PRESETS = ["stone", "gold", "slate", "wood"] as const;
export type TexturePreset = (typeof TEXTURE_PRESETS)[number];

/** Doku dolgusu: şeklin içine procedural doku basar. Tile tasarımlarda dikişsiz (stitch) çalışır. */
const TextureFill = z.object({
  kind: z.literal("texture"),
  preset: z.enum(TEXTURE_PRESETS),
  colors: z.array(Color).min(2).max(6).optional(), // koyu → açık renk rampası; verilmezse preset'in rampası
  scale: z.number().positive().max(20).optional(), // doku frekansı çarpanı (büyük = daha ince taneli)
  contrast: z.number().min(0.2).max(6).optional(),
  seed: z.number().int().min(0).max(9999).optional(),
}).strict();

/** CPU malzeme dolgusu: Voronoi taş/blok, fırçalı metal, ahşap; kenar eğimi (bevel) gerçek yükseklikten hesaplanır. */
const MaterialFill = z.object({
  kind: z.literal("material"),
  preset: z.enum(MATERIAL_PRESETS),
  pattern: z.enum(STONE_PATTERNS).optional(), // sadece stone/slate
  colors: z.array(Color).min(2).max(6).optional(),
  scale: z.number().positive().max(20).optional(),
  seed: z.number().int().min(0).max(9999).optional(),
  wear: z.number().min(0).max(1).optional(), // 0..1: kenar aşınması + oyuklarda kir + lekeler
}).strict();

export const FillSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("solid"), color: Color, opacity: z.number().min(0).max(1).optional() }).strict(),
  z.object({ kind: z.literal("linear"), angle: z.number().optional(), stops: Stops }).strict(), // 0=soldan sağa, 90=yukarıdan aşağı
  z.object({ kind: z.literal("radial"), stops: Stops }).strict(),
  TextureFill,
  MaterialFill,
]);
export type Fill = z.infer<typeof FillSchema>;

export const EffectSchema = z.discriminatedUnion("kind", [
  // Metalik/kabartma: ışık yönüne göre kenar vurgusu ve gölgesi.
  z.object({ kind: z.literal("bevel"), depth: z.number().min(0.5).max(20).optional(), size: z.number().min(0.3).max(12).optional(),
    azimuth: z.number().optional(), highlight: Color.optional() }).strict(),
  z.object({ kind: z.literal("shadow"), dx: z.number().optional(), dy: z.number().optional(), blur: z.number().min(0).max(30).optional(),
    color: Color.optional(), opacity: z.number().min(0).max(1).optional() }).strict(),
  z.object({ kind: z.literal("innerShadow"), dx: z.number().optional(), dy: z.number().optional(), blur: z.number().min(0).max(30).optional(),
    color: Color.optional(), opacity: z.number().min(0).max(1).optional() }).strict(),
  z.object({ kind: z.literal("glow"), blur: z.number().min(0).max(40).optional(), color: Color.optional(), opacity: z.number().min(0).max(1).optional() }).strict(),
]);
export type Effect = z.infer<typeof EffectSchema>;

const Stroke = z.object({ color: Color, width: z.number().positive().max(64), opacity: z.number().min(0).max(1).optional() }).strict();
const num = z.number();

const common = {
  id: z.string().min(1),
  name: z.string().optional(),
  fill: FillSchema.optional(),
  stroke: Stroke.optional(),
  effects: z.array(EffectSchema).optional(),
  opacity: z.number().min(0).max(1).optional(),
  hidden: z.boolean().optional(),
};
// Kutu geometrisi: ya inset (tuvalin kenarından içeri) ya da x/y/w/h.
const boxGeo = { inset: num.min(0).optional(), x: num.optional(), y: num.optional(), w: num.positive().optional(), h: num.positive().optional(),
  radius: num.min(0).optional(), chamfer: num.min(0).optional() };

export const LayerSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("box"), ...boxGeo }).strict(),
  // Halka: kutunun dış sınırı, kalınlığı `thickness`; ortası boş (çerçeve için).
  z.object({ ...common, kind: z.literal("ring"), ...boxGeo, thickness: num.positive() }).strict(),
  z.object({ ...common, kind: z.literal("polygon"), points: z.array(z.tuple([num, num])).min(3) }).strict(),
  z.object({ ...common, kind: z.literal("ellipse"), cx: num, cy: num, rx: num.positive(), ry: num.positive() }).strict(),
  // Hazır mücevher: faset + (isteğe bağlı) altın yuva. fill/effects kullanmaz.
  z.object({ id: z.string().min(1), name: z.string().optional(), opacity: z.number().min(0).max(1).optional(), hidden: z.boolean().optional(),
    kind: z.literal("gem"), cx: num, cy: num, size: num.positive(), color: Color,
    shape: z.enum(["diamond", "round", "hex"]).optional(), setting: z.enum(["gold", "none"]).optional() }).strict(),
  // Köşe süsü: kıvrımlı bıçaklar (+ orta kabartma). fill/stroke/effects her parçaya uygulanır. Boyut slice marjını aşmamalı (gerilmesin).
  z.object({ ...common, kind: z.literal("corners"), style: z.enum(["blade"]), size: num.positive(), inset: num.min(0).optional(),
    which: z.array(z.enum(["tl", "tr", "bl", "br"])).min(1).optional(), studs: z.boolean().optional() }).strict(),
]);
export type Layer = z.infer<typeof LayerSchema>;

export const DESIGN_KINDS = ["frame9", "tile", "sprite"] as const;
export const DesignSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)"),
  kind: z.enum(DESIGN_KINDS), // frame9: 9-slice çerçeve/panel · tile: dikişsiz döşenen doku · sprite: tek parça süs
  width: z.number().int().min(8).max(2048),
  height: z.number().int().min(8).max(2048),
  slice: SliceSchema.optional(),
  layers: z.array(LayerSchema),
}).strict().superRefine((d, ctx) => {
  if (d.kind === "frame9") {
    if (!d.slice) return ctx.addIssue({ code: "custom", message: "frame9 için slice gerekli" });
    try { validateSlice(d.slice, d.width, d.height); } catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); }
  } else if (d.slice) ctx.addIssue({ code: "custom", message: `${d.kind} tasarımında slice olmaz` });
  const ids = d.layers.map((l) => l.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "katman id'leri benzersiz olmalı" });
});
export type Design = z.infer<typeof DesignSchema>;

// ---------- renk yardımcıları ----------
const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
/** f>0 beyaza, f<0 siyaha doğru karıştırır. */
export const shade = (h: string, f: number) => rgb2hex(hex2rgb(h).map((v) => (f >= 0 ? v + (255 - v) * f : v * (1 + f))));

// ---------- doku preset'leri ----------
interface Preset { a: [number, number, number]; b: [number, number, number]; surface: number; ramp: string[]; contrast: number; veins?: boolean }
const PRESETS: Record<TexturePreset, Preset> = {
  // a: geniş lekeler (fx, fy, oktav), b: ince tane (fx, fy, oktav), surface: kabartma şiddeti
  stone: { a: [0.022, 0.022, 5], b: [0.2, 0.2, 3], surface: 1.5, ramp: ["#4a463f", "#7b756b", "#a39b8d", "#bdb4a3"], contrast: 1.7 },
  gold: { a: [0.008, 0.03, 2], b: [0.6, 0.6, 2], surface: 0.5, ramp: ["#3e260a", "#8a5d16", "#d9a93f", "#fbe89a", "#c9922e", "#6e4712"], contrast: 1.9 },
  slate: { a: [0.02, 0.02, 4], b: [0.6, 0.6, 2], surface: 1.4, ramp: ["#0f1517", "#1c2528", "#33403f"], contrast: 2.4 },
  wood: { a: [0.012, 0.11, 4], b: [0.4, 0.4, 2], surface: 1.1, ramp: ["#34200f", "#5f3f20", "#8a6234"], contrast: 2.6 },
};
export const presetInfo = () => Object.fromEntries(TEXTURE_PRESETS.map((k) => [k, { defaultColors: PRESETS[k].ramp }]));

const f2 = (n: number) => +n.toFixed(3);

function textureStep(t: z.infer<typeof TextureFill>, out: string): string {
  const p = PRESETS[t.preset], s = t.scale ?? 1, seed = t.seed ?? 1, k = t.contrast ?? p.contrast;
  const ramp = (t.colors ?? p.ramp).map(hex2rgb);
  const table = (ch: number) => ramp.map((c) => f2(c[ch] / 255)).join(" ");
  const gray = `values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"`;
  const lin = `type="linear" slope="${k}" intercept="${f2(0.5 - 0.5 * k)}"`;
  const veins = p.veins
    ? `<feTurbulence type="turbulence" baseFrequency="${f2(0.009 * s)}" numOctaves="3" seed="${seed + 11}" stitchTiles="stitch" result="vn"/>
       <feColorMatrix in="vn" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -16 0 0 0 1.05" result="vl"/>
       <feComponentTransfer in="vl" result="vd"><feFuncA type="linear" slope=".42"/></feComponentTransfer>
       <feMerge result="tex2"><feMergeNode in="tex"/><feMergeNode in="vd"/></feMerge>`
    : `<feOffset in="tex" dx="0" dy="0" result="tex2"/>`;
  return `<feTurbulence type="fractalNoise" baseFrequency="${f2(p.a[0] * s)} ${f2(p.a[1] * s)}" numOctaves="${p.a[2]}" seed="${seed}" stitchTiles="stitch" result="na"/>
    <feTurbulence type="fractalNoise" baseFrequency="${f2(p.b[0] * s)} ${f2(p.b[1] * s)}" numOctaves="${p.b[2]}" seed="${seed + 3}" stitchTiles="stitch" result="nb"/>
    <feColorMatrix in="na" type="matrix" ${gray} result="ag"/>
    <feComponentTransfer in="ag" result="ac"><feFuncR ${lin}/><feFuncG ${lin}/><feFuncB ${lin}/></feComponentTransfer>
    <feComponentTransfer in="ac" result="col"><feFuncR type="table" tableValues="${table(0)}"/><feFuncG type="table" tableValues="${table(1)}"/><feFuncB type="table" tableValues="${table(2)}"/></feComponentTransfer>
    <feDiffuseLighting in="nb" surfaceScale="${p.surface}" diffuseConstant="1" lighting-color="#ffffff" result="lit"><feDistantLight azimuth="225" elevation="58"/></feDiffuseLighting>
    <feComposite in="col" in2="lit" operator="arithmetic" k1="1.3" k2="0" k3="0" k4="0" result="tex"/>
    ${veins}
    <feComposite in="tex2" in2="SourceAlpha" operator="in" result="${out}"/>`;
}

// ---------- efekt zinciri ----------
function effectStep(e: Effect, cur: string, out: string): string {
  switch (e.kind) {
    case "bevel": {
      const d = e.depth ?? 4, az = e.azimuth ?? 235;
      return `<feGaussianBlur in="SourceAlpha" stdDeviation="${e.size ?? 1.6}" result="${out}_b"/>
        <feSpecularLighting in="${out}_b" surfaceScale="${d}" specularConstant=".75" specularExponent="26" lighting-color="${e.highlight ?? "#ffe9a8"}" result="${out}_s"><feDistantLight azimuth="${az}" elevation="42"/></feSpecularLighting>
        <feComposite in="${out}_s" in2="SourceAlpha" operator="in" result="${out}_si"/>
        <feDiffuseLighting in="${out}_b" surfaceScale="${d}" diffuseConstant="1" lighting-color="#ffffff" result="${out}_d"><feDistantLight azimuth="${az}" elevation="58"/></feDiffuseLighting>
        <feComposite in="${cur}" in2="${out}_d" operator="arithmetic" k1="1.18" k2="0" k3="0" k4="0" result="${out}_l"/>
        <feComposite in="${out}_l" in2="${out}_si" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${out}_o"/>
        <feComposite in="${out}_o" in2="SourceAlpha" operator="in" result="${out}"/>`;
    }
    case "shadow":
      // feDropShadow yerine temel primitifler: librsvg, feDropShadow'a önceki bir sonucu `in` verince beyaz üretiyor.
      return `<feGaussianBlur in="${cur}" stdDeviation="${e.blur ?? 3}" result="${out}_b"/>
        <feOffset in="${out}_b" dx="${e.dx ?? 2}" dy="${e.dy ?? 4}" result="${out}_o"/>
        <feFlood flood-color="${e.color ?? "#000000"}" flood-opacity="${e.opacity ?? 0.6}" result="${out}_c"/>
        <feComposite in="${out}_c" in2="${out}_o" operator="in" result="${out}_s"/>
        <feMerge result="${out}"><feMergeNode in="${out}_s"/><feMergeNode in="${cur}"/></feMerge>`;
    case "innerShadow":
      return `<feComponentTransfer in="SourceAlpha" result="${out}_i"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>
        <feGaussianBlur in="${out}_i" stdDeviation="${e.blur ?? 4}" result="${out}_g"/>
        <feOffset in="${out}_g" dx="${e.dx ?? 0}" dy="${e.dy ?? 2}" result="${out}_o"/>
        <feFlood flood-color="${e.color ?? "#000000"}" flood-opacity="${e.opacity ?? 0.6}" result="${out}_c"/>
        <feComposite in="${out}_c" in2="${out}_o" operator="in" result="${out}_m"/>
        <feComposite in="${out}_m" in2="SourceAlpha" operator="in" result="${out}_k"/>
        <feMerge result="${out}"><feMergeNode in="${cur}"/><feMergeNode in="${out}_k"/></feMerge>`;
    case "glow":
      return `<feGaussianBlur in="SourceAlpha" stdDeviation="${e.blur ?? 6}" result="${out}_g"/>
        <feFlood flood-color="${e.color ?? "#ffd27a"}" flood-opacity="${e.opacity ?? 0.8}" result="${out}_c"/>
        <feComposite in="${out}_c" in2="${out}_g" operator="in" result="${out}_m"/>
        <feMerge result="${out}"><feMergeNode in="${out}_m"/><feMergeNode in="${cur}"/></feMerge>`;
  }
}

// ---------- geometri ----------
const fmt = (n: number) => String(+n.toFixed(2));
function boxPath(x: number, y: number, w: number, h: number, r = 0, c = 0): string {
  if (c > 0) {
    c = Math.min(c, w / 2, h / 2);
    return `M${fmt(x + c)},${fmt(y)} H${fmt(x + w - c)} L${fmt(x + w)},${fmt(y + c)} V${fmt(y + h - c)} L${fmt(x + w - c)},${fmt(y + h)} H${fmt(x + c)} L${fmt(x)},${fmt(y + h - c)} V${fmt(y + c)} Z`;
  }
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) return `M${fmt(x)},${fmt(y)} H${fmt(x + w)} V${fmt(y + h)} H${fmt(x)} Z`;
  const a = `A${fmt(r)},${fmt(r)} 0 0 1`;
  return `M${fmt(x + r)},${fmt(y)} H${fmt(x + w - r)} ${a} ${fmt(x + w)},${fmt(y + r)} V${fmt(y + h - r)} ${a} ${fmt(x + w - r)},${fmt(y + h)} H${fmt(x + r)} ${a} ${fmt(x)},${fmt(y + h - r)} V${fmt(y + r)} ${a} ${fmt(x + r)},${fmt(y)} Z`;
}

export type Shape = Exclude<Layer, { kind: "gem" | "corners" }>;

function geometry(l: Shape, W: number, H: number): { d: string; evenodd: boolean } {
  switch (l.kind) {
    case "polygon": return { d: `M${l.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" L")} Z`, evenodd: false };
    case "ellipse": return { d: `M${fmt(l.cx - l.rx)},${fmt(l.cy)} A${fmt(l.rx)},${fmt(l.ry)} 0 1 0 ${fmt(l.cx + l.rx)},${fmt(l.cy)} A${fmt(l.rx)},${fmt(l.ry)} 0 1 0 ${fmt(l.cx - l.rx)},${fmt(l.cy)} Z`, evenodd: false };
    case "box":
    case "ring": {
      const i = l.inset;
      const x = i ?? l.x ?? 0, y = i ?? l.y ?? 0;
      const w = i !== undefined ? W - 2 * i : l.w ?? W - x, h = i !== undefined ? H - 2 * i : l.h ?? H - y;
      const r = l.radius ?? 0, c = l.chamfer ?? 0;
      const outer = boxPath(x, y, w, h, r, c);
      if (l.kind === "box") return { d: outer, evenodd: false };
      const t = l.thickness;
      if (w - 2 * t <= 0 || h - 2 * t <= 0) throw new Error(`ring ${l.id}: thickness kutuya sığmıyor`);
      // Eşit kalınlık için iç yarıçap r-t, iç pah c - t(2-√2).
      return { d: `${outer} ${boxPath(x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0, r - t), c > 0 ? Math.max(0, c - t * 0.586) : 0)}`, evenodd: true };
    }
  }
}

// ---------- mücevher: alt katmanlara genişler ----------
function expandGem(g: Extract<Layer, { kind: "gem" }>): Layer[] {
  const r = g.size / 2, { cx, cy } = g, shape = g.shape ?? "diamond", id = g.id;
  const out: Layer[] = [];
  const pts = (rr: number, k: number): [number, number][] => shape === "hex"
    ? Array.from({ length: 6 }, (_, i) => [cx + rr * Math.cos((Math.PI / 3) * i), cy + rr * Math.sin((Math.PI / 3) * i)] as [number, number])
    : shape === "round" ? [] : [[cx, cy - rr], [cx + rr * k, cy], [cx, cy + rr], [cx - rr * k, cy]];
  const gold = (sub: string, shapeL: Shape): Layer => ({ ...shapeL, id: `${id}__${sub}`,
    fill: { kind: "material", preset: "gold", scale: 1.4 }, stroke: { color: "#1a1008", width: 2 },
    effects: [{ kind: "bevel", depth: 2.5, size: 4 }, { kind: "shadow", dx: 1.5, dy: 3, blur: 3, opacity: 0.6 }] } as Layer);
  if ((g.setting ?? "gold") === "gold") {
    out.push(shape === "round"
      ? gold("set", { id: "", kind: "ellipse", cx, cy, rx: r * 1.32, ry: r * 1.32 })
      : gold("set", { id: "", kind: "polygon", points: pts(r * 1.36, 0.85) }));
    out.push({ id: `${id}__well`, kind: "polygon", points: shape === "round" ? [[cx - r * 1.06, cy], [cx, cy - r * 1.06], [cx + r * 1.06, cy], [cx, cy + r * 1.06]] : pts(r * 1.08, 0.85), fill: { kind: "solid", color: "#0d0906" } });
  }
  const dark = shade(g.color, -0.55), mid = shade(g.color, -0.15), light = shade(g.color, 0.35), hi = shade(g.color, 0.7);
  const tri = (sub: string, p: [number, number][], color: string): Layer =>
    ({ id: `${id}__${sub}`, kind: "polygon", points: p, fill: { kind: "solid", color }, stroke: { color: shade(g.color, -0.7), width: 1 } });
  if (shape === "round") {
    out.push({ id: `${id}__body`, kind: "ellipse", cx, cy, rx: r, ry: r,
      fill: { kind: "radial", stops: [[0, light], [0.55, g.color], [1, dark]] }, stroke: { color: shade(g.color, -0.7), width: 1.2 },
      effects: [{ kind: "innerShadow", blur: r * 0.25, dx: 0, dy: r * 0.1, opacity: 0.55 }] });
  } else {
    const P = pts(r, 0.85), c: [number, number] = [cx, cy], shades = [light, g.color, dark, mid];
    P.forEach((p, i) => out.push(tri(`f${i}`, [c, p, P[(i + 1) % P.length]], P.length === 6 ? [light, g.color, mid, dark, mid, g.color][i] : shades[i])));
  }
  out.push({ id: `${id}__glint`, kind: "ellipse", cx: cx - r * 0.28, cy: cy - r * 0.32, rx: r * 0.22, ry: r * 0.12, fill: { kind: "solid", color: hi, opacity: 0.75 } });
  return out.map((l) => ({ ...l, opacity: g.opacity, hidden: g.hidden }) as Layer);
}

// ---------- köşe süsü ----------
type Pt = [number, number];
const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 10): Pt[] => Array.from({ length: n }, (_, k) => {
  const t = (k + 1) / n, u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]] as Pt;
});
// "blade" birim şekilleri (160x160 kutu, sol üst köşe orijin): bir bıçak (diğeri köşegende aynalanır), orta diken, orta kabartma.
const BLADE: Pt[] = [[28, 14], ...cubic([28, 14], [70, 10], [118, 14], [158, 30]), ...cubic([158, 30], [112, 34], [84, 52], [74, 88]), ...cubic([74, 88], [62, 58], [46, 46], [26, 44])];
const THORN: Pt[] = [[56, 72], [106, 106], [72, 56]];
const STUD: Pt[] = [[44, 26], [62, 44], [44, 62], [26, 44]];

function expandCorners(c: Extract<Layer, { kind: "corners" }>, W: number, H: number): Layer[] {
  const k = c.size / 160, inset = c.inset ?? 0, out: Layer[] = [];
  const parts: [string, Pt[]][] = [["horn_a", BLADE], ["horn_b", BLADE.map(([x, y]) => [y, x] as Pt)], ["thorn", THORN], ...(c.studs === false ? [] : [["stud", STUD] as [string, Pt[]]])];
  for (const corner of c.which ?? ["tl", "tr", "bl", "br"]) {
    for (const [name, pts] of parts) {
      out.push({ id: `${c.id}__${corner}_${name}`, kind: "polygon", fill: c.fill, stroke: c.stroke, effects: c.effects, opacity: c.opacity,
        points: pts.map(([x, y]) => {
          const px = inset + x * k, py = inset + y * k;
          return [corner[1] === "r" ? W - px : px, corner[0] === "b" ? H - py : py] as Pt;
        }) });
    }
  }
  return out;
}

/** Görünür katmanlar; mücevher ve köşe süsleri alt şekillere açılmış (çizim sırasıyla). */
export function expandLayers(d: Design): Shape[] {
  const out: Shape[] = [];
  for (const l of d.layers) {
    if (l.hidden) continue;
    const subs: Layer[] = l.kind === "gem" ? expandGem(l) : l.kind === "corners" ? expandCorners(l, d.width, d.height) : [l];
    for (const s of subs) if (!s.hidden && s.kind !== "gem" && s.kind !== "corners") out.push(s);
  }
  return out;
}

// ---------- derleyici ----------
export function compileDesign(d: Design): string {
  const W = d.width, H = d.height;
  const defs: string[] = [], body: string[] = [];

  const emit = (l: Shape) => {
    const { d: path, evenodd } = geometry(l, W, H);
    let fill = "none";
    const f = l.fill;
    if (f?.kind === "solid") fill = f.color;
    else if (f?.kind === "texture" || f?.kind === "material") fill = "#ffffff";
    else if (f?.kind === "linear" || f?.kind === "radial") {
      const stops = f.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
      if (f.kind === "linear") {
        const a = ((f.angle ?? 90) * Math.PI) / 180, cx = Math.cos(a) / 2, cy = Math.sin(a) / 2;
        defs.push(`<linearGradient id="g_${l.id}" x1="${f2(0.5 - cx)}" y1="${f2(0.5 - cy)}" x2="${f2(0.5 + cx)}" y2="${f2(0.5 + cy)}">${stops}</linearGradient>`);
      } else defs.push(`<radialGradient id="g_${l.id}" cx=".4" cy=".35" r=".75">${stops}</radialGradient>`);
      fill = `url(#g_${l.id})`;
    }
    const steps: string[] = [];
    let cur = "SourceGraphic";
    if (f?.kind === "texture") { steps.push(textureStep(f, "t0")); cur = "t0"; }
    (l.effects ?? []).forEach((e, i) => { steps.push(effectStep(e, cur, `e${i}`)); cur = `e${i}`; });
    let filterAttr = "";
    if (steps.length) {
      // Bölge = tuval (userSpaceOnUse): dönüşüm kullanmadığımız için güvenli; stitchTiles dikişsizliği buna bağlı.
      defs.push(`<filter id="f_${l.id}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${steps.join("")}</filter>`);
      filterAttr = ` filter="url(#f_${l.id})"`;
    }
    const fo = f?.kind === "solid" && f.opacity !== undefined ? ` fill-opacity="${f.opacity}"` : "";
    const st = l.stroke ? ` stroke="${l.stroke.color}" stroke-width="${l.stroke.width}" stroke-opacity="${l.stroke.opacity ?? 1}" stroke-linejoin="round"` : "";
    const op = l.opacity !== undefined ? ` opacity="${l.opacity}"` : "";
    body.push(`<path d="${path}" fill="${fill}"${fo}${evenodd ? ' fill-rule="evenodd"' : ""}${st}${op}${filterAttr}/>`);
  };

  for (const s of expandLayers(d)) emit(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join("")}</defs>${body.join("\n")}</svg>`;
}
