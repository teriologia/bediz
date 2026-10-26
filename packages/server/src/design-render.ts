import sharp from "sharp";
import { assets } from "./state.js";
import {
  compileDesign, displaceRgba, edgeDistance, expandLayers, makeSeamless, noiseRgba, shadeMaterial, withInnerShadow, withShadow,
  type Design, type Shape,
} from "@bediz/core";

type MaterialShape = Shape & { fill: Extract<NonNullable<Shape["fill"]>, { kind: "material" }> };
const isMaterial = (l: Shape): l is MaterialShape => l.fill?.kind === "material";

const svgOf = (d: Design, l: Shape) => Buffer.from(compileDesign({ ...d, layers: [l] }));
const rawPng = (rgba: Uint8Array, w: number, h: number) => sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

/** Malzeme katmanı: SVG'den şekil maskesi → CPU'da boya → CPU efektleri → (varsa) çizgi SVG'si. */
async function materialLayer(d: Design, l: MaterialShape): Promise<sharp.OverlayOptions[]> {
  const { width: w, height: h } = d;
  const maskLayer = { ...l, fill: { kind: "solid", color: "#ffffff" }, stroke: undefined, effects: undefined, opacity: undefined } as Shape;
  const raw = await sharp(svgOf(d, maskLayer)).ensureAlpha().raw().toBuffer();
  const mask = Float32Array.from({ length: w * h }, (_, i) => raw[i * 4 + 3] / 255);

  const effects = l.effects ?? [];
  const bevel = effects.find((e) => e.kind === "bevel");
  let rgba = shadeMaterial({
    w, h, mask, fill: l.fill, tileable: d.kind === "tile",
    bevel: bevel?.kind === "bevel" ? { depth: bevel.depth ?? 4, size: bevel.size, azimuth: bevel.azimuth } : undefined,
  });
  for (const e of effects) {
    if (e.kind === "innerShadow") rgba = withInnerShadow(rgba, w, h, e);
    else if (e.kind === "shadow") rgba = withShadow(rgba, w, h, e);
    else if (e.kind === "glow") rgba = withShadow(rgba, w, h, { dx: 0, dy: 0, blur: e.blur ?? 6, color: e.color ?? "#ffd27a", opacity: e.opacity ?? 0.8 });
  }
  if (l.opacity !== undefined) for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * l.opacity);

  const parts: sharp.OverlayOptions[] = [{ input: await rawPng(rgba, w, h) }];
  if (l.stroke) parts.push({ input: await sharp(svgOf(d, { ...l, fill: undefined, effects: undefined, opacity: l.opacity } as Shape)).png().toBuffer() });
  return parts;
}

type ImageShape = Extract<Shape, { kind: "image" }>;

