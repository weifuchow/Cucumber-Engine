import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Pause, Play, RotateCcw } from "lucide-react";
import { drawCharacter, pickCharacterShape } from "../engine/characterPainter";
import {
  drawSceneLayer,
  drawShape,
  getParallaxFactor,
  hasSceneLayers,
  isProceduralShape,
  type ConditionalPrimitive,
  type ProceduralShape,
  type SceneLayerKey,
} from "../engine/proceduralShape";
import { ANGLE_KEYS, type AngleKey, type AssetManifest } from "../types/schema";

const W = 340;
const H = 420;

// Display order for the angle picker (mirrors the natural turn-around the
// user would see: side → front → side, then back, then 3/4 variants).
const ANGLE_DISPLAY_ORDER: AngleKey[] = [
  "sideLeft", "threeQuarterLeft", "front", "threeQuarterRight", "sideRight", "back",
];

const ANGLE_LABEL: Record<AngleKey, string> = {
  front: "正",
  back: "背",
  sideLeft: "侧左",
  sideRight: "侧右",
  threeQuarterLeft: "斜左",
  threeQuarterRight: "斜右",
};

interface ShapeStates {
  actions: string[];
  expressions: string[];
  usesProgress: boolean;
}

/**
 * Pull declared views from a character manifest. Falls back to `["front"]`
 * for legacy single-shape manifests so the angle picker UI is non-empty.
 */
function getDeclaredViews(asset: AssetManifest): AngleKey[] {
  const declared = (asset.metadata as { views?: unknown }).views;
  if (Array.isArray(declared) && declared.length) {
    const filtered = declared.filter((v): v is AngleKey => ANGLE_KEYS.includes(v as AngleKey));
    if (filtered.length) return filtered;
  }
  const shapes = (asset.metadata as { shapes?: Partial<Record<AngleKey, unknown>> }).shapes;
  if (shapes) {
    const keys = (Object.keys(shapes) as AngleKey[]).filter((k) => ANGLE_KEYS.includes(k));
    if (keys.length) return keys;
  }
  return ["front"];
}

