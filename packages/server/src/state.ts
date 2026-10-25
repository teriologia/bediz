import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { registerFont } from "./text.js";
import { AssetSchema, DesignSchema, WidgetSchema, type Asset, type Design, type Widget } from "@bediz/core";

export const assets = new Map<string, Asset>();
export const widgets = new Map<string, Widget>();
export const designs = new Map<string, Design>();
/** Kayıtlı fontlar: kimlik → kaynak dosya (+ UE'deki Font asset yolu). */
export const fonts = new Map<string, { file: string; ueAsset?: string }>();

const ProjectSchema = z.object({
  version: z.literal(1),
  assets: z.array(AssetSchema),
  widgets: z.array(WidgetSchema).default([]),
  designs: z.array(DesignSchema).default([]),
  fonts: z.array(z.object({ id: z.string(), file: z.string(), ueAsset: z.string().optional() })).default([]),
});

let projectFile: string | undefined;

/** Proje dosyasının klasörü; dışa aktarılan görseller `art/` altına yazılır. */
export const projectDir = () => {
  if (!projectFile) throw new Error("proje açık değil");
  return dirname(projectFile);
};

/** Proje dosyasını açar (yoksa boş başlar). Bozuksa fırlatır: üzerine yazıp veri kaybetmemek için. */
export function openProject(file: string) {
  projectFile = resolve(file);
  assets.clear();
  widgets.clear();
  designs.clear();
  fonts.clear();
  if (!existsSync(projectFile)) return;
  let parsed;
  try {
    parsed = ProjectSchema.parse(JSON.parse(readFileSync(projectFile, "utf8")));
  } catch (e) {
    throw new Error(`proje dosyası okunamadı (${projectFile}): ${(e as Error).message}`);
  }
  for (const a of parsed.assets) assets.set(a.id, { ...a, path: resolve(dirname(projectFile), a.path) });
  for (const w of parsed.widgets) widgets.set(w.id, w);
  for (const d of parsed.designs) designs.set(d.id, d);
  for (const f of parsed.fonts) {
    const file = resolve(dirname(projectFile), f.file);
    fonts.set(f.id, { file, ueAsset: f.ueAsset });
    try { registerFont(f.id, file); } catch (e) { console.error(`font yüklenemedi (${f.id}): ${(e as Error).message}`); }
  }
}

function save() {
  if (!projectFile) return;
  const dir = dirname(projectFile);
  const data = {
    version: 1,
    // Taşınabilirlik: proje klasöründeki dosyalar göreli yazılır (başka sürücüdeyse mutlak kalır).
    assets: [...assets.values()].map((a) => {
      const rel = relative(dir, a.path);
      return { ...a, path: (isAbsolute(rel) ? rel : rel.replaceAll("\\", "/")) };
    }),
    widgets: [...widgets.values()],
    designs: [...designs.values()],
    fonts: [...fonts].map(([id, f]) => ({ id, file: relative(dir, f.file).replaceAll("\\", "/"), ueAsset: f.ueAsset })),
  };
  const tmp = `${projectFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, projectFile);
}

// Editör (SSE) dinleyicileri; her değişiklikte çağrılır.
const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
export const notify = () => (save(), listeners.forEach((fn) => fn()));

export function getDesign(id: string): Design {
  const d = designs.get(id);
  if (!d) throw new Error(`tasarım yok: ${id}`);
  return d;
}

export function getWidget(id: string): Widget {
  const w = widgets.get(id);
  if (!w) throw new Error(`widget yok: ${id}`);
  return w;
}

export function getAsset(id: string): Asset {
  const a = assets.get(id);
  if (!a) throw new Error(`asset yok: ${id}`);
  return a;
}
