import type { AngleKey, AssetManifest, Viseme } from "../types/schema";
import { drawShape, isProceduralShape, type ConditionalPrimitive, type ProceduralShape } from "./proceduralShape";
import { evaluateSpineBones, type SpineAnimationMap } from "./spineKeyframes";

/**
 * Per-limb occlusion layer. A character's primitives are partitioned into
 * three groups: things that draw BEHIND another character's torso when
 * they overlap (back arm, back leg), things that draw at the same level
 * (torso, head silhouette), and things that draw IN FRONT (front arm
 * reaching toward camera).
 *
 * The render loop walks all characters three times, once per layer, so
 * char A's "front" arm can appear over char B's "main" torso even though
 * both characters have similar z.
 *
 * Unlabeled primitives default to "main".
 */
export type BodyPartLayer = "behind" | "main" | "front";

/**
 * `metadata.bodyPartLayers` shape: maps top-level primitive index → layer.
 * Primitive indices refer to the layer-specific shape (e.g. shapes.front.primitives[i]).
 *
 * Stored as `Partial<Record<BodyPartLayer, number[]>>` rather than an
 * index→layer map because authoring is easier: the AI just lists which
 * primitives go behind / in front, omits anything that's "main".
 */
export interface BodyPartLayerMap {
  behind?: number[];
  main?: number[];
  front?: number[];
}

export function getBodyPartLayers(asset: AssetManifest | undefined): BodyPartLayerMap | undefined {
  const m = asset?.metadata as { bodyPartLayers?: BodyPartLayerMap } | undefined;
  return m?.bodyPartLayers;
}

/**
 * Given a shape and a per-asset layer map, return the subset of top-level
 * primitives that belong to `layer`. Index references in the layer map
 * are matched against the shape's `primitives` array; out-of-range
 * indices are silently dropped. When no map is present:
 *   - `main` returns every primitive (the legacy single-pass behavior)
 *   - `behind` / `front` return [] (no occlusion split)
 */
export function filterByLayer(
  shape: ProceduralShape,
  layerMap: BodyPartLayerMap | undefined,
  layer: BodyPartLayer,
): ConditionalPrimitive[] {
  if (!layerMap) return layer === "main" ? shape.primitives : [];
  const ix = layerMap[layer] ?? [];
  if (!ix.length && layer === "main") {
    // Default behavior: anything not explicitly placed in behind/front IS main.
    const claimed = new Set([...(layerMap.behind ?? []), ...(layerMap.front ?? [])]);
    return shape.primitives.filter((_, i) => !claimed.has(i));
  }
  return ix.map((i) => shape.primitives[i]).filter(Boolean);
}

export interface DrawCharacterOptions {
  x: number;
  y: number;
  scale: number;
  expression: string;
  /** 0–1 expression strength. Mouth-corner / brow-lift amplitudes scale by this. */
  expressionIntensity?: number;
  action?: string;
  time?: number;
  name?: string;
  /** Pseudo-depth used by contact shadow + lighting expressions in the shape. */
  z?: number;
  /** 2.5D view angle (front / back / side / threeQuarter). Defaults to front. */
  angle?: AngleKey;
  /** Mouth shape — driven by lip-sync visemes. */
  viseme?: Viseme;
  /** Head yaw / pitch in radians. Default 0. */
  headYaw?: number;
  headPitch?: number;
  /**
   * When set, only draw the named per-limb layer. The multi-pass renderer
   * in PreviewCanvas uses this to interleave one character's front arm in
   * front of another character's torso. Default = draw the entire shape.
   */
  bodyPartLayer?: BodyPartLayer;
}

/**
 * Resolve which procedural shape to render for a character at a given angle.
 *
 * Lookup order:
 *   1. `metadata.shapes[angle]` — explicit per-angle shape
 *   2. for `threeQuarter*` → fall back to the matching `side*`
 *   3. `metadata.shapes.front` — default canonical view
 *   4. `metadata.shape` — legacy single-shape (treated as front)
 *
 * Returns the shape and the angle that was actually resolved, so callers can
 * push the *effective* angle into the shape state (matters when the manifest
 * doesn't ship a back view but the timeline requested one — the shape's
 * internal `when: "angle == ..."` branches still get the real request).
 */
