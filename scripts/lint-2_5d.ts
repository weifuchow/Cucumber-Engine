// 2.5D lint — scans every visual procedural AssetManifest in the seeded
// sample library AND the live SQLite library, flagging assets that don't
// satisfy the 2.5D rules (see docs/2.5d-plan.md and the
// cucumber-asset-generator skill).
//
// Rules enforced per asset type:
//
//   character → required body-part topology (head, torso, ≥ 2 limb groups,
//               ≥ 2 leg/foot shapes), lighting trio (gradient + face
//               radial + z-aware contact shadow), ≥ 4 actions, ≥ 4 outline
//               strokes, ≥ 4 polygons, declared metadata.actions[]; if the
//               manifest declares >1 view, accessory parity (hat / mark /
//               emblem) across views; all declared views correspond to a
//               populated metadata.shapes[<view>] entry.
//   scene     → shape.layers.{background, midground, foreground} all
//               non-empty; shape.parallax map present with bg ≤ 0.7 and
//               fg ≥ 1.1; background contains at least one rect with
//               x ≤ -100 (the parallax-overscan rule).
//   prop      → at least one gradient OR a `shadow` modifier on any
//               primitive OR a contact-shadow ellipse.
//   effect    → at least one radial gradient OR a `${1 - progress}`
//               alpha-fade reference.
//
// Usage: `npx tsx scripts/lint-2_5d.ts`
// Exits 0 if everything passes, 1 if any asset fails its rule set.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AngleKey, AssetManifest } from "../src/types/schema.ts";
import type { ConditionalPrimitive, Primitive, ProceduralShape } from "../src/engine/proceduralShape.ts";
import { sampleLibrary } from "../src/data/sampleProject.ts";

interface Finding {
  assetId: string;
  type: string;
  scope: string;
  rule: string;
  message: string;
}

function walkPrimitives(prims: ConditionalPrimitive[]): Primitive[] {
  const out: Primitive[] = [];
  for (const p of prims) {
    out.push(p);
    if (p.kind === "transform" || p.kind === "clip") out.push(...walkPrimitives(p.children));
  }
  return out;
}

function flattenShape(shape: ProceduralShape): Primitive[] {
  const all = walkPrimitives(shape.primitives);
  if (shape.layers) {
    if (shape.layers.background) all.push(...walkPrimitives(shape.layers.background));
    if (shape.layers.midground) all.push(...walkPrimitives(shape.layers.midground));
    if (shape.layers.foreground) all.push(...walkPrimitives(shape.layers.foreground));
  }
  return all;
}

function hasGradientFill(p: Primitive): boolean {
  const fill = (p as { fill?: unknown }).fill;
  if (fill && typeof fill === "object" && "gradient" in fill) return true;
  return false;
}

function hasShadowModifier(p: Primitive): boolean {
  return Boolean((p as { shadow?: unknown }).shadow);
}

/**
 * Walk the primitive tree counting body-part heuristics. Thresholds are
 * scaled to the character's declared `metadata.height` so they work for
 * both tall humans (520 px) and chibi designs (280 px). The lint exists
 * to catch "missing whole limb" cases, not to micro-grade proportion.
 *
 * Default height assumes 520 px (the canonical built-in builder size)
 * when the manifest doesn't declare one.
 *
 * Coordinate convention: characters are anchored at (0, 0) on the
 * ground line, so head sits at negative cy (~-0.6 × height), torso at
 * (~-0.45 × height), legs at (~-0.1 × height), feet near 0.
 */
function countBodyParts(prims: ConditionalPrimitive[], height = 520): {
  head: number;
  torso: number;
  legs: number;
  feet: number;
  armBranches: number;
} {
  let head = 0;
  let torso = 0;
  let legs = 0;
  let feet = 0;
  let armBranches = 0;

  const headCyMax = -height * 0.55;       // cy must be ≤ this (head is high up)
  const headRMin = height * 0.10;         // head radius proportional
  const torsoYMax = -height * 0.35;       // torso top ≤ this
  const torsoHMin = height * 0.28;        // torso height proportional
  const legYMin = -height * 0.12;         // legs sit near ground
  const legYMax = 0;
  const legHMin = height * 0.05;
  const feetYRange = height * 0.04;       // feet polys near baseline ±4 % height
  const armXRange = [height * 0.045, height * 0.18]; // arm translate.x in this range

  function visit(list: ConditionalPrimitive[]) {
    for (const p of list) {
      if (p.kind === "circle" && typeof p.cy === "number" && typeof p.r === "number"
          && p.cy <= headCyMax && p.r >= headRMin) {
        head++;
      }
      // Torso: roundedRect OR polygon — the latter so cape/robe silhouettes count.
      if (p.kind === "roundedRect" && typeof p.y === "number" && typeof p.h === "number"
          && p.y <= torsoYMax && p.h >= torsoHMin) {
        torso++;
      }
      if (p.kind === "polygon" && Array.isArray(p.points) && p.points.length >= 4) {
        const ys = p.points.map((pt) => (typeof pt.y === "number" ? pt.y : 0));
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        if (minY <= torsoYMax && maxY - minY >= torsoHMin) torso++;
      }
      if (p.kind === "roundedRect" && typeof p.y === "number" && typeof p.h === "number"
          && p.y >= legYMin && p.y <= legYMax && p.h >= legHMin) {
        legs++;
      }
      if (p.kind === "polygon" && Array.isArray(p.points)) {
        const ys = p.points.map((pt) => (typeof pt.y === "number" ? pt.y : 0));
        if (ys.length && Math.min(...ys) >= -feetYRange && Math.max(...ys) <= feetYRange + 20) feet++;
      }
      if (p.kind === "transform" && p.translate && typeof p.translate.x === "number") {
        const ax = Math.abs(p.translate.x);
        if (ax >= armXRange[0] && ax <= armXRange[1]) armBranches++;
        visit(p.children);
      } else if (p.kind === "transform" || p.kind === "clip") {
        visit(p.children);
      }
    }
  }
  visit(prims);
  return { head, torso, legs, feet, armBranches };
}

