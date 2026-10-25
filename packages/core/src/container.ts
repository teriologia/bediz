import { z } from "zod";
import { DesignSchema, type Design } from "./design.js";
import { MATERIAL_PRESETS, STONE_PATTERNS, type MaterialPreset, type StonePattern } from "./material.js";
import { WidgetSchema, type Widget } from "./scene.js";

export const THEME_NAMES = ["gold-stone", "silver-slate", "bronze-wood", "ruby-blocks", "emerald-bronze"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
const STYLES = ["blade", "scroll", "claw", "filigree"] as const;

/** Tarifin çözülmüş (varsayılanlar + tema + kullanıcı) parametreleri. */
export interface ContainerParams {
  width: number; height: number;
  background: MaterialPreset; pattern?: StonePattern; frame: MaterialPreset; band: MaterialPreset;
  thickness: number; radius: number; chamfer: boolean; cracks: boolean; wear: number;
  ornaments: boolean; cornerStyle: (typeof STYLES)[number]; cornerSize: number;
  gem: boolean; gemColor: string; gemShape: "diamond" | "round" | "hex"; gemSize: number;
  style: "metal" | "ghost";
}

const BASE: ContainerParams = {
  width: 480, height: 320, background: "stone", pattern: "flagstone", frame: "gold", band: "slate",
  thickness: 30, radius: 14, chamfer: true, cracks: true, wear: 0.5,
  ornaments: true, cornerStyle: "filigree", cornerSize: 64, gem: true, gemColor: "#2a9fb0", gemShape: "diamond", gemSize: 44, style: "metal",
};
// ghost: ince çift çizgi, süs/mücevher/çatlak yok; çizgi rengi çerçeve metalinden gelir.
const GHOST: Partial<ContainerParams> = { thickness: 16, gem: false, ornaments: false, cracks: false };
export const GHOST_LINE: Record<string, string> = { gold: "#c9a45a", silver: "#b9c2cc", bronze: "#b87b45", wood: "#a9855a", stone: "#a09a8e", slate: "#8e9aa6" };

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
  theme: z.enum(THEME_NAMES).optional(),
  width: z.number().int().min(120).max(2048).optional(), height: z.number().int().min(120).max(2048).optional(),
  background: z.enum(MATERIAL_PRESETS).optional(), pattern: z.enum(STONE_PATTERNS).optional(),
  frame: z.enum(MATERIAL_PRESETS).optional(), band: z.enum(MATERIAL_PRESETS).optional(),
  thickness: z.number().int().min(10).max(90).optional(), radius: z.number().int().min(0).max(60).optional(),
  chamfer: z.boolean().optional(), cracks: z.boolean().optional(), wear: z.number().min(0).max(1).optional(),
  ornaments: z.boolean().optional(), cornerStyle: z.enum(STYLES).optional(), cornerSize: z.number().int().min(24).max(200).optional(),
  style: z.enum(["metal", "ghost"]).optional(), // ghost: ince çizgili çerçeve (metal bevel/süs yok)
  gem: z.boolean().optional(), gemColor: Hex.optional(), gemShape: z.enum(["diamond", "round", "hex"]).optional(), gemSize: z.number().int().min(16).max(160).optional(),
}).strict();
export type ContainerInput = z.infer<typeof ContainerInputSchema>;

export interface ContainerRecipe {
  theme: ThemeName;
  resolved: ContainerParams;
  bg: Design; frame: Design; gem?: Design; widget: Widget;
}

/**
 * Tek çağrılık container: dikişsiz zemin (tile) + 9-slice çerçeve + üstte mücevher sprite'ı + bunları birleştiren widget.
 * Çerçeve dıştan içe: dış altın bant, arduvaz bant (oyuk), iç çıta; toplam kalınlık = thickness.
 */
