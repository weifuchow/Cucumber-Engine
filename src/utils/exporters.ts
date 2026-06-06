import type { AssetLibrary, Project } from "../types/schema";

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildProjectExport(project: Project, library: AssetLibrary) {
  const assetIds = new Set(project.assetRefs);
  return {
    schema: "cucumber-engine.project.v1",
    exportedAt: new Date().toISOString(),
    project,
    scenes: library.scenes.filter((scene) => assetIds.has(scene.sceneId)),
    assets: [...library.globalAssets, ...library.projectAssets].filter((asset) => assetIds.has(asset.assetId)),
  };
}

export function buildAssetManifestExport(library: AssetLibrary) {
  return {
    schema: "cucumber-engine.asset-manifest.v1",
    exportedAt: new Date().toISOString(),
    globalAssets: library.globalAssets,
    projectAssets: library.projectAssets,
  };
}
