# Procedural Shape Reference (2.5D)

Visual procedural assets describe their geometry as a list of declarative primitives stored at `metadata.shape`. The Cucumber Engine renderer is a pure interpreter — there is no code path that draws an asset without `shape`.

Canonical TypeScript definition lives in `src/engine/proceduralShape.ts`. Read it for the authoritative type. This file is a flat author-facing summary, organised around the four 2.5D dimensions: **lighting**, **layering**, **parallax**, **shadow**.

## Top-level shape

```ts
type SceneLayerKey = "background" | "midground" | "foreground";

interface ProceduralShape {
  scale?: number;                                // uniform scaling applied to everything
  preview?: { fit?: "contain" | "center" | "bottom"; scale?: number };
  primitives: ConditionalPrimitive[];            // legacy / character / prop / effect path
  layers?: Partial<Record<SceneLayerKey, ConditionalPrimitive[]>>;
  parallax?: Partial<Record<SceneLayerKey, number>>;
}
```

Defaults if you omit `parallax`: `{ background: 0.5, midground: 1, foreground: 1.25 }`.

`preview` hints what the gallery thumbnail does:
- `"bottom"` — center horizontally, anchor at bottom (characters)
- `"center"` — center at canvas center (default for props/effects)
- `"contain"` — scale to fit, used for scenes (full 1280×720 background)

## Asset-type quick map

| Type | Authoring shape | Required 2.5D features |
|---|---|---|
| character | flat `primitives` (no layers) | linear/radial gradient on body + face highlight + z-aware contact shadow |
| scene / background / foreground | `layers.background/midground/foreground` + `parallax` | three layers populated + atmospheric haze in background + at least one occluder in foreground |
| prop | flat `primitives` | linear gradient or radial highlight + contact-shadow ellipse |
| effect | flat `primitives`, references `progress` | radial gradient halo recommended |

## Numeric expressions

Every numeric field accepts a literal `number` OR a string expression. State variables:

| State | Available in | Range / type |
|---|---|---|
| `progress` | effect shapes | `0..1` over `defaultDuration` |
| `time` | any shape | seconds, monotonic |
| `expression` | character shapes (`when` only) | `"neutral" \| "angry" \| "soft" \| "sad" \| "surprised" \| ...` |
| `action` | character shapes (`when` + expressions) | `"idle" \| "walking" \| ...` |
| `z` | character shapes | pseudo-depth in pixels (0 = camera plane, +large = far) |
| `name` | text primitive `${name}` interpolation | from `metadata.displayName` or `name` |

Operators: `+ - * / %`, parentheses, unary `-`.
Constants: `PI`, `TAU` (=2π), `E`.
Functions: `cos sin tan abs min max sqrt pow floor ceil round clamp(v, lo, hi) lerp(a, b, t)`.

Examples:
- `"90 + progress * 80"` — radius grows over the effect's lifetime
- `"sin(time * 8) * 0.5"` — leg swing for walking
- `"92 * (1 - clamp(z * 0.0008, 0, 0.35))"` — contact shadow shrinks with depth
- `"lerp(20, 80, progress)"` — interpolation helper

## Color specs

```ts
type ColorSpec =
  | string                                                    // CSS color; may contain ${expr} interpolation
  | { palette: string; darken?: number }                      // palette ref; darken subtracts the value from each RGB
  | { gradient: "linear"; x0, y0, x1, y1; stops: [{at, color}] }
  | { gradient: "radial"; x0, y0, r0, x1, y1, r1; stops: [{at, color}] }
```

`${expr}` works inside color strings — used for alpha-fade: `"rgba(255, 213, 88, ${1 - progress})"`. The inner expression is evaluated as a number.

Palette refs read from `manifest.metadata.palette`. Standard keys: `body`, `skin`, `hair`. `darken: 32` subtracts 32 from each of R/G/B (so arms appear slightly darker than the torso).

## Shadow modifier

Any primitive can carry an optional `shadow` for a soft drop shadow:

```ts
shadow?: { blur: NumExpr; offsetX?: NumExpr; offsetY?: NumExpr; color: string }
```

