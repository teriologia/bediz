import { z } from "zod";
import { barRecipe, buttonRecipe, metalOf, slotRecipe, THEME_LOOK, type ComponentRecipe } from "./components.js";
import { GHOST_LINE, THEME_NAMES, containerRecipe } from "./container.js";
import { DesignSchema, shade, type Design } from "./design.js";
import { dropdownRecipe, inputRecipe, scrollbarRecipe, tooltipRecipe } from "./fields.js";
import { MATERIAL_PRESETS } from "./material.js";
import { WidgetSchema, type Node } from "./scene.js";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)");
const common = { id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), style: z.enum(["metal", "ghost"]).optional() };
const outline = "#120b05";
const full = { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, offsets: { left: 0, top: 0, right: 0, bottom: 0 } };

// ---------------------------------------------------------------- TOGGLE
export const ToggleInputSchema = z.object({ ...common, width: z.number().int().min(40).max(160).optional(), height: z.number().int().min(20).max(80).optional() }).strict();
export type ToggleInput = z.infer<typeof ToggleInputSchema>;

/** Aç/kapa anahtarı: iki sabit boyutlu sprite (`<id>_off`, `<id>_on`); oyun CheckBox/Button brush'ını değiştirerek gösterir. */
export function toggleRecipe(input: ToggleInput): ComponentRecipe & { variants: { off: string; on: string } } {
  const { id, theme = "gold-stone", ...o } = ToggleInputSchema.parse(input);
  const look = THEME_LOOK[theme], metal = metalOf(theme, o.frame), W = o.width ?? 68, H = o.height ?? 34, r = H / 2, ghost = o.style === "ghost", line = GHOST_LINE[metal] ?? "#c9a45a";
  const make = (on: boolean): Design => {
    const kx = on ? W - r : r, well = on ? [shade(look.fill, -0.35), look.fill] : ["#07090b", "#171c20"];
    return DesignSchema.parse({ id: `${id}_${on ? "on" : "off"}`, kind: "sprite", width: W, height: H, layers: ghost ? [
      { id: "well", kind: "box", inset: 0, radius: r, opacity: on ? 0.7 : 0.45, fill: { kind: "linear", angle: 90, stops: [[0, well[0]], [1, well[1]]] }, effects: [{ kind: "innerShadow", blur: 3, dy: 1, opacity: 0.7 }] },
      { id: "line", kind: "ring", inset: 0, thickness: 2, radius: r, opacity: on ? 1 : 0.6, fill: { kind: "solid", color: on ? "#e0b860" : line } },
      { id: "knob", kind: "ellipse", cx: kx, cy: r, rx: r - 6, ry: r - 6, fill: { kind: "solid", color: on ? "#e0b860" : look.text, opacity: on ? 1 : 0.8 } },
    ] : [
      { id: "outline", kind: "box", inset: 0, radius: r, fill: { kind: "solid", color: outline } },
      { id: "rim", kind: "ring", inset: 1, thickness: 3, radius: r - 1, fill: { kind: "material", preset: metal, seed: 12, wear: 0.25 }, effects: [{ kind: "bevel", depth: 3, size: 2 }] },
      { id: "well", kind: "box", inset: 4, radius: r - 4, fill: { kind: "linear", angle: 90, stops: [[0, well[0]], [1, well[1]]] }, effects: [{ kind: "innerShadow", blur: 4, dy: 2, opacity: 0.9 }] },
      { id: "knob", kind: "ellipse", cx: kx + (on ? -1 : 1), cy: r, rx: r - 6, ry: r - 6, fill: { kind: "material", preset: metal, seed: 14, wear: 0.15 },
        stroke: { color: outline, width: 1 }, effects: [{ kind: "bevel", depth: 3, size: 3 }, { kind: "shadow", dx: 0, dy: 2, blur: 3, opacity: 0.7 }] },
    ] });
  };
  const off = make(false), on = make(true);
  const widget = WidgetSchema.parse({ id, width: W, height: H, root: { id: "Root", type: "CanvasPanel", children: [{ id: "Toggle", type: "Image", brush: { asset: off.id }, slot: full, children: [] }] } });
  return { theme, designs: [off, on], widget, variants: { off: off.id, on: on.id } };
}

