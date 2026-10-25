import assert from "node:assert/strict";
import { compileDesign } from "./design.js";
import { dropdownRecipe, inputRecipe, scrollbarRecipe, tooltipRecipe } from "./fields.js";
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

// yeni alan bileşenleri
const inp = inputRecipe({ id: "in", placeholder: "x" });
assert.deepEqual(inp.designs.map((d) => d.id), ["in_normal", "in_focused", "in_disabled"]);
const dd = dropdownRecipe({ id: "dd", options: ["A", "B", "C"], selected: 1 });
const ddn = [...walk(dd.widget.root)].map((e) => e.node.id);
assert.ok(ddn.includes("Option3Box") && ddn.includes("RowHighlight"));
const ddc = dropdownRecipe({ id: "ddc", open: false });
assert.ok(![...walk(ddc.widget.root)].some((e) => e.node.id === "List") && ddc.widget.height < dd.widget.height);
assert.throws(() => dropdownRecipe({ id: "x", options: ["A"] }));
const sb = scrollbarRecipe({ id: "sb", start: 0.5, size: 0.9 });
const thumbN = [...walk(sb.widget.root)].find((e) => e.node.id === "Thumb")!.node;
assert.ok(thumbN.slot!.offsets!.top + thumbN.slot!.offsets!.bottom <= sb.widget.height, "başlık oluktan taşmamalı");
const tp = tooltipRecipe({ id: "tp", title: "T", body: "uzun uzun bir açıklama metni burada yer alıyor ve satıra sarılmalı" });
assert.ok([...walk(tp.widget.root)].filter((e) => /^Line\d+$/.test(e.node.id)).length >= 2, "gövde sarılmalı");
[inp, dd, ddc, sb, tp].forEach((r) => r.designs.forEach(compileDesign));

// kit: her temada bileşenler, tasarım id'leri bileşenler arasında çakışmaz, aynı metal belirteci
for (const theme of THEME_NAMES) for (const style of ["metal", "ghost"] as const) {
  const kit = uiKitRecipe({ id: "kit", theme, style });
  assert.deepEqual(Object.keys(kit.components), ["panel", "button", "tabs", "bar", "slot", "toggle", "slider", "input", "dropdown", "scrollbar", "tooltip"]);
  const ids = Object.values(kit.components).flatMap((c) => c.designs.map((d) => d.id));
  assert.equal(new Set(ids).size, ids.length, `${theme}/${style}: tasarım id çakışması`);
  Object.values(kit.components).forEach((c) => c.designs.forEach(compileDesign));
}
console.log("kit ok");
