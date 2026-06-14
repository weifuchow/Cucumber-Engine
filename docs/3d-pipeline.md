# 3D / image-to-3D pipeline plan

> Status: **design doc** (no runtime yet). The engine today is a pure
> Canvas2D procedural-shape interpreter. This document lays out how to bring
> AI-generated 3D characters into Cucumber without throwing that away, in the
> order the work should actually happen.

## Why this doc exists

By mid-2026 single-image and multi-view image→3D generation (Tripo v3,
Hunyuan3D 2.5/3.1, TRELLIS-2, Rodin) produce meshes that genuinely compete
with hand modeling, and auto-rig + text-to-motion (Meshy, Tripo, Uthana,
MoMask-class motion models) can take a static mesh to an animated character
without a TD. The question is **not** "2D Spine or 3D" — the 2026 production
trend is *hybrid* (3D character, 2D-style treatment: lowered frame rate, ink
lines, flat grade). The question is how an engine whose entire renderer is
Canvas2D adopts 3D **incrementally**, without a rewrite.

This doc answers that, and defines the contract the `cucumber-3d-fetcher`
skill builds against.

## Where Spine sits

Keep Spine. But know its current limit in this engine: `spineImporter` does
**not** run a real Spine runtime. As of the `skinnedMesh` work it now does
genuine bone-weighted **mesh deform** (see `proceduralShape.ts`), plus rigid
region attachments and per-bone keyframes — but still no IK / path / physics
constraints, no attachment swap, no textured mesh fill. Spine is the right
2D-skeletal answer; 3D is the *next* axis, not a replacement.

## The three adoption paths, in priority order

| Path | What it is | Engine cost | When |
|---|---|---|---|
| **C — Bake to multi-view sprites** | Render the rigged 3D model offline from N angles × M action frames → feed frames into the asset system | Add one **`imageSprite`** primitive + a bake script. No renderer rewrite. | **Now** — highest ROI |
| **A — Hybrid WebGL layer** | Keep Canvas2D for scenes/FX/subtitles; add a Three.js layer that renders only 3D characters, composited into the same frame | New WebGL render layer + compositor; real-time glTF skeletal playback | Mid-term |
| **B — Full 3D rewrite** | Replace the renderer with Three.js/Babylon | Throws away all procedural 2.5D assets | **Not now** |

The rest of this doc details C and A. B is recorded only to be explicitly
rejected.

---

## Path C — bake 3D → multi-view sprites (do this first)

### The idea

The engine already picks a per-angle shape via `pickCharacterShape` (front /
back / sideLeft / sideRight / threeQuarter*). That selection machinery is
exactly what a sprite-based character needs. So:

1. Generate / fetch a rigged glTF (see skill + image→3D below).
2. **Offline**, render it from the 4–6 canonical angles, for each `action`
   (idle / walking / attack / …) across a small frame loop, to PNG (+ a
   normal/AO pass if we want relight later).
3. Emit an AssetManifest whose `metadata.shapes[angle]` points at frame
   sequences instead of procedural primitives.
4. The runtime draws the current (angle, action, frame) sprite.

This gives true 3D-derived character art inside the existing 2.5D timeline,
camera, lip-sync and post-FX, with **no change to the timeline or scene
model** — only one new leaf primitive and a draw branch.

### Engine change required: an `imageSprite` primitive

Mirror how `skinnedMesh` was added — one new member of the `Primitive` union
in `proceduralShape.ts`, one `case` in `drawPrimitive`:

```ts
| {
    kind: "imageSprite";
    src: string;            // staged frame URL, e.g. data/3d-imports/<id>/front/idle/{frame}.png
    frames?: number;        // sequence length; default 1 (static)
    fps?: number;           // playback rate for the loop; default 12 ("on twos")
    w: NumExpr; h: NumExpr;  // draw size (anchor-relative)
    anchorX?: NumExpr; anchorY?: NumExpr;
  }
```

Draw notes:
- Cache decoded `HTMLImageElement`/`ImageBitmap` per `src` on the ctx (same
  WeakMap pattern as the noise tile cache).
- Frame index = `floor((state.time * fps)) % frames`, so it respects the
  existing `frameHold` clamp automatically (frameHold rewrites `state.time`).
- Honor the global post-FX grade — sprites get the same grain/vignette as
  procedural art, which is what keeps a 3D-baked character from looking
  pasted on.
- `lint-2_5d` must learn this primitive counts toward the "has art" bar.

### Bake script (companion to the skill)

`scripts/bake-gltf-views.ts` (headless, Node + a GPU-less rasterizer or a
headless WebGL via `gl`/`three` offscreen): inputs a glTF + a view/action
matrix, writes frames to `data/3d-imports/<assetId>/<angle>/<action>/<n>.png`
and prints the `metadata.shapes` block that references them. This is the
piece the `cucumber-3d-fetcher` skill calls, analogous to
`import-spine-json.ts`.

