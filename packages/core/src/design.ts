import { z } from "zod";
import { SliceSchema, validateSlice } from "./slice.js";
import { MATERIAL_PRESETS, NOISE_STYLES, STONE_PATTERNS, hash2 } from "./material.js";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "renk #RRGGBB olmalı");
// Durak rengi #RRGGBB ya da #RRGGBBAA (son iki hane saydamlık): vinyet gibi saydama dönen geçişler için.
const StopColor = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "renk #RRGGBB veya #RRGGBBAA olmalı");
const Stops = z.array(z.tuple([z.number().min(0).max(1), StopColor])).min(2);

export const BLEND_MODES = ["multiply", "screen", "overlay", "soft-light", "lighten", "darken"] as const;
export const TEXTURE_PRESETS = ["stone", "gold", "slate", "wood"] as const;
export type TexturePreset = (typeof TEXTURE_PRESETS)[number];

/** Doku dolgusu: şeklin içine procedural doku basar. Tile tasarımlarda dikişsiz (stitch) çalışır. */
// SVG özniteliğine yazıldığı için kümeyi kısıtlı tutar (enjeksiyon yok); komut/argüman sayısı doğrulanmaz: bozuk yol çizimde boş kalır.
export const REPEATS = ["stud", "diamond", "tick", "dash", "chevron", "thorn"] as const;
export const MOTIFS = ["chevrons", "wings", "crest", "rune"] as const;
const PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/;

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

/** Gürültü dolgusu: prosedürel bulut/gren/hücre/çizik, renk rampasıyla. Blend ve maskelerle kir, pas, gren, ışık için. */
const NoiseFill = z.object({
  kind: z.literal("noise"),
  style: z.enum(NOISE_STYLES),
  scale: z.number().positive().max(20).optional(), // büyük = daha ince desen
  contrast: z.number().min(0.2).max(6).optional(),
  seed: z.number().int().min(0).max(9999).optional(),
  colors: z.array(Color).min(2).max(6).optional(), // koyu → açık; varsayılan siyah → beyaz
}).strict();

export const FillSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("solid"), color: Color, opacity: z.number().min(0).max(1).optional() }).strict(),
  z.object({ kind: z.literal("linear"), angle: z.number().optional(), stops: Stops }).strict(), // 0=soldan sağa, 90=yukarıdan aşağı
  z.object({ kind: z.literal("radial"), stops: Stops, cx: z.number().optional(), cy: z.number().optional(), r: z.number().positive().optional() }).strict(), // cx/cy/r: 0..1 tuval oranı (varsayılan .4/.35/.75; vinyet için .5/.5/.75)
  TextureFill,
  MaterialFill,
  NoiseFill,
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
  // Bulanıklık: katmanın son hâlini (tüm efektlerden sonra, maskeden önce) gaussian bulanıklaştırır; radius = sigma px. Yumuşak ışık, sis, derinlik.
  z.object({ kind: z.literal("blur"), radius: z.number().min(0.3).max(80) }).strict(),
  z.object({ kind: z.literal("glow"), blur: z.number().min(0).max(40).optional(), color: Color.optional(), opacity: z.number().min(0).max(1).optional() }).strict(),
  // Film greni: şeklin içine koyulaştıran ince gürültü (amount 0..1, size = tane sıklığı çarpanı). Sadece SVG hattında; `material` dolgulu katmanlarda yok sayılır.
  z.object({ kind: z.literal("grain"), amount: z.number().min(0).max(1).optional(), size: z.number().positive().max(8).optional(), seed: z.number().int().min(0).max(9999).optional() }).strict(),
]);
export type Effect = z.infer<typeof EffectSchema>;

const Stroke = z.object({ color: Color, width: z.number().positive().max(64), opacity: z.number().min(0).max(1).optional() }).strict();
const num = z.number();

// Maske: bu katman yalnızca `layer` (aynı tasarımdaki başka bir üst düzey katman) boyalı olan yerde görünür.
// use: alpha (varsayılan: maskenin şeffaflığı) | luma (parlaklık × alfa: siyah→beyaz gradyan geçişli maske). invert: tersi. Maske katmanı hidden:true ile çıktıdan gizlenir ama maske olarak çalışır.
export const MaskSchema = z.object({ layer: z.string().min(1), use: z.enum(["alpha", "luma"]).optional(), invert: z.boolean().optional() }).strict();
const common = {
  id: z.string().min(1),
  name: z.string().optional(),
  fill: FillSchema.optional(),
  stroke: Stroke.optional(),
  effects: z.array(EffectSchema).optional(),
  opacity: z.number().min(0).max(1).optional(),
  blend: z.enum(BLEND_MODES).optional(), // alttaki katmanlarla karışım (PNG hattında; compileDesign tek başına SVG'de uygulamaz)
  hidden: z.boolean().optional(),
  mask: MaskSchema.optional(),
};
// Kutu geometrisi: ya inset (tuvalin kenarından içeri) ya da x/y/w/h.
const boxGeo = { inset: num.min(0).optional(), x: num.optional(), y: num.optional(), w: num.positive().optional(), h: num.positive().optional(),
  radius: num.min(0).optional(), chamfer: num.min(0).optional() };

