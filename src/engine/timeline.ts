import type { AngleKey, AssetLibrary, Project, Segment, TimelineEvent, Viseme, VisemeFrame } from "../types/schema";

export interface CharacterRenderState {
  assetId: string;
  visible: boolean;
  x: number;
  y: number;
  z: number;
  scale: number;
  expression: string;
  /** 0–1 expression strength. 1 = full read, 0.4 = barely-on. */
  expressionIntensity: number;
  action?: string;
  /**
   * Which view of the character to draw. `characterTurn` events set this
   * explicitly; `characterMove` events infer it from horizontal direction
   * unless they carry an explicit `to.angle`. Defaults to `front`.
   */
  angle: AngleKey;
  /** Active viseme — drives the mouth shape. Updated from lipSync frames. */
  viseme: Viseme;
  /** Head yaw in radians from `headTurn` events. ±0.6 typical. */
  headYaw: number;
  /** Head pitch in radians from `headTurn` events. ±0.4 typical. */
  headPitch: number;
}

/** Pick the side that matches the sign of a horizontal displacement. */
function angleFromDx(dx: number): AngleKey | null {
  if (Math.abs(dx) < 4) return null;
  return dx > 0 ? "sideRight" : "sideLeft";
}

export interface EffectRenderState {
  effectId: string;
  x: number;
  y: number;
  progress: number;
}

export interface PreviewState {
  sceneId: string;
  characters: CharacterRenderState[];
  effects: EffectRenderState[];
  camera: { x: number; y: number; zoom: number; mode: string };
  caption: string;
}

const defaultCamera = { x: 640, y: 360, zoom: 1, mode: "wide" };

export function getActiveSegment(project: Project): Segment {
  const chapter = project.chapters.find((item) => item.chapterId === project.preview.activeChapterId) ?? project.chapters[0];
  return chapter.segments.find((item) => item.segmentId === project.preview.activeSegmentId) ?? chapter.segments[0];
}

