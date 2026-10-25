import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BUTTON_STATES, SliceSchema, buttonWidget, toUnrealBrush, validateSlice, type Asset } from "@bediz/core";
import { brushes, content, find, sheet, variant } from "./component-tools.js";
import { exportDesign } from "./design-tools.js";
import { renderWidget } from "./render-scene.js";
import { assets, designs, notify, projectDir, widgets } from "./state.js";

export type DerivedState = "hovered" | "pressed" | "disabled";
export interface DeriveOptions { brightness?: number; saturation?: number; glow?: number; glowColor?: string; gloss?: number }

/** Durum başına varsayılanlar (çarpan olarak: 1 = değişmez). */
const DEFAULTS: Record<DerivedState, Required<DeriveOptions>> = {
  hovered: { brightness: 1.16, saturation: 1.1, glow: 0.55, glowColor: "#ffd27a", gloss: 0.1 },
  pressed: { brightness: 0.74, saturation: 0.95, glow: 0, glowColor: "#000000", gloss: -0.3 }, // gloss<0: üstten iç gölge
  disabled: { brightness: 0.6, saturation: 0.1, glow: 0, glowColor: "#000000", gloss: 0 },
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * Bir görselden (yaratıcı/serbest tasarım) buton durumu türetir: renk filtresi (parlaklık/doygunluk) + hover'da iç kenar parıltısı ve üst parlama,
 * pressed'de üstten iç gölge. Alfa (silüet) korunur (disabled hariç hafif solar), boyut ve slice aynı kalır.
 */
export async function deriveState(png: Buffer, state: DerivedState, over: DeriveOptions = {}): Promise<Buffer> {
  const o = { ...DEFAULTS[state], ...over };
  const { data, info } = await sharp(png).ensureAlpha().modulate({ brightness: o.brightness, saturation: o.saturation }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, n = W * H;
  const a8 = Buffer.alloc(n);
  for (let i = 0; i < n; i++) a8[i] = data[i * 4 + 3];
  // İç kenar bandı: alfa − bulanık alfa (yalnız şeklin içinde, kenara yakın yerde güçlü)
  const blurred = await sharp(a8, { raw: { width: W, height: H, channels: 1 } }).blur(Math.max(1, Math.min(W, H) / 40)).raw().toBuffer();
  const [gr, gg, gb] = hex(o.glowColor), out = Buffer.from(data);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, al = a8[i] / 255;
    if (al === 0) continue;
    const band = Math.max(0, Math.min(1, ((a8[i] - blurred[i]) / 255) * 2.4)), top = Math.max(0, 1 - y / (H * 0.42));
    for (let c = 0; c < 3; c++) {
      let v = out[i * 4 + c];
      if (o.glow > 0) v += ([gr, gg, gb][c] - v) * band * o.glow;
      if (o.gloss > 0) v += (255 - v) * top * o.gloss;
      else if (o.gloss < 0) v *= 1 + top * o.gloss;
      out[i * 4 + c] = Math.max(0, Math.min(255, v));
    }
    if (state === "disabled") out[i * 4 + 3] = Math.round(a8[i] * 0.92);
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

const Opt = z.object({ brightness: z.number().min(0.1).max(2.5).optional(), saturation: z.number().min(0).max(2.5).optional(), glow: z.number().min(0).max(1).optional(), glowColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), gloss: z.number().min(-1).max(1).optional() }).strict();

export function registerDeriveTools(server: McpServer) {
  server.tool(
    "derive_button_states",
    "Serbest/yaratıcı bir tasarımı (kendi çizdiğin buton görseli) çalışan bir butona çevirir: kaynak görselden hovered, pressed ve disabled hâllerini renk filtresi + iç kenar parıltısı/gölge ile türetir, " +
    "`<id>_normal|_hovered|_pressed|_disabled` asset'lerini ve etiketli Button widget'ını oluşturur. source: export edilmiş asset id'si ya da design id'si (otomatik export edilir). " +
    "Slice varsa (frame9 ya da slice parametresi) Box olarak gerilir; yoksa sabit boyutlu Image (kanatlı/süslü, gerilmeyen butonlar için). hovered/pressed/disabled ile filtreleri ezebilirsin " +
    "(brightness/saturation çarpan, glow 0..1, glowColor, gloss: >0 üst parlama, <0 üstten iç gölge). Dört durumu tek görselde gösterir. UE'de export_unreal_plan ile aktarılır.",
    {
      id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), source: z.string(), slice: SliceSchema.optional(),
      label: z.string().max(60).optional(), fontSize: z.number().int().min(8).max(96).optional(), textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      width: z.number().int().min(20).max(2048).optional(), height: z.number().int().min(20).max(1024).optional(),
      hovered: Opt.optional(), pressed: Opt.optional(), disabled: Opt.optional(),
    },
    async (input) => {
      let src: Asset | undefined = assets.get(input.source);
      if (!src && designs.has(input.source)) src = await exportDesign(designs.get(input.source)!);
      if (!src) throw new Error(`kaynak yok: ${input.source} (asset ya da design id'si ver)`);
      const slice = input.slice ?? src.slice;
      if (slice) validateSlice(slice, src.width, src.height);
      const png = await sharp(src.path).png().toBuffer(), dir = join(projectDir(), "art");
      mkdirSync(dir, { recursive: true });
      const made: Asset[] = [];
      const put = async (state: (typeof BUTTON_STATES)[number], buf: Buffer) => {
        const a: Asset = { id: `${input.id}_${state}`, path: join(dir, `${input.id}_${state}.png`), width: src!.width, height: src!.height, ...(slice && { slice }) };
        writeFileSync(a.path, buf);
        assets.set(a.id, a);
        made.push(a);
      };
      await put("normal", png);
      for (const s of ["hovered", "pressed", "disabled"] as const) await put(s, await deriveState(png, s, input[s]));
      const states = Object.fromEntries(BUTTON_STATES.map((s) => [s, `${input.id}_${s}`])) as Record<(typeof BUTTON_STATES)[number], string>;
      const widget = buttonWidget(input.id, states, {
        width: input.width ?? src.width, height: input.height ?? src.height, label: input.label ?? "", fontSize: input.fontSize ?? 22, color: input.textColor ?? "#ffffff",
      });
      widgets.set(widget.id, widget);
      notify();
      const pngs: Buffer[] = [];
      for (const s of BUTTON_STATES) pngs.push(await renderWidget(variant(widget, (root) => { find(root, "Button")!.brush = { asset: states[s] }; }), assets, "#2a2a32"));
      return content({
        widget: { id: widget.id, width: widget.width, height: widget.height }, states, mode: slice ? "9-slice (Box, gerilir)" : "sabit boyutlu (Image)", slice: slice ?? null,
        assets: made.map((a) => ({ id: a.id, size: `${a.width}x${a.height}`, slice: a.slice, unrealBrush: toUnrealBrush(a) })),
      }, await sheet(pngs, "column"));
    },
  );
}
