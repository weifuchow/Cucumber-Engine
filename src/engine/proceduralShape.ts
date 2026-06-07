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

export type Primitive =
  | { kind: "roundedRect"; x: NumExpr; y: NumExpr; w: NumExpr; h: NumExpr; r: NumExpr; fill?: ColorSpec; stroke?: ColorSpec; lineWidth?: NumExpr; shadow?: ShadowSpec }
  | { kind: "rect"; x: NumExpr; y: NumExpr; w: NumExpr; h: NumExpr; fill?: ColorSpec; stroke?: ColorSpec; lineWidth?: NumExpr; shadow?: ShadowSpec }
  | {
      kind: "circle";
      cx: NumExpr;
      cy: NumExpr;
      r: NumExpr;
      fill?: ColorSpec;
      stroke?: ColorSpec;
      lineWidth?: NumExpr;
      shadow?: ShadowSpec;
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
      children: ConditionalPrimitive[];
    }
  | {
      kind: "clip";
      shape: ClipShape;
      children: ConditionalPrimitive[];
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
    return;
  }
  drawPrimitive(ctx, prim, palette, state);
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
      for (const child of prim.children) drawConditional(ctx, child, palette, state);
      ctx.restore();
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
    const base = palette[spec.palette] ?? "#000000";
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
