import assert from "node:assert/strict";
import { DesignSchema, compileDesign, shade } from "./design.js";

const frame = DesignSchema.parse({
  id: "f", kind: "frame9", width: 128, height: 128, slice: { left: 24, top: 24, right: 24, bottom: 24 },
  layers: [
    { id: "ring", kind: "ring", inset: 0, thickness: 20, radius: 12, fill: { kind: "texture", preset: "gold" }, effects: [{ kind: "bevel" }] },
    { id: "g", kind: "gem", cx: 64, cy: 10, size: 24, color: "#2fb5c9" },
  ],
});
const svg = compileDesign(frame);
assert.match(svg, /fill-rule="evenodd"/);          // halka = delikli yol
assert.match(svg, /<filter id="f_ring"[^>]*userSpaceOnUse/);
assert.match(svg, /stitchTiles="stitch"/);
assert.ok(!/<g[^>]*transform/.test(svg));          // dönüşüm yok: filtre kırpılma tuzağı kapalı
assert.equal(compileDesign(frame), svg);           // deterministik

// doğrulamalar
assert.throws(() => DesignSchema.parse({ id: "x", kind: "frame9", width: 64, height: 64, layers: [] }), /slice/);
assert.throws(() => DesignSchema.parse({ id: "x", kind: "tile", width: 64, height: 64, slice: { left: 1, top: 1, right: 1, bottom: 1 }, layers: [] }));
assert.throws(() => DesignSchema.parse({ id: "x", kind: "sprite", width: 64, height: 64, layers: [{ id: "a", kind: "box", fill: { kind: "solid", color: "red" } }] }));
assert.throws(() => DesignSchema.parse({ id: "x", kind: "sprite", width: 64, height: 64, layers: [{ id: "a", kind: "box", bogus: 1 }] }));
assert.throws(() => DesignSchema.parse({ id: "x", kind: "sprite", width: 64, height: 64, layers: [{ id: "a", kind: "box" }, { id: "a", kind: "box" }] }), /benzersiz/);
assert.throws(() => compileDesign(DesignSchema.parse({ id: "x", kind: "sprite", width: 32, height: 32, layers: [{ id: "r", kind: "ring", thickness: 20 }] })), /sığmıyor/);
assert.equal(shade("#808080", 1), "#ffffff");
assert.equal(shade("#808080", -1), "#000000");
console.log("design ok");