/** Görsel katmanı: asset PNG'sini kutuya sığdırır (fit), gerekirse çevirir, tuvale yerleştirir. */
async function imageLayer(d: Design, l: ImageShape): Promise<sharp.OverlayOptions[]> {
  const a = assets.get(l.asset);
  if (!a) throw new Error(`image ${l.id}: asset yok: ${l.asset} (import_image/export_design ile oluştur)`);
  const x = Math.round(l.inset ?? l.x ?? 0), y = Math.round(l.inset ?? l.y ?? 0);
  const w = Math.round(l.w ?? (l.inset !== undefined ? d.width - 2 * l.inset : d.width - x)), h = Math.round(l.h ?? (l.inset !== undefined ? d.height - 2 * l.inset : d.height - y));
  let img = sharp(a.path).ensureAlpha().resize(w, h, { fit: l.fit === "cover" ? "cover" : l.fit === "contain" ? "contain" : "fill", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (l.flipX) img = img.flop();
  if (l.flipY) img = img.flip();
  const buf = await img.png().toBuffer(), left = Math.max(0, x), top = Math.max(0, y);
  // tuval dışına taşan kısım kırpılır
  const crop = { left: left - x, top: top - y, width: Math.min(w - (left - x), d.width - left), height: Math.min(h - (top - y), d.height - top) };
  if (crop.width <= 0 || crop.height <= 0) return [];
  const piece = await sharp(buf).extract(crop).png().toBuffer();
  let out = piece;
  if (l.opacity !== undefined) {
    const { data, info } = await sharp(piece).raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * l.opacity);
    out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }
  return [{ input: out, left, top }];
}

type NoiseShape = Shape & { fill: Extract<NonNullable<Shape["fill"]>, { kind: "noise" }> };
const isNoise = (l: Shape): l is NoiseShape => l.fill?.kind === "noise";

/** Gürültü katmanı: SVG'den şekil maskesi → renk rampalı prosedürel gürültü → CPU efektleri (gölge/iç gölge/parıltı). */
async function noiseLayer(d: Design, l: NoiseShape): Promise<sharp.OverlayOptions[]> {
  const { width: w, height: h } = d;
  const raw = await sharp(svgOf(d, { ...l, fill: { kind: "solid", color: "#ffffff" }, stroke: undefined, effects: undefined, opacity: undefined } as Shape)).ensureAlpha().raw().toBuffer();
  let rgba = noiseRgba(w, h, Float32Array.from({ length: w * h }, (_, i) => raw[i * 4 + 3] / 255), l.fill);
  for (const e of l.effects ?? []) {
    if (e.kind === "innerShadow") rgba = withInnerShadow(rgba, w, h, e);
    else if (e.kind === "shadow") rgba = withShadow(rgba, w, h, e);
    else if (e.kind === "glow") rgba = withShadow(rgba, w, h, { dx: 0, dy: 0, blur: e.blur ?? 6, color: e.color ?? "#ffd27a", opacity: e.opacity ?? 0.8 });
  }
  if (l.opacity !== undefined) for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * l.opacity);
  const parts: sharp.OverlayOptions[] = [{ input: await rawPng(rgba, w, h) }];
  if (l.stroke) parts.push({ input: await sharp(svgOf(d, { ...l, fill: undefined, effects: undefined, opacity: l.opacity } as Shape)).png().toBuffer() });
  return parts;
}

type BandShape = Extract<Shape, { kind: "band" }>;

/**
 * Bant katmanı: silüet yolunun maskesi → Öklid kenar mesafesi → [from, to] px aralığı (yarım piksel yumuşatmalı) bant maskesi.
 * Dolgu malzemeyse bant maskesiyle CPU'da boyanır (bevel ve fırça bant kenarlarını izler); değilse dolgu SVG'de tuvale çizilip alfası bantla çarpılır.
 * Ardından CPU efektleri (gölge, iç gölge, parıltı). Bant dışında bevel yalnız malzeme dolgusunda çalışır.
 */
async function bandLayer(d: Design, l: BandShape): Promise<sharp.OverlayOptions[]> {
  if (!l.fill) throw new Error(`band ${l.id}: fill gerekli`);
  const { width: w, height: h } = d, clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const sil = await sharp(svgOf(d, { id: "s", kind: "path", d: l.d, fill: { kind: "solid", color: "#ffffff" } } as Shape)).ensureAlpha().raw().toBuffer();
  const sm = Float32Array.from({ length: w * h }, (_, i) => sil[i * 4 + 3] / 255), dist = edgeDistance(sm, w, h);
  const mask = Float32Array.from(sm, (a, i) => (a === 0 ? 0 : a * clamp01(dist[i] - l.from + 0.5) * (l.to === undefined ? 1 : clamp01(l.to - dist[i] + 0.5))));

  const effects = l.effects ?? [], bevel = effects.find((e) => e.kind === "bevel");
  let rgba: Uint8Array;
  if (l.fill.kind === "material") {
    rgba = shadeMaterial({ w, h, mask, fill: l.fill, tileable: false, bevel: bevel?.kind === "bevel" ? { depth: bevel.depth ?? 4, size: bevel.size, azimuth: bevel.azimuth } : undefined });
  } else {
    const paint = await sharp(svgOf(d, { id: "p", kind: "box", inset: 0, fill: l.fill } as Shape)).ensureAlpha().raw().toBuffer();
    rgba = new Uint8Array(paint);
    for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = Math.round(paint[i * 4 + 3] * mask[i]);
  }
  for (const e of effects) {
    if (e.kind === "innerShadow") rgba = withInnerShadow(rgba, w, h, e);
    else if (e.kind === "shadow") rgba = withShadow(rgba, w, h, e);
    else if (e.kind === "glow") rgba = withShadow(rgba, w, h, { dx: 0, dy: 0, blur: e.blur ?? 6, color: e.color ?? "#ffd27a", opacity: e.opacity ?? 0.8 });
  }
  if (l.opacity !== undefined) for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * l.opacity);
  return [{ input: await rawPng(rgba, w, h) }];
}

