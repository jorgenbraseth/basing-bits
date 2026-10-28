#!/usr/bin/env python3
"""Dimensioned orthographic sketches of the Battlefields: Armageddon terrain.

Writes one SVG per piece next to this script, drawn 1:1 in millimetres, so
a sheet printed at 100% matches the real piece. Each sheet uses
third-angle projection: the top view sits above the front view, and the
right-hand side view sits to the right of it.

Dimensions marked with ~ are estimates scaled from photos. The rest are the
measured plan sizes and the 3" floor from ../wh40k-11e-terrain.md.
"""
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))

INK = "#1d2733"
THIN = "#5b6b7c"
DIM = "#c0392b"
GLASS = "#dfe9f3"
FILL = "#ffffff"
SOLID = "#e8ecf0"

GAP = 34      # space between views, room for dimension lines
MARGIN = 26


def fmt(mm, est):
    s = f"{mm:.0f} mm ({mm / 25.4:.2f}\")"
    return ("~" + s) if est else s


class View:
    """One projection. u runs right, v runs up, both in mm."""

    def __init__(self, ox, oy):
        self.ox, self.oy = ox, oy   # sheet position of (u=0, v=0)
        self.out = []

    def p(self, u, v):
        return self.ox + u, self.oy - v

    def poly(self, pts, fill=FILL, stroke=INK, w=0.5, dash=None):
        d = " ".join(f"{x:.2f},{y:.2f}" for x, y in (self.p(u, v) for u, v in pts))
        extra = f' stroke-dasharray="{dash}"' if dash else ""
        self.out.append(f'<polygon points="{d}" fill="{fill}" stroke="{stroke}" '
                        f'stroke-width="{w}" stroke-linejoin="round"{extra}/>')

    def rect(self, u, v, wu, hv, **kw):
        self.poly([(u, v), (u + wu, v), (u + wu, v + hv), (u, v + hv)], **kw)

    def line(self, u1, v1, u2, v2, stroke=THIN, w=0.3, dash=None):
        x1, y1 = self.p(u1, v1)
        x2, y2 = self.p(u2, v2)
        extra = f' stroke-dasharray="{dash}"' if dash else ""
        self.out.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
                        f'stroke="{stroke}" stroke-width="{w}"{extra}/>')

    def path(self, pts, stroke=THIN, w=0.3, fill="none"):
        d = "M " + " L ".join(f"{x:.2f},{y:.2f}" for x, y in (self.p(u, v) for u, v in pts))
        self.out.append(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{w}" '
                        f'stroke-linejoin="round"/>')

    def circle(self, u, v, r, fill=FILL, stroke=INK, w=0.5):
        x, y = self.p(u, v)
        self.out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}" fill="{fill}" '
                        f'stroke="{stroke}" stroke-width="{w}"/>')

    def arch(self, u, v, wu, hv, fill=GLASS, stroke=INK, w=0.35):
        """A pointed gothic opening: sides up to v + hv - wu*0.7, then a point."""
        spring = hv - wu * 0.75
        pts = [(u, v), (u + wu, v), (u + wu, v + spring)]
        for i in range(1, 8):
            t = i / 8
            pts.append((u + wu - wu / 2 * t, v + spring + wu * 0.75 * math.sin(t * math.pi / 2)))
        for i in range(7, 0, -1):
            t = i / 8
            pts.append((u + wu / 2 * t, v + spring + wu * 0.75 * math.sin(t * math.pi / 2)))
        pts.append((u, v + spring))
        self.poly(pts, fill=fill, stroke=stroke, w=w)

    def text(self, u, v, s, size=3.2, anchor="middle", color=INK, weight="normal", rot=0):
        x, y = self.p(u, v)
        tr = f' transform="rotate({rot} {x:.2f} {y:.2f})"' if rot else ""
        self.out.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" text-anchor="{anchor}" '
                        f'fill="{color}" font-weight="{weight}"{tr}>{s}</text>')

    def hdim(self, u1, u2, v, ref_v, mm=None, est=False):
        """Horizontal dimension at height v, with extension lines from ref_v."""
        mm = abs(u2 - u1) if mm is None else mm
        for u in (u1, u2):
            self.line(u, ref_v, u, v + (1.5 if v > ref_v else -1.5), stroke=DIM, w=0.2)
        self.line(u1, v, u2, v, stroke=DIM, w=0.25)
        for u, s in ((u1, 1), (u2, -1)):
            self.poly([(u, v), (u + 2.2 * s, v + 0.7), (u + 2.2 * s, v - 0.7)], fill=DIM, stroke=DIM, w=0.1)
        self.text((u1 + u2) / 2, v + 1.2, fmt(mm, est), size=2.8, color=DIM)

    def vdim(self, v1, v2, u, ref_u, mm=None, est=False, label=None):
        """Vertical dimension at u, with extension lines from ref_u."""
        mm = abs(v2 - v1) if mm is None else mm
        for v in (v1, v2):
            self.line(ref_u, v, u + (1.5 if u > ref_u else -1.5), v, stroke=DIM, w=0.2)
        self.line(u, v1, u, v2, stroke=DIM, w=0.25)
        for v, s in ((v1, 1), (v2, -1)):
            self.poly([(u, v), (u + 0.7, v + 2.2 * s), (u - 0.7, v + 2.2 * s)], fill=DIM, stroke=DIM, w=0.1)
        s = fmt(mm, est) if label is None else label
        x, y = self.p(u - 1.2, (v1 + v2) / 2)
        self.out.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="2.8" text-anchor="middle" fill="{DIM}" '
                        f'transform="rotate(-90 {x:.2f} {y:.2f})">{s}</text>')

    def ground(self, u1, u2):
        self.line(u1 - 6, 0, u2 + 6, 0, stroke=INK, w=0.6)


