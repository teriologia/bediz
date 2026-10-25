import type { Asset } from "@bediz/core";

export const assets = new Map<string, Asset>();

// Editör (SSE) dinleyicileri; her değişiklikte çağrılır.
const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
export const notify = () => listeners.forEach((fn) => fn());

export function getAsset(id: string): Asset {
  const a = assets.get(id);
  if (!a) throw new Error(`asset yok: ${id}`);
  return a;
}
