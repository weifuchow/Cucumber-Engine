# Procedural Shape Reference

Visual procedural assets describe their geometry as a list of declarative primitives stored at `metadata.shape`. The Cucumber Engine renderer is a pure interpreter — there is no code path that draws an asset without `shape`.

Canonical TypeScript definition lives in `src/engine/proceduralShape.ts`. Read it for the authoritative type. This file is a flat author-facing summary.

## Top-level shape

```ts
interface ProceduralShape {
  scale?: number;                     // optional uniform scaling applied to all primitives
  preview?: { fit?: "contain" | "center" | "bottom"; scale?: number };  // guides thumbnail layout
  primitives: ConditionalPrimitive[];
}
```

`preview` hints what the gallery thumbnail does:
- `"bottom"` — center horizontally, anchor at bottom (used for characters)
- `"center"` — center at canvas center (default for props/effects)
- `"contain"` — scale to fit, used for scenes (full-size backgrounds)

## Numeric expressions

Every numeric field accepts either a literal `number` or a string expression. Expressions can reference state variables:

| State | Available in | Range |
|---|---|---|
| `progress` | effect shapes | `0..1` over `defaultDuration` |
| `expression` | character shapes (`when` only) | `"neutral" \| "angry" \| "soft" \| "sad" \| "surprised" \| ...` |
| `name` | text primitive `${name}` interpolation | from `metadata.displayName` or `name` |

Operators: `+ - * / %`, parentheses, unary `-`.
Constants: `PI`, `TAU` (=2π), `E`.
Functions: `cos sin tan abs min max sqrt pow floor ceil round clamp(v, lo, hi) lerp(a, b, t)`.

Examples:
- `"90 + progress * 80"` — outer radius grows over time
- `"progress * PI"` — half rotation over the effect's lifetime
- `"cos(angle) * r"` — polar-to-cartesian inside vertex lists
- `"lerp(20, 80, progress)"` — interpolation helper

## Color specs

```ts
type ColorSpec =
  | string                                                    // CSS color, may contain ${expr} interpolation
  | { palette: string; darken?: number }                      // ref into manifest.metadata.palette; darken subtracts the value from each RGB channel
  | { gradient: "linear"; x0, y0, x1, y1; stops: [{at, color}] }
  | { gradient: "radial"; x0, y0, r0, x1, y1, r1; stops: [{at, color}] }
```

`${expr}` works inside color strings — useful for alpha-fade: `"rgba(255, 213, 88, ${1 - progress})"`. The inner expression is evaluated as a number.

Palette refs read from `manifest.metadata.palette`. Standard keys: `body`, `skin`, `hair`, plus any custom key. `darken: 32` subtracts 32 from each of R/G/B (so arms appear slightly darker than the torso).

## Conditional `when`

Every primitive can carry `when: "<expr>"` that gates whether it draws. Supported forms:
- `key == value` / `key != value`
- `key in [a, b, c]` / `key not in [a, b, c]`

Currently only string state values are matched. The most useful key is `expression` on character shapes.

## Primitives

```ts
{ kind: "roundedRect", x, y, w, h, r; fill }
{ kind: "rect",        x, y, w, h; fill }
{ kind: "circle",      cx, cy, r; fill?; stroke?; lineWidth? }
{ kind: "ellipse",     cx, cy, rx, ry, rotation?, startAngle?, endAngle?; fill?; stroke?; lineWidth? }
{ kind: "line",        x1, y1, x2, y2; stroke; lineWidth; lineCap? }
{ kind: "arc",         cx, cy, r, startAngle, endAngle; fill?; stroke?; lineWidth? }
{ kind: "polygon",     points: [{x, y}]; fill?; stroke?; lineWidth?; closed? }
{ kind: "starBurst",   cx, cy, spikes: number, outer, inner, rotation?; fill?; stroke?; lineWidth? }
{ kind: "text",        x, y, text, fill, size; align?; font? }
{ kind: "transform",   translate?, rotate?, scale?; children: ConditionalPrimitive[] }
```

