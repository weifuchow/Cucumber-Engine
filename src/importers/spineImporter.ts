// Spine JSON → Cucumber Engine AssetManifest converter.
//
// Spine is the industry-standard 2D skeletal animation format. A .json
// export carries bones (hierarchy of transforms), slots (draw order +
// per-slot color), skins (the actual attachments — region rects /
// meshes / paths), and animations (timelines of per-bone keyframes).
//
// We don't aim for animation parity — Spine's bone-skinning / mesh-deform
// is far richer than our procedural-shape DSL. Instead we map the
// authoring intent:
//
//   - default skin → procedural shape primitives (rect / polygon / circle)
//     positioned at each bone's world rest transform
//   - each animation name → an entry in metadata.actions (so the timeline
//     editor and AssetPreviewStage show them as switchable poses)
//   - skin/slot colors → palette entries
//
// What we deliberately drop: per-frame keyframe interpolation, mesh
// vertex deformation, IK constraints, path constraints, physics. Those
// would need a full Spine runtime port — out of scope for an MVP importer.
//
// Spec reference (Spine 4.x JSON): http://esotericsoftware.com/spine-json-format

import type { ConditionalPrimitive, Primitive, ProceduralShape } from "../engine/proceduralShape";
import type { SpineAnimation, SpineAnimationMap, SpineBoneKeyframes, SpineColorKey, SpineRotateKey, SpineSlotKeyframes, SpineVecKey } from "../engine/spineKeyframes";
import { sanitize as sanitizeBoneName } from "../engine/spineKeyframes";
import type { AssetManifest, AssetScope } from "../types/schema";
import { createDefaultLicense, safeId } from "./importers";

