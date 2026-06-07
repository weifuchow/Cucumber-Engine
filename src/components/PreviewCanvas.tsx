import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
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

/**
 * Imperative handle exposed via ref for video export. Calling `exportVideo`
 * arms a MediaRecorder against the live canvas captureStream + a
 * Web-Audio mix of dialogue/bgm/sfx, then drives playback through the
 * segment duration and returns a WebM blob. The caller is responsible
 * for downloading or transcoding the result.
 */
export interface PreviewCanvasHandle {
  exportVideo: (opts: ExportVideoOptions) => Promise<Blob>;
  getCanvas: () => HTMLCanvasElement | null;
}

export interface ExportVideoOptions {
  /** Hint the MediaRecorder fps. Default 30. */
  fps?: number;
  /** Called as playback ticks. progress 0..1. */
  onProgress?: (progress: number) => void;
  /** Called when recording starts. */
  onStart?: () => void;
  /** Setter the export uses to drive playback time. */
  setTime: (t: number) => void;
  /** Setter the export uses to start/stop playback. */
  setPlaying: (p: boolean) => void;
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
    } else if (event.type === "characterAction") {
      // Auto-soundEffect: if the character manifest declares a
      // `metadata.soundEffectIds[<actionName>]`, treat the action as
      // an implicit soundEffect event without requiring the segment to
      // also emit one explicitly. The skill docs promise this; this is
      // where the promise becomes runtime behavior.
      const character = allAssets.find((a) => a.assetId === event.target);
      const sfxMap = (character?.metadata as { soundEffectIds?: Record<string, string> } | undefined)?.soundEffectIds;
      const sfxId = sfxMap?.[event.action.name];
      if (!sfxId) continue;
      const sfxAsset = allAssets.find((a) => a.assetId === sfxId);
      const url = sfxAsset?.files?.sourceUrl ?? sfxAsset?.files?.preview;
      if (!url || !url.startsWith("http") && !url.startsWith("/")) continue;
      const meta = sfxAsset?.metadata as { durationSec?: number } | undefined;
      const sfxDur = typeof meta?.durationSec === "number" ? meta.durationSec : 0.8;
      if (time < event.time || time >= event.time + sfxDur + 0.05) continue;
      out.push({
        key: `autoSfx:${i}`,
        startTime: event.time,
        duration: sfxDur,
        audioUrl: url,
        volume: 0.7,
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
/**
 * Recording bridge — when video export is active, every newly mounted
 * audio element gets routed through the export's AudioContext destination
 * so the recorded MediaStream carries the mix. Set/cleared by the
 * exportVideo() handle below.
 */
interface RecordingBridge {
  audioContext: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  routed: WeakSet<HTMLAudioElement>;
}

function routeForRecording(el: HTMLAudioElement, bridge: RecordingBridge | null) {
  if (!bridge) return;
  if (bridge.routed.has(el)) return;
  try {
    const src = bridge.audioContext.createMediaElementSource(el);
    src.connect(bridge.destination);
    // Also tee back to the speakers so the user hears playback as it
    // records — otherwise the export runs in silence.
    src.connect(bridge.audioContext.destination);
    bridge.routed.add(el);
  } catch {
    // createMediaElementSource throws if the element is already in a
    // different graph. Ignore — we just won't capture this one.
  }
}

function syncAudio(
  bag: AudioBag,
  desired: AudibleEvent[],
  time: number,
  playing: boolean,
  recordingBridge: RecordingBridge | null,
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
    routeForRecording(el, recordingBridge);
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

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(function PreviewCanvas(
  { project, library, time, playing = true },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioBagRef = useRef<AudioBag>(new Map());
  const recordingBridgeRef = useRef<RecordingBridge | null>(null);
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

    // ------- post-FX pass: global film grain + vignette + LUT --------------
    // Applied AFTER the scene/characters/effects are flat but BEFORE the
    // HUD overlay so subtitles + timer stay crisp.
    paintPostFX(ctx, project);

    drawHud(ctx, state.caption, time, state.camera.mode, state.captionStyle);
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
    syncAudio(audioBagRef.current, audible, time, playing, recordingBridgeRef.current);
  }, [project, library, time, playing]);

  // Final cleanup on unmount.
  useEffect(() => {
    const bag = audioBagRef.current;
    return () => {
      for (const el of bag.values()) { el.pause(); el.src = ""; }
      bag.clear();
    };
  }, []);

  // ---- exportVideo handle ------------------------------------------------
  //
  // Builds a MediaStream that combines the canvas video track with a Web
  // Audio destination carrying every active dialogue/narration/bgm/sfx,
  // then records the segment from t=0 to t=duration via MediaRecorder
  // and resolves with the resulting WebM blob.
  //
  // Caveats / design decisions:
  //   - Recording runs in REAL TIME (no fast-render path) because the
  //     audio elements drive playback off wall-clock time. A 22 s
  //     segment takes ~22 s to export.
  //   - WebM (vp9 + opus) is the only mime type all Chromium/Firefox
  //     versions agree on. MP4 requires server-side transcoding via
  //     /api/export/transcode (added separately).
  //   - Audio elements created BEFORE recording starts are routed via
  //     the bridge.routed weak-set; elements created mid-recording are
  //     routed by syncAudio() via routeForRecording().
  //   - createMediaElementSource throws if an element was already
  //     adopted into another AudioContext. We swallow that — affected
  //     elements simply won't be captured (acceptable for elements that
  //     finished playing before the export began).
  useImperativeHandle(forwardedRef, () => ({
    getCanvas: () => canvasRef.current,
    exportVideo: async (opts: ExportVideoOptions) => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("preview canvas not mounted yet");
      const segment = getActiveSegment(project);
      const fps = opts.fps ?? 30;

      // Build the Web Audio mix + recording bridge.
      const audioContext = new AudioContext();
      const dest = audioContext.createMediaStreamDestination();
      const bridge: RecordingBridge = { audioContext, destination: dest, routed: new WeakSet() };
      recordingBridgeRef.current = bridge;
      // Adopt any audio elements already playing into the bridge.
      for (const el of audioBagRef.current.values()) routeForRecording(el, bridge);

      const videoStream = canvas.captureStream(fps);
      const combined = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 4_500_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const blobPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      });

      // Reset playback + start recording + start playback.
      opts.setTime(0);
      opts.setPlaying(false);
      // Wait a frame so the canvas reflects the reset before capturing.
      await new Promise((r) => requestAnimationFrame(() => r(null)));

      recorder.start(250);
      opts.onStart?.();
      opts.setPlaying(true);

      // Tick a progress reporter against wall-clock instead of `time` state
      // (we don't have access to that without a getter; the playback effect
      // is what drives time forward).
      const startedAt = performance.now();
      const totalMs = (segment.duration + 0.4) * 1000;
      const progressTimer = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const progress = Math.min(elapsed / totalMs, 1);
        opts.onProgress?.(progress);
        if (elapsed >= totalMs) {
          window.clearInterval(progressTimer);
          recorder.stop();
          opts.setPlaying(false);
        }
      }, 200);

      const blob = await blobPromise;

      // Tear down the bridge.
      try { audioContext.close(); } catch { /* ignore */ }
      recordingBridgeRef.current = null;

      return blob;
    },
  }), [project]);

  return <canvas ref={canvasRef} className="preview-canvas" width={width} height={height} aria-label="黄瓜引擎短剧预览" />;
});

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

