// Smoke test: build every model, check it is a closed, outward-facing solid, write STLs to test/out/.
// Usage: node test/check.js [seed] [quality]
const G = require('../src/gen.js');
const fs = require('fs'), path = require('path');
const seed = +(process.argv[2] ?? 7), quality = +(process.argv[3] ?? 0.7);
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
let failed = 0;
for (const [model, info] of Object.entries(G.MODELS)) {
  const t0 = Date.now();
  const r = G.generate(model, seed, { quality, scale: info.group === 'Props' ? 0.2 : 0.25 });
  const P = r.positions, I = r.indices, edges = new Map();
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3], k = a < b ? a * 4e6 + b : b * 4e6 + a; edges.set(k, (edges.get(k) || 0) + 1); }
    const [a, b, c] = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  let open = 0, pinch = 0; for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) pinch++; }
  const ok = vol > 0 && open === 0;
  if (!ok) failed++;
  fs.writeFileSync(path.join(out, `${model}_seed${seed}.stl`), G.toSTL(P, I, model));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${model.padEnd(15)} ${String(Date.now() - t0).padStart(6)} ms  ${r.size.map((x) => x.toFixed(1)).join(' x ')} mm  ${I.length / 3} tris  open edges ${open}  pinch edges ${pinch}`);
}
process.exit(failed ? 1 : 0);
