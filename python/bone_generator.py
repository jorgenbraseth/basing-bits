#!/usr/bin/env python3
"""
Desert bones generator: animal skulls and ribcages as printable STL files,
sized for 28mm miniature bases / dioramas.

Every piece is modelled in real-world centimetres, then scaled with --scale
(mm per real cm; default 0.25 ≈ 1:40, a slightly "heroic" 28mm scale so the
bones read well on the table). Each piece is half-sunk in sand: the bottom is
cut flat at ground level so it sits and glues flat on a base.

Requirements:  pip install numpy scipy scikit-image matplotlib   (matplotlib only for --render)

Models:
  skull_longhorn  steer skull with long sweeping horns
  skull_bull      heavy bull/bison skull with short curved horns
  skull_cow       hornless cow skull, one broken horn stub
  skull_ram       ram skull with curled horns
  skull_horse     long horse skull
  skull_wolf      small wolf/coyote skull
  skull_beast     giant horned monster skull (centerpiece)
  ribs_cattle     cattle ribcage lying on its back
  ribs_horse      horse ribcage lying on its side
  ribs_goat       small goat/sheep ribcage
  ribs_beast      giant beast ribcage (big centerpiece)

Examples:
  python bone_generator.py --render                      # one of each model
  python bone_generator.py --models skull_ram ribs_cattle --variants 4 --render
  python bone_generator.py --scale 0.3                   # everything 20% bigger
  python bone_generator.py --seed 42                     # different random variation
"""
import argparse, os, struct
import numpy as np
from skimage.measure import marching_cubes


# ----------------------------------------------------------------------------
# Primitives (all in real cm). Each is a dict; ops are applied in order.
# ----------------------------------------------------------------------------
def unit(v):
    v = np.asarray(v, float); return v / np.linalg.norm(v)


def cone(a, b, r1, r2, op='add', k=1.5):
    return dict(t='cone', a=np.array(a, float), b=np.array(b, float), r1=r1, r2=r2, op=op, k=k)


def ell(c, r, op='add', k=1.5):
    return dict(t='ell', c=np.array(c, float), r=np.array(r, float), R=np.eye(3), op=op, k=k)


def sph(c, r, op='add', k=1.5):
    return ell(c, (r, r, r), op, k)


def chain(pts, radii, k=1.0):
    return [cone(pts[i], pts[i+1], radii[i], radii[i+1], k=k) for i in range(len(pts) - 1)]


def rot_matrix(yaw=0, pitch=0, roll=0):
    cy, sy, cp, sp, cr, sr = np.cos(yaw), np.sin(yaw), np.cos(pitch), np.sin(pitch), np.cos(roll), np.sin(roll)
    Rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    Ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    Rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    return Rz @ Ry @ Rx


def transform(prims, M, shift=(0, 0, 0)):
    shift = np.asarray(shift, float)
    for p in prims:
        if p['t'] == 'cone':
            p['a'] = M @ p['a'] + shift; p['b'] = M @ p['b'] + shift
        else:
            p['c'] = M @ p['c'] + shift; p['R'] = M @ p['R']
    return prims


def mirror(y_side_prims_fn):
    """Call fn(s) for s = -1 and +1 and concatenate."""
    return y_side_prims_fn(-1) + y_side_prims_fn(1)


