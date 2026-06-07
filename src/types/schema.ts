export type AssetCategory = "visual" | "audio";

export type AssetScope = "global" | "project";

/**
 * 2.5D character view angles. A character manifest may carry separate
 * `metadata.shapes[<angle>]` shape entries; the renderer picks the one
 * matching the current `CharacterRenderState.angle` (with fallback to
 * `front`, then to `metadata.shape`).
 *
 * `front` is the legacy single-shape default. `sideLeft` / `sideRight`
 * are profile views facing screen-left / screen-right respectively.
 * `back` is the away-from-camera view. `threeQuarterLeft` /
 * `threeQuarterRight` are optional 3/4 turn variants between front and
 * side; if not declared, the engine falls back to the closest side view.
 */
export type AngleKey =
  | "front"
  | "back"
  | "sideLeft"
  | "sideRight"
  | "threeQuarterLeft"
  | "threeQuarterRight";

export const ANGLE_KEYS: readonly AngleKey[] = [
  "front",
  "back",
  "sideLeft",
  "sideRight",
  "threeQuarterLeft",
  "threeQuarterRight",
];

/**
 * 7-viseme lip-sync set. Mirrors `server/services/tts/types.ts` — keep
 * the two in sync. The renderer drives `state.viseme` from `lipSync`
 * frames on `dialogue` / `narration` / `lipSync` timeline events.
 */
export type Viseme =
  | "rest"   // closed neutral
  | "open"   // wide "a"
  | "narrow" // tight "i" smile
  | "round"  // pursed "u/o"
  | "mid"    // half-open "e"
  | "wide"   // diphthong open + lateral
  | "ee";    // bright "ie/ye" smile

export const VISEMES: readonly Viseme[] = ["rest", "open", "narrow", "round", "mid", "wide", "ee"];

/**
 * Standard 12-expression set. Manifests are free to declare additional
 * names in `metadata.expressions`; this list is the **baseline** that
 * AI-generated characters should always cover so the segment generator
 * can request any of them by name without checking manifests first.
 */
export const STANDARD_EXPRESSIONS = [
  "neutral", "happy", "sad", "angry", "surprised",
  "soft", "scared", "smug", "embarrassed", "thinking",
  "crying", "laughing",
] as const;
export type StandardExpression = (typeof STANDARD_EXPRESSIONS)[number];

export interface VisemeFrame {
  time: number;
  viseme: Viseme;
  token?: string;
}

export type AssetType =
  | "character"
  | "scene"
  | "prop"
  | "expression"
  | "action"
  | "effect"
  | "foreground"
  | "background"
  | "cameraTemplate"
  | "sceneElement"
  | "bgm"
  | "dialogue"
  | "narration"
  | "soundEffect"
  | "environment";

export interface LicenseInfo {
  type: string;
  author: string;
  sourceUrl: string;
  commercialUse: boolean;
  needAttribution: boolean;
}

export interface AssetManifest {
  assetId: string;
  name: string;
  category: AssetCategory;
  type: AssetType;
  scope: AssetScope;
  source: {
    kind: "imported" | "generated" | "manual" | "referenced";
    format: string;
    originalFile: string;
  };
  files: Record<string, string>;
  tags: string[];
  metadata: Record<string, unknown>;
  license: LicenseInfo;
  overrides?: Record<string, unknown>;
}

export interface SceneObject {
  id: string;
  type: "obstacle" | "prop" | "interactive" | "movable";
  movable: boolean;
  assetId?: string;
  x?: number;
  y?: number;
}

export interface SceneDefinition {
  sceneId: string;
  name: string;
  background: string;
  foreground?: string;
  points: Record<string, { x: number; y: number }>;
  objects: SceneObject[];
  cameraPoints: Record<string, { x: number; y: number; zoom: number }>;
}

export interface Project {
  projectId: string;
  title: string;
  description: string;
  assetRefs: string[];
  chapters: Chapter[];
  config: {
    resolution: "1280x720" | "1920x1080";
    fps: number;
    /**
     * Opt-in stylistic acceptance bar. When set, the AI generators and
     * lint scripts apply the extra rules documented in
     * docs/acceptance-<bar>.md. Defaults to undefined (baseline 2.5D only).
     */
    styleBar?: "luoxiaohei" | "shinkai" | "ghibli" | "jiangnan-baiyi";
    /**
     * Post-processing grade applied to every frame by PreviewCanvas. All
     * fields optional — undefined falls back to the default tasteful
     * grade (slight desat, soft contrast bump, faint sepia + vignette +
     * film grain). Set `enabled: false` to render raw 2.5D output for
     * authoring/debug.
     */
    postFX?: {
      enabled?: boolean;
      saturate?: number;     // 1 = unchanged; 0.94 default
      contrast?: number;     // 1 = unchanged; 1.06 default
      brightness?: number;   // 1 = unchanged
      sepia?: number;        // 0 = none; 0.03 default
      vignette?: number;     // 0..1 — edge darkening; 0.28 default
      noiseAlpha?: number;   // 0..1 — film grain; 0.07 default
    };
  };
  preview: {
    activeChapterId: string;
    activeSegmentId: string;
  };
  export: {
    includeAssets: boolean;
    includeTimeline: boolean;
  };
  aiReserved: {
    assetGenerationEndpoint: string;
    timelineGenerationEndpoint: string;
    acceptedSchemas: string[];
  };
}

