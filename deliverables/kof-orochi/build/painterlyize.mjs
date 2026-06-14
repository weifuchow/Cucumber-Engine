// painterlyize v2 — aggressive de-Flash. The subtle v1 overlays didn't beat the
// clean-vector base read, so this hits harder: visible paper grain, flat cel
// shadow planes (real anime shading, not a gradient), a wild brush hair mass
// that takes over the silhouette, inked brush contour accents, and a form rim.
// Pure JSON in/out, reusable per fighter via CLI flags.
//
// node painterlyize.mjs --in base.json --out final.json \
//   --rim "rgba(176,118,255,0.72)" --hair "#d8242f" --hairDark "#7d1320" \
//   --shadow "rgba(26,14,22,0.34)" --wild 1

import { readFileSync, writeFileSync } from "node:fs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const raw = JSON.parse(readFileSync(arg("in"), "utf8"));
const manifest = raw.manifest ?? raw;
const shapes = manifest.metadata.shapes ?? { front: manifest.metadata.shape };

const rim = arg("rim", "rgba(176,118,255,0.72)");
const hair = arg("hair", "#d8242f");
const hairDark = arg("hairDark", "#7d1320");
const shadow = arg("shadow", "rgba(22,14,20,0.34)");
const wild = arg("wild", "1") !== "0";
const hairMode = arg("hairMode", "wild"); // wild (spiky up) | flow (sweep down)

// Soften the base's bold uniform vector outlines — the single loudest Flash
// tell. Large silhouette shapes lose their crisp dark stroke for a faint thin
// contour; the brush ink + cel shadows carry the edge read instead. Small
// detail strokes (eyes, marks) are left intact so the face stays crisp.
function softenOutlines(prims) {
  for (const p of prims) {
    if (Array.isArray(p.children)) softenOutlines(p.children);
    if (!p.stroke || typeof p.stroke !== "string") continue;
    const big =
      (p.kind === "roundedRect" && (p.w >= 40 || p.h >= 40)) ||
      (p.kind === "rect" && (p.w >= 40 || p.h >= 40)) ||
      (p.kind === "circle" && p.r >= 40) ||
      (p.kind === "ellipse" && (p.rx >= 30 || p.ry >= 30)) ||
      (p.kind === "polygon" && Array.isArray(p.points) && p.points.length >= 4);
    if (big) { p.stroke = "rgba(28,18,24,0.32)"; p.lineWidth = 0.8; }
  }
}

function find(prims, pred) { return prims.find(pred); }

function torsoOf(prims) {
  return find(prims, (p) => p.kind === "roundedRect" && typeof p.y === "number" && p.y <= -195 && typeof p.h === "number" && p.h >= 150);
}
function headOf(prims) {
  return find(prims, (p) => p.kind === "circle" && typeof p.cy === "number" && p.cy <= -280 && typeof p.r === "number" && p.r >= 50);
}

// Flat cel shadow planes derived from the torso + head boxes — the shaded side
// of a form, in one flat dark-alpha tone (anime cel, not a soft gradient).
function celShadows(prims) {
  const out = [];
  const t = torsoOf(prims);
  if (t) {
    const x0 = t.x, x1 = t.x + t.w, y0 = t.y, y1 = t.y + t.h;
    const midx = x0 + t.w * 0.46;
    out.push({ kind: "polygon", points: [
      { x: midx, y: y0 + 6 }, { x: x1 - 4, y: y0 + 10 }, { x: x1 - 6, y: y1 - 8 },
      { x: midx + 8, y: y1 - 6 }, { x: midx + 14, y: y0 + t.h * 0.5 },
    ], fill: shadow, closed: true });
    // chest core-shadow under the collar
    out.push({ kind: "polygon", points: [
      { x: x0 + 10, y: y0 + 8 }, { x: x1 - 10, y: y0 + 8 }, { x: x1 - 22, y: y0 + 34 }, { x: x0 + 22, y: y0 + 34 },
    ], fill: shadow, closed: true });
  }
  const h = headOf(prims);
  if (h) {
    // jaw/right-face shadow crescent
    out.push({ kind: "ellipse", cx: h.cx + h.r * 0.34, cy: h.cy + h.r * 0.22, rx: h.r * 0.6, ry: h.r * 0.82,
      rotation: 0.25, fill: shadow });
    // under-jaw neck shadow
    out.push({ kind: "ellipse", cx: h.cx, cy: h.cy + h.r * 0.86, rx: h.r * 0.5, ry: h.r * 0.22, fill: shadow });
  }
  return out;
}

function addRim(prims) {
  const t = torsoOf(prims);
  if (t && !t.rimLight) t.rimLight = { color: rim, fromAngle: -2.1, width: 3.2, falloff: 0.42 };
  const h = headOf(prims);
  if (h && !h.rimLight) h.rimLight = { color: rim, fromAngle: -2.1, width: 2.4, falloff: 0.5 };
}