# ----------------------------------------------------------------------------
# Skulls  (x = forward/snout, y = left/right, z = up)
# ----------------------------------------------------------------------------
def bovine_skull(rng, horns='longhorn'):
    J = lambda s=1.0: rng.normal(0, s)
    P = [
        ell((-2, 0, 12), (12, 12, 10)),                       # cranium
        ell((6, 0, 13), (10, 11, 7)),                         # broad flat forehead
        cone((-9, -9, 17), (-9, 9, 17), 4.5, 4.5),            # poll (bar between horns)
        cone((8, -4, 10), (40, -3, 6), 6, 3.5),               # face / maxilla
        cone((8, 4, 10), (40, 3, 6), 6, 3.5),
        cone((8, 0, 12), (40, 0, 8), 5, 3),                   # nasal bridge
        ell((43, 0, 5), (5, 5.5, 3.5)),                       # muzzle (premaxilla)
        ell((18, -7, 6), (10, 4.5, 5)), ell((18, 7, 6), (10, 4.5, 5)),
        sph((8, -11, 13), 5.5), sph((8, 11, 13), 5.5),        # orbit rims
        sph((10, -13, 14), 5.0, 'sub', 1.0), sph((10, 13, 14), 5.0, 'sub', 1.0),   # eye sockets
        ell((32, 0, 9.5), (9, 2.4, 3.2), 'sub', 1.0),         # nasal opening
        ell((46, 0, 6), (3, 3.5, 2.5), 'sub', 1.0),           # nostril
        sph((-14, 0, 8), 3.2, 'sub', 0.8),                    # foramen magnum
        ell((14, 0, 0), (22, 6, 3), 'sub', 1.5),              # hollow palate underside
    ]
    for s in (-1, 1):
        base = np.array([-9, s*9, 17.5])
        n = 12
        if horns == 'longhorn':
            L = 55 + J(8); lift = 22 + J(5); fwd = 8 + J(4)
            f = lambda t: base + [fwd*t*t - 2*t, s*L*t, 3*t + lift*t**3]
            rad = lambda t: 5.2*(1 - t) + 1.6
        elif horns == 'bull':
            L = 17 + J(3)
            f = lambda t: base + [4*t + 4*t*t, s*(L*np.sin(t*2.2)/np.sin(2.2) + 2*t), 4*t + 16*t*t]
            rad = lambda t: 4.6*(1 - t)**0.9 + 1.5
        else:  # 'cow': short horn cores, one snapped
            L = 9 if s < 0 else 4 + abs(J(1)); n = 4
            f = lambda t: base + [2*t, s*L*t, 5*t]
            rad = lambda t: 5 - 1.5*t
        ts = np.linspace(0, 1, n)
        P += chain([f(t) for t in ts], [rad(t) for t in ts], k=1.0)
    return P, 1.5      # prims, bury depth (cm)


def ram_skull(rng):
    J = lambda s=1.0: rng.normal(0, s)
    P = [
        ell((-2, 0, 9), (8, 7, 8)),
        cone((4, -2, 9), (22, -1.5, 5), 4.2, 2.4), cone((4, 2, 9), (22, 1.5, 5), 4.2, 2.4),
        cone((4, 0, 11), (21, 0, 7), 3.5, 2.0),
        ell((24, 0, 4.5), (3, 2.5, 2)),
        sph((4, -6.5, 10), 3.6), sph((4, 6.5, 10), 3.6),
        sph((5, -7.6, 10.5), 3.0, 'sub', 0.6), sph((5, 7.6, 10.5), 3.0, 'sub', 0.6),
        ell((18, 0, 7.5), (5, 1.3, 2), 'sub', 0.6),
        sph((-9, 0, 6), 2, 'sub', 0.5),
    ]
    for s in (-1, 1):
        th_max = 1.75*np.pi + J(0.15)
        R0 = 9.5 + J(0.8); c = np.array([-3, 0, 14 - R0])
        ts = np.linspace(0, 1, 26)
        pts, rad = [], []
        for t in ts:
            th = t*th_max; R = R0*(1 - 0.42*t)
            a = np.pi/2 + th                              # starts on top, curls back, down, forward
            pts.append(c + [R*np.cos(a), s*(4 + 9*t), R*np.sin(a)])
            rad.append(4.6*(1 - t) + 1.4)
        P += chain(pts, rad, k=0.8)
    return P, 1.0


def horse_skull(rng):
    P = [
        ell((-6, 0, 12), (11, 9, 10)),                            # braincase
        cone((-16, 0, 15), (2, 0, 19), 3, 3),                     # top crest
        cone((2, -10, 12), (10, -10.5, 16), 2.8, 2.4), cone((2, 10, 12), (10, 10.5, 16), 2.8, 2.4),   # orbital bars
        ell((9, -9, 13), (5, 3.5, 5)), ell((9, 9, 13), (5, 3.5, 5)),
        cone((4, 0, 14), (44, 0, 8), 7.5, 3.8),                   # long face
        cone((6, -5, 10), (42, -3, 5), 6, 3.2), cone((6, 5, 10), (42, 3, 5), 6, 3.2),
        cone((10, -8, 8), (26, -7, 7), 2.6, 2), cone((10, 8, 8), (26, 7, 7), 2.6, 2),   # facial crests
        ell((47, 0, 5), (5.5, 4.5, 3.5)),
        ell((18, -5.5, 3.5), (15, 2.6, 3)), ell((18, 5.5, 3.5), (15, 2.6, 3)),         # cheek teeth rows
        sph((7, -11.5, 14.5), 4.2, 'sub', 0.8), sph((7, 11.5, 14.5), 4.2, 'sub', 0.8),   # eye sockets
        ell((40, 0, 10), (9, 2, 3), 'sub', 0.8),                  # nasal notch
        ell((-12, -8, 13), (5, 3, 4), 'sub', 1.0), ell((-12, 8, 13), (5, 3, 4), 'sub', 1.0),  # temporal fossae
        sph((-17, 0, 9), 2.8, 'sub', 0.6),
    ]
    return P, 1.0


