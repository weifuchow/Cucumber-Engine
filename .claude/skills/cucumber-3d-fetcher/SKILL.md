---
name: cucumber-3d-fetcher
description: Fetch or AI-generate a 3D character model (image→3D, or an existing rigged glTF/GLB) and stage it for the Cucumber Engine, emitting an AssetManifest the UI can preview-and-confirm. Use whenever the user says "make a 3D character from this image", "import this GLB", "turn these turnaround photos into a 3D model", or otherwise wants a 3D-derived character in the asset library. The skill researches sources, verifies licenses, fetches/stages the model, and (when the bake path is available) renders multi-view sprites the existing 2.5D renderer can draw — the front-end is responsible for the final POST that registers the asset.
---

# Cucumber 3D Fetcher

> **Skeleton status.** This skill is wired against the Path C plan in
> [docs/3d-pipeline.md](../../../docs/3d-pipeline.md). The engine does not yet
> have the `imageSprite` primitive or the `scripts/bake-gltf-views.ts` bake
> script, so until those land the skill **fetches + validates + stages** a
> model and emits a *pending-bake* manifest. It must NOT pretend the asset is
> renderable. Read the plan doc before extending this skill.

## What this skill is for

Cucumber's characters are authored as procedural 2.5D shapes today. This skill
is the on-ramp for **3D-derived** characters: take an image (or several
turnaround views), or an existing rigged model, produce a mesh, and bring it
into the asset library the same preview-first way the Spine fetcher does.

Use this skill — not `cucumber-asset-generator` (procedural design) and not
`cucumber-spine-fetcher` (2D skeletal) — when the source is a **3D mesh or an
image to be lifted into 3D**.

## Authoring contract (read first)

Identical discipline to `cucumber-spine-fetcher`:

- This skill **does NOT register the asset.** It returns one AssetManifest as
  JSON; the UI renders a preview and the user confirms or discards.
- **Never** POST to `/api/assets`. **Never** write into `data/cucumber.db`,
  `src/data/*`, or `public/assets/`.
- All downloads + bake output land under `data/3d-imports/<assetId>/`. That is
  the staging area; the user owns final disposition from the UI.

## Output format (strict)

End your run with exactly one trailing line of pure JSON:

```json
{"ok": true, "manifest": { ...full AssetManifest... }, "pendingBake": true}
```

…or on recoverable failure:

```json
{"ok": false, "error": "<short reason>"}
```

`pendingBake: true` signals the frontend that the manifest references a staged
model that has **not** been baked to drawable sprites yet (current skeleton
state). Once `bake-gltf-views.ts` exists and ran, emit `pendingBake: false`
and a manifest whose `metadata.shapes[<angle>]` carry `imageSprite` primitives.

The frontend slurps the last `{...}` JSON object from your output. No prose
after it, no markdown fences on that final line.

## Workflow

### 1. Resolve the source

| Input shape | Action |
|---|---|
| Direct URL to `.glb` / `.gltf` | Use directly. |
| Image URL(s) / staged image path(s) (turnaround) | This is an **image→3D** job; go to step 3b. |
| Page / repo URL | `WebFetch`; look for `.glb`/`.gltf` links or a model viewer embed. |
| A name ("a low-poly knight", "Mixamo Y-bot") | See [references/known-sources.md](references/known-sources.md). |
| Vague description | `WebSearch`; present 2–3 candidates **with licenses** and stop for user choice. |

### 2. License check (REQUIRED before download)

3D assets are rarely CC0. For known sources, use the license recorded in
[references/known-sources.md](references/known-sources.md). For unknown
sources, `WebFetch` the `LICENSE`/README; if unverifiable, default to:

```json
"license": { "type": "unknown", "author": "", "sourceUrl": "<url>", "commercialUse": false, "needAttribution": true }
```

and add `metadata.licenseNote`. For **AI-generated** meshes, the license is
the generator's output terms (e.g. Tripo/Meshy commercial tiers) PLUS the
rights to the **input image** — verify the user owns/licensed the source
image, and record both. Never assert commercial rights you didn't confirm.

### 3a. Fetch an existing model

