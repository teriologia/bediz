import assert from "node:assert/strict";
import { THEME_NAMES } from "./container.js";
import { compileDesign, type Design } from "./design.js";
import { layoutWidget } from "./layout.js";
import { walk, type Node } from "./scene.js";
import type { Asset } from "./slice.js";
import { approxMeasure, inventoryRecipe, mainMenuRecipe, settingsRecipe, type ScreenRecipe } from "./screens.js";
import { unrealPlan, type PlanStep } from "./unreal-plan.js";

const assetsOf = (ds: Design[]) => new Map<string, Asset>(ds.map((d) => [d.id, { id: d.id, path: `C:\art\${d.id}.png`, width: d.width, height: d.height, slice: d.slice, tile: d.kind === "tile" || undefined }]));
const nodes = (r: ScreenRecipe) => [...walk(r.widget.root)].map((e) => e.node);
const ofType = (r: ScreenRecipe, t: Node["type"]) => nodes(r).filter((n) => n.type === t);
const rects = (r: ScreenRecipe) => layoutWidget(r.widget, (id) => { const a = assetsOf(r.designs).get(id); return a && { w: a.width, h: a.height }; }, approxMeasure);

// ---- ana menü ----
const m = mainMenuRecipe({ id: "menu" });
assert.equal(m.widget.fullscreen, true);
assert.deepEqual([m.widget.width, m.widget.height], [1280, 720]);
assert.deepEqual(m.widget.root.children.map((c) => c.id), ["Backdrop", "Panel"]);
assert.deepEqual(m.designs.map((d) => d.id).sort(), ["menu_backdrop", "menu_btn_disabled", "menu_btn_hovered", "menu_btn_normal", "menu_btn_pressed", "menu_panel_frame", "menu_panel_gem", "menu_panelbg"]);
assert.equal(new Set(m.designs.map((d) => d.id)).size, m.designs.length, "tasarım id'leri benzersiz");
const buttons = ofType(m, "Button");
assert.deepEqual(buttons.map((b) => b.id), ["Btn1", "Btn2", "Btn3"]);
assert.ok(buttons.every((b) => b.brush!.asset === "menu_btn_normal" && b.states!.pressed!.asset === "menu_btn_pressed"), "tüm butonlar aynı 4 durumlu tasarımı paylaşır");
assert.deepEqual(buttons.map((b) => b.children[0].text), ["Oyna", "Ayarlar", "Çıkış"]);
assert.equal(ofType(m, "SizeBox").length, 3, "her buton sabit yükseklikli SizeBox içinde");
assert.ok(new Set(nodes(m).map((n) => n.id)).size === nodes(m).length, "node id'leri benzersiz");
for (const d of m.designs) compileDesign(d);

// içerik panele sığar (kaba ölçüyle): tüm node'lar panel dikdörtgeninin içinde
const fits = (r: ScreenRecipe) => {
  const L = rects(r), P = L.get("Panel")!;
  for (const n of nodes(r)) {
    if (["Root", "Backdrop", "Panel", "PanelBg", "PanelFrame", "Gem"].includes(n.id)) continue;
    const b = L.get(n.id)!;
    assert.ok(b.x >= P.x - 1 && b.y >= P.y - 1 && b.x + b.w <= P.x + P.w + 1 && b.y + b.h <= P.y + P.h + 1, `${r.widget.id}/${n.id} panelden taşıyor: ${JSON.stringify(b)} / ${JSON.stringify(P)}`);
  }
  return { L, P };
};
const { L, P } = fits(m);
assert.ok(Math.abs(P.x + P.w / 2 - 640) < 1 && Math.abs(P.y + P.h / 2 - 360) < 1, "panel ekranın ortasında");
assert.equal(P.w, 440);
// buton yüksekliği sabit, genişliği panelin iç genişliği
assert.equal(L.get("Btn1")!.h, 64);

