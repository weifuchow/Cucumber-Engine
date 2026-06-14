import type { AngleKey, AssetLibrary, Project, Segment, TimelineEvent, Viseme, VisemeFrame } from "../types/schema";
import { applyEase } from "./easing";

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
  /**
   * Optional rendering style for the active subtitle. Populated when the
   * active caption is a `subtitle` event with a `style` field; null
   * otherwise (dialogue/narration captions fall back to the default
   * bottom-center lower-third in PreviewCanvas).
   */
  captionStyle: SubtitleStyle | null;
}

export type SubtitleStyle = {
  position?: "bottom" | "top" | "center";
  align?: "left" | "center" | "right";
  color?: string;
  bgColor?: string;
  fontSize?: number;
  weight?: "normal" | "bold" | number;
};

const defaultCamera = { x: 640, y: 360, zoom: 1, mode: "wide" };

export function getActiveSegment(project: Project): Segment {
  const chapter = project.chapters.find((item) => item.chapterId === project.preview.activeChapterId) ?? project.chapters[0];
  return chapter.segments.find((item) => item.segmentId === project.preview.activeSegmentId) ?? chapter.segments[0];
}

export function evaluateTimeline(project: Project, library: AssetLibrary, time: number): PreviewState {
  const chapter = project.chapters.find((item) => item.chapterId === project.preview.activeChapterId) ?? project.chapters[0];
  const segment = getActiveSegment(project);
  // Apply frame-hold clamping FIRST so every state pulled below — characters,
  // camera, viseme, head pose — sees the snapped time. Without this, lip-sync
  // would still tick at 30 fps inside an "on twos" hold window.
  time = applyFrameHold(segment.timeline, time);
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
    const t = applyEase(last.ease, (time - last.time) / dur);
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
    const eased = applyEase(move.ease, progress);
    // Optional travel arc: a parabola peaking at mid-move so the path reads
    // as a hop/gesture lift instead of a dead-straight slide. 0 = straight.
    const arcLift = move.arc ? Math.sin(progress * Math.PI) * move.arc : 0;
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
      y: lerp(from.y, move.to.y, eased) - arcLift,
      z: lerp(from.z, targetZ, eased),
      angle: nextAngle,
    });
  }

  // ---- character turn staging --------------------------------------------
  //
  // A `characterTurn` with a `duration` now reads through an intermediate
  // 3/4 pose instead of teleporting between front and side. Discrete angle
  // views can't be lerped, but routing front→¾→side across the duration
  // sells the rotation. Runs after the move pass so an explicit turn wins.
  const charTurns = segment.timeline.filter(
    (e): e is Extract<TimelineEvent, { type: "characterTurn" }> => e.type === "characterTurn",
  );
  for (const [id, char] of characterMap) {
    const mine = charTurns.filter((e) => e.target === id && e.time <= time);
    const last = mine.at(-1);
    if (!last || !last.duration || last.duration <= 0) continue;
    if (time >= last.time + last.duration) continue; // settled — main loop already set the target
    const fromAngle: AngleKey =
      mine.length >= 2 ? mine[mine.length - 2].angle : getAppearAngle(segment.timeline, id);
    const progress = (time - last.time) / last.duration;
    characterMap.set(id, { ...char, angle: stagedTurnAngle(fromAngle, last.angle, progress) });
  }

  const characters = [...characterMap.values()].filter((character) => character.visible);
  // Camera resolves against base positions so the idle breath below doesn't
  // make a `follow` camera bob.
  const camera = evaluateCamera(segment.timeline, characters, time);
  const breathingCharacters = withIdleBreathing(characters, time);
  const { text: caption, style: captionStyle } = evaluateCaption(segment.timeline, time);
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
    characters: breathingCharacters,
    effects,
    camera,
    caption,
    captionStyle,
  };
}

/**
 * Layer a subtle, per-character idle breath onto the resolved poses: a slow
 * vertical bob + a fainter horizontal sway, desynced per character via a name
 * hash. This kills the "frozen mannequin" read with zero authoring — a static
 * standing character that never moves between keyframes is itself a Flash
 * tell. Amplitude drops while the character is mid-action so it never fights
 * a deliberate animation. Runs on the frame-held time, so it respects "on
 * twos" holds.
 */
function withIdleBreathing(
  characters: CharacterRenderState[],
  time: number,
): CharacterRenderState[] {
  return characters.map((c) => {
    const action = c.action ?? "idle";
    const calm = action === "idle" || action === "neutral" || action === "";
    const amp = calm ? 1 : 0.35;
    const phase = breathPhase(c.assetId);
    const bob = Math.sin(time * 1.6 + phase) * 1.6 * amp; // ~0.25 Hz, ≤1.6px
    const sway = Math.sin(time * 0.9 + phase * 1.7) * 0.45 * amp;
    return { ...c, x: c.x + sway, y: c.y + bob };
  });
}

