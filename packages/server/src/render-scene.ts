import sharp from "sharp";
import { layoutWidget, walk, type Asset, type Node, type Widget } from "@bediz/core";
import { renderNineSlice, tileTo } from "./render.js";
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

  /** Asset'i verilen boyuta çizer: tile → döşer, 9-slice → gerer (sığmıyorsa düz gerer), diğerleri → düz gerer. */
  const brushImage = async (n: Node, assetId: string, w: number, h: number): Promise<Buffer> => {
    const a = assets.get(assetId);
    if (!a) throw new Error(`${n.id}: asset yok: ${assetId}`);
    if (a.tile) return tileTo(a.path, w, h);
    const sl = a.slice;
    return sl && w >= sl.left + sl.right && h >= sl.top + sl.bottom ? renderNineSlice(a, w, h) : sharp(a.path).resize(w, h, { fit: "fill" }).png().toBuffer();
  };

  const draw = async (n: Node) => {
    const r = rects.get(n.id)!;
    const [x, y, w, h] = [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)];
    if (w <= 0 || h <= 0) return;
    if (n.brush && ["Border", "Image", "Button", "ProgressBar"].includes(n.type)) {
      await clipped(await brushImage(n, n.brush.asset, w, h), x, y, w, h);
      // ProgressBar dolgusu: UE'nin barFillStyle=Scale davranışı gibi, brush yüzdeye göre gerilir (9-slice köşeleri korur).
      if (n.type === "ProgressBar" && n.fill) {
        const i = Math.round(n.inset ?? 0), fw = Math.round((w - 2 * i) * (n.percent ?? 0.5)), fh = h - 2 * i;
        if (fw > 0 && fh > 0) await clipped(await brushImage(n, n.fill.asset, fw, fh), x + i, y + i, fw, fh);
      }
    } else if (n.type === "TextBlock" && n.text) {
      const fs = n.fontSize ?? 16;
      // Yazı vektör yola çevrilir (Roboto Bold, UE'nin varsayılanı) ve rect'ine kırpılmaz (UMG gibi taşabilir); sadece canvas sınırında kırpılır.
      const d = textPathData(n.text, 0, 0, fs, n.font, n.letterSpacing), sh = n.shadow, ol = n.outline;
      const pad = Math.ceil(Math.max(Math.abs(sh?.x ?? 0), Math.abs(sh?.y ?? 0), ol?.size ?? 0));
      const tw = Math.max(w, measureText(n.text, fs, n.font, n.letterSpacing).w + 2 + pad);
      const col = (hex: string) => `fill="${hex.slice(0, 7)}"${hex.length > 7 ? ` fill-opacity="${(parseInt(hex.slice(7), 16) / 255).toFixed(3)}"` : ""}`;
      // Sıra UE gibi: gölge, kontur, dolgu.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${h + pad}">${sh ? `<path transform="translate(${sh.x} ${sh.y})" d="${d}" ${col(sh.color)}/>` : ""}${ol ? `<path d="${d}" ${col(ol.color)} stroke="${ol.color.slice(0, 7)}" stroke-width="${ol.size * 2}" stroke-linejoin="round"/>` : ""}<path d="${d}" fill="${n.color ?? "#ffffff"}"/></svg>`;
      await clipped(await sharp(Buffer.from(svg)).png().toBuffer(), x, y, tw, h + pad);
    }
  };

  // Çizim sırası: parent önce, sonra child'lar (UMG'de sonraki kardeş üstte).
  for (const { node } of walk(widget.root)) await draw(node);
  return sharp({ create: { width: W, height: H, channels: 4, background } }).composite(parts).png().toBuffer();
}
