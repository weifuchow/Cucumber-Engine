// Cut every needed pose (both facings) out of the two reference sheets, then
// emit raster imageSprite manifests for Iori + Orochi. The art sheets share a
// layout (5-view top band). Native art faces RIGHT; _L files are mirrored.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { loadImage } from "@napi-rs/canvas";

const R = "deliverables/kof-orochi/references";
const A = "deliverables/kof-orochi/art";
const cut = "deliverables/kof-orochi/build/cutout.mjs";

// rect per view in sheet px (shared layout), + per-character bg threshold.
const RECTS = {
  front:  "158,138,180,516",
  threeq: "332,138,172,516",
  side:   "502,138,160,516",
  back:   "655,138,190,516",
  action: "835,128,255,540",
};
const CHARS = {
  iori:   { sheet: `${R}/iori_sheet_ref.png`,   bg: 228 },
  orochi: { sheet: `${R}/orochi_sheet_ref.png`, bg: 216 },
};

function run(args) { execFileSync("npx", ["tsx", cut, ...args], { stdio: "ignore" }); }

for (const [char, cfg] of Object.entries(CHARS)) {
  for (const [view, rect] of Object.entries(RECTS)) {
    // right-facing (native) + left-facing (mirror)
    run(["--in", cfg.sheet, "--rect", rect, "--out", `${A}/${char}/${view}_R.png`, "--bg", String(cfg.bg)]);
    run(["--in", cfg.sheet, "--rect", rect, "--out", `${A}/${char}/${view}_L.png`, "--bg", String(cfg.bg), "--flip", "1"]);
  }
}

// ---- build imageSprite manifests -------------------------------------------
const H = 520; // character local height units (matches the procedural baseline)

async function dims(p) { const im = await loadImage(p); return { w: im.width, h: im.height }; }

// One imageSprite primitive (single static frame) for a given art file.
async function sprite(char, file, when) {
  const d = await dims(`${A}/${char}/${file}.png`);
  const h = H;
  const w = Math.round((d.w / d.h) * h);
  return {
    kind: "imageSprite", when,
    src: `deliverables/kof-orochi/art/${char}/${file}.png`,
    w, h, anchorX: 0.5, anchorY: 1,
  };
}

const contactShadow = {
  kind: "ellipse", cx: 0, cy: 4,
  rx: "120 * (1 - clamp(z * 0.0008, 0, 0.35))", ry: "26 * (1 - clamp(z * 0.0008, 0, 0.35))",
  fill: { gradient: "radial", x0: 0, y0: 4, r0: 0, x1: 0, y1: 4, r1: 120,
    stops: [{ at: 0, color: "rgba(10,8,12,${0.4 * (1 - clamp(z * 0.0008, 0, 0.6))})" }, { at: 1, color: "rgba(10,8,12,0)" }] },
};

// Map an AngleKey to its standing art (facing) + the matching attack pose.
async function viewShape(char, stand, actionFile) {
  return { primitives: [
    contactShadow,
    await sprite(char, actionFile, "action == attack"),
    await sprite(char, stand, "action != attack"),
  ] };
}

// High-poly rigged glTF (three.js RobotExpressive — vertex-coloured, with
// Idle/Walking/Punch/… clips). One model fields both fighters via colorMul.
const ROBOT = "deliverables/kof-orochi/models/RobotExpressive.glb";
const CLIPMAP = { idle: "Idle", walking: "Walking", attack: "Punch", defend: "Idle", victory: "ThumbsUp" };
const MODEL3D = {
  iori:   { gltf: ROBOT, colorMul: [1.15, 0.42, 0.4], clipMap: CLIPMAP, rim: "#b076ff",
            spec: { coat: "#7a1622", skin: "#e7b892", hair: "#c8202a", pants: "#1a1620", shoe: "#0e0c12", spikes: 9 } },
  orochi: { gltf: ROBOT, colorMul: [0.42, 0.95, 0.92], clipMap: CLIPMAP, rim: "#7cf2c0",
            spec: { coat: "#b0855f", skin: "#e6cdb8", hair: "#e2e6f0", pants: "#c6c7d2", shoe: "#574636", spikes: 0, harness: true, band: "#1c2742" } },
};

async function buildManifest(char, baseId, name, display, faces /* 'R' | 'L' */) {
  const f = faces;
  const shapes = {
    front:              await viewShape(char, `front_${f}`,   `action_${f}`),
    back:               await viewShape(char, `back_${f}`,    `action_${f}`),
    threeQuarterRight:  await viewShape(char, "threeq_R",     "action_R"),
    threeQuarterLeft:   await viewShape(char, "threeq_L",     "action_L"),
    sideRight:          await viewShape(char, "side_R",       "action_R"),
    sideLeft:           await viewShape(char, "side_L",       "action_L"),
  };
  return {
    assetId: baseId, name, category: "visual", type: "character", scope: "project",
    source: { kind: "imported", format: "raster-art", originalFile: `${char}_sheet_ref.png` },
    files: { preview: `procedural://${baseId}` },
    tags: ["kof", char, "character", "raster", "real-art"],
    metadata: {
      width: 360, height: H, anchor: { x: 180, y: H }, displayName: display,
      views: ["front", "back", "sideLeft", "sideRight", "threeQuarterLeft", "threeQuarterRight"],
      actions: ["idle", "walking", "attack", "defend", "victory"],
      expressions: ["neutral", "angry", "smug", "surprised", "scared", "crying"],
      palette: {},
      references: [{ sourceType: "user-upload", source: `${char}_sheet_ref.png`, note: "official-style KOF turnaround art provided by user; cut + keyed into imageSprite frames" }],
      shape: shapes.front,
      shapes,
      // 3D asset spec — a posable cel-shaded humanoid (real depth/rotation).
      // The renderer prefers this over the 2D imageSprite shapes when present.
      model3d: MODEL3D[char],
    },
    license: { type: "user-provided", author: "user upload", sourceUrl: "", commercialUse: false, needAttribution: true },
  };
}

const iori = await buildManifest("iori", "character_iori_001", "八神庵", "庵", "R");      // on the left, faces right
const orochi = await buildManifest("orochi", "character_orochi_001", "大蛇", "大蛇", "L"); // on the right, faces left
writeFileSync(`${A}/../assets/character_iori_001.json`, JSON.stringify(iori, null, 2));
writeFileSync(`${A}/../assets/character_orochi_001.json`, JSON.stringify(orochi, null, 2));
console.log("built real-art manifests for Iori + Orochi");
