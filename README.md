# Cucumber Engine

A Canvas2D-based 2.5D short-drama production engine. Procedural shape language for art, multi-view characters, lip-synced dialogue via Alibaba TTS, painterly post-processing, and AI skills that author whole segments + assets from a script outline. SQLite-backed asset + audio library.

> 黄瓜引擎 — 抖音漫剧主流栈对齐，Live2D 级别角色表现，AI 一句话出 30 秒片段。

## Quick start

```bash
npm install
npm run db:init && npm run db:seed   # one-time
npm run dev                          # web on :5173, api on :3001
```

For real TTS, drop a DashScope key into a `.env` file (gitignored). The dev server picks it up via Node's `--env-file-if-exists`:

```bash
echo 'DASHSCOPE_API_KEY=sk-…' >> .env
```

Without a key the server falls back to a silent-WAV mock TTS provider so the lip-sync wiring still verifies offline.

`npm run build` typechecks + bundles. `npm run check` adds the server typecheck. `npm run lint:2.5d` validates every visual asset against the 2.5D rules; `npm run lint:luoxiaohei` adds the 罗小黑 style-bar rules.

## What you can do

| Capability | How |
|---|---|
| **Author characters with 4+ views** | `metadata.shapes: { front, back, sideLeft, sideRight }` — engine auto-picks per timeline angle |
| **Generate dialogue audio via Alibaba CosyVoice** | TTS panel on any `dialogue` event OR batch button on segment view |
| **Auto lip-sync from text** | Pinyin → 7-viseme mapper feeds the mouth shape state at draw time |
| **Drive characters from Spine JSON keyframes** | Importer parses bones + animations[] with cubic-bezier curves + slot color animation |
| **Multi-pass per-limb occlusion** | `metadata.bodyPartLayers: { behind, main, front }` — A's arm can pass behind B's torso |
| **Camera handheld jitter + frame-hold stutter** | `camera.jitter` + `frameHold { fps, duration }` events |
| **Paper-grain + rim light + post-FX color grade** | `noise` / `brush` primitives + `rimLight` modifier + auto `postFX` LUT |
| **AI generate a 30s segment** | "AI 生成片段" button → skill writes Chapter + Segment + missing assets |
| **AI generate single asset** | "AI 生成资产" button → manifest with shape, palette, references, license |
| **Enforce 罗小黑战记 visual bar** | `project.config.styleBar = "luoxiaohei"` → 22 LX-* lint rules |
| **Multi-project workspace** | Top-bar project picker + 新建项目 modal |

## Architecture

```
                    ┌─────────────────────────────────────────────┐
   AI skills ──────►│  manifests + segments (JSON, preview-first) │◄─── importers
   (cucumber-…)     └────────────────────┬────────────────────────┘    (Spine, …)
                                         │
                              ┌──────────▼──────────┐
                              │  SQLite             │
                              │  - assets           │
                              │  - scenes           │
                              │  - projects         │
                              │  - tts_audio (BLOB) │
                              │  - ai_jobs          │
                              └──────────┬──────────┘
                                         │
   ┌─────────────────────────────────────▼────────────────────────────────┐
   │  evaluateTimeline(time)  →  PreviewState (chars, camera, viseme, …)  │
   └─────────────────────────────────────┬────────────────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │  PreviewCanvas      │
                              │    bg layer         │
                              │    mid + chars (3-pass occlusion)
                              │    fg layer         │
                              │    postFX (LUT)     │
                              │    HUD              │
                              └─────────────────────┘
```

## Procedural shape DSL

A `ProceduralShape` is a list of declarative primitives. The renderer is a pure interpreter — adding a new character/scene/effect is a JSON-only change.

### Primitives
`rect` · `roundedRect` · `circle` · `ellipse` · `line` · `arc` · `polygon` · `starBurst` · `text` · `transform` (group + blurPx) · `clip` · `particles` (up to 500/emitter) · **`noise`** (paper grain) · **`brush`** (hand-drawn stroke)

### Modifiers
- `shadow: { blur, offsetX, offsetY, color }` — Canvas shadow on any primitive
- `rimLight: { color, fromAngle, width, falloff }` — directional silhouette edge highlight
- `when: "key == value" | "key in [a,b]"` — state-gated rendering

### Fills
- `string` (CSS color)
- `{ palette: "key", darken? }` — manifest palette ref; **state can override** (Spine slot color animation)
- `{ gradient: "linear" | "radial", x0, y0, …, stops: [{ at, color }] }` — static gradients are cached per-ctx

### Expression DSL
Numeric fields accept literal numbers OR string expressions: `+ - * / %`, `PI / TAU / E`, `cos sin tan clamp lerp pow sqrt floor ceil round min max abs`. Color strings interpolate `${expr}` for state-dependent alpha.

### State variables (auto-injected)

