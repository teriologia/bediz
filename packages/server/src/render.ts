import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { validateSlice, type Asset } from "@bediz/core";

/** 9-slice'ı hedef boyuta (w×h) çizer: köşeler sabit, kenarlar tek eksende, merkez iki eksende uzar. */
export async function renderNineSlice(a: Asset, w: number, h: number): Promise<Buffer> {
  return renderNineSliceFrom(await readFile(a.path), a, w, h);
}

/** Aynısı, kaynak PNG bellekteyken (henüz diske yazılmamış tasarımlar için). */
export async function renderNineSliceFrom(src: Buffer, a: Pick<Asset, "id" | "width" | "height" | "slice">, w: number, h: number): Promise<Buffer> {
  if (!a.slice) throw new Error(`asset ${a.id} için slice tanımlı değil`);
  const s = a.slice;
  validateSlice(s, a.width, a.height);
  // shortcut: hedef köşelerden küçükse hata veriyoruz (Unreal köşeleri küçültür), gerekirse sonra.
  if (w < s.left + s.right || h < s.top + s.bottom) {
    throw new Error(`hedef ${w}x${h}, köşe toplamından (${s.left + s.right}x${s.top + s.bottom}) küçük olamaz`);
  }
  const sx = [0, s.left, a.width - s.right], sw = [s.left, a.width - s.left - s.right, s.right];
  const sy = [0, s.top, a.height - s.bottom], sh = [s.top, a.height - s.top - s.bottom, s.bottom];
  const dx = [0, s.left, w - s.right], dw = [s.left, w - s.left - s.right, s.right];
  const dy = [0, s.top, h - s.bottom], dh = [s.top, h - s.top - s.bottom, s.bottom];

  const parts: sharp.OverlayOptions[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    if (!sw[i] || !sh[j] || !dw[i] || !dh[j]) continue;
    const input = await sharp(src)
      .extract({ left: sx[i], top: sy[j], width: sw[i], height: sh[j] })
      .resize(dw[i], dh[j], { fit: "fill" })
      .toBuffer();
    parts.push({ input, left: dx[i], top: dy[j] });
  }
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(parts).png().toBuffer();
}
