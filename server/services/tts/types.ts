// Shared TTS types. Used by every provider and consumed by the route layer
// and the front-end timeline editor.

/** Coarse viseme set — 7 lip shapes that drive the character's mouth shape. */
export type Viseme =
  | "rest"        // closed neutral (silence, m/b/p closures)
  | "open"        // wide "a" (ah, an, ang)
  | "narrow"      // tight "i" (yi, in, ing — slight smile)
  | "round"       // rounded "u/o" (wu, uo, wo — pursed)
  | "mid"         // mid "e" (e, en, eng)
  | "wide"        // diphthong "ai/ei" (open + lateral)
  | "ee";         // bright "ie/ye" (smile + tongue forward)

export const VISEMES: readonly Viseme[] = [
  "rest", "open", "narrow", "round", "mid", "wide", "ee",
];

/** One viseme keyframe along the synthesized audio timeline. */
export interface VisemeFrame {
  /** Seconds from audio start. */
  time: number;
  /** Active viseme until the next frame. */
  viseme: Viseme;
  /** Optional source token (character/syllable) — useful for debugging. */
  token?: string;
}

/** A word-level alignment if the provider supports it (CosyVoice does). */
export interface WordTiming {
  word: string;
  startSec: number;
  endSec: number;
}

export interface TtsSynthesizeOptions {
  /** UTF-8 text to synthesize. */
  text: string;
  /**
   * Voice id. For Alibaba CosyVoice common ones:
   *   "longxiaochun" — female, warm
   *   "longxiaoxia"  — female, lively
   *   "longwan"      — male, mature
   *   "longcheng"    — male, calm
   *   "longhua"      — male, young
   */
  voice?: string;
  /**
   * Emotion / style cue. Alibaba CosyVoice 2 supports natural-language style
   * prompts in SSML-like form. We pass it through verbatim when present.
   * Examples: "calm", "angry", "happy", "sad", "surprised", "whisper".
   */
  emotion?: string;
  /** 0.5 to 2.0; default 1.0. */
  speedRate?: number;
  /** 0.5 to 2.0; default 1.0. Voice pitch. */
  pitchRate?: number;
  /** Output format. `mp3` is the default and what the engine plays. */
  format?: "mp3" | "wav";
}

export interface TtsSynthesizeResult {
  /** Raw audio bytes. The route layer is responsible for writing them to disk. */
  audio: Uint8Array;
  format: "mp3" | "wav";
  durationSec: number;
  /** Word-level alignment, populated only if the provider returned it. */
  words?: WordTiming[];
  /**
   * Viseme keyframes. The TTS service synthesizes these from `words` when
   * available, otherwise from the input text (even distribution + pinyin
   * heuristic). Always populated so the renderer never has to fall back.
   */
  visemes: VisemeFrame[];
  /** Echo back the provider name + voice for the manifest's source field. */
  provider: string;
  voice: string;
}

/** Provider interface — every TTS backend implements this. */
export interface TtsProvider {
  readonly name: string;
  synthesize(opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult>;
}
