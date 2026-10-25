import assert from "node:assert/strict";
import { buttonRecipe } from "./components.js";
import { DesignSchema, expandLayers, compileDesign, MOTIFS } from "./design.js";
import { SILHOUETTES, silhouettePath } from "./shapes.js";

// silüet yolları: M ile başlar, her alt yol Z ile kapanır, tüm koordinatlar tuvalin içinde; winged üç parça (iki kanat + gövde)
const W = 360, H = 96;
for (const s of SILHOUETTES) {
  const d = silhouettePath(s, W, H, 34, 8);
  assert.match(d, /^M/);
  const subs = d.trim().split("Z").filter(Boolean);
  assert.equal(subs.length, s === "winged" ? 3 : 1, `${s}: alt yol sayısı`);
  for (const [x, y] of [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]])) assert.ok(x >= 0 && x <= W && y >= 0 && y <= H, `${s}: (${x},${y}) tuval dışı`);
  DesignSchema.parse({ id: "s", kind: "sprite", width: W, height: H, layers: [{ id: "b", kind: "band", d, from: 0, fill: { kind: "solid", color: "#ffffff" } }] });
}
// simetri: yatay aynada yol noktaları kümesi aynı (rect/notched/hex/swallow/winged; arrow bilerek asimetrik)
for (const s of SILHOUETTES.filter((x) => x !== "arrow")) {
  const pts = [...silhouettePath(s, W, H, 34, 8).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => `${(+m[1]).toFixed(1)},${(+m[2]).toFixed(1)}`);
  const mirrored = [...silhouettePath(s, W, H, 34, 8).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => `${(W - +m[1]).toFixed(1)},${(+m[2]).toFixed(1)}`);
  assert.deepEqual([...pts].sort(), [...mirrored].sort(), `${s}: simetrik değil`);
}
assert.throws(() => DesignSchema.parse({ id: "x", kind: "sprite", width: 64, height: 64, layers: [{ id: "b", kind: "band", d: 'L0,0 "', from: 0 }] }));

// silüetli buton: dört (+selected) durum, band katmanları, canvas yüksekliği = buton yüksekliği, uçlar sabit slice
for (const shape of SILHOUETTES.filter((x) => x !== "rect")) for (const style of ["metal", "ghost"] as const) {
  const b = buttonRecipe({ id: "sb", shape, style, height: 60, selected: true });
  assert.equal(b.designs.length, 5);
  for (const d of b.designs) {
    assert.equal(d.height, 60);
    assert.ok(d.layers.every((l) => l.kind === "band") && d.layers.some((l) => l.id === "face"), `${shape}/${style}: bant yığını`);
    assert.ok(d.slice!.left >= 8 + Math.round(60 * 0.62) && d.slice!.left === d.slice!.right);
    compileDesign(d);
  }
}
assert.equal(buttonRecipe({ id: "sr", shape: "rect" }).designs[0].layers.some((l) => l.kind === "band"), false, "rect eski kutu yolunu kullanır");

// motif: parça sayıları, mirror simetrisi (x → W−x), stil sabitleri
const md = (style: string, mirror?: boolean) => DesignSchema.parse({ id: "m", kind: "sprite", width: 200, height: 100, layers: [{ id: "k", kind: "motif", style, cx: 60, cy: 50, size: 40, mirror, fill: { kind: "solid", color: "#ffffff" } }] });
for (const style of MOTIFS) {
  const one = expandLayers(md(style)), two = expandLayers(md(style, true));
  assert.equal(two.length, one.length * 2, `${style}: mirror iki katı`);
}
const ch = expandLayers(md("chevrons", true)).filter((l) => l.kind === "polygon") as { points: [number, number][] }[];
assert.equal(ch.length, 4);
const xs = (l: { points: [number, number][] }) => l.points.map((p) => p[0]).sort((a, b) => a - b);
assert.deepEqual(xs(ch[1]).map((x) => +(200 - x).toFixed(3)).sort((a, b) => a - b), xs(ch[0]).map((x) => +x.toFixed(3)), "ayna x → W−x");
assert.throws(() => DesignSchema.parse({ id: "m", kind: "sprite", width: 64, height: 64, layers: [{ id: "k", kind: "motif", style: "nope", cx: 1, cy: 1, size: 5 }] }));
console.log("shapes ok");
