// Runtime evaluator for Spine 4.x keyframe animations.
//
// The spineImporter writes geometry primitives WITHIN bone-named transforms
// whose `rotate` / `translate.x` / `translate.y` reference expression
// strings like `bone_torso_rotate`, `bone_torso_x`, `bone_torso_y`. At
// draw time, the character painter calls `evaluateSpineBones` with the
// current animation name + local time and gets back a flat state object
// to merge into the shape state. The expression evaluator then resolves
// each transform's pose per frame.
//
// We support the keyframe subset used by the canonical Spine examples:
//
//   - `rotate`    : [{ time, angle, curve? }]
//   - `translate` : [{ time, x, y, curve? }]
//   - `scale`     : [{ time, x, y, curve? }]   (rare; merged in if present)
//
// Curve handling: linear OR stepped only. Cubic-bezier curves are
// approximated as linear — visible difference is small for the typical
// 12-fps Spine timelines that漫剧 imports use.
//
// The per-bone pose this evaluator produces ALSO drives mesh deformation:
// `skinnedMesh` primitives (emitted by spineImporter for Spine mesh
// attachments) read the same `bone_<name>_*` keys to skin their weighted
// vertices, so an animation bends meshes through their bones, not just the
// rigid region rectangles.
//
// What we deliberately don't implement: attachment swapping, IK constraint
// timelines, path/physics constraints. Those need a fuller Spine runtime.

import type { ShapeState } from "./proceduralShape";

/**
 * Spine keyframe curve. Three forms:
 *   - "linear"  (default if omitted) — straight lerp
 *   - "stepped" — hold previous value until next keyframe
 *   - number[]  — cubic bezier control handle: `[cx1, cy1, cx2, cy2]`
 *                 each in [0, 1] normalized to the keyframe span. Anything
 *                 else (custom 8/16-tuple) is approximated as linear.
 */
export type SpineCurve = "linear" | "stepped" | number[] | undefined;

export interface SpineRotateKey {
  time: number;
  angle: number;
  curve?: SpineCurve;
}
export interface SpineVecKey {
  time: number;
  x?: number;
  y?: number;
  curve?: SpineCurve;
}

export interface SpineBoneKeyframes {
  rotate?: SpineRotateKey[];
  translate?: SpineVecKey[];
  scale?: SpineVecKey[];
}

/**
 * Slot color keyframe. Spine encodes colors as 8-char rgba hex
 * ("ff8800ff") on slots. The animation keyframes lerp between hex
 * colors over time; we resolve them at draw time to a usable
 * `rgba(r, g, b, a)` string stored in `slot_<name>_color`.
 */
export interface SpineColorKey {
  time: number;
  /** 8-char rgba hex without the leading `#`. */
  color: string;
  curve?: SpineCurve;
}

export interface SpineSlotKeyframes {
  color?: SpineColorKey[];
}

export interface SpineAnimation {
  bones: Record<string, SpineBoneKeyframes>;
  slots?: Record<string, SpineSlotKeyframes>;
}

export type SpineAnimationMap = Record<string, SpineAnimation>;

/**
 * Pick the active keyframe pair for `time` given a sorted (ascending)
 * keyframe array. Returns the two keys + the local-progress 0..1, with
 * the bezier curve already baked in (so the caller can plain-lerp the
 * value field).
 *
 * Bezier handling: when the FROM keyframe declares a 4-tuple curve, we
 * sample the cubic-bezier y(t) for the linear time `t`. The 4-tuple is
 * `[x1, y1, x2, y2]` with implicit anchors at (0,0) and (1,1) — standard
 * Spine convention. We find the parametric `u` such that bezierX(u) = t
 * via Newton iteration, then return bezierY(u).
 */
function pickKeyPair<T extends { time: number; curve?: SpineCurve }>(
  keys: T[],
  time: number,
): { from: T | null; to: T | null; t: number; stepped: boolean } {
  if (!keys.length) return { from: null, to: null, t: 0, stepped: false };
  if (time <= keys[0].time) return { from: keys[0], to: keys[0], t: 0, stepped: false };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = Math.max(b.time - a.time, 1e-6);
      const linearT = (time - a.time) / span;
      const stepped = a.curve === "stepped";
      const easedT = stepped ? 0 : applyCurve(a.curve, linearT);
      return { from: a, to: b, t: easedT, stepped };
    }
  }
  const last = keys[keys.length - 1];
  return { from: last, to: last, t: 1, stepped: false };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Map a linear `t` ∈ [0,1] through the FROM keyframe's curve spec.
 * - undefined / "linear" → identity
 * - "stepped"           → handled by the caller (always returns 0 here)
 * - [x1, y1, x2, y2]    → cubic bezier
 * - any other array     → fall back to linear (we don't model Spine's
 *                         richer 16-tuple "curveType" variants yet)
 */
function applyCurve(curve: SpineCurve, t: number): number {
  if (!curve || curve === "linear") return t;
  if (curve === "stepped") return 0;
  if (!Array.isArray(curve) || curve.length < 4) return t;
  const [x1, y1, x2, y2] = curve;
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return t;
  const u = solveBezierU(t, x1, x2);
  return cubicBezierAt(u, y1, y2);
}