export function evaluateTimeline(project: Project, library: AssetLibrary, time: number): PreviewState {
  const chapter = project.chapters.find((item) => item.chapterId === project.preview.activeChapterId) ?? project.chapters[0];
  const segment = getActiveSegment(project);
  const sceneId = getLatestSceneId(segment.timeline, time, chapter.sceneId);
  const characterMap = new Map<string, CharacterRenderState>();

  for (const event of segment.timeline.filter((item) => item.time <= time).sort((a, b) => a.time - b.time)) {
    if (event.type === "characterAppear") {
      characterMap.set(event.target, {
        assetId: event.target,
        visible: true,
        x: event.position.x,
        y: event.position.y,
        z: event.position.z ?? 0,
        scale: event.scale ?? 1,
        expression: event.expression ?? "neutral",
        expressionIntensity: 1,
        angle: event.position.angle ?? "front",
        viseme: "rest",
        headYaw: 0,
        headPitch: 0,
      });
    }

    if (event.type === "characterDisappear") {
      const current = characterMap.get(event.target);
      if (current) characterMap.set(event.target, { ...current, visible: false });
    }

    if (event.type === "expressionChange") {
      const current = characterMap.get(event.target);
      if (current) {
        const intensity = typeof event.intensity === "number"
          ? clamp(event.intensity, 0, 1)
          : 1;
        characterMap.set(event.target, { ...current, expression: event.expression, expressionIntensity: intensity });
      }
    }

    if (event.type === "characterAction") {
      const current = characterMap.get(event.target);
      if (current) characterMap.set(event.target, { ...current, action: event.action.name });
    }

    if (event.type === "characterTurn") {
      // Turn is instantaneous at `event.time`. The optional `duration` is
      // recorded for future interpolation hooks but the renderer always
      // snaps to the target angle once the event fires.
      const current = characterMap.get(event.target);
      if (current) characterMap.set(event.target, { ...current, angle: event.angle });
    }

    if (event.type === "headTurn") {
      // The instantaneous snap is then refined in the interpolation pass
      // below — that pass picks up the latest two headTurn events around
      // `time` and lerps between them so the head reads as smoothly
      // turning instead of teleporting.
      const current = characterMap.get(event.target);
      if (current) {
        characterMap.set(event.target, {
          ...current,
          headYaw: event.yaw,
          headPitch: event.pitch ?? current.headPitch,
        });
      }
    }
  }

  // ---- head pose interpolation -------------------------------------------
  //
  // For each character, find the most recent headTurn event whose `time`
  // is ≤ current `time`. If it has a `duration`, ease toward the target
  // yaw/pitch from the *prior* head state (the rest pose at the start of
  // the segment, or the previous headTurn's target).
  const headTurns = segment.timeline.filter(
    (e): e is Extract<TimelineEvent, { type: "headTurn" }> => e.type === "headTurn",
  );
  for (const [id, char] of characterMap) {
    const myTurns = headTurns.filter((e) => e.target === id && e.time <= time);
    const last = myTurns.at(-1);
    if (!last) continue;
    const dur = last.duration ?? 0;
    if (dur <= 0 || time >= last.time + dur) {
      characterMap.set(id, { ...char, headYaw: last.yaw, headPitch: last.pitch ?? char.headPitch });
      continue;
    }
    // Lerp from the previous head state.
    const prev = myTurns.length >= 2 ? myTurns[myTurns.length - 2] : null;
    const fromYaw = prev?.yaw ?? 0;
    const fromPitch = prev?.pitch ?? 0;
    const t = easeInOut((time - last.time) / dur);
    characterMap.set(id, {
      ...char,
      headYaw: lerp(fromYaw, last.yaw, t),
      headPitch: lerp(fromPitch, last.pitch ?? 0, t),
    });
  }

  // ---- viseme resolution -------------------------------------------------
  //
  // Default everyone to a closed mouth, then walk dialogue / lipSync events
  // that cover `time` and snap each character's viseme to the active frame.
  for (const [id, char] of characterMap) {
    characterMap.set(id, { ...char, viseme: "rest" });
  }

  const lipSyncSources = segment.timeline.filter(
    (e): e is Extract<TimelineEvent, { type: "dialogue" | "lipSync" }> =>
      (e.type === "dialogue" || e.type === "lipSync") && time >= e.time && time <= e.time + e.duration,
  );
  for (const ev of lipSyncSources) {
    const targetId = ev.type === "dialogue" ? ev.target : ev.target;
    const current = characterMap.get(targetId);
    if (!current) continue;
    const frames: VisemeFrame[] | undefined = ev.visemes;
    if (!Array.isArray(frames) || !frames.length) continue;
    const localT = time - ev.time;
    let active: Viseme = "rest";
    for (const f of frames) {
      if (f.time <= localT) active = f.viseme;
      else break;
    }
    characterMap.set(targetId, { ...current, viseme: active });
  }

  for (const move of segment.timeline.filter((event): event is Extract<TimelineEvent, { type: "characterMove" }> => event.type === "characterMove")) {
    const current = characterMap.get(move.target);
    if (!current || time < move.time) continue;

    const from = getPositionBeforeMove(segment.timeline, move.target, move.time);
    const progress = clamp((time - move.time) / Math.max(move.duration, 0.001), 0, 1);
    const eased = easeInOut(progress);
    const targetZ = move.to.z ?? current.z;
    // Angle resolution priority:
    //   1. explicit move.to.angle
    //   2. auto-infer from horizontal displacement (sideLeft / sideRight)
    //   3. keep current
    // The inferred angle locks at move start so the character doesn't
    // flip back to front the instant they stop moving.
    const explicitAngle = move.to.angle;
    const inferredAngle = explicitAngle ? null : angleFromDx(move.to.x - from.x);
    const nextAngle: AngleKey = explicitAngle ?? inferredAngle ?? current.angle;
    characterMap.set(move.target, {
      ...current,
      x: lerp(from.x, move.to.x, eased),
      y: lerp(from.y, move.to.y, eased),
      z: lerp(from.z, targetZ, eased),
      angle: nextAngle,
    });
  }

  const characters = [...characterMap.values()].filter((character) => character.visible);
  const camera = evaluateCamera(segment.timeline, characters, time);
  const caption = evaluateCaption(segment.timeline, time);
  const effects = segment.timeline
    .filter((event): event is Extract<TimelineEvent, { type: "effectPlay" }> => event.type === "effectPlay")
    .filter((event) => time >= event.time && time <= event.time + event.duration)
    .map((event) => ({
      effectId: event.effectId,
      x: event.position.x,
      y: event.position.y,
      progress: clamp((time - event.time) / event.duration, 0, 1),
    }));

  return {
    sceneId,
    characters,
    effects,
    camera,
    caption,
  };
}

