import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DesignSchema, ornateFrameRecipe, silhouettePath } from "@bediz/core";
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
// band: silüet dışı şeffaf, dış çizgi bandı kenarda koyu, yüzey bandı merkezde boyalı; malzemeli bant bevel ile parlar
{
  const Wb = 200, Hb = 80, d = silhouettePath("hex", Wb, Hb, 30, 6);
  const des = DesignSchema.parse({ id: "bd", kind: "sprite", width: Wb, height: Hb, layers: [
    { id: "o", kind: "band", d, from: 0, to: 3, fill: { kind: "solid", color: "#101010" } },
    { id: "r", kind: "band", d, from: 2, to: 8, fill: { kind: "material", preset: "gold", seed: 3, wear: 0 }, effects: [{ kind: "bevel", depth: 3, size: 3 }] },
    { id: "f", kind: "band", d, from: 8, fill: { kind: "solid", color: "#2244aa" } }] });
  const { data } = await sharp(await renderDesignPng(des)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [...data.subarray((y * Wb + x) * 4, (y * Wb + x) * 4 + 4)];
  assert.equal(px(1, 1)[3], 0, "silüet dışı şeffaf");
  assert.ok(px(100, 40)[2] > 150 && px(100, 40)[0] < 80 && px(100, 40)[3] === 255, "yüzey bandı mavi");
  const rim = px(100, 6 + 5); // üst kenardan ~5 px: metal bandı
  assert.ok(rim[0] > rim[2] + 30, `metal bandı altın tonlu olmalı: ${rim}`);
  assert.ok(px(100, 7)[0] < 60 || px(100, 6)[0] < 60, "en dış bant koyu çizgi");
}
// gotik çerçeve: orta saydam, bant dolu, kule çerçeve dışına taşar, dört köşede aynı (xy simetri)
{
  const r = ornateFrameRecipe({ id: "ofx", width: 480, height: 360, spire: 40, thickness: 20 }), Wo = 480, Ho = 360, M = 54;
  const { data } = await sharp(await renderDesignPng(r.designs[0])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = (x: number, y: number) => data[(y * Wo + x) * 4 + 3];
  assert.equal(a(Wo / 2, Ho / 2), 0, "orta saydam");
  assert.ok(a(Wo / 2 - 60, M + 8) > 200, "üst bant dolu");
  for (const [x, y] of [[M, M - 20], [M - 20, M + 1]]) {
    assert.ok(a(x, y) > 100, `kule dışarı taşmalı (${x},${y})`);
    assert.equal(a(Wo - 1 - x, y), a(x, y), "sağ-üst aynalı");
    assert.equal(a(x, Ho - 1 - y), a(x, y), "sol-alt aynalı");
  }
}
// mask: şekil içine kırpma (alfa), gradyan luma maskesi (+ invert), gizli maske çıktıda görünmez, iç içe maske, motif açılımı
{
  const Wm = 64, Hm = 64, red = { kind: "solid", color: "#ff0000" }, base = { kind: "box", inset: 0, fill: red };
  const px = async (layers: object[]) => {
    const { data } = await sharp(await renderDesignPng(DesignSchema.parse({ id: "mk", kind: "sprite", width: Wm, height: Hm, layers }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return (x: number, y: number) => [...data.subarray((y * Wm + x) * 4, (y * Wm + x) * 4 + 4)];
  };
  const left = { id: "m", kind: "box", x: 0, y: 0, w: 32, h: Hm, hidden: true, fill: { kind: "solid", color: "#ffffff" } };
  const clip = await px([left, { id: "a", ...base, mask: { layer: "m" } }]);
  assert.equal(clip(10, 30)[3], 255, "maske içinde görünür");
  assert.equal(clip(50, 30)[3], 0, "maske dışında şeffaf; gizli maske çıktıda yok");
  const inv = await px([left, { id: "a", ...base, mask: { layer: "m", invert: true } }]);
  assert.equal(inv(10, 30)[3], 0); assert.equal(inv(50, 30)[3], 255);
  // luma: soldan sağa siyah→beyaz gradyan; alfa soldan sağa artar, invert azalır
  const grad = { id: "g", kind: "box", inset: 0, hidden: true, fill: { kind: "linear", angle: 0, stops: [[0, "#000000"], [1, "#ffffff"]] } };
  const lu = await px([grad, { id: "a", ...base, mask: { layer: "g", use: "luma" } }]);
  assert.ok(lu(4, 30)[3] < 40 && lu(60, 30)[3] > 215 && lu(32, 30)[3] > 100 && lu(32, 30)[3] < 155, `luma geçişi: ${lu(4, 30)[3]} ${lu(32, 30)[3]} ${lu(60, 30)[3]}`);
  const li = await px([grad, { id: "a", ...base, mask: { layer: "g", use: "luma", invert: true } }]);
  assert.ok(li(4, 30)[3] > 215 && li(60, 30)[3] < 40);
  // iç içe: b, a ile maskeli; c, b ile maskeli → c yalnız a ∩ b'de
  const top = { id: "a", kind: "box", x: 0, y: 0, w: Wm, h: 40, hidden: true, fill: { kind: "solid", color: "#ffffff" } };
  const nest = await px([top, { id: "b", kind: "box", inset: 0, hidden: true, fill: { kind: "solid", color: "#ffffff" }, mask: { layer: "a" } }, left.id === "m" ? { ...left, id: "l" } : left, { id: "c", ...base, mask: { layer: "b" } }]);
  assert.equal(nest(10, 20)[3], 255, "a içinde"); assert.equal(nest(10, 50)[3], 0, "a dışında (iç içe maske)");
  // maskesiz referans katman görünür kalır (hidden verilmediyse)
  const vis = await px([{ id: "m", ...base, x: 0, y: 0, w: 20, h: 20, inset: undefined, fill: { kind: "solid", color: "#00ff00" } }, { id: "a", ...base, mask: { layer: "m" } }]);
  assert.deepEqual(vis(5, 5).slice(0, 3), [255, 0, 0], "maskelenen katman üstte kırmızı"); assert.equal(vis(40, 40)[3], 0);
}
// blur: kenar yumuşar (alfa 0 ile 255 arası ara değerler), merkez dolu kalır; maske blur'dan sonra uygulanır (maske kenarı keskin); noise dolgusu şekil içinde değişken, dışında şeffaf
{
  const Wb = 64, Hb = 64, px = async (layers: object[]) => {
    const { data } = await sharp(await renderDesignPng(DesignSchema.parse({ id: "bl", kind: "sprite", width: Wb, height: Hb, layers }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return (x: number, y: number) => data[(y * Wb + x) * 4 + 3];
  };
  const sq = { kind: "box", x: 16, y: 16, w: 32, h: 32, fill: { kind: "solid", color: "#ffffff" } };
  const sharpA = await px([{ id: "a", ...sq }]), soft = await px([{ id: "a", ...sq, effects: [{ kind: "blur", radius: 4 }] }]);
  assert.equal(sharpA(14, 32), 0); assert.ok(soft(14, 32) > 20 && soft(14, 32) < 235, `kenar yumuşamalı: ${soft(14, 32)}`);
  assert.ok(soft(32, 32) > 230 && sharpA(32, 32) === 255, "merkez dolu");
  const masked = await px([{ id: "m", kind: "box", x: 0, y: 0, w: 20, h: Hb, hidden: true, fill: { kind: "solid", color: "#ffffff" } }, { id: "a", ...sq, effects: [{ kind: "blur", radius: 4 }], mask: { layer: "m" } }]);
  assert.equal(masked(30, 32), 0, "maske dışında şeffaf (maske blur'dan sonra)"); assert.ok(masked(18, 32) > 20, "maske içinde bulanık içerik kalır");
  const lum = async (layers: object[]) => {
    const { data } = await sharp(await renderDesignPng(DesignSchema.parse({ id: "nz", kind: "sprite", width: Wb, height: Hb, layers }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return (x: number, y: number) => [data[(y * Wb + x) * 4], data[(y * Wb + x) * 4 + 3]];
  };
  const nz = await lum([{ id: "n", kind: "box", x: 16, y: 16, w: 32, h: 32, fill: { kind: "noise", style: "cells", scale: 4, seed: 2 } }]);
  const vals = Array.from({ length: 16 }, (_, i) => nz(20 + i, 24 + i)[0]);
  assert.ok(Math.max(...vals) - Math.min(...vals) > 40, "noise şekil içinde değişken"); assert.equal(nz(5, 5)[1], 0, "noise şekil dışında şeffaf");
}
assert.throws(() => DesignSchema.parse({ id: "t", kind: "tile", width: 16, height: 16, symmetry: "x", layers: [] }), /symmetry/);
console.log("render ok");