/**
 * Extract the names of accessories the spec declares so we can ask "does
 * every populated view carry them?". Used for view-parity checks.
 */
function declaredAccessories(asset: AssetManifest): {
  hasHat: boolean;
  hasEmblem: boolean;
  hasMark: boolean;
} {
  const m = asset.metadata as { hat?: unknown; chestEmblem?: unknown; facialMarks?: unknown };
  return {
    hasHat: typeof m.hat === "string" && m.hat !== "none" && m.hat !== "",
    hasEmblem: typeof m.chestEmblem === "object" && m.chestEmblem !== null,
    hasMark: Array.isArray(m.facialMarks) && m.facialMarks.length > 0,
  };
}

/** Coarse text scan for accessory presence in a primitive list. */
function shapeMentionsHat(prims: ConditionalPrimitive[]): boolean {
  // Hat is always either a roundedRect/ellipse around y ≈ -360..-400 OR a
  // polygon crown with all y < -340. Look for either.
  function visit(list: ConditionalPrimitive[]): boolean {
    for (const p of list) {
      if ((p.kind === "ellipse" || p.kind === "roundedRect") &&
          typeof (p as { cy?: unknown; y?: unknown }).cy === "number") {
        const cy = (p as { cy: number }).cy;
        if (cy <= -350 && cy >= -410) return true;
      }
      if (p.kind === "polygon" && Array.isArray(p.points)) {
        const ys = p.points.map((pt) => (typeof pt.y === "number" ? pt.y : 0));
        if (ys.length && Math.max(...ys) <= -340) return true;
      }
      if ((p.kind === "transform" || p.kind === "clip") && visit(p.children)) return true;
    }
    return false;
  }
  return visit(prims);
}

function shapeMentionsEmblem(prims: ConditionalPrimitive[]): boolean {
  // Emblem appears as a small circle (r ≤ 14) somewhere in the upper torso.
  function visit(list: ConditionalPrimitive[]): boolean {
    for (const p of list) {
      if (p.kind === "circle" && typeof p.r === "number" && typeof p.cy === "number" &&
          p.r <= 14 && p.r >= 6 && p.cy <= -170 && p.cy >= -210) {
        return true;
      }
      if ((p.kind === "transform" || p.kind === "clip") && visit(p.children)) return true;
    }
    return false;
  }
  return visit(prims);
}

function getViewShapes(asset: AssetManifest): Partial<Record<AngleKey, ProceduralShape>> {
  const shapes = (asset.metadata as { shapes?: Partial<Record<AngleKey, ProceduralShape>> }).shapes;
  if (shapes && typeof shapes === "object") return shapes;
  const single = (asset.metadata as { shape?: ProceduralShape }).shape;
  return single ? { front: single } : {};
}

