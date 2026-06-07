# 罗小黑战记 验收标准 (Luo Xiao Hei Acceptance Bar)

Visual style + camera-work bar that AI-generated assets and segments must clear. Translated from observation of **罗小黑战记** (《罗小黑战记》/ *The Legend of Hei*) into machine-checkable rules.

> Use this together with [docs/2.5d-plan.md](2.5d-plan.md) and [docs/capability-roadmap.md](capability-roadmap.md). The 2.5D plan is *what the engine can do*; this doc is *what we want output to look like*.

---

## 1. Visual style — what makes 罗小黑 read

What sets the show apart visually:

1. **Cel-shading with crisp shadow polygons** — body color is mostly FLAT; volume comes from one or two hard-edged shadow polygons per part, NOT continuous radial gradients
2. **Uniform thin contour stroke** — every silhouette has a 1.2-1.8 px outline, same width everywhere; thicker outlines look 3D-render-y and break the style
3. **Limited palette per character** — typically 4-6 saturated-but-not-neon colors. Black/dark-brown for outlines, one body color, one skin tone, one accent, one accessory color
4. **Simple eye design** — small black pupils on white sclera, sometimes a single dot highlight. No anime-style 3-stop iris gradients, no double-highlight glamour
5. **Slightly chibi proportions** — head is large relative to body (head-radius : total-height ≈ 0.18-0.28). Less stylized than full chibi (1:2) but more than realistic (1:7)
6. **Warm peach skin** — `#f5cba0`-ish; minimal shading on the face itself (cheek pink dots are the main face feature)
7. **Watercolor-inflected backgrounds** — soft atmospheric haze rect over the bg, color-graded toward cool/warm depending on time-of-day. Not photoreal, not hard-edged
8. **Foreground occluders frame the action** — branches / leaves / doorframes partially obstruct characters, contributing to the storybook feel

## 2. Camera signatures — how 罗小黑 cuts

The show's editing fingerprints:

1. **Long horizontal pans** — sustained tracking shots that follow a character left-to-right (3-6 seconds). Parallax shows depth.
2. **Slow push-ins on reactions** — when a character has an emotional beat, the camera zooms 1.0 → 1.4× over 1.5-2.5 s (zoom delta ≥ 0.15, duration ≥ 1.5 s, transition: smooth)
3. **Environment hold at start** — opening 1.5-2.5 s of any scene shows the SETTING before any character moves. No `characterAppear` should fire before camera has had time to establish.
4. **Wide → CU → wide dialogue rhythm** — when a character speaks, a closeUp cut on them mid-line; then back to wide at the end. Single dialogue line ≥ 2s should have at least one closeUp on the speaker.
5. **Speed lines on action** — `effectPlay` with a radial spread should land on at least one of the `characterAction` events (attack / punch / dodge) per segment. Adds the show's signature kinetic feel.
6. **Soft cuts, not jarring** — most transitions are `smooth`. `cut` transition is reserved for shock beats (1 per segment max).
7. **Holding on the empty frame** — after a character `characterDisappear`, hold the empty frame ≥ 0.6 s before scene change. The "lingering breath" beat.

## 3. Hard rules (lint-enforced)

These are checked by `npm run lint:2.5d` when `--style luoxiaohei` is passed. Anything failing is rejected.

### Character (per-asset)

| ID | Rule | How it's checked |
|---|---|---|
| LX-C1 | Palette has 3-6 entries | `Object.keys(metadata.palette).length` |
| LX-C2 | Outline stroke widths in [1.0, 2.0] uniformly | scan `primitives[].lineWidth` literals |
| LX-C3 | ≥ 2 crisp shadow polygons (flat-fill polygon with rgba alpha 0.18-0.45) per character | count polygons with rgba black/brown semi-alpha fill |
| LX-C4 | No iris radial gradients with > 2 stops | reject ellipse/circle fills that are radial-gradient with > 2 stops AND cy ∈ eye-zone |
| LX-C5 | Head-to-height ratio in [0.18, 0.30] | `head_radius * 2 / (height)` derived from manifest |
| LX-C6 | Cheek warmth ellipses present (≥ 2, rgba pink alpha 0.2-0.4) | scan for ellipses with pinkish rgba fill near `cy ∈ [-290, -260]` |
| LX-C7 | No more than 1 chest-emblem-style decoration | count primitives in chest zone with palette/accent fill |

### Scene (per-asset)