### Viseme → mouth, for free-ish

We already drive `state.viseme` (7 visemes). For a baked character, bake a
small mouth-only sprite set per viseme (or a separate mouth layer composited
over the head sprite), keyed the same way the procedural mouth is. The
ARKit-52 blendshape set most 3D heads ship maps cleanly onto our 7 visemes.

---

## Path A — hybrid WebGL character layer (mid-term)

Once baked sprites prove the asset pipeline, the natural upgrade is real-time
3D for hero characters that need free camera / continuous turn:

- Add a **`<canvas>` WebGL layer** (Three.js) stacked under/over the existing
  2D canvas, or a single WebGL canvas the 2D pass draws into via a texture.
- `evaluateTimeline` already produces per-character world position / angle /
  action / viseme / headYaw — feed that straight into a glTF
  `AnimationMixer` + morph-target (blendshape) weights. The timeline model
  does **not** change; only the character draw call is swapped per-asset.
- Composite order: scene (2D) → 3D characters (GL) → FX + subtitles (2D) →
  post-FX grade over the merged frame, so the grade unifies both.
- Apply the 2D-style treatment in the grade pass (frame-rate hold, optional
  edge-ink shader) — this is what makes a 3D character read as "漫剧", not
  "Unity cutscene", matching the 2026 hybrid trend.

A and C coexist: an asset can be `imageSprite` (baked) or `gltf` (live);
`pickCharacterShape` / `drawCharacter` dispatch on which the manifest carries.

---

## Image→3D + animation tech (what the skill orchestrates)

Two technology branches — **pick mesh-based, not splatting**, because only
meshes rig and animate cleanly:

| Branch | Tools (2026) | Output | Riggable |
|---|---|---|---|
| **Mesh** ✅ | Tripo v3, Hunyuan3D 2.5/3.1, Meshy | `.glb/.fbx`, quad topology | Yes — standard glTF skin |
| Gaussian splatting | TRELLIS-2, Rodin | point cloud | No (hard to skin / composite) |

Pipeline the skill targets:

```
image(s) ──▶ mesh (Tripo/Hunyuan3D, multi-view input for accurate backs)
          ──▶ auto-rig (Tripo/Meshy/AccuRIG/Mixamo; humanoids use a standard skeleton)
          ──▶ motion:
                • preset clip library (Mixamo/Meshy)        ← fastest to ship
                • text-to-motion (Uthana / MoMask-class)    ← matches "AI 一句话出片段"
                • video-to-motion (DeepMotion/Uthana)       ← reference-driven mocap
          ──▶ Path C: bake N angles × actions → imageSprite manifest
              Path A: ship the rigged glTF → live WebGL layer
```

- **Multi-image / multi-view input** beats single-image (single-image backs
  are hallucinated). Prefer tools that accept a turnaround.
- **Humanoid** rigs are the mature case (standard skeleton + ARKit
  blendshapes). Non-humanoid auto-rig is rougher — flag it to the user.

---

## Sequencing / definition of done

1. Spine mesh deform — closes the worst 2D Flash tell. ✅
2. `imageSprite` primitive (proceduralShape.ts) + raster bake
   (`scripts/bake-character-sprites.ts`) + lint support — the engine can now
   draw baked/painted bitmap sprites off the vector plane. ✅ Currently bakes
   *procedural* art (supersample-soft edges + pixel paper-grain + ink-edge);
   the same primitive drops in genuinely painted/generated frames unchanged.
   A `bake-gltf-views.ts` (3D model → frames) is the remaining variant.
3. `cucumber-3d-fetcher` skill wired to a real image→3D provider + the bake
   script (Path C content side). Skeleton landed; see
   `.claude/skills/cucumber-3d-fetcher/`.
4. WebGL hybrid layer for live glTF (Path A). ✅ **Proven**: `scripts/lib/
   character3d.mjs` renders a posable cel-shaded humanoid via three.js
   (WebGL1Renderer) on headless-gl under xvfb, composited per-timeline-frame
   into the 2D scene by `qc-render.ts` (a character with `metadata.model3d`
   renders as real 3D — depth, yaw-from-angle, articulated limbs — instead of a
   billboard). Same three.js scene graph drives a browser WebGL canvas in-app.
   Remaining: load real rigged glTF models (needs an image→3D source / asset);
   wire the WebGL layer into the React PreviewCanvas.

### Headless 3D notes
- three.js must be a WebGL1-capable build (`three@0.149`, `WebGL1Renderer`) —
  headless-gl exposes only WebGL1, and newer three calls `texImage3D` at init.
- Run under `xvfb-run` (headless-gl needs an X display); read back via
  `gl.readPixels` → napi canvas. qc-render falls back to 2D if no GL context.

Until step 2 lands, the `cucumber-3d-fetcher` skill can fetch + validate +
stage a model and emit a *pending-bake* manifest, but the asset is not
renderable. That gap is intentional and tracked here, not hidden in the skill.
