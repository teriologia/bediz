import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SliderInputSchema, TabsInputSchema, ToggleInputSchema, UiKitInputSchema, sliderRecipe, tabsRecipe, toggleRecipe, uiKitRecipe } from "@bediz/core";
import { brushes, content, find, install, sheet, variant } from "./component-tools.js";
import { renderWidget } from "./render-scene.js";
import { assets } from "./state.js";

const BG = "#2a2a32";

export function registerKitTools(server: McpServer) {
  server.tool(
    "create_toggle",
    "Aç/kapa anahtarı: `<id>_off` ve `<id>_on` sabit boyutlu tasarımları (style: metal | ghost). Oyun brush'ı değiştirerek durumu gösterir.",
    ToggleInputSchema.shape,
    async (input) => {
      const r = toggleRecipe(input);
      const exported = await install(r);
      const pngs = [];
      for (const v of [r.variants.off, r.variants.on]) pngs.push(await renderWidget(variant(r.widget, (root) => { find(root, "Image")!.brush = { asset: v }; }), assets, BG));
      return content({ theme: r.theme, widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height }, variants: r.variants, assets: brushes(exported) }, await sheet(pngs, "row"));
    },
  );

  server.tool(
    "create_slider",
    "Kaydırıcı: çubuk (oluk + dolgu) ve `<id>_thumb` başlığı; başlık `value` (0..1) konumuna yerleşir. UE'de ProgressBar + Image; sürükleme mantığı oyunun işi.",
    SliderInputSchema.shape,
    async (input) => {
      const r = sliderRecipe(input);
      const exported = await install(r);
      return content({ theme: r.theme, widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height }, thumb: r.thumb, fillInset: r.inset, assets: brushes(exported) }, await renderWidget(r.widget, assets, BG));
    },
  );

  server.tool(
    "create_tabs",
    "Sekme grubu: labels için yan yana düğmeler, `selected` indeksli sekme kalıcı seçili görünümde (varsayılan stil ghost). Ortak `<id>_tab_*` tasarımlarını üretir; oyunda seçimi değiştirirken brush'ları yer değiştir.",
    TabsInputSchema.shape,
    async (input) => {
      const r = tabsRecipe(input);
      const exported = await install(r);
      return content({ theme: r.theme, widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height }, tab: r.tab, assets: brushes(exported) }, await renderWidget(r.widget, assets, BG));
    },
  );

  server.tool(
    "create_ui_kit",
    "Tek çağrıda tutarlı bir UI kiti: panel, düğme, sekmeler, ilerleme çubuğu, slot, toggle, kaydırıcı. Hepsi aynı tema/stil/metalle üretilir (`<id>_panel`, `_button`, `_tabs`, `_bar`, `_slot`, `_toggle`, `_slider`). " +
    "style: metal (kalın bevel'li) | ghost (ince çizgili). Dönüş: tema belirteçleri, her bileşenin widget'ı ve hepsini gösteren önizleme. Bileşenleri UE'ye tek tek export_unreal_plan ile aktar.",
    UiKitInputSchema.shape,
    async (input) => {
      const kit = uiKitRecipe(input);
      const summary: Record<string, unknown> = {};
      const pngs: Buffer[] = [];
      for (const [name, r] of Object.entries(kit.components)) {
        await install(r);
        summary[name] = { widget: r.widget.id, size: `${r.widget.width}x${r.widget.height}`, designs: r.designs.map((d) => d.id) };
        pngs.push(await renderWidget(r.widget, assets, BG));
      }
      return content({ theme: kit.theme, style: kit.style, tokens: kit.tokens, components: summary }, await sheet(pngs, "column", 16));
    },
  );
}