function lintCharacter(asset: AssetManifest, shape: ProceduralShape, findings: Finding[]) {
  const prims = flattenShape(shape);
  const allPrims: ConditionalPrimitive[] = [
    ...shape.primitives,
    ...(shape.layers?.background ?? []),
    ...(shape.layers?.midground ?? []),
    ...(shape.layers?.foreground ?? []),
  ];

  // Required body topology — catches "missing limb" cases.
  const declaredHeight = (asset.metadata as { height?: unknown }).height;
  const heightHint = typeof declaredHeight === "number" && declaredHeight > 80 ? declaredHeight : 520;
  const parts = countBodyParts(allPrims, heightHint);
  if (parts.head < 1) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.requiredParts.head", message: "no head silhouette found (expected ≥ 1 circle with cy ≤ -280 and r ≥ 50)" });
  }
  if (parts.torso < 1) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.requiredParts.torso", message: "no torso silhouette found (expected ≥ 1 roundedRect with y ≤ -200 and h ≥ 150)" });
  }
  if (parts.legs < 1) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.requiredParts.legs", message: "no leg shapes found (expected ≥ 1 roundedRect with y near 0 and h ≥ 30)" });
  }
  if (parts.feet < 1) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.requiredParts.feet", message: "no foot/shoe polygons found at the baseline — character is footless" });
  }
  if (parts.armBranches < 2) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.requiredParts.arms", message: `only ${parts.armBranches} arm transform branch(es) found — character has missing arm(s)` });
  }

  // Lighting trio
  const hasGradient = prims.some(hasGradientFill);
  if (!hasGradient) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.lighting", message: "no gradient fill found — add a body linear gradient and/or face radial highlight" });
  }
  const hasZContactShadow = prims.some((p) => {
    if (p.kind !== "ellipse") return false;
    const rx = (p as { rx?: unknown }).rx;
    const ry = (p as { ry?: unknown }).ry;
    return (typeof rx === "string" && rx.includes("z")) || (typeof ry === "string" && ry.includes("z"));
  });
  if (!hasZContactShadow) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.contactShadow", message: "no z-aware contact shadow — add an ellipse whose rx/ry expression references the `z` state variable" });
  }

  // Cel-shading detail set
  const outlineCount = prims.filter((p) => Boolean((p as { stroke?: unknown }).stroke)).length;
  if (outlineCount < 4) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.outline", message: `only ${outlineCount} outline strokes found — add stroke on torso, limbs, head silhouettes for cel-shading read` });
  }
  const polygonCount = prims.filter((p) => p.kind === "polygon").length;
  if (polygonCount < 4) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.detail", message: `only ${polygonCount} polygon primitives found — add hair locks / facial features (nose, jaw shadow) as polygons` });
  }

  // Action coverage: walk the `when` clauses on the top-level conditional
  // primitives, collect every action value referenced, require ≥ 4 distinct
  // actions including `idle` + `walking` + at least one of attack/defend/victory/punch/kick.
  const actionsFromWhen = new Set<string>();
  function collectActions(prims: ConditionalPrimitive[]) {
    for (const p of prims) {
      if (p.when) {
        const eq = p.when.match(/^\s*action\s*(==|!=)\s*([\w-]+)\s*$/);
        if (eq) actionsFromWhen.add(eq[2]);
        const inList = p.when.match(/^\s*action\s+(not\s+)?in\s+\[([^\]]+)\]\s*$/);
        if (inList) {
          for (const v of inList[2].split(",").map((s) => s.trim()).filter(Boolean)) actionsFromWhen.add(v);
        }
      }
      if (p.kind === "transform" || p.kind === "clip") collectActions(p.children);
    }
  }
  collectActions(allPrims);
  if (actionsFromWhen.size < 4) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.actionCount", message: `only ${actionsFromWhen.size} distinct actions referenced (${[...actionsFromWhen].join(",") || "none"}) — need ≥ 4 (idle + walking + 2 active poses)` });
  }
  const expressive = new Set(["attack", "defend", "victory", "punch", "kick", "block", "cheer", "kneel", "sit"]);
  const hasActive = [...actionsFromWhen].some((a) => expressive.has(a));
  if (!hasActive) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.actionVariety", message: "no expressive pose found — add at least one of attack/defend/victory/punch/kick/block as a `when: \"action == xxx\"` branch" });
  }

  // metadata.actions declaration (frontend uses this to render buttons)
  const actionsDecl = (asset.metadata as { actions?: unknown }).actions;
  if (!Array.isArray(actionsDecl) || actionsDecl.length < 4) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.actionsMetadata", message: "metadata.actions[] missing or has < 4 entries — declare the supported actions so the preview UI shows them" });
  }

  // Viseme coverage — when ANY `when: "mouth == <viseme>"` branch exists,
  // require all 7 visemes (rest is implicit). Mixed-coverage produces
  // mid-sentence frozen-mouth glitches.
  const VISEMES = ["open", "narrow", "round", "mid", "wide", "ee"];
  const visemeBranches = new Set<string>();
  function scanMouth(prims: ConditionalPrimitive[]) {
    for (const p of prims) {
      if (p.when) {
        const m = p.when.match(/^\s*mouth\s*==\s*([\w-]+)\s*$/);
        if (m && VISEMES.includes(m[1])) visemeBranches.add(m[1]);
      }
      if (p.kind === "transform" || p.kind === "clip") scanMouth(p.children);
    }
  }
  scanMouth(allPrims);
  if (visemeBranches.size && visemeBranches.size < VISEMES.length) {
    const missing = VISEMES.filter((v) => !visemeBranches.has(v));
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.lipSync", message: `mouth viseme branches partial: missing [${missing.join(",")}] — define all 7 visemes (open/narrow/round/mid/wide/ee + rest implicit) or none` });
  }

  // soundEffectIds metadata — if declared, every key must reference a
  // real soundEffect asset. We don't have the full library at lint time
  // (it's a separate scan), so we just enforce structural shape.
  const sfx = (asset.metadata as { soundEffectIds?: unknown }).soundEffectIds;
  if (sfx !== undefined) {
    if (typeof sfx !== "object" || sfx === null || Array.isArray(sfx)) {
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.soundEffectIds.shape", message: "metadata.soundEffectIds must be an object of {actionName: soundEffectAssetId}" });
    } else {
      for (const [k, v] of Object.entries(sfx)) {
        if (typeof v !== "string" || !v.startsWith("sfx_") && !v.startsWith("soundEffect_")) {
          findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.soundEffectIds.value", message: `metadata.soundEffectIds["${k}"] must be a string assetId beginning with sfx_ or soundEffect_` });
        }
      }
    }
  }

  // references[] — AI-generated characters should record what they looked at
  // (for attribution + reproducibility). Skip the seeded built-in assets.
  const isBuiltIn = asset.source.kind === "manual" || asset.source.kind === "referenced";
  if (!isBuiltIn) {
    const refs = (asset.metadata as { references?: unknown }).references;
    if (!Array.isArray(refs) || refs.length === 0) {
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.references", message: "AI-generated character should record metadata.references[] (user-upload paths or web URLs) for attribution + reproducibility" });
    }
  }
}

