---
name: cucumber-spine-fetcher
description: Fetch a Spine 2D skeletal-animation JSON asset from a URL or known public source, validate it, and convert it into a Cucumber Engine AssetManifest so the UI can preview it. Use whenever the user says "import a Spine asset from the web", "fetch this Spineboy", "grab a Spine JSON from <URL>", or otherwise wants to pull a Spine-format character into the asset library without manually downloading the file first. The skill researches sources, verifies licenses, downloads JSON (+ optional atlas / PNG companions), runs the project's spineImporter, and emits a manifest — the front-end is responsible for the final POST that registers the asset.
---

# Cucumber Spine Fetcher

## What this skill is for

The Cucumber Engine already has a Spine 4.x JSON importer (`src/importers/spineImporter.ts`) that the front-end calls when a user drops a `.json` file onto the upload button. This skill handles the upstream half: **going to the web, finding / fetching a Spine JSON, and running the importer** so the user gets a ready-to-preview AssetManifest from a single prompt like "import the Spineboy example".

Use this skill — not `cucumber-asset-generator` — when the source is an **existing Spine export**, not a procedural shape the user wants you to design.

## Authoring contract (read first)

This skill **does NOT register the asset.** It returns a fully-formed AssetManifest as JSON. The Cucumber Engine UI takes that JSON, renders a preview, and lets the user confirm or discard before any DB write happens.

That means:

- **Never** POST to `/api/assets`.
- **Never** write into `data/cucumber.db`, `src/data/*.json`, or `public/assets/`.
- Downloaded files land in `data/spine-imports/<assetId>/`. That directory is the staging area — the engine reads from it for preview but the user owns the eventual disposition (commit / discard) from the UI.

## Output format (strict)

End your run with exactly one trailing line of pure JSON:

```json
{"ok": true, "manifest": { ...full AssetManifest... }}
```

