// Finalize an asset manifest's metadata for delivery: tags, references,
// soundEffectIds, scope, license. Reusable; values passed via --json.
//
// node finalize-meta.mjs --in p.json --out final.json --json '{...patch...}'

import { readFileSync, writeFileSync } from "node:fs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const m = JSON.parse(readFileSync(arg("in"), "utf8"));
const manifest = m.manifest ?? m;
const patch = JSON.parse(arg("json", "{}"));

manifest.scope = patch.scope ?? manifest.scope ?? "project";
manifest.tags = [...new Set([...(manifest.tags ?? []), ...(patch.tags ?? [])])];
manifest.source = { ...(manifest.source ?? {}), ...(patch.source ?? { kind: "generated", format: "procedural", originalFile: "built-in" }) };
manifest.files = { ...(manifest.files ?? {}), ...(patch.files ?? { preview: `procedural://${manifest.assetId}` }) };
manifest.metadata.references = patch.references ?? manifest.metadata.references ?? [];
if (patch.soundEffectIds) manifest.metadata.soundEffectIds = patch.soundEffectIds;
if (patch.displayName) manifest.metadata.displayName = patch.displayName;
manifest.license = patch.license ?? manifest.license ?? {
  type: "internal-generated", author: "Cucumber Engine", sourceUrl: "", commercialUse: true, needAttribution: false,
};

writeFileSync(arg("out"), JSON.stringify(manifest, null, 2));
console.log(`finalized ${manifest.assetId} → ${arg("out")}`);
