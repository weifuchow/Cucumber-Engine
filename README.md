# Cucumber Engine

A lightweight 2.5D short-drama production base. Canvas2D rendering, a declarative procedural-shape language for art, a SQLite-backed asset library, and an AI skill that designs new assets on demand.

## Quick start

```bash
npm install
npm run db:init && npm run db:seed   # one-time
npm run dev                          # web on :5173, api on :3001
```

`npm run build` typechecks and bundles the web client. `npm run check` typechecks the server too (the server tsconfig pre-dates DOM types and will surface some pre-existing `CanvasRenderingContext2D` errors from shared engine files — those do not affect the runtime).

## What's in here

| Path | Role |
|---|---|
| [src/engine/proceduralShape.ts](src/engine/proceduralShape.ts) | Shape interpreter — declarative primitives, gradients, parallax layers, clip, shadow |
| [src/engine/timeline.ts](src/engine/timeline.ts) | Pure timeline evaluator: time → render state (scene, characters, effects, camera) |
| [src/engine/characterPainter.ts](src/engine/characterPainter.ts) | Character draw call that injects `expression / action / time / z` into the shape state |
| [src/components/PreviewCanvas.tsx](src/components/PreviewCanvas.tsx) | The 2.5D render pipeline (bg → mid → fg with per-layer parallax) |
| [src/components/AssetPreviewStage.tsx](src/components/AssetPreviewStage.tsx) | Per-asset preview with 2.5D controls (camera-pan toggle, z slider) |
| [src/data/sampleProject.ts](src/data/sampleProject.ts) | The "客厅 + 门口 + 父子" demo content |
| [.claude/skills/cucumber-asset-generator](.claude/skills/cucumber-asset-generator) | AI skill that designs new manifests with 2.5D rules baked in |
| [docs/2.5d-plan.md](docs/2.5d-plan.md) | The 2.5D migration plan that drove the current architecture |

## 2.5D architecture

The engine is Canvas2D, not WebGL — depth is illusion, not geometry. Every depth cue is one of these six tricks, applied through the shape interpreter:

```
       ┌────────────────────────── camera ──────────────────────────┐
       │                                                            │
   parallax    z-scale     soft       atmospheric    contact     foreground
   factor      / dim     lighting        haze         shadow      occlusion
       │         │          │             │            │             │
       ▼         ▼          ▼             ▼            ▼             ▼
   scene.layers character    body / face   background  ellipse w/   scene.layers
   .background  .scale       gradients     gradient    z-driven     .foreground
   .midground   .alpha                     band        rx / alpha
   .foreground
```

### The render pipeline

```
PreviewCanvas(time)
  │
  ├─ evaluateTimeline(project, time) → { scene, characters[], effects[], camera, caption }
  │
  ├─ withCameraLayer("background", parallax 0.45) → drawSceneLayer(bg)
  ├─ withCameraLayer("midground",  parallax 1.0)  → drawSceneLayer(mid)
  │                                                  + props
  │                                                  + characters (z-sort + y-sort, scale/alpha by z)
  │                                                  + effects
  ├─ withCameraLayer("foreground", parallax 1.28) → drawSceneLayer(fg)
  │                                                  + scene.foreground asset (if distinct)
  │
  └─ drawHud(caption, time, mode)
```

`withCameraLayer` translates the canvas by `cameraDelta * parallaxFactor` per layer — so background drifts slowly and foreground races, producing visible depth on any camera pan.

### Six depth cues, implemented

1. **Parallax** — `shape.parallax.{background,midground,foreground}` factors. Background rects extend `x: -200, w: 1680` so pans never reveal empty canvas.
2. **z-scale + dim** — `characterAppear.position.z` (and `characterMove.to.z`) become a `depthScale = 1 / (1 + z * 0.0015)` plus `globalAlpha = 1 - clamp(z * 0.0008, 0, 0.25)`. The `z` value is also injected into the character's shape state so contact shadows scale with it.
3. **Soft lighting** — body linear gradients + face radial gradients in character shapes. A shadow modifier (`shadow: { blur, offset, color }`) wraps a single draw call in canvas shadow state.
4. **Atmospheric haze** — translucent cool-tone band on the background layer. One rect; biggest depth payoff per primitive.
5. **Contact shadow** — z-aware ellipse below characters whose `rx/ry/alpha` shrink with depth.
6. **Foreground occlusion** — items in `scene.layers.foreground` draw *after* characters, so they pass in front and crop the silhouette.

### Procedural shape language

A `ProceduralShape` is a list of declarative primitives — `rect`, `roundedRect`, `circle`, `ellipse`, `line`, `arc`, `polygon`, `starBurst`, `text`, plus structural `transform` (group) and `clip` (restrict children to a region). Every primitive can carry an optional `shadow` modifier and a `when` clause for state-gated drawing.

Fills support `string` (CSS), `{ palette, darken? }`, and `{ gradient: "linear" | "radial", … stops }`. Color strings and numeric fields evaluate a small expression DSL with `+ - * / %`, `PI / TAU / E`, and `cos / sin / clamp / lerp / pow / sqrt / floor / ceil / round / min / max / abs / tan`. State variables: `progress` (effects), `time` (any shape), `expression`/`action` (characters), `z` (characters), `name` (text interpolation).

