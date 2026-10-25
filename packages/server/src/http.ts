import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { assets, onChange } from "./state.js";

/** Editör için yerel HTTP: /state (JSON), /asset/:id (görsel), /events (SSE). Sadece 127.0.0.1. */
export function startHttp(port: number) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/state") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify([...assets.values()]));
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(": ok\n\n");
      const off = onChange(() => res.write("data: change\n\n"));
      return void req.on("close", off);
    }
    const m = url.pathname.match(/^\/asset\/(.+)$/);
    const a = m && assets.get(decodeURIComponent(m[1]));
    if (a) {
      try { return res.end(await readFile(a.path)); } catch { /* 404'e düş */ }
    }
    res.statusCode = 404;
    res.end();
  });
  // Başka bir bediz örneği portu tutuyorsa MCP yine de çalışmalı.
  server.on("error", (e) => console.error("bediz http:", e.message));
  server.listen(port, "127.0.0.1");
}
