---
name: cucumber-segment-generator
description: Design a Cucumber Engine Segment (chapter + segment + timeline) from a textual script idea so the UI can preview the playback and the user can confirm before it lands in the project. Use whenever the user asks to "AI-generate a segment", "design a 30-second scene", or to bootstrap a new chapter from a plot summary. The skill researches existing assets, may design missing ones via the sister cucumber-asset-generator skill, and authors the segment JSON — the front-end (not this skill) is responsible for inserting the segment into the project.
---

# Cucumber Segment Generator

## Authoring contract (read first)

This skill **does NOT mutate the project.** It returns a fully-formed Segment JSON (plus any new asset manifests the segment needs). The Cucumber Engine UI takes that JSON, renders a live timeline preview, and lets the user accept or discard it before any DB write.

Allowed network calls (read-only): list/get existing assets, scenes, and projects so the segment references real ids.

Backend base URL is in environment variable `CUCUMBER_API_BASE` (default `http://localhost:3001/api`):

| Verb | Path | Purpose |
|---|---|---|
| GET  | `/assets` | list existing assets to find characters / scenes / props / effects to reuse |
| GET  | `/scenes` | list registered scenes |
| GET  | `/projects` | inspect the target project for chapter / character context |
| POST | `/tts/synthesize` | generate dialogue audio via Alibaba TTS (returns `audioUrl` + viseme frames) |
| GET  | `/tts/voices`    | list configured voices + emotion cues |

## Output format (strict)

End your run with exactly one trailing line of pure JSON:

```json
{
  "ok": true,
  "segment": {
    "chapter": { ...Chapter... },
    "segment": { ...Segment... },
    "newAssets": [ ...AssetManifest[] ]
  }
}
```

