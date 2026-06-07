// High-detail 2.5D human character shape generator.
//
// This is the "anime cel-shading" path — designed so AI-generated characters
// don't degenerate into stacked rectangles when written by hand. Instead of
// letting the model write 100+ primitives from scratch, expose this builder
// as both a TS function AND a CLI (scripts/build-character-shape.ts). The
// model only fills a high-level CharacterSpec and the geometry is generated
// deterministically with the same fidelity every time.
//
// What this builder produces over the old version:
//   - eyes: almond polygon + upper eyelid shadow strip + larger iris + double highlight
//   - eyebrows: arched thin polygons (~8px wide) instead of 20px rectangles
//   - nose: minimal — one shading line + two tiny nostril dots
//   - mouth: subtle upper-lip polygon + lower-lip hue shift + corner shadow
//   - hair: 6-10 overlapping wisps as polygons with curved tips + radial highlight + back tail
//   - face: jawline polygon clipped to head, cheek hue-shift (warmer than skin base)
//   - neck: occlusion strip at jawline + shadow inside collar
//   - torso: inner chest shadow + shoulder rim light + visible buttons / lacing
//   - sleeves: cuff highlight + inner-armpit shadow
//   - optional hat (straw / cap / beret) with brim-shadow on forehead
//   - optional facial marks (scars, marks) on the cheek/forehead/under-eye
//
// Everything still uses the existing procedural-shape DSL — no rendering
// changes required.

import type { ConditionalPrimitive, ProceduralShape } from "../engine/proceduralShape";
import {
  buildBackViewShape,
  buildSideViewShape,
  buildThreeQuarterShape,
} from "./characterShapesViews";

export type HairStyle = "short" | "fringe" | "spiky" | "flowing" | "bald";
export type HatStyle = "none" | "straw" | "cap" | "beret" | "headband";
export type CostumeStyle = "jacket" | "vest" | "robe" | "shirt" | "tank";
export type FacialMarkKind = "scar_diagonal" | "scar_x" | "mark_dot" | "mole";

export interface FacialMark {
  kind: FacialMarkKind;
  /** Position relative to head center: "left_cheek" | "right_cheek" | "forehead" | "under_left_eye" | "under_right_eye" */
  at: "left_cheek" | "right_cheek" | "forehead" | "under_left_eye" | "under_right_eye";
  color?: string;
}

export interface HumanCharacterOptions {
  scale?: number;
  hairStyle?: HairStyle;
  hat?: HatStyle;
  hatColor?: string;        // override straw default
  hatBandColor?: string;    // override the ribbon
  costume?: CostumeStyle;
  /** Whether to draw shorts (true) or full-length pants (false). */
  shorts?: boolean;
  facialMarks?: FacialMark[];
  /** Eye style: "round" (chibi) | "almond" (anime, default) | "narrow" (sharp). */
  eyeStyle?: "round" | "almond" | "narrow";
  /** Add chest emblem circle (One-Piece-vest style). */
  chestEmblem?: { color: string };
}

const SUPPORTED_ACTIONS = ["idle", "walking", "attack", "defend", "victory"] as const;
export type CharacterAction = (typeof SUPPORTED_ACTIONS)[number];
export const HUMAN_CHARACTER_ACTIONS: ReadonlyArray<CharacterAction> = SUPPORTED_ACTIONS;
export const HUMAN_CHARACTER_EXPRESSIONS = [
  "neutral", "happy", "sad", "angry", "surprised",
  "soft", "scared", "smug", "embarrassed", "thinking",
  "crying", "laughing",
] as const;
export const HUMAN_CHARACTER_VISEMES = ["rest", "open", "narrow", "round", "mid", "wide", "ee"] as const;

/** Views the builder family knows how to produce. */
export const HUMAN_CHARACTER_VIEWS = [
  "front",
  "back",
  "sideLeft",
  "sideRight",
  "threeQuarterLeft",
  "threeQuarterRight",
] as const;
export type HumanCharacterView = (typeof HUMAN_CHARACTER_VIEWS)[number];

const OUTLINE = "rgba(20,16,12,0.7)";
const OUTLINE_SOFT = "rgba(20,16,12,0.45)";

