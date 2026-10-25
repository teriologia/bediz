import assert from "node:assert/strict";
import { toUnrealBrush } from "./slice.js";
const a = { id: "p", path: "p.png", width: 100, height: 50, slice: { left: 10, top: 5, right: 20, bottom: 10 } };
assert.deepEqual(toUnrealBrush(a).Margin, { Left: 0.1, Top: 0.1, Right: 0.2, Bottom: 0.2 });
assert.throws(() => toUnrealBrush({ ...a, slice: { left: 60, top: 0, right: 40, bottom: 0 } }));
assert.throws(() => toUnrealBrush({ ...a, slice: undefined }));
console.log("core ok");
