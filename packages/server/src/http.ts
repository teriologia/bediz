import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { layoutWidget, type Design } from "@bediz/core";
import { renderDesignPng } from "./design-render.js";
import { renderWidget } from "./render-scene.js";
import { assets, designs, onChange, widgets } from "./state.js";
import { measureText } from "./text.js";

/** Derlenmiş editör (npm run build:editor); varsa aynı porttan sunulur. */
const DIST = fileURLToPath(new URL("../../editor/dist/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".map": "application/json", ".ico": "image/x-icon",
};

// Yerel API: sadece loopback host'u ve izinli kökenler. `*` yok: gezilen başka bir site proje verisini okuyamasın.
const HOST_OK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const ORIGINS = (process.env.BEDIZ_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim()).filter(Boolean);

const short = (v: unknown) => createHash("md5").update(JSON.stringify(v)).digest("hex").slice(0, 8);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function send(res: ServerResponse, status: number, body: string | Buffer, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
const json = (res: ServerResponse, v: unknown, status = 200) => send(res, status, JSON.stringify(v));

/** Host (DNS rebinding) ve Origin (CORS) denetimi; geçerliyse CORS başlıklarını ekler. */
function guard(req: IncomingMessage, res: ServerResponse): boolean {
  const host = req.headers.host ?? "";
  if (!HOST_OK.test(host)) return json(res, { error: "host reddedildi" }, 403), false;
  const origin = req.headers.origin;
  if (origin) {
    if (origin !== `http://${host}` && !ORIGINS.includes(origin)) return json(res, { error: "köken reddedildi" }, 403), false;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  return true;
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  if (!existsSync(DIST)) return false;
  const file = normalize(join(DIST, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep) || !existsSync(file) || !statSync(file).isFile()) return false;
  send(res, 200, await readFile(file), MIME[extname(file)] ?? "application/octet-stream");
  return true;
}

function hiddenCopy(d: Design, hide: string[]): Design {
  return hide.length ? { ...d, layers: d.layers.map((l) => (hide.includes(l.id) ? { ...l, hidden: true } : l)) } : d;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!guard(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, { error: "sadece GET" }, 405);
  const url = new URL(req.url ?? "/", "http://localhost"), p = url.pathname;

  if (p === "/api/project") {
    return json(res, {
      designs: [...designs.values()].map((d) => ({ id: d.id, kind: d.kind, width: d.width, height: d.height, layers: d.layers.length, hash: short(d) })),
      widgets: [...widgets.values()].map((w) => ({ id: w.id, width: w.width, height: w.height, hash: short(w) })),
      assets: [...assets.values()].map((a) => ({ id: a.id, width: a.width, height: a.height, slice: a.slice, tile: a.tile })),
    });
  }
  let m = p.match(/^\/api\/design\/([A-Za-z0-9_-]{1,64})(\.png)?$/);
  if (m) {
    const d = designs.get(m[1]);
    if (!d) return json(res, { error: "tasarım yok" }, 404);
    if (!m[2]) return json(res, d);
    return send(res, 200, await renderDesignPng(hiddenCopy(d, (url.searchParams.get("hide") ?? "").split(",").filter(Boolean))), "image/png");
  }
  m = p.match(/^\/api\/widget\/(.+?)(\.png)?$/);
  if (m) {
    const w = widgets.get(decodeURIComponent(m[1]));
    if (!w) return json(res, { error: "widget yok" }, 404);
    if (m[2]) return send(res, 200, await renderWidget(w, assets, url.searchParams.get("bg") === "none" ? undefined : "#2a2a32"), "image/png");
    const rects = layoutWidget(w, (id) => { const a = assets.get(id); return a && { w: a.width, h: a.height }; }, measureText);
    return json(res, { widget: w, rects: Object.fromEntries([...rects].map(([id, r]) => [id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }])) });
  }

  // Eski uçlar (geriye uyumluluk)
  if (p === "/state") return json(res, [...assets.values()]);
  if (p === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": ok\n\n");
    const off = onChange(() => res.write("data: change\n\n"));
    const beat = setInterval(() => res.write(": ♥\n\n"), 25000); // proxy/tarayıcı zaman aşımına karşı
    return void req.on("close", () => { off(); clearInterval(beat); });
  }
  m = p.match(/^\/asset\/(.+)$/);
  const a = m && assets.get(decodeURIComponent(m[1]));
  if (a) {
    try { return send(res, 200, await readFile(a.path), "image/png"); } catch { /* 404'e düş */ }
  }
  if (!p.startsWith("/api/") && (await serveStatic(p, res))) return;
  if (p === "/") return send(res, 200, "bediz: editör derlenmemiş. `npm run build:editor` ya da `npm run dev -w @bediz/editor` (http://localhost:5173).", "text/plain; charset=utf-8");
  json(res, { error: "bulunamadı" }, 404);
}

/** Editör için yerel HTTP (127.0.0.1): /api/*, /events (SSE), derlenmişse editör. */
export function startHttp(port: number): Server {
  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => (res.headersSent ? res.end() : json(res, { error: e.message }, 500)));
  });
  // Başka bir bediz örneği portu tutuyorsa MCP yine de çalışmalı.
  server.on("error", (e) => console.error("bediz http:", e.message));
  server.listen(port, "127.0.0.1");
  return server;
}