def wolf_skull(rng):
    """Big wolf / hyena-sized canid skull (slightly oversized so it reads at 28mm)."""
    P = [
        ell((-4, 0, 8), (9, 6.5, 6.5)),                           # braincase
        cone((-13, 0, 12.5), (1, 0, 14), 1.8, 2.0),               # sagittal crest
        cone((-5, -8, 6.5), (6, -7, 7), 2.0, 2.0), cone((-5, 8, 6.5), (6, 7, 7), 2.0, 2.0),  # cheekbones
        cone((4, 0, 9), (21, 0, 5.5), 4.6, 2.6),                  # snout
        cone((4, -2.6, 7), (21, -1.8, 4), 3.6, 2.3), cone((4, 2.6, 7), (21, 1.8, 4), 3.6, 2.3),
        cone((17.5, -2.4, 3.5), (18.2, -2.4, -1.5), 1.6, 0.9), cone((17.5, 2.4, 3.5), (18.2, 2.4, -1.5), 1.6, 0.9),  # canines
        sph((4.5, -5.6, 9.5), 3.2, 'sub', 0.5), sph((4.5, 5.6, 9.5), 3.2, 'sub', 0.5),      # eye sockets
        ell((-3, -6.5, 8), (4, 2, 3), 'sub', 0.6), ell((-3, 6.5, 8), (4, 2, 3), 'sub', 0.6),  # temporal openings
        ell((22, 0, 5.8), (2, 1.6, 1.6), 'sub', 0.4),
    ]
    return P, 0.6


def beast_skull(rng):
    J = lambda s=1.0: rng.normal(0, s)
    P = [
        ell((-15, 0, 30), (35, 30, 28)),
        cone((5, -24, 44), (35, -18, 40), 12, 9), cone((5, 24, 44), (35, 18, 40), 12, 9),   # brow ridges
        cone((10, 0, 30), (110, 0, 20), 26, 13),
        cone((10, -15, 24), (105, -10, 14), 18, 10), cone((10, 15, 24), (105, 10, 14), 18, 10),
        ell((112, 0, 18), (12, 14, 10)),
        sph((32, -27, 40), 12, 'sub', 3), sph((32, 27, 40), 12, 'sub', 3),                   # eye sockets
        ell((-12, -31, 30), (14, 7, 10), 'sub', 3), ell((-12, 31, 30), (14, 7, 10), 'sub', 3),  # skull windows
        ell((80, 0, 39), (16, 5, 7), 'sub', 2), ell((118, 0, 22), (5, 9, 5), 'sub', 2),
    ]
    for s in (-1, 1):
        # main horns sweeping back and up
        base = np.array([-20, s*20, 50]); L = 90 + J(10)
        ts = np.linspace(0, 1, 12)
        pts = [base + [-0.8*L*t, s*(28*t + 10*t*t), 60*t - 20*t*t + 25*t**3] for t in ts]
        P += chain(pts, [13*(1 - t) + 3 for t in ts], k=2)
        # brow spikes
        for i, u in enumerate((0.15, 0.45, 0.75)):
            b = np.array([5 + 30*u, s*(24 - 6*u), 46 - 4*u])
            P.append(cone(b, b + [-10, s*6, 13 - 3*i], 5, 2, k=1.5))
        # fangs, stabbing into the sand
        for x, r in ((96, 5.5), (70, 4)):
            P.append(cone((x, s*12, 10), (x + 2, s*12, -12), r, 2, k=1.5))
        # lower jaw, fallen slightly askew, with a row of teeth
        j0, j1 = np.array([-10, s*28, -2]), np.array([95, s*9, -5])
        P.append(cone(j0, j1, 9, 6, k=2))
        P.append(cone(j0, j0 + [-6, s*2, 18], 7, 5, k=2))        # jaw hinge
        for u in np.linspace(0.3, 0.95, 6):
            b = j0 + (j1 - j0)*u + [0, 0, 5]
            P.append(cone(b, b + [1, -s*1, 7 + 4*(u > 0.8)], 3, 1.5, k=1))
    return P, 7


