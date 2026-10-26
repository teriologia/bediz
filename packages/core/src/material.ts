/**
 * CPU malzeme hattı: yükseklik haritası → normal → ışık. Taş/metal/ahşap yüzeyleri SVG filtreleriyle yapılamayan
 * yapıyla (Voronoi taş/blok, fırçalı metal, gerçek kenar eğimi) üretir. Tüm gürültü periyodiktir: tile'lar dikişsizdir.
 */

export const MATERIAL_PRESETS = ["stone", "slate", "gold", "silver", "bronze", "wood", "leather", "marble", "carbon", "cloth", "papyrus", "parchment"] as const;
export type MaterialPreset = (typeof MATERIAL_PRESETS)[number];
export const STONE_PATTERNS = ["flagstone", "blocks", "rough", "fine"] as const;
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

interface Def { family: "stone" | "metal" | "wood" | "leather" | "marble" | "weave" | "paper"; ramp: string[]; amp: number; spec: number; pattern?: StonePattern; cells?: number; weaveCell?: number; twill?: boolean; paper?: "papyrus" | "skin" }
const DEFS: Record<MaterialPreset, Def> = {
  stone: { family: "stone", ramp: ["#3e3a35", "#645f56", "#8b8374", "#a79e8d"], amp: 3, spec: 0.08, pattern: "flagstone" },
  slate: { family: "stone", ramp: ["#0b1013", "#18211f", "#26312f", "#38453f"], amp: 2.2, spec: 0.15, pattern: "flagstone", cells: 0.75 },
  gold: { family: "metal", ramp: ["#150e07", "#3a2810", "#6a4f23", "#9a7a3f", "#cdb072"], amp: 0.7, spec: 0.55 },
  silver: { family: "metal", ramp: ["#101216", "#30353d", "#5f6671", "#939ba7", "#cdd3db"], amp: 0.6, spec: 0.55 },
  bronze: { family: "metal", ramp: ["#150a05", "#3d2210", "#6e4322", "#9b6a3c", "#c79a68"], amp: 0.8, spec: 0.5 },
  wood: { family: "wood", ramp: ["#2b190b", "#4d2f16", "#7a5229", "#a07842"], amp: 1.2, spec: 0.15 },
  leather: { family: "leather", ramp: ["#1a0f0a", "#33200f", "#5a3a1c", "#80582b"], amp: 1.6, spec: 0.12 }, // taneli deri: küçük yuvarlak hücreler + kırışıklık çizgileri
  marble: { family: "marble", ramp: ["#1c1c22", "#4b4b55", "#a3a3ad", "#e8e8ee"], amp: 0.35, spec: 0.45 }, // damarlı cilalı mermer (colors ile siyah/yeşil mermer)
  carbon: { family: "weave", ramp: ["#040405", "#0e0f12", "#1b1d22", "#2e3139"], amp: 1.4, spec: 0.55, weaveCell: 5, twill: true }, // çapraz dokuma karbon fiber
  papyrus: { family: "paper", ramp: ["#4a3418", "#8a6a3a", "#c4a468", "#e6d3a0"], amp: 0.9, spec: 0.02, paper: "papyrus" }, // çapraz şeritli lifli papirüs; wear: yaşlanma (leke, kenar yanığı, katlanma izi, benek)
  parchment: { family: "paper", ramp: ["#5a4020", "#9a7a48", "#d2b886", "#efe0b8"], amp: 0.35, spec: 0.04, paper: "skin" }, // düzgün parşömen (hayvan derisi): bulutlu ton, ince damar ve gözenek
  cloth: { family: "weave", ramp: ["#1a0a10", "#3a1220", "#6a1f35", "#8f3550"], amp: 0.7, spec: 0.03, weaveCell: 3, twill: false }, // ince dokuma kumaş/kadife
};
export const materialDefaults = () => Object.fromEntries(MATERIAL_PRESETS.map((k) => [k, { colors: DEFS[k].ramp, pattern: DEFS[k].pattern }]));

