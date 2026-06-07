import { useEffect, useRef } from "react";
import { evaluateTimeline, getAssetName } from "../engine/timeline";
import { drawCharacter } from "../engine/characterPainter";
import {
  drawSceneLayer,
  drawShape,
  getParallaxFactor,
  hasSceneLayers,
  isProceduralShape,
  type ProceduralShape,
  type SceneLayerKey,
} from "../engine/proceduralShape";
import type { AssetLibrary, AssetManifest, Project } from "../types/schema";

interface PreviewCanvasProps {
  project: Project;
  library: AssetLibrary;
  time: number;
}

const width = 1280;
const height = 720;

// Default camera "rest" position used when no cameraChange event is active.
// Parallax math is relative to this anchor so background and foreground only
// diverge while the camera actually pans/zooms.
const CAMERA_REST = { x: 640, y: 360 };

export function PreviewCanvas({ project, library, time }: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const allAssets = [...library.projectAssets, ...library.globalAssets];
    const state = evaluateTimeline(project, library, time);
    const scene = library.scenes.find((item) => item.sceneId === state.sceneId);
    const sceneAsset = scene ? allAssets.find((asset) => asset.assetId === scene.background) : undefined;
    const foregroundAsset = scene?.foreground
      ? allAssets.find((asset) => asset.assetId === scene.foreground)
      : undefined;

    ctx.clearRect(0, 0, width, height);

    const cameraDX = state.camera.x - CAMERA_REST.x;
    const cameraDY = state.camera.y - CAMERA_REST.y;

    // ------- background layer (slowest) -------
    withCameraLayer(ctx, state.camera, cameraDX, cameraDY, sceneAsset, "background", () => {
      paintSceneLayer(ctx, sceneAsset, "background", time);
    });

    // ------- midground: scene mid + props + characters + effects -------
    withCameraLayer(ctx, state.camera, cameraDX, cameraDY, sceneAsset, "midground", () => {
      paintSceneLayer(ctx, sceneAsset, "midground", time);

      if (scene) {
        for (const object of scene.objects) {
          if (object.type !== "prop") continue;
          const propAsset = allAssets.find((asset) => asset.assetId === (object.assetId ?? object.id));
          ctx.save();
          ctx.translate(object.x ?? 0, object.y ?? 0);
          paintShape(ctx, propAsset, { time });
          ctx.restore();
        }
      }

      // y-sort + z-sort: things farther away (lower y, higher z) draw first.
      // Depth coefficients tuned so a z = 240 character reads as ~60% the
      // size and ~70% the brightness of a z = 0 character — clearly
      // different at a glance, not just a subtle nudge.
      const sortedCharacters = [...state.characters].sort((a, b) => (b.z - a.z) || (a.y - b.y));
      for (const character of sortedCharacters) {
        const asset = allAssets.find((item) => item.assetId === character.assetId);
        const name = asset ? getAssetName({ globalAssets: [], projectAssets: [asset], scenes: [] }, asset.assetId) : "";
        const depthScale = 1 / (1 + character.z * 0.0028);
        const depthDim = clamp(character.z * 0.0014, 0, 0.35);
        ctx.save();
        ctx.globalAlpha = 1 - depthDim;
        drawCharacter(ctx, asset, {
          x: character.x,
          y: character.y,
          scale: character.scale * depthScale,
          expression: character.expression,
          action: character.action,
          time,
          name,
          z: character.z,
        });
        ctx.restore();
      }

      for (const effect of state.effects) {
        const effectAsset = allAssets.find((asset) => asset.assetId === effect.effectId);
        ctx.save();
        ctx.translate(effect.x, effect.y);
        paintShape(ctx, effectAsset, { progress: effect.progress, time });
        ctx.restore();
      }
    });

    // ------- foreground layer (fastest parallax, occludes characters) -------
    // Two foreground sources: scene's own `foreground` layer primitives, and an
    // explicit foreground asset referenced via SceneDefinition.foreground (when
    // distinct from the background asset).
    withCameraLayer(ctx, state.camera, cameraDX, cameraDY, sceneAsset, "foreground", () => {
      paintSceneLayer(ctx, sceneAsset, "foreground", time);
    });

    if (foregroundAsset && foregroundAsset.assetId !== sceneAsset?.assetId) {
      const fgShape = (foregroundAsset.metadata.shape ?? undefined) as ProceduralShape | undefined;
      const fgFactor = fgShape ? getParallaxFactor(fgShape, "foreground") : 1.25;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(state.camera.zoom, state.camera.zoom);
      ctx.translate(-(CAMERA_REST.x + cameraDX * fgFactor), -(CAMERA_REST.y + cameraDY * fgFactor));
      paintShape(ctx, foregroundAsset, { time });
      ctx.restore();
    }

    drawHud(ctx, state.caption, time, state.camera.mode);
  }, [library, project, time]);

  return <canvas ref={canvasRef} className="preview-canvas" width={width} height={height} aria-label="黄瓜引擎短剧预览" />;
}

function withCameraLayer(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number; zoom: number; mode: string },
  cameraDX: number,
  cameraDY: number,
  sceneAsset: AssetManifest | undefined,
  layer: SceneLayerKey,
  draw: () => void,
) {
  const shape = sceneAsset?.metadata.shape;
  const factor = isProceduralShape(shape)
    ? getParallaxFactor(shape, layer)
    : layer === "midground"
      ? 1
      : layer === "background"
        ? 0.5
        : 1.25;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-(CAMERA_REST.x + cameraDX * factor), -(CAMERA_REST.y + cameraDY * factor));
  draw();
  ctx.restore();
}

function paintShape(
  ctx: CanvasRenderingContext2D,
  asset: AssetManifest | undefined,
  state: Record<string, string | number | boolean | undefined>,
) {
  const shape = asset?.metadata.shape;
  if (!isProceduralShape(shape)) return;
  const palette = (asset?.metadata.palette ?? {}) as Record<string, string>;
  drawShape(ctx, shape, palette, state);
}

function paintSceneLayer(
  ctx: CanvasRenderingContext2D,
  asset: AssetManifest | undefined,
  layer: SceneLayerKey,
  time: number,
) {
  const shape = asset?.metadata.shape;
  if (!isProceduralShape(shape)) return;
  const palette = (asset?.metadata.palette ?? {}) as Record<string, string>;
  if (hasSceneLayers(shape)) {
    drawSceneLayer(ctx, shape, palette, { time }, layer);
    return;
  }
  // Legacy: a flat shape with no layer split is treated entirely as midground.
  if (layer === "midground") drawShape(ctx, shape, palette, { time });
}

function drawHud(ctx: CanvasRenderingContext2D, caption: string, time: number, mode: string) {
  ctx.fillStyle = "rgba(20, 30, 32, 0.74)";
  roundedRect(ctx, 34, 30, 245, 46, 12);
  ctx.fillStyle = "#eef7f4";
  ctx.font = "22px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${time.toFixed(1)}s · ${mode}`, 55, 61);

  if (!caption) return;
  ctx.fillStyle = "rgba(19, 25, 28, 0.78)";
  roundedRect(ctx, 220, 612, 840, 58, 16);
  ctx.fillStyle = "#fff8ed";
  ctx.font = "28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(caption, 640, 650);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
