#!/usr/bin/env python3
"""
Gnarled dead-tree generator for 28mm miniatures -> printable STL files.

Each tree is grown as a set of tapered branch segments, blended into one
smooth solid (signed distance field), given bark texture, cut flat at the
bottom, and meshed with marching cubes. Output is a closed (watertight) mesh.

Requirements:  pip install numpy scikit-image matplotlib
               (matplotlib is only needed for --render)

Examples:
  python dead_tree_generator.py                         # 10 random trees in ./trees_out
  python dead_tree_generator.py --count 5 --render      # 5 trees + overview image
  python dead_tree_generator.py --seeds 14 27 40        # specific trees again
  python dead_tree_generator.py --height 0.8 --gnarl 1.3 --count 10 --render
  python dead_tree_generator.py --seeds 14 27 40 53 66 79 92 105 118 131
        # ^ reproduces the original set dead_tree_01..10
"""
import argparse, os, struct
import numpy as np
from skimage.measure import marching_cubes


# ----------------------------------------------------------------------------
# Tree skeleton
# ----------------------------------------------------------------------------
def unit(v):
    return v / np.linalg.norm(v)


def rot_toward(d, axis, ang):
    k = unit(axis)
    return unit(d*np.cos(ang) + np.cross(k, d)*np.sin(ang) + k*np.dot(k, d)*(1 - np.cos(ang)))


def grow_tree(seed, height=1.0, gnarl=1.0, min_r=0.55, thickness=1.0):
    """Return a list of segments (a, b, radius_a, radius_b) in mm."""
    rng = np.random.default_rng(seed)
    segs = []

    def knot(p, d, r):
        off = unit(np.cross(d, rng.normal(size=3)))
        c = p + off*r*rng.uniform(0.45, 0.75)
        segs.append((c, c + d*r*0.5, r*rng.uniform(0.45, 0.7), r*rng.uniform(0.35, 0.55)))

    def limb(p, d, r, length, depth, nseg, fork=False):
        step = length / nseg
        for i in range(nseg):
            side = unit(np.cross(d, rng.normal(size=3)))
            d = rot_toward(d, side, rng.normal(0, (0.62 if depth else 0.36)*gnarl))
            up = (0.16 if depth == 0 else 0.06 + 0.04*depth) - (0.12 if depth and rng.random() < 0.25 else 0)
            d = unit(d + np.array([0, 0, up]))
            r2 = max(min_r, r * (0.90 if depth == 0 else 0.83))
            q = p + d*step*rng.uniform(0.7, 1.3)
            segs.append((p.copy(), q.copy(), r, r2))
            if r > 1.2 and rng.random() < (0.45 if depth == 0 else 0.25):
                knot(p, d, r)
            if depth < 3 and r2 > min_r*1.6 and i >= (2 if depth == 0 else 0) \
                    and rng.random() < (0.5 if depth == 0 else 0.42):
                nd = rot_toward(d, unit(np.cross(d, rng.normal(size=3))), rng.uniform(0.7, 1.3))
                br = r2*rng.uniform(0.5, 0.72)
                if rng.random() < 0.32:          # broken stub
                    limb(q, nd, max(br, 0.9), length*rng.uniform(0.08, 0.16), 3, 2)
                else:
                    limb(q, nd, br, length*rng.uniform(0.5, 0.75), depth + 1, max(3, nseg - 3))
            p, r = q, r2
        if fork:                                 # trunk splits into main limbs at the top
            for _ in range(rng.integers(2, 4)):
                nd = rot_toward(d, unit(np.cross(d, rng.normal(size=3))), rng.uniform(0.5, 1.0))
                limb(p, nd, r*rng.uniform(0.6, 0.8), length*rng.uniform(0.45, 0.7), 1, 5)

    # trunk
    H = rng.uniform(26, 34) * height
    lean = unit(np.array([rng.normal(0, .25), rng.normal(0, .25), 1.0]))
    limb(np.zeros(3), lean, rng.uniform(3.6, 4.4) * thickness, H, 0, 8, fork=True)

    # roots: thick, twisting, hugging the ground
    for a in np.linspace(0, 2*np.pi, rng.integers(5, 8), endpoint=False) + rng.uniform(0, 1):
        d = unit(np.array([np.cos(a), np.sin(a), -0.35]))
        p = np.array([0., 0., 3.5]); r = rng.uniform(1.8, 2.6) * thickness
        for _ in range(rng.integers(3, 5)):
            q = p + d*rng.uniform(2.0, 3.2); q[2] = max(r*0.35 - 0.2, q[2])
            r2 = max(0.6, r*0.68)
            segs.append((p.copy(), q.copy(), r, r2)); p, r = q, r2
            d = unit(d + np.array([rng.normal(0, .45), rng.normal(0, .45), 0]))
    return segs


