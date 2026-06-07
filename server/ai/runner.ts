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
  /**
   * Local image paths the skill should `Read` for high-fidelity reference.
   * The frontend writes uploaded files to a temp dir and passes the paths.
   * Empty / undefined means the skill falls back to web-search references.
   */
  referenceImagePaths?: string[];
  /** Stable suggested id from the planning step (skill verifies uniqueness). */
  suggestedId?: string;
  /** Stable suggested name. */
  suggestedName?: string;
}

export interface SegmentGenerationInput {
  prompt: string;            // script / plot idea
  projectId: string;         // target project id — included in the skill prompt for context
  durationSec?: number;      // hint, default 30
  apiBase?: string;
}

export interface ImportPlanInput {
  /** N image files written to disk before this call; we pass absolute paths. */
  imagePaths: string[];
  /** Optional user hint disambiguating the intent. */
  hint?: string;
  apiBase?: string;
}

export interface ImportPlanItem {
  kind: "asset" | "skip";
  /** AssetType when kind === "asset". */
  type?: string;
  scope?: "global" | "project";
  /** Suggested human-readable name. */
  suggestedName?: string;
  /** Suggested stable id. */
  suggestedId?: string;
  /** Indexes into the input imagePaths[] that should drive this generation. */
  sourceImageIndexes: number[];
  /** Short justification surfaced to the user. */
  rationale: string;
  /** Prompt to feed into cucumber-asset-generator when the user confirms. */
  promptForGenerator?: string;
}

export interface ImportPlan {
  items: ImportPlanItem[];
}

export type RunnerEvent =
  | { kind: "start"; jobId: string }
  | { kind: "message"; text: string }
  | { kind: "tool"; name: string; input?: unknown }
  | { kind: "tool_result"; name: string; ok: boolean }
  | { kind: "done"; result?: unknown }
  | { kind: "error"; error: string };

const PROMPT_TEMPLATE = (input: AssetGenerationInput) => `You are an asset-manifest authoring agent for the Cucumber Engine project.

Use the cucumber-asset-generator Skill. Follow its instructions strictly. The Skill explicitly forbids POSTing to /api/assets — registration is the UI's job. Your output is consumed by the front-end, which previews the manifest and lets the user confirm.

User request:
- type: ${input.type}
- scope: ${input.scope}
- category: ${input.category ?? "(infer)"}
- description: ${input.prompt}
${input.suggestedId ? `- suggested assetId: ${input.suggestedId} (verify uniqueness, bump suffix if taken)\n` : ""}${input.suggestedName ? `- suggested name: ${input.suggestedName}\n` : ""}${input.referenceImagePaths && input.referenceImagePaths.length
  ? `- reference images (REQUIRED — Read each one for palette / silhouette / pose extraction):
${input.referenceImagePaths.map((p, i) => `    [${i}] ${p}`).join("\n")}
  Record them in metadata.references[] with sourceType:"user-upload".
` : "- (no local images uploaded — use WebSearch + WebFetch to gather visual references)\n"}

Backend API base URL (read-only — list/get assets to avoid id collisions):
  ${input.apiBase ?? "http://localhost:3001/api"}

End your run with exactly one trailing line of pure JSON in one of these shapes:
{"ok": true, "manifest": { ...full AssetManifest, including metadata.shape for visual procedural assets... }}
{"ok": false, "error": "<short reason>"}
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

const SEGMENT_PROMPT_TEMPLATE = (input: SegmentGenerationInput) => `You are a segment-authoring agent for the Cucumber Engine project.

Use the cucumber-segment-generator Skill. Follow its instructions strictly. The Skill explicitly forbids POSTing to /api/projects, /api/assets, or /api/scenes — registration is the UI's job. Your output is consumed by the front-end, which previews the segment and lets the user confirm it before insertion.

User request:
- target projectId: ${input.projectId}
- target duration: ${input.durationSec ?? 30}s
- description: ${input.prompt}

