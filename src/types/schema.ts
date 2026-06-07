export type AssetCategory = "visual" | "audio";

export type AssetScope = "global" | "project";

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

export interface Segment {
  segmentId: string;
  name: string;
  duration: number;
  timeline: TimelineEvent[];
}

export type TimelineEvent =
  | {
      time: number;
      type: "characterAppear";
      target: string;
      position: { x: number; y: number; z?: number };
      expression?: string;
      scale?: number;
    }
  | { time: number; type: "characterDisappear"; target: string }
  | {
      time: number;
      type: "characterMove";
      target: string;
      to: { x: number; y: number; z?: number };
      duration: number;
    }
  | {
      time: number;
      type: "characterAction";
      target: string;
      action: { name: string; params: Record<string, unknown> };
    }
  | { time: number; type: "expressionChange"; target: string; expression: string }
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
      };
    }
  | { time: number; type: "subtitle"; text: string; duration: number }
  | { time: number; type: "bgmPlay"; assetId: string; volume: number }
  | { time: number; type: "dialogue"; target: string; assetId?: string; text?: string; duration: number }
  | { time: number; type: "narration"; assetId?: string; text?: string; duration: number }
  | { time: number; type: "soundEffect"; assetId: string; volume: number };

export interface AssetLibrary {
  globalAssets: AssetManifest[];
  projectAssets: AssetManifest[];
  scenes: SceneDefinition[];
}
