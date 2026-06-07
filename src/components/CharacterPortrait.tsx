import { useEffect, useRef } from "react";
import { drawCharacter } from "../engine/characterPainter";
import {
  drawSceneLayer,
  drawShape,
  hasSceneLayers,
  isProceduralShape,
  type SceneLayerKey,
} from "../engine/proceduralShape";
import type { AssetManifest } from "../types/schema";

const W = 340;
const H = 420;

export function CharacterPortrait({ asset }: { asset: AssetManifest }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#eef3f0";
    ctx.fillRect(0, 0, W, H);

    const shape = asset.metadata.shape;
    if (!isProceduralShape(shape)) return;

    if (asset.type === "character") {
      drawCharacter(ctx, asset, {
        x: W / 2,
        y: H - 30,
        scale: shape.preview?.scale ?? 0.78,
        expression: "neutral",
      });
      return;
    }

    const palette = (asset.metadata.palette ?? {}) as Record<string, string>;
    const fit = shape.preview?.fit ?? "center";

    if (fit === "contain") {
      const w = (asset.metadata.width as number | undefined) ?? 1280;
      const h = (asset.metadata.height as number | undefined) ?? 720;
      const s = Math.min(W / w, H / h) * 0.96;
      ctx.translate((W - w * s) / 2, (H - h * s) / 2);
      ctx.scale(s, s);

      if (hasSceneLayers(shape)) {
        const layers: SceneLayerKey[] = ["background", "midground", "foreground"];
        for (const layer of layers) drawSceneLayer(ctx, shape, palette, { progress: 0.4 }, layer);
      } else {
        drawShape(ctx, shape, palette, { progress: 0.4 });
      }
      return;
    }

    ctx.translate(W / 2, H / 2);
    if (shape.preview?.scale) ctx.scale(shape.preview.scale, shape.preview.scale);
    drawShape(ctx, shape, palette, { progress: 0.4 });
  }, [asset]);

  return <canvas ref={canvasRef} className="character-portrait" width={W} height={H} aria-label={`${asset.name} 预览`} />;
}