export function getAssetName(library: AssetLibrary, assetId: string) {
  return [...library.globalAssets, ...library.projectAssets].find((asset) => asset.assetId === assetId)?.name ?? assetId;
}

function getLatestSceneId(events: TimelineEvent[], time: number, fallback: string) {
  const sceneChange = events
    .filter((event): event is Extract<TimelineEvent, { type: "sceneChange" }> => event.type === "sceneChange" && event.time <= time)
    .at(-1);
  return sceneChange?.sceneId ?? fallback;
}

function evaluateCaption(events: TimelineEvent[], time: number) {
  const captions = events.filter(
    (event): event is Extract<TimelineEvent, { type: "subtitle" | "dialogue" | "narration" }> =>
      (event.type === "subtitle" || event.type === "dialogue" || event.type === "narration") &&
      time >= event.time &&
      time <= event.time + event.duration,
  );
  const latest = captions.at(-1);
  if (!latest) return "";
  if (latest.type === "dialogue") return latest.text ?? "";
  if (latest.type === "narration") return latest.text ?? "";
  return latest.text;
}

function evaluateCamera(events: TimelineEvent[], characters: CharacterRenderState[], time: number) {
  const cameraEvents = events.filter((event): event is Extract<TimelineEvent, { type: "cameraChange" }> => event.type === "cameraChange");
  let previous = defaultCamera;

  for (const event of cameraEvents) {
    const target = event.camera.target ? characters.find((character) => character.assetId === event.camera.target) : undefined;
    const next = {
      x: target?.x ?? event.camera.x ?? previous.x,
      y: target ? target.y - 140 : event.camera.y ?? previous.y,
      zoom: event.camera.zoom,
      mode: event.camera.mode,
    };

    if (time < event.time) break;
    if (event.camera.transition !== "cut" && event.camera.duration > 0 && time < event.time + event.camera.duration) {
      const progress = easeInOut((time - event.time) / event.camera.duration);
      return {
        x: lerp(previous.x, next.x, progress),
        y: lerp(previous.y, next.y, progress),
        zoom: lerp(previous.zoom, next.zoom, progress),
        mode: next.mode,
      };
    }
    previous = next;
  }

  return previous;
}

function getPositionBeforeMove(events: TimelineEvent[], target: string, time: number) {
  let position: { x: number; y: number; z: number } = { x: 640, y: 540, z: 0 };
  for (const event of events.filter((item) => item.time < time).sort((a, b) => a.time - b.time)) {
    if (event.type === "characterAppear" && event.target === target) {
      position = { x: event.position.x, y: event.position.y, z: event.position.z ?? 0 };
    }
    if (event.type === "characterMove" && event.target === target && event.time + event.duration <= time) {
      position = { x: event.to.x, y: event.to.y, z: event.to.z ?? position.z };
    }
  }
  return position;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function easeInOut(progress: number) {
  const t = clamp(progress, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
