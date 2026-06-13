import { Hono } from "hono";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { getTtsProvider } from "../services/tts/index.js";
import type { TtsSynthesizeOptions } from "../services/tts/types.js";
import { getTtsAudio, getTtsAudioMeta, listTtsAudio, upsertTtsAudio } from "../repo/ttsAudio.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const legacyDiskCache = resolve(repoRoot, "data", "tts-cache");

export const ttsRoute = new Hono();

const FORMAT_MIME: Record<"mp3" | "wav", string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function cacheKey(opts: TtsSynthesizeOptions, providerName: string): string {
  return createHash("sha256")
    .update(JSON.stringify({
      p: providerName,
      v: opts.voice ?? "",
      e: opts.emotion ?? "",
      s: opts.speedRate ?? 1,
      h: opts.pitchRate ?? 1,
      f: opts.format ?? "mp3",
      t: opts.text,
    }))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Serve cached audio. Reads from the `tts_audio` table; falls back to the
 * legacy on-disk cache for hashes synthesized before the DB migration.
 *
 * Filename is `<hash>.<format>`. The hash + extension guard against path
 * injection — anything else returns 400.
 */
ttsRoute.get("/audio/:filename", async (c) => {
  const filename = c.req.param("filename");
  const m = filename.match(/^([a-f0-9]{32})\.(mp3|wav)$/);
  if (!m) return c.json({ error: "invalid_filename" }, 400);
  const [, hash, ext] = m;

  const row = getTtsAudio(hash);
  if (row) {
    // `row.audio` is a Node Buffer (backed by a real ArrayBuffer at runtime);
    // wrap it in a plain Uint8Array view so it satisfies the (DOM) BodyInit
    // type without copying the bytes.
    const body = new Uint8Array(
      row.audio.buffer as ArrayBuffer,
      row.audio.byteOffset,
      row.audio.byteLength,
    );
    return new Response(body, {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(row.sizeBytes),
        "Cache-Control": "public, max-age=31536000",
      },
    });
  }

  // Read-through to the legacy on-disk cache
  const diskPath = resolve(legacyDiskCache, `${hash}.${ext}`);
  if (existsSync(diskPath)) {
    const data = await readFile(diskPath);
    return new Response(data, {
      headers: {
        "Content-Type": FORMAT_MIME[ext as "mp3" | "wav"],
        "Cache-Control": "public, max-age=31536000",
      },
    });
  }
  return c.json({ error: "not_found" }, 404);
});

/**
 * Synthesize speech from text. Stores blob + viseme timing in the DB
 * `tts_audio` table; future requests for the same (provider, voice,
 * emotion, text) tuple hit the cache and don't burn credits.
 *
 * Request body:
 *   { text, voice?, emotion?, speedRate?, pitchRate?, format? }
 *
 * Response:
 *   {
 *     audioUrl: "/api/tts/audio/<hash>.<ext>",
 *     durationSec, visemes, words?, provider, voice, cached
 *   }
 */
ttsRoute.post("/synthesize", async (c) => {
  let body: TtsSynthesizeOptions;
  try {
    body = (await c.req.json()) as TtsSynthesizeOptions;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!body?.text || typeof body.text !== "string" || !body.text.trim()) {
    return c.json({ error: "missing_text" }, 400);
  }
  if (body.text.length > 1000) {
    return c.json({ error: "text_too_long", maxChars: 1000 }, 400);
  }

  const provider = getTtsProvider();
  const hash = cacheKey(body, provider.name);

  // Cache lookup — DB first, then the legacy disk cache via sidecar JSON
  // (we don't promote disk-cached audio into the DB automatically; it'll
  // be re-synthesized on a new request, which is the natural migration).
  const meta = getTtsAudioMeta(hash);
  if (meta) {
    return c.json({
      audioUrl: `/api/tts/audio/${hash}.${meta.format}`,
      durationSec: meta.durationSec,
      visemes: meta.visemes,
      words: meta.words,
      provider: meta.provider,
      voice: meta.voice,
      cached: true,
    });
  }

  let result;
  try {
    result = await provider.synthesize(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: "tts_failed", message: msg, provider: provider.name }, 502);
  }

  upsertTtsAudio({
    hash,
    text: body.text,
    voice: result.voice,
    emotion: body.emotion ?? null,
    provider: result.provider,
    format: result.format,
    mime: FORMAT_MIME[result.format],
    durationSec: result.durationSec,
    visemes: result.visemes,
    words: result.words,
    audio: result.audio,
  });

  return c.json({
    audioUrl: `/api/tts/audio/${hash}.${result.format}`,
    durationSec: result.durationSec,
    visemes: result.visemes,
    words: result.words,
    provider: result.provider,
    voice: result.voice,
    cached: false,
  });
});

/**
 * List the most recent N entries in the TTS audio cache (no blob).
 * Used by the UI's "audio library" affordance and for sanity checks.
 *
 *   GET /api/tts/cache?limit=50
 */
ttsRoute.get("/cache", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  return c.json({ audios: listTtsAudio(limit) });
});

/**
 * Configured voices + emotions. Hard-coded — Alibaba doesn't expose a
 * runtime listing for these and the catalogue is stable.
 */
