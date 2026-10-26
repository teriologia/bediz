import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeSeamless, toUnrealBrush } from "@bediz/core";
import { assets, getAsset, notify, projectDir } from "./state.js";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id sadece harf, rakam, _ ve - içerebilir (dosya adı olur)");
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "renk #RRGGBB olmalı");
const text = (v: unknown) => ({ type: "text" as const, text: JSON.stringify(v, null, 2) });
const preview = async (png: Buffer) => ({ type: "image" as const, data: (await sharp(png).resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).flatten({ background: "#2a2a32" }).png().toBuffer()).toString("base64"), mimeType: "image/png" });

/** PNG'yi art/<id>.png olarak yazar ve asset olarak kaydeder (aynı id varsa üzerine yazar). */
export async function putAsset(assetId: string, png: Buffer, tile?: boolean) {
  const dir = join(projectDir(), "art");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${assetId}.png`), { width, height } = await sharp(png).metadata();
  writeFileSync(path, png);
  const a = { id: assetId, path, width: width!, height: height!, ...(tile && { tile: true }) };
  assets.set(assetId, a);
  notify();
  return a;
}

const rawOf = async (assetId: string) => sharp(getAsset(assetId).path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/** Anahtar renge yakın pikselleri saydamlaştırır: uzaklık ≤ tolerance → tam saydam, tolerance..tolerance+softness arası yumuşak geçiş. */
export function keyAlphaRgba(data: Uint8Array, color: string, tolerance: number, softness: number): Uint8Array {
  const [kr, kg, kb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)), out = Uint8Array.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const dist = Math.hypot(out[i] - kr, out[i + 1] - kg, out[i + 2] - kb), k = softness <= 0 ? (dist > tolerance ? 1 : 0) : Math.min(1, Math.max(0, (dist - tolerance) / softness));
    out[i + 3] = Math.round(out[i + 3] * k);
  }
  return out;
}

/** Izgara hücreleri: kenar boşluğu (margin) ve hücre arası (gap) düşülür; hücre boyutu tam sayıya yuvarlanır. */
export function gridCells(w: number, h: number, cols: number, rows: number, margin = 0, gap = 0) {
  const cw = Math.floor((w - 2 * margin - gap * (cols - 1)) / cols), ch = Math.floor((h - 2 * margin - gap * (rows - 1)) / rows);
  if (cw < 1 || ch < 1) throw new Error("hücre boyutu 1 px'in altında: cols/rows/margin/gap görsele sığmıyor");
  return Array.from({ length: rows * cols }, (_, k) => ({ r: Math.floor(k / cols), c: k % cols })).map(({ r, c }) => ({ r, c, left: margin + c * (cw + gap), top: margin + r * (ch + gap), width: cw, height: ch }));
}

export function registerImageTools(server: McpServer) {
  server.tool(
    "import_image",
    "Dışarıdaki bir görseli (PNG/JPG/WebP) asset olarak içe aktarır: path (bu bilgisayardaki dosya) ya da base64 ver. Sonra tasarımda {kind:'image', asset:<id>} katmanı, crop_asset, key_alpha, make_seamless_asset ve grid_slice ile kullanılır. Yaratıcı hibrit yol: görsel modelle üretilen doku/süs/ikon burada işlenir.",
    { id, path: z.string().optional(), base64: z.string().optional() },
    async ({ id: aid, path, base64 }) => {
      if (!path === !base64) throw new Error("path ya da base64'ten tam biri verilmeli");
      const png = await sharp(path ? readFileSync(path) : Buffer.from(base64!, "base64")).ensureAlpha().png().toBuffer();
      const a = await putAsset(aid, png);
      return { content: [text({ asset: a, unrealBrush: toUnrealBrush(a) }), await preview(png)] };
    },
  );

  server.tool(
    "crop_asset",
    "Asset'ten dikdörtgen bir bölge kesip yeni asset yapar (x, y, width, height px; görsel dışına taşamaz).",
    { source: z.string(), id, x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() },
    async ({ source, id: aid, x, y, width, height }) => {
      const a = getAsset(source);
      if (x + width > a.width || y + height > a.height) throw new Error(`kırpma görsele sığmıyor: kaynak ${a.width}x${a.height}`);
      const png = await sharp(a.path).extract({ left: x, top: y, width, height }).png().toBuffer();
      return { content: [text({ asset: await putAsset(aid, png) }), await preview(png)] };
    },
  );

  server.tool(
    "key_alpha",
    "Arka plan rengini saydamlaştırır (renk anahtarı): color rengine uzaklığı tolerance'ten (0-441) küçük pikseller silinir, softness px aralığında yumuşak geçiş. Düz zeminli üretilmiş görselden süs/ikon ayırmak için (beyaz #ffffff, siyah #000000, yeşil perde). Kenarda renk sızıntısı (halo) kalabilir.",
    { source: z.string(), id, color: Hex, tolerance: z.number().min(0).max(441).default(40), softness: z.number().min(0).max(441).default(30) },
    async ({ source, id: aid, color, tolerance, softness }) => {
      const { data, info } = await rawOf(source), out = keyAlphaRgba(data, color, tolerance, softness);
      const png = await sharp(Buffer.from(out), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
      return { content: [text({ asset: await putAsset(aid, png) }), await preview(png)] };
    },
  );

  server.tool(
    "make_seamless_asset",
    "Asset'i dikişsiz döşenebilir hâle getirir (kenar karışımı) ve tile asset'i olarak kaydeder. Gürültülü dokular için iyi; belirgin motifli görsellerde kontrast düşer, hayalet oluşabilir.",
    { source: z.string(), id },
    async ({ source, id: aid }) => {
      const { data, info } = await rawOf(source);
      const png = await sharp(Buffer.from(makeSeamless(data, info.width, info.height)), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
      return { content: [text({ asset: await putAsset(aid, png, true) }), await preview(png)] };
    },
  );

  server.tool(
    "grid_slice",
    "Asset'i cols x rows ızgarasına bölüp her hücreyi `<prefix>_<satır>_<sütun>` asset'i yapar (sprite sheet, ikon sayfası). margin kenar boşluğu, gap hücre arası boşluk (px). En çok 64 hücre.",
    { source: z.string(), prefix: id, cols: z.number().int().min(1).max(16), rows: z.number().int().min(1).max(16), margin: z.number().int().min(0).default(0), gap: z.number().int().min(0).default(0) },
    async ({ source, prefix, cols, rows, margin, gap }) => {
      if (cols * rows > 64) throw new Error("en çok 64 hücre");
      const a = getAsset(source), cells = gridCells(a.width, a.height, cols, rows, margin, gap), made = [];
      for (const { r, c, ...box } of cells) made.push(await putAsset(`${prefix}_${r}_${c}`, await sharp(a.path).extract(box).png().toBuffer()));
      return { content: [text({ cell: `${cells[0].width}x${cells[0].height}`, assets: made.map((m) => m.id) })] };
    },
  );
}
