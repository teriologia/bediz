import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DesignSchema } from "@bediz/core";
import { renderDesignPng } from "./design-render.js";
import { renderNineSlice, tileTo } from "./render.js";

// 30x30 kaynak: 10px kenarlı 3x3 ızgara, her bölge ayrı renk (R = sütun, G = satır).
const raw = Buffer.alloc(30 * 30 * 4);
for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
  raw.set([Math.floor(x / 10) * 100, Math.floor(y / 10) * 100, 0, 255], (y * 30 + x) * 4);
}
const path = join(mkdtempSync(join(tmpdir(), "bediz-")), "t.png");
writeFileSync(path, await sharp(raw, { raw: { width: 30, height: 30, channels: 4 } }).png().toBuffer());

const a = { id: "t", path, width: 30, height: 30, slice: { left: 10, top: 10, right: 10, bottom: 10 } };
const out = await sharp(await renderNineSlice(a, 100, 80)).raw().toBuffer({ resolveWithObject: true });
assert.deepEqual([out.info.width, out.info.height], [100, 80]);
const px = (x: number, y: number) => [...out.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 2)];
assert.deepEqual(px(2, 2), [0, 0]);       // sol üst köşe
assert.deepEqual(px(97, 77), [200, 200]); // sağ alt köşe
assert.deepEqual(px(50, 40), [100, 100]); // merkez uzamış
assert.deepEqual(px(50, 2), [100, 0]);    // üst kenar
await assert.rejects(renderNineSlice(a, 15, 80));
// döşeme: tile'dan küçük/büyük/karışık alanlar (küçük alanda sharp'ın "same dimensions or smaller" hatası olmamalı)
for (const [w, h] of [[10, 10], [20, 45], [100, 10], [75, 75], [90, 30]] as const) {
  const t = await sharp(await tileTo(path, w, h)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([t.info.width, t.info.height], [w, h]);
}
const big = await sharp(await tileTo(path, 100, 100)).raw().toBuffer({ resolveWithObject: true });
const at = (x: number, y: number) => [...big.data.subarray((y * 100 + x) * big.info.channels, (y * 100 + x) * big.info.channels + 3)];
assert.deepEqual(at(5, 7), at(35, 7), "30px'lik tile x ekseninde periyodik");
assert.deepEqual(at(5, 7), at(5, 37), "y ekseninde periyodik");
// symmetry: yalnızca sol yarı çizilir; dokulu, bevel'li katmanda bile çıktı piksel piksel aynalıdır (tek sayılı genişlik dahil)
for (const [W, H, mode] of [[121, 60, "x"], [60, 71, "y"], [61, 61, "xy"]] as const) {
  const d = DesignSchema.parse({ id: "sym", kind: "sprite", width: W, height: H, symmetry: mode, layers: [
    { id: "a", kind: "polygon", points: [[8, 8], [W * 0.45, 10], [W * 0.3, H * 0.8]], fill: { kind: "material", preset: "gold", seed: 3, wear: 0.4 }, effects: [{ kind: "bevel", depth: 4, size: 4 }] }] });
  const { data } = await sharp(await renderDesignPng(d)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)].join();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mode !== "y") assert.equal(px(x, y), px(W - 1 - x, y), `${mode}: x yansıması (${x},${y})`);
    if (mode !== "x") assert.equal(px(x, y), px(x, H - 1 - y), `${mode}: y yansıması (${x},${y})`);
  }
}
assert.throws(() => DesignSchema.parse({ id: "t", kind: "tile", width: 16, height: 16, symmetry: "x", layers: [] }), /symmetry/);
console.log("render ok");
