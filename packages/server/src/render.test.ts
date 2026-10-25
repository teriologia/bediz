import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { renderNineSlice } from "./render.js";

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
console.log("render ok");
