/**
 * CPU malzeme hattı: yükseklik haritası → normal → ışık. Taş/metal/ahşap yüzeyleri SVG filtreleriyle yapılamayan
 * yapıyla (Voronoi taş/blok, fırçalı metal, gerçek kenar eğimi) üretir. Tüm gürültü periyodiktir: tile'lar dikişsizdir.
 */

export const MATERIAL_PRESETS = ["stone", "slate", "gold", "silver", "bronze", "wood"] as const;
export type MaterialPreset = (typeof MATERIAL_PRESETS)[number];
export const STONE_PATTERNS = ["flagstone", "blocks", "rough"] as const;
export type StonePattern = (typeof STONE_PATTERNS)[number];

export interface MaterialParams {
  preset: MaterialPreset;
  pattern?: StonePattern; // sadece taş/arduvaz
  colors?: string[]; // koyu → açık rampa; verilmezse preset'in rampası
  scale?: number; // büyük = daha ince desen
  seed?: number;
  wear?: number; // 0..1
}
export interface Bevel { depth: number; size?: number; azimuth?: number } // depth/size px cinsinden kenar eğimi

interface Def { family: "stone" | "metal" | "wood"; ramp: string[]; amp: number; spec: number; pattern?: StonePattern; cells?: number }
const DEFS: Record<MaterialPreset, Def> = {
  stone: { family: "stone", ramp: ["#4d4943", "#7a7469", "#a29a8b", "#c2b9a7"], amp: 3, spec: 0.1, pattern: "flagstone" },
  slate: { family: "stone", ramp: ["#10161a", "#212b30", "#37454a", "#51626a"], amp: 2.2, spec: 0.25, pattern: "flagstone", cells: 0.75 },
  gold: { family: "metal", ramp: ["#2e1b06", "#6e4710", "#b98a2a", "#e6bf55", "#fbe9a0"], amp: 0.7, spec: 1 },
  silver: { family: "metal", ramp: ["#1c1f24", "#4a505a", "#8d95a1", "#cfd5dd", "#ffffff"], amp: 0.6, spec: 1 },
  bronze: { family: "metal", ramp: ["#24120a", "#5c3318", "#9a5f2c", "#c98a4a", "#f0c590"], amp: 0.8, spec: 0.8 },
  wood: { family: "wood", ramp: ["#2b190b", "#4d2f16", "#7a5229", "#a07842"], amp: 1.2, spec: 0.15 },
};
export const materialDefaults = () => Object.fromEntries(MATERIAL_PRESETS.map((k) => [k, { colors: DEFS[k].ramp, pattern: DEFS[k].pattern }]));

// ---------- gürültü ----------
const mod = (a: number, n: number) => ((a % n) + n) % n;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periyodik değer gürültüsü; x∈[0,px), y∈[0,py). */
function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(mod(x0, px), mod(y0, py), seed), b = hash2(mod(x0 + 1, px), mod(y0, py), seed);
  const c = hash2(mod(x0, px), mod(y0 + 1, py), seed), d = hash2(mod(x0 + 1, px), mod(y0 + 1, py), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** u,v ∈ [0,1) tuval koordinatı; px,py ilk oktavdaki hücre sayısı. */
function fbm(u: number, v: number, px: number, py: number, oct: number, seed: number): number {
  let s = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) { s += amp * vnoise(u * px, v * py, px, py, seed + o * 17); tot += amp; amp *= 0.5; px *= 2; py *= 2; }
  return s / tot;
}

/** Periyodik Voronoi: f1/f2 hücre birimiyle en yakın iki noktaya uzaklık, id en yakın hücrenin rastgele değeri. */
function worley(u: number, v: number, nx: number, ny: number, seed: number) {
  const x = u * nx, y = v * ny, cx = Math.floor(x), cy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const gx = cx + dx, gy = cy + dy, hx = mod(gx, nx), hy = mod(gy, ny);
    const d = Math.hypot(gx + 0.15 + 0.7 * hash2(hx, hy, seed) - x, gy + 0.15 + 0.7 * hash2(hx, hy, seed + 101) - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(hx, hy, seed + 7); } else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}

// ---------- görüntü işleme yardımcıları ----------
/** Maskenin içindeki her piksel için en yakın dış piksele mesafe (px); tuval sınırı dış sayılır. */
export function edgeDistance(mask: Float32Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] > 0.5 ? 1e9 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
  }
  return d;
}

