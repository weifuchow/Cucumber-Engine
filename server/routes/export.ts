import { Hono } from "hono";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const exportRoute = new Hono();

/**
 * Best-effort lookup of ffmpeg. Checks the standard install paths so the
 * server doesn't have to require it in PATH (most users running this
 * from a GUI shell won't have /opt/homebrew/bin on $PATH).
 */
function findFfmpeg(): string | null {
  const candidates = [
    process.env.CUCUMBER_FFMPEG,
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/snap/bin/ffmpeg",
    "ffmpeg",
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (p === "ffmpeg") return "ffmpeg";
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * GET /api/export/transcode/probe — reports whether server-side WebM→MP4
 * transcoding is available. Frontend uses this on mount to decide whether
 * to offer an "MP4" option vs the always-on WebM download.
 */
exportRoute.get("/transcode/probe", (c) => {
  const ffmpeg = findFfmpeg();
  return c.json({ available: Boolean(ffmpeg), path: ffmpeg ?? null });
});

/**
 * POST /api/export/transcode — accepts a WebM body (Content-Type
 * video/webm), returns MP4. Pipes both ends through ffmpeg without
 * touching disk so big segments don't blow up the data partition.
 *
 * H.264 baseline + AAC for maximum compatibility. CRF 23 + preset
 * "veryfast" picks a sane quality/speed default for漫剧 segments;
 * tweak via env vars if the user needs different defaults.
 */
exportRoute.post("/transcode", async (c) => {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    return c.json({ error: "ffmpeg_not_found",
      hint: "Install ffmpeg via brew/apt and restart the server, or set CUCUMBER_FFMPEG=/path/to/ffmpeg.",
    }, 503);
  }

  const inputBuffer = Buffer.from(await c.req.arrayBuffer());
  if (inputBuffer.length === 0) {
    return c.json({ error: "empty_body" }, 400);
  }
  if (inputBuffer.length > 200 * 1024 * 1024) {
    return c.json({ error: "input_too_large", maxBytes: 200 * 1024 * 1024 }, 413);
  }

  const args = [
    "-loglevel", "error",
    "-i", "pipe:0",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",   // most Apple/Windows players need this
    "-movflags", "frag_keyframe+empty_moov",  // streamable MP4
    "-c:a", "aac",
    "-b:a", "192k",
    "-f", "mp4",
    "pipe:1",
  ];

  return new Promise<Response>((resolve) => {
    const proc = spawn(ffmpeg, args, { stdio: ["pipe", "pipe", "pipe"] });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
    proc.on("error", (err) => {
      resolve(c.json({ error: "ffmpeg_spawn_failed", message: err.message }, 500));
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString("utf8");
        resolve(c.json({ error: "ffmpeg_failed", code, stderr: stderr.slice(0, 4000) }, 500));
        return;
      }
      const mp4 = Buffer.concat(outChunks);
      resolve(new Response(mp4, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(mp4.length),
          "Content-Disposition": "attachment; filename=\"export.mp4\"",
        },
      }));
    });
    proc.stdin.end(inputBuffer);
  });
});
