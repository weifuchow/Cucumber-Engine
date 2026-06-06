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
- **character**: also `width:int, height:int, anchor:{x,y}, palette:{body,skin,hair,...}, parts:[...]`, optional `displayName:string` (overrides head-badge text).
- **scene / background / foreground**: also `width:int, height:int`.
- **prop**: also `width:int, height:int`.
- **effect**: also `blendMode:"screen|add|multiply|normal", defaultDuration:number`. The shape may reference `progress` (0 → 1 over `defaultDuration`).
- **bgm / soundEffect**: `durationSec:number, loop:bool, bpm:int?` — no shape (audio).

## Procedural shape (visual assets)

For procedural visual assets, populate `metadata.shape` with a list of declarative primitives that the front-end renders via its shape interpreter. This is the **only** way the asset becomes visible — there is no code path that draws a procedural asset without a shape.

See [references/procedural-shape.md](references/procedural-shape.md) for primitives, color specs (incl. gradients + palette refs), the numeric expression mini-language (`progress * PI`, `cos(angle) * r`, …), and conditional `when` clauses.

## Workflow

1. **Clarify only if necessary.** From the user prompt infer: type, scope, category, style. Only ask back if a required field is genuinely ambiguous.
2. **De-dup.** `curl -sS "$CUCUMBER_API_BASE/assets?type=<type>" | jq -r '.assets[].assetId'` and pick an unused id.
3. **Research sources** (only if the asset references external files). Use `WebFetch`/`WebSearch` to verify license terms **before** including the URL. If license is unclear, set `commercialUse:false, needAttribution:true`, and add `metadata.licenseNote`.
4. **Compose the manifest.** For visual procedural assets, author `metadata.shape` from the primitives in [references/procedural-shape.md](references/procedural-shape.md). Start from an example shape that matches the asset type (character → body+head+face; prop → simple rounded rects; effect → starBurst with `progress`-driven radius/rotation/alpha; scene → background gradient + furniture rects).
5. **Emit final line.** Print exactly one trailing line of JSON in the format described in **Output format** above. Nothing after it. The frontend slurps the last `{...}` JSON object from your output.

## Hard rules

- **Never POST to `/api/assets`.** Registration happens in the UI after the user confirms.
- Never write to `src/data/*.json`, `data/cucumber.db`, or `public/assets/`.
- Never invent license terms. If a source's license page wasn't actually read, default to non-commercial.
- Never include API keys, OAuth tokens, or shell environment dumps in the manifest, the description, or any logged output.
- Visual procedural assets without a `metadata.shape` array are not viable — re-run shape authoring if you omitted it.

## Examples

### Procedural character

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
        { "kind": "ellipse", "cx": 0, "cy": 14, "rx": 92, "ry": 25, "fill": "rgba(25,24,22,0.18)" },
        { "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38, "fill": { "palette": "body" } },
        { "kind": "circle", "cx": 0, "cy": -310, "r": 70, "fill": { "palette": "skin" } },
        { "kind": "rect", "x": -68, "y": -345, "w": 136, "h": 28, "fill": { "palette": "hair" } },
        { "kind": "text", "x": 0, "y": -372, "text": "${name}", "fill": "#243033", "size": 22, "align": "center" }
      ] }
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