// ---------------------------------------------------------------- SLIDER
export const SliderInputSchema = z.object({ ...common, width: z.number().int().min(80).max(1024).optional(), height: z.number().int().min(16).max(64).optional(), value: z.number().min(0).max(1).optional() }).strict();
export type SliderInput = z.infer<typeof SliderInputSchema>;

/** Kaydırıcı: çubuk (oluk + dolgu, barRecipe) + `<id>_thumb` başlığı; başlık değere göre konumlanır. UE'de ProgressBar + Image; sürükleme oyunun işi. */
export function sliderRecipe(input: SliderInput): ComponentRecipe & { thumb: string; inset: number } {
  const { id, theme = "gold-stone", value = 0.6, ...o } = SliderInputSchema.parse(input);
  const look = THEME_LOOK[theme], metal = metalOf(theme, o.frame), ghost = o.style === "ghost", line = GHOST_LINE[metal] ?? "#c9a45a";
  const w = o.width ?? 260, h = Math.min(o.height ?? 22, 40), T = Math.max(26, h + 8);
  const bar = barRecipe({ id, theme, frame: o.frame, style: o.style, width: w, height: h, percent: value });
  const thumb = DesignSchema.parse({ id: `${id}_thumb`, kind: "sprite", width: T, height: T, layers: ghost ? [
    { id: "disc", kind: "ellipse", cx: T / 2, cy: T / 2, rx: T / 2 - 2, ry: T / 2 - 2, fill: { kind: "linear", angle: 90, stops: [[0, "#1a1d21"], [1, "#07090b"]] } },
    { id: "line", kind: "ring", inset: 0, thickness: 2, radius: T / 2, fill: { kind: "solid", color: line } },
    { id: "dot", kind: "ellipse", cx: T / 2, cy: T / 2, rx: 3, ry: 3, fill: { kind: "solid", color: look.text } },
  ] : [
    { id: "disc", kind: "ellipse", cx: T / 2, cy: T / 2, rx: T / 2 - 2, ry: T / 2 - 2, fill: { kind: "material", preset: metal, seed: 15, wear: 0.15 }, stroke: { color: outline, width: 1.5 },
      effects: [{ kind: "bevel", depth: 3.5, size: 4 }, { kind: "shadow", dx: 0, dy: 2, blur: 3, opacity: 0.7 }] },
    { id: "dimple", kind: "ellipse", cx: T / 2, cy: T / 2, rx: T / 5, ry: T / 5, fill: { kind: "linear", angle: 90, stops: [[0, "#0c0e10"], [1, "#2a2f33"]] }, effects: [{ kind: "innerShadow", blur: 2, dy: 1, opacity: 0.8 }] },
  ] });
  const H = Math.max(T, h), span = w - 2 * (bar.inset + 1);
  const tx = bar.inset + 1 + value * span;
  const widget = WidgetSchema.parse({ id, width: w, height: H, root: { id: "Root", type: "CanvasPanel", children: [
    { ...(bar.widget.root.children[0] as Node), slot: { anchors: full.anchors, offsets: { left: 0, top: Math.round((H - h) / 2), right: 0, bottom: Math.round((H - h) / 2) } } },
    { id: "Thumb", type: "Image", brush: { asset: thumb.id }, size: { x: T, y: T },
      slot: { anchors: { minX: 0, minY: 0.5, maxX: 0, maxY: 0.5 }, offsets: { left: Math.round(tx), top: 0, right: T, bottom: T }, alignment: { x: 0.5, y: 0.5 } }, children: [] },
  ] } });
  return { theme, designs: [...bar.designs, thumb], widget, thumb: thumb.id, inset: bar.inset };
}

// ---------------------------------------------------------------- SEKME GRUBU
export const TabsInputSchema = z.object({
  ...common, labels: z.array(z.string().min(1).max(30)).min(2).max(8), selected: z.number().int().min(0).optional(),
  tabWidth: z.number().int().min(60).max(400).optional(), tabHeight: z.number().int().min(28).max(100).optional(), fontSize: z.number().int().min(8).max(48).optional(), gap: z.number().int().min(0).max(40).optional(),
}).strict();
export type TabsInput = z.infer<typeof TabsInputSchema>;

