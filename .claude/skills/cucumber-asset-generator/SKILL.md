---
name: cucumber-asset-generator
description: Design Cucumber Engine asset manifests (characters, scenes, props, effects, BGM, sound effects) so the UI can preview them and the user can confirm before they enter the SQLite library. Use whenever the user asks to "AI-generate an asset", "design a character / scene / prop / BGM", or to enrich the asset library from a textual description. The skill researches, picks ids/licenses, and authors the manifest — the front-end (not this skill) is responsible for the final POST that registers the asset.
---

# Cucumber Asset Generator

## Authoring contract (read first)

This skill **does NOT register the asset.** It returns a fully-formed AssetManifest as JSON. The Cucumber Engine UI takes that JSON, renders a preview to the user, and lets them confirm or discard before any DB write happens.

That means: **do not POST to `/api/assets`**. The only API calls allowed are read-only — listing existing assets to avoid `assetId` collisions, and fetching license pages when researching external sources.

Backend base URL is provided in environment variable `CUCUMBER_API_BASE` (default `http://localhost:3001/api`). Read-only endpoints used by this skill:

| Verb | Path | Purpose |
|---|---|---|
| GET  | `/assets` | list current assets (avoid duplicate ids) |
| GET  | `/assets/:id` | check existence |

## Output format (strict)

End your run with exactly one trailing line of pure JSON:

```json
{"ok": true, "manifest": { ...full AssetManifest... }}
```

…or, on a recoverable failure (e.g. license could not be verified, user prompt was ambiguous):

```json
{"ok": false, "error": "<short reason>"}
```

The `manifest` field must be the complete object that would round-trip through the API. No extra wrapping, no markdown fences in the final line. The frontend parses this line.

## Manifest schema

Mirror `src/types/schema.ts`. Every manifest MUST include:

```json
{
  "assetId":  "<stable_snake_id>",
  "name":     "<human readable>",
  "category": "visual" | "audio",
  "type":     "character" | "scene" | "prop" | "expression" | "action" | "effect" | "foreground" | "background" | "cameraTemplate" | "sceneElement" | "bgm" | "dialogue" | "narration" | "soundEffect" | "environment",
  "scope":    "global" | "project",
  "source":   { "kind": "imported" | "generated" | "manual" | "referenced", "format": "<png|svg|wav|mp3|procedural|...>", "originalFile": "<filename or url>" },
  "files":    { "<key>": "<url or local path>" },
  "tags":     ["..."],
  "metadata": { /* type-specific, see below — visual procedural assets MUST include `shape` */ },
  "license":  { "type": "...", "author": "...", "sourceUrl": "...", "commercialUse": true|false, "needAttribution": true|false }
}
```

`assetId` rules:
- Stable, lowercase, ASCII, `<type>_<descriptor>_<3digit>` convention (`character_chef_007`, `bgm_calm_morning_002`).
- Check `GET /assets/:id` before choosing — bump the suffix if taken.

`metadata` by type:
- **character / prop / scene / background / foreground / effect (visual, procedural)**: include `shape: ProceduralShape` — see [references/procedural-shape.md](references/procedural-shape.md). Without `shape`, the engine cannot render the asset.
- **character**: also `width:int, height:int, anchor:{x,y}, palette:{body,skin,hair,...}, parts:[...]`, optional `displayName:string` (overrides head-badge text). Multi-view characters additionally carry `shapes: { front?, back?, sideLeft?, sideRight?, threeQuarterLeft?, threeQuarterRight? }` and a `views: AngleKey[]` declaration — see "Multi-view characters" below.
- **scene / background / foreground**: also `width:int, height:int, layers:["background","midground","foreground"]`. The `shape` MUST populate `layers.background/midground/foreground` and a `parallax` map (see 2.5D rules below).
- **prop**: also `width:int, height:int`.
- **effect**: also `blendMode:"screen|add|multiply|normal", defaultDuration:number`. The shape may reference `progress` (0 → 1 over `defaultDuration`).
- **bgm / soundEffect**: `durationSec:number, loop:bool, bpm:int?` — no shape (audio).

## Required elements (pre-emit hard gate)

Before emitting the manifest, **walk the checklist below for the asset type**. Any unchecked box is a rejection — re-author until every box clears. The frontend runs `scripts/lint-2_5d.ts` after the manifest arrives; failing the lint blocks the preview button. Treat this checklist as the lint's spec — don't ship a manifest you haven't manually verified against it.

### Character — required topology

A human character is "complete" only if **every one** of these is present in the shape:

| # | Element | How the lint detects it | Why it matters |
|---|---|---|---|
| C1 | **Head** | `circle` with `cy ≤ -280` and `r ≥ 50` | Without a head silhouette the character has no face anchor |
| C2 | **Torso** | `roundedRect` with `y ≤ -200` and `h ≥ 150` | The body silhouette read |
| C3 | **Two arms** | ≥ 2 `transform` branches with `\|translate.x\| ∈ [24, 70]` | A one-armed character was the most common AI failure mode |
| C4 | **Legs** | ≥ 1 `roundedRect` with `y ∈ [-60, 0]` and `h ≥ 30` | Pants / shorts block |
| C5 | **Feet** | ≥ 1 `polygon` at the baseline (`y ∈ [-10, 30]`) | Shoes / contact with ground |
| C6 | **Neck** (recommended) | rounded rect with `y ∈ [-280, -240]` and width ≈ 22-30 | Connects head to torso; absence reads as floating head |
| C7 | **Face features** (front + threeQuarter only) | At least 2 eye polygons + nose/mouth marks | Back view legitimately drops these |
| C8 | **Hair** (unless `hairStyle:"bald"`) | Polygon with all `y < -270` | Bald reads ok if declared, otherwise scalp shows |
| C9 | **≥ 4 outline strokes** | Any primitive with `stroke` | Cel-shading silhouette read |
| C10 | **≥ 4 distinct actions** | `when: "action == xxx"` branches covering ≥ 4 names from {idle, walking, attack, defend, victory, punch, kick, block, cheer} | Timeline-driven posing |
| C11 | **`metadata.actions[]` declared** with ≥ 4 entries | Drives the preview UI's action buttons |
| C12 | **Lighting trio** (body gradient + face radial + z-aware contact shadow) | See 2.5D rules below |
| C13 | **`metadata.references[]` non-empty** (for AI-generated assets) | Attribution + reproducibility |
| C14 | **All 7 visemes covered** when any are declared | `mouth == open/narrow/round/mid/wide/ee` — see "Lip-sync visemes" below |
| C15 | **`metadata.expressions[]` covers the 12-baseline set** (or explicitly omits ones the character can't do) | Drives segment-generator's confidence in requesting expressions |
| C16 | **`metadata.soundEffectIds`** (optional but recommended) | Maps action names → soundEffect assetIds for auto-play on `characterAction` |

### Scene — required topology

| # | Element |
|---|---|
| S1 | `shape.layers.background` non-empty |
| S2 | `shape.layers.midground` non-empty |
| S3 | `shape.layers.foreground` non-empty |
| S4 | `shape.parallax.background ≤ 0.7` |
| S5 | `shape.parallax.foreground ≥ 1.1` |
| S6 | At least one background rect with `x ≤ -100` (overscan rule) |
| S7 | Atmospheric haze rect somewhere in background |
| S8 | Foreground contains at least one occluder shape |

### Prop — required topology

| # | Element |
|---|---|
| P1 | Main silhouette rect / polygon (not a single circle) |
| P2 | ≥ 1 gradient OR a `shadow` modifier OR a contact-shadow ellipse |
| P3 | Outline stroke on the main silhouette |

### Effect — required topology

| # | Element |
|---|---|
| E1 | Main shape primitive (starBurst / polygon) |
| E2 | Radial gradient halo behind the main shape |
| E3 | Alpha driven by `${1 - progress}` somewhere so the effect fades |

### Audio (bgm / soundEffect) — required topology

| # | Element |
|---|---|
| A1 | `metadata.durationSec` > 0 |
| A2 | `metadata.loop` set explicitly |
| A3 | `license` matches the actual source page (no inventing CC0 for unknown sources) |
| A4 | `files.sourceUrl` populated |

### Pre-emit self-check

Right before emitting the final `{"ok":true,"manifest":...}` line, mentally run the checklist for the asset's type. If anything is missing, **don't emit a half-finished manifest with a TODO comment** — go back, fix the gap, then emit. Half-shipped manifests downgrade the entire authoring loop because the user has to repeat the prompt instead of accepting the preview.

## Multi-view characters (angle support)

The engine renders a character from one of six angles depending on `CharacterRenderState.angle`: `front | back | sideLeft | sideRight | threeQuarterLeft | threeQuarterRight`. To support angle-switching the manifest carries:

```json
"metadata": {
  "views": ["front", "sideLeft", "sideRight"],
  "shape":  { "primitives": [...] },        // canonical / front (back-compat)
  "shapes": {
    "front":     { "primitives": [...] },
    "sideLeft":  { "primitives": [...] },
    "sideRight": { "primitives": [...] }
    // "back" + "threeQuarter*" optional
  }
}
```

Rules:

1. **Minimum**: every character must have `front`. Single-view (legacy) manifests still work.
2. **Important characters** (主角, 常驻 NPC): produce **front + sideLeft + sideRight** at minimum. Back is recommended if the script ever has them walk away. `threeQuarter*` is optional polish.
3. **Configurable accessories must appear in every populated view** (hat, chest emblem). Facial marks only appear in views where that side of the face is visible. The lint enforces this — a hat declared on `metadata.hat` that doesn't show up in the `back` view's primitives is a rejection.
4. **Palette is shared** — never use per-view colors. Fork the palette only by adding new keys (e.g. `palette.skinShadow`), never by overriding `palette.body` per view.
5. **Width / height / anchor are shared** — the same anchor point is used by every view so the character doesn't jump when angle changes. Side views naturally occupy less horizontal space inside the same box; that's fine.

### Generate the multi-view bundle via the script

Single command, all four canonical views at once, palette / accessories all locked:

```bash
npx tsx scripts/build-character-shape.ts --emit bundle --spec '{
  "palette": { "body": "#c14a3a", "skin": "#f0bf95", "hair": "#1f1610", "pants": "#3b6090" },
  "hairStyle": "fringe",
  "hat": "straw",
  "hatColor": "#e8c97a",
  "hatBandColor": "#c14a3a",
  "costume": "vest",
  "shorts": true,
  "facialMarks": [{ "kind": "scar_diagonal", "at": "under_left_eye" }],
  "chestEmblem": { "color": "#fff8e0" }
}' > /tmp/shapes.json
```

Then embed `/tmp/shapes.json` as `metadata.shapes` and set `metadata.views` to `["front","back","sideLeft","sideRight"]`.

Or get a complete manifest with the bundle pre-wired:

```bash
npx tsx scripts/build-character-shape.ts --emit manifest --views all --spec '{ "name": "厨师小李", ... }'
```

### Generate a single view

```bash
npx tsx scripts/build-character-shape.ts --view sideRight --spec '...' > /tmp/sideRight.json
```

`--view` accepts: `front` | `back` | `sideLeft` | `sideRight` | `threeQuarterLeft` | `threeQuarterRight`.

### When NOT to ship multi-view

- One-off background character that only appears front-on (background NPC at a table) — `front` only is fine
- Animal / robot / abstract character where the side-view builders don't apply — fall back to authoring views by hand
- Caller explicitly said "single view is fine"

When skipping additional views, **leave `metadata.shapes` undefined** rather than emitting empty entries. The renderer falls back to `metadata.shape` for any view it can't find.

## Lip-sync visemes

The engine drives character mouth shapes from a 7-viseme set. When a `dialogue` (or `lipSync`) event is active, the painter feeds one of these into `state.viseme` and `state.mouth`:

| Viseme | Pinyin family | Shape read |
|---|---|---|
| `rest` | silence, m/b/p closures | closed neutral |
| `open` | a, an, ang | wide "ah" |
| `narrow` | i, in, ing | tight smile |
| `round` | u, o, uo, ou | pursed "oh" |
| `mid` | e, en, eng | half-open "uh" |
| `wide` | ai, ei, ao | open + lateral pull |
| `ee` | ie, ye, üe | bright smile, teeth |

**State key**: `mouth`. The painter combines viseme + silent expression into a single key:

- when `viseme != rest` → `mouth = viseme`
- when `viseme == rest` → `mouth = expression` (e.g. `neutral`, `happy`, `sad`)

So the builder should write **one mouth primitive per viseme + one per expression**, each gated on `when: "mouth == <key>"`. **All 7 visemes must be present** if any are. Partial coverage causes mid-sentence frozen-mouth bugs; the lint catches this.

The 12-expression baseline: `neutral`, `happy`, `sad`, `angry`, `surprised`, `soft`, `scared`, `smug`, `embarrassed`, `thinking`, `crying`, `laughing`. Declare any subset you actually drew in `metadata.expressions[]` so the segment generator doesn't request `embarrassed` from a character that can only do `neutral / happy / sad`.

The build-character-shape.ts script ships all 12 expressions + all 7 visemes by default — use it.

### Intensity

Expressions accept an `intensity` ∈ [0, 1] from the timeline (default 1). Authored expression primitives can use this in numeric expressions:

```json
{ "kind": "polygon", "when": "mouth == happy",
  "points": [{ "x": -16, "y": "-256 + 3 * intensity" }, ...] }
```

That makes a "barely smiling" (intensity 0.3) read differently from a "full grin" (intensity 1). The built-in builder uses this on `happy`, `soft`, `sad`, `crying`.

## Head pose (yaw / pitch)

The timeline supports `headTurn { target, yaw, pitch?, duration? }` events. State variables `headYaw` and `headPitch` are pushed into the shape state in radians (typical range ±0.6 yaw, ±0.4 pitch).

The built-in builder doesn't yet rotate the head from these variables — that's a follow-up. AI-authored characters that want head-pose response should use the state in their facial primitives:

```json
{ "kind": "circle", "cx": "0 + headYaw * 14", "cy": "-318 + headPitch * 6", "r": 4, "fill": "#1a120a" }
```

Eyes shift slightly with headYaw; nose drops with headPitch. Read it as a "small head turn" for soft conversation cues.

## Sound-effects tied to actions

A character manifest may declare `metadata.soundEffectIds`:

```json
"metadata": {
  "soundEffectIds": {
    "walking": "sfx_footstep_001",
    "attack":  "sfx_swoosh_001",
    "victory": "sfx_cheer_001"
  }
}
```

The segment generator skill reads this and auto-emits `soundEffect` events whenever it emits a `characterAction` for that character. Soundless characters omit the key entirely.

Values must be `sfx_*` or `soundEffect_*` assetIds resolvable in the asset library.

## Painterly primitives — escape the Flash look

Four engine features that collectively shift the read from "SVG / Flash MX" toward "painterly cel animation". All optional; AI generators should use them on every character / scene unless the user explicitly asked for a flat / minimalist style.

### `kind: "noise"` — paper grain / film grain overlay

A tiled noise pattern alpha-blended over an area. Single biggest contributor to escaping the Flash look.

```json
{
  "kind": "noise",
  "x": -200, "y": 0, "w": 1680, "h": 720,
  "scale": 0.9, "alpha": 0.13,
  "blendMode": "multiply", "seed": 4242
}
```

Typical placement: one noise rect covering the full canvas of a SCENE's background layer at `alpha 0.10–0.18`. For warmer "watercolor paper" feel use `blendMode: "soft-light"`; for darker "newsprint" feel use `"multiply"`. The renderer caches the tile per CanvasRenderingContext2D, so repeated draws are free. `seed` freezes the pattern so it doesn't shimmer between frames.

### `kind: "brush"` — hand-drawn stroke

Replaces `polygon stroke` for hair locks, scars, accent lines. Multi-pass with width/alpha/jitter variation per stroke.

```json
{
  "kind": "brush",
  "points": [{"x": -8, "y": -240}, {"x": 0, "y": -250}, {"x": 8, "y": -240}, {"x": 0, "y": -234}],
  "stroke": "#1a1612",
  "closed": true,
  "passes": 4,
  "jitter": 1.1,
  "widthRange": [0.8, 2.4],
  "alphaRange": [0.55, 0.95],
  "seed": 211
}
```

Use on: hair tufts, character outlines that need "marker" feel, eyebrows, scars. **Don't** use on: precise silhouettes (head circle, torso rect) — those should stay clean.

### `rimLight` modifier on closed shapes

Optional field on `rect / roundedRect / circle / ellipse / polygon`. Draws a soft directional highlight along the silhouette edge, separating the shape from its background.

```json
{
  "kind": "polygon", "points": [...],
  "fill": {"palette": "body"},
  "stroke": "rgba(26,22,18,0.85)", "lineWidth": 1.6,
  "rimLight": { "color": "rgba(255,232,180,0.72)", "fromAngle": -2.1, "width": 2.2, "falloff": 0.45 }
}
```

Use on: character body / cape silhouette (warm rim from upper-left if the implied sun is upper-left), tree crowns in mid-distance (cool sky bounce rim), prop highlights.

`fromAngle` in radians; `-2.1` ≈ upper-left, `-PI/2` = directly above, `0` = screen-right. `falloff` 0..1; 0.3 = sharp rim, 0.7 = soft wrap.

### `blurPx` on `transform` — depth of field

Wrap a sub-tree in a transform with `blurPx`:

```json
{ "kind": "transform", "blurPx": 1.4, "children": [ ...background trees... ] }
```

Apply 1–2 px blur to background layer + 0.5 px to foreground occluder. Brings mid-ground character into focus — instant DoF read.

### Project-level grade (postFX)

`project.config.postFX` controls the global LUT applied to every frame by PreviewCanvas:

```json
"postFX": {
  "saturate": 0.94, "contrast": 1.06,
  "sepia": 0.03, "vignette": 0.28, "noiseAlpha": 0.07
}
```

The defaults shown above are applied automatically when `postFX` is undefined — they give a tasteful painterly grade without configuration. Set `"enabled": false` to disable for authoring/debug.

## Particles primitive

The shape DSL now includes `kind: "particles"` for emitting up to 500 deterministic particles in one declaration. Use it for fire, snow, sparkles, debris, blossoms.

```json
{
  "kind": "particles",
  "count": 40,
  "cx": "cos(seed * 0.6 + time * 2) * 80",
  "cy": "-30 + seed * 2 + sin(seed * 0.4 + time) * 4",
  "r":  "2 + (seed % 4)",
  "fill": "rgba(255, 200, 80, ${0.7 - progress * 0.5})",
  "particleShape": "spark"
}
```

Available state inside particle expressions: everything that's in the shape state PLUS `seed` and `i` (alias) = particle index 0..count-1.

`particleShape`: `"circle"` (default), `"rect"`, `"spark"` (4-spike asterisk).

Effects with > 8 particles should always include a radial halo behind them — particles alone read flat.

## Style bars (opt-in per project)

A project may set `project.config.styleBar = "luoxiaohei"` (or other named bars in the future). When the bar is active, the asset MUST also pass the extra rules listed in [docs/acceptance-luoxiaohei.md](../../../docs/acceptance-luoxiaohei.md).

Quick TL;DR for **罗小黑战记** characters:

| Rule | What it means concretely |
|---|---|
| LX-C1 | Palette has **3–6** colors — no jewel-toned 12-color spreads |
| LX-C2 | Outlines are uniform **1.2–1.8 px** — no thick-thin variation |
| LX-C3 | **Cel-shading**: ≥ 2 crisp shadow polygons with flat dark-alpha fill (rgba(20,18,16,0.3) family). NOT continuous body gradients |
| LX-C4 | Eyes are **simple black pupils** on white sclera — no 3-stop iris radial gradients |
| LX-C5 | Head/height ratio in **[0.18, 0.30]** — slightly chibi |
| LX-C6 | **Both cheeks** carry pink warmth ellipses (rgba pink ~0.3 alpha) |

For 罗小黑 SCENES:

| Rule | What it means |
|---|---|
| LX-S1 | Atmospheric haze rect over the bg (rgba cool/warm soft alpha) |
| LX-S2 | At least one watercolor-style gradient (linear, ≥3 stops, ≥1 with alpha) — gives painterly depth |
| LX-S3 | Foreground has an **occluder** (branch / leaf / doorframe) framing the action |
| LX-S5 | Parallax bg ≤ **0.55**, fg ≥ **1.2** — stronger separation than the baseline 2.5D bar |

Validation: `npm run lint:luoxiaohei` checks the asset library against these rules. The lint exits non-zero if any LX-* rule fires; treat that as a rejection.

When the user **doesn't** specify a style bar, the baseline 2.5D rules above apply and the LX-* rules are skipped.

## 2.5D rules (mandatory for visual procedural assets)

These rules turn a flat manifest into a depth-readable 2.5D asset. The engine renderer respects them automatically once they appear in `shape`.

### Characters must include the lighting trio

1. **Body lighting gradient** — at least one linear OR radial gradient overlay on the torso (in addition to the palette base color).
2. **Face radial highlight** — a radial gradient on the head circle whose focus point sits in the upper-left quadrant.
3. **Contact shadow that follows `z`** — an ellipse below the feet whose `rx`/`ry` shrink with the `z` state variable, e.g. `"92 * (1 - clamp(z * 0.0008, 0, 0.35))"`.

### Characters MUST be generated through the shape builder script

Hand-writing 150 primitives for every character is how AI-generated assets degenerate into Flash-style stacked rectangles. Instead, **always invoke the shape builder script** to generate `metadata.shape`:

```bash
echo '{
  "palette": { "body": "#c14a3a", "skin": "#f0bf95", "hair": "#1f1610", "pants": "#3b6090" },
  "hairStyle": "fringe",
  "hat": "straw",
  "hatColor": "#e8c97a",
  "hatBandColor": "#c14a3a",
  "costume": "vest",
  "shorts": true,
  "eyeStyle": "almond",
  "facialMarks": [{ "kind": "scar_diagonal", "at": "under_left_eye" }],
  "chestEmblem": { "color": "#fff8e0" }
}' | npx tsx scripts/build-character-shape.ts > /tmp/shape.json
```

Then embed the resulting JSON as `metadata.shape` in your manifest. The script guarantees ~150 primitives of consistent cel-shading quality: almond eyes with iris radial gradient + double highlight, ~6 polygon hair wisps with crown highlight, anatomically subtle nose (one shading line + nostril dots), thin curved-polygon eyebrows that switch shape per expression, neck occlusion shadow, cheek hue-shift, sleeve cuffs with shadow, optional hat with brim shadow on forehead, optional facial scars/marks, all 5 actions (idle/walking/attack/defend/victory) wired with `when` branches.

#### CharacterSpec schema

```ts
{
  hairStyle?: "short" | "fringe" | "spiky" | "flowing" | "bald",
  hat?:      "none" | "straw" | "cap" | "beret" | "headband",
  hatColor?: string,       // CSS hex
  hatBandColor?: string,   // CSS hex (only for straw hat ribbon)
  costume?:  "jacket" | "vest" | "robe" | "shirt" | "tank",
  shorts?:   boolean,      // true = shorts, false = full pants
  eyeStyle?: "round" | "almond" | "narrow",
  facialMarks?: [
    { kind: "scar_diagonal"|"scar_x"|"mark_dot"|"mole",
      at:   "left_cheek"|"right_cheek"|"forehead"|"under_left_eye"|"under_right_eye",
      color?: string }
  ],
  chestEmblem?: { color: string }
}
```

#### When to use `--emit manifest`

If the user only wants the shape (your usual case — you wrap it yourself in a manifest with the right tags / references / license), use the default `--emit shape`.

If you want the whole AssetManifest in one shot:

```bash
npx tsx scripts/build-character-shape.ts --emit manifest --spec '{
  "assetId": "character_chef_001",
  "name": "厨师小李",
  "displayName": "小李",
  "palette": { "body": "#f5e7d4", "skin": "#f0b985", "hair": "#1a120a", "pants": "#2a2018" },
  "hairStyle": "short",
  "costume": "shirt",
  "hat": "none",
  "references": [{ "sourceType": "web", "source": "https://...", "note": "chef apron reference" }]
}'
```

then `Read` the output, parse, optionally edit a few fields, emit.

#### When NOT to use the script

- The user is generating a **non-human** character (animal, robot, abstract) → fall back to writing primitives by hand following the recipes in [references/procedural-shape.md](references/procedural-shape.md).
- The user wants very specific costume geometry the spec doesn't cover (kimono, samurai armor, lab coat with pockets) → use the script for the base body, then `Read` the shape JSON, deserialize, append your costume primitives to `primitives[]`, re-serialize.

#### Acceptance bar (the script handles all of these automatically)

1. **Outline strokes** on torso + limbs + head silhouette
2. **Hair locks** — 5–6 polygon wisps with curved tips
3. **Facial features** — almond eye polygon, iris radial gradient, double highlight, curved-polygon eyebrows, minimal nose (shading line + nostril dots), upper-lip polygon with corner shadows
4. **Clothing detail** — V-lapels with gradient, 3 button circles, belt with buckle (when costume = jacket/vest), shoulder occlusion shadow
5. **Shoes** — rounded-toe polygon + top sheen ellipse + heel shadow
6. Optional **hat** with brim shadow projected on forehead
7. Optional **facial marks** (scars, moles, dots)
8. All 5 actions (idle/walking/attack/defend/victory)
9. z-aware contact shadow

Targets ~150 primitives total. Anything under 80 with the script means something went wrong — re-run.

### Characters must support at least 4 actions

Every character shape MUST gate parts of its body on `action` so the timeline can pose it. Required minimum action set:

- `idle` (default, includes subtle `sin(time)` breathing)
- `walking` (limbs swing with `sin(time * 8) * 0.5` around the hip pivot)
- One of `attack` / `punch` / `swing` (right arm thrust forward)
- One of `defend` / `block` (arms crossed at the chest)

Optional but recommended: `victory`, `cheer`, `sit`, `kneel`.

Use the procedural-shape DSL: each action has its own `when: "action == xxx"` branch wrapping a `transform` with the desired pose. The same arm primitives can be re-used in 4–5 branches without duplicating geometry — just change the `translate` and `rotate`.

Declare the supported set in `metadata.actions: string[]` so the AssetPreviewStage shows the right buttons.

A character manifest missing any of the three rule sets (lighting trio + cel-shading detail set + ≥ 4 actions) is **not viable** and should be re-authored before emitting.

### Scenes must split into three layers + parallax

`shape.layers.background`, `shape.layers.midground`, `shape.layers.foreground` are all required (each a non-empty primitive list), AND `shape.parallax` must be supplied for at least the two non-default layers.

- **background**: distant wall / sky / haze / framed pictures — slow parallax (default 0.45–0.55).
- **midground**: main furniture + structural elements — full-camera parallax (1.0).
- **foreground**: items that should **occlude characters** as the camera pans — fast parallax (default 1.2–1.4).

Background rects should overshoot the canvas: use `x = -200, w = 1680` so the parallax pan doesn't reveal empty edges.

The background layer should contain at least one atmospheric haze rect (cool-tone translucent gradient) — this is the cheapest depth cue.

### Props should sell volume

At least one of: linear/radial gradient highlight, OR a `shadow` modifier on the main rect, OR a small contact-shadow ellipse below.

### Effects should glow

Effects that fade in/out should pair a radial-gradient halo behind the main spikes — center-bright, edge-transparent — driven by `${1 - progress}` alpha.

See [references/procedural-shape.md](references/procedural-shape.md) for the exact recipes. The pre-flight validation checklist at the bottom of that file is the final gate before emitting the manifest.

## Procedural shape (visual assets)

For procedural visual assets, populate `metadata.shape` with a list of declarative primitives that the front-end renders via its shape interpreter. This is the **only** way the asset becomes visible — there is no code path that draws a procedural asset without a shape.

See [references/procedural-shape.md](references/procedural-shape.md) for primitives, color specs (incl. gradients + palette refs), the numeric expression mini-language (`progress * PI`, `cos(angle) * r`, …), and conditional `when` clauses.

## Workflow

1. **Clarify only if necessary.** From the user prompt infer: type, scope, category, style. Only ask back if a required field is genuinely ambiguous.
2. **De-dup.** `curl -sS "$CUCUMBER_API_BASE/assets?type=<type>" | jq -r '.assets[].assetId'` and pick an unused id.
3. **Visual reference research (REQUIRED for character / scene / prop / background / foreground).** See "Reference research" below.
4. **Inspect provided reference images.** When the user has uploaded local images, paths arrive via `metadata.referenceImagePaths[]` (relative to repo root). `Read` them — Claude's vision capability extracts palette, silhouette, posture. **Treat user-uploaded images as the authoritative reference**, web search is the fallback.
5. **License check on external assets.** If the manifest references external files (downloaded sprites, BGM), use `WebFetch` to verify license terms before recording the URL. If unclear, set `commercialUse:false, needAttribution:true`, add `metadata.licenseNote`.
6. **Compose the manifest.** For visual procedural assets, author `metadata.shape` from the primitives in [references/procedural-shape.md](references/procedural-shape.md). The shape MUST faithfully mirror the reference's defining features (silhouette, palette, signature accessories, posture) — generic stand-ins are rejected.
7. **For characters: decide on view set.** Default to `front + sideLeft + sideRight` (3 views) for any character with on-screen dialogue / movement. Use the `--emit bundle` script path so palette + accessories carry over automatically.
8. **Run the required-elements pre-emit gate** (see "Required elements" above). Walk through the checklist for the asset's type. If anything is missing — a one-armed character, a scene with no foreground, a prop with no shadow — re-author. Do not emit a manifest with TODO holes.
9. **Optional: run the lint locally.** `npx tsx scripts/lint-2_5d.ts` will catch most missing-element cases. Useful when authoring a new character — but **NOT a replacement** for the manual checklist above (lint heuristics catch ~80% of the gaps; the other 20% need eyes on the manifest).
10. **Emit final line.** Print exactly one trailing line of JSON in the format described in **Output format** above. Nothing after it. The frontend slurps the last `{...}` JSON object from your output.

## Reference research

A character / scene / prop manifest WITHOUT reference imagery in the workflow reads as generic. Before authoring the shape, you MUST do one of:

### Option A — User-provided images

If `metadata.referenceImagePaths` is populated in the input, `Read` each path (they are local files). Build a feature spec:

```
References:
  /tmp/asset_imports/iori_back_pose.png:
    silhouette  : tall, narrow torso, slight back-arch, looking over shoulder
    palette     : black jacket #1f1814, white inner shirt #f1ece4,
                  fiery red hair #d33a17, orange pants #ef6d2c,
                  black shoes #1a1612, gold belt buckle #d9b46b
    landmarks   : white circle emblem on right shoulder, leather belt with
                  dangling strap, sharp spiky hair tips, cuffed sleeves
    signature   : pointing-back gesture with left hand, right hand at hip
    posture     : standing back-to-camera, weight on left foot
  /tmp/asset_imports/iori_front_attack.png:
    posture     : right-arm forward thrust, left arm tucked at chest
    expression  : narrow eyes, mouth set
    new info    : confirmed front-view hair has spiky bangs over right eye
```

### Option B — Web search

When the user only described the asset in text, search the web:

1. `WebSearch "<subject> character key visual reference"` — pick 1–3 stable URLs (artstation, fandom wiki, official site)
2. `WebFetch <url>` — read the page description / alt text for visible features
3. Build the feature spec described in option A from textual description

### Recording references in the manifest

Add `metadata.references: { source: string; note: string; sourceType: "user-upload" | "web" }[]`:

```json
"metadata": {
  "references": [
    { "sourceType": "user-upload", "source": "iori_back_pose.png", "note": "back-pose, palette + silhouette source" },
    { "sourceType": "web",          "source": "https://kof.fandom.com/wiki/Iori_Yagami", "note": "front view confirmation + signature gestures" }
  ],
  ...
}
```

**Copyright rule.** Do not embed binary image data in the manifest. The references field stores URLs / filenames only — they're for attribution and let a reviewer trace what the AI looked at. The shape itself is your original interpretation; if the reference is copyrighted, deliberately re-stylize (different proportions, different secondary palette) rather than tracing.

## Open-format conversion

When the user wants to import an asset that's already in a standard 2D format, the engine has two paths:

1. **Programmatic** (preferred when supported): the frontend ships a converter that emits a manifest directly without an AI round-trip. Currently shipped:
   - **Spine JSON** — `src/importers/spineImporter.ts`. Parses bones, slots, region attachments, and animation names. Skin colors come from `slots[].color`, geometry from region attachments. Animation names become `metadata.actions` entries; default pose becomes `idle`.
2. **AI conversion** (you do this when the user uploads a format the engine doesn't know): the user passes the file as a `metadata.sourceFile` path; you `Read` it, parse the JSON, and translate to a procedural shape.

### Recipes for common open formats

| Format | What to map | How |
|---|---|---|
| **Spine JSON** | `bones[]` → coordinate hierarchy<br/>`slots[].color` → palette / fill<br/>`skins.default.attachments` → region rects / polygons<br/>`animations` keys → `metadata.actions[]` | See spineImporter.ts for the canonical mapping. Each region attachment becomes a `transform`-wrapped `roundedRect` at the bone's world position. |
| **DragonBones JSON** | `armature[].bone[]`, `armature[].slot[]`, `armature[].skin[].slot[].display[]` | Same shape as Spine; `display[].type == "image"` → rect, `mesh` → polygon. |
| **Lottie JSON (Bodymovin)** | `layers[].shapes[]` → procedural primitives directly | Lottie shape `ty: "rc"` → roundedRect, `el` → ellipse, `sr` → starBurst, `gf` → gradient fill. Map `ks.p` → translate, `ks.r` → rotate, `ks.s` → scale, drive with `time` expression. |
| **Tiled TMX / JSON** | scene `layers[]` → `ProceduralShape.layers.{background,midground,foreground}` | Each Tiled image layer → a `rect` of that image's palette-extracted color. Object layers → individual props. Pick parallax factors from Tiled `parallaxx` / `parallaxy` properties. |
| **Aseprite JSON sheet** | `frames` + `meta.frameTags` | Each frame tag becomes an action; geometry is a single `rect` with `fill` = average color (placeholder). Better path: read the PNG, run palette extraction, build polygons matching frame contents. |

After conversion always set:

```json
"source": { "kind": "imported", "format": "spine-json" | "lottie-json" | "tiled-json" | "aseprite-json", "originalFile": "<filename>" }
```

so the UI shows the provenance.

## Hard rules

- **Never POST to `/api/assets`.** Registration happens in the UI after the user confirms.
- Never write to `src/data/*.json`, `data/cucumber.db`, or `public/assets/`.
- Never invent license terms. If a source's license page wasn't actually read, default to non-commercial.
- Never include API keys, OAuth tokens, or shell environment dumps in the manifest, the description, or any logged output.
- Visual procedural assets without a `metadata.shape` array are not viable — re-run shape authoring if you omitted it.

## Examples

### Procedural 2.5D character (cel-shading bar)

The example below is **abridged**. A real submission must hit ~100 primitives — outlines on every silhouette, ≥ 4 hair locks, nose/lip/jaw polygons, sleeve cuffs, ≥ 4 `action` branches. See `src/data/characterShapes.ts:buildHumanCharacterShape` for a complete reference (you can model your output on its structure).

```json
{
  "ok": true,
  "manifest": {
    "assetId": "character_chef_001",
    "name": "厨师小李",
    "category": "visual",
    "type": "character",
    "scope": "project",
    "source": { "kind": "generated", "format": "procedural", "originalFile": "built-in" },
    "files": { "preview": "procedural://character_chef_001" },
    "tags": ["chef","adult","apron"],
    "metadata": {
      "width": 240, "height": 520,
      "anchor": {"x":120,"y":500},
      "palette": {"body":"#ffffff","skin":"#f0b985","hair":"#222","accent":"#c0392b"},
      "parts": ["body","face","hair","expression","costume","voice"],
      "displayName": "小李",
      "shape": { "primitives": [
        { "kind": "ellipse", "cx": 0, "cy": 14,
          "rx": "92 * (1 - clamp(z * 0.0008, 0, 0.35))",
          "ry": "25 * (1 - clamp(z * 0.0008, 0, 0.35))",
          "fill": { "gradient": "radial",
            "x0": 0, "y0": 14, "r0": 0, "x1": 0, "y1": 14, "r1": 92,
            "stops": [
              { "at": 0,    "color": "rgba(20,18,16,${0.34 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
              { "at": 0.72, "color": "rgba(20,18,16,${0.16 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
              { "at": 1,    "color": "rgba(20,18,16,0)" }
            ] } },
        { "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38, "fill": { "palette": "body" } },
        { "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38,
          "fill": { "gradient": "linear", "x0": -58, "y0": -245, "x1": 58, "y1": -40,
            "stops": [
              { "at": 0,    "color": "rgba(255,255,255,0.2)" },
              { "at": 0.45, "color": "rgba(255,255,255,0)" },
              { "at": 1,    "color": "rgba(0,0,0,0.24)" }
            ] } },
        { "kind": "circle", "cx": 0, "cy": -310, "r": 70, "fill": { "palette": "skin" } },
        { "kind": "circle", "cx": 0, "cy": -310, "r": 70,
          "fill": { "gradient": "radial",
            "x0": -22, "y0": -334, "r0": 4, "x1": 0, "y1": -310, "r1": 70,
            "stops": [
              { "at": 0,    "color": "rgba(255,246,230,0.55)" },
              { "at": 0.55, "color": "rgba(255,246,230,0)" },
              { "at": 1,    "color": "rgba(40,22,14,0.22)" }
            ] } },
        { "kind": "rect", "x": -68, "y": -345, "w": 136, "h": 28, "fill": { "palette": "hair" } },
        { "kind": "text", "x": 0, "y": -372, "text": "${name}", "fill": "#243033", "size": 22, "align": "center" }
      ] }
    },
    "license": { "type":"internal-generated","author":"Cucumber Engine","sourceUrl":"","commercialUse":true,"needAttribution":false }
  }
}
```

### Procedural 2.5D scene

Three-layer split with parallax map. Background rects overshoot the canvas (`x: -200, w: 1680`) so pan never reveals empty space. Foreground contains an occluder.

```json
{
  "ok": true,
  "manifest": {
    "assetId": "scene_kitchen_001",
    "name": "清晨厨房",
    "category": "visual",
    "type": "scene",
    "scope": "project",
    "source": { "kind": "generated", "format": "procedural", "originalFile": "built-in" },
    "files": { "preview": "procedural://scene_kitchen_001" },
    "tags": ["kitchen","morning","interior"],
    "metadata": {
      "width": 1280, "height": 720,
      "layers": ["background","midground","foreground"],
      "shape": {
        "preview": { "fit": "contain" },
        "parallax": { "background": 0.45, "midground": 1, "foreground": 1.28 },
        "primitives": [],
        "layers": {
          "background": [
            { "kind": "rect", "x": -200, "y": 0, "w": 1680, "h": 720,
              "fill": { "gradient": "linear", "x0": 0, "y0": 0, "x1": 0, "y1": 720,
                "stops": [
                  { "at": 0,    "color": "#fbe5c4" },
                  { "at": 0.55, "color": "#e6c994" },
                  { "at": 0.56, "color": "#7a5a3e" },
                  { "at": 1,    "color": "#4e3725" }
                ] } },
            { "kind": "rect", "x": -200, "y": 0, "w": 1680, "h": 240,
              "fill": { "gradient": "linear", "x0": 0, "y0": 0, "x1": 0, "y1": 240,
                "stops": [
                  { "at": 0, "color": "rgba(200,210,220,0.45)" },
                  { "at": 1, "color": "rgba(200,210,220,0)" }
                ] } }
          ],
          "midground": [
            { "kind": "roundedRect", "x": 280, "y": 380, "w": 720, "h": 160, "r": 14, "fill": "#bf8d5c",
              "shadow": { "blur": 18, "offsetY": 8, "color": "rgba(20,12,8,0.32)" } },
            { "kind": "roundedRect", "x": 280, "y": 380, "w": 720, "h": 160, "r": 14,
              "fill": { "gradient": "linear", "x0": 280, "y0": 380, "x1": 1000, "y1": 540,
                "stops": [
                  { "at": 0, "color": "rgba(255,235,200,0.22)" },
                  { "at": 1, "color": "rgba(0,0,0,0.28)" }
                ] } }
          ],
          "foreground": [
            { "kind": "rect", "x": -100, "y": 684, "w": 1480, "h": 36,
              "fill": { "gradient": "linear", "x0": 0, "y0": 684, "x1": 0, "y1": 720,
                "stops": [
                  { "at": 0, "color": "rgba(30,42,42,0.28)" },
                  { "at": 1, "color": "rgba(30,42,42,0)" }
                ] } }
          ]
        }
      }
    },
    "license": { "type":"internal-generated","author":"Cucumber Engine","sourceUrl":"","commercialUse":true,"needAttribution":false }
  }
}
```

### Procedural effect (uses `progress`)

```json
{
  "ok": true,
  "manifest": {
    "assetId": "effect_spark_001",
    "name": "金色火花",
    "category": "visual",
    "type": "effect",
    "scope": "global",
    "source": { "kind": "generated", "format": "procedural", "originalFile": "built-in" },
    "files": { "preview": "procedural://effect_spark_001" },
    "tags": ["effect","spark","positive"],
    "metadata": {
      "blendMode": "screen",
      "defaultDuration": 0.6,
      "shape": { "primitives": [
        { "kind": "starBurst", "cx": 0, "cy": 0, "spikes": 10,
          "outer": "60 + progress * 60", "inner": 22,
          "rotation": "progress * PI",
          "fill": "rgba(255, 213, 88, ${1 - progress})",
          "stroke": "rgba(255, 165, 60, ${1 - progress})",
          "lineWidth": 6 }
      ] }
    },
    "license": { "type":"internal-generated","author":"Cucumber Engine","sourceUrl":"","commercialUse":true,"needAttribution":false }
  }
}
```

### Referenced BGM (metadata-only, no shape)

```json
{
  "ok": true,
  "manifest": {
    "assetId": "bgm_calm_morning_001",
    "name": "Calm Morning",
    "category": "audio",
    "type": "bgm",
    "scope": "project",
    "source": { "kind": "referenced", "format": "mp3", "originalFile": "https://...source-page..." },
    "files": { "sourceUrl": "https://...source-page..." },
    "tags": ["calm","morning","piano"],
    "metadata": { "durationSec": 120, "loop": true, "bpm": 72 },
    "license": { "type":"CC-BY 4.0","author":"<creator>","sourceUrl":"<license page>","commercialUse":true,"needAttribution":true }
  }
}
```
