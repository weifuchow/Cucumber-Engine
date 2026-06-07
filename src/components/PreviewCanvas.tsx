import { useEffect, useRef } from "react";
import { evaluateTimeline, getAssetName, getActiveSegment } from "../engine/timeline";
import { drawCharacter, getBodyPartLayers, type BodyPartLayer } from "../engine/characterPainter";
import {
  drawSceneLayer,
  drawShape,
  getParallaxFactor,
  hasSceneLayers,
  isProceduralShape,
  type ProceduralShape,
  type SceneLayerKey,
} from "../engine/proceduralShape";
import type { AssetLibrary, AssetManifest, Project, TimelineEvent } from "../types/schema";

interface PreviewCanvasProps {
  project: Project;
  library: AssetLibrary;
  time: number;
  /**
   * Whether the preview is actively running (vs. paused / scrubbing). When
   * false the audio playback layer pauses everything; when true it tries
   * to keep playback in sync with `time` and only catches up if drift
   * exceeds AUDIO_RESYNC_THRESHOLD seconds.
   */
  playing?: boolean;
}

const AUDIO_RESYNC_THRESHOLD = 0.25;
const SEGMENT_GAP_SETTLE = 0.4;

const width = 1280;
const height = 720;

// Default camera "rest" position used when no cameraChange event is active.
// Parallax math is relative to this anchor so background and foreground only
// diverge while the camera actually pans/zooms.
const CAMERA_REST = { x: 640, y: 360 };

/**
 * Bag of audio elements currently mounted by the preview. Keyed by
 * `<eventType>:<eventIndexInSegment>` so we can identify them on the next
 * tick. We keep them alive across frames (don't remount per-frame) to
 * avoid the browser's autoplay throttle.
 */
type AudioBag = Map<string, HTMLAudioElement>;

interface AudibleEvent {
  key: string;
  startTime: number;
  duration: number;
  audioUrl: string;
  volume: number;
  loop: boolean;
}

/**
 * Walk the segment timeline and return the subset of events that should
 * be producing sound at the given preview `time`. Only events with an
 * `audioUrl` (TTS dialogue/narration) or that point at an audio asset
 * (`bgmPlay`, `soundEffect`) contribute.
 */
function collectAudibleEvents(
  segmentTimeline: TimelineEvent[],
  library: AssetLibrary,
  time: number,
): AudibleEvent[] {
  const out: AudibleEvent[] = [];
  const allAssets = [...library.projectAssets, ...library.globalAssets];

  for (let i = 0; i < segmentTimeline.length; i++) {
    const event = segmentTimeline[i];
    if (event.type === "dialogue" || event.type === "narration") {
      if (!event.audioUrl) continue;
      const inWindow = time >= event.time && time < event.time + event.duration + 0.05;
      if (!inWindow) continue;
      out.push({
        key: `${event.type}:${i}`,
        startTime: event.time,
        duration: event.duration,
        audioUrl: event.audioUrl,
        volume: 1,
        loop: false,
      });
    } else if (event.type === "bgmPlay") {
      const asset = allAssets.find((a) => a.assetId === event.assetId);
      const url = asset?.files?.sourceUrl ?? asset?.files?.preview;
      // BGM persists for the rest of the segment (no native duration field).
      if (!url || !url.startsWith("http") && !url.startsWith("/")) continue;
      if (time < event.time) continue;
      out.push({
        key: `bgm:${i}`,
        startTime: event.time,
        duration: 9999,
        audioUrl: url,
        volume: clamp((event.volume ?? 60) / 100, 0, 1),
        loop: true,
      });
    } else if (event.type === "soundEffect") {
      const asset = allAssets.find((a) => a.assetId === event.assetId);
      const url = asset?.files?.sourceUrl ?? asset?.files?.preview;
      if (!url || !url.startsWith("http") && !url.startsWith("/")) continue;
      const meta = asset?.metadata as { durationSec?: number } | undefined;
      const sfxDur = typeof meta?.durationSec === "number" ? meta.durationSec : 1.2;
      if (time < event.time || time >= event.time + sfxDur + 0.05) continue;
      out.push({
        key: `sfx:${i}`,
        startTime: event.time,
        duration: sfxDur,
        audioUrl: url,
        volume: clamp((event.volume ?? 80) / 100, 0, 1),
        loop: false,
      });
    }
  }
  return out;
}