/** Sol/üst yarıyı aynalayıp karşı yarının yerine koyar (tek sayıda piksel varsa orta sütun/satır yarıyla gelir, çakışma olmaz). */
async function mirrorHalves(png: Buffer, w: number, h: number, mode: "x" | "y" | "xy"): Promise<Buffer> {
  const half = async (src: Buffer, horizontal: boolean) => {
    const keep = Math.ceil((horizontal ? w : h) / 2), mir = Math.floor((horizontal ? w : h) / 2);
    const region = (n: number) => (horizontal ? { left: 0, top: 0, width: n, height: h } : { left: 0, top: 0, width: w, height: n });
    const a = await sharp(src).extract(region(keep)).png().toBuffer();
    const b = await sharp(src).extract(region(mir))[horizontal ? "flop" : "flip"]().png().toBuffer();
    return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: a, left: 0, top: 0 }, { input: b, left: horizontal ? w - mir : 0, top: horizontal ? 0 : h - mir }]).png().toBuffer();
  };
  let cur = png;
  if (mode !== "y") cur = await half(cur, true);
  if (mode !== "x") cur = await half(cur, false);
  return cur;
}

type MaskOf = NonNullable<Shape["mask"]>;
const transparent = (d: Design) => sharp({ create: { width: d.width, height: d.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });

/** Tek şeklin katman parçaları (maske uygulanmış). Maskeli katman tuvale çizilir, alfası maske değeriyle çarpılır, tek parça olarak döner. */
async function shapeParts(d: Design, l: Shape, cache: Map<string, Float32Array>, stack: string[]): Promise<sharp.OverlayOptions[]> {
  let parts = l.kind === "image" ? await imageLayer(d, l) : l.kind === "band" ? await bandLayer(d, l) : isMaterial(l) ? await materialLayer(d, l) : isNoise(l) ? await noiseLayer(d, l) : [{ input: await sharp(svgOf(d, l)).png().toBuffer() }];
  // bulanıklık tüm efektlerden sonra, maskeden önce (Photoshop'ta filtre sonra katman maskesi gibi: maske kenarı keskin kalır)
  const blur = l.effects?.find((e) => e.kind === "blur");
  if (blur?.kind === "blur") parts = [{ input: await sharp(await transparent(d).composite(parts).png().toBuffer()).blur(Math.max(0.3, blur.radius)).png().toBuffer() }]; // composite sharp'ta bulanıklıktan SONRA çalışır: önce tuvale çiz, sonra bulanıklaştır
  const dist = l.effects?.find((e) => e.kind === "distort");
  if (dist?.kind === "distort") {
    const { data, info } = await transparent(d).composite(parts).raw().toBuffer({ resolveWithObject: true });
    const moved = displaceRgba(data, info.width, info.height, dist.amount, dist.scale ?? 10, dist.seed ?? 1);
    parts = [{ input: await sharp(Buffer.from(moved), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer() }];
  }
  for (const adj of l.effects?.filter((e) => e.kind === "adjust") ?? []) if (adj.kind === "adjust") {
    let img = sharp(await transparent(d).composite(parts).png().toBuffer());
    const c = 1 + (adj.contrast ?? 0); // kontrast: 128 etrafında ölçekle, alfa dokunulmaz
    if (c !== 1) img = sharp(await img.linear([c, c, c, 1], [128 * (1 - c), 128 * (1 - c), 128 * (1 - c), 0]).png().toBuffer());
    img = img.modulate({ brightness: 1 + (adj.brightness ?? 0), saturation: Math.max(0, 1 + (adj.saturation ?? 0)), hue: adj.hue ?? 0 });
    parts = [{ input: await img.png().toBuffer() }];
  }
  if (!l.mask) return parts;
  const m = await maskValues(d, l.mask, cache, stack), { data, info } = await transparent(d).composite(parts).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < m.length; i++) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * m[i]);
  return [{ input: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer() }];
}