/**
 * Per-canvas memoized noise pattern for the post-FX grain overlay. Cheap
 * to compute (one ImageData, ~16 KB) but we only need it once per ctx.
 */
const postFxNoiseCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

function getPostFxNoise(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const cached = postFxNoiseCache.get(ctx);
  if (cached) return cached;
  const TILE = 128;
  const off = document.createElement("canvas");
  off.width = TILE; off.height = TILE;
  const octx = off.getContext("2d");
  if (!octx) return null;
  const img = octx.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    // Cheap xorshift-style hash. Same algorithm as engine.proceduralShape
    // but inlined here to avoid an import for a 3-line helper.
    let n = (i * 374761393 + 7919) | 0;
    n = (n ^ (n >>> 16)) * 0x45d9f3b | 0;
    n = (n ^ (n >>> 16)) * 0x45d9f3b | 0;
    n = (n ^ (n >>> 16)) >>> 0;
    const g = n % 256;
    img.data[i * 4 + 0] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  const pattern = ctx.createPattern(off, "repeat");
  if (pattern) postFxNoiseCache.set(ctx, pattern);
  return pattern;
}

interface PostFxConfig {
  enabled?: boolean;
  saturate?: number;
  contrast?: number;
  sepia?: number;
  brightness?: number;
  vignette?: number;
  noiseAlpha?: number;
}

