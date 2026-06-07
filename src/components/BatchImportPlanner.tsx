import { useEffect, useMemo, useState } from "react";
import { Check, Image as ImageIcon, RefreshCcw, Sparkles, Trash2, X } from "lucide-react";
import { api, type AiEvent } from "../api/client";
import { assetTypeLabels, assetScopeLabels, labelFor } from "../i18n/labels";
import type { AssetManifest, AssetScope, AssetType } from "../types/schema";

/**
 * Multi-image batch importer.
 *
 * Flow:
 *   1. User selects N images via the file input (or drags them in)
 *   2. Frontend POSTs them to /api/ai/import/upload — backend writes them to
 *      data/import-tmp/ and returns server-side paths
 *   3. Frontend triggers /api/ai/import/plan — backend invokes a planning
 *      runner that `Read`s each image and emits an ImportPlan
 *   4. User reviews the plan (can tweak type/scope/name, drop items)
 *   5. For each accepted item, frontend calls cucumber-asset-generator with
 *      the image paths as `referenceImagePaths`, then saves the resulting
 *      manifest. Progress streams live for each item.
 */

interface PlanItem {
  kind: "asset" | "skip";
  type?: AssetType;
  scope?: AssetScope;
  suggestedName?: string;
  suggestedId?: string;
  sourceImageIndexes: number[];
  rationale: string;
  promptForGenerator?: string;
}

interface UploadedImage {
  file: File;
  previewUrl: string;
  serverPath: string;
}

type Stage =
  | { name: "select" }
  | { name: "uploading" }
  | { name: "planning"; events: AiEvent[] }
  | { name: "review"; items: PlanItem[] }
  | { name: "generating"; items: PlanItem[]; currentIndex: number; results: GeneratedRow[]; events: AiEvent[] }
  | { name: "done"; results: GeneratedRow[] }
  | { name: "error"; message: string };

interface GeneratedRow {
  item: PlanItem;
  manifest?: AssetManifest;
  error?: string;
}

