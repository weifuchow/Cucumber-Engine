import { useEffect, useRef } from "react";
import { evaluateTimeline, getAssetName } from "../engine/timeline";
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

    const state = evaluateTimeline(project, library, time);
    const scene = library.scenes.find((item) => item.sceneId === state.sceneId);

    ctx.clearRect(0, 0, width, height);
    drawScene(ctx);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.translate(-state.camera.x, -state.camera.y);

    drawRoomDepth(ctx);
    if (scene) {
      for (const object of scene.objects) {
        if (object.type === "prop") drawProp(ctx, object.assetId ?? object.id, object.x ?? 0, object.y ?? 0);
      }
    }

    for (const character of state.characters.sort((a, b) => a.y - b.y)) {
      const asset = [...library.projectAssets, ...library.globalAssets].find((item) => item.assetId === character.assetId);
      drawCharacter(ctx, asset, character.x, character.y, character.scale, character.expression);
    }

    for (const effect of state.effects) drawFlash(ctx, effect.x, effect.y, effect.progress);
    drawForeground(ctx);
    ctx.restore();

    drawHud(ctx, state.caption, time, state.camera.mode);
  }, [library, project, time]);

  return <canvas ref={canvasRef} className="preview-canvas" width={width} height={height} aria-label="黄瓜引擎短剧预览" />;
}

function drawScene(ctx: CanvasRenderingContext2D) {
  const wall = ctx.createLinearGradient(0, 0, 0, height);
  wall.addColorStop(0, "#d8e9e5");
  wall.addColorStop(0.58, "#bed4cf");
  wall.addColorStop(0.59, "#88664e");
  wall.addColorStop(1, "#5f4234");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#e8f3ef";
  ctx.fillRect(84, 80, 245, 385);
  ctx.fillStyle = "#99b8b4";
  ctx.fillRect(105, 105, 88, 135);
  ctx.fillRect(215, 105, 88, 135);
  ctx.fillRect(105, 263, 88, 165);
  ctx.fillRect(215, 263, 88, 165);

  ctx.fillStyle = "#6d4d3f";
  ctx.fillRect(760, 365, 300, 140);
  ctx.fillStyle = "#80614f";
  roundedRect(ctx, 720, 445, 400, 115, 24);
  ctx.fillStyle = "#3d6269";
  roundedRect(ctx, 770, 393, 300, 80, 28);

  ctx.fillStyle = "#b98e55";
  roundedRect(ctx, 510, 574, 240, 42, 14);
  ctx.fillStyle = "#6e4a35";
  ctx.fillRect(535, 610, 18, 58);
  ctx.fillRect(705, 610, 18, 58);
}

function drawRoomDepth(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "rgba(45, 52, 51, 0.16)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 545);
  ctx.lineTo(1280, 545);
  ctx.moveTo(640, 545);
  ctx.lineTo(330, 720);
  ctx.moveTo(640, 545);
  ctx.lineTo(950, 720);
  ctx.stroke();
}

function drawForeground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(30, 42, 42, 0.16)";
  ctx.fillRect(0, 684, width, 36);
}

function drawProp(ctx: CanvasRenderingContext2D, assetId: string, x: number, y: number) {
  if (!assetId.includes("schoolbag")) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#385d82";
  roundedRect(ctx, -55, -78, 110, 76, 16);
  ctx.strokeStyle = "#243d58";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, -78, 38, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#f4b457";
  roundedRect(ctx, -28, -58, 56, 26, 8);
  ctx.restore();
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  asset: AssetManifest | undefined,
  x: number,
  y: number,
  scale: number,
  expression: string,
) {
  const palette = (asset?.metadata.palette ?? {}) as Record<string, string>;
  const isChild = asset?.assetId.includes("child");
  const name = asset ? getAssetName({ globalAssets: [], projectAssets: [asset], scenes: [] }, asset.assetId) : "";
  const body = palette.body ?? "#496f8d";
  const skin = palette.skin ?? "#efbd8b";
  const hair = palette.hair ?? "#34261e";
  const heightScale = isChild ? 0.82 : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * heightScale, scale * heightScale);

  ctx.fillStyle = "rgba(25, 24, 22, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 14, 92, 25, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = body;
  roundedRect(ctx, -58, -245, 116, 205, 38);
  ctx.fillStyle = darken(body);
  roundedRect(ctx, -75, -210, 36, 128, 20);
  roundedRect(ctx, 39, -210, 36, 128, 20);

  ctx.fillStyle = "#293038";
  roundedRect(ctx, -48, -48, 36, 65, 13);
  roundedRect(ctx, 12, -48, 36, 65, 13);

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -310, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(0, -344, 72, 44, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-68, -345, 136, 28);

  drawFace(ctx, expression);

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  roundedRect(ctx, -72, -395, 144, 32, 10);
  ctx.fillStyle = "#243033";
  ctx.font = "22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name.replace("模板", ""), 0, -372);
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, expression: string) {
  ctx.strokeStyle = "#2b2420";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";

  if (expression === "angry") {
    ctx.beginPath();
    ctx.moveTo(-36, -326);
    ctx.lineTo(-12, -318);
    ctx.moveTo(36, -326);
    ctx.lineTo(12, -318);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-36, -322);
    ctx.lineTo(-12, -322);
    ctx.moveTo(12, -322);
    ctx.lineTo(36, -322);
    ctx.stroke();
  }

  ctx.fillStyle = "#251f1c";
  ctx.beginPath();
  ctx.arc(-24, -302, 5, 0, Math.PI * 2);
  ctx.arc(24, -302, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  if (expression === "sad") {
    ctx.arc(0, -268, 25, Math.PI * 1.12, Math.PI * 1.88);
  } else if (expression === "soft") {
    ctx.arc(0, -282, 26, 0.15, Math.PI - 0.15);
  } else if (expression === "surprised") {
    ctx.arc(0, -276, 11, 0, Math.PI * 2);
  } else {
    ctx.moveTo(-20, -276);
    ctx.lineTo(20, -276);
  }
  ctx.stroke();
}

function drawFlash(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(progress * Math.PI);
  const alpha = 1 - progress;
  ctx.fillStyle = `rgba(255, 213, 88, ${alpha})`;
  ctx.strokeStyle = `rgba(198, 75, 58, ${alpha})`;
  ctx.lineWidth = 8;
  ctx.beginPath();
  for (let i = 0; i < 12; i += 1) {
    const radius = i % 2 === 0 ? 90 + progress * 80 : 34;
    const angle = (i / 12) * Math.PI * 2;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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

function darken(color: string) {
  if (!color.startsWith("#") || color.length !== 7) return color;
  const n = Number.parseInt(color.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 32);
  const g = Math.max(0, ((n >> 8) & 255) - 32);
  const b = Math.max(0, (n & 255) - 32);
  return `rgb(${r}, ${g}, ${b})`;
}