class Sheet:
    """Lays out top, front and side views for a piece of size L x D x H."""

    def __init__(self, name, title, L, D, H, notes):
        self.name, self.title, self.notes = name, title, notes
        self.L, self.D, self.H = L, D, H
        left = MARGIN + 18
        top_y = MARGIN + 22 + D             # baseline (v=0) of the top view
        front_y = top_y + GAP + 14 + H      # ground line of the elevations
        self.top = View(left, top_y)
        self.front = View(left, front_y)
        self.side = View(left + L + GAP + 18, front_y)
        self.W = left + L + GAP + 18 + D + 30 + MARGIN
        self.Hs = front_y + 30 + 7 * len(notes) + MARGIN

    def save(self):
        body = []
        for v, label in ((self.top, "TOP"), (self.front, "FRONT"), (self.side, "RIGHT SIDE")):
            body += v.out
        labels = [
            (self.top, self.L / 2, self.D + 9, "TOP VIEW"),
            (self.front, self.L / 2, -13, "FRONT ELEVATION"),
            (self.side, self.D / 2, -13, "RIGHT SIDE ELEVATION"),
        ]
        for v, u, vv, s in labels:
            x, y = v.p(u, vv)
            body.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="3.4" text-anchor="middle" '
                        f'fill="{INK}" font-weight="bold" letter-spacing="0.4">{s}</text>')
        y = self.front.oy + 24
        body.append(f'<text x="{MARGIN}" y="{MARGIN}" font-size="6" fill="{INK}" font-weight="bold">'
                    f'{self.title}</text>')
        body.append(f'<text x="{MARGIN}" y="{MARGIN + 7}" font-size="3.2" fill="{THIN}">'
                    f'Warhammer 40,000 11th edition, Battlefields: Armageddon. 1:1 scale in mm, '
                    f'third-angle projection.</text>')
        for n in self.notes:
            body.append(f'<text x="{MARGIN}" y="{y:.2f}" font-size="3" fill="{THIN}">{n}</text>')
            y += 6
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.W:.0f}mm" height="{self.Hs:.0f}mm" '
               f'viewBox="0 0 {self.W:.1f} {self.Hs:.1f}" font-family="Helvetica, Arial, sans-serif">\n'
               f'<rect width="100%" height="100%" fill="#ffffff"/>\n' + "\n".join(body) + "\n</svg>\n")
        with open(os.path.join(HERE, self.name + ".svg"), "w") as f:
            f.write(svg)


COMMON = "Sizes without ~ are measured off GW's to-scale Event Companion layouts (+/-4 mm) or set by the rules. ~ means estimated from photos (+/-15%)."