# ----------------------------------------------------------------------------
# Solid + mesh
# ----------------------------------------------------------------------------
def round_cone(P, a, b, r1, r2):
    """Signed distance to a tapered capsule (Inigo Quilez)."""
    ba = b - a; l2 = ba @ ba; rr = r1 - r2; a2 = l2 - rr*rr; il2 = 1.0/l2
    pa = P - a; y = pa @ ba; z = y - l2
    x = pa*l2 - y[..., None]*ba; x2 = (x*x).sum(-1); y2 = y*y*l2; z2 = z*z*l2
    k = np.sign(rr)*rr*rr*x2
    out = (np.sqrt(x2*a2*il2) + y*rr)*il2 - r1
    m1 = np.sign(z)*a2*z2 > k
    m2 = np.sign(y)*a2*y2 < k
    out = np.where(m1, np.sqrt(x2 + z2)*il2 - r2, out)
    out = np.where(m2 & ~m1, np.sqrt(x2 + y2)*il2 - r1, out)
    return out


def mesh_tree(segs, vox=0.18, blend=0.6, bark=1.0):
    A = np.array([s[0] for s in segs]); B = np.array([s[1] for s in segs])
    R = np.array([[s[2], s[3]] for s in segs])
    lo = np.minimum(A, B).min(0) - 5; hi = np.maximum(A, B).max(0) + 5; lo[2] = -1.0
    xs, ys, zs = [np.arange(lo[i], hi[i], vox) for i in range(3)]
    F = np.full((len(xs), len(ys), len(zs)), 10.0, np.float32)

    for a, b, (r1, r2) in zip(A, B, R):          # smooth union, only near each segment
        pad = max(r1, r2) + blend + 0.5
        m = np.minimum(a, b) - pad; M = np.maximum(a, b) + pad
        i0, i1 = np.searchsorted(xs, m[0]), np.searchsorted(xs, M[0])
        j0, j1 = np.searchsorted(ys, m[1]), np.searchsorted(ys, M[1])
        k0, k1 = np.searchsorted(zs, m[2]), np.searchsorted(zs, M[2])
        if i1 <= i0 or j1 <= j0 or k1 <= k0:
            continue
        X, Y, Z = np.meshgrid(xs[i0:i1], ys[j0:j1], zs[k0:k1], indexing='ij')
        d = round_cone(np.stack([X, Y, Z], -1), a, b, r1, r2)
        f = F[i0:i1, j0:j1, k0:k1]
        h = np.clip(0.5 + 0.5*(d - f)/blend, 0, 1)
        F[i0:i1, j0:j1, k0:k1] = d*(1 - h) + f*h - blend*h*(1 - h)

    # bark furrows, applied only near the surface
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    ang = np.arctan2(Y, X)
    tex = bark*(0.17*np.sin(ang*9 + Z*0.35 + 1.5*np.sin(Z*0.2))
                + 0.10*np.sin(X*2.1 + Z*1.7)*np.sin(Y*1.9 - Z*1.1))
    F = np.where(np.abs(F) < 1.0, F + tex*np.clip(F + 1.0, 0, 1), F)
    F = np.maximum(F, -Z)                        # flat bottom at z = 0
    F[:, :, 0] = F[:, :, -1] = 1.0; F[0] = F[-1] = 1.0; F[:, 0] = F[:, -1] = 1.0
    del X, Y, Z, ang, tex

    v, f, _, _ = marching_cubes(F, 0.0, spacing=(vox,)*3, gradient_direction='ascent')
    v += lo
    v[:, 2] -= v[:, 2].min()
    return v.astype(np.float32), f


