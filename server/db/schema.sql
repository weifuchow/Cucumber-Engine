-- Cucumber Engine SQLite schema
-- All structured JSON columns store the corresponding TS type from src/types/schema.ts.

CREATE TABLE IF NOT EXISTS assets (
  asset_id      TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('visual','audio')),
  type          TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('global','project')),
  manifest_json TEXT NOT NULL,      -- full AssetManifest
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_assets_scope_type ON assets(scope, type);
CREATE INDEX IF NOT EXISTS idx_assets_category   ON assets(category);

CREATE TABLE IF NOT EXISTS scenes (
  scene_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  scene_json TEXT NOT NULL,         -- full SceneDefinition
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS projects (
  project_id   TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  project_json TEXT NOT NULL,       -- full Project (chapters/segments embedded)
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- AI job runs (per asset/segment generation invocation)
CREATE TABLE IF NOT EXISTS ai_jobs (
  job_id      TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,        -- 'asset.generate' | 'segment.generate' | ...
  status      TEXT NOT NULL,        -- 'running' | 'done' | 'error'
  input_json  TEXT NOT NULL,
  output_json TEXT,
  error_text  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);

-- Synthesized TTS audio. The hash is derived from
-- (provider, voice, emotion, speed, pitch, format, text) so identical
-- requests dedupe naturally. The audio blob and viseme timing are
-- stored together so a single SELECT serves the renderer everything it
-- needs without filesystem detours.
--
-- mime is e.g. "audio/mpeg" / "audio/wav" — used directly as the
-- Content-Type header by the audio file route.
CREATE TABLE IF NOT EXISTS tts_audio (
  hash         TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  voice        TEXT NOT NULL,
  emotion      TEXT,
  provider     TEXT NOT NULL,
  format       TEXT NOT NULL,            -- 'mp3' | 'wav'
  mime         TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  visemes_json TEXT NOT NULL,            -- VisemeFrame[] serialized
  words_json   TEXT,                     -- WordTiming[] serialized (optional)
  audio_blob   BLOB NOT NULL,            -- the actual audio bytes
  size_bytes   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tts_audio_voice ON tts_audio(voice);