def prof(profile, u):
    """Height of a wall profile [(u, h), ...] at u, interpolated linearly."""
    pts = sorted(profile)
    best = 0.0
    for (u1, h1), (u2, h2) in zip(pts, pts[1:]):
        if u1 <= u <= u2:
            h = h1 if u2 == u1 else h1 + (h2 - h1) * (u - u1) / (u2 - u1)
            best = max(best, h)
    return best


def pilasters(view, profile, us, w=6):
    for u in us:
        top = min(prof(profile, u + 0.01), prof(profile, u + w - 0.01))
        view.rect(u, 0, w, top, fill=SOLID, stroke=THIN, w=0.3)


# ---------------------------------------------------------------- large ruin

def large_ruin():
    L, D, T = 163.0, 125.0, 5.0         # ruin EF: long wall, short wall, wall thickness
    FLOOR, FT = 76.2, 3.0               # 3" mezzanine top, floor plate thickness
    FD = 87.0                           # mezzanine plate is about 87 mm square
    # height profile of the long (back) wall along x, and the short (left) wall along y
    back = [(0, 127), (47, 127), (47, 112), (95, 112), (104, 98), (112, 90), (121, 74),
            (130, 66), (139, 52), (150, 44), (163, 30)]
    left = [(125, 120), (95, 120), (95, 104), (72, 104), (64, 88), (52, 80), (40, 62),
            (28, 50), (14, 38), (0, 26)]

    s = Sheet("large-ruin", "Large Manufactorum Ruin (EF)", L, D, 127, [
        "Dense. Plan size and 3\" floor measured; wall profile, openings and thickness estimated from sprue photos.",
        "The four large ruins share this construction. Plan sizes: AB 116 x 128, CD 166 x 83, EF 163 x 125, GH 81 x 163 mm.",
        "Mezzanine floor: riveted 2 x 2 plate grid with a hatch and a broken edge. Door and ground-floor niches are solid, not openings.",
        COMMON,
    ])

    # TOP VIEW (y = 0 is the open front; the walls stand along the back and left edges)
    t = s.top
    t.rect(0, D - FD, FD, FD - T, fill=SOLID, stroke=THIN, w=0.35)       # mezzanine
    t.line(FD / 2, D - FD, FD / 2, D - T, dash="1.2,1")                  # plate seams
    t.line(0, D - FD + (FD - T) / 2, FD, D - FD + (FD - T) / 2, dash="1.2,1")
    t.path([(FD, D - FD), (FD - 6, D - FD - 4), (FD - 14, D - FD + 2), (FD - 22, D - FD - 3),
            (FD - 30, D - FD)], stroke=THIN)                                 # broken edge
    t.text(FD / 2, D - FD / 2, "mezzanine", size=2.6, color=THIN)
    t.rect(0, D - T, L, T, fill=INK)                                    # back wall
    t.rect(0, 0, T, D, fill=INK)                                        # left wall
    for u in (26, 50, 98, 116, 143):                                     # pilasters
        t.rect(u - 3, D - T - 1.5, 6, 1.5, fill=INK, stroke=INK, w=0.2)
    t.hdim(0, L, D + 5, D)
    t.vdim(0, D, L + 7, L)
    t.vdim(D - FD, D - T, FD + 6, FD, est=True)
    t.hdim(0, T, -6, 0, est=True)

    # FRONT ELEVATION: inner face of the back wall, the left wall edge-on
    f = s.front
    f.poly([(0, 0)] + back + [(L, 0)])
    pilasters(f, back, (23, 47, 95, 113, 140))
    f.line(0, 57, L - 30, 57)                                            # frieze band
    f.line(0, 59, L - 32, 59)
    for i in range(9):                                                   # louvres under the floor
        u = 52 + i * 10
        if u + 8 < 140:
            f.rect(u, 60, 8, 13.5, fill=GLASS, stroke=THIN, w=0.3)
            for k in range(1, 6):
                f.line(u + 1, 60 + k * 2.2, u + 7, 60 + k * 2.2, stroke=THIN, w=0.15)
    f.rect(60, 0, 21, 45, fill=SOLID, stroke=INK, w=0.45)               # big riveted door
    f.line(60, 0, 81, 45)
    f.line(81, 0, 60, 45)
    f.arch(24, 6, 14, 38, fill=SOLID)                                    # machinery niches
    f.arch(120, 6, 14, 38, fill=SOLID)
    f.arch(7, 92, 14, 20)                                                # upper window
    for u0, u1 in ((29, 47), (53, 95)):                                  # X-braced bays, upper storey
        f.line(u0, 80, u1, 108)
        f.line(u1, 80, u0, 108)
    f.rect(0, FLOOR - FT, FD, FT, fill=SOLID, stroke=INK, w=0.45)       # mezzanine edge-on
    f.rect(0, 0, T, 127, fill=INK)                                       # left wall edge-on (corner)
    f.ground(0, L)
    f.vdim(0, 127, -7, 0, est=True)
    f.vdim(0, FLOOR, -15, 0, label="76 mm (3\") floor")
    f.vdim(0, 45, 56, 60, est=True)
    f.hdim(60, 81, 49, 45, est=True)
    f.hdim(7, 21, 118, 112, est=True)
    f.hdim(0, L, -6, 0)
    f.vdim(0, 30, L + 7, L, est=True)

    # RIGHT SIDE ELEVATION: inner face of the left wall, the back wall edge-on
    r = s.side
    r.poly([(0, 0)] + [(y, h) for y, h in sorted(left)] + [(D, 0)])
    pilasters(r, left, (30, 62, 95))
    r.line(0, 57, D, 57)
    r.line(0, 59, D, 59)
    r.arch(12, 6, 14, 38, fill=SOLID)
    r.arch(70, 6, 14, 38, fill=SOLID)
    r.arch(100, 84, 14, 20)
    r.rect(D - FD, FLOOR - FT, FD, FT, fill=SOLID, stroke=INK, w=0.45)
    r.rect(D - T, 0, T, 127, fill=INK)                                   # back wall edge-on
    r.ground(0, D)
    r.vdim(0, 120, -7, 0, est=True)
    r.hdim(0, D, -6, 0)
    r.vdim(0, 57, D + 7, D, est=True)
    s.save()


