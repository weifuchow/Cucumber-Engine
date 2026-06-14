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

import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

// Polyfill the bits of `document` the noise primitive touches (it builds an
// offscreen canvas for its tiled pattern). Harness-side only.
(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return createCanvas(1, 1);
    throw new Error(`qc-render: unsupported document.createElement(${tag})`);
  },
};

import { drawCharacter } from "../src/engine/characterPainter.ts";
import { drawShape, drawSceneLayer, hasSceneLayers, registerSpriteImage, type ProceduralShape } from "../src/engine/proceduralShape.ts";
import { evaluateTimeline } from "../src/engine/timeline.ts";
import type { AssetManifest } from "../src/types/schema.ts";

// Headless can't lazy-load images — pre-decode every imageSprite frame a
// manifest references and seed the engine's sprite cache.
async function preloadSprites(assets: AssetManifest[]) {
  for (const a of assets) {
    const shapesObj = (a.metadata.shapes as Record<string, ProceduralShape> | undefined) ?? {};
    const shapes = [
      ...Object.values(shapesObj),
      (a.metadata.shape as ProceduralShape | undefined),
    ].filter(Boolean) as ProceduralShape[];
    for (const sh of shapes) {
      for (const p of sh.primitives ?? []) {
        if ((p as { kind?: string }).kind !== "imageSprite") continue;
        const sp = p as { src: string; frames?: number };
        const frames = Math.max(1, sp.frames ?? 1);
        for (let f = 0; f < frames; f++) {
          const src = sp.src.replace("{frame}", String(f));
          if (!existsSync(src)) continue;
          try { registerSpriteImage(src, await loadImage(src) as never); } catch { /* skip */ }
        }
      }
    }
  }
}

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

const YAW: Record<string, number> = {
  front: 0, back: Math.PI,
  sideRight: 1.45, sideLeft: -1.45,
  threeQuarterRight: 0.7, threeQuarterLeft: -0.7,
};

type Render3D = (o: { spec: unknown; yaw: number; action: string; time: number; W: number; H: number; rim: string }) => CanvasImageSource;
type RenderGltf = (o: { path: string; yaw: number; time: number; W: number; H: number; rim: string; tint?: string; clip?: string; colorMul?: [number, number, number] }) => CanvasImageSource;
interface WorldMaps { assetsById: Map<string, AssetManifest>; scenesById: Map<string, AssetManifest>; render3D?: Render3D; renderGltf?: RenderGltf }

// Load whichever 3D backends the library needs: the procedural humanoid
// (model3d.spec) and/or the glTF loader (model3d.gltf, preloaded).
async function load3D(assetsById: Map<string, AssetManifest>): Promise<{ render3D?: Render3D; renderGltf?: RenderGltf }> {
  const specs = [...assetsById.values()].map((a) => (a.metadata as { model3d?: { spec?: unknown; gltf?: string } }).model3d).filter(Boolean) as Array<{ spec?: unknown; gltf?: string }>;
  let render3D: Render3D | undefined, renderGltf: RenderGltf | undefined;
  if (specs.some((m) => m.spec)) ({ renderCharacter3D: render3D } = (await import("./lib/character3d.mjs")) as never);
  if (specs.some((m) => m.gltf)) {
    const g = (await import("./lib/gltf3d.mjs")) as { renderGltf3D: RenderGltf; preloadGltf: (p: string) => Promise<unknown> };
    renderGltf = g.renderGltf3D;
    for (const m of specs) if (m.gltf) await g.preloadGltf(m.gltf);
  }
  return { render3D, renderGltf };
}

