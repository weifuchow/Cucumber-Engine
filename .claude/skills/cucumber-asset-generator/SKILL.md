---
name: cucumber-asset-generator
description: Generate and register Cucumber Engine assets (characters, scenes, props, effects, BGM, sound effects) into the project's SQLite-backed asset library through the local backend REST API. Use whenever the user asks to "AI-generate an asset", "add a character / scene / prop / BGM", or to enrich the asset library from a textual description. Covers research, manifest authoring, optional file fetching, and HTTP registration. Replaces the older JSON-file-only cucumber-asset-research workflow when a backend is available.
---

# Cucumber Asset Generator

## Architecture (read first)

This project has a Node + SQLite backend. The canonical asset store is SQLite, accessed through a REST API. **Never** write directly to `src/data/*.json` or to the database file — always go through the API so the backend can validate and broadcast updates.

Backend base URL is provided in environment variable `CUCUMBER_API_BASE` (default `http://localhost:3001/api`).

Endpoints used by this skill:

| Verb | Path | Purpose |
|---|---|---|
| GET  | `/assets` | list current assets (avoid duplicate IDs) |
| GET  | `/assets/:id` | check existence |
| POST | `/assets` | upsert an AssetManifest (body = AssetManifest JSON) |

## Manifest schema

Mirror `src/types/schema.ts`. Every registered asset MUST include:

```json
{
  "assetId":  "<stable_kebab_or_snake_id>",
  "name":     "<human readable>",
  "category": "visual" | "audio",
  "type":     "character" | "scene" | "prop" | "expression" | "action" | "effect" | "foreground" | "background" | "cameraTemplate" | "sceneElement" | "bgm" | "dialogue" | "narration" | "soundEffect" | "environment",
  "scope":    "global" | "project",
  "source":   { "kind": "imported" | "generated" | "manual" | "referenced", "format": "<png|svg|wav|mp3|procedural|...>", "originalFile": "<filename or url>" },
  "files":    { "<key>": "<url or local path>" },
  "tags":     ["..."],
  "metadata": { /* type-specific, see below */ },
  "license":  { "type": "...", "author": "...", "sourceUrl": "...", "commercialUse": true|false, "needAttribution": true|false }
}
```

`assetId` rules:
- Stable, lowercase, ASCII, `<type>_<descriptor>_<3digit>` convention (e.g. `character_chef_007`, `bgm_calm_morning_002`).
- Check `GET /assets/:id` before choosing — bump the suffix if taken.

`metadata` by type:
- character: `{ "width": int, "height": int, "anchor": {"x":int,"y":int}, "palette": {...}, "parts": ["body","face","hair","expression","costume","voice"] }`
- scene/background/foreground: `{ "width": int, "height": int }`
- prop: `{ "width": int, "height": int }`
- effect: `{ "blendMode": "screen"|"add"|"multiply"|"normal", "defaultDuration": number }`
- bgm/soundEffect: `{ "durationSec": number, "loop": bool, "bpm": int? }`

## Workflow

1. **Clarify only if necessary.** From the user prompt infer: type, scope, category, style, count. Only ask back if a required field is genuinely ambiguous.
2. **De-dup.** `curl -sS "$CUCUMBER_API_BASE/assets?type=<type>" | jq -r '.assets[].assetId'` and avoid collisions.
3. **Source material.**
   - Visual generated assets: prefer `procedural://<id>` placeholder when no real file is fetched; the engine renders procedurals.
   - Real files: only fetch from sources with clear commercial-use license (Kenney, OpenGameArt, Wikimedia Commons, itch.io with explicit terms, Freesound). Use `WebFetch`/`WebSearch` to verify license **before** including the URL.
   - If license is unclear, set `commercialUse: false`, `needAttribution: true`, and add `metadata.licenseNote` describing the uncertainty.
4. **Compose the manifest** as JSON adhering to the schema above.
5. **Register via API.** Save the manifest to a temp file, then POST:

   ```bash
   MANIFEST=$(mktemp /tmp/cucumber-manifest.XXXXXX.json)
   cat > "$MANIFEST" <<'JSON'
   { ... your manifest ... }
   JSON
   curl -sS -X POST "$CUCUMBER_API_BASE/assets" \
        -H 'content-type: application/json' \
        --data-binary "@$MANIFEST"
   ```

   The response is the saved manifest (HTTP 201). Treat anything else as failure.
6. **Verify.** `curl -sS "$CUCUMBER_API_BASE/assets/<assetId>"` and confirm round-trip.
7. **Final output.** Print a single trailing JSON line — the runner parses it:
   ```json
   {"ok": true, "assetId": "<id>", "name": "<name>"}
   ```
   or on failure:
   ```json
   {"ok": false, "error": "<short reason>"}
   ```

## Hard rules

- Never write to `src/data/*.json`, `data/cucumber.db`, or any file under `public/assets/` unless the user explicitly asks for a local file copy AND license permits it.
- Never invent license terms. If a source's license page wasn't actually read, default to non-commercial.
- Never register multiple assets per run unless the user explicitly asked for a batch.
- Never include API keys, OAuth tokens, or shell environment dumps in the manifest, the description, or any logged output.

## Examples

**Generate a character procedurally**

```json
{
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
    "parts": ["body","face","hair","expression","costume","voice"]
  },
  "license": { "type":"internal-generated","author":"Cucumber Engine","sourceUrl":"","commercialUse":true,"needAttribution":false }
}
```

**Register a referenced BGM (metadata-only)**

```json
{
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
```