interface SpineBone {
  name: string;
  parent?: string;
  length?: number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

interface SpineSlot {
  name: string;
  bone: string;
  color?: string;                // 8-char rgba hex like "ffaabbff"
  attachment?: string;
}

interface SpineRegionAttachment {
  type?: "region";
  x?: number;
  y?: number;
  width: number;
  height: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  color?: string;
}

interface SpineMeshAttachment {
  type: "mesh";
  vertices?: number[];           // flat [x0, y0, x1, y1, …]
  width?: number;
  height?: number;
  color?: string;
}

type SpineAttachment = SpineRegionAttachment | SpineMeshAttachment;

interface SpineSkin {
  name: string;
  attachments: Record<string, Record<string, SpineAttachment>>;
}

interface SpineJson {
  skeleton?: { name?: string; width?: number; height?: number };
  bones?: SpineBone[];
  slots?: SpineSlot[];
  skins?: SpineSkin[] | Record<string, Record<string, Record<string, SpineAttachment>>>;
  animations?: Record<string, SpineAnimationData>;
}

interface SpineAnimationData {
  bones?: Record<string, {
    rotate?: Array<{ time?: number; angle?: number; curve?: unknown }>;
    translate?: Array<{ time?: number; x?: number; y?: number; curve?: unknown }>;
    scale?: Array<{ time?: number; x?: number; y?: number; curve?: unknown }>;
  }>;
  slots?: Record<string, {
    color?: Array<{ time?: number; color?: string; curve?: unknown }>;
  }>;
  // Still ignored: deform timelines, IK constraints, physics constraints.
}

interface BoneTransform {
  worldX: number;
  worldY: number;
  worldRotation: number;
  scaleX: number;
  scaleY: number;
}

export async function importSpineJsonFile(file: File, scope: AssetScope): Promise<AssetManifest> {
  const text = await file.text();
  const json = JSON.parse(text) as SpineJson;
  return spineJsonToManifest(json, file.name, scope);
}

export function spineJsonToManifest(
  json: SpineJson,
  originalFile: string,
  scope: AssetScope,
): AssetManifest {
  const name = json.skeleton?.name ?? originalFile.replace(/\.[^/.]+$/, "");
  const width = json.skeleton?.width ?? 260;
  const height = json.skeleton?.height ?? 520;

  // 1. Resolve world rest transforms for every bone.
  const boneMap = new Map<string, SpineBone>();
  for (const b of json.bones ?? []) boneMap.set(b.name, b);
  const worldTransforms = new Map<string, BoneTransform>();
  function resolve(name: string): BoneTransform {
    const cached = worldTransforms.get(name);
    if (cached) return cached;
    const bone = boneMap.get(name);
    if (!bone) {
      const id: BoneTransform = { worldX: 0, worldY: 0, worldRotation: 0, scaleX: 1, scaleY: 1 };
      worldTransforms.set(name, id);
      return id;
    }
    const parent = bone.parent ? resolve(bone.parent) : { worldX: 0, worldY: 0, worldRotation: 0, scaleX: 1, scaleY: 1 };
    const rad = (parent.worldRotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = (bone.x ?? 0) * parent.scaleX;
    const ly = (bone.y ?? 0) * parent.scaleY;
    const wt: BoneTransform = {
      worldX: parent.worldX + cos * lx - sin * ly,
      worldY: parent.worldY + sin * lx + cos * ly,
      worldRotation: parent.worldRotation + (bone.rotation ?? 0),
      scaleX: parent.scaleX * (bone.scaleX ?? 1),
      scaleY: parent.scaleY * (bone.scaleY ?? 1),
    };
    worldTransforms.set(name, wt);
    return wt;
  }
  for (const b of json.bones ?? []) resolve(b.name);

  // 2. Walk the default skin in draw order (slot order).
  const skinMap = normalizeSkins(json.skins);
  const defaultSkin = skinMap.get("default") ?? skinMap.values().next().value ?? {};

  const palette: Record<string, string> = {};
  const primitives: ConditionalPrimitive[] = [];

  // Spine's Y is up-positive; ours is up-negative. Flip once when projecting.
  const flipY = (y: number) => -y;

  for (const slot of json.slots ?? []) {
    const attachmentMap = defaultSkin[slot.name];
    if (!attachmentMap) continue;
    const attachmentName = slot.attachment;
    const attachment = attachmentName ? attachmentMap[attachmentName] : Object.values(attachmentMap)[0];
    if (!attachment) continue;

    const bone = worldTransforms.get(slot.bone) ?? { worldX: 0, worldY: 0, worldRotation: 0, scaleX: 1, scaleY: 1 };
    const tint = parseSpineColor(slot.color ?? attachment.color);
    // Naming matches `evaluateSpineBones`'s slot color output key
    // (`slot_<sanitized_name>_color`) so a running animation can override
    // the rest-pose tint with no extra plumbing.
    const paletteKey = `slot_${sanitizeBoneName(slot.name)}_color`;
    palette[paletteKey] = tint;

    if (isRegion(attachment)) {
      const w = attachment.width * (attachment.scaleX ?? 1);
      const h = attachment.height * (attachment.scaleY ?? 1);
      const ax = (attachment.x ?? 0);
      const ay = (attachment.y ?? 0);
      const restRotationDeg = bone.worldRotation + (attachment.rotation ?? 0);
      const safe = sanitizeBoneName(slot.bone);
      // Outer transform: bone rest pose + animation-driven translate (Y
      // is flipped at import — we pre-flip the rest position and reverse
      // the per-frame `bone_<name>_y` by negating it in the expression).
      // Inner transform: attachment offset.
      primitives.push({
        kind: "transform",
        translate: {
          x: `${bone.worldX} + bone_${safe}_x`,
          y: `${flipY(bone.worldY)} - bone_${safe}_y`,
        },
        rotate: `(${restRotationDeg} + bone_${safe}_rotate) * (PI / 180)`,
        children: [{
          kind: "transform",
          translate: { x: ax, y: flipY(ay) - flipY(0) },
          children: [
            { kind: "roundedRect", x: -w / 2, y: -h / 2, w, h, r: Math.min(w, h) * 0.12, fill: { palette: paletteKey }, stroke: "rgba(0,0,0,0.55)", lineWidth: 1.4 },
            { kind: "roundedRect", x: -w / 2, y: -h / 2, w, h, r: Math.min(w, h) * 0.12,
              fill: { gradient: "linear", x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, stops: [
                { at: 0, color: "rgba(255,255,255,0.18)" },
                { at: 1, color: "rgba(0,0,0,0.3)" },
              ] } },
          ],
        }],
      });
    } else if (isMesh(attachment) && Array.isArray(attachment.vertices) && attachment.vertices.length >= 6) {
      // Build a flat polygon from the vertex pairs (drop bone weights — we
      // just use rest positions).
      const points: Array<{ x: number; y: number }> = [];
      const verts = attachment.vertices;
      for (let i = 0; i < verts.length; i += 2) {
        const vx = verts[i];
        const vy = verts[i + 1];
        if (typeof vx !== "number" || typeof vy !== "number") break;
        points.push({ x: bone.worldX + vx, y: flipY(bone.worldY + vy) });
      }
      if (points.length >= 3) {
        primitives.push({ kind: "polygon", points, fill: { palette: paletteKey }, stroke: "rgba(0,0,0,0.55)", lineWidth: 1.4 });
      }
    }
  }

  // 3. Add a z-aware contact shadow so the lint passes.
  primitives.unshift({
    kind: "ellipse",
    cx: 0,
    cy: height * 0.02,
    rx: `${Math.max(width * 0.35, 60)} * (1 - clamp(z * 0.0008, 0, 0.35))`,
    ry: `${Math.max(width * 0.1, 18)} * (1 - clamp(z * 0.0008, 0, 0.35))`,
    fill: {
      gradient: "radial",
      x0: 0, y0: height * 0.02, r0: 0,
      x1: 0, y1: height * 0.02, r1: width * 0.5,
      stops: [
        { at: 0, color: "rgba(20, 18, 16, ${0.32 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
        { at: 1, color: "rgba(20, 18, 16, 0)" },
      ],
    },
  });

  // 4. Animation names → actions list. Always include `idle` first.
  //    Spine animation names map directly onto our `action` state. The
  //    runtime evaluator (`evaluateSpineBones`) reads the structured
  //    keyframes below to drive each transform's translate / rotate per
  //    frame.
  const animations = json.animations ?? {};
  const animationNames = Object.keys(animations);
  const actions = uniq(["idle", ...animationNames.map(slugify)]);

  const spineAnimations: SpineAnimationMap = {};
  for (const animName of animationNames) {
    const safeName = slugify(animName);
    const anim = animations[animName];
    const bones = anim?.bones ?? {};
    const boneEntries: Record<string, SpineBoneKeyframes> = {};
    for (const [boneName, kf] of Object.entries(bones)) {
      const safeBone = sanitizeBoneName(boneName);
      const entry: SpineBoneKeyframes = {};
      if (Array.isArray(kf.rotate) && kf.rotate.length) {
        entry.rotate = kf.rotate
          .filter((k) => typeof k?.time === "number")
          .map<SpineRotateKey>((k) => ({
            time: k.time ?? 0,
            angle: k.angle ?? 0,
            curve: normalizeCurve(k.curve),
          }));
      }
      if (Array.isArray(kf.translate) && kf.translate.length) {
        entry.translate = kf.translate
          .filter((k) => typeof k?.time === "number")
          .map<SpineVecKey>((k) => ({
            time: k.time ?? 0,
            x: k.x ?? 0,
            y: k.y ?? 0,
            curve: normalizeCurve(k.curve),
          }));
      }
      if (Array.isArray(kf.scale) && kf.scale.length) {
        entry.scale = kf.scale
          .filter((k) => typeof k?.time === "number")
          .map<SpineVecKey>((k) => ({
            time: k.time ?? 0,
            x: k.x ?? 1,
            y: k.y ?? 1,
            curve: normalizeCurve(k.curve),
          }));
      }
      if (entry.rotate || entry.translate || entry.scale) boneEntries[safeBone] = entry;
    }

    const slotEntries: Record<string, SpineSlotKeyframes> = {};
    for (const [slotName, slotKf] of Object.entries(anim?.slots ?? {})) {
      const safeSlot = sanitizeBoneName(slotName);
      const entry: SpineSlotKeyframes = {};
      if (Array.isArray(slotKf.color) && slotKf.color.length) {
        entry.color = slotKf.color
          .filter((k) => typeof k?.time === "number" && typeof k.color === "string")
          .map<SpineColorKey>((k) => ({
            time: k.time ?? 0,
            color: String(k.color ?? "ffffffff"),
            curve: normalizeCurve(k.curve),
          }));
      }
      if (entry.color) slotEntries[safeSlot] = entry;
    }

    const animEntry: SpineAnimation = { bones: boneEntries };
    if (Object.keys(slotEntries).length) animEntry.slots = slotEntries;
    spineAnimations[safeName] = animEntry;
  }

  // 5. Wrap each animation-named action in a soft "stand still in that pose"
  //    branch on the existing primitives. Without per-frame keyframes we
  //    can't reproduce the actual motion — but `when: "action == xxx"`
  //    lets the timeline still drive a swap by name, and the primitives
  //    fall back to the rest pose. This keeps the shape future-proof:
  //    later the user can fill in the keyframe-driven `transform.rotate`
  //    expressions by hand.

  const shape: ProceduralShape = { primitives };

  return {
    assetId: safeId("character", name),
    name,
    category: "visual",
    type: "character",
    scope,
    source: { kind: "imported", format: "spine-json", originalFile },
    files: { preview: `procedural://${slugify(name)}`, sourceFile: originalFile },
    tags: ["spine", "imported"],
    metadata: {
      width,
      height,
      anchor: { x: Math.round(width / 2), y: height },
      palette,
      displayName: name,
      actions,
      expressions: ["neutral"],
      shape,
      spineAnimations,
      references: [{ sourceType: "open-format", source: originalFile, note: `Spine JSON skeleton import — ${animationNames.length} animation(s) with keyframe data: ${animationNames.join(", ") || "none"}` }],
    },
    license: createDefaultLicense(),
  };
}

function normalizeSkins(skins: SpineJson["skins"]): Map<string, Record<string, Record<string, SpineAttachment>>> {
  const out = new Map<string, Record<string, Record<string, SpineAttachment>>>();
  if (!skins) return out;
  if (Array.isArray(skins)) {
    for (const s of skins) out.set(s.name, s.attachments);
  } else {
    // Spine 3.x: skins is an object keyed by skin name
    for (const [name, attachments] of Object.entries(skins)) {
      out.set(name, attachments as Record<string, Record<string, SpineAttachment>>);
    }
  }
  return out;
}

function isRegion(a: SpineAttachment): a is SpineRegionAttachment {
  return !a.type || a.type === "region";
}

function isMesh(a: SpineAttachment): a is SpineMeshAttachment {
  return (a as SpineMeshAttachment).type === "mesh";
}

function parseSpineColor(raw?: string): string {
  if (!raw) return "#a8a8a8";
  const hex = raw.replace(/^#/, "");
  if (hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  if (hex.length === 6) return `#${hex}`;
  return "#a8a8a8";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Normalize Spine's loose curve declaration into our SpineCurve union.
 * Strings stay as-is when known; 4-tuple arrays pass through unchanged;
 * everything else collapses to "linear".
 */
function normalizeCurve(raw: unknown): import("../engine/spineKeyframes").SpineCurve {
  if (raw === "stepped") return "stepped";
  if (Array.isArray(raw) && raw.length >= 4 && raw.slice(0, 4).every((v) => typeof v === "number")) {
    return raw.slice(0, 4) as number[];
  }
  return "linear";
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// Re-export Primitive type so consumers don't double-import.
export type { Primitive };
