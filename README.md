# basing-bits

Procedural scatter terrain for 28mm miniature bases and dioramas: gnarled dead trees, animal skulls, ribcages, barrels, crates and rocks. Every piece comes out as a closed, printable STL with a flat bottom, ready to glue onto a base.

## The web generator

`web/index.html` is a single self-contained page. All generation runs in the browser with no server: pick a piece, change the seed or sliders, preview it in 3D next to a 28mm figure on a 25 mm base, and download the STL.

- **Run it:** use the site at https://jorgenbraseth.github.io/basing-bits/, open `web/index.html` straight from disk, or host it anywhere static.
- **Download:** a single piece saves as `.stl`; "Download variants" builds 2–20 consecutive seeds into one `.zip`. File names include the model and seed, so you can always regenerate the same piece.

| Tab | Pieces |
|---|---|
| Trees | Dead tree (height, gnarl, trunk thickness, bark depth, thinnest twig) |
| Skulls | Longhorn steer, bull, cow with broken horn, ram, horse, wolf, giant beast |
| Ribcages | Cattle (on its back), horse (on its side), goat, giant beast |
| Props | Barrel, barrel on its side, broken barrel, crate, smashed crate, stacked crates |
| Rocks | Boulder, rock cluster, scree (loose stones), layered sandstone outcrop, hoodoo (rock pillar with cap); size, roughness, angularity |

### Scale

Skulls, ribcages and props are modelled in real-world centimetres and scaled with the **Model scale** slider (mm per real cm). The defaults are 1:40 for bones, slightly heroic so they read well on the table, and 1:50 for props. Strict 28mm is about 1:56. Rocks have no real-world scale; the **Size** slider scales them directly (at ×1 a boulder is about 20 mm across).

The thinnest twig or bone has a minimum thickness (default 1.1 mm for trees, 0.8 mm for bones). Plank seams on barrels and crates are about 0.2 mm deep, so they show best on resin printers.

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

`.github/workflows/pages.yml` runs on every push to `main`: it builds `web/index.html` from `web/src/`, smoke-tests every model, and deploys the page to **https://jorgenbraseth.github.io/basing-bits/** (the old `/web/` address forwards there). Pull requests get the build and test without deploying. This needs **Settings → Pages → Source: GitHub Actions**.

You don't need to rebuild before committing; the action does it. The committed `web/index.html` is only there so you can open the generator straight from a download of the repo, and it may lag behind `src/` until you run `python3 web/build.py` yourself.

`page.html` is also the exact source of the claude.ai artifact version. There it saves through the platform's download capability, which allows `.zip` but not `.stl`. Opened anywhere else, it uses ordinary browser downloads.

## Python scripts (earlier versions)

`python/` holds the first command-line versions. They need `pip install numpy scipy scikit-image matplotlib`.

- `dead_tree_generator.py`: dead trees (`--count`, `--seeds`, `--height`, `--gnarl`, `--thickness`, `--bark`, `--min-twig`, `--render`)
- `bone_generator.py`: skulls and ribcages (`--models`, `--variants`, `--scale`, `--min-thick`, `--render`)

The web generator is newer. It has smoother joints between bone and branch segments, mesh smoothing, grain-aligned bark (the Python tree wraps bark around a vertical axis, which pinches where branches cross it), and the barrels and crates. Seeds differ between the two because they use different random number generators.
