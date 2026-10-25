import sharp from "sharp";
import {
  compileDesign, expandLayers, makeSeamless, shadeMaterial, withInnerShadow, withShadow,
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

/**
 * Tasarımı PNG'ye çizer. Katmanlar sırayla çizilir: `material` dolgulu olanlar CPU hattında, diğerleri SVG'de.
 * shortcut: her katman tuval boyutunda ayrı rasterlanır; çok katmanlı ve çok büyük (2048²) tasarımlarda yavaşlar.
 */
export async function renderDesignPng(d: Design, background?: string): Promise<Buffer> {
  const parts: sharp.OverlayOptions[] = [];
  for (const l of expandLayers(d)) {
    const layerParts = isMaterial(l) ? await materialLayer(d, l) : [{ input: await sharp(svgOf(d, l)).png().toBuffer() }];
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
