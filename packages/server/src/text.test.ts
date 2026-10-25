import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { measureText, registerFont, textMetrics, textPathData } from "./text.js";

// ölçü: boyutla doğrusal artar, daha uzun metin daha geniş, boş metin 0
const a = measureText("Hello", 20), b = measureText("Hello", 40);
assert.ok(Math.abs(b.w - 2 * a.w) <= 2, `doğrusal değil: ${a.w} vs ${b.w}`);
assert.ok(measureText("Hello World", 20).w > a.w);
assert.equal(measureText("", 20).w, 0);
assert.ok(measureText("WWWW", 20).w > measureText("iiii", 20).w * 2, "orantılı font: W i'den çok geniş");
assert.ok(a.h >= 25 && a.h <= 40, `satır yüksekliği makul değil: ${a.h}`);

// Türkçe harfler (latin-ext) .notdef değil: gerçek ilerleme genişliği var
for (const ch of ["ğ", "ş", "İ", "ı", "ç", "ö", "ü"]) assert.ok(measureText(ch, 40).w > 10, `${ch} ölçülemedi`);
assert.ok(measureText("Çıkış", 24).w > measureText("Cikis", 24).w * 0.8);

// UE kalibrasyonu: canlı UE'de ölçülen metin genişliği (size 60, "RUBY HALL RUBY HALL") ≈ 880 birim (±5%)
const ue = measureText("RUBY HALL RUBY HALL", 60).w;
assert.ok(ue > 836 && ue < 924, `UE ölçüsünden saptı: ${ue}`);
// yol: boş değil, SVG komutları içerir, konuma duyarlı; metrikler tutarlı
const p = textPathData("Ana Menü", 0, 0, 30);
assert.match(p, /^M/);
assert.notEqual(textPathData("Ana Menü", 10, 0, 30), p);
const m = textMetrics(30);
assert.ok(m.ascent > 0 && m.descent > 0 && Math.abs(m.lineHeight - (m.ascent + m.descent)) < 1e-6);
// kullanıcı fontu: kayıttan sonra farklı ölçü verir; Roboto'da olmayan glif yedeğe düşer; kayıtsız kimlik hata verir
registerFont("light", createRequire(import.meta.url).resolve("@fontsource/roboto/files/roboto-latin-300-normal.woff"));
assert.notEqual(measureText("Hello", 20, "light").w, a.w);
assert.ok(measureText("Ğş", 20, "light").w > 0);
assert.notEqual(textPathData("Ana", 0, 0, 30, "light"), textPathData("Ana", 0, 0, 30));
assert.throws(() => measureText("x", 20, "yok"), /kayıtlı değil/);
// harf aralığı: her harfe size×spacing/1000×96/72 px eklenir
const sp = measureText("Hello", 30, undefined, 200);
assert.ok(Math.abs(sp.w - measureText("Hello", 30).w - 5 * 0.2 * 30 * (96 / 72)) <= 2);
console.log("text ok");
