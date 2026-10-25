#!/usr/bin/env node
// export_unreal_plan çıktısını (plan.json) çalışan Unreal Editor'daki unreal-mcp sunucusuna uygular.
// Kullanım: node tools/run-unreal-plan.mjs <plan.json> [--url http://127.0.0.1:8000/mcp] [--out <klasör>]
// Plan Unreal projesine asset ekler (mevcutlara dokunmaz). Hata olursa ilk başarısız adımda durur.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--url" && args[args.indexOf(a) - 1] !== "--out");
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
if (!file) { console.error("Kullanım: node tools/run-unreal-plan.mjs <plan.json> [--url ...] [--out klasör]"); process.exit(2); }
const plan = JSON.parse(readFileSync(file, "utf8"));
const URL_ = opt("--url", "http://127.0.0.1:8000/mcp"), OUT = resolve(opt("--out", dirname(resolve(file))));

let sid, n = 0;
async function rpc(method, params, notify = false) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sid ? { "Mcp-Session-Id": sid } : {}), "MCP-Protocol-Version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, ...(notify ? {} : { id: ++n }) }),
  });
  sid ??= r.headers.get("mcp-session-id") ?? undefined;
  const t = await r.text();
  if (notify || !t) return;
  const j = t.startsWith("event:") || t.startsWith("data:") ? JSON.parse(t.split("\n").find((l) => l.startsWith("data:")).slice(5)) : JSON.parse(t);
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

const vars = {};
const resolveRefs = (v) => {
  if (Array.isArray(v)) return v.map(resolveRefs);
  if (v && typeof v === "object") {
    if (typeof v.$ref === "string") {
      const [name, part] = v.$ref.split(".");
      const val = vars[name]?.[part];
      if (!val) throw new Error(`referans çözülemedi: ${v.$ref}`);
      return val;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x)]));
  }
  return v;
};

await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "bediz-run-unreal-plan", version: "0" } });
await rpc("notifications/initialized", {}, true);
console.log(`Plan: ${plan.blueprint} (${plan.steps.length} adım) → ${URL_}`);

for (const [i, step] of plan.steps.entries()) {
  const label = `[${i + 1}/${plan.steps.length}] ${step.tool}${step.note ? " — " + step.note : ""}`;
  try {
    if (step.tool === "CaptureEditorImage") await new Promise((r) => setTimeout(r, 4000)); // editörün sekmeyi çizmesi için
    const res = await rpc("tools/call", { name: "call_tool", arguments: { toolset_name: step.toolset, tool_name: step.tool, arguments: resolveRefs(step.arguments) } });
    const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
    if (res.isError) throw new Error(text.slice(0, 400));
    let data; try { data = JSON.parse(text).returnValue; } catch { data = text; }
    if (data === false || data === null && /Create|Compile|save|set_/.test(step.tool)) throw new Error(`araç başarısız döndü (${JSON.stringify(data)})`);
    if (step.save) {
      if (!data?.widget) throw new Error("AddWidget sonucunda widget yok");
      vars[step.save] = { widget: data.widget, slot: data.slot };
    }
    if (step.tool === "CaptureEditorImage" && data?.data) {
      mkdirSync(OUT, { recursive: true });
      const png = resolve(OUT, `${plan.blueprint.split("/").pop()}.png`);
      writeFileSync(png, Buffer.from(data.data, "base64"));
      console.log(`${label} ✓ → ${png}`);
    } else console.log(`${label} ✓`);
  } catch (e) {
    if (step.optional) { console.log(`${label} (isteğe bağlı) ✗ ${e.message}`); continue; }
    console.error(`${label} ✗ ${e.message}`);
    console.error("Durduruldu. UE'de yarım kalan asset'ler olabilir; plan klasörünü silip tekrar deneyebilirsin.");
    process.exit(1);
  }
}

// Doku doğrulaması: UE bazen bozuk (ör. tamamen siyah) doku içe aktarabiliyor ve widget'ta sessizce beyaz/siyah görünüyor.
// Her dokunun UE'deki önizlemesinin ortalama parlaklığı kaynak PNG ile karşılaştırılır (yalnızca opak kaynaklar; sharp yoksa atlanır).
let sharp;
try { sharp = (await import("sharp")).default; } catch { console.log("(sharp yok: doku doğrulaması atlandı)"); }
const bad = [];
if (sharp) {
  const mean = async (input) => { const st = await sharp(input).stats(); return { v: st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3, opaque: st.isOpaque }; };
  for (const st of plan.steps.filter((x) => x.tool === "import_file")) {
    const path = `${st.arguments.folder_path}/${st.arguments.asset_name}`;
    try {
      const src = await mean(st.arguments.source_file);
      if (!src.opaque) continue; // saydam dokularda önizleme farklı birleştirilir; karşılaştırma güvenilmez
      const res = await rpc("tools/call", { name: "call_tool", arguments: { toolset_name: "EditorToolset.EditorAppToolset", tool_name: "CaptureAssetImage", arguments: { assetPath: path } } });
      const out = JSON.parse((res.content ?? []).map((c) => c.text ?? "").join("")).returnValue;
      const ue = await mean(Buffer.from(out.data, "base64"));
      if (Math.abs(ue.v - src.v) > Math.max(10, src.v * 0.5)) bad.push(`${path}: UE parlaklığı ${ue.v.toFixed(0)}, kaynak ${src.v.toFixed(0)}`);
    } catch (e) { console.log(`(doku doğrulanamadı: ${path}: ${e.message.slice(0, 80)})`); }
  }
}
if (bad.length) {
  console.error("✗ Bozuk görünen doku(lar):\n  " + bad.join("\n  "));
  console.error("Çözüm: UE'de bu asset'i silip (AssetTools.delete) aynı kaynaktan yeniden içe aktar (import_file + doku ayarları), ya da planı yeni bir klasöre tekrar uygula.");
  process.exit(3);
}
console.log("Tamam.");