…or, on a recoverable failure (e.g. user asked for an asset that can't be designed within scope):

```json
{"ok": false, "error": "<short reason>"}
```

Both `chapter` and `segment` are required. `newAssets` is optional — include any asset manifests the segment references that don't already exist on the backend. Each asset must follow the `cucumber-asset-generator` 2.5D rules; if you need a new character/scene/prop/effect, design it inline and emit it in `newAssets`.

The `chapter.chapterId` and `segment.segmentId` must be unique within the target project (the front-end will detect collisions and ask for new ids if needed — pick something descriptive like `chapter_kitchen_breakfast_001`).

## Segment schema reminder

Mirrors `src/types/schema.ts`:

```ts
interface Chapter {
  chapterId: string;
  title: string;
  sceneId: string;                         // must point to a real scene (existing OR included in newAssets)
  characters: string[];                    // assetIds referenced by the segment
  transition: { type: "none"|"cut"|"fadeIn"|"fadeOut"|"fadeToBlack"|"dissolve"|"titleCard"; duration: number };
  bgm?: string;                            // optional bgm assetId
  segments: Segment[];                     // include the single segment here too
}

interface Segment {
  segmentId: string;
  name: string;
  duration: number;                        // total seconds
  timeline: TimelineEvent[];               // see below
}

type AngleKey =
  | "front" | "back"
  | "sideLeft" | "sideRight"
  | "threeQuarterLeft" | "threeQuarterRight";

type Viseme = "rest" | "open" | "narrow" | "round" | "mid" | "wide" | "ee";
type VisemeFrame = { time: number; viseme: Viseme; token?: string };

type TimelineEvent =
  | { time, type: "sceneChange", sceneId }
  | { time, type: "cameraChange",
      camera: { mode, target?, x?, y?, zoom, duration, transition,
                jitter? /* px peak displacement; 0.6–1.2 for handheld pan, 0 = locked tripod */,
                ease?   /* easeInOut(default) | easeOut(settling dolly) | linear(programmed) */ } }
  | { time, type: "frameHold",
      fps      /* 6 = anticipation hold, 10 = impact stutter, 12 = cel "on twos" */,
      duration /* seconds — typically 0.3–0.6 around an impact beat */ }
  | { time, type: "characterAppear", target, position: { x, y, z?, angle? }, expression?, scale? }
  | { time, type: "characterDisappear", target }
  | { time, type: "characterMove", target, to: { x, y, z?, angle? }, duration,
      ease? /* easeInOut(default)|overshoot|anticipate|elastic|bounce|linear|easeIn|easeOut */,
      arc?  /* px vertical arc height; >0 = hop/gesture lift, 0 = straight (default) */ }
  | { time, type: "characterAction", target, action: { name, params } }
  | { time, type: "expressionChange", target, expression, intensity? /* 0..1 */ }
  | { time, type: "characterTurn", target, angle: AngleKey, duration? /* >0 routes through a ¾ pose */ }
  | { time, type: "headTurn", target, yaw /* radians ±0.6 */, pitch?, duration?, ease? }
  | { time, type: "propChange", propId, visible?, position? }
  | { time, type: "effectPlay", effectId, position, duration }
  | { time, type: "subtitle", text, duration }
  | { time, type: "dialogue", target, assetId?, text?, duration,
                              audioUrl?, voice?, emotion?, visemes?: VisemeFrame[] }
  | { time, type: "narration", assetId?, text?, duration,
                                audioUrl?, voice?, emotion? }
  | { time, type: "lipSync", target, duration, visemes: VisemeFrame[] }
  | { time, type: "bgmPlay", assetId, volume }
  | { time, type: "soundEffect", assetId, volume };
```

## Motion polish — escape Flash tweening

Uniform symmetric `easeInOut` on every move + dead-straight paths + frozen
standing characters is the signature "Flash motion tween" read. The engine now
gives you the tools to break it; **use them on every segment**:

| Lever | Rule of thumb |
|---|---|
| **`ease` on characterMove** | A character arriving at a mark should `ease: "overshoot"` (weighted stop). A reach/lunge should `ease: "anticipate"` (wind-up). Reserve plain `easeInOut`/`linear` for mechanical motion. **Don't** leave every move on the default. |
| **`arc` on characterMove** | Any move that isn't a flat walk gets a small `arc` (20–60 px) so the path bows instead of sliding ruler-straight. Hops/dodges use larger arcs. |
| **`characterTurn` `duration`** | Always give a turn a `duration` (0.2–0.4 s) so it routes front→¾→side instead of snapping. A 0-duration turn teleports — only use that for a hard cut. |
| **`ease` on cameraChange** | A settling dolly-in reads better as `easeOut` than symmetric `easeInOut`. |
| **Idle breath is automatic** | Every visible character gets a subtle, desynced breathing bob for free — you do **not** author it. But that means a "nothing happens" segment still looks alive only at the breath level; you still owe at least one real `characterAction` (TL5). |

## Style bars (opt-in per project)

If `project.config.styleBar = "luoxiaohei"`, the segment must additionally pass the rules in [docs/acceptance-luoxiaohei.md](../../../docs/acceptance-luoxiaohei.md). The camera-grammar is the biggest delta from baseline:

| Rule | What the timeline must satisfy |
|---|---|
| LX-T1 | First `characterAppear` at `time ≥ 1.0 s` — open with environment hold |
| LX-T2 | ≥ 1 smooth horizontal pan: `cameraChange` with `transition: "smooth"`, Δx ≥ 200, `duration ≥ 2.0` |
| LX-T3 | ≥ 1 slow push-in: Δzoom ≥ 0.15, `duration ≥ 1.5`, `transition: "smooth"` |
| LX-T4 | Each dialogue ≥ 2.0 s should have a closeUp `cameraChange` on the speaker mid-line |
| LX-T5 | Every `characterAction` whose name matches attack/punch/kick should have an `effectPlay` (radial speed line) within ±0.15 s |
| LX-T6 | ≤ 1 hard `transition: "cut"` per segment |
| LX-T7 | After `characterDisappear`, hold ≥ 0.6 s before the next `sceneChange` |
| LX-T8 | Total dialogue duration ≤ 70 % of segment duration |
| LX-W2 | If the BGM declares a BPM, snap ≥ 2 `cameraChange` events to beats; cache the resolved grid on `segment.beatGrid` |

### Snapping to beats

Call `/api/audio/beats?bpm=<bgm.bpm>&duration=<segment.duration>` once at the start; you get back `{ beats, downbeats, downbeatEvery }`. Snap every camera/effect event you author to the nearest beat that's within ±0.2 s — pick the downbeat when the beat is a "big" cut (sceneChange or wide reset). Cache the grid on `segment.beatGrid` so the editor draws the same guides the user sees.

### Camera grammar cheat-sheet

Templates to paste verbatim:

**Environment hold (opening 2 s)**:
```json
{ "time": 0,    "type": "sceneChange",  "sceneId": "..." },
{ "time": 0,    "type": "cameraChange", "camera": { "mode": "wide", "x": 460, "y": 360, "zoom": 0.95, "duration": 0, "transition": "cut" } }
```

**Horizontal pan with parallax (3 s)**:
```json
{ "time": 5, "type": "cameraChange",
  "camera": { "mode": "wide", "x": 880, "y": 360, "zoom": 1.0, "duration": 3, "transition": "smooth" } }
```

**Slow push-in on reaction (1.8 s)**:
```json
{ "time": 12, "type": "cameraChange",
  "camera": { "mode": "closeUp", "target": "character_xiaohei_001", "zoom": 1.45, "duration": 1.8, "transition": "smooth" } }
```

**Speed line on attack**:
```json
{ "time": 8.0, "type": "characterAction", "target": "character_xiaohei_001", "action": { "name": "attack", "params": {} } },
{ "time": 8.0, "type": "effectPlay",       "effectId": "effect_speed_lines_001", "position": { "x": 540, "y": 400 }, "duration": 0.5 }
```

**Lingering empty-frame breath**:
```json
{ "time": 22, "type": "characterDisappear", "target": "character_xiaohei_001" },
{ "time": 22.8, "type": "sceneChange", "sceneId": "scene_forest_path_001" }
```

If the user doesn't ask for a style bar, the baseline 2.5D timeline rules below apply and the LX-* rules are skipped.

## 2.5D timeline rules

Make z-depth and parallax pay off. A good segment includes:

1. **Distinct character depths** — characters who are visually distant get `position.z` ≥ 150; foreground characters stay at z ≤ 30. Without z spread, depth scaling has nothing to show.
2. **`z` interpolation in characterMove** — at least one `characterMove` must change `to.z` (not just x/y) so the user sees a character grow or shrink as they walk toward/away from camera.
3. **Camera pans, not just cuts** — at least one `cameraChange` with `transition: "smooth"` and a non-trivial `(x, y)` delta so parallax has something to push against.
4. **Open the segment offset from camera rest** — don't start with the camera centred at `(640, 360)`. Bias toward 460 or 820 so the first pan immediately reveals parallax.
5. **End on a wide reset** — last cameraChange should return to a wide shot, so the next segment starts clean.
6. **Angle-aware movement** — when a character walks horizontally, do one of:
   - Set `to.angle` on the `characterMove` event explicitly (`"sideRight"` if dx>0, `"sideLeft"` if dx<0).
   - Or rely on auto-inference: the engine sets the angle from `dx` automatically when `to.angle` is unset.
   - Add a `characterTurn` event right after the move ends to face the character back toward the conversation partner.

   This only matters for characters whose manifest declares ≥ 2 views in `metadata.views`. For single-view (front-only) characters the angle field is ignored.
7. **Dialogue audio + lip sync (Alibaba TTS)** — for every `dialogue` event with a `text` field, call `POST /api/tts/synthesize` and merge the result into the event:

   ```bash
   curl -sS -X POST "$CUCUMBER_API_BASE/tts/synthesize" \
     -H "Content-Type: application/json" \
     -d '{"text":"起这么早？","voice":"longwan","emotion":"calm"}' \
     | jq '{audioUrl, durationSec, visemes}'
   ```

   Take the returned `audioUrl`, `visemes`, and `durationSec` and put them onto the event:

   ```json
   {
     "time": 7,
     "type": "dialogue",
     "target": "character_father_001",
     "text": "起这么早？",
     "voice": "longwan",
     "emotion": "calm",
     "audioUrl": "/api/tts/audio/<hash>.mp3",
     "visemes": [...],
     "duration": 2.0
   }
   ```

   **Important**: set `duration` to the TTS-returned `durationSec` (rounded up to 0.1s) — guessing causes audio to clip mid-syllable. Use `voice` from the **same character every time** so the actor doesn't change voices mid-segment.

   Skip TTS when `assetId` (pre-recorded audio) is set — that path is for user-imported voice tracks.

8. **Head pose for conversation framing** — emit `headTurn` for close-ups where a character should be looking at someone NOT centred on screen. Yaw values:
   - look at someone on screen-right → `yaw: 0.4`
   - look at someone on screen-left → `yaw: -0.4`
   - look down (at table, or dejected) → `pitch: 0.3`

9. **Auto sound effects on actions** — when emitting a `characterAction`, look at the character's manifest `metadata.soundEffectIds[<actionName>]`. If a sfx asset id is registered, also emit a `soundEffect` at the same `time`:

   ```json
   { "time": 2.5, "type": "characterAction", "target": "character_child_001", "action": { "name": "walking", "params": {} } },
   { "time": 2.5, "type": "soundEffect", "assetId": "sfx_footstep_001", "volume": 60 }
   ```

   Characters without `soundEffectIds` declared are silent on action by design — don't fabricate sfx ids.

### Conversation framing
   - Two-character dialogue: face them toward each other (`sideLeft` + `sideRight`) at the start, then snap to `front` on the speaker during their close-up.
   - One character walking away with parting dialogue: emit `characterTurn` to `back` before / during the line so the back of their head is what the camera lingers on.

## Workflow

1. **Read the script idea.** Extract: location, character list, beat structure, target duration (assume 25–35 seconds unless told otherwise).
2. **Inventory existing assets.**
   - `curl -sS "$CUCUMBER_API_BASE/assets"` → list of all assets
   - `curl -sS "$CUCUMBER_API_BASE/scenes"` → list of registered scenes
   - `curl -sS "$CUCUMBER_API_BASE/projects"` → current project structure (find the active one)
   - Pick existing characters / scene / props / bgm by id where possible.
3. **Design missing assets.** For each missing asset, invoke the `cucumber-asset-generator` skill inline (or follow its `references/procedural-shape.md` directly) and include the full AssetManifest in `newAssets`. Do NOT POST them — the UI registers them.
4. **Author the timeline.** Lay out events in time order. Honour the 2.5D timeline rules above. Use the procedural-shape.md state vocabulary (`expression`, `action: walking|idle`, `z`) for character behaviour.
5. **Pre-emit validation (hard gate).** Walk through every box in "Pre-emit checklist" below. Any unchecked box is a rejection — go back to step 4 and fix it. Do not emit a half-finished segment with a TODO note.
6. **Emit the final line.** Print exactly one trailing JSON object per the **Output format**.

## Pre-emit checklist

These are the things the front-end and the user will notice immediately. Skipping any of them produces a broken preview.

### Structure

| # | Check |
|---|---|
| ST1 | `chapter.chapterId` is unique, descriptive (`chapter_<location>_<beat>_NNN`), and snake_case |
| ST2 | `chapter.title` is a meaningful name, not a placeholder |
| ST3 | `chapter.sceneId` resolves to a real `SceneDefinition` (existing OR a newAsset of `type:"scene"`) |
| ST4 | `chapter.characters[]` contains the assetId of EVERY character that appears in the timeline |
| ST5 | `chapter.transition.duration ≥ 0` and `chapter.transition.type` is a valid enum |
| ST6 | `chapter.bgm` (if set) resolves to a real `bgm` asset |
| ST7 | `chapter.segments[]` includes the segment object (don't return it only in the top-level `segment` field — it must be inside `chapter.segments` too) |
| ST8 | `segment.duration ≥ 10` (anything shorter isn't a real beat) and ≤ 120 |

### Required timeline events (beat structure)

A coherent segment has these beats. Missing any one of them produces a flat/lifeless preview.

| # | Check |
|---|---|
| TL1 | At least one `sceneChange` event at `time: 0` (so the engine knows the starting scene even if it matches the chapter default) |
| TL2 | At least one `cameraChange` event at `time: 0` defining the initial framing |
| TL3 | At least one `characterAppear` per character listed in `chapter.characters[]` — no orphan characters |
| TL4 | At least one `dialogue` OR `subtitle` OR `narration` event — silent segments are rejected |
| TL5 | At least one `characterAction` with `action.name` other than `idle` — pure standing-around segments are rejected |
| TL6 | At least one `cameraChange` with `transition: "smooth"` and a non-trivial pan (Δx ≥ 80 or Δy ≥ 60 or Δzoom ≥ 0.15) |
| TL7 | At least one `characterMove` OR one `expressionChange` mid-segment — characters can't be frozen statues |
| TL8 | The final 1.5s of the segment includes either a closing line, a wide-shot reset, or a `fadeOut`/`fadeToBlack` transition cue |

### Reference integrity

| # | Check |
|---|---|
| R1 | Every `target` in any character-event resolves to a character assetId in the inventory or `newAssets` |
| R2 | Every `effectId` resolves to an effect asset |
| R3 | Every `sceneId` resolves to a scene |
| R4 | Every `assetId` on `bgmPlay` / `soundEffect` / `dialogue` / `narration` resolves to the correct asset type |
| R5 | Every `propId` resolves to a prop registered on the scene or a `newAssets` entry |
| R6 | `chapter.bgm` matches a `bgmPlay` event in the timeline (or is absent on both sides) |

### Time domain

| # | Check |
|---|---|
| T1 | Every `time` is `≥ 0` |
| T2 | Every `time` is `≤ segment.duration` |
| T3 | For every `characterMove`: `time + duration ≤ segment.duration` |
| T4 | For every `effectPlay`: `time + duration ≤ segment.duration` |
| T5 | For every `cameraChange`: `time + camera.duration ≤ segment.duration` |
| T6 | For every `subtitle` / `dialogue` / `narration`: `time + duration ≤ segment.duration` |
| T7 | No two events with the same `time` AND same `target` AND same `type` collide (duplicate) — Pick a 0.1s gap if you intentionally chain them |
| T8 | Event list is sorted by `time` ascending (helps human review even though engine doesn't require it) |

### Logical consistency

| # | Check |
|---|---|
| L1 | No `expressionChange` for a character before that character's `characterAppear` |
| L2 | No `characterMove` for a character before its `characterAppear` |
| L3 | No `characterAction` before `characterAppear` |
| L4 | If a character is `characterDisappear`-ed, no later event references them until a new `characterAppear` |
| L5 | Camera `target` (if used) resolves to a character that's visible at the camera event's time |
| L6 | Dialogue / narration text fields (when used without `assetId`) are non-empty strings |
| L7 | If `chapter.bgm` is set, exactly one `bgmPlay` event references it (not zero, not two competing tracks) |

### Multi-view (only if any character has ≥ 2 declared views)

| # | Check |
|---|---|
| V1 | `characterMove` events that change x by ≥ 80 either set `to.angle` explicitly or rely on auto-inference (don't pin them to `front` accidentally) |
| V2 | Conversation scenes (≥ 2 dialogue-speakers facing each other) set their initial `position.angle` to `sideLeft` / `sideRight` rather than both `front` |
| V3 | A character walking away from the camera (parting beat) gets a `characterTurn` to `back` before the line |
| V4 | A character's declared angle in any event matches a key present in their manifest's `metadata.views[]` (don't request `back` on a character that only has `front`) |

### Audio + lip-sync (TTS)

| # | Check |
|---|---|
| AU1 | Every `dialogue` event with `text` has `audioUrl` populated from a `/api/tts/synthesize` call |
| AU2 | Every dialogue event has `visemes` populated (from the same call) — empty viseme arrays produce frozen mouths |
| AU3 | Every dialogue event's `duration` matches the TTS-returned `durationSec` to within 0.2s |
| AU4 | All dialogue events for the SAME character use the SAME `voice` (consistent casting) |
| AU5 | `emotion` field corresponds to the dialogue's emotional context (e.g. an angry line uses `emotion: "angry"`, not `"calm"`) |
| AU6 | If a `narration` event has `text`, it also has `audioUrl` from TTS (narration plays back too) |

### Auto sound effects

| # | Check |
|---|---|
| SE1 | For every `characterAction` whose character manifest declares `metadata.soundEffectIds[<actionName>]`, the timeline includes a matching `soundEffect` event at the same time |
| SE2 | No fabricated `sfx_*` ids — only ids that exist in the inventory or in `newAssets` |
| SE3 | `volume` is in [0, 100], realistic for the kind of sfx (footsteps ~50, swings ~70, impacts ~85) |

### Head pose (only when characters carry expressive close-ups)

| # | Check |
|---|---|
| HD1 | At least one `headTurn` per character in a close-up sequence ≥ 5s so eyes aren't dead-locked forward |
| HD2 | Yaw values are within ±0.6 (33°) — anything bigger should be `characterTurn` to a side view instead |
| HD3 | Reciprocal pose: when char A is `headTurn yaw:0.4` (looking right), the char B they're looking at is somewhere screen-right relative to A |

### `newAssets` minimums (only if `newAssets[]` is non-empty)

| # | Check |
|---|---|
| N1 | Every `newAssets[]` entry passes the `cucumber-asset-generator` skill's "Required elements" gate |
| N2 | Every `newAssets[]` character has `metadata.views[]` declaring at least one view, plus a matching `metadata.shape` (legacy) or `metadata.shapes[<view>]` |
| N3 | Every `newAssets[]` scene has the full 3-layer split + parallax map (S1–S6 from asset-generator) |
| N4 | No `newAssets[]` entry duplicates an existing assetId from the inventory |
| N5 | Every `target` / `effectId` / `propId` / `sceneId` / `bgmId` referenced by the segment that ISN'T in the existing inventory has a corresponding entry in `newAssets[]` (no dangling references) |

## Hard rules

- **Never POST to `/api/assets`, `/api/scenes`, or `/api/projects`.** All persistence is the UI's job.
- Never invent asset ids that look like existing ones — always check `GET /assets/:id` if you're unsure.
- Reused asset ids must match exactly (`character_father_001`, not `father_001`).
- Newly designed assets must include the 2.5D mandatory features from `cucumber-asset-generator/SKILL.md` (character lighting trio; scene layers + parallax; etc.).
- Never include API keys or environment dumps in the output.

## Examples

### Minimal sit-down conversation

```json
{
  "ok": true,
  "segment": {
    "chapter": {
      "chapterId": "chapter_kitchen_breakfast_001",
      "title": "早餐对话",
      "sceneId": "scene_kitchen_001",
      "characters": ["character_father_001", "character_child_001"],
      "transition": { "type": "fadeIn", "duration": 1 },
      "segments": []
    },
    "segment": {
      "segmentId": "segment_kitchen_breakfast_001",
      "name": "孩子下楼吃早餐",
      "duration": 30,
      "timeline": [
        { "time": 0, "type": "sceneChange", "sceneId": "scene_kitchen_001" },
        { "time": 0, "type": "cameraChange", "camera": { "mode": "wide", "x": 460, "y": 360, "zoom": 1, "duration": 0, "transition": "cut" } },
        { "time": 0.5, "type": "characterAppear", "target": "character_father_001", "position": { "x": 820, "y": 545, "z": 60 }, "expression": "neutral", "scale": 1 },
        { "time": 1.0, "type": "characterAppear", "target": "character_child_001", "position": { "x": 200, "y": 600, "z": 0 }, "expression": "neutral", "scale": 0.92 },
        { "time": 1.5, "type": "subtitle", "text": "孩子下楼，闻到了煎蛋的香味。", "duration": 3 },
        { "time": 2.5, "type": "characterAction", "target": "character_child_001", "action": { "name": "walking", "params": {} } },
        { "time": 2.5, "type": "characterMove", "target": "character_child_001", "to": { "x": 540, "y": 545, "z": 50 }, "duration": 4 },
        { "time": 3.0, "type": "cameraChange", "camera": { "mode": "wide", "x": 700, "y": 360, "zoom": 1, "duration": 3.5, "transition": "smooth" } },
        { "time": 6.5, "type": "characterAction", "target": "character_child_001", "action": { "name": "idle", "params": {} } },
        { "time": 7, "type": "dialogue", "target": "character_father_001", "text": "起这么早？", "duration": 2.0 },
        { "time": 9.5, "type": "dialogue", "target": "character_child_001", "text": "学校有早自习。", "duration": 2.4 },
        { "time": 12, "type": "cameraChange", "camera": { "mode": "closeUp", "target": "character_child_001", "zoom": 1.5, "duration": 1.2, "transition": "smooth" } },
        { "time": 13.5, "type": "expressionChange", "target": "character_child_001", "expression": "soft" },
        { "time": 14, "type": "dialogue", "target": "character_child_001", "text": "谢谢爸。", "duration": 2.4 },
        { "time": 17, "type": "cameraChange", "camera": { "mode": "wide", "x": 640, "y": 360, "zoom": 1, "duration": 2, "transition": "smooth" } },
        { "time": 20, "type": "expressionChange", "target": "character_father_001", "expression": "soft" },
        { "time": 20.5, "type": "dialogue", "target": "character_father_001", "text": "路上小心。", "duration": 2.4 },
        { "time": 25, "type": "subtitle", "text": "厨房里只剩下窗外的阳光。", "duration": 4 }
      ]
    }
  }
}
```