/** Stable 0..2π phase from an asset id so two characters don't breathe in lockstep. */
function breathPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 360) / 360) * Math.PI * 2;
}

/** The angle a character first appeared at (fallback for a turn's "from"). */
function getAppearAngle(events: TimelineEvent[], target: string): AngleKey {
  for (const e of events) {
    if (e.type === "characterAppear" && e.target === target) return e.position.angle ?? "front";
  }
  return "front";
}

/**
 * Resolve the displayed angle partway through a staged turn. Routes through a
 * 3/4 view at the midpoint for the common front↔side / side↔side cases; for
 * transitions with no clean intermediate it falls back to a half-way snap.
 */
function stagedTurnAngle(from: AngleKey, to: AngleKey, progress: number): AngleKey {
  if (progress >= 1) return to;
  const mid = midTurnAngle(from, to);
  if (!mid) return progress < 0.5 ? from : to;
  if (progress < 0.34) return from;
  if (progress < 0.67) return mid;
  return to;
}

function midTurnAngle(from: AngleKey, to: AngleKey): AngleKey | null {
  const has = (a: AngleKey) => from === a || to === a;
  if (has("front") && has("sideRight")) return "threeQuarterRight";
  if (has("front") && has("sideLeft")) return "threeQuarterLeft";
  if (has("sideLeft") && has("sideRight")) return "front";
  return null;
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

function evaluateCaption(events: TimelineEvent[], time: number): { text: string; style: SubtitleStyle | null } {
  const captions = events.filter(
    (event): event is Extract<TimelineEvent, { type: "subtitle" | "dialogue" | "narration" }> =>
      (event.type === "subtitle" || event.type === "dialogue" || event.type === "narration") &&
      time >= event.time &&
      time <= event.time + event.duration,
  );
  const latest = captions.at(-1);
  if (!latest) return { text: "", style: null };
  if (latest.type === "dialogue") return { text: latest.text ?? "", style: null };
  if (latest.type === "narration") return { text: latest.text ?? "", style: null };
  return { text: latest.text, style: latest.style ?? null };
}

function evaluateCamera(events: TimelineEvent[], characters: CharacterRenderState[], time: number) {
  const cameraEvents = events.filter((event): event is Extract<TimelineEvent, { type: "cameraChange" }> => event.type === "cameraChange");
  let previous = defaultCamera;
  let jitterPx = 0;

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
      const progress = applyEase(event.camera.ease, (time - event.time) / event.camera.duration);
      // Hand-held jitter — picked up from whichever cameraChange is
      // currently "active". Lerped during transitions so jitter level
      // ramps in/out smoothly.
      const prevJitter = jitterPx;
      const nextJitter = event.camera.jitter ?? 0;
      const activeJitter = lerp(prevJitter, nextJitter, progress);
      return applyJitter(
        {
          x: lerp(previous.x, next.x, progress),
          y: lerp(previous.y, next.y, progress),
          zoom: lerp(previous.zoom, next.zoom, progress),
          mode: next.mode,
        },
        activeJitter,
        time,
      );
    }
    previous = next;
    jitterPx = event.camera.jitter ?? 0;
  }

  return applyJitter(previous, jitterPx, time);
}

/**
 * Layer a small hand-held wobble onto the resolved camera. Two coupled
 * sine waves (different frequency on x/y) read as "operator breath"
 * rather than periodic shake. jitterPx caps the peak displacement.
 */
function applyJitter(
  cam: { x: number; y: number; zoom: number; mode: string },
  jitterPx: number,
  time: number,
): { x: number; y: number; zoom: number; mode: string } {
  if (!jitterPx) return cam;
  return {
    ...cam,
    x: cam.x + Math.sin(time * 7.3) * jitterPx + Math.sin(time * 3.1) * jitterPx * 0.35,
    y: cam.y + Math.cos(time * 5.7) * jitterPx * 0.6 + Math.sin(time * 2.4) * jitterPx * 0.25,
  };
}

/**
 * Frame-hold clamp: if `time` falls inside a `frameHold` event window,
 * snap to the nearest 1/fps step. This produces the "on twos / on threes"
 * stutter without changing the actual playback rate. The animation loop
 * still ticks at 30 fps; the engine just renders the same frame N times.
 */
export function applyFrameHold(events: TimelineEvent[], time: number): number {
  for (const ev of events) {
    if (ev.type !== "frameHold") continue;
    if (time < ev.time) continue;
    if (time > ev.time + ev.duration) continue;
    const step = 1 / Math.max(ev.fps, 1);
    const local = time - ev.time;
    const clamped = Math.floor(local / step) * step;
    return ev.time + clamped;
  }
  return time;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