/**
 * Reconcile the live `audioBag` with the desired set of audible events.
 *   - Add any new ones (mount + play).
 *   - Update volume + audio src if it changed.
 *   - Resync `currentTime` if drift > AUDIO_RESYNC_THRESHOLD (catches up
 *     after scrubs / pauses).
 *   - Remove any no-longer-active ones (pause + drop the entry).
 *
 * Returns nothing — bag is mutated in place.
 */
function syncAudio(
  bag: AudioBag,
  desired: AudibleEvent[],
  time: number,
  playing: boolean,
) {
  const desiredKeys = new Set(desired.map((d) => d.key));

  // Remove anything no longer wanted.
  for (const [key, el] of bag) {
    if (!desiredKeys.has(key)) {
      el.pause();
      el.src = "";
      bag.delete(key);
    }
  }

  // Add / update what is wanted.
  for (const ev of desired) {
    let el = bag.get(ev.key);
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      bag.set(ev.key, el);
    }
    if (el.src !== ev.audioUrl && !el.src.endsWith(ev.audioUrl)) {
      el.src = ev.audioUrl;
      el.loop = ev.loop;
    }
    el.volume = ev.volume;
    const wantedAt = Math.max(0, time - ev.startTime);
    const drift = Math.abs((el.currentTime || 0) - wantedAt);
    if (drift > AUDIO_RESYNC_THRESHOLD) {
      // Defensive: setting currentTime on an unloaded element throws.
      try { el.currentTime = wantedAt; } catch {/* ignore */}
    }
    if (playing && el.paused) {
      // play() can reject on autoplay throttle; ignore so we don't crash
      // the render loop.
      el.play().catch(() => {/* user gesture required, etc. */});
    } else if (!playing && !el.paused) {
      el.pause();
    }
  }
}

export function PreviewCanvas({ project, library, time, playing = true }: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioBagRef = useRef<AudioBag>(new Map());
  const lastSegmentIdRef = useRef<string>("");
  const lastTimeRef = useRef<number>(0);

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

      // Detect whether any character has a body-part layer map. If none
      // do, fall back to the legacy single-pass render (cheaper, identical
      // output). If any do, run a 3-pass render so per-limb occlusion
      // works across characters.
      const anyHasLayers = sortedCharacters.some((c) => {
        const asset = allAssets.find((a) => a.assetId === c.assetId);
        return Boolean(getBodyPartLayers(asset));
      });

      const drawOne = (character: typeof sortedCharacters[number], bodyPartLayer?: BodyPartLayer) => {
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
          expressionIntensity: character.expressionIntensity,
          action: character.action,
          time,
          name,
          z: character.z,
          angle: character.angle,
          viseme: character.viseme,
          headYaw: character.headYaw,
          headPitch: character.headPitch,
          bodyPartLayer,
        });
        ctx.restore();
      };

      if (!anyHasLayers) {
        for (const character of sortedCharacters) drawOne(character);
      } else {
        // 3-pass: behind → main → front. Each pass re-sorts by depth so
        // closer characters' parts always overlap farther characters'
        // parts of the same layer.
        const passes: BodyPartLayer[] = ["behind", "main", "front"];
        for (const layer of passes) {
          for (const character of sortedCharacters) drawOne(character, layer);
        }
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

  // ---- audio playback (dialogue / narration / bgm / sfx) ------------------
  useEffect(() => {
    // Detect segment swap — fully purge the audio bag because keys are
    // segment-indexed and would collide otherwise.
    const segment = getActiveSegment(project);
    if (lastSegmentIdRef.current && lastSegmentIdRef.current !== segment.segmentId) {
      for (const el of audioBagRef.current.values()) { el.pause(); el.src = ""; }
      audioBagRef.current.clear();
    }
    lastSegmentIdRef.current = segment.segmentId;

    // Detect backwards seek by more than the settle threshold — purge and
    // let syncAudio re-trigger play() from scratch. Without this, an audio
    // element that's already past `time` will refuse to "rewind" cleanly
    // on some browsers.
    if (lastTimeRef.current - time > SEGMENT_GAP_SETTLE) {
      for (const el of audioBagRef.current.values()) { el.pause(); el.currentTime = 0; }
    }
    lastTimeRef.current = time;

    const audible = collectAudibleEvents(segment.timeline, library, time);
    syncAudio(audioBagRef.current, audible, time, playing);
  }, [project, library, time, playing]);

  // Final cleanup on unmount.
  useEffect(() => {
    const bag = audioBagRef.current;
    return () => {
      for (const el of bag.values()) { el.pause(); el.src = ""; }
      bag.clear();
    };
  }, []);

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