# ---------------------------------------------------------------- small ruin

def small_ruin():
    L, D, T = 75.0, 48.0, 5.0
    s = Sheet("small-ruin", "Small Manufactorum Ruin (corner)", L, D, 60, [
        "Light. Plan size measured (one of four variants: 75 x 48, 79 x 44, 48 x 76, 42 x 48 mm); height estimated.",
        COMMON,
    ])
    back = [(0, 60), (18, 60), (18, 50), (30, 46), (42, 36), (55, 30), (66, 22), (75, 16)]
    left = [(48, 56), (34, 56), (26, 42), (14, 30), (0, 18)]
    t = s.top
    t.rect(0, D - T, L, T, fill=INK)
    t.rect(0, 0, T, D, fill=INK)
    t.hdim(0, L, D + 5, D)
    t.vdim(0, D, L + 7, L)
    f = s.front
    f.poly([(0, 0)] + back + [(L, 0)])
    pilasters(f, back, (18, 47))
    f.line(0, 34, 42, 34)
    f.arch(25, 4, 14, 26, fill=SOLID)
    f.rect(0, 0, T, 60, fill=INK)
    f.ground(0, L)
    f.vdim(0, 60, -7, 0, est=True)
    f.hdim(0, L, -6, 0)
    r = s.side
    r.poly([(0, 0)] + sorted(left) + [(D, 0)])
    r.rect(D - T, 0, T, 60, fill=INK)
    r.arch(12, 4, 14, 22, fill=SOLID)
    r.ground(0, D)
    r.hdim(0, D, -6, 0)
    r.vdim(0, 56, -7, 0, est=True)
    s.save()


# ---------------------------------------------------------------- shock array

