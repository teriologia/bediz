import assert from "node:assert/strict";
import { compileDesign } from "./design.js";
import { sliderRecipe, tabsRecipe, toggleRecipe, uiKitRecipe } from "./kit.js";
import { THEME_NAMES } from "./container.js";
import { walk } from "./scene.js";

// toggle: iki sabit boyutlu varyant, ghost'ta metal katman yok
for (const style of ["metal", "ghost"] as const) {
  const t = toggleRecipe({ id: "tg", style });
  assert.deepEqual(t.designs.map((d) => d.id), ["tg_off", "tg_on"]);
  t.designs.forEach(compileDesign);
  if (style === "ghost") assert.ok(t.designs.every((d) => d.layers.every((l) => !("fill" in l && l.fill?.kind === "material"))));
}

// slider: başlık değerle orantılı konumlanır (value 0 < 1), widget yüksekliği başlığı kapsar
const s0 = sliderRecipe({ id: "sl", value: 0 }), s1 = sliderRecipe({ id: "sl", value: 1 });
const left = (r: typeof s0) => [...walk(r.widget.root)].find((e) => e.node.id === "Thumb")!.node.slot!.offsets!.left;
assert.ok(left(s1) - left(s0) > 200, "başlık değere göre kaymalı");
assert.ok(s0.widget.height >= 26);
s0.designs.forEach(compileDesign);

// sekmeler: yalnızca seçili sekme selected brush'ı kullanır; geçersiz indeks hata verir
const tb = tabsRecipe({ id: "tb", labels: ["A", "B", "C"], selected: 1 });
const brushOf = (n: number) => [...walk(tb.widget.root)].find((e) => e.node.id === `Button${n}`)!.node.brush!.asset;
assert.equal(brushOf(2), "tb_tab_selected");
assert.equal(brushOf(1), "tb_tab_normal");
assert.throws(() => tabsRecipe({ id: "x", labels: ["A", "B"], selected: 2 }), /sekme sayısından/);
tb.designs.forEach(compileDesign);

// kit: her temada 7 bileşen, tasarım id'leri bileşenler arasında çakışmaz, aynı metal belirteci
for (const theme of THEME_NAMES) for (const style of ["metal", "ghost"] as const) {
  const kit = uiKitRecipe({ id: "kit", theme, style });
  assert.deepEqual(Object.keys(kit.components), ["panel", "button", "tabs", "bar", "slot", "toggle", "slider"]);
  const ids = Object.values(kit.components).flatMap((c) => c.designs.map((d) => d.id));
  assert.equal(new Set(ids).size, ids.length, `${theme}/${style}: tasarım id çakışması`);
  Object.values(kit.components).forEach((c) => c.designs.forEach(compileDesign));
}
console.log("kit ok");
