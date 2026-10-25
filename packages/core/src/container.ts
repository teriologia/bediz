import { z } from "zod";
import { DesignSchema, type Design } from "./design.js";
import { MATERIAL_PRESETS, STONE_PATTERNS, type MaterialPreset, type StonePattern } from "./material.js";
import { WidgetSchema, type Widget } from "./scene.js";

export const THEME_NAMES = ["gold-stone", "silver-slate", "bronze-wood", "ruby-blocks", "emerald-bronze"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
const STYLES = ["blade", "scroll", "claw"] as const;

/** Tarifin çözülmüş (varsayılanlar + tema + kullanıcı) parametreleri. */
export interface ContainerParams {
  width: number; height: number;
  background: MaterialPreset; pattern?: StonePattern; frame: MaterialPreset; band: MaterialPreset;
  thickness: number; radius: number; chamfer: boolean; cracks: boolean; wear: number;
  ornaments: boolean; cornerStyle: (typeof STYLES)[number]; cornerSize: number;
  gem: boolean; gemColor: string; gemShape: "diamond" | "round" | "hex"; gemSize: number;
}

const BASE: ContainerParams = {
  width: 480, height: 320, background: "stone", pattern: "flagstone", frame: "gold", band: "slate",
  thickness: 30, radius: 14, chamfer: true, cracks: true, wear: 0.5,
  ornaments: true, cornerStyle: "blade", cornerSize: 64, gem: true, gemColor: "#2fb5c9", gemShape: "diamond", gemSize: 44,
};

/** Hazır görünümler: sadece farkları yazılır, kullanıcı parametreleri üstüne biner. */
export const CONTAINER_THEMES: Record<ThemeName, Partial<ContainerParams>> = {
  "gold-stone": {},
  "silver-slate": { background: "slate", pattern: "flagstone", frame: "silver", band: "slate", cornerStyle: "claw", gemColor: "#6fb4ff", gemShape: "round" },
  "bronze-wood": { background: "wood", pattern: undefined, frame: "bronze", band: "wood", cornerStyle: "scroll", chamfer: false, radius: 12, gemColor: "#e0892a", gemShape: "hex" },
  "ruby-blocks": { background: "stone", pattern: "blocks", frame: "gold", band: "slate", cornerStyle: "claw", gemColor: "#c0233a", gemShape: "diamond" },
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
  const p: ContainerParams = { ...BASE, ...CONTAINER_THEMES[theme], ...defined };
  const t = p.thickness, r = p.radius, c0 = Math.max(8, Math.round(r * 1.6));

  // Süs pah kırık köşenin dışına taşmasın diye içeri alınır; slice marjı süsü kapsar (yoksa gerilir).
  const orn = p.chamfer ? Math.round(c0 * 0.5) : 2;
  const m = Math.max(t + 14, p.ornaments ? p.cornerSize + orn + 2 : 0), S = 2 * m + 96;
  const g = Math.round(t * 0.42), rim = Math.max(3, Math.round(t * 0.12)), sl = t - g - rim;
  // Köşe biçimi: pah ya da yuvarlak; iç halkalarda eşit kalınlık için küçülür (inset 2 = dış altın başlangıcı).
  const corner = (inset: number) => (p.chamfer ? { chamfer: Math.max(0, Math.round(c0 - (inset - 2) * 0.586)) } : { radius: Math.max(0, r - (inset - 2)) });
  const metal = (seed: number) => ({ kind: "material" as const, preset: p.frame, seed, wear: p.wear });

  // Çatlaklar sadece bantlarda: her köşede üst/alt bant boyunca yatay, yan bant boyunca dikey birer çatlak.
  const cw = m - 12, b0 = Math.round(t * 0.3), bh = Math.round(t * 0.4), cracks: Record<string, unknown>[] = [];
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy], k) => {
    const at = (x0: number, y0: number, w: number, h: number) => ({ x: sx > 0 ? x0 : S - x0 - w, y: sy > 0 ? y0 : S - y0 - h, w, h });
    cracks.push({ id: `crack_h${k}`, kind: "cracks", ...at(8, b0, cw, bh), count: 1, length: Math.round(m * 0.5), seed: 11 + k, direction: 0 });
    cracks.push({ id: `crack_v${k}`, kind: "cracks", ...at(b0, 8, bh, cw), count: 1, length: Math.round(m * 0.5), seed: 21 + k, direction: Math.PI / 2 });
  });

  const bg = DesignSchema.parse({ id: `${id}_bg`, kind: "tile", width: 256, height: 256, layers: [
    { id: "ground", kind: "box", inset: 0, fill: { kind: "material", preset: p.background, pattern: p.pattern, seed: 5, wear: p.wear * 0.8 } },
  ] });
  const frame = DesignSchema.parse({ id: `${id}_frame`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: [
    { id: "outline", kind: "ring", inset: 0, thickness: t + 5, ...corner(0), fill: { kind: "solid", color: "#1a1008" } },
    { id: "gold_outer", kind: "ring", inset: 2, thickness: g, ...corner(2), fill: metal(3),
      effects: [{ kind: "bevel", depth: 6, size: Math.max(3, Math.round(g * 0.5)) }, { kind: "shadow", dx: 0, dy: 2, blur: 2, opacity: 0.5 }] },
    { id: "slate", kind: "ring", inset: 2 + g, thickness: sl, ...corner(2 + g),
      fill: { kind: "material", preset: p.band, pattern: "rough", scale: 2.2, seed: 6, wear: p.wear * 0.4 },
      effects: [{ kind: "innerShadow", blur: 4, dy: 2, opacity: 0.8 }] },
    { id: "gold_rim", kind: "ring", inset: 2 + g + sl, thickness: rim, ...corner(2 + g + sl), fill: metal(5),
      effects: [{ kind: "bevel", depth: 3, size: Math.max(2, rim - 1) }, { kind: "shadow", dx: 0, dy: 1, blur: 1.5, opacity: 0.6 }] },
    // iç dudak: açıklığa yumuşak gölge düşürür
    { id: "lip", kind: "ring", inset: 2 + t, thickness: 3, ...corner(2 + t), fill: { kind: "solid", color: "#0e0905", opacity: 0.9 },
      effects: [{ kind: "shadow", dx: 0, dy: 3, blur: 7, opacity: 0.75 }] },
    ...(p.cracks ? cracks : []),
    ...(p.ornaments ? [{ id: "corners", kind: "corners", style: p.cornerStyle, size: p.cornerSize, inset: orn, fill: metal(4),
      stroke: { color: "#1a1008", width: 1.6 }, effects: [{ kind: "bevel", depth: 5, size: 6 }, { kind: "shadow", dx: 1, dy: 3, blur: 3, opacity: 0.6 }] }] : []),
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
