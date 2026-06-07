import { useState } from "react";
import { Check, RefreshCcw, Sparkles, X } from "lucide-react";
import { api, type AiEvent } from "../api/client";
import { PreviewCanvas } from "./PreviewCanvas";
import type { AssetLibrary, AssetManifest, Chapter, Project, Segment } from "../types/schema";

interface SegmentResult {
  ok: boolean;
  segment?: {
    chapter: Chapter;
    segment: Segment;
    newAssets?: AssetManifest[];
  };
  error?: string;
}

type Stage =
  | { name: "input" }
  | { name: "running" }
  | { name: "preview"; chapter: Chapter; segment: Segment; newAssets: AssetManifest[] }
  | { name: "error"; message: string };

/**
 * Modal for AI-driven Segment generation. The skill emits a Chapter + Segment
 * + (optional) new asset manifests. The frontend previews the segment using
 * the same PreviewCanvas that runs the project — so what the user sees is
 * exactly what'll play after they confirm.
 */
export function AiSegmentGenerator({
  project,
  library,
  onClose,
  onAccept,
}: {
  project: Project;
  library: AssetLibrary;
  onClose: () => void;
  onAccept: (result: { chapter: Chapter; segment: Segment; newAssets: AssetManifest[] }) => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(30);
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [cancel, setCancel] = useState<(() => void) | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "input" });
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState(0);

  async function start() {
    if (!prompt.trim() || stage.name === "running") return;
    setEvents([]);
    setStage({ name: "running" });
    try {
      const { cancel, done } = api.generateSegment({ prompt, projectId: project.projectId, durationSec: duration }, (ev) => {
        setEvents((cur) => [...cur, ev]);
      });
      setCancel(() => cancel);
      const final = await done;
      const parsed = parseFinalResult(final);
      if (parsed?.ok && parsed.segment) {
        setStage({
          name: "preview",
          chapter: parsed.segment.chapter,
          segment: parsed.segment.segment,
          newAssets: parsed.segment.newAssets ?? [],
        });
        setTime(0);
      } else {
        setStage({ name: "error", message: parsed?.error ?? "AI 未返回可识别的片段。" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEvents((cur) => [...cur, { kind: "error", error: msg }]);
      setStage({ name: "error", message: msg });
    } finally {
      setCancel(null);
    }
  }

  async function confirmInsert() {
    if (stage.name !== "preview") return;
    setSaving(true);
    try {
      await onAccept({ chapter: stage.chapter, segment: stage.segment, newAssets: stage.newAssets });
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

  // Build a throwaway "preview project" so PreviewCanvas can render the new
  // segment without us having to commit it to the real project state.
  const previewProject: Project | null = stage.name === "preview"
    ? {
        ...project,
        chapters: [{ ...stage.chapter, segments: [stage.segment] }],
        preview: { activeChapterId: stage.chapter.chapterId, activeSegmentId: stage.segment.segmentId },
      }
    : null;

  const previewLibrary: AssetLibrary | null = stage.name === "preview"
    ? {
        ...library,
        projectAssets: [...library.projectAssets, ...stage.newAssets.filter((a) => a.scope === "project")],
        globalAssets: [...library.globalAssets, ...stage.newAssets.filter((a) => a.scope === "global")],
      }
    : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal ai-modal" style={{ width: "min(1100px, 96vw)" }}>
        <header className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} />
            <span>AI 生成片段</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        {stage.name === "input" || stage.name === "running" ? (
          <>
            <section className="ai-modal-form">
              <label className="full">
                <span>剧本描述</span>
                <textarea
                  rows={4}
                  placeholder="例：父子在厨房早餐桌的 30 秒对话。孩子下楼，父亲在煎蛋，两人和解。结尾镜头拉远到窗外阳光。"
                  value={prompt}
                  disabled={stage.name === "running"}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <label>
                <span>目标时长（秒）</span>
                <input
                  type="number"
                  min={10}
                  max={120}
                  step={1}
                  value={duration}
                  disabled={stage.name === "running"}
                  onChange={(e) => setDuration(Number(e.target.value) || 30)}
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
              {events.length === 0 ? <p className="muted">写下剧本要点和长度后点击"生成预览"。AI 会先盘点现有资产，复用能复用的，缺什么就顺手设计，然后输出一段完整 Segment 给你试播。</p> : null}
              {events.map((ev, i) => (
                <pre key={i} className={`ai-event ai-event-${ev.kind}`}>
                  {renderEvent(ev)}
                </pre>
              ))}
            </section>
          </>
        ) : null}

        {stage.name === "preview" && previewProject && previewLibrary ? (
          <section className="ai-preview">
            <div className="ai-preview-header">
              <div>
                <p className="eyebrow">片段预览</p>
                <h3>{stage.segment.name}</h3>
                <span className="muted">
                  {stage.chapter.title} · {stage.segment.duration}s · {stage.segment.timeline.length} 事件
                  {stage.newAssets.length ? ` · 新增 ${stage.newAssets.length} 个资产` : ""}
                </span>
              </div>
            </div>
            <div className="ai-preview-canvas">
              <PreviewCanvas project={previewProject} library={previewLibrary} time={time} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px" }}>
              <input
                type="range"
                min={0}
                max={stage.segment.duration}
                step={0.05}
                value={time}
                onChange={(e) => setTime(Number(e.target.value))}
                style={{ flex: 1 }}
                aria-label="片段时间轴"
              />
              <strong>{time.toFixed(1)}s</strong>
              <span className="muted">/ {stage.segment.duration}s</span>
            </div>
            <details className="ai-preview-json">
              <summary>查看 Segment JSON</summary>
              <pre>{JSON.stringify({ chapter: stage.chapter, segment: stage.segment, newAssets: stage.newAssets }, null, 2)}</pre>
            </details>
            <div className="ai-modal-actions">
              <button type="button" onClick={regenerate} disabled={saving}>
                <RefreshCcw size={15} />
                <span>重新生成</span>
              </button>
              <button type="button" className="primary" onClick={confirmInsert} disabled={saving}>
                <Check size={15} />
                <span>{saving ? "插入中…" : "确认插入项目"}</span>
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

function parseFinalResult(ev: AiEvent): SegmentResult | null {
  const raw = ev.kind === "done" ? ev.result : ev.kind === "error" ? `{"ok":false,"error":${JSON.stringify(ev.error)}}` : null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const obj = raw as SegmentResult;
    if (typeof obj.ok === "boolean") return obj;
  }
  if (typeof raw !== "string") return null;
  const candidate = extractLastJsonObject(raw);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as SegmentResult;
  } catch {
    return null;
  }
}

function extractLastJsonObject(text: string): string | null {
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
