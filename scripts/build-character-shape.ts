// CLI that turns a high-level CharacterSpec JSON into a full ProceduralShape
// JSON. The AI authoring path (cucumber-asset-generator) is supposed to call
// this script instead of writing ~150 primitives by hand — the resulting
// shape is guaranteed to hit the cel-shading bar (almond eyes, layered hair,
// occlusion shadows, outline strokes, ≥ 4 actions).
//
// Usage:
//
//   # spec from stdin, produce front view shape
//   echo '{"palette":{...},"hairStyle":"fringe","hat":"straw"}' \
//     | npx tsx scripts/build-character-shape.ts
//
//   # spec from --spec-file
//   npx tsx scripts/build-character-shape.ts --spec-file /tmp/spec.json
//
//   # spec inline
//   npx tsx scripts/build-character-shape.ts --spec '{"hairStyle":"spiky"}'
//
//   # pick an alternate view (back / sideLeft / sideRight / threeQuarterLeft / threeQuarterRight)
//   npx tsx scripts/build-character-shape.ts --view sideLeft --spec '...'
//
//   # produce all four canonical views (front + back + sideLeft + sideRight)
//   # as a single JSON object keyed by view name
//   npx tsx scripts/build-character-shape.ts --emit bundle --spec '...'
//
//   # full manifest with the 4-view bundle wired into metadata.shapes
//   npx tsx scripts/build-character-shape.ts --emit manifest --views all --spec '...'
//
// Output is a single JSON object printed to stdout. The shell calling this
// script slurps it and embeds it in the manifest under metadata.shape /
// metadata.shapes.

import { readFileSync } from "node:fs";
import {
  buildHumanCharacterShape,
  buildHumanCharacterShapeForView,
  buildHumanCharacterShapesBundle,
  HUMAN_CHARACTER_ACTIONS,
  HUMAN_CHARACTER_EXPRESSIONS,
  type HumanCharacterOptions,
  type HumanCharacterView,
} from "../src/data/characterShapes.ts";

type EmitMode = "shape" | "manifest" | "bundle";
type ViewsMode = "front" | "all";

interface FullSpec extends HumanCharacterOptions {
  // Manifest-mode metadata (only used when --emit manifest)
  assetId?: string;
  name?: string;
  scope?: "global" | "project";
  palette?: Record<string, string>;
  displayName?: string;
  width?: number;
  height?: number;
  tags?: string[];
  references?: Array<{ sourceType: string; source: string; note: string }>;
}

interface ParsedArgs {
  emit: EmitMode;
  view: HumanCharacterView;
  views: ViewsMode;
  spec: FullSpec;
}

const VALID_VIEWS: HumanCharacterView[] = [
  "front", "back", "sideLeft", "sideRight", "threeQuarterLeft", "threeQuarterRight",
];

function parseArgs(argv: string[]): ParsedArgs {
  let emit: EmitMode = "shape";
  let view: HumanCharacterView = "front";
  let views: ViewsMode = "front";
  let specText: string | null = null;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--emit") {
      const v = argv[++i];
      emit = v === "manifest" ? "manifest" : v === "bundle" ? "bundle" : "shape";
    } else if (arg === "--view") {
      const v = argv[++i] as HumanCharacterView;
      if (!VALID_VIEWS.includes(v)) {
        throw new Error(`unknown --view '${v}'. valid: ${VALID_VIEWS.join(", ")}`);
      }
      view = v;
    } else if (arg === "--views") {
      const v = argv[++i];
      views = v === "all" ? "all" : "front";
    } else if (arg === "--spec") {
      specText = argv[++i];
    } else if (arg === "--spec-file") {
      specText = readFileSync(argv[++i], "utf8");
    }
  }

  if (specText === null) specText = readFileSync(0, "utf8");
  const spec = JSON.parse(specText || "{}") as FullSpec;
  return { emit, view, views, spec };
}

function specToOptions(spec: FullSpec): HumanCharacterOptions {
  return {
    scale: spec.scale,
    hairStyle: spec.hairStyle,
    hat: spec.hat,
    hatColor: spec.hatColor,
    hatBandColor: spec.hatBandColor,
    costume: spec.costume,
    shorts: spec.shorts,
    facialMarks: spec.facialMarks,
    eyeStyle: spec.eyeStyle,
    chestEmblem: spec.chestEmblem,
  };
}

function main() {
  const { emit, view, views, spec } = parseArgs(process.argv);
  const options = specToOptions(spec);

  if (emit === "shape") {
    const shape = view === "front"
      ? buildHumanCharacterShape(options)
      : buildHumanCharacterShapeForView(options, view);
    process.stdout.write(JSON.stringify(shape));
    return;
  }

  if (emit === "bundle") {
    process.stdout.write(JSON.stringify(buildHumanCharacterShapesBundle(options)));
    return;
  }

  // emit === "manifest"
  const palette = spec.palette ?? {
    body: "#c14a3a",
    skin: "#f0bf95",
    hair: "#2a1e16",
    pants: "#3b6090",
  };

  const shapeFront = buildHumanCharacterShape(options);
  const shapesBundle = views === "all" ? buildHumanCharacterShapesBundle(options) : undefined;
  const populatedViews = shapesBundle
    ? (Object.keys(shapesBundle) as HumanCharacterView[])
    : ["front" as HumanCharacterView];

  const manifest = {
    assetId: spec.assetId ?? `character_${slugify(spec.name ?? "unnamed")}_001`,
    name: spec.name ?? "未命名角色",
    category: "visual" as const,
    type: "character" as const,
    scope: spec.scope ?? ("project" as const),
    source: { kind: "generated" as const, format: "procedural", originalFile: "built-by-script" },
    files: { preview: `procedural://${slugify(spec.name ?? "unnamed")}` },
    tags: spec.tags ?? ["character", "procedural"],
    metadata: {
      width: spec.width ?? 260,
      height: spec.height ?? 520,
      anchor: { x: 130, y: 500 },
      palette,
      displayName: spec.displayName ?? spec.name ?? "角色",
      actions: HUMAN_CHARACTER_ACTIONS,
      expressions: HUMAN_CHARACTER_EXPRESSIONS,
      views: populatedViews,
      // `shape` is kept for back-compat (renderers without view support
      // pick this up as the canonical front view).
      shape: shapeFront,
      ...(shapesBundle ? { shapes: shapesBundle } : {}),
      references: spec.references ?? [],
      builtBy: "scripts/build-character-shape.ts",
    },
    license: {
      type: "internal-generated",
      author: "Cucumber Engine",
      sourceUrl: "",
      commercialUse: true,
      needAttribution: false,
    },
  };
  process.stdout.write(JSON.stringify(manifest));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "_")
    .replace(/^_+|_+$/g, "") || "asset";
}

main();