/** Maske katmanını (gizli olsa da, kendi maskesi dahil) tuvale çizip 0..1 değerlere çevirir; önbellekli, döngü korumalı. */
async function maskValues(d: Design, m: MaskOf, cache: Map<string, Float32Array>, stack: string[]): Promise<Float32Array> {
  const key = `${m.layer}|${m.use ?? "alpha"}|${m.invert ? 1 : 0}`, hit = cache.get(key);
  if (hit) return hit;
  const ref = d.layers.find((x) => x.id === m.layer);
  if (!ref || stack.includes(m.layer)) throw new Error(`maske katmanı çözülemedi: ${m.layer}`);
  const parts: sharp.OverlayOptions[] = [];
  for (const sh of expandLayers({ ...d, layers: [{ ...ref, hidden: false }] })) parts.push(...(await shapeParts(d, sh, cache, [...stack, m.layer])).map((p) => (sh.blend ? { ...p, blend: sh.blend } : p)));
  const { data } = await transparent(d).composite(parts).raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(d.width * d.height);
  for (let i = 0; i < out.length; i++) {
    const a = data[i * 4 + 3] / 255, v = m.use === "luma" ? ((0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255) * a : a;
    out[i] = m.invert ? 1 - v : v;
  }
  cache.set(key, out);
  return out;
}

/**
 * Tasarımı PNG'ye çizer. Katmanlar sırayla çizilir: `material` dolgulu olanlar CPU hattında, diğerleri SVG'de.
 * `mask` verilen katman, başka bir katmanın alfası/parlaklığıyla çarpılır (gizli katman maske olarak kullanılabilir).
 * shortcut: her katman tuval boyutunda ayrı rasterlanır; çok katmanlı ve çok büyük (2048²) tasarımlarda yavaşlar.
 */
export async function renderDesignPng(d: Design, background?: string): Promise<Buffer> {
  const parts: sharp.OverlayOptions[] = [], cache = new Map<string, Float32Array>();
  for (const l of expandLayers(d)) {
    const layerParts = await shapeParts(d, l, cache, []);
    parts.push(...layerParts.map((p) => (l.blend ? { ...p, blend: l.blend } : p)));
  }
  let img = sharp({ create: { width: d.width, height: d.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts);
  // SVG `texture` dolgusu (librsvg stitchTiles çalışmıyor) dikişsizliği sonradan alır; `material` zaten periyodik.
  if (d.kind === "tile" && d.layers.some((l) => "fill" in l && l.fill?.kind === "texture")) {
    const { data, info } = await sharp(await img.png().toBuffer()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    img = sharp(makeSeamless(data, info.width, info.height), { raw: { width: info.width, height: info.height, channels: 4 } });
  }
  if (d.symmetry) img = sharp(await mirrorHalves(await img.png().toBuffer(), d.width, d.height, d.symmetry));
  return (background ? img.flatten({ background }) : img).png().toBuffer();
}
