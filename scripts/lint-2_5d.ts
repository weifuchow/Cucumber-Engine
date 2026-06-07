// 2.5D lint — scans every visual procedural AssetManifest in the seeded
// sample library AND the live SQLite library, flagging assets that don't
// satisfy the 2.5D rules (see docs/2.5d-plan.md and the
// cucumber-asset-generator skill).
//
// Rules enforced per asset type:
//
//   character → at least one gradient fill (linear or radial), at least
//               one contact-shadow ellipse whose rx/ry expression references
//               the `z` state variable.
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
import type { AssetManifest } from "../src/types/schema.ts";
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

function lintCharacter(asset: AssetManifest, shape: ProceduralShape, findings: Finding[]) {
  const prims = flattenShape(shape);
  const allPrims: ConditionalPrimitive[] = [
    ...shape.primitives,
    ...(shape.layers?.background ?? []),
    ...(shape.layers?.midground ?? []),
    ...(shape.layers?.foreground ?? []),
  ];

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

function lintAsset(asset: AssetManifest, findings: Finding[]) {
  const shape = (asset.metadata as { shape?: ProceduralShape }).shape;
  if (!shape) return; // audio assets / non-procedural — skip
  if (!Array.isArray((shape as { primitives?: unknown }).primitives)) return;
  if (asset.type === "character") lintCharacter(asset, shape, findings);
  else if (asset.type === "scene" || asset.type === "background" || asset.type === "foreground") lintScene(asset, shape, findings);
  else if (asset.type === "prop") lintProp(asset, shape, findings);
  else if (asset.type === "effect") lintEffect(asset, shape, findings);
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

async function main() {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const seedAssets = [...sampleLibrary.globalAssets, ...sampleLibrary.projectAssets];
  for (const a of seedAssets) {
    seen.add(a.assetId);
    lintAsset(a, findings);
  }
  const liveAssets = await loadLiveAssets();
  for (const a of liveAssets) {
    if (seen.has(a.assetId)) continue;
    seen.add(a.assetId);
    lintAsset(a, findings);
  }

  const totalScanned = seen.size;
  if (!findings.length) {
    console.log(`[lint-2.5d] ✓ ${totalScanned} 个资产全部通过 2.5D 规则。`);
    process.exit(0);
  }

  console.log(`[lint-2.5d] 扫描了 ${totalScanned} 个资产，发现 ${findings.length} 条警告：`);
  for (const f of findings) {
    console.log(`  · ${f.assetId} [${f.type}/${f.scope}]  ${f.rule}: ${f.message}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