export interface Chapter {
  chapterId: string;
  title: string;
  sceneId: string;
  characters: string[];
  transition: {
    type: "none" | "cut" | "fadeIn" | "fadeOut" | "fadeToBlack" | "dissolve" | "titleCard";
    duration: number;
  };
  bgm?: string;
  segments: Segment[];
}

export interface BeatGrid {
  bpm: number;
  offsetSec: number;
  durationSec: number;
  beats: number[];
  downbeatEvery: number;
  downbeats: number[];
}

export interface Segment {
  segmentId: string;
  name: string;
  duration: number;
  timeline: TimelineEvent[];
  /**
   * Optional beat grid cached at design time. Populated by calling
   * `/api/audio/beats` and shown in the editor as vertical guide lines;
   * the AI segment generator consumes it to snap cameraChange /
   * effectPlay / characterAction events to the nearest beat. Not used by
   * the runtime renderer.
   */
  beatGrid?: BeatGrid;
}

export type TimelineEvent =
  | {
      time: number;
      type: "characterAppear";
      target: string;
      position: { x: number; y: number; z?: number; angle?: AngleKey };
      expression?: string;
      scale?: number;
    }
  | { time: number; type: "characterDisappear"; target: string }
  | {
      time: number;
      type: "characterMove";
      target: string;
      to: { x: number; y: number; z?: number; angle?: AngleKey };
      duration: number;
    }
  | {
      time: number;
      type: "characterAction";
      target: string;
      action: { name: string; params: Record<string, unknown> };
    }
  | {
      time: number;
      type: "expressionChange";
      target: string;
      expression: string;
      /**
       * Strength of the expression, 0–1. Default 1. The engine maps this
       * onto eyebrow lift / mouth corner pull / cheek warmth amplitudes.
       * Useful for "barely smiling" or "barely angry" reads.
       */
      intensity?: number;
    }
  | {
      time: number;
      type: "characterTurn";
      target: string;
      angle: AngleKey;
      duration?: number;
    }
  | {
      time: number;
      type: "headTurn";
      target: string;
      /**
       * Head yaw in radians. Positive = head turned to character's right
       * (screen-right when character faces front). Range roughly ±0.6.
       * Used for "look at the other speaker" beats without swapping the
       * full body view angle.
       */
      yaw: number;
      /** Head pitch in radians. Positive = looking up. Range roughly ±0.4. */
      pitch?: number;
      duration?: number;
    }
  | { time: number; type: "sceneChange"; sceneId: string }
  | {
      time: number;
      type: "propChange";
      propId: string;
      visible?: boolean;
      position?: { x: number; y: number };
    }
  | {
      time: number;
      type: "effectPlay";
      effectId: string;
      position: { x: number; y: number };
      duration: number;
    }
  | {
      time: number;
      type: "cameraChange";
      camera: {
        mode: "default" | "wide" | "medium" | "closeUp" | "follow";
        target?: string;
        x?: number;
        y?: number;
        zoom: number;
        duration: number;
        transition: "cut" | "smooth" | "fade";
        /**
         * Hand-held camera jitter, in pixels of peak displacement. The
         * renderer adds `sin(time * 7) * jitter` to camera.x and a smaller
         * orthogonal wobble to camera.y for the duration of this segment.
         * Default 0 (locked tripod).
         */
        jitter?: number;
      };
    }
  | {
      /**
       * Frame-hold: clamp the renderer's effective time to integer steps
       * of `fps` while `time ∈ [event.time, event.time + duration]`. Use
       * to mix "on twos / on threes" (12 fps / 8 fps) into otherwise
       * smooth 30 fps preview, giving the stylized stutter that real 2D
       * animation uses for impact / comedy beats.
       *
       *   fps: 6  → very chunky (anticipation hold)
       *   fps: 12 → standard cel-animation "on twos"
       *   fps: 24 → film cadence
       */
      time: number;
      type: "frameHold";
      fps: number;
      duration: number;
    }
  | { time: number; type: "subtitle"; text: string; duration: number }
  | { time: number; type: "bgmPlay"; assetId: string; volume: number }
  | {
      time: number;
      type: "dialogue";
      target: string;
      assetId?: string;
      text?: string;
      duration: number;
      /** TTS-generated audio URL (served from /api/tts/audio/...). */
      audioUrl?: string;
      /** TTS provider voice id ("longxiaochun" / etc.). */
      voice?: string;
      /** Emotion cue passed to the TTS provider. */
      emotion?: string;
      /** Per-frame viseme keyframes. The renderer maps these onto the speaker's mouth shape via state.viseme. */
      visemes?: VisemeFrame[];
    }
  | {
      time: number;
      type: "narration";
      assetId?: string;
      text?: string;
      duration: number;
      audioUrl?: string;
      voice?: string;
      emotion?: string;
    }
  | { time: number; type: "soundEffect"; assetId: string; volume: number }
  | {
      time: number;
      /**
       * Standalone lip-sync drive. Used when dialogue audio is registered
       * as a separate `dialogue` event but the lip-sync timing was
       * computed/edited independently (e.g. user re-recorded the line).
       * Overrides whatever visemes the matching dialogue event carries.
       */
      type: "lipSync";
      target: string;
      duration: number;
      visemes: VisemeFrame[];
    };

export interface AssetLibrary {
  globalAssets: AssetManifest[];
  projectAssets: AssetManifest[];
  scenes: SceneDefinition[];
}