export function containerRecipe(input: ContainerInput): ContainerRecipe {
  const { id, theme = "gold-stone", ...explicit } = ContainerInputSchema.parse(input);
  const defined = Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined));
  const p: ContainerParams = { ...BASE, ...CONTAINER_THEMES[theme], ...(defined.style === "ghost" ? GHOST : {}), ...defined };
  const t = p.thickness, r = p.radius, c0 = Math.max(8, Math.round(r * 1.6));

  // Süs pah kırık köşenin dışına taşmasın diye içeri alınır; slice marjı süsü kapsar (yoksa gerilir).
  const orn = p.chamfer ? Math.round(c0 * 0.5) : 2;
  const m = Math.max(t + 14, p.ornaments ? p.cornerSize + orn + 2 : 0), S = 2 * m + 96;
  // İnce altın çerçeve, geniş koyu bant (PC oyunu oranı); dış kontur 1 px.
  const o = 1, g = Math.max(3, Math.round(t * 0.24)), rim = Math.max(2, Math.round(t * 0.1)), sl = t - g - rim;
  // Köşe biçimi: pah ya da yuvarlak; iç halkalarda eşit kalınlık için küçülür (inset o = dış altın başlangıcı).
  const corner = (inset: number) => (p.chamfer ? { chamfer: Math.max(0, Math.round(c0 - (inset - o) * 0.586)) } : { radius: Math.max(0, r - (inset - o)) });
  const metal = (seed: number, wear = p.wear * 0.5) => ({ kind: "material" as const, preset: p.frame, seed, wear });

  // Çatlaklar sadece bantlarda: her köşede üst/alt bant boyunca yatay, yan bant boyunca dikey birer çatlak.
  const cw = m - 12, b0 = o + g + 3, bh = Math.max(4, sl - 6), cracks: Record<string, unknown>[] = [];
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy], k) => {
    const at = (x0: number, y0: number, w: number, h: number) => ({ x: sx > 0 ? x0 : S - x0 - w, y: sy > 0 ? y0 : S - y0 - h, w, h });
    cracks.push({ id: `crack_h${k}`, kind: "cracks", ...at(8, b0, cw, bh), count: 1, length: Math.round(m * 0.5), seed: 11 + k, direction: 0 });
    cracks.push({ id: `crack_v${k}`, kind: "cracks", ...at(b0, 8, bh, cw), count: 1, length: Math.round(m * 0.5), seed: 21 + k, direction: Math.PI / 2 });
  });

  const bg = DesignSchema.parse({ id: `${id}_bg`, kind: "tile", width: 256, height: 256, layers: [
    { id: "ground", kind: "box", inset: 0, fill: { kind: "material", preset: p.background, pattern: p.pattern, seed: 5, wear: p.wear * 0.8 } },
  ] });
  const line = GHOST_LINE[p.frame] ?? "#c9a45a";
  const ghostLayers = [
    { id: "shade", kind: "ring", inset: 0, thickness: 4, ...corner(0), fill: { kind: "solid", color: "#000000", opacity: 0.55 }, effects: [{ kind: "shadow", dx: 0, dy: 2, blur: 5, opacity: 0.6 }] },
    { id: "line", kind: "ring", inset: 1, thickness: 2, ...corner(1), fill: { kind: "solid", color: line, opacity: 0.85 } },
    { id: "line2", kind: "ring", inset: 7, thickness: 1, ...corner(7), fill: { kind: "solid", color: line, opacity: 0.4 } },
  ];
  const frame = DesignSchema.parse({ id: `${id}_frame`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: p.style === "ghost" ? ghostLayers : [
    { id: "outline", kind: "ring", inset: 0, thickness: t + o + 3, ...corner(0), fill: { kind: "solid", color: "#120b05" } },
    { id: "gold_outer", kind: "ring", inset: o, thickness: g, ...corner(o), fill: metal(3),
      effects: [{ kind: "bevel", depth: 4, size: Math.max(2, Math.round(g * 0.6)) }, { kind: "shadow", dx: 0, dy: 2, blur: 4, opacity: 0.7 }] },
    { id: "slate", kind: "ring", inset: o + g, thickness: sl, ...corner(o + g),
      fill: { kind: "material", preset: p.band, pattern: "fine", scale: 2.2, seed: 6, wear: p.wear * 0.25 },
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
    { id: "gem", kind: "gem", cx: G / 2, cy: G / 2 + 2, size: p.gemSize, color: p.gemColor, shape: p.gemShape },
  ] }) : undefined;

  // Widget: gem'in üst kenardan taşan yarısı için tepeye pay bırakılır.
  const ov = p.gem ? Math.round(G / 2 - 4) : 0;
  const full = { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
  const widget = WidgetSchema.parse({ id, width: p.width, height: p.height + ov, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Background", type: "Image", brush: { asset: bg.id }, slot: { ...full, offsets: { left: t - 2, top: ov + t - 2, right: t - 2, bottom: t - 2 } }, children: [] },
    { id: "Frame", type: "Image", brush: { asset: frame.id }, slot: { ...full, offsets: { left: 0, top: ov, right: 0, bottom: 0 } }, children: [] },
    ...(gem ? [{ id: "Gem", type: "Image", brush: { asset: gem.id }, slot: {
      anchors: { minX: 0.5, minY: 0, maxX: 0.5, maxY: 0 }, offsets: { left: 0, top: ov + Math.round(t * 0.45), right: G, bottom: G }, alignment: { x: 0.5, y: 0.5 } }, children: [] }] : []),
  ] } });

  return { theme, resolved: p, bg, frame, gem, widget };
}
