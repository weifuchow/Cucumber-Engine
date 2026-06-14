// Procedural shape language. Assets describe their geometry as a list of
// declarative primitives, decoupled from any drawing code. The renderer is a
// pure interpreter, so adding a new character/prop/effect/scene is a
// manifest-only change.
//
// Numeric fields accept either a literal `number` or a string expression that
// references `state` variables (e.g. `"progress * PI"`). Color strings support
// `${expr}` interpolation for state-dependent values like alpha.
//
// Supported primitives: roundedRect, rect, circle, ellipse, line, arc, polygon,
// starBurst, text, transform (group with translate/rotate/scale + children),
// clip (use a shape as clipping region for its children).
//
// Any primitive may carry an optional `shadow: { blur, offsetX?, offsetY?, color }`
// modifier — the renderer sets `ctx.shadowBlur/Color/Offset` for that one draw
// call to create a soft drop shadow without an extra primitive.
//
// `when` clauses (per primitive) gate drawing on simple state predicates:
//   `key == value`, `key != value`, `key in [a, b]`, `key not in [a, b]`.
//
// Scene shapes may use the multi-layer form `{ layers: { background, midground,
// foreground }, parallax: { background, midground, foreground } }`. The
// PreviewCanvas walks each layer in z-order, applying the matching parallax
// factor to the camera transform so a single camera pan reads as depth.

export type NumExpr = number | string;

export type ColorSpec =
  | string
  | { palette: string; darken?: number }
  | {
      gradient: "linear";
      x0: NumExpr;
      y0: NumExpr;
      x1: NumExpr;
      y1: NumExpr;
      stops: Array<{ at: number; color: string }>;
    }
  | {
      gradient: "radial";
      x0: NumExpr;
      y0: NumExpr;
      r0: NumExpr;
      x1: NumExpr;
      y1: NumExpr;
      r1: NumExpr;
      stops: Array<{ at: number; color: string }>;
    };

export interface ShadowSpec {
  blur: NumExpr;
  offsetX?: NumExpr;
  offsetY?: NumExpr;
  color: string;
}

/**
 * Rim light overlay — draws a directional highlight on the silhouette edge
 * of the primitive, simulating light wrapping around a 3D form. The shape's
 * own outline is unaffected; this stroke is drawn AFTER the main fill+stroke
 * with a linear-gradient stroke that fades from `color` to transparent
 * across the shape's bounding box, oriented along `fromAngle`.
 *
 * Use cases: separating characters from background (Hollow Knight reads),
 * the bright cyan/orange wrap that makes Spirited Away figures pop.
 *
 *   fromAngle — radians; 0 = light from screen-left, PI/2 = from above
 *   color     — usually a warm white at low alpha, e.g. "rgba(255,235,180,0.75)"
 *   width     — stroke width of the rim, typically 1.5–3 px
 *   falloff   — 0..1; how quickly the gradient fades. 0.3 = sharp rim,
 *               0.7 = soft wrap
 */
export interface RimLightSpec {
  color: string;
  fromAngle?: NumExpr;
  width?: NumExpr;
  falloff?: number;
}

/**
 * One bone of a `skinnedMesh`'s self-contained mini-skeleton. Holds the
 * REST-pose *local* transform (relative to `parent`); the renderer composes
 * the animated world transform per frame by walking the parent chain and
 * adding the `bone_<name>_*` animation deltas from shape state.
 *
 * `name` / `parent` are pre-sanitized (snake_case) so they match the state
 * keys emitted by `evaluateSpineBones`. The root bone omits `parent`.
 */
export interface SkinnedBone {
  name: string;
  parent?: string;
  x: number;
  y: number;
  rotation: number; // degrees, Spine convention
  scaleX: number;
  scaleY: number;
}

/**
 * One weighted bone binding of a mesh vertex. `(x, y)` is the vertex
 * position expressed in `bone`'s LOCAL space (Spine space, Y-up); `weight`
 * is the blend weight. A rigid (non-weighted) vertex is a single binding
 * with `weight: 1`.
 */
export interface SkinnedVertexBinding {
  bone: string;
  x: number;
  y: number;
  weight: number;
}

/** A mesh vertex = one or more weighted bone bindings (their weights sum ~1). */
export type SkinnedVertex = SkinnedVertexBinding[];

