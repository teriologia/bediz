import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { unrealPlan } from "@bediz/core";
import { assets, getWidget, projectDir } from "./state.js";

export function registerUnrealTools(server: McpServer) {
  server.tool(
    "export_unreal_plan",
    "Bir bediz widget'ını Unreal Engine'e aktarmak için sıralı, doğrulanmış unreal-mcp çağrı listesi üretir: klasör, doku importu ve UI doku ayarları, " +
    "widget blueprint, node ağacı (brush/margin/tiling, slot yerleşimi, yazı), derleme, kaydetme. Planı Unreal'da ÇALIŞTIRMAZ; adımları unreal-mcp'nin call_tool'uyla " +
    "sırayla uygula (howToRun'a bak) ya da dönen dosyayı `node tools/run-unreal-plan.mjs <dosya>` ile çalıştır. Widget'taki tüm asset'ler önce export_design ile dışa aktarılmış olmalı " +
    "(create_container bunu zaten yapar). folder: /Game/... altında yeni/boş bir klasör seç; kullanıcıdan onay almadan uygulama. " +
    "sizeBox verilmezse: tam ekran widget'lara (create_main_menu vb.) SizeBox sarılmaz, diğerlerine widget boyutunda sarılır. " +
    "Uygulamadan sonra dokuları doğrula (tools/run-unreal-plan.mjs bunu kendisi yapar): UE bazen bozuk (siyah) doku içe aktarabiliyor.",
    { widget: z.string(), folder: z.string().optional(), sizeBox: z.boolean().optional(), verify: z.boolean().default(false) },
    async ({ widget, folder, sizeBox, verify }) => {
      const plan = unrealPlan(getWidget(widget), (id) => assets.get(id), { folder, sizeBox, verify });
      for (const id of Object.keys(plan.textures)) {
        const a = assets.get(id)!;
        if (!existsSync(a.path)) throw new Error(`asset dosyası yok: ${a.path} (export_design ile yeniden dışa aktar)`);
      }
      const dir = join(projectDir(), "unreal");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${widget}.plan.json`);
      writeFileSync(file, JSON.stringify(plan, null, 2));
      return { content: [{ type: "text" as const, text: JSON.stringify({ file, stepCount: plan.steps.length, ...plan }, null, 2) }] };
    },
  );
}
