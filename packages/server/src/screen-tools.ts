import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DialogInputSchema, InventoryInputSchema, MainMenuInputSchema, SettingsInputSchema, dialogRecipe, inventoryRecipe, mainMenuRecipe, settingsRecipe, type ScreenRecipe } from "@bediz/core";
import { install } from "./component-tools.js";
import { renderWidget } from "./render-scene.js";
import { assets } from "./state.js";
import { measureText } from "./text.js";

/** Ekranı kurar (tasarımlar + widget), PNG'leri dışa aktarır, önizlemeyi döndürür. */
async function build(r: ScreenRecipe) {
  const exported = await install(r);
  const png = await renderWidget(r.widget, assets);
  const summary = {
    widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height, fullscreen: true }, theme: r.theme, panel: r.panel,
    assets: exported.map((a) => ({ id: a.id, size: `${a.width}x${a.height}`, ...(a.slice && { slice: a.slice }), ...(a.tile && { tile: true }) })),
    next: `Unreal'a aktarmak için: export_unreal_plan {widget: "${r.widget.id}", folder: "/Game/..." } (tam ekran: widget'a SizeBox sarılmaz).`,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }, { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }] };
}

const THEMES = "theme: gold-stone, silver-slate, bronze-wood, ruby-blocks, emerald-bronze.";
const COMMON = "Karartılmış zemin döşemesi + ortada çerçeveli panel (üstte mücevher) kurar; <id>_* tasarımlarını ve tam ekran <id> widget'ını oluşturup dışa aktarır, 1280×720 önizlemeyi döndürür. Aynı id ile tekrar çağrılırsa üzerine yazar. ";

export function registerScreenTools(server: McpServer) {
  server.tool(
    "create_main_menu",
    `Ana menü ekranı: başlık + dikey buton listesi (her biri 4 durumlu Button; items listesindeki her öğe bir buton). ${COMMON}${THEMES}`,
    MainMenuInputSchema.shape,
    async (input) => build(mainMenuRecipe(input, measureText)),
  );
  server.tool(
    "create_settings_menu",
    `Ayarlar ekranı: kaydırıcılar (ProgressBar, yüzdeli), onay kutuları (açık/kapalı) ve alt butonlar. ${COMMON}${THEMES}`,
    SettingsInputSchema.shape,
    async (input) => build(settingsRecipe(input, measureText)),
  );
  server.tool(
    "create_inventory_screen",
    `Envanter ekranı: columns×rows slot ızgarası, selected ile seçili hücreler (parıltılı çerçeve) ve alt bilgi satırı. ${COMMON}${THEMES}`,
    InventoryInputSchema.shape,
    async (input) => build(inventoryRecipe(input, measureText)),
  );
  server.tool(
    "create_dialog_screen",
    `Modal diyalog: yarı saydam karartma + panel + başlık + sarılmış mesaj + alt butonlar (buttons, en çok 3). Üst katman ekran olduğundan zemin döşemesi yerine scrim kullanır. ${COMMON}${THEMES}`,
    DialogInputSchema.shape,
    async (input) => build(dialogRecipe(input, measureText)),
  );
}
