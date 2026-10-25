import { boxBlur } from "./material.js";

export interface ShadowFx { dx?: number; dy?: number; blur?: number; color?: string; opacity?: number }

const hex2rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Gauss yaklaşığı: üç geçiş kutu bulanıklığı. */
function gauss(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(0, Math.round(sigma * 0.8));
  return r < 1 ? a : boxBlur(boxBlur(boxBlur(a, w, h, r), w, h, r), w, h, r);
}

const alphaOf = (rgba: Uint8Array) => Float32Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3] / 255);

/** Şeklin altına gölge/parlama koyar (dx=dy=0 ise parlama). */
export function withShadow(rgba: Uint8Array, w: number, h: number, fx: ShadowFx): Uint8Array {
  const { dx = 2, dy = 4, blur = 3, color = "#000000", opacity = 0.6 } = fx, c = hex2rgb(color);
  const a = alphaOf(rgba), sh = gauss(a, w, h, blur), out = new Uint8Array(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, sx = x - Math.round(dx), sy = y - Math.round(dy);
    const sa = sx < 0 || sy < 0 || sx >= w || sy >= h ? 0 : sh[sy * w + sx] * opacity;
    const pa = a[i], ra = pa + sa * (1 - pa), o = i * 4;
    for (let k = 0; k < 3; k++) out[o + k] = ra > 0 ? Math.round((rgba[o + k] * pa + c[k] * sa * (1 - pa)) / ra) : 0;
    out[o + 3] = Math.round(ra * 255);
  }
  return out;
}

/** Şeklin içine, kenarlara yakın gölge basar. */
export function withInnerShadow(rgba: Uint8Array, w: number, h: number, fx: ShadowFx): Uint8Array {
  const { dx = 0, dy = 2, blur = 4, color = "#000000", opacity = 0.6 } = fx, c = hex2rgb(color);
  const a = alphaOf(rgba), inv = gauss(a.map((v) => 1 - v), w, h, blur), out = Uint8Array.from(rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, sx = x - Math.round(dx), sy = y - Math.round(dy);
    const s = (sx < 0 || sy < 0 || sx >= w || sy >= h ? 1 : inv[sy * w + sx]) * opacity * a[i], o = i * 4;
    for (let k = 0; k < 3; k++) out[o + k] = Math.round(rgba[o + k] * (1 - s) + c[k] * s);
  }
  return out;
}
