import assert from "node:assert/strict";
import { DesignSchema, compileDesign, expandLayers, shade } from "./design.js";

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
// köşe süsü: 4 köşe × (2 bıçak + diken + kabartma) = 16 çokgen; sağ köşeler sol köşelerin aynası
const cd = DesignSchema.parse({ id: "c", kind: "frame9", width: 200, height: 160, slice: { left: 60, top: 60, right: 60, bottom: 60 },
  layers: [{ id: "k", kind: "corners", style: "blade", size: 50, inset: 2, fill: { kind: "solid", color: "#c9a227" } }] });
const sh = expandLayers(cd);
assert.equal(sh.length, 16);
const pt = (id: string) => (sh.find((l) => l.id === id) as { points: [number, number][] }).points[0];
assert.equal(pt("k__tl_horn_a")[0] + pt("k__tr_horn_a")[0], 200);
assert.equal(pt("k__tl_horn_a")[1] + pt("k__bl_horn_a")[1], 160);
assert.equal(expandLayers(DesignSchema.parse({ ...cd, layers: [{ ...cd.layers[0], which: ["tl"], studs: false }] })).length, 3);
compileDesign(cd);
// çizgi: açık uçlu (Z yok), stroke zorunlu; çatlak üretici deterministik ve seed'e duyarlı
const ld = DesignSchema.parse({ id: "l", kind: "sprite", width: 64, height: 64, layers: [{ id: "a", kind: "line", points: [[4, 4], [30, 20], [50, 8]], stroke: { color: "#000000", width: 2 } }] });
const lsvg = compileDesign(ld);
assert.match(lsvg, /stroke-linecap="round"/);
assert.ok(!/ Z"/.test(lsvg.match(/<path d="[^"]*"/)![0]), "açık uçlu çizgi kapanmamalı");
assert.throws(() => compileDesign(DesignSchema.parse({ id: "l", kind: "sprite", width: 64, height: 64, layers: [{ id: "a", kind: "line", points: [[0, 0], [9, 9]] }] })), /stroke gerekli/);
const crk = (seed: number, extra = {}) => DesignSchema.parse({ id: "k", kind: "sprite", width: 128, height: 128,
  layers: [{ id: "c", kind: "cracks", x: 10, y: 10, w: 100, h: 100, count: 3, seed, ...extra }] });
const pts = (d: ReturnType<typeof crk>) => JSON.stringify(expandLayers(d).map((l) => (l as { points: unknown }).points));
assert.equal(pts(crk(1)), pts(crk(1)));
assert.notEqual(pts(crk(1)), pts(crk(2)));
assert.ok(expandLayers(crk(1)).length >= 6, "her çatlak: iz + parlak kenar");
assert.equal(expandLayers(crk(1, { highlight: false })).length * 2 <= expandLayers(crk(1)).length + 1, true);
// yön verilince çatlaklar o eksende ilerler (yatay: x değişimi y değişiminden büyük)
const horiz = expandLayers(crk(3, { direction: 0, spread: 0.4, highlight: false })).filter((l) => /__\d+_0$/.test(l.id)) as { points: [number, number][] }[];
assert.ok(horiz.length === 3 && horiz.every((l) => Math.abs(l.points.at(-1)![0] - l.points[0][0]) > Math.abs(l.points.at(-1)![1] - l.points[0][1])));
assert.equal(shade("#808080", 1), "#ffffff");
assert.equal(shade("#808080", -1), "#000000");
console.log("design ok");
