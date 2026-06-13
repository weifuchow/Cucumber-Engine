# Known 3D model + image→3D sources

A catalogue for the `cucumber-3d-fetcher` skill. Two kinds of source: **mesh
generators** (image→3D) and **existing free model libraries**. Always prefer
**mesh** output over Gaussian splatting — splats don't rig or composite into
this engine (see [docs/3d-pipeline.md](../../../docs/3d-pipeline.md)).

> Licenses below are summaries, not legal advice, and providers change terms.
> When in doubt, `WebFetch` the provider's current terms and record the exact
> phrasing in `license.type` + `metadata.licenseNote`.

## Image→3D generators (mesh)

Pick by need; all take one image, the better ones take a multi-view turnaround
(more accurate backs). None are bundled — the skill needs a configured key or
an already-generated `.glb`.

| Provider | Strengths | Topology / rig | License posture |
|---|---|---|---|
| **Tripo (v3)** | best price→game-ready; quad topology; built-in auto-rig | quad, auto-rig | Free tier = personal; paid tiers grant commercial. Confirm tier. |
| **Hunyuan3D 2.5 / 3.1** | open-weights, self-hostable, strong quality | mesh; rig separately | Tencent model license — check commercial clause for the weights version used. |
| **Meshy** | one-stop: model + texture + auto-rig + 100+ preset motions | mesh, auto-rig | Subscription tiers define commercial rights. |
| **Rodin** | highest photorealism, 4K textures | mesh | Paid; enterprise terms. |
| TRELLIS-2 / splatting | cinematic stills | ⚠️ splat — **avoid** for characters | n/a here |

**Input-image rights matter as much as the generator license.** A Tripo
commercial tier does not grant rights to a copyrighted input image. Verify the
user owns or licensed the source image; record both in the manifest.

For **humanoids**, request auto-rigged output (standard skeleton) so the bake
step (`bake-gltf-views.ts`) can pose actions. Non-humanoid auto-rig is rougher
— flag it.

## Free rigged-model libraries (existing GLB/FBX)

| Source | What | License | Notes |
|---|---|---|---|
| **Mixamo** (adobe) | rigged humanoids + huge motion library | Free for use incl. commercial, no attribution; **redistribution of the raw files is restricted** | Best source of *motions* to retarget; download as glTF/FBX. |
| **Khronos glTF-Sample-Assets** | reference glTF models (incl. rigged: CesiumMan, Fox, BrainStem) | Mostly CC0 / CC-BY — **per-model**, listed in the repo | `github.com/KhronosGroup/glTF-Sample-Assets`. Verify the specific model's row. |
| **Sketchfab** (downloadable) | community models | **per-model**: CC0 / CC-BY / editorial / paid | Never assume; read each model's license tab. |
| **Poly Pizza**, **Quaternius** | low-poly packs | CC0 (verify) | Good for props / stylized. |

### Khronos sample rigged characters (handy for testing the bake path)

Hosted under `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models`.
Check each model's `LICENSE.md` in its folder before use.

| Model | Type | Path (Models/<name>/glTF-Binary/<name>.glb) |
|---|---|---|
| CesiumMan | rigged humanoid (skin + walk) | `Models/CesiumMan/glTF-Binary/CesiumMan.glb` |
| BrainStem | rigged humanoid robot | `Models/BrainStem/glTF-Binary/BrainStem.glb` |
| Fox | rigged quadruped (3 anims) | `Models/Fox/glTF-Binary/Fox.glb` |
| RiggedFigure | minimal rigged biped | `Models/RiggedFigure/glTF-Binary/RiggedFigure.glb` |

Raw download: rewrite the blob/tree URL to
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/<path>`.

## License defaults

When a source's terms can't be verified, default to the conservative block and
note what you couldn't confirm:

```json
"license": { "type": "unknown", "author": "", "sourceUrl": "<url>", "commercialUse": false, "needAttribution": true }
```

## Anti-patterns

- **Do not** ship a Gaussian-splat asset as a character — it can't rig or
  composite here.
- **Do not** conflate the generator license with the input-image rights; an
  AI mesh of a copyrighted character is still infringing.
- **Do not** redistribute Mixamo's raw rig files; use them to derive motion,
  and keep the staged copy under `data/3d-imports/` (not committed).
- **Do not** mark a fetched-but-unbaked model as renderable — emit
  `pendingBake: true` until the bake step exists and ran.