export type Primitive =
  | { kind: "roundedRect"; x: NumExpr; y: NumExpr; w: NumExpr; h: NumExpr; r: NumExpr; fill?: ColorSpec; stroke?: ColorSpec; lineWidth?: NumExpr; shadow?: ShadowSpec; rimLight?: RimLightSpec }
  | { kind: "rect"; x: NumExpr; y: NumExpr; w: NumExpr; h: NumExpr; fill?: ColorSpec; stroke?: ColorSpec; lineWidth?: NumExpr; shadow?: ShadowSpec; rimLight?: RimLightSpec }
  | {
      kind: "circle";
      cx: NumExpr;
      cy: NumExpr;
      r: NumExpr;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      shadow?: ShadowSpec;
      rimLight?: RimLightSpec;
    }
  | {
      kind: "ellipse";
      cx: NumExpr;
      cy: NumExpr;
      rx: NumExpr;
      ry: NumExpr;
      rotation?: NumExpr;
      startAngle?: NumExpr;
      endAngle?: NumExpr;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      shadow?: ShadowSpec;
      rimLight?: RimLightSpec;
    }
  | {
      kind: "line";
      x1: NumExpr;
      y1: NumExpr;
      x2: NumExpr;
      y2: NumExpr;
      stroke: ColorSpec;
      lineWidth: NumExpr;
      lineCap?: CanvasLineCap;
      shadow?: ShadowSpec;
    }
  | {
      kind: "arc";
      cx: NumExpr;
      cy: NumExpr;
      r: NumExpr;
      startAngle: NumExpr;
      endAngle: NumExpr;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      shadow?: ShadowSpec;
    }
  | {
      kind: "polygon";
      points: Array<{ x: NumExpr; y: NumExpr }>;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      closed?: boolean;
      shadow?: ShadowSpec;
      rimLight?: RimLightSpec;
    }
  | {
      kind: "starBurst";
      cx: NumExpr;
      cy: NumExpr;
      spikes: number;
      outer: NumExpr;
      inner: NumExpr;
      rotation?: NumExpr;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      shadow?: ShadowSpec;
    }
  | {
      kind: "text";
      x: NumExpr;
      y: NumExpr;
      text: string;
      fill: ColorSpec;
      size: NumExpr;
      align?: CanvasTextAlign;
      font?: string;
      shadow?: ShadowSpec;
    }
  | {
      kind: "transform";
      translate?: { x: NumExpr; y: NumExpr };
      rotate?: NumExpr;
      scale?: NumExpr | { x: NumExpr; y: NumExpr };
      /** Apply Canvas filter (e.g. blur) to children. Use `blurPx` for the common case. */
      blurPx?: NumExpr;
      children: ConditionalPrimitive[];
    }
  | {
      kind: "clip";
      shape: ClipShape;
      children: ConditionalPrimitive[];
    }
  | {
      /**
       * Procedural particle emitter. Emits `count` deterministic particles
       * whose position / size / fill are derived from a per-particle
       * `seed` (0…count-1) and the existing state vocabulary (`time`,
       * `progress`, etc.).
       *
       * Use cases: 爆炸碎片, 雪花, 火星, 水滴, 樱花 — anything where
       * hand-writing 60 polygons is silly but the renderer can iterate
       * cheaply.
       *
       * The renderer evaluates each numeric field once per particle with
       * `seed` and `i` (alias for seed) bound in the shape-state scope on
       * top of the inherited state, so e.g.
       *   `cx: "cos(seed * 0.6 + time) * 80"`
       * gives a horizontally-spread spray.
       *
       * Particles are simple — they support fill/stroke/lineWidth/shadow
       * but not children. For complex per-particle assemblies, wrap a
       * single `transform` per particle by hand instead.
       */
      kind: "particles";
      count: number;
      cx: NumExpr;
      cy: NumExpr;
      r: NumExpr;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      shadow?: ShadowSpec;
      /**
       * Shape of each particle. Defaults to "circle" — `r` is the radius.
       * "rect" interprets `r` as half-width / half-height (square).
       * "spark" draws a 4-spike asterisk at radius `r`.
       */
      particleShape?: "circle" | "rect" | "spark";
    }
  | {
      /**
       * Paper / film-grain noise overlay. Fills the rect (x, y, w, h) with
       * pseudo-random monochromatic noise alpha-blended over whatever has
       * been drawn underneath.
       *
       * Implementation uses a tiled noise texture cached per CanvasRenderingContext2D,
       * so the cost is bounded regardless of overlay size. Tile size is fixed
       * at 128×128 → ~16 KB ImageData per ctx, rendered once.
       *
       * Purpose: kills the "vector / SVG" look that pure flat fills produce.
       * One full-canvas noise rect at alpha 0.10–0.18 is enough to shift
       * the read from Flash-vector → painterly.
       *
       *   scale     — 0.3 (chunky grain) … 2.5 (fine grit). Default 1.
       *   alpha     — 0..1, blend strength. Default 0.15.
       *   blendMode — Canvas globalCompositeOperation. Default "multiply".
       *               Try "soft-light" for a warmer painterly feel.
       *   seed      — integer; freezes the pattern so it doesn't shimmer.
       */
      kind: "noise";
      x: NumExpr;
      y: NumExpr;
      w: NumExpr;
      h: NumExpr;
      scale?: NumExpr;
      alpha?: NumExpr;
      blendMode?: GlobalCompositeOperation;
      seed?: number;
    }
  | {
      /**
       * Hand-drawn brush stroke — renders a path as 3–5 slightly-offset
       * thin strokes with alpha variation, giving the appearance of a
       * cel-animation marker / brush instead of a clean vector line.
       *
       * Same path API as `polygon` (open or closed via `closed`), plus:
       *   passes      — 3..6, number of offset strokes. Default 4.
       *   jitter      — px max offset perpendicular to path. Default 1.2.
       *   widthRange  — [min, max] stroke width per pass. Default [0.6, 1.6].
       *   alphaRange  — [min, max] stroke alpha per pass. Default [0.4, 0.95].
       *   seed        — deterministic offset/width/alpha pattern.
       *
       * Use case: replace `polygon stroke` on hair locks / scars / cheek
       * lines with brush — instantly lifts the asset off the SVG plane.
       */
      kind: "brush";
      points: Array<{ x: NumExpr; y: NumExpr }>;
      stroke: ColorSpec;
      closed?: boolean;
      passes?: number;
      jitter?: NumExpr;
      widthRange?: [number, number];
      alphaRange?: [number, number];
      seed?: number;
    }
  | {
      /**
       * Weighted skeletal mesh — the genuine Spine "mesh deform". Each vertex
       * is bound to one or more bones in `bones`; at draw time the renderer
       * computes every bone's animated world transform from the
       * `bone_<name>_rotate / _x / _y / _scale_x / _scale_y` state keys
       * (injected by `evaluateSpineBones`) and skins each vertex:
       *
       *   world(v) = Σ_i  weight_i · boneWorld_i · (v.x_i, v.y_i)
       *
       * so rotating a bone bends the mesh through it instead of sliding a
       * rigid rectangle. This is what lifts an imported Spine character off
       * the "stack of rotating boxes" Flash read that the region-attachment
       * path produces.
       *
       * Coordinates are authored in Spine space (Y-up); the renderer flips Y
       * once when it emits the final canvas path, matching `spineImporter`.
       *
       * `bones` is self-contained: every bone referenced by a vertex plus its
       * ancestors, each with its rest-pose local transform. Outline = the
       * first `hull` vertices (Spine convention) when provided, else all
       * vertices in order. `triangles` is retained for future texture mapping
       * but flat-color meshes render via the hull fill.
       */
      kind: "skinnedMesh";
      bones: SkinnedBone[];
      vertices: SkinnedVertex[];
      triangles?: number[];
      hull?: number;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      shadow?: ShadowSpec;
      rimLight?: RimLightSpec;
    }
  | {
      /**
       * Raster sprite — draws a bitmap (PNG) at the current transform origin.
       * This is the engine's path OFF the vector/Flash plane: a baked or
       * painted bitmap carries texture, soft edges and tonal form that
       * procedural primitives cannot. General-purpose (any asset), not tied to
       * any one character.
       *
       * Frame sequences: when `src` contains the token `{frame}` and `frames`
       * > 1, the renderer substitutes the current frame index
       * `floor(time * fps) % frames`, so a baked walk/attack loop plays from
       * state.time (and respects frameHold, which rewrites state.time).
       *
       * Image loading is async but drawShape is sync: a per-module cache lazily
       * loads in the browser (the rAF loop repaints once ready) and is
       * pre-seeded in headless tooling via `registerSpriteImage`. A missing
       * image is skipped (nothing drawn) rather than throwing.
       *
       * Anchor: `anchorX`/`anchorY` are 0..1 fractions of the draw box placed
       * at the origin. Default (0.5, 1) = bottom-center, matching a character
       * standing on the ground line.
       */
      kind: "imageSprite";
      src: string;
      frames?: number;
      fps?: NumExpr;
      w: NumExpr;
      h: NumExpr;
      anchorX?: NumExpr;
      anchorY?: NumExpr;
      shadow?: ShadowSpec;
    };