function lintScene(asset: AssetManifest, shape: ProceduralShape, findings: Finding[]) {
  const bg = shape.layers?.background ?? [];
  const mid = shape.layers?.midground ?? [];
  const fg = shape.layers?.foreground ?? [];
  if (!bg.length || !mid.length || !fg.length) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "scene.layers", message: `layers.background/midground/foreground must all be non-empty (got ${bg.length}/${mid.length}/${fg.length})` });
  }
  const px = shape.parallax;
  if (!px || px.background === undefined || px.foreground === undefined) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "scene.parallax", message: "parallax map must declare at least background + foreground factors" });
  } else {
    if ((px.background ?? 1) > 0.7) findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "scene.parallax.background", message: `background parallax ${px.background} should be ≤ 0.7 for a clearly slow drift` });
    if ((px.foreground ?? 1) < 1.1) findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "scene.parallax.foreground", message: `foreground parallax ${px.foreground} should be ≥ 1.1 for a clearly fast slide` });
  }
  // Background overscan: at least one rect with x ≤ -100 (so pan never reveals empty canvas).
  const bgPrims = walkPrimitives(bg);
  const hasOverscan = bgPrims.some((p) => {
    if (p.kind !== "rect" && p.kind !== "roundedRect") return false;
    const x = (p as { x: unknown }).x;
    return typeof x === "number" && x <= -100;
  });
  if (!hasOverscan && bgPrims.length) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "scene.overscan", message: "background should include a rect with x ≤ -100 so parallax pan never reveals empty canvas" });
  }
}

function lintProp(asset: AssetManifest, shape: ProceduralShape, findings: Finding[]) {
  const prims = flattenShape(shape);
  const hasGradient = prims.some(hasGradientFill);
  const hasShadow = prims.some(hasShadowModifier);
  const hasContactShadow = prims.some((p) => p.kind === "ellipse" && typeof (p as { cy?: unknown }).cy === "number");
  if (!hasGradient && !hasShadow && !hasContactShadow) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "prop.volume", message: "prop should include at least one gradient, shadow modifier, or contact-shadow ellipse" });
  }
}

function lintEffect(asset: AssetManifest, shape: ProceduralShape, findings: Finding[]) {
  const prims = flattenShape(shape);
  const hasRadial = prims.some((p) => {
    const fill = (p as { fill?: unknown }).fill;
    return Boolean(fill && typeof fill === "object" && (fill as { gradient?: string }).gradient === "radial");
  });
  if (!hasRadial) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "effect.halo", message: "effect should include a radial gradient halo behind the main shapes" });
  }
}

