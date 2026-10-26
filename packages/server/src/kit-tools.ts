import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DropdownInputSchema, InputInputSchema, OrnateFrameInputSchema, PaletteSchema, registerPalette, ornateFrameRecipe, ScrollbarInputSchema, SliderInputSchema, TabsInputSchema, ToggleInputSchema, TooltipInputSchema, UiKitInputSchema,
  dropdownRecipe, inputRecipe, scrollbarRecipe, sliderRecipe, tabsRecipe, toggleRecipe, tooltipRecipe, uiKitRecipe, type ComponentRecipe,
} from "@bediz/core";
import { brushes, content, find, install, sheet, variant } from "./component-tools.js";
import { renderWidget } from "./render-scene.js";
import sharp from "sharp";
import { assets, notify, palettes } from "./state.js";
import { measureText } from "./text.js";

const BG = "#2a2a32";

export function registerKitTools(server: McpServer) {
  server.tool(
    "register_palette",
    "Serbest renk paleti kaydeder; `name` artık bir tema adıdır (create_ui_kit, create_button, create_container, create_*_screen vb. `theme: <name>` ile kullanır). " +
    "surface: yüzeyin AÇIK tonu (alt ton otomatik), accent: çubuk dolgusu/mücevher/vurgu, metal: çerçeve metalinin orta tonu (koyu→açık rampa otomatik), text, ground?: panel zemin rengi. " +
    "Dönüş: bu paletle üretilmiş küçük bir kit önizlemesi. Aynı ad yeniden kaydedilirse üzerine yazılır (önceden üretilen asset'ler değişmez, yeniden üret).",
    PaletteSchema.shape,
    async (input) => {
      const p = PaletteSchema.parse(input);
      registerPalette(p);
      palettes.set(p.name, p);
      notify();
      const kit = uiKitRecipe({ id: `pal_${p.name}`, theme: p.name });
      const pngs: Buffer[] = [];
      for (const key of ["button", "bar", "toggle", "slider"]) { const r = kit.components[key]; await install(r); pngs.push(await renderWidget(r.widget, assets, BG)); }
      return content({ theme: p.name, palette: p }, await sheet(pngs, "column", 16));
    },
  );

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

  // Tek önizlemeli bileşenler: kur, dışa aktar, çiz.
  const simple = (name: string, description: string, shape: Record<string, never> | object, make: (input: never) => ComponentRecipe & Record<string, unknown>) =>
    server.tool(name, description, shape as never, (async (input: never) => {
      const r = make(input);
      const exported = await install(r);
      const { theme, designs: _d, widget, ...extra } = r;
      return content({ theme, widget: { id: widget.id, width: widget.width, height: widget.height }, ...extra, assets: brushes(exported) }, await renderWidget(widget, assets, BG));
    }) as never);
  simple("create_input", "Metin girişi: `<id>_normal|_focused|_disabled` çerçeveleri + yer tutucu/değer yazısı (style: metal | ghost). Yazma davranışı oyunun işi.", InputInputSchema.shape, inputRecipe as never);
  simple("create_dropdown", "Açılır liste: kapalı alan + ok, `open` ile açık liste paneli ve seçili satır vurgusu. Aç/kapa oyunda görünürlükle yapılır.", DropdownInputSchema.shape, dropdownRecipe as never);
  simple("create_scrollbar", "Dikey kaydırma çubuğu: oluk + başlık (+ hover varyantı); start/size oranları başlığın yerini ve boyunu verir. Kaydırma mantığı oyunun işi.", ScrollbarInputSchema.shape, scrollbarRecipe as never);
  simple("create_tooltip", "Bilgi balonu: çerçeveli panel + başlık + sarılmış gövde metni; yükseklik metin ölçüsünden hesaplanır.", TooltipInputSchema.shape, ((i: never) => tooltipRecipe(i, measureText)) as never);

  server.tool(
    "create_ornate_frame",
    "Gotik dikenli çerçeve (tek sabit boyutlu görsel): koyu demir bant, kenar boyunca dışarı bakan kıvrık dikenler, köşe kuleleri (sivri uçlar + gövde + mücevher), üst/alt orta süs kulesi. " +
    "Sol-üst çeyrek çizilip symmetry:xy ile aynalanır. Orta bölge saydam: paneli/arka planı çerçevenin ALTINA koy; dönüşteki `inner` içerik alanıdır (tuval px). " +
    "width/height çerçevenin nihai boyutu (480..1920 × 360..1080; gerilmez, çizim boyuta göre 5-25 sn sürer), spire kule uzunluğu (çerçeve bu kadar boşlukla çizilir), thickness demir kalınlığı, " +
    "thorns/thornSize/thornStep dikenler, accent mücevher+kakma rengi, metalColors demir rampası (koyu→açık), wear 0..1. theme/palet verirsen demir ve renkler ondan gelir.",
    OrnateFrameInputSchema.shape,
    async (input) => {
      const r = ornateFrameRecipe(input);
      const exported = await install(r);
      const png = await sharp(await renderWidget(r.widget, assets, "#0a0a0c")).resize({ width: Math.min(960, r.widget.width) }).png().toBuffer();
      return content({ theme: r.theme, widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height }, inner: r.inner, assets: brushes(exported) }, png);
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
