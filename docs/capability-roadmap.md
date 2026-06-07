# Capability roadmap

Snapshot of where the engine sits after the 2.5D + multi-view + TTS+lip-sync work, and what's queued next. Update this doc on every cap-layer commit.

## Where we are (2026-06)

### ✅ Shipped

| Capability | Surface | Notes |
|---|---|---|
| 2.5D camera + parallax | `ProceduralShape.layers` + parallax map | bg / mid / fg, atmospheric haze |
| Character z + depth | `CharacterRenderState.z`, `depthScale = 1/(1 + z·0.0028)` | range 0–300 |
| Multi-view characters | `metadata.shapes[<angle>]` + `views[]` | front/back/sideLeft/sideRight + 3/4 |
| Auto-angle on movement | timeline infers `to.angle` from dx | overridable per event |
| `characterTurn` event | snaps the angle | duration field reserved for future easing |
| AI character builder | `scripts/build-character-shape.ts --emit bundle` | one CharacterSpec → 4 views |
| Required-elements lint | `scripts/lint-2_5d.ts` | head/torso/arms/legs/feet/viseme/parity |
| Pre-emit checklists | both AI skills | 16 character + 47 segment checks |
| **Alibaba TTS provider** | `server/services/tts/alibaba.ts` | CosyVoice v2 WebSocket |
| **TTS endpoint + audio cache** | `POST /api/tts/synthesize` | SHA-256 cached by (provider, voice, emotion, text) |
| **Mock TTS fallback** | `server/services/tts/mock.ts` | silent WAV + viseme estimates, no key needed |
| **Pinyin → viseme mapper** | `server/services/tts/pinyinViseme.ts` | 7 visemes, ~600 char curated table |
| **Lip-sync timeline state** | `CharacterRenderState.viseme` | resolved per-frame from `dialogue` / `lipSync` events |
| **12-expression baseline** | `STANDARD_EXPRESSIONS` | + `expressionIntensity` ∈ [0,1] |
| **Particles primitive** | `kind: "particles"` in shape DSL | up to 500 per emitter, 3 shapes |
| **Head pose state** | `headYaw` / `headPitch` | wired through state; builder usage documented |
| **Sound-effect convention** | `metadata.soundEffectIds[<action>]` | segment generator auto-emits sfx |

## ✅ Newly shipped (2026-06, third pass)

| Capability | Surface | Notes |
|---|---|---|
| **Music-beat scaffolding** | [server/services/audio/beatGrid.ts](../server/services/audio/beatGrid.ts) + `/api/audio/beats` + `/api/audio/snap` | BPM-driven beat grid; `Segment.beatGrid` cache; downbeats every 4; `snapToBeat()` helper for AI |
| **Spine cubic bezier curves** | [spineKeyframes.ts:60](../src/engine/spineKeyframes.ts:60) | Newton-iter solver for bezier `[x1, y1, x2, y2]`; falls back to linear on malformed curves |
| **Spine slot color animation** | `SpineSlotKeyframes.color[]` + `slot_<name>_color` state injection | importer maps slot palette key to the same name; runtime override via state takes precedence over the manifest palette |
| **罗小黑 acceptance bar** | [docs/acceptance-luoxiaohei.md](acceptance-luoxiaohei.md) + `npm run lint:luoxiaohei` | 6 character + 4 scene + 8 timeline LX-rules; opt-in via `project.config.styleBar = "luoxiaohei"` |
| Style-bar lint extension | [scripts/lint-2_5d.ts](../scripts/lint-2_5d.ts) | `--style luoxiaohei` flag walks assets AND segments in the live DB + seed project |

## ✅ Newly shipped (2026-06, second pass)

| Capability | Surface | Notes |
|---|---|---|
| Audio playback in preview | [PreviewCanvas.tsx](../src/components/PreviewCanvas.tsx) | multi-track: dialogue / narration / bgm (looping) / sfx; auto-resync on scrub; cleanup on segment swap |
| TTS panel in event editor | `TtsPanel` in [App.tsx](../src/App.tsx) | voice + emotion select, "生成音频" / "重新生成" / "试听" buttons, patches event in place with audioUrl + viseme frames |
| Head pose in built-in builder | [characterShapes.ts](../src/data/characterShapes.ts) (face block wrapped in transform) | eyes / mouth / brows / nose all shift with `headYaw * 14` translation + `headYaw * 0.15` rotation |
| Head pose interpolation | [timeline.ts](../src/engine/timeline.ts) | easeInOut lerp between consecutive `headTurn` events across their `duration` |
| Per-limb occlusion | `bodyPartLayer` in painter + 3-pass renderer in PreviewCanvas | characters opt-in via `metadata.bodyPartLayers: { behind?: number[], main?: number[], front?: number[] }`; legacy single-pass fallback when no character declares it |
| Spine keyframes | [spineKeyframes.ts](../src/engine/spineKeyframes.ts) + extended [spineImporter.ts](../src/importers/spineImporter.ts) | imports `animations[].bones[].rotate/translate/scale[]` keyframes; emits `bone_<name>_rotate/_x/_y` state vars; transforms in the imported shape reference them so action change → real movement |

## ⏸️ Wired-but-not-applied (state plumbed, builder hasn't covered every case yet)

All of the previously deferred items now SHIP. The only remaining wired-but-passive piece is:

| Capability | Why | Next step |
|---|---|---|
| Music-beat-driven scene timing | No beat analyzer yet | Add `bgmAnalyze` server endpoint + new timeline event `bgmBeat` for snapping cameras |
| Spine cubic-bezier curves | Importer reads keyframes but flattens any non-stepped curve to linear | When [spineKeyframes.ts:60](../src/engine/spineKeyframes.ts:60) sees `Array.isArray(curve)` (cubic 4-tuple), interpolate via the bezier instead of `lerp` |

## 🛠️ Truly heavy lifts (not started)

Each of these is a separate engineering arc.

### Music-driven scene timing
- ~2 days
- Beat detection on the server (lib: `web-audio-beat-detector` or `essentia.js`)
- New event `bgmBeat[]` derived from analysis, queryable by camera / effect snap logic

### Spine bezier curves + slot color timelines
- ~1.5 days
- Spine ships per-keyframe cubic curves as 4-tuples `[cx1, cy1, cx2, cy2]`; we currently treat as linear
- Slot color animation needs a new `bone_<name>_color` state var + a `palette` override hook in the renderer

### True 3D pipeline migration
- weeks
- Out of scope for Canvas2D — would require Three.js / WebGPU rewrite

## Style summary

The engine is now equivalent in capability to **抖音漫剧主流栈** (PSD slice + lip-sync + TTS + simple parallax + multi-view), and AI-generated assets pass through a documented + automated quality gate. The next two big lifts (Spine keyframes, per-limb occlusion) bring it close to **Live2D-tier** for character performance.

Hard ceilings remain unchanged: no real 3D, no normal maps, no cloth/fluid physics, no IK, no mesh deform. Those require a different render pipeline (Three.js or WebGPU); not in scope for this Canvas2D engine.