// Draw scene + characters + effects in WORLD coordinates (1280×720). Shared by
// the filmstrip (overview cells) and the video renderer (under a camera xform).
function composeWorld(ctx: Ctx, st: ReturnType<typeof evaluateTimeline>, t: number, m: WorldMaps) {
  const sceneAsset = m.scenesById.get(st.sceneId);
  if (sceneAsset) {
    const shape = (sceneAsset.metadata.shape as ProceduralShape) ?? { primitives: [] };
    const pal = (sceneAsset.metadata.palette ?? {}) as Record<string, string>;
    if (hasSceneLayers(shape)) for (const l of ["background", "midground", "foreground"] as const) drawSceneLayer(ctx as never, shape, pal, { time: t }, l);
    else drawShape(ctx as never, shape, pal, { time: t });
  } else { ctx.fillStyle = "#20232c"; ctx.fillRect(0, 0, 1280, 720); }
  for (const ch of st.characters) {
    const a = m.assetsById.get(ch.assetId);
    if (!a) continue;
    const m3d = (a.metadata as { model3d?: { spec?: unknown; gltf?: string; rim: string; tint?: string; colorMul?: [number, number, number]; clipMap?: Record<string, string> } }).model3d;
    let drew3D = false;
    if (m3d && (m.render3D || m.renderGltf)) {
      try {
        const RW = 360, RH = 620;
        const yaw = YAW[ch.angle] ?? 0;
        const action = ch.action ?? "idle";
        let im: CanvasImageSource | undefined;
        if (m3d.gltf && m.renderGltf) im = m.renderGltf({ path: m3d.gltf, yaw, time: t, W: RW, H: RH, rim: m3d.rim, tint: m3d.tint, colorMul: m3d.colorMul, clip: m3d.clipMap?.[action] ?? m3d.clipMap?.idle });
        else if (m3d.spec && m.render3D) im = m.render3D({ spec: m3d.spec, yaw, action, time: t, W: RW, H: RH, rim: m3d.rim });
        if (im) {
          const s = (610 * ch.scale) / RH;
          ctx.drawImage(im, ch.x - (RW * s) / 2, ch.y - RH * s + 14 * ch.scale, RW * s, RH * s);
          drew3D = true;
        }
      } catch { /* no GL → 2D fallback */ }
    }
    if (!drew3D) {
      drawCharacter(ctx as never, a, {
        x: ch.x, y: ch.y, scale: ch.scale, expression: ch.expression, action: ch.action ?? "idle",
        time: t, angle: ch.angle, viseme: ch.viseme, z: ch.z, headYaw: ch.headYaw, headPitch: ch.headPitch,
      });
    }
  }
  for (const fx of st.effects) {
    const a = m.assetsById.get(fx.effectId);
    if (!a) continue;
    const shape = (a.metadata.shape as ProceduralShape) ?? { primitives: [] };
    const pal = (a.metadata.palette ?? {}) as Record<string, string>;
    ctx.save();
    ctx.translate(fx.x, fx.y);
    drawShape(ctx as never, shape, pal, { progress: fx.progress, time: t });
    ctx.restore();
  }
}

async function renderFilmstrip(projectPath: string, out: string) {
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

  const { render3D, renderGltf } = await load3D(assetsById);

  for (let i = 0; i < n; i++) {
    const t = explicitTimes ? explicitTimes[i] : (dur * i) / Math.max(n - 1, 1);
    const st = evaluateTimeline(project, library as never, t);
    const ox = (i % cols) * fw, oy = Math.floor(i / cols) * fh;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, fw, fh); ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(fw / 1280, fh / 720);
    composeWorld(ctx, st, t, { assetsById, scenesById, render3D, renderGltf });
    ctx.restore();
    label(ctx, `t=${t.toFixed(1)}s ${st.caption ? "· " + st.caption.slice(0, 18) : ""}`, ox, oy);
  }
  save(canvas, out);
}

