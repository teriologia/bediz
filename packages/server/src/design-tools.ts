import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CONTAINER_THEMES, ContainerInputSchema, DESIGN_KINDS, DesignSchema, LayerSchema, SliceSchema, containerRecipe, compileDesign, materialDefaults, presetInfo, toUnrealBrush,
  type Design,
} from "@bediz/core";
import { assets, designs, getDesign, notify, projectDir, widgets } from "./state.js";
import { renderDesignPng } from "./design-render.js";
import { renderNineSliceFrom, tileTo } from "./render.js";
import { renderWidget } from "./render-scene.js";

const text = (v: unknown) => ({ type: "text" as const, text: JSON.stringify(v, null, 2) });
const image = (png: Buffer) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" });
const bg = z.string().regex(/^(#[0-9a-fA-F]{6}|none)$/, "#RRGGBB veya none");
const designId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)");

/** Doğrulayıp (şema + derleme) kaydeder; geçersizse tasarım olduğu gibi kalır. */
function commit(id: string, mutate: (d: Design) => void): Design {
  const next = structuredClone(getDesign(id));
  mutate(next);
  const valid = DesignSchema.parse(next);
  compileDesign(valid); // ring kalınlığı gibi geometri hatalarını kaydetmeden yakala
  designs.set(id, valid);
  notify();
  return valid;
}

export async function exportDesign(d: Design) {
  const dir = join(projectDir(), "art");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${d.id}.png`);
  writeFileSync(path, await renderDesignPng(d));
  const a = { id: d.id, path, width: d.width, height: d.height, ...(d.slice && { slice: d.slice }), ...(d.kind === "tile" && { tile: true }) };
  assets.set(a.id, a);
  notify();
  return a;
}

async function flat(png: Buffer, background: string) {
  return background === "none" ? png : sharp(png).flatten({ background }).png().toBuffer();
}

export function registerDesignTools(server: McpServer) {
  server.tool(
    "list_presets",
    "Çizim motorunun yeteneklerini ve tasarım ipuçlarını döndürür. Çizime başlamadan önce oku.",
    {},
    async () => ({
      content: [text({
        designKinds: {
          frame9: "9-slice çerçeve/panel. slice (px) köşe+kenar kalınlığını kapsamalı; ortası genelde şeffaf bırakılır. Ortası gerilir, köşeler gerilmez.",
          tile: "Dikişsiz döşenen doku (arka plan zemini). Tek bir box + texture dolgu yeterli. Bevel/shadow kullanma (kenarlarda iz bırakır).",
          sprite: "Tek parça süs (mücevher, rozet). Gerilmez; widget'ta anchor ile yerleştirilir.",
        },
        materials: { note: "fill {kind:material}: CPU hattı; preset: stone/slate (taş, desen: flagstone|blocks|rough|fine), gold/silver/bronze (fırçalı metal), wood, leather (taneli deri), marble (damarlı mermer), carbon (çapraz dokuma karbon fiber), cloth (kumaş/kadife). colors: koyu→açık rampa ile HER malzemeyi istediğin renge boya (ör. siyah mermer, kırmızı deri, mavi kadife); scale/wear ile ince ayar. Bevel gerçek kenar eğimi (depth/size px). Önerilen.", ...materialDefaults() },
        themes: { note: "create_container theme değerleri; alanları ayrıca vererek ezebilirsin.", ...CONTAINER_THEMES },
        textures: { note: "fill {kind:texture}: eski SVG filtre dokuları (basit).", ...presetInfo() },
        layerKinds: {
          box: "inset (tuval kenarından içeri) VEYA x,y,w,h; radius (yuvarlak köşe) veya chamfer (pah).",
          ring: "box gibi + thickness: ortası boş çerçeve halkası (eşit kalınlık).",
          polygon: "points [[x,y],...]; smooth (0..1) köşeleri Bézier ile yuvarlar (az nokta + smooth: pürüzsüz eğri), corners [indeks,...] keskin kalacak köşeler.",
          path: "d: SVG yol verisi (M L H V C S Q T A Z). Gerçek Bézier/yay eğrileri için bunu kullan: az noktayla pürüzsüz kenar (köşeli çokgenden çok daha iyi). evenodd? ile delikli şekil.",
          ellipse: "cx,cy,rx,ry",
          gem: "cx,cy,size,color + shape(diamond|round|hex) + setting(gold|none): hazır faset mücevher (altın yuvalı).",
          line: "points [[x,y],...], closed?; stroke ZORUNLU (fill kullanma). Açık uçlu çizgi: tel, oyuk, çatlak.",
          cracks: "x,y,w,h bölgesine count adet dallanan çatlak (koyu iz + parlak kenar); length, seed, direction (rad, bir yöne hizalar), spread. Bölgeyi yüzeyin içinde tut (boşluğa taşan çatlak havada kalır).",
          band: "d (silüet SVG yolu), from, to? (kenara px mesafe aralığı), fill: silüetin kenar mesafesine göre dilimi — eşit kalınlıklı çerçeve katmanları (dış çizgi → metal → boşluk → yüzey) için, her silüette. Yalnız PNG çıktısında; malzeme dolgusu bevel'i bant kenarlarında alır. silhouettePath: rect|notched|hex|arrow|swallow|winged (create_button shape: ile hazır).",
          repeat: "style: stud (nokta/perçin) | diamond | tick | dash | chevron | thorn (dışarı bakan kıvrık diken: yukarı giden çizgide dışarı, jitter ile boy değişimi); points (çokgen çizgi), step (px), size, margin?, rotate? (varsayılan çizgi yönüne döner): çizgi boyunca yinelenen süs dizisi (kenar perçini, boncuk, ayraç, diş). Hepsi tek yol katmanı: malzeme dolgusunda da hızlı. Köşeli çerçeve kenarı için 5 noktayla kapalı dikdörtgen ver.",
          motif: "style: chevrons («» oklar) | wings (yukarı-dışa kanat/taç) | crest (tepe süsü) | rune (mühür halkası); cx,cy,size, mirror? (tuval ortasına aynalı kopya); fill/stroke/effects her parçaya uygulanır.",
          rivets: "points [[x,y],...] (sol üst köşeye göre, 4 köşeye aynalanır), size, which?: kubbeli altın perçin. Köşe bölgesinde tut (kenar şeridinde gerilir).",
          corners: "style: blade (keskin boynuz) | scroll (kıvrımlı volüt) | claw (pençe); size (px; slice marjını aşma, yoksa gerilir), inset?, which?:[tl,tr,bl,br], studs? — 4 köşeye süs; fill/stroke/effects her parçaya uygulanır.",
        },
        fills: "solid{color,opacity} · linear{angle,stops} · radial{stops,cx?,cy?,r?} (durak rengi #RRGGBBAA olabilir: saydama sönen vinyet/ışık) · material{preset,pattern?,colors?,scale?,seed?,wear?(0..1: kenar aşınması+kir)} · texture{...eski}",
        effects: "bevel{depth,size,azimuth,highlight} · shadow{dx,dy,blur,color,opacity} · innerShadow · glow · grain{amount,size,seed} (koyulaştıran ince gren, material dışı katmanlarda). Sıra önemli (üstten uygulanır). Katman blend: multiply|screen|overlay|soft-light|lighten|darken. Tasarım symmetry: x|y|xy (yalnız sol/üst yarıyı yaz, kalanı aynalanır; tile'da olmaz).",
        tips: [
          "UI'ı TEK RESİM olarak çizme (tam ekran sprite + üstüne yazı): sekme, buton, çerçeve resmin içinde kalır, tıklanamaz, durumu/9-slice'ı olmaz, başka ekranda kullanılamaz. Her parça ayrı bileşen olsun: çerçeve/panel = frame9, buton = create_button ya da derive_button_states, madalyon/süs = ayrı sprite; hepsini widget'ta Image/Button node'larıyla yerleştir.",
          "Yazıyı ortalamak için sol koordinatı tahmin etme (kayar): ya Overlay içine TextBlock koy ve slot'una hAlign:Center (+ vAlign:Center) ver ya da canvas slotunda anchors orta noktası (minX=maxX=0.5) + alignment {x:0.5} + autoSize:true kullan. Aralıklı sütunlar için HorizontalBox/VerticalBox kullan, tek tek offset yazma.",
          "Etiket butonun içine sığmalı: genişliği metin ölçüsünden büyük ver (silüetli butonlarda uç bölgeleri iç alanı daraltır) ve önizlemede taşma/çakışma var mı kontrol et.",
          "Gotik/dikenli/kuleli çerçeve için create_ornate_frame (hazır, tek çağrı: dikenler, köşe kuleleri, mücevher, orta süs; dönen inner içerik alanı). Daha özel istiyorsan aynı yapıyı band + repeat(thorn) + polygon/path + symmetry:xy ile kendin kur.",
          "Katmanlar alttan üste çizilir (dizideki sıra).",
          "Altın çerçeve: ring + texture gold + bevel + hafif shadow; altına koyu ring ile dış çizgi ekle.",
          "frame9 slice ≥ çerçeve kalınlığı + köşe yarıçapı. Ortada 64px+ düz bölge bırak.",
          "frame9'u göstereceğin boyutta çiz (width/height = nihai boyut; dar bir tuvali 5× germek malzeme dokusunu uzatıp bulandırır: taş/metal 'sıkılmış' görünür). Tam ekran çerçeve için 1280×720 gibi gerçek boyutta çiz, preview_stretch ile kontrol et; büyük boyutta çizim birkaç sn sürer. create_container bunu kendisi yapar.",
          "Süs/mücevhere frame9'a koyma: gerilir. Ayrı sprite yap, widget'ta ortala.",
          "Kendi (yaratıcı) buton tasarımını çizdiysen: derive_button_states ile hover/pressed/disabled hâllerini türet ve çalışan Button widget'ı al; kanatlı/süslü gerilmeyen butonlar için slice verme (sabit boyutlu Image olur).",
          "Tek çağrıda hazır container için create_container; sonra katmanları update_layer ile inceltebilirsin.",
        ],
      })],
    }),
  );

  server.tool(
    "create_design",
    "Boş bir tasarım (tuval) oluşturur. kind: frame9 (slice gerekli) | tile | sprite. Sonra add_layer ile çiz.",
    { id: designId, kind: z.enum(DESIGN_KINDS), width: z.number().int().min(8).max(2048), height: z.number().int().min(8).max(2048),
      slice: SliceSchema.optional(), symmetry: z.enum(["x", "y", "xy"]).optional(), layers: z.array(LayerSchema).optional() },
    async ({ id, layers, ...rest }) => {
      if (designs.has(id)) throw new Error(`tasarım zaten var: ${id}`);
      const d = DesignSchema.parse({ id, ...rest, layers: layers ?? [] });
      compileDesign(d);
      designs.set(id, d);
      notify();
      return { content: [text(d)] };
    },
  );

  server.tool(
    "update_design",
    "Tasarımın boyutunu ve/veya slice'ını değiştirir.",
    { design: z.string(), width: z.number().int().min(8).max(2048).optional(), height: z.number().int().min(8).max(2048).optional(), slice: SliceSchema.optional(), symmetry: z.enum(["x", "y", "xy"]).optional() },
    async ({ design, ...p }) => ({ content: [text(commit(design, (d) => Object.assign(d, p)))] }),
  );

  server.tool(
    "add_layer",
    "Tasarıma katman ekler (üste; index verilirse o sıraya). Katman şeması için list_presets'e bak.",
    { design: z.string(), layer: LayerSchema, index: z.number().int().min(0).optional() },
    async ({ design, layer, index }) => ({
      content: [text(commit(design, (d) => d.layers.splice(index ?? d.layers.length, 0, layer)))],
    }),
  );

  server.tool(
    "update_layer",
    "Katmanın alanlarını günceller. patch: sadece değişen alanlar; fill/effects/stroke bütün olarak değişir; alana null vermek onu siler.",
    { design: z.string(), id: z.string(), patch: z.record(z.string(), z.unknown()) },
    async ({ design, id, patch }) => ({
      content: [text(commit(design, (d) => {
        const i = d.layers.findIndex((l) => l.id === id);
        if (i < 0) throw new Error(`katman yok: ${id}`);
        const l = { ...d.layers[i] } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) v === null ? delete l[k] : (l[k] = v);
        d.layers[i] = l as typeof d.layers[number];
      }))],
    }),
  );

  server.tool(
    "remove_layer",
    "Katmanı siler.",
    { design: z.string(), id: z.string() },
    async ({ design, id }) => ({
      content: [text(commit(design, (d) => {
        if (!d.layers.some((l) => l.id === id)) throw new Error(`katman yok: ${id}`);
        d.layers = d.layers.filter((l) => l.id !== id);
      }))],
    }),
  );

  server.tool(
    "get_design",
    "Tasarımı döndürür. design verilmezse tasarım listesi.",
    { design: z.string().optional() },
    async ({ design }) => ({
      content: [text(design ? getDesign(design) : [...designs.values()].map((d) => ({ id: d.id, kind: d.kind, width: d.width, height: d.height, layers: d.layers.length })))],
    }),
  );

  server.tool(
    "render_design",
    "Tasarımı PNG olarak çizer (kendi boyutunda). Çizdiğini görmek için kullan. scale küçük süsleri büyütür.",
    { design: z.string(), background: bg.default("#2a2a32"), scale: z.number().int().min(1).max(4).default(1) },
    async ({ design, background, scale }) => {
      const d = getDesign(design);
      let img = sharp(await renderDesignPng(d));
      if (scale > 1) img = sharp(await img.resize(d.width * scale, d.height * scale, { kernel: "nearest" }).png().toBuffer());
      return { content: [image(await flat(await img.png().toBuffer(), background))] };
    },
  );

  server.tool(
    "preview_stretch",
    "Tasarımı hedef boyutta gösterir: frame9 → 9-slice gerilmiş, tile → döşenmiş, sprite → ortalanmış. Gerilince bozulup bozulmadığını kontrol et.",
    { design: z.string(), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096), background: bg.default("#2a2a32") },
    async ({ design, width, height, background }) => {
      const d = getDesign(design);
      const png = await renderDesignPng(d);
      const base = { create: { width, height, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
      const out = d.kind === "frame9"
        ? await renderNineSliceFrom(png, { id: d.id, width: d.width, height: d.height, slice: d.slice }, width, height)
        : d.kind === "tile"
          ? await tileTo(png, width, height)
          : await sharp(base).composite([{ input: png, gravity: "center" }]).png().toBuffer();
      return { content: [image(await flat(out, background))] };
    },
  );

  server.tool(
    "export_design",
    "Tasarımı projenin art/ klasörüne PNG yazar ve asset olarak kaydeder (id = tasarım id'si). Sonra widget tool'larında brush={asset} ile kullanılır. Unreal brush değerlerini döndürür.",
    { design: z.string() },
    async ({ design }) => {
      const a = await exportDesign(getDesign(design));
      return { content: [text({ asset: a, unrealBrush: toUnrealBrush(a) })] };
    },
  );

  server.tool(
    "create_container",
    "Tek çağrıda hazır container: dikişsiz zemin dokusu (tile) + 9-slice çerçeve (altın bant, arduvaz bant, iç çıta, köşe süsü, çatlak) + üstte ortalanmış mücevher. " +
    "Önce theme seç (gold-stone, silver-slate, bronze-wood, ruby-blocks, emerald-bronze), istediğin alanı ayrıca vererek ez. " +
    "<id>_bg, <id>_frame, <id>_shade (vinyet + ışık; shade:false ile kapanır), <id>_gem tasarımlarını ve <id> widget'ını oluşturup dışa aktarır, önizlemeyi döndürür. Aynı id ile tekrar çağrılırsa üzerine yazar. " +
    "Sonra tasarımları update_layer/add_layer ile inceltip export_design ile yenileyebilirsin.",
    ContainerInputSchema.shape,
    async (input) => {
      const r = containerRecipe(input);
      const ds = [r.bg, r.frame, ...(r.shade ? [r.shade] : []), ...(r.gem ? [r.gem] : [])];
      for (const d of ds) { compileDesign(d); designs.set(d.id, d); }
      if (!r.gem) designs.delete(`${input.id}_gem`);
      if (!r.shade) designs.delete(`${input.id}_shade`);
      const exported = await Promise.all(ds.map(exportDesign));
      widgets.set(r.widget.id, r.widget);
      notify();
      const png = await renderWidget(r.widget, assets);
      return {
        content: [
          text({
            theme: r.theme, resolved: r.resolved,
            widget: { id: r.widget.id, width: r.widget.width, height: r.widget.height },
            assets: exported.map((a) => ({ id: a.id, size: `${a.width}x${a.height}`, slice: a.slice, tile: a.tile, unrealBrush: toUnrealBrush(a) })),
          }),
          image(png),
        ],
      };
    },
  );
}