// ---------- gürültü ----------
const mod = (a: number, n: number) => ((a % n) + n) % n;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export function hash2(x: number, y: number, seed: number): number {
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

/**
 * RGBA tamponunu gürültü alanıyla kaydırır (displacement): yırtık/aşınmış kenar. amount en büyük kayma px, scale gürültü öbek boyu px; iki oktav (ince oktav kenara tırtık verir).
 * Örnekleme premultiplied çift doğrusal: kenarda koyu halka oluşmaz. Aynı seed aynı sonucu verir.
 */
export function displaceRgba(src: Uint8Array, w: number, h: number, amount: number, scale: number, seed: number): Uint8Array {
  const out = new Uint8Array(src.length), N = 1 << 20, s = Math.max(1, scale);
  const f = (x: number, y: number, sd: number) => (vnoise(x / s, y / s, N, N, sd) - 0.5) * 1.3 + (vnoise((x * 2.7) / s, (y * 2.7) / s, N, N, sd + 7) - 0.5) * 0.7;
  const px = (x: number, y: number, c: number) => { const i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4; return src[i + c] * (c === 3 ? 1 : src[i + 3] / 255); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x + f(x, y, seed) * 2 * amount, sy = y + f(x + 311, y + 177, seed + 3) * 2 * amount;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, o = (y * w + x) * 4;
    const v = (c: number) => (px(x0, y0, c) * (1 - fx) + px(x0 + 1, y0, c) * fx) * (1 - fy) + (px(x0, y0 + 1, c) * (1 - fx) + px(x0 + 1, y0 + 1, c) * fx) * fy;
    const a = v(3);
    out[o + 3] = Math.round(a);
    if (a > 0.5) for (let c = 0; c < 3; c++) out[o + c] = Math.round(clamp((v(c) * 255) / a, 0, 255));
  }
  return out;
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
/**
 * Maskenin içindeki her piksel için en yakın dış kenara mesafe (px); tuval sınırı dış sayılır.
 * Tam Öklid mesafesi (Felzenszwalb): 8 yönlü chamfer, çapraz ve eğri kenarlarda sekizgen basamaklar üretiyordu.
 * Kenar pikselinde antialias kapsama oranı mesafeyi alt piksel düzeyinde düzeltir, sonuç 3x3 yumuşatılır.
 */
export function edgeDistance(mask: Float32Array, w: number, h: number): Float32Array {
  const W = w + 2, H = h + 2, INF = 1e12, sq = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = x > 0 && y > 0 && x <= w && y <= h && mask[(y - 1) * w + (x - 1)] > 0.5;
    sq[y * W + x] = inside ? INF : 0;
  }
  const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len: number, get: (k: number) => number, put: (k: number, val: number) => void) => {
    for (let k = 0; k < len; k++) f[k] = get(k);
    let r = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let sx = ((f[q] + q * q) - (f[v[r]] + v[r] * v[r])) / (2 * q - 2 * v[r]);
      while (sx <= z[r]) { r--; sx = ((f[q] + q * q) - (f[v[r]] + v[r] * v[r])) / (2 * q - 2 * v[r]); }
      r++; v[r] = q; z[r] = sx; z[r + 1] = INF;
    }
    r = 0;
    for (let q = 0; q < len; q++) { while (z[r + 1] < q) r++; d[q] = (q - v[r]) ** 2 + f[v[r]]; }
    for (let k = 0; k < len; k++) put(k, d[k]);
  };
  for (let x = 0; x < W; x++) pass(H, (k) => sq[k * W + x], (k, val) => { sq[k * W + x] = val; });
  for (let y = 0; y < H; y++) pass(W, (k) => sq[y * W + k], (k, val) => { sq[y * W + k] = val; });
  // Piksel merkezinden kenara: merkezler arası mesafe − 0.5; kenar pikselinde kapsama (mask) ile alt piksel düzeltmesi.
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (mask[i] <= 0.5) continue;
    const dc = Math.sqrt(sq[(y + 1) * W + (x + 1)]);
    out[i] = Math.max(0, dc - 1 + mask[i] - 0.5);
  }
  return boxBlur(out, w, h, 1);
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

