import type { AssetManifest, AssetScope, AssetType, Project, SceneDefinition } from "../types/schema";

const API_BASE =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE) ?? "/api";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
  }
  return res.json() as Promise<T>;
}

export const api = {
  async listAssets(filter?: { scope?: AssetScope; type?: AssetType }): Promise<AssetManifest[]> {
    const qs = new URLSearchParams();
    if (filter?.scope) qs.set("scope", filter.scope);
    if (filter?.type) qs.set("type", filter.type);
    const url = qs.toString() ? `${API_BASE}/assets?${qs}` : `${API_BASE}/assets`;
    const data = await jsonOrThrow<{ assets: AssetManifest[] }>(await fetch(url));
    return data.assets;
  },

  async saveAsset(manifest: AssetManifest): Promise<AssetManifest> {
    return jsonOrThrow<AssetManifest>(
      await fetch(`${API_BASE}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(manifest),
      }),
    );
  },

  async deleteAsset(assetId: string): Promise<void> {
    await jsonOrThrow(await fetch(`${API_BASE}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }));
  },

  async listScenes(): Promise<SceneDefinition[]> {
    const data = await jsonOrThrow<{ scenes: SceneDefinition[] }>(await fetch(`${API_BASE}/scenes`));
    return data.scenes;
  },

  async saveScene(scene: SceneDefinition): Promise<SceneDefinition> {
    return jsonOrThrow<SceneDefinition>(
      await fetch(`${API_BASE}/scenes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scene),
      }),
    );
  },

  async listProjects(): Promise<Project[]> {
    const data = await jsonOrThrow<{ projects: Project[] }>(await fetch(`${API_BASE}/projects`));
    return data.projects;
  },

  async saveProject(project: Project): Promise<Project> {
    return jsonOrThrow<Project>(
      await fetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(project),
      }),
    );
  },

  /**
   * Subscribe to an asset-generation SSE stream.
   * Resolves with the final result message once the stream emits `done` or `error`.
   */
  generateAsset(
    input: { prompt: string; scope: AssetScope; type: AssetType; category?: "visual" | "audio" },
    onEvent: (ev: AiEvent) => void,
  ): { cancel: () => void; done: Promise<AiEvent> } {
    const ac = new AbortController();
    const done = (async (): Promise<AiEvent> => {
      const res = await fetch(`${API_BASE}/ai/asset/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(input),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let last: AiEvent = { kind: "done" };
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine.slice(5).trim()) as AiEvent;
            onEvent(ev);
            last = ev;
            if (ev.kind === "done" || ev.kind === "error") return ev;
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
      return last;
    })();
    return { cancel: () => ac.abort(), done };
  },
};

export type AiEvent =
  | { kind: "start"; jobId: string }
  | { kind: "message"; text: string }
  | { kind: "tool"; name: string; input?: unknown }
  | { kind: "tool_result"; name: string; ok: boolean }
  | { kind: "done"; result?: unknown }
  | { kind: "error"; error: string };