# ----------------------------------------------------------------------------
# Ribcages
# ----------------------------------------------------------------------------
def ribcage(rng, L, a, b, n, r_rib, r_vert, side=False, broken=0.3, missing=0.12):
    """Spine along x, ribs as arcs. Lying on its back (tilted) unless side=True."""
    P = []
    nv = int(n*1.15) + 4
    xs = np.linspace(-0.08*L, 1.12*L, nv)
    zsp = r_vert*0.6
    vpts = [np.array([x, rng.normal(0, r_vert*0.2), zsp + rng.normal(0, r_vert*0.1)]) for x in xs]
    for i, p in enumerate(vpts):
        tail = max(0, (p[0] - L)/(0.12*L))               # vertebrae shrink toward the tail end
        rv = r_vert*(1 - 0.35*tail)
        P.append(ell(p, (rv*0.75, rv, rv*0.85), k=rv*0.3))
        P.append(cone(p + [0, -rv*1.1, 0], p + [0, rv*1.1, 0], rv*0.3, rv*0.3, k=rv*0.3))   # transverse processes
        if i:
            P.append(cone(vpts[i-1], p, rv*0.45, rv*0.45, k=rv*0.3))
    for i in range(n):
        u = i/(n - 1)
        size = 0.55 + 0.45*np.sin(np.pi*(0.2 + 0.75*u))          # small at neck, big mid, smaller at back
        x0 = 0.04*L + 0.86*L*u
        for s in (-1, 1):
            if rng.random() < missing:
                continue
            ph_end = rng.uniform(0.9, 1.9) if rng.random() < broken else rng.uniform(2.2, 2.6)
            A, B = a*size*rng.uniform(0.9, 1.08), b*size*rng.uniform(0.9, 1.08)
            slant = 0.3*B*rng.uniform(0.8, 1.2)
            sag = rng.normal(0, 0.06)                             # some ribs fallen in or out a bit
            phs = np.linspace(0.05, ph_end, 12)
            pts = [np.array([x0 + slant*(1 - np.cos(ph)),
                             s*(r_vert*0.8 + A*np.sin(ph)*(1 + sag*ph)),
                             zsp + B*(1 - np.cos(ph))]) for ph in phs]
            rr = [r_rib*(1.2 - 0.5*ph/2.6) for ph in phs]
            P += chain(pts, rr, k=r_rib*0.5)
    if side:
        transform(P, rot_matrix(roll=np.pi/2 + rng.normal(0, 0.15)), (0, 0, r_vert))
        bury = 0.25*a
    else:
        transform(P, rot_matrix(roll=rng.choice([-1, 1])*rng.uniform(0.15, 0.35), pitch=rng.normal(0, 0.04)))
        bury = r_vert*0.9
    return P, bury


MODELS = {
    'skull_longhorn': lambda rng: bovine_skull(rng, 'longhorn'),
    'skull_bull':     lambda rng: bovine_skull(rng, 'bull'),
    'skull_cow':      lambda rng: bovine_skull(rng, 'cow'),
    'skull_ram':      ram_skull,
    'skull_horse':    horse_skull,
    'skull_wolf':     wolf_skull,
    'skull_beast':    beast_skull,
    'ribs_cattle':    lambda rng: ribcage(rng, 100, 30, 28, 10, 1.9, 4.5),
    'ribs_horse':     lambda rng: ribcage(rng, 115, 26, 32, 11, 1.9, 5, side=True),
    'ribs_goat':      lambda rng: ribcage(rng, 55, 16, 15, 9, 1.6, 2.6),
    'ribs_beast':     lambda rng: ribcage(rng, 260, 85, 85, 11, 6.5, 14, broken=0.35),
}


# ----------------------------------------------------------------------------
# Solid + mesh
# ----------------------------------------------------------------------------
def sd_cone(P, a, b, r1, r2):
    ba = b - a; l2 = ba @ ba; rr = r1 - r2; a2 = l2 - rr*rr; il2 = 1.0/l2
    pa = P - a; y = pa @ ba; z = y - l2
    x = pa*l2 - y[..., None]*ba; x2 = (x*x).sum(-1); y2 = y*y*l2; z2 = z*z*l2
    k = np.sign(rr)*rr*rr*x2
    out = (np.sqrt(np.maximum(x2*a2*il2, 0)) + y*rr)*il2 - r1
    m1 = np.sign(z)*a2*z2 > k; m2 = np.sign(y)*a2*y2 < k
    out = np.where(m1, np.sqrt(x2 + z2)*il2 - r2, out)
    out = np.where(m2 & ~m1, np.sqrt(x2 + y2)*il2 - r1, out)
    return out


