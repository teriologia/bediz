import { z } from "zod";
import { barRecipe, buttonRecipe, slotRecipe, THEME_LOOK } from "./components.js";
import { CONTAINER_THEMES, THEME_NAMES, containerRecipe, type ThemeName } from "./container.js";
import { DesignSchema, type Design } from "./design.js";
import { MATERIAL_PRESETS, type MaterialPreset, type StonePattern } from "./material.js";
import { WidgetSchema, type Node, type Widget } from "./scene.js";
import type { TextMeasure } from "./layout.js";

/**
 * Ekran tarifleri: ana menü, ayarlar, envanter. Hepsi aynı kalıbı kullanır (aşağıdaki "kit"):
 * tam ekran arka plan (karartılmış döşeme) + ortada çerçeveli panel (zemin, çerçeve, üstte mücevher) + panel içinde
 * dikey yığın: başlık, gövde, (isteğe bağlı) alt satır. Bileşen tasarımları (buton, çubuk, slot) tarif başına bir kez üretilir.
 */
export interface ScreenRecipe { theme: ThemeName; designs: Design[]; widget: Widget; panel: { width: number; height: number } }

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)");
const base = {
  id: Id, theme: z.enum(THEME_NAMES).optional(), frame: z.enum(MATERIAL_PRESETS).optional(), gem: z.boolean().optional(),
  width: z.number().int().min(640).max(3840).optional(), height: z.number().int().min(360).max(2160).optional(),
};

// ---------------------------------------------------------------- kit
const full = { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, offsets: { left: 0, top: 0, right: 0, bottom: 0 } };
const pad = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const node = (type: Node["type"], id: string, props: Partial<Node> = {}, children: Node[] = []): Node => ({ id, type, ...props, children });
/** Metin ölçücü verilmezse kaba tahmin (Roboto Bold ortalama ilerleme ≈ 0.58 em × 96/72). Sunucu gerçek ölçücüyü verir. */
const approx: TextMeasure = (t, fs) => ({ w: Math.ceil(t.length * fs * 0.8), h: Math.ceil(fs * (96 / 72) * 1.17) });
export const approxMeasure = approx;
/** UE Roboto Bold satır yüksekliği: 1.17 em × 96/72 (text.ts kalibrasyonu). */
const lineH = (fs: number) => Math.ceil(fs * (96 / 72) * 1.17);

/** Temanın zemin dokusu, siyahla karartılmış döşeme (ekran arka planı ve panel zemini için; okunaklı yazı). */
function backdrop(id: string, theme: ThemeName, dim = 0.62, name = "backdrop", mat?: { preset: MaterialPreset; pattern?: StonePattern }): Design {
  const c = CONTAINER_THEMES[theme];
  return DesignSchema.parse({ id: `${id}_${name}`, kind: "tile", width: 256, height: 256, layers: [
    { id: "ground", kind: "box", inset: 0, fill: { kind: "material", preset: mat?.preset ?? c.background ?? "stone", pattern: mat ? mat.pattern : c.pattern, seed: 21, wear: 0.3 } },
    { id: "dim", kind: "box", inset: 0, fill: { kind: "solid", color: "#000000", opacity: dim } },
  ] });
}

interface Panel { node: Node; designs: Design[]; content: Node; innerWidth: number; height: number }