The renderer wraps the draw call in `ctx.save/restore` and sets `shadowBlur/Color/Offset`. Use this for furniture so the room reads as volumetric. Avoid on every primitive — three or four per scene layer is usually enough.

## Conditional `when`

Every primitive can carry `when: "<expr>"` that gates whether it draws. Supported forms:
- `key == value` / `key != value`
- `key in [a, b, c]` / `key not in [a, b, c]`

Currently only string state values are matched. The most useful keys are `expression` and `action` on character shapes.

## Primitives

```ts
{ kind: "roundedRect", x, y, w, h, r; fill; shadow? }
{ kind: "rect",        x, y, w, h; fill; shadow? }
{ kind: "circle",      cx, cy, r; fill?; stroke?; lineWidth?; shadow? }
{ kind: "ellipse",     cx, cy, rx, ry, rotation?, startAngle?, endAngle?; fill?; stroke?; lineWidth?; shadow? }
{ kind: "line",        x1, y1, x2, y2; stroke; lineWidth; lineCap?; shadow? }
{ kind: "arc",         cx, cy, r, startAngle, endAngle; fill?; stroke?; lineWidth?; shadow? }
{ kind: "polygon",     points: [{x, y}]; fill?; stroke?; lineWidth?; closed?; shadow? }
{ kind: "starBurst",   cx, cy, spikes: number, outer, inner, rotation?; fill?; stroke?; lineWidth?; shadow? }
{ kind: "text",        x, y, text, fill, size; align?; font?; shadow? }
{ kind: "transform",   translate?, rotate?, scale?; children: ConditionalPrimitive[] }
{ kind: "clip",        shape: { kind:"rect"|"roundedRect"|"circle"|"ellipse", ... }; children: ConditionalPrimitive[] }
```

Notes:
- `ellipse` angles follow Canvas2D: `startAngle = PI, endAngle = 2*PI` draws the lower half (a "dome" sitting on top when used at `y < 0`).
- `arc` is fill-or-stroke; when stroked it uses a round line cap automatically.
- `text` supports `${name}` and `${expr}` interpolation in the `text` string.
- `transform` is the only nesting primitive for rotation/translation.
- `clip` restricts its `children` to its `shape` region. Use to keep highlights inside a body silhouette or to mask a face highlight to the head circle.

## Coordinate conventions

| Type | Origin | Typical extent | Notes |
|---|---|---|---|
| character | feet (anchor) at `(0, 0)` | head ~ `y = -380`, name plate ~ `y = -395` | y is up-negative; rendered after translate to character world position |
| prop | center at `(0, 0)` | symmetric around origin | rendered after translate to prop world position |
| effect | center at `(0, 0)` | radial pattern around origin | rendered after translate to effect world position |
| scene | top-left at `(0, 0)` | full canvas `1280 × 720`; extend ±200 for parallax overscan | bg / mid / fg layers each pinned to their own parallax factor |

### Standard human body coordinates

Use these as the anchor for new characters — change palette + accessories rather than redrawing the body from scratch:

- contact shadow ellipse at `(0, 14)` with rx/ry that shrink with `z` (see "contact shadow" recipe below)
- torso roundedRect at `(-58, -245)` w=116 h=205
- head circle at `(0, -310)` r=70
- hair ellipse `(0, -344)` rx=72 ry=44 (lower-half-only with `startAngle: PI, endAngle: 2*PI`)
- eyes at `(±24, -302)` r=5
- name plate `(-72, -395)` w=144 h=32 with text at `(0, -372)` align center

## 2.5D recipes

### 1 — Lighting (body / surface volume)

Stack a base palette color + a linear-gradient overlay shifted toward upper-left. This reads as a directional key light from the upper-left, the standard cartoon convention.

```json
{ "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38,
  "fill": { "palette": "body" } },
{ "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38,
  "fill": { "gradient": "linear", "x0": -58, "y0": -245, "x1": 58, "y1": -40,
    "stops": [
      { "at": 0,    "color": "rgba(255,255,255,0.18)" },
      { "at": 0.45, "color": "rgba(255,255,255,0)" },
      { "at": 1,    "color": "rgba(0,0,0,0.22)" }
    ] } }
```

