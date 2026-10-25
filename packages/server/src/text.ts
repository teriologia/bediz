import { createRequire } from "node:module";
import type { Font, Glyph } from "opentype.js";

const require = createRequire(import.meta.url);
// opentype.js CJS; dinamik yükleme ESM/CJS arayüz farkını ortadan kaldırır.
const opentype = require("opentype.js") as typeof import("opentype.js");

/**
 * Unreal'ın TextBlock varsayılan fontu Roboto Bold'dur. Önizleme ve yerleşim aynı fontla ölçer/çizer;
 * sistem fontlarına bağlı değildir (yazılar vektör yola çevrilir). Latin-ext: ğ ş İ ı gibi Türkçe harfler için.
 * shortcut: Latin + Latin-ext dışındaki yazı sistemleri (CJK, Kiril...) için yedek yok; eksik glifler boş kutu (.notdef) olur.
 */
const FILES = ["latin", "latin-ext"];
let fonts: Font[] | undefined;
const loaded = (): Font[] => (fonts ??= FILES.map((f) => opentype.loadSync(require.resolve(`@fontsource/roboto/files/roboto-${f}-700-normal.woff`))));

/** Kullanıcı fontları: kimlik → [font, ...Roboto]; kullanıcı fontunda olmayan glifler Roboto'ya düşer (yedek). */
const custom = new Map<string, Font[]>();
export const registerFont = (id: string, file: string) => void custom.set(id, [opentype.loadSync(file), ...loaded()]);
export const hasFont = (id: string) => custom.has(id);
const chain = (id?: string): Font[] => {
  if (id && !custom.has(id)) throw new Error(`font kayıtlı değil: ${id} (register_font ile ekle)`);
  return id ? custom.get(id)! : loaded();
};

/**
 * UE font boyutu puan olarak verilir ve 96 DPI'da pikselleştirilir: px = size × 96/72.
 * Canlı UE 5.8'de ölçüldü (800 birimlik referansa göre): büyük harf yüksekliği oranı 1.343, metin genişliği oranları 1.29–1.35
 * (4/3 = 1.333). Kalan ±3% fark, Roboto sürümü ve ekran görüntüsü çözünürlüğündendir.
 */
export const UE_SIZE_TO_PX = 96 / 72;

function pick(ch: string, id?: string): { font: Font; glyph: Glyph } {
  const fs = chain(id);
  for (const font of fs) {
    const g = font.charToGlyph(ch);
    if (g && g.index > 0) return { font, glyph: g };
  }
  return { font: fs[0], glyph: fs[0].charToGlyph(ch) };
}

/** Karakter karakter yerleşim: ilerleme + aynı font içindeki ikili kerning. */
function layout(text: string, size: number, id?: string): { glyph: Glyph; font: Font; x: number }[] {
  const px = size * UE_SIZE_TO_PX, out: { glyph: Glyph; font: Font; x: number }[] = [];
  let x = 0, prev: { glyph: Glyph; font: Font } | undefined;
  for (const ch of text) {
    const cur = pick(ch, id);
    if (prev && prev.font === cur.font) x += (cur.font.getKerningValue(prev.glyph, cur.glyph) * px) / cur.font.unitsPerEm;
    out.push({ ...cur, x });
    x += ((cur.glyph.advanceWidth ?? 0) * px) / cur.font.unitsPerEm;
    prev = cur;
  }
  out.push({ glyph: undefined as never, font: undefined as never, x }); // son eleman: toplam genişlik
  return out;
}

export function textMetrics(size: number, id?: string) {
  const f = chain(id)[0], px = size * UE_SIZE_TO_PX, k = px / f.unitsPerEm;
  return { ascent: f.ascender * k, descent: -f.descender * k, lineHeight: (f.ascender - f.descender) * k };
}

/** Metnin piksel genişliği ve satır yüksekliği (tek satır). */
export function measureText(text: string, size: number, id?: string): { w: number; h: number } {
  const l = layout(text, size, id);
  return { w: Math.ceil(l[l.length - 1].x), h: Math.ceil(textMetrics(size, id).lineHeight) };
}

/** Metni, sol üstü (x, y) olacak şekilde SVG yol verisine (path d) çevirir. */
export function textPathData(text: string, x: number, y: number, size: number, id?: string): string {
  const base = y + textMetrics(size, id).ascent, px = size * UE_SIZE_TO_PX;
  return layout(text, size, id).slice(0, -1).map((g) => g.glyph.getPath(x + g.x, base, px).toPathData(2)).join("");
}
