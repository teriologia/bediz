import assert from "node:assert/strict";
import { DesignSchema, expandLayers, REPEATS, compileDesign } from "./design.js";

// repeat: çizgi boyunca her step'te bir öğe; tüm öğeler tek yol katmanına birleşir (malzeme dolgusunda tek geçiş)
const rp = (extra: object) => expandLayers(DesignSchema.parse({ id: "r", kind: "sprite", width: 200, height: 100, layers: [
  { id: "x", kind: "repeat", style: "diamond", points: [[10, 50], [110, 50]], step: 20, size: 8, fill: { kind: "solid", color: "#ffffff" }, ...extra }] }));
const items = (extra: object) => ((rp(extra)[0] as unknown as { d: string }).d.match(/M/g) ?? []).length;

assert.equal(rp({}).length, 1, "tek yol katmanı");
assert.equal(items({}), 6, "100 px çizgi, step 20 → 0,20,...,100 = 6 öğe");
assert.equal(items({ margin: 30 }), 4, "margin 30 → 30,50,70,90");
assert.equal(items({ points: [[10, 50], [60, 50], [60, 100]] }), 6, "köşeli çizgi: 50 + 50 = 100 px → 6 öğe");
const bent = (rp({ points: [[10, 50], [60, 50], [60, 100]] })[0] as unknown as { d: string }).d;
assert.ok([...bent.matchAll(/,(-?[\d.]+)/g)].some((m) => +m[1] > 90), "ikinci parçada (aşağıda) öğeler olmalı");
assert.equal(items({ step: 3, size: 2, points: [[0, 0], [1000, 0]] }), 334, "1000 px, step 3 → 334 öğe (üst sınırın altında)");
assert.ok(items({ step: 3, size: 2, points: [[0, 0], [5000, 0]] }) <= 600, "öğe sayısı üst sınırı 600");

// çizgi yönüne döner: dikey çizgide elmasın (uzun ekseni çizgi yönünde) x yayılımı dar, y yayılımı geniş; rotate:false sabit kalır
const spread = (pts: [number, number][], rotate?: boolean) => {
  const d = (rp({ points: pts, margin: 0, step: 1000, rotate })[0] as unknown as { d: string }).d;
  const xy = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  return [Math.max(...xy.map((p) => p[0])) - Math.min(...xy.map((p) => p[0])), Math.max(...xy.map((p) => p[1])) - Math.min(...xy.map((p) => p[1]))];
};
const [vx, vy] = spread([[50, 10], [50, 60]]);
assert.ok(vy > vx, `dikey çizgide elmas dikey uzar: ${vx} x ${vy}`);
const [fx, fy] = spread([[50, 10], [50, 60]], false);
assert.ok(fx > fy, `rotate:false → yatay kalır: ${fx} x ${fy}`);

// her stil derlenir; geçersiz stil ve çok kısa adım reddedilir
for (const style of REPEATS) compileDesign(DesignSchema.parse({ id: "s", kind: "sprite", width: 100, height: 40, layers: [{ id: "x", kind: "repeat", style, points: [[5, 20], [95, 20]], step: 12, size: 8, fill: { kind: "solid", color: "#ffffff" } }] }));
assert.throws(() => DesignSchema.parse({ id: "s", kind: "sprite", width: 100, height: 40, layers: [{ id: "x", kind: "repeat", style: "nope", points: [[0, 0], [9, 9]], step: 12, size: 8 }] }));
assert.throws(() => DesignSchema.parse({ id: "s", kind: "sprite", width: 100, height: 40, layers: [{ id: "x", kind: "repeat", style: "stud", points: [[0, 0], [9, 9]], step: 1, size: 8 }] }));
// brush: tek yol; uçlar sivri (taper), orta tam kalınlık; taper:0 künt uç
const br = (extra: object) => expandLayers(DesignSchema.parse({ id: "b", kind: "sprite", width: 200, height: 100, layers: [
  { id: "s", kind: "brush", points: [[10, 50], [100, 50], [190, 50]], width: 20, fill: { kind: "solid", color: "#ffffff" }, ...extra }] }));
const ys = (extra: object) => [...(br(extra)[0] as unknown as { d: string }).d.matchAll(/,(-?[\d.]+)/g)].map((m) => +m[1]);
assert.equal(br({}).length, 1, "fırça tek yol katmanı");
const mid = ys({}), span = Math.max(...mid) - Math.min(...mid);
assert.ok(span > 19 && span < 21, `orta kalınlık ~20: ${span}`);
const tip = (extra: object) => { const d = (br(extra)[0] as unknown as { d: string }).d, first = d.match(/^M(-?[\d.]+),(-?[\d.]+) L(-?[\d.]+),/)!; return Math.abs(+first[2] - 50); };
assert.ok(tip({}) < 1, "taper: uç sivri");
assert.ok(tip({ taper: 0 }) > 9, "taper 0: künt uç");
assert.throws(() => DesignSchema.parse({ id: "b", kind: "sprite", width: 9, height: 9, layers: [{ id: "s", kind: "brush", points: [[0, 0]], width: 4 }] }));
console.log("repeat ok");
