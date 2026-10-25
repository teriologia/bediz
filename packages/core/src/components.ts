import { z } from "zod";
import { CONTAINER_THEMES, THEME_NAMES, type ThemeName } from "./container.js";
import { DesignSchema, shade, type Design } from "./design.js";
import { MATERIAL_PRESETS, type MaterialPreset } from "./material.js";
import { WidgetSchema, type Widget } from "./scene.js";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)");
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "renk #RRGGBB olmalı");

/** Tema başına bileşen renkleri: yüzey degradesi (üst/alt), yazı, çubuk dolgusu. Metal, container temasından gelir. */
const LOOK: Record<ThemeName, { top: string; bottom: string; text: string; fill: string }> = {
  "gold-stone": { top: "#2e3a39", bottom: "#141a1c", text: "#d8bf86", fill: "#4a9a5c" },
  "silver-slate": { top: "#2b3b4a", bottom: "#10171e", text: "#cfd6df", fill: "#4a86c4" },
  "bronze-wood": { top: "#4a3018", bottom: "#20130a", text: "#d8b48a", fill: "#c47a30" },
  "ruby-blocks": { top: "#521620", bottom: "#260a0f", text: "#d8bf86", fill: "#a8283a" },
  "emerald-bronze": { top: "#18443a", bottom: "#0a2019", text: "#d8b48a", fill: "#3a9a68" },
};
export { LOOK as THEME_LOOK };
const metalOf = (theme: ThemeName, frame?: MaterialPreset): MaterialPreset => frame ?? CONTAINER_THEMES[theme].frame ?? "gold";

export interface ComponentRecipe { theme: ThemeName; designs: Design[]; widget: Widget }

const full = { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, offsets: { left: 0, top: 0, right: 0, bottom: 0 } };
const outlineColor = "#120b05";

// ---------------------------------------------------------------- BUTON
export const ButtonInputSchema = z.object({
  id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(),
  label: z.string().max(60).optional(), width: z.number().int().min(60).max(1024).optional(), height: z.number().int().min(28).max(512).optional(),
  fontSize: z.number().int().min(8).max(96).optional(), rim: z.number().int().min(2).max(16).optional(), chamfer: z.boolean().optional(),
  wear: z.number().min(0).max(1).optional(), textColor: Hex.optional(),
}).strict();
export type ButtonInput = z.infer<typeof ButtonInputSchema>;
export const BUTTON_STATES = ["normal", "hovered", "pressed", "disabled"] as const;

/**
 * Dört durumlu 9-slice buton: metal çerçeve + degrade yüzey. Her durum aynı slice'a sahiptir (UE durum geçişinde şekil değişmez).
 * normal: temel · hovered: parlak çerçeve, parıltı, açık yüzey · pressed: koyu çerçeve, derin iç gölge · disabled: gri, sönük.
 */
