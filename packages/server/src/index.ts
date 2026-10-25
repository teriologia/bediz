import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SliceSchema, toUnrealBrush, validateSlice, type Asset } from "@bediz/core";

// shortcut: bellek içi durum, kalıcı proje dosyası + editör WS senkronu sonraki adım.
const assets = new Map<string, Asset>();

const server = new McpServer({ name: "bediz", version: "0.0.1" });
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

server.tool(
  "register_asset",
  "Bir texture'ı id, dosya yolu ve piksel boyutuyla kaydeder.",
  { id: z.string(), path: z.string(), width: z.number().int().positive(), height: z.number().int().positive() },
  async (a) => { assets.set(a.id, a); return text(a); },
);

server.tool(
  "set_slice",
  "Asset için 9-slice kenarlarını (piksel) belirler.",
  { id: z.string(), slice: SliceSchema },
  async ({ id, slice }) => {
    const a = assets.get(id);
    if (!a) throw new Error(`asset yok: ${id}`);
    validateSlice(slice, a.width, a.height);
    a.slice = slice;
    return text(a);
  },
);

server.tool(
  "export_unreal_brush",
  "Asset'in 9-slice'ını Unreal UMG Brush (Box, normalize Margin) olarak döndürür.",
  { id: z.string() },
  async ({ id }) => {
    const a = assets.get(id);
    if (!a) throw new Error(`asset yok: ${id}`);
    return text(toUnrealBrush(a));
  },
);

await server.connect(new StdioServerTransport());
