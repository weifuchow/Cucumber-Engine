import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAiJob, finishAiJob, failAiJob, listAiJobs, getAiJob } from "../repo/aiJobs.js";
import { runAssetGeneration, runSegmentGeneration, runImportPlanning, type AssetGenerationInput, type SegmentGenerationInput, type ImportPlanInput } from "../ai/runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const importTmpDir = resolve(repoRoot, "data", "import-tmp");

export const aiRoute = new Hono();

aiRoute.get("/jobs", (c) => c.json({ jobs: listAiJobs() }));
aiRoute.get("/jobs/:id", (c) => {
  const job = getAiJob(c.req.param("id"));
  return job ? c.json(job) : c.json({ error: "not_found" }, 404);
});

aiRoute.post("/asset/generate", async (c) => {
  const body = (await c.req.json()) as AssetGenerationInput;
  if (!body?.prompt || !body?.type || !body?.scope) {
    return c.json({ error: "missing_required_fields", required: ["prompt", "type", "scope"] }, 400);
  }
  const job = createAiJob("asset.generate", body);

  return streamSSE(c, async (stream) => {
    let final: unknown = null;
    try {
      for await (const ev of runAssetGeneration(job.jobId, body)) {
        await stream.writeSSE({ event: ev.kind, data: JSON.stringify(ev) });
        if (ev.kind === "done") final = ev.result;
        if (ev.kind === "error") {
          failAiJob(job.jobId, ev.error);
          return;
        }
      }
      finishAiJob(job.jobId, final);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ kind: "error", error: msg }) });
      failAiJob(job.jobId, msg);
    }
  });
});

aiRoute.post("/segment/generate", async (c) => {
  const body = (await c.req.json()) as SegmentGenerationInput;
  if (!body?.prompt || !body?.projectId) {
    return c.json({ error: "missing_required_fields", required: ["prompt", "projectId"] }, 400);
  }
  const job = createAiJob("segment.generate", body);

  return streamSSE(c, async (stream) => {
    let final: unknown = null;
    try {
      for await (const ev of runSegmentGeneration(job.jobId, body)) {
        await stream.writeSSE({ event: ev.kind, data: JSON.stringify(ev) });
        if (ev.kind === "done") final = ev.result;
        if (ev.kind === "error") {
          failAiJob(job.jobId, ev.error);
          return;
        }
      }
      finishAiJob(job.jobId, final);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ kind: "error", error: msg }) });
      failAiJob(job.jobId, msg);
    }
  });
});

/**
 * Upload N image files to a server-side tmp directory and return their
 * absolute paths so subsequent skill runs can `Read` them directly. The
 * uploaded files persist until the user is finished with the import flow
 * (we don't auto-clean — they're cheap, and the skill needs them around
 * across multiple AI invocations).
 *
 * Request: multipart/form-data with field `files` (one or more).
 * Response: { paths: string[] }
 */
aiRoute.post("/import/upload", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (!files.length) return c.json({ error: "no_files" }, 400);

  await mkdir(importTmpDir, { recursive: true });
  const stamp = Date.now().toString(36);
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
    const dest = resolve(importTmpDir, `${stamp}_${i}_${safe}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(dest, buf);
    paths.push(dest);
  }
  return c.json({ paths });
});

/**
 * Plan how to ingest a batch of uploaded images. The AI Reads each image,
 * groups them into asset entries, and emits a plan the frontend can confirm.
 */
aiRoute.post("/import/plan", async (c) => {
  const body = (await c.req.json()) as ImportPlanInput;
  if (!Array.isArray(body?.imagePaths) || !body.imagePaths.length) {
    return c.json({ error: "missing_imagePaths" }, 400);
  }
  const job = createAiJob("import.plan", body);

  return streamSSE(c, async (stream) => {
    let final: unknown = null;
    try {
      for await (const ev of runImportPlanning(job.jobId, body)) {
        await stream.writeSSE({ event: ev.kind, data: JSON.stringify(ev) });
        if (ev.kind === "done") final = ev.result;
        if (ev.kind === "error") {
          failAiJob(job.jobId, ev.error);
          return;
        }
      }
      finishAiJob(job.jobId, final);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ kind: "error", error: msg }) });
      failAiJob(job.jobId, msg);
    }
  });
});