def sd_ell(P, c, r, R):
    q = (P - c) @ R                       # into local frame
    k0 = np.linalg.norm(q/r, axis=-1); k1 = np.linalg.norm(q/(r*r), axis=-1)
    return k0*(k0 - 1)/np.maximum(k1, 1e-9)


def build(prims, scale, bury_cm, min_r_mm, voxel=None):
    S = scale
    # scale to mm, enforce printable minimum radius, sink into the ground
    for p in prims:
        if p['t'] == 'cone':
            p['a'] = p['a']*S; p['b'] = p['b']*S
            p['r1'] = max(p['r1']*S, min_r_mm); p['r2'] = max(p['r2']*S, min_r_mm)
            if np.linalg.norm(p['b'] - p['a']) < 1e-4: p['b'] = p['a'] + [0, 0, 1e-3]
        else:
            p['c'] = p['c']*S; p['r'] = np.maximum(p['r']*S, min_r_mm)
        p['k'] *= S
    lows = [min(p['a'][2] - p['r1'], p['b'][2] - p['r2']) if p['t'] == 'cone' else p['c'][2] - p['r'].max()
            for p in prims if p['op'] == 'add']
    dz = -min(lows) - bury_cm*S
    for p in prims:
        if p['t'] == 'cone': p['a'][2] += dz; p['b'][2] += dz
        else: p['c'][2] += dz

    def bbox(p):
        if p['t'] == 'cone':
            r = max(p['r1'], p['r2']); return np.minimum(p['a'], p['b']) - r, np.maximum(p['a'], p['b']) + r
        r = p['r'].max(); return p['c'] - r, p['c'] + r

    bbs = [bbox(p) for p in prims if p['op'] == 'add']
    lo = np.min([b[0] for b in bbs], 0) - 1.0; hi = np.max([b[1] for b in bbs], 0) + 1.0
    lo[2] = -0.6; hi[2] = max(hi[2], 1.0)
    if voxel is None:
        voxel = float(np.clip((hi - lo).max()/420, 0.06, 0.2))
    xs, ys, zs = [np.arange(lo[i], hi[i], voxel) for i in range(3)]
    F = np.full((len(xs), len(ys), len(zs)), 10.0, np.float32)

    for p in prims:
        m, M = bbox(p); pad = p['k'] + 0.4
        m = m - pad; M = M + pad
        i0, i1 = np.searchsorted(xs, m[0]), np.searchsorted(xs, M[0])
        j0, j1 = np.searchsorted(ys, m[1]), np.searchsorted(ys, M[1])
        k0, k1 = np.searchsorted(zs, m[2]), np.searchsorted(zs, M[2])
        if i1 <= i0 or j1 <= j0 or k1 <= k0: continue
        X, Y, Z = np.meshgrid(xs[i0:i1], ys[j0:j1], zs[k0:k1], indexing='ij')
        Pg = np.stack([X, Y, Z], -1)
        d = sd_cone(Pg, p['a'], p['b'], p['r1'], p['r2']) if p['t'] == 'cone' else sd_ell(Pg, p['c'], p['r'], p['R'])
        f = F[i0:i1, j0:j1, k0:k1]; k = p['k']
        if p['op'] == 'add':
            h = np.clip(0.5 + 0.5*(d - f)/k, 0, 1)
            F[i0:i1, j0:j1, k0:k1] = d*(1 - h) + f*h - k*h*(1 - h)
        else:
            h = np.clip(0.5 - 0.5*(f + d)/k, 0, 1)
            F[i0:i1, j0:j1, k0:k1] = f*(1 - h) - d*h + k*h*(1 - h)

    # faint weathering so bones don't look like plastic
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    noise = 0.025*(np.sin(X*7.1 + Y*3.3) * np.sin(Y*6.7 - Z*4.1) + np.sin(Z*8.3 + X*2.9))
    F = np.where(np.abs(F) < 0.3, F + noise, F)
    F = np.maximum(F, -Z)                                    # flat bottom at ground level
    F[:, :, 0] = F[:, :, -1] = 1.0; F[0] = F[-1] = 1.0; F[:, 0] = F[:, -1] = 1.0
    del X, Y, Z, noise

    v, f, _, _ = marching_cubes(F, 0.0, spacing=(voxel,)*3, gradient_direction='ascent')
    v += lo; v[:, 2] -= v[:, 2].min()
    v, f = keep_main_parts(v, f)
    v[:, :2] -= (v[:, :2].min(0) + v[:, :2].max(0))/2
    return v.astype(np.float32), f


