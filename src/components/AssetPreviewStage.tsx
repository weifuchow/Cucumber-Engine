import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { drawCharacter } from "../engine/characterPainter";
import {
  drawShape,
  isProceduralShape,
  type ConditionalPrimitive,
  type ProceduralShape,
} from "../engine/proceduralShape";
import type { AssetManifest } from "../types/schema";

const W = 340;
const H = 420;

interface ShapeStates {
  actions: string[];
  expressions: string[];
  usesProgress: boolean;
}

export function AssetPreviewStage({ asset }: { asset: AssetManifest }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const states = useMemo(() => extractShapeStates(asset), [asset]);
  const [action, setAction] = useState<string>(states.actions[0] ?? "idle");
  const [expression, setExpression] = useState<string>(states.expressions[0] ?? "neutral");
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);

  useEffect(() => {
    setAction(states.actions[0] ?? "idle");
    setExpression(states.expressions[0] ?? "neutral");
    setTime(0);
  }, [asset.assetId, states.actions, states.expressions]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const step = (now: number) => {
      setTime((t) => t + (now - prev) / 1000);
      prev = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

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
        expression,
        action,
        time,
      });
      return;
    }

    const palette = (asset.metadata.palette ?? {}) as Record<string, string>;
    const fit = shape.preview?.fit ?? "center";

    if (asset.type === "effect" || states.usesProgress) {
      const loopSec = 1.2;
      const progress = (time % loopSec) / loopSec;
      ctx.translate(W / 2, H / 2);
      drawShape(ctx, shape, palette, { progress, time });
      return;
    }

    if (fit === "contain") {
      const w = (asset.metadata.width as number | undefined) ?? 1280;
      const h = (asset.metadata.height as number | undefined) ?? 720;
      const s = Math.min(W / w, H / h) * 0.96;
      ctx.translate((W - w * s) / 2, (H - h * s) / 2);
      ctx.scale(s, s);
      drawShape(ctx, shape, palette, { time });
      return;
    }

    ctx.translate(W / 2, H / 2);
    if (shape.preview?.scale) ctx.scale(shape.preview.scale, shape.preview.scale);
    drawShape(ctx, shape, palette, { time });
  }, [asset, action, expression, time, states.usesProgress]);

  const hasActionToggle = states.actions.length > 1;
  const hasExpressionToggle = states.expressions.length > 1;

  return (
    <div className="asset-preview-stage">
      <canvas ref={canvasRef} className="character-portrait" width={W} height={H} aria-label={`${asset.name} 预览`} />

      <div className="stage-controls">
        {hasActionToggle ? (
          <div className="stage-control-group">
            <small>动作</small>
            <div className="stage-pill-row">
              {states.actions.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`stage-pill ${value === action ? "is-active" : ""}`}
                  onClick={() => setAction(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {hasExpressionToggle ? (
          <div className="stage-control-group">
            <small>表情</small>
            <div className="stage-pill-row">
              {states.expressions.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`stage-pill ${value === expression ? "is-active" : ""}`}
                  onClick={() => setExpression(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="stage-control-group stage-control-buttons">
          <button
            type="button"
            className="icon-button"
            title={playing ? "暂停动画" : "继续动画"}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            type="button"
            className="icon-button"
            title="重置动画"
            onClick={() => setTime(0)}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function extractShapeStates(asset: AssetManifest): ShapeStates {
  const shape = asset.metadata?.shape;
  if (!isProceduralShape(shape)) return { actions: [], expressions: [], usesProgress: false };

  const actions = new Set<string>();
  const expressions = new Set<string>();
  let usesProgress = false;

  function scanString(s: string) {
    if (s.includes("progress")) usesProgress = true;
  }

  function scanWhen(when: string) {
    const inMatch = when.match(/^\s*(\w+)\s+(not\s+)?in\s+\[([^\]]+)\]\s*$/);
    if (inMatch) {
      const key = inMatch[1];
      const vals = inMatch[3].split(",").map((s) => s.trim()).filter(Boolean);
      const target = key === "action" ? actions : key === "expression" ? expressions : null;
      if (target) vals.forEach((v) => target.add(v));
      return;
    }
    const eqMatch = when.match(/^\s*(\w+)\s*(==|!=)\s*([\w-]+)\s*$/);
    if (eqMatch) {
      const key = eqMatch[1];
      const val = eqMatch[3];
      const target = key === "action" ? actions : key === "expression" ? expressions : null;
      if (target) target.add(val);
    }
  }

  function visit(prims: ConditionalPrimitive[]) {
    for (const p of prims) {
      if (p.when) scanWhen(p.when);
      // crude scan for any string-valued numeric expression referencing `progress`
      for (const value of Object.values(p)) {
        if (typeof value === "string") scanString(value);
      }
      if (p.kind === "transform") visit(p.children);
    }
  }

  visit((shape as ProceduralShape).primitives);

  if (asset.type === "character") {
    if (!expressions.has("neutral")) {
      const list = Array.from(expressions);
      expressions.clear();
      expressions.add("neutral");
      list.forEach((v) => expressions.add(v));
    }
    if (!actions.has("idle")) {
      const list = Array.from(actions);
      actions.clear();
      actions.add("idle");
      list.forEach((v) => actions.add(v));
    }
  }

  return {
    actions: Array.from(actions),
    expressions: Array.from(expressions),
    usesProgress,
  };
}
