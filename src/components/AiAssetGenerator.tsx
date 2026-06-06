import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { api, type AiEvent } from "../api/client";
import type { AssetScope, AssetType } from "../types/schema";

export function AiAssetGenerator({
  defaultType,
  defaultScope,
  onClose,
  onRegistered,
}: {
  defaultType: AssetType;
  defaultScope: AssetScope;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<AssetType>(defaultType);
  const [scope, setScope] = useState<AssetScope>(defaultScope);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [cancel, setCancel] = useState<(() => void) | null>(null);

  async function start() {
    if (!prompt.trim() || running) return;
    setEvents([]);
    setRunning(true);
    try {
      const { cancel, done } = api.generateAsset({ prompt, type, scope }, (ev) => {
        setEvents((cur) => [...cur, ev]);
      });
      setCancel(() => cancel);
      const final = await done;
      if (final.kind === "done") onRegistered();
    } catch (err) {
      setEvents((cur) => [...cur, { kind: "error", error: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setRunning(false);
      setCancel(null);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal ai-modal">
        <header className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} />
            <span>AI 生成资产</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        <section className="ai-modal-form">
          <label>
            <span>类型</span>
            <select value={type} onChange={(e) => setType(e.target.value as AssetType)}>
              {(
                ["character","scene","prop","background","foreground","effect","bgm","soundEffect","environment"] as AssetType[]
              ).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            <span>范围</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as AssetScope)}>
              <option value="project">项目</option>
              <option value="global">通用</option>
            </select>
          </label>
          <label className="full">
            <span>描述</span>
            <textarea
              rows={4}
              placeholder="例：一位戴白色厨师帽的中年男性厨师，过程化角色，主色调白色与红色，用于早餐场景。"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <div className="ai-modal-actions">
            <button type="button" className="primary" disabled={running || !prompt.trim()} onClick={start}>
              {running ? "生成中…" : "开始生成"}
            </button>
            {running && cancel ? (
              <button type="button" onClick={() => cancel()}>
                取消
              </button>
            ) : null}
          </div>
        </section>

        <section className="ai-modal-log">
          {events.length === 0 ? <p className="muted">暂无输出。</p> : null}
          {events.map((ev, i) => (
            <pre key={i} className={`ai-event ai-event-${ev.kind}`}>
              {renderEvent(ev)}
            </pre>
          ))}
        </section>
      </div>
    </div>
  );
}

function renderEvent(ev: AiEvent): string {
  switch (ev.kind) {
    case "start":     return `▶ start ${ev.jobId}`;
    case "message":   return ev.text;
    case "tool":      return `🛠  ${ev.name}${ev.input ? " " + truncate(JSON.stringify(ev.input)) : ""}`;
    case "tool_result": return `   ↳ ${ev.ok ? "ok" : "fail"}`;
    case "done":      return `✓ done\n${typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result ?? null, null, 2)}`;
    case "error":     return `✗ error: ${ev.error}`;
  }
}

function truncate(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
