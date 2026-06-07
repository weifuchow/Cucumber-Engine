// TTS provider registry. Single env-var driven factory so the route layer
// stays agnostic of which backend is configured.
//
// Selection:
//   - DASHSCOPE_API_KEY set → AlibabaCosyVoiceProvider
//   - otherwise → MockTtsProvider (silent WAV + viseme estimates)
//
// Set CUCUMBER_TTS_PROVIDER=mock to force the mock provider even when an
// API key is present (useful for offline regression tests).

import { AlibabaCosyVoiceProvider } from "./alibaba.js";
import { MockTtsProvider } from "./mock.js";
import type { TtsProvider } from "./types.js";

export type { TtsProvider, TtsSynthesizeOptions, TtsSynthesizeResult, Viseme, VisemeFrame, WordTiming } from "./types.js";
export { VISEMES } from "./types.js";
export {
  synthesizeVisemesFromText,
  synthesizeVisemesFromWords,
  charToViseme,
  finalToViseme,
} from "./pinyinViseme.js";

let cachedProvider: TtsProvider | null = null;

export function getTtsProvider(): TtsProvider {
  if (cachedProvider) return cachedProvider;
  const forceMock = process.env.CUCUMBER_TTS_PROVIDER === "mock";
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (forceMock || !apiKey) {
    cachedProvider = new MockTtsProvider();
  } else {
    cachedProvider = new AlibabaCosyVoiceProvider(apiKey);
  }
  return cachedProvider;
}

/** Test hook — let suites swap the provider without touching env vars. */
export function setTtsProvider(provider: TtsProvider | null) {
  cachedProvider = provider;
}
