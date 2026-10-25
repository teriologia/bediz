import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notify, fonts } from "./state.js";
import { measureText, registerFont } from "./text.js";

export function registerFontTools(server: McpServer) {
  server.tool(
    "register_font",
    "Kendi yazı tipini (.ttf/.otf/.woff) projeye kaydeder. Sonra TextBlock'larda `font: <id>` ver: önizleme ve yerleşim bu fontla ölçülür/çizilir " +
    "(font'ta olmayan glifler Roboto'ya düşer). Unreal'a aktarım için fontu UE'de bir kez içe aktarıp (Content Browser'a sürükle) `ueAsset` olarak " +
    "Font asset yolunu ver (/Game/.../Ad_Font ya da /Game/.../Ad_Font.Ad_Font); export_unreal_plan TextBlock'a bunu bağlar, ueAsset yoksa hata verir.",
    { id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), file: z.string(), ueAsset: z.string().regex(/^\/Game\/[A-Za-z0-9_\/.\-]+$/).optional() },
    async ({ id, file, ueAsset }) => {
      const path = resolve(file);
      if (!existsSync(path)) throw new Error(`font dosyası yok: ${path}`);
      registerFont(id, path); // bozuk dosyada burada fırlatır, kayıt eklenmez
      fonts.set(id, { file: path, ueAsset });
      notify();
      return { content: [{ type: "text" as const, text: JSON.stringify({ id, file: path, ueAsset: ueAsset ?? null, sample: measureText("HARİTALAR Çöl", 20, id) }) }] };
    },
  );
}