For a face, use a radial gradient with the focus at the upper-left of the head circle:

```json
{ "kind": "circle", "cx": 0, "cy": -310, "r": 70, "fill": { "palette": "skin" } },
{ "kind": "circle", "cx": 0, "cy": -310, "r": 70,
  "fill": { "gradient": "radial",
    "x0": -22, "y0": -334, "r0": 4,
    "x1": 0,   "y1": -310, "r1": 70,
    "stops": [
      { "at": 0,    "color": "rgba(255, 246, 230, 0.55)" },
      { "at": 0.55, "color": "rgba(255, 246, 230, 0)" },
      { "at": 1,    "color": "rgba(40, 22, 14, 0.22)" }
    ] } }
```

### 2 — Multi-layer scene with parallax

A scene MUST split into `layers.background / midground / foreground` and provide a `parallax` factor map. Background is slowest (wall, sky, distant props), midground is the main set (furniture, doorways), foreground is what should occlude characters when the camera pans (front edges, plants, doorframes).

```json
"shape": {
  "preview": { "fit": "contain" },
  "parallax": { "background": 0.45, "midground": 1, "foreground": 1.25 },
  "primitives": [],
  "layers": {
    "background": [
      { "kind": "rect", "x": -200, "y": 0, "w": 1680, "h": 720,
        "fill": { "gradient": "linear", "x0": 0, "y0": 0, "x1": 0, "y1": 720,
          "stops": [
            { "at": 0,    "color": "#dde8e7" },
            { "at": 0.58, "color": "#a8c0bb" },
            { "at": 0.59, "color": "#88664e" },
            { "at": 1,    "color": "#5b3f31" }
          ] } }
    ],
    "midground": [
      { "kind": "roundedRect", "x": 720, "y": 445, "w": 400, "h": 115, "r": 24,
        "fill": "#80614f",
        "shadow": { "blur": 18, "offsetY": 8, "color": "rgba(20,12,8,0.32)" } }
    ],
    "foreground": [
      { "kind": "rect", "x": -100, "y": 684, "w": 1480, "h": 36,
        "fill": { "gradient": "linear", "x0": 0, "y0": 684, "x1": 0, "y1": 720,
          "stops": [
            { "at": 0, "color": "rgba(30, 42, 42, 0.28)" },
            { "at": 1, "color": "rgba(30, 42, 42, 0)" }
          ] } }
    ]
  }
}
```

Always extend background rects from `x = -200, w = 1680` (instead of `x = 0, w = 1280`) so parallax pan doesn't reveal empty canvas at the edges.

### 3 — Atmospheric haze (background depth)

Add a translucent cool-blue band high on the wall in the background layer. Costs one rect, sells distance instantly.

```json
{ "kind": "rect", "x": -200, "y": 0, "w": 1680, "h": 240,
  "fill": { "gradient": "linear", "x0": 0, "y0": 0, "x1": 0, "y1": 240,
    "stops": [
      { "at": 0, "color": "rgba(180, 198, 210, 0.55)" },
      { "at": 1, "color": "rgba(180, 198, 210, 0)" }
    ] } }
```

### 4 — Contact shadow that follows z

Characters MUST start with a contact shadow whose `rx`/`ry` and alpha scale down with z. This is what makes the depth slider feel right.

```json
{ "kind": "ellipse", "cx": 0, "cy": 14,
  "rx": "92 * (1 - clamp(z * 0.0008, 0, 0.35))",
  "ry": "25 * (1 - clamp(z * 0.0008, 0, 0.35))",
  "fill": { "gradient": "radial",
    "x0": 0, "y0": 14, "r0": 0, "x1": 0, "y1": 14, "r1": 92,
    "stops": [
      { "at": 0,    "color": "rgba(20, 18, 16, ${0.34 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
      { "at": 0.72, "color": "rgba(20, 18, 16, ${0.16 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
      { "at": 1,    "color": "rgba(20, 18, 16, 0)" }
    ] } }
```

### 5 — Soft drop shadow on furniture

