import { z } from "zod";
import { metalOf, THEME_LOOK, type ComponentRecipe } from "./components.js";
import { GHOST_LINE, THEME_NAMES } from "./container.js";
import { DesignSchema, type Design } from "./design.js";
import { MATERIAL_PRESETS } from "./material.js";
import { approxMeasure } from "./screens.js";
import { WidgetSchema, type Node } from "./scene.js";
import type { TextMeasure } from "./layout.js";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)");
const common = { id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), style: z.enum(["metal", "ghost"]).optional() };
const outline = "#120b05";
const full = { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, offsets: { left: 0, top: 0, right: 0, bottom: 0 } };
const at = (x: number, y: number, w: number, h: number) => ({ anchors: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, offsets: { left: x, top: y, right: w, bottom: h } });
const img = (id: string, asset: string, slot: Node["slot"], size?: { x: number; y: number }): Node => ({ id, type: "Image", brush: { asset }, ...(size ? { size } : {}), slot, children: [] });
const text = (id: string, t: string, fontSize: number, color: string, slot: Node["slot"]): Node => ({ id, type: "TextBlock", text: t, fontSize, color, slot, children: [] });

type FieldState = "normal" | "focused" | "disabled";
/** Çökük alan çerçevesi (metin girişi, açılır liste gövdesi): 9-slice; focused = altın çizgi/parıltı, disabled = sönük. */
function fieldFrame(id: string, state: FieldState, o: { theme: keyof typeof THEME_LOOK; frame?: z.infer<typeof common.frame>; style?: "metal" | "ghost"; size: number }): Design {
  const look = THEME_LOOK[o.theme], metal = metalOf(o.theme, o.frame), line = GHOST_LINE[metal] ?? "#c9a45a", S = o.size, m = 10;
  const foc = state === "focused", dis = state === "disabled";
  const slice = { left: m, top: m, right: m, bottom: m };
  if (o.style === "ghost") {
    return DesignSchema.parse({ id, kind: "frame9", width: S, height: S, slice, layers: [
      { id: "well", kind: "box", inset: 0, chamfer: 5, opacity: dis ? 0.3 : foc ? 0.7 : 0.5, fill: { kind: "linear", angle: 90, stops: [[0, "#06080a"], [1, foc ? "#14181c" : "#0d1114"]] }, effects: [{ kind: "innerShadow", blur: 4, dy: 1, opacity: 0.8 }] },
      { id: "line", kind: "ring", inset: 0, thickness: foc ? 3 : 2, chamfer: 5, opacity: dis ? 0.3 : foc ? 1 : 0.6, fill: { kind: "solid", color: foc ? "#e0b860" : line } },
      { id: "line2", kind: "ring", inset: 4, thickness: 1, chamfer: 2, opacity: dis ? 0.1 : 0.28, fill: { kind: "solid", color: look.text } },
    ] });
  }
  return DesignSchema.parse({ id, kind: "frame9", width: S, height: S, slice, layers: [
    { id: "outline", kind: "ring", inset: 0, thickness: 6, chamfer: 6, fill: { kind: "solid", color: outline } },
    { id: "rim", kind: "ring", inset: 1, thickness: 3, chamfer: 5, fill: { kind: "material", preset: dis ? "silver" : metal, seed: 17, wear: foc ? 0 : 0.25 },
      effects: [{ kind: "bevel", depth: 2.5, size: 2 }, ...(foc ? [{ kind: "glow", blur: 4, color: "#ffd27a", opacity: 0.7 }] : [])] },
    ...(dis ? [{ id: "rim_dim", kind: "ring", inset: 1, thickness: 3, chamfer: 5, fill: { kind: "solid", color: "#000000", opacity: 0.5 } }] : []),
    { id: "well", kind: "box", inset: 4, chamfer: 2, fill: { kind: "linear", angle: 90, stops: [[0, "#05070a"], [1, foc ? "#1d2429" : "#14191d"]] }, effects: [{ kind: "innerShadow", blur: 4, dy: 2, opacity: 0.9 }] },
  ] });
}