def shock_array():
    L, D, H = 123.0, 40.0, 70.0
    posts = (20.5, 61.5, 102.5)
    s = Sheet("shock-array", "Shock Array", L, D, H, [
        "Light. Plan size measured; heights scaled from a front-on photo (height / length = 0.57).",
        "Three skull-ring emitter posts on a riveted base beam with triangular feet; sculpted lightning arcs between the rings.",
        COMMON,
    ])
    t = s.top
    t.rect(0, D / 2 - 4, L, 8, fill=SOLID)
    for u in posts:
        t.rect(u - 9, 0, 18, D, fill=SOLID, stroke=THIN, w=0.35)      # feet
        t.circle(u, D / 2, 7)
    t.hdim(0, L, D + 5, D)
    t.vdim(0, D, L + 7, L)
    f = s.front
    f.rect(0, 0, L, 14)
    for u in posts:
        f.poly([(u - 16, 0), (u + 16, 0), (u + 6, 14), (u - 6, 14)], fill=SOLID)
        f.rect(u - 4, 0, 8, 48)
        for k in range(6):
            f.rect(u - 8, 16 + k * 3, 16, 2, fill=SOLID, stroke=THIN, w=0.25)   # coil
        f.circle(u, 40, 6)
        f.circle(u, 52, 10, fill="none")
        f.circle(u, 52, 4)
    for a, b in zip(posts, posts[1:]):                                  # lightning
        f.path([(a + 10, 54), (a + 16, 62), (a + 20, 56), (a + 26, 66), (b - 18, 58),
                (b - 12, 67), (b - 10, 56)], stroke="#2e86c1", w=0.5)
    f.path([(2, 50), (6, 64), (10, 58), (14, 70)], stroke="#2e86c1", w=0.5)
    f.path([(L - 2, 50), (L - 6, 64), (L - 10, 58), (L - 14, 70)], stroke="#2e86c1", w=0.5)
    f.ground(0, L)
    f.hdim(0, L, -6, 0)
    f.vdim(0, H, -7, 0, est=True)
    f.vdim(0, 62, L + 7, L, est=True)
    f.vdim(0, 14, L + 15, L, est=True)
    r = s.side
    r.poly([(0, 0), (D, 0), (D / 2 + 5, 14), (D / 2 - 5, 14)], fill=SOLID)
    r.rect(D / 2 - 4, 0, 8, 48)
    for k in range(6):
        r.rect(D / 2 - 8, 16 + k * 3, 16, 2, fill=SOLID, stroke=THIN, w=0.25)
    r.rect(D / 2 - 2, 42, 4, 20)
    r.path([(D / 2, 62), (D / 2 - 4, 66), (D / 2 + 3, 70)], stroke="#2e86c1", w=0.5)
    r.ground(0, D)
    r.hdim(0, D, -6, 0)
    s.save()


# ---------------------------------------------------------------- capacitor stack

def capacitor_stack():
    L, D, H = 109.0, 45.0, 75.0
    s = Sheet("capacitor-stack", "Capacitor Stack", L, D, H, [
        "Dense. Plan size measured; height estimated from sprue photos (one ribbed cylinder is about 67 mm long).",
        "Two ribbed capacitor cylinders joined by a riveted coupling, conductor heads on top. The cogitator and servitor",
        "add-on (not drawn, 38 x 69 mm in plan) clips to one side in some layouts.",
        COMMON,
    ])
    R = D / 2
    t = s.top
    t.rect(R, R - 9, L - D, 18, fill=SOLID)
    for c in (R, L - R):
        t.circle(c, R, R)
        t.circle(c, R, R - 6, fill="none", stroke=THIN, w=0.3)
        t.circle(c, R, 5)
    t.hdim(0, L, -6, 0)
    t.vdim(0, D, L + 7, L)
    f = s.front
    f.rect(D - 2, 8, L - 2 * D + 4, 44, fill=SOLID)                     # coupling
    for k in range(4):
        f.line(D, 16 + k * 10, L - D, 16 + k * 10)
    for u0 in (0, L - D):
        f.rect(u0 + 3, 0, D - 6, 4, fill=SOLID)
        f.rect(u0, 4, D, 63)
        for k in range(10):
            f.line(u0, 8 + k * 6, u0 + D, 8 + k * 6)
        f.rect(u0 + 8, 67, D - 16, 5, fill=SOLID)
        f.rect(u0 + R - 3, 72, 6, 3, fill=SOLID)
    f.ground(0, L)
    f.hdim(0, L, -6, 0)
    f.vdim(0, H, -7, 0, est=True)
    f.vdim(4, 67, L + 7, L, est=True)
    r = s.side
    r.rect(3, 0, D - 6, 4, fill=SOLID)
    r.rect(0, 4, D, 63)
    for k in range(10):
        r.line(0, 8 + k * 6, D, 8 + k * 6)
    r.rect(8, 67, D - 16, 5, fill=SOLID)
    r.rect(R - 3, 72, 6, 3, fill=SOLID)
    r.ground(0, D)
    r.hdim(0, D, -6, 0)
    s.save()


