// ============================================================================
// Procedural terrain bits for 28mm: dead trees, skulls, ribcages.
// Pure JS, no dependencies. Exposes generate(model, seed, params) ->
// { positions: Float32Array, indices: Uint32Array, size:[x,y,z] } in mm.
// ============================================================================
const GEN = (() => {
  // ---------- seeded RNG ----------
  function makeRng(seed) {
    let a = (Math.imul((seed >>> 0) ^ 0x9E3779B9, 2654435761) >>> 0) || 1;
    const random = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    const rng = {
      random,
      uniform: (lo, hi) => lo + (hi - lo) * random(),
      normal(m = 0, s = 1) {
        if (spare !== null) { const v = spare; spare = null; return m + s * v; }
        let u = 0; while (u === 0) u = random();
        const v = random(), mag = Math.sqrt(-2 * Math.log(u));
        spare = mag * Math.sin(2 * Math.PI * v);
        return m + s * mag * Math.cos(2 * Math.PI * v);
      },
      int: (lo, hi) => lo + Math.floor(random() * (hi - lo)),   // [lo, hi)
      choice: (arr) => arr[Math.floor(random() * arr.length)],
      normal3() { return [rng.normal(), rng.normal(), rng.normal()]; },
    };
    return rng;
  }

  // ---------- vectors ----------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lin = (a, b, n) => Array.from({ length: n }, (_, i) => n === 1 ? a : a + (b - a) * i / (n - 1));
  function rotToward(d, axis, ang) {
    const k = unit(axis), c = Math.cos(ang), s = Math.sin(ang);
    return unit(add(add(mul(d, c), mul(cross(k, d), s)), mul(k, dot(k, d) * (1 - c))));
  }
  const matMul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  const matVec = (M, v) => M.map((row) => dot(row, v));
  function rotMatrix(yaw = 0, pitch = 0, roll = 0) {
    const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
    const Rz = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]];
    const Ry = [[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]];
    const Rx = [[1, 0, 0], [0, cr, -sr], [0, sr, cr]];
    return matMul(matMul(Rz, Ry), Rx);
  }

  // ---------- smooth 3D value noise (no UV mapping, no poles) ----------
  function hash3(x, y, z) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a000 = hash3(xi, yi, zi), a100 = hash3(xi + 1, yi, zi), a010 = hash3(xi, yi + 1, zi), a110 = hash3(xi + 1, yi + 1, zi);
    const a001 = hash3(xi, yi, zi + 1), a101 = hash3(xi + 1, yi, zi + 1), a011 = hash3(xi, yi + 1, zi + 1), a111 = hash3(xi + 1, yi + 1, zi + 1);
    const x00 = a000 + (a100 - a000) * u, x10 = a010 + (a110 - a010) * u;
    const x01 = a001 + (a101 - a001) * u, x11 = a011 + (a111 - a011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;                       // 0..1
  }

  // ---------- primitives (op: add | sub, k: blend radius) ----------
  const cone = (a, b, r1, r2, op = 'add', k = 1.5) => ({ t: 'cone', a: [...a], b: [...b], r1, r2, op, k });
  const ell = (c, r, op = 'add', k = 1.5) => ({ t: 'ell', c: [...c], r: [...r], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], op, k });
  const sph = (c, r, op = 'add', k = 1.5) => ell(c, [r, r, r], op, k);
  // A chain is one continuous tube: hard-joined segments (no bulge at joints), soft-blended with everything else.
  const chainOf = (segs, k) => ({ t: 'chain', segs, op: 'add', k });
  const chain = (pts, radii, k = 1.0) => [chainOf(pts.slice(0, -1).map((p, i) => cone(p, pts[i + 1], radii[i], radii[i + 1], 'add', k)), k)];
  function transform(prims, M, shift = [0, 0, 0]) {
    for (const p of prims) {
      if (p.t === 'fn') { p.R = matMul(M, p.R); p.c = add(matVec(M, p.c), shift); continue; }
      if (p.t === 'chain') transform(p.segs, M, shift);
      else if (p.t === 'cone') { p.a = add(matVec(M, p.a), shift); p.b = add(matVec(M, p.b), shift); }
      else { p.c = add(matVec(M, p.c), shift); p.R = matMul(M, p.R); }
    }
    return prims;
  }

  // ======================================================================
  // Dead tree (units: mm)
  // ======================================================================
  function deadTree(rng, o) {
    const { height = 1, gnarl = 1, thickness = 1 } = o;
    const minR = (o.minThick ?? 1.1) / 2;
    const segs = [], K = 0.6;
    function knot(p, d, r) {
      const off = unit(cross(d, rng.normal3()));
      const c = add(p, mul(off, r * rng.uniform(0.45, 0.75)));
      segs.push(cone(c, add(c, mul(d, r * 0.5)), r * rng.uniform(0.45, 0.7), r * rng.uniform(0.35, 0.55), 'add', K));
    }
    function limb(p, d, r, length, depth, nseg, fork = false) {
      const step = length / nseg, mine = [];
      segs.push(chainOf(mine, K));
      for (let i = 0; i < nseg; i++) {
        const side = unit(cross(d, rng.normal3()));
        d = rotToward(d, side, rng.normal(0, (depth ? 0.62 : 0.36) * gnarl));
        const up = (depth === 0 ? 0.16 : 0.06 + 0.04 * depth) - ((depth && rng.random() < 0.25) ? 0.12 : 0);
        d = unit(add(d, [0, 0, up]));
        const r2 = Math.max(minR, r * (depth === 0 ? 0.90 : 0.83));
        const q = add(p, mul(d, step * rng.uniform(0.7, 1.3)));
        mine.push(cone(p, q, r, r2, 'add', K));
        if (r > 1.2 && rng.random() < (depth === 0 ? 0.45 : 0.25)) knot(p, d, r);
        if (depth < 3 && r2 > minR * 1.6 && i >= (depth === 0 ? 2 : 0) && rng.random() < (depth === 0 ? 0.5 : 0.42)) {
          const nd = rotToward(d, unit(cross(d, rng.normal3())), rng.uniform(0.7, 1.3));
          const br = r2 * rng.uniform(0.5, 0.72);
          if (rng.random() < 0.32) limb(q, nd, Math.max(br, 0.9), length * rng.uniform(0.08, 0.16), 3, 2);   // broken stub
          else limb(q, nd, br, length * rng.uniform(0.5, 0.75), depth + 1, Math.max(3, nseg - 3));
        }
        p = q; r = r2;
      }
      if (fork) {                                   // trunk splits into main limbs at the top
        const nf = rng.int(2, 4);
        for (let f = 0; f < nf; f++) {
          const nd = rotToward(d, unit(cross(d, rng.normal3())), rng.uniform(0.5, 1.0));
          limb(p, nd, r * rng.uniform(0.6, 0.8), length * rng.uniform(0.45, 0.7), 1, 5);
        }
      }
    }
    const H = rng.uniform(26, 34) * height;
    const lean = unit([rng.normal(0, 0.25), rng.normal(0, 0.25), 1]);
    limb([0, 0, 0], lean, rng.uniform(3.6, 4.4) * thickness, H, 0, 8, true);
    // roots: thick, twisting, hugging the ground
    const nr = rng.int(5, 8), a0 = rng.uniform(0, 1);
    for (let ri = 0; ri < nr; ri++) {
      const ang = 2 * Math.PI * ri / nr + a0;
      let d = unit([Math.cos(ang), Math.sin(ang), -0.35]);
      let p = [0, 0, 3.5], r = rng.uniform(1.8, 2.6) * thickness;
      const ns = rng.int(3, 5), mine = []; segs.push(chainOf(mine, K));
      for (let i = 0; i < ns; i++) {
        const q = add(p, mul(d, rng.uniform(2.0, 3.2))); q[2] = Math.max(r * 0.35 - 0.2, q[2]);
        const r2 = Math.max(0.6, r * 0.68);
        mine.push(cone(p, q, r, r2, 'add', K)); p = q; r = r2;
        d = unit(add(d, [rng.normal(0, 0.45), rng.normal(0, 0.45), 0]));
      }
    }
    return segs;
  }

  // ======================================================================
  // Skulls (units: real cm; x = snout, y = side, z = up)
  // ======================================================================
  function bovineSkull(rng, horns) {
    const J = (s = 1) => rng.normal(0, s);
    const P = [
      ell([-2, 0, 12], [12, 12, 10]),
      ell([6, 0, 13], [10, 11, 7]),
      cone([-9, -9, 17], [-9, 9, 17], 4.5, 4.5),
      cone([8, -4, 10], [40, -3, 6], 6, 3.5), cone([8, 4, 10], [40, 3, 6], 6, 3.5),
      cone([8, 0, 12], [40, 0, 8], 5, 3),
      ell([43, 0, 5], [5, 5.5, 3.5]),
      ell([18, -7, 6], [10, 4.5, 5]), ell([18, 7, 6], [10, 4.5, 5]),
      sph([8, -11, 13], 5.5), sph([8, 11, 13], 5.5),
      sph([10, -13, 14], 5.0, 'sub', 1.0), sph([10, 13, 14], 5.0, 'sub', 1.0),
      ell([32, 0, 9.5], [9, 2.4, 3.2], 'sub', 1.0),
      ell([46, 0, 6], [3, 3.5, 2.5], 'sub', 1.0),
      sph([-14, 0, 8], 3.2, 'sub', 0.8),
      ell([14, 0, 0], [22, 6, 3], 'sub', 1.5),
    ];
    for (const s of [-1, 1]) {
      const base = [-9, s * 9, 17.5];
      let n = 12, f, rad;
      if (horns === 'longhorn') {
        const L = 55 + J(8), lift = 22 + J(5), fwd = 8 + J(4);
        f = (t) => add(base, [fwd * t * t - 2 * t, s * L * t, 3 * t + lift * t ** 3]);
        rad = (t) => 5.2 * (1 - t) + 1.6;
      } else if (horns === 'bull') {
        const L = 17 + J(3);
        f = (t) => add(base, [4 * t + 4 * t * t, s * (L * Math.sin(t * 2.2) / Math.sin(2.2) + 2 * t), 4 * t + 16 * t * t]);
        rad = (t) => 4.6 * (1 - t) ** 0.9 + 1.5;
      } else {                                      // cow: short cores, one snapped
        const L = s < 0 ? 9 : 4 + Math.abs(J(1)); n = 4;
        f = (t) => add(base, [2 * t, s * L * t, 5 * t]);
        rad = (t) => 5 - 1.5 * t;
      }
      const ts = lin(0, 1, n);
      P.push(...chain(ts.map(f), ts.map(rad), 1.0));
    }
    return [P, 1.5];
  }

  function ramSkull(rng) {
    const J = (s = 1) => rng.normal(0, s);
    const P = [
      ell([-2, 0, 9], [8, 7, 8]),
      cone([4, -2, 9], [22, -1.5, 5], 4.2, 2.4), cone([4, 2, 9], [22, 1.5, 5], 4.2, 2.4),
      cone([4, 0, 11], [21, 0, 7], 3.5, 2.0),
      ell([24, 0, 4.5], [3, 2.5, 2]),
      sph([4, -6.5, 10], 3.6), sph([4, 6.5, 10], 3.6),
      sph([5, -7.6, 10.5], 3.0, 'sub', 0.6), sph([5, 7.6, 10.5], 3.0, 'sub', 0.6),
      ell([18, 0, 7.5], [5, 1.3, 2], 'sub', 0.6),
      sph([-9, 0, 6], 2, 'sub', 0.5),
    ];
    for (const s of [-1, 1]) {
      const thMax = 1.75 * Math.PI + J(0.15), R0 = 9.5 + J(0.8), c = [-3, 0, 14 - R0];
      const ts = lin(0, 1, 26), pts = [], rad = [];
      for (const t of ts) {
        const R = R0 * (1 - 0.42 * t), a = Math.PI / 2 + t * thMax;
        pts.push(add(c, [R * Math.cos(a), s * (4 + 9 * t), R * Math.sin(a)]));
        rad.push(4.6 * (1 - t) + 1.4);
      }
      P.push(...chain(pts, rad, 0.8));
    }
    return [P, 1.0];
  }

  function horseSkull() {
    return [[
      ell([-6, 0, 12], [11, 9, 10]),
      cone([-16, 0, 15], [2, 0, 19], 3, 3),
      cone([2, -10, 12], [10, -10.5, 16], 2.8, 2.4), cone([2, 10, 12], [10, 10.5, 16], 2.8, 2.4),
      ell([9, -9, 13], [5, 3.5, 5]), ell([9, 9, 13], [5, 3.5, 5]),
      cone([4, 0, 14], [44, 0, 8], 7.5, 3.8),
      cone([6, -5, 10], [42, -3, 5], 6, 3.2), cone([6, 5, 10], [42, 3, 5], 6, 3.2),
      cone([10, -8, 8], [26, -7, 7], 2.6, 2), cone([10, 8, 8], [26, 7, 7], 2.6, 2),
      ell([47, 0, 5], [5.5, 4.5, 3.5]),
      ell([18, -5.5, 3.5], [15, 2.6, 3]), ell([18, 5.5, 3.5], [15, 2.6, 3]),
      sph([7, -11.5, 14.5], 4.2, 'sub', 0.8), sph([7, 11.5, 14.5], 4.2, 'sub', 0.8),
      ell([40, 0, 10], [9, 2, 3], 'sub', 0.8),
      ell([-12, -8, 13], [5, 3, 4], 'sub', 1.0), ell([-12, 8, 13], [5, 3, 4], 'sub', 1.0),
      sph([-17, 0, 9], 2.8, 'sub', 0.6),
    ], 1.0];
  }

  function wolfSkull() {
    return [[
      ell([-4, 0, 8], [9, 6.5, 6.5]),
      cone([-13, 0, 12.5], [1, 0, 14], 1.8, 2.0),
      cone([-5, -8, 6.5], [6, -7, 7], 2.0, 2.0), cone([-5, 8, 6.5], [6, 7, 7], 2.0, 2.0),
      cone([4, 0, 9], [21, 0, 5.5], 4.6, 2.6),
      cone([4, -2.6, 7], [21, -1.8, 4], 3.6, 2.3), cone([4, 2.6, 7], [21, 1.8, 4], 3.6, 2.3),
      cone([17.5, -2.4, 3.5], [18.2, -2.4, -1.5], 1.6, 0.9), cone([17.5, 2.4, 3.5], [18.2, 2.4, -1.5], 1.6, 0.9),
      sph([4.5, -5.6, 9.5], 3.2, 'sub', 0.5), sph([4.5, 5.6, 9.5], 3.2, 'sub', 0.5),
      ell([-3, -6.5, 8], [4, 2, 3], 'sub', 0.6), ell([-3, 6.5, 8], [4, 2, 3], 'sub', 0.6),
      ell([22, 0, 5.8], [2, 1.6, 1.6], 'sub', 0.4),
    ], 0.6];
  }

  function beastSkull(rng) {
    const J = (s = 1) => rng.normal(0, s);
    const P = [
      ell([-15, 0, 30], [35, 30, 28]),
      cone([5, -24, 44], [35, -18, 40], 12, 9), cone([5, 24, 44], [35, 18, 40], 12, 9),
      cone([10, 0, 30], [110, 0, 20], 26, 13),
      cone([10, -15, 24], [105, -10, 14], 18, 10), cone([10, 15, 24], [105, 10, 14], 18, 10),
      ell([112, 0, 18], [12, 14, 10]),
      sph([32, -27, 40], 12, 'sub', 3), sph([32, 27, 40], 12, 'sub', 3),
      ell([-12, -31, 30], [14, 7, 10], 'sub', 3), ell([-12, 31, 30], [14, 7, 10], 'sub', 3),
      ell([80, 0, 39], [16, 5, 7], 'sub', 2), ell([118, 0, 22], [5, 9, 5], 'sub', 2),
    ];
    for (const s of [-1, 1]) {
      const base = [-20, s * 20, 50], L = 90 + J(10), ts = lin(0, 1, 12);
      P.push(...chain(ts.map((t) => add(base, [-0.8 * L * t, s * (28 * t + 10 * t * t), 60 * t - 20 * t * t + 25 * t ** 3])),
        ts.map((t) => 13 * (1 - t) + 3), 2));
      [0.15, 0.45, 0.75].forEach((u, i) => {                    // brow spikes
        const b = [5 + 30 * u, s * (24 - 6 * u), 46 - 4 * u];
        P.push(cone(b, add(b, [-10, s * 6, 13 - 3 * i]), 5, 2, 'add', 1.5));
      });
      for (const [x, r] of [[96, 5.5], [70, 4]]) P.push(cone([x, s * 12, 10], [x + 2, s * 12, -12], r, 2, 'add', 1.5));  // fangs
      const j0 = [-10, s * 28, -2], j1 = [95, s * 9, -5];      // fallen lower jaw
      P.push(cone(j0, j1, 9, 6, 'add', 2));
      P.push(cone(j0, add(j0, [-6, s * 2, 18]), 7, 5, 'add', 2));
      for (const u of lin(0.3, 0.95, 6)) {
        const b = add(add(j0, mul(sub(j1, j0), u)), [0, 0, 5]);
        P.push(cone(b, add(b, [1, -s, 7 + (u > 0.8 ? 4 : 0)]), 3, 1.5, 'add', 1));
      }
    }
    return [P, 7];
  }

  // ======================================================================
  // Ribcages (units: real cm)
  // ======================================================================
  function ribcage(rng, L, a, b, n, rRib, rVert, { side = false, broken = 0.3, missing = 0.12 } = {}) {
    const P = [], nv = Math.floor(n * 1.15) + 4, zsp = rVert * 0.6;
    const vpts = lin(-0.08 * L, 1.12 * L, nv).map((x) => [x, rng.normal(0, rVert * 0.2), zsp + rng.normal(0, rVert * 0.1)]);
    vpts.forEach((p, i) => {
      const tail = Math.max(0, (p[0] - L) / (0.12 * L)), rv = rVert * (1 - 0.35 * tail);
      P.push(ell(p, [rv * 0.75, rv, rv * 0.85], 'add', rv * 0.3));
      P.push(cone(add(p, [0, -rv * 1.1, 0]), add(p, [0, rv * 1.1, 0]), rv * 0.3, rv * 0.3, 'add', rv * 0.3));
      if (i) P.push(cone(vpts[i - 1], p, rv * 0.45, rv * 0.45, 'add', rv * 0.3));
    });
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const size = 0.55 + 0.45 * Math.sin(Math.PI * (0.2 + 0.75 * u));
      const x0 = 0.04 * L + 0.86 * L * u;
      for (const s of [-1, 1]) {
        if (rng.random() < missing) continue;
        const phEnd = rng.random() < broken ? rng.uniform(0.9, 1.9) : rng.uniform(2.2, 2.6);
        const A = a * size * rng.uniform(0.9, 1.08), B = b * size * rng.uniform(0.9, 1.08);
        const slant = 0.3 * B * rng.uniform(0.8, 1.2), sag = rng.normal(0, 0.06);
        const phs = lin(0.05, phEnd, 12);
        const pts = phs.map((ph) => [x0 + slant * (1 - Math.cos(ph)), s * (rVert * 0.8 + A * Math.sin(ph) * (1 + sag * ph)), zsp + B * (1 - Math.cos(ph))]);
        P.push(...chain(pts, phs.map((ph) => rRib * (1.2 - 0.5 * ph / 2.6)), rRib * 0.5));
      }
    }
    let bury;
    if (side) { transform(P, rotMatrix(0, 0, Math.PI / 2 + rng.normal(0, 0.15)), [0, 0, rVert]); bury = 0.25 * a; }
    else { transform(P, rotMatrix(0, rng.normal(0, 0.04), rng.choice([-1, 1]) * rng.uniform(0.15, 0.35))); bury = rVert * 0.9; }
    return [P, bury];
  }

  // ======================================================================
  // Props: barrels and crates (units: real cm). Each is one custom SDF.
  // ======================================================================
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const sstep = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
  const sdBox = (x, y, z, hx, hy, hz) => {
    const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
  };
  const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const fnPrim = (f, llo, lhi, R = I3(), c = [0, 0, 0], k = 0.6) => ({ t: 'fn', f, llo, lhi, R, c, op: 'add', k });

  function barrelShape(rng, { broken = false } = {}) {
    const H = rng.uniform(78, 92), Rm = rng.uniform(29, 33), Re = Rm - rng.uniform(4, 6.5);
    const n = rng.int(14, 19), off = rng.uniform(0, 1);
    const hoopZ = [0.07, 0.2 + rng.uniform(-0.03, 0.03), 0.8 + rng.uniform(-0.03, 0.03), 0.93].map((u) => u * H);
    const hoopHW = rng.uniform(1.6, 2.2), hoopT = 0.9, lidDepth = 2.2, chime = 1.6, wall = 2.6;
    const tops = Array.from({ length: n }, () => broken ? H * (rng.random() < 0.35 ? rng.uniform(0.45, 0.75) : rng.uniform(0.8, 1.0)) : H);
    const dents = Array.from({ length: 3 }, () => ({ a: rng.uniform(0, 2 * Math.PI), z: rng.uniform(0.25, 0.75) * H, r: rng.uniform(6, 11), d: rng.uniform(0.4, 1.0) }));
    const pw = rng.uniform(7, 9);
    const rad = (z) => { const u = 2 * z / H - 1; return Rm - (Rm - Re) * u * u; };
    const f = (x, y, z) => {
      const rho = Math.hypot(x, y), r = rad(Math.min(Math.max(z, 0), H));
      let d0 = Math.max(rho - r - hoopT, -z, z - H);   // cheap bound: skip detail far from the surface
      if (broken) d0 = Math.max(d0, -Math.max(rho - (r - wall), wall - z));
      if (d0 > 3.5 || d0 < -3.5) return d0;
      const th = Math.atan2(y, x), sIdx = th / (2 * Math.PI) * n + off, st = ((Math.floor(sIdx) % n) + n) % n;
      const topZ = tops[st];
      let d = Math.max(rho - r, -z, z - topZ);
      // stave seams (on the side wall only)
      const side = clamp01((rho - (r - 1.5)) / 1.0);
      if (side > 0) {
        const fr = sIdx - Math.floor(sIdx); const arc = Math.min(fr, 1 - fr) * 2 * Math.PI / n * rho;
        d += 0.9 * side * sstep(1 - arc / 0.9);
        d += 0.35 * (vnoise(x * 0.9, y * 0.9, z * 0.11) - 0.5) * side;    // wood grain along the staves
      }
      for (const t of dents) {                       // shallow knocks
        const dx = x - Math.cos(t.a) * r, dy = y - Math.sin(t.a) * r, dz = z - t.z;
        d += t.d * Math.max(0, 1 - Math.hypot(dx, dy, dz) / t.r) ** 2;
      }
      // iron hoops
      for (const hz of hoopZ) {
        if (hz > topZ - 0.5) continue;
        const rh = rad(hz) + hoopT;
        const band = Math.max(rho - rh, Math.abs(z - hz) - hoopHW) - 0.15;
        if (band < d) d = band;
      }
      if (broken) {                                  // open, hollow, with jagged stave tops
        d = Math.max(d, -Math.max(rho - (r - wall), wall - z));
      } else {                                       // recessed lid inside the chime, with lid planks
        const lidR = rad(H) - chime;
        d = Math.max(d, -Math.max(rho - lidR, (H - lidDepth) - z));
        if (rho < lidR && z > H - lidDepth - 1) {
          const fy = Math.abs(y / pw - Math.round(y / pw)) * pw;
          d += 0.6 * sstep(1 - fy / 0.7);
        }
      }
      return d;
    };
    return { f, R: Rm + hoopT + 0.5, H };
  }
  function barrel(rng, mode) {
    const b = barrelShape(rng, { broken: mode === 'broken' });
    const llo = [-b.R, -b.R, -0.5], lhi = [b.R, b.R, b.H + 0.5];
    if (mode === 'side') {
      const R = matMul(rotMatrix(rng.uniform(0, Math.PI), 0, 0), rotMatrix(0, Math.PI / 2, rng.uniform(0, Math.PI * 2)));
      return [[fnPrim(b.f, llo, lhi, R, mul(matVec(R, [0, 0, b.H / 2]), -1))], 2.0];
    }
    return [[fnPrim(b.f, llo, lhi)], 0.4];
  }

  function crateShape(rng, { a, b, c, broken = false }) {
    const ph = 2 * c / rng.int(3, 5), pw = 2 * b / rng.int(3, 5);
    const bw = rng.uniform(7, 9), bt = 1.8, wall = 2.6;
    const braceY = rng.choice(['none', 'diag', 'x']), braceX = rng.choice(['none', 'diag']);
    const hole = broken ? Array.from({ length: 4 }, () => ({ x: rng.uniform(-0.45, 0.45) * a, z: rng.uniform(0.35, 0.75) * 2 * c, rx: rng.uniform(7, 13), rz: rng.uniform(6, 11) })) : [];
    const gap = broken ? { y0: rng.uniform(-b, b - 2 * pw), w: pw * rng.int(1, 3) } : null;
    const board = (u, v, w, u0, v0, u1, v1, halfW, t, off) => {      // diagonal board in a face plane
      const du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv) / 2, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const ca = du / (2 * L), sa = dv / (2 * L), pu = u - cu, pv = v - cv;
      return sdBox(pu * ca + pv * sa, -pu * sa + pv * ca, w - off, L, halfW, t);
    };
    const f = (x, y, z) => {
      const zc = z - c;
      let d0 = sdBox(x, y, zc, a + bt, b + bt, c);      // cheap bound: skip detail far from the surface
      if (broken) d0 = Math.max(d0, -sdBox(x, y, zc, a - wall, b - wall, c - wall));
      if (d0 > 3.5 || d0 < -3.5) return d0;
      let d = sdBox(x, y, zc, a - 0.4, b - 0.4, c - 0.4) - 0.4;
      const nearTop = z > 2 * c - 1.5;
      const nearSide = Math.max(Math.abs(x) - (a - 1.5), Math.abs(y) - (b - 1.5)) > 0;
      if (nearSide && !nearTop) {                    // horizontal plank seams on the sides
        const fz = Math.abs(z / ph - Math.round(z / ph)) * ph;
        d += 0.9 * sstep(1 - fz / 0.8);
        d += 0.3 * (vnoise(x * 0.11, y * 0.11, z * 0.9) - 0.5);
      }
      if (nearTop) {                                 // lid planks
        const fy = Math.abs(y / pw - Math.round(y / pw)) * pw;
        d += 0.9 * sstep(1 - fy / 0.8);
        d += 0.3 * (vnoise(x * 0.11, y * 0.9, z * 0.9) - 0.5);
      }
      // battens: frame boards on all four sides
      for (const s of [-1, 1]) {
        const oy = s * y - b - bt / 2, ox = s * x - a - bt / 2;
        let fb = Math.min(
          sdBox(Math.abs(x) - (a - bw / 2), oy, zc, bw / 2, bt / 2, c),
          sdBox(x, oy, Math.abs(zc) - (c - bw / 2), a, bt / 2, bw / 2),
          sdBox(ox, Math.abs(y) - (b - bw / 2), zc, bt / 2, bw / 2, c),
          sdBox(ox, y, Math.abs(zc) - (c - bw / 2), bt / 2, b, bw / 2));
        if (braceY !== 'none') fb = Math.min(fb, board(x, z, s * y, -a + bw, bw, a - bw, 2 * c - bw, bw * 0.42, bt / 2, b + bt / 2));
        if (braceY === 'x') fb = Math.min(fb, board(x, z, s * y, -a + bw, 2 * c - bw, a - bw, bw, bw * 0.42, bt / 2, b + bt / 2));
        if (braceX === 'diag') fb = Math.min(fb, board(y, z, s * x, -b + bw, bw, b - bw, 2 * c - bw, bw * 0.42, bt / 2, a + bt / 2));
        d = Math.min(d, fb - 0.2);
      }
      // nail heads at the frame corners
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const nx = sx * (a - bw / 2), nz = c + sz * (c - bw / 2);
        d = Math.min(d, Math.hypot(x - nx, Math.abs(y) - (b + bt), z - nz) - 0.8, Math.hypot(Math.abs(x) - (a + bt), y - sx * (b - bw / 2), z - nz) - 0.8);
      }
      if (broken) {
        d = Math.max(d, -sdBox(x, y, zc, a - wall, b - wall, c - wall));          // hollow inside
        for (const h of hole) {                                                    // smashed side
          const e = Math.hypot((x - h.x) / h.rx, (y - b) / 6, (z - h.z) / h.rz) - 1;
          d = Math.max(d, -e * Math.min(h.rx, h.rz) * 0.7);
        }
        d = Math.max(d, -sdBox(x, y - (gap.y0 + gap.w / 2), z - 2 * c, a - bw, gap.w / 2, wall + 1.5));   // missing lid planks
      }
      return d;
    };
    const m = Math.max(a, b) + bt + 1;
    return { f, llo: [-a - bt - 1, -b - bt - 1, -0.5], lhi: [a + bt + 1, b + bt + 1, 2 * c + 0.5], m };
  }
  function crateDims(rng) {
    const kind = rng.int(0, 3);
    if (kind === 0) { const s = rng.uniform(23, 27); return { a: s, b: s, c: s }; }                    // cube
    if (kind === 1) return { a: rng.uniform(36, 44), b: rng.uniform(20, 24), c: rng.uniform(20, 24) };   // long
    return { a: rng.uniform(17, 21), b: rng.uniform(14, 17), c: rng.uniform(13, 16) };                     // small
  }
  function crate(rng, mode) {
    if (mode === 'stack') {
      const d1 = { a: rng.uniform(26, 30), b: rng.uniform(24, 28), c: rng.uniform(22, 26) };
      const d2 = { a: rng.uniform(17, 21), b: rng.uniform(15, 18), c: rng.uniform(13, 16) };
      const s1 = crateShape(rng, d1), s2 = crateShape(rng, d2);
      const R2 = rotMatrix(rng.uniform(-0.6, 0.6), 0, 0);
      const c2 = [rng.uniform(-0.3, 0.3) * (d1.a - d2.a), rng.uniform(-0.3, 0.3) * (d1.b - d2.b), 2 * d1.c - 0.2];
      return [[fnPrim(s1.f, s1.llo, s1.lhi), fnPrim(s2.f, s2.llo, s2.lhi, R2, c2)], 0.2];
    }
    const sh = crateShape(rng, { ...crateDims(rng), broken: mode === 'broken' });
    return [[fnPrim(sh.f, sh.llo, sh.lhi, rotMatrix(rng.uniform(0, Math.PI), 0, 0))], 0.2];
  }

  // ======================================================================
  // Rocks (units: mm, scaled by the Size slider)
  // ======================================================================
  const fbm = (x, y, z, oct) => { let v = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { v += a * vnoise(x * f + i * 31.7, y * f - i * 17.3, z * f + i * 7.1); n += a; a *= 0.5; f *= 2.03; } return v / n; };
  const smax = (a, b, k) => { const h = clamp01(0.5 - 0.5 * (b - a) / k); return a * h + b * (1 - h) + k * h * (1 - h); };
  function randomUnit(rng) { return unit(rng.normal3()); }

  // One rock: an ellipsoid cut by random planes (facets), worn edges, fractal erosion,
  // and optional horizontal strata ledges (sandstone).
  function rockShape(rng, { r, rough = 1, angular = 1, strata = 0, z0 = 0, flatTop = null }) {
    const R = Math.max(...r), np = Math.round(6 + 10 * angular);
    const planes = Array.from({ length: np }, () => {
      const n = randomUnit(rng);
      const ext = Math.hypot(n[0] * r[0], n[1] * r[1], n[2] * r[2]);   // ellipsoid support in that direction
      return { n, o: ext * (1 - angular * rng.uniform(0.12, 0.4)) };
    });
    const PN = new Float64Array(planes.length * 4);
    planes.forEach((p, i) => { PN[i * 4] = p.n[0]; PN[i * 4 + 1] = p.n[1]; PN[i * 4 + 2] = p.n[2]; PN[i * 4 + 3] = p.o; });
    const wear = R * (0.025 + 0.12 * (1 - angular)), amp = R * 0.07 * rough, freq = 1.4 / R, seed = rng.uniform(0, 100);
    for (let i = rng.int(1, 4); i > 0; i--) { randomUnit(rng); rng.uniform(-0.5, 0.5); }   // former crack lines: draws kept so seeds give the same rocks
    const layerH = R * rng.uniform(0.18, 0.28), insets = Array.from({ length: 64 }, () => rng.uniform(0, 1));
    const f = (x, y, z) => {
      const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]), k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
      let d = k0 * (k0 - 1) / Math.max(k1, 1e-9);
      if (d > amp * 0.9 + strata * R * 0.15 + 0.4 || d < -(amp + R * 0.42 + 0.4)) return d;   // far from the surface: skip detail
      for (let i = 0; i < PN.length; i += 4) {
        const b = PN[i] * x + PN[i + 1] * y + PN[i + 2] * z - PN[i + 3], df = b - d;
        if (df >= wear) d = b; else if (df > -wear) { const h = 0.5 - 0.5 * df / wear; d = d * h + b * (1 - h) + wear * h * (1 - h); }
      }
      if (flatTop !== null) d = smax(d, z - flatTop, wear);
      d += amp * (fbm(x * freq + seed, y * freq, z * freq, 3) - 0.5) * 1.6;
      d += R * 0.018 * rough * (vnoise(x * freq * 9, y * freq * 9, z * freq * 9) - 0.5);   // fine grit
      if (strata) {                                                  // ledges: each layer erodes back by its own amount
        const t = (z + z0) / layerH, i = Math.floor(t), fr = t - i;
        const a = insets[((i % 64) + 64) % 64], b = insets[(((i + 1) % 64) + 64) % 64];
        d += strata * R * 0.09 * (a + (b - a) * sstep((fr - 0.8) / 0.2) + 0.6 * (1 - fr) ** 6);
      }
      return d;
    };
    const pad = amp + strata * R * 0.15 + 0.8;
    return { f, llo: r.map((v) => -v - pad), lhi: r.map((v) => v + pad) };
  }
  const rockPrim = (sh, c, R = I3(), k = 0.8) => fnPrim(sh.f, sh.llo, sh.lhi, R, c, k);
  const yaw = (rng) => rotMatrix(rng.uniform(0, 2 * Math.PI), 0, 0);
  const tumble = (rng) => rotMatrix(rng.uniform(0, 2 * Math.PI), rng.normal(0, 0.35), rng.normal(0, 0.35));

  function rockBoulder(rng, o) {
    const s = rng.uniform(7, 11), r = [s * rng.uniform(1.0, 1.35), s * rng.uniform(0.8, 1.05), s * rng.uniform(0.6, 0.85)];
    const sh = rockShape(rng, { r, rough: o.rough, angular: o.angular });
    return [[rockPrim(sh, [0, 0, r[2] * 0.7], tumble(rng))], 0];
  }
  function rockCluster(rng, o) {
    const P = [], n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const big = i === 0, s = big ? rng.uniform(8, 11) : rng.uniform(3, 7);
      const r = [s * rng.uniform(1, 1.3), s * rng.uniform(0.8, 1), s * rng.uniform(0.55, 0.85)];
      const a = rng.uniform(0, 2 * Math.PI), dist = big ? 0 : rng.uniform(7, 13);
      P.push(rockPrim(rockShape(rng, { r, rough: o.rough, angular: o.angular }), [Math.cos(a) * dist, Math.sin(a) * dist, r[2] * rng.uniform(0.45, 0.7)], tumble(rng)));
    }
    return [P, 0];
  }
  function rockScree(rng, o) {
    const P = [], n = rng.int(10, 18);
    for (let i = 0; i < n; i++) {
      const s = rng.uniform(1.2, 3.6), r = [s * rng.uniform(1, 1.4), s * rng.uniform(0.8, 1.1), s * rng.uniform(0.5, 0.8)];
      const a = rng.uniform(0, 2 * Math.PI), dist = 14 * Math.sqrt(rng.random());
      P.push(rockPrim(rockShape(rng, { r, rough: o.rough, angular: o.angular }), [Math.cos(a) * dist, Math.sin(a) * dist, r[2] * 0.55], tumble(rng), 0.3));
    }
    return [P, 0];
  }
  function rockOutcrop(rng, o) {
    const P = [];
    const r = [rng.uniform(14, 19), rng.uniform(9, 13), rng.uniform(8, 12)];
    P.push(rockPrim(rockShape(rng, { r, rough: o.rough, angular: (o.angular ?? 1) * 0.8, strata: 1, z0: r[2] * 0.3, flatTop: r[2] * rng.uniform(0.35, 0.55) }), [0, 0, r[2] * 0.3], yaw(rng), 1.2));
    for (let i = 0; i < rng.int(1, 3); i++) {                        // lower shoulders of the same rock
      const rr = r.map((v) => v * rng.uniform(0.45, 0.65)), a = rng.uniform(0, 2 * Math.PI);
      P.push(rockPrim(rockShape(rng, { r: rr, rough: o.rough, angular: (o.angular ?? 1) * 0.8, strata: 1, z0: rr[2] * 0.2, flatTop: rr[2] * rng.uniform(0.3, 0.6) }), [Math.cos(a) * r[0] * 0.7, Math.sin(a) * r[1] * 0.7, rr[2] * 0.2], yaw(rng), 1.2));
    }
    return [P, 0];
  }
  function rockHoodoo(rng, o) {
    const H = rng.uniform(32, 46), Rb = rng.uniform(7, 9.5), seed = rng.uniform(0, 100), lean = [rng.normal(0, 0.06), rng.normal(0, 0.06)];
    const capR = Rb * rng.uniform(1.0, 1.35), capH = rng.uniform(4, 6.5), layerH = rng.uniform(2.2, 3.4);
    const insets = Array.from({ length: 64 }, () => rng.uniform(0, 1)), rough = o.rough ?? 1;
    const prof = (z) => {                                            // waisted pillar: wide base, thin neck under the cap
      const u = z / H;
      return Rb * (1 - 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 1.5 + 0.35 * (1 - u) ** 3) * (1 + 0.12 * Math.sin(u * 9 + seed));
    };
    const NT = 1024, profT = new Float64Array(NT + 1);
    for (let i = 0; i <= NT; i++) profT[i] = prof((H - capH) * i / NT);
    const profAt = (z) => { const t = z / (H - capH) * NT, i = Math.min(NT - 1, Math.floor(t)), fr = t - i; return profT[i] + (profT[i + 1] - profT[i]) * fr; };
    const f = (x, y, z) => {
      const cx = lean[0] * z, cy = lean[1] * z, zz = Math.min(Math.max(z, 0), H - capH);
      // irregular, vertically fluted cross-section instead of a perfect circle
      const flute = Rb * 0.28 * rough * (fbm(x * 0.28 + seed, y * 0.28, z * 0.07, 3) - 0.5) * 2;
      const rho = Math.hypot(x - cx, y - cy) + flute;
      let d = Math.max(rho - profAt(zz), -z, z - (H - capH * 0.4));
      const capEdge = capR * (1 + 0.25 * (fbm(x * 0.18 - seed, y * 0.18, 3.3, 3) - 0.5) * 2);
      const cap = Math.max(Math.hypot(x - cx, y - cy) - capEdge, Math.abs(z - (H - capH / 2)) - capH / 2) - 0.6;
      d = Math.min(d, cap);
      if (d > Rb * 0.06 * rough + 1.6 || d < -(Rb * 0.06 * rough + 2)) return d;
      d += Rb * 0.06 * rough * (fbm(x * 0.5 + seed, y * 0.5, z * 0.5, 3) - 0.5) * 1.6;
      const t = z / layerH, i = Math.floor(t), fr = t - i;
      const a = insets[((i % 64) + 64) % 64], b = insets[(((i + 1) % 64) + 64) % 64];
      d += 0.9 * (a + (b - a) * sstep((fr - 0.8) / 0.2) + 0.5 * (1 - fr) ** 6) * (z < H - capH ? 1 : 0.4);
      return d;
    };
    const m = capR * 1.7 + 4;
    return [[fnPrim(f, [-m, -m, -1], [m, m, H + 3], I3(), [0, 0, 0], 0.6)], 0];
  }

  const MODELS = {
    tree:           { group: 'Trees', label: 'Dead tree', kind: 'tree' },
    skull_longhorn: { group: 'Skulls', label: 'Longhorn steer skull', fn: (r) => bovineSkull(r, 'longhorn') },
    skull_bull:     { group: 'Skulls', label: 'Bull skull', fn: (r) => bovineSkull(r, 'bull') },
    skull_cow:      { group: 'Skulls', label: 'Cow skull, broken horn', fn: (r) => bovineSkull(r, 'cow') },
    skull_ram:      { group: 'Skulls', label: 'Ram skull', fn: ramSkull },
    skull_horse:    { group: 'Skulls', label: 'Horse skull', fn: horseSkull },
    skull_wolf:     { group: 'Skulls', label: 'Wolf skull', fn: wolfSkull },
    skull_beast:    { group: 'Skulls', label: 'Giant beast skull', fn: beastSkull },
    ribs_cattle:    { group: 'Ribcages', label: 'Cattle ribcage', fn: (r) => ribcage(r, 100, 30, 28, 10, 1.9, 4.5) },
    ribs_horse:     { group: 'Ribcages', label: 'Horse ribcage (on its side)', fn: (r) => ribcage(r, 115, 26, 32, 11, 1.9, 5, { side: true }) },
    ribs_goat:      { group: 'Ribcages', label: 'Goat ribcage', fn: (r) => ribcage(r, 55, 16, 15, 9, 1.6, 2.6) },
    ribs_beast:     { group: 'Ribcages', label: 'Giant beast ribcage', fn: (r) => ribcage(r, 260, 85, 85, 11, 6.5, 14, { broken: 0.35 }) },
    barrel:         { group: 'Props', label: 'Barrel', fn: (r) => barrel(r, 'upright'), smooth: 2, wood: true },
    barrel_side:    { group: 'Props', label: 'Barrel on its side', fn: (r) => barrel(r, 'side'), smooth: 2, wood: true },
    barrel_broken:  { group: 'Props', label: 'Broken open barrel', fn: (r) => barrel(r, 'broken'), smooth: 2, wood: true },
    crate:          { group: 'Props', label: 'Wooden crate', fn: (r) => crate(r, 'closed'), smooth: 2, wood: true },
    crate_broken:   { group: 'Props', label: 'Smashed crate', fn: (r) => crate(r, 'broken'), smooth: 2, wood: true },
    crate_stack:    { group: 'Props', label: 'Stacked crates', fn: (r) => crate(r, 'stack'), smooth: 2, wood: true },
    rock_boulder:   { group: 'Rocks', label: 'Boulder', fn: rockBoulder, rock: true },
    rock_cluster:   { group: 'Rocks', label: 'Rock cluster', fn: rockCluster, rock: true },
    rock_scree:     { group: 'Rocks', label: 'Scree (loose stones)', fn: rockScree, rock: true, keepAll: true },
    rock_outcrop:   { group: 'Rocks', label: 'Layered sandstone outcrop', fn: rockOutcrop, rock: true },
    rock_hoodoo:    { group: 'Rocks', label: 'Hoodoo (rock pillar with cap)', fn: rockHoodoo, rock: true },
  };

  // ======================================================================
  // Signed distance field -> mesh
  // ======================================================================
  function prep(p) {
    if (p.t === 'fn') {                             // custom SDF in its own frame: world = c + s * R * local
      p.s = p.s || 1; p.Rt = [0, 1, 2].map((i) => [0, 1, 2].map((j) => p.R[j][i]));
      const L0 = p.llo, L1 = p.lhi, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let m = 0; m < 8; m++) {
        const w = add(p.c, mul(matVec(p.R, [m & 1 ? L1[0] : L0[0], m & 2 ? L1[1] : L0[1], m & 4 ? L1[2] : L0[2]]), p.s));
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], w[i]); hi[i] = Math.max(hi[i], w[i]); }
      }
      p.lo = lo; p.hi = hi; return;
    }
    if (p.t === 'chain') {
      p.segs.forEach(prep);
      p.lo = [0, 1, 2].map((i) => Math.min(...p.segs.map((q) => q.lo[i])));
      p.hi = [0, 1, 2].map((i) => Math.max(...p.segs.map((q) => q.hi[i])));
      return;
    }
    if (p.t === 'cone') {
      if (Math.hypot(...sub(p.b, p.a)) < 1e-4) p.b = add(p.a, [0, 0, 1e-3]);
      const ba = sub(p.b, p.a), l2 = dot(ba, ba), rr = p.r1 - p.r2;
      Object.assign(p, { ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, sg: Math.sign(rr) });
      const r = Math.max(p.r1, p.r2);
      p.lo = sub([Math.min(p.a[0], p.b[0]), Math.min(p.a[1], p.b[1]), Math.min(p.a[2], p.b[2])], [r, r, r]);
      p.hi = add([Math.max(p.a[0], p.b[0]), Math.max(p.a[1], p.b[1]), Math.max(p.a[2], p.b[2])], [r, r, r]);
    } else {
      const r = Math.max(...p.r);
      p.lo = sub(p.c, [r, r, r]); p.hi = add(p.c, [r, r, r]);
    }
  }
  function sdf(p, x, y, z) {
    if (p.t === 'fn') {
      const dx = (x - p.c[0]) / p.s, dy = (y - p.c[1]) / p.s, dz = (z - p.c[2]) / p.s, T = p.Rt;
      return p.f(T[0][0] * dx + T[0][1] * dy + T[0][2] * dz, T[1][0] * dx + T[1][1] * dy + T[1][2] * dz, T[2][0] * dx + T[2][1] * dy + T[2][2] * dz) * p.s;
    }
    if (p.t === 'cone') {                         // round cone (Inigo Quilez)
      const px = x - p.a[0], py = y - p.a[1], pz = z - p.a[2], ba = p.ba;
      const yy = px * ba[0] + py * ba[1] + pz * ba[2], zz = yy - p.l2;
      const qx = px * p.l2 - yy * ba[0], qy = py * p.l2 - yy * ba[1], qz = pz * p.l2 - yy * ba[2];
      const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * p.l2, z2 = zz * zz * p.l2;
      const k = p.sg * p.rr * p.rr * x2;
      if (Math.sign(zz) * p.a2 * z2 > k) return Math.sqrt(x2 + z2) * p.il2 - p.r2;
      if (Math.sign(yy) * p.a2 * y2 < k) return Math.sqrt(x2 + y2) * p.il2 - p.r1;
      return (Math.sqrt(Math.max(x2 * p.a2 * p.il2, 0)) + yy * p.rr) * p.il2 - p.r1;
    }
    const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2], R = p.R, r = p.r;   // ellipsoid, local frame = R^T (p - c)
    const qx = (R[0][0] * dx + R[1][0] * dy + R[2][0] * dz), qy = (R[0][1] * dx + R[1][1] * dy + R[2][1] * dz), qz = (R[0][2] * dx + R[1][2] * dy + R[2][2] * dz);
    const k0 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
    const k1 = Math.hypot(qx / (r[0] * r[0]), qy / (r[1] * r[1]), qz / (r[2] * r[2]));
    return k0 * (k0 - 1) / Math.max(k1, 1e-9);
  }

  function buildField(prims, { lo, hi, voxel, texture }) {
    const nx = Math.ceil((hi[0] - lo[0]) / voxel) + 1, ny = Math.ceil((hi[1] - lo[1]) / voxel) + 1, nz = Math.ceil((hi[2] - lo[2]) / voxel) + 1;
    const F = new Float32Array(nx * ny * nz).fill(10);
    const sxy = nx * ny;
    const bark = texture && texture.bark, noise = texture && texture.bone;
    const D = bark ? new Float32Array(nx * ny * nz * 3) : null;   // grain direction field (trees only)
    for (const p of prims) {
      const pad = p.k + 0.5;
      const i0 = Math.max(0, Math.floor((p.lo[0] - pad - lo[0]) / voxel)), i1 = Math.min(nx, Math.ceil((p.hi[0] + pad - lo[0]) / voxel) + 1);
      const j0 = Math.max(0, Math.floor((p.lo[1] - pad - lo[1]) / voxel)), j1 = Math.min(ny, Math.ceil((p.hi[1] + pad - lo[1]) / voxel) + 1);
      const k0 = Math.max(0, Math.floor((p.lo[2] - pad - lo[2]) / voxel)), k1 = Math.min(nz, Math.ceil((p.hi[2] + pad - lo[2]) / voxel) + 1);
      const k = p.k, isAdd = p.op === 'add';
      const parts = p.t === 'chain' ? p.segs : [p];
      if (!parts.length || i1 <= i0 || j1 <= j0 || k1 <= k0) continue;
      const dirs = D ? parts.map((q) => q.t === 'cone' ? unit(q.ba) : null) : null;
      const dws = parts.map((q) => q.t === 'cone' ? Math.max(q.r1, q.r2) : 0);
      // Chains: hard-min all segments into a local buffer first, each only over its own box.
      let T = null, B = null; const rx = i1 - i0, ry = j1 - j0, rxy = rx * ry;
      if (p.t === 'fn') {
        // Custom shapes are costly: sample every 4th voxel first, then evaluate exactly only in
        // blocks that may contain the surface; elsewhere interpolate the coarse samples.
        const rz = k1 - k0, BK = 4, cx = Math.ceil((rx - 1) / BK) + 1, cy = Math.ceil((ry - 1) / BK) + 1, cz = Math.ceil((rz - 1) / BK) + 1;
        const ci = (c, n) => Math.min(c * BK, n - 1);
        const C = new Float32Array(cx * cy * cz);
        for (let c2 = 0; c2 < cz; c2++) for (let c1 = 0; c1 < cy; c1++) for (let c0 = 0; c0 < cx; c0++)
          C[(c2 * cy + c1) * cx + c0] = sdf(p, lo[0] + (i0 + ci(c0, rx)) * voxel, lo[1] + (j0 + ci(c1, ry)) * voxel, lo[2] + (k0 + ci(c2, rz)) * voxel);
        T = new Float32Array(rxy * rz);
        const thr = 2.5 * BK * voxel;
        for (let b2 = 0; b2 < cz - 1 || (cz === 1 && b2 === 0); b2++) for (let b1 = 0; b1 < cy - 1 || (cy === 1 && b1 === 0); b1++) for (let b0 = 0; b0 < cx - 1 || (cx === 1 && b0 === 0); b0++) {
          const q0 = Math.min(b0 + 1, cx - 1), q1 = Math.min(b1 + 1, cy - 1), q2 = Math.min(b2 + 1, cz - 1);
          const g = (a0, a1, a2) => C[(a2 * cy + a1) * cx + a0];
          const v000 = g(b0, b1, b2), v100 = g(q0, b1, b2), v010 = g(b0, q1, b2), v110 = g(q0, q1, b2);
          const v001 = g(b0, b1, q2), v101 = g(q0, b1, q2), v011 = g(b0, q1, q2), v111 = g(q0, q1, q2);
          const mn = Math.min(v000, v100, v010, v110, v001, v101, v011, v111), mx = Math.max(v000, v100, v010, v110, v001, v101, v011, v111);
          const far = mn > thr || mx < -thr;
          const ia = ci(b0, rx), ib = ci(q0, rx), ja = ci(b1, ry), jb = ci(q1, ry), ka = ci(b2, rz), kb = ci(q2, rz);
          const ie = q0 === cx - 1 ? rx : ib, je = q1 === cy - 1 ? ry : jb, ke = q2 === cz - 1 ? rz : kb;
          for (let kk = ka; kk < ke; kk++) for (let j = ja; j < je; j++) for (let i = ia; i < ie; i++) {
            const ti = kk * rxy + j * rx + i;
            if (far) {
              const u = ib > ia ? (i - ia) / (ib - ia) : 0, w = jb > ja ? (j - ja) / (jb - ja) : 0, t = kb > ka ? (kk - ka) / (kb - ka) : 0;
              const x0 = v000 + (v100 - v000) * u, x1 = v010 + (v110 - v010) * u, x2 = v001 + (v101 - v001) * u, x3 = v011 + (v111 - v011) * u;
              const y0 = x0 + (x1 - x0) * w, y1 = x2 + (x3 - x2) * w;
              T[ti] = y0 + (y1 - y0) * t;
            } else T[ti] = sdf(p, lo[0] + (i0 + i) * voxel, lo[1] + (j0 + j) * voxel, lo[2] + (k0 + kk) * voxel);
          }
        }
        B = new Uint16Array(T.length);
      } else if (parts.length > 1) {
        T = new Float32Array(rxy * (k1 - k0)).fill(1e9); B = new Uint16Array(T.length);
        parts.forEach((q, qi) => {
          const a0 = Math.max(i0, Math.floor((q.lo[0] - pad - lo[0]) / voxel)), a1 = Math.min(i1, Math.ceil((q.hi[0] + pad - lo[0]) / voxel) + 1);
          const b0 = Math.max(j0, Math.floor((q.lo[1] - pad - lo[1]) / voxel)), b1 = Math.min(j1, Math.ceil((q.hi[1] + pad - lo[1]) / voxel) + 1);
          const c0 = Math.max(k0, Math.floor((q.lo[2] - pad - lo[2]) / voxel)), c1 = Math.min(k1, Math.ceil((q.hi[2] + pad - lo[2]) / voxel) + 1);
          for (let kk = c0; kk < c1; kk++) for (let j = b0; j < b1; j++) for (let i = a0; i < a1; i++) {
            const ti = (kk - k0) * rxy + (j - j0) * rx + (i - i0);
            const dq = sdf(q, lo[0] + i * voxel, lo[1] + j * voxel, lo[2] + kk * voxel);
            if (dq < T[ti]) { T[ti] = dq; B[ti] = qi; }
          }
        });
      }
      for (let kk = k0; kk < k1; kk++) {
        const z = lo[2] + kk * voxel;
        for (let j = j0; j < j1; j++) {
          const y = lo[1] + j * voxel, row = kk * sxy + j * nx;
          for (let i = i0; i < i1; i++) {
            const x = lo[0] + i * voxel, idx = row + i, f = F[idx];
            let d, best = 0;
            if (T) { const ti = (kk - k0) * rxy + (j - j0) * rx + (i - i0); d = T[ti]; best = B[ti]; if (d >= 1e9) continue; }
            else d = sdf(p, x, y, z);
            if (dirs && dirs[best] && d < 1.2) {   // weight nearby branches into a smooth grain direction
              const dir = dirs[best], wgt = dws[best] * Math.exp(-2.5 * Math.max(d, 0)), o3 = idx * 3;
              D[o3] += dir[0] * wgt; D[o3 + 1] += dir[1] * wgt; D[o3 + 2] += dir[2] * wgt;
            }
            if (isAdd) {                          // smooth union
              if (d - f >= k) continue;
              let h = 0.5 + 0.5 * (d - f) / k; h = h < 0 ? 0 : h > 1 ? 1 : h;
              F[idx] = d * (1 - h) + f * h - k * h * (1 - h);
            } else {                              // smooth subtraction
              let h = 0.5 - 0.5 * (f + d) / k; if (h <= 0) continue; if (h > 1) h = 1;
              F[idx] = f * (1 - h) - d * h + k * h * (1 - h);
            }
          }
        }
      }
    }
    // surface texture + flat ground cut at z = 0 + closed borders
    for (let kk = 0; kk < nz; kk++) {
      const z = lo[2] + kk * voxel;
      for (let j = 0; j < ny; j++) {
        const y = lo[1] + j * voxel;
        for (let i = 0; i < nx; i++) {
          const idx = kk * sxy + j * nx + i; let f = F[idx];
          const x = lo[0] + i * voxel;
          if (bark && f > -1 && f < 1) {
            // Bark: 3D noise squashed along the local grain, so furrows run along each branch.
            const o3 = idx * 3; let gx = D[o3], gy = D[o3 + 1], gz = D[o3 + 2];
            const gl = Math.hypot(gx, gy, gz);
            if (gl > 1e-6) { gx /= gl; gy /= gl; gz /= gl; } else { gx = 0; gy = 0; gz = 1; }
            const along = (x * gx + y * gy + z * gz) * (1 - 1 / 6);    // features ~6x longer along the grain
            const qx = (x - gx * along) * 1.15, qy = (y - gy * along) * 1.15, qz = (z - gz * along) * 1.15;
            const n1 = vnoise(qx, qy, qz), n2 = vnoise(qx * 2.3 + 17.1, qy * 2.3 + 3.7, qz * 2.3 + 9.2);
            const ridge = 1 - Math.sqrt((2 * n1 - 1) ** 2 + 0.015);           // furrows, softly rounded at the bottom
            const t = bark * (0.32 * (ridge - 0.6) + 0.08 * (n2 - 0.5));
            f += t * Math.min(1, Math.max(0, f + 1));
          } else if (noise && f > -0.3 && f < 0.3) {
            // Bone: very soft, broad weathering only
            f += 0.03 * (vnoise(x * 0.9, y * 0.9, z * 0.9) - 0.5);
          }
          if (-z > f) f = -z;
          if (i === 0 || j === 0 || kk === 0 || i === nx - 1 || j === ny - 1 || kk === nz - 1) f = 1;
          F[idx] = f;
        }
      }
    }
    return { F, nx, ny, nz };
  }

  // Naive surface nets: closed mesh, consistent outward winding.
  const SN_EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], SN_EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const SN_CX = [0, 1, 0, 1, 0, 1, 0, 1], SN_CY = [0, 0, 1, 1, 0, 0, 1, 1], SN_CZ = [0, 0, 0, 0, 1, 1, 1, 1];
  function surfaceNets({ F, nx, ny, nz }, lo, voxel) {
    const sxy = nx * ny, cell = new Int32Array(nx * ny * nz).fill(-1);
    const off = SN_CX.map((_, c) => SN_CX[c] + SN_CY[c] * nx + SN_CZ[c] * sxy);
    let pos = new Float32Array(1 << 16), nv = 0;
    const v = new Float64Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) {
      const rowBase = k * sxy + j * nx;
      for (let i = 0; i < nx - 1; i++) {
        const base = rowBase + i;
        let mask = 0;
        for (let c = 0; c < 8; c++) { const fv = F[base + off[c]]; v[c] = fv; if (fv < 0) mask |= 1 << c; }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = SN_EA[e], b = SN_EB[e];
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += SN_CX[a] + (SN_CX[b] - SN_CX[a]) * t; sy += SN_CY[a] + (SN_CY[b] - SN_CY[a]) * t; sz += SN_CZ[a] + (SN_CZ[b] - SN_CZ[a]) * t; cnt++;
        }
        if (nv * 3 + 3 > pos.length) { const np = new Float32Array(pos.length * 2); np.set(pos); pos = np; }
        pos[nv * 3] = lo[0] + (i + sx / cnt) * voxel; pos[nv * 3 + 1] = lo[1] + (j + sy / cnt) * voxel; pos[nv * 3 + 2] = lo[2] + (k + sz / cnt) * voxel;
        cell[base] = nv++;
      }
    }
    let idx = new Uint32Array(1 << 17), nt = 0;
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (nt * 3 + 6 > idx.length) { const ni = new Uint32Array(idx.length * 2); ni.set(idx); idx = ni; }
      const o = nt * 3;
      if (flip) { idx[o] = a; idx[o + 1] = c; idx[o + 2] = b; idx[o + 3] = a; idx[o + 4] = d; idx[o + 5] = c; }
      else { idx[o] = a; idx[o + 1] = b; idx[o + 2] = c; idx[o + 3] = a; idx[o + 4] = c; idx[o + 5] = d; }
      nt += 2;
    };
    for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
      const p0 = k * sxy + j * nx + i, in0 = F[p0] < 0;
      if (i < nx - 1 && in0 !== (F[p0 + 1] < 0)) quad(cell[p0 - nx - sxy], cell[p0 - sxy], cell[p0], cell[p0 - nx], !in0);
      if (j < ny - 1 && in0 !== (F[p0 + nx] < 0)) quad(cell[p0 - 1 - sxy], cell[p0 - 1], cell[p0], cell[p0 - sxy], !in0);
      if (k < nz - 1 && in0 !== (F[p0 + sxy] < 0)) quad(cell[p0 - 1 - nx], cell[p0 - nx], cell[p0], cell[p0 - 1], !in0);
    }
    return { positions: pos.subarray(0, nv * 3), indices: idx.subarray(0, nt * 3) };
  }

  // Drop sealed internal voids and tiny loose bits (keeps parts touching the ground).
  function keepMainParts(positions, indices, minShare = 0.02) {
    const nv = positions.length / 3, parent = new Int32Array(nv);
    for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < indices.length; t += 3) {
      const a = find(indices[t]), b = find(indices[t + 1]), c = find(indices[t + 2]);
      if (a !== b) parent[a] = b; const b2 = find(b); if (c !== b2) parent[c] = b2;
    }
    const tris = new Map(), zmin = new Map();
    let gz = Infinity;
    for (let i = 0; i < nv; i++) { const r = find(i), z = positions[i * 3 + 2]; if (z < (zmin.get(r) ?? Infinity)) zmin.set(r, z); if (z < gz) gz = z; }
    for (let t = 0; t < indices.length; t += 3) { const r = find(indices[t]); tris.set(r, (tris.get(r) || 0) + 1); }
    if (tris.size <= 1) return { positions, indices };
    const maxT = Math.max(...tris.values());
    const keep = new Set([...tris].filter(([r, n]) => n >= minShare * maxT && zmin.get(r) <= gz + 0.05).map(([r]) => r));
    const remap = new Int32Array(nv).fill(-1); let nn = 0;
    const out = [];
    for (let t = 0; t < indices.length; t += 3) {
      if (!keep.has(find(indices[t]))) continue;
      for (let c = 0; c < 3; c++) { const v = indices[t + c]; if (remap[v] < 0) remap[v] = nn++; out.push(remap[v]); }
    }
    const np = new Float32Array(nn * 3);
    for (let i = 0; i < nv; i++) if (remap[i] >= 0) np.set(positions.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    return { positions: np, indices: Uint32Array.from(out) };
  }

  // Taubin smoothing (lambda/mu): removes voxel grain without shrinking the piece.
  // Vertices on the flat ground cut keep z = ground so the piece still sits flat.
  function taubin(P, I, iters, voxel) {
    if (!iters) return;
    const nv = P.length / 3, deg = new Uint32Array(nv + 1);
    for (let t = 0; t < I.length; t++) deg[I[t] + 1] += 2;
    for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
    const nb = new Uint32Array(deg[nv]), fillp = deg.slice(0, nv);
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3]; nb[fillp[a]++] = b; nb[fillp[b]++] = a;
    }
    let gz = Infinity; for (let i = 2; i < P.length; i += 3) if (P[i] < gz) gz = P[i];
    const pinned = new Uint8Array(nv); for (let i = 0; i < nv; i++) if (P[i * 3 + 2] < gz + voxel * 0.35) pinned[i] = 1;
    const L = new Float32Array(P.length);
    const step = (lam) => {
      for (let i = 0; i < nv; i++) {
        const s = deg[i], e = deg[i + 1], n = e - s; if (!n) continue;
        let ax = 0, ay = 0, az = 0;
        for (let j = s; j < e; j++) { const q = nb[j] * 3; ax += P[q]; ay += P[q + 1]; az += P[q + 2]; }
        L[i * 3] = ax / n - P[i * 3]; L[i * 3 + 1] = ay / n - P[i * 3 + 1]; L[i * 3 + 2] = pinned[i] ? 0 : az / n - P[i * 3 + 2];
      }
      for (let i = 0; i < P.length; i++) P[i] += lam * L[i];
    };
    for (let k = 0; k < iters; k++) { step(0.55); step(-0.58); }
  }

  const MAX_VOXELS = 30e6;
  function generate(model, seed, o = {}) {
    const m = MODELS[model]; if (!m) throw new Error('Unknown model ' + model);
    const rng = makeRng(seed), quality = o.quality ?? 1;
    let prims, texture, lo, hi, voxel;
    if (m.kind === 'tree') {
      prims = deadTree(rng, o); prims.forEach(prep);
      lo = [0, 1, 2].map((i) => Math.min(...prims.map((p) => p.lo[i])) - 1.5);
      hi = [0, 1, 2].map((i) => Math.max(...prims.map((p) => p.hi[i])) + 1.5);
      lo[2] = -1; voxel = 0.2 / quality;
      texture = { bark: o.bark ?? 1 };
    } else {
      const S = m.rock ? (o.size ?? 1) : (o.scale ?? 0.25), minR = m.rock ? 0 : (o.minThick ?? 0.8) / 2;
      let bury; [prims, bury] = m.fn(rng, o);
      const scaleP = (p) => {
        if (p.t === 'fn') { p.c = mul(p.c, S); p.s = (p.s || 1) * S; p.k *= S; return; }
        if (p.t === 'chain') p.segs.forEach(scaleP);
        else if (p.t === 'cone') { p.a = mul(p.a, S); p.b = mul(p.b, S); p.r1 = Math.max(p.r1 * S, minR); p.r2 = Math.max(p.r2 * S, minR); }
        else { p.c = mul(p.c, S); p.r = p.r.map((r) => Math.max(r * S, minR)); }
        p.k *= S;
      };
      prims.forEach(scaleP);
      prims.forEach(prep);
      const adds = prims.filter((p) => p.op === 'add');
      const dz = m.rock ? 0 : -Math.min(...adds.map((p) => p.lo[2])) - bury * S;   // rocks are placed on the ground already
      const shiftP = (p) => { if (p.t === 'fn') p.c[2] += dz; else if (p.t === 'chain') p.segs.forEach(shiftP); else if (p.t === 'cone') { p.a[2] += dz; p.b[2] += dz; } else p.c[2] += dz; };
      for (const p of prims) { shiftP(p); prep(p); }
      lo = [0, 1, 2].map((i) => Math.min(...adds.map((p) => p.lo[i])) - 1);
      hi = [0, 1, 2].map((i) => Math.max(...adds.map((p) => p.hi[i])) + 1);
      lo[2] = -0.6; hi[2] = Math.max(hi[2], 1);
      voxel = Math.min(0.2, Math.max(m.rock ? 0.09 : m.wood ? 0.075 : 0.06, Math.max(...sub(hi, lo)) / 420)) / quality;
      texture = m.wood || m.rock ? null : { bone: true };
    }
    const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
    voxel = Math.max(voxel, Math.cbrt(vol / (m.kind === 'tree' ? MAX_VOXELS / 2 : MAX_VOXELS)));
    const field = buildField(prims, { lo, hi, voxel, texture });
    let mesh = surfaceNets(field, lo, voxel);
    mesh = keepMainParts(mesh.positions, mesh.indices, m.keepAll ? 0.0005 : 0.02);
    taubin(mesh.positions, mesh.indices, o.smooth ?? m.smooth ?? (m.rock ? 3 : 8), voxel);
    const P = mesh.positions, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], P[i + c]); mx[c] = Math.max(mx[c], P[i + c]); }
    const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2;
    for (let i = 0; i < P.length; i += 3) { P[i] -= cx; P[i + 1] -= cy; P[i + 2] -= mn[2]; }
    return { positions: P, indices: mesh.indices, size: sub(mx, mn), voxel };
  }

  // ---------- binary STL + stored ZIP ----------
  function toSTL(positions, indices, name = 'generated 28mm terrain') {
    const nt = indices.length / 3, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
    const head = new TextEncoder().encode(name.slice(0, 79)); new Uint8Array(buf, 0, 80).set(head);
    dv.setUint32(80, nt, true);
    let o = 84;
    for (let t = 0; t < nt; t++) {
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3, P = positions;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (const v of [a, b, c]) { dv.setFloat32(o, P[v], true); dv.setFloat32(o + 4, P[v + 1], true); dv.setFloat32(o + 8, P[v + 2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Uint8Array(buf);
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function toZip(files) {                            // files: [{name, data: Uint8Array}] -> Uint8Array (stored, no compression)
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + sz;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  return { generate, toSTL, toZip, MODELS };
})();
if (typeof module !== 'undefined') module.exports = GEN;
