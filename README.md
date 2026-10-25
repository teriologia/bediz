# bediz

AI destekli oyun UI aracı: MCP üzerinden 9-slice tabanlı UI tasarımı, hedef motor Unreal Engine 5.8 (UMG Brush export).

- `packages/core` — şema, 9-slice doğrulama, Unreal export
- `packages/server` — MCP sunucusu (stdio)
- `packages/editor` — canlı önizleme (yapılacak)

```
npm install && npm run build && npm test
```

## Unreal Engine'e aktarma

Bediz doğrudan Unreal'a bağlanmaz; AI istemcisine bediz ve unreal-mcp birlikte eklenir. `export_unreal_plan` bir widget için doğrulanmış çağrı listesini üretir
(klasör, doku importu ve UI doku ayarları, widget blueprint, brush/margin/tiling, slot yerleşimi, yazı, derleme, kaydetme) ve projedeki `unreal/<widget>.plan.json` dosyasına yazar.
Adımları AI `call_tool` ile sırayla uygulayabilir, ya da tek komutla:

```
node tools/run-unreal-plan.mjs <proje>/unreal/<widget>.plan.json [--url http://127.0.0.1:8000/mcp] [--out klasör]
```

Plan Unreal projesine yeni asset ekler (mevcutlara dokunmaz); yeni/boş bir `/Game/...` klasörü seç. UE 5.8'de Border/Image/TextBlock, Canvas/Box/Overlay slotları ve 9-slice/tiling brush'ları doğrulandı.

## Editör (canlı önizleme)

AI tool çağırdıkça tasarımları ve widget'ları tarayıcıda canlı gösterir (salt okunur).

```
npm run build:editor      # bir kez; sonra bediz sunucusu editörü aynı porttan sunar
# MCP sunucusu çalışırken: http://127.0.0.1:5757/
npm run dev -w @bediz/editor   # geliştirme: http://localhost:5173 (sunucuya 5757'den bağlanır)
```

- **Son değişikliği izle:** AI bir tasarım/widget oluşturunca ya da değiştirince editör otomatik ona geçer.
- **Tasarım:** 9-slice için gerilmiş önizleme (genişlik/yükseklik kaydırıcıları) ya da kaynak + dilim çizgileri; tile için döşenmiş görünüm ve tile ızgarası; katmanları göz kutularıyla gizleme (sadece önizleme, tasarım değişmez).
- **Widget:** bediz'in render'ı; üzerine gelince node çerçevesi ve `boyut @konum`, sağda node ağacı. Tekerlek: yakınlaştır, sürükle: kaydır, `F`: sığdır, `1`: 1:1.
- **Güvenlik:** API yalnızca 127.0.0.1'de dinler; `Host` ve `Origin` doğrulanır (CORS `*` yok). Başka bir geliştirme kökeni için `BEDIZ_ORIGINS` (virgüllü).