/** Ortalanmış çerçeveli panel. `build` içeriği (VerticalBox) üretir; içerik yüksekliğine göre panel yüksekliği hesaplanır. */
function panel(id: string, theme: ThemeName, o: { frame?: z.infer<typeof base.frame>; gem?: boolean; width: number; title: string; titleSize: number; bodyHeight: number; footerHeight?: number; minInner?: number; measure: TextMeasure }, body: Node[]): Panel {
  const look = THEME_LOOK[theme];
  const r = containerRecipe({ id: `${id}_panel`, theme, frame: o.frame, gem: o.gem ?? true, width: o.width, height: 200 });
  const t = r.resolved.thickness;
  // Panel, başlık ve gövdenin gerektirdiği genişliğe açılır (uzun başlık çerçeveden taşmasın).
  const need = Math.max(o.measure(o.title, o.titleSize).w + 24, o.minInner ?? 0) + 2 * (t + 26);
  const width = Math.max(o.width, need);
  const G = r.gem?.width ?? 0, zemin = backdrop(id, theme, 0.3, "panelbg", { preset: CONTAINER_THEMES[theme].band ?? "slate", pattern: "fine" }); // koyu, ince taneli iç yüzey: yazılar okunur, panel arka plandan ayrışır
  const contentTop = r.gem ? Math.round(t * 0.45 + G / 2) + 8 : t + 20;
  const titleH = lineH(o.titleSize) + 20;
  const height = contentTop + titleH + o.bodyHeight + (o.footerHeight ?? 0) + t + 26;
  const content = node("VerticalBox", "Content", { slot: { anchors: full.anchors, offsets: { left: t + 26, top: contentTop, right: t + 26, bottom: t + 24 } } }, [
    node("TextBlock", "Title", { text: o.title, fontSize: o.titleSize, color: look.text, slot: { hAlign: "Center", padding: pad(0, 0, 0, 20) } }),
    ...body,
  ]);
  const p = node("CanvasPanel", "Panel", { slot: { anchors: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 }, offsets: { left: 0, top: 0, right: width, bottom: height }, alignment: { x: 0.5, y: 0.5 } } }, [
    node("Image", "PanelBg", { brush: { asset: zemin.id }, slot: { anchors: full.anchors, offsets: { left: t - 2, top: t - 2, right: t - 2, bottom: t - 2 } } }),
    node("Image", "PanelFrame", { brush: { asset: r.frame.id }, slot: full }),
    ...(r.gem ? [node("Image", "Gem", { brush: { asset: r.gem.id }, slot: { anchors: { minX: 0.5, minY: 0, maxX: 0.5, maxY: 0 }, offsets: { left: 0, top: Math.round(t * 0.45), right: G, bottom: G }, alignment: { x: 0.5, y: 0.5 } } })] : []),
    content,
  ]);
  return { node: p, designs: [zemin, r.frame, ...(r.gem ? [r.gem] : [])], content, innerWidth: width - 2 * (t + 26), height };
}

type States = Record<"normal" | "hovered" | "pressed" | "disabled", string>;
/** Sabit yükseklikli menü butonu: SizeBox > Button > ortalanmış etiket. */
function menuButton(id: string, label: string, s: States, fs: number, color: string, height: number, slot: Node["slot"]): Node {
  return node("SizeBox", `${id}Box`, { height, slot }, [
    node("Button", id, { brush: { asset: s.normal }, states: { hovered: { asset: s.hovered }, pressed: { asset: s.pressed }, disabled: { asset: s.disabled } }, slot: { hAlign: "Fill", vAlign: "Fill" } }, [
      node("TextBlock", `${id}Label`, { text: label, fontSize: fs, color, slot: { hAlign: "Center", vAlign: "Center" } }),
    ]),
  ]);
}

function screen(id: string, theme: ThemeName, W: number, H: number, p: Panel, extra: Design[]): ScreenRecipe {
  const pw = p.node.slot!.offsets!.right;
  if (p.height > H || pw > W) {
    throw new Error(`${id}: panel ekrana sığmıyor (${pw}×${p.height} > ${W}×${H}); satır/sütun/slotSize/buton sayısını azalt ya da height/width'i artır`);
  }
  const bd = backdrop(id, theme);
  const widget = WidgetSchema.parse({ id, width: W, height: H, fullscreen: true, root: node("CanvasPanel", "Root", {}, [
    node("Image", "Backdrop", { brush: { asset: bd.id }, slot: full }), p.node,
  ]) });
  const designs = [bd, ...p.designs, ...extra];
  return { theme, designs, widget, panel: { width: pw, height: p.height } };
}

// ---------------------------------------------------------------- ANA MENÜ
export const MainMenuInputSchema = z.object({
  ...base, title: z.string().min(1).max(40).optional(), items: z.array(z.string().min(1).max(40)).min(1).max(8).optional(),
  panelWidth: z.number().int().min(280).max(900).optional(), buttonHeight: z.number().int().min(40).max(120).optional(),
  fontSize: z.number().int().min(12).max(60).optional(), titleSize: z.number().int().min(18).max(90).optional(),
}).strict();
export type MainMenuInput = z.infer<typeof MainMenuInputSchema>;