| ID | Rule | How it's checked |
|---|---|---|
| LX-S1 | Atmospheric haze rect present in background (rgba cool/warm soft alpha) | scan layer.background for rect with rgba fill, alpha ∈ [0.2, 0.5] |
| LX-S2 | Background includes ≥ 1 watercolor-ramp gradient (linear with ≥ 3 stops including 1 with alpha < 1) | scan layer.background for linear gradients |
| LX-S3 | Foreground has ≥ 1 occluder shape (polygon or rect that overlaps character zone y∈[300,720]) | walk layer.foreground |
| LX-S4 | Limited scene palette: ≤ 10 distinct base colors across all primitives | scan unique color strings + palette refs |
| LX-S5 | Parallax bg ≤ 0.55 AND fg ≥ 1.2 (stronger separation than baseline 2.5D) | `shape.parallax` values |

### Segment timeline (per-segment)

| ID | Rule | How it's checked |
|---|---|---|
| LX-T1 | Opening ≥ 1.0 s without `characterAppear` (environment hold) | scan timeline, no characterAppear before t ≥ 1.0 |
| LX-T2 | ≥ 1 horizontal pan with Δx ≥ 200 AND duration ≥ 2.0 s AND transition=smooth | scan `cameraChange` |
| LX-T3 | ≥ 1 slow push-in: Δzoom ≥ 0.15, duration ≥ 1.5 s, transition=smooth | scan `cameraChange` |
| LX-T4 | Each dialogue ≥ 2.0 s has at least one closeUp cut on the speaker mid-line | correlate `dialogue` + `cameraChange` |
| LX-T5 | ≥ 1 `effectPlay` (radial/speed line) co-located with a `characterAction` of attack/punch | timing correlation |
| LX-T6 | At most 1 `transition: "cut"` cameraChange per segment | count `cut` transitions |
| LX-T7 | If a character `characterDisappear`s, hold ≥ 0.6 s before the next sceneChange | timing check |
| LX-T8 | Total dialogue talking time ≤ 70% of segment duration | sum dialogue durations |

## 4. Soft rules (recommended, warnings only)

| ID | Rule |
|---|---|
| LX-W1 | Use `intensity` < 0.8 for most expressions — 罗小黑's emotional range is restrained |
| LX-W2 | BGM with declared BPM should have at least 2 cameraChange events snapped to beats (`beatGrid` cached) |
| LX-W3 | Characters with > 30 s on-screen time should have body-part layer map declared (so the multi-pass renderer can do per-limb occlusion) |
| LX-W4 | Avoid pure black (`#000`). Use `#1a120a` / `#1f1610` for outlines — softer warmer reads |
| LX-W5 | Background green: `#7a8c5a` to `#a8b87c` family. Sky blue: `#c0d4dc` to `#9db8c6`. Don't use saturated `#00ff00` / `#0080ff`. |

## 5. Camera grammar cheat-sheet for AI

Quick templates the segment generator can paste:

**Environment hold** (opening 2 s):
```json
{ "time": 0, "type": "sceneChange", "sceneId": "..." },
{ "time": 0, "type": "cameraChange", "camera": { "mode": "wide", "x": 460, "y": 360, "zoom": 0.95, "duration": 0, "transition": "cut" } }
// (no characterAppear until t >= 1.0 s)
```

**Horizontal pan with parallax** (3 s):
```json
{ "time": 5, "type": "cameraChange",
  "camera": { "mode": "wide", "x": 880, "y": 360, "zoom": 1.0, "duration": 3, "transition": "smooth" } }
```

**Slow push-in on reaction** (1.8 s):
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
// (no events for 0.8 s — hold the empty frame)
{ "time": 22.8, "type": "sceneChange", "sceneId": "scene_forest_path_001" }
```

## 6. When NOT to apply the 罗小黑 bar

The bar is **opt-in per project**. Set `project.config.styleBar = "luoxiaohei"` to enable. Other style bars planned: `"shinkai"` (Makoto Shinkai), `"ghibli"`, `"jiangnan-baiyi"` (Chinese ink-wash). The default (`undefined`) skips style-specific lint.

Cases where AI should NOT apply this bar even when enabled:

- Comedy gag segments where the emotional restraint rules don't fit
- Action segments > 10 s of pure choreography where dialogue rules don't apply (LX-T8 still applies)
- Title cards / fade-to-black transitions

In all these cases the AI should still author with the SPIRIT of the style (limited palette, soft cuts) but skip the specific rule check.