export type ClipShape =
  | { kind: "rect"; x: NumExpr; y: NumExpr; w: NumExpr; h: NumExpr }
  | { kind: "roundedRect"; x: NumExpr; y: NumExpr; w: NumExpr; h: NumExpr; r: NumExpr }
  | { kind: "circle"; cx: NumExpr; cy: NumExpr; r: NumExpr }
  | { kind: "ellipse"; cx: NumExpr; cy: NumExpr; rx: NumExpr; ry: NumExpr; rotation?: NumExpr };

export type ConditionalPrimitive = Primitive & { when?: string };

export interface ShapePreviewHint {
  fit?: "contain" | "bottom" | "center";
  scale?: number;
}

export type SceneLayerKey = "background" | "midground" | "foreground";

export interface ProceduralShape {
  scale?: number;
  preview?: ShapePreviewHint;
  primitives: ConditionalPrimitive[];
  /**
   * Optional multi-layer split for scenes. When present, the PreviewCanvas
   * walks each layer in bg→mid→fg order with its own parallax factor; the
   * combined output is the visual scene. `primitives` is still used as a
   * fallback for assets that pre-date the layer split.
   */
  layers?: Partial<Record<SceneLayerKey, ConditionalPrimitive[]>>;
  /**
   * Parallax factor per layer relative to camera translation. 1.0 = move with
   * the camera 1:1 (default). <1 = background (slower than camera). >1 =
   * foreground (faster than camera).
   */
  parallax?: Partial<Record<SceneLayerKey, number>>;
}

export type ShapeState = Record<string, string | number | boolean | undefined>;

export const DEFAULT_PARALLAX: Record<SceneLayerKey, number> = {
  background: 0.5,
  midground: 1,
  foreground: 1.25,
};

export function getSceneLayerPrimitives(
  shape: ProceduralShape,
  layer: SceneLayerKey,
): ConditionalPrimitive[] {
  const layered = shape.layers?.[layer];
  if (layered && layered.length) return layered;
  // Back-compat: if no layers declared, the legacy flat `primitives` array
  // counts as midground only.
  if (!shape.layers && layer === "midground") return shape.primitives;
  return [];
}

export function getParallaxFactor(shape: ProceduralShape, layer: SceneLayerKey): number {
  return shape.parallax?.[layer] ?? DEFAULT_PARALLAX[layer];
}

export function hasSceneLayers(shape: ProceduralShape): boolean {
  return Boolean(shape.layers && (shape.layers.background?.length || shape.layers.midground?.length || shape.layers.foreground?.length));
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ProceduralShape,
  palette: Record<string, string>,
  state: ShapeState,
) {
  ctx.save();
  if (shape.scale && shape.scale !== 1) ctx.scale(shape.scale, shape.scale);
  for (const prim of shape.primitives) drawConditional(ctx, prim, palette, state);
  ctx.restore();
}

/**
 * Draw a specific scene layer (background / midground / foreground). Falls
 * back to legacy flat `primitives` when the shape pre-dates the layer split.
 */
export function drawSceneLayer(
  ctx: CanvasRenderingContext2D,
  shape: ProceduralShape,
  palette: Record<string, string>,
  state: ShapeState,
  layer: SceneLayerKey,
) {
  const prims = getSceneLayerPrimitives(shape, layer);
  if (!prims.length) return;
  ctx.save();
  if (shape.scale && shape.scale !== 1) ctx.scale(shape.scale, shape.scale);
  for (const prim of prims) drawConditional(ctx, prim, palette, state);
  ctx.restore();
}

function drawConditional(
  ctx: CanvasRenderingContext2D,
  prim: ConditionalPrimitive,
  palette: Record<string, string>,
  state: ShapeState,
) {
  if (!evaluateWhen(prim.when, state)) return;
  const shadow = (prim as { shadow?: ShadowSpec }).shadow;
  if (shadow) {
    ctx.save();
    ctx.shadowBlur = evalNum(shadow.blur, state);
    ctx.shadowOffsetX = evalNum(shadow.offsetX ?? 0, state);
    ctx.shadowOffsetY = evalNum(shadow.offsetY ?? 0, state);
    ctx.shadowColor = interpolate(shadow.color, state);
    drawPrimitive(ctx, prim, palette, state);
    ctx.restore();
  } else {
    drawPrimitive(ctx, prim, palette, state);
  }
  // RimLight is overlaid AFTER the main fill+stroke so it sits on the
  // silhouette edge, independent of the shadow path above.
  const rim = (prim as { rimLight?: RimLightSpec }).rimLight;
  if (rim) drawRimLight(ctx, prim, rim, state);
}

