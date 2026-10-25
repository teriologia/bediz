import { Application, NineSliceSprite, Texture } from "pixi.js";

const API = `http://127.0.0.1:${new URLSearchParams(location.search).get("port") ?? 5757}`;

type Asset = {
  id: string; path: string; width: number; height: number;
  slice?: { left: number; top: number; right: number; bottom: number };
};

const app = new Application();
await app.init({ resizeTo: window, background: "#1e1e24", antialias: true });
document.body.appendChild(app.canvas);

const wIn = document.querySelector<HTMLInputElement>("#w")!;
const hIn = document.querySelector<HTMLInputElement>("#h")!;
const empty = document.querySelector<HTMLElement>("#empty")!;
const textures = new Map<string, Texture>(); // id → doku; yeniden kayıtta yenilenir

async function texture(a: Asset): Promise<Texture> {
  const key = `${a.id}|${a.path}`;
  let t = textures.get(key);
  if (!t) {
    const blob = await (await fetch(`${API}/asset/${encodeURIComponent(a.id)}?${Date.now()}`)).blob();
    t = Texture.from(await createImageBitmap(blob));
    textures.set(key, t);
  }
  return t;
}

let busy = false, again = false;
async function render() {
  if (busy) return void (again = true);
  busy = true;
  try {
    const assets: Asset[] = await (await fetch(`${API}/state`)).json();
    const w = +wIn.value, h = +hIn.value;
    (document.querySelector("#wv") as HTMLElement).textContent = String(w);
    (document.querySelector("#hv") as HTMLElement).textContent = String(h);
    app.stage.removeChildren().forEach((c) => c.destroy());
    const sliced = assets.filter((a) => a.slice);
    empty.style.display = sliced.length ? "none" : "grid";
    let x = 20, y = 60, rowH = 0;
    for (const a of sliced) {
      const s = a.slice!;
      const sprite = new NineSliceSprite({
        texture: await texture(a),
        leftWidth: s.left, topHeight: s.top, rightWidth: s.right, bottomHeight: s.bottom,
        width: Math.max(w, s.left + s.right), height: Math.max(h, s.top + s.bottom),
      });
      if (x + sprite.width > app.screen.width && x > 20) { x = 20; y += rowH + 20; rowH = 0; }
      sprite.position.set(x, y);
      app.stage.addChild(sprite);
      x += sprite.width + 20;
      rowH = Math.max(rowH, sprite.height);
    }
  } finally {
    busy = false;
    if (again) { again = false; void render(); }
  }
}

wIn.oninput = hIn.oninput = () => void render();
new EventSource(`${API}/events`).onmessage = () => void render();
void render();