/** Başlık + dikey buton listesi. Her buton bir menü öğesidir; hepsi aynı 4 durumlu buton tasarımını paylaşır. */
export function mainMenuRecipe(input: MainMenuInput, measure: TextMeasure = approx): ScreenRecipe {
  const { id, theme = "gold-stone", ...o } = MainMenuInputSchema.parse(input);
  const look = THEME_LOOK[theme], items = o.items ?? ["Oyna", "Ayarlar", "Çıkış"], bh = o.buttonHeight ?? 64, fs = o.fontSize ?? 26, pw = o.panelWidth ?? 440;
  const btn = buttonRecipe({ id: `${id}_btn`, theme, frame: o.frame, label: "", fontSize: fs, height: bh });
  const buttons = items.map((label, i) => menuButton(`Btn${i + 1}`, label, btn.states, fs, look.text, bh, { hAlign: "Fill", padding: pad(0, 6, 0, 6) }));
  const p = panel(id, theme, { frame: o.frame, gem: o.gem, width: pw, title: o.title ?? "ANA MENÜ", titleSize: o.titleSize ?? 42, bodyHeight: items.length * (bh + 12), measure,
    minInner: Math.max(...items.map((l) => measure(l, fs).w)) + 120 }, buttons);
  return screen(id, theme, o.width ?? 1280, o.height ?? 720, p, btn.designs);
}

// ---------------------------------------------------------------- AYARLAR
export const SettingsInputSchema = z.object({
  ...base, title: z.string().min(1).max(40).optional(), panelWidth: z.number().int().min(420).max(1000).optional(),
  sliders: z.array(z.object({ label: z.string().min(1).max(30), percent: z.number().min(0).max(1) }).strict()).min(0).max(6).optional(),
  toggles: z.array(z.object({ label: z.string().min(1).max(30), on: z.boolean().optional() }).strict()).min(0).max(6).optional(),
  buttons: z.array(z.string().min(1).max(30)).min(1).max(3).optional(), fontSize: z.number().int().min(12).max(40).optional(),
}).strict();
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

/** Kaydırıcı (ProgressBar) ve onay kutusu (slot) satırları + alt butonlar. */
export function settingsRecipe(input: SettingsInput, measure: TextMeasure = approx): ScreenRecipe {
  const { id, theme = "gold-stone", ...o } = SettingsInputSchema.parse(input);
  const look = THEME_LOOK[theme], pw = o.panelWidth ?? 560, fs = o.fontSize ?? 24, bh = 56;
  const sliders = o.sliders ?? [{ label: "Ses", percent: 0.8 }, { label: "Müzik", percent: 0.5 }, { label: "Efekt", percent: 0.65 }];
  const toggles = o.toggles ?? [{ label: "Tam ekran", on: true }, { label: "Titreşim", on: false }];
  const names = o.buttons ?? ["Uygula", "Geri"];
  const btn = buttonRecipe({ id: `${id}_btn`, theme, frame: o.frame, label: "", fontSize: fs, height: bh });
  const bar = barRecipe({ id: `${id}_bar`, theme, width: 220, height: 28 });
  const chk = slotRecipe({ id: `${id}_chk`, theme, size: 40 });
  const rowH = 44, label = (text: string) => node("TextBlock", "", { text, fontSize: fs, color: look.text, slot: { fill: 1, vAlign: "Center" } });
  const named = (n: Node, name: string): Node => ({ ...n, id: name });

  const rows: Node[] = [
    ...sliders.map((s, i) => node("HorizontalBox", `Slider${i + 1}`, { slot: { padding: pad(0, 0, 0, 12) } }, [
      named(label(s.label), `Slider${i + 1}Label`),
      node("SizeBox", `Slider${i + 1}Box`, { width: 220, height: 28, slot: { vAlign: "Center" } }, [
        node("ProgressBar", `Slider${i + 1}Bar`, { brush: { asset: bar.designs[0].id }, fill: { asset: bar.designs[1].id }, percent: s.percent, inset: bar.inset, slot: { hAlign: "Fill", vAlign: "Fill" } }),
      ]),
    ])),
    ...toggles.map((t, i) => node("HorizontalBox", `Toggle${i + 1}`, { slot: { padding: pad(0, 0, 0, 12) } }, [
      named(label(t.label), `Toggle${i + 1}Label`),
      node("Image", `Toggle${i + 1}Box`, { brush: { asset: t.on ? chk.variants.selected : chk.variants.normal }, size: { x: 40, y: 40 }, slot: { vAlign: "Center" } }),
    ])),
    node("HorizontalBox", "Actions", { slot: { padding: pad(0, 12, 0, 0) } }, names.map((n, i) =>
      menuButton(`Act${i + 1}`, n, btn.states, fs, look.text, bh, { fill: 1, padding: pad(i ? 8 : 0, 0, i < names.length - 1 ? 8 : 0, 0) }))),
  ];
  const body = (sliders.length + toggles.length) * (rowH + 12) + bh + 12 + 12;
  const p = panel(id, theme, { frame: o.frame, gem: o.gem, width: pw, title: o.title ?? "AYARLAR", titleSize: 38, bodyHeight: body, measure,
    minInner: Math.max(...[...sliders.map((s) => measure(s.label, fs).w + 220 + 24), ...toggles.map((t) => measure(t.label, fs).w + 40 + 24), 0]) }, rows);
  return screen(id, theme, o.width ?? 1280, o.height ?? 720, p, [...btn.designs, ...bar.designs, ...chk.designs]);
}