/** Ayrılabilir kutu bulanıklığı; kenarlar kıstırılır, wrap=true ise sarılır (dikişsiz tile). */
export function boxBlur(src: Float32Array, w: number, h: number, r: number, wrap = false): Float32Array {
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
  const ix = (k: number, len: number) => (wrap ? mod(k, len) : clamp(k, 0, len - 1));
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * w + ix(k, w)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += src[y * w + ix(x + r + 1, w)] - src[y * w + ix(x - r, w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[ix(k, h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[ix(y + r + 1, h) * w + x] - tmp[ix(y - r, h) * w + x];
    }
  }
  return out;
}

const hex2rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function rampFn(colors: string[]) {
  const c = colors.map(hex2rgb), last = c.length - 1;
  return (t: number): [number, number, number] => {
    const p = clamp(t) * last, i = Math.min(last - 1, Math.floor(p)), f = p - i;
    return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f, c[i][2] + (c[i + 1][2] - c[i][2]) * f];
  };
}

// ---------- malzeme alanları ----------
interface Fields { H: Float32Array; tone: Float32Array; dark: Float32Array; sp: Float32Array }

function fields(def: Def, p: MaterialParams, w: number, h: number): Fields {
  const n = w * h, H = new Float32Array(n), tone = new Float32Array(n), dark = new Float32Array(n).fill(1), sp = new Float32Array(n).fill(def.spec);
  const seed = p.seed ?? 1, sc = p.scale ?? 1;
  const amp = def.amp;
  const rnd = (base: number, per: number) => Math.max(1, Math.round(base / per));

  if (def.family === "stone") {
    const pattern = p.pattern ?? def.pattern ?? "flagstone";
    const cellPx = (46 * (def.cells ?? 1)) / sc;
    const nx = Math.max(2, rnd(w, cellPx)), ny = Math.max(2, rnd(h, cellPx));
    const nr = Math.max(1, rnd(h, cellPx * 0.8)), nb = Math.max(2, rnd(w, cellPx * 1.8));
    const cell2 = cellPx * 1.7, nx2 = Math.max(2, rnd(w, cell2)), ny2 = Math.max(2, rnd(h, cell2));
    const gap = 2.4, round = 6;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
      let d = 99, id: number;
      if (pattern === "blocks") {
        const row = Math.floor(v * nr), uu = u * nb + hash2(row, 0, seed + 31) * nb, col = Math.floor(uu);
        const fx = uu - col, fy = v * nr - row;
        d = Math.min(Math.min(fx, 1 - fx) * (w / nb), Math.min(fy, 1 - fy) * (h / nr));
        id = hash2(mod(col, nb), row, seed + 7);
      } else if (pattern === "flagstone") {
        const wo = worley(u, v, nx, ny, seed);
        d = (wo.f2 - wo.f1) * 0.5 * cellPx;
        id = wo.id;
      } else id = fbm(u, v, rnd(w, 90), rnd(h, 90), 2, seed + 2);
      const mottle = fbm(u, v, rnd(w, 70), rnd(h, 70), 4, seed + 3);
      const detail = fbm(u, v, rnd(w, 9), rnd(h, 9), 2, seed + 5);
      if (d < gap) { // harç / aralık
        H[i] = -2.5 + (detail - 0.5) * 0.8; tone[i] = 0.02; dark[i] = 0.76; sp[i] = 0;
      } else {
        const t = clamp((d - gap) / round), top = Math.sqrt(1 - (1 - t) * (1 - t));
        H[i] = amp * top + (detail - 0.5) * amp * 0.7 + (mottle - 0.5) * amp * 0.4;
        tone[i] = clamp(0.5 + (id - 0.5) * 0.6 + (mottle - 0.5) * 0.55);
        const wc = worley(u, v, nx2, ny2, seed + 50); // ince çatlaklar
        if (wc.id > 0.62 && (wc.f2 - wc.f1) * 0.5 * cell2 < 0.8) { H[i] -= 1.4; dark[i] = 0.6; }
      }
    }
  } else if (def.family === "metal") {
    const nxs = rnd(w, 200 / sc), nys = Math.max(2, rnd(h, 1.4)), nxf = rnd(w, 40), nyf = Math.max(2, rnd(h, 1.2));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
      const streak = vnoise(u * nxs, v * nys, nxs, nys, seed), scratch = vnoise(u * nxf, v * nyf, nxf, nyf, seed + 4);
      const mott = fbm(u, v, rnd(w, 120), rnd(h, 120), 3, seed + 9);
      H[i] = (streak - 0.5) * amp * 0.45 + (scratch - 0.5) * amp * 0.25 + (mott - 0.5) * amp * 2.4;
      tone[i] = (mott - 0.5) * 0.28 + Math.cos(2 * Math.PI * (u + v)) * 0.15 + Math.cos(2 * Math.PI * (u - 2 * v) + 1) * 0.05; // geniş parlama süpürmesi (periyodik)
    }
  } else { // wood
    const rings = Math.max(2, rnd(h, 18 / sc)), nxf = rnd(w, 60), nyf = Math.max(2, rnd(h, 1.3));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
      const warp = fbm(u, v, 3, 3, 3, seed) - 0.5, ph = v * rings + warp * 2.2, ring = ph - Math.floor(ph);
      const fiber = vnoise(u * nxf, v * nyf, nxf, nyf, seed + 6);
      const groove = smooth(Math.abs(ring - 0.5) * 2);
      tone[i] = clamp(0.25 + groove * 0.5 + (fiber - 0.5) * 0.35);
      H[i] = (fiber - 0.5) * amp * 0.8 - (1 - groove) * 0.0 - Math.pow(1 - groove, 6) * 0.8;
    }
  }
  return { H, tone, dark, sp };
}

