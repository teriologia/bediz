import assert from "node:assert/strict";
import { containerRecipe, THEME_NAMES } from "./container.js";
import { compileDesign, expandLayers } from "./design.js";
import { layoutWidget } from "./layout.js";

// varsayılan tarif: geçerli, deterministik, slice süsü kapsıyor
const a = containerRecipe({ id: "p" });
assert.deepEqual(a, containerRecipe({ id: "p" }));
assert.equal(a.theme, "gold-stone");
const m = a.frame.slice!.left;
assert.ok(m >= a.resolved.cornerSize + 2, "slice marjı süsü kapsamalı (yoksa gerilir)");
assert.equal(a.frame.width, 2 * m + 96);
assert.equal(a.widget.root.children.map((c) => c.id).join(), "Background,Shade,Frame,Gem");
// shade:false derinlik katmanını kaldırır; dim zemin tasarımına karartma katmanı ekler (0 ise eklemez)
const ns = containerRecipe({ id: "ns", shade: false, dim: 0 });
assert.equal(ns.widget.root.children.map((c) => c.id).join(), "Background,Frame,Gem");
assert.equal(ns.shade, undefined);
assert.deepEqual(ns.bg.layers.map((l) => l.id), ["ground"]);
assert.deepEqual(a.bg.layers.map((l) => l.id), ["ground", "dim"]);
assert.equal(a.gem!.width, Math.round(a.resolved.gemSize * 2.2));

// tema + açık parametre: açık olan kazanır, tema varsayılanı ezer
const w = containerRecipe({ id: "p", theme: "bronze-wood" });
assert.equal(w.resolved.frame, "bronze");
assert.equal(w.resolved.chamfer, false);
assert.equal(w.resolved.cornerStyle, "scroll");
const o = containerRecipe({ id: "p", theme: "bronze-wood", frame: "silver", chamfer: true });
assert.equal(o.resolved.frame, "silver");
assert.equal(o.resolved.chamfer, true);
assert.equal(o.resolved.gemShape, "hex", "tema, açıkça verilmeyen alanları korur");

// pah kapalıyken halkalarda chamfer değil radius, açıkken tersi
const ring = (r: ReturnType<typeof containerRecipe>) => r.frame.layers.find((l) => l.id === "gold_outer") as { chamfer?: number; radius?: number };
assert.ok(ring(a).chamfer! > 0 && ring(a).radius === undefined);
assert.ok(ring(w).radius! > 0 && ring(w).chamfer === undefined);

// seçenekler: mücevhersiz, süssüz, çatlaksız
const bare = containerRecipe({ id: "q", gem: false, ornaments: false, cracks: false });
assert.equal(bare.gem, undefined);
assert.ok(!bare.widget.root.children.some((c) => c.id === "Gem"));
assert.ok(!bare.frame.layers.some((l) => l.kind === "corners" || l.kind === "cracks"));
assert.equal(bare.frame.slice!.left, bare.resolved.thickness + 14, "süs yoksa marj sadece kalınlığa göre");

// her tema ve süs stili derlenir, katmanlar açılır, widget yerleşimi tuvale sığar
for (const theme of THEME_NAMES) for (const cornerStyle of ["blade", "scroll", "claw"] as const) {
  const r = containerRecipe({ id: "t", theme, cornerStyle });
  for (const d of [r.bg, r.frame, r.gem!]) { compileDesign(d); assert.ok(expandLayers(d).length > 0); }
  const L = layoutWidget(r.widget, (id) => ({ w: 100, h: 100 })[id as never] && { w: 100, h: 100 });
  const f = L.get("Frame")!;
  assert.ok(f.w === r.widget.width && f.y + f.h === r.widget.height, `${theme}: çerçeve widget'ı doldurmalı`);
}
// geçersiz girdi
assert.throws(() => containerRecipe({ id: "../x" }), /id/);
assert.throws(() => containerRecipe({ id: "x", bogus: 1 } as never));
console.log("container ok");
