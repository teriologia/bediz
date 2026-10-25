import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { AssetSchema, type Asset } from "@bediz/core";

export const assets = new Map<string, Asset>();

const ProjectSchema = z.object({ version: z.literal(1), assets: z.array(AssetSchema) });

let projectFile: string | undefined;

/** Proje dosyasını açar (yoksa boş başlar). Bozuksa fırlatır: üzerine yazıp veri kaybetmemek için. */
export function openProject(file: string) {
  projectFile = resolve(file);
  assets.clear();
  if (!existsSync(projectFile)) return;
  let parsed;
  try {
    parsed = ProjectSchema.parse(JSON.parse(readFileSync(projectFile, "utf8")));
  } catch (e) {
    throw new Error(`proje dosyası okunamadı (${projectFile}): ${(e as Error).message}`);
  }
  for (const a of parsed.assets) assets.set(a.id, { ...a, path: resolve(dirname(projectFile), a.path) });
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
  };
  const tmp = `${projectFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, projectFile);
}

// Editör (SSE) dinleyicileri; her değişiklikte çağrılır.
const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
export const notify = () => (save(), listeners.forEach((fn) => fn()));

export function getAsset(id: string): Asset {
  const a = assets.get(id);
  if (!a) throw new Error(`asset yok: ${id}`);
  return a;
}