…or, on a recoverable failure (download blocked, license unverifiable, URL doesn't actually serve Spine JSON):

```json
{"ok": false, "error": "<short reason>"}
```

The `manifest` field must be the complete object that would round-trip through the API. No extra wrapping, no markdown fences in the final line. The frontend slurps the last `{...}` JSON object from your output.

## Workflow

### 1. Resolve the source

The user prompt arrives in one of three shapes. Detect which and act:

| Input shape | Action |
|---|---|
| Direct URL to a `.json` file (`https://.../spineboy.json`) | Use it directly. |
| GitHub blob URL (`https://github.com/.../blob/.../spineboy-ess.json`) | Rewrite to `https://raw.githubusercontent.com/.../spineboy-ess.json`. |
| Page URL or repo URL | `WebFetch` it; look for `<a href="...json">` links to the Spine JSON. Prefer files whose name ends in `-ess.json`, `-pro.json`, or just `<name>.json`. |
| Just a name ("Spineboy", "Raptor", "Goblins") | See [references/known-sources.md](references/known-sources.md) for the canonical URLs from `EsotericSoftware/spine-runtimes`. |
| Vague description ("a free spine asset of a knight") | `WebSearch` for `<description> "spine" json site:github.com OR site:itch.io`. Confirm with the user before downloading non-curated sources. |

### 2. License check (REQUIRED before download)

Spine assets are almost never CC0. Most of the canonical examples are under the **Spine Examples License**: free for evaluation / education / non-commercial use, **not** for commercial games. Refer to [references/known-sources.md](references/known-sources.md) for the license terms of every named asset listed there.

For unknown sources, `WebFetch` the repo's `LICENSE` / `README` and the file's containing folder. If license terms cannot be verified, default to:

```json
"license": { "type": "unknown", "author": "", "sourceUrl": "<url>", "commercialUse": false, "needAttribution": true }
```

and add `metadata.licenseNote` explaining what you couldn't verify.

### 3. Download

```bash
ASSET_ID="character_spineboy_$(date +%s | tail -c 4)"
DEST="data/spine-imports/$ASSET_ID"
mkdir -p "$DEST"
curl -fsSL "<json-url>"  -o "$DEST/skeleton.json"

# Optional companions — fetch if the URL has obvious siblings, ignore 404s.
curl -fsSL "<atlas-url>" -o "$DEST/skeleton.atlas" || rm -f "$DEST/skeleton.atlas"
curl -fsSL "<png-url>"   -o "$DEST/skeleton.png"   || rm -f "$DEST/skeleton.png"
```

Rules:

- `curl -fsSL` is mandatory: `-f` fails on HTTP errors, `-L` follows redirects, `-s` quiets progress, `-S` keeps errors.
- If the JSON download fails, emit `{"ok": false, "error": "..."}` and stop. Don't fall back to an unrelated asset.
- Companion atlas / PNG are optional — the engine's importer ignores them today (it only reads geometry from the JSON), but having them on disk lets a future version paint textures.

### 4. Validate

Read the first ~200 chars and confirm it's actually Spine JSON. The minimum shape is `{"skeleton":{...}, "bones":[...], ...}`. Reject if you see Lottie (`{"v":"5.x", "layers":...}`), DragonBones (`{"name":"...", "armature":...}`), or generic JSON.

```bash
node -e "const j = require('./$DEST/skeleton.json'); if (!j.skeleton || !Array.isArray(j.bones)) { console.error('Not a Spine JSON'); process.exit(1); } console.log('bones=' + j.bones.length + ' slots=' + (j.slots?.length ?? 0) + ' anims=' + Object.keys(j.animations ?? {}).length);"
```

If validation fails, emit `{"ok": false, "error": "<file> is not a valid Spine JSON"}` and stop.

### 5. Convert to AssetManifest

Invoke the project's own importer via `scripts/import-spine-json.ts` — it wraps `spineJsonToManifest` and applies license / name / sourceUrl overrides:

```bash
npx tsx scripts/import-spine-json.ts \
  --file "$DEST/skeleton.json" \
  --scope project \
  --name "Spineboy" \
  --assetId "$ASSET_ID" \
  --source-url "https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/spineboy/export/spineboy-ess.json" \
  --tags "spine,imported,example" \
  --license-type "Spine Examples License" \
  --license-author "Esoteric Software" \
  --license-source-url "https://esotericsoftware.com/spine-examples-license" \
  --license-commercial false \
  --license-attribution true
```

The script emits the AssetManifest as a single JSON line to stdout. Capture it.

### 6. Emit the trailing line

Print `{"ok": true, "manifest": <the manifest from step 5>}` as the final line of your output. No prose after.

## Helper script reference

The skill ships with [scripts/import-spine-json.ts](../../scripts/import-spine-json.ts) (project-relative). Recognized flags:

| Flag | Meaning |
|---|---|
| `--file <path>` | Spine JSON path. If omitted, reads JSON from stdin. |
| `--scope global \| project` | Default `project`. Use `global` only if user says "save to global library". |
| `--name <string>` | Override `manifest.name` (also drives `displayName`). |
| `--assetId <string>` | Override `manifest.assetId` (skip the random suffix). |
| `--source-url <url>` | Recorded in `source.originalFile` and `files.sourceUrl`. |
| `--tags <a,b,c>` | Merged into `manifest.tags`. |
| `--license-type <string>` | e.g. `"Spine Examples License"`, `"CC-BY 4.0"`, `"CC0"`, `"unknown"`. |
| `--license-author <string>` | Original author / studio. |
| `--license-source-url <url>` | License page or repo LICENSE link. |
| `--license-commercial true\|false` | Default unchanged from importer (`false`). |
| `--license-attribution true\|false` | Default unchanged from importer (`false`). |

## Hard rules

- **Never POST to `/api/assets`.** Registration happens in the UI after the user confirms.
- **Never** write into `data/cucumber.db`, `src/data/*.json`, or `public/assets/`. Downloads go only to `data/spine-imports/<assetId>/`.
- **Never** invent license terms. If a source's license page wasn't actually read, default to `commercialUse:false, needAttribution:true, type:"unknown"`.
- **Never** download anything other than `.json`, `.atlas`, `.png`, `.jpg`, `.webp`. If a URL is suspicious (executable, archive of unknown contents), refuse and ask the user.
- **Never** download files larger than ~20 MB without asking the user first — Spine JSONs are typically 10 KB – 2 MB; anything bigger is probably a misidentified file.
- **Never** embed binary image data in the manifest. The atlas / PNG live on disk; the manifest only references paths.
- If you can't verify a license and the user hasn't explicitly authorized "non-commercial use only", surface the license question to the user rather than silently emitting a `commercialUse:false` manifest.

## Examples

### Example 1 — user supplies a direct URL

> User: 帮我从这个链接导入 Spine: `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/raptor/export/raptor-pro.json`

1. URL ends in `.json` — use directly.
2. Repo is `EsotericSoftware/spine-runtimes` → license is Spine Examples License (non-commercial), per [references/known-sources.md](references/known-sources.md).
3. Download to `data/spine-imports/character_raptor_<id>/skeleton.json`.
4. Validate: parses, has `skeleton.bones[]`.
5. Convert via `scripts/import-spine-json.ts` with name "Raptor", license Spine Examples, commercial=false.
6. Emit `{"ok": true, "manifest": ...}`.

### Example 2 — user names a known asset

> User: AI 帮我加一个 Spineboy

1. Look up Spineboy in [references/known-sources.md](references/known-sources.md) → `spineboy-ess.json` raw URL.
2. Same flow as Example 1.

### Example 3 — vague request

> User: 给我找一个免费的 Spine 战士

The skill does NOT silently pick an asset. Search, present 2-3 candidates with their license terms in plain text, and stop. Wait for the user's choice before downloading. (This is the one place the skill pauses for user input — license selection has real legal consequences.)

### Example 4 — failure mode

> User: 导入 https://example.com/not-actually-spine.json

After download + validate, the JSON is not Spine. Delete the staging directory, emit:

```json
{"ok": false, "error": "Downloaded file is not a Spine JSON (no skeleton/bones fields)"}
```
