import assert from "node:assert/strict";
import { makeSeamless } from "./seamless.js";

// Yatay rampa: sarma noktasında 255'lik sıçrama var. Dikişsizden sonra sıçrama komşu farkı kadar olmalı.
const N = 64, ramp = new Uint8Array(N * N * 4);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) ramp.set([x * 4, x * 4, x * 4, 255], (y * N + x) * 4);
const seam = (d: Uint8Array) => Math.abs(d[(N - 1) * 4] - d[0]);
assert.ok(seam(ramp) > 200);
const s = makeSeamless(ramp, N, N);
assert.ok(seam(s) <= 8, `dikiş hâlâ ${seam(s)}`);
assert.equal(s[3], 255);
assert.equal(s.length, ramp.length);
console.log("seamless ok");