const DEFAULT_POSTFX: Required<PostFxConfig> = {
  enabled:    true,
  saturate:   0.94,
  contrast:   1.06,
  sepia:      0.03,
  brightness: 1.00,
  vignette:   0.28,
  noiseAlpha: 0.07,
};

/**
 * Global post-processing: color grade + vignette + film grain. Applied
 * once per frame after the scene is drawn but before the HUD overlay
 * (so subtitles + timer stay crisp). All three stages are independently
 * disable-able via `project.config.postFX`.
 *
 * Why this matters: the single biggest tell that "this looks like Flash"
 * is uniformly-saturated flat colors. A 5 % desat + 6 % contrast bump +
 * tiny sepia tint + soft grain at α 0.07 collectively shift the read
 * from "vector" to "painterly cel" without measurably hurting perf.
 */
function paintPostFX(ctx: CanvasRenderingContext2D, project: Project) {
  const config = ((project.config as { postFX?: PostFxConfig }).postFX) ?? {};
  const cfg = { ...DEFAULT_POSTFX, ...config };
  if (cfg.enabled === false) return;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Stage 1 — color grade. We re-paint the existing canvas into itself
  // through a Canvas filter. cheaper than a per-pixel loop.
  const filterParts: string[] = [];
  if (cfg.saturate   !== 1) filterParts.push(`saturate(${cfg.saturate})`);
  if (cfg.contrast   !== 1) filterParts.push(`contrast(${cfg.contrast})`);
  if (cfg.brightness !== 1) filterParts.push(`brightness(${cfg.brightness})`);
  if (cfg.sepia      !== 0) filterParts.push(`sepia(${cfg.sepia})`);
  if (filterParts.length) {
    ctx.save();
    ctx.filter = filterParts.join(" ");
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.restore();
  }

  // Stage 2 — vignette. Radial gradient darkening edges.
  if (cfg.vignette > 0) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(0,0,0,${cfg.vignette})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Stage 3 — film grain.
  if (cfg.noiseAlpha > 0) {
    const pattern = getPostFxNoise(ctx);
    if (pattern) {
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = cfg.noiseAlpha;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
}

import type { SubtitleStyle } from "../engine/timeline";

function drawHud(
  ctx: CanvasRenderingContext2D,
  caption: string,
  time: number,
  mode: string,
  style: SubtitleStyle | null,
) {
  ctx.fillStyle = "rgba(20, 30, 32, 0.74)";
  roundedRect(ctx, 34, 30, 245, 46, 12);
  ctx.fillStyle = "#eef7f4";
  ctx.font = "22px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${time.toFixed(1)}s · ${mode}`, 55, 61);

  if (!caption) return;

  // Style defaults match the original lower-third look (bottom-center,
  // white-on-dark) so legacy subtitles render unchanged. Any field the
  // event sets in `style` overrides the corresponding default.
  const position = style?.position ?? "bottom";
  const align    = style?.align    ?? "center";
  const color    = style?.color    ?? "#fff8ed";
  const bgColor  = style?.bgColor  ?? "rgba(19, 25, 28, 0.78)";
  const fontSize = style?.fontSize ?? 28;
  const weight   = style?.weight   ?? "normal";

  // Measure to size the plate around the text.
  ctx.font = `${typeof weight === "number" ? weight : weight === "bold" ? "700" : "400"} ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(caption);
  const textWidth = metrics.width;
  const padX = 24;
  const padY = 14;
  const plateW = Math.min(width - 80, textWidth + padX * 2);
  const plateH = fontSize + padY * 2;

  // Vertical placement.
  let plateY: number;
  if (position === "top") plateY = 56;
  else if (position === "center") plateY = (height - plateH) / 2;
  else plateY = height - plateH - 36;

  // Horizontal placement keys off `align`.
  let plateX: number;
  let textX: number;
  if (align === "left") {
    plateX = 40;
    textX = plateX + padX;
  } else if (align === "right") {
    plateX = width - 40 - plateW;
    textX = plateX + plateW - padX;
  } else {
    plateX = (width - plateW) / 2;
    textX = width / 2;
  }

  ctx.fillStyle = bgColor;
  roundedRect(ctx, plateX, plateY, plateW, plateH, 16);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(caption, textX, plateY + plateH - padY - 4);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
