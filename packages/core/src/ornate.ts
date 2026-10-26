import { z } from "zod";
import { metalOf, type ComponentRecipe } from "./components.js";
import { THEME_LOOK, ThemeSchema, rampOf, rampsOf } from "./container.js";
import { DesignSchema, type Layer } from "./design.js";
import { MATERIAL_PRESETS } from "./material.js";
import { WidgetSchema } from "./scene.js";
import { silhouettePath } from "./shapes.js";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "renk #RRGGBB olmalı");
export const OrnateFrameInputSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)"),
  theme: ThemeSchema.optional(), frame: z.enum(MATERIAL_PRESETS).optional(),
  width: z.number().int().min(480).max(1920).optional(), height: z.number().int().min(360).max(1080).optional(),
  thickness: z.number().int().min(16).max(60).optional(), // demir bandın kalınlığı (px)
  thorns: z.boolean().optional(), thornSize: z.number().int().min(8).max(30).optional(), thornStep: z.number().int().min(20).max(80).optional(),
  spire: z.number().int().min(30).max(140).optional(), // köşe/orta kulelerin dışarı uzunluğu (px); çerçeve tuvalde bu kadar boşlukla çizilir
  midFinials: z.boolean().optional(), // üst/alt orta süs kulesi + mücevher
  accent: Hex.optional(), inlay: z.boolean().optional(), // mücevher ve ince kakma rengi
  metalColors: z.array(Hex).min(2).max(6).optional(), // demir rampası (koyu → açık); verilmezse koyu çelik ya da paletin metali
  wear: z.number().min(0).max(1).optional(),
}).strict();
export type OrnateFrameInput = z.infer<typeof OrnateFrameInputSchema>;

export interface OrnateFrameRecipe extends ComponentRecipe {
  /** Çerçevenin içindeki boş alan (tuval içinde px): içerik buraya yerleştirilir. */
  inner: { left: number; top: number; right: number; bottom: number };
}

const DARK_STEEL = ["#050608", "#14171c", "#343a44", "#6a7280"];

/**
 * Gotik dikenli çerçeve: koyu demir bant, kenar boyunca dışarı bakan kıvrık dikenler, köşe kuleleri (sivri uçlar + gövde + mücevher),
 * üst/alt orta süs kulesi. Tek bir sabit boyutlu görsel (sprite): doku gerilmez; sol-üst çeyrek çizilir, `symmetry: "xy"` diğer köşeleri aynalar.
 * Orta bölge saydamdır; panel/arka plan ayrı katman olarak çerçevenin altına konur.
 */
