// CLI that turns a high-level CharacterSpec JSON into a full ProceduralShape
// JSON. The AI authoring path (cucumber-asset-generator) is supposed to call
// this script instead of writing ~150 primitives by hand — the resulting
// shape is guaranteed to hit the cel-shading bar (almond eyes, layered hair,
// occlusion shadows, outline strokes, ≥ 4 actions).
//
// Usage:
//
//   # spec from stdin
//   echo '{"palette":{...},"hairStyle":"fringe","hat":"straw"}' \
//     | npx tsx scripts/build-character-shape.ts
//
//   # spec from --spec-file
//   npx tsx scripts/build-character-shape.ts --spec-file /tmp/spec.json
//
//   # spec inline
//   npx tsx scripts/build-character-shape.ts --spec '{"hairStyle":"spiky"}'
//
//   # full manifest (wraps the shape in the boilerplate AssetManifest)
//   npx tsx scripts/build-character-shape.ts --emit manifest --spec '...'
//
// Output is a single JSON object printed to stdout. The shell calling this
// script slurps it and embeds it in the manifest under metadata.shape.

import { readFileSync } from "node:fs";
import {
  buildHumanCharacterShape,
  HUMAN_CHARACTER_ACTIONS,
  HUMAN_CHARACTER_EXPRESSIONS,
  type HumanCharacterOptions,
} from "../src/data/characterShapes.ts";

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

function parseArgs(argv: string[]): { emit: "shape" | "manifest"; spec: FullSpec } {
  let emit: "shape" | "manifest" = "shape";
  let specText: string | null = null;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--emit") emit = argv[++i] === "manifest" ? "manifest" : "shape";
    else if (arg === "--spec") specText = argv[++i];
    else if (arg === "--spec-file") specText = readFileSync(argv[++i], "utf8");
  }

  if (specText === null) {
    // read from stdin
    specText = readFileSync(0, "utf8");
  }

  const spec = JSON.parse(specText || "{}") as FullSpec;
  return { emit, spec };
}

function main() {
  const { emit, spec } = parseArgs(process.argv);

  const shape = buildHumanCharacterShape({
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
  });

  if (emit === "shape") {
    process.stdout.write(JSON.stringify(shape));
    return;
  }

  // emit === "manifest"
  const palette = spec.palette ?? {
    body: "#c14a3a",
    skin: "#f0bf95",
    hair: "#2a1e16",
    pants: "#3b6090",
  };
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
      shape,
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