| Variable | Source |
|---|---|
| `time` | Always available |
| `progress` | Effects only (0→1 over `defaultDuration`) |
| `expression` / `action` / `mouth` | Character render state |
| `intensity` | Expression strength 0..1 |
| `viseme` / `name` | Dialogue + display |
| `z` | Pseudo-depth; drives contact shadows |
| `angle` / `resolvedAngle` | Multi-view characters |
| `headYaw` / `headPitch` | `headTurn` events; built-in face block uses these |
| `bone_<name>_rotate / _x / _y / _scale_x / _scale_y` | Spine keyframe runtime |
| `slot_<name>_color` | Spine slot color animation override |
| `seed` / `i` | Inside `particles` per-particle scope |

## 2.5D depth cues

Eight cues, all applied through the shape interpreter:

1. **Parallax** — `shape.layers.{bg,mid,fg}` + `shape.parallax` factors
2. **Z-scale + dim** — `characterAppear.position.z`, `depthScale = 1/(1 + z·0.0028)`
3. **Soft lighting** — body gradients + face radial + cel-shading shadow polygons
4. **Atmospheric haze** — translucent cool overlay in background
5. **Contact shadow** — z-aware ellipse below characters
6. **Foreground occlusion** — `scene.layers.foreground` draws after characters
7. **Per-limb occlusion** — `metadata.bodyPartLayers: { behind, main, front }` for cross-character interleaving
8. **Depth-of-field blur** — `transform.blurPx` on bg/fg layers

## Painterly features — escape the Flash look

The features below collectively shift the read from "vector / SVG" toward "painterly cel". Defaults are tuned to apply automatically; opt out via `project.config.postFX.enabled = false`.

| Feature | Implementation | Effect |
|---|---|---|
| **`noise` primitive** | Tiled 128×128 ImageData, per-ctx cache | Paper / film grain over flat fills |
| **`brush` primitive** | 3–5 offset strokes with width/alpha jitter | Hair / scars read as marker, not vector |
| **`rimLight` modifier** | Gradient stroke on silhouette path | Character pops off background |
| **`blurPx` on transform** | Canvas `filter: blur(Npx)` | Shallow depth-of-field |
| **`camera.jitter`** | Coupled sin/cos on (x,y) per frame | Hand-held camera read |
| **`frameHold` event** | Clamps time to 1/fps steps in window | "On twos/threes" impact stutter |
| **Global postFX** | saturate · contrast · sepia · vignette · grain | Unified painterly grade per frame |
| **AO ellipses (auto)** | Built into `buildHumanCharacterShape` | Anchors silhouette to ground |
| **Hair micro-sway (auto)** | `rotate: "sin(time * 0.6) * 0.014"` on hair | Hair "breathes" even when idle |

## Timeline events

```ts
sceneChange · cameraChange (with jitter) · frameHold · subtitle
characterAppear · characterDisappear · characterMove · characterAction
expressionChange (with intensity) · characterTurn · headTurn
propChange · effectPlay
dialogue · narration · lipSync · bgmPlay · soundEffect
```

The timeline engine is pure: `evaluateTimeline(project, library, time) → PreviewState`. Time is clamped through any active `frameHold` first, then every other resolution sees the snapped value (so lip-sync also stutters together).

## TTS + lip sync (Alibaba CosyVoice)

| Endpoint | Use |
|---|---|
| `POST /api/tts/synthesize` | One line; returns audio URL + viseme frames; caches by (provider, voice, emotion, text) hash |
| `POST /api/tts/segment-generate` | Walks dialogue+narration events in a segment; only synthesizes missing audio |
| `GET /api/tts/audio/<hash>.mp3` | Serves audio from `tts_audio` SQLite table (BLOB) with disk fallback |
| `GET /api/tts/voices` | Hard-coded catalogue (longxiaochun / longwan / longxiaocheng / …) |
| `GET /api/tts/cache?limit=N` | Inventory of cached audio (no blobs) |

Provider is auto-selected:
- `DASHSCOPE_API_KEY` set → `AlibabaCosyVoiceProvider` (WebSocket, cosyvoice-v1 default)
- otherwise → `MockTtsProvider` (silent WAV + estimated visemes, no quota)
- `CUCUMBER_TTS_PROVIDER=mock` forces mock even with key

Lip sync: Chinese text → pinyin (~600-char hand-curated table) → 7 visemes (`rest / open / narrow / round / mid / wide / ee`) → viseme frames ride the dialogue event into `state.viseme` → builder's mouth primitives are gated on `when: "mouth == open"` etc.

## Music beat grid

`GET /api/audio/beats?bpm=120&duration=30&offset=0.1` returns a beat array + downbeat indices. Snap event times via `/api/audio/snap` or cache the grid on `segment.beatGrid` for the editor to draw guides.

## AI skills

Five skills in `.claude/skills/`:

