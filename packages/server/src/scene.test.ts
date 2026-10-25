import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Asset, Widget } from "@bediz/core";
import { renderWidget } from "./render-scene.js";

// 30x30 kaynak, 10px kenarlı 3x3 ızgara (R = sütun, G = satır renkleri).
const raw = Buffer.alloc(30 * 30 * 4);
for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) raw.set([Math.floor(x / 10) * 100, Math.floor(y / 10) * 100, 0, 255], (y * 30 + x) * 4);
const path = join(mkdtempSync(join(tmpdir(), "bediz-scene-")), "g.png");
writeFileSync(path, await sharp(raw, { raw: { width: 30, height: 30, channels: 4 } }).png().toBuffer());
const g: Asset = { id: "g", path, width: 30, height: 30, slice: { left: 10, top: 10, right: 10, bottom: 10 } };

const widget: Widget = {
  id: "w", width: 200, height: 100,
  root: { id: "Root", type: "CanvasPanel", children: [
    { id: "box", type: "Border", brush: { asset: "g" }, slot: { offsets: { left: 20, top: 20, right: 100, bottom: 60 } }, children: [] },
    // sol kenardan taşıyor: kırpılmalı, hata vermemeli
    { id: "off", type: "Image", brush: { asset: "g" }, slot: { offsets: { left: -30, top: 0, right: 50, bottom: 50 } }, children: [] },
  ] },
};

const { data, info } = await sharp(await renderWidget(widget, new Map([["g", g]]))).raw().toBuffer({ resolveWithObject: true });
assert.deepEqual([info.width, info.height], [200, 100]);
const px = (x: number, y: number) => [...data.subarray((y * 200 + x) * info.channels, (y * 200 + x) * info.channels + 2)];
assert.deepEqual(px(190, 90), [42, 42]); // arka plan #2a2a32 (R, G)
assert.deepEqual(px(22, 50), [0, 100]);      // box sol-orta kenar (R=sütun0, G=satır1)
assert.deepEqual(px(22, 75), [0, 200]);      // box sol-alt köşe
assert.deepEqual(px(70, 50), [100, 100]);    // box merkezi
assert.deepEqual(px(1, 5), [100, 0]);        // taşan image'in görünen kısmı (kaynağın üst-orta kenarı)
console.log("scene ok");