// Wild brush hair mass — long jagged strokes radiating from the crown, taking
// over the silhouette the way KOF hair does, instead of a neat cap.
function flowHair(view) {
  // Long strokes sweeping down/out from the crown — Orochi's smooth mane,
  // not Iori's spikes.
  const strokes = [];
  const dirs = [
    [-78, -250, -52, -340], [-86, -190, -58, -330], [-80, -120, -54, -320],
    [78, -250, 52, -340], [86, -190, 58, -330], [80, -120, 54, -320],
    [-30, -402, -18, -350], [30, -402, 18, -350], [0, -410, 0, -352],
    [-58, -300, -40, -344], [58, -300, 40, -344],
  ];
  dirs.forEach((d, i) => {
    strokes.push({ kind: "brush",
      points: [{ x: d[2], y: d[3] }, { x: (d[0] + d[2]) / 2 + 4, y: (d[1] + d[3]) / 2 }, { x: d[0], y: d[1] }],
      stroke: i % 3 === 0 ? hairDark : hair, closed: false,
      passes: 4, jitter: 1.4, widthRange: [1.4, 3.6], alphaRange: [0.55, 0.92], seed: 1500 + i * 19 + view.length });
  });
  return strokes;
}

function wildHair(view) {
  if (!wild) return [];
  if (hairMode === "flow") return flowHair(view);
  const crownY = -348;
  const strokes = [];
  const dirs = [
    [-58, -432, -40, -360], [-40, -452, -22, -356], [-20, -460, -8, -360],
    [4, -462, 0, -358], [24, -456, 12, -358], [44, -440, 28, -358],
    [60, -416, 40, -356], [-70, -404, -48, -360], [70, -398, 50, -358],
    [-10, -470, -4, -360], [14, -468, 6, -360],
  ];
  dirs.forEach((d, i) => {
    strokes.push({ kind: "brush",
      points: [{ x: d[2], y: crownY }, { x: (d[0] + d[2]) / 2, y: (d[1] + crownY) / 2 - 6 }, { x: d[0], y: d[1] }],
      stroke: i % 3 === 0 ? hairDark : hair, closed: false,
      passes: 5, jitter: 2.0, widthRange: [1.6, 4.2], alphaRange: [0.65, 0.98], seed: 900 + i * 17 + view.length });
  });
  // a couple of dark inner-hair strokes for depth
  strokes.push({ kind: "brush", points: [{ x: -30, y: -360 }, { x: 0, y: -388 }, { x: 30, y: -360 }],
    stroke: hairDark, closed: false, passes: 4, jitter: 1.6, widthRange: [2, 5], alphaRange: [0.5, 0.85], seed: 1313 });
  return strokes;
}

// Inked silhouette accents — short brush strokes along torso sides + arm edges
// so the contour reads hand-drawn rather than clean-vector.
function inkAccents(prims) {
  const out = [];
  const t = torsoOf(prims);
  if (t) {
    out.push({ kind: "brush", points: [{ x: t.x + 2, y: t.y + 16 }, { x: t.x - 2, y: t.y + t.h * 0.5 }, { x: t.x + 4, y: t.y + t.h - 10 }],
      stroke: "rgba(20,14,18,0.8)", closed: false, passes: 4, jitter: 1.4, widthRange: [1.2, 3.2], alphaRange: [0.5, 0.9], seed: 411 });
    out.push({ kind: "brush", points: [{ x: t.x + t.w - 2, y: t.y + 16 }, { x: t.x + t.w + 2, y: t.y + t.h * 0.5 }, { x: t.x + t.w - 4, y: t.y + t.h - 10 }],
      stroke: "rgba(20,14,18,0.8)", closed: false, passes: 4, jitter: 1.4, widthRange: [1.2, 3.2], alphaRange: [0.5, 0.9], seed: 412 });
  }
  return out;
}

function grain(view) {
  return { kind: "noise", x: -130, y: -470, w: 260, h: 500, scale: 0.7, alpha: 0.16, blendMode: "multiply", seed: 4200 + view.length };
}

for (const [view, shape] of Object.entries(shapes)) {
  if (!shape || !Array.isArray(shape.primitives)) continue;
  const p = shape.primitives;
  softenOutlines(p);
  addRim(p);
  // cel shadows go ON TOP of the base fills (after them) but UNDER hair/ink/grain.
  p.push(...celShadows(p));
  p.push(...inkAccents(p));
  p.push(...wildHair(view));
  p.push(grain(view));
}
if (manifest.metadata.shapes?.front) manifest.metadata.shape = manifest.metadata.shapes.front;

writeFileSync(arg("out"), JSON.stringify(manifest, null, 2));
console.log(`painterlyized(v2) ${Object.keys(shapes).length} views → ${arg("out")}`);
