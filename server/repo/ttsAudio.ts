// CRUD for the tts_audio table. Audio bytes live in the DB as BLOB
// so the project's TTS cache travels with the SQLite file — backing up
// `data/cucumber.db` now backs up every synthesized line as well.
//
// On-disk file cache under `data/tts-cache/` is kept ONLY as a transitional
// read-through. Brand-new synthesis goes straight to the DB.

import { db } from "../db/index.js";
import type { VisemeFrame, WordTiming } from "../services/tts/types.js";

export interface TtsAudioRow {
  hash: string;
  text: string;
  voice: string;
  emotion: string | null;
  provider: string;
  format: "mp3" | "wav";
  mime: string;
  durationSec: number;
  visemes: VisemeFrame[];
  words: WordTiming[] | null;
  audio: Buffer;
  sizeBytes: number;
  createdAt: number;
}

interface TtsAudioRowRaw {
  hash: string;
  text: string;
  voice: string;
  emotion: string | null;
  provider: string;
  format: "mp3" | "wav";
  mime: string;
  duration_sec: number;
  visemes_json: string;
  words_json: string | null;
  audio_blob: Buffer;
  size_bytes: number;
  created_at: number;
}

function rowToRecord(row: TtsAudioRowRaw): TtsAudioRow {
  return {
    hash: row.hash,
    text: row.text,
    voice: row.voice,
    emotion: row.emotion,
    provider: row.provider,
    format: row.format,
    mime: row.mime,
    durationSec: row.duration_sec,
    visemes: JSON.parse(row.visemes_json) as VisemeFrame[],
    words: row.words_json ? (JSON.parse(row.words_json) as WordTiming[]) : null,
    audio: row.audio_blob,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export interface UpsertTtsAudioInput {
  hash: string;
  text: string;
  voice: string;
  emotion?: string | null;
  provider: string;
  format: "mp3" | "wav";
  mime: string;
  durationSec: number;
  visemes: VisemeFrame[];
  words?: WordTiming[];
  audio: Buffer | Uint8Array;
}

export function upsertTtsAudio(input: UpsertTtsAudioInput): TtsAudioRow {
  const buf = Buffer.isBuffer(input.audio) ? input.audio : Buffer.from(input.audio);
  db.prepare(`
    INSERT INTO tts_audio (hash, text, voice, emotion, provider, format, mime,
                           duration_sec, visemes_json, words_json, audio_blob, size_bytes)
    VALUES (@hash, @text, @voice, @emotion, @provider, @format, @mime,
            @durationSec, @visemesJson, @wordsJson, @audioBlob, @sizeBytes)
    ON CONFLICT(hash) DO UPDATE SET
      text = excluded.text,
      voice = excluded.voice,
      emotion = excluded.emotion,
      provider = excluded.provider,
      format = excluded.format,
      mime = excluded.mime,
      duration_sec = excluded.duration_sec,
      visemes_json = excluded.visemes_json,
      words_json = excluded.words_json,
      audio_blob = excluded.audio_blob,
      size_bytes = excluded.size_bytes
  `).run({
    hash: input.hash,
    text: input.text,
    voice: input.voice,
    emotion: input.emotion ?? null,
    provider: input.provider,
    format: input.format,
    mime: input.mime,
    durationSec: input.durationSec,
    visemesJson: JSON.stringify(input.visemes),
    wordsJson: input.words ? JSON.stringify(input.words) : null,
    audioBlob: buf,
    sizeBytes: buf.length,
  });
  return getTtsAudio(input.hash)!;
}

export function getTtsAudio(hash: string): TtsAudioRow | null {
  const row = db
    .prepare("SELECT * FROM tts_audio WHERE hash = ?")
    .get(hash) as TtsAudioRowRaw | undefined;
  return row ? rowToRecord(row) : null;
}

/** Lightweight metadata read — skips loading the audio blob. */
export function getTtsAudioMeta(hash: string):
  | (Omit<TtsAudioRow, "audio"> & { audio?: never })
  | null {
  const row = db
    .prepare(
      `SELECT hash, text, voice, emotion, provider, format, mime,
              duration_sec, visemes_json, words_json, size_bytes, created_at
       FROM tts_audio WHERE hash = ?`,
    )
    .get(hash) as Omit<TtsAudioRowRaw, "audio_blob"> | undefined;
  if (!row) return null;
  return {
    hash: row.hash,
    text: row.text,
    voice: row.voice,
    emotion: row.emotion,
    provider: row.provider,
    format: row.format,
    mime: row.mime,
    durationSec: row.duration_sec,
    visemes: JSON.parse(row.visemes_json) as VisemeFrame[],
    words: row.words_json ? (JSON.parse(row.words_json) as WordTiming[]) : null,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export function listTtsAudio(limit = 100): Array<Omit<TtsAudioRow, "audio">> {
  const rows = db
    .prepare(
      `SELECT hash, text, voice, emotion, provider, format, mime,
              duration_sec, visemes_json, words_json, size_bytes, created_at
       FROM tts_audio ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Omit<TtsAudioRowRaw, "audio_blob">>;
  return rows.map((row) => ({
    hash: row.hash,
    text: row.text,
    voice: row.voice,
    emotion: row.emotion,
    provider: row.provider,
    format: row.format,
    mime: row.mime,
    durationSec: row.duration_sec,
    visemes: JSON.parse(row.visemes_json) as VisemeFrame[],
    words: row.words_json ? (JSON.parse(row.words_json) as WordTiming[]) : null,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }));
}

export function deleteTtsAudio(hash: string): boolean {
  const r = db.prepare("DELETE FROM tts_audio WHERE hash = ?").run(hash);
  return r.changes > 0;
}
