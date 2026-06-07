// Mock TTS provider — for dev without a DashScope API key. Produces a
// short silent WAV plus synthesized viseme frames derived from the input
// text. Good enough to verify the renderer's lip-sync wiring offline.

import { synthesizeVisemesFromText } from "./pinyinViseme.js";
import type {
  TtsProvider,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
} from "./types.js";

export class MockTtsProvider implements TtsProvider {
  readonly name = "mock";

  async synthesize(opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    const duration = Math.max(opts.text.length * 0.18, 1);
    const audio = makeSilentWav(duration, 22050);
    return {
      audio,
      format: "wav",
      durationSec: duration,
      visemes: synthesizeVisemesFromText(opts.text, duration),
      provider: this.name,
      voice: opts.voice ?? "mock-default",
    };
  }
}

/**
 * Generate a minimal PCM16 mono silent WAV of the requested duration.
 * Header is the standard 44-byte canonical layout; data is all-zero PCM.
 */
function makeSilentWav(durationSec: number, sampleRate: number): Uint8Array {
  const samples = Math.floor(durationSec * sampleRate);
  const dataSize = samples * 2; // PCM16 mono
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);
  // RIFF header
  writeStr(buf, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(buf, 8, "WAVE");
  // fmt chunk
  writeStr(buf, 12, "fmt ");
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  // data chunk
  writeStr(buf, 36, "data");
  view.setUint32(40, dataSize, true);
  // (data is already zero from Uint8Array init)
  return buf;
}

function writeStr(buf: Uint8Array, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) buf[offset + i] = s.charCodeAt(i);
}
