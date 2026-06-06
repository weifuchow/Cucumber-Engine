import { useState } from "react";
import { Check, RefreshCcw, Sparkles, X } from "lucide-react";
import { api, type AiEvent } from "../api/client";
import { assetScopeLabels, assetTypeLabels } from "../i18n/labels";
import type { AssetManifest, AssetScope, AssetType } from "../types/schema";
import { AssetPreviewStage } from "./AssetPreviewStage";

interface RunnerResult {
  ok: boolean;
  manifest?: AssetManifest;
  error?: string;
}

type Stage =
  | { name: "input" }
  | { name: "running" }
  | { name: "preview"; manifest: AssetManifest }
  | { name: "error"; message: string };

export function AiAssetGenerator({
  defaultType,
  defaultScope,
  onClose,
  onRegistered,
}: {
  defaultType: AssetType;
  defaultScope: AssetScope;
  onClose: () => void;
  onRegistered: (manifest: AssetManifest) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<AssetType>(defaultType);
  const [scope, setScope] = useState<AssetScope>(defaultScope);
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [cancel, setCancel] = useState<(() => void) | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "input" });
  const [saving, setSaving] = useState(false);

  async function start() {
    if (!prompt.trim() || stage.name === "running") return;
    setEvents([]);
    setStage({ name: "running" });
    try {
      const { cancel, done } = api.generateAsset({ prompt, type, scope }, (ev) => {
        setEvents((cur) => [...cur, ev]);
      });
      setCancel(() => cancel);
      const final = await done;
      const parsed = parseFinalResult(final);
      if (parsed?.ok && parsed.manifest) {
        setStage({ name: "preview", manifest: parsed.manifest });
      } else {
        setStage({ name: "error", message: parsed?.error ?? "AI 未返回可识别的资产清单。" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEvents((cur) => [...cur, { kind: "error", error: msg }]);
      setStage({ name: "error", message: msg });
    } finally {
      setCancel(null);
    }
  }

  async function confirmRegister() {
    if (stage.name !== "preview") return;
    setSaving(true);
    try {
      const saved = await api.saveAsset(stage.manifest);
      onRegistered(saved);
      onClose();
    } catch (err) {
      setStage({ name: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  function regenerate() {
    setStage({ name: "input" });
    setEvents([]);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal ai-modal">
        <header className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} />
            <span>AI 设计资产</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        {stage.name === "input" || stage.name === "running" ? (
          <>
            <section className="ai-modal-form">
              <label>
                <span>类型</span>
                <select
                  value={type}
                  disabled={stage.name === "running"}
                  onChange={(e) => setType(e.target.value as AssetType)}
                >
                  {(
                    ["character","scene","prop","background","foreground","effect","bgm","soundEffect","environment"] as AssetType[]
                  ).map((t) => (
                    <option key={t} value={t}>{assetTypeLabels[t]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>范围</span>
                <select
                  value={scope}
                  disabled={stage.name === "running"}
                  onChange={(e) => setScope(e.target.value as AssetScope)}
                >
                  <option value="project">{assetScopeLabels.project}</option>
                  <option value="global">{assetScopeLabels.global}</option>
                </select>
              </label>
              <label className="full">
                <span>描述</span>
                <textarea
                  rows={4}
                  placeholder="例：一位戴白色厨师帽的中年男性厨师，过程化角色，主色调白色与红色，用于早餐场景。"
                  value={prompt}
                  disabled={stage.name === "running"}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <div className="ai-modal-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={stage.name === "running" || !prompt.trim()}
                  onClick={start}
                >
                  {stage.name === "running" ? "生成中…" : "生成预览"}
                </button>
                {stage.name === "running" && cancel ? (
                  <button type="button" onClick={() => cancel()}>取消</button>
                ) : null}
              </div>
            </section>

            <section className="ai-modal-log">
              {events.length === 0 ? <p className="muted">填写描述后点击"生成预览"，AI 会写出 manifest，让你确认后再入库。</p> : null}
              {events.map((ev, i) => (
                <pre key={i} className={`ai-event ai-event-${ev.kind}`}>
                  {renderEvent(ev)}
                </pre>
              ))}
            </section>
          </>
        ) : null}

        {stage.name === "preview" ? (
          <section className="ai-preview">
            <div className="ai-preview-header">
              <div>
                <p className="eyebrow">预览</p>
                <h3>{stage.manifest.name}</h3>
                <span className="muted">{stage.manifest.assetId} · {assetTypeLabels[stage.manifest.type]} · {assetScopeLabels[stage.manifest.scope]}</span>
              </div>
            </div>
            <div className="ai-preview-canvas">
              <AssetPreviewStage asset={stage.manifest} />
            </div>
            <details className="ai-preview-json">
              <summary>查看 manifest JSON</summary>
              <pre>{JSON.stringify(stage.manifest, null, 2)}</pre>
            </details>
            <div className="ai-modal-actions">
              <button type="button" onClick={regenerate} disabled={saving}>
                <RefreshCcw size={15} />
                <span>重新生成</span>
              </button>
              <button type="button" className="primary" onClick={confirmRegister} disabled={saving}>
                <Check size={15} />
                <span>{saving ? "入库中…" : "确认入库"}</span>
              </button>
            </div>
          </section>
        ) : null}

        {stage.name === "error" ? (
          <section className="ai-modal-form">
            <p className="ai-event ai-event-error">{stage.message}</p>
            <div className="ai-modal-actions">
              <button type="button" onClick={regenerate}>
                <RefreshCcw size={15} />
                <span>重试</span>
              </button>
              <button type="button" onClick={onClose}>关闭</button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function parseFinalResult(ev: AiEvent): RunnerResult | null {
  const raw = ev.kind === "done" ? ev.result : ev.kind === "error" ? `{"ok":false,"error":${JSON.stringify(ev.error)}}` : null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const obj = raw as RunnerResult;
    if (typeof obj.ok === "boolean") return obj;
  }
  if (typeof raw !== "string") return null;
  const candidate = extractLastJsonObject(raw);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as RunnerResult;
  } catch {
    return null;
  }
}

function extractLastJsonObject(text: string): string | null {
  // Walk back from end finding the last `{ ... }` block at depth 0.
  let end = -1;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === "}") {
      if (end === -1) end = i;
      depth++;
    } else if (c === "{") {
      depth--;
      if (depth === 0 && end !== -1) return text.slice(i, end + 1);
    }
  }
  return null;
}

function renderEvent(ev: AiEvent): string {
  switch (ev.kind) {
    case "start":     return `▶ start ${ev.jobId}`;
    case "message":   return ev.text;
    case "tool":      return `🛠  ${ev.name}${ev.input ? " " + truncate(JSON.stringify(ev.input)) : ""}`;
    case "tool_result": return `   ↳ ${ev.ok ? "ok" : "fail"}`;
    case "done":      return `✓ done`;
    case "error":     return `✗ error: ${ev.error}`;
  }
}

function truncate(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
