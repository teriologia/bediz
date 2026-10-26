import { z } from "zod";
import { DesignSchema, shade, type Design } from "./design.js";
import { MATERIAL_PRESETS, STONE_PATTERNS, type MaterialPreset, type StonePattern } from "./material.js";
import { WidgetSchema, type Widget } from "./scene.js";

const STYLES = ["blade", "scroll", "claw", "filigree"] as const;

/** Yerleşik temalar; kayıtlı özel paletler (registerPalette) CONTAINER_THEMES / THEME_LOOK'a eklenir ve tema adı olarak kullanılır. */
export const THEME_NAMES = ["gold-stone", "silver-slate", "bronze-wood", "ruby-blocks", "emerald-bronze"] as const;
export type ThemeName = string;
export const isTheme = (n: string) => n in CONTAINER_THEMES;
export const ThemeSchema = z.string().refine(isTheme, { message: "bilinmeyen tema (yerleşik tema ya da register_palette ile kayıtlı ad)" });

/** Tema başına bileşen renkleri: yüzey degradesi (üst/alt), yazı, çubuk dolgusu. Metal, container temasından gelir. */
export const THEME_LOOK: Record<ThemeName, { top: string; bottom: string; text: string; fill: string }> = {
  "gold-stone": { top: "#2e3a39", bottom: "#141a1c", text: "#d8bf86", fill: "#4a9a5c" },
  "silver-slate": { top: "#2b3b4a", bottom: "#10171e", text: "#cfd6df", fill: "#4a86c4" },
  "bronze-wood": { top: "#4a3018", bottom: "#20130a", text: "#d8b48a", fill: "#c47a30" },
  "ruby-blocks": { top: "#521620", bottom: "#260a0f", text: "#d8bf86", fill: "#a8283a" },
  "emerald-bronze": { top: "#18443a", bottom: "#0a2019", text: "#d8b48a", fill: "#3a9a68" },
};

// ---------- serbest palet
const Hex6 = z.string().regex(/^#[0-9a-fA-F]{6}$/, "renk #RRGGBB olmalı");
export const PaletteSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "ad küçük harf/rakam/_/- (en çok 40)").refine((n) => !(THEME_NAMES as readonly string[]).includes(n), "yerleşik tema adı kullanılamaz"),
  surface: Hex6, // bileşen yüzeyinin AÇIK tonu (düğme/alan gövdesi); alt tonu otomatik koyulaşır
  accent: Hex6, // çubuk dolgusu, mücevher, vurgu
  metal: Hex6, // çerçeve metalinin orta tonu (rampa otomatik: koyu → açık)
  text: Hex6,
  ground: Hex6.optional(), // panel zemin döşemesinin rengi (varsayılan: surface)
  gemShape: z.enum(["diamond", "round", "hex"]).optional(),
  cornerStyle: z.enum(STYLES).optional(),
}).strict();
export type Palette = z.infer<typeof PaletteSchema>;

const ramp5 = (h: string) => [shade(h, -0.72), shade(h, -0.42), h, shade(h, 0.3), shade(h, 0.62)];
/** Özel tema adı → malzeme renk rampaları ve çizgi rengi (ghost stil); yerleşik temalarda yok. */
const customRamps = new Map<string, { metal: string[]; ground: string[]; band: string[]; line: string }>();
export const rampOf = (theme: ThemeName): { colors?: string[] } => { const r = customRamps.get(theme); return r ? { colors: r.metal } : {}; };
export const rampsOf = (theme: ThemeName) => customRamps.get(theme);
const GHOST_LINES: Record<string, string> = { gold: "#c9a45a", silver: "#b9c2cc", bronze: "#b87b45", wood: "#a9855a", stone: "#a09a8e", slate: "#8e9aa6", leather: "#a9855a", marble: "#c8c8d0", carbon: "#8a8f99", cloth: "#b87a8a", papyrus: "#8a6a3a", parchment: "#9a7a48" };
/** Ghost stilde çizgi rengi: özel palette metalin açık tonu, yerleşik temada metal ön ayarının rengi. */
export const lineOf = (theme: ThemeName, frame?: MaterialPreset): string => customRamps.get(theme)?.line ?? GHOST_LINES[frame ?? CONTAINER_THEMES[theme].frame ?? "gold"] ?? "#c9a45a";

