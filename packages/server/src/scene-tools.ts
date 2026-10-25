import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  NODE_TYPES, NodeSchema, SlotSchema, WidgetSchema, assertCanHaveChild, assertPropsFit, findNode, layoutWidget,
  nodePropShape, walk, type Node, type Widget,
} from "@bediz/core";
import { assets, getWidget, notify, widgets } from "./state.js";
import { renderWidget } from "./render-scene.js";
import { measureText } from "./text.js";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const nodeType = z.enum(NODE_TYPES);

const checkBrush = (n: Partial<Node>) => {
  if (n.brush && !assets.has(n.brush.asset)) throw new Error(`asset yok: ${n.brush.asset}`);
};

/** Değişikliği doğrulayıp kaydeder; geçersizse widget olduğu gibi kalır. */
const commit = (w: Widget, mutate: () => void) => {
  const snapshot = structuredClone(w);
  try {
    mutate();
    WidgetSchema.parse(w);
  } catch (e) {
    Object.assign(w, snapshot); // yarım kalan değişikliği geri al
    throw e;
  }
  notify();
};

const view = (w: Widget) => {
  const rects = layoutWidget(w, (id) => {
    const a = assets.get(id);
    return a && { w: a.width, h: a.height };
  }, measureText);
  const r = Math.round;
  const dump = (n: Node): unknown => {
    const { children, ...rest } = n;
    const rc = rects.get(n.id)!;
    return { ...rest, rect: { x: r(rc.x), y: r(rc.y), w: r(rc.w), h: r(rc.h) }, children: children.map(dump) };
  };
  return { id: w.id, width: w.width, height: w.height, root: dump(w.root) };
};

export function registerSceneTools(server: McpServer) {
  server.tool(
    "create_widget",
    "Yeni bir UMG widget (ekran) oluşturur. width/height tasarım çözünürlüğüdür. Kök node varsayılan CanvasPanel, id 'Root'.",
    { id: z.string().min(1), width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192), rootType: nodeType.default("CanvasPanel") },
    async ({ id, width, height, rootType }) => {
      if (widgets.has(id)) throw new Error(`widget zaten var: ${id}`);
      const w = WidgetSchema.parse({ id, width, height, root: { id: "Root", type: rootType, children: [] } });
      widgets.set(id, w);
      notify();
      return text(view(w));
    },
  );

  server.tool(
    "add_node",
    "Widget'a node ekler. parent verilmezse kök node'un altına eklenir. id verilmezse üretilir. " +
    "Slot, parent türüne göre: CanvasPanel için anchors/offsets/alignment/autoSize; Box/Overlay/Border için padding/hAlign/vAlign (+Box'ta fill). " +
    "Border/Image için brush={asset}; TextBlock için text/fontSize/color(#RRGGBB).",
    {
      widget: z.string(), type: nodeType, parent: z.string().optional(), id: z.string().optional(),
      index: z.number().int().min(0).optional(), ...nodePropShape,
    },
    async ({ widget, type, parent, id, index, ...props }) => {
      const w = getWidget(widget);
      const p = parent ? findNode(w.root, parent)?.node : w.root;
      if (!p) throw new Error(`parent yok: ${parent}`);
      assertPropsFit(type, props);
      checkBrush(props);
      const taken = new Set([...walk(w.root)].map((e) => e.node.id));
      let nid = id;
      if (nid && taken.has(nid)) throw new Error(`id zaten var: ${nid}`);
      for (let i = 1; !nid; i++) if (!taken.has(`${type}_${i}`)) nid = `${type}_${i}`;
      commit(w, () => {
        assertCanHaveChild(p);
        const node: Node = NodeSchema.parse({ id: nid, type, ...props, children: [] });
        p.children.splice(index ?? p.children.length, 0, node);
      });
      return text(view(w));
    },
  );

  server.tool(
    "update_node",
    "Node özelliklerini günceller. slot verilirse mevcut slot ile alan alan birleştirilir (alt nesneler, ör. offsets, tamamen değişir).",
    { widget: z.string(), id: z.string(), ...nodePropShape },
    async ({ widget, id, slot, ...props }) => {
      const w = getWidget(widget);
      const node = findNode(w.root, id)?.node;
      if (!node) throw new Error(`node yok: ${id}`);
      assertPropsFit(node.type, props);
      checkBrush(props);
      commit(w, () => {
        Object.assign(node, props);
        if (slot) node.slot = SlotSchema.parse({ ...node.slot, ...slot });
      });
      return text(view(w));
    },
  );

  server.tool(
    "remove_node",
    "Node'u (ve altındakileri) siler. Kök node silinemez.",
    { widget: z.string(), id: z.string() },
    async ({ widget, id }) => {
      const w = getWidget(widget);
      const hit = findNode(w.root, id);
      if (!hit) throw new Error(`node yok: ${id}`);
      if (!hit.parent) throw new Error("kök node silinemez");
      commit(w, () => { hit.parent!.children = hit.parent!.children.filter((c) => c.id !== id); });
      return text(view(w));
    },
  );

  server.tool(
    "get_widget",
    "Widget ağacını, her node'un hesaplanmış rect'iyle (x,y,w,h piksel) döndürür. widget verilmezse widget listesi döner.",
    { widget: z.string().optional() },
    async ({ widget }) =>
      text(widget ? view(getWidget(widget)) : [...widgets.values()].map((w) => ({ id: w.id, width: w.width, height: w.height }))),
  );

  server.tool(
    "render_widget",
    "Widget'ı PNG olarak çizer (sonucu görüp düzeltmek için). background: #RRGGBB.",
    { widget: z.string(), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2a2a32") },
    async ({ widget, background }) => {
      const png = await renderWidget(getWidget(widget), assets, background);
      return { content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }] };
    },
  );
}
