import assert from "node:assert/strict";
import { containerRecipe } from "./container.js";
import type { Asset } from "./slice.js";
import { WidgetSchema, type Widget } from "./scene.js";
import { unrealPlan, type PlanStep } from "./unreal-plan.js";

const asArt = (r: ReturnType<typeof containerRecipe>) => {
  const m = new Map<string, Asset>();
  for (const d of [r.bg, r.frame, r.shade!, r.gem!]) m.set(d.id, { id: d.id, path: `C:\\art\\${d.id}.png`, width: d.width, height: d.height, slice: d.slice, tile: d.kind === "tile" || undefined });
  return m;
};
const r = containerRecipe({ id: "gold_stone" });
const plan = unrealPlan(r.widget, (id) => asArt(r).get(id), { folder: "/Game/BedizTest/Plan" });
const by = (tool: string) => plan.steps.filter((s) => s.tool === tool);
const vals = (s: PlanStep) => JSON.parse(s.arguments.values as string);

// sıra: klasör → (import, doku ayarı)× → blueprint → ağaç → derle → kaydet
assert.equal(plan.steps[0].tool, "create_folder");
assert.equal(plan.steps.at(-1)!.tool, "save_assets");
assert.equal(plan.steps.at(-2)!.tool, "CompileWidgetBlueprint");
assert.equal(by("import_file").length, 4);
assert.equal(by("CreateWidgetBlueprint").length, 1);
const lastImport = plan.steps.map((s) => s.tool).lastIndexOf("import_file");
assert.ok(plan.steps.findIndex((s) => s.tool === "CreateWidgetBlueprint") > lastImport);
assert.deepEqual(by("import_file")[0].arguments.source_file, "C:/art/gold_stone_bg.png"); // ters eğik çizgi yok
assert.equal(plan.textures["gold_stone_frame"], "/Game/BedizTest/Plan/T_gold_stone_frame");

// doku ayarları: tile Wrap, çerçeve/sprite Clamp
const texSets = by("set_properties").filter((s) => "compressionSettings" in vals(s));
assert.equal(texSets.length, 4);
assert.equal(vals(texSets[0]).addressX, "TA_Wrap");
assert.equal(vals(texSets[1]).addressX, "TA_Clamp");

// AddWidget: SizeBox kök, sonra Root canvas ve çocukları; her $ref daha önce kaydedilmiş olmalı
assert.deepEqual(by("AddWidget").map((s) => s.save), ["SizeBox", "Root", "Background", "Shade", "Frame", "Gem"]);
const saved = new Set<string>();
for (const s of plan.steps) {
  const walkRefs = (v: unknown): void => {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.$ref === "string") assert.ok(saved.has(o.$ref.split(".")[0]), `${s.id}: ${o.$ref} henüz kaydedilmedi`);
      else Object.values(o).forEach(walkRefs);
    }
  };
  walkRefs(s.arguments);
  if (s.save) saved.add(s.save);
}
for (const s of by("set_properties")) assert.equal(typeof s.arguments.values, "string", "values JSON metni olmalı");

// bediz → UE brush: çerçeve Box + normalize margin, zemin Image + Tiling Both, mücevher düz Image
const brushOf = (name: string) => {
  const i = plan.steps.findIndex((s) => s.save === name);
  return vals(plan.steps.slice(i).find((s) => s.tool === "set_properties" && "brush" in vals(s))!).brush;
};
const f = brushOf("Frame"), g = brushOf("Gem"), b = brushOf("Background");
assert.equal(f.drawAs, "Box");
assert.ok(Math.abs(f.margin.left - r.frame.slice!.left / r.frame.width) < 1e-9);
assert.equal(f.resourceObject, "/Game/BedizTest/Plan/T_gold_stone_frame.T_gold_stone_frame");
assert.equal(b.tiling, "Both");
assert.equal(g.drawAs, "Image");
assert.equal(g.margin, undefined);

// slot: canvas layoutData bediz değerleriyle aynı; SizeBox boyutu widget boyutu
const slotOf = (name: string) => {
  const i = plan.steps.findIndex((s) => s.save === name);
  return vals(plan.steps[i + 1]);
};
assert.deepEqual(slotOf("Gem").layoutData.alignment, { x: 0.5, y: 0.5 });
assert.deepEqual(slotOf("Gem").layoutData.offsets, r.widget.root.children.find((c) => c.id === "Gem")!.slot!.offsets);
assert.deepEqual(slotOf("Frame").layoutData.anchors, { minimum: { x: 0, y: 0 }, maximum: { x: 1, y: 1 } });
assert.deepEqual(vals(plan.steps[plan.steps.findIndex((s) => s.save === "SizeBox") + 1]).widthOverride, r.widget.width);
assert.deepEqual(slotOf("Root"), { padding: { left: 0, top: 0, right: 0, bottom: 0 }, horizontalAlignment: "HAlign_Fill", verticalAlignment: "VAlign_Fill" });

