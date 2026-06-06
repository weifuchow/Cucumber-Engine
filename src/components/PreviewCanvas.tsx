import { useEffect, useRef } from "react";
import { evaluateTimeline, getAssetName } from "../engine/timeline";
import { drawCharacter } from "../engine/characterPainter";
import { drawShape, isProceduralShape } from "../engine/proceduralShape";
import type { AssetLibrary, AssetManifest, Project } from "../types/schema";

interface PreviewCanvasProps {
  project: Project;
  library: AssetLibrary;
  time: number;
}

const width = 1280;
const height = 720;

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

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.translate(-state.camera.x, -state.camera.y);

    paintShape(ctx, sceneAsset, {});

    if (scene) {
      for (const object of scene.objects) {
        if (object.type !== "prop") continue;
        const propAsset = allAssets.find((asset) => asset.assetId === (object.assetId ?? object.id));
        ctx.save();
        ctx.translate(object.x ?? 0, object.y ?? 0);
        paintShape(ctx, propAsset, {});
        ctx.restore();
      }
    }

    for (const character of state.characters.sort((a, b) => a.y - b.y)) {
      const asset = allAssets.find((item) => item.assetId === character.assetId);
      const name = asset ? getAssetName({ globalAssets: [], projectAssets: [asset], scenes: [] }, asset.assetId) : "";
      drawCharacter(ctx, asset, {
        x: character.x,
        y: character.y,
        scale: character.scale,
        expression: character.expression,
        action: character.action,
        time,
        name,
      });
    }

    for (const effect of state.effects) {
      const effectAsset = allAssets.find((asset) => asset.assetId === effect.effectId);
      ctx.save();
      ctx.translate(effect.x, effect.y);
      paintShape(ctx, effectAsset, { progress: effect.progress });
      ctx.restore();
    }
    ctx.restore();

    drawHud(ctx, state.caption, time, state.camera.mode);
  }, [library, project, time]);

  return <canvas ref={canvasRef} className="preview-canvas" width={width} height={height} aria-label="黄瓜引擎短剧预览" />;
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
