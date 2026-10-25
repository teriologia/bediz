/**
 * Silüet kütüphanesi: dikdörtgen olmayan bileşen biçimleri (altıgen, çentikli, kanatlı...) için SVG yol verisi.
 * Hepsi yatay uzayan 9-slice için tasarlandı: uç bölgeler (`cap` px) sabit kalır, ortası düz gerilir. Yol saat yönünde (nonzero dolgu).
 * Katmanlar `band` türüyle silüetin kenar mesafesine göre dilimlenir (dış çizgi, metal, boşluk, yüzey), bu yüzden köşeli/eğri her biçimde eşit kalınlık korunur.
 */
export const SILHOUETTES = ["rect", "notched", "hex", "arrow", "swallow", "winged"] as const;
export type Silhouette = (typeof SILHOUETTES)[number];

const f = (n: number) => String(+n.toFixed(2));
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L")} Z`;

/** Tuval W×H, kenarlardan `margin` boşluk (gölge/parıltı için); uç bölgesi `cap` px. */
export function silhouettePath(shape: Silhouette, W: number, H: number, cap: number, margin: number): string {
  const x0 = margin, x1 = W - margin, y0 = margin, y1 = H - margin, mid = H / 2, hh = y1 - y0;
  switch (shape) {
    case "rect": {
      const c = Math.min(cap * 0.5, hh / 2);
      return poly([[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]]);
    }
    case "notched": {
      const cc = cap * 0.45, nd = cap * 0.35, nh = hh * 0.14;
      return poly([[x0 + cc, y0], [x1 - cc, y0], [x1, y0 + cc], [x1, mid - nh], [x1 - nd, mid], [x1, mid + nh], [x1, y1 - cc], [x1 - cc, y1],
        [x0 + cc, y1], [x0, y1 - cc], [x0, mid + nh], [x0 + nd, mid], [x0, mid - nh], [x0, y0 + cc]]);
    }
    case "hex": return poly([[x0 + cap, y0], [x1 - cap, y0], [x1, mid], [x1 - cap, y1], [x0 + cap, y1], [x0, mid]]);
    case "arrow": return poly([[x0, y0], [x1 - cap, y0], [x1, mid], [x1 - cap, y1], [x0, y1]]);
    case "swallow": return poly([[x0, y0], [x1, y0], [x1 - cap * 0.6, mid], [x1, y1], [x0, y1], [x0 + cap * 0.6, mid]]);
    case "winged": {
      // Gövde (altıgen) + iki yanda dışa bakan şevron kanat; hepsi x0..x0+cap uç bölgesinde biter.
      const xb = x0 + cap * 0.4, bc = cap * 0.6, wy0 = y0 + hh * 0.12, wy1 = y1 - hh * 0.12, ww = cap * 0.4, wt = cap * 0.55;
      const body = poly([[xb + bc, y0], [W - xb - bc, y0], [W - xb, mid], [W - xb - bc, y1], [xb + bc, y1], [xb, mid]]);
      const wing = (dir: 1 | -1): string => {
        const X = (x: number) => (dir === 1 ? x : W - x);
        const pts: [number, number][] = [[x0, mid], [x0 + wt, wy0], [x0 + wt + ww, wy0], [x0 + ww, mid], [x0 + wt + ww, wy1], [x0 + wt, wy1]];
        // sağ kanat aynalanır: sıra tersine çevrilir ki yol yönü (saat yönü) korunsun
        return poly((dir === 1 ? pts : pts.reverse()).map(([x, y]) => [X(x), y] as [number, number]));
      };
      return `${wing(1)} ${body} ${wing(-1)}`;
    }
  }
}
