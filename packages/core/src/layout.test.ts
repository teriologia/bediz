import assert from "node:assert/strict";
import { layoutWidget } from "./layout.js";
import { NodeSchema, assertCanHaveChild, assertPropsFit, type Node, type Widget } from "./scene.js";

const n = (id: string, type: Node["type"], extra: Partial<Node> = {}, children: Node[] = []): Node => ({ id, type, ...extra, children });
const widget = (root: Node, width = 800, height = 600): Widget => ({ id: "w", width, height, root });
const none = () => undefined;

// Canvas: merkez anchor + pivot, ve gerilmiş anchor
const canvas = widget(n("root", "CanvasPanel", {}, [
  n("c", "Overlay", { slot: { anchors: { minX: .5, minY: .5, maxX: .5, maxY: .5 }, offsets: { left: 0, top: 0, right: 200, bottom: 100 }, alignment: { x: .5, y: .5 } } }),
  n("s", "Overlay", { slot: { anchors: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, offsets: { left: 10, top: 20, right: 30, bottom: 40 } } }),
]));
const L = layoutWidget(canvas, none);
assert.deepEqual(L.get("c"), { x: 300, y: 250, w: 200, h: 100 });
assert.deepEqual(L.get("s"), { x: 10, y: 20, w: 760, h: 540 });

// HorizontalBox: Auto + Fill(1) + Fill(2), vAlign Center
const box = widget(n("root", "HorizontalBox", {}, [
  n("a", "Image", { size: { x: 50, y: 20 }, slot: { vAlign: "Center" } }),
  n("b", "Overlay", { slot: { fill: 1 } }),
  n("f", "Overlay", { slot: { fill: 2, padding: { left: 10, top: 0, right: 0, bottom: 0 } } }),
]), 300, 100);
const B = layoutWidget(box, none);
assert.deepEqual(B.get("a"), { x: 0, y: 40, w: 50, h: 20 });
assert.deepEqual(B.get("b"), { x: 50, y: 0, w: 250 / 3, h: 100 });
assert.deepEqual(B.get("f"), { x: 50 + 250 / 3 + 10, y: 0, w: (500 / 3) - 10, h: 100 });

// VerticalBox Auto boyutu + Border padding + autoSize canvas
const v = widget(n("root", "CanvasPanel", {}, [
  n("bd", "Border", { slot: { autoSize: true, offsets: { left: 5, top: 5, right: 0, bottom: 0 } } }, [
    n("col", "VerticalBox", { slot: { padding: { left: 4, top: 4, right: 4, bottom: 4 } } }, [
      n("i1", "Image", { size: { x: 30, y: 10 } }),
      n("i2", "Image", { size: { x: 40, y: 10 } }),
    ]),
  ]),
]));
const V = layoutWidget(v, none);
assert.deepEqual(V.get("bd"), { x: 5, y: 5, w: 48, h: 28 }); // 40+8, 20+8
assert.deepEqual(V.get("i2"), { x: 9, y: 19, w: 40, h: 10 });

// Şema ve kural denetimleri
assert.throws(() => NodeSchema.parse({ ...n("x", "Image"), bogus: 1 }));
assert.throws(() => assertCanHaveChild(n("t", "TextBlock")));
assert.throws(() => assertCanHaveChild(n("b", "Border", {}, [n("k", "Image")])));
assert.throws(() => assertPropsFit("TextBlock", { brush: { asset: "a" } }));
console.log("layout ok");
