import assert from "node:assert/strict";
import { inventoryRecipe, layoutWidget, mainMenuRecipe, settingsRecipe, walk, type Asset, type ScreenRecipe } from "@bediz/core";
import { measureText } from "./text.js";

/** Gerçek (UE'ye kalibre) metin ölçüsüyle: panelin içindeki hiçbir node panelden taşmamalı, yazılar kendi kutusuna sığmalı. */
const check = (r: ScreenRecipe) => {
  const art = new Map<string, Asset>(r.designs.map((d) => [d.id, { id: d.id, path: "", width: d.width, height: d.height }]));
  const L = layoutWidget(r.widget, (id) => art.get(id) && { w: art.get(id)!.width, h: art.get(id)!.height }, measureText);
  const P = L.get("Panel")!;
  for (const { node } of walk(r.widget.root)) {
    if (["Root", "Backdrop", "Panel", "PanelBg", "PanelFrame", "Gem"].includes(node.id)) continue;
    const b = L.get(node.id)!;
    assert.ok(b.x >= P.x - 1 && b.y >= P.y - 1 && b.x + b.w <= P.x + P.w + 1 && b.y + b.h <= P.y + P.h + 1, `${r.widget.id}/${node.id} panelden taşıyor: ${JSON.stringify(b)} panel ${JSON.stringify(P)}`);
    if (node.type === "TextBlock" && node.text) assert.ok(measureText(node.text, node.fontSize ?? 16).w <= b.w + 1, `${node.id} yazısı kutusundan geniş: "${node.text}"`);
  }
  return P;
};

const tr = ["Yeni Oyun", "Devam Et", "Kayıtlı Oyunu Yükle", "Ayarlar", "Çıkış", "Geliştirici Notları"];
const m = check(mainMenuRecipe({ id: "m", title: "KARANLIK ZİNDAN MACERASI", items: tr }, measureText));
assert.ok(m.w > 440, "uzun başlık/etiket paneli genişletti");
check(mainMenuRecipe({ id: "m1" }, measureText));
check(mainMenuRecipe({ id: "m2", fontSize: 40, titleSize: 70, buttonHeight: 90 }, measureText));
check(settingsRecipe({ id: "s", sliders: [{ label: "Genel ses seviyesi", percent: 0.5 }, { label: "Müzik", percent: 1 }], toggles: [{ label: "Tam ekran modunu kullan", on: true }] }, measureText));
check(settingsRecipe({ id: "s2", title: "OYUN AYARLARI VE TERCİHLER" }, measureText));
// 10×8 slot 720 px ekrana sığmaz: sessizce taşmak yerine net hata; ekran büyütülünce sığar
assert.throws(() => inventoryRecipe({ id: "i", columns: 10, rows: 8, slotSize: 56 }, measureText), /ekrana sığmıyor/);
check(inventoryRecipe({ id: "i", columns: 10, rows: 8, slotSize: 56, height: 1080, footer: "Altın: 12.450 · Ağırlık 38/60" }, measureText));
check(inventoryRecipe({ id: "i2", columns: 2, rows: 1, title: "ÇOK UZUN BİR ENVANTER BAŞLIĞI" }, measureText));
console.log("screens(server) ok");
