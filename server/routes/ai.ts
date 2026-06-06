import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createAiJob, finishAiJob, failAiJob, listAiJobs, getAiJob } from "../repo/aiJobs.js";
import { runAssetGeneration, type AssetGenerationInput } from "../ai/runner.js";

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