function lintCharacterViewParity(asset: AssetManifest, findings: Finding[]) {
  const shapes = getViewShapes(asset);
  const populated = Object.keys(shapes) as AngleKey[];
  const declared = (asset.metadata as { views?: unknown }).views;
  const declaredViews = Array.isArray(declared) ? (declared as AngleKey[]) : populated;

  // Every declared view must have a corresponding shape.
  for (const v of declaredViews) {
    if (!shapes[v]) {
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "character.views.missingShape", message: `metadata.views declares "${v}" but metadata.shapes["${v}"] is missing` });
    }
  }

  // Multi-view bundle — lint each non-front view individually with the
  // same body-topology rules so we catch "back view has no legs" cases.
  for (const v of populated) {
    const s = shapes[v];
    if (!s) continue;
    const list: ConditionalPrimitive[] = [
      ...s.primitives,
      ...(s.layers?.background ?? []),
      ...(s.layers?.midground ?? []),
      ...(s.layers?.foreground ?? []),
    ];
    const viewDeclaredHeight = (asset.metadata as { height?: unknown }).height;
    const viewHeightHint = typeof viewDeclaredHeight === "number" && viewDeclaredHeight > 80 ? viewDeclaredHeight : 520;
    const parts = countBodyParts(list, viewHeightHint);
    if (parts.head < 1 || parts.torso < 1 || parts.legs < 1 || parts.feet < 1) {
      const missing: string[] = [];
      if (parts.head < 1) missing.push("head");
      if (parts.torso < 1) missing.push("torso");
      if (parts.legs < 1) missing.push("legs");
      if (parts.feet < 1) missing.push("feet");
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: `character.views.${v}.requiredParts`, message: `view "${v}" missing required parts: ${missing.join(", ")}` });
    }
    if (parts.armBranches < 1) {
      // Side/back may legitimately combine arms into fewer branches, but
      // zero arm presence means the character is armless from that angle.
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: `character.views.${v}.arms`, message: `view "${v}" has no arm transform branches — character is armless from this angle` });
    }
  }

  // Accessory parity — if the character declares hat/emblem, every populated
  // view must reflect it. (Marks are face-side specific, so we don't enforce
  // them across back / non-facing-side views.)
  if (populated.length > 1) {
    const acc = declaredAccessories(asset);
    for (const v of populated) {
      const s = shapes[v];
      if (!s) continue;
      const list: ConditionalPrimitive[] = [
        ...s.primitives,
        ...(s.layers?.background ?? []),
        ...(s.layers?.midground ?? []),
        ...(s.layers?.foreground ?? []),
      ];
      if (acc.hasHat && !shapeMentionsHat(list)) {
        findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: `character.views.${v}.hatParity`, message: `view "${v}" missing the hat declared in metadata.hat — accessory should appear in every populated view` });
      }
      // Chest emblem only required on front + threeQuarter (not visible from
      // back, and on side views it sits in profile — we accept either).
      if (acc.hasEmblem && (v === "front" || v.startsWith("threeQuarter")) && !shapeMentionsEmblem(list)) {
        findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: `character.views.${v}.emblemParity`, message: `view "${v}" missing the chest emblem declared in metadata.chestEmblem` });
      }
    }
  }
}

function lintAsset(asset: AssetManifest, findings: Finding[]) {
  const shapesBundle = getViewShapes(asset);
  const primaryShape = shapesBundle.front
    ?? Object.values(shapesBundle)[0]
    ?? (asset.metadata as { shape?: ProceduralShape }).shape;
  if (!primaryShape) return; // audio assets / non-procedural — skip
  if (!Array.isArray((primaryShape as { primitives?: unknown }).primitives)) return;
  if (asset.type === "character") {
    lintCharacter(asset, primaryShape, findings);
    lintCharacterViewParity(asset, findings);
  } else if (asset.type === "scene" || asset.type === "background" || asset.type === "foreground") {
    lintScene(asset, primaryShape, findings);
  } else if (asset.type === "prop") {
    lintProp(asset, primaryShape, findings);
  } else if (asset.type === "effect") {
    lintEffect(asset, primaryShape, findings);
  }
}