// ---------------------------------------------------------------- METİN GİRİŞİ
export const InputInputSchema = z.object({
  ...common, width: z.number().int().min(80).max(1024).optional(), height: z.number().int().min(28).max(96).optional(),
  placeholder: z.string().max(60).optional(), value: z.string().max(60).optional(), fontSize: z.number().int().min(8).max(48).optional(),
}).strict();
export type InputInput = z.infer<typeof InputInputSchema>;

/** Metin girişi: normal/focused/disabled çerçeveleri (`<id>_normal|_focused|_disabled`) + yer tutucu ya da değer yazısı. Yazma davranışı oyunun işi (UE EditableText'e brush bağlanır). */
export function inputRecipe(input: InputInput): ComponentRecipe & { states: Record<FieldState, string> } {
  const { id, theme = "gold-stone", ...o } = InputInputSchema.parse(input);
  const look = THEME_LOOK[theme], w = o.width ?? 280, h = o.height ?? 44, fs = o.fontSize ?? 18;
  const states = { normal: `${id}_normal`, focused: `${id}_focused`, disabled: `${id}_disabled` } as const;
  const designs = (Object.keys(states) as FieldState[]).map((s) => fieldFrame(states[s], s, { theme, frame: o.frame, style: o.style, size: 2 * 10 + 24 }));
  const empty = !o.value;
  const widget = WidgetSchema.parse({ id, width: w, height: h, root: { id: "Root", type: "CanvasPanel", children: [
    img("Field", states.normal, full),
    { id: "Text", type: "Overlay", slot: { anchors: full.anchors, offsets: { left: 14, top: 0, right: 14, bottom: 0 } }, children: [
      text("Label", o.value || o.placeholder || "Metin gir...", fs, empty ? `${look.text}88` : look.text, { hAlign: "Left", vAlign: "Center" })] },
  ] } });
  return { theme, designs, widget, states: { ...states } };
}

// ---------------------------------------------------------------- AÇILIR LİSTE
export const DropdownInputSchema = z.object({
  ...common, width: z.number().int().min(100).max(1024).optional(), height: z.number().int().min(28).max(96).optional(),
  options: z.array(z.string().min(1).max(40)).min(2).max(10).optional(), selected: z.number().int().min(0).optional(), open: z.boolean().optional(), fontSize: z.number().int().min(8).max(48).optional(),
}).strict();
export type DropdownInput = z.infer<typeof DropdownInputSchema>;

