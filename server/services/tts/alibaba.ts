// Alibaba DashScope CosyVoice TTS provider.
//
// Wire reference: https://help.aliyun.com/zh/dashscope/developer-reference/cosyvoice-quick-start
// Endpoint: WebSocket wss://dashscope.aliyuncs.com/api-ws/v1/inference
// Auth:     `Authorization: Bearer <DASHSCOPE_API_KEY>` set as a request header
//           on the WebSocket upgrade.
//
// We use CosyVoice in `text-to-speech` task mode which streams MP3 audio
// chunks back as base64 frames, plus a final `result-finished` event that
// includes word-level timing when `enable_words: true` is set.
//
// The Node `ws` package isn't a dependency yet; we use the built-in
// undici WebSocket polyfill (Node 22+). Falls back to throwing if the
// global WebSocket isn't available.

import { synthesizeVisemesFromText, synthesizeVisemesFromWords } from "./pinyinViseme.js";
import type {
  TtsProvider,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  WordTiming,
} from "./types.js";

const ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

interface CosyResponse {
  header: {
    task_id: string;
    event: "task-started" | "result-generated" | "task-finished" | "task-failed";
    error_code?: string;
    error_message?: string;
  };
  payload?: {
    output?: {
      audio?: { data?: string };
      sentence?: {
        words?: Array<{ text: string; begin_time: number; end_time: number }>;
      };
    };
    usage?: { duration?: number };
  };
}

export class AlibabaCosyVoiceProvider implements TtsProvider {
  readonly name = "alibaba-cosyvoice";

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("AlibabaCosyVoiceProvider: apiKey is required");
  }

  async synthesize(opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this Node runtime — upgrade to Node 22+");
    }
    const ws = new WebSocket(ENDPOINT, {
      // Node-fetch undici options aren't typed in lib.dom.d.ts so we cast.
      // The Authorization header rides the WebSocket upgrade request.
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-DashScope-DataInspection": "enable",
      },
    } as unknown as undefined);

    const audioChunks: Buffer[] = [];
    const allWords: WordTiming[] = [];
    let duration = 0;
    const taskId = randomTaskId();

    return new Promise<TtsSynthesizeResult>((resolveOuter, rejectOuter) => {
      const reject = (err: Error) => {
        try { ws.close(); } catch {/* ignore */}
        rejectOuter(err);
      };

      ws.addEventListener("open", () => {
        // Model selection: default to cosyvoice-v1, which is what most
        // freshly-issued DashScope keys have permission for. v2 is
        // opt-in per account and returns error 418 when not enabled.
        // Override via `CUCUMBER_TTS_MODEL` env if you do have v2 access.
        const model = process.env.CUCUMBER_TTS_MODEL ?? "cosyvoice-v1";
        const runTask = {
          header: { action: "run-task", task_id: taskId, streaming: "duplex" },
          payload: {
            task_group: "audio",
            task: "tts",
            function: "SpeechSynthesizer",
            model,
            parameters: {
              text_type: "PlainText",
              voice: opts.voice ?? "longxiaochun",
              format: opts.format ?? "mp3",
              sample_rate: 22050,
              volume: 50,
              rate: opts.speedRate ?? 1.0,
              pitch: opts.pitchRate ?? 1.0,
              enable_words: true,
              // CosyVoice v1 doesn't accept instruct; v2 expects
              // `instruct_text`. We only set it on v2 to avoid 418s.
              ...(opts.emotion && model.startsWith("cosyvoice-v2")
                ? { instruct_text: `请用${opts.emotion}的情绪说话` }
                : {}),
            },
            input: {},
          },
        };
        ws.send(JSON.stringify(runTask));
      });

      ws.addEventListener("message", async (raw) => {
        // Node 22+ Undici delivers binary frames as Blob; older runtimes
        // (and browser polyfills) deliver ArrayBuffer / Buffer. Normalize
        // before deciding what to do with the frame.
        let data: string | Buffer;
        if (typeof raw.data === "string") {
          data = raw.data;
        } else if (raw.data instanceof Blob) {
          data = Buffer.from(await raw.data.arrayBuffer());
        } else if (raw.data instanceof ArrayBuffer) {
          data = Buffer.from(raw.data);
        } else if (Buffer.isBuffer(raw.data)) {
          data = raw.data;
        } else {
          // Best-effort fallback — unknown wire frame type.
          return;
        }
        if (typeof data !== "string") {
          audioChunks.push(data);
          return;
        }
        let msg: CosyResponse;
        try { msg = JSON.parse(data); } catch { return; }
        const ev = msg.header.event;
        if (ev === "task-started") {
          // Send the text and signal finish.
          ws.send(JSON.stringify({
            header: { action: "continue-task", task_id: taskId, streaming: "duplex" },
            payload: { input: { text: opts.text } },
          }));
          ws.send(JSON.stringify({
            header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
            payload: { input: {} },
          }));
        } else if (ev === "result-generated") {
          const audioB64 = msg.payload?.output?.audio?.data;
          if (audioB64) audioChunks.push(Buffer.from(audioB64, "base64"));
          const words = msg.payload?.output?.sentence?.words;
          if (Array.isArray(words)) {
            for (const w of words) {
              allWords.push({ word: w.text, startSec: w.begin_time / 1000, endSec: w.end_time / 1000 });
            }
          }
        } else if (ev === "task-finished") {
          duration = (msg.payload?.usage?.duration ?? 0) / 1000;
          ws.close();
          const audio = Buffer.concat(audioChunks);
          // duration fallback: estimate ~0.18s per CJK char if usage absent
          const fallbackDur = Math.max(opts.text.length * 0.18, 1);
          const finalDur = duration > 0 ? duration : fallbackDur;
          const visemes = allWords.length
            ? synthesizeVisemesFromWords(allWords, finalDur)
            : synthesizeVisemesFromText(opts.text, finalDur);
          resolveOuter({
            audio,
            format: opts.format ?? "mp3",
            durationSec: finalDur,
            words: allWords.length ? allWords : undefined,
            visemes,
            provider: this.name,
            voice: opts.voice ?? "longxiaochun",
          });
        } else if (ev === "task-failed") {
          reject(new Error(`Alibaba CosyVoice ${msg.header.error_code ?? ""}: ${msg.header.error_message ?? "unknown error"}`));
        }
      });

      ws.addEventListener("error", (err) => {
        const msg = err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
        reject(new Error(`WebSocket error: ${msg}`));
      });

      ws.addEventListener("close", () => {
        // If we never resolved (no task-finished), surface as an error.
        if (!duration) {
          // Promise may have already settled; this is a no-op then.
          reject(new Error("WebSocket closed before TTS task finished"));
        }
      });
    });
  }
}

function randomTaskId(): string {
  return `cucumber_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
