// Alternate-view (back / side) builders for human characters.
//
// `characterShapes.ts:buildHumanCharacterShape` produces the canonical FRONT
// view. For 2.5D camera work we also need back + left/right profiles so the
// engine can render a character walking away from / sideways past the camera
// without resorting to runtime mirroring (which would flip facial highlights
// and signature accessories the wrong way).
//
// Design constraints (these views must look like the SAME character):
//   - palette is shared (caller threads `metadata.palette` through unchanged)
//   - canvas footprint (width / height / anchor) is shared
//   - hat / chest emblem / facial marks declared in the spec must appear in
//     every populated view, just translated/clipped to fit
//   - lighting trio (gradient + face highlight equivalent + z-aware contact
//     shadow) is preserved
//   - ≥ 4 action branches gated on `when: "action == xxx"`
//
// These builders are intentionally tighter than the front builder
// (~70–90 primitives each instead of ~150). Back view drops facial
// features by definition; side view halves the visible limb count.
//
// Re-uses the same procedural-shape DSL — no engine changes.

import type { ConditionalPrimitive, Primitive, ProceduralShape } from "../engine/proceduralShape";
import type { HumanCharacterOptions } from "./characterShapes";

const OUTLINE = "rgba(20,16,12,0.7)";
const OUTLINE_SOFT = "rgba(20,16,12,0.45)";