function drawPrimitive(
  ctx: CanvasRenderingContext2D,
  prim: Primitive,
  palette: Record<string, string>,
  state: ShapeState,
) {
  switch (prim.kind) {
    case "roundedRect": {
      ctx.beginPath();
      ctx.roundRect(
        evalNum(prim.x, state),
        evalNum(prim.y, state),
        evalNum(prim.w, state),
        evalNum(prim.h, state),
        evalNum(prim.r, state),
      );
      strokeFill(ctx, prim, palette, state);
      return;
    }
    case "rect": {
      ctx.beginPath();
      ctx.rect(
        evalNum(prim.x, state),
        evalNum(prim.y, state),
        evalNum(prim.w, state),
        evalNum(prim.h, state),
      );
      strokeFill(ctx, prim, palette, state);
      return;
    }
    case "circle": {
      ctx.beginPath();
      ctx.arc(evalNum(prim.cx, state), evalNum(prim.cy, state), evalNum(prim.r, state), 0, Math.PI * 2);
      strokeFill(ctx, prim, palette, state);
      return;
    }
    case "ellipse": {
      ctx.beginPath();
      ctx.ellipse(
        evalNum(prim.cx, state),
        evalNum(prim.cy, state),
        evalNum(prim.rx, state),
        evalNum(prim.ry, state),
        evalNum(prim.rotation ?? 0, state),
        evalNum(prim.startAngle ?? 0, state),
        evalNum(prim.endAngle ?? Math.PI * 2, state),
      );
      strokeFill(ctx, prim, palette, state);
      return;
    }
    case "line": {
      ctx.beginPath();
      ctx.moveTo(evalNum(prim.x1, state), evalNum(prim.y1, state));
      ctx.lineTo(evalNum(prim.x2, state), evalNum(prim.y2, state));
      ctx.strokeStyle = resolveColor(ctx, prim.stroke, palette, state);
      ctx.lineWidth = evalNum(prim.lineWidth, state);
      ctx.lineCap = prim.lineCap ?? "butt";
      ctx.stroke();
      return;
    }
    case "arc": {
      ctx.beginPath();
      ctx.arc(
        evalNum(prim.cx, state),
        evalNum(prim.cy, state),
        evalNum(prim.r, state),
        evalNum(prim.startAngle, state),
        evalNum(prim.endAngle, state),
      );
      if (prim.fill) {
        ctx.fillStyle = resolveColor(ctx, prim.fill, palette, state);
        ctx.fill();
      }
      if (prim.stroke) {
        ctx.strokeStyle = resolveColor(ctx, prim.stroke, palette, state);
        ctx.lineWidth = evalNum(prim.lineWidth ?? 1, state);
        ctx.lineCap = "round";
        ctx.stroke();
      }
      return;
    }
    case "polygon": {
      ctx.beginPath();
      prim.points.forEach((pt, i) => {
        const x = evalNum(pt.x, state);
        const y = evalNum(pt.y, state);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (prim.closed !== false) ctx.closePath();
      strokeFill(ctx, prim, palette, state);
      return;
    }
    case "starBurst": {
      const cx = evalNum(prim.cx, state);
      const cy = evalNum(prim.cy, state);
      const outer = evalNum(prim.outer, state);
      const inner = evalNum(prim.inner, state);
      const rot = evalNum(prim.rotation ?? 0, state);
      const spikes = prim.spikes;
      ctx.save();
      ctx.translate(cx, cy);
      if (rot) ctx.rotate(rot);
      ctx.beginPath();
      for (let i = 0; i < spikes; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const angle = (i / spikes) * Math.PI * 2;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      strokeFill(ctx, prim, palette, state);
      ctx.restore();
      return;
    }
    case "text": {
      ctx.fillStyle = resolveColor(ctx, prim.fill, palette, state);
      ctx.font = `${evalNum(prim.size, state)}px ${prim.font ?? "sans-serif"}`;
      ctx.textAlign = prim.align ?? "left";
      ctx.fillText(interpolate(prim.text, state), evalNum(prim.x, state), evalNum(prim.y, state));
      return;
    }
    case "transform": {
      ctx.save();
      if (prim.translate) ctx.translate(evalNum(prim.translate.x, state), evalNum(prim.translate.y, state));
      if (prim.rotate) ctx.rotate(evalNum(prim.rotate, state));
      if (prim.scale !== undefined) {
        if (typeof prim.scale === "object") {
          ctx.scale(evalNum(prim.scale.x, state), evalNum(prim.scale.y, state));
        } else {
          const s = evalNum(prim.scale, state);
          ctx.scale(s, s);
        }
      }
      // blurPx applies a Canvas filter to everything drawn under this
      // transform — used for depth-of-field on background/foreground
      // scene layers and for the soft-edge halo on glow effects.
      if (prim.blurPx !== undefined) {
        const px = evalNum(prim.blurPx, state);
        if (px > 0) ctx.filter = `blur(${px}px)`;
      }
      for (const child of prim.children) drawConditional(ctx, child, palette, state);
      ctx.restore();
      return;
    }
    case "particles": {
      const count = Math.max(0, Math.min(prim.count | 0, 500));
      const shape = prim.particleShape ?? "circle";
      for (let i = 0; i < count; i++) {
        const particleState: ShapeState = { ...state, seed: i, i };
        const cx = evalNum(prim.cx, particleState);
        const cy = evalNum(prim.cy, particleState);
        const r  = evalNum(prim.r,  particleState);
        if (!isFinite(cx) || !isFinite(cy) || !isFinite(r) || r <= 0) continue;
        if (prim.shadow) {
          ctx.save();
          ctx.shadowBlur = evalNum(prim.shadow.blur, particleState);
          ctx.shadowOffsetX = evalNum(prim.shadow.offsetX ?? 0, particleState);
          ctx.shadowOffsetY = evalNum(prim.shadow.offsetY ?? 0, particleState);
          ctx.shadowColor = interpolate(prim.shadow.color, particleState);
        }
        ctx.beginPath();
        if (shape === "circle") {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        } else if (shape === "rect") {
          ctx.rect(cx - r, cy - r, r * 2, r * 2);
        } else { // spark — 4-spike
          ctx.moveTo(cx - r, cy);
          ctx.lineTo(cx + r, cy);
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx, cy + r);
        }
        if (shape === "spark") {
          // Spark renders as strokes only — fill doesn't apply.
          ctx.strokeStyle = resolveColor(ctx, prim.stroke ?? prim.fill ?? "#fff", palette, particleState);
          ctx.lineWidth = evalNum(prim.lineWidth ?? 1.5, particleState);
          ctx.lineCap = "round";
          ctx.stroke();
        } else {
          if (prim.fill) {
            ctx.fillStyle = resolveColor(ctx, prim.fill, palette, particleState);
            ctx.fill();
          }
          if (prim.stroke) {
            ctx.strokeStyle = resolveColor(ctx, prim.stroke, palette, particleState);
            ctx.lineWidth = evalNum(prim.lineWidth ?? 1, particleState);
            ctx.stroke();
          }
        }
        if (prim.shadow) ctx.restore();
      }
      return;
    }
    case "noise": {
      drawNoise(ctx, prim, state);
      return;
    }
    case "brush": {
      drawBrush(ctx, prim, palette, state);
      return;
    }
    case "skinnedMesh": {
      drawSkinnedMesh(ctx, prim, palette, state);
      return;
    }
    case "imageSprite": {
      drawImageSprite(ctx, prim, state);
      return;
    }
    case "clip": {
      ctx.save();
      ctx.beginPath();
      const c = prim.shape;
      switch (c.kind) {
        case "rect":
          ctx.rect(evalNum(c.x, state), evalNum(c.y, state), evalNum(c.w, state), evalNum(c.h, state));
          break;
        case "roundedRect":
          ctx.roundRect(
            evalNum(c.x, state),
            evalNum(c.y, state),
            evalNum(c.w, state),
            evalNum(c.h, state),
            evalNum(c.r, state),
          );
          break;
        case "circle":
          ctx.arc(evalNum(c.cx, state), evalNum(c.cy, state), evalNum(c.r, state), 0, Math.PI * 2);
          break;
        case "ellipse":
          ctx.ellipse(
            evalNum(c.cx, state),
            evalNum(c.cy, state),
            evalNum(c.rx, state),
            evalNum(c.ry, state),
            evalNum(c.rotation ?? 0, state),
            0,
            Math.PI * 2,
          );
          break;
      }
      ctx.clip();
      for (const child of prim.children) drawConditional(ctx, child, palette, state);
      ctx.restore();
      return;
    }
  }
}

function strokeFill(
  ctx: CanvasRenderingContext2D,
  prim: { fill?: ColorSpec; stroke?: ColorSpec; lineWidth?: NumExpr },
  palette: Record<string, string>,
  state: ShapeState,
) {
  if (prim.fill) {
    ctx.fillStyle = resolveColor(ctx, prim.fill, palette, state);
    ctx.fill();
  }
  if (prim.stroke) {
    ctx.strokeStyle = resolveColor(ctx, prim.stroke, palette, state);
    ctx.lineWidth = evalNum(prim.lineWidth ?? 1, state);
    ctx.stroke();
  }
}

// Per-context cache of CanvasGradient objects. A gradient spec is "static"
// when all of its numeric fields are literals AND none of its stop colors
// contain a `${...}` interpolation; for those, we can reuse the same
// CanvasGradient object across frames instead of rebuilding it on every
// draw call. Even a modestly busy scene rebuilds dozens of gradients per
// frame without this; with it, those collapse into a single creation.
type GradientSpec = Extract<ColorSpec, { gradient: "linear" | "radial" }>;
const gradientCache = new WeakMap<CanvasRenderingContext2D, WeakMap<GradientSpec, CanvasGradient>>();

function isLiteralNum(value: NumExpr | undefined): boolean {
  return typeof value !== "string";
}

function isGradientStatic(spec: GradientSpec): boolean {
  if (!isLiteralNum(spec.x0) || !isLiteralNum(spec.y0) || !isLiteralNum(spec.x1) || !isLiteralNum(spec.y1)) return false;
  if (spec.gradient === "radial" && (!isLiteralNum(spec.r0) || !isLiteralNum(spec.r1))) return false;
  for (const stop of spec.stops) {
    if (stop.color.includes("${")) return false;
  }
  return true;
}

function resolveColor(
  ctx: CanvasRenderingContext2D,
  spec: ColorSpec,
  palette: Record<string, string>,
  state: ShapeState,
): string | CanvasGradient {
  if (typeof spec === "string") return interpolate(spec, state);
  if ("palette" in spec) {
    // State takes precedence — this is how Spine slot color animation
    // overrides the manifest's rest-pose palette. The painter merges
    // `slot_<name>_color` keys into state from the spine animation
    // evaluator; if one exists for this palette name, it wins. Otherwise
    // fall back to the manifest palette dict.
    const stateOverride = state[spec.palette];
    const base = (typeof stateOverride === "string" && stateOverride) ? stateOverride : (palette[spec.palette] ?? "#000000");
    return spec.darken ? darken(base, spec.darken) : base;
  }

  // Try the static gradient cache first — most scene/character gradients
  // never change per frame, so this is the dominant case.
  let ctxCache = gradientCache.get(ctx);
  if (!ctxCache) {
    ctxCache = new WeakMap();
    gradientCache.set(ctx, ctxCache);
  }
  if (isGradientStatic(spec)) {
    const cached = ctxCache.get(spec);
    if (cached) return cached;
  }

  if (spec.gradient === "linear") {
    const g = ctx.createLinearGradient(
      evalNum(spec.x0, state),
      evalNum(spec.y0, state),
      evalNum(spec.x1, state),
      evalNum(spec.y1, state),
    );
    for (const stop of spec.stops) g.addColorStop(stop.at, interpolate(stop.color, state));
    if (isGradientStatic(spec)) ctxCache.set(spec, g);
    return g;
  }
  // radial
  const g = ctx.createRadialGradient(
    evalNum(spec.x0, state),
    evalNum(spec.y0, state),
    evalNum(spec.r0, state),
    evalNum(spec.x1, state),
    evalNum(spec.y1, state),
    evalNum(spec.r1, state),
  );
  for (const stop of spec.stops) g.addColorStop(stop.at, interpolate(stop.color, state));
  if (isGradientStatic(spec)) ctxCache.set(spec, g);
  return g;
}

function darken(color: string, amount: number): string {
  if (!color.startsWith("#") || color.length !== 7) return color;
  const n = Number.parseInt(color.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - amount);
  const g = Math.max(0, ((n >> 8) & 255) - amount);
  const b = Math.max(0, (n & 255) - amount);
  return `rgb(${r}, ${g}, ${b})`;
}

const notInListRe = /^\s*(\w+)\s+not\s+in\s+\[([^\]]+)\]\s*$/;
const inListRe = /^\s*(\w+)\s+in\s+\[([^\]]+)\]\s*$/;
const eqRe = /^\s*(\w+)\s*(==|!=)\s*([\w-]+)\s*$/;

