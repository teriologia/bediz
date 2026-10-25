import assert from "node:assert/strict";
import { BUTTON_STATES, barRecipe, buttonRecipe, skillBarRecipe, slotRecipe } from "./components.js";
import { THEME_NAMES, containerRecipe } from "./container.js";
import { compileDesign, expandLayers, type Design } from "./design.js";
import { layoutWidget } from "./layout.js";
import { assertCanHaveChild, assertPropsFit, type Node } from "./scene.js";
import type { Asset } from "./slice.js";
import { unrealPlan, type PlanStep } from "./unreal-plan.js";

const assetsOf = (ds: Design[]) => new Map<string, Asset>(ds.map((d) => [d.id, { id: d.id, path: `C:\art\${d.id}.png`, width: d.width, height: d.height, slice: d.slice, tile: d.kind === "tile" || undefined }]));
const vals = (s: PlanStep) => JSON.parse(s.arguments.values as string);
const after = (steps: PlanStep[], name: string, key: string) => {
  const i = steps.findIndex((s) => s.save === name);
  return steps.slice(i + 1, i + 3).filter((s) => s.tool === "set_properties").map(vals).find((v) => key in v);
};

// ---- buton ----
const b = buttonRecipe({ id: "play", label: "OYNA" });
assert.deepEqual(b.designs.map((d) => d.id), BUTTON_STATES.map((s) => `play_${s}`));
assert.equal(b.selected, undefined);
const bs = buttonRecipe({ id: "tab", selected: true });
assert.equal(bs.selected, "tab_selected");
assert.equal(bs.designs.length, 5);
compileDesign(bs.designs[4]);
assert.ok(b.designs.every((d) => d.kind === "frame9" && JSON.stringify(d.slice) === JSON.stringify(b.designs[0].slice)), "tüm durumların slice'ı aynı olmalı");
for (const d of b.designs) { compileDesign(d); assert.ok(expandLayers(d).length > 3); }
const btn = b.widget.root.children[0];
assert.equal(btn.type, "Button");
assert.equal(btn.brush!.asset, "play_normal");
assert.deepEqual(btn.states, { hovered: { asset: "play_hovered" }, pressed: { asset: "play_pressed" }, disabled: { asset: "play_disabled" } });
assert.equal(btn.children[0].text, "OYNA");
assert.equal(buttonRecipe({ id: "x", theme: "silver-slate" }).widget.root.children[0].children[0].color, "#cfd6df");
assert.equal(buttonRecipe({ id: "x", textColor: "#112233" }).widget.root.children[0].children[0].color, "#112233");
assert.throws(() => buttonRecipe({ id: "../x" }), /id/);
assert.throws(() => buttonRecipe({ id: "x", bogus: 1 } as never));

// ---- çubuk ----
const bar = barRecipe({ id: "hp", width: 300, height: 30, percent: 0.4 });
const [trough, fill] = bar.designs;
assert.deepEqual([trough.id, fill.id], ["hp_trough", "hp_fill"]);
assert.equal(bar.inset, 4);
assert.equal(fill.height, 30 - 2 * bar.inset, "dolgu, oluğun içine inset kadar boşlukla oturur");
const pb = bar.widget.root.children[0];
assert.equal(pb.type, "ProgressBar");
assert.equal(pb.percent, 0.4);
assert.deepEqual([pb.brush!.asset, pb.fill!.asset, pb.inset], ["hp_trough", "hp_fill", 4]);
assert.throws(() => barRecipe({ id: "x", percent: 1.5 }));
// özel dolgu rengi dolguya yansır
const fillColors = (d: Design) => JSON.stringify(d.layers.find((l) => l.id === "body"));
assert.notEqual(fillColors(barRecipe({ id: "x", fillColor: "#ff0000" }).designs[1]), fillColors(barRecipe({ id: "x", fillColor: "#0000ff" }).designs[1]));

// ---- slot ----
const sl = slotRecipe({ id: "inv", size: 72 });
assert.deepEqual(Object.values(sl.variants), ["inv_normal", "inv_selected"]);
assert.ok(sl.designs.every((d) => d.width === 72 && d.height === 72 && d.slice!.left < 36));

// ---- her tema derlenir ----
for (const theme of THEME_NAMES) for (const r of [buttonRecipe({ id: "t", theme }), barRecipe({ id: "t", theme }), slotRecipe({ id: "t", theme })]) {
  for (const d of r.designs) compileDesign(d);
}

// ---- sahne kuralları ----
const node = (type: Node["type"], children: Node[] = []): Node => ({ id: "n", type, children });
assert.throws(() => assertCanHaveChild(node("ProgressBar")), /child/);
assert.doesNotThrow(() => assertCanHaveChild(node("Button")));
assert.throws(() => assertCanHaveChild(node("Button", [node("TextBlock")])));
assert.throws(() => assertPropsFit("Image", { states: { hovered: { asset: "a" } } }), /Button/);
assert.throws(() => assertPropsFit("Button", { fill: { asset: "a" } }), /ProgressBar/);
assert.throws(() => assertPropsFit("TextBlock", { percent: 0.3 }), /ProgressBar/);
assert.doesNotThrow(() => assertPropsFit("Button", { brush: { asset: "a" }, states: { pressed: { asset: "b" } } }));
assert.doesNotThrow(() => assertPropsFit("ProgressBar", { brush: { asset: "a" }, fill: { asset: "b" }, percent: 1, inset: 2, size: { x: 10, y: 10 } }));

