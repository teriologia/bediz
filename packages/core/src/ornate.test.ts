import assert from "node:assert/strict";
import { compileDesign, expandLayers } from "./design.js";
import { registerPalette, rampOf } from "./container.js";
import { ornateFrameRecipe } from "./ornate.js";

const r = ornateFrameRecipe({ id: "of" });
const d = r.designs[0];
assert.deepEqual([d.width, d.height, d.symmetry, d.kind], [1280, 720, "xy", "sprite"]);
const ids = d.layers.map((l) => l.id);
for (const want of ["outline", "iron", "groove", "inlay", "thorns_top", "thorns_left", "corner_up", "corner_gem", "mid_spire", "mid_gem"]) assert.ok(ids.includes(want), `katman yok: ${want}`);
compileDesign(d);

// iç alan: marj (spire+14) + kalınlık + 12; çerçeve içinde ve simetrik
const M = 78 + 14, T = 30;
assert.deepEqual(r.inner, { left: M + T + 12, top: M + T + 12, right: 1280 - M - T - 12, bottom: 720 - M - T - 12 });

// seçenekler: thorns/midFinials kapanır, metalColors demire uygulanır, çok küçük çerçeve hata verir, simetri tek çeyrek yazar (köşe kulesi sol-üstte)
const ids2 = ornateFrameRecipe({ id: "o2", thorns: false, midFinials: false, inlay: false }).designs[0].layers.map((l) => l.id);
assert.ok(!ids2.some((i) => i.startsWith("thorns") || i.startsWith("mid_") || i === "inlay"));
const iron = ornateFrameRecipe({ id: "o3", metalColors: ["#101010", "#ffcc00"] }).designs[0].layers.find((l) => l.id === "iron") as { fill: { colors: string[] } };
assert.deepEqual(iron.fill.colors, ["#101010", "#ffcc00"]);
assert.throws(() => ornateFrameRecipe({ id: "o4", width: 500, height: 400, spire: 140, thickness: 60 }), /çok küçük/);
const cornerUp = d.layers.find((l) => l.id === "corner_up") as { points: [number, number][] };
assert.ok(cornerUp.points.every(([x, y]) => x < 640 && y < 360), "kule sol-üst çeyrekte çizilir; sağ/alt aynalanır");

// özel palet: demir rampası ve vurgu paletten gelir
registerPalette({ name: "orn-test", surface: "#201030", accent: "#33ddcc", metal: "#8a60d0", text: "#eeeeff" });
const pd = ornateFrameRecipe({ id: "o5", theme: "orn-test" }).designs[0];
assert.deepEqual((pd.layers.find((l) => l.id === "iron") as { fill: { colors: string[] } }).fill.colors, rampOf("orn-test").colors);
assert.equal((pd.layers.find((l) => l.id === "corner_gem") as { color: string }).color, "#33ddcc");
// motif/repeat açılımı hata vermez, thorn tek yola birleşir
assert.ok(expandLayers(d).some((l) => l.id === "thorns_top__items"));
console.log("ornate ok");
