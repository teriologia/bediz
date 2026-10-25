import sharp from "sharp";
import { layoutWidget, walk, type Asset, type Node, type Widget } from "@bediz/core";
import { renderNineSlice } from "./render.js";
import { measureText, textPathData } from "./text.js";

/** Widget'ı layout'a göre PNG'ye çizer; canvas dışına taşan kısımlar kırpılır. */
export async function renderWidget(widget: Widget, assets: Map<string, Asset>, background = "#2a2a32"): Promise<Buffer> {
  const rects = layoutWidget(widget, (id) => {
    const a = assets.get(id);
    return a && { w: a.width, h: a.height };
  }, measureText);
  const W = widget.width, H = widget.height;
  const parts: sharp.OverlayOptions[] = [];

  const clipped = async (buf: Buffer, x: number, y: number, w: number, h: number) => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    const input = x0 === x && y0 === y && x1 === x + w && y1 === y + h
      ? buf
      : await sharp(buf).extract({ left: x0 - x, top: y0 - y, width: x1 - x0, height: y1 - y0 }).toBuffer();
    parts.push({ input, left: x0, top: y0 });
  };

  const draw = async (n: Node) => {
    const r = rects.get(n.id)!;
    const [x, y, w, h] = [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)];
    if (w <= 0 || h <= 0) return;
    if ((n.type === "Border" || n.type === "Image") && n.brush) {
      const a = assets.get(n.brush.asset);
      if (!a) throw new Error(`${n.id}: asset yok: ${n.brush.asset}`);
      if (a.tile) {
        const tiled = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: a.path, tile: true }]).png().toBuffer();
        return void (await clipped(tiled, x, y, w, h));
      }
      const s = a.slice;
      const fits = s && w >= s.left + s.right && h >= s.top + s.bottom;
      await clipped(fits ? await renderNineSlice(a, w, h) : await sharp(a.path).resize(w, h, { fit: "fill" }).png().toBuffer(), x, y, w, h);
    } else if (n.type === "TextBlock" && n.text) {
      const fs = n.fontSize ?? 16;
      // Yazı vektör yola çevrilir (Roboto Bold, UE'nin varsayılanı) ve rect'ine kırpılmaz (UMG gibi taşabilir); sadece canvas sınırında kırpılır.
      const tw = Math.max(w, measureText(n.text, fs).w + 2);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${h}"><path d="${textPathData(n.text, 0, 0, fs)}" fill="${n.color ?? "#ffffff"}"/></svg>`;
      await clipped(await sharp(Buffer.from(svg)).png().toBuffer(), x, y, tw, h);
    }
  };

  // Çizim sırası: parent önce, sonra child'lar (UMG'de sonraki kardeş üstte).
  for (const { node } of walk(widget.root)) await draw(node);
  return sharp({ create: { width: W, height: H, channels: 4, background } }).composite(parts).png().toBuffer();
}
