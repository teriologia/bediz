/**
 * Ham RGBA görüntüyü dikişsiz döşenir hale getirir (offset-blend):
 * sonuç = I·m + kaydır(I)·(1-m), m merkezde 1 kenarda ~0 olan çadır ağırlığı.
 * Kenar pikselleri I'nın yarım kaydırılmış (merkez) komşuluğundan geldiği için sağ/sol ve alt/üst eşleşir.
 * shortcut: karışım bölgesinde doku kontrastı düşer ve hafif hayalet oluşur; gürültü dokular için yeterli, belirgin motifler için değil.
 */
export function makeSeamless(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  const wx = (x: number) => 1 - Math.abs((2 * (x + 0.5)) / w - 1);
  const wy = (y: number) => 1 - Math.abs((2 * (y + 0.5)) / h - 1);
  for (let y = 0; y < h; y++) {
    const sy = (y + (h >> 1)) % h, my = wy(y);
    for (let x = 0; x < w; x++) {
      const sx = (x + (w >> 1)) % w, m = wx(x) * my;
      const a = (y * w + x) * 4, b = (sy * w + sx) * 4;
      for (let c = 0; c < 4; c++) out[a + c] = Math.round(rgba[a + c] * m + rgba[b + c] * (1 - m));
    }
  }
  return out;
}
