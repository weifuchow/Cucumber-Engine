// Bake a procedural character manifest into raster sprite frames + an
// imageSprite manifest — the engine's path OFF the vector/Flash plane.
//
// For each view × action × frame it renders the procedural character at 3×
// supersample, applies a raster paint pass (paper-grain multiply confined to
// the silhouette + a soft diffusion), then downsamples — the supersample
// downscale alone replaces hard vector edges with soft anti-aliased ones, and
// the pixel-level paper texture breaks the flat fill. These are operations the
// vector primitives cannot do. Content-agnostic: works on any character built
// by build-character-shape.
//
//   npx tsx scripts/bake-character-sprites.ts --file char.json \
//       --outDir deliverables/kof-orochi/sprites --srcBase deliverables/kof-orochi/sprites \
//       --out deliverables/kof-orochi/assets/char_raster.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return createCanvas(1, 1);
    throw new Error(`bake: unsupported document.createElement(${tag})`);
  },
};

import { drawCharacter } from "../src/engine/characterPainter.ts";
import type { AssetManifest } from "../src/types/schema.ts";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const file = arg("file")!;
const outDir = arg("outDir", "sprites")!;
const srcBase = arg("srcBase", outDir)!;
const outManifest = arg("out")!;

const manifest = JSON.parse(readFileSync(file, "utf8")) as AssetManifest;
const id = manifest.assetId;

const SS = 3;                 // supersample factor
const TW = 320, TH = 560;     // target sprite px
const FEET_X = TW / 2, FEET_Y = TH * 0.95;
const CHAR_SCALE = (TH * 0.9) / ((manifest.metadata.height as number | undefined ?? 520));
const FRAMES = 5, FPS = 12;

const views = ((manifest.metadata.views as string[] | undefined) ??
  Object.keys((manifest.metadata.shapes as Record<string, unknown> | undefined) ?? { front: 1 })) as Array<
  "front" | "back" | "sideLeft" | "sideRight"
>;
const actions = ((manifest.metadata.actions as string[] | undefined) ?? ["idle"]).filter(Boolean);

// Pixel-space paint pass: paper-grain multiply + inked silhouette edge. Runs on
// the downscaled target so it's cheap. These are raster-only operations — the
// vector primitives can't darken an anti-aliased contour or texture per pixel.
function paintPass(
  octx: import("@napi-rs/canvas").SKRSContext2D,
  w: number,
  h: number,
  seed: number,
) {
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const alpha = d[i + 3];
      if (alpha === 0) continue;
      // paper grain (deterministic per pixel)
      const n = Math.abs((Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233 + seed) * 43758.5453) % 1);
      const paper = 0.84 + n * 0.16; // 0.84..1.0 multiply
      // ink edge: how much background sits in the neighbourhood
      const open = (255 - a(x - 1, y)) + (255 - a(x + 1, y)) + (255 - a(x, y - 1)) + (255 - a(x, y + 1));
      const edge = Math.min(1, open / (255 * 2.2)); // 0 interior .. 1 strong edge
      const ink = 1 - edge * 0.55; // darken contour up to 55%
      const m = paper * ink;
      d[i] = d[i] * m;
      d[i + 1] = d[i + 1] * m;
      d[i + 2] = d[i + 2] * m;
    }
  }
  octx.putImageData(img, 0, 0);
}

let baked = 0;
const shapes: Record<string, { primitives: unknown[] }> = {};

for (const view of views) {
  for (const action of actions) {
    const dir = join(outDir, id, view, action);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < FRAMES; f++) {
      const time = f / FPS;
      // 1. supersample render of the procedural figure on transparent bg
      const ss = createCanvas(TW * SS, TH * SS);
      const sctx = ss.getContext("2d");
      drawCharacter(sctx as never, manifest, {
        x: FEET_X * SS, y: FEET_Y * SS, scale: SS * CHAR_SCALE,
        expression: "neutral", action, time, angle: view, viseme: "rest",
      });

      // 2. downscale to target — the supersample average replaces hard vector
      //    edges with soft anti-aliased ones (the core de-vector step).
      const out = createCanvas(TW, TH);
      const octx = out.getContext("2d");
      octx.imageSmoothingEnabled = true;
      octx.drawImage(ss, 0, 0, TW, TH);

      // 3. pixel-space paint pass (impossible in vector): per-pixel paper
      //    grain multiply + a silhouette ink-edge darken. Cheap at target res.
      paintPass(octx, TW, TH, f);

      writeFileSync(join(dir, `${f}.png`), out.toBuffer("image/png"));
      baked++;
    }
  }

  // imageSprite primitives per action, gated by `when`, + a z-aware contact shadow.
  const prims: unknown[] = [
    { kind: "ellipse", cx: 0, cy: 6,
      rx: "92 * (1 - clamp(z * 0.0008, 0, 0.35))", ry: "24 * (1 - clamp(z * 0.0008, 0, 0.35))",
      fill: { gradient: "radial", x0: 0, y0: 6, r0: 0, x1: 0, y1: 6, r1: 92,
        stops: [ { at: 0, color: "rgba(12,10,14,${0.34 * (1 - clamp(z * 0.0008, 0, 0.6))})" }, { at: 1, color: "rgba(12,10,14,0)" } ] } },
  ];
  for (const action of actions) {
    const when = action === "idle" ? `action not in [walking, attack, defend, victory]` : `action == ${action}`;
    prims.push({
      kind: "imageSprite", when,
      src: `${srcBase}/${id}/${view}/${action}/{frame}.png`,
      frames: FRAMES, fps: FPS,
      w: TW, h: TH, anchorX: 0.5, anchorY: FEET_Y / TH,
    });
  }
  shapes[view] = { primitives: prims };
}

const rasterManifest = {
  ...manifest,
  source: { ...(manifest.source ?? {}), kind: "generated", format: "raster-bake" },
  tags: [...new Set([...(manifest.tags ?? []), "raster", "baked"])],
  metadata: {
    ...manifest.metadata,
    views,
    shape: shapes[views[0]],
    shapes,
  },
};

mkdirSync(dirname(outManifest), { recursive: true });
writeFileSync(outManifest, JSON.stringify(rasterManifest, null, 2));
console.log(`baked ${baked} frames · ${views.length} views × ${actions.length} actions × ${FRAMES} → ${outManifest}`);
