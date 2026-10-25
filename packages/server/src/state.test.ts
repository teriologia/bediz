import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assets, notify, openProject } from "./state.js";

const dir = mkdtempSync(join(tmpdir(), "bediz-proj-"));
const file = join(dir, "p.bediz.json");

openProject(file); // dosya yok → boş başla
assert.equal(assets.size, 0);

const a = { id: "x", path: join(dir, "art", "x.png"), width: 64, height: 32, slice: { left: 4, top: 4, right: 4, bottom: 4 } };
assets.set("x", a);
notify();
assert.equal(JSON.parse(readFileSync(file, "utf8")).assets[0].path, "art/x.png"); // göreli yazılır

openProject(file); // yeniden aç → aynı veri, mutlak yola çözülmüş
assert.deepEqual(assets.get("x"), a);

writeFileSync(file, "{ bozuk");
assert.throws(() => openProject(file), /okunamadı/);
console.log("state ok");
