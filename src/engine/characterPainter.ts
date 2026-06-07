import type { AssetManifest } from "../types/schema";
import { drawShape, isProceduralShape, type ProceduralShape } from "./proceduralShape";

export interface DrawCharacterOptions {
  x: number;
  y: number;
  scale: number;
  expression: string;
  action?: string;
  time?: number;
  name?: string;
  /** Pseudo-depth used by contact shadow + lighting expressions in the shape. */
  z?: number;
}

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  asset: AssetManifest | undefined,
  options: DrawCharacterOptions,
) {
  const palette = (asset?.metadata.palette ?? {}) as Record<string, string>;
  const shape = asset?.metadata.shape;
  const displayName = (asset?.metadata.displayName as string | undefined) ?? options.name ?? asset?.name ?? "";

  ctx.save();
  ctx.translate(options.x, options.y);
  ctx.scale(options.scale, options.scale);

  if (isProceduralShape(shape)) {
    drawShape(ctx, shape as ProceduralShape, palette, {
      expression: options.expression,
      action: options.action ?? "idle",
      time: options.time ?? 0,
      name: displayName,
      z: options.z ?? 0,
    });
  }

  ctx.restore();
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

export function darken(color: string) {
  if (!color.startsWith("#") || color.length !== 7) return color;
  const n = Number.parseInt(color.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 32);
  const g = Math.max(0, ((n >> 8) & 255) - 32);
  const b = Math.max(0, (n & 255) - 32);
  return `rgb(${r}, ${g}, ${b})`;
}