def keep_main_parts(v, f):
    """Drop sealed internal voids and tiny loose bits (e.g. a rib tip poking out of the sand)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]]])
    nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(v), len(v))), directed=False)
    if nc == 1:
        return v, f
    flab = lab[f[:, 0]]; counts = np.bincount(flab, minlength=nc)
    zmin = np.full(nc, np.inf); np.minimum.at(zmin, lab, v[:, 2])
    keep = (counts >= 0.02*counts.max()) & (zmin <= v[:, 2].min() + 0.05)
    f = f[keep[flab]]
    used = np.unique(f); remap = -np.ones(len(v), int); remap[used] = np.arange(len(used))
    return v[used], remap[f]


def write_stl(path, v, f, name=b'desert bones 28mm'):
    tri = v[f]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    data = np.zeros(len(f), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    data['n'] = n; data['v'] = tri
    with open(path, 'wb') as fh:
        fh.write(name.ljust(80, b' ')); fh.write(struct.pack('<I', len(f))); fh.write(data.tobytes())


def render_overview(meshes, labels, path, same_scale=False):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    L = unit([0.4, -0.6, 0.8])
    cols = min(4, len(meshes)); rows = (len(meshes) + cols - 1)//cols
    gs = max((v.max(0) - v.min(0)).max() for v, _ in meshes)/2
    fig = plt.figure(figsize=(4*cols, 3.6*rows), facecolor='white')
    for i, ((v, f), lab) in enumerate(zip(meshes, labels)):
        t = v[f]
        n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        sh = np.clip(n @ L, 0, 1)*0.55 + 0.42
        ax = fig.add_subplot(rows, cols, i + 1, projection='3d')
        ax.add_collection3d(Poly3DCollection(t, facecolors=np.stack([sh*.93, sh*.88, sh*.76, np.ones_like(sh)], 1), edgecolor='none'))
        ext = v.max(0) - v.min(0)
        s = gs if same_scale else ext.max()/2*1.05
        m = (v.min(0) + v.max(0))/2
        ax.set_xlim(m[0]-s, m[0]+s); ax.set_ylim(m[1]-s, m[1]+s); ax.set_zlim(0, 2*s)
        ax.set_box_aspect((1, 1, 1)); ax.view_init(elev=32, azim=-35); ax.set_axis_off()
        ax.set_title(f"{lab}\n{ext[0]:.0f} × {ext[1]:.0f} × {ext[2]:.0f} mm", fontsize=10)
    plt.tight_layout(); plt.savefig(path, dpi=100); plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description="Generate desert skulls and ribcages as STL for 28mm bases.")
    ap.add_argument('--models', nargs='+', default=list(MODELS), choices=list(MODELS), help='which models (default: all)')
    ap.add_argument('--variants', type=int, default=1, help='random variants per model')
    ap.add_argument('--seed', type=int, default=1, help='base random seed')
    ap.add_argument('--scale', type=float, default=0.25, help='mm per real cm (0.25 ≈ 1:40 heroic 28mm)')
    ap.add_argument('--min-thick', type=float, default=0.8, help='thinnest bone diameter in mm')
    ap.add_argument('--voxel', type=float, default=None, help='mesh resolution in mm (auto by size if omitted)')
    ap.add_argument('--outdir', default='bones_out')
    ap.add_argument('--render', action='store_true', help='save overview.png (needs matplotlib)')
    a = ap.parse_args()

    os.makedirs(a.outdir, exist_ok=True)
    meshes, labels = [], []
    for mi, name in enumerate(a.models):
        for vi in range(a.variants):
            seed = a.seed*1000 + mi*37 + vi
            prims, bury = MODELS[name](np.random.default_rng(seed))
            v, f = build(prims, a.scale, bury, a.min_thick/2, a.voxel)
            fn = f"{name}_{vi+1:02d}.stl" if a.variants > 1 else f"{name}.stl"
            write_stl(os.path.join(a.outdir, fn), v, f)
            ext = v.max(0) - v.min(0)
            print(f"{fn}: {ext[0]:.1f} x {ext[1]:.1f} x {ext[2]:.1f} mm, {len(f)} triangles")
            if a.render:
                meshes.append((v, f)); labels.append(fn[:-4])
    if a.render:
        p = os.path.join(a.outdir, 'overview.png')
        render_overview(meshes, labels, p)
        print("overview:", p)


if __name__ == '__main__':
    main()