function drawSubtitle(ctx: Ctx, st: ReturnType<typeof evaluateTimeline>, W: number, H: number) {
  const text = st.caption;
  if (!text) return;
  const style = (st.captionStyle ?? {}) as { position?: string; color?: string; bgColor?: string; fontSize?: number; weight?: string | number };
  const fontSize = style.fontSize ?? 30;
  const weight = style.weight ?? "bold";
  ctx.save();
  ctx.font = `${weight} ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  const y = style.position === "top" ? 72 : style.position === "center" ? H / 2 : H - 52;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = style.bgColor ?? "rgba(8,6,12,0.6)";
  ctx.fillRect(W / 2 - tw / 2 - 20, y - fontSize, tw + 40, fontSize + 20);
  ctx.fillStyle = style.color ?? "#ffffff";
  ctx.fillText(text, W / 2, y + 4);
  ctx.restore();
}

function applyPostFX(ctx: Ctx, W: number, H: number, cfg: { enabled?: boolean; vignette?: number; noiseAlpha?: number }) {
  if (cfg.enabled === false) return;
  const vig = cfg.vignette ?? 0.34;
  if (vig > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${vig})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const na = cfg.noiseAlpha ?? 0.07;
  if (na > 0) {
    ctx.save();
    ctx.globalAlpha = na;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 2600; i++) ctx.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
    ctx.restore();
  }
}

async function renderVideo(projectPath: string, out: string) {
  const project = load<Parameters<typeof evaluateTimeline>[0]>(projectPath);
  const library = load<Parameters<typeof evaluateTimeline>[1]>(arg("library")!);
  const assetsById = new Map<string, AssetManifest>();
  for (const a of [...(library as { globalAssets: AssetManifest[] }).globalAssets, ...(library as { projectAssets: AssetManifest[] }).projectAssets]) assetsById.set(a.assetId, a);
  const scenesById = new Map<string, AssetManifest>();
  for (const s of (library as { scenes?: AssetManifest[] }).scenes ?? []) scenesById.set((s as unknown as { sceneId: string }).sceneId, s);
  await preloadSprites([...assetsById.values()]);
  const { render3D, renderGltf } = await load3D(assetsById);

  const W = 1280, H = 720;
  const fps = Number(arg("fps", "24"));
  const dur = Number(arg("duration", "30"));
  const N = Math.round(dur * fps);
  const postFX = ((project as { config?: { postFX?: Record<string, number> } }).config?.postFX) ?? {};
  const frameDir = "/tmp/qc/frames";
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  for (let f = 0; f < N; f++) {
    const t = f / fps;
    const st = evaluateTimeline(project, library, t);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d") as unknown as Ctx;
    ctx.fillStyle = "#08080c"; ctx.fillRect(0, 0, W, H);
    const cam = st.camera as { x: number; y: number; zoom: number };
    const zoom = cam.zoom || 1;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-(cam.x ?? 640), -(cam.y ?? 360));
    composeWorld(ctx, st, t, { assetsById, scenesById, render3D, renderGltf });
    ctx.restore();
    drawSubtitle(ctx, st, W, H);
    applyPostFX(ctx, W, H, postFX);
    writeFileSync(`${frameDir}/${String(f).padStart(5, "0")}.png`, canvas.toBuffer("image/png"));
    if (f % 60 === 0) console.log(`  frame ${f}/${N}`);
  }

  const ff = ((await import("@ffmpeg-installer/ffmpeg")) as { default: { path: string } }).default.path;
  mkdirSync(dirname(out), { recursive: true });
  spawnSync(ff, ["-y", "-framerate", String(fps), "-i", `${frameDir}/%05d.png`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "ignore" });
  const gif = out.replace(/\.mp4$/, ".gif");
  spawnSync(ff, ["-y", "-framerate", String(fps), "-i", `${frameDir}/%05d.png`, "-vf", "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", "-loop", "0", gif], { stdio: "ignore" });
  console.log(`wrote ${out} (${N} frames @ ${fps}fps) + ${gif}`);
}

async function main() {
  const kind = arg("kind", "character");
  const out = arg("out", "/tmp/qc/out.png")!;
  if (kind === "filmstrip") {
    const libPath = arg("library");
    if (libPath) {
      const lib = load<{ globalAssets?: AssetManifest[]; projectAssets?: AssetManifest[] }>(libPath);
      await preloadSprites([...(lib.globalAssets ?? []), ...(lib.projectAssets ?? [])]);
    }
    await renderFilmstrip(arg("project")!, out);
    return;
  }
  if (kind === "video") {
    await renderVideo(arg("project")!, out);
    return;
  }
  const asset = load<AssetManifest>(arg("file")!);
  await preloadSprites([asset]);
  if (kind === "character") renderCharacter(asset, out);
  else if (kind === "scene") renderScene(asset, out);
  else if (kind === "effect") renderEffect(asset, out);
  else throw new Error(`unknown --kind ${kind}`);
}

main();
