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
  selected: z.boolean().optional(), // true: ek `<id>_selected` tasarımı üretir (sekme/anahtar için kalıcı seçili görünüm)
  style: z.enum(["metal", "ghost"]).optional(), // metal: kalın bevel'li metal çerçeve (varsayılan); ghost: ince çift çizgi, cam yüzey (sekme/ikincil düğme)
  faceOpacity: z.number().min(0).max(1).optional(), // 1: opak yüzey; düşük: şeffaf/cam buton (zemin görünür)
}).strict();
export type ButtonInput = z.infer<typeof ButtonInputSchema>;
export const BUTTON_STATES = ["normal", "hovered", "pressed", "disabled"] as const;

/**
 * Dört durumlu 9-slice buton: metal çerçeve + degrade yüzey. Her durum aynı slice'a sahiptir (UE durum geçişinde şekil değişmez).
 * `selected: true` (UE Button durumu değil): sekme/anahtar için kalıcı seçili görünüm; oyunda brush değiştirilerek gösterilir.
 * normal: temel · hovered: parlak çerçeve, parıltı, açık yüzey · pressed: koyu çerçeve, derin iç gölge · disabled: gri, sönük.
 */
export function buttonRecipe(input: ButtonInput): ComponentRecipe & { states: Record<(typeof BUTTON_STATES)[number], string>; selected?: string } {
  const { id, theme = "gold-stone", ...o } = ButtonInputSchema.parse(input);
  const look = LOOK[theme], metal = metalOf(theme, o.frame);
  const w = o.width ?? 200, h = o.height ?? 56, t = o.rim ?? 6, wear = o.wear ?? 0.3, chamfer = o.chamfer ?? true;
  const m = t + 8, S = 2 * m + 24;
  // Köşe: pah ya da yuvarlak; iç katmanlarda eşit kalınlık için küçülür.
  const corner = (inset: number) => (chamfer ? { chamfer: Math.max(0, Math.round(9 - (inset - 1) * 0.586)) } : { radius: Math.max(0, 9 - (inset - 1)) });

  const make = (state: (typeof BUTTON_STATES)[number] | "selected"): Design => {
    const hov = state === "hovered", prs = state === "pressed", dis = state === "disabled", sel = state === "selected";
    const top = dis ? "#3a3d41" : prs || sel ? shade(look.top, -0.4) : hov ? shade(look.top, 0.28) : look.top;
    const bottom = dis ? "#1d1f22" : prs || sel ? shade(look.bottom, -0.4) : hov ? shade(look.bottom, 0.2) : look.bottom;
    if (o.style === "ghost") {
      // İnce çizgi dili: tek piksel çizgiler, cam yüzey; hover'da çizgi parlar ve altın parıltı eklenir, pressed'de yüzey koyulaşır.
      const lw = o.rim ?? 2, line = dis ? "#7a7f85" : sel ? "#e0b860" : look.text, lo = dis ? 0.35 : prs ? 0.7 : hov || sel ? 1 : 0.6;
      return DesignSchema.parse({ id: `${id}_${state}`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: [
        { id: "face", kind: "box", inset: 0, ...corner(0), opacity: sel ? 0.92 : o.faceOpacity ?? (hov ? 0.55 : 0.32), fill: { kind: "linear", angle: 90, stops: sel ? [[0, "#3a2e14"], [1, "#150f05"]] : [[0, hov ? look.top : "#0c0e11"], [1, prs ? "#050607" : hov ? look.bottom : "#07080a"]] } },
        { id: "line", kind: "ring", inset: 0, thickness: sel ? lw + 1 : lw, ...corner(0), opacity: lo, fill: { kind: "solid", color: line }, effects: hov ? [{ kind: "glow", blur: 3, color: "#ffd27a", opacity: 0.55 }] : [] },
        { id: "line2", kind: "ring", inset: lw + 2, thickness: 1, ...corner(lw + 2), opacity: lo * 0.35, fill: { kind: "solid", color: line } },
      ] });
    }
    const rimFill = { kind: "material" as const, preset: dis ? ("silver" as const) : metal, seed: 7, wear: hov || sel ? 0 : wear };
    return DesignSchema.parse({ id: `${id}_${state}`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: [
      { id: "outline", kind: "ring", inset: 0, thickness: t + 3, ...corner(0), fill: { kind: "solid", color: outlineColor } },
      { id: "rim", kind: "ring", inset: 1, thickness: t, ...corner(1), fill: rimFill,
        effects: [{ kind: "bevel", depth: 3, size: Math.max(2, Math.min(12, t - 1)) }, ...(hov || sel ? [{ kind: "glow", blur: 4, color: "#ffd27a", opacity: sel ? 0.8 : 0.5 }] : [])] },
      ...(prs || dis ? [{ id: "rim_dim", kind: "ring", inset: 1, thickness: t, ...corner(1), fill: { kind: "solid", color: "#000000", opacity: dis ? 0.5 : 0.3 } }] : []),
      { id: "face", kind: "box", inset: 1 + t, ...corner(1 + t), opacity: o.faceOpacity, fill: { kind: "linear", angle: 90, stops: [[0, top], [1, bottom]] },
        effects: [{ kind: "innerShadow", blur: prs ? 5 : 3, dy: prs ? 3 : 1, opacity: prs ? 0.9 : 0.6 }] },
      // parlama sadece kenar bölgesinde (gerilmeyen kısım): yükseklik sabit kalır
      { id: "gloss", kind: "box", inset: 1 + t, h: m - (1 + t), ...corner(1 + t), fill: { kind: "solid", color: "#ffffff", opacity: dis ? 0.03 : prs ? 0.04 : hov ? 0.18 : 0.1 } },
    ] });
  };
  const designs = [...BUTTON_STATES, ...(o.selected ? (["selected"] as const) : [])].map(make);
  const states = Object.fromEntries(BUTTON_STATES.map((s) => [s, `${id}_${s}`])) as Record<(typeof BUTTON_STATES)[number], string>;

  const widget = WidgetSchema.parse({ id, width: w, height: h, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Button", type: "Button", brush: { asset: states.normal }, slot: full,
      states: { hovered: { asset: states.hovered }, pressed: { asset: states.pressed }, disabled: { asset: states.disabled } },
      children: [{ id: "Label", type: "TextBlock", text: o.label ?? "Button", fontSize: o.fontSize ?? 22, color: o.textColor ?? look.text, slot: { hAlign: "Center", vAlign: "Center" }, children: [] }] },
  ] } });
  return { theme, designs, widget, states, ...(o.selected ? { selected: `${id}_selected` } : {}) };
}

