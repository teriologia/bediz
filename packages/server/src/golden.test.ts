// Görsel regresyon: kit (iki stil) ve iki ekran, `golden/` altındaki referans PNG'lerle piksel farkı eşiğiyle karşılaştırılır.
// Bilinçli görünüm değişikliğinden sonra referansları yenile:  UPDATE_GOLDEN=1 node dist/golden.test.js
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { dialogRecipe, mainMenuRecipe, uiKitRecipe, type ComponentRecipe, type ScreenRecipe } from "@bediz/core";
import { install, sheet } from "./component-tools.js";
import { renderWidget } from "./render-scene.js";
import { assets, openProject } from "./state.js";
import { measureText } from "./text.js";

const GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), "../golden"), UPDATE = !!process.env.UPDATE_GOLDEN;
// Eşikler: librsvg/sharp sürümleri arasında kenar antialias farkı olur; gerçek görünüm değişikliği bunları aşar.
const MEAN_MAX = 1.2, BAD_FRACTION_MAX = 0.004, BAD_DELTA = 28;

/** Ortalama kanal farkı (0..255) ve belirgin farklı piksel oranı; boyut farklıysa sonsuz sayılır. */
export async function compare(a: Buffer, b: Buffer): Promise<{ mean: number; bad: number }> {
  const [ra, rb] = await Promise.all([a, b].map((x) => sharp(x).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))), n = ra.info.width * ra.info.height;
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return { mean: Infinity, bad: 1 };
  let sum = 0, bad = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(ra.data[i * 4 + c] - rb.data[i * 4 + c]));
    sum += m;
    if (m > BAD_DELTA) bad++;
  }
  return { mean: sum / n, bad: bad / n };
}

async function check(name: string, png: Buffer) {
  const file = join(GOLDEN, `${name}.png`);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, png);
    console.log(`  golden ${UPDATE ? "yenilendi" : "oluşturuldu"}: ${name}`);
    return;
  }
  const r = await compare(readFileSync(file), png);
  if (r.mean > MEAN_MAX || r.bad > BAD_FRACTION_MAX) {
    const out = join(tmpdir(), `golden-fail-${name}.png`);
    writeFileSync(out, png);
    assert.fail(`${name}: referanstan saptı (ortalama fark ${r.mean.toFixed(2)}, belirgin piksel %${(r.bad * 100).toFixed(2)}); yeni çıktı: ${out}. Bilinçliyse UPDATE_GOLDEN=1 ile yenile.`);
  }
}

openProject(join(mkdtempSync(join(tmpdir(), "bediz-golden-")), "p.json"));
const half = (png: Buffer) => sharp(png).resize({ width: 640 }).png().toBuffer();
const BG = "#2a2a32";

async function kitSheet(theme: "gold-stone" | "silver-slate", style: "metal" | "ghost"): Promise<Buffer> {
  const kit = uiKitRecipe({ id: `g${style}`, theme, style });
  const pngs: Buffer[] = [];
  for (const r of Object.values(kit.components) as ComponentRecipe[]) { await install(r); pngs.push(await renderWidget(r.widget, assets, BG)); }
  return sheet(pngs, "column", 16);
}
async function screenPng(r: ScreenRecipe) { await install(r); return half(await renderWidget(r.widget, assets)); }

// karşılaştırıcının kendisi: aynı görüntü geçer; kaymış/solmuş görüntü eşiği aşar
{
  const base = await sharp({ create: { width: 120, height: 80, channels: 4, background: "#334455" } })
    .composite([{ input: await sharp({ create: { width: 60, height: 30, channels: 4, background: "#ddaa55" } }).png().toBuffer(), left: 20, top: 20 }]).png().toBuffer();
  assert.deepEqual(await compare(base, base), { mean: 0, bad: 0 });
  const moved = await sharp({ create: { width: 120, height: 80, channels: 4, background: "#334455" } })
    .composite([{ input: await sharp({ create: { width: 60, height: 30, channels: 4, background: "#ddaa55" } }).png().toBuffer(), left: 34, top: 20 }]).png().toBuffer();
  const r = await compare(base, moved);
  assert.ok(r.bad > BAD_FRACTION_MAX, "kaymayı yakalamalı");
  assert.equal((await compare(base, await sharp(base).resize(60, 40).png().toBuffer())).mean, Infinity);
}

// çıktı deterministik: aynı tarif iki kez çizilince birebir aynı (kararsız referans üretmemek için)
const first = await kitSheet("gold-stone", "ghost");
assert.deepEqual(await compare(first, await kitSheet("gold-stone", "ghost")), { mean: 0, bad: 0 }, "çizim deterministik değil");

await check("kit-metal-gold-stone", await kitSheet("gold-stone", "metal"));
await check("kit-ghost-silver-slate", await kitSheet("silver-slate", "ghost"));
await check("screen-menu-ghost", await screenPng(mainMenuRecipe({ id: "gmenu", style: "ghost", theme: "silver-slate" }, measureText)));
await check("screen-dialog-metal", await screenPng(dialogRecipe({ id: "gdlg", message: "Kaydedilmemiş ilerleme kaybolacak. Çıkmak istediğine emin misin?" }, measureText)));
console.log("golden ok");