export const LayerSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("box"), ...boxGeo }).strict(),
  // Halka: kutunun dış sınırı, kalınlığı `thickness`; ortası boş (çerçeve için).
  z.object({ ...common, kind: z.literal("ring"), ...boxGeo, thickness: num.positive() }).strict(),
  // smooth: 0..1 — köşeleri Catmull-Rom→Bézier ile yuvarlar (1 = tam yumuşak); corners: yumuşatılmayacak (keskin) köşe indeksleri.
  z.object({ ...common, kind: z.literal("polygon"), points: z.array(z.tuple([num, num])).min(3), smooth: z.number().min(0).max(1).optional(), corners: z.array(z.number().int().min(0)).optional() }).strict(),
  // Tekrar: çokgen çizgi (points) boyunca her step px'te bir süs öğesi (stud nokta, diamond, tick, dash, chevron), çizgi yönüne döner (rotate:false → sabit).
  // Tüm öğeler tek yol katmanı olur (tek geçiş: malzeme dolgusunda da hızlı). Kenar boyunca perçin/boncuk/diş dizisi, ayraç çizgileri için.
  z.object({ ...common, kind: z.literal("repeat"), style: z.enum(REPEATS), points: z.array(z.tuple([num, num])).min(2), step: num.min(3), size: num.positive().max(200), margin: num.min(0).optional(), rotate: z.boolean().optional(), jitter: z.number().min(0).max(0.8).optional() }).strict(),
  // Fırça darbesi: points boyunca yumuşatılmış, kalınlığı değişen dolu şerit. width tepe kalınlığı px; taper uç incelmesi (0..0.5, çizgi boyunun oranı; 0 = künt uç);
  // wobble 0..1 kalınlık dalgalanması (elle çizilmiş his). Tek yol katmanı olur; yumuşak kenar için blur efekti, doku için malzeme/noise dolgusu + mask kullan.
  z.object({ ...common, kind: z.literal("brush"), points: z.array(z.tuple([num, num])).min(2).max(60), width: num.positive().max(300), taper: z.number().min(0).max(0.5).optional(), wobble: z.number().min(0).max(1).optional(), seed: z.number().int().optional() }).strict(),
  // Motif: hazır süs (chevrons «» oklar, wings kanat, crest tepe süsü, rune mühür halkası). (cx,cy) merkez, size yükseklik px;
  // mirror: tuval ortasına göre karşı tarafa aynalı kopya (kanat/ok çifti). fill/stroke/effects her parçaya uygulanır.
  z.object({ ...common, kind: z.literal("motif"), style: z.enum(MOTIFS), cx: num, cy: num, size: num.positive(), mirror: z.boolean().optional() }).strict(),
  // Bant: silüet yolunun (d) kenar mesafesine göre dilimi — from..to px aralığındaki bölge (to yoksa merkeze kadar). Eşit kalınlıklı çerçeve katmanları için;
  // yalnız PNG hattında çizilir (SVG derleyici yok sayar). Malzeme dolgusunda bevel bant kenarlarını izler.
  z.object({ ...common, kind: z.literal("band"), d: z.string().min(2).max(4000).regex(PATH_CHARS).regex(/^\s*[Mm]/), from: num.min(0), to: num.positive().optional() }).strict(),
  // Yol: SVG path verisi (M L H V C S Q T A Z, mutlak/göreli). Gerçek Bézier/yay eğrileri; kapalı alan dolgulanır, istenirse stroke.
  z.object({ ...common, kind: z.literal("path"), d: z.string().min(2).max(4000).regex(PATH_CHARS, "d yalnızca SVG yol komutları, sayı ve ayraç içerebilir").regex(/^\s*[Mm]/, "d bir M komutuyla başlamalı"), evenodd: z.boolean().optional() }).strict(),
  z.object({ ...common, kind: z.literal("ellipse"), cx: num, cy: num, rx: num.positive(), ry: num.positive() }).strict(),
  // Hazır mücevher: faset + (isteğe bağlı) altın yuva. fill/effects kullanmaz.
  z.object({ id: z.string().min(1), name: z.string().optional(), opacity: z.number().min(0).max(1).optional(), hidden: z.boolean().optional(), mask: MaskSchema.optional(),
    kind: z.literal("gem"), cx: num, cy: num, size: num.positive(), color: Color,
    shape: z.enum(["diamond", "round", "hex"]).optional(), setting: z.enum(["gold", "none"]).optional(),
    settingColors: z.array(Color).min(2).max(6).optional() }).strict(), // settingColors: yuva metalinin koyu→açık rampası (varsayılan altın)
  // Köşe süsü: kıvrımlı bıçaklar (+ orta kabartma). fill/stroke/effects her parçaya uygulanır. Boyut slice marjını aşmamalı (gerilmesin).
  z.object({ ...common, kind: z.literal("corners"), style: z.enum(["blade", "scroll", "claw", "filigree"]), size: num.positive(), inset: num.min(0).optional(),
    which: z.array(z.enum(["tl", "tr", "bl", "br"])).min(1).optional(), studs: z.boolean().optional() }).strict(),
  // Açık uçlu çizgi (çatlak, tel, oyuk): stroke zorunlu; closed=true ise kapanır.
  z.object({ ...common, kind: z.literal("line"), points: z.array(z.tuple([num, num])).min(2), closed: z.boolean().optional() }).strict(),
  // Çatlak üretici: x,y,w,h bölgesine count adet dallanan çatlak (koyu iz + ince parlak kenar). Aynı seed → aynı çatlaklar.
  z.object({ id: z.string().min(1), name: z.string().optional(), opacity: z.number().min(0).max(1).optional(), hidden: z.boolean().optional(), mask: MaskSchema.optional(),
    kind: z.literal("cracks"), x: num, y: num, w: num.positive(), h: num.positive(), count: z.number().int().min(1).max(40).optional(),
    length: num.positive().optional(), seed: z.number().int().min(0).max(9999).optional(), color: Color.optional(), width: num.positive().max(8).optional(),
    highlight: z.boolean().optional(),
    direction: num.optional(), spread: num.positive().max(6.3).optional() }).strict(), // direction (rad): çatlakları bir yöne hizalar; spread: sapma (varsayılan 0.8)
  // Perçin: points sol üst köşeye göre (px), 4 köşeye aynalanır. Varsayılan: kubbeli altın (bevel ile gerçek kubbe gölgesi).
  z.object({ ...common, kind: z.literal("rivets"), points: z.array(z.tuple([num, num])).min(1), size: num.positive().max(48),
    which: z.array(z.enum(["tl", "tr", "bl", "br"])).min(1).optional() }).strict(),
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
  // Simetri: sol (x), üst (y) ya da sol-üst çeyrek (xy) çizilir, kalanı PNG çıktısında aynalanır; ışık, doku ve çatlaklar birebir yansır (ışık dış kenarlardan gelir).
  symmetry: z.enum(["x", "y", "xy"]).optional(),
}).strict().superRefine((d, ctx) => {
  if (d.symmetry && d.kind === "tile") ctx.addIssue({ code: "custom", message: "tile tasarımında symmetry olmaz (dikişsizlik bozulur)" });
  if (d.kind === "frame9") {
    if (!d.slice) return ctx.addIssue({ code: "custom", message: "frame9 için slice gerekli" });
    try { validateSlice(d.slice, d.width, d.height); } catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); }
  } else if (d.slice) ctx.addIssue({ code: "custom", message: `${d.kind} tasarımında slice olmaz` });
  const ids = d.layers.map((l) => l.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "katman id'leri benzersiz olmalı" });
  // maske referansları: var olan başka bir katman, döngü yok
  const byId = new Map(d.layers.map((l) => [l.id, l]));
  for (const l of d.layers) {
    if (!l.mask) continue;
    if (!byId.has(l.mask.layer)) ctx.addIssue({ code: "custom", message: `${l.id}: maske katmanı yok: ${l.mask.layer}` });
    else if (l.mask.layer === l.id) ctx.addIssue({ code: "custom", message: `${l.id}: katman kendi maskesi olamaz` });
    else for (let cur = byId.get(l.mask.layer), n = 0; cur?.mask; cur = byId.get(cur.mask.layer), n++) {
      if (cur.mask.layer === l.id || n > d.layers.length) { ctx.addIssue({ code: "custom", message: `${l.id}: maske döngüsü` }); break; }
    }
  }
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
    case "grain": {
      const a = e.amount ?? 0.3;
      return `<feTurbulence type="fractalNoise" baseFrequency="${0.9 * (e.size ?? 1)}" numOctaves="2" seed="${e.seed ?? 3}" result="${out}_n"/>
        <feColorMatrix in="${out}_n" type="matrix" values="${-a} 0 0 0 1  ${-a} 0 0 0 1  ${-a} 0 0 0 1  0 0 0 0 1" result="${out}_m"/>
        <feBlend in="${out}_m" in2="${cur}" mode="multiply" result="${out}_x"/>
        <feComposite in="${out}_x" in2="SourceAlpha" operator="in" result="${out}"/>`;
    }
    case "blur": // bulanıklık katman sonunda PNG hattında uygulanır; SVG zincirinde geçiş
      return `<feOffset in="${cur}" dx="0" dy="0" result="${out}"/>`;
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