async function loadLiveAssets(): Promise<AssetManifest[]> {
  const dbPath = resolve(process.cwd(), "data", "cucumber.db");
  if (!existsSync(dbPath)) return [];
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT manifest_json FROM assets").all() as Array<{ manifest_json: string }>;
    db.close();
    return rows.map((r) => JSON.parse(r.manifest_json) as AssetManifest);
  } catch (err) {
    console.warn(`[lint-2.5d] could not open live db: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// =====================================================================
// 罗小黑 STYLE BAR — opt-in via `--style luoxiaohei`
// =====================================================================
// See docs/acceptance-luoxiaohei.md for what each rule maps to. This is
// strict-mode lint on top of the baseline 2.5D rules above; rules here
// start with LX- so they don't collide.

function isPinkish(rgba: string): boolean {
  // crude pink test — rgba with r >= 180 and g/b lower, alpha 0.18-0.45
  const m = rgba.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  if (!m) return false;
  const [, rs, gs, bs, as] = m;
  const r = +rs, g = +gs, b = +bs, a = +as;
  return r >= 180 && g <= 180 && b <= 180 && a >= 0.15 && a <= 0.5 && r > g && r > b;
}

function isShadowy(rgba: string): boolean {
  // dark-warm shadow: rgba black/brown family, alpha 0.18-0.5
  const m = rgba.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  if (!m) return false;
  const [, rs, gs, bs, as] = m;
  const r = +rs, g = +gs, b = +bs, a = +as;
  return r < 100 && g < 100 && b < 100 && a >= 0.15 && a <= 0.55;
}

function lintCharacterLuoXiaoHei(asset: AssetManifest, shape: ProceduralShape, findings: Finding[]) {
  const prims = flattenShape(shape);

  // LX-C1: palette has 3–6 entries
  const palette = (asset.metadata.palette ?? {}) as Record<string, string>;
  const paletteSize = Object.keys(palette).filter((k) => !k.startsWith("slot_")).length;
  if (paletteSize < 3 || paletteSize > 6) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-C1.palette", message: `palette has ${paletteSize} entries, 罗小黑 bar expects 3–6` });
  }

  // LX-C2: outline stroke widths uniform in [1.0, 2.0]
  const strokeWidths = prims
    .map((p) => (p as { lineWidth?: unknown }).lineWidth)
    .filter((w): w is number => typeof w === "number");
  const outOfRange = strokeWidths.filter((w) => w < 1.0 || w > 2.0);
  if (outOfRange.length > strokeWidths.length * 0.15) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-C2.outline", message: `${outOfRange.length}/${strokeWidths.length} outline widths outside [1.0, 2.0] — 罗小黑 uses uniform thin contour` });
  }

  // LX-C3: ≥ 2 crisp shadow polygons (flat dark-rgba fill)
  const shadowPolys = prims.filter((p) => {
    if (p.kind !== "polygon") return false;
    const fill = (p as { fill?: unknown }).fill;
    return typeof fill === "string" && isShadowy(fill);
  });
  if (shadowPolys.length < 2) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-C3.shadow", message: `only ${shadowPolys.length} cel-shading shadow polygons — 罗小黑 needs ≥ 2 (one per major body part)` });
  }

  // LX-C4: no iris radial gradients with > 2 stops — eye band scales with height
  const declHeightForEye = (asset.metadata as { height?: unknown }).height;
  const hEye = typeof declHeightForEye === "number" && declHeightForEye > 80 ? declHeightForEye : 520;
  const eyeCyMin = -hEye * 0.78;
  const eyeCyMax = -hEye * 0.56;
  for (const p of prims) {
    if (p.kind !== "circle" && p.kind !== "ellipse") continue;
    const cy = (p as { cy?: unknown }).cy;
    if (typeof cy !== "number") continue;
    if (cy > eyeCyMax || cy < eyeCyMin) continue;
    const fill = (p as { fill?: unknown }).fill;
    if (!fill || typeof fill !== "object") continue;
    const f = fill as { gradient?: string; stops?: unknown[] };
    if (f.gradient === "radial" && Array.isArray(f.stops) && f.stops.length > 2) {
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-C4.eye", message: "iris uses radial gradient with > 2 stops — 罗小黑 uses flat pupils" });
      break;
    }
  }

  // LX-C5: head-to-height ratio in [0.18, 0.30]
  const height = (asset.metadata.height as number | undefined) ?? 0;
  const headPrim = prims.find((p) => p.kind === "circle" && typeof (p as { cy?: unknown }).cy === "number" && (p as { cy: number }).cy <= -280 && typeof (p as { r?: unknown }).r === "number" && (p as { r: number }).r >= 50);
  if (headPrim && height > 0) {
    const r = (headPrim as { r: number }).r;
    const ratio = (r * 2) / height;
    if (ratio < 0.18 || ratio > 0.30) {
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-C5.proportion", message: `head/height = ${ratio.toFixed(2)} — 罗小黑 bar wants [0.18, 0.30] (slightly chibi)` });
    }
  }

  // LX-C6: ≥ 2 cheek warmth pink ellipses (height-relative band — cheeks sit
  // at roughly 65 % of total height up from the ground).
  const declaredHeight = (asset.metadata as { height?: unknown }).height;
  const hh = typeof declaredHeight === "number" && declaredHeight > 80 ? declaredHeight : 520;
  const cheekCyMin = -hh * 0.72;
  const cheekCyMax = -hh * 0.55;
  const cheekWarmth = prims.filter((p) => {
    if (p.kind !== "ellipse") return false;
    const cy = (p as { cy?: unknown }).cy;
    if (typeof cy !== "number") return false;
    if (cy > cheekCyMax || cy < cheekCyMin) return false;
    const fill = (p as { fill?: unknown }).fill;
    return typeof fill === "string" && isPinkish(fill);
  });
  if (cheekWarmth.length < 2) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-C6.cheek", message: `only ${cheekWarmth.length} cheek-warmth pink ellipses found in band cy ∈ [${cheekCyMin.toFixed(0)}, ${cheekCyMax.toFixed(0)}] — 罗小黑 always has both cheeks` });
  }
}

function lintSceneLuoXiaoHei(asset: AssetManifest, shape: ProceduralShape, findings: Finding[]) {
  const bg = walkPrimitives(shape.layers?.background ?? []);
  const fg = walkPrimitives(shape.layers?.foreground ?? []);

  // LX-S1: atmospheric haze rect in bg
  const hasHaze = bg.some((p) => {
    if (p.kind !== "rect" && p.kind !== "roundedRect") return false;
    const fill = (p as { fill?: unknown }).fill;
    if (!fill) return false;
    if (typeof fill === "string") return /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.[2-4]\d*\s*\)/.test(fill);
    if (typeof fill === "object" && (fill as { gradient?: string }).gradient === "linear") {
      const stops = (fill as { stops?: Array<{ color?: string }> }).stops ?? [];
      return stops.some((s) => typeof s.color === "string" && /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.[1-4]\d*\s*\)/.test(s.color));
    }
    return false;
  });
  if (!hasHaze) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-S1.haze", message: "no atmospheric haze rect in background — 罗小黑 needs soft alpha overlay for depth" });
  }

  // LX-S2: watercolor-ramp gradient (≥ 3 stops, ≥ 1 with alpha)
  const hasWatercolor = bg.some((p) => {
    const fill = (p as { fill?: unknown }).fill;
    if (!fill || typeof fill !== "object") return false;
    const f = fill as { gradient?: string; stops?: Array<{ color?: string }> };
    if (f.gradient !== "linear" || !Array.isArray(f.stops) || f.stops.length < 3) return false;
    return f.stops.some((s) => typeof s.color === "string" && s.color.includes("rgba"));
  });
  if (!hasWatercolor) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-S2.watercolor", message: "no watercolor-style gradient in bg (linear ≥ 3 stops with alpha) — adds painterly depth" });
  }

  // LX-S3: foreground has occluder shape
  if (!fg.length) {
    findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-S3.occluder", message: "foreground empty — 罗小黑 frames action with branches/leaves/doorframes" });
  }

  // LX-S5: stronger parallax separation
  const px = shape.parallax;
  if (px) {
    if ((px.background ?? 1) > 0.55) {
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-S5.bgParallax", message: `bg parallax ${px.background} > 0.55 — 罗小黑 needs stronger separation` });
    }
    if ((px.foreground ?? 1) < 1.2) {
      findings.push({ assetId: asset.assetId, type: asset.type, scope: asset.scope, rule: "LX-S5.fgParallax", message: `fg parallax ${px.foreground} < 1.2 — 罗小黑 needs faster foreground slide` });
    }
  }
}

function lintAssetWithStyle(asset: AssetManifest, findings: Finding[], style: string | null) {
  if (style !== "luoxiaohei") return;
  const shape = (asset.metadata as { shape?: ProceduralShape }).shape;
  if (!shape) return;
  if (asset.type === "character") lintCharacterLuoXiaoHei(asset, shape, findings);
  else if (asset.type === "scene" || asset.type === "background") lintSceneLuoXiaoHei(asset, shape, findings);
}

// =====================================================================
// SEGMENT lint — only fires when --style luoxiaohei
// =====================================================================
//
// Loaded as a separate scan because segments aren't asset manifests;
// they live on Project.chapters[].segments[]. We walk the seeded sample
// project + every project in the live DB.

interface SegmentFinding {
  projectId: string;
  segmentId: string;
  rule: string;
  message: string;
}

interface MinTimelineEvent {
  time: number;
  type: string;
  duration?: number;
  target?: string;
  camera?: { mode?: string; x?: number; y?: number; zoom?: number; duration?: number; transition?: string; target?: string };
  effectId?: string;
  action?: { name?: string };
  sceneId?: string;
}

interface MinSegment { segmentId: string; duration: number; timeline: MinTimelineEvent[] }
interface MinProject {
  projectId: string;
  chapters: Array<{ segments: MinSegment[] }>;
  config?: { styleBar?: string };
}

function lintSegmentLuoXiaoHei(projectId: string, segment: MinSegment, findings: SegmentFinding[]) {
  const tl = segment.timeline;
  const segDur = segment.duration;
  const push = (rule: string, message: string) => findings.push({ projectId, segmentId: segment.segmentId, rule, message });

  // LX-T1: no characterAppear in opening 1.0s
  const earlyAppear = tl.find((e) => e.type === "characterAppear" && e.time < 1.0);
  if (earlyAppear) {
    push("LX-T1.envHold", `characterAppear at t=${earlyAppear.time} — environment should hold ≥ 1.0 s before any character enters`);
  }

  // LX-T2: ≥ 1 smooth horizontal pan (Δx ≥ 200, dur ≥ 2.0)
  const cameras = tl.filter((e) => e.type === "cameraChange").map((e) => e);
  let prevX = 640;
  let foundPan = false;
  for (const cam of cameras) {
    const dx = Math.abs((cam.camera?.x ?? prevX) - prevX);
    if (dx >= 200 && (cam.camera?.duration ?? 0) >= 2.0 && cam.camera?.transition === "smooth") {
      foundPan = true; break;
    }
    if (cam.camera?.x !== undefined) prevX = cam.camera.x;
  }
  if (!foundPan) {
    push("LX-T2.horizontalPan", "no smooth horizontal pan ≥ 2.0 s with Δx ≥ 200 — 罗小黑 needs at least one sustained tracking shot");
  }

  // LX-T3: ≥ 1 slow push-in (Δzoom ≥ 0.15, dur ≥ 1.5, transition=smooth)
  let prevZoom = 1.0;
  let foundPush = false;
  for (const cam of cameras) {
    const z = cam.camera?.zoom ?? prevZoom;
    if (Math.abs(z - prevZoom) >= 0.15 && (cam.camera?.duration ?? 0) >= 1.5 && cam.camera?.transition === "smooth") {
      foundPush = true; break;
    }
    prevZoom = z;
  }
  if (!foundPush) {
    push("LX-T3.pushIn", "no slow push-in (Δzoom ≥ 0.15, dur ≥ 1.5 s, smooth) — 罗小黑 close-ups punch via this beat");
  }

  // LX-T5: ≥ 1 effectPlay timed with attack/punch characterAction
  const attackEvents = tl.filter((e) => e.type === "characterAction" && /attack|punch|kick/i.test(e.action?.name ?? ""));
  const effects = tl.filter((e) => e.type === "effectPlay");
  let coLocated = false;
  for (const atk of attackEvents) {
    if (effects.some((fx) => Math.abs(fx.time - atk.time) <= 0.15)) { coLocated = true; break; }
  }
  if (attackEvents.length && !coLocated) {
    push("LX-T5.speedLine", "characterAction attack/punch without an effectPlay within ±0.15 s — add speed lines");
  }

  // LX-T6: ≤ 1 hard `cut` transition
  const cuts = cameras.filter((e) => e.camera?.transition === "cut");
  if (cuts.length > 1) {
    push("LX-T6.cuts", `${cuts.length} hard cut camera transitions — 罗小黑 allows at most 1 per segment`);
  }

  // LX-T7: ≥ 0.6 s after characterDisappear before sceneChange
  for (let i = 0; i < tl.length; i++) {
    if (tl[i].type !== "characterDisappear") continue;
    const sceneChange = tl.find((e, j) => j > i && e.type === "sceneChange" && e.time - tl[i].time < 0.6);
    if (sceneChange) {
      push("LX-T7.breathPause", `sceneChange ${sceneChange.time - tl[i].time}s after characterDisappear — hold ≥ 0.6 s for the "lingering breath" beat`);
    }
  }

  // LX-T8: dialogue time ≤ 70% of segment
  const dialogueTime = tl.filter((e) => e.type === "dialogue").reduce((s, e) => s + (e.duration ?? 0), 0);
  if (dialogueTime / segDur > 0.70) {
    push("LX-T8.talkTime", `dialogue ${(dialogueTime / segDur * 100).toFixed(0)}% of segment — 罗小黑 breathes; cap at 70%`);
  }
}

async function loadLiveProjects(): Promise<MinProject[]> {
  const dbPath = resolve(process.cwd(), "data", "cucumber.db");
  if (!existsSync(dbPath)) return [];
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT project_json FROM projects").all() as Array<{ project_json: string }>;
    db.close();
    return rows.map((r) => JSON.parse(r.project_json) as MinProject);
  } catch (err) {
    console.warn(`[lint-2.5d] could not open live db for projects: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function main() {
  const style = process.argv.includes("--style")
    ? process.argv[process.argv.indexOf("--style") + 1] ?? null
    : null;
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const seedAssets = [...sampleLibrary.globalAssets, ...sampleLibrary.projectAssets];
  for (const a of seedAssets) {
    seen.add(a.assetId);
    lintAsset(a, findings);
    lintAssetWithStyle(a, findings, style);
  }
  const liveAssets = await loadLiveAssets();
  for (const a of liveAssets) {
    if (seen.has(a.assetId)) continue;
    seen.add(a.assetId);
    lintAsset(a, findings);
    lintAssetWithStyle(a, findings, style);
  }

  // Segment-level checks (style bar only)
  const segmentFindings: SegmentFinding[] = [];
  let segmentsScanned = 0;
  if (style === "luoxiaohei") {
    const liveProjects = await loadLiveProjects();
    // also include the seeded sample project so AI-authored test segments hit the bar.
    const { sampleProject } = await import("../src/data/sampleProject.ts");
    const projects: MinProject[] = [sampleProject as unknown as MinProject, ...liveProjects];
    for (const proj of projects) {
      // Only enforce segment rules on projects that explicitly opt into
      // this style bar. Other projects can coexist with their own rules.
      if (proj.config?.styleBar !== "luoxiaohei") continue;
      for (const ch of proj.chapters ?? []) {
        for (const seg of ch.segments ?? []) {
          segmentsScanned++;
          lintSegmentLuoXiaoHei(proj.projectId, seg, segmentFindings);
        }
      }
    }
  }

  const totalScanned = seen.size;
  const styleSuffix = style ? ` (style: ${style})` : "";
  const totalFindings = findings.length + segmentFindings.length;

  if (!totalFindings) {
    console.log(`[lint-2.5d] ✓ ${totalScanned} 个资产 + ${segmentsScanned} 个 segment 全部通过${styleSuffix}。`);
    process.exit(0);
  }

  console.log(`[lint-2.5d] 扫描了 ${totalScanned} 个资产 + ${segmentsScanned} 个 segment${styleSuffix}，发现 ${totalFindings} 条警告：`);
  for (const f of findings) {
    console.log(`  · ${f.assetId} [${f.type}/${f.scope}]  ${f.rule}: ${f.message}`);
  }
  for (const f of segmentFindings) {
    console.log(`  · ${f.projectId} :: ${f.segmentId}  ${f.rule}: ${f.message}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
