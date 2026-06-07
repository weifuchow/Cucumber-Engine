import { Hono } from "hono";
import { generateBeatGrid, snapToBeat } from "../services/audio/beatGrid.js";

export const audioRoute = new Hono();

/**
 * Compute a beat grid from BPM + duration. The frontend timeline editor
 * draws vertical guides at every returned beat and lets users snap
 * camera/effect events to them; the segment generator skill consumes
 * the same data when authoring cuts.
 *
 *   GET /api/audio/beats?bpm=120&duration=30&offset=0.1&downbeatEvery=4
 *
 * Response:
 *   {
 *     bpm: 120,
 *     beats: [0.1, 0.6, 1.1, ...],
 *     downbeats: [0, 4, 8, ...],   // indices into `beats`
 *     downbeatEvery: 4,
 *     durationSec: 30,
 *     offsetSec: 0.1
 *   }
 */
audioRoute.get("/beats", (c) => {
  const bpm = Number(c.req.query("bpm") ?? "");
  const durationSec = Number(c.req.query("duration") ?? "");
  const offsetSec = Number(c.req.query("offset") ?? "0");
  const downbeatEvery = Number(c.req.query("downbeatEvery") ?? "4");
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return c.json({ error: "bpm_required" }, 400);
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return c.json({ error: "duration_required" }, 400);
  }
  const grid = generateBeatGrid({ bpm, durationSec, offsetSec, downbeatEvery });
  return c.json(grid);
});

/**
 * Snap a single time to the nearest beat. Quick helper for the timeline
 * editor's "snap selected event to beat" affordance.
 *
 *   GET /api/audio/snap?time=8.7&bpm=120&duration=30&offset=0
 *
 * Response:
 *   { time: 8.5, snapped: true, beatIndex: 17, isDownbeat: false }
 */
audioRoute.get("/snap", (c) => {
  const time = Number(c.req.query("time") ?? "");
  const bpm = Number(c.req.query("bpm") ?? "");
  const durationSec = Number(c.req.query("duration") ?? "30");
  const offsetSec = Number(c.req.query("offset") ?? "0");
  const tolerance = c.req.query("tolerance") ? Number(c.req.query("tolerance")) : undefined;
  if (!Number.isFinite(time) || !Number.isFinite(bpm) || bpm <= 0) {
    return c.json({ error: "time_and_bpm_required" }, 400);
  }
  const grid = generateBeatGrid({ bpm, durationSec, offsetSec });
  return c.json(snapToBeat(time, grid, tolerance));
});