/**
 * Cubic bezier in 1D with implicit anchors at 0 and 1:
 *   B(u) = 3·(1−u)²·u·p1 + 3·(1−u)·u²·p2 + u³
 */
function cubicBezierAt(u: number, p1: number, p2: number): number {
  const oneMinus = 1 - u;
  return 3 * oneMinus * oneMinus * u * p1
       + 3 * oneMinus * u * u * p2
       + u * u * u;
}

/**
 * Given a target X (a linear time progress 0..1), solve for the
 * parametric `u` such that the cubic-bezier X-axis curve at `u` equals
 * the target. Newton-Raphson, 6 iterations, with bisection fallback.
 */
function solveBezierU(targetX: number, x1: number, x2: number): number {
  let u = targetX;
  for (let i = 0; i < 6; i++) {
    const x = cubicBezierAt(u, x1, x2);
    const dx = 3 * (1 - u) * (1 - u) * x1
             + 6 * (1 - u) * u * (x2 - x1)
             + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    const next = u - (x - targetX) / dx;
    if (next < 0) { u = 0; break; }
    if (next > 1) { u = 1; break; }
    u = next;
  }
  return u;
}

/**
 * Evaluate every bone in the given animation at `time`, returning a flat
 * map suitable for merging into a shape state. Keys are namespaced as:
 *
 *   bone_<name>_rotate   (degrees, matches Spine convention)
 *   bone_<name>_x        (offset from rest position)
 *   bone_<name>_y        (offset, note: Spine's Y-up is flipped at import)
 *   bone_<name>_scale_x  (multiplier, default 1)
 *   bone_<name>_scale_y  (multiplier, default 1)
 *
 * Bones with no entry in this animation contribute identity keys (0
 * rotation, 0 translation, 1 scale) so transforms reading them never
 * pick up undefined.
 */
export function evaluateSpineBones(
  animations: SpineAnimationMap,
  animationName: string,
  time: number,
): ShapeState {
  const out: ShapeState = {};
  const anim = animations[animationName];
  if (!anim) return out;
  for (const [boneName, kf] of Object.entries(anim.bones)) {
    const safe = sanitize(boneName);
    if (kf.rotate?.length) {
      const { from, to, t, stepped } = pickKeyPair(kf.rotate, time);
      const v = !from ? 0 : stepped || !to ? from.angle : lerp(from.angle, to.angle, t);
      out[`bone_${safe}_rotate`] = v;
    } else {
      out[`bone_${safe}_rotate`] = 0;
    }
    if (kf.translate?.length) {
      const { from, to, t, stepped } = pickKeyPair(kf.translate, time);
      out[`bone_${safe}_x`] = !from ? 0 : stepped || !to ? (from.x ?? 0) : lerp(from.x ?? 0, to.x ?? 0, t);
      out[`bone_${safe}_y`] = !from ? 0 : stepped || !to ? (from.y ?? 0) : lerp(from.y ?? 0, to.y ?? 0, t);
    } else {
      out[`bone_${safe}_x`] = 0;
      out[`bone_${safe}_y`] = 0;
    }
    if (kf.scale?.length) {
      const { from, to, t, stepped } = pickKeyPair(kf.scale, time);
      out[`bone_${safe}_scale_x`] = !from ? 1 : stepped || !to ? (from.x ?? 1) : lerp(from.x ?? 1, to.x ?? 1, t);
      out[`bone_${safe}_scale_y`] = !from ? 1 : stepped || !to ? (from.y ?? 1) : lerp(from.y ?? 1, to.y ?? 1, t);
    } else {
      out[`bone_${safe}_scale_x`] = 1;
      out[`bone_${safe}_scale_y`] = 1;
    }
  }

  // ---- slot color animation ---------------------------------------------
  //
  // Spine slots carry a tint (rgba). Animations can lerp the tint over
  // time. We resolve it here to a usable `rgba(r, g, b, a)` string and
  // store it as `slot_<name>_color`. The renderer's color resolver
  // checks for this key when a fill spec references `{ palette: "slot_<name>_color" }`.
  for (const [slotName, slotKf] of Object.entries(anim.slots ?? {})) {
    const safe = sanitize(slotName);
    if (!slotKf.color?.length) continue;
    const { from, to, t, stepped } = pickKeyPair(slotKf.color, time);
    if (!from) continue;
    const color = stepped || !to ? parseHexRgba(from.color) : lerpRgba(parseHexRgba(from.color), parseHexRgba(to.color), t);
    out[`slot_${safe}_color`] = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a.toFixed(3)})`;
  }
  return out;
}

interface Rgba { r: number; g: number; b: number; a: number }

function parseHexRgba(hex: string): Rgba {
  const h = hex.replace(/^#/, "").padEnd(8, "f");
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
    a: (parseInt(h.slice(6, 8), 16) || 255) / 255,
  };
}

function lerpRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
    a: a.a + (b.a - a.a) * t,
  };
}

/**
 * Sanitize a Spine bone name so it's a valid identifier in the shape
 * expression mini-language. Spine allows spaces / dashes / dots; the
 * expression parser only matches `[A-Za-z_][A-Za-z0-9_]*`. We snake-case
 * everything to keep the mapping deterministic across import + draw.
 */
export function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