/** Açılır liste: kapalı alan + ok, açık liste paneli ve seçili satır vurgusu. `open` listeyi widget'ta gösterir (oyunda aç/kapa görünürlükle yapılır). */
export function dropdownRecipe(input: DropdownInput): ComponentRecipe & { field: Record<"normal" | "focused", string>; list: string; row: string; arrow: string } {
  const { id, theme = "gold-stone", ...o } = DropdownInputSchema.parse(input);
  const look = THEME_LOOK[theme], metal = metalOf(theme, o.frame), line = GHOST_LINE[metal] ?? "#c9a45a", ghost = o.style === "ghost";
  const w = o.width ?? 280, h = o.height ?? 44, fs = o.fontSize ?? 18, options = o.options ?? ["Seçenek 1", "Seçenek 2", "Seçenek 3"], sel = Math.min(o.selected ?? 0, options.length - 1), open = o.open ?? true;
  const fo = { theme, frame: o.frame, style: o.style, size: 44 };
  const normal = fieldFrame(`${id}_normal`, "normal", fo), focused = fieldFrame(`${id}_focused`, "focused", fo);
  const list = fieldFrame(`${id}_list`, "normal", fo);
  const row = DesignSchema.parse({ id: `${id}_row`, kind: "sprite", width: 16, height: 16, layers: [{ id: "hl", kind: "box", inset: 0, fill: { kind: "solid", color: ghost ? "#e0b860" : line, opacity: 0.22 } }] });
  const arrow = DesignSchema.parse({ id: `${id}_arrow`, kind: "sprite", width: 18, height: 12, layers: [
    { id: "tri", kind: "polygon", points: [[2, 2], [16, 2], [9, 10]], fill: { kind: "solid", color: ghost ? line : look.text }, stroke: { color: outline, width: 1, opacity: 0.6 } }] });
  const rowH = h - 4, listH = options.length * rowH + 12, W = w, H = open ? h + 4 + listH : h;
  // Metinler Overlay içinde dikey ortalanır (canvas slotu dikey hiza vermez).
  const children: Node[] = [
    img("Field", open ? focused.id : normal.id, at(0, 0, w, h)),
    { id: "SelectedBox", type: "Overlay", slot: at(14, 0, w - 50, h), children: [text("Selected", options[sel], fs, look.text, { hAlign: "Left", vAlign: "Center" })] },
    img("Arrow", arrow.id, at(w - 32, (h - 12) / 2, 18, 12)),
  ];
  if (open) {
    children.push(img("List", list.id, at(0, h + 4, w, listH)));
    children.push(img("RowHighlight", row.id, at(6, h + 4 + 6 + sel * rowH, w - 12, rowH)));
    options.forEach((t, i) => children.push({ id: `Option${i + 1}Box`, type: "Overlay", slot: at(14, h + 4 + 6 + i * rowH, w - 28, rowH), children: [text(`Option${i + 1}`, t, fs, i === sel ? "#f4e2b0" : look.text, { hAlign: "Left", vAlign: "Center" })] }));
  }
  const widget = WidgetSchema.parse({ id, width: W, height: H, root: { id: "Root", type: "CanvasPanel", children } });
  return { theme, designs: [normal, focused, ...(open ? [list, row] : []), arrow], widget, field: { normal: normal.id, focused: focused.id }, list: list.id, row: row.id, arrow: arrow.id };
}

// ---------------------------------------------------------------- KAYDIRMA ÇUBUĞU (dikey)
export const ScrollbarInputSchema = z.object({
  ...common, height: z.number().int().min(80).max(1024).optional(), width: z.number().int().min(10).max(40).optional(),
  start: z.number().min(0).max(1).optional(), size: z.number().min(0.05).max(1).optional(),
}).strict();
export type ScrollbarInput = z.infer<typeof ScrollbarInputSchema>;

/** Dikey kaydırma çubuğu: oluk + başlık (`<id>_thumb`, `<id>_thumb_hover`). start/size oranları başlığın yerini ve boyunu verir; kaydırma mantığı oyunun işi. */
export function scrollbarRecipe(input: ScrollbarInput): ComponentRecipe & { thumb: { normal: string; hovered: string } } {
  const { id, theme = "gold-stone", ...o } = ScrollbarInputSchema.parse(input);
  const look = THEME_LOOK[theme], metal = metalOf(theme, o.frame), line = GHOST_LINE[metal] ?? "#c9a45a", ghost = o.style === "ghost";
  const w = o.width ?? 18, h = o.height ?? 260, start = o.start ?? 0.15, size = Math.min(o.size ?? 0.35, 1 - start);
  const m = 7, S = 2 * m + 12;
  const trough = DesignSchema.parse({ id: `${id}_track`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: ghost ? [
    { id: "well", kind: "box", inset: 0, radius: 6, opacity: 0.5, fill: { kind: "solid", color: "#06080a" } },
    { id: "line", kind: "ring", inset: 0, thickness: 1, radius: 6, opacity: 0.5, fill: { kind: "solid", color: line } },
  ] : [
    { id: "outline", kind: "ring", inset: 0, thickness: 4, radius: 7, fill: { kind: "solid", color: outline } },
    { id: "well", kind: "box", inset: 1, radius: 6, fill: { kind: "linear", angle: 0, stops: [[0, "#05070a"], [1, "#161b1f"]] }, effects: [{ kind: "innerShadow", blur: 3, dx: 1, opacity: 0.9 }] },
  ] });
  const thumbOf = (hov: boolean) => DesignSchema.parse({ id: `${id}_thumb${hov ? "_hover" : ""}`, kind: "frame9", width: S, height: S, slice: { left: m, top: m, right: m, bottom: m }, layers: ghost ? [
    { id: "body", kind: "box", inset: 0, radius: 6, opacity: hov ? 0.6 : 0.35, fill: { kind: "solid", color: hov ? "#e0b860" : look.text } },
    { id: "line", kind: "ring", inset: 0, thickness: 1, radius: 6, opacity: hov ? 1 : 0.7, fill: { kind: "solid", color: hov ? "#e0b860" : line } },
  ] : [
    { id: "outline", kind: "box", inset: 0, radius: 7, fill: { kind: "solid", color: outline } },
    { id: "body", kind: "box", inset: 1, radius: 6, fill: { kind: "material", preset: metal, seed: 19, wear: hov ? 0 : 0.2 }, effects: [{ kind: "bevel", depth: 3, size: 3 }, ...(hov ? [{ kind: "glow", blur: 3, color: "#ffd27a", opacity: 0.6 }] : [])] },
  ] });
  const thumb = thumbOf(false), hover = thumbOf(true), ty = Math.round(start * (h - 4)) + 2, th = Math.max(24, Math.round(size * (h - 4)));
  const widget = WidgetSchema.parse({ id, width: w, height: h, root: { id: "Root", type: "CanvasPanel", children: [
    img("Track", trough.id, full),
    img("Thumb", thumb.id, at(2, ty, w - 4, th)),
  ] } });
  return { theme, designs: [trough, thumb, hover], widget, thumb: { normal: thumb.id, hovered: hover.id } };
}