```bash
ASSET_ID="character_3d_$(date +%s | tail -c 5)"
DEST="data/3d-imports/$ASSET_ID"
mkdir -p "$DEST"
curl -fsSL "<glb-url>" -o "$DEST/model.glb"
```

`curl -fsSL` mandatory. Reject anything that isn't `.glb`/`.gltf`(+`.bin`/
textures). Refuse files > ~50 MB without asking.

### 3b. Image→3D (generation)

When the input is image(s), the mesh is produced by an external provider
(Tripo / Hunyuan3D / Meshy — see the plan doc for the trade-offs). The skill
does not bundle a provider key; it expects one of:

- a configured provider endpoint/key in the environment, OR
- the user to point at an already-generated `.glb`.

Prefer **multi-view input** when the user supplies a turnaround (accurate
backs). Stage the resulting `model.glb` into `$DEST` as in 3a. For humanoids,
request an **auto-rigged** output so the bake step has a skeleton to pose.

### 4. Validate

```bash
node -e "const b=require('fs').readFileSync('$DEST/model.glb'); if(b.slice(0,4).toString()!=='glTF'){console.error('not a GLB');process.exit(1);} console.log('glb bytes='+b.length);"
```

For `.gltf` (JSON), confirm `{ asset:{version}, meshes:[...] }`. Reject Spine
JSON, Lottie, DragonBones, plain images.

### 5. Convert / stage

- **If `bake-gltf-views.ts` exists** (Path C live): run it to render the
  canonical angles × actions to `$DEST/<angle>/<action>/*.png` and capture the
  emitted `metadata.shapes` block of `imageSprite` primitives. Emit a full
  manifest with `pendingBake: false`.
- **Otherwise (skeleton state):** emit a *pending-bake* manifest:

```json
{
  "assetId": "<ASSET_ID>",
  "name": "<name>",
  "category": "visual",
  "type": "character",
  "scope": "project",
  "source": { "kind": "imported", "format": "gltf", "originalFile": "<url or filename>" },
  "files": { "model": "data/3d-imports/<ASSET_ID>/model.glb", "preview": "" },
  "tags": ["3d", "imported", "pending-bake"],
  "metadata": {
    "width": 260, "height": 520,
    "anchor": { "x": 130, "y": 520 },
    "displayName": "<name>",
    "actions": ["idle"],
    "expressions": ["neutral"],
    "model3d": { "format": "gltf", "rigged": <true|false>, "path": "data/3d-imports/<ASSET_ID>/model.glb" },
    "pendingBake": true,
    "references": [{ "sourceType": "...", "source": "<url>", "note": "..." }]
  },
  "license": { ... }
}
```

### 6. Emit the trailing line

Print `{"ok": true, "manifest": <manifest>, "pendingBake": <bool>}` as the
final line. No prose after.

## Hard rules

- **Never POST to `/api/assets`** and never touch `data/cucumber.db`,
  `src/data/*`, `public/assets/`. Staging only: `data/3d-imports/<assetId>/`.
- **Never invent license terms.** Image→3D inherits both the generator's terms
  and the input image's rights — confirm both or default to non-commercial +
  attribution.
- **Never** claim an asset is renderable while `pendingBake` is true. The
  engine cannot draw a raw glTF yet (see plan doc); say so plainly.
- **Never** download executables/archives of unknown contents, or files
  > ~50 MB, without asking.
- Prefer **mesh-based** generators over Gaussian-splatting ones — splats don't
  rig or composite into this engine.
- For **vague** requests, present candidates + licenses and stop; do not
  silently pick (license has legal consequences).

## Examples

### Example 1 — existing GLB
> User: 把这个 GLB 导进来 `https://example.com/knight.glb`
Fetch → validate (`glTF` magic) → license check → emit pending-bake manifest
(`format: "gltf"`, `model3d.path` set, `pendingBake: true`), noting it will be
drawable once the bake step exists.

### Example 2 — image→3D turnaround
> User: 这三张转面图生成一个 3D 角色
Confirm the user owns the images → run multi-view image→3D (auto-rigged
humanoid) → stage `model.glb` → emit pending-bake manifest, license = generator
terms + image rights.

### Example 3 — vague
> User: 给我找个免费的 3D 少女模型
Search, present 2–3 candidates with license terms in plain text, stop. Wait for
the user's pick before downloading.