export interface MaterialInput {
  w: number;
  h: number;
  mask: Float32Array; // 0..1 şekil kapsama (SVG'den)
  fill: MaterialParams;
  bevel?: Bevel;
  tileable?: boolean; // true: tuval kenarı şekil kenarı sayılmaz (dikişsiz tile)
}

/** Maskelenmiş şekli malzemeyle boyar; RGBA (alfa = maske) döndürür. */
export function shadeMaterial(inp: MaterialInput): Uint8Array {
  const { w, h, mask } = inp, n = w * h, def = DEFS[inp.fill.preset];
  const F = fields(def, inp.fill, w, h);
  const dist = inp.tileable ? new Float32Array(n).fill(1e9) : edgeDistance(mask, w, h);
  const bd = inp.bevel?.depth ?? 0, bw = Math.max(1, inp.bevel?.size ?? Math.max(3, bd * 1.2));
  const H = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = clamp(dist[i] / bw);
    H[i] = F.H[i] + (bd > 0 ? bd * Math.sqrt(1 - (1 - t) * (1 - t)) : 0);
  }

  const az = ((inp.bevel?.azimuth ?? 315) * Math.PI) / 180, el = (55 * Math.PI) / 180;
  const L: [number, number, number] = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
  const hv = Math.hypot(L[0], L[1], L[2] + 1), Hh: [number, number, number] = [L[0] / hv, L[1] / hv, (L[2] + 1) / hv];
  const wrap = !!inp.tileable, blur = boxBlur(H, w, h, 5, wrap);
  const ix = (k: number, len: number) => (wrap ? mod(k, len) : clamp(k, 0, len - 1));
  const ramp = rampFn(inp.fill.colors ?? def.ramp), hi = ramp(1), out = new Uint8Array(n * 4);
  const wear = inp.fill.wear ?? 0, wseed = (inp.fill.seed ?? 1) + 77;
  const wnx = Math.max(1, Math.round(w / 14)), wny = Math.max(1, Math.round(h / 14)), snx = Math.max(1, Math.round(w / 60)), sny = Math.max(1, Math.round(h / 60));
  const wearTone: [number, number, number] = def.family === "metal" ? ramp(0.97) : [226, 219, 202];
  
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const gx = (H[y * w + ix(x + 1, w)] - H[y * w + ix(x - 1, w)]) * 0.5;
    const gy = (H[ix(y + 1, h) * w + x] - H[ix(y - 1, h) * w + x]) * 0.5;
    const inv = 1 / Math.hypot(gx, gy, 1), nx = -gx * inv, ny = -gy * inv, nz = inv;
    const diffN = clamp((nx * L[0] + ny * L[1] + nz * L[2]) / L[2], 0, 1.6);
    const ao = clamp(1 + (H[i] - blur[i]) * 0.2, 0.5, 1.12);
    const spec = Math.pow(clamp(nx * Hh[0] + ny * Hh[1] + nz * Hh[2]), def.family === "metal" ? 40 : 18) * F.sp[i];
    let r: number, g: number, b: number;
    if (def.family === "metal") {
      const c = ramp(clamp(ao * (0.3 + 0.7 * diffN) * 0.56 + F.tone[i]));
      [r, g, b] = [c[0] + hi[0] * spec * 0.9, c[1] + hi[1] * spec * 0.9, c[2] + hi[2] * spec * 0.9];
    } else {
      const c = ramp(F.tone[i]), s = ao * (0.38 + 0.62 * Math.min(diffN, 1.5)) * F.dark[i];
      const m = 1;
      [r, g, b] = [c[0] * s * m + 255 * spec * 0.25, c[1] * s * m + 255 * spec * 0.25, c[2] * s * m + 255 * spec * 0.25];
    }
    if (wear > 0) {
      const u = (x + 0.5) / w, v = (y + 0.5) / h;
      // kir: oyuklarda ve geniş lekelerde koyu kahve
      const cav = clamp((blur[i] - H[i]) * 0.6), stain = smooth(clamp((fbm(u, v, snx, sny, 3, wseed + 5) - 0.45) / 0.3));
      const grime = clamp(wear * (0.9 * cav + 0.55 * stain));
      r += (38 - r) * grime * 0.6; g += (26 - g) * grime * 0.6; b += (12 - b) * grime * 0.6;
      // kenar aşınması: kenara yakın + gürültü eşiği → parlak (metal) / açık toz (taş)
      const edge = 1 - clamp(dist[i] / (3 + wear * 5)), nz = fbm(u, v, wnx, wny, 3, wseed);
      const ew = clamp((edge * 1.5 + (nz - 0.5) * 1.4 - 0.6) * 3) * wear * 0.85;
      r += (wearTone[0] - r) * ew; g += (wearTone[1] - g) * ew; b += (wearTone[2] - b) * ew;
    }
    const o = i * 4;
    out[o] = clamp(r, 0, 255); out[o + 1] = clamp(g, 0, 255); out[o + 2] = clamp(b, 0, 255);
    out[o + 3] = Math.round(clamp(mask[i]) * 255);
  }
  return out;
}
