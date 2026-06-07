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

type TimelineEvent =
  | { time, type: "sceneChange", sceneId }
  | { time, type: "cameraChange", camera: { mode, target?, x?, y?, zoom, duration, transition } }
  | { time, type: "characterAppear", target, position: { x, y, z? }, expression?, scale? }
  | { time, type: "characterDisappear", target }
  | { time, type: "characterMove", target, to: { x, y, z? }, duration }
  | { time, type: "characterAction", target, action: { name, params } }
  | { time, type: "expressionChange", target, expression }
  | { time, type: "propChange", propId, visible?, position? }
  | { time, type: "effectPlay", effectId, position, duration }
  | { time, type: "subtitle", text, duration }
  | { time, type: "dialogue", target, assetId?, text?, duration }
  | { time, type: "narration", assetId?, text?, duration }
  | { time, type: "bgmPlay", assetId, volume }
  | { time, type: "soundEffect", assetId, volume };
```

## 2.5D timeline rules

Make z-depth and parallax pay off. A good segment includes:

1. **Distinct character depths** — characters who are visually distant get `position.z` ≥ 150; foreground characters stay at z ≤ 30. Without z spread, depth scaling has nothing to show.
2. **`z` interpolation in characterMove** — at least one `characterMove` must change `to.z` (not just x/y) so the user sees a character grow or shrink as they walk toward/away from camera.
3. **Camera pans, not just cuts** — at least one `cameraChange` with `transition: "smooth"` and a non-trivial `(x, y)` delta so parallax has something to push against.
4. **Open the segment offset from camera rest** — don't start with the camera centred at `(640, 360)`. Bias toward 460 or 820 so the first pan immediately reveals parallax.
5. **End on a wide reset** — last cameraChange should return to a wide shot, so the next segment starts clean.

## Workflow

1. **Read the script idea.** Extract: location, character list, beat structure, target duration (assume 25–35 seconds unless told otherwise).
2. **Inventory existing assets.**
   - `curl -sS "$CUCUMBER_API_BASE/assets"` → list of all assets
   - `curl -sS "$CUCUMBER_API_BASE/scenes"` → list of registered scenes
   - `curl -sS "$CUCUMBER_API_BASE/projects"` → current project structure (find the active one)
   - Pick existing characters / scene / props / bgm by id where possible.
3. **Design missing assets.** For each missing asset, invoke the `cucumber-asset-generator` skill inline (or follow its `references/procedural-shape.md` directly) and include the full AssetManifest in `newAssets`. Do NOT POST them — the UI registers them.
4. **Author the timeline.** Lay out events in time order. Honour the 2.5D timeline rules above. Use the procedural-shape.md state vocabulary (`expression`, `action: walking|idle`, `z`) for character behaviour.
5. **Pre-flight checklist.**
   - every `target` / `effectId` / `sceneId` / `assetId` is either listed in the existing inventory or in `newAssets`
   - every `time` is non-negative and within `segment.duration`
   - subtitle / dialogue durations don't run past the segment end
   - at least one z-aware character move + one smooth camera pan
6. **Emit the final line.** Print exactly one trailing JSON object per the **Output format**.

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