export type Shape = Exclude<Layer, { kind: "gem" | "corners" | "cracks" | "rivets" | "motif" | "repeat" | "brush" }>;

/** Kapalı çokgeni Catmull-Rom → kübik Bézier'e çevirir; tension 0..1, `sharp` köşelerde teğet sıfırlanır (köşe korunur). */
function smoothPath(P: [number, number][], tension: number, sharp: Set<number>): string {
  const n = P.length, at = (i: number) => P[((i % n) + n) % n], f = (p: [number, number]) => `${fmt(p[0])},${fmt(p[1])}`;
  const k = tension / 6;
  let d = `M${f(P[0])}`;
  for (let i = 0; i < n; i++) {
    const a = at(i), b = at(i + 1), p = at(i - 1), q = at(i + 2);
    const c1: [number, number] = sharp.has(i % n) ? a : [a[0] + (b[0] - p[0]) * k, a[1] + (b[1] - p[1]) * k];
    const c2: [number, number] = sharp.has((i + 1) % n) ? b : [b[0] - (q[0] - a[0]) * k, b[1] - (q[1] - a[1]) * k];
    d += ` C${f(c1)} ${f(c2)} ${f(b)}`;
  }
  return `${d} Z`;
}

function geometry(l: Shape, W: number, H: number): { d: string; evenodd: boolean } {
  switch (l.kind) {
    case "line":
      if (!l.stroke) throw new Error(`line ${l.id}: stroke gerekli`);
      return { d: `M${l.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" L")}${l.closed ? " Z" : ""}`, evenodd: false };
    case "polygon": return { d: l.smooth ? smoothPath(l.points, l.smooth, new Set(l.corners)) : `M${l.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" L")} Z`, evenodd: false };
    case "path": return { d: l.d, evenodd: !!l.evenodd };
    case "band": return { d: l.d, evenodd: false };
    case "ellipse": return { d: `M${fmt(l.cx - l.rx)},${fmt(l.cy)} A${fmt(l.rx)},${fmt(l.ry)} 0 1 0 ${fmt(l.cx + l.rx)},${fmt(l.cy)} A${fmt(l.rx)},${fmt(l.ry)} 0 1 0 ${fmt(l.cx - l.rx)},${fmt(l.cy)} Z`, evenodd: false };
    case "box":
    case "ring": {
      const i = l.inset;
      const x = i ?? l.x ?? 0, y = i ?? l.y ?? 0;
      // Açıkça verilen w/h her zaman kazanır; inset yalnızca eksik olanları tuvalden içeri doldurur.
      const w = l.w ?? (i !== undefined ? W - 2 * i : W - x), h = l.h ?? (i !== undefined ? H - 2 * i : H - y);
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
    fill: { kind: "material", preset: "gold", ...(g.settingColors ? { colors: g.settingColors } : {}), scale: 1.4 }, stroke: { color: "#1a1008", width: 2 },
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
  // faset masası (yüzlerin üstüne açık tablo) + alt sağda zayıf yansıma: düz renkli üçgenleri camsı gösterir
  if (shape !== "round") out.push({ id: `${id}__table`, kind: "polygon", points: pts(r * 0.46, 0.85), fill: { kind: "solid", color: hi, opacity: 0.22 }, stroke: { color: hi, width: 0.8, opacity: 0.45 } });
  out.push({ id: `${id}__bounce`, kind: "ellipse", cx: cx + r * 0.3, cy: cy + r * 0.36, rx: r * 0.2, ry: r * 0.09, fill: { kind: "solid", color: light, opacity: 0.35 } });
  out.push({ id: `${id}__glint`, kind: "ellipse", cx: cx - r * 0.28, cy: cy - r * 0.32, rx: r * 0.22, ry: r * 0.12, fill: { kind: "solid", color: hi, opacity: 0.75 } });
  return out.map((l) => ({ ...l, opacity: g.opacity, hidden: g.hidden }) as Layer);
}

// ---------- motifler ----------
/** Birim şekiller (merkez 0,0; yükseklik ≈ 100): çokgen parçalar ya da yol (delikli) — expandMotif ölçekler, konumlar, aynalar. */
function motifParts(style: (typeof MOTIFS)[number]): { name: string; pts?: Pt[]; d?: (k: number, cx: number, cy: number) => string; evenodd?: boolean }[] {
  switch (style) {
    case "chevrons": {
      const one = (x: number): Pt[] => [[x - 22, -40], [x + 4, -40], [x + 34, 0], [x + 4, 40], [x - 22, 40], [x + 8, 0]];
      return [{ name: "a", pts: one(-14) }, { name: "b", pts: one(18) }];
    }
    case "wings": {
      // sağ kanat: kökten yukarı-dışa yelpaze gibi açılan 3 sivrilen kıvrık bıçak (sol kanat mirror ile)
      return [[-76, 86], [-52, 108], [-26, 96]].map(([deg, L], i) => {
        const a = (deg * Math.PI) / 180, tip: Pt = [L * Math.cos(a), L * Math.sin(a)];
        return { name: `blade${i}`, pts: ribbon([[0, 0], ...cubic([0, 0], [tip[0] * 0.35, tip[1] * 0.1], [tip[0] * 0.75, tip[1] * 0.55], tip, 14)], 30 - i * 4, 2) };
      });
    }
    case "crest": return [
      { name: "gem", pts: [[0, -34], [15, 0], [0, 34], [-15, 0]] },
      { name: "spikeL", pts: [[-15, -6], [-52, 0], [-15, 6]] }, { name: "spikeR", pts: [[15, -6], [52, 0], [15, 6]] },
      { name: "cap", pts: [[0, -50], [7, -38], [0, -34], [-7, -38]] },
    ];
    case "rune": return [
      { name: "ring", evenodd: true, d: (k, cx, cy) => { const o = 40 * k, i = 30 * k, c = (r: number) => `M${f2(cx - r)},${f2(cy)} A${f2(r)},${f2(r)} 0 1 0 ${f2(cx + r)},${f2(cy)} A${f2(r)},${f2(r)} 0 1 0 ${f2(cx - r)},${f2(cy)} Z`; return `${c(o)} ${c(i)}`; } },
      { name: "diamond", pts: [[0, -22], [14, 0], [0, 22], [-14, 0]] }, { name: "tick1", pts: [[-3, -52], [3, -52], [0, -42]] }, { name: "tick2", pts: [[-3, 52], [3, 52], [0, 42]] },
    ];
  }
}

function expandMotif(m: Extract<Layer, { kind: "motif" }>, W: number): Layer[] {
  const k = m.size / 100, out: Layer[] = [];
  const base = { fill: m.fill, stroke: m.stroke, effects: m.effects, opacity: m.opacity, blend: m.blend };
  for (const p of motifParts(m.style)) {
    for (const mir of m.mirror ? [false, true] : [false]) {
      const id = `${m.id}__${p.name}${mir ? "_m" : ""}`;
      if (p.d) out.push({ id, kind: "path", d: p.d(k, mir ? W - m.cx : m.cx, m.cy), evenodd: p.evenodd, ...base } as Layer);
      else out.push({ id, kind: "polygon", points: p.pts!.map(([x, y]) => [mir ? W - (m.cx + x * k) : m.cx + x * k, m.cy + y * k] as Pt), ...base } as Layer);
    }
  }
  return out;
}

// ---------- tekrar (çizgi boyunca yinelenen süs) ----------
function expandRepeat(r: Extract<Layer, { kind: "repeat" }>): Layer[] {
  const S = r.size, keep = r.rotate !== false, local: Record<string, Pt[]> = {
    diamond: [[S / 2, 0], [0, S / 3], [-S / 2, 0], [0, -S / 3]],
    tick: [[-Math.max(1, S * 0.12), -S / 2], [Math.max(1, S * 0.12), -S / 2], [Math.max(1, S * 0.12), S / 2], [-Math.max(1, S * 0.12), S / 2]],
    dash: [[-S / 2, -Math.max(1, S * 0.12)], [S / 2, -Math.max(1, S * 0.12)], [S / 2, Math.max(1, S * 0.12)], [-S / 2, Math.max(1, S * 0.12)]],
    chevron: [[-S / 2, -S / 2], [0, -S / 2], [S / 2, 0], [0, S / 2], [-S / 2, S / 2], [0, 0]],
    // thorn: tabanı çizgi üzerinde, ucu çizginin SOLUNA (yerel -y) bakan, çizgi yönüne yaslanan kıvrık diken; yukarı doğru giden çizgide dışarı bakar
    thorn: [[-0.42 * S, 0], [-0.12 * S, -0.55 * S], [0.38 * S, -1.25 * S], [0.16 * S, -0.5 * S], [0.42 * S, 0]],
  };
  // çok parçalı tek yol: her öğe alt yol; böylece tek geçişte (tek malzeme boyaması) çizilir. Öğeler çizgi boyunca toplam mesafeyle yerleşir.
  const segs = r.points.slice(1).map((p, i) => ({ a: r.points[i], len: Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]), b: p })), total = segs.reduce((t, g) => t + g.len, 0);
  let d = "", at = 0;
  for (let k = 0, s = r.margin ?? 0; s <= total + 1e-6 && k < 600; k++, s += r.step) {
    while (at < segs.length - 1 && s > segs.slice(0, at + 1).reduce((t, g) => t + g.len, 0)) at++;
    const g = segs[at], before = segs.slice(0, at).reduce((t, q) => t + q.len, 0);
    if (g.len === 0) continue;
    const ux = (g.b[0] - g.a[0]) / g.len, uy = (g.b[1] - g.a[1]) / g.len, t = Math.min(g.len, s - before), cx = g.a[0] + ux * t, cy = g.a[1] + uy * t;
    const ang = keep ? Math.atan2(uy, ux) : 0, ca = Math.cos(ang), sa = Math.sin(ang);
    if (r.style === "stud") { const R = S / 2; d += `M${f2(cx - R)},${f2(cy)} A${f2(R)},${f2(R)} 0 1 0 ${f2(cx + R)},${f2(cy)} A${f2(R)},${f2(R)} 0 1 0 ${f2(cx - R)},${f2(cy)} Z `; continue; }
    const kk = 1 - (r.jitter ?? 0) * hash2(k, 3, 17); // öğe boyu değişimi (jitter) tohumsuz ama konuma bağlı: yeniden çizimde aynı
    d += `M${local[r.style].map(([lx, ly]) => `${f2(cx + kk * (lx * ca - ly * sa))},${f2(cy + kk * (lx * sa + ly * ca))}`).join(" L")} Z `;
  }
  if (!d) return [];
  return [{ id: `${r.id}__items`, kind: "path", d: d.trim(), fill: r.fill, stroke: r.stroke, effects: r.effects, opacity: r.opacity, blend: r.blend } as Layer];
}

