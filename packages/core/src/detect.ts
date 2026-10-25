import type { Slice } from "./slice.js";

export interface Detection {
  slice: Slice;
  warnings: string[];
}

/**
 * Her eksende birbirinin aynı olan (tolerans dahilinde) ardışık sütun/satırların en uzun bandı
 * esnetilebilir merkezdir; bandın iki yanı kenar sayılır. `rgba` ham 4 kanallı veridir.
 */
export function detectSlice(rgba: Uint8Array, w: number, h: number, tol = 2): Detection {
  const warnings: string[] = [];

  // n: eksendeki çizgi sayısı, m: çizgi uzunluğu, off(i, j): i. çizginin j. pikselinin bayt konumu
  const band = (name: string, n: number, m: number, off: (i: number, j: number) => number) => {
    let run = 0, best = 0, bestStart = 0, bestDist = Infinity;
    for (let i = 0; i < n - 1; i++) {
      let same = true;
      for (let j = 0; j < m && same; j++) {
        const a = off(i, j), b = off(i + 1, j);
        for (let c = 0; c < 4; c++) if (Math.abs(rgba[a + c] - rgba[b + c]) > tol) { same = false; break; }
      }
      run = same ? run + 1 : 0;
      const start = i - run + 1, dist = Math.abs(start + run / 2 - n / 2);
      if (run > best || (run === best && run > 0 && dist < bestDist)) [best, bestStart, bestDist] = [run, start, dist];
    }
    if (best === 0) {
      warnings.push(`${name}: esnetilebilir bölge bulunamadı, ortadaki 1px merkez varsayıldı`);
      const before = Math.floor((n - 1) / 2);
      return [before, n - 1 - before];
    }
    return [bestStart, n - 1 - (bestStart + best)];
  };

  const [left, right] = band("yatay", w, h, (i, j) => (j * w + i) * 4);
  const [top, bottom] = band("dikey", h, w, (i, j) => (i * w + j) * 4);
  return { slice: { left, top, right, bottom }, warnings };
}