export function buildHumanCharacterShape(opts: HumanCharacterOptions = {}): ProceduralShape {
  const hair: HairStyle = opts.hairStyle ?? "fringe";
  const hat: HatStyle = opts.hat ?? "none";
  const costume: CostumeStyle = opts.costume ?? "jacket";
  const eyeStyle = opts.eyeStyle ?? "almond";
  const shorts = opts.shorts ?? false;
  const marks = opts.facialMarks ?? [];

  const p: ConditionalPrimitive[] = [];

  // ============================================================
  // CONTACT SHADOW — z-aware, soft radial.
  // ============================================================
  p.push({
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
  });

  // ============================================================
  // SHOES — rounded toe + heel shadow + top sheen.
  // ============================================================
  for (const sign of [-1, 1]) {
    const x = sign * 30;
    p.push({ kind: "polygon", points: [
      { x: x - 24, y: -6 },
      { x: x + 24, y: -6 },
      { x: x + 26, y: 4 },
      { x: x + 22, y: 22 },
      { x: x - 22, y: 22 },
      { x: x - 26, y: 4 },
    ], fill: "#1a120a", stroke: OUTLINE, lineWidth: 1.6 });
    p.push({ kind: "ellipse", cx: x - 4, cy: -1, rx: 12, ry: 3.5, fill: "rgba(255,255,255,0.32)" });
    p.push({ kind: "polygon", points: [
      { x: x - 24, y: 12 }, { x: x + 24, y: 12 },
      { x: x + 22, y: 22 }, { x: x - 22, y: 22 },
    ], fill: "rgba(0,0,0,0.4)" });
  }

  // ============================================================
  // PANTS / SHORTS — base + linear gradient + side wrinkles + outline
  // ============================================================
  const legTop = shorts ? -20 : -48;
  const legBottom = -6;
  const legH = legBottom - legTop;
  for (const sign of [-1, 1]) {
    const x = sign * 30;
    // idle stance: straight legs
    p.push({ when: "action not in [walking]", kind: "roundedRect",
      x: x - 18, y: legTop, w: 36, h: legH, r: shorts ? 10 : 8,
      fill: { palette: "pants" } });
    // linear key light
    p.push({ when: "action not in [walking]", kind: "roundedRect",
      x: x - 18, y: legTop, w: 36, h: legH, r: shorts ? 10 : 8,
      fill: { gradient: "linear", x0: x - 18, y0: legTop, x1: x + 18, y1: legBottom,
        stops: [
          { at: 0, color: "rgba(255,255,255,0.16)" },
          { at: 0.5, color: "rgba(255,255,255,0)" },
          { at: 1, color: "rgba(0,0,0,0.32)" },
        ] } });
    // outer-side rim
    p.push({ when: "action not in [walking]", kind: "line",
      x1: x - 18, y1: legTop + 4, x2: x - 18, y2: legBottom - 4,
      stroke: "rgba(0,0,0,0.3)", lineWidth: 1.2 });
    // outline silhouette
    p.push({ when: "action not in [walking]", kind: "roundedRect",
      x: x - 18, y: legTop, w: 36, h: legH, r: shorts ? 10 : 8,
      stroke: OUTLINE, lineWidth: 1.6 });
    // shorts: rough hem
    if (shorts) {
      p.push({ when: "action not in [walking]", kind: "line",
        x1: x - 18, y1: legBottom - 2, x2: x + 18, y2: legBottom - 4,
        stroke: "rgba(0,0,0,0.45)", lineWidth: 1.4, lineCap: "round" });
      // bare leg below shorts (visible skin)
      p.push({ when: "action not in [walking]", kind: "roundedRect",
        x: x - 13, y: legBottom, w: 26, h: 14, r: 5,
        fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 });
      p.push({ when: "action not in [walking]", kind: "roundedRect",
        x: x - 13, y: legBottom, w: 26, h: 14, r: 5,
        fill: { gradient: "linear", x0: x - 13, y0: legBottom, x1: x + 13, y1: legBottom + 14,
          stops: [{ at: 0, color: "rgba(255,255,255,0.18)" }, { at: 1, color: "rgba(0,0,0,0.25)" }] } });
    }
  }

  // walking legs (transform-swing) — keep the swing simple but with outline
  for (const cfg of [{ x: -30, phase: 0 }, { x: 30, phase: Math.PI }]) {
    p.push({ when: "action == walking", kind: "transform",
      translate: { x: cfg.x, y: legTop },
      rotate: `sin(time * 8 + ${cfg.phase}) * 0.5`,
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: legH, r: shorts ? 10 : 8, fill: { palette: "pants" } },
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: legH, r: shorts ? 10 : 8,
          fill: { gradient: "linear", x0: -18, y0: 0, x1: 18, y1: legH,
            stops: [{ at: 0, color: "rgba(255,255,255,0.16)" }, { at: 1, color: "rgba(0,0,0,0.32)" }] } },
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: legH, r: shorts ? 10 : 8, stroke: OUTLINE, lineWidth: 1.6 },
      ],
    });
  }

  // ============================================================
  // TORSO — base + gradient + collar / opening based on costume
  // ============================================================
  // Belt (skip if costume is tank top)
  if (costume !== "tank") {
    p.push({ kind: "rect", x: -50, y: -56, w: 100, h: 12, fill: "#241a12" });
    p.push({ kind: "rect", x: -50, y: -56, w: 100, h: 12,
      fill: { gradient: "linear", x0: 0, y0: -56, x1: 0, y1: -44,
        stops: [{ at: 0, color: "rgba(255,255,255,0.18)" }, { at: 1, color: "rgba(0,0,0,0.4)" }] } });
    p.push({ kind: "roundedRect", x: -9, y: -55, w: 18, h: 10, r: 2, fill: "#d4ad62", stroke: OUTLINE, lineWidth: 1.2 });
    p.push({ kind: "rect", x: -50, y: -56, w: 100, h: 12, stroke: OUTLINE, lineWidth: 1.4 });
  }

  // Torso base body color
  p.push({ kind: "roundedRect", x: -58, y: -245, w: 116, h: 205, r: 36,
    fill: { palette: "body" },
    shadow: { blur: 16, offsetY: 6, color: "rgba(18,12,8,0.32)" } });

  // Costume-specific inner garment showing through opening
  // For "jacket" or "vest" — open V-front showing skin/inner shirt
  if (costume === "jacket" || costume === "vest") {
    // Skin/inner shirt V-opening
    p.push({ kind: "polygon", points: [
      { x: -30, y: -240 }, { x: 30, y: -240 },
      { x: 14, y: -180 }, { x: 0, y: -160 }, { x: -14, y: -180 },
    ], fill: { palette: "skin" } });
    // Chest shadow inside V
    p.push({ kind: "polygon", points: [
      { x: -14, y: -180 }, { x: 0, y: -160 }, { x: 14, y: -180 },
      { x: 8, y: -185 }, { x: 0, y: -172 }, { x: -8, y: -185 },
    ], fill: "rgba(80,40,20,0.32)" });
    // V-line shading on chest (rib hint)
    p.push({ kind: "line", x1: 0, y1: -200, x2: 0, y2: -165,
      stroke: "rgba(80,40,20,0.4)", lineWidth: 1.3, lineCap: "round" });
    // Lapels — left + right slanted polygons
    for (const sign of [-1, 1]) {
      p.push({ kind: "polygon", points: [
        { x: sign * 58, y: -240 },
        { x: sign * 14, y: -240 },
        { x: sign * 6, y: -180 },
        { x: sign * 16, y: -120 },
        { x: sign * 42, y: -160 },
      ], fill: { palette: "body", darken: 20 } });
      p.push({ kind: "polygon", points: [
        { x: sign * 58, y: -240 },
        { x: sign * 14, y: -240 },
        { x: sign * 6, y: -180 },
        { x: sign * 16, y: -120 },
        { x: sign * 42, y: -160 },
      ], fill: { gradient: "linear",
        x0: sign * 58, y0: -240, x1: sign * 6, y1: -120,
        stops: [
          { at: 0, color: "rgba(255,255,255,0.22)" },
          { at: 1, color: "rgba(0,0,0,0.28)" },
        ] }, stroke: OUTLINE, lineWidth: 1.5 });
    }
    // 3 buttons / lacing
    for (const y of [-150, -120, -90]) {
      p.push({ kind: "circle", cx: 0, cy: y, r: 4, fill: "#d4ad62", stroke: OUTLINE, lineWidth: 1 });
      p.push({ kind: "circle", cx: -1, cy: y - 1, r: 1.5, fill: "rgba(255,255,255,0.5)" });
    }
  } else if (costume === "shirt") {
    // simple buttoned shirt: single vertical strip + small buttons
    p.push({ kind: "rect", x: -3, y: -240, w: 6, h: 200, fill: { palette: "body", darken: 28 } });
    for (const y of [-220, -180, -140, -100]) {
      p.push({ kind: "circle", cx: 0, cy: y, r: 3, fill: "#e7d4a0", stroke: OUTLINE, lineWidth: 0.8 });
    }
  } else if (costume === "robe") {
    // crossed-over robe: diagonal seam
    p.push({ kind: "polygon", points: [
      { x: -58, y: -245 }, { x: 30, y: -245 },
      { x: 14, y: -50 }, { x: -58, y: -50 },
    ], fill: { palette: "body", darken: 12 }, stroke: OUTLINE, lineWidth: 1.5 });
  }

  // Linear key-light over torso (always — final pass)
  p.push({ kind: "roundedRect", x: -58, y: -245, w: 116, h: 205, r: 36,
    fill: { gradient: "linear", x0: -58, y0: -245, x1: 58, y1: -40,
      stops: [
        { at: 0, color: "rgba(255,255,255,0.18)" },
        { at: 0.4, color: "rgba(255,255,255,0)" },
        { at: 0.85, color: "rgba(0,0,0,0.18)" },
        { at: 1, color: "rgba(0,0,0,0.34)" },
      ] } });

  // Torso wrinkle/fold hints — 3 soft strokes at bottom
  p.push({ kind: "line", x1: -32, y1: -110, x2: -16, y2: -78, stroke: "rgba(0,0,0,0.28)", lineWidth: 2, lineCap: "round" });
  p.push({ kind: "line", x1: 32, y1: -110, x2: 16, y2: -78, stroke: "rgba(0,0,0,0.28)", lineWidth: 2, lineCap: "round" });
  p.push({ kind: "line", x1: 0, y1: -80, x2: 0, y2: -58, stroke: "rgba(0,0,0,0.22)", lineWidth: 1.8, lineCap: "round" });

  // Chest emblem (optional)
  if (opts.chestEmblem) {
    p.push({ kind: "circle", cx: 30, cy: -190, r: 12, fill: "rgba(0,0,0,0.2)" });
    p.push({ kind: "circle", cx: 30, cy: -190, r: 11, fill: opts.chestEmblem.color, stroke: OUTLINE, lineWidth: 1.2 });
    p.push({ kind: "circle", cx: 28, cy: -192, r: 3, fill: "rgba(255,255,255,0.45)" });
  }

  // Final torso silhouette outline
  p.push({ kind: "roundedRect", x: -58, y: -245, w: 116, h: 205, r: 36,
    stroke: OUTLINE, lineWidth: 1.8 });

  // ============================================================
  // ARMS — idle / walking / attack / defend / victory branches
  // ============================================================
  // Idle arm template
  const idleArm = (sign: number): ConditionalPrimitive => ({
    when: "action in [idle, defend]",
    kind: "transform",
    translate: { x: sign * 56, y: -210 },
    rotate: sign > 0 ? "0.05 + sin(time * 1.4) * 0.02" : "-0.05 + sin(time * 1.4 + PI) * 0.02",
    children: [
      // shoulder pad shadow under the sleeve
      { kind: "ellipse", cx: 0, cy: 4, rx: 20, ry: 10, fill: "rgba(0,0,0,0.35)" },
      // upper sleeve
      { kind: "roundedRect", x: -18, y: 0, w: 36, h: 78, r: 17, fill: { palette: "body" } },
      { kind: "roundedRect", x: -18, y: 0, w: 36, h: 78, r: 17,
        fill: { gradient: "linear", x0: -18, y0: 0, x1: 18, y1: 78,
          stops: [{ at: 0, color: "rgba(255,255,255,0.22)" }, { at: 1, color: "rgba(0,0,0,0.32)" }] } },
      { kind: "roundedRect", x: -18, y: 0, w: 36, h: 78, r: 17, stroke: OUTLINE, lineWidth: 1.5 },
      // sleeve cuff (rolled-up look)
      { kind: "roundedRect", x: -20, y: 70, w: 40, h: 14, r: 6, fill: { palette: "body", darken: 24 }, stroke: OUTLINE, lineWidth: 1.4 },
      { kind: "line", x1: -16, y1: 78, x2: 16, y2: 78, stroke: "rgba(255,255,255,0.25)", lineWidth: 1.2 },
      // forearm (skin)
      { kind: "roundedRect", x: -14, y: 84, w: 28, h: 50, r: 13, fill: { palette: "skin" } },
      { kind: "roundedRect", x: -14, y: 84, w: 28, h: 50, r: 13,
        fill: { gradient: "linear", x0: -14, y0: 84, x1: 14, y1: 134,
          stops: [{ at: 0, color: "rgba(255,255,255,0.2)" }, { at: 1, color: "rgba(0,0,0,0.25)" }] } },
      { kind: "roundedRect", x: -14, y: 84, w: 28, h: 50, r: 13, stroke: OUTLINE, lineWidth: 1.4 },
      // hand (rounded fist — palm shading)
      { kind: "circle", cx: 0, cy: 142, r: 13, fill: { palette: "skin" } },
      { kind: "circle", cx: 0, cy: 142, r: 13,
        fill: { gradient: "radial", x0: -3, y0: 138, r0: 1, x1: 0, y1: 144, r1: 14,
          stops: [
            { at: 0, color: "rgba(255,255,255,0.4)" },
            { at: 0.6, color: "rgba(255,255,255,0)" },
            { at: 1, color: "rgba(0,0,0,0.3)" },
          ] } },
      // 3 small knuckle dimples
      { kind: "circle", cx: -5, cy: 138, r: 1.2, fill: "rgba(0,0,0,0.35)" },
      { kind: "circle", cx: 0, cy: 137, r: 1.2, fill: "rgba(0,0,0,0.35)" },
      { kind: "circle", cx: 5, cy: 138, r: 1.2, fill: "rgba(0,0,0,0.35)" },
      { kind: "circle", cx: 0, cy: 142, r: 13, stroke: OUTLINE, lineWidth: 1.4 },
    ],
  });
  p.push(idleArm(-1));
  p.push(idleArm(1));

  // defend overlay — crossed forearms at chest
  for (const sign of [-1, 1]) {
    p.push({ when: "action == defend", kind: "transform",
      translate: { x: sign * 18, y: -148 }, rotate: sign * 0.62,
      children: [
        { kind: "roundedRect", x: -16, y: 0, w: 32, h: 108, r: 16, fill: { palette: "body", darken: 28 } },
        { kind: "roundedRect", x: -16, y: 0, w: 32, h: 108, r: 16, stroke: OUTLINE, lineWidth: 1.5 },
        { kind: "circle", cx: 0, cy: 114, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 },
      ],
    });
  }

  // walking — extended sleeve swing
  for (const cfg of [{ x: -56, phase: Math.PI }, { x: 56, phase: 0 }]) {
    p.push({ when: "action == walking", kind: "transform",
      translate: { x: cfg.x, y: -195 },
      rotate: `sin(time * 8 + ${cfg.phase}) * 0.32`,
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 128, r: 17, fill: { palette: "body" } },
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 128, r: 17,
          fill: { gradient: "linear", x0: -18, y0: 0, x1: 18, y1: 128,
            stops: [{ at: 0, color: "rgba(255,255,255,0.22)" }, { at: 1, color: "rgba(0,0,0,0.32)" }] } },
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 128, r: 17, stroke: OUTLINE, lineWidth: 1.5 },
        { kind: "roundedRect", x: -20, y: 120, w: 40, h: 12, r: 6, fill: { palette: "body", darken: 28 }, stroke: OUTLINE, lineWidth: 1.4 },
        { kind: "circle", cx: 0, cy: 142, r: 12, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 },
      ],
    });
  }

  // attack — right arm thrust forward + motion line
  p.push({ when: "action == attack", kind: "transform",
    translate: { x: 50, y: -200 }, rotate: -1.55,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 145, r: 16, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 145, r: 16,
        fill: { gradient: "linear", x0: -16, y0: 0, x1: 16, y1: 145,
          stops: [{ at: 0, color: "rgba(255,255,255,0.28)" }, { at: 1, color: "rgba(0,0,0,0.34)" }] } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 145, r: 16, stroke: OUTLINE, lineWidth: 1.6 },
      // fist
      { kind: "circle", cx: 0, cy: 158, r: 17, fill: { palette: "skin" } },
      { kind: "circle", cx: 0, cy: 158, r: 17,
        fill: { gradient: "radial", x0: -5, y0: 152, r0: 2, x1: 0, y1: 160, r1: 18,
          stops: [{ at: 0, color: "rgba(255,255,255,0.4)" }, { at: 1, color: "rgba(0,0,0,0.3)" }] } },
      { kind: "circle", cx: 0, cy: 158, r: 17, stroke: OUTLINE, lineWidth: 1.6 },
      // motion line
      { kind: "line", x1: 0, y1: 18, x2: 0, y2: -48, stroke: "rgba(255,210,120,0.6)", lineWidth: 5, lineCap: "round" },
      { kind: "line", x1: -6, y1: 12, x2: -10, y2: -28, stroke: "rgba(255,210,120,0.35)", lineWidth: 3, lineCap: "round" },
      { kind: "line", x1: 6, y1: 12, x2: 10, y2: -28, stroke: "rgba(255,210,120,0.35)", lineWidth: 3, lineCap: "round" },
    ],
  });
  // attack left arm — tucked at hip
  p.push({ when: "action == attack", kind: "transform",
    translate: { x: -50, y: -195 }, rotate: 0.8,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 110, r: 16, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 110, r: 16, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: 122, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 },
    ],
  });

  // victory — right arm raised, V-fingers
  p.push({ when: "action == victory", kind: "transform",
    translate: { x: 48, y: -210 }, rotate: -2.4,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 145, r: 16, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 145, r: 16,
        fill: { gradient: "linear", x0: -16, y0: 0, x1: 16, y1: 145,
          stops: [{ at: 0, color: "rgba(255,255,255,0.26)" }, { at: 1, color: "rgba(0,0,0,0.32)" }] } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 145, r: 16, stroke: OUTLINE, lineWidth: 1.6 },
      { kind: "circle", cx: 0, cy: 158, r: 14, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 },
      // peace sign — two fingers up
      { kind: "polygon", points: [
        { x: -8, y: 150 }, { x: -5, y: 150 }, { x: -5, y: 132 }, { x: -8, y: 132 },
      ], fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.1 },
      { kind: "polygon", points: [
        { x: 5, y: 150 }, { x: 8, y: 150 }, { x: 8, y: 132 }, { x: 5, y: 132 },
      ], fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.1 },
    ],
  });
  // victory left arm — relaxed
  p.push({ when: "action == victory", kind: "transform",
    translate: { x: -56, y: -200 }, rotate: 0.15,
    children: [
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 140, r: 16, fill: { palette: "body" } },
      { kind: "roundedRect", x: -16, y: 0, w: 32, h: 140, r: 16, stroke: OUTLINE, lineWidth: 1.5 },
      { kind: "circle", cx: 0, cy: 152, r: 13, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.4 },
    ],
  });

  // ============================================================
  // NECK — base + heavy occlusion shadow under jawline
  // ============================================================
  p.push({ kind: "roundedRect", x: -15, y: -274, w: 30, h: 32, r: 7, fill: { palette: "skin" } });
  p.push({ kind: "roundedRect", x: -15, y: -274, w: 30, h: 32, r: 7,
    fill: { gradient: "linear", x0: -15, y0: -274, x1: 15, y1: -242,
      stops: [
        { at: 0, color: "rgba(60,30,20,0.6)" },
        { at: 0.5, color: "rgba(60,30,20,0.25)" },
        { at: 1, color: "rgba(0,0,0,0.32)" },
      ] } });
  p.push({ kind: "roundedRect", x: -15, y: -274, w: 30, h: 32, r: 7, stroke: OUTLINE, lineWidth: 1.3 });
  // jawline occlusion strip
  p.push({ kind: "ellipse", cx: 0, cy: -252, rx: 42, ry: 8, fill: "rgba(40,22,16,0.5)" });

  // ============================================================
  // HEAD — circle base + warm radial highlight + jawline + cheek hue
  // ============================================================
  p.push({ kind: "circle", cx: 0, cy: -310, r: 70, fill: { palette: "skin" } });
  // Main face radial gradient (key light upper-left)
  p.push({ kind: "circle", cx: 0, cy: -310, r: 70,
    fill: { gradient: "radial",
      x0: -22, y0: -334, r0: 6, x1: 0, y1: -310, r1: 72,
      stops: [
        { at: 0, color: "rgba(255,250,238,0.5)" },
        { at: 0.45, color: "rgba(255,250,238,0)" },
        { at: 0.9, color: "rgba(80,38,24,0.18)" },
        { at: 1, color: "rgba(80,38,24,0.42)" },
      ] } });
  // Cheek warmth — two soft pink ovals
  p.push({ kind: "ellipse", cx: -32, cy: -278, rx: 14, ry: 8, fill: "rgba(220,110,90,0.28)" });
  p.push({ kind: "ellipse", cx: 32, cy: -278, rx: 14, ry: 8, fill: "rgba(220,110,90,0.28)" });
  // Right-side jaw shadow clipped to head
  p.push({ kind: "clip",
    shape: { kind: "circle", cx: 0, cy: -310, r: 70 },
    children: [
      { kind: "polygon", points: [
        { x: 22, y: -270 }, { x: 64, y: -300 },
        { x: 56, y: -244 }, { x: 8, y: -250 },
      ], fill: "rgba(80,38,24,0.22)" },
    ],
  });

  // Ears (sit slightly behind hair locks)
  for (const sign of [-1, 1]) {
    p.push({ kind: "ellipse", cx: sign * 68, cy: -312, rx: 8, ry: 16, fill: { palette: "skin" }, stroke: OUTLINE, lineWidth: 1.3 });
    p.push({ kind: "ellipse", cx: sign * 68, cy: -310, rx: 4, ry: 9, fill: "rgba(80,38,24,0.42)" });
    p.push({ kind: "line", x1: sign * 66, y1: -316, x2: sign * 66, y2: -302, stroke: "rgba(0,0,0,0.35)", lineWidth: 1 });
  }

  // Head outline last (the silhouette read)
  p.push({ kind: "circle", cx: 0, cy: -310, r: 70, stroke: OUTLINE, lineWidth: 1.8 });

  // ============================================================
  // HAIR — multiple polygon wisps, soft tips, with highlight strip
  // ============================================================
  if (hair !== "bald") {
    // Back hair mass (sits behind head)
    p.push({ kind: "polygon", points: [
      { x: -72, y: -340 }, { x: -56, y: -370 }, { x: -28, y: -380 },
      { x: 0, y: -382 }, { x: 28, y: -380 }, { x: 56, y: -370 },
      { x: 72, y: -340 }, { x: 70, y: -288 }, { x: -70, y: -288 },
    ], fill: { palette: "hair" }, stroke: OUTLINE, lineWidth: 1.5 });
    // Crown highlight strip — radial
    p.push({ kind: "ellipse", cx: -10, cy: -362, rx: 36, ry: 14,
      fill: { gradient: "radial", x0: -16, y0: -368, r0: 2, x1: -10, y1: -362, r1: 36,
        stops: [
          { at: 0, color: "rgba(255,255,255,0.4)" },
          { at: 0.6, color: "rgba(255,255,255,0)" },
          { at: 1, color: "rgba(0,0,0,0.2)" },
        ] } });

    if (hair === "fringe") {
      // Soft fringe — 6 polygon locks across the forehead
      const fringe: Array<[number, number, number]> = [
        [-58, -325, -38],
        [-38, -340, -22],
        [-22, -348, -8],
        [-8, -342, 10],
        [10, -344, 26],
        [26, -332, 46],
      ];
      for (const [x1, ytip, x2] of fringe) {
        p.push({ kind: "polygon", points: [
          { x: x1, y: -332 },
          { x: (x1 + x2) / 2 + 2, y: ytip },
          { x: x2, y: -330 },
          { x: x2 - 4, y: -300 },
          { x: x1 + 4, y: -302 },
        ], fill: { palette: "hair" }, stroke: OUTLINE_SOFT, lineWidth: 1.2 });
      }
    } else if (hair === "spiky") {
      // Spiky bangs — 6 sharp triangular locks
      const tips: Array<[number, number, number]> = [
        [-58, -350, -38], [-38, -370, -18], [-18, -380, 4],
        [4, -376, 22], [22, -360, 42], [42, -340, 60],
      ];
      for (const [x1, ytip, x2] of tips) {
        p.push({ kind: "polygon", points: [
          { x: x1, y: -320 }, { x: (x1 + x2) / 2, y: ytip },
          { x: x2, y: -320 }, { x: x2 - 4, y: -296 },
          { x: x1 + 4, y: -296 },
        ], fill: { palette: "hair" }, stroke: OUTLINE, lineWidth: 1.3 });
      }
    } else if (hair === "short") {
      // close-cropped — single chunky polygon over the crown
      p.push({ kind: "polygon", points: [
        { x: -64, y: -325 }, { x: -50, y: -360 }, { x: -20, y: -372 },
        { x: 0, y: -374 }, { x: 20, y: -372 }, { x: 50, y: -360 },
        { x: 64, y: -325 }, { x: 56, y: -305 }, { x: -56, y: -305 },
      ], fill: { palette: "hair" }, stroke: OUTLINE, lineWidth: 1.5 });
    } else if (hair === "flowing") {
      // Long flowing — extra mass behind shoulders
      p.push({ kind: "polygon", points: [
        { x: -82, y: -345 }, { x: -70, y: -240 }, { x: -56, y: -200 },
        { x: -44, y: -245 }, { x: -50, y: -310 },
      ], fill: { palette: "hair", darken: 18 }, stroke: OUTLINE, lineWidth: 1.4 });
      p.push({ kind: "polygon", points: [
        { x: 82, y: -345 }, { x: 70, y: -240 }, { x: 56, y: -200 },
        { x: 44, y: -245 }, { x: 50, y: -310 },
      ], fill: { palette: "hair", darken: 18 }, stroke: OUTLINE, lineWidth: 1.4 });
      // Soft side-swept fringe
      for (let i = 0; i < 5; i++) {
        const dx = -50 + i * 22;
        p.push({ kind: "polygon", points: [
          { x: dx, y: -340 }, { x: dx + 14, y: -348 },
          { x: dx + 18, y: -296 }, { x: dx + 4, y: -298 },
        ], fill: { palette: "hair" }, stroke: OUTLINE_SOFT, lineWidth: 1.1 });
      }
    }

    // Sideburns (subtle, except short/flowing)
    if (hair === "fringe" || hair === "spiky") {
      for (const sign of [-1, 1]) {
        p.push({ kind: "polygon", points: [
          { x: sign * 72, y: -322 }, { x: sign * 58, y: -322 },
          { x: sign * 56, y: -274 }, { x: sign * 68, y: -280 },
        ], fill: { palette: "hair", darken: 18 }, stroke: OUTLINE_SOFT, lineWidth: 1.1 });
      }
    }
  }

  // ============================================================
  // ============================================================
  // FACE BLOCK — eyebrows, eyes, nose, mouth, jaw
  // Buffered into `facePrim` so the whole face is wrapped in a single
  // transform driven by `headYaw` / `headPitch`. Eyes / mouth shift
  // with the head pose without restructuring every primitive.
  // ============================================================
  const facePrim: ConditionalPrimitive[] = [];

  // EYEBROWS — thin arched polygons (expression-controlled)
  // ============================================================
  const browY = -320;
  for (const sign of [-1, 1]) {
    // Neutral — gentle arch
    facePrim.push({ when: "expression not in [angry, sad]", kind: "polygon", points: [
      { x: sign * 38, y: browY },
      { x: sign * 12, y: browY - 3 },
      { x: sign * 12, y: browY + 1 },
      { x: sign * 38, y: browY + 4 },
    ], fill: "#1a120a" });
    // Angry — tilted inward + thicker
    facePrim.push({ when: "expression == angry", kind: "polygon", points: [
      { x: sign * 38, y: browY - 4 },
      { x: sign * 12, y: browY + 6 },
      { x: sign * 12, y: browY + 9 },
      { x: sign * 38, y: browY },
    ], fill: "#1a120a" });
    // Sad — tilted outward
    facePrim.push({ when: "expression == sad", kind: "polygon", points: [
      { x: sign * 38, y: browY + 4 },
      { x: sign * 12, y: browY - 4 },
      { x: sign * 12, y: browY },
      { x: sign * 38, y: browY + 8 },
    ], fill: "#1a120a" });
  }

  // ============================================================
  // EYES — almond / round / narrow polygon shape
  // ============================================================
  for (const sign of [-1, 1]) {
    const ex = sign * 26;
    const ey = -302;

    if (eyeStyle === "almond") {
      // outer almond polygon (sclera)
      facePrim.push({ kind: "polygon", points: [
        { x: ex - 12, y: ey + 1 },
        { x: ex - 8, y: ey - 6 },
        { x: ex + 8, y: ey - 7 },
        { x: ex + 12, y: ey - 2 },
        { x: ex + 8, y: ey + 5 },
        { x: ex - 8, y: ey + 5 },
      ], fill: "#fbf6ee", stroke: OUTLINE, lineWidth: 1.4 });
      // upper eyelid shadow strip
      facePrim.push({ kind: "polygon", points: [
        { x: ex - 12, y: ey + 1 },
        { x: ex - 8, y: ey - 6 },
        { x: ex + 8, y: ey - 7 },
        { x: ex + 12, y: ey - 2 },
        { x: ex + 8, y: ey - 2 },
        { x: ex - 8, y: ey - 1 },
      ], fill: "rgba(40,20,12,0.32)" });
    } else if (eyeStyle === "narrow") {
      // narrow squint — slit polygon
      facePrim.push({ kind: "polygon", points: [
        { x: ex - 12, y: ey + 2 },
        { x: ex - 5, y: ey - 3 },
        { x: ex + 5, y: ey - 3 },
        { x: ex + 12, y: ey + 2 },
        { x: ex + 5, y: ey + 4 },
        { x: ex - 5, y: ey + 4 },
      ], fill: "#fbf6ee", stroke: OUTLINE, lineWidth: 1.4 });
    } else {
      // round chibi
      facePrim.push({ kind: "ellipse", cx: ex, cy: ey, rx: 11, ry: 9, fill: "#fbf6ee", stroke: OUTLINE, lineWidth: 1.4 });
    }

    // Iris (larger for anime feel)
    facePrim.push({ kind: "circle", cx: ex, cy: ey + 1, r: 6,
      fill: { gradient: "radial", x0: ex, y0: ey, r0: 1, x1: ex, y1: ey + 2, r1: 6,
        stops: [{ at: 0, color: "#3a6f8a" }, { at: 1, color: "#1f3a4a" }] } });
    // Pupil
    facePrim.push({ when: "expression != surprised", kind: "circle", cx: ex, cy: ey + 1, r: 3, fill: "#08111a" });
    // Surprised pupil — small
    facePrim.push({ when: "expression == surprised", kind: "circle", cx: ex, cy: ey + 1, r: 1.5, fill: "#08111a" });
    // Double highlight
    facePrim.push({ kind: "circle", cx: ex - 2, cy: ey - 1, r: 2, fill: "rgba(255,255,255,0.95)" });
    facePrim.push({ kind: "circle", cx: ex + 2.5, cy: ey + 2.5, r: 1, fill: "rgba(255,255,255,0.7)" });
    // Lower eyelid hint
    facePrim.push({ kind: "line", x1: ex - 8, y1: ey + 5, x2: ex + 8, y2: ey + 5,
      stroke: "rgba(40,20,12,0.4)", lineWidth: 1 });
  }

  // ============================================================
  // NOSE — minimal: tiny shading line on one side + nostril dot
  // ============================================================
  facePrim.push({ kind: "line", x1: -3, y1: -286, x2: -5, y2: -272, stroke: "rgba(60,30,20,0.4)", lineWidth: 1.2, lineCap: "round" });
  facePrim.push({ kind: "circle", cx: -2, cy: -270, r: 1, fill: "rgba(60,30,20,0.5)" });
  facePrim.push({ kind: "circle", cx: 3, cy: -270, r: 1, fill: "rgba(60,30,20,0.5)" });
  // nose tip soft highlight
  facePrim.push({ kind: "ellipse", cx: 0, cy: -273, rx: 3, ry: 1.5, fill: "rgba(255,250,238,0.45)" });

  // ============================================================
  // MOUTH — viseme-aware (when talking) OR expression-aware (when silent).
  // ============================================================
  //
  // The `mouth` shape-state key is set by the character painter:
  //   - active dialogue  → mouth = viseme  (open/narrow/round/mid/wide/ee)
  //   - silent           → mouth = expression (neutral/sad/happy/...)
  //
  // We list expressions FIRST so the resting/idle reads stay; the viseme
  // branches override them whenever a dialogue/lipSync event drives the
  // viseme away from "rest".

  // --- Silent expressions (mouth == <expression>) ---
  // Neutral — slight smile arc
  facePrim.push({ when: "mouth == neutral", kind: "polygon", points: [
    { x: -14, y: -258 }, { x: -8, y: -256 }, { x: 0, y: -255 },
    { x: 8, y: -256 }, { x: 14, y: -258 },
    { x: 14, y: -257 }, { x: 0, y: -253 }, { x: -14, y: -257 },
  ], fill: "#2b1810" });
  facePrim.push({ when: "mouth == neutral", kind: "ellipse", cx: 0, cy: -250, rx: 11, ry: 2.5, fill: "rgba(200,100,80,0.32)" });

  // Soft smile (intensity-amplified)
  facePrim.push({ when: "mouth == soft", kind: "polygon", points: [
    { x: -16, y: "-256 + 2 * intensity" }, { x: -8, y: "-250 + 2 * intensity" }, { x: 0, y: "-248 + 2 * intensity" },
    { x: 8, y: "-250 + 2 * intensity" }, { x: 16, y: "-256 + 2 * intensity" },
    { x: 14, y: "-254 + 2 * intensity" }, { x: 0, y: "-244 + 4 * intensity" }, { x: -14, y: "-254 + 2 * intensity" },
  ], fill: "#2b1810" });

  // Happy (open smile, more amplitude than soft)
  facePrim.push({ when: "mouth == happy", kind: "polygon", points: [
    { x: -20, y: "-256 + 3 * intensity" }, { x: -10, y: "-246 + 4 * intensity" }, { x: 0, y: "-244 + 4 * intensity" },
    { x: 10, y: "-246 + 4 * intensity" }, { x: 20, y: "-256 + 3 * intensity" },
    { x: 16, y: -252 }, { x: 0, y: "-238 + 6 * intensity" }, { x: -16, y: -252 },
  ], fill: "#2b1810" });
  facePrim.push({ when: "mouth == happy", kind: "ellipse", cx: 0, cy: -245, rx: "12 * intensity", ry: "3.5 * intensity", fill: "rgba(255,255,255,0.5)" });

  // Laughing — open smile + tongue hint
  facePrim.push({ when: "mouth == laughing", kind: "ellipse", cx: 0, cy: -244, rx: 18, ry: 9, fill: "#2b1810" });
  facePrim.push({ when: "mouth == laughing", kind: "ellipse", cx: 0, cy: -242, rx: 9, ry: 4, fill: "#c14a3a" });
  facePrim.push({ when: "mouth == laughing", kind: "ellipse", cx: 0, cy: -244, rx: 18, ry: 9, stroke: OUTLINE, lineWidth: 1.5 });

  // Sad — frown (intensity-amplified)
  facePrim.push({ when: "mouth == sad", kind: "arc", cx: 0, cy: "-246 + 4 * intensity", r: 18, startAngle: Math.PI * 1.15, endAngle: Math.PI * 1.85, stroke: "#2b1810", lineWidth: 2.5 });

  // Crying — frown + tear streaks (overlayed lower)
  facePrim.push({ when: "mouth == crying", kind: "arc", cx: 0, cy: "-244 + 4 * intensity", r: 18, startAngle: Math.PI * 1.15, endAngle: Math.PI * 1.85, stroke: "#2b1810", lineWidth: 2.5 });
  facePrim.push({ when: "mouth == crying", kind: "polygon", points: [
    { x: -32, y: -286 }, { x: -30, y: -270 }, { x: -28, y: -286 },
  ], fill: "rgba(120,180,220,0.6)" });
  facePrim.push({ when: "mouth == crying", kind: "polygon", points: [
    { x: 28, y: -286 }, { x: 30, y: -270 }, { x: 32, y: -286 },
  ], fill: "rgba(120,180,220,0.6)" });

  // Angry — tight straight line + slight downward corners
  facePrim.push({ when: "mouth == angry", kind: "polygon", points: [
    { x: -16, y: -254 }, { x: 0, y: -252 }, { x: 16, y: -254 },
    { x: 16, y: -252 }, { x: 0, y: -250 }, { x: -16, y: -252 },
  ], fill: "#2b1810" });

  // Surprised — small O
  facePrim.push({ when: "mouth == surprised", kind: "ellipse", cx: 0, cy: -252, rx: 6, ry: 8, fill: "#2b1810" });
  facePrim.push({ when: "mouth == surprised", kind: "ellipse", cx: 0, cy: -252, rx: 6, ry: 8, stroke: OUTLINE, lineWidth: 1.3 });

  // Scared — wider stretched O
  facePrim.push({ when: "mouth == scared", kind: "ellipse", cx: 0, cy: -250, rx: 9, ry: 11, fill: "#2b1810" });
  facePrim.push({ when: "mouth == scared", kind: "ellipse", cx: 0, cy: -250, rx: 9, ry: 11, stroke: OUTLINE, lineWidth: 1.3 });

  // Embarrassed — small line + blush hint (blush already in cheek warmth)
  facePrim.push({ when: "mouth == embarrassed", kind: "line", x1: -8, y1: -252, x2: 8, y2: -252, stroke: "#2b1810", lineWidth: 2.2, lineCap: "round" });

  // Smug — half-smile, asymmetric
  facePrim.push({ when: "mouth == smug", kind: "polygon", points: [
    { x: -14, y: -255 }, { x: -4, y: -253 }, { x: 6, y: -250 },
    { x: 14, y: -244 }, { x: 14, y: -242 }, { x: 6, y: -248 },
    { x: -4, y: -251 }, { x: -14, y: -253 },
  ], fill: "#2b1810" });

  // Thinking — neutral closed mouth, slight pucker
  facePrim.push({ when: "mouth == thinking", kind: "ellipse", cx: 0, cy: -252, rx: 6, ry: 1.6, fill: "#2b1810" });

  // --- Viseme-driven mouth shapes (mouth == open|narrow|round|mid|wide|ee) ---
  // Open "a" — wide rectangle, lower lip drops
  facePrim.push({ when: "mouth == open", kind: "ellipse", cx: 0, cy: -246, rx: 14, ry: 10, fill: "#2b1810" });
  facePrim.push({ when: "mouth == open", kind: "ellipse", cx: 0, cy: -244, rx: 10, ry: 4, fill: "#7a2818" });
  facePrim.push({ when: "mouth == open", kind: "ellipse", cx: 0, cy: -246, rx: 14, ry: 10, stroke: OUTLINE, lineWidth: 1.4 });

  // Narrow "i" — tight horizontal line, slight smile
  facePrim.push({ when: "mouth == narrow", kind: "polygon", points: [
    { x: -14, y: -252 }, { x: 0, y: -250 }, { x: 14, y: -252 },
    { x: 14, y: -251 }, { x: 0, y: -249 }, { x: -14, y: -251 },
  ], fill: "#2b1810" });

  // Round "u/o" — small round O, pursed
  facePrim.push({ when: "mouth == round", kind: "circle", cx: 0, cy: -250, r: 7, fill: "#2b1810" });
  facePrim.push({ when: "mouth == round", kind: "circle", cx: 0, cy: -250, r: 7, stroke: OUTLINE, lineWidth: 1.4 });

  // Mid "e" — medium oval
  facePrim.push({ when: "mouth == mid", kind: "ellipse", cx: 0, cy: -250, rx: 10, ry: 6, fill: "#2b1810" });
  facePrim.push({ when: "mouth == mid", kind: "ellipse", cx: 0, cy: -250, rx: 10, ry: 6, stroke: OUTLINE, lineWidth: 1.3 });

  // Wide "ai/ei" — long horizontal open with low pull
  facePrim.push({ when: "mouth == wide", kind: "ellipse", cx: 0, cy: -248, rx: 18, ry: 8, fill: "#2b1810" });
  facePrim.push({ when: "mouth == wide", kind: "ellipse", cx: 0, cy: -248, rx: 18, ry: 8, stroke: OUTLINE, lineWidth: 1.4 });

  // Ee "ie/ye" — broad smile, teeth showing
  facePrim.push({ when: "mouth == ee", kind: "polygon", points: [
    { x: -16, y: -252 }, { x: -10, y: -248 }, { x: 0, y: -246 },
    { x: 10, y: -248 }, { x: 16, y: -252 },
    { x: 14, y: -250 }, { x: 0, y: -244 }, { x: -14, y: -250 },
  ], fill: "#2b1810" });
  facePrim.push({ when: "mouth == ee", kind: "rect", x: -10, y: -250, w: 20, h: 2.5, fill: "#fff" });

  // Corner shadows
  facePrim.push({ kind: "circle", cx: -14, cy: -256, r: 1.4, fill: "rgba(0,0,0,0.4)" });
  facePrim.push({ kind: "circle", cx: 14, cy: -256, r: 1.4, fill: "rgba(0,0,0,0.4)" });

  // Chin jawline arc (subtle)
  facePrim.push({ kind: "arc", cx: 0, cy: -288, r: 56, startAngle: 0.35, endAngle: Math.PI - 0.35,
    stroke: "rgba(0,0,0,0.32)", lineWidth: 1.3 });

  p.push({ kind: "transform",
    translate: { x: "headYaw * 14", y: "headPitch * 6" },
    rotate: "headYaw * 0.15",
    children: facePrim,
  });

  // ============================================================
  // FACIAL MARKS — scars / dots / moles
  // ============================================================
  for (const mark of marks) {
    const pos = markPosition(mark.at);
    const color = mark.color ?? "rgba(150,60,40,0.85)";
    if (mark.kind === "scar_diagonal") {
      p.push({ kind: "polygon", points: [
        { x: pos.x - 4, y: pos.y + 5 },
        { x: pos.x + 5, y: pos.y - 4 },
        { x: pos.x + 6, y: pos.y - 3 },
        { x: pos.x - 3, y: pos.y + 6 },
      ], fill: color });
    } else if (mark.kind === "scar_x") {
      p.push({ kind: "line", x1: pos.x - 5, y1: pos.y - 5, x2: pos.x + 5, y2: pos.y + 5, stroke: color, lineWidth: 2, lineCap: "round" });
      p.push({ kind: "line", x1: pos.x + 5, y1: pos.y - 5, x2: pos.x - 5, y2: pos.y + 5, stroke: color, lineWidth: 2, lineCap: "round" });
    } else if (mark.kind === "mark_dot") {
      p.push({ kind: "circle", cx: pos.x, cy: pos.y, r: 2.5, fill: color });
    } else if (mark.kind === "mole") {
      p.push({ kind: "circle", cx: pos.x, cy: pos.y, r: 1.8, fill: "rgba(40,20,10,0.8)" });
    }
  }

  // ============================================================
  // HAT (drawn LAST so it sits on top of the hair)
  // ============================================================
  if (hat === "straw") {
    const brimY = -350;
    const crownColor = opts.hatColor ?? "#e8c97a";
    const bandColor = opts.hatBandColor ?? "#c14a3a";
    // Brim — wide ellipse
    p.push({ kind: "ellipse", cx: 0, cy: brimY + 6, rx: 110, ry: 22, fill: crownColor,
      shadow: { blur: 14, offsetY: 8, color: "rgba(0,0,0,0.35)" } });
    p.push({ kind: "ellipse", cx: 0, cy: brimY + 6, rx: 110, ry: 22,
      fill: { gradient: "radial", x0: -20, y0: brimY, r0: 4, x1: 0, y1: brimY + 6, r1: 110,
        stops: [
          { at: 0, color: "rgba(255,255,255,0.3)" },
          { at: 0.6, color: "rgba(255,255,255,0)" },
          { at: 1, color: "rgba(0,0,0,0.3)" },
        ] } });
    // Brim outline + weave lines
    p.push({ kind: "ellipse", cx: 0, cy: brimY + 6, rx: 110, ry: 22, stroke: OUTLINE, lineWidth: 1.6 });
    for (let i = -3; i <= 3; i++) {
      p.push({ kind: "line", x1: i * 26, y1: brimY - 8, x2: i * 32, y2: brimY + 22, stroke: "rgba(120,80,30,0.32)", lineWidth: 1 });
    }
    // Brim shadow on forehead
    p.push({ kind: "clip",
      shape: { kind: "circle", cx: 0, cy: -310, r: 70 },
      children: [
        { kind: "rect", x: -70, y: -340, w: 140, h: 32, fill: "rgba(20,12,8,0.32)" },
      ],
    });
    // Crown — dome
    p.push({ kind: "ellipse", cx: 0, cy: brimY - 18, rx: 56, ry: 28, fill: crownColor, startAngle: Math.PI, endAngle: Math.PI * 2 });
    p.push({ kind: "ellipse", cx: 0, cy: brimY - 18, rx: 56, ry: 28, startAngle: Math.PI, endAngle: Math.PI * 2,
      fill: { gradient: "radial", x0: -16, y0: brimY - 26, r0: 4, x1: 0, y1: brimY - 18, r1: 56,
        stops: [{ at: 0, color: "rgba(255,255,255,0.4)" }, { at: 1, color: "rgba(0,0,0,0.3)" }] } });
    p.push({ kind: "ellipse", cx: 0, cy: brimY - 18, rx: 56, ry: 28, startAngle: Math.PI, endAngle: Math.PI * 2,
      stroke: OUTLINE, lineWidth: 1.6 });
    // Ribbon band
    p.push({ kind: "rect", x: -56, y: brimY - 4, w: 112, h: 8, fill: bandColor, stroke: OUTLINE, lineWidth: 1.2 });
    p.push({ kind: "rect", x: -56, y: brimY - 4, w: 112, h: 8,
      fill: { gradient: "linear", x0: 0, y0: brimY - 4, x1: 0, y1: brimY + 4,
        stops: [{ at: 0, color: "rgba(255,255,255,0.25)" }, { at: 1, color: "rgba(0,0,0,0.3)" }] } });
  } else if (hat === "cap") {
    const capColor = opts.hatColor ?? "#2c4d6a";
    p.push({ kind: "ellipse", cx: 0, cy: -354, rx: 64, ry: 30, fill: capColor, startAngle: Math.PI, endAngle: Math.PI * 2 });
    p.push({ kind: "ellipse", cx: 0, cy: -354, rx: 64, ry: 30, startAngle: Math.PI, endAngle: Math.PI * 2,
      fill: { gradient: "radial", x0: -16, y0: -370, r0: 4, x1: 0, y1: -354, r1: 64,
        stops: [{ at: 0, color: "rgba(255,255,255,0.32)" }, { at: 1, color: "rgba(0,0,0,0.32)" }] } });
    // Brim
    p.push({ kind: "polygon", points: [
      { x: -60, y: -332 }, { x: -20, y: -340 }, { x: 60, y: -340 },
      { x: 70, y: -322 }, { x: -10, y: -322 },
    ], fill: capColor, stroke: OUTLINE, lineWidth: 1.5 });
    p.push({ kind: "ellipse", cx: 0, cy: -354, rx: 64, ry: 30, startAngle: Math.PI, endAngle: Math.PI * 2, stroke: OUTLINE, lineWidth: 1.6 });
  } else if (hat === "beret") {
    const beretColor = opts.hatColor ?? "#2a2018";
    p.push({ kind: "ellipse", cx: 12, cy: -362, rx: 70, ry: 26, fill: beretColor });
    p.push({ kind: "ellipse", cx: 12, cy: -362, rx: 70, ry: 26,
      fill: { gradient: "linear", x0: -50, y0: -380, x1: 50, y1: -340,
        stops: [{ at: 0, color: "rgba(255,255,255,0.3)" }, { at: 1, color: "rgba(0,0,0,0.4)" }] } });
    p.push({ kind: "ellipse", cx: 12, cy: -362, rx: 70, ry: 26, stroke: OUTLINE, lineWidth: 1.5 });
    // Stem on top
    p.push({ kind: "circle", cx: 26, cy: -384, r: 4, fill: beretColor, stroke: OUTLINE, lineWidth: 1.2 });
  } else if (hat === "headband") {
    const hbColor = opts.hatColor ?? "#c14a3a";
    p.push({ kind: "rect", x: -72, y: -340, w: 144, h: 12, fill: hbColor, stroke: OUTLINE, lineWidth: 1.4 });
    p.push({ kind: "rect", x: -72, y: -340, w: 144, h: 12,
      fill: { gradient: "linear", x0: 0, y0: -340, x1: 0, y1: -328,
        stops: [{ at: 0, color: "rgba(255,255,255,0.32)" }, { at: 1, color: "rgba(0,0,0,0.35)" }] } });
  }

  // ============================================================
  // NAMEPLATE
  // ============================================================
  const nameplateY = hat !== "none" ? -430 : -405;
  p.push({ kind: "roundedRect", x: -72, y: nameplateY, w: 144, h: 30, r: 10,
    fill: "rgba(255,255,255,0.94)", stroke: "rgba(0,0,0,0.4)", lineWidth: 1 });
  p.push({ kind: "text", x: 0, y: nameplateY + 22, text: "${name}", fill: "#243033", size: 22, align: "center" });

  return {
    scale: opts.scale,
    primitives: p,
  };
}