// ---------- fırça darbesi ----------
function expandBrush(b: Extract<Layer, { kind: "brush" }>): Layer[] {
  const P = b.points, tp = b.taper ?? 0.25, wob = b.wobble ?? 0, seed = b.seed ?? 1;
  // Catmull-Rom ile yumuşatılmış örnekler
  const pts: Pt[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 10; k++) {
      const t = k / 10, t2 = t * t, t3 = t2 * t;
      pts.push([0, 1].map((a) => 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - 3 * p2[a] + p3[a] - p0[a]) * t3)) as Pt);
    }
  }
  pts.push(P[P.length - 1]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [];
  const left: Pt[] = [], right: Pt[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
    const tx = c[0] - a[0], ty = c[1] - a[1], tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl, u = cum[i] / total;
    const edge = tp > 0 ? Math.min(1, Math.min(u, 1 - u) / tp) : 1, ease = Math.sin((edge * Math.PI) / 2);
    const q = cum[i] / 8, q0 = Math.floor(q), nz = 2 * (hash2(q0, seed, 5) * (1 - (q - q0)) + hash2(q0 + 1, seed, 5) * (q - q0)); // 8 px aralıklı yumuşak değer gürültüsü
    const w = (b.width / 2) * (tp > 0 ? ease : 1) * (1 + wob * 0.5 * (nz - 1));
    left.push([p[0] + nx * w, p[1] + ny * w]); right.push([p[0] - nx * w, p[1] - ny * w]);
  });
  const d = "M" + [...left, ...right.reverse()].map(([x, y]) => `${f2(x)},${f2(y)}`).join(" L") + " Z";
  return [{ id: `${b.id}__stroke`, kind: "path", d, fill: b.fill, stroke: b.stroke, effects: b.effects, opacity: b.opacity, blend: b.blend } as Layer];
}