// ---------------------------------------------------------------- İLERLEME ÇUBUĞU
export const BarInputSchema = z.object({
  id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), fillColor: Hex.optional(),
  width: z.number().int().min(60).max(2048).optional(), height: z.number().int().min(16).max(128).optional(), percent: z.number().min(0).max(1).optional(),
  style: z.enum(["metal", "ghost"]).optional(),
}).strict();
export type BarInput = z.infer<typeof BarInputSchema>;

/** Yatay çubuk: metal çerçeveli koyu oluk (frame9) + degrade dolgu (frame9). UE'de ProgressBar, dolgu Scale stiliyle yüzdeye göre gerilir. */
export function barRecipe(input: BarInput): ComponentRecipe & { inset: number } {
  const { id, theme = "gold-stone", ...o } = BarInputSchema.parse(input);
  const look = LOOK[theme], metal = metalOf(theme, o.frame), fillColor = o.fillColor ?? look.fill;
  const w = o.width ?? 240, h = o.height ?? 28, rim = 3, inset = rim + 1, r = Math.min(6, Math.floor(h / 4));
  const mx = 14, my = Math.min(10, Math.floor(h / 2) - 2), TW = 2 * mx + 16, TH = 2 * my + 8;
  const troughLayers = o.style === "ghost" ? [
    { id: "well", kind: "box", inset: 0, radius: r, opacity: 0.5, fill: { kind: "linear", angle: 90, stops: [[0, "#06080a"], [1, "#12171b"]] }, effects: [{ kind: "innerShadow", blur: 3, dy: 1, opacity: 0.7 }] },
    { id: "line", kind: "ring", inset: 0, thickness: 2, radius: r, opacity: 0.6, fill: { kind: "solid", color: look.text } },
  ] : undefined;
  const trough = DesignSchema.parse({ id: `${id}_trough`, kind: "frame9", width: TW, height: TH, slice: { left: mx, top: my, right: mx, bottom: my }, layers: troughLayers ?? [
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
  style: z.enum(["metal", "ghost"]).optional(),
}).strict();
export type SlotInput = z.infer<typeof SlotInputSchema>;

/** Envanter/eşya yuvası: metal çerçeveli çökük koyu kutu. İki varyant: normal ve seçili (parıltılı çerçeve). */
export function slotRecipe(input: SlotInput): ComponentRecipe & { variants: { normal: string; selected: string } } {
  const { id, theme = "gold-stone", ...o } = SlotInputSchema.parse(input);
  const look = LOOK[theme], metal = metalOf(theme, o.frame), size = o.size ?? 64, t = 5, m = Math.min(16, Math.floor(size / 3));
  const sel = (v: string) => v === "selected";
  const makeGhost = (variant: "normal" | "selected") => DesignSchema.parse({ id: `${id}_${variant}`, kind: "frame9", width: size, height: size, slice: { left: m, top: m, right: m, bottom: m }, layers: [
    { id: "well", kind: "box", inset: 0, chamfer: 6, opacity: sel(variant) ? 0.8 : 0.45, fill: { kind: "linear", angle: 90, stops: sel(variant) ? [[0, "#4a3a18"], [1, "#1c1608"]] : [[0, "#0d1114"], [1, "#07090b"]] }, effects: [{ kind: "innerShadow", blur: 6, dy: 2, opacity: 0.8 }] },
    { id: "line", kind: "ring", inset: 0, thickness: sel(variant) ? 3 : 2, chamfer: 6, opacity: sel(variant) ? 1 : 0.6, fill: { kind: "solid", color: sel(variant) ? "#e0b860" : look.text } },
    { id: "line2", kind: "ring", inset: 4, thickness: 1, chamfer: 3, opacity: 0.3, fill: { kind: "solid", color: look.text } },
  ] });
  const make = (variant: "normal" | "selected") => o.style === "ghost" ? makeGhost(variant) : DesignSchema.parse({ id: `${id}_${variant}`, kind: "frame9", width: size, height: size, slice: { left: m, top: m, right: m, bottom: m }, layers: [
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

// ---------------------------------------------------------------- YETENEK ÇUBUĞU (QWER)
export const SkillBarInputSchema = z.object({
  id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), size: z.number().int().min(56).max(160).optional(),
  keys: z.array(z.string().min(1).max(3)).min(1).max(8).optional(), gap: z.number().int().min(0).max(40).optional(),
  active: z.array(z.number().int().min(0)).max(8).optional(), cooldowns: z.array(z.number().min(0).max(1)).max(8).optional(),
  icons: z.array(z.string()).max(8).optional(), iconColors: z.array(Hex).max(8).optional(),
}).strict();
export type SkillBarInput = z.infer<typeof SkillBarInputSchema>;

const RUNE_COLORS = ["#d9602a", "#3aa0d8", "#5fbf5a", "#a45ad8"];

/**
 * Yetenek çubuğu (Q W E R…): her yetenek için metal çerçeveli çökük yuva, simge (varsayılan: renkli rün-mücevher yer tutucu;
 * `icons` ile kendi simge asset'lerini ver), altta çıkıntılı tuş kapağı, üstten aşağı dolan soğuma karartması, `active` slotlarda parıltı.
 */
export function skillBarRecipe(input: SkillBarInput): ComponentRecipe & { variants: { normal: string; active: string } } {
  const { id, theme = "gold-stone", ...o } = SkillBarInputSchema.parse(input);
  const look = LOOK[theme], metal = metalOf(theme, o.frame), S = o.size ?? 88, gap = o.gap ?? 14, t = Math.max(5, Math.round(S / 14));
  const keys = o.keys ?? ["Q", "W", "E", "R"], active = new Set(o.active ?? []), cds = o.cooldowns ?? [], m = Math.min(16, Math.floor(S / 3));
  const make = (variant: "normal" | "active") => DesignSchema.parse({ id: `${id}_${variant}`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: [
    { id: "outline", kind: "ring", inset: 0, thickness: t + 3, chamfer: 10, fill: { kind: "solid", color: outlineColor },
      effects: [{ kind: "shadow", dx: 0, dy: 3, blur: 5, opacity: 0.7 }] },
    { id: "rim", kind: "ring", inset: 1, thickness: t, chamfer: 9, fill: { kind: "material", preset: metal, seed: 5, wear: variant === "active" ? 0 : 0.25 },
      effects: [{ kind: "bevel", depth: 4, size: Math.max(2, t - 1) }, ...(variant === "active" ? [{ kind: "glow", blur: 8, color: "#ffd27a", opacity: 0.9 }] : [])] },
    { id: "seam", kind: "ring", inset: 1 + t, thickness: 2, chamfer: 5, fill: variant === "active" ? { kind: "solid", color: "#ffd27a", opacity: 0.85 } : { kind: "solid", color: "#0a0705" },
      effects: variant === "active" ? [{ kind: "glow", blur: 4, color: "#ffb040", opacity: 0.8 }] : [] },
    { id: "well", kind: "box", inset: 3 + t, chamfer: 4, fill: { kind: "radial", stops: variant === "active" ? [[0, "#3a2f18"], [1, "#0d0a05"]] : [[0, "#1f2a30"], [1, "#07090b"]] },
      effects: [{ kind: "innerShadow", blur: 10, dy: 3, opacity: 0.95 }] },
  ] });
  const normal = make("normal"), activeD = make("active");

  const km = 8, K = 2 * km + 16;
  const keycap = DesignSchema.parse({ id: `${id}_key`, kind: "frame9", width: K, height: K, slice: { left: km, top: km, right: km, bottom: km }, layers: [
    { id: "outline", kind: "ring", inset: 0, thickness: 5, chamfer: 6, fill: { kind: "solid", color: outlineColor }, effects: [{ kind: "shadow", dx: 0, dy: 2, blur: 3, opacity: 0.8 }] },
    { id: "rim", kind: "ring", inset: 1, thickness: 3, chamfer: 5, fill: { kind: "material", preset: metal, seed: 9, wear: 0.2 }, effects: [{ kind: "bevel", depth: 2, size: 2 }] },
    { id: "face", kind: "box", inset: 4, chamfer: 2, fill: { kind: "linear", angle: 90, stops: [[0, look.top], [1, look.bottom]] }, effects: [{ kind: "innerShadow", blur: 3, dy: 1, opacity: 0.8 }] },
  ] });
  const cd = DesignSchema.parse({ id: `${id}_cd`, kind: "sprite", width: 16, height: 16, layers: [
    { id: "dim", kind: "box", inset: 0, fill: { kind: "solid", color: "#05070a", opacity: 0.72 } },
  ] });
  const IC = S - 2 * (t + 5);
  const runes = keys.map((_, i) => o.icons?.[i] ? undefined : DesignSchema.parse({ id: `${id}_rune${i + 1}`, kind: "sprite", width: IC, height: IC, layers: [
    { id: "gem", kind: "gem", cx: IC / 2, cy: IC / 2, size: IC * 0.5, color: o.iconColors?.[i] ?? RUNE_COLORS[i % RUNE_COLORS.length], shape: "diamond", setting: "none" },
  ] })).filter((d): d is Design => !!d);

  const gemKeyH = 28, extra = Math.round(gemKeyH / 2);
  const cell = (i: number) => {
    const cdPx = Math.round((S - 2 * (t + 5)) * (cds[i] ?? 0));
    return { id: `Skill${i + 1}`, type: "SizeBox" as const, width: S, height: S + extra, slot: { padding: { left: gap / 2, top: 0, right: gap / 2, bottom: 0 } }, children: [
      { id: `Cell${i + 1}`, type: "Overlay" as const, children: [
        { id: `Frame${i + 1}`, type: "Image" as const, brush: { asset: active.has(i) ? activeD.id : normal.id }, slot: { padding: { left: 0, top: 0, right: 0, bottom: extra } }, children: [] },
        { id: `Icon${i + 1}`, type: "Image" as const, brush: { asset: o.icons?.[i] ?? `${id}_rune${i + 1}` }, size: { x: IC, y: IC }, slot: { hAlign: "Center" as const, vAlign: "Top" as const, padding: { left: 0, top: t + 5, right: 0, bottom: 0 } }, children: [] },
        ...(cdPx > 0 ? [{ id: `Cooldown${i + 1}`, type: "Image" as const, brush: { asset: cd.id }, size: { x: IC, y: cdPx }, slot: { hAlign: "Center" as const, vAlign: "Top" as const, padding: { left: 0, top: t + 5, right: 0, bottom: 0 } }, children: [] }] : []),
        { id: `KeyCap${i + 1}`, type: "Image" as const, brush: { asset: keycap.id }, size: { x: 38, y: gemKeyH }, slot: { hAlign: "Center" as const, vAlign: "Bottom" as const }, children: [] },
        { id: `Key${i + 1}`, type: "TextBlock" as const, text: keys[i], fontSize: 17, color: look.text, slot: { hAlign: "Center" as const, vAlign: "Bottom" as const, padding: { left: 0, top: 0, right: 0, bottom: 4 } }, children: [] },
      ] },
    ] };
  };
  const width = keys.length * (S + gap), height = S + extra;
  const widget = WidgetSchema.parse({ id, width, height, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Bar", type: "HorizontalBox", slot: full, children: keys.map((_, i) => cell(i)) },
  ] } });
  return { theme, designs: [normal, activeD, keycap, cd, ...runes], widget, variants: { normal: normal.id, active: activeD.id } };
}