export function ornateFrameRecipe(input: OrnateFrameInput): OrnateFrameRecipe {
  const { id, theme = "gold-stone", ...o } = OrnateFrameInputSchema.parse(input);
  const W = o.width ?? 1280, H = o.height ?? 720, T = o.thickness ?? 30, L = o.spire ?? 78, M = L + 14, wear = o.wear ?? 0.45;
  const x0 = M, y0 = M, cx = W / 2, cy = H / 2, custom = !!rampsOf(theme);
  if (W - 2 * M < 4 * T || H - 2 * M < 4 * T) throw new Error(`çerçeve çok küçük: width/height, spire (${L}) ve thickness (${T}) ile iç alan kalmıyor`);
  const colors = o.metalColors ?? (custom ? rampOf(theme).colors! : DARK_STEEL), accent = o.accent ?? (custom ? THEME_LOOK[theme].fill : "#c42a3c");
  const iron = { kind: "material" as const, preset: custom || o.metalColors ? metalOf(theme, o.frame) : o.frame ?? "silver", colors, seed: 11, wear };
  const fx = [{ kind: "bevel", depth: 3.5, size: 3 }, { kind: "shadow", dx: 0, dy: 3, blur: 4, opacity: 0.75 }];
  const stroke = { color: "#050608", width: 1.2 };
  const k = L / 78; // kule ölçeği (varsayılan 78 px'e göre)
  const body = silhouettePath("rect", W, H, 28, M);
  const P = (pid: string, points: [number, number][]) => ({ id: pid, kind: "polygon", points, fill: iron, stroke, effects: fx }) as Layer;
  const run = (a: number, b: number, step: number) => b - a >= step;

  const layers: Layer[] = [
    { id: "outline", kind: "band", d: body, from: 0, to: 3, fill: { kind: "solid", color: "#040405" } },
    { id: "iron", kind: "band", d: body, from: 2, to: T, fill: iron, effects: [{ kind: "bevel", depth: 4, size: 5 }, { kind: "shadow", dx: 0, dy: 4, blur: 6, opacity: 0.7 }] },
    { id: "groove", kind: "band", d: body, from: T, to: T + 3, fill: { kind: "solid", color: "#020203" } },
    ...(o.inlay === false ? [] : [{ id: "inlay", kind: "band", d: body, from: T + 9, to: T + 11, fill: { kind: "solid", color: accent }, effects: [{ kind: "glow", blur: 3, color: accent, opacity: 0.6 }] } as Layer]),
  ];
  const ts = o.thornSize ?? 16, step = o.thornStep ?? 36;
  if (o.thorns !== false) {
    // sol-üst çeyrek: üst kenar kuleden orta kuleye; sol kenar ortadan köşeye yukarı (diken ucu yukarı giden çizgide dışarı bakar)
    if (run(x0 + L + 6, cx - L * 0.9, step)) layers.push({ id: "thorns_top", kind: "repeat", style: "thorn", points: [[x0 + L + 6, y0 + 3], [cx - L * 0.9, y0 + 3]], step, size: ts, margin: 0, jitter: 0.35, fill: iron, stroke, effects: fx } as Layer);
    if (run(y0 + L + 6, cy - 10, step)) layers.push({ id: "thorns_left", kind: "repeat", style: "thorn", points: [[x0 + 3, cy - 10], [x0 + 3, y0 + L + 6]], step, size: ts, margin: 0, jitter: 0.35, fill: iron, stroke, effects: fx } as Layer);
  }
  // köşe kulesi: yukarı ve sola uzun sivri, çapraz diken, merkez gövde halkası ve mücevher
  layers.push(
    P("corner_up", [[x0 - 9 * k, y0 + 10 * k], [x0 - 2 * k, y0 - L], [x0 + 10 * k, y0 - L * 0.9], [x0 + 16 * k, y0 + 10 * k]]),
    P("corner_left", [[x0 + 10 * k, y0 - 9 * k], [x0 - L, y0 - 2 * k], [x0 - L * 0.9, y0 + 10 * k], [x0 + 10 * k, y0 + 16 * k]]),
    P("corner_diag", [[x0 - 8 * k, y0 - 6 * k], [x0 - 52 * k, y0 - 52 * k], [x0 - 30 * k, y0 - 2 * k], [x0 - 2 * k, y0 - 26 * k]]),
    { id: "corner_boss", kind: "ellipse", cx: x0 + 2, cy: y0 + 2, rx: 30 * k, ry: 30 * k, fill: iron, stroke, effects: fx } as Layer,
    { id: "corner_ring", kind: "ellipse", cx: x0 + 2, cy: y0 + 2, rx: 21 * k, ry: 21 * k, fill: { kind: "solid", color: "#0a0b0e" } } as Layer,
    { id: "corner_gem", kind: "gem", cx: x0 + 2, cy: y0 + 2, size: 26 * k, color: accent, shape: "diamond", setting: "none" } as Layer,
  );
  if (o.midFinials !== false) layers.push(
    // üst orta kule: yalnız sol yarı (x ≤ cx); symmetry aynalar
    P("mid_spire", [[cx, y0 - L - 2 * k], [cx - 12 * k, y0 - 6 * k], [cx - 30 * k, y0 + 8 * k], [cx, y0 + 8 * k]]),
    P("mid_wing", [[cx - 14 * k, y0 - 12 * k], [cx - 64 * k, y0 - 34 * k], [cx - 40 * k, y0 + 6 * k]]),
    { id: "mid_gem", kind: "gem", cx, cy: y0 + 6 * k, size: 30 * k, color: accent, shape: "diamond", setting: "gold", settingColors: colors } as Layer,
  );

  const design = DesignSchema.parse({ id, kind: "sprite", width: W, height: H, symmetry: "xy", layers });
  const widget = WidgetSchema.parse({ id, width: W, height: H, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Frame", type: "Image", brush: { asset: id }, slot: { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, offsets: { left: 0, top: 0, right: 0, bottom: 0 } }, children: [] },
  ] } });
  const inner = T + 12;
  return { theme, designs: [design], widget, inner: { left: x0 + inner, top: y0 + inner, right: W - x0 - inner, bottom: H - y0 - inner } };
}