// ---------- köşe süsü ----------
type Pt = [number, number];
const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 10): Pt[] => Array.from({ length: n }, (_, k) => {
  const t = (k + 1) / n, u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]] as Pt;
});
// Birim şekiller 160x160 kutuda, sol üst köşe orijin. "_b" parçası köşegende aynalanır (x↔y).
const swap = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [y, x] as Pt);
const BLADE: Pt[] = [[28, 14], ...cubic([28, 14], [70, 10], [118, 14], [158, 30]), ...cubic([158, 30], [112, 34], [84, 52], [74, 88]), ...cubic([74, 88], [62, 58], [46, 46], [26, 44])];
const THORN: Pt[] = [[56, 72], [106, 106], [72, 56]];
const STUD: Pt[] = [[44, 26], [62, 44], [44, 62], [26, 44]];

/** İnceliği azalan, sona doğru içe kıvrılan sarmal (volüt) şerit: orta çizgi + yan kaydırma ile çokgen. */
function scrollShape(): Pt[] {
  const P: Pt[] = [[22, 50], [52, 52], [86, 32], [118, 32]], C: Pt = [118, 58], center: Pt[] = [P[0], ...cubic(P[0], P[1], P[2], P[3], 24)];
  for (let k = 1; k <= 48; k++) { const f = k / 48, th = -Math.PI / 2 + f * 3 * Math.PI, r = 26 - f * 20; center.push([C[0] + r * Math.cos(th), C[1] + r * Math.sin(th)]); }
  return ribbon(center, 13, 3);
}
const SCROLL = scrollShape();

