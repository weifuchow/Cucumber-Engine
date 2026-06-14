// Post-process a build-character-shape manifest: layer painterly accents
// (rimLight on the silhouette, brush hair tufts, a soft grain overlay) onto
// every view. Pure JSON in/out — no engine import. Reusable across characters
// via CLI flags so each fighter gets its own rim/hair tone.
//
// node painterlyize.mjs --in base.json --out final.json \
//   --rim "rgba(173,120,255,0.7)" --hair "#c8202a" --hairDark "#7d1320" --tufts 1

import { readFileSync, writeFileSync } from "node:fs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const inPath = arg("in");
const outPath = arg("out");
const rim = arg("rim", "rgba(173,120,255,0.7)");
const hair = arg("hair", "#c8202a");
const hairDark = arg("hairDark", "#7d1320");
const wantTufts = arg("tufts", "1") !== "0";

const raw = JSON.parse(readFileSync(inPath, "utf8"));
const manifest = raw.manifest ?? raw;
const shapes = manifest.metadata.shapes ?? { front: manifest.metadata.shape };

// Crown tuft geometry per view — a few jagged upward brush strokes that sell
// the unkempt fighter hair the chibi base only hints at.
function hairTufts(view) {
  if (!wantTufts) return [];
  // x mirroring: side views sit the head near center too (builder keeps anchor).
  const tufts = [
    [[-34, -352], [-46, -388], [-30, -360]],
    [[-12, -360], [-16, -402], [-2, -366]],
    [[10, -360], [18, -400], [6, -362]],
    [[30, -354], [44, -386], [26, -360]],
    [[0, -358], [2, -396], [-6, -362]],
  ];
  const strokes = [];
  for (let i = 0; i < tufts.length; i++) {
    const pts = tufts[i].map(([x, y]) => ({ x, y }));
    strokes.push({
      kind: "brush",
      points: pts,
      stroke: i % 2 ? hairDark : hair,
      closed: false,
      passes: 4,
      jitter: 1.3,
      widthRange: [1.2, 3.2],
      alphaRange: [0.6, 0.95],
      seed: 700 + i * 13 + view.length,
    });
  }
  return strokes;
}

function addRimToSilhouette(prims) {
  // Torso roundedRect (body silhouette) + head circle get a cool rim from the
  // upper-left, reading as the character's own flame backlight.
  for (const p of prims) {
    if (p.kind === "roundedRect" && typeof p.y === "number" && p.y <= -195 && typeof p.h === "number" && p.h >= 150 && !p.rimLight) {
      p.rimLight = { color: rim, fromAngle: -2.1, width: 2.4, falloff: 0.5 };
      break;
    }
  }
  for (const p of prims) {
    if (p.kind === "circle" && typeof p.cy === "number" && p.cy <= -280 && typeof p.r === "number" && p.r >= 50 && !p.rimLight) {
      p.rimLight = { color: rim, fromAngle: -2.1, width: 1.8, falloff: 0.55 };
      break;
    }
  }
}

function grainOverlay(view) {
  // Sits last so it grains the whole figure. soft-light keeps it gentle.
  return {
    kind: "noise",
    x: -120, y: -410, w: 240, h: 440,
    scale: 0.85, alpha: 0.09, blendMode: "soft-light",
    seed: 4200 + view.length,
  };
}

for (const [view, shape] of Object.entries(shapes)) {
  if (!shape || !Array.isArray(shape.primitives)) continue;
  addRimToSilhouette(shape.primitives);
  // Insert hair tufts just before the grain so the grain covers them too.
  shape.primitives.push(...hairTufts(view));
  shape.primitives.push(grainOverlay(view));
}
// Keep the legacy flat `shape` (front) in sync for back-compat renderers.
if (manifest.metadata.shapes?.front) manifest.metadata.shape = manifest.metadata.shapes.front;

writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`painterlyized ${Object.keys(shapes).length} views → ${outPath}`);