// ---- yerleşim: ProgressBar boyutu (size > asset > varsayılan), Button içeriği ortalanır ----
const L = layoutWidget(b.widget, (id) => ({ w: 52, h: 52 })[id as never] && { w: 52, h: 52 });
assert.deepEqual(L.get("Button"), { x: 0, y: 0, w: 200, h: 56 });
const label = L.get("Label")!;
assert.ok(Math.abs(label.x + label.w / 2 - 100) < 1 && Math.abs(label.y + label.h / 2 - 28) < 1, "etiket butonda ortalı");

// ---- UE planı: Button durumları ve ProgressBar stili ----
const bp = unrealPlan(b.widget, (id) => assetsOf(b.designs).get(id), { folder: "/Game/T/Btn" });
assert.deepEqual(bp.steps.filter((s) => s.tool === "AddWidget").map((s) => s.save), ["SizeBox", "Root", "Button", "Label"]);
assert.equal(bp.steps.filter((s) => s.tool === "import_file").length, 4);
const style = after(bp.steps, "Button", "widgetStyle").widgetStyle;
assert.deepEqual(Object.keys(style), ["normal", "hovered", "pressed", "disabled"]);
for (const k of Object.keys(style)) {
  assert.equal(style[k].drawAs, "Box");
  assert.deepEqual(style[k].tintColor.specifiedColor, { r: 1, g: 1, b: 1, a: 1 }, "gri varsayılan tint beyaza çekilmeli");
  assert.equal(style[k].resourceObject, `/Game/T/Btn/T_play_${k === "normal" ? "normal" : k}.T_play_${k === "normal" ? "normal" : k}`);
}
assert.equal(vals(bp.steps.find((s) => s.note === "Label: yerleşim")!).horizontalAlignment, "HAlign_Center");

const pp = unrealPlan(bar.widget, (id) => assetsOf(bar.designs).get(id), { folder: "/Game/T/Bar" });
const ps = after(pp.steps, "Bar", "widgetStyle");
assert.equal(ps.widgetStyle.backgroundImage.resourceObject, "/Game/T/Bar/T_hp_trough.T_hp_trough");
assert.equal(ps.widgetStyle.fillImage.resourceObject, "/Game/T/Bar/T_hp_fill.T_hp_fill");
assert.equal(ps.percent, 0.4);
assert.equal(ps.barFillStyle, "Scale");
assert.deepEqual(ps.borderPadding, { x: 4, y: 4 });
// durum asset'i eksikse net hata
assert.throws(() => unrealPlan(b.widget, (id) => (id === "play_pressed" ? undefined : assetsOf(b.designs).get(id))), /play_pressed/);
// yetenek çubuğu: 4 tuş, her slot için simge + tuş kapağı; soğuma yalnızca verilen slotta
const sb = skillBarRecipe({ id: "sk", cooldowns: [0, 0.5] });
const sbNodes = [...(function* w(n: Node): Generator<Node> { yield n; for (const c of n.children) yield* w(c); })(sb.widget.root)];
assert.equal(sbNodes.filter((n) => /^Key\d$/.test(n.id)).map((n) => n.text).join(""), "QWER");
assert.deepEqual(sbNodes.filter((n) => n.id.startsWith("Cooldown")).map((n) => n.id), ["Cooldown2"]);
for (const d of sb.designs) compileDesign(d);
// ghost stil: ince çizgi + cam yüzey, metal katmanları yok; 4 durum da derlenir
const gh = buttonRecipe({ id: "gh", label: "X", style: "ghost" });
for (const d of gh.designs) {
  compileDesign(d);
  assert.deepEqual(d.layers.map((l) => l.id), ["face", "line", "line2"]);
}
assert.ok(gh.designs.every((d) => d.layers[0].opacity! < 1));
// stil ailesi: ghost slot / çubuk / container metal katmanı içermez ve derlenir; ghost container varsayılan olarak ince (süs, mücevher yok)
for (const d of [...slotRecipe({ id: "gs", style: "ghost" }).designs, ...barRecipe({ id: "gb", style: "ghost" }).designs.slice(0, 1)]) {
  compileDesign(d);
  assert.ok(!d.layers.some((l) => "fill" in l && l.fill?.kind === "material"), `${d.id}: ghost'ta material olmamalı`);
}
const gc = containerRecipe({ id: "gc", style: "ghost" });
assert.ok(!gc.gem && gc.resolved.thickness === 16 && gc.frame.layers.every((l) => !("fill" in l && l.fill?.kind === "material")));
assert.equal(containerRecipe({ id: "gc2", style: "ghost", thickness: 30 }).resolved.thickness, 30);
console.log("components ok");