/** Orta çizgi boyunca kalınlığı w0'dan w1'e doğrusal değişen şerit (çokgen): ince, uca doğru sivrilen kıvrımlar için. */
function ribbon(center: Pt[], w0: number, w1: number): Pt[] {
  const left: Pt[] = [], right: Pt[] = [], n = center.length;
  center.forEach(([x, y], i) => {
    const [ax, ay] = center[Math.max(0, i - 1)], [bx, by] = center[Math.min(n - 1, i + 1)], len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len, ny = (bx - ax) / len, w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push([x + nx * w, y + ny * w]); right.push([x - nx * w, y - ny * w]);
  });
  return [...left, ...right.reverse()];
}
const path = (...segs: [Pt, Pt, Pt, Pt, number][]): Pt[] => segs.flatMap(([a, b, c, d, n], i) => (i ? cubic(a, b, c, d, n) : [a, ...cubic(a, b, c, d, n)]));
// filigran: koyu bandın içine oturan diken kümesi. Her diken tabanda geniş, ucu kıvrık sivri, alt kenarı içbükey (iki kol köşegende
// aynalanır) + köşegen boyunca içe bakan simetrik bir diken; ortada küçük elmas.
const FIL_ARM: Pt[] = [[34, 32], ...cubic([34, 32], [58, 20], [92, 30], [132, 12], 18), ...cubic([132, 12], [106, 38], [80, 40], [60, 58], 18)];
const FIL_THORN: Pt[] = [[48, 72], ...cubic([48, 72], [72, 76], [88, 84], [98, 98], 14), ...cubic([98, 98], [84, 88], [76, 72], [72, 48], 14)];
const CLAW_A: Pt[] = [[40, 18], ...cubic([40, 18], [80, 14], [116, 22], [152, 46]), ...cubic([152, 46], [112, 36], [78, 36], [42, 42])];
const CLAW_C: Pt[] = [[30, 56], ...cubic([30, 56], [62, 58], [90, 78], [108, 108]), ...cubic([108, 108], [78, 90], [58, 62], [56, 30])];
const ORNAMENTS: Record<"blade" | "scroll" | "claw" | "filigree", [string, Pt[]][]> = {
  filigree: [["arm_a", FIL_ARM], ["arm_b", swap(FIL_ARM)], ["thorn", FIL_THORN]],
  blade: [["horn_a", BLADE], ["horn_b", swap(BLADE)], ["thorn", THORN]],
  scroll: [["scroll_a", SCROLL], ["scroll_b", swap(SCROLL)]],
  claw: [["claw_a", CLAW_A], ["claw_b", swap(CLAW_A)], ["claw_c", CLAW_C]],
};

