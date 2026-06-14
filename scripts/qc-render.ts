// QC render harness — the "detection loop" mechanism. Renders a procedural
// AssetManifest headlessly to a PNG contact sheet so the design can be eyeballed
// and iterated WITHOUT a browser. It only *calls* the engine's own draw
// functions (drawCharacter / drawShape / drawSceneLayer) — it does not modify
// the engine, and it is content-agnostic (works for any manifest, not just KOF).
//
// Usage:
//   npx tsx scripts/qc-render.ts --kind character --file a.json --out a.png
//   npx tsx scripts/qc-render.ts --kind scene     --file s.json --out s.png
//   npx tsx scripts/qc-render.ts --kind effect    --file e.json --out e.png
//   npx tsx scripts/qc-render.ts --kind filmstrip --project p.json --seg s1 --out f.png  (timeline frames)

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

// Polyfill the bits of `document` the noise primitive touches (it builds an
// offscreen canvas for its tiled pattern). Harness-side only.
(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return createCanvas(1, 1);
    throw new Error(`qc-render: unsupported document.createElement(${tag})`);
  },
};

import { drawCharacter } from "../src/engine/characterPainter.ts";
import { drawShape, drawSceneLayer, hasSceneLayers, type ProceduralShape } from "../src/engine/proceduralShape.ts";
import { evaluateTimeline } from "../src/engine/timeline.ts";
import type { AssetManifest } from "../src/types/schema.ts";

type Ctx = SKRSContext2D;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function load<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function save(canvas: ReturnType<typeof createCanvas>, out: string) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log("wrote", out);
}

function label(ctx: Ctx, text: string, x: number, y: number) {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(text, x + 6, y + 16);
}

function renderCharacter(asset: AssetManifest, out: string) {
  const actions = (asset.metadata.actions as string[] | undefined)?.filter(Boolean) ?? ["idle"];
  const times = [0, 0.35, 0.7, 1.05, 1.4]; // sample the motion cycle
  const views: Array<"front" | "sideRight" | "back" | "sideLeft"> = ["front", "sideRight", "back", "sideLeft"];
  const cw = 200, chH = 300;
  const cols = times.length;
  const rows = actions.length + 1; // + a views row
  const W = cw * cols, H = chH * rows;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  // checker bg so silhouettes read
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    ctx.fillStyle = (r + c) % 2 ? "#e8e8ec" : "#dcdce2";
    ctx.fillRect(c * cw, r * chH, cw, chH);
  }

  const baseY = chH - 30;
  const scale = (chH - 60) / ((asset.metadata.height as number | undefined) ?? 520);

  actions.forEach((action, r) => {
    times.forEach((t, c) => {
      ctx.save();
      drawCharacter(ctx as never, asset, {
        x: c * cw + cw / 2, y: r * chH + baseY, scale,
        expression: "neutral", action, time: t, angle: "front", viseme: "rest",
      });
      ctx.restore();
      label(ctx, `${action} t=${t}`, c * cw, r * chH);
    });
  });
  // views row
  const vr = actions.length;
  views.forEach((v, c) => {
    ctx.save();
    drawCharacter(ctx as never, asset, {
      x: c * cw + cw / 2, y: vr * chH + baseY, scale,
      expression: "neutral", action: "idle", time: 0.2, angle: v, viseme: "rest",
    });
    ctx.restore();
    label(ctx, v, c * cw, vr * chH);
  });

  save(canvas, out);
}

function renderScene(asset: AssetManifest, out: string) {
  const shape = (asset.metadata.shape as ProceduralShape) ?? { primitives: [] };
  const palette = (asset.metadata.palette ?? {}) as Record<string, string>;
  const W = 1280, H = 720;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  const state = { time: 0.5, progress: 0.5 };
  if (hasSceneLayers(shape)) {
    for (const layer of ["background", "midground", "foreground"] as const) {
      drawSceneLayer(ctx as never, shape, palette, state, layer);
    }
  } else {
    drawShape(ctx as never, shape, palette, state);
  }
  save(canvas, out);
}

function renderEffect(asset: AssetManifest, out: string) {
  const shape = (asset.metadata.shape as ProceduralShape) ?? { primitives: [] };
  const palette = (asset.metadata.palette ?? {}) as Record<string, string>;
  const samples = [0.0, 0.25, 0.5, 0.75, 1.0];
  const cell = 240;
  const canvas = createCanvas(cell * samples.length, cell);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  samples.forEach((p, i) => {
    ctx.save();
    ctx.fillStyle = "#1a1a22"; ctx.fillRect(i * cell, 0, cell, cell);
    ctx.translate(i * cell + cell / 2, cell / 2);
    drawShape(ctx as never, shape, palette, { progress: p, time: p * 2 });
    ctx.restore();
    label(ctx, `progress=${p}`, i * cell, 0);
  });
  save(canvas, out);
}

