# Known Spine JSON sources

A short catalogue of public Spine assets the skill can pull without further research. **All entries here have been license-vetted** — copy the license block as-is into the manifest.

When the user names one of these by name ("Spineboy", "Raptor", etc.), skip the search step and go straight to the URL below.

## Esoteric Software examples

Hosted at `https://github.com/EsotericSoftware/spine-runtimes`. License: **Spine Examples License**.

> The Spine Runtimes Examples (i.e., the contents under the spine-runtimes/examples directory) are licensed under the Spine Examples License, which permits use solely for evaluation, learning, and development of products that integrate the Spine Runtimes. They may not be redistributed nor used to develop non-Spine-related products.

Practical translation for the manifest:

```json
"license": {
  "type": "Spine Examples License",
  "author": "Esoteric Software",
  "sourceUrl": "https://esotericsoftware.com/spine-examples-license",
  "commercialUse": false,
  "needAttribution": true
}
```

Use the `4.2` branch unless the user explicitly asks for an older runtime.

| Asset | Type | JSON URL (raw) |
|---|---|---|
| Spineboy | character | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/spineboy/export/spineboy-ess.json` |
| Spineboy (Pro / mesh) | character | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/spineboy/export/spineboy-pro.json` |
| Raptor | character | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/raptor/export/raptor-pro.json` |
| Goblins | character (multi-skin) | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/goblins/export/goblins-pro.json` |
| Hero | character | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/hero/export/hero-pro.json` |
| Stretchyman | character | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/stretchyman/export/stretchyman-pro.json` |
| Mix and Match | character | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/mix-and-match/export/mix-and-match-pro.json` |
| Tank | prop / vehicle | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/tank/export/tank-pro.json` |
| Owl | character (animal) | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/owl/export/owl-pro.json` |
| Coin | prop | `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/coin/export/coin-pro.json` |

Companion files (same directory, same names with `.atlas` / `.png` extensions). Fetch them if convenient — the importer ignores them today but having them on disk future-proofs texture support.

## Community packs

There's no curated allowlist here yet. When a user supplies a community asset URL (itch.io, OpenGameArt, a personal portfolio), do not pre-trust it:

1. `WebFetch` the page hosting the file. Read the license terms in plain text.
2. If the page says CC0 / CC-BY / MIT, record the exact phrasing in `license.type`.
3. If the page says "personal / non-commercial use only" or has no clear license, set `commercialUse:false, needAttribution:true, type:"unknown"`, and add `metadata.licenseNote` quoting what the page said.
4. If the file is hosted on a dead link or a Discord CDN with no surrounding license context, refuse and tell the user.

## URL rewriting

The `EsotericSoftware/spine-runtimes` repo is occasionally browsed via the GitHub blob UI. Always rewrite blob URLs to raw before `curl`:

| From | To |
|---|---|
| `https://github.com/<user>/<repo>/blob/<ref>/<path>` | `https://raw.githubusercontent.com/<user>/<repo>/<ref>/<path>` |

Same idea for GitLab and Codeberg — every blob viewer has a `raw` variant.

## Anti-patterns

- **Do not** point the user at the `spine-runtimes` `LICENSE` file at the repo root. That covers the *runtime* code (BSD-style); the *examples* under `examples/` are governed by the separate Spine Examples License. They are not the same.
- **Do not** assume newer Spine versions of an asset (4.3, 4.4) exist before checking. The repo bumps branches, not paths — if `4.2` ships an asset, `4.3` may have a renamed file.
- **Do not** use `https://esotericsoftware.com/files/examples/...` URLs from old docs — many of those redirect to login walls now. Always prefer the raw.githubusercontent path.
