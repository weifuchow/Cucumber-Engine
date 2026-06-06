import { Hono } from "hono";
import { listProjects, getProject, upsertProject, deleteProject } from "../repo/projects.js";
import { listScenes, upsertScene } from "../repo/scenes.js";
import type { Project, SceneDefinition } from "../../src/types/schema.js";

export const projectsRoute = new Hono();

projectsRoute.get("/", (c) => c.json({ projects: listProjects() }));

projectsRoute.get("/:id", (c) => {
  const p = getProject(c.req.param("id"));
  if (!p) return c.json({ error: "not_found" }, 404);
  return c.json(p);
});

projectsRoute.post("/", async (c) => {
  const body = (await c.req.json()) as Project;
  if (!body?.projectId || !body?.title) return c.json({ error: "missing_required_fields" }, 400);
  return c.json(upsertProject(body), 201);
});

projectsRoute.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as Project;
  if (body.projectId !== id) return c.json({ error: "id_mismatch" }, 400);
  return c.json(upsertProject(body));
});

projectsRoute.delete("/:id", (c) => {
  const ok = deleteProject(c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// Scenes — nested under projects for namespacing, but global in DB.
export const scenesRoute = new Hono();
scenesRoute.get("/", (c) => c.json({ scenes: listScenes() }));
scenesRoute.post("/", async (c) => {
  const body = (await c.req.json()) as SceneDefinition;
  if (!body?.sceneId || !body?.name) return c.json({ error: "missing_required_fields" }, 400);
  return c.json(upsertScene(body), 201);
});
