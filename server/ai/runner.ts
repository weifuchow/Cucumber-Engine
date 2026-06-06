import { query } from "@anthropic-ai/claude-agent-sdk";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export interface AssetGenerationInput {
  prompt: string;            // user description of what to generate
  scope: "global" | "project";
  type: string;              // AssetType
  category?: "visual" | "audio";
  apiBase?: string;          // defaults to http://localhost:3001/api — passed into skill via env
}

export type RunnerEvent =
  | { kind: "start"; jobId: string }
  | { kind: "message"; text: string }
  | { kind: "tool"; name: string; input?: unknown }
  | { kind: "tool_result"; name: string; ok: boolean }
  | { kind: "done"; result?: unknown }
  | { kind: "error"; error: string };

const PROMPT_TEMPLATE = (input: AssetGenerationInput) => `You are an asset registration agent for the Cucumber Engine project.

Use the cucumber-asset-generator Skill. Follow its instructions strictly.

User request:
- type: ${input.type}
- scope: ${input.scope}
- category: ${input.category ?? "(infer)"}
- description: ${input.prompt}

Backend API base URL (use this to POST the manifest):
  ${input.apiBase ?? "http://localhost:3001/api"}

When done, output a final line of pure JSON of shape:
{"ok": true, "assetId": "<id>", "name": "<name>"}
or
{"ok": false, "error": "<reason>"}
`;

export async function* runAssetGeneration(
  jobId: string,
  input: AssetGenerationInput,
  signal?: AbortSignal,
): AsyncGenerator<RunnerEvent> {
  yield { kind: "start", jobId };

  const ac = new AbortController();
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });

  try {
    const q = query({
      prompt: PROMPT_TEMPLATE(input),
      options: {
        cwd: repoRoot,
        abortController: ac,
        skills: ["cucumber-asset-generator"],
        allowedTools: ["Read", "Write", "Edit", "Bash", "WebFetch", "WebSearch", "Grep", "Glob"],
        env: {
          ...process.env,
          CUCUMBER_API_BASE: input.apiBase ?? "http://localhost:3001/api",
        } as Record<string, string>,
      },
    });

    let lastText = "";
    for await (const msg of q) {
      // The SDK yields heterogeneous messages: assistant text, tool calls, tool results, system, result.
      const anyMsg = msg as unknown as Record<string, unknown>;
      const type = anyMsg.type as string | undefined;

      if (type === "assistant") {
        const message = anyMsg.message as { content?: Array<Record<string, unknown>> } | undefined;
        for (const block of message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string") {
            lastText = block.text;
            yield { kind: "message", text: block.text };
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            yield { kind: "tool", name: block.name, input: block.input };
          }
        }
      } else if (type === "user") {
        const message = anyMsg.message as { content?: Array<Record<string, unknown>> } | undefined;
        for (const block of message?.content ?? []) {
          if (block.type === "tool_result") {
            const isErr = Boolean(block.is_error);
            yield { kind: "tool_result", name: String(block.tool_use_id ?? "tool"), ok: !isErr };
          }
        }
      } else if (type === "result") {
        // Final result event; emit done.
        yield { kind: "done", result: anyMsg.result ?? lastText };
        return;
      }
    }

    yield { kind: "done", result: lastText };
  } catch (err) {
    yield { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