For scenes specifically, the shape splits into `layers.background / midground / foreground`, each with its own primitive list, and a `parallax` map. See [.claude/skills/cucumber-asset-generator/references/procedural-shape.md](.claude/skills/cucumber-asset-generator/references/procedural-shape.md) for the full reference plus 2.5D recipes (lighting, parallax, haze, contact shadow, clip-to-silhouette).

## Demo content

The seeded project is "父子争吵" (Father-Son Argument): the camera opens on the doorway scene, the child enters, a `sceneChange` cuts to the living room, the child walks deeper into the room (`z` rises from 0 → 60 → 60, so they shrink + dim correctly), the father reacts, an emotion flash plays, the camera pushes in for a close-up, then dollies back to wide for the resolution. Every depth cue is exercised at least once. Open the preview, scrub the timeline, and toggle the AssetPreviewStage's camera-pan switch to verify parallax visually.

## Adding new assets via AI

The `cucumber-asset-generator` skill emits a complete `AssetManifest` JSON when you describe what you want. It enforces the 2.5D rules (lighting trio on characters, three-layer + parallax on scenes, atmospheric haze, etc.) and round-trips through the same UI preview path users see for hand-authored assets. The skill never writes to the DB; the UI registers what the user confirms.

Three text-prompt flows + three import flows now exist:

| Trigger | Flow |
|---|---|
| **AI 生成资产** button (toolbar) | Single-asset text prompt → skill researches references via WebSearch → renders shape → preview → confirm |
| **AI 批量图像导入** button | Multi-image upload → AI `Read`s each image → emits import plan (group / split / skip) → user confirms per-item → skill regenerates each as a procedural asset using the uploaded images as `metadata.referenceImagePaths[]` |
| **AI 生成片段** button (project module) | Script outline → skill writes Chapter + Segment + missing assets → preview with timeline scrubber → insert |
| **导入图片** (single) | Single-image stub manifest (no shape — kept for raw asset registration) |
| **导入 Spine JSON** | Programmatic Spine 3/4 JSON → procedural shape converter (`src/importers/spineImporter.ts`). Maps bones/slots/region+mesh attachments to primitives, animation names to `metadata.actions[]` |
| **导入场景 JSON / 图集 JSON** | Existing legacy importers, kept for back-compat |

### Reference research is required

The `cucumber-asset-generator` skill is hard-wired to do visual research before designing the shape:

1. If the user uploaded local images, the skill `Read`s each path (Claude's vision extracts palette + silhouette + posture) — **this is the authoritative reference**.
2. Otherwise, it `WebSearch`es for `"<subject> character key visual reference"`, picks 1–3 stable URLs (Fandom, ArtStation, official site), `WebFetch`es them, and builds a feature spec.
3. The shape is authored to match those features (signature accessories, palette, posture). Generic stand-ins are rejected by the skill's own checklist.
4. References are recorded in `metadata.references[]` (URLs / filenames + notes — no binary embedding) for attribution.

### Importing from open formats

| Format | Path | Status |
|---|---|---|
| **Spine JSON** (3.x / 4.x) | programmatic — `src/importers/spineImporter.ts` | ✅ shipped: bones / slots / region & mesh attachments → primitives; animation names → `metadata.actions[]` |
| **DragonBones JSON** | AI conversion via cucumber-asset-generator | recipe in skill docs (same shape as Spine, different field names) |
| **Lottie JSON (Bodymovin)** | AI conversion | recipe in skill docs (`ty: rc` → roundedRect, `el` → ellipse, etc.) |
| **Tiled TMX/JSON** | AI conversion | recipe in skill docs (image layers → bg/mid/fg, object layers → props) |
| **Aseprite sheet JSON** | AI conversion | recipe in skill docs (frame tags → actions) |

For AI-conversion formats: upload the file via the **AI 批量图像导入** flow (it also accepts JSON when the hint says "this is a Spine/Lottie/Tiled file"), and the skill will branch to the conversion recipe.

## Adding new segments via AI

The `cucumber-segment-generator` skill takes a script outline ("父子在厨房早餐桌的 30 秒对话") and returns a `{ chapter, segment, newAssets }` JSON. The frontend's "AI 生成片段" button (top of the project module) opens a modal that streams the skill's progress, previews the segment with the live `PreviewCanvas`, and inserts it into the active project on confirmation. Missing assets are designed inline (via the asset-generator skill as a subroutine) and saved alongside the segment.

## Quality gates

```bash
npm run lint:2.5d   # scan every visual asset against the 2.5D rules
```

The lint script enforces:
- character → at least one gradient + a z-aware contact shadow
- scene → all three layers populated + parallax (bg ≤ 0.7, fg ≥ 1.1) + background overscan rect
- prop → at least one gradient / shadow / contact shadow
- effect → at least one radial gradient halo

It scans both the seeded sample library and the live SQLite database, so an AI-generated asset that bypassed the skill's checklist will surface here.

## Performance notes

The shape interpreter caches every static `CanvasGradient` per `CanvasRenderingContext2D`. "Static" = all numeric fields are literals and color strings have no `${...}` interpolation — which covers the vast majority of scene + character gradients. Time-varying gradients (effect halos that scale with `progress`, contact shadows that scale with `z`) skip the cache and rebuild on every frame.

## Roadmap

See [docs/2.5d-plan.md](docs/2.5d-plan.md) for the full plan. All five phases are implemented; future work is incremental polish (more demo assets, additional camera transition modes, BGM/SE).