| Skill | Trigger |
|---|---|
| **cucumber-asset-generator** | "AI 生成资产" button — designs a single AssetManifest with 2.5D + LX-* rules baked in |
| **cucumber-segment-generator** | "AI 生成片段" button — designs Chapter + Segment + missing assets from a script |
| **cucumber-spine-fetcher** | Fetches public Spine examples from URLs / GitHub raw + auto-converts |
| **(referenced) cucumber-asset-generator references/procedural-shape.md** | Full primitive recipe library AI consults during generation |

All skills emit JSON for UI preview; the frontend (not the skill) decides what enters the DB.

### Pre-emit checklists

- Asset generator: 16-row required-elements + multi-view + LX-* compliance
- Segment generator: 47 pre-emit checks across structure / TL events / references / time / logic / multi-view / audio / sfx / head-pose

Lint scripts mirror these so anything that bypasses the skill still gets caught.

## Style bars

Opt-in stylistic acceptance bars via `project.config.styleBar`. The lint and AI skills apply extra rules per bar:

| Bar | Doc | Status |
|---|---|---|
| `luoxiaohei` | [docs/acceptance-luoxiaohei.md](docs/acceptance-luoxiaohei.md) | ✅ 22 LX-* rules |
| `shinkai` / `ghibli` / `jiangnan-baiyi` | — | reserved (schema accepts, rules TBD) |

Run `npm run lint:luoxiaohei` to validate every 罗小黑 project's assets + segments against the bar.

## Demo content

Two projects ship pre-seeded:

| Project | Style | Notes |
|---|---|---|
| 父子争吵 (`project_family_argument_001`) | Baseline 2.5D | Living-room + doorway, two-character dialogue. Exercises every depth cue + sceneChange + camera push-in. |
| 罗小黑风格 · 森林晨光 (`project_luoxiaohei_demo_001`) | `styleBar: luoxiaohei` | 22 s segment in a forest. Showcases multi-view + TTS + viseme sync + camera jitter + frameHold impact + noise + rimLight + brush hair. |

Open http://localhost:5173/ → 项目管理 → top-right project picker.

The 罗小黑 demo is re-seeded by `python3 scripts/seed-luoxiaohei-demo.py` (~350 lines of hand-authored manifests against the LX-* bar). Audio re-generation hits the SQLite cache, so re-seeding doesn't burn TTS quota.

## Performance notes

- Static `CanvasGradient` per-ctx cache (most scene/character gradients are literal-only)
- `noise` primitive tile cached per-ctx (128×128, ~16 KB)
- `tts_audio` table reads as BLOB direct to Response body
- 3-pass per-limb renderer only activates if any character declares `bodyPartLayers`; legacy assets keep single-pass cost

Bundle: ~355 KB / ~106 KB gzip.

## Roadmap

See [docs/capability-roadmap.md](docs/capability-roadmap.md) for the full table of what's shipped vs. queued. Big-lift items still queued:

- True 3D pipeline (out of scope — different render stack)
- Music-onset beat detection (we have BPM-driven grid; real DSP analysis is the next step)

## Key files

| Path | Role |
|---|---|
| [src/engine/proceduralShape.ts](src/engine/proceduralShape.ts) | Shape interpreter — all 14 primitives, gradients, rimLight, blur, noise, brush |
| [src/engine/timeline.ts](src/engine/timeline.ts) | Pure time → state evaluator; handles frameHold, camera jitter, viseme/head interpolation |
| [src/engine/characterPainter.ts](src/engine/characterPainter.ts) | Per-character draw with angle/viseme/headPose/bodyPart routing |
| [src/engine/spineKeyframes.ts](src/engine/spineKeyframes.ts) | Spine bone/slot keyframe evaluator with cubic bezier |
| [src/data/characterShapes.ts](src/data/characterShapes.ts) | Built-in human builder (~800 lines, 12 expressions, 7 visemes, head pose, hair sway, AO) |
| [src/data/characterShapesViews.ts](src/data/characterShapesViews.ts) | Back / side / 3-quarter view builders |
| [src/components/PreviewCanvas.tsx](src/components/PreviewCanvas.tsx) | Render pipeline + audio playback + postFX |
| [server/services/tts/](server/services/tts/) | Alibaba CosyVoice + mock providers + pinyin viseme mapper |
| [server/services/audio/beatGrid.ts](server/services/audio/beatGrid.ts) | BPM beat grid generator |
| [server/repo/ttsAudio.ts](server/repo/ttsAudio.ts) | BLOB audio storage |
| [scripts/build-character-shape.ts](scripts/build-character-shape.ts) | CLI: spec → shape/manifest/bundle (4-view) |
| [scripts/seed-luoxiaohei-demo.py](scripts/seed-luoxiaohei-demo.py) | The 罗小黑 demo project seed |
| [scripts/lint-2_5d.ts](scripts/lint-2_5d.ts) | Asset + segment lint + LX-* style-bar rules |
| [docs/](docs/) | 2.5d-plan · capability-roadmap · acceptance-luoxiaohei |
