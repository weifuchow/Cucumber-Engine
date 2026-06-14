// Assemble the delivered assets + segment into a runnable Project + AssetLibrary
// pair (the shapes the engine's evaluateTimeline / renderer consume). Output is
// written next to the assets so qc-render --kind filmstrip can render the whole
// 30s timeline for review.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");

const assets = readdirSync(assetsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(assetsDir, f), "utf8")));

const sceneAsset = assets.find((a) => a.type === "scene");
const characterAndFx = assets.filter((a) => a.type !== "scene");

// The renderer keys scenes by `sceneId`; mirror the asset under that key.
const sceneForLib = { ...sceneAsset, sceneId: sceneAsset.assetId };

const library = {
  globalAssets: [],
  projectAssets: characterAndFx,
  scenes: [sceneForLib],
};

const segment = JSON.parse(readFileSync(join(root, "segment.json"), "utf8"));

const project = {
  projectId: "project_kof_orochi_001",
  title: "KOF · 八神庵 vs 大蛇",
  description: "AI-authored 30s fight segment. Assets via cucumber-asset-generator; motion via the engine's easing/arc/idle-breath system.",
  assetRefs: assets.map((a) => a.assetId),
  chapters: [
    {
      chapterId: "chapter_001",
      title: "封印之地决战",
      sceneId: sceneAsset.assetId,
      characters: characterAndFx.filter((a) => a.type === "character").map((a) => a.assetId),
      transition: { type: "fadeIn", duration: 0.6 },
      segments: [segment],
    },
  ],
  config: {
    resolution: "1280x720",
    fps: 30,
    postFX: { enabled: true, saturate: 1.02, contrast: 1.08, sepia: 0.02, vignette: 0.34, noiseAlpha: 0.08 },
  },
  preview: { activeChapterId: "chapter_001", activeSegmentId: segment.segmentId },
  export: { includeAssets: true, includeTimeline: true },
  aiReserved: { assetGenerationEndpoint: "", timelineGenerationEndpoint: "", acceptedSchemas: [] },
};

writeFileSync(join(root, "library.json"), JSON.stringify(library, null, 2));
writeFileSync(join(root, "project.json"), JSON.stringify(project, null, 2));
console.log(`assembled: ${assets.length} assets · ${project.chapters[0].characters.length} characters · scene ${sceneAsset.assetId}`);