const CORNERS = ["tl", "tr", "bl", "br"] as const;
/** Sol üst köşeye göre (x,y) noktasını istenen köşeye aynalar. */
const toCorner = (corner: string, x: number, y: number, W: number, H: number): Pt => [corner[1] === "r" ? W - x : x, corner[0] === "b" ? H - y : y];

function expandCorners(c: Extract<Layer, { kind: "corners" }>, W: number, H: number): Layer[] {
  const k = c.size / 160, inset = c.inset ?? 0, out: Layer[] = [];
  const parts = [...ORNAMENTS[c.style], ...(c.studs === false ? [] : [["stud", STUD] as [string, Pt[]]])];
  for (const corner of c.which ?? CORNERS) {
    for (const [name, pts] of parts) {
      out.push({ id: `${c.id}__${corner}_${name}`, kind: "polygon", fill: c.fill, stroke: c.stroke, effects: c.effects, opacity: c.opacity,
        points: pts.map(([x, y]) => toCorner(corner, inset + x * k, inset + y * k, W, H)) });
    }
  }
  return out;
}

function expandRivets(r: Extract<Layer, { kind: "rivets" }>, W: number, H: number): Layer[] {
  const rad = r.size / 2, out: Layer[] = [];
  for (const corner of r.which ?? CORNERS) {
    r.points.forEach(([x, y], i) => {
      const [cx, cy] = toCorner(corner, x, y, W, H);
      out.push({ id: `${r.id}__${corner}_${i}`, kind: "ellipse", cx, cy, rx: rad, ry: rad, opacity: r.opacity,
        fill: r.fill ?? { kind: "material", preset: "gold", scale: 2 }, stroke: r.stroke ?? { color: "#1a1008", width: 1 },
        effects: r.effects ?? [{ kind: "bevel", depth: Math.max(0.5, Math.min(20, rad * 0.9)), size: Math.min(12, rad) }, { kind: "shadow", dx: 0.8, dy: 1.5, blur: 1.5, opacity: 0.6 }] });
    });
  }
  return out;
}

