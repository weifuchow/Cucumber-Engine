import { db } from "../db/index.js";
import type { Project } from "../../src/types/schema.js";

interface ProjectRow {
  project_id: string;
  title: string;
  description: string | null;
  project_json: string;
  created_at: number;
  updated_at: number;
}

export function listProjects(): Project[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  return rows.map((r) => JSON.parse(r.project_json) as Project);
}

export function getProject(projectId: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId) as ProjectRow | undefined;
  return row ? (JSON.parse(row.project_json) as Project) : null;
}

export function upsertProject(project: Project): Project {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO projects (project_id, title, description, project_json, created_at, updated_at)
     VALUES (@id, @title, @desc, @json, @now, @now)
     ON CONFLICT(project_id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       project_json = excluded.project_json,
       updated_at = excluded.updated_at`,
  ).run({
    id: project.projectId,
    title: project.title,
    desc: project.description ?? null,
    json: JSON.stringify(project),
    now,
  });
  return project;
}

export function deleteProject(projectId: string): boolean {
  return db.prepare("DELETE FROM projects WHERE project_id = ?").run(projectId).changes > 0;
}