For midground props that should pop off the wall:

```json
{ "kind": "rect", "x": 760, "y": 365, "w": 300, "h": 140, "fill": "#6d4d3f",
  "shadow": { "blur": 18, "offsetY": 8, "color": "rgba(20,12,8,0.32)" } }
```

### 6 — Animated effect (radial halo + star burst)

```json
{ "kind": "circle", "cx": 0, "cy": 0, "r": "60 + progress * 90",
  "fill": { "gradient": "radial",
    "x0": 0, "y0": 0, "r0": 0,
    "x1": 0, "y1": 0, "r1": "60 + progress * 90",
    "stops": [
      { "at": 0,    "color": "rgba(255, 246, 196, ${0.7 * (1 - progress)})" },
      { "at": 0.55, "color": "rgba(255, 213, 88,  ${0.45 * (1 - progress)})" },
      { "at": 1,    "color": "rgba(255, 196, 90, 0)" }
    ] } },
{ "kind": "starBurst", "cx": 0, "cy": 0, "spikes": 12,
  "outer": "90 + progress * 80", "inner": 34,
  "rotation": "progress * PI",
  "fill":   "rgba(255, 213, 88, ${1 - progress})",
  "stroke": "rgba(198, 75, 58, ${1 - progress})",
  "lineWidth": 8 }
```

### 7 — Clip to silhouette

Limit a face highlight to the head circle so it doesn't bleed onto hair or background.

```json
{ "kind": "clip",
  "shape": { "kind": "circle", "cx": 0, "cy": -310, "r": 70 },
  "children": [
    { "kind": "circle", "cx": -22, "cy": -334, "r": 24,
      "fill": "rgba(255, 246, 230, 0.55)" }
  ] }
```

### 8 — Facial features (nose, lips, jaw, cheeks, ears, eyes)

The single biggest jump from "Flash MX" to "cel-shading" is putting actual features on the face instead of leaving it a flat skin circle.

```json
// Nose — slim shadow polygon + tip highlight + bridge stroke
{ "kind": "polygon", "points": [
  { "x": -3, "y": -298 }, { "x": -6, "y": -278 },
  { "x":  0, "y": -274 }, { "x":  6, "y": -278 },
  { "x":  3, "y": -298 }
], "fill": "rgba(60, 30, 20, 0.18)" },
{ "kind": "ellipse", "cx": 0, "cy": -278, "rx": 4, "ry": 2,
  "fill": "rgba(255,246,230,0.6)" },
{ "kind": "line", "x1": -2, "y1": -296, "x2": -4, "y2": -280,
  "stroke": "rgba(0,0,0,0.25)", "lineWidth": 1 },

// Eyes — sclera + iris + pupil + highlight + lash line
{ "kind": "ellipse", "cx": -24, "cy": -302, "rx": 9, "ry": 7,
  "fill": "#fbf6ee",
  "stroke": "rgba(0,0,0,0.7)", "lineWidth": 1.2 },
{ "kind": "circle", "cx": -24, "cy": -302, "r": 5,    "fill": "#1f3a4a" },
{ "kind": "circle", "cx": -24, "cy": -302, "r": 2.4,  "fill": "#08111a" },
{ "kind": "circle", "cx": -26, "cy": -304, "r": 1.6,  "fill": "rgba(255,255,255,0.95)" },
{ "kind": "line",   "x1": -32, "y1": -307, "x2": -16, "y2": -307,
  "stroke": "#1a120c", "lineWidth": 1.5, "lineCap": "round" },

// Lips — upper arc + lower fade
{ "kind": "arc",     "cx": 0, "cy": -278, "r": 22,
  "startAngle": 0.15, "endAngle": 2.99,
  "stroke": "#2b1810", "lineWidth": 3 },
{ "kind": "ellipse", "cx": 0, "cy": -268, "rx": 12, "ry": 2.5,
  "fill": "rgba(200, 100, 90, 0.32)" },

// Cheekbone highlights
{ "kind": "ellipse", "cx": -34, "cy": -288, "rx": 8, "ry": 4, "fill": "rgba(255,255,255,0.18)" },
{ "kind": "ellipse", "cx":  34, "cy": -288, "rx": 8, "ry": 4, "fill": "rgba(255,255,255,0.18)" },

// Ears (drawn behind the head circle)
{ "kind": "ellipse", "cx": -66, "cy": -312, "rx": 9, "ry": 16,
  "fill": { "palette": "skin" }, "stroke": "rgba(0,0,0,0.45)", "lineWidth": 1.2 },
{ "kind": "ellipse", "cx":  66, "cy": -312, "rx": 9, "ry": 16,
  "fill": { "palette": "skin" }, "stroke": "rgba(0,0,0,0.45)", "lineWidth": 1.2 },

// Jaw shadow — clip to head circle so it bleeds into nothing
{ "kind": "clip",
  "shape": { "kind": "circle", "cx": 0, "cy": -310, "r": 70 },
  "children": [
    { "kind": "polygon", "points": [
      { "x": 20, "y": -270 }, { "x": 60, "y": -290 },
      { "x": 50, "y": -245 }, { "x": 10, "y": -250 }
    ], "fill": "rgba(60, 30, 20, 0.22)" }
  ] }
```

