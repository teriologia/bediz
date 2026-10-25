import assert from "node:assert/strict";
import { buttonRecipe } from "./components.js";
import { containerRecipe, registerPalette, rampOf, lineOf, ThemeSchema } from "./container.js";
import { compileDesign, type Layer } from "./design.js";
import { uiKitRecipe } from "./kit.js";
import { mainMenuRecipe } from "./screens.js";

// serbest palet: tema adı olarak kullanılır; yerleşik ad ve geçersiz renk reddedilir; bilinmeyen tema reddedilir
const base = { name: "test-violet", surface: "#2a1a4a", accent: "#2fe0d0", metal: "#8f6bd8", text: "#e9ddff" };
assert.throws(() => ThemeSchema.parse("test-violet"), /bilinmeyen tema/);
assert.equal(registerPalette(base), "test-violet");
assert.equal(ThemeSchema.parse("test-violet"), "test-violet");
assert.throws(() => registerPalette({ ...base, name: "gold-stone" }), /yerleşik/);
assert.throws(() => registerPalette({ ...base, name: "x", metal: "purple" } as never));

// metal malzeme rampası palet renginden gelir (açık uç metal tonundan açık, koyu uç koyu); yerleşik temada colors yok
assert.equal(rampOf("test-violet").colors!.length, 5);
assert.deepEqual(rampOf("gold-stone"), {});
const hasRamp = (layers: Layer[]) => layers.some((l) => "fill" in l && l.fill?.kind === "material" && l.fill.colors?.length === 5);
const b = buttonRecipe({ id: "pb", theme: "test-violet" });
assert.ok(b.designs.every((d) => d.id.endsWith("disabled") || hasRamp(d.layers)), "buton rimi palet rampasını kullanmalı");
const c = containerRecipe({ id: "pc", theme: "test-violet" });
assert.ok(hasRamp(c.frame.layers) && hasRamp(c.bg.layers), "container metal + zemin rampası");
assert.equal(c.resolved.gemColor, "#2fe0d0");
const gem = c.gem!.layers[0] as Extract<Layer, { kind: "gem" }>;
assert.equal(gem.settingColors!.length, 5, "mücevher yuvası palet metalinde");
assert.notEqual(lineOf("test-violet"), lineOf("gold-stone"));

// kit ve ekran özel temayla derlenir; çubuk dolgusu accent'ten
for (const style of ["metal", "ghost"] as const) {
  const kit = uiKitRecipe({ id: "pk", theme: "test-violet", style });
  Object.values(kit.components).forEach((r) => r.designs.forEach(compileDesign));
  assert.equal(kit.tokens.fill, "#2fe0d0");
}
mainMenuRecipe({ id: "pm", theme: "test-violet" }).designs.forEach(compileDesign);

// yerleşik temalar etkilenmez (golden testleri de bunu doğrular); çizim deterministik
assert.deepEqual(buttonRecipe({ id: "gb", theme: "gold-stone" }).designs, buttonRecipe({ id: "gb", theme: "gold-stone" }).designs);
console.log("palette ok");