/** Common z-aware contact shadow shared by every view. */
function contactShadow(): ConditionalPrimitive {
  return {
    kind: "ellipse",
    cx: 0, cy: 14,
    rx: "92 * (1 - clamp(z * 0.0008, 0, 0.35))",
    ry: "25 * (1 - clamp(z * 0.0008, 0, 0.35))",
    fill: {
      gradient: "radial",
      x0: 0, y0: 14, r0: 0, x1: 0, y1: 14, r1: 92,
      stops: [
        { at: 0, color: "rgba(18,14,10,${0.4 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
        { at: 0.55, color: "rgba(18,14,10,${0.22 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
        { at: 1, color: "rgba(18,14,10,0)" },
      ],
    },
  };
}

// =====================================================================
// BACK VIEW
// =====================================================================

/**
 * Back-of-character view. Face is replaced by the back-of-head hair mass +
 * neck nape shadow. Hat (if present) shows its rear silhouette with brim
 * shadow pushed onto the upper back instead of the forehead.
 */
export function buildBackViewShape(opts: HumanCharacterOptions = {}): ProceduralShape {
  const costume = opts.costume ?? "jacket";
  const shorts = opts.shorts ?? false;
  const hairBald = opts.hairStyle === "bald";

  const p: ConditionalPrimitive[] = [];
  p.push(contactShadow());

  // ---- shoes (rear three-quarter) ----
  for (const sign of [-1, 1]) {
    const x = sign * 30;
    p.push({ kind: "polygon", points: [
      { x: x - 22, y: -4 }, { x: x + 22, y: -4 },
      { x: x + 24, y: 6 }, { x: x + 20, y: 22 },
      { x: x - 20, y: 22 }, { x: x - 24, y: 6 },
    ], fill: "#1a120a", stroke: OUTLINE, lineWidth: 1.6 });
    p.push({ kind: "polygon", points: [
      { x: x - 22, y: 14 }, { x: x + 22, y: 14 },
      { x: x + 20, y: 22 }, { x: x - 20, y: 22 },
    ], fill: "rgba(0,0,0,0.45)" });
  }

  // ---- pants/shorts (idle + walking branches) ----
  const legTop = shorts ? -20 : -48;
  const legBottom = -6;
  const legH = legBottom - legTop;
  for (const sign of [-1, 1]) {
    const x = sign * 30;
    p.push({ when: "action not in [walking]", kind: "roundedRect",
      x: x - 18, y: legTop, w: 36, h: legH, r: shorts ? 10 : 8,
      fill: { palette: "pants" } });
    p.push({ when: "action not in [walking]", kind: "roundedRect",
      x: x - 18, y: legTop, w: 36, h: legH, r: shorts ? 10 : 8,
      fill: { gradient: "linear", x0: x - 18, y0: legTop, x1: x + 18, y1: legBottom,
        stops: [
          { at: 0, color: "rgba(0,0,0,0.3)" },
          { at: 0.4, color: "rgba(0,0,0,0)" },
          { at: 1, color: "rgba(0,0,0,0.34)" },
        ] } });
    p.push({ when: "action not in [walking]", kind: "roundedRect",
      x: x - 18, y: legTop, w: 36, h: legH, r: shorts ? 10 : 8,
      stroke: OUTLINE, lineWidth: 1.6 });
  }
  // walking swing
  for (const cfg of [{ x: -30, phase: 0 }, { x: 30, phase: Math.PI }]) {
    p.push({ when: "action == walking", kind: "transform",
      translate: { x: cfg.x, y: legTop },
      rotate: `sin(time * 8 + ${cfg.phase}) * 0.5`,
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: legH, r: shorts ? 10 : 8, fill: { palette: "pants" } },
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: legH, r: shorts ? 10 : 8, stroke: OUTLINE, lineWidth: 1.6 },
      ],
    });
  }

  // ---- torso (back) ----
  p.push({ kind: "roundedRect", x: -58, y: -245, w: 116, h: 205, r: 36,
    fill: { palette: "body" },
    shadow: { blur: 16, offsetY: 6, color: "rgba(18,12,8,0.32)" } });

  // Back-specific: vertical spine shadow line, no V-lapel.
  p.push({ kind: "rect", x: -2, y: -240, w: 4, h: 195,
    fill: { gradient: "linear", x0: 0, y0: -240, x1: 0, y1: -45,
      stops: [
        { at: 0, color: "rgba(0,0,0,0.3)" },
        { at: 1, color: "rgba(0,0,0,0.5)" },
      ] } });

  // Belt (visible from behind)
  if (costume !== "tank") {
    p.push({ kind: "rect", x: -50, y: -56, w: 100, h: 12, fill: "#241a12" });
    p.push({ kind: "rect", x: -50, y: -56, w: 100, h: 12, stroke: OUTLINE, lineWidth: 1.4 });
  }

  // Torso linear light (light source still upper-left — but from BEHIND
  // means the right shoulder catches it from the back of the figure).
  p.push({ kind: "roundedRect", x: -58, y: -245, w: 116, h: 205, r: 36,
    fill: { gradient: "linear", x0: -58, y0: -245, x1: 58, y1: -40,
      stops: [
        { at: 0, color: "rgba(255,255,255,0.14)" },
        { at: 0.45, color: "rgba(255,255,255,0)" },
        { at: 1, color: "rgba(0,0,0,0.36)" },
      ] } });

  // Shoulder yoke (subtle horizontal shadow at top of back)
  p.push({ kind: "rect", x: -58, y: -240, w: 116, h: 18,
    fill: { gradient: "linear", x0: 0, y0: -240, x1: 0, y1: -222,
      stops: [
        { at: 0, color: "rgba(0,0,0,0.32)" },
        { at: 1, color: "rgba(0,0,0,0)" },
      ] } });

  // Final torso outline
  p.push({ kind: "roundedRect", x: -58, y: -245, w: 116, h: 205, r: 36,
    stroke: OUTLINE, lineWidth: 1.8 });

  // ---- arms (idle + walking + attack + defend overlays) ----
  const idleArmBack = (sign: number): ConditionalPrimitive => ({
    when: "action in [idle, defend]",
    kind: "transform",
    translate: { x: sign * 56, y: -210 },
    rotate: sign > 0 ? "0.04 + sin(time * 1.4) * 0.02" : "-0.04 + sin(time * 1.4 + PI) * 0.02",
    children: [
      { kind: "ellipse", cx: 0, cy: 4, rx: 20, ry: 10, fill: "rgba(0,0,0,0.4)" },
      { kind: "roundedRect", x: -18, y: 0, w: 36, h: 78, r: 17, fill: { palette: "body" } },
      { kind: "roundedRect", x: -18, y: 0, w: 36, h: 78, r: 17,
        fill: { gradient: "linear", x0: -18, y0: 0, x1: 18, y1: 78,
          stops: [{ at: 0, color: "rgba(255,255,255,0.12)" }, { at: 1, color: "rgba(0,0,0,0.34)" }] } },
      { kind: "roundedRect", x: -18, y: 0, w: 36, h: 78, r: 17, stroke: OUTLINE, lineWidth: 1.5 },
      // Lower sleeve (back of forearm)
      { kind: "roundedRect", x: -16, y: 80, w: 32, h: 50, r: 14, fill: { palette: "body", darken: 16 }, stroke: OUTLINE, lineWidth: 1.3 },
      { kind: "circle", cx: 0, cy: 140, r: 12, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  });
  p.push(idleArmBack(-1));
  p.push(idleArmBack(1));

  for (const cfg of [{ x: -56, phase: Math.PI }, { x: 56, phase: 0 }]) {
    p.push({ when: "action == walking", kind: "transform",
      translate: { x: cfg.x, y: -195 },
      rotate: `sin(time * 8 + ${cfg.phase}) * 0.32`,
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 128, r: 17, fill: { palette: "body" } },
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 128, r: 17, stroke: OUTLINE, lineWidth: 1.5 },
        { kind: "circle", cx: 0, cy: 140, r: 12, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
      ],
    });
  }

  // attack — right arm thrust away from camera (arm visually compresses)
  p.push({ when: "action == attack", kind: "transform",
    translate: { x: 56, y: -206 }, rotate: -0.3,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 110, r: 14, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 110, r: 14, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: 118, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  });

  // defend — crossed arms shown as two overlapping silhouettes behind torso
  for (const sign of [-1, 1]) {
    p.push({ when: "action == defend", kind: "transform",
      translate: { x: sign * 22, y: -150 }, rotate: sign * 0.5,
      children: [
        { kind: "roundedRect", x: -14, y: 0, w: 28, h: 100, r: 14, fill: { palette: "body", darken: 28 } },
        { kind: "roundedRect", x: -14, y: 0, w: 28, h: 100, r: 14, stroke: OUTLINE, lineWidth: 1.5 },
      ],
    });
  }

  // victory — both arms up
  p.push({ when: "action == victory", kind: "transform",
    translate: { x: -56, y: -200 }, rotate: -0.16,
    children: [
      { kind: "roundedRect", x: -16, y: -130, w: 32, h: 130, r: 14, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: -130, w: 32, h: 130, r: 14, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: -140, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  });
  p.push({ when: "action == victory", kind: "transform",
    translate: { x: 56, y: -200 }, rotate: 0.16,
    children: [
      { kind: "roundedRect", x: -16, y: -130, w: 32, h: 130, r: 14, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: -130, w: 32, h: 130, r: 14, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: -140, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  });

  // ---- neck (nape view) ----
  p.push({ kind: "roundedRect", x: -15, y: -274, w: 30, h: 32, r: 7, fill: { palette: "skin" } });
  // Deep nape shadow — almost full coverage because the neck is concave from behind.
  p.push({ kind: "roundedRect", x: -15, y: -274, w: 30, h: 24, r: 7,
    fill: { gradient: "linear", x0: 0, y0: -274, x1: 0, y1: -250,
      stops: [
        { at: 0, color: "rgba(60,30,20,0.7)" },
        { at: 1, color: "rgba(60,30,20,0.2)" },
      ] } });
  p.push({ kind: "roundedRect", x: -15, y: -274, w: 30, h: 32, r: 7, stroke: OUTLINE, lineWidth: 1.3 });

  // ---- back of head ----
  p.push({ kind: "circle", cx: 0, cy: -310, r: 70, fill: { palette: "skin" } });
  // Most of the back-of-head is covered by hair, so the "face highlight"
  // radial becomes a soft RIM light tracing the upper-left of the silhouette.
  p.push({ kind: "circle", cx: 0, cy: -310, r: 70,
    fill: { gradient: "radial", x0: -34, y0: -340, r0: 8, x1: 0, y1: -310, r1: 72,
      stops: [
        { at: 0, color: "rgba(255,250,238,0.42)" },
        { at: 0.5, color: "rgba(255,250,238,0)" },
        { at: 0.9, color: "rgba(40,20,12,0.32)" },
        { at: 1, color: "rgba(40,20,12,0.55)" },
      ] } });

  // Ears (visible from behind, slightly forward of silhouette)
  for (const sign of [-1, 1]) {
    p.push({ kind: "ellipse", cx: sign * 60, cy: -310, rx: 8, ry: 16, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 });
  }

  p.push({ kind: "circle", cx: 0, cy: -310, r: 70, stroke: OUTLINE, lineWidth: 1.8 });

  // ---- back hair mass ----
  if (!hairBald) {
    // Big covering mass — covers most of the back of the head.
    p.push({ kind: "polygon", points: [
      { x: -76, y: -344 }, { x: -60, y: -376 }, { x: -28, y: -384 },
      { x: 0, y: -386 }, { x: 28, y: -384 }, { x: 60, y: -376 },
      { x: 76, y: -344 }, { x: 72, y: -260 }, { x: 50, y: -250 },
      { x: 0, y: -252 }, { x: -50, y: -250 }, { x: -72, y: -260 },
    ], fill: { palette: "hair" }, stroke: OUTLINE, lineWidth: 1.5 });
    // Crown highlight
    p.push({ kind: "ellipse", cx: -8, cy: -360, rx: 38, ry: 14,
      fill: { gradient: "radial", x0: -14, y0: -366, r0: 2, x1: -8, y1: -360, r1: 38,
        stops: [
          { at: 0, color: "rgba(255,255,255,0.32)" },
          { at: 0.6, color: "rgba(255,255,255,0)" },
          { at: 1, color: "rgba(0,0,0,0.2)" },
        ] } });
    // Center parting line — characteristic of back-of-head reads
    p.push({ kind: "line", x1: 0, y1: -382, x2: 0, y2: -300, stroke: "rgba(0,0,0,0.36)", lineWidth: 1.6, lineCap: "round" });
    // Side wisps
    for (const sign of [-1, 1]) {
      p.push({ kind: "polygon", points: [
        { x: sign * 56, y: -344 },
        { x: sign * 72, y: -300 },
        { x: sign * 64, y: -262 },
        { x: sign * 50, y: -270 },
      ], fill: { palette: "hair" }, stroke: OUTLINE_SOFT, lineWidth: 1.2 });
    }
  }

  // ---- optional hat (rear view) ----
  if (opts.hat && opts.hat !== "none") {
    const hatColor = opts.hatColor ?? (opts.hat === "straw" ? "#e8c97a" : "#3a2820");
    // Brim
    p.push({ kind: "ellipse", cx: 0, cy: -362, rx: 88, ry: 18, fill: hatColor, stroke: OUTLINE, lineWidth: 1.6 });
    // Crown
    p.push({ kind: "polygon", points: [
      { x: -50, y: -360 }, { x: -42, y: -396 }, { x: 42, y: -396 }, { x: 50, y: -360 },
    ], fill: hatColor, stroke: OUTLINE, lineWidth: 1.6 });
    if (opts.hat === "straw" && opts.hatBandColor) {
      p.push({ kind: "rect", x: -50, y: -370, w: 100, h: 6, fill: opts.hatBandColor });
    }
    // Brim shadow on upper back (not forehead, since it's behind)
    p.push({ kind: "rect", x: -56, y: -350, w: 112, h: 18,
      fill: { gradient: "linear", x0: 0, y0: -350, x1: 0, y1: -332,
        stops: [
          { at: 0, color: "rgba(0,0,0,0.35)" },
          { at: 1, color: "rgba(0,0,0,0)" },
        ] } });
  }

  // ---- displayName badge (still shown so the user can tell who's facing away) ----
  p.push({ kind: "rect", x: -68, y: -245, w: 136, h: 26, fill: "rgba(20,16,12,0.6)" });
  p.push({ kind: "text", x: 0, y: -226, text: "${name}", fill: "#fff8ed", size: 18, align: "center" });

  return { primitives: p, preview: { fit: "contain" } };
}

// =====================================================================
// SIDE VIEW
// =====================================================================

/**
 * Side profile. `facing` is +1 for screen-right, -1 for screen-left.
 * Caller-supplied accessories (hat, emblem, marks) are mirrored along the
 * facing axis automatically.
 */
export function buildSideViewShape(
  opts: HumanCharacterOptions = {},
  facing: 1 | -1 = 1,
): ProceduralShape {
  const f = facing;
  const costume = opts.costume ?? "jacket";
  const shorts = opts.shorts ?? false;
  const hair = opts.hairStyle ?? "fringe";

  const p: ConditionalPrimitive[] = [];
  p.push(contactShadow());

  // ---- shoe (single, in profile) ----
  p.push({ kind: "polygon", points: [
    { x: -28 * f, y: -4 }, { x: 36 * f, y: -4 },
    { x: 38 * f, y: 6 }, { x: 34 * f, y: 22 },
    { x: -26 * f, y: 22 }, { x: -32 * f, y: 6 },
  ], fill: "#1a120a", stroke: OUTLINE, lineWidth: 1.6 });
  p.push({ kind: "ellipse", cx: 4 * f, cy: -1, rx: 14, ry: 3.5, fill: "rgba(255,255,255,0.32)" });
  p.push({ kind: "polygon", points: [
    { x: -28 * f, y: 14 }, { x: 36 * f, y: 14 },
    { x: 34 * f, y: 22 }, { x: -26 * f, y: 22 },
  ], fill: "rgba(0,0,0,0.45)" });

  // Rear leg shoe (smaller, occluded)
  p.push({ kind: "polygon", points: [
    { x: -18 * f, y: -2 }, { x: 18 * f, y: -2 },
    { x: 14 * f, y: 18 }, { x: -16 * f, y: 18 },
  ], fill: "#0e0807", stroke: OUTLINE_SOFT, lineWidth: 1.3 });

  // ---- legs (single thick + single thin behind) ----
  const legTop = shorts ? -20 : -48;
  const legBottom = -6;
  const legH = legBottom - legTop;
  // front leg
  p.push({ when: "action not in [walking]", kind: "roundedRect",
    x: -16, y: legTop, w: 32, h: legH, r: shorts ? 10 : 8,
    fill: { palette: "pants" } });
  p.push({ when: "action not in [walking]", kind: "roundedRect",
    x: -16, y: legTop, w: 32, h: legH, r: shorts ? 10 : 8,
    fill: { gradient: "linear", x0: -16 * f, y0: legTop, x1: 16 * f, y1: legBottom,
      stops: [
        { at: 0, color: "rgba(255,255,255,0.16)" },
        { at: 1, color: "rgba(0,0,0,0.32)" },
      ] } });
  p.push({ when: "action not in [walking]", kind: "roundedRect",
    x: -16, y: legTop, w: 32, h: legH, r: shorts ? 10 : 8,
    stroke: OUTLINE, lineWidth: 1.6 });
  // back leg (smaller, darkened)
  p.push({ when: "action not in [walking]", kind: "roundedRect",
    x: -12, y: legTop + 4, w: 24, h: legH - 4, r: shorts ? 8 : 6,
    fill: { palette: "pants", darken: 30 }, stroke: OUTLINE_SOFT, lineWidth: 1.3 });

  // walking — front leg + back leg both swing, opposite phase
  p.push({ when: "action == walking", kind: "transform",
    translate: { x: 0, y: legTop },
    rotate: `sin(time * 8) * 0.45`,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: legH, r: shorts ? 10 : 8, fill: { palette: "pants" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: legH, r: shorts ? 10 : 8, stroke: OUTLINE, lineWidth: 1.6 },
    ],
  });
  p.push({ when: "action == walking", kind: "transform",
    translate: { x: 0, y: legTop + 4 },
    rotate: `sin(time * 8 + PI) * 0.45`,
    children: [
      { kind: "roundedRect", x: -12, y: 0, w: 24, h: legH - 4, r: shorts ? 8 : 6,
        fill: { palette: "pants", darken: 30 }, stroke: OUTLINE_SOFT, lineWidth: 1.3 },
    ],
  });

  // ---- belt ----
  if (costume !== "tank") {
    p.push({ kind: "rect", x: -38, y: -56, w: 76, h: 12, fill: "#241a12" });
    p.push({ kind: "roundedRect", x: -8 * f, y: -55, w: 16, h: 10, r: 2,
      fill: "#d4ad62", stroke: OUTLINE, lineWidth: 1.2 });
    p.push({ kind: "rect", x: -38, y: -56, w: 76, h: 12, stroke: OUTLINE, lineWidth: 1.4 });
  }

  // ---- torso (narrower for profile) ----
  const torsoW = 76;
  p.push({ kind: "roundedRect", x: -torsoW / 2, y: -245, w: torsoW, h: 205, r: 28,
    fill: { palette: "body" },
    shadow: { blur: 14, offsetY: 5, color: "rgba(18,12,8,0.32)" } });
  // Side highlight (front edge catches light)
  p.push({ kind: "roundedRect", x: -torsoW / 2, y: -245, w: torsoW, h: 205, r: 28,
    fill: { gradient: "linear", x0: -torsoW / 2 * f, y0: -245, x1: torsoW / 2 * f, y1: -40,
      stops: [
        { at: 0, color: "rgba(255,255,255,0.22)" },
        { at: 0.5, color: "rgba(255,255,255,0)" },
        { at: 1, color: "rgba(0,0,0,0.36)" },
      ] } });
  // Spine seam (visible from profile as a slight curved indent at back edge)
  p.push({ kind: "line", x1: -torsoW / 2 * f, y1: -230, x2: -torsoW / 2 * f, y2: -55,
    stroke: "rgba(0,0,0,0.32)", lineWidth: 1.4, lineCap: "round" });

  // chest emblem on visible side
  if (opts.chestEmblem) {
    p.push({ kind: "circle", cx: 14 * f, cy: -190, r: 12, fill: "rgba(0,0,0,0.2)" });
    p.push({ kind: "circle", cx: 14 * f, cy: -190, r: 11, fill: opts.chestEmblem.color, stroke: OUTLINE, lineWidth: 1.2 });
  }
  // Torso outline
  p.push({ kind: "roundedRect", x: -torsoW / 2, y: -245, w: torsoW, h: 205, r: 28,
    stroke: OUTLINE, lineWidth: 1.8 });

  // ---- arms (one front + one back) ----
  const frontArm: ConditionalPrimitive = {
    when: "action in [idle, defend]",
    kind: "transform",
    translate: { x: 32 * f, y: -210 },
    rotate: `${f * 0.05} + sin(time * 1.4) * 0.04`,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 78, r: 15, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 78, r: 15, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "roundedRect", x: -14, y: 80, w: 28, h: 50, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 },
      { kind: "circle", cx: 0, cy: 140, r: 12, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  };
  // Back arm — partially hidden behind torso
  const backArm: ConditionalPrimitive = {
    when: "action in [idle, defend]",
    kind: "transform",
    translate: { x: -28 * f, y: -208 },
    rotate: `${-f * 0.05} + sin(time * 1.4 + PI) * 0.04`,
    children: [
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 76, r: 13, fill: { palette: "body", darken: 24 } },
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 76, r: 13, stroke: OUTLINE_SOFT, lineWidth: 1.3 },
      { kind: "circle", cx: 0, cy: 90, r: 11, fill: { palette: "skin" }, stroke: OUTLINE_SOFT, lineWidth: 1.2 },
    ],
  };
  p.push(frontArm);
  p.push(backArm);

  // walking arm swings
  p.push({ when: "action == walking", kind: "transform",
    translate: { x: 32 * f, y: -200 },
    rotate: `sin(time * 8) * 0.32`,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 128, r: 15, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 128, r: 15, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: 140, r: 12, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  });
  p.push({ when: "action == walking", kind: "transform",
    translate: { x: -28 * f, y: -200 },
    rotate: `sin(time * 8 + PI) * 0.32`,
    children: [
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 120, r: 13, fill: { palette: "body", darken: 24 } },
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 120, r: 13, stroke: OUTLINE_SOFT, lineWidth: 1.3 },
    ],
  });

  // attack — front arm thrust forward
  p.push({ when: "action == attack", kind: "transform",
    translate: { x: 28 * f, y: -200 }, rotate: -f * 0.65,
    children: [
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 124, r: 13, fill: { palette: "body" } },
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 124, r: 13, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: 132, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  });

  // defend — front arm crossed at chest
  p.push({ when: "action == defend", kind: "transform",
    translate: { x: 14 * f, y: -148 }, rotate: f * 0.6,
    children: [
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 108, r: 14, fill: { palette: "body", darken: 24 } },
      { kind: "roundedRect", x: -14, y: 0, w: 28, h: 108, r: 14, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: 114, r: 12, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 },
    ],
  });

  // victory — front arm up
  p.push({ when: "action == victory", kind: "transform",
    translate: { x: 26 * f, y: -200 }, rotate: f * 0.18,
    children: [
      { kind: "roundedRect", x: -14, y: -128, w: 28, h: 128, r: 14, fill: { palette: "body" } },
      { kind: "roundedRect", x: -14, y: -128, w: 28, h: 128, r: 14, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: -138, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 },
    ],
  });

  // ---- neck (in profile, slightly forward) ----
  p.push({ kind: "roundedRect", x: -10 + 4 * f, y: -274, w: 22, h: 32, r: 7, fill: { palette: "skin" } });
  p.push({ kind: "roundedRect", x: -10 + 4 * f, y: -274, w: 22, h: 32, r: 7,
    fill: { gradient: "linear", x0: 0, y0: -274, x1: 0, y1: -242,
      stops: [
        { at: 0, color: "rgba(60,30,20,0.5)" },
        { at: 1, color: "rgba(0,0,0,0.36)" },
      ] } });
  p.push({ kind: "roundedRect", x: -10 + 4 * f, y: -274, w: 22, h: 32, r: 7, stroke: OUTLINE, lineWidth: 1.3 });

  // ---- head silhouette (profile — nose protrudes on facing side) ----
  // Main head circle
  p.push({ kind: "circle", cx: 0, cy: -310, r: 66, fill: { palette: "skin" } });
  // Nose bump — small wedge protruding on `facing` side
  p.push({ kind: "polygon", points: [
    { x: 56 * f, y: -304 }, { x: 78 * f, y: -298 },
    { x: 76 * f, y: -288 }, { x: 56 * f, y: -286 },
  ], fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 });
  // Lip + chin profile bump
  p.push({ kind: "polygon", points: [
    { x: 50 * f, y: -274 }, { x: 60 * f, y: -270 },
    { x: 56 * f, y: -258 }, { x: 44 * f, y: -260 },
  ], fill: { palette: "skin", darken: 18 } });
  // Face radial highlight on facing side
  p.push({ kind: "circle", cx: 0, cy: -310, r: 66,
    fill: { gradient: "radial",
      x0: 24 * f, y0: -332, r0: 6, x1: 0, y1: -310, r1: 68,
      stops: [
        { at: 0, color: "rgba(255,250,238,0.5)" },
        { at: 0.45, color: "rgba(255,250,238,0)" },
        { at: 0.9, color: "rgba(80,38,24,0.22)" },
        { at: 1, color: "rgba(80,38,24,0.46)" },
      ] } });
  // Cheek warmth on facing side
  p.push({ kind: "ellipse", cx: 28 * f, cy: -288, rx: 14, ry: 8, fill: "rgba(220,110,90,0.32)" });
  // Single visible eye
  p.push({ kind: "polygon", points: [
    { x: 20 * f, y: -322 }, { x: 38 * f, y: -324 },
    { x: 40 * f, y: -314 }, { x: 22 * f, y: -312 },
  ], fill: "#1a120a", stroke: OUTLINE_SOFT, lineWidth: 1 });
  // iris
  p.push({ kind: "circle", cx: 30 * f, cy: -318, r: 4, fill: "#3a2410" });
  // highlight
  p.push({ kind: "circle", cx: 28 * f, cy: -320, r: 1.5, fill: "rgba(255,255,255,0.7)" });
  // eyebrow
  p.push({ kind: "polygon", points: [
    { x: 18 * f, y: -332 }, { x: 38 * f, y: -334 },
    { x: 38 * f, y: -330 }, { x: 18 * f, y: -328 },
  ], fill: "#1a120a" });
  // Single ear on far side (occluded — small)
  p.push({ kind: "ellipse", cx: -50 * f, cy: -308, rx: 6, ry: 14, fill: { palette: "skin", darken: 12 }, stroke: OUTLINE_SOFT, lineWidth: 1.2 });

  p.push({ kind: "circle", cx: 0, cy: -310, r: 66, stroke: OUTLINE, lineWidth: 1.8 });

  // ---- hair (only visible side) ----
  if (hair !== "bald") {
    // Back-of-head hair mass
    p.push({ kind: "polygon", points: [
      { x: -68 * f, y: -344 }, { x: -52 * f, y: -370 },
      { x: -20 * f, y: -378 }, { x: 6 * f, y: -378 },
      { x: 6 * f, y: -280 }, { x: -56 * f, y: -270 },
    ], fill: { palette: "hair" }, stroke: OUTLINE, lineWidth: 1.5 });
    // Crown highlight
    p.push({ kind: "ellipse", cx: -18 * f, cy: -358, rx: 28, ry: 10,
      fill: { gradient: "radial", x0: -22 * f, y0: -364, r0: 2, x1: -18 * f, y1: -358, r1: 28,
        stops: [
          { at: 0, color: "rgba(255,255,255,0.4)" },
          { at: 0.6, color: "rgba(255,255,255,0)" },
        ] } });

    if (hair === "fringe" || hair === "short") {
      // Fringe over forehead and visible side
      for (let i = 0; i < 4; i++) {
        const x1 = (-10 + i * 12) * f;
        const x2 = (2 + i * 12) * f;
        p.push({ kind: "polygon", points: [
          { x: x1, y: -332 },
          { x: (x1 + x2) / 2, y: -348 },
          { x: x2, y: -330 },
          { x: x2, y: -308 },
          { x: x1, y: -310 },
        ], fill: { palette: "hair" }, stroke: OUTLINE_SOFT, lineWidth: 1.2 });
      }
    } else if (hair === "spiky") {
      for (let i = 0; i < 4; i++) {
        const x1 = (-12 + i * 14) * f;
        const x2 = (2 + i * 14) * f;
        p.push({ kind: "polygon", points: [
          { x: x1, y: -322 },
          { x: (x1 + x2) / 2, y: -360 },
          { x: x2, y: -322 }, { x: x2 - 2, y: -300 }, { x: x1 + 2, y: -300 },
        ], fill: { palette: "hair" }, stroke: OUTLINE, lineWidth: 1.3 });
      }
    }
  }

  // ---- facial marks (only on visible side) ----
  for (const mark of opts.facialMarks ?? []) {
    const visible = mark.at.endsWith("cheek") || mark.at.endsWith("eye") || mark.at === "forehead";
    if (!visible) continue;
    const cx = mark.at === "forehead" ? 6 * f : 30 * f;
    const cy = mark.at === "forehead" ? -348 : mark.at.endsWith("eye") ? -304 : -288;
    if (mark.kind === "scar_diagonal") {
      p.push({ kind: "line", x1: cx - 5, y1: cy - 6, x2: cx + 8, y2: cy + 6,
        stroke: mark.color ?? "#5b1d12", lineWidth: 1.6, lineCap: "round" });
    } else if (mark.kind === "scar_x") {
      p.push({ kind: "line", x1: cx - 6, y1: cy - 6, x2: cx + 6, y2: cy + 6, stroke: mark.color ?? "#5b1d12", lineWidth: 1.4 });
      p.push({ kind: "line", x1: cx - 6, y1: cy + 6, x2: cx + 6, y2: cy - 6, stroke: mark.color ?? "#5b1d12", lineWidth: 1.4 });
    } else {
      p.push({ kind: "circle", cx, cy, r: 2.2, fill: mark.color ?? "#3a2410" });
    }
  }

  // ---- hat in profile ----
  if (opts.hat && opts.hat !== "none") {
    const hatColor = opts.hatColor ?? (opts.hat === "straw" ? "#e8c97a" : "#3a2820");
    p.push({ kind: "ellipse", cx: 0, cy: -362, rx: 78, ry: 14, fill: hatColor, stroke: OUTLINE, lineWidth: 1.6 });
    p.push({ kind: "polygon", points: [
      { x: -42, y: -360 }, { x: -36, y: -392 }, { x: 36, y: -392 }, { x: 42, y: -360 },
    ], fill: hatColor, stroke: OUTLINE, lineWidth: 1.6 });
    if (opts.hat === "straw" && opts.hatBandColor) {
      p.push({ kind: "rect", x: -42, y: -370, w: 84, h: 6, fill: opts.hatBandColor });
    }
    // Brim shadow falls onto the eye on the facing side.
    p.push({ kind: "rect", x: 0, y: -344, w: 56 * f, h: 14,
      fill: { gradient: "linear", x0: 0, y0: -344, x1: 0, y1: -330,
        stops: [
          { at: 0, color: "rgba(0,0,0,0.45)" },
          { at: 1, color: "rgba(0,0,0,0)" },
        ] } });
  }

  // ---- viseme-aware mouth on visible side ----
  // Same vocabulary as the front builder. Mouth sits ~26px forward
  // (on the facing side) at cy ≈ -262.
  const mx = 26 * f;
  p.push({ when: "mouth == neutral", kind: "polygon", points: [
    { x: mx - 10, y: -262 }, { x: mx, y: -260 }, { x: mx + 10, y: -262 },
  ], fill: "#2b1810" });
  p.push({ when: "mouth == soft", kind: "polygon", points: [
    { x: mx - 12, y: -260 }, { x: mx, y: -254 }, { x: mx + 10, y: -260 },
  ], fill: "#2b1810" });
  p.push({ when: "mouth == happy", kind: "polygon", points: [
    { x: mx - 14, y: -260 }, { x: mx, y: -248 }, { x: mx + 12, y: -260 },
    { x: mx + 10, y: -256 }, { x: mx, y: -244 }, { x: mx - 10, y: -256 },
  ], fill: "#2b1810" });
  p.push({ when: "mouth == laughing", kind: "ellipse", cx: mx, cy: -250, rx: 12, ry: 7, fill: "#2b1810" });
  p.push({ when: "mouth == sad", kind: "arc", cx: mx, cy: -250, r: 12, startAngle: Math.PI * 1.1, endAngle: Math.PI * 1.9, stroke: "#2b1810", lineWidth: 2.2 });
  p.push({ when: "mouth == crying", kind: "arc", cx: mx, cy: -248, r: 12, startAngle: Math.PI * 1.1, endAngle: Math.PI * 1.9, stroke: "#2b1810", lineWidth: 2.2 });
  p.push({ when: "mouth == angry", kind: "line", x1: mx - 10, y1: -256, x2: mx + 12, y2: -254, stroke: "#2b1810", lineWidth: 2.5 });
  p.push({ when: "mouth == surprised", kind: "ellipse", cx: mx, cy: -254, rx: 5, ry: 6, fill: "#2b1810" });
  p.push({ when: "mouth == scared", kind: "ellipse", cx: mx, cy: -252, rx: 7, ry: 9, fill: "#2b1810" });
  p.push({ when: "mouth == embarrassed", kind: "line", x1: mx - 6, y1: -256, x2: mx + 6, y2: -256, stroke: "#2b1810", lineWidth: 2 });
  p.push({ when: "mouth == smug", kind: "polygon", points: [
    { x: mx - 8, y: -260 }, { x: mx - 2, y: -258 }, { x: mx + 8, y: -250 },
    { x: mx + 6, y: -248 }, { x: mx - 6, y: -255 }, { x: mx - 8, y: -258 },
  ], fill: "#2b1810" });
  p.push({ when: "mouth == thinking", kind: "ellipse", cx: mx, cy: -256, rx: 4, ry: 1.2, fill: "#2b1810" });
  // Viseme shapes
  p.push({ when: "mouth == open", kind: "ellipse", cx: mx, cy: -250, rx: 10, ry: 8, fill: "#2b1810" });
  p.push({ when: "mouth == narrow", kind: "line", x1: mx - 10, y1: -255, x2: mx + 10, y2: -255, stroke: "#2b1810", lineWidth: 2.5 });
  p.push({ when: "mouth == round", kind: "circle", cx: mx, cy: -253, r: 5, fill: "#2b1810" });
  p.push({ when: "mouth == mid", kind: "ellipse", cx: mx, cy: -253, rx: 8, ry: 5, fill: "#2b1810" });
  p.push({ when: "mouth == wide", kind: "ellipse", cx: mx, cy: -252, rx: 14, ry: 6, fill: "#2b1810" });
  p.push({ when: "mouth == ee", kind: "polygon", points: [
    { x: mx - 12, y: -256 }, { x: mx, y: -248 }, { x: mx + 12, y: -256 },
    { x: mx + 10, y: -254 }, { x: mx, y: -246 }, { x: mx - 10, y: -254 },
  ], fill: "#2b1810" });

  // ---- displayName badge ----
  p.push({ kind: "rect", x: -64, y: -240, w: 128, h: 24, fill: "rgba(20,16,12,0.55)" });
  p.push({ kind: "text", x: 0, y: -222, text: "${name}", fill: "#fff8ed", size: 17, align: "center" });

  return { primitives: p, preview: { fit: "contain" } };
}