/**
 * Build the shape for a specific view, delegating to the front/back/side
 * builders. The same `opts` (palette, hat, costume, marks, emblem) drive
 * every view, which is what keeps a character recognizable across angles.
 */
export function buildHumanCharacterShapeForView(
  opts: HumanCharacterOptions = {},
  view: HumanCharacterView = "front",
): ProceduralShape {
  // Lazy-required to keep the import graph minimal for callers that only
  // need the canonical front view.
  if (view === "front") return buildHumanCharacterShape(opts);
  switch (view) {
    case "back": return buildBackViewShape(opts);
    case "sideLeft": return buildSideViewShape(opts, -1);
    case "sideRight": return buildSideViewShape(opts, 1);
    case "threeQuarterLeft": return buildThreeQuarterShape(opts, -1);
    case "threeQuarterRight": return buildThreeQuarterShape(opts, 1);
  }
}

/**
 * Build the standard 4-view bundle (front + back + sideLeft + sideRight)
 * that the cucumber-asset-generator skill emits for any "important"
 * character. Caller may add threeQuarter views post-hoc.
 */
export function buildHumanCharacterShapesBundle(
  opts: HumanCharacterOptions = {},
): Partial<Record<HumanCharacterView, ProceduralShape>> {
  return {
    front: buildHumanCharacterShapeForView(opts, "front"),
    back: buildHumanCharacterShapeForView(opts, "back"),
    sideLeft: buildHumanCharacterShapeForView(opts, "sideLeft"),
    sideRight: buildHumanCharacterShapeForView(opts, "sideRight"),
  };
}

function markPosition(at: FacialMark["at"]): { x: number; y: number } {
  switch (at) {
    case "left_cheek": return { x: -36, y: -270 };
    case "right_cheek": return { x: 36, y: -270 };
    case "forehead": return { x: 0, y: -335 };
    case "under_left_eye": return { x: -26, y: -290 };
    case "under_right_eye": return { x: 26, y: -290 };
  }
}
