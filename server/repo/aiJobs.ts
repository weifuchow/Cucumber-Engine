import { db } from "../db/index.js";
import { randomUUID } from "node:crypto";

export type AiJobKind = "asset.generate" | "segment.generate" | "skill.run" | "import.plan";
export type AiJobStatus = "running" | "done" | "error";

export interface AiJob {
  jobId: string;
  kind: AiJobKind;
  status: AiJobStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

interface AiJobRow {
  job_id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  input_json: string;
  output_json: string | null;
  error_text: string | null;
  created_at: number;
  finished_at: number | null;
}

function rowToJob(r: AiJobRow): AiJob {
  return {
    jobId: r.job_id,
    kind: r.kind,
    status: r.status,
    input: JSON.parse(r.input_json),
    output: r.output_json ? JSON.parse(r.output_json) : undefined,
    error: r.error_text ?? undefined,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? undefined,
  };
}

export function createAiJob(kind: AiJobKind, input: unknown): AiJob {
  const jobId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO ai_jobs (job_id, kind, status, input_json, created_at)
     VALUES (?, ?, 'running', ?, ?)`,
  ).run(jobId, kind, JSON.stringify(input), now);
  return { jobId, kind, status: "running", input, createdAt: now };
}

export function finishAiJob(jobId: string, output: unknown): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE ai_jobs SET status='done', output_json=?, finished_at=? WHERE job_id=?`,
  ).run(JSON.stringify(output), now, jobId);
}

export function failAiJob(jobId: string, error: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE ai_jobs SET status='error', error_text=?, finished_at=? WHERE job_id=?`,
  ).run(error, now, jobId);
}

export function getAiJob(jobId: string): AiJob | null {
  const row = db.prepare("SELECT * FROM ai_jobs WHERE job_id = ?").get(jobId) as AiJobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function listAiJobs(limit = 50): AiJob[] {
  const rows = db.prepare("SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as AiJobRow[];
  return rows.map(rowToJob);
}
