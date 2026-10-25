import assert from "node:assert/strict";
import { detectSlice } from "./detect.js";

// 40x20: x<8 ve x>=32 sütunları ile y<5 ve y>=15 satırları farklı, aradaki bant sabit.
const ramp = (v: number, n: number, lo: number, hi: number) => (v < lo ? v * 20 : v >= n - hi ? 100 + v : 250) % 256;
const make = (noise = 0) => {
  const d = new Uint8Array(40 * 20 * 4);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) {
    d.set([ramp(x, 40, 8, 8), ramp(y, 20, 5, 5), 0, 255], (y * 40 + x) * 4);
    if (noise && x >= 8 && x < 32) d[(y * 40 + x) * 4 + 2] = (x * 7 + y * 3) % (noise + 1);
  }
  return d;
};

assert.deepEqual(detectSlice(make(), 40, 20), { slice: { left: 8, top: 5, right: 8, bottom: 5 }, warnings: [] });
// gürültü toleransın içindeyse aynı sonuç, dışındaysa merkez bozulur
assert.deepEqual(detectSlice(make(2), 40, 20, 2).slice, { left: 8, top: 5, right: 8, bottom: 5 });
assert.notDeepEqual(detectSlice(make(40), 40, 20, 2).slice, { left: 8, top: 5, right: 8, bottom: 5 });
// düz renk: tamamı esnetilebilir
assert.deepEqual(detectSlice(new Uint8Array(10 * 10 * 4).fill(9), 10, 10).slice, { left: 0, top: 0, right: 0, bottom: 0 });
// hiç tekrar yok: uyarı verir ama geçerli slice döner
const noisy = Uint8Array.from({ length: 9 * 9 * 4 }, (_, i) => (i * 37) % 251);
const r = detectSlice(noisy, 9, 9);
assert.equal(r.warnings.length, 2);
assert.ok(r.slice.left + r.slice.right < 9 && r.slice.top + r.slice.bottom < 9);
console.log("detect ok");
