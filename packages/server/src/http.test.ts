import assert from "node:assert/strict";
import { request, get, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { DesignSchema, WidgetSchema } from "@bediz/core";
import { startHttp } from "./http.js";
import { designs, notify, widgets } from "./state.js";

designs.set("frm", DesignSchema.parse({ id: "frm", kind: "frame9", width: 64, height: 64, slice: { left: 16, top: 16, right: 16, bottom: 16 }, layers: [
  { id: "back", kind: "box", inset: 0, fill: { kind: "solid", color: "#336699" } },
  { id: "dot", kind: "ellipse", cx: 32, cy: 32, rx: 8, ry: 8, fill: { kind: "solid", color: "#ffcc00" } },
] }));
widgets.set("W 1", WidgetSchema.parse({ id: "W 1", width: 200, height: 100, root: { id: "Root", type: "CanvasPanel", children: [
  { id: "T", type: "TextBlock", text: "Selam", fontSize: 20, slot: { offsets: { left: 10, top: 10, right: 100, bottom: 30 } }, children: [] },
] } }));

const server = startHttp(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as AddressInfo).port;

/** fetch yerine ham http: Host/Origin başlıklarını serbestçe verebilmek için. */
const call = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Promise<{ status: number; headers: IncomingMessage["headers"]; body: Buffer }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c)).on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject).end();
  });
const jsonOf = (r: { body: Buffer }) => JSON.parse(r.body.toString());

// proje özeti
const proj = jsonOf(await call("/api/project"));
assert.deepEqual(proj.designs.map((d: { id: string }) => d.id), ["frm"]);
assert.equal(proj.designs[0].layers, 2);
assert.match(proj.designs[0].hash, /^[0-9a-f]{8}$/);
assert.equal(proj.widgets[0].id, "W 1");

// tasarım: JSON ve PNG; hide parametresi katmanı gizler
assert.equal(jsonOf(await call("/api/design/frm")).slice.left, 16);
const png = await call("/api/design/frm.png");
assert.equal(png.status, 200);
assert.equal(png.headers["content-type"], "image/png");
const px = async (buf: Buffer) => { const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); const o = (32 * info.width + 32) * info.channels; return [info.width, info.height, data[o], data[o + 1], data[o + 2]]; };
assert.deepEqual(await px(png.body), [64, 64, 255, 204, 0]); // ortadaki sarı nokta
assert.deepEqual((await px((await call("/api/design/frm.png?hide=dot")).body)).slice(2), [51, 102, 153]); // nokta gizli → mavi zemin
assert.deepEqual((await px((await call("/api/design/frm.png?hide=yok,dot")).body)).slice(2), [51, 102, 153], "bilinmeyen id yok sayılır");

// widget: id boşluk içerebilir; JSON rect'ler ve PNG
const w = jsonOf(await call("/api/widget/W%201"));
assert.deepEqual(w.rects.T, { x: 10, y: 10, w: 100, h: 30 });
assert.equal(w.rects.Root.w, 200);
const wp = await sharp((await call("/api/widget/W%201.png")).body).metadata();
assert.deepEqual([wp.width, wp.height], [200, 100]);

// bulunamayanlar ve yalnızca GET
assert.equal((await call("/api/design/yok")).status, 404);
assert.equal((await call("/api/widget/yok")).status, 404);
assert.equal((await call("/api/design/..%2f..%2fx")).status, 404);
assert.equal((await call("/api/project", {}, "POST")).status, 405);

// güvenlik: yabancı Host (DNS rebinding) ve yabancı Origin reddedilir, izinli Origin yansıtılır
assert.equal((await call("/api/project", { Host: "evil.example.com" })).status, 403);
assert.equal((await call("/api/project", { Origin: "http://evil.example.com" })).status, 403);
const ok = await call("/api/project", { Origin: "http://localhost:5173" });
assert.equal(ok.status, 200);
assert.equal(ok.headers["access-control-allow-origin"], "http://localhost:5173");
assert.equal((await call("/api/project")).headers["access-control-allow-origin"], undefined, "Origin yoksa CORS başlığı yok (asla *)");
assert.equal((await call("/api/project", { Origin: `http://127.0.0.1:${port}` })).status, 200, "aynı köken serbest");
// dosya sistemi: yol atlatma statik sunumdan dosya sızdırmaz
const trav = await call("/..%2f..%2f..%2fpackage.json");
assert.notEqual(trav.status, 200);

// SSE: notify() olay yollar
const sse = await new Promise<string>((resolve, reject) => {
  const req = get({ host: "127.0.0.1", port, path: "/events", headers: { Host: `127.0.0.1:${port}` } }, (res) => {
    res.on("data", (c) => { const s = String(c); if (s.includes("data: change")) { req.destroy(); resolve(s); } else if (s.startsWith(": ok")) notify(); });
  });
  req.on("error", (e) => (String(e).includes("socket hang up") ? undefined : reject(e)));
  setTimeout(() => reject(new Error("SSE olayı gelmedi")), 4000);
});
assert.match(sse, /data: change/);

server.closeAllConnections();
server.close();
console.log("http ok");
