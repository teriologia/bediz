import assert from "node:assert/strict";
import sharp from "sharp";
import { deriveState } from "./derive-tools.js";

// saydam zeminde mor, ortası dolu yuvarlak köşeli bir plaka: silüet alfası korunmalı
const W = 120, H = 60;
const plate = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 100, height: 40, channels: 4, background: "#7a4fd0" } }).png().toBuffer(), left: 10, top: 10 }]).png().toBuffer();

const raw = async (png: Buffer) => (await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const stat = (d: Buffer) => {
  let lum = 0, sat = 0, n = 0, alpha = 0;
  for (let i = 0; i < d.length; i += 4) {
    alpha += d[i + 3];
    if (!d[i + 3]) continue;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    lum += (d[i] + d[i + 1] + d[i + 2]) / 3; sat += mx ? (mx - mn) / mx : 0; n++;
  }
  return { lum: lum / n, sat: sat / n, alpha };
};
const base = stat(await raw(plate));
const hov = stat(await raw(await deriveState(plate, "hovered")));
const prs = stat(await raw(await deriveState(plate, "pressed")));
const dis = stat(await raw(await deriveState(plate, "disabled")));

assert.ok(hov.lum > base.lum && base.lum > prs.lum && prs.lum > dis.lum, `parlaklık sırası: ${hov.lum} ${base.lum} ${prs.lum} ${dis.lum}`);
assert.ok(dis.sat < base.sat * 0.3, "disabled neredeyse renksiz olmalı");
assert.equal(hov.alpha, base.alpha, "hover silüet alfasını değiştirmemeli");
assert.equal(prs.alpha, base.alpha, "pressed silüet alfasını değiştirmemeli");
assert.ok(dis.alpha < base.alpha && dis.alpha > base.alpha * 0.85, "disabled hafif solar");
// boyut korunur; seçenekler ezilir (glow 0 + parlaklık 1 + gloss 0 → hover ≈ kaynak)
const same = stat(await raw(await deriveState(plate, "hovered", { brightness: 1, saturation: 1, glow: 0, gloss: 0 })));
assert.ok(Math.abs(same.lum - base.lum) < 1.5 && Math.abs(same.sat - base.sat) < 0.02, "nötr seçenekler görüntüyü değiştirmemeli");
assert.deepEqual((await sharp(await deriveState(plate, "pressed")).metadata()).width, W);
console.log("derive ok");
