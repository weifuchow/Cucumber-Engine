// CLI wrapper around src/importers/spineImporter.ts so the
// `cucumber-spine-fetcher` skill can turn a downloaded Spine JSON file
// into an AssetManifest without writing browser-only File / FileReader
// boilerplate.
//
// Usage:
//
//   # file path arg
//   npx tsx scripts/import-spine-json.ts \
//     --file /tmp/spine-imports/spineboy/spineboy.json \
//     --scope project \
//     --name "Spineboy" \
//     --source-url "https://esotericsoftware.com/spine-examples" \
//     --license-type "Spine Examples License" \
//     --license-author "Esoteric Software" \
//     --license-source-url "https://esotericsoftware.com/spine-examples-license" \
//     --license-commercial false \
//     --license-attribution true
//
//   # stdin
//   curl -sS <url>/spineboy.json | npx tsx scripts/import-spine-json.ts --scope project
//
// Output: a single JSON object printed to stdout — the AssetManifest produced by
// spineJsonToManifest, with optional license / name / sourceUrl overrides applied
// on top. The skill wraps this in {"ok":true,"manifest": ...} as the final line.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { spineJsonToManifest } from "../src/importers/spineImporter.ts";
import type { AssetScope } from "../src/types/schema.ts";

interface Args {
  file?: string;
  scope: AssetScope;
  name?: string;
  assetId?: string;
  sourceUrl?: string;
  tags?: string[];
  license: {
    type?: string;
    author?: string;
    sourceUrl?: string;
    commercialUse?: boolean;
    needAttribution?: boolean;
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = { scope: "project", license: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--file") args.file = next();
    else if (a === "--scope") args.scope = (next() as AssetScope) ?? "project";
    else if (a === "--name") args.name = next();
    else if (a === "--assetId") args.assetId = next();
    else if (a === "--source-url") args.sourceUrl = next();
    else if (a === "--tags") args.tags = next().split(",").map((t) => t.trim()).filter(Boolean);
    else if (a === "--license-type") args.license.type = next();
    else if (a === "--license-author") args.license.author = next();
    else if (a === "--license-source-url") args.license.sourceUrl = next();
    else if (a === "--license-commercial") args.license.commercialUse = next() === "true";
    else if (a === "--license-attribution") args.license.needAttribution = next() === "true";
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const text = args.file ? readFileSync(args.file, "utf8") : readFileSync(0, "utf8");
  const json = JSON.parse(text) as Parameters<typeof spineJsonToManifest>[0];

  const originalFile = args.file ? basename(args.file) : (args.name ?? "spine.json");
  const manifest = spineJsonToManifest(json, originalFile, args.scope);

  if (args.name) manifest.name = args.name;
  if (args.assetId) manifest.assetId = args.assetId;
  if (args.sourceUrl) {
    manifest.source = { ...manifest.source, originalFile: args.sourceUrl };
    manifest.files = { ...manifest.files, sourceUrl: args.sourceUrl };
  }
  if (args.tags && args.tags.length) {
    const merged = new Set([...(manifest.tags ?? []), ...args.tags]);
    manifest.tags = Array.from(merged);
  }
  if (args.license.type !== undefined) manifest.license.type = args.license.type;
  if (args.license.author !== undefined) manifest.license.author = args.license.author;
  if (args.license.sourceUrl !== undefined) manifest.license.sourceUrl = args.license.sourceUrl;
  if (args.license.commercialUse !== undefined) manifest.license.commercialUse = args.license.commercialUse;
  if (args.license.needAttribution !== undefined) manifest.license.needAttribution = args.license.needAttribution;

  process.stdout.write(JSON.stringify(manifest));
}

main();