/** Serbest paleti tema olarak kaydeder (aynı ad yeniden çağrılırsa üzerine yazar). Dönüş: tema adı. */
export function registerPalette(input: Palette): string {
  const p = PaletteSchema.parse(input), ground = p.ground ?? p.surface;
  THEME_LOOK[p.name] = { top: p.surface, bottom: shade(p.surface, -0.55), text: p.text, fill: p.accent };
  CONTAINER_THEMES[p.name] = { background: "stone", pattern: "flagstone", frame: "silver", band: "slate", gemColor: p.accent, gemShape: p.gemShape ?? "diamond", cornerStyle: p.cornerStyle ?? "filigree" };
  customRamps.set(p.name, { metal: ramp5(p.metal), ground: ramp5(ground), band: ramp5(shade(p.surface, -0.2)), line: shade(p.metal, 0.35) });
  return p.name;
}

/** Tarifin çözülmüş (varsayılanlar + tema + kullanıcı) parametreleri. */
export interface ContainerParams {
  width: number; height: number;
  background: MaterialPreset; pattern?: StonePattern; frame: MaterialPreset; band: MaterialPreset;
  thickness: number; radius: number; chamfer: boolean; cracks: boolean; wear: number;
  ornaments: boolean; cornerStyle: (typeof STYLES)[number]; cornerSize: number;
  gem: boolean; gemColor: string; gemShape: "diamond" | "round" | "hex"; gemSize: number;
  style: "metal" | "ghost";
  dim: number; shade: boolean;
}

const BASE: ContainerParams = {
  width: 480, height: 320, background: "stone", pattern: "flagstone", frame: "gold", band: "slate",
  thickness: 30, radius: 14, chamfer: true, cracks: true, wear: 0.5,
  ornaments: true, cornerStyle: "filigree", cornerSize: 64, gem: true, gemColor: "#2a9fb0", gemShape: "diamond", gemSize: 44, style: "metal", dim: 0.28, shade: true,
};
// ghost: ince çift çizgi, süs/mücevher/çatlak yok; çizgi rengi çerçeve metalinden gelir.
const GHOST: Partial<ContainerParams> = { thickness: 16, gem: false, ornaments: false, cracks: false, dim: 0.45 };

/** Hazır görünümler: sadece farkları yazılır, kullanıcı parametreleri üstüne biner. */
export const CONTAINER_THEMES: Record<ThemeName, Partial<ContainerParams>> = {
  "gold-stone": {},
  "silver-slate": { background: "slate", pattern: "flagstone", frame: "silver", band: "slate", cornerStyle: "filigree", gemColor: "#5f9bd6", gemShape: "round" },
  "bronze-wood": { background: "wood", pattern: undefined, frame: "bronze", band: "wood", cornerStyle: "scroll", chamfer: false, radius: 12, gemColor: "#e0892a", gemShape: "hex" },
  "ruby-blocks": { background: "stone", pattern: "blocks", frame: "gold", band: "slate", cornerStyle: "filigree", gemColor: "#a8283a", gemShape: "diamond" },
  "emerald-bronze": { background: "slate", pattern: "blocks", frame: "bronze", band: "slate", cornerStyle: "scroll", gemColor: "#2fbf71", gemShape: "round" },
};

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "renk #RRGGBB olmalı");
export const ContainerInputSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)"),
  theme: ThemeSchema.optional(),
  width: z.number().int().min(120).max(2048).optional(), height: z.number().int().min(120).max(2048).optional(),
  background: z.enum(MATERIAL_PRESETS).optional(), pattern: z.enum(STONE_PATTERNS).optional(),
  frame: z.enum(MATERIAL_PRESETS).optional(), band: z.enum(MATERIAL_PRESETS).optional(),
  thickness: z.number().int().min(10).max(90).optional(), radius: z.number().int().min(0).max(60).optional(),
  chamfer: z.boolean().optional(), cracks: z.boolean().optional(), wear: z.number().min(0).max(1).optional(),
  ornaments: z.boolean().optional(), cornerStyle: z.enum(STYLES).optional(), cornerSize: z.number().int().min(24).max(200).optional(),
  style: z.enum(["metal", "ghost"]).optional(), // ghost: ince çizgili çerçeve (metal bevel/süs yok)
  dim: z.number().min(0).max(0.9).optional(), shade: z.boolean().optional(), // dim: zemini karartma; shade: vinyet + sıcak ışık katmanı (derinlik)
  gem: z.boolean().optional(), gemColor: Hex.optional(), gemShape: z.enum(["diamond", "round", "hex"]).optional(), gemSize: z.number().int().min(16).max(160).optional(),
}).strict();
export type ContainerInput = z.infer<typeof ContainerInputSchema>;

export interface ContainerRecipe {
  theme: ThemeName;
  resolved: ContainerParams;
  bg: Design; frame: Design; gem?: Design; shade?: Design; widget: Widget;
}

/**
 * Tek çağrılık container: dikişsiz zemin (tile) + 9-slice çerçeve + üstte mücevher sprite'ı + bunları birleştiren widget.
 * Çerçeve dıştan içe: dış altın bant, arduvaz bant (oyuk), iç çıta; toplam kalınlık = thickness.
 */
