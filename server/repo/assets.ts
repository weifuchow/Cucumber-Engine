import { db } from "../db/index.js";
import type { AssetManifest, AssetScope, AssetType, AssetCategory } from "../../src/types/schema.js";

export interface AssetRow {
  asset_id: string;
  name: string;
  category: AssetCategory;
  type: AssetType;
  scope: AssetScope;
  manifest_json: string;
  created_at: number;
  updated_at: number;
}

function rowToManifest(row: AssetRow): AssetManifest {
  return JSON.parse(row.manifest_json) as AssetManifest;
}

export function listAssets(filter?: { scope?: AssetScope; type?: AssetType }): AssetManifest[] {
  let sql = "SELECT * FROM assets";
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter?.scope) {
    where.push("scope = ?");
    params.push(filter.scope);
  }
  if (filter?.type) {
    where.push("type = ?");
    params.push(filter.type);
  }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY updated_at DESC";
  const rows = db.prepare(sql).all(...params) as AssetRow[];
  return rows.map(rowToManifest);
}

export function getAsset(assetId: string): AssetManifest | null {
  const row = db.prepare("SELECT * FROM assets WHERE asset_id = ?").get(assetId) as AssetRow | undefined;
  return row ? rowToManifest(row) : null;
}

export function upsertAsset(manifest: AssetManifest): AssetManifest {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO assets (asset_id, name, category, type, scope, manifest_json, created_at, updated_at)
     VALUES (@asset_id, @name, @category, @type, @scope, @manifest_json, @now, @now)
     ON CONFLICT(asset_id) DO UPDATE SET
       name = excluded.name,
       category = excluded.category,
       type = excluded.type,
       scope = excluded.scope,
       manifest_json = excluded.manifest_json,
       updated_at = excluded.updated_at`,
  ).run({
    asset_id: manifest.assetId,
    name: manifest.name,
    category: manifest.category,
    type: manifest.type,
    scope: manifest.scope,
    manifest_json: JSON.stringify(manifest),
    now,
  });
  return manifest;
}

export function deleteAsset(assetId: string): boolean {
  const info = db.prepare("DELETE FROM assets WHERE asset_id = ?").run(assetId);
  return info.changes > 0;
}
