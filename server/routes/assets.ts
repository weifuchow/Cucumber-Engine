import { Hono } from "hono";
import { listAssets, getAsset, upsertAsset, deleteAsset } from "../repo/assets.js";
import type { AssetManifest, AssetScope, AssetType } from "../../src/types/schema.js";

export const assetsRoute = new Hono();

assetsRoute.get("/", (c) => {
  const scope = c.req.query("scope") as AssetScope | undefined;
  const type = c.req.query("type") as AssetType | undefined;
  return c.json({ assets: listAssets({ scope, type }) });
});

assetsRoute.get("/:id", (c) => {
  const asset = getAsset(c.req.param("id"));
  if (!asset) return c.json({ error: "not_found" }, 404);
  return c.json(asset);
});

assetsRoute.post("/", async (c) => {
  const body = (await c.req.json()) as AssetManifest;
  if (!body?.assetId || !body?.name || !body?.category || !body?.type || !body?.scope) {
    return c.json({ error: "missing_required_fields", required: ["assetId", "name", "category", "type", "scope"] }, 400);
  }
  const saved = upsertAsset(body);
  return c.json(saved, 201);
});

assetsRoute.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as AssetManifest;
  if (body.assetId !== id) return c.json({ error: "id_mismatch" }, 400);
  return c.json(upsertAsset(body));
});

assetsRoute.delete("/:id", (c) => {
  const ok = deleteAsset(c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