def write_stl(path, v, f):
    tri = v[f]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    data = np.zeros(len(f), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    data['n'] = n; data['v'] = tri
    with open(path, 'wb') as fh:
        fh.write(b'dead tree 28mm'.ljust(80, b' '))
        fh.write(struct.pack('<I', len(f)))
        fh.write(data.tobytes())


def render_overview(meshes, labels, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    L = unit(np.array([0.4, -0.6, 0.7]))
    cols = min(5, len(meshes)); rows = (len(meshes) + cols - 1) // cols
    s = max(max((v.max(0) - v.min(0)).max() for v, _ in meshes) / 2, 10)
    fig = plt.figure(figsize=(3*cols, 3.75*rows), facecolor='white')
    for i, ((v, f), lab) in enumerate(zip(meshes, labels)):
        t = v[f]
        n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        sh = np.clip(n @ L, 0, 1)*0.75 + 0.2
        ax = fig.add_subplot(rows, cols, i + 1, projection='3d')
        ax.add_collection3d(Poly3DCollection(
            t, facecolors=np.stack([sh*.55, sh*.45, sh*.36, np.ones_like(sh)], 1), edgecolor='none'))
        m = (v.min(0) + v.max(0)) / 2
        ax.set_xlim(m[0]-s, m[0]+s); ax.set_ylim(m[1]-s, m[1]+s); ax.set_zlim(0, 2*s)
        ax.set_box_aspect((1, 1, 1)); ax.view_init(elev=12, azim=-60); ax.set_axis_off()
        ax.set_title(f"{lab}  ·  {v[:, 2].max():.0f} mm tall", fontsize=10)
    fig.suptitle("Dead trees (same scale)", fontsize=13)
    plt.tight_layout(); plt.savefig(path, dpi=100); plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description="Generate gnarled dead trees as STL for 28mm miniatures.")
    ap.add_argument('--count', type=int, default=10, help='number of random trees (ignored if --seeds given)')
    ap.add_argument('--seeds', type=int, nargs='+', help='specific seeds; same seed + settings = same tree')
    ap.add_argument('--outdir', default='trees_out', help='output folder')
    ap.add_argument('--height', type=float, default=1.0, help='height multiplier (1.0 ≈ 35–50 mm tall)')
    ap.add_argument('--thickness', type=float, default=1.0, help='trunk/root thickness multiplier')
    ap.add_argument('--gnarl', type=float, default=1.0, help='how twisted branches are (0.5 calm, 1.5 wild)')
    ap.add_argument('--bark', type=float, default=1.0, help='bark texture depth multiplier (0 = smooth)')
    ap.add_argument('--min-twig', type=float, default=1.1, help='thinnest twig diameter in mm')
    ap.add_argument('--voxel', type=float, default=0.18, help='mesh resolution in mm (smaller = finer, slower)')
    ap.add_argument('--render', action='store_true', help='also save an overview PNG (needs matplotlib)')
    a = ap.parse_args()

    seeds = a.seeds or list(np.random.default_rng().integers(0, 1_000_000, a.count))
    os.makedirs(a.outdir, exist_ok=True)
    meshes, labels = [], []
    for i, seed in enumerate(seeds, 1):
        segs = grow_tree(int(seed), a.height, a.gnarl, a.min_twig/2, a.thickness)
        v, f = mesh_tree(segs, a.voxel, bark=a.bark)
        name = f"dead_tree_{i:02d}_seed{seed}.stl"
        write_stl(os.path.join(a.outdir, name), v, f)
        ext = v.max(0) - v.min(0)
        print(f"{name}: {ext[0]:.0f} x {ext[1]:.0f} x {ext[2]:.0f} mm, {len(f)} triangles")
        if a.render:
            meshes.append((v, f)); labels.append(f"#{i} (seed {seed})")
    if a.render:
        p = os.path.join(a.outdir, 'overview.png')
        render_overview(meshes, labels, p)
        print("overview:", p)


if __name__ == '__main__':
    main()
