import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import "./db/index.js";
import { assetsRoute } from "./routes/assets.js";
import { projectsRoute, scenesRoute } from "./routes/projects.js";
import { aiRoute } from "./routes/ai.js";
import { ttsRoute } from "./routes/tts.js";
import { audioRoute } from "./routes/audio.js";
import { exportRoute } from "./routes/export.js";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.route("/api/assets", assetsRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/scenes", scenesRoute);
app.route("/api/ai", aiRoute);
app.route("/api/tts", ttsRoute);
app.route("/api/audio", audioRoute);
app.route("/api/export", exportRoute);

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});