function evaluateWhen(when: string | undefined, state: ShapeState): boolean {
  if (!when) return true;
  let m = when.match(notInListRe);
  if (m) {
    const list = m[2].split(",").map((s) => s.trim());
    return !list.includes(String(state[m[1]] ?? ""));
  }
  m = when.match(inListRe);
  if (m) {
    const list = m[2].split(",").map((s) => s.trim());
    return list.includes(String(state[m[1]] ?? ""));
  }
  m = when.match(eqRe);
  if (m) {
    const left = String(state[m[1]] ?? "");
    return m[2] === "==" ? left === m[3] : left !== m[3];
  }
  return true;
}

function interpolate(s: string, state: ShapeState): string {
  return s.replace(/\$\{([^}]+)\}/g, (_, raw: string) => {
    const expr = raw.trim();
    if (/^\w+$/.test(expr)) return String(state[expr] ?? "");
    return formatNum(evalNumExpr(expr, state));
  });
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.abs(n) < 1e-4 ? "0" : String(Math.round(n * 1000) / 1000);
}

// ----- numeric expression evaluation -----

const FNS: Record<string, (...args: number[]) => number> = {
  cos: Math.cos,
  sin: Math.sin,
  tan: Math.tan,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  sqrt: Math.sqrt,
  pow: Math.pow,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
};

