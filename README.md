# basing-bits

Procedural scatter terrain for 28mm miniature bases and dioramas: gnarled dead trees, animal skulls, ribcages, barrels, crates, fences, shipping containers, rocks and textured base toppers. Every piece comes out as a closed, printable STL with a flat bottom, ready to glue onto a base.

## The web generator

`web/index.html` is a single self-contained page. All generation runs in the browser with no server: pick a piece, change the seed or sliders, preview it in 3D next to a 28mm figure on a 25 mm base, and download the STL.

- **Run it:** use the site at **https://basingbits.download/**, open `web/index.html` straight from disk, or host it anywhere static.
- **Download:** a single piece saves as `.stl`; "Download variants" builds 2–20 consecutive seeds into one `.zip`. File names include the model and seed, so you can always regenerate the same piece.

| Tab | Pieces |
|---|---|
| Trees | Dead tree (height, gnarl, trunk thickness, bark depth, thinnest twig) |
| Skulls | Longhorn steer, bull, cow with broken horn, ram, horse, wolf, giant beast |
| Ribcages | Cattle (on its back), horse (on its side), goat, giant beast |
| Props | Barrel, barrel on its side, broken barrel, crate, smashed crate, stacked crates, post-and-rail fence, picket fence, broken fence (fences: 1–5 bays, each about 2.3 m), shipping containers: 20 ft, 40 ft, opened, wrecked and half buried |
| Rocks | Boulder, rock cluster, scree (loose stones), layered sandstone outcrop, hoodoo (rock pillar with cap); size, roughness, angularity |
| Bases | Textured toppers cut to the top surface of a base: cobblestones, wooden planks, flagstones, cracked earth, sand and pebbles, industrial deck plate, floor tiles, gravel and dirt |

### Composing a scene

**Add piece to scene** bakes the current piece into a scene; switch tabs, generate the next piece and add that too, for example a base topper and then rocks, a skull or a barrel on it. Select a piece in the scene list to move it; clicking in the 3D view only moves the camera (drag to rotate, Shift-drag or a two-finger drag to pan, scroll or pinch to zoom). The selected piece gets a transform gizmo, with a **Move** / **Rotate** switch and **Snap** (1 mm and 15° steps) in a toolbar at the top of the view: drag the arrows to slide it along X, Y or Z, or the rings to turn it around each axis. **All / X / Y / Z** in the same toolbar (or the X, Y and Z keys) locks the gizmo to one axis, so only that arrow or ring is shown. It also has X, Y, height, rotation and X/Y tilt fields, plus Duplicate and Remove. Keys: M move, R rotate, arrows nudge 1 mm (Shift: 5 mm), Q and E turn 15°, Delete removes. Moving with the gizmo never drops the piece, so you can lift it on purpose.

With **Drop pieces onto the surface below** on, a newly added piece, or one you nudge with the arrow keys, settles onto whatever is under its centre and sinks in by the **Sink into surface** amount (0.4 mm by default), so the parts fuse when printed. **Download scene STL** writes every piece, in place, into one STL. Overlapping parts are simply stacked meshes; slicers merge them when they print.

### Library

**Save piece** and **Save scene** keep the current piece, or the whole scene with every piece's position and rotation, in a library stored in your browser (IndexedDB) on this machine only. Nothing is uploaded. Each entry has a thumbnail; **Add to scene** puts a saved piece back into the scene, and **Load into scene** brings back a saved scene with everything in place. The library belongs to the browser and the site address it was saved from, so the GitHub Pages site, a local copy of `index.html` and the claude.ai version each have their own. Clearing the browser's site data deletes it.

### Scale

Skulls, ribcages and props are modelled in real-world centimetres and scaled with the **Model scale** slider (mm per real cm). The defaults are 1:40 for bones, slightly heroic so they read well on the table, and 1:50 for props. Strict 28mm is about 1:56. Rocks have no real-world scale; the **Size** slider scales them directly (at ×1 a boulder is about 20 mm across).

The thinnest twig or bone has a minimum thickness (default 1.1 mm for trees, 0.8 mm for bones). Plank seams on barrels and crates are about 0.2 mm deep, so they show best on resin printers.

### Base toppers