# ---------------------------------------------------------------- generator shrine

def generator_shrine():
    L, D, H = 88.0, 67.0, 100.0
    s = Sheet("generator-shrine", "Generator Shrine", L, D, H, [
        "Dense. Plan size measured; height estimated from a photo of the full table (+/-20%).",
        "Domed generator drum between two Y-shaped riveted side frames (the same frames as the pylons), Imperial aquila on top.",
        "Pylon cables plug into the side frames.",
        COMMON,
    ])
    t = s.top
    for u in (0, L - 12):
        t.rect(u, 0, 12, D, fill=SOLID)
        for k in range(3):
            t.circle(u + 6, 14 + k * 19.5, 3, fill=FILL, stroke=THIN, w=0.3)
    t.circle(L / 2, D / 2, 24)
    t.circle(L / 2, D / 2, 15, fill="none", stroke=THIN, w=0.3)
    t.circle(L / 2, D / 2, 4)
    t.hdim(0, L, D + 5, D)
    t.vdim(0, D, L + 7, L)
    f = s.front
    for u in (0, L - 12):
        f.rect(u, 0, 12, 82, fill=SOLID)
        f.circle(u + 6, 60, 4)
    f.rect(L / 2 - 28, 0, 56, 10, fill=SOLID)
    f.rect(L / 2 - 24, 10, 48, 48)
    for k in range(4):
        f.line(L / 2 - 24, 18 + k * 10, L / 2 + 24, 18 + k * 10)
    f.poly([(L / 2 - 24, 58), (L / 2 + 24, 58), (L / 2 + 16, 70), (L / 2 - 16, 70)])
    f.rect(L / 2 - 4, 70, 8, 10, fill=SOLID)
    f.poly([(L / 2, 80), (L / 2 + 22, 92), (L / 2 + 8, 90), (L / 2, 100), (L / 2 - 8, 90), (L / 2 - 22, 92)],
           fill=SOLID)                                                   # aquila
    f.ground(0, L)
    f.hdim(0, L, -6, 0)
    f.vdim(0, H, -7, 0, est=True)
    f.vdim(0, 82, L + 7, L, est=True)
    r = s.side
    r.poly([(0, 0), (14, 0), (D / 2 - 2, 52), (D / 2 + 2, 52), (D - 14, 0), (D, 0),
            (D / 2 + 9, 70), (D / 2 + 9, 82), (D / 2 - 9, 82), (D / 2 - 9, 70)], fill=SOLID)
    for k in range(3):
        r.circle(8 + k * 4, 12 + k * 14, 2.2, fill=FILL, stroke=THIN, w=0.3)
        r.circle(D - 8 - k * 4, 12 + k * 14, 2.2, fill=FILL, stroke=THIN, w=0.3)
    r.circle(D / 2, 74, 4)
    r.poly([(D / 2 - 3, 82), (D / 2 + 3, 82), (D / 2 + 2, 100), (D / 2 - 2, 100)])
    r.ground(0, D)
    r.hdim(0, D, -6, 0)
    s.save()


# ---------------------------------------------------------------- pylon run

