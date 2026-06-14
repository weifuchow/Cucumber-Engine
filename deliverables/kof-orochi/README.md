# KOF · 八神庵 vs 大蛇 — 30s fight segment (deliverable)

A ~30-second fight segment for the Cucumber Engine: **八神庵 (Iori Yagami) vs
大蛇 (Orochi)** on the sealing-ground arena. All visual assets were authored
through the **`cucumber-asset-generator` skill** (characters via the skill's
required `build-character-shape.ts` base + painterly layering; scene/effects via
the skill's scene/effect recipes). No engine code was special-cased for this
content.

## What's here

```
assets/
  character_iori_001.json     # 4 views · 5 actions · 12 expressions · viseme mouth · purple-flame rim/brush/grain
  character_orochi_001.json   # 4 views · 5 actions · silver-hair · green-energy rim
  scene_orochi_arena_001.json # 3-layer parallax: storm sky · red torii · glowing seal · rock occluders
  effect_iori_flame_001.json  # 八稚女 purple flame (starburst + rising sparks + halo)
  effect_orochi_energy_001.json # green serpent energy burst
  effect_clash_impact_001.json  # white/gold hit flash
segment.json                  # the 30s timeline (the fight)
project.json / library.json   # assembled, runnable by the engine renderer
renders/                      # QC output — storyboard, keyframes, character sheets, scene
build/                        # reproducible pipeline + the QC "detection loop"
```

## The detection loop (quality gate)

`scripts/qc-render.ts` is a headless renderer that calls the engine's own
`drawCharacter` / `drawShape` / `evaluateTimeline` and writes PNG contact
sheets — so a design can be eyeballed and iterated without a browser. It is
content-agnostic (works for any manifest). The KOF assets were driven through
it repeatedly (base → painterly → scene → effects → timeline → keyframes →
storyboard), judging each pass for: readable silhouette, fluid action across the
time cycle, distinct fighters, effects timed to contact, and **no positional
breaks** (every move interpolates with the engine's easing/arc, not a teleport).

```bash
# whole segment as a storyboard grid
npx tsx scripts/qc-render.ts --kind filmstrip \
  --project deliverables/kof-orochi/project.json \
  --library deliverables/kof-orochi/library.json \
  --big 1 --cols 5 --rows 5 --duration 30 --out /tmp/story.png

# specific moments at full res (with effects)
npx tsx scripts/qc-render.ts --kind filmstrip --project ... --library ... \
  --big 1 --cols 3 --times "6.95,12.3,19.65,23.7,27.6" --out /tmp/keys.png

# a single character's action × time × view sheet
npx tsx scripts/qc-render.ts --kind character \
  --file deliverables/kof-orochi/assets/character_iori_001.json --out /tmp/iori.png
```

## Reproduce from scratch

```bash
bash deliverables/kof-orochi/build/build-all.sh
```

Re-runs the skill base builder, re-applies painterly, finalizes metadata,
re-assembles project/library, and re-renders the storyboard.

## Motion design (why it reads fluid, not "Flash")

The timeline leans on the engine's motion layer: `characterMove` uses
`ease: "overshoot"` on lunges and `arc` on knockbacks; impacts use `frameHold`
(6–10 fps) for the cel "snap"; the final turn uses a staged `characterTurn`
(front via ¾); every standing beat carries the automatic per-character idle
breath. Iori's flames rim purple, Orochi's energy rims green — readable sides.

## Real painted art (off the vector/Flash plane)

The characters are **real painted KOF turnaround art** (user-provided), not
procedural shapes. `build/cut-all.mjs` crops each view (front / ¾ / side / back
/ action) out of `references/<char>_sheet_ref.png`, removes the sheet
background by edge flood-fill keyed to the brightest border colour (robust to a
crop corner landing on the figure), mirrors for left-facing, and wires the
frames into the engine's **`imageSprite`** primitive
(`src/engine/proceduralShape.ts`). Iori faces right, Orochi faces left; `attack`
swaps to the dynamic action pose.

This is the genuine escape from the vector look — the engine composites real
illustration over the procedural scene/effects. `imageSprite` is general; any
painted/generated frames drop into `shapes[view]` with no engine change.

- `art/` (cut frames) **is committed** — rendering works out of the box.
- `references/` (the raw upload sheets, ~14 MB) is git-ignored; needed only to
  re-cut via `build-all.sh`.

The earlier procedural-then-raster bake path (`scripts/bake-character-sprites.ts`
+ painterly v3) still exists as the engine's general capability and as the
fallback when no painted source art is available.

## 3D variant (real depth, not a billboard)

The 2D imageSprite art is a flat billboard ("贴图，生硬"). Each character also
carries a `metadata.model3d` spec — a posable cel-shaded low-poly humanoid
rendered in **genuine 3D** (three.js `WebGL1Renderer` on headless-gl, under
xvfb) by `scripts/lib/character3d.mjs`. `qc-render.ts` prefers it: the fighters
get volume, turn to face each other (yaw from the timeline angle), and
articulate limbs per action (walk stride, attack thrust, victory raise) — real
3D, not a slid plane.

```bash
xvfb-run -a node --import tsx scripts/qc-render.ts --kind filmstrip \
  --project deliverables/kof-orochi/project.json \
  --library deliverables/kof-orochi/library.json \
  --big 1 --cols 5 --rows 5 --duration 30 --out /tmp/story3d.png
```

Renders: `renders/storyboard_3d.png`, `renders/keyframes_3d.png`.

**Honest scope:** these are *procedural low-poly* 3D figures (capsules/boxes,
coloured per fighter) — they prove real 3D rotation/articulation but are not
high-fidelity. True Iori/Orochi 3D needs an **image→3D model** (Tripo /
Hunyuan3D / Meshy), which this sandbox can't run (no GPU, image/3D APIs
unreachable). The moment a rigged `.glb` exists, it loads into the same three.js
path (GLTFLoader) with no further engine change — the `cucumber-3d-fetcher`
skill is the on-ramp.

## Notes / honest caveats

- **codex image-gen was not available in this environment** (no codex CLI / key,
  restricted egress). The pipeline's "images first" step is realized as
  *headless renders of the procedural assets* that were judged and iterated —
  which is faithful to the deliverable, since Cucumber assets ARE procedural,
  not bitmaps. Designs follow canonical SNK references (recorded in each
  manifest's `metadata.references`), re-stylized to the engine's chibi 2.5D.
- To run inside the app, register the assets + project the same preview-first
  way the UI does (the skill never POSTs; the frontend confirms).
