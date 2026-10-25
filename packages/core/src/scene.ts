import { z } from "zod";

/** UMG widget türlerinin yaptığımız alt kümesi. */
export const NODE_TYPES = [
  "CanvasPanel", "HorizontalBox", "VerticalBox", "Overlay", "Border", "Image", "TextBlock", "Button", "ProgressBar",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

const Margin = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }).strict();
export type Margin = z.infer<typeof Margin>;

const anchor = z.number().min(0).max(1);

/**
 * UMG slot: parent'ın child'a verdiği yerleşim ayarları.
 * CanvasPanel: anchors/offsets/alignment/autoSize. Box, Overlay, Border: padding/hAlign/vAlign (+ Box'ta fill).
 * Canvas offsets, UMG gibi: anchor noktaysa (min==max) left/top = konum, right/bottom = boyut;
 * anchor gerilmişse left/top/right/bottom = kenar boşlukları.
 */
export const SlotSchema = z.object({
  anchors: z.object({ minX: anchor, minY: anchor, maxX: anchor, maxY: anchor }).strict().optional(),
  offsets: Margin.optional(),
  alignment: z.object({ x: z.number(), y: z.number() }).strict().optional(),
  autoSize: z.boolean().optional(),
  padding: Margin.optional(),
  hAlign: z.enum(["Fill", "Left", "Center", "Right"]).optional(),
  vAlign: z.enum(["Fill", "Top", "Center", "Bottom"]).optional(),
  fill: z.number().positive().optional(), // Box'ta Fill kuralı ağırlığı; yoksa Auto
}).strict();
export type Slot = z.infer<typeof SlotSchema>;

const assetRef = z.object({ asset: z.string() }).strict();

/** Node'un türüne göre anlamlı özellikleri (id/type/children hariç). */
export const nodePropShape = {
  name: z.string().optional(),
  slot: SlotSchema.optional(),
  brush: z.object({ asset: z.string() }).strict().optional(), // Border, Image; Button: normal durum; ProgressBar: oluk (arka plan)
  states: z.object({ hovered: assetRef.optional(), pressed: assetRef.optional(), disabled: assetRef.optional() }).strict().optional(), // Button durum brush'ları
  fill: assetRef.optional(), // ProgressBar dolgu brush'ı
  percent: z.number().min(0).max(1).optional(), // ProgressBar doluluk
  inset: z.number().min(0).optional(), // ProgressBar: dolgunun oluk içindeki boşluğu (px)
  size: z.object({ x: z.number().positive(), y: z.number().positive() }).strict().optional(), // Image/ProgressBar boyutu
  text: z.string().optional(), // TextBlock
  fontSize: z.number().positive().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "renk #RRGGBB veya #RRGGBBAA olmalı").optional(),
};

export interface Node {
  id: string;
  type: NodeType;
  name?: string;
  slot?: Slot;
  brush?: { asset: string };
  states?: { hovered?: { asset: string }; pressed?: { asset: string }; disabled?: { asset: string } };
  fill?: { asset: string };
  percent?: number;
  inset?: number;
  size?: { x: number; y: number };
  text?: string;
  fontSize?: number;
  color?: string;
  children: Node[];
}

export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum(NODE_TYPES),
    ...nodePropShape,
    children: z.array(NodeSchema),
  }).strict(),
);

export const WidgetSchema = z.object({
  id: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  root: NodeSchema,
});
export type Widget = z.infer<typeof WidgetSchema>;

export function* walk(n: Node, parent?: Node): Generator<{ node: Node; parent?: Node }> {
  yield { node: n, parent };
  for (const c of n.children) yield* walk(c, n);
}

export const findNode = (root: Node, id: string) => {
  for (const e of walk(root)) if (e.node.id === id) return e;
};

/** Child kabul eden türler ve üst sınırı. */
const MAX_CHILDREN: Record<NodeType, number> = {
  CanvasPanel: Infinity, HorizontalBox: Infinity, VerticalBox: Infinity, Overlay: Infinity,
  Border: 1, Image: 0, TextBlock: 0, Button: 1, ProgressBar: 0,
};
export function assertCanHaveChild(parent: Node) {
  if (parent.children.length >= MAX_CHILDREN[parent.type]) {
    throw new Error(`${parent.type} (${parent.id}) daha fazla child alamaz (üst sınır ${MAX_CHILDREN[parent.type]})`);
  }
}

/** Özelliklerin türle uyumunu denetler (ör. TextBlock'a brush verilemez). */
export function assertPropsFit(type: NodeType, p: Partial<Node>) {
  const bad = (k: string, ok: string) => { throw new Error(`'${k}' sadece ${ok} için geçerli, ${type} için değil`); };
  if (p.brush && !["Border", "Image", "Button", "ProgressBar"].includes(type)) bad("brush", "Border/Image/Button/ProgressBar");
  if (p.states && type !== "Button") bad("states", "Button");
  if ((p.fill || p.percent !== undefined || p.inset !== undefined) && type !== "ProgressBar") bad("fill/percent/inset", "ProgressBar");
  if (p.size && type !== "Image" && type !== "ProgressBar") bad("size", "Image/ProgressBar");
  if ((p.text !== undefined || p.fontSize || p.color) && type !== "TextBlock") bad("text/fontSize/color", "TextBlock");
}