// ---------- çatlaklar ----------
function expandCracks(c: Extract<Layer, { kind: "cracks" }>): Layer[] {
  const n = c.count ?? 3, len = c.length ?? 40, seed = c.seed ?? 1, wd = c.width ?? 1.4, out: Layer[] = [];
  // Açı her adımda biraz sapar → kırık çizgi; salt her çatlağa özgü rastgelelik verir.
  // direction verilmişse çatlak başlangıç yönüne geri çekilir (aksi halde sapma birikir, yüzeyin dışına savrulur).
  const pull = c.direction === undefined ? 0 : 0.4;
  const walk = (x: number, y: number, a: number, segs: number, step: number, salt: number): Pt[] => {
    const pts: Pt[] = [[x, y]], anchor = a;
    for (let k = 0; k < segs; k++) { a += (hash2(salt, k + 3, seed) - 0.5) * 1.1 + (anchor - a) * pull; x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push([x, y]); }
    return pts;
  };
  for (let i = 0; i < n; i++) {
    const a0 = c.direction === undefined ? hash2(i, 2, seed) * Math.PI * 2 : c.direction + (hash2(i, 2, seed) - 0.5) * (c.spread ?? 0.8), segs = 6, step = len / segs;
    const main = walk(c.x + hash2(i, 0, seed) * c.w, c.y + hash2(i, 1, seed) * c.h, a0, segs, step, i * 10);
    const lines = [main];
    if (hash2(i, 9, seed) > 0.45) lines.push(walk(main[3][0], main[3][1], a0 + (hash2(i, 8, seed) > 0.5 ? 0.9 : -0.9), 3, step * 0.8, i * 10 + 5));
    lines.forEach((pts, j) => {
      if (c.highlight !== false) out.push({ id: `${c.id}__${i}_${j}h`, kind: "line", points: pts.map(([x, y]) => [x + 0.9, y + 0.9] as Pt), stroke: { color: "#fff1b8", width: wd * 0.6, opacity: 0.22 } });
      out.push({ id: `${c.id}__${i}_${j}`, kind: "line", points: pts, stroke: { color: c.color ?? "#1a1008", width: wd * (j ? 0.7 : 1), opacity: 0.8 } });
    });
  }
  return out.map((l) => ({ ...l, opacity: c.opacity, hidden: c.hidden }) as Layer);
}

/** Görünür katmanlar; mücevher, köşe süsü ve çatlaklar alt şekillere açılmış (çizim sırasıyla). */
export function expandLayers(d: Design): Shape[] {
  const out: Shape[] = [];
  for (const l of d.layers) {
    if (l.hidden) continue;
    const subs: Layer[] = l.kind === "gem" ? expandGem(l) : l.kind === "corners" ? expandCorners(l, d.width, d.height) : l.kind === "cracks" ? expandCracks(l) : l.kind === "rivets" ? expandRivets(l, d.width, d.height) : l.kind === "motif" ? expandMotif(l, d.width) : l.kind === "repeat" ? expandRepeat(l) : l.kind === "brush" ? expandBrush(l) : [l];
    for (const s of subs) if (l.mask && !s.mask) s.mask = l.mask; // açılımlar (motif, köşe, gem...) ana katmanın maskesini devralır
    for (const s of subs) if (!s.hidden && s.kind !== "gem" && s.kind !== "corners" && s.kind !== "cracks" && s.kind !== "rivets" && s.kind !== "motif" && s.kind !== "repeat" && s.kind !== "brush") out.push(s);
  }
  return out;
}

// ---------- derleyici ----------
export function compileDesign(d: Design): string {
  const W = d.width, H = d.height;
  const defs: string[] = [], body: string[] = [];

  const emit = (l: Shape) => {
    if (l.kind === "band") return; // bant katmanları yalnız PNG hattında (CPU mesafe alanı) çizilir
    const { d: path, evenodd } = geometry(l, W, H);
    let fill = "none";
    const f = l.fill;
    if (f?.kind === "solid") fill = f.color;
    else if (f?.kind === "texture" || f?.kind === "material" || f?.kind === "noise") fill = "#ffffff";
    else if (f?.kind === "linear" || f?.kind === "radial") {
      const stops = f.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c.slice(0, 7)}"${c.length > 7 ? ` stop-opacity="${f2(parseInt(c.slice(7), 16) / 255)}"` : ""}/>`).join("");
      if (f.kind === "linear") {
        const a = ((f.angle ?? 90) * Math.PI) / 180, cx = Math.cos(a) / 2, cy = Math.sin(a) / 2;
        defs.push(`<linearGradient id="g_${l.id}" x1="${f2(0.5 - cx)}" y1="${f2(0.5 - cy)}" x2="${f2(0.5 + cx)}" y2="${f2(0.5 + cy)}">${stops}</linearGradient>`);
      } else defs.push(`<radialGradient id="g_${l.id}" cx="${f.cx ?? 0.4}" cy="${f.cy ?? 0.35}" r="${f.r ?? 0.75}">${stops}</radialGradient>`);
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
    const st = l.stroke ? ` stroke="${l.stroke.color}" stroke-width="${l.stroke.width}" stroke-opacity="${l.stroke.opacity ?? 1}" stroke-linejoin="round" stroke-linecap="round"` : "";
    const op = l.opacity !== undefined ? ` opacity="${l.opacity}"` : "";
    body.push(`<path d="${path}" fill="${fill}"${fo}${evenodd ? ' fill-rule="evenodd"' : ""}${st}${op}${filterAttr}/>`);
  };

  for (const s of expandLayers(d)) emit(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join("")}</defs>${body.join("\n")}</svg>`;
}