Notes:
- `ellipse` angles follow Canvas2D: `startAngle = PI, endAngle = 2*PI` draws the lower half (a "dome" sitting on top when used at y < 0).
- `arc` is fill-or-stroke; when stroked it uses a round line cap automatically.
- `text` supports `${name}` and `${expr}` interpolation in the `text` string.
- `transform` is the only nesting primitive — use it for rotation/translation around a sub-group of children.

## Coordinate conventions

Different asset types use different natural coordinate spaces:

| Type | Origin | Typical extent | Notes |
|---|---|---|---|
| character | feet (anchor) at `(0, 0)` | head ~ `y = -380`, name plate ~ `y = -395` | y is up-negative inside the body; rendered after translate to character world position |
| prop | center at `(0, 0)` | symmetric around origin | rendered after translate to prop world position |
| effect | center at `(0, 0)` | radial pattern around origin | rendered after translate to effect world position |
| scene | top-left at `(0, 0)` | full canvas `1280 × 720` | rendered before camera transform |

For characters specifically, the standard "human body" coordinates used in the engine's sample data are:
- ground shadow ellipse at `(0, 14)` rx=92 ry=25
- torso roundedRect at `(-58, -245)` w=116 h=205
- head circle at `(0, -310)` r=70
- hair ellipse `(0, -344)` rx=72 ry=44 (lower-half-only with `startAngle: PI, endAngle: 2*PI`)
- eyes at `(±24, -302)` r=5
- name plate `(-72, -395)` w=144 h=32 with text at `(0, -372)` align center

Use these as the anchor for new characters — change palette + add/replace accessories rather than redrawing the body from scratch.

## Quick recipes

**Add an accessory** (e.g. glasses on a character):

```json
{ "kind": "circle", "cx": -24, "cy": -302, "r": 11, "stroke": "#1a1815", "lineWidth": 3 },
{ "kind": "circle", "cx":  24, "cy": -302, "r": 11, "stroke": "#1a1815", "lineWidth": 3 },
{ "kind": "line",   "x1": -13, "y1": -302, "x2": 13, "y2": -302, "stroke": "#1a1815", "lineWidth": 3 }
```

**Expression-dependent mouth**:

```json
{ "when": "expression == sad", "kind": "arc", "cx": 0, "cy": -268, "r": 25, "startAngle": 3.5186, "endAngle": 5.906, "stroke": "#2b2420", "lineWidth": 5 },
{ "when": "expression not in [sad, soft, surprised]", "kind": "line", "x1": -20, "y1": -276, "x2": 20, "y2": -276, "stroke": "#2b2420", "lineWidth": 5, "lineCap": "round" }
```

**Animated effect** (radial burst that grows + fades):

```json
{ "kind": "starBurst", "cx": 0, "cy": 0, "spikes": 12,
  "outer": "90 + progress * 80",
  "inner": 34,
  "rotation": "progress * PI",
  "fill":   "rgba(255, 213, 88, ${1 - progress})",
  "stroke": "rgba(198, 75, 58, ${1 - progress})",
  "lineWidth": 8 }
```

**Scene background with floor gradient**:

```json
{ "kind": "rect", "x": 0, "y": 0, "w": 1280, "h": 720,
  "fill": { "gradient": "linear", "x0": 0, "y0": 0, "x1": 0, "y1": 720,
    "stops": [
      { "at": 0,    "color": "#d8e9e5" },
      { "at": 0.58, "color": "#bed4cf" },
      { "at": 0.59, "color": "#88664e" },
      { "at": 1,    "color": "#5f4234" }
    ] } }
```

## Validation checklist before emitting

1. `shape.primitives` is a non-empty array.
2. Every numeric field is either a number or a parseable expression (only `+ - * / %`, identifiers, numbers, functions, parens).
3. Every `palette` reference key exists in `metadata.palette`.
4. Every `when` clause matches one of the four supported forms.
5. For effects: `progress` only appears in expression contexts, never as a literal field name.
6. For characters: include at least one `text` primitive with `text: "${name}"` for the name plate (optional but expected by reviewers).