/**
 * Batch-synthesize every dialogue / narration event in a segment that
 * doesn't already have an `audioUrl`. Patches the project in place and
 * returns the updated project plus a summary of what was generated.
 *
 *   POST /api/tts/segment-generate
 *     { projectId, segmentId, voiceMap?, defaultVoice?, defaultEmotion? }
 *
 *   voiceMap     — { [characterAssetId]: voiceId }
 *                  Pin a specific voice to a character so every line of
 *                  theirs uses the same actor.
 *   defaultVoice — used when a character isn't in voiceMap. Default
 *                  "longxiaochun".
 *
 * Response:
 *   {
 *     project: <updated Project>,
 *     generated: number,
 *     cached:    number,
 *     skipped:   number,
 *     events: [{ eventIndex, status, audioUrl?, durationSec?, error? }]
 *   }
 */
ttsRoute.post("/segment-generate", async (c) => {
  let body: {
    projectId: string;
    segmentId: string;
    voiceMap?: Record<string, string>;
    defaultVoice?: string;
    defaultEmotion?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!body?.projectId || !body?.segmentId) {
    return c.json({ error: "missing_required_fields", required: ["projectId", "segmentId"] }, 400);
  }

  const { getProject, upsertProject } = await import("../repo/projects.js");
  const project = getProject(body.projectId);
  if (!project) return c.json({ error: "project_not_found" }, 404);

  // Locate the segment (linear walk — projects rarely have > 10 chapters)
  let chapterIdx = -1, segmentIdx = -1;
  for (let i = 0; i < project.chapters.length; i++) {
    const si = project.chapters[i].segments.findIndex((s) => s.segmentId === body.segmentId);
    if (si >= 0) { chapterIdx = i; segmentIdx = si; break; }
  }
  if (chapterIdx < 0) return c.json({ error: "segment_not_found" }, 404);

  const segment = project.chapters[chapterIdx].segments[segmentIdx];
  const provider = getTtsProvider();
  const voiceMap = body.voiceMap ?? {};
  const defaultVoice = body.defaultVoice ?? "longxiaochun";
  const defaultEmotion = body.defaultEmotion ?? "neutral";

  let generated = 0, cached = 0, skipped = 0;
  const events: Array<{ eventIndex: number; status: "generated" | "cached" | "skipped" | "error"; audioUrl?: string; durationSec?: number; visemes?: unknown; error?: string }> = [];

  for (let i = 0; i < segment.timeline.length; i++) {
    const ev = segment.timeline[i];
    if (ev.type !== "dialogue" && ev.type !== "narration") continue;
    if (!ev.text || !ev.text.trim()) { skipped++; events.push({ eventIndex: i, status: "skipped" }); continue; }
    if (ev.audioUrl) { skipped++; events.push({ eventIndex: i, status: "skipped", audioUrl: ev.audioUrl }); continue; }

    const voice = ev.voice
      ?? (ev.type === "dialogue" ? voiceMap[ev.target] : undefined)
      ?? defaultVoice;
    const emotion = ev.emotion ?? defaultEmotion;
    const opts: TtsSynthesizeOptions = { text: ev.text, voice, emotion };
    const hash = cacheKey(opts, provider.name);

    const cachedRow = getTtsAudioMeta(hash);
    if (cachedRow) {
      ev.audioUrl = `/api/tts/audio/${hash}.${cachedRow.format}`;
      ev.voice = cachedRow.voice;
      ev.emotion = cachedRow.emotion ?? emotion;
      ev.duration = Math.max(Math.round(cachedRow.durationSec * 10) / 10, 0.5);
      if (ev.type === "dialogue") ev.visemes = cachedRow.visemes;
      cached++;
      events.push({ eventIndex: i, status: "cached", audioUrl: ev.audioUrl, durationSec: ev.duration });
      continue;
    }

    try {
      const result = await provider.synthesize(opts);
      upsertTtsAudio({
        hash,
        text: opts.text,
        voice: result.voice,
        emotion: emotion,
        provider: result.provider,
        format: result.format,
        mime: FORMAT_MIME[result.format],
        durationSec: result.durationSec,
        visemes: result.visemes,
        words: result.words,
        audio: result.audio,
      });
      ev.audioUrl = `/api/tts/audio/${hash}.${result.format}`;
      ev.voice = result.voice;
      ev.emotion = emotion;
      ev.duration = Math.max(Math.round(result.durationSec * 10) / 10, 0.5);
      if (ev.type === "dialogue") ev.visemes = result.visemes;
      generated++;
      events.push({ eventIndex: i, status: "generated", audioUrl: ev.audioUrl, durationSec: ev.duration });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      events.push({ eventIndex: i, status: "error", error: msg });
    }
  }

  const saved = upsertProject(project);
  return c.json({ project: saved, generated, cached, skipped, events });
});

ttsRoute.get("/voices", (c) => {
  return c.json({
    voices: [
      { id: "longxiaochun",  name: "龙小淳", gender: "female", style: "warm",   language: "zh-CN" },
      { id: "longxiaoxia",   name: "龙小夏", gender: "female", style: "lively", language: "zh-CN" },
      { id: "longxiaobai",   name: "龙小白", gender: "female", style: "soft",   language: "zh-CN" },
      { id: "longwan",       name: "龙婉",  gender: "male",   style: "mature", language: "zh-CN" },
      { id: "longcheng",     name: "龙澄",  gender: "male",   style: "calm",   language: "zh-CN" },
      { id: "longhua",       name: "龙华",  gender: "male",   style: "young",  language: "zh-CN" },
      { id: "longxiaocheng", name: "龙小诚", gender: "child", style: "child",  language: "zh-CN" },
    ],
    emotions: ["neutral", "happy", "sad", "angry", "surprised", "calm", "whisper", "shout"],
  });
});
