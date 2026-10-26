import assert from "node:assert/strict";
import { DesignSchema, compileDesign } from "./design.js";
import { SCENE_RECIPES } from "./scene-recipes.js";

// her tarif kendi başına geçerli bir 1280×720 tasarım olmalı (dokümandaki örnekler çürümesin)
for (const [name, r] of Object.entries(SCENE_RECIPES)) {
  const d = DesignSchema.parse({ id: name, kind: "sprite", width: 1280, height: 720, layers: r.layers });
  compileDesign(d);
  assert.ok(r.about.length > 20, `${name}: açıklama`);
}
assert.ok(Object.keys(SCENE_RECIPES).length >= 6);
console.log("scene-recipes ok");