Citadel bases taper: the stated size is the bottom, and the flat top is smaller. Toppers are cut to the top, minus a fit tolerance (default 0.2 mm), so they sit inside the rim.

| Base | Top surface used |
|---|---|
| 25 / 28.5 / 32 / 40 / 50 / 60 mm round | 23 / 26* / 29 / 37 / 47 / 56 mm |
| 80 / 90 / 100 / 130 / 160 mm round | 76* / 86* / 96* / 126* / 156* mm |
| 60×35 / 75×42 / 90×52 mm oval | 57×32* / 72×39* / 87×49* mm |
| 105×70 / 120×92 / 150×95 / 170×105 mm oval | 101×66* / 116×88* / 146×91* / 166×101* mm |

The 25, 32, 40, 50 and 60 mm tops are measured values, given identically by [Customeeple](https://www.customeeple.com/base-top-size-guide/) and [Getwarsplay](https://www.getwarsplay.com/blogs/news/how-tall-are-warhammer-bases-base-height-explained). Sizes marked * are estimates from the same 1.5–2 mm per-side taper. Measure one of your bases with calipers if you can, and use **Custom top size** in the page.

The **Rotation** slider (0–180°) turns the ground pattern about the centre of the base, for example to run planks or tile lines along an oval or at 45° to the front of the model. The outline never moves.

### How it works

Each piece is a set of primitives (tapered capsules, ellipsoids, and custom distance functions for the barrels and crates), combined into one signed distance field with smooth blends and subtractions. Bark is 3D noise stretched along each branch's direction, so it has no UV seams or poles. Rocks are ellipsoids cut by random planes (fracture faces), with fractal erosion and, for sandstone, ledges per layer. The field is meshed with surface nets, smoothed with Taubin smoothing (which doesn't shrink the piece, and keeps the ground cut flat), and cleaned of sealed internal voids and loose bits.

The mesh is closed and outward-facing. A handful of edges per piece can be shared by four triangles (pinch points); PrusaSlicer, Chitubox, Lychee and Cura repair these automatically.

### Editing

| File | What it is |
|---|---|
| `web/src/gen.js` | The generator: models, SDF evaluation, meshing, STL and ZIP writers. Runs in the browser and in Node. |
| `web/src/page.html` | The page UI (Three.js viewport, controls, export). |
| `web/build.py` | Inlines `gen.js` into `page.html` and writes `web/index.html`. |
| `web/test/check.js` | Smoke test: builds every model and checks the mesh is closed and outward-facing. |

After changing anything in `web/src/`:

```sh
cd web
python3 build.py          # rebuild index.html
node test/check.js        # optional: build all models (STLs land in test/out/)
```

### GitHub Pages

`.github/workflows/pages.yml` runs on every push to `main`: it builds `web/index.html` from `web/src/`, smoke-tests every model, and deploys the page to **https://basingbits.download/** (a custom domain on GitHub Pages; the old `jorgenbraseth.github.io/basing-bits/` address and its `/web/` path forward there). Pull requests get the build and test without deploying. This needs **Settings → Pages → Source: GitHub Actions**.

You don't need to rebuild before committing; the action does it. The committed `web/index.html` is only there so you can open the generator straight from a download of the repo, and it may lag behind `src/` until you run `python3 web/build.py` yourself.

`page.html` is also the exact source of the claude.ai artifact version. There it saves through the platform's download capability, which allows `.zip` but not `.stl`. Opened anywhere else, it uses ordinary browser downloads.

## Python scripts (earlier versions)

`python/` holds the first command-line versions. They need `pip install numpy scipy scikit-image matplotlib`.

- `dead_tree_generator.py`: dead trees (`--count`, `--seeds`, `--height`, `--gnarl`, `--thickness`, `--bark`, `--min-twig`, `--render`)
- `bone_generator.py`: skulls and ribcages (`--models`, `--variants`, `--scale`, `--min-thick`, `--render`)

The web generator is newer. It has smoother joints between bone and branch segments, mesh smoothing, grain-aligned bark (the Python tree wraps bark around a vertical axis, which pinches where branches cross it), and the barrels and crates. Seeds differ between the two because they use different random number generators.