const CONSTS: Record<string, number> = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
};

interface Cursor { s: string; i: number }

function evalNum(value: NumExpr | undefined, state: ShapeState): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return value;
  return evalNumExpr(value, state);
}

function evalNumExpr(s: string, state: ShapeState): number {
  const cur: Cursor = { s, i: 0 };
  return parseExpr(cur, state);
}

function ws(c: Cursor) {
  while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++;
}

function parseExpr(c: Cursor, state: ShapeState): number {
  let left = parseTerm(c, state);
  while (true) {
    ws(c);
    const op = c.s[c.i];
    if (op !== "+" && op !== "-") break;
    c.i++;
    const right = parseTerm(c, state);
    left = op === "+" ? left + right : left - right;
  }
  return left;
}

function parseTerm(c: Cursor, state: ShapeState): number {
  let left = parseUnary(c, state);
  while (true) {
    ws(c);
    const op = c.s[c.i];
    if (op !== "*" && op !== "/" && op !== "%") break;
    c.i++;
    const right = parseUnary(c, state);
    left = op === "*" ? left * right : op === "/" ? left / right : left % right;
  }
  return left;
}

function parseUnary(c: Cursor, state: ShapeState): number {
  ws(c);
  if (c.s[c.i] === "-") { c.i++; return -parseUnary(c, state); }
  if (c.s[c.i] === "+") { c.i++; return parseUnary(c, state); }
  return parseAtom(c, state);
}

function parseAtom(c: Cursor, state: ShapeState): number {
  ws(c);
  if (c.s[c.i] === "(") {
    c.i++;
    const v = parseExpr(c, state);
    ws(c);
    if (c.s[c.i] === ")") c.i++;
    return v;
  }
  const numMatch = c.s.slice(c.i).match(/^\d+(\.\d+)?/);
  if (numMatch) {
    c.i += numMatch[0].length;
    return Number(numMatch[0]);
  }
  const idMatch = c.s.slice(c.i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (idMatch) {
    const id = idMatch[0];
    c.i += id.length;
    ws(c);
    if (c.s[c.i] === "(") {
      c.i++;
      const args: number[] = [];
      ws(c);
      if (c.s[c.i] !== ")") {
        args.push(parseExpr(c, state));
        while (true) {
          ws(c);
          if (c.s[c.i] !== ",") break;
          c.i++;
          args.push(parseExpr(c, state));
        }
      }
      ws(c);
      if (c.s[c.i] === ")") c.i++;
      const fn = FNS[id];
      return fn ? fn(...args) : 0;
    }
    if (id in CONSTS) return CONSTS[id];
    const sv = state[id];
    return typeof sv === "number" ? sv : 0;
  }
  return 0;
}

export function isProceduralShape(value: unknown): value is ProceduralShape {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { primitives?: unknown }).primitives)
  );
}

// =====================================================================
// PAINTERLY HELPERS — noise overlay, brush stroke, rim light
// =====================================================================

/**
 * Lightweight integer hash (xorshift) used to deterministically seed
 * jitter in brush + noise without bringing in a real PRNG.
 */
function hash32(x: number): number {
  let n = x | 0;
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n = n ^ (n >>> 4);
  n = (n * 0x27d4eb2d) | 0;
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967295;
}

/**
 * Per-canvas cache of noise tiles, keyed by (scale, seed). Generating
 * 128×128 ImageData is ~16 KB and ~5 ms; cached forever per ctx.
 */
const noiseTileCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

function getNoisePattern(
  ctx: CanvasRenderingContext2D,
  scale: number,
  seed: number,
): CanvasPattern | null {
  let perCtx = noiseTileCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    noiseTileCache.set(ctx, perCtx);
  }
  const cacheKey = `${Math.round(scale * 100)}_${seed}`;
  const cached = perCtx.get(cacheKey);
  if (cached) return cached;

  const TILE = 128;
  // We need an offscreen canvas to build the pattern. ImageData → toCanvas
  // is cheaper than per-pixel fillRect.
  const off = document.createElement("canvas");
  off.width = TILE;
  off.height = TILE;
  const octx = off.getContext("2d");
  if (!octx) return null;
  const img = octx.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    // Hash by (i, seed) so different seeds produce uncorrelated tiles.
    const v = hash32(i * 73856093 ^ seed * 19349663);
    const g = Math.round(v * 255);
    img.data[i * 4 + 0] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  // If scale != 1, blit through a scaled canvas so the pattern grain
  // matches the requested size when tiled by the destination ctx.
  let source: HTMLCanvasElement = off;
  if (scale !== 1) {
    const dim = Math.max(8, Math.round(TILE * scale));
    const scaled = document.createElement("canvas");
    scaled.width = dim;
    scaled.height = dim;
    const sctx = scaled.getContext("2d");
    if (sctx) {
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(off, 0, 0, dim, dim);
      source = scaled;
    }
  }
  const pattern = ctx.createPattern(source, "repeat");
  if (pattern) perCtx.set(cacheKey, pattern);
  return pattern;
}