export function buttonRecipe(input: ButtonInput): ComponentRecipe & { states: Record<(typeof BUTTON_STATES)[number], string> } {
  const { id, theme = "gold-stone", ...o } = ButtonInputSchema.parse(input);
  const look = LOOK[theme], metal = metalOf(theme, o.frame);
  const w = o.width ?? 200, h = o.height ?? 56, t = o.rim ?? 6, wear = o.wear ?? 0.3, chamfer = o.chamfer ?? true;
  const m = t + 8, S = 2 * m + 24;
  // Köşe: pah ya da yuvarlak; iç katmanlarda eşit kalınlık için küçülür.
  const corner = (inset: number) => (chamfer ? { chamfer: Math.max(0, Math.round(9 - (inset - 1) * 0.586)) } : { radius: Math.max(0, 9 - (inset - 1)) });

  const make = (state: (typeof BUTTON_STATES)[number]): Design => {
    const hov = state === "hovered", prs = state === "pressed", dis = state === "disabled";
    const top = dis ? "#3a3d41" : prs ? shade(look.top, -0.4) : hov ? shade(look.top, 0.28) : look.top;
    const bottom = dis ? "#1d1f22" : prs ? shade(look.bottom, -0.4) : hov ? shade(look.bottom, 0.2) : look.bottom;
    const rimFill = { kind: "material" as const, preset: dis ? ("silver" as const) : metal, seed: 7, wear: hov ? 0 : wear };
    return DesignSchema.parse({ id: `${id}_${state}`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: [
      { id: "outline", kind: "ring", inset: 0, thickness: t + 3, ...corner(0), fill: { kind: "solid", color: outlineColor } },
      { id: "rim", kind: "ring", inset: 1, thickness: t, ...corner(1), fill: rimFill,
        effects: [{ kind: "bevel", depth: 3, size: Math.max(2, Math.min(12, t - 1)) }, ...(hov ? [{ kind: "glow", blur: 4, color: "#ffd27a", opacity: 0.5 }] : [])] },
      ...(prs || dis ? [{ id: "rim_dim", kind: "ring", inset: 1, thickness: t, ...corner(1), fill: { kind: "solid", color: "#000000", opacity: dis ? 0.5 : 0.3 } }] : []),
      { id: "face", kind: "box", inset: 1 + t, ...corner(1 + t), fill: { kind: "linear", angle: 90, stops: [[0, top], [1, bottom]] },
        effects: [{ kind: "innerShadow", blur: prs ? 5 : 3, dy: prs ? 3 : 1, opacity: prs ? 0.9 : 0.6 }] },
      // parlama sadece kenar bölgesinde (gerilmeyen kısım): yükseklik sabit kalır
      { id: "gloss", kind: "box", inset: 1 + t, h: m - (1 + t), ...corner(1 + t), fill: { kind: "solid", color: "#ffffff", opacity: dis ? 0.03 : prs ? 0.04 : hov ? 0.18 : 0.1 } },
    ] });
  };
  const designs = BUTTON_STATES.map(make);
  const states = Object.fromEntries(BUTTON_STATES.map((s) => [s, `${id}_${s}`])) as Record<(typeof BUTTON_STATES)[number], string>;

  const widget = WidgetSchema.parse({ id, width: w, height: h, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Button", type: "Button", brush: { asset: states.normal }, slot: full,
      states: { hovered: { asset: states.hovered }, pressed: { asset: states.pressed }, disabled: { asset: states.disabled } },
      children: [{ id: "Label", type: "TextBlock", text: o.label ?? "Button", fontSize: o.fontSize ?? 22, color: o.textColor ?? look.text, slot: { hAlign: "Center", vAlign: "Center" }, children: [] }] },
  ] } });
  return { theme, designs, widget, states };
}

// ---------------------------------------------------------------- İLERLEME ÇUBUĞU
export const BarInputSchema = z.object({
  id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), fillColor: Hex.optional(),
  width: z.number().int().min(60).max(2048).optional(), height: z.number().int().min(16).max(128).optional(), percent: z.number().min(0).max(1).optional(),
}).strict();
export type BarInput = z.infer<typeof BarInputSchema>;

