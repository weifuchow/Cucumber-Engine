import "./index.js";
import { upsertAsset } from "../repo/assets.js";
import { upsertScene } from "../repo/scenes.js";
import { upsertProject } from "../repo/projects.js";
import { sampleLibrary, sampleProject } from "../../src/data/sampleProject.js";

let assets = 0;
for (const a of sampleLibrary.globalAssets) {
  upsertAsset(a);
  assets++;
}
for (const a of sampleLibrary.projectAssets) {
  upsertAsset(a);
  assets++;
}

let scenes = 0;
for (const s of sampleLibrary.scenes) {
  upsertScene(s);
  scenes++;
}

upsertProject(sampleProject);

console.log(`[db:seed] assets=${assets} scenes=${scenes} projects=1 (project_id=${sampleProject.projectId})`);
