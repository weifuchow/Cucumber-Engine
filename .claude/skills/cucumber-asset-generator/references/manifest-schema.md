# Asset Manifest Schema Reference

Canonical TypeScript definition lives in `src/types/schema.ts` at the repo root. Re-read it before authoring a non-trivial manifest; this file is a flat summary.

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `assetId` | string | yes | stable kebab/snake id, see SKILL.md |
| `name` | string | yes | human-readable |
| `category` | `"visual" \| "audio"` | yes | |
| `type` | AssetType | yes | see enum below |
| `scope` | `"global" \| "project"` | yes | `global` = shared library; `project` = current project only |
| `source.kind` | `"imported" \| "generated" \| "manual" \| "referenced"` | yes | |
| `source.format` | string | yes | extension or `procedural` |
| `source.originalFile` | string | yes | filename or source URL |
| `files` | `Record<string,string>` | yes | at minimum one of `{ preview, sourceUrl, file }` |
| `tags` | `string[]` | yes | searchable; lowercase preferred |
| `metadata` | object | yes | type-specific, see SKILL.md |
| `license.type` | string | yes | SPDX-ish or descriptive |
| `license.author` | string | yes | |
| `license.sourceUrl` | string | yes | URL of license page or origin |
| `license.commercialUse` | boolean | yes | conservative default `false` if unclear |
| `license.needAttribution` | boolean | yes | conservative default `true` if unclear |
| `overrides` | object | no | project-level diffs from a global asset |

## AssetType enum

`character`, `scene`, `prop`, `expression`, `action`, `effect`, `foreground`, `background`, `cameraTemplate`, `sceneElement`, `bgm`, `dialogue`, `narration`, `soundEffect`, `environment`

## Round-trip check

```bash
# After POST, GET should return the same manifest you sent.
ID=character_chef_001
curl -sS "$CUCUMBER_API_BASE/assets/$ID" | jq .
```