// ---------------------------------------------------------------- TOOLTIP
export const TooltipInputSchema = z.object({
  ...common, title: z.string().min(1).max(40), body: z.string().max(200).optional(), width: z.number().int().min(120).max(600).optional(),
  titleSize: z.number().int().min(8).max(40).optional(), bodySize: z.number().int().min(8).max(32).optional(),
}).strict();
export type TooltipInput = z.infer<typeof TooltipInputSchema>;

/** Bilgi balonu: çerçeveli koyu panel + başlık + (satır sarılmış) gövde metni. Yükseklik metin ölçüsünden hesaplanır (measure verilmezse kaba tahmin). */
export function tooltipRecipe(input: TooltipInput, measure: TextMeasure = approxMeasure): ComponentRecipe & { panel: string } {
  const { id, theme = "gold-stone", ...o } = TooltipInputSchema.parse(input);
  const look = THEME_LOOK[theme], w = o.width ?? 260, ts = o.titleSize ?? 20, bs = o.bodySize ?? 15, pad = 14;
  const panel = fieldFrame(`${id}_panel`, "normal", { theme, frame: o.frame, style: o.style, size: 44 });
  // Basit sözcük sarma: ölçüm ölçücüyle yapılır, satır genişliği w - 2·pad.
  const lines: string[] = [];
  let cur = "";
  for (const word of (o.body ?? "").split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure(next, bs).w > w - 2 * pad) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  const th = measure(o.title, ts).h, bh = measure("Ag", bs).h, h = pad + th + (lines.length ? 8 + lines.length * bh : 0) + pad;
  const body: Node[] = [text("Title", o.title, ts, "#f4e2b0", { hAlign: "Left", padding: { left: 0, top: 0, right: 0, bottom: lines.length ? 8 : 0 } }),
    ...lines.map((l, i) => text(`Line${i + 1}`, l, bs, look.text, { hAlign: "Left" }))];
  const widget = WidgetSchema.parse({ id, width: w, height: h, root: { id: "Root", type: "CanvasPanel", children: [
    img("Panel", panel.id, full),
    { id: "Content", type: "VerticalBox", slot: { anchors: full.anchors, offsets: { left: pad, top: pad, right: pad, bottom: pad } }, children: body },
  ] } });
  return { theme, designs: [panel], widget, panel: panel.id };
}