function drawNoise(
  ctx: CanvasRenderingContext2D,
  prim: Extract<Primitive, { kind: "noise" }>,
  state: ShapeState,
) {
  const x = evalNum(prim.x, state);
  const y = evalNum(prim.y, state);
  const w = evalNum(prim.w, state);
  const h = evalNum(prim.h, state);
  const scale = evalNum(prim.scale ?? 1, state);
  const alpha = clampN(evalNum(prim.alpha ?? 0.15, state), 0, 1);
  const seed = (prim.seed ?? 1337) | 0;
  if (w <= 0 || h <= 0 || alpha <= 0) return;

  const pattern = getNoisePattern(ctx, scale, seed);
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = prim.blendMode ?? "multiply";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawBrush(
  ctx: CanvasRenderingContext2D,
  prim: Extract<Primitive, { kind: "brush" }>,
  palette: Record<string, string>,
  state: ShapeState,
) {
  if (!Array.isArray(prim.points) || prim.points.length < 2) return;
  const passes = Math.max(2, Math.min(prim.passes ?? 4, 8));
  const jitter = evalNum(prim.jitter ?? 1.2, state);
  const [wMin, wMax] = prim.widthRange ?? [0.6, 1.6];
  const [aMin, aMax] = prim.alphaRange ?? [0.4, 0.95];
  const seed = (prim.seed ?? 9001) | 0;

  // Pre-evaluate path once.
  const pts = prim.points.map((p) => ({ x: evalNum(p.x, state), y: evalNum(p.y, state) }));

  const baseColor = resolveColor(ctx, prim.stroke, palette, state);
  for (let pass = 0; pass < passes; pass++) {
    const h1 = hash32(seed * 9176 + pass * 31);
    const h2 = hash32(seed * 6151 + pass * 17);
    const h3 = hash32(seed * 4099 + pass * 11);
    const offsetMag = (h1 - 0.5) * 2 * jitter;
    const widthPx = wMin + (wMax - wMin) * h2;
    const passAlpha = aMin + (aMax - aMin) * h3;

    ctx.save();
    ctx.globalAlpha = passAlpha;
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = widthPx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      // Per-pass perpendicular offset, varying smoothly along the path.
      const phase = hash32(seed * 7919 + i * 13 + pass * 113) - 0.5;
      const off = offsetMag + phase * jitter * 0.6;
      let nx = 0, ny = 0;
      if (pts.length > 1) {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        const tx = next.x - prev.x, ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        // Perpendicular (rotated 90°).
        nx = -ty / len;
        ny = tx / len;
      }
      const px = pts[i].x + nx * off;
      const py = pts[i].y + ny * off;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (prim.closed) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

// =====================================================================
// SKINNED MESH — weighted bone deformation (real Spine mesh deform)
// =====================================================================

/** 2D affine transform [[a, c, tx], [b, d, ty]]. */
interface Affine { a: number; b: number; c: number; d: number; tx: number; ty: number }

const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function numState(state: ShapeState, key: string, fallback: number): number {
  const v = state[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Compose each bone's animated world transform: rest-pose local transform
 * combined with the per-frame animation deltas in `state`, walked up the
 * parent chain. Returns sanitized-name → world affine (Spine space, Y-up).
 * Memoized + depth-guarded so a malformed cyclic skeleton can't hang.
 */
function computeSkinnedBoneWorlds(bones: SkinnedBone[], state: ShapeState): Map<string, Affine> {
  const byName = new Map<string, SkinnedBone>();
  for (const b of bones) byName.set(b.name, b);
  const worlds = new Map<string, Affine>();

  function resolve(name: string, guard: number): Affine {
    const cached = worlds.get(name);
    if (cached) return cached;
    const bone = byName.get(name);
    if (!bone || guard > 64) return IDENTITY_AFFINE;
    const parent =
      bone.parent && bone.parent !== name ? resolve(bone.parent, guard + 1) : IDENTITY_AFFINE;

    // Animated local transform = rest pose + animation deltas.
    const rot = (bone.rotation + numState(state, `bone_${name}_rotate`, 0)) * (Math.PI / 180);
    const tx = bone.x + numState(state, `bone_${name}_x`, 0);
    const ty = bone.y + numState(state, `bone_${name}_y`, 0);
    const sx = bone.scaleX * numState(state, `bone_${name}_scale_x`, 1);
    const sy = bone.scaleY * numState(state, `bone_${name}_scale_y`, 1);
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const la = cos * sx, lb = sin * sx, lc = -sin * sy, ld = cos * sy;

    // world = parent ∘ local
    const w: Affine = {
      a: parent.a * la + parent.c * lb,
      b: parent.b * la + parent.d * lb,
      c: parent.a * lc + parent.c * ld,
      d: parent.b * lc + parent.d * ld,
      tx: parent.a * tx + parent.c * ty + parent.tx,
      ty: parent.b * tx + parent.d * ty + parent.ty,
    };
    worlds.set(name, w);
    return w;
  }

  for (const b of bones) resolve(b.name, 0);
  return worlds;
}

function drawSkinnedMesh(
  ctx: CanvasRenderingContext2D,
  prim: Extract<Primitive, { kind: "skinnedMesh" }>,
  palette: Record<string, string>,
  state: ShapeState,
) {
  if (!Array.isArray(prim.vertices) || prim.vertices.length < 3) return;
  const worlds = computeSkinnedBoneWorlds(prim.bones ?? [], state);

  // Skin every vertex into canvas space (flip Y once at the end).
  const pts: Array<{ x: number; y: number }> = new Array(prim.vertices.length);
  for (let i = 0; i < prim.vertices.length; i++) {
    const bindings = prim.vertices[i];
    let wx = 0, wy = 0, wsum = 0;
    for (const bind of bindings) {
      const m = worlds.get(bind.bone) ?? IDENTITY_AFFINE;
      wx += (m.a * bind.x + m.c * bind.y + m.tx) * bind.weight;
      wy += (m.b * bind.x + m.d * bind.y + m.ty) * bind.weight;
      wsum += bind.weight;
    }
    if (wsum > 1e-6) { wx /= wsum; wy /= wsum; }
    pts[i] = { x: wx, y: -wy }; // Spine Y-up → canvas Y-down
  }

  // Outline = the hull (perimeter) vertices when declared, else the whole ring.
  const hullCount =
    prim.hull && prim.hull >= 3 && prim.hull <= pts.length ? prim.hull : pts.length;

  ctx.beginPath();
  let started = false;
  for (let i = 0; i < hullCount; i++) {
    const p = pts[i];
    if (!isFinite(p.x) || !isFinite(p.y)) continue;
    if (!started) { ctx.moveTo(p.x, p.y); started = true; }
    else ctx.lineTo(p.x, p.y);
  }
  if (!started) return;
  ctx.closePath();
  strokeFill(ctx, prim, palette, state);
}

// =====================================================================
// IMAGE SPRITE — raster bitmap drawing (the path off the vector plane)
// =====================================================================

type SpriteImage = CanvasImageSource & {
  complete?: boolean;
  naturalWidth?: number;
};

const spriteImageCache = new Map<string, SpriteImage | null>();

/** Pre-seed a decoded image for `src` (used by headless tooling that can't lazy-load). */
export function registerSpriteImage(src: string, image: CanvasImageSource): void {
  spriteImageCache.set(src, image as SpriteImage);
}

/** Drop all cached sprite images (e.g. when reloading an asset's frames). */
export function clearSpriteImageCache(): void {
  spriteImageCache.clear();
}

function resolveSpriteImage(src: string): SpriteImage | null {
  const cached = spriteImageCache.get(src);
  if (cached !== undefined) {
    if (!cached) return null;
    if (typeof cached.complete === "boolean" && !cached.complete) return null;
    if (typeof cached.naturalWidth === "number" && cached.naturalWidth === 0) return null;
    return cached;
  }
  // Browser: kick off a lazy load; the animation loop repaints once ready.
  const ImageCtor = (globalThis as unknown as { Image?: new () => SpriteImage }).Image;
  if (typeof ImageCtor === "function") {
    const im = new ImageCtor();
    spriteImageCache.set(src, im);
    (im as unknown as { src: string }).src = src;
    return null;
  }
  // Headless without a preload → nothing to draw.
  spriteImageCache.set(src, null);
  return null;
}

function drawImageSprite(
  ctx: CanvasRenderingContext2D,
  prim: Extract<Primitive, { kind: "imageSprite" }>,
  state: ShapeState,
) {
  const frames = Math.max(1, Math.floor(prim.frames ?? 1));
  let src = prim.src;
  if (src.includes("{frame}")) {
    const fps = frames > 1 ? evalNum(prim.fps ?? 12, state) : 0;
    const t = numState(state, "time", 0);
    const idx = frames > 1 ? (((Math.floor(Math.abs(t) * fps) % frames) + frames) % frames) : 0;
    src = src.replace("{frame}", String(idx));
  }
  const img = resolveSpriteImage(src);
  if (!img) return;
  const w = evalNum(prim.w, state);
  const h = evalNum(prim.h, state);
  if (w <= 0 || h <= 0) return;
  const ax = evalNum(prim.anchorX ?? 0.5, state);
  const ay = evalNum(prim.anchorY ?? 1, state);
  ctx.drawImage(img as CanvasImageSource, -w * ax, -h * ay, w, h);
}

/**
 * Compute the axis-aligned bounding box of a primitive (only the closed
 * shapes that support rim-light). Returns null if we can't derive one.
 */
function primBBox(
  prim: Primitive,
  state: ShapeState,
): { x: number; y: number; w: number; h: number } | null {
  switch (prim.kind) {
    case "rect":
    case "roundedRect":
      return {
        x: evalNum(prim.x, state),
        y: evalNum(prim.y, state),
        w: evalNum(prim.w, state),
        h: evalNum(prim.h, state),
      };
    case "circle": {
      const cx = evalNum(prim.cx, state);
      const cy = evalNum(prim.cy, state);
      const r = evalNum(prim.r, state);
      return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    }
    case "ellipse": {
      const cx = evalNum(prim.cx, state);
      const cy = evalNum(prim.cy, state);
      const rx = evalNum(prim.rx, state);
      const ry = evalNum(prim.ry, state);
      return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
    }
    case "polygon": {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of prim.points) {
        const x = evalNum(p.x, state), y = evalNum(p.y, state);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (!isFinite(minX)) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    default:
      return null;
  }
}

/** Trace the primitive's silhouette path into the current ctx. */
function tracePrimPath(
  ctx: CanvasRenderingContext2D,
  prim: Primitive,
  state: ShapeState,
) {
  ctx.beginPath();
  switch (prim.kind) {
    case "rect":
      ctx.rect(evalNum(prim.x, state), evalNum(prim.y, state), evalNum(prim.w, state), evalNum(prim.h, state));
      return;
    case "roundedRect":
      ctx.roundRect(
        evalNum(prim.x, state),
        evalNum(prim.y, state),
        evalNum(prim.w, state),
        evalNum(prim.h, state),
        evalNum(prim.r, state),
      );
      return;
    case "circle":
      ctx.arc(evalNum(prim.cx, state), evalNum(prim.cy, state), evalNum(prim.r, state), 0, Math.PI * 2);
      return;
    case "ellipse":
      ctx.ellipse(
        evalNum(prim.cx, state),
        evalNum(prim.cy, state),
        evalNum(prim.rx, state),
        evalNum(prim.ry, state),
        evalNum(prim.rotation ?? 0, state),
        0,
        Math.PI * 2,
      );
      return;
    case "polygon": {
      prim.points.forEach((pt, i) => {
        const x = evalNum(pt.x, state), y = evalNum(pt.y, state);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      return;
    }
  }
}

function drawRimLight(
  ctx: CanvasRenderingContext2D,
  prim: Primitive,
  rim: RimLightSpec,
  state: ShapeState,
) {
  const bbox = primBBox(prim, state);
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return;
  const angle = evalNum(rim.fromAngle ?? -2.0944, state); // default upper-left
  const width = evalNum(rim.width ?? 1.8, state);
  const falloff = clampN(rim.falloff ?? 0.5, 0.05, 0.95);

  // Build a linear gradient running across the bbox along `angle`.
  // The light side gets the rim color; the dark side fades to fully transparent.
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const reach = Math.max(bbox.w, bbox.h) * 0.6;
  const x0 = cx + Math.cos(angle) * reach;
  const y0 = cy + Math.sin(angle) * reach;
  const x1 = cx - Math.cos(angle) * reach;
  const y1 = cy - Math.sin(angle) * reach;
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, rim.color);
  grad.addColorStop(falloff, rim.color);
  grad.addColorStop(Math.min(0.95, falloff + 0.25), withAlpha(rim.color, 0));
  grad.addColorStop(1, withAlpha(rim.color, 0));

  ctx.save();
  tracePrimPath(ctx, prim, state);
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function withAlpha(color: string, alpha: number): string {
  // For "rgba(r,g,b,a)" / "rgb(r,g,b)" / "#rrggbb" — produce an rgba with
  // the requested alpha. Handles the cases our codebase actually emits.
  const rgba = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgba) {
    return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
  }
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
