import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BUTTON_STATES, BarInputSchema, ButtonInputSchema, SlotInputSchema, barRecipe, buttonRecipe, compileDesign, slotRecipe, toUnrealBrush,
  type ComponentRecipe, type Node, type Widget,
} from "@bediz/core";
import { exportDesign } from "./design-tools.js";
import { renderWidget } from "./render-scene.js";
import { assets, designs, notify, widgets } from "./state.js";

/** Tasarımları ve widget'ı kaydeder, PNG'leri dışa aktarır. */
export async function install(r: ComponentRecipe) {
  for (const d of r.designs) { compileDesign(d); designs.set(d.id, d); }
  const exported = [];
  for (const d of r.designs) exported.push(await exportDesign(d));
  widgets.set(r.widget.id, r.widget);
  notify();
  return exported;
}

export const find = (n: Node, type: string): Node | undefined => (n.type === type ? n : n.children.map((c) => find(c, type)).find(Boolean));
export const variant = (w: Widget, change: (root: Node) => void): Widget => { const c = structuredClone(w); change(c.root); return c; };

/** Önizlemeleri yan yana (row) ya da alt alta (column) dizer. */
export async function sheet(pngs: Buffer[], direction: "row" | "column", gap = 14, background = "#1c1f23") {
  const metas = await Promise.all(pngs.map((p) => sharp(p).metadata()));
  const W = direction === "row" ? metas.reduce((s, m) => s + m.width! + gap, gap) : Math.max(...metas.map((m) => m.width!)) + 2 * gap;
  const H = direction === "row" ? Math.max(...metas.map((m) => m.height!)) + 2 * gap : metas.reduce((s, m) => s + m.height! + gap, gap);
  let at = gap;
  const parts = pngs.map((input, i) => {
    const p = direction === "row" ? { input, left: at, top: gap } : { input, left: gap, top: at };
    at += (direction === "row" ? metas[i].width! : metas[i].height!) + gap;
    return p;
  });
  return sharp({ create: { width: W, height: H, channels: 4, background } }).composite(parts).png().toBuffer();
}

export const content = (summary: unknown, png: Buffer) => ({
  content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }, { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }],
});
export const brushes = (exported: Awaited<ReturnType<typeof install>>) =>
  exported.map((a) => ({ id: a.id, size: `${a.width}x${a.height}`, slice: a.slice, unrealBrush: toUnrealBrush(a) }));

export function registerComponentTools(server: McpServer) {
  server.tool(
    "create_button",
    "Oyun butonu: 9-slice metal çerçeve + degrade yüzey, 4 durum (normal, hovered, pressed, disabled) ve etiketli Button widget'ı. " +
    "<id>_normal/_hovered/_pressed/_disabled tasarımlarını ve <id> widget'ını oluşturup dışa aktarır; durumları tek görselde gösterir. " +
    "theme: gold-stone, silver-slate, bronze-wood, ruby-blocks, emerald-bronze. UE'de export_unreal_plan ile Button widget'ına (durum stilleriyle) aktarılır.",
    ButtonInputSchema.shape,
    async (input) => {
      const r = buttonRecipe(input);
      const exported = await install(r);
      const pngs = [];
      for (const s of BUTTON_STATES) {
        pngs.push(await renderWidget(variant(r.widget, (root) => { find(root, "Button")!.brush = { asset: r.states[s] }; }), assets, "#2a2a32"));
      }
      return content({ theme: r.theme, widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height }, states: r.states, assets: brushes(exported) }, await sheet(pngs, "column"));
    },
  );

  server.tool(
    "create_progress_bar",
    "Yatay ilerleme çubuğu: metal çerçeveli koyu oluk (9-slice) + degrade dolgu (9-slice) ve ProgressBar widget'ı. fillColor ile renk (can=kırmızı, mana=mavi...). " +
    "<id>_trough ve <id>_fill tasarımlarını, <id> widget'ını oluşturup dışa aktarır; %0, %30, %65 ve %100 dolulukları gösterir. UE'de ProgressBar (Scale dolgu) olarak aktarılır.",
    BarInputSchema.shape,
    async (input) => {
      const r = barRecipe(input);
      const exported = await install(r);
      const pngs = [];
      for (const p of [0, 0.3, 0.65, 1]) pngs.push(await renderWidget(variant(r.widget, (root) => { find(root, "ProgressBar")!.percent = p; }), assets, "#2a2a32"));
      return content({ theme: r.theme, widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height }, fillInset: r.inset, assets: brushes(exported) }, await sheet(pngs, "column"));
    },
  );

  server.tool(
    "create_slot",
    "Envanter/eşya yuvası: metal çerçeveli çökük koyu kutu (9-slice), iki varyant: normal ve seçili (parıltılı çerçeve). " +
    "<id>_normal ve <id>_selected tasarımlarını, <id> widget'ını (normal varyantla) oluşturup dışa aktarır. Seçili durumu oyunda brush'ı değiştirerek gösterirsin.",
    SlotInputSchema.shape,
    async (input) => {
      const r = slotRecipe(input);
      const exported = await install(r);
      const pngs = [];
      for (const v of [r.variants.normal, r.variants.selected]) {
        const png = await renderWidget(variant(r.widget, (root) => { find(root, "Image")!.brush = { asset: v }; }), assets, "#2a2a32");
        pngs.push(await sharp(png).resize(r.widget.width * 3, r.widget.height * 3, { kernel: "nearest" }).png().toBuffer());
      }
      return content({ theme: r.theme, widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height }, variants: r.variants, assets: brushes(exported) }, await sheet(pngs, "row"));
    },
  );
}