function renderFilmstrip(projectPath: string, out: string) {
  const project = load<Parameters<typeof evaluateTimeline>[0]>(projectPath);
  const libPath = arg("library");
  const library = libPath ? load<Parameters<typeof evaluateTimeline>[1]>(libPath) : ({ globalAssets: [], projectAssets: [], scenes: [] } as never);
  const assetsById = new Map<string, AssetManifest>();
  for (const a of [...(library as { globalAssets: AssetManifest[] }).globalAssets, ...(library as { projectAssets: AssetManifest[] }).projectAssets]) assetsById.set(a.assetId, a);
  const scenesById = new Map<string, AssetManifest>();
  for (const s of (library as { scenes?: AssetManifest[] }).scenes ?? []) scenesById.set((s as unknown as { sceneId: string }).sceneId, s);

  const dur = Number(arg("duration", "30"));
  const timesArg = arg("times");
  const explicitTimes = timesArg ? timesArg.split(",").map(Number).filter((x) => !Number.isNaN(x)) : null;
  const big = arg("big") === "1";
  const cols = explicitTimes ? Math.min(explicitTimes.length, Number(arg("cols", "3"))) : Number(arg("cols", "6"));
  const rows = explicitTimes ? Math.ceil(explicitTimes.length / cols) : Number(arg("rows", "5"));
  const n = explicitTimes ? explicitTimes.length : cols * rows;
  const fw = big ? 640 : 320, fh = big ? 360 : 180;
  const canvas = createCanvas(fw * cols, fh * rows);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  for (let i = 0; i < n; i++) {
    const t = explicitTimes ? explicitTimes[i] : (dur * i) / Math.max(n - 1, 1);
    const st = evaluateTimeline(project, library as never, t);
    const ox = (i % cols) * fw, oy = Math.floor(i / cols) * fh;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, fw, fh); ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(fw / 1280, fh / 720);
    // scene
    const sceneAsset = scenesById.get(st.sceneId);
    if (sceneAsset) {
      const shape = (sceneAsset.metadata.shape as ProceduralShape) ?? { primitives: [] };
      const pal = (sceneAsset.metadata.palette ?? {}) as Record<string, string>;
      if (hasSceneLayers(shape)) for (const l of ["background", "midground", "foreground"] as const) drawSceneLayer(ctx as never, shape, pal, { time: t }, l);
      else drawShape(ctx as never, shape, pal, { time: t });
    } else { ctx.fillStyle = "#20232c"; ctx.fillRect(0, 0, 1280, 720); }
    // characters
    for (const ch of st.characters) {
      const a = assetsById.get(ch.assetId);
      if (!a) continue;
      drawCharacter(ctx as never, a, {
        x: ch.x, y: ch.y, scale: ch.scale, expression: ch.expression, action: ch.action ?? "idle",
        time: t, angle: ch.angle, viseme: ch.viseme, z: ch.z, headYaw: ch.headYaw, headPitch: ch.headPitch,
      });
    }
    // effects (drawn over characters, at their world position)
    for (const fx of st.effects) {
      const a = assetsById.get(fx.effectId);
      if (!a) continue;
      const shape = (a.metadata.shape as ProceduralShape) ?? { primitives: [] };
      const pal = (a.metadata.palette ?? {}) as Record<string, string>;
      ctx.save();
      ctx.translate(fx.x, fx.y);
      drawShape(ctx as never, shape, pal, { progress: fx.progress, time: t });
      ctx.restore();
    }
    ctx.restore();
    label(ctx, `t=${t.toFixed(1)}s ${st.caption ? "· " + st.caption.slice(0, 18) : ""}`, ox, oy);
  }
  save(canvas, out);
}

function main() {
  const kind = arg("kind", "character");
  const out = arg("out", "/tmp/qc/out.png")!;
  if (kind === "filmstrip") { renderFilmstrip(arg("project")!, out); return; }
  const asset = load<AssetManifest>(arg("file")!);
  if (kind === "character") renderCharacter(asset, out);
  else if (kind === "scene") renderScene(asset, out);
  else if (kind === "effect") renderEffect(asset, out);
  else throw new Error(`unknown --kind ${kind}`);
}

main();
