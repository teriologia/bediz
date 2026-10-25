import { z } from "zod";

/** 9-slice kenar değerleri, kaynak texture üzerinde piksel cinsinden. */
export const SliceSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  right: z.number().int().min(0),
  bottom: z.number().int().min(0),
});
export type Slice = z.infer<typeof SliceSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  slice: SliceSchema.optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

/** Kenarlar texture'a sığmalı ve merkez bölge boş kalmamalı. */
export function validateSlice(s: Slice, w: number, h: number): void {
  if (s.left + s.right >= w || s.top + s.bottom >= h) {
    throw new Error(`slice ${w}x${h} texture'a sığmıyor (merkez bölge kalmıyor)`);
  }
}

/**
 * Unreal UMG brush: DrawAs=Box, Margin normalize (0-1) ve sıra Left, Top, Right, Bottom.
 */
export function toUnrealBrush(a: Asset) {
  if (!a.slice) throw new Error(`asset ${a.id} için slice tanımlı değil`);
  validateSlice(a.slice, a.width, a.height);
  const { left, top, right, bottom } = a.slice;
  return {
    DrawAs: "Box",
    ImageSize: { X: a.width, Y: a.height },
    Margin: { Left: left / a.width, Top: top / a.height, Right: right / a.width, Bottom: bottom / a.height },
  };
}