/** Sekme grubu: ortak `<id>_tab_*` tasarımları (normal/hover/pressed/disabled + selected); seçili sekme `selected` brush'ıyla çizilir. */
export function tabsRecipe(input: TabsInput): ComponentRecipe & { tab: ReturnType<typeof buttonRecipe>["states"] & { selected: string } } {
  const { id, theme = "gold-stone", labels, selected = 0, ...o } = TabsInputSchema.parse(input);
  if (selected >= labels.length) throw new Error(`selected (${selected}) sekme sayısından (${labels.length}) küçük olmalı`);
  const tw = o.tabWidth ?? 170, th = o.tabHeight ?? 42, gap = o.gap ?? 14;
  const b = buttonRecipe({ id: `${id}_tab`, theme, frame: o.frame, style: o.style ?? "ghost", width: tw, height: th, fontSize: o.fontSize ?? 18, selected: true });
  const text = THEME_LOOK[theme].text;
  const cell = (label: string, i: number): Node => {
    const on = i === selected, s = b.states;
    return { id: `Tab${i + 1}`, type: "SizeBox", width: tw, height: th, slot: { padding: { left: gap / 2, top: 0, right: gap / 2, bottom: 0 } }, children: [
      { id: `Button${i + 1}`, type: "Button", brush: { asset: on ? b.selected! : s.normal },
        states: { hovered: { asset: on ? b.selected! : s.hovered }, pressed: { asset: on ? b.selected! : s.pressed }, disabled: { asset: s.disabled } },
        children: [{ id: `Label${i + 1}`, type: "TextBlock", text: label, fontSize: o.fontSize ?? 18, color: text, slot: { hAlign: "Center", vAlign: "Center" }, children: [] }] },
    ] };
  };
  const widget = WidgetSchema.parse({ id, width: labels.length * (tw + gap), height: th, root: { id: "Root", type: "CanvasPanel", children: [
    { id: "Tabs", type: "HorizontalBox", slot: full, children: labels.map(cell) },
  ] } });
  return { theme, designs: b.designs, widget, tab: { ...b.states, selected: b.selected! } };
}

// ---------------------------------------------------------------- UI KİTİ
export const UiKitInputSchema = z.object({ id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), style: z.enum(["metal", "ghost"]).optional() }).strict();
export type UiKitInput = z.infer<typeof UiKitInputSchema>;

/** Bir temadan tutarlı bileşen seti: panel, düğme, sekmeler, çubuk, slot, toggle, kaydırıcı, metin girişi, açılır liste, kaydırma çubuğu, tooltip. Hepsi aynı tema/stil/metal ile üretilir. */
export function uiKitRecipe(input: UiKitInput) {
  const { id, theme = "gold-stone", ...o } = UiKitInputSchema.parse(input);
  const base = { theme, frame: o.frame, style: o.style } as const;
  const panel = containerRecipe({ id: `${id}_panel`, theme, frame: o.frame, style: o.style, width: 420, height: 240 });
  const components: Record<string, ComponentRecipe> = {
    panel: { theme, designs: [panel.bg, panel.frame, ...(panel.shade ? [panel.shade] : []), ...(panel.gem ? [panel.gem] : [])], widget: panel.widget },
    button: buttonRecipe({ id: `${id}_button`, label: "BAŞLA", width: 190, height: 48, ...base }),
    tabs: tabsRecipe({ id: `${id}_tabs`, labels: ["HARİTALAR", "BOSSLAR", "ENDLESS"], ...base }),
    bar: barRecipe({ id: `${id}_bar`, width: 240, height: 24, percent: 0.65, ...base }),
    slot: slotRecipe({ id: `${id}_slot`, size: 72, ...base }),
    toggle: toggleRecipe({ id: `${id}_toggle`, ...base }),
    slider: sliderRecipe({ id: `${id}_slider`, ...base }),
    input: inputRecipe({ id: `${id}_input`, placeholder: "Oyuncu adı...", ...base }),
    dropdown: dropdownRecipe({ id: `${id}_dropdown`, ...base }),
    scrollbar: scrollbarRecipe({ id: `${id}_scroll`, ...base }),
    tooltip: tooltipRecipe({ id: `${id}_tooltip`, title: "Kadim Mühür", body: "Geçidi açar ve yakındaki düşmanlara hasar verir.", ...base }),
  };
  return { theme, style: o.style ?? "metal", tokens: { ...THEME_LOOK[theme], line: GHOST_LINE[metalOf(theme, o.frame)] ?? "#c9a45a", metal: metalOf(theme, o.frame) }, components };
}