### 9 — Hair locks (no more single ellipse)

Hair as a single ellipse always reads as a wig. Split into 4–6 polygon "locks" plus the base.

```json
// base back hair
{ "kind": "ellipse", "cx": 0, "cy": -344, "rx": 72, "ry": 48,
  "startAngle": 3.14159, "endAngle": 6.28318,
  "fill": { "palette": "hair" } },
{ "kind": "ellipse", "cx": 0, "cy": -344, "rx": 72, "ry": 48,
  "startAngle": 3.14159, "endAngle": 6.28318,
  "fill": { "gradient": "radial",
    "x0": -10, "y0": -362, "r0": 4, "x1": 0, "y1": -344, "r1": 70,
    "stops": [
      { "at": 0,   "color": "rgba(255,255,255,0.36)" },
      { "at": 0.6, "color": "rgba(255,255,255,0)" },
      { "at": 1,   "color": "rgba(0,0,0,0.3)" }
    ] } },

// fringe locks — 5 slanted polygons across the forehead
{ "kind": "polygon", "points": [
  { "x": -58, "y": -340 }, { "x": -42, "y": -300 },
  { "x": -30, "y": -296 }, { "x": -56, "y": -334 }
], "fill": { "palette": "hair" }, "stroke": "rgba(0,0,0,0.5)", "lineWidth": 1.1 }
// …4 more
```

### 10 — Clothing wrinkles + outline strokes

Cel-shading is essentially "base color + flat shadow polygon + outline stroke" per cloth piece. Keep wrinkles few but expressive — 2–3 strokes per limb is enough.

```json
// torso base + outline
{ "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38,
  "fill": { "palette": "body" } },
// linear key light
{ "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38,
  "fill": { "gradient": "linear", "x0": -58, "y0": -245, "x1": 58, "y1": -40,
    "stops": [
      { "at": 0,    "color": "rgba(255,255,255,0.2)" },
      { "at": 0.45, "color": "rgba(255,255,255,0)" },
      { "at": 1,    "color": "rgba(0,0,0,0.28)" }
    ] } },
// outline silhouette
{ "kind": "roundedRect", "x": -58, "y": -245, "w": 116, "h": 205, "r": 38,
  "stroke": "rgba(0,0,0,0.55)", "lineWidth": 1.6 },
// wrinkle hints — 2 slanted dark lines
{ "kind": "line", "x1": -30, "y1": -120, "x2": -10, "y2": -90,
  "stroke": "rgba(0,0,0,0.25)", "lineWidth": 2, "lineCap": "round" },
{ "kind": "line", "x1": 30,  "y1": -120, "x2": 10,  "y2": -90,
  "stroke": "rgba(0,0,0,0.25)", "lineWidth": 2, "lineCap": "round" }
```

Note that `rect` and `roundedRect` now accept BOTH `fill` and `stroke` simultaneously — emit two copies (base color, then outline-only with `stroke` no `fill`) OR one combined primitive.

