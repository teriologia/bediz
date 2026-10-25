import assert from "node:assert/strict";
import { boxBlur, shadeMaterial } from "./material.js";

const ones = (w: number, h: number) => new Float32Array(w * h).fill(1);
const lum = (d: Uint8Array, x: number, y: number, w: number) => { const o = (y * w + x) * 4; return (d[o] + d[o + 1] + d[o + 2]) / 3; };

// determinizm
const a = shadeMaterial({ w: 64, h: 64, mask: ones(64, 64), fill: { preset: "stone", seed: 3 }, tileable: true });
const b = shadeMaterial({ w: 64, h: 64, mask: ones(64, 64), fill: { preset: "stone", seed: 3 }, tileable: true });
assert.deepEqual(a, b);
assert.notDeepEqual(a, shadeMaterial({ w: 64, h: 64, mask: ones(64, 64), fill: { preset: "stone", seed: 4 }, tileable: true }));

// dikişsizlik: sarma komşuluğu (N-1,0), iç komşu çiftlerinin %90 diliminden belirgin büyük olmamalı
// (tek çifte bakmak keskin harç çizgilerinde gürültülü; 2x2 döşeme görsel olarak da doğrulandı)
for (const [preset, pattern] of [["stone", "flagstone"], ["stone", "blocks"], ["slate", "flagstone"], ["gold", undefined], ["wood", undefined]] as const) {
  const N = 128, t = shadeMaterial({ w: N, h: N, mask: ones(N, N), fill: { preset, pattern, seed: 2 }, tileable: true });
  const col = (x1: number, x2: number) => { let s = 0; for (let y = 0; y < N; y++) s += Math.abs(lum(t, x1, y, N) - lum(t, x2, y, N)); return s / N; };
  const row = (y1: number, y2: number) => { let s = 0; for (let x = 0; x < N; x++) s += Math.abs(lum(t, x, y1, N) - lum(t, x, y2, N)); return s / N; };
  const p90 = (f: (i: number, j: number) => number) => {
    const v = Array.from({ length: N - 1 }, (_, i) => f(i, i + 1)).sort((x, y) => x - y);
    return v[Math.floor(v.length * 0.9)];
  };
  assert.ok(col(N - 1, 0) <= p90(col) * 1.3 + 2, `${preset}/${pattern}: x dikişi ${col(N - 1, 0).toFixed(1)} p90 ${p90(col).toFixed(1)}`);
  assert.ok(row(N - 1, 0) <= p90(row) * 1.3 + 2, `${preset}/${pattern}: y dikişi ${row(N - 1, 0).toFixed(1)} p90 ${p90(row).toFixed(1)}`);
}
// boxBlur sarması: x=0'daki dürtü karşı kenara da taşmalı
const imp = new Float32Array(16 * 16);
imp[0] = 1;
assert.ok(boxBlur(imp, 16, 16, 2, true)[15] > 0 && boxBlur(imp, 16, 16, 2, false)[15] === 0);

// bevel yönü: ışık sol üstten (315°) → üst kenar şeridi, alt kenar şeridinden parlak
const W = 96, mask = new Float32Array(W * W);
for (let y = 16; y < 80; y++) for (let x = 16; x < 80; x++) mask[y * W + x] = 1;
const m = shadeMaterial({ w: W, h: W, mask, fill: { preset: "gold", seed: 1 }, bevel: { depth: 6, size: 8 } });
const band = (y: number) => { let s = 0; for (let x = 30; x < 66; x++) s += lum(m, x, y, W); return s / 36; };
assert.ok(band(18) > band(77) + 15, `bevel: üst ${band(18).toFixed(0)} alt ${band(77).toFixed(0)}`);
assert.equal(m[(48 * W + 48) * 4 + 3], 255);
assert.equal(m[3], 0); // maske dışı saydam

// aşınma: deterministik, alfa değişmez, kenarda ve oyuklarda rengi değiştirir; wear=0 ile aynı çıktıyı vermez
const wm = (wear: number) => shadeMaterial({ w: W, h: W, mask, fill: { preset: "gold", seed: 1, wear }, bevel: { depth: 6, size: 8 } });
assert.deepEqual(wm(0.6), wm(0.6));
assert.notDeepEqual(wm(0.6), wm(0));
assert.deepEqual(wm(0), m);
assert.equal(wm(0.6)[(48 * W + 48) * 4 + 3], 255);

// taş: gerçekten desenli (düz renk değil)
let mean = 0;
for (let i = 0; i < 64 * 64; i++) mean += lum(a, i % 64, (i / 64) | 0, 64);
mean /= 4096;
let varr = 0;
for (let i = 0; i < 64 * 64; i++) varr += (lum(a, i % 64, (i / 64) | 0, 64) - mean) ** 2;
assert.ok(Math.sqrt(varr / 4096) > 8, "taş dokusu düz");

// hız: 256² tile < 1.5 sn
const t0 = Date.now();
shadeMaterial({ w: 256, h: 256, mask: ones(256, 256), fill: { preset: "stone" }, tileable: true });
assert.ok(Date.now() - t0 < 1500, `yavaş: ${Date.now() - t0}ms`);
console.log("material ok");