/** Yatay çubuk: metal çerçeveli koyu oluk (frame9) + degrade dolgu (frame9). UE'de ProgressBar, dolgu Scale stiliyle yüzdeye göre gerilir. */
export function barRecipe(input: BarInput): ComponentRecipe & { inset: number } {
  const { id, theme = "gold-stone", ...o } = BarInputSchema.parse(input);
  const look = LOOK[theme], metal = metalOf(theme, o.frame), fillColor = o.fillColor ?? look.fill;
  const w = o.width ?? 240, h = o.height ?? 28, rim = 3, inset = rim + 1, r = Math.min(6, Math.floor(h / 4));
  const mx = 14, my = Math.min(10, Math.floor(h / 2) - 2), TW = 2 * mx + 16, TH = 2 * my + 8;
  const trough = DesignSchema.parse({ id: `${id}_trough`, kind: "frame9", width: TW, height: TH, slice: { left: mx, top: my, right: mx, bottom: my }, layers: [
    { id: "outline", kind: "ring", inset: 0, thickness: rim + 2, radius: r + 1, fill: { kind: "solid", color: outlineColor } },
    { id: "rim", kind: "ring", inset: 1, thickness: rim, radius: r, fill: { kind: "material", preset: metal, seed: 9, wear: 0.25 }, effects: [{ kind: "bevel", depth: 2.5, size: 2 }] },
    { id: "well", kind: "box", inset: 1 + rim, radius: Math.max(0, r - rim), fill: { kind: "linear", angle: 90, stops: [[0, "#06080a"], [1, "#161b1f"]] }, effects: [{ kind: "innerShadow", blur: 3, dy: 2, opacity: 0.9 }] },
  ] });
  const FH = h - 2 * inset, fm = Math.min(6, Math.floor(FH / 2) - 1), FW = 2 * 8 + 12;
  const fill = DesignSchema.parse({ id: `${id}_fill`, kind: "frame9", width: FW, height: FH, slice: { left: 8, top: fm, right: 8, bottom: fm }, layers: [
    { id: "body", kind: "box", inset: 0, radius: Math.max(0, r - 1), fill: { kind: "linear", angle: 90, stops: [[0, shade(fillColor, 0.18)], [0.45, fillColor], [1, shade(fillColor, -0.5)]] } },
    { id: "gloss", kind: "box", inset: 1, h: Math.max(2, fm - 1), radius: Math.max(0, r - 2), fill: { kind: "solid", color: "#ffffff", opacity: 0.2 } },
    { id: "edge", kind: "ring", inset: 0, thickness: 1, radius: Math.max(0, r - 1), fill: { kind: "solid", color: "#000000", opacity: 0.45 } },
  ] });
  const widget = WidgetSchema.parse({ id, width: w, height: h, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Bar", type: "ProgressBar", brush: { asset: trough.id }, fill: { asset: fill.id }, percent: o.percent ?? 0.7, inset, slot: full, children: [] },
  ] } });
  return { theme, designs: [trough, fill], widget, inset };
}

// ---------------------------------------------------------------- SLOT
export const SlotInputSchema = z.object({
  id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), size: z.number().int().min(32).max(256).optional(),
}).strict();
export type SlotInput = z.infer<typeof SlotInputSchema>;

/** Envanter/eşya yuvası: metal çerçeveli çökük koyu kutu. İki varyant: normal ve seçili (parıltılı çerçeve). */
export function slotRecipe(input: SlotInput): ComponentRecipe & { variants: { normal: string; selected: string } } {
  const { id, theme = "gold-stone", ...o } = SlotInputSchema.parse(input);
  const metal = metalOf(theme, o.frame), size = o.size ?? 64, t = 5, m = Math.min(16, Math.floor(size / 3));
  const make = (variant: "normal" | "selected") => DesignSchema.parse({ id: `${id}_${variant}`, kind: "frame9", width: size, height: size, slice: { left: m, top: m, right: m, bottom: m }, layers: [
    { id: "outline", kind: "ring", inset: 0, thickness: t + 2, chamfer: 7, fill: { kind: "solid", color: outlineColor } },
    { id: "rim", kind: "ring", inset: 1, thickness: t, chamfer: 6, fill: { kind: "material", preset: metal, seed: 11, wear: variant === "selected" ? 0 : 0.3 },
      effects: [{ kind: "bevel", depth: 3, size: 3 }, ...(variant === "selected" ? [{ kind: "glow", blur: 6, color: "#ffd27a", opacity: 0.95 }] : [])] },
    { id: "well", kind: "box", inset: 1 + t, chamfer: 3, fill: { kind: "linear", angle: 90, stops: variant === "selected" ? [[0, "#7a5f22"], [1, "#33280f"]] : [[0, "#0d1114"], [1, "#1b2227"]] }, effects: [{ kind: "innerShadow", blur: 6, dy: 2, opacity: 0.9 }] },
  ] });
  const normal = make("normal"), selected = make("selected");
  const widget = WidgetSchema.parse({ id, width: size, height: size, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Frame", type: "Image", brush: { asset: normal.id }, slot: full, children: [] },
  ] } });
  return { theme, designs: [normal, selected], widget, variants: { normal: normal.id, selected: selected.id } };
}