export function pickCharacterShape(
  asset: AssetManifest | undefined,
  angle: AngleKey,
): { shape: ProceduralShape | null; resolvedAngle: AngleKey } {
  const metadata = asset?.metadata;
  if (!metadata) return { shape: null, resolvedAngle: angle };

  const shapes = (metadata as { shapes?: Partial<Record<AngleKey, ProceduralShape>> }).shapes;
  const direct = shapes?.[angle];
  if (direct && isProceduralShape(direct)) return { shape: direct, resolvedAngle: angle };

  if (angle === "threeQuarterLeft" && shapes?.sideLeft && isProceduralShape(shapes.sideLeft)) {
    return { shape: shapes.sideLeft, resolvedAngle: "sideLeft" };
  }
  if (angle === "threeQuarterRight" && shapes?.sideRight && isProceduralShape(shapes.sideRight)) {
    return { shape: shapes.sideRight, resolvedAngle: "sideRight" };
  }

  if (shapes?.front && isProceduralShape(shapes.front)) {
    return { shape: shapes.front, resolvedAngle: "front" };
  }

  const legacy = (metadata as { shape?: unknown }).shape;
  if (isProceduralShape(legacy)) return { shape: legacy, resolvedAngle: "front" };

  return { shape: null, resolvedAngle: angle };
}

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  asset: AssetManifest | undefined,
  options: DrawCharacterOptions,
) {
  const palette = (asset?.metadata.palette ?? {}) as Record<string, string>;
  const displayName = (asset?.metadata.displayName as string | undefined) ?? options.name ?? asset?.name ?? "";
  const requestedAngle = options.angle ?? "front";
  const { shape, resolvedAngle } = pickCharacterShape(asset, requestedAngle);

  ctx.save();
  ctx.translate(options.x, options.y);
  ctx.scale(options.scale, options.scale);

  if (shape) {
    const viseme = options.viseme ?? "rest";
    const mouth = viseme !== "rest" ? viseme : options.expression;
    const intensity = options.expressionIntensity ?? 1;
    const action = options.action ?? "idle";
    const time = options.time ?? 0;

    // Spine keyframe binding: if the asset carries imported animation
    // timelines and the current action matches one, evaluate each bone's
    // pose at the current time and inject `bone_<name>_rotate / _x / _y`
    // keys into the shape state. Transforms written by spineImporter.ts
    // pick these up automatically via their expression strings.
    const spineAnimations = (asset?.metadata as { spineAnimations?: SpineAnimationMap }).spineAnimations;
    const boneState = spineAnimations
      ? evaluateSpineBones(spineAnimations, action, time)
      : {};

    const state = {
      expression: options.expression,
      expressionIntensity: intensity,
      intensity,
      mouth,
      action,
      time,
      name: displayName,
      z: options.z ?? 0,
      angle: requestedAngle,
      resolvedAngle,
      viseme,
      headYaw: options.headYaw ?? 0,
      headPitch: options.headPitch ?? 0,
      ...boneState,
    };

    if (options.bodyPartLayer) {
      // Multi-pass occlusion mode — draw only the named layer's
      // primitives. Falls back to all primitives if the asset doesn't
      // declare a layer map (legacy single-pass behavior is preserved
      // because the renderer only invokes this path with bodyPartLayer
      // set when the asset declares the map).
      const layerMap = getBodyPartLayers(asset);
      const subset = filterByLayer(shape, layerMap, options.bodyPartLayer);
      // Draw with the SAME state but just the filtered primitive list.
      // Wrap in a synthetic ProceduralShape so drawShape applies its
      // top-level scale + iteration logic.
      drawShape(ctx, { ...shape, primitives: subset, layers: undefined }, palette, state);
    } else {
      drawShape(ctx, shape, palette, state);
    }
  }

  ctx.restore();
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

export function darken(color: string) {
  if (!color.startsWith("#") || color.length !== 7) return color;
  const n = Number.parseInt(color.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 32);
  const g = Math.max(0, ((n >> 8) & 255) - 32);
  const b = Math.max(0, (n & 255) - 32);
  return `rgb(${r}, ${g}, ${b})`;
}