function fields(def: Def, p: MaterialParams, w: number, h: number, dist?: Float32Array): Fields {
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
      } else id = fbm(u, v, rnd(w, 90), rnd(h, 90), 2, seed + 2); // rough / fine
      const mottle = fbm(u, v, rnd(w, 70), rnd(h, 70), 4, seed + 3);
      const detail = fbm(u, v, rnd(w, 9), rnd(h, 9), 2, seed + 5);
      if (d < gap) { // harç / aralık
        H[i] = -2.5 + (detail - 0.5) * 0.8; tone[i] = 0.02; dark[i] = 0.76; sp[i] = 0;
      } else {
        const t = clamp((d - gap) / round), top = Math.sqrt(1 - (1 - t) * (1 - t));
        const fine = pattern === "fine";
        // fine: düz yüzey, düşük kontrastlı tane (koyu arduvaz/boyalı taş); yapı çizgisi yok
        H[i] = fine ? (detail - 0.5) * amp * 0.45 : amp * top + (detail - 0.5) * amp * 0.7 + (mottle - 0.5) * amp * 0.4;
        tone[i] = fine ? clamp(0.45 + (id - 0.5) * 0.25 + (mottle - 0.5) * 0.3 + (detail - 0.5) * 0.35) : clamp(0.5 + (id - 0.5) * 0.6 + (mottle - 0.5) * 0.55);
        if (pattern === "flagstone" || pattern === "blocks") {
          const wc = worley(u, v, nx2, ny2, seed + 50); // ince çatlaklar
          if (wc.id > 0.62 && (wc.f2 - wc.f1) * 0.5 * cell2 < 0.8) { H[i] -= 1.4; dark[i] = 0.6; }
        }
      }
    }
  } else if (def.family === "metal") {
    const nxs = rnd(w, 200 / sc), nys = Math.max(2, rnd(h, 1.4)), nxf = rnd(w, 40), nyf = Math.max(2, rnd(h, 1.2));
    // Kenara uzaklığın gradyanı kenarı dik keser; fırça darbeleri teğet boyunca akar (üstte yatay, yanlarda dikey, köşede çapraz).
    // Yön alanı: gradyanın yön tensörü (işaretsiz) güven ağırlığıyla yatay yöne harmanlanıp yumuşatılır; böylece kenardan uzaklaşırken
    // ve köşelerde yön ani kopmaz (eski sürüm 24 px'te yatay yöne sıçrıyordu, dikey kenarlarda işaret titriyordu).
    let ang: Float32Array | undefined, cf: Float32Array | undefined;
    if (dist) {
      const D = Float32Array.from(dist, (d) => Math.min(d, 24)), conf0 = new Float32Array(n), sxx = new Float32Array(n), sxy = new Float32Array(n), syy = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, gx = D[y * w + Math.min(w - 1, x + 1)] - D[y * w + Math.max(0, x - 1)], gy = D[Math.min(h - 1, y + 1) * w + x] - D[Math.max(0, y - 1) * w + x];
        const gl = Math.hypot(gx, gy), conf = gl > 0.2 ? smooth(clamp((24 - D[i]) / 10)) : 0, nx = gl > 0.2 ? gx / gl : 0, ny = gl > 0.2 ? gy / gl : 0;
        sxx[i] = conf * nx * nx; sxy[i] = conf * nx * ny; syy[i] = conf * ny * ny + (1 - conf); conf0[i] = conf;
      }
      const bxx = boxBlur(sxx, w, h, 3), bxy = boxBlur(sxy, w, h, 3), byy = boxBlur(syy, w, h, 3);
      ang = new Float32Array(n); cf = boxBlur(conf0, w, h, 3);
      // teğet = gradyan yönü + 90°; (-75°,105°] aralığına indirilir (dikey teğet bu aralığın ortasında, işaret titremez)
      for (let i = 0; i < n; i++) {
        let t = 0.5 * Math.atan2(2 * bxy[i], bxx[i] - byy[i]) + Math.PI / 2;
        while (t > (105 * Math.PI) / 180) t -= Math.PI;
        while (t <= (-75 * Math.PI) / 180) t += Math.PI;
        ang[i] = t;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
      let streak: number, scratch: number;
      // Yatay fırça her yerde hesaplanır; kenara yakınken, kenara paralel fırça (across = kenara uzaklık: çizgiler kenarı birebir izler,
      // dönen koordinat tabanının yarattığı girdap yok; along yalnız düşük frekanslı) çapraz geçişle karıştırılır.
      streak = vnoise(u * nxs, v * nys, nxs, nys, seed);
      scratch = vnoise(u * nxf, v * nyf, nxf, nyf, seed + 4);
      if (ang && cf && cf[i] > 0.001) {
        const c = cf[i], along = x * Math.cos(ang[i]) + y * Math.sin(ang[i]) + 4096, across = dist![i] + 4096;
        streak += c * (vnoise(along / (200 / sc), across / 1.4, 8192, 8192, seed) - streak);
        scratch += c * (vnoise(along / 40, across / 1.2, 8192, 8192, seed + 4) - scratch);
      }
      const mott = fbm(u, v, rnd(w, 120), rnd(h, 120), 3, seed + 9);
      H[i] = (streak - 0.5) * amp * 0.45 + (scratch - 0.5) * amp * 0.25 + (mott - 0.5) * amp * 2.4;
      tone[i] = (mott - 0.5) * 0.28 + Math.cos(2 * Math.PI * (u + v)) * 0.15 + Math.cos(2 * Math.PI * (u - 2 * v) + 1) * 0.05; // geniş parlama süpürmesi (periyodik)
    }
  } else if (def.family === "leather") {
    const cellPx = 9 / sc, nx = Math.max(4, rnd(w, cellPx)), ny = Math.max(4, rnd(h, cellPx));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
      const wo = worley(u, v, nx, ny, seed), t = clamp(((wo.f2 - wo.f1) * 0.5 * cellPx) / 3.2), top = Math.sqrt(1 - (1 - t) * (1 - t));
      const fold = fbm(u, v, rnd(w, 70), rnd(h, 70), 4, seed + 3), crease = Math.pow(1 - Math.abs(2 * fold - 1), 7), detail = fbm(u, v, rnd(w, 5), rnd(h, 5), 2, seed + 5);
      H[i] = amp * top * 0.7 - crease * amp * 1.3 + (detail - 0.5) * 0.25;
      tone[i] = clamp(0.5 + (wo.id - 0.5) * 0.22 + (fold - 0.5) * 0.4 - crease * 0.28);
      dark[i] = 1 - crease * 0.4; sp[i] = def.spec * (0.5 + top);
    }
  } else if (def.family === "marble") {
    const k1 = Math.max(1, Math.round(w / (230 / sc))), k2 = Math.max(1, Math.round(h / (260 / sc)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
      const warp = fbm(u, v, rnd(w, 150), rnd(h, 150), 4, seed + 1), warp2 = fbm(u, v, rnd(w, 90), rnd(h, 90), 3, seed + 8);
      const ph = Math.PI * (k1 * u + k2 * v) * 2 + warp * 11, ph2 = Math.PI * 2 * ((k1 + 1) * u - k2 * v) + warp2 * 8;
      const vein = Math.pow(1 - Math.abs(Math.sin(ph / 2)), 22), vein2 = Math.pow(1 - Math.abs(Math.sin(ph2 / 2)), 30);
      const cloud = fbm(u, v, rnd(w, 60), rnd(h, 60), 4, seed + 4);
      tone[i] = clamp(0.8 + (cloud - 0.5) * 0.3 - vein * 0.6 - vein2 * 0.35);
      H[i] = (cloud - 0.5) * amp * 0.5 - vein * 0.15;
      sp[i] = def.spec * (1 - vein * 0.5);
    }
  } else if (def.family === "weave") {
    const c = (def.weaveCell ?? 4) / sc, ni = Math.max(4, Math.round(w / c / 4) * 4), nj = Math.max(4, Math.round(h / c / 4) * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h, fx = u * ni, fy = v * nj, ci = Math.floor(fx), cj = Math.floor(fy), a = fx - ci, b = fy - cj;
      const over = def.twill ? mod(ci + cj, 4) < 2 : mod(ci + cj, 2) === 0;
      const thread = Math.sin(Math.PI * (over ? b : a)), fiber = vnoise(u * ni * 5, v * nj * 5, ni * 5, nj * 5, seed + 6), fold = fbm(u, v, rnd(w, 140), rnd(h, 140), 3, seed + 2);
      H[i] = amp * thread * 0.8 + (fiber - 0.5) * amp * 0.2;
      tone[i] = clamp(0.42 + thread * 0.3 + (fiber - 0.5) * 0.2 + (fold - 0.5) * 0.25);
      dark[i] = 0.68 + 0.32 * thread; sp[i] = def.spec * (0.35 + 0.65 * thread);
    }
  } else if (def.family === "paper") {
    // Yaşlanma wear (0..1) ile üretilir: leke bulutları, benek (foxing), katlanma izleri ve (tileable değilse) kenar yanığı.
    const age = p.wear ?? 0, fx = rnd(w, 11), fy = rnd(h, 11);
    const nvx = Math.max(2, rnd(w, 17 / sc)), nvy = Math.max(2, rnd(h, 17 / sc)); // papirüs şerit sayıları
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
      let t: number, hh: number, dk = 1;
      if (def.paper === "papyrus") {
        // iki katman şerit: dikey ve yatay; yamalarla hangisinin üstte olduğu değişir. Şerit aralarında koyu dikiş.
        const sv = u * nvx, sh = v * nvy, seamV = Math.abs(sv - Math.round(sv)), seamH = Math.abs(sh - Math.round(sh));
        const fibV = vnoise(u * w / 2.2, v * h / 110, rnd(w, 2.2), rnd(h, 110), seed), fibH = vnoise(u * w / 110, v * h / 2.2, rnd(w, 110), rnd(h, 2.2), seed + 3);
        const top = smooth(clamp((fbm(u, v, rnd(w, 120), rnd(h, 120), 3, seed + 9) - 0.3) / 0.22)); // çoğunlukla dikey şerit üstte, yer yer yatay katman görünür
        const strip = hash2(Math.floor(top > 0.5 ? sv : sh), 7, seed) - 0.5; // şerit başına ton farkı
        const fib = fibV * top + fibH * (1 - top), seam = Math.pow(1 - Math.min(1, (top * seamV + (1 - top) * seamH) * 5), 3);
        t = clamp(0.6 + strip * 0.16 + (fib - 0.5) * 0.45 - seam * 0.18 + (fbm(u, v, rnd(w, 120), rnd(h, 120), 3, seed + 4) - 0.5) * 0.3);
        hh = amp * ((fib - 0.5) * 0.9 - seam * 0.7); dk = 1 - seam * 0.12;
      } else {
        const cloud = fbm(u, v, rnd(w, 110), rnd(h, 110), 4, seed + 4), pore = fbm(u, v, rnd(w, 4), rnd(h, 4), 2, seed + 6);
        const vein = Math.pow(1 - Math.abs(2 * fbm(u, v, rnd(w, 75), rnd(h, 75), 4, seed + 12) - 1), 9) * 0.55; // organik çatallanan damar (kıvrık, kesik)
        t = clamp(0.66 + (cloud - 0.5) * 0.45 - vein * 0.12 + (pore - 0.5) * 0.12);
        hh = amp * ((pore - 0.5) * 0.7 - vein * 0.35);
      }
      if (age > 0) {
        const stain = smooth(clamp((fbm(u, v, rnd(w, 170), rnd(h, 170), 4, seed + 11) - 0.5) / 0.2)) * age;
        const wf = worley(u, v, fx, fy, seed + 21), rad = 3 + wf.id * 7, spot = wf.id < 0.12 * age && wf.f1 * 11 < rad ? smooth(1 - (wf.f1 * 11) / rad) : 0; // benek: bazı hücrelerde yumuşak koyu leke
        const jit = (fbm(u, v, 6, 6, 2, seed + 31) - 0.5) * 0.05, crease = Math.max(Math.exp(-Math.pow((u - 0.33 - jit) * w / 2.2, 2)), Math.exp(-Math.pow((u - 0.66 - jit) * w / 2.2, 2)), Math.exp(-Math.pow((v - 0.5 - jit) * h / 2.2, 2))) * age;
        let burn = 0;
        if (dist) { const ragged = 0.7 + 0.6 * fbm(u, v, rnd(w, 40), rnd(h, 40), 3, seed + 41); burn = Math.pow(clamp(1 - dist[i] / ((8 + age * 36) * ragged)), 1.6) * age; }
        t = clamp(t - stain * 0.3 - spot * 0.45 - burn * 0.55 - crease * 0.1);
        hh += -crease * 1.6 - spot * 0.2 - burn * 0.5; dk *= 1 - stain * 0.18 - spot * 0.3 - burn * 0.45 - crease * 0.22;
      }
      tone[i] = t; H[i] = hh; dark[i] = dk;
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

export const NOISE_STYLES = ["clouds", "grain", "cells", "streaks"] as const;
export type NoiseStyle = (typeof NOISE_STYLES)[number];
export interface NoiseParams { style: NoiseStyle; scale?: number; contrast?: number; seed?: number; colors?: string[] }

/**
 * Gürültü katmanı: maskeli şekli renk rampasıyla (varsayılan siyah→beyaz) boyanmış prosedürel gürültüyle doldurur; RGBA (alfa = maske).
 * clouds: bulut/leke · grain: piksel taneli gren · cells: Voronoi hücre · streaks: yatay çizik/fırça. Tüm gürültü periyodiktir (tile'da dikişsiz).
 * Tek başına anlamı overlay/multiply/screen blend ve maskelerle birleşince ortaya çıkar (kir, pas lekesi, gren, ışık).
 */
// fbm doğal olarak dar aralıkta (0.25..0.75): bulut/çizik için varsayılan kontrast yüksek tutulur.
export function noiseRgba(w: number, h: number, mask: Float32Array, p: NoiseParams): Uint8Array {
  const sc = p.scale ?? 1, seed = p.seed ?? 1, ct = p.contrast ?? (p.style === "clouds" ? 2.2 : p.style === "streaks" ? 1.5 : 1), ramp = rampFn(p.colors ?? ["#000000", "#ffffff"]), out = new Uint8Array(w * h * 4);
  const rnd = (base: number, per: number) => Math.max(1, Math.round(base / per));
  const cells = Math.max(2, rnd(w, 24 / sc)), cellsY = Math.max(2, rnd(h, 24 / sc));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = (x + 0.5) / w, v = (y + 0.5) / h;
    let n: number;
    if (p.style === "clouds") n = fbm(u, v, rnd(w, 120 / sc), rnd(h, 120 / sc), 5, seed);
    else if (p.style === "grain") n = hash2(x, y, seed);
    else if (p.style === "cells") { const wo = worley(u, v, cells, cellsY, seed); n = clamp(wo.f1 * 1.2) * 0.6 + wo.id * 0.4; }
    else n = 0.65 * vnoise(u * rnd(w, 140 / sc), v * rnd(h, 1.6), rnd(w, 140 / sc), rnd(h, 1.6), seed) + 0.35 * vnoise(u * rnd(w, 40 / sc), v * rnd(h, 1.1), rnd(w, 40 / sc), rnd(h, 1.1), seed + 5);
    const c = ramp(clamp((n - 0.5) * ct + 0.5)), o = i * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = Math.round(clamp(mask[i]) * 255);
  }
  return out;
}

/** Maskelenmiş şekli malzemeyle boyar; RGBA (alfa = maske) döndürür. */
export function shadeMaterial(inp: MaterialInput): Uint8Array {
  const { w, h, mask } = inp, n = w * h, def = DEFS[inp.fill.preset];
  const dist = inp.tileable ? new Float32Array(n).fill(1e9) : edgeDistance(mask, w, h);
  const F = fields(def, inp.fill, w, h, inp.tileable ? undefined : dist);
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
  const wear = def.family === "paper" ? 0 : inp.fill.wear ?? 0, wseed = (inp.fill.seed ?? 1) + 77;
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