export function containerRecipe(input: ContainerInput): ContainerRecipe {
  const { id, theme = "gold-stone", ...explicit } = ContainerInputSchema.parse(input);
  const defined = Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined));
  const p: ContainerParams = { ...BASE, ...CONTAINER_THEMES[theme], ...(defined.style === "ghost" ? GHOST : {}), ...defined };
  const line = lineOf(theme, p.frame), ramps = rampsOf(theme);
  const t = p.thickness, r = p.radius, c0 = Math.max(8, Math.round(r * 1.6));

  // Süs pah kırık köşenin dışına taşmasın diye içeri alınır; slice marjı süsü kapsar (yoksa gerilir).
  const orn = p.chamfer ? Math.round(c0 * 0.5) : 2;
  const m = Math.max(t + 14, p.ornaments ? p.cornerSize + orn + 2 : 0), S = 2 * m + 96;
  // Çerçeve tuvali, göstereceği boyuta eşitlenir (gerilme yok): dar tuvali 5× germek dokuyu uzatıp bulandırır, bu kaynak çözünürlüğü sınırı (dokuyu önceden sıkıştırmak
  // yatayda pikselleşme verdi). Tuval en az S; piksel bütçesi (≈1.1 MP) aşılırsa eski kompakt tuval + gerilme.
  const CW = Math.max(S, p.width), CH = Math.max(S, p.height), exact = CW * CH <= 1_100_000, FW = exact ? CW : S, FH = exact ? CH : S;
  // İnce altın çerçeve, geniş koyu bant (PC oyunu oranı); dış kontur 1 px.
  const o = 1, g = Math.max(3, Math.round(t * 0.24)), rim = Math.max(2, Math.round(t * 0.1)), sl = t - g - rim;
  // Köşe biçimi: pah ya da yuvarlak; iç halkalarda eşit kalınlık için küçülür (inset o = dış altın başlangıcı).
  const corner = (inset: number) => (p.chamfer ? { chamfer: Math.max(0, Math.round(c0 - (inset - o) * 0.586)) } : { radius: Math.max(0, r - (inset - o)) });
  const metal = (seed: number, wear = p.wear * 0.5) => ({ kind: "material" as const, preset: p.frame, ...(ramps ? { colors: ramps.metal } : {}), seed, wear });

  // Çatlaklar sadece bantlarda: her köşede üst/alt bant boyunca yatay, yan bant boyunca dikey birer çatlak.
  const cw = m - 12, b0 = o + g + 3, bh = Math.max(4, sl - 6), cracks: Record<string, unknown>[] = [];
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy], k) => {
    const at = (x0: number, y0: number, w: number, h: number) => ({ x: sx > 0 ? x0 : FW - x0 - w, y: sy > 0 ? y0 : FH - y0 - h, w, h });
    cracks.push({ id: `crack_h${k}`, kind: "cracks", ...at(8, b0, cw, bh), count: 1, length: Math.round(m * 0.5), seed: 11 + k, direction: 0 });
    cracks.push({ id: `crack_v${k}`, kind: "cracks", ...at(b0, 8, bh, cw), count: 1, length: Math.round(m * 0.5), seed: 21 + k, direction: Math.PI / 2 });
  });

  const BT = p.width * p.height > 300_000 ? 512 : 256; // büyük panelde döşeme tekrarı belli olmasın
  const bg = DesignSchema.parse({ id: `${id}_bg`, kind: "tile", width: BT, height: BT, layers: [
    { id: "ground", kind: "box", inset: 0, fill: { kind: "material", preset: p.background, pattern: p.pattern, ...(ramps ? { colors: ramps.ground } : {}), seed: 5, wear: p.wear * 0.8 } },
    ...(p.dim > 0 ? [{ id: "dim", kind: "box", inset: 0, fill: { kind: "solid", color: "#000000", opacity: p.dim } }] : []),
  ] });
  // Derinlik katmanı: ortadan kenara sönen sıcak ışık (screen) + kenar vinyeti; zeminle çerçeve arasında gerilir.
  const lineHex = line;
  const shade = p.shade ? DesignSchema.parse({ id: `${id}_shade`, kind: "sprite", width: 256, height: 256, layers: [
    { id: "light", kind: "box", inset: 0, blend: "screen", fill: { kind: "radial", cx: 0.5, cy: 0.38, r: 0.6, stops: [[0, `${lineHex}40`], [1, `${lineHex}00`]] } },
    { id: "vignette", kind: "box", inset: 0, fill: { kind: "radial", cx: 0.5, cy: 0.5, r: 0.8, stops: [[0.35, "#00000000"], [1, "#000000b8"]] } },
  ] }) : undefined;
  const ghostLayers = [
    { id: "shade", kind: "ring", inset: 0, thickness: 4, ...corner(0), fill: { kind: "solid", color: "#000000", opacity: 0.55 }, effects: [{ kind: "shadow", dx: 0, dy: 2, blur: 5, opacity: 0.6 }] },
    { id: "line", kind: "ring", inset: 1, thickness: 2, ...corner(1), fill: { kind: "solid", color: line, opacity: 0.85 } },
    { id: "line2", kind: "ring", inset: 7, thickness: 1, ...corner(7), fill: { kind: "solid", color: line, opacity: 0.4 } },
  ];
  const frame = DesignSchema.parse({ id: `${id}_frame`, kind: "frame9", width: FW, height: FH, slice: { left: m, top: m, right: m, bottom: m }, layers: p.style === "ghost" ? ghostLayers : [
    { id: "outline", kind: "ring", inset: 0, thickness: t + o + 3, ...corner(0), fill: { kind: "solid", color: "#120b05" } },
    { id: "gold_outer", kind: "ring", inset: o, thickness: g, ...corner(o), fill: metal(3),
      effects: [{ kind: "bevel", depth: 4, size: Math.max(2, Math.round(g * 0.6)) }, { kind: "shadow", dx: 0, dy: 2, blur: 4, opacity: 0.7 }] },
    { id: "slate", kind: "ring", inset: o + g, thickness: sl, ...corner(o + g),
      fill: { kind: "material", preset: p.band, pattern: "fine", ...(ramps ? { colors: ramps.band } : {}), scale: 2.2, seed: 6, wear: p.wear * 0.25 },
      effects: [{ kind: "innerShadow", blur: 6, dy: 2, opacity: 0.9 }] },
    { id: "gold_rim", kind: "ring", inset: o + g + sl, thickness: rim, ...corner(o + g + sl), fill: metal(5),
      effects: [{ kind: "bevel", depth: 3, size: Math.max(2, rim - 1) }, { kind: "shadow", dx: 0, dy: 2, blur: 3, opacity: 0.75 }] },
    // iç dudak: açıklığa yumuşak gölge düşürür
    { id: "lip", kind: "ring", inset: o + t, thickness: 3, ...corner(o + t), fill: { kind: "solid", color: "#0e0905", opacity: 0.9 },
      effects: [{ kind: "shadow", dx: 0, dy: 3, blur: 7, opacity: 0.75 }] },
    ...(p.cracks ? cracks : []),
    ...(p.ornaments ? [{ id: "corners", kind: "corners", style: p.cornerStyle, size: p.cornerSize, inset: orn, fill: metal(4, p.wear),
      stroke: { color: "#120b05", width: 1, opacity: 0.85 }, effects: [{ kind: "bevel", depth: 3, size: 3 }, { kind: "shadow", dx: 1, dy: 2, blur: 3, opacity: 0.75 }] }] : []),
  ] });

  const G = Math.round(p.gemSize * 2.2);
  const gem = p.gem ? DesignSchema.parse({ id: `${id}_gem`, kind: "sprite", width: G, height: G, layers: [
    { id: "gem", kind: "gem", cx: G / 2, cy: G / 2 + 2, size: p.gemSize, color: p.gemColor, shape: p.gemShape, ...(ramps ? { settingColors: ramps.metal } : {}) },
  ] }) : undefined;

  // Widget: gem'in üst kenardan taşan yarısı için tepeye pay bırakılır.
  const ov = p.gem ? Math.round(G / 2 - 4) : 0;
  const full = { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
  const widget = WidgetSchema.parse({ id, width: p.width, height: p.height + ov, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Background", type: "Image", brush: { asset: bg.id }, slot: { ...full, offsets: { left: t - 2, top: ov + t - 2, right: t - 2, bottom: t - 2 } }, children: [] },
    ...(shade ? [{ id: "Shade", type: "Image", brush: { asset: shade.id }, slot: { ...full, offsets: { left: t - 2, top: ov + t - 2, right: t - 2, bottom: t - 2 } }, children: [] }] : []),
    { id: "Frame", type: "Image", brush: { asset: frame.id }, slot: { ...full, offsets: { left: 0, top: ov, right: 0, bottom: 0 } }, children: [] },
    ...(gem ? [{ id: "Gem", type: "Image", brush: { asset: gem.id }, slot: {
      anchors: { minX: 0.5, minY: 0, maxX: 0.5, maxY: 0 }, offsets: { left: 0, top: ov + Math.round(t * 0.45), right: G, bottom: G }, alignment: { x: 0.5, y: 0.5 } }, children: [] }] : []),
  ] } });

  return { theme, resolved: p, bg, frame, gem, shade, widget };
}