export function BatchImportPlanner({
  defaultScope,
  onClose,
  onRegistered,
}: {
  defaultScope: AssetScope;
  onClose: () => void;
  onRegistered: (manifests: AssetManifest[]) => void;
}) {
  const [uploaded, setUploaded] = useState<UploadedImage[]>([]);
  const [hint, setHint] = useState("");
  const [stage, setStage] = useState<Stage>({ name: "select" });
  const [cancelPlan, setCancelPlan] = useState<(() => void) | null>(null);

  // Free object URLs on unmount so we don't leak blob: URLs.
  useEffect(() => () => uploaded.forEach((u) => URL.revokeObjectURL(u.previewUrl)), [uploaded]);

  async function handleFilesPicked(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setStage({ name: "uploading" });
    try {
      const { paths } = await api.uploadImportImages(list);
      const next: UploadedImage[] = list.map((file, i) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        serverPath: paths[i],
      }));
      setUploaded((cur) => [...cur, ...next]);
      setStage({ name: "select" });
    } catch (err) {
      setStage({ name: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function removeUploaded(idx: number) {
    setUploaded((cur) => {
      const copy = [...cur];
      const [removed] = copy.splice(idx, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return copy;
    });
  }

  async function startPlanning() {
    if (!uploaded.length) return;
    setStage({ name: "planning", events: [] });
    try {
      const { cancel, done } = api.planImport(
        { imagePaths: uploaded.map((u) => u.serverPath), hint },
        (ev) => setStage((cur) => (cur.name === "planning" ? { ...cur, events: [...cur.events, ev] } : cur)),
      );
      setCancelPlan(() => cancel);
      const final = await done;
      const plan = parsePlan(final);
      if (!plan) {
        setStage({ name: "error", message: "AI 未返回可识别的导入计划。" });
        return;
      }
      // Normalize: ensure scope defaults + suggestedId fallback
      const normalized: PlanItem[] = plan.map((item) => ({
        ...item,
        scope: item.scope ?? defaultScope,
      }));
      setStage({ name: "review", items: normalized });
    } catch (err) {
      setStage({ name: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCancelPlan(null);
    }
  }

  function updateItem(idx: number, patch: Partial<PlanItem>) {
    setStage((cur) => {
      if (cur.name !== "review") return cur;
      const items = cur.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      return { ...cur, items };
    });
  }

  async function executePlan() {
    const reviewStage = stage.name === "review" ? stage : null;
    if (!reviewStage) return;
    const accepted = reviewStage.items.filter((it) => it.kind === "asset");
    if (!accepted.length) {
      setStage({ name: "error", message: "没有要生成的资产 — 至少保留一项 kind: asset。" });
      return;
    }

    const results: GeneratedRow[] = [];
    setStage({ name: "generating", items: accepted, currentIndex: 0, results: [], events: [] });

    for (let i = 0; i < accepted.length; i++) {
      const item = accepted[i];
      const refPaths = item.sourceImageIndexes
        .map((idx) => uploaded[idx]?.serverPath)
        .filter((p): p is string => Boolean(p));
      setStage({ name: "generating", items: accepted, currentIndex: i, results, events: [] });

      try {
        const { done } = api.generateAsset(
          {
            prompt: item.promptForGenerator ?? item.rationale,
            type: (item.type ?? "character") as AssetType,
            scope: (item.scope ?? defaultScope) as AssetScope,
            referenceImagePaths: refPaths,
            suggestedId: item.suggestedId,
            suggestedName: item.suggestedName,
          },
          (ev) => setStage((cur) => (cur.name === "generating" ? { ...cur, events: [...cur.events, ev] } : cur)),
        );
        const final = await done;
        const parsed = parseManifestResult(final);
        if (!parsed?.ok || !parsed.manifest) {
          results.push({ item, error: parsed?.error ?? "AI 未返回有效 manifest。" });
        } else {
          // Persist immediately so the user sees the asset show up
          const saved = await api.saveAsset(parsed.manifest);
          results.push({ item, manifest: saved });
        }
      } catch (err) {
        results.push({ item, error: err instanceof Error ? err.message : String(err) });
      }
    }

    onRegistered(results.filter((r) => r.manifest).map((r) => r.manifest as AssetManifest));
    setStage({ name: "done", results });
  }

  const stageName = stage.name;
  const planningEvents = stageName === "planning" ? stage.events : [];
  const generatingEvents = stageName === "generating" ? stage.events : [];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal ai-modal" style={{ width: "min(1100px, 96vw)", maxHeight: "92vh", overflow: "auto" }}>
        <header className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} />
            <span>AI 批量图像导入</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        {stageName === "select" || stageName === "uploading" ? (
          <section className="ai-modal-form">
            <p className="muted">
              选择多张参考图（角色立绘、场景概念、道具草图…）。AI 会查看每张图后给出导入建议，可以归并同一资产的多张参考、或拆成多个资产。
            </p>
            <label className="full">
              <span>意图提示（可选）</span>
              <textarea
                rows={2}
                placeholder="例：这几张是同一个格斗角色的不同姿态。或：左两张是客厅场景的不同光线，右一张是新角色。"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
              />
            </label>
            <div className="ai-modal-actions">
              <label className="file-button">
                <ImageIcon size={16} />
                <span>{stageName === "uploading" ? "上传中…" : "选择图片"}</span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  disabled={stageName === "uploading"}
                  onChange={(e) => handleFilesPicked(e.target.files)}
                />
              </label>
              <button
                type="button"
                className="primary"
                disabled={!uploaded.length || stageName === "uploading"}
                onClick={startPlanning}
              >
                <Sparkles size={15} />
                <span>AI 思考决策（{uploaded.length} 张）</span>
              </button>
            </div>

            {uploaded.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, padding: "8px 0" }}>
                {uploaded.map((u, i) => (
                  <figure key={u.serverPath} style={{ position: "relative", margin: 0, border: "1px solid rgba(0,0,0,0.18)", borderRadius: 6, overflow: "hidden" }}>
                    <img src={u.previewUrl} alt={u.file.name} style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                    <figcaption style={{ position: "absolute", left: 4, top: 4, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>
                      [{i}] {u.file.name}
                    </figcaption>
                    <button
                      type="button"
                      onClick={() => removeUploaded(i)}
                      title="移除"
                      style={{ position: "absolute", right: 4, top: 4, background: "rgba(0,0,0,0.55)", color: "#fff", border: 0, borderRadius: 4, padding: 4, cursor: "pointer" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="muted">尚未选择图片。</p>
            )}
          </section>
        ) : null}

        {stageName === "planning" ? (
          <section className="ai-modal-log">
            <p className="muted">AI 正在阅读每张图并归类…</p>
            {planningEvents.map((ev, i) => (
              <pre key={i} className={`ai-event ai-event-${ev.kind}`}>{renderEvent(ev)}</pre>
            ))}
            {cancelPlan ? (
              <div className="ai-modal-actions">
                <button type="button" onClick={() => cancelPlan()}>取消</button>
              </div>
            ) : null}
          </section>
        ) : null}

        {stageName === "review" ? (
          <ReviewPanel
            items={stage.items}
            uploaded={uploaded}
            onUpdate={updateItem}
            onCancel={() => setStage({ name: "select" })}
            onConfirm={executePlan}
          />
        ) : null}

        {stageName === "generating" ? (
          <section className="ai-modal-log">
            <p className="muted">
              正在生成第 {stage.currentIndex + 1} / {stage.items.length} 个资产：
              <strong> {stage.items[stage.currentIndex]?.suggestedName ?? stage.items[stage.currentIndex]?.suggestedId}</strong>
            </p>
            {stage.results.map((r, i) => (
              <pre key={i} className={`ai-event ai-event-${r.manifest ? "done" : "error"}`}>
                {r.manifest ? `✓ ${r.manifest.name} (${r.manifest.assetId}) 已入库` : `✗ ${r.item.suggestedName ?? "?"}: ${r.error}`}
              </pre>
            ))}
            {generatingEvents.map((ev, i) => (
              <pre key={`live-${i}`} className={`ai-event ai-event-${ev.kind}`}>{renderEvent(ev)}</pre>
            ))}
          </section>
        ) : null}

        {stageName === "done" ? (
          <section className="ai-modal-form">
            <p className="muted">导入完成 — 成功 {stage.results.filter((r) => r.manifest).length} / 共 {stage.results.length}</p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {stage.results.map((r, i) => (
                <li key={i}>
                  {r.manifest ? (
                    <span>✓ <strong>{r.manifest.name}</strong> <code>({r.manifest.assetId})</code> · {labelFor(assetTypeLabels, r.manifest.type)}</span>
                  ) : (
                    <span>✗ {r.item.suggestedName ?? "(未命名)"}: {r.error}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="ai-modal-actions">
              <button type="button" className="primary" onClick={onClose}>关闭</button>
            </div>
          </section>
        ) : null}

        {stageName === "error" ? (
          <section className="ai-modal-form">
            <p className="ai-event ai-event-error">{stage.message}</p>
            <div className="ai-modal-actions">
              <button type="button" onClick={() => setStage({ name: "select" })}>
                <RefreshCcw size={15} />
                <span>返回</span>
              </button>
              <button type="button" onClick={onClose}>关闭</button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ReviewPanel({
  items,
  uploaded,
  onUpdate,
  onCancel,
  onConfirm,
}: {
  items: PlanItem[];
  uploaded: UploadedImage[];
  onUpdate: (idx: number, patch: Partial<PlanItem>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const acceptedCount = useMemo(() => items.filter((it) => it.kind === "asset").length, [items]);
  return (
    <section className="ai-modal-form">
      <p className="muted">AI 给出 {items.length} 条导入建议（{acceptedCount} 个资产 + {items.length - acceptedCount} 项跳过）。可调整类型 / 范围 / 名称后再确认。</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, idx) => (
          <article key={idx} style={{ border: "1px solid rgba(0,0,0,0.15)", borderRadius: 8, padding: 12, background: item.kind === "skip" ? "rgba(0,0,0,0.04)" : "rgba(0,150,100,0.06)" }}>
            <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <strong>#{idx + 1}</strong>
              <select
                value={item.kind}
                onChange={(e) => onUpdate(idx, { kind: e.target.value as PlanItem["kind"] })}
              >
                <option value="asset">登记为资产</option>
                <option value="skip">跳过</option>
              </select>
              {item.kind === "asset" ? (
                <>
                  <select
                    value={item.type ?? "character"}
                    onChange={(e) => onUpdate(idx, { type: e.target.value as AssetType })}
                  >
                    {(["character","scene","prop","background","foreground","effect","sceneElement"] as AssetType[]).map((t) => (
                      <option key={t} value={t}>{labelFor(assetTypeLabels, t)}</option>
                    ))}
                  </select>
                  <select
                    value={item.scope ?? "project"}
                    onChange={(e) => onUpdate(idx, { scope: e.target.value as AssetScope })}
                  >
                    <option value="project">{assetScopeLabels.project}</option>
                    <option value="global">{assetScopeLabels.global}</option>
                  </select>
                </>
              ) : null}
            </header>
            {item.kind === "asset" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <label>
                  <span>名称</span>
                  <input
                    value={item.suggestedName ?? ""}
                    onChange={(e) => onUpdate(idx, { suggestedName: e.target.value })}
                  />
                </label>
                <label>
                  <span>建议 id</span>
                  <input
                    value={item.suggestedId ?? ""}
                    onChange={(e) => onUpdate(idx, { suggestedId: e.target.value })}
                  />
                </label>
              </div>
            ) : null}
            <p style={{ margin: "4px 0 8px", fontSize: 13 }}>{item.rationale}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {item.sourceImageIndexes.map((srcIdx) => {
                const u = uploaded[srcIdx];
                if (!u) return null;
                return (
                  <figure key={srcIdx} style={{ margin: 0, position: "relative" }}>
                    <img src={u.previewUrl} alt={`[${srcIdx}]`} style={{ width: 72, height: 72, objectFit: "cover", border: "1px solid rgba(0,0,0,0.2)", borderRadius: 4 }} />
                    <figcaption style={{ position: "absolute", left: 2, top: 2, background: "rgba(0,0,0,0.7)", color: "#fff", padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>[{srcIdx}]</figcaption>
                  </figure>
                );
              })}
            </div>
          </article>
        ))}
      </div>
      <div className="ai-modal-actions">
        <button type="button" onClick={onCancel}>
          <RefreshCcw size={15} />
          <span>返回选图</span>
        </button>
        <button type="button" className="primary" disabled={acceptedCount === 0} onClick={onConfirm}>
          <Check size={15} />
          <span>确认并生成 {acceptedCount} 个资产</span>
        </button>
      </div>
    </section>
  );
}

function parsePlan(ev: AiEvent): PlanItem[] | null {
  const raw = extractJsonResult(ev);
  if (!raw) return null;
  const items = (raw as { plan?: { items?: PlanItem[] } }).plan?.items;
  return Array.isArray(items) ? items : null;
}

interface AssetGenerationResult { ok: boolean; manifest?: AssetManifest; error?: string }

function parseManifestResult(ev: AiEvent): AssetGenerationResult | null {
  const raw = extractJsonResult(ev);
  if (!raw) return null;
  const asUnknown = raw as unknown as AssetGenerationResult;
  if (typeof asUnknown.ok === "boolean") return asUnknown;
  return null;
}

function extractJsonResult(ev: AiEvent): Record<string, unknown> | null {
  const raw = ev.kind === "done" ? ev.result : ev.kind === "error" ? `{"ok":false,"error":${JSON.stringify(ev.error)}}` : null;
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  let end = -1; let depth = 0;
  for (let i = raw.length - 1; i >= 0; i--) {
    const c = raw[i];
    if (c === "}") { if (end === -1) end = i; depth++; }
    else if (c === "{") { depth--; if (depth === 0 && end !== -1) {
      try { return JSON.parse(raw.slice(i, end + 1)) as Record<string, unknown>; } catch { return null; }
    } }
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
