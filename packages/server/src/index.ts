import { basename, resolve } from "node:path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SliceSchema, detectSlice, toUnrealBrush, validateSlice } from "@bediz/core";
import { assets, getAsset, notify, openProject } from "./state.js";
import { renderNineSlice } from "./render.js";
import { startHttp } from "./http.js";
import { registerSceneTools } from "./scene-tools.js";
import { registerDesignTools } from "./design-tools.js";
import { registerUnrealTools } from "./unreal-tools.js";
import { registerComponentTools } from "./component-tools.js";

// Proje dosyası: BEDIZ_PROJECT, yoksa çalışma klasöründeki bediz.project.json.
// shortcut: her değişiklikte tüm dosya yeniden yazılır; büyük projelerde artımlı yazıma geç.
const projectPath = resolve(process.env.BEDIZ_PROJECT ?? "bediz.project.json");
openProject(projectPath);
console.error(`bediz project: ${projectPath} (${assets.size} asset)`);
startHttp(Number(process.env.BEDIZ_PORT ?? 5757));

const server = new McpServer({ name: "bediz", version: "0.0.1" });
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

server.tool(
  "register_asset",
  "Bir texture dosyasını kaydeder; boyutu dosyadan okunur. id verilmezse dosya adı kullanılır.",
  { path: z.string(), id: z.string().optional() },
  async ({ path, id }) => {
    const abs = resolve(path);
    const { width, height } = await sharp(abs).metadata();
    if (!width || !height) throw new Error(`görsel okunamadı: ${abs}`);
    const a = { id: id ?? basename(abs).replace(/\.[^.]+$/, ""), path: abs, width, height };
    assets.set(a.id, a);
    notify();
    return text(a);
  },
);

server.tool(
  "set_slice",
  "Asset için 9-slice kenarlarını (piksel) belirler.",
  { id: z.string(), slice: SliceSchema },
  async ({ id, slice }) => {
    const a = getAsset(id);
    validateSlice(slice, a.width, a.height);
    a.slice = slice;
    notify();
    return text(a);
  },
);

server.tool(
  "auto_detect_slice",
  "Görselin kenar piksellerini analiz edip 9-slice değerlerini önerir. apply=true ise asset'e uygular; sonucu render_preview ile kontrol et.",
  { id: z.string(), tolerance: z.number().int().min(0).max(255).default(2), apply: z.boolean().default(false) },
  async ({ id, tolerance, apply }) => {
    const a = getAsset(id);
    const { data, info } = await sharp(a.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const d = detectSlice(data, info.width, info.height, tolerance);
    if (apply) { a.slice = d.slice; notify(); }
    return text({ ...d, applied: apply });
  },
);

server.tool(
  "render_preview",
  "Asset'i verilen boyutta 9-slice olarak çizer ve PNG döndürür (sonucu görüp slice'ı düzeltmek için).",
  { id: z.string(), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096) },
  async ({ id, width, height }) => {
    const png = await renderNineSlice(getAsset(id), width, height);
    return { content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }] };
  },
);

server.tool(
  "export_unreal_brush",
  "Asset'in 9-slice'ını Unreal UMG Brush (Box, normalize Margin) olarak döndürür.",
  { id: z.string() },
  async ({ id }) => text(toUnrealBrush(getAsset(id))),
);

registerSceneTools(server);
registerDesignTools(server);
registerUnrealTools(server);
registerComponentTools(server);

await server.connect(new StdioServerTransport());
