import type { Margin, Node, Slot, Widget } from "./scene.js";

export interface Rect { x: number; y: number; w: number; h: number }
export type AssetSize = (assetId: string) => { w: number; h: number } | undefined;
/** Metin ölçücü (gerçek font ölçüsü sunucudan enjekte edilir); verilmezse karakter başına 0.6×fontSize tahmini. */
export type TextMeasure = (text: string, fontSize: number) => { w: number; h: number };
const approxText: TextMeasure = (t, fs) => ({ w: Math.ceil(t.length * fs * 0.6), h: Math.ceil(fs * 1.25) });

const ZERO: Margin = { left: 0, top: 0, right: 0, bottom: 0 };
const pad = (s?: Slot) => s?.padding ?? ZERO;

/**
 * Widget'ın her node'u için rect hesaplar (widget'ın sol üstü 0,0).
 * Yazı boyutu measureText ile ölçülür (varsayılan: kaba tahmin).
 */
export function layoutWidget(widget: Widget, assetSize: AssetSize, measureText: TextMeasure = approxText): Map<string, Rect> {
  const out = new Map<string, Rect>();

  const measure = (n: Node): { w: number; h: number } => {
    switch (n.type) {
      case "Image": {
        if (n.size) return { w: n.size.x, h: n.size.y };
        const s = n.brush && assetSize(n.brush.asset);
        return s ?? { w: 0, h: 0 };
      }
      case "TextBlock": return measureText(n.text ?? "", n.fontSize ?? 16);
      case "Border":
      case "Button": return n.children[0] ? outer(n.children[0]) : { w: 0, h: 0 };
      case "ProgressBar": {
        if (n.size) return { w: n.size.x, h: n.size.y };
        const s = n.brush && assetSize(n.brush.asset);
        return s ?? { w: 100, h: 20 };
      }
      case "HorizontalBox": return fold(n, (a, b) => a + b, Math.max);
      case "VerticalBox": return fold(n, Math.max, (a, b) => a + b);
      case "Overlay": return fold(n, Math.max, Math.max);
      case "CanvasPanel": return { w: 0, h: 0 };
    }
  };
  // Slot padding'i dahil child boyutu.
  const outer = (c: Node) => {
    const d = measure(c), p = pad(c.slot);
    return { w: d.w + p.left + p.right, h: d.h + p.top + p.bottom };
  };
  const fold = (n: Node, fw: (a: number, b: number) => number, fh: (a: number, b: number) => number) =>
    n.children.reduce((acc, c) => { const o = outer(c); return { w: fw(acc.w, o.w), h: fh(acc.h, o.h) }; }, { w: 0, h: 0 });

  /** Child'ı hücresine slot padding ve hizalamayla yerleştirir. */
  const place = (cell: Rect, c: Node): Rect => {
    const p = pad(c.slot), d = measure(c);
    const x = cell.x + p.left, y = cell.y + p.top;
    const w = Math.max(0, cell.w - p.left - p.right), h = Math.max(0, cell.h - p.top - p.bottom);
    const ha = c.slot?.hAlign ?? "Fill", va = c.slot?.vAlign ?? "Fill";
    const rw = ha === "Fill" ? w : d.w, rh = va === "Fill" ? h : d.h;
    return {
      x: ha === "Center" ? x + (w - rw) / 2 : ha === "Right" ? x + w - rw : x,
      y: va === "Center" ? y + (h - rh) / 2 : va === "Bottom" ? y + h - rh : y,
      w: rw, h: rh,
    };
  };

  const arrange = (n: Node, r: Rect): void => {
    out.set(n.id, r);
    switch (n.type) {
      case "CanvasPanel":
        for (const c of n.children) arrange(c, canvasSlot(c, r));
        break;
      case "HorizontalBox":
      case "VerticalBox": {
        const horiz = n.type === "HorizontalBox";
        const main = (c: Node) => (horiz ? outer(c).w : outer(c).h);
        const autos = n.children.filter((c) => !c.slot?.fill);
        const weight = n.children.reduce((s, c) => s + (c.slot?.fill ?? 0), 0);
        const left = Math.max(0, (horiz ? r.w : r.h) - autos.reduce((s, c) => s + main(c), 0));
        let pos = 0;
        for (const c of n.children) {
          const len = c.slot?.fill ? (left * c.slot.fill) / weight : main(c);
          const cell = horiz ? { x: r.x + pos, y: r.y, w: len, h: r.h } : { x: r.x, y: r.y + pos, w: r.w, h: len };
          arrange(c, place(cell, c));
          pos += len;
        }
        break;
      }
      case "Overlay":
      case "Border":
      case "Button":
        for (const c of n.children) arrange(c, place(r, c));
        break;
    }
  };

  const canvasSlot = (c: Node, r: Rect): Rect => {
    const s = c.slot ?? {};
    const a = s.anchors ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const o = s.offsets ?? { left: 0, top: 0, right: 100, bottom: 100 };
    const al = s.alignment ?? { x: 0, y: 0 };
    const d = s.autoSize ? measure(c) : undefined;
    const axis = (origin: number, len: number, min: number, max: number, o0: number, o1: number, align: number, auto?: number) => {
      const p0 = origin + min * len, p1 = origin + max * len;
      if (min === max) { const size = auto ?? o1; return [p0 + o0 - size * align, size]; }
      return [p0 + o0, p1 - o1 - (p0 + o0)];
    };
    const [x, w] = axis(r.x, r.w, a.minX, a.maxX, o.left, o.right, al.x, d?.w);
    const [y, h] = axis(r.y, r.h, a.minY, a.maxY, o.top, o.bottom, al.y, d?.h);
    return { x, y, w, h };
  };

  arrange(widget.root, { x: 0, y: 0, w: widget.width, h: widget.height });
  return out;
}