def pylon_run():
    L, D, H = 206.0, 49.0, 80.0
    posts = (21, 68, 115, 162)
    rails = ((15, 70), (24, 74), (33, 70))   # (y in plan, height at the post)
    s = Sheet("galvanic-pylons", "Galvanic Pylons with cable runs", L, D, H, [
        "Dense. Plan size measured (as drawn in the Event Companion layouts); height estimated from a photo of the full table.",
        "Y-frame pylons carry three sagging cable bundles; the run ends in a ribbed end cap or plugs into the Generator Shrine.",
        "The identification of this piece on the layout diagrams is inferred from counts and sprue photos.",
        COMMON,
    ])
    t = s.top
    for y, _ in rails:
        t.rect(0, y - 2.5, 196, 5, fill=SOLID)
    t.rect(194, 30, 12, 8, fill=SOLID)                                   # end cap
    for u in posts:
        t.rect(u - 5, 0, 10, D)
    t.hdim(0, L, D + 5, D)
    t.vdim(0, D, L + 7, L)
    f = s.front
    for a, b in zip(posts, posts[1:]):
        for dv in (0, 4):
            pts = [(a + (b - a) * i / 10, 74 - dv - 9 * math.sin(math.pi * i / 10)) for i in range(11)]
            f.path(pts, stroke=INK, w=0.9)
    for u in posts:
        f.poly([(u - 6, 0), (u + 6, 0), (u + 3, 66), (u - 3, 66)], fill=SOLID)
        f.rect(u - 7, 66, 14, 10)
        f.circle(u, 80, 3)
    f.path([(0, 74), (posts[0] - 7, 74)], stroke=INK, w=0.9)
    f.path([(posts[-1] + 7, 74), (194, 74)], stroke=INK, w=0.9)
    f.rect(194, 69, 12, 10, fill=SOLID)
    for k in range(4):
        f.line(197 + k * 2.5, 69, 197 + k * 2.5, 79)
    f.ground(0, L)
    f.hdim(0, L, -6, 0)
    f.vdim(0, H, -7, 0, est=True)
    f.hdim(posts[0], posts[1], 90, 80)
    r = s.side
    r.poly([(0, 0), (10, 0), (D / 2 - 2, 48), (D / 2 + 2, 48), (D - 10, 0), (D, 0),
            (D / 2 + 7, 66), (D / 2 - 7, 66)], fill=SOLID)
    r.rect(D / 2 - 18, 66, 36, 10)
    for y, h in rails:
        r.circle(y, h + 4, 2.6)
    r.ground(0, D)
    r.hdim(0, D, -6, 0)
    s.save()


# ---------------------------------------------------------------- barricade

def barricade():
    L, D, H = 97.0, 33.0, 55.0
    s = Sheet("rockcrete-barricade", "Rockcrete Barricade", L, D, H, [
        "Light. Plan size measured (pylon and barricade outlines on the layout diagrams could be swapped); height estimated.",
        "Two aquila-relief rockcrete slabs between riveted posts, a rail and a lattice grille below. A taller variant is reported.",
        COMMON,
    ])
    t = s.top
    t.rect(4, D / 2 - 3, L - 8, 6, fill=SOLID)
    for u in (0, L / 2 - 3, L - 6):
        t.rect(u, 0, 6, D)
    t.hdim(0, L, D + 5, D)
    t.vdim(0, D, L + 7, L)
    f = s.front
    for u0 in (6, L / 2 + 3):
        w = L / 2 - 9
        f.rect(u0, 24, w, 31)
        f.rect(u0 + 4, 28, w - 8, 23, fill="none", stroke=THIN, w=0.3)
        f.poly([(u0 + w / 2, 34), (u0 + w / 2 + 12, 42), (u0 + w / 2 + 4, 41), (u0 + w / 2, 47),
                (u0 + w / 2 - 4, 41), (u0 + w / 2 - 12, 42)], fill=SOLID, stroke=THIN, w=0.3)
        f.rect(u0, 3, w, 10, fill=SOLID)
        for k in range(1, 12):
            f.line(u0 + k * w / 12, 3, u0 + k * w / 12, 13, w=0.2)
    f.rect(6, 16, L - 12, 3, fill=SOLID)
    for u in (0, L / 2 - 3, L - 6):
        f.rect(u, 0, 6, 55, fill=SOLID)
    f.ground(0, L)
    f.hdim(0, L, -6, 0)
    f.vdim(0, H, -7, 0, est=True)
    f.vdim(24, 55, L + 7, L, est=True)
    r = s.side
    r.rect(0, 0, D, 4, fill=SOLID)
    r.rect(D / 2 - 3, 0, 6, 55, fill=SOLID)
    r.rect(D / 2 - 2, 24, 4, 31)
    r.ground(0, D)
    r.hdim(0, D, -6, 0)
    s.save()


if __name__ == "__main__":
    for fn in (large_ruin, small_ruin, shock_array, capacitor_stack, generator_shrine, pylon_run, barricade):
        fn()
    print("wrote", ", ".join(sorted(f for f in os.listdir(HERE) if f.endswith(".svg"))))
