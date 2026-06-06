import { db } from "../db/index.js";
import type { SceneDefinition } from "../../src/types/schema.js";

interface SceneRow {
  scene_id: string;
  name: string;
  scene_json: string;
  updated_at: number;
}

export function listScenes(): SceneDefinition[] {
  const rows = db.prepare("SELECT * FROM scenes ORDER BY updated_at DESC").all() as SceneRow[];
  return rows.map((r) => JSON.parse(r.scene_json) as SceneDefinition);
}

export function upsertScene(scene: SceneDefinition): SceneDefinition {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO scenes (scene_id, name, scene_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(scene_id) DO UPDATE SET
       name = excluded.name,
       scene_json = excluded.scene_json,
       updated_at = excluded.updated_at`,
  ).run(scene.sceneId, scene.name, JSON.stringify(scene), now);
  return scene;
}