// diğer node türleri: kutu slotu, Border background, TextBlock; UE varsayılanından farklı hizalar açık yazılır
const menu: Widget = WidgetSchema.parse({ id: "Menu", width: 300, height: 200, root: { id: "Root", type: "Overlay", children: [
  { id: "Panel", type: "Border", brush: { asset: "gold_stone_frame" }, children: [
    { id: "Col", type: "VerticalBox", children: [
      { id: "Title", type: "TextBlock", text: "Ana Menü", fontSize: 28, color: "#808080", slot: { hAlign: "Center", fill: 2 }, children: [] },
      { id: "Ico", type: "Image", size: { x: 32, y: 32 }, children: [] },
    ] },
  ] },
] } });
const mp = unrealPlan(menu, (id) => asArt(r).get(id), { sizeBox: false, verify: true });
assert.ok(!mp.steps.some((s) => s.save === "SizeBox"));
assert.deepEqual(mp.steps.filter((s) => s.tool === "AddWidget").map((s) => (s.arguments.widgetClass as { refPath: string }).refPath.split(".").pop()), ["Overlay", "Border", "VerticalBox", "TextBlock", "Image"]);
const mv = (name: string, key: string) => {
  const i = mp.steps.findIndex((s) => s.save === name);
  return mp.steps.slice(i + 1, i + 3).map((s) => (s.tool === "set_properties" ? vals(s) : {})).find((v) => key in v);
};
assert.ok(mv("Panel", "background").background.drawAs === "Box");
assert.deepEqual(mv("Title", "size").size, { sizeRule: "Fill", value: 2 });
assert.equal(mv("Title", "horizontalAlignment").horizontalAlignment, "HAlign_Center");
assert.equal(mv("Panel", "horizontalAlignment").horizontalAlignment, "HAlign_Fill", "Border çocuğu Fill (UE varsayılanı değil)");
const text = mv("Title", "text");
assert.equal(text.text, "Ana Menü");
assert.equal(text.font.size, 28);
assert.ok(Math.abs(text.colorAndOpacity.specifiedColor.r - 0.21586) < 1e-3, "sRGB → doğrusal renk");
assert.equal(mv("Ico", "brush").brush.drawAs, "NoDrawType");
assert.deepEqual(mv("Ico", "brush").brush.imageSize, { x: 32, y: 32 });
assert.deepEqual(mp.steps.slice(-3).map((s) => s.tool), ["OpenEditorForAsset", "CaptureEditorImage", "save_assets"]);
assert.ok(mp.steps.slice(-3).every((s) => s.optional));
assert.equal(mp.steps.filter((s) => !s.optional && s.tool === "save_assets").length, 1, "asıl kaydetme isteğe bağlı olmamalı");

// hatalar
assert.throws(() => unrealPlan(r.widget, () => undefined), /asset yok/);
assert.throws(() => unrealPlan(r.widget, (id) => asArt(r).get(id), { folder: "/Game/../x" }), /folder/);
assert.throws(() => unrealPlan(r.widget, (id) => asArt(r).get(id), { folder: "C:/x" }), /folder/);
// ad temizleme: özel karakterli id geçerli UE adına döner, çakışmada benzersizleşir
const odd: Widget = WidgetSchema.parse({ id: "my widget!", width: 100, height: 100, root: { id: "a b", type: "CanvasPanel", children: [{ id: "a_b", type: "Image", children: [] }] } });
const op = unrealPlan(odd, () => undefined);
assert.equal(op.blueprint, "/Game/Bediz/my_widget_/WBP_my_widget_");
assert.deepEqual(op.steps.filter((s) => s.tool === "AddWidget").map((s) => s.save), ["SizeBox", "a_b", "a_b_"]);
// TextBlock.font: ueAsset yoksa hata; varsa fontObject (Ad.Ad biçimine tamamlanır)
const fw = WidgetSchema.parse({ id: "ft", width: 100, height: 40, root: { id: "R", type: "CanvasPanel", children: [{ id: "T", type: "TextBlock", text: "x", font: "cinzel", children: [] }] } });
assert.throws(() => unrealPlan(fw, () => undefined), /UE Font asset yolu yok/);
const fp = unrealPlan(fw, () => undefined, { fonts: () => "/Game/UI/Fonts/Cinzel_Font" });
assert.match(fp.steps.map((s) => String(s.arguments.values ?? "")).join(), /"fontObject":"\/Game\/UI\/Fonts\/Cinzel_Font\.Cinzel_Font"/);
// yazı efektleri: harf aralığı, kontur, gölge (#RRGGBBAA alfa korunur)
const ew = WidgetSchema.parse({ id: "fx", width: 100, height: 40, root: { id: "R", type: "CanvasPanel", children: [{ id: "T", type: "TextBlock", text: "x", letterSpacing: 120, outline: { size: 2, color: "#000000" }, shadow: { x: 2, y: 3, color: "#00000080" }, children: [] }] } });
const ev = JSON.parse(String(unrealPlan(ew, () => undefined).steps.find((s) => String(s.arguments.values ?? "").includes('"letterSpacing"'))!.arguments.values));
assert.equal(ev.font.letterSpacing, 120);
assert.equal(ev.font.outlineSettings.outlineSize, 2);
assert.deepEqual(ev.shadowOffset, { x: 2, y: 3 });
assert.ok(Math.abs(ev.shadowColorAndOpacity.a - 0.502) < 0.001);
console.log("unreal-plan ok");