### 11 — Multi-action character

Every character should support `idle / walking / attack / defend / victory` minimum. Use `when: "action == xxx"` to gate each pose. The same arm primitive can be reused in different transforms:

```json
// idle: arms hang naturally, micro breathing sway
{ "when": "action in [idle, defend]", "kind": "transform",
  "translate": { "x": 57, "y": -210 },
  "rotate":    "0.04 + sin(time * 1.4) * 0.02",
  "children": [
    { "kind": "roundedRect", "x": -18, "y": 0, "w": 36, "h": 80, "r": 18,
      "fill": { "palette": "body", "darken": 18 } },
    { "kind": "roundedRect", "x": -18, "y": 0, "w": 36, "h": 80, "r": 18,
      "stroke": "rgba(0,0,0,0.55)", "lineWidth": 1.4 },
    { "kind": "circle", "cx": 0, "cy": 142, "r": 12,
      "fill": { "palette": "skin" },
      "stroke": "rgba(0,0,0,0.55)", "lineWidth": 1.2 }
  ] },

// attack: right arm thrusts forward, "punch" motion line
{ "when": "action == attack", "kind": "transform",
  "translate": { "x": 50, "y": -200 },
  "rotate":    -1.55,
  "children": [
    { "kind": "roundedRect", "x": -16, "y": 0, "w": 32, "h": 145, "r": 16,
      "fill": { "palette": "body", "darken": 30 },
      "stroke": "rgba(0,0,0,0.55)", "lineWidth": 1.4 },
    { "kind": "circle", "cx": 0, "cy": 160, "r": 16,
      "fill": { "palette": "skin" },
      "stroke": "rgba(0,0,0,0.55)", "lineWidth": 1.4 },
    { "kind": "line", "x1": 0, "y1": 14, "x2": 0, "y2": -40,
      "stroke": "rgba(255,220,120,0.5)", "lineWidth": 4, "lineCap": "round" }
  ] },

// walking: sin-swing as before
{ "when": "action == walking", "kind": "transform",
  "translate": { "x": 57, "y": -195 },
  "rotate":    "sin(time * 8) * 0.32",
  "children": [
    { "kind": "roundedRect", "x": -18, "y": 0, "w": 36, "h": 128, "r": 18,
      "fill": { "palette": "body", "darken": 28 },
      "stroke": "rgba(0,0,0,0.55)", "lineWidth": 1.4 }
  ] }
```

Don't forget to declare the action set in metadata:

```json
"metadata": {
  ...
  "actions": ["idle", "walking", "attack", "defend", "victory"]
}
```

## Validation checklist before emitting

1. `shape.primitives` is an array (may be empty when `layers` is populated for a scene).
2. Every numeric field is either a number or a parseable expression (only `+ - * / %`, identifiers, numbers, functions, parens).
3. Every `palette` reference key exists in `metadata.palette`.
4. Every `when` clause matches one of the four supported forms.
5. **Character (mandatory cel-shading bar)**:
   - at least one `gradient` fill on the torso
   - a contact-shadow ellipse with `z`-aware `rx`/`ry`
   - outline `stroke` on torso + limbs + head (silhouette read)
   - ≥ 4 hair-lock polygons (front fringe / spiky tips)
   - facial features: nose polygon, lip arc, jaw shadow polygon clipped to head, ear ovals, eye sclera + iris + pupil + lash line
   - shoes with rounded toe + top sheen
   - ≥ 4 actions declared in `metadata.actions` AND gated via `when: "action == xxx"` in the shape (must include `idle`, `walking`, plus 2 of: `attack`/`defend`/`victory`/`punch`/`kick`)
   - aim for ~100 primitives total (the engine handles it)
6. **Scene**: contains a `layers` map with all three keys populated AND a `parallax` map, AND its background rect overshoots ±200 px on x.
7. **Prop**: contains at least one gradient OR shadow modifier.
8. For effects: `progress` only appears in expression contexts, never as a literal field name.
9. For characters: include at least one `text` primitive with `text: "${name}"` for the name plate (optional but expected by reviewers).