export function AssetPreviewStage({ asset }: { asset: AssetManifest }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const states = useMemo(() => extractShapeStates(asset), [asset]);
  const declaredViews = useMemo(() => getDeclaredViews(asset), [asset]);
  const [action, setAction] = useState<string>(states.actions[0] ?? "idle");
  const [expression, setExpression] = useState<string>(states.expressions[0] ?? "neutral");
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  // 2.5D preview controls
  const [cameraPan, setCameraPan] = useState(false);
  const [characterZ, setCharacterZ] = useState(0);
  const [angle, setAngle] = useState<AngleKey>(declaredViews[0] ?? "front");
  // Painterly post-FX toggle — lets the author verify how the asset
  // reads through the project's global LUT + grain + vignette without
  // having to drop it into a segment first.
  const [postFxOn, setPostFxOn] = useState(true);

  useEffect(() => {
    setAction(states.actions[0] ?? "idle");
    setExpression(states.expressions[0] ?? "neutral");
    setTime(0);
    setCameraPan(false);
    setCharacterZ(0);
    setAngle(declaredViews[0] ?? "front");
  }, [asset.assetId, states.actions, states.expressions, declaredViews]);

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

    if (asset.type === "character") {
      // Resolve the current-angle shape first so the preview matches the
      // angle picker. Falls back to legacy `metadata.shape` for older
      // single-view assets via pickCharacterShape().
      const { shape: angleShape } = pickCharacterShape(asset, angle);
      if (!angleShape) return;
      // Apply depth scaling + dimming based on the z slider so users can
      // dial in the same z-depth behavior the timeline applies.
      const depthScale = 1 / (1 + characterZ * 0.0015);
      const depthDim = clamp(characterZ * 0.0008, 0, 0.25);
      ctx.save();
      ctx.globalAlpha = 1 - depthDim;
      drawCharacter(ctx, asset, {
        x: W / 2,
        y: H - 30,
        scale: (angleShape.preview?.scale ?? 0.78) * depthScale,
        expression,
        action,
        time,
        z: characterZ,
        angle,
      });
      ctx.restore();
      return;
    }

    const shape = asset.metadata.shape;
    if (!isProceduralShape(shape)) return;

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

      // Scene multi-layer preview with optional parallax pan: oscillate a
      // virtual camera offset along x and draw each layer at its own
      // parallax factor. Lets the user feel depth from a single thumbnail.
      const panAmpPx = cameraPan ? 90 : 0;
      const cameraDX = Math.sin(time * 1.4) * panAmpPx;
      const layers: SceneLayerKey[] = ["background", "midground", "foreground"];

      const renderLayer = (layer: SceneLayerKey) => {
        const factor = getParallaxFactor(shape, layer);
        ctx.save();
        ctx.translate((W - w * s) / 2, (H - h * s) / 2);
        ctx.scale(s, s);
        ctx.translate(-cameraDX * factor, 0);
        drawSceneLayer(ctx, shape, palette, { time }, layer);
        ctx.restore();
      };

      if (hasSceneLayers(shape)) {
        for (const layer of layers) renderLayer(layer);
      } else {
        ctx.save();
        ctx.translate((W - w * s) / 2, (H - h * s) / 2);
        ctx.scale(s, s);
        ctx.translate(-cameraDX, 0);
        drawShape(ctx, shape, palette, { time });
        ctx.restore();
      }
      return;
    }

    ctx.translate(W / 2, H / 2);
    if (shape.preview?.scale) ctx.scale(shape.preview.scale, shape.preview.scale);
    drawShape(ctx, shape, palette, { time });
  }, [asset, action, expression, time, states.usesProgress, cameraPan, characterZ, angle, postFxOn]);

  // Stage-local postFX pass — mirrors the project-level grade in
  // PreviewCanvas but runs against the asset preview canvas so authors
  // can verify how the asset reads under the LUT before dropping it
  // into a segment. Re-runs only when postFxOn changes (cheap; once
  // per toggle), composited on top of the latest frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!postFxOn) return;
    // Re-grade by copying the canvas through a filter, then dust grain.
    ctx.save();
    ctx.filter = "saturate(0.94) contrast(1.06) sepia(0.03)";
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }, [postFxOn, time, asset, action, expression, angle, cameraPan, characterZ]);

  const hasActionToggle = states.actions.length > 1;
  const hasExpressionToggle = states.expressions.length > 1;
  const isScene = asset.type === "scene" || asset.type === "background" || asset.type === "foreground";
  const shape = asset.metadata.shape;
  const sceneHasLayers = isProceduralShape(shape) && hasSceneLayers(shape);
  const isCharacter = asset.type === "character";
  const hasAngleToggle = isCharacter && declaredViews.length > 1;
  // Display order: only show the views the manifest actually declares,
  // but sort them in the natural turn order.
  const angleButtons = ANGLE_DISPLAY_ORDER.filter((a) => declaredViews.includes(a));

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
        {hasAngleToggle ? (
          <div className="stage-control-group">
            <small>视角</small>
            <div className="stage-pill-row">
              {angleButtons.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`stage-pill ${value === angle ? "is-active" : ""}`}
                  onClick={() => setAngle(value)}
                  title={value}
                >
                  {ANGLE_LABEL[value]}
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
        {isScene && sceneHasLayers ? (
          <div className="stage-control-group">
            <small>2.5D 摄像机扫动</small>
            <div className="stage-pill-row">
              <button
                type="button"
                className={`stage-pill ${cameraPan ? "is-active" : ""}`}
                onClick={() => setCameraPan((current) => !current)}
                title="开关左右扫动以验证视差"
              >
                <Camera size={13} style={{ marginRight: 4 }} />
                {cameraPan ? "扫动中" : "静止"}
              </button>
            </div>
          </div>
        ) : null}
        <div className="stage-control-group">
          <small>后期效果</small>
          <div className="stage-pill-row">
            <button
              type="button"
              className={`stage-pill ${postFxOn ? "is-active" : ""}`}
              onClick={() => setPostFxOn((current) => !current)}
              title="叠加项目全局 LUT（饱和度/对比度/sepia）— 看 asset 上线后的真实观感"
            >
              {postFxOn ? "Post-FX 开" : "Post-FX 关"}
            </button>
          </div>
        </div>
        {isCharacter ? (
          <div className="stage-control-group" style={{ flex: 1 }}>
            <small>景深 z: {Math.round(characterZ)}</small>
            <input
              type="range"
              min={0}
              max={300}
              step={5}
              value={characterZ}
              onChange={(event) => setCharacterZ(Number(event.target.value))}
              aria-label="角色 z 景深"
              style={{ width: "100%" }}
            />
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

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
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
      if (p.kind === "clip") visit(p.children);
    }
  }

  const allPrims: ConditionalPrimitive[] = [
    ...(shape as ProceduralShape).primitives,
    ...((shape as ProceduralShape).layers?.background ?? []),
    ...((shape as ProceduralShape).layers?.midground ?? []),
    ...((shape as ProceduralShape).layers?.foreground ?? []),
  ];
  visit(allPrims);

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
