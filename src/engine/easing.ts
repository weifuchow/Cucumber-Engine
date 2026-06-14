// Easing palette. The timeline used a single symmetric `easeInOut` for every
// move, camera push and head turn — and uniform symmetric tweening is the
// signature "Flash motion tween" read. This module gives the timeline (and the
// AI segment generator) a vocabulary of curves so motion can anticipate,
// overshoot and settle instead of gliding A→B at the same robotic rate.
//
// `easeInOut` here is byte-for-byte the old curve, so anything that doesn't
// opt into a different `ease` behaves exactly as before (no regression).

export type EaseKind =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "anticipate"     // dip back before launching (easeInBack)
  | "overshoot"      // shoot past, settle back (easeOutBack)
  | "elastic"        // springy settle (easeOutElastic)
  | "bounce";        // landing bounce (easeOutBounce)

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function applyEase(kind: EaseKind | undefined, progress: number): number {
  const t = clamp01(progress);
  switch (kind) {
    case "linear":
      return t;
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "anticipate": {
      // easeInBack — pulls slightly backward before accelerating forward.
      return BACK_C3 * t * t * t - BACK_C1 * t * t;
    }
    case "overshoot": {
      // easeOutBack — overshoots the target then settles, the single most
      // useful curve for making a stop feel like it has weight.
      const u = t - 1;
      return 1 + BACK_C3 * u * u * u + BACK_C1 * u * u;
    }
    case "elastic": {
      if (t === 0 || t === 1) return t;
      const p = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * p) + 1;
    }
    case "bounce":
      return easeOutBounce(t);
    case "easeInOut":
    case undefined:
    default:
      // The historical default — kept identical for backward compatibility.
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}