// =====================================================================
// THREE-QUARTER VIEW
// =====================================================================

/**
 * Three-quarter view — a side view nudged toward the camera by ~30%.
 * For the MVP we synthesize this by drawing a side view and overlaying
 * the far-side eye and a sliver of the far cheek. Cheap, but reads
 * distinctly from a flat profile.
 */
export function buildThreeQuarterShape(
  opts: HumanCharacterOptions = {},
  facing: 1 | -1 = 1,
): ProceduralShape {
  const base = buildSideViewShape(opts, facing);
  const f = facing;
  const extras: Primitive[] = [
    // Far eye — smaller, tucked further from center
    { kind: "polygon", points: [
      { x: -10 * f, y: -322 }, { x: 4 * f, y: -324 },
      { x: 6 * f, y: -314 }, { x: -8 * f, y: -312 },
    ], fill: "#1a120a" },
    { kind: "circle", cx: -2 * f, cy: -318, r: 3, fill: "#3a2410" },
    { kind: "circle", cx: -4 * f, cy: -320, r: 1.2, fill: "rgba(255,255,255,0.7)" },
    // Far eyebrow
    { kind: "polygon", points: [
      { x: -12 * f, y: -332 }, { x: 4 * f, y: -334 },
      { x: 4 * f, y: -330 }, { x: -12 * f, y: -328 },
    ], fill: "#1a120a" },
  ];
  return { ...base, primitives: [...base.primitives, ...extras] };
}