// ---------------------------------------------------------------- ENVANTER
export const InventoryInputSchema = z.object({
  ...base, title: z.string().min(1).max(40).optional(), columns: z.number().int().min(2).max(10).optional(), rows: z.number().int().min(1).max(8).optional(),
  slotSize: z.number().int().min(40).max(128).optional(), selected: z.array(z.number().int().min(0)).max(80).optional(), footer: z.string().max(60).optional(),
}).strict();
export type InventoryInput = z.infer<typeof InventoryInputSchema>;

/** Slot ızgarası (satırlar × sütunlar), seçili hücreler parıltılı çerçeveyle, altta bir bilgi satırı. */
export function inventoryRecipe(input: InventoryInput, measure: TextMeasure = approx): ScreenRecipe {
  const { id, theme = "gold-stone", ...o } = InventoryInputSchema.parse(input);
  const look = THEME_LOOK[theme], cols = o.columns ?? 6, rows = o.rows ?? 4, S = o.slotSize ?? 64, gap = 8, selected = new Set(o.selected ?? [0]);
  const slot = slotRecipe({ id: `${id}_slot`, theme, frame: o.frame, size: S });
  const cell = (r: number, c: number) => node("Image", `Slot_${r + 1}_${c + 1}`, {
    brush: { asset: selected.has(r * cols + c) ? slot.variants.selected : slot.variants.normal }, size: { x: S, y: S }, slot: { padding: pad(gap / 2, gap / 2, gap / 2, gap / 2) },
  });
  const grid = Array.from({ length: rows }, (_, r) => node("HorizontalBox", `Row${r + 1}`, { slot: { hAlign: "Center" } }, Array.from({ length: cols }, (_, c) => cell(r, c))));
  const footer = node("TextBlock", "Footer", { text: o.footer ?? `Kapasite ${selected.size}/${rows * cols}`, fontSize: 20, color: look.text, slot: { hAlign: "Center", padding: pad(0, 14, 0, 0) } });
  const gridH = rows * (S + gap), footerH = lineH(20) + 14, pw = cols * (S + gap) + 2 * 60 + 40;
  const p = panel(id, theme, { frame: o.frame, gem: o.gem, width: pw, title: o.title ?? "ENVANTER", titleSize: 38, bodyHeight: gridH, footerHeight: footerH, measure }, [...grid, footer]);
  return screen(id, theme, o.width ?? 1280, o.height ?? 720, p, slot.designs);
}