Backend API base URL (read-only — list assets/scenes/projects to find reuse candidates):
  ${input.apiBase ?? "http://localhost:3001/api"}

End your run with exactly one trailing line of pure JSON in one of these shapes:
{"ok": true, "segment": { "chapter": Chapter, "segment": Segment, "newAssets": AssetManifest[]? }}
{"ok": false, "error": "<short reason>"}
`;

export async function* runSegmentGeneration(
  jobId: string,
  input: SegmentGenerationInput,
  signal?: AbortSignal,
): AsyncGenerator<RunnerEvent> {
  yield { kind: "start", jobId };

  const ac = new AbortController();
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });

  try {
    const q = query({
      prompt: SEGMENT_PROMPT_TEMPLATE(input),
      options: {
        cwd: repoRoot,
        abortController: ac,
        skills: ["cucumber-segment-generator", "cucumber-asset-generator"],
        allowedTools: ["Read", "Write", "Edit", "Bash", "WebFetch", "WebSearch", "Grep", "Glob"],
        env: {
          ...process.env,
          CUCUMBER_API_BASE: input.apiBase ?? "http://localhost:3001/api",
        } as Record<string, string>,
      },
    });

    let lastText = "";
    for await (const msg of q) {
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
        yield { kind: "done", result: anyMsg.result ?? lastText };
        return;
      }
    }

    yield { kind: "done", result: lastText };
  } catch (err) {
    yield { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

const IMPORT_PLAN_PROMPT_TEMPLATE = (input: ImportPlanInput) => `You are an import-planning agent for the Cucumber Engine project.

The user uploaded ${input.imagePaths.length} image(s). Decide how to ingest them. Read each image with the Read tool to extract visible features (silhouette, palette, what's depicted), then output an import plan.

Image paths (relative to the repo root):
${input.imagePaths.map((p, i) => `  [${i}] ${p}`).join("\n")}

User intent hint: ${input.hint ? JSON.stringify(input.hint) : "(none)"}

Decide for each image (or group of images) what to ingest. Common cases:
  - all images are different views of the same character → ONE asset entry with sourceImageIndexes covering them all (the asset generator will use them as references)
  - images are different rooms / locations → multiple scene assets, one per image
  - some images are duplicates or test shots → kind: "skip" with reason
  - one image is a character + one is the same character's pose sheet → one asset that uses both as refs

End your run with exactly one trailing line of pure JSON:

{"ok": true, "plan": {"items": [
  {"kind": "asset", "type": "character", "scope": "project", "suggestedName": "...", "suggestedId": "character_<descriptor>_001", "sourceImageIndexes": [0, 1], "rationale": "...", "promptForGenerator": "..."},
  {"kind": "skip", "sourceImageIndexes": [2], "rationale": "blurry duplicate of [0]"}
]}}

…or on failure:

{"ok": false, "error": "<short reason>"}

Do NOT generate the actual asset manifests in this run — just the plan. The frontend will then drive cucumber-asset-generator per item, passing the image paths into metadata.referenceImagePaths for high-fidelity reproduction.
`;

export async function* runImportPlanning(
  jobId: string,
  input: ImportPlanInput,
  signal?: AbortSignal,
): AsyncGenerator<RunnerEvent> {
  yield { kind: "start", jobId };

  const ac = new AbortController();
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });

  try {
    const q = query({
      prompt: IMPORT_PLAN_PROMPT_TEMPLATE(input),
      options: {
        cwd: repoRoot,
        abortController: ac,
        allowedTools: ["Read", "Bash", "WebFetch", "WebSearch", "Grep", "Glob"],
        env: {
          ...process.env,
          CUCUMBER_API_BASE: input.apiBase ?? "http://localhost:3001/api",
        } as Record<string, string>,
      },
    });

    let lastText = "";
    for await (const msg of q) {
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
        yield { kind: "done", result: anyMsg.result ?? lastText };
        return;
      }
    }

    yield { kind: "done", result: lastText };
  } catch (err) {
    yield { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