// içerik sayısı ve uzun başlık panelin boyutunu büyütür
const big = mainMenuRecipe({ id: "m2", items: ["a", "b", "c", "d", "e", "f"], title: "ÇOK UZUN BİR OYUN ADI BURADA" });
assert.ok(big.panel.height > m.panel.height, "daha çok buton → daha yüksek panel");
assert.ok(big.panel.width > 440, "uzun başlık paneli genişletir");
fits(big);
assert.throws(() => mainMenuRecipe({ id: "x", items: [] }));
assert.throws(() => mainMenuRecipe({ id: "x", items: Array(8).fill("a"), buttonHeight: 120 }), /ekrana sığmıyor/);
assert.doesNotThrow(() => mainMenuRecipe({ id: "x", items: Array(8).fill("a"), buttonHeight: 120, height: 1440 }));
assert.throws(() => mainMenuRecipe({ id: "x", items: Array(9).fill("a") }));
assert.throws(() => mainMenuRecipe({ id: "../x" }));

// ---- ayarlar ----
const s = settingsRecipe({ id: "set" });
assert.equal(ofType(s, "ProgressBar").length, 3);
assert.deepEqual(ofType(s, "ProgressBar").map((b) => b.percent), [0.8, 0.5, 0.65]);
const chk = nodes(s).filter((n) => n.id.startsWith("Toggle") && n.type === "Image");
assert.deepEqual(chk.map((n) => n.brush!.asset), ["set_chk_selected", "set_chk_normal"], "açık olan seçili varyantla");
assert.equal(ofType(s, "Button").length, 2);
fits(s);
const s0 = settingsRecipe({ id: "s0", sliders: [], toggles: [], buttons: ["Tamam"] });
assert.equal(ofType(s0, "ProgressBar").length, 0);
fits(s0);

// ---- envanter ----
const inv = inventoryRecipe({ id: "inv", columns: 5, rows: 3, selected: [0, 7] });
assert.equal(nodes(inv).filter((n) => n.id.startsWith("Slot_")).length, 15);
assert.deepEqual(nodes(inv).filter((n) => n.brush?.asset === "inv_slot_selected").map((n) => n.id), ["Slot_1_1", "Slot_2_3"]);
assert.equal(nodes(inv).find((n) => n.id === "Footer")!.text, "Kapasite 2/15");
fits(inv);
assert.equal(inventoryRecipe({ id: "i2", footer: "Altın: 120" }).widget.root.children[1].children.at(-1)!.children.at(-1)!.text, "Altın: 120");

// ---- her tema ve ekran derlenir ----
for (const theme of THEME_NAMES) for (const r of [mainMenuRecipe({ id: "t", theme }), settingsRecipe({ id: "t", theme }), inventoryRecipe({ id: "t", theme })]) {
  for (const d of r.designs) compileDesign(d);
  fits(r);
}

// ---- Unreal planı: tam ekran → SizeBox sarmalayıcı yok; SizeBox node'ları override alır ----
const plan = unrealPlan(m.widget, (id) => assetsOf(m.designs).get(id), { folder: "/Game/T/Menu" });
assert.ok(!plan.steps.some((s) => s.save === "SizeBox"), "tam ekran widget'a SizeBox sarılmaz");
assert.equal(plan.steps.filter((s) => s.tool === "import_file").length, 8);
assert.equal(plan.steps.filter((s) => s.tool === "AddWidget" && (s.arguments.widgetClass as { refPath: string }).refPath.endsWith(".SizeBox")).length, 3);
const vals = (st: PlanStep) => JSON.parse(st.arguments.values as string);
const afterSave = (name: string, key: string) => { const i = plan.steps.findIndex((x) => x.save === name); return plan.steps.slice(i + 1, i + 3).filter((x) => x.tool === "set_properties").map(vals).find((v) => key in v); };
assert.deepEqual(afterSave("Btn1Box", "heightOverride"), { heightOverride: 64, bOverride_HeightOverride: true });
assert.equal(afterSave("Btn1Box", "widthOverride"), undefined, "genişlik verilmediyse override yok");
// aynı widget sizeBox: true istenirse sarmalanır
assert.ok(unrealPlan(m.widget, (id) => assetsOf(m.designs).get(id), { sizeBox: true }).steps.some((x) => x.save === "SizeBox"));
console.log("screens ok");
