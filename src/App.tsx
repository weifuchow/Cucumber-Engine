import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Boxes,
  Camera,
  Download,
  ExternalLink,
  Eye,
  FileJson,
  FilePlus2,
  FolderInput,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { PreviewCanvas } from "./components/PreviewCanvas";
import { AiAssetGenerator } from "./components/AiAssetGenerator";
import { AiSegmentGenerator } from "./components/AiSegmentGenerator";
import { BatchImportPlanner } from "./components/BatchImportPlanner";
import { CharacterPortrait } from "./components/CharacterPortrait";
import { AssetPreviewStage } from "./components/AssetPreviewStage";
import { sampleLibrary, sampleProject } from "./data/sampleProject";
import { getActiveSegment } from "./engine/timeline";
import { importImageFile, importSceneJsonFile, importSpriteSheetJsonFile } from "./importers/importers";
import { importSpineJsonFile } from "./importers/spineImporter";
import { buildAssetManifestExport, buildProjectExport, downloadJson } from "./utils/exporters";
import { api } from "./api/client";
import {
  assetCategoryLabels,
  assetScopeLabels,
  assetTypeLabels,
  cameraModeLabels,
  labelFor,
  sourceKindLabels,
  timelineEventTypeLabels,
  transitionLabels,
} from "./i18n/labels";
import type { AssetLibrary, AssetManifest, AssetScope, AssetType, Chapter, Project, Segment, TimelineEvent } from "./types/schema";

const imageTypes: AssetType[] = ["character", "scene", "prop", "expression", "effect", "foreground", "background"];
type ModuleId = "assets" | "project" | "export";

const modules: Array<{ id: ModuleId; label: string; description: string; icon: typeof Boxes }> = [
  { id: "assets", label: "通用资产库", description: "导入、分类、预览和登记通用素材 Manifest", icon: Boxes },
  { id: "project", label: "项目管理", description: "项目、章节、片段、参数编辑和片段渲染编辑", icon: FileJson },
  { id: "export", label: "导出与 AI", description: "项目 JSON、资产配置和 AI Schema 预留", icon: Sparkles },
];

type PendingImport =
  | { kind: "image"; file: File; scope: AssetScope }
  | { kind: "spritesheet"; file: File; scope: AssetScope };

function dedupe(assets: AssetManifest[]): AssetManifest[] {
  const seen = new Set<string>();
  const out: AssetManifest[] = [];
  for (const a of assets) {
    if (seen.has(a.assetId)) continue;
    seen.add(a.assetId);
    out.push(a);
  }
  return out;
}

function collectTimelineUsedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const chapter of project.chapters) {
    if (chapter.sceneId) ids.add(chapter.sceneId);
    if (chapter.bgm) ids.add(chapter.bgm);
    for (const characterId of chapter.characters) ids.add(characterId);
    for (const segmentItem of chapter.segments) {
      for (const ev of segmentItem.timeline) {
        if ("target" in ev && typeof ev.target === "string") ids.add(ev.target);
        if ("sceneId" in ev && typeof (ev as { sceneId?: unknown }).sceneId === "string") ids.add((ev as { sceneId: string }).sceneId);
        if ("propId" in ev && typeof (ev as { propId?: unknown }).propId === "string") ids.add((ev as { propId: string }).propId);
        if ("effectId" in ev && typeof (ev as { effectId?: unknown }).effectId === "string") ids.add((ev as { effectId: string }).effectId);
        if ("assetId" in ev && typeof (ev as { assetId?: unknown }).assetId === "string") ids.add((ev as { assetId: string }).assetId);
      }
    }
  }
  return ids;
}

export function App() {
  const [project, setProject] = useState<Project>(sampleProject);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [library, setLibrary] = useState<AssetLibrary>(sampleLibrary);
  const [activeModule, setActiveModule] = useState<ModuleId>("assets");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("已载入最小演示项目：客厅、两个角色、道具、镜头、表情和特效。");
  const [selectedAssetId, setSelectedAssetId] = useState("character_child_001");
  const [assetPreviewOpen, setAssetPreviewOpen] = useState(false);
  const [segmentEditorOpen, setSegmentEditorOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState<null | { scope: AssetScope }>(null);
  const [aiSegmentOpen, setAiSegmentOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState<null | { scope: AssetScope }>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const apiReadyRef = useRef(false);

  async function reloadLibraryFromApi() {
    try {
      const [global, projectAssets, scenes, projects] = await Promise.all([
        api.listAssets({ scope: "global" }),
        api.listAssets({ scope: "project" }),
        api.listScenes(),
        api.listProjects(),
      ]);
      if (global.length || projectAssets.length || scenes.length) {
        setLibrary((current) => ({
          globalAssets: global.length ? global : current.globalAssets,
          projectAssets: projectAssets.length ? projectAssets : current.projectAssets,
          scenes: scenes.length ? scenes : current.scenes,
        }));
      }
      setAvailableProjects(projects);
      const persisted = projects.find((p) => p.projectId === project.projectId) ?? projects[0];
      if (persisted) setProject(persisted);
      setNotice(`已从后端载入 ${global.length + projectAssets.length} 个资产、${scenes.length} 个场景、${projects.length} 个项目。`);
    } catch (err) {
      console.warn("[api] library load failed, keeping samples:", err);
    } finally {
      // Mark ready after the React state updates above have been flushed.
      window.setTimeout(() => { apiReadyRef.current = true; }, 0);
    }
  }

  useEffect(() => {
    void reloadLibraryFromApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear the one-line status notice whenever the user switches modules.
  // Otherwise a "已切换到「X 项目」" message set in the project module would
  // linger inside the unrelated asset / export modules.
  useEffect(() => {
    setNotice("");
  }, [activeModule]);

  // Debounced auto-save of the current project to the backend.
  // Only fires after the initial load completes — avoids overwriting DB with sample state.
  useEffect(() => {
    if (!apiReadyRef.current) return;
    const handle = window.setTimeout(() => {
      api.saveProject(project).catch((err) => {
        console.warn("[api] saveProject failed:", err);
      });
    }, 600);
    return () => window.clearTimeout(handle);
  }, [project]);

  const segment = useMemo(() => getActiveSegment(project), [project]);
  const activeChapter = project.chapters.find((chapter) => chapter.chapterId === project.preview.activeChapterId) ?? project.chapters[0];
  const allAssets = useMemo(() => [...library.projectAssets, ...library.globalAssets], [library]);
  const selectedAsset = allAssets.find((asset) => asset.assetId === selectedAssetId) ?? null;
  const activeModuleMeta = modules.find((module) => module.id === activeModule) ?? modules[0];

  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setTime((current) => {
        const next = current + delta;
        if (next >= segment.duration) {
          setPlaying(false);
          return segment.duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, segment.duration]);

  async function handleImageImport(file: File, type: AssetType, scope: AssetScope) {
    try {
      const manifest = await importImageFile(file, type, scope);
      await api.saveAsset(manifest);
      setLibrary((current) =>
        scope === "global"
          ? { ...current, globalAssets: [manifest, ...current.globalAssets] }
          : { ...current, projectAssets: [manifest, ...current.projectAssets] },
      );
      if (scope === "project") setProject((current) => ({ ...current, assetRefs: [...new Set([manifest.assetId, ...current.assetRefs])] }));
      setSelectedAssetId(manifest.assetId);
      setAssetPreviewOpen(true);
      setNotice(`已导入 ${file.name}，已入库 ${manifest.assetId}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入失败。");
    }
  }

  async function handleSceneImport(file: File | undefined) {
    if (!file) return;
    try {
      const scene = await importSceneJsonFile(file);
      await api.saveScene(scene);
      setLibrary((current) => ({ ...current, scenes: [scene, ...current.scenes] }));
      setProject((current) => ({ ...current, assetRefs: [...new Set([scene.sceneId, ...current.assetRefs])] }));
      setNotice(`已入库场景 JSON：${scene.name}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "场景 JSON 导入失败。");
    }
  }

  async function handleSpineImport(file: File | undefined, scope: AssetScope) {
    if (!file) return;
    try {
      const manifest = await importSpineJsonFile(file, scope);
      await api.saveAsset(manifest);
      setLibrary((current) =>
        scope === "global"
          ? { ...current, globalAssets: [manifest, ...current.globalAssets] }
          : { ...current, projectAssets: [manifest, ...current.projectAssets] },
      );
      if (scope === "project") {
        setProject((current) => ({ ...current, assetRefs: [...new Set([manifest.assetId, ...current.assetRefs])] }));
      }
      setSelectedAssetId(manifest.assetId);
      setAssetPreviewOpen(true);
      setNotice(`已从 Spine JSON 导入「${manifest.name}」（${(manifest.metadata.actions as string[] | undefined)?.length ?? 0} 个动作）。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Spine JSON 导入失败。");
    }
  }

  async function handleSpriteSheetImport(file: File, type: AssetType, scope: AssetScope) {
    const narrowed: "action" | "effect" = type === "action" ? "action" : "effect";
    try {
      const manifest = await importSpriteSheetJsonFile(file, scope, narrowed);
      await api.saveAsset(manifest);
      setLibrary((current) =>
        scope === "global"
          ? { ...current, globalAssets: [manifest, ...current.globalAssets] }
          : { ...current, projectAssets: [manifest, ...current.projectAssets] },
      );
      if (scope === "project") setProject((current) => ({ ...current, assetRefs: [...new Set([manifest.assetId, ...current.assetRefs])] }));
      setSelectedAssetId(manifest.assetId);
      setAssetPreviewOpen(true);
      setNotice(`已入库图集 JSON，登记为 ${labelFor(assetTypeLabels, manifest.type)} 资产。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "图集 JSON 导入失败。");
    }
  }

  function queueImport(kind: PendingImport["kind"], file: File | undefined, scope: AssetScope) {
    if (!file) return;
    setPendingImport({ kind, file, scope } as PendingImport);
  }

  async function confirmPendingImport(type: AssetType) {
    const pending = pendingImport;
    if (!pending) return;
    setPendingImport(null);
    if (pending.kind === "image") await handleImageImport(pending.file, type, pending.scope);
    else if (pending.kind === "spritesheet") await handleSpriteSheetImport(pending.file, type, pending.scope);
  }

  async function handleDeleteAsset(assetId: string) {
    const asset = [...library.globalAssets, ...library.projectAssets].find((item) => item.assetId === assetId);
    if (!asset) return;
    if (asset.scope === "project") {
      const usedIds = collectTimelineUsedAssetIds(project);
      if (usedIds.has(assetId)) {
        setNotice(`「${asset.name}」仍被时间线引用，先移除相关事件再删除。`);
        return;
      }
    }
    if (!window.confirm(`删除资产「${asset.name}」？该操作不可撤销。`)) return;
    try {
      await api.deleteAsset(assetId);
      setLibrary((current) => ({
        ...current,
        globalAssets: current.globalAssets.filter((item) => item.assetId !== assetId),
        projectAssets: current.projectAssets.filter((item) => item.assetId !== assetId),
      }));
      setProject((current) => ({ ...current, assetRefs: current.assetRefs.filter((ref) => ref !== assetId) }));
      if (selectedAssetId === assetId) {
        setSelectedAssetId("");
        setAssetPreviewOpen(false);
      }
      setNotice(`已删除资产「${asset.name}」。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败。");
    }
  }

  async function acceptAiSegment(result: { chapter: Chapter; segment: Segment; newAssets: AssetManifest[] }) {
    // 1. Persist any new assets the AI designed so they're available next
    //    time the project loads. We do this before inserting the chapter so
    //    the timeline's references are immediately resolvable.
    for (const asset of result.newAssets) {
      try {
        await api.saveAsset(asset);
      } catch (err) {
        console.warn(`[ai-segment] saveAsset failed for ${asset.assetId}:`, err);
      }
    }

    // 2. Merge new assets into the in-memory library.
    if (result.newAssets.length) {
      setLibrary((current) => ({
        ...current,
        globalAssets: dedupe([...result.newAssets.filter((a) => a.scope === "global"), ...current.globalAssets]),
        projectAssets: dedupe([...result.newAssets.filter((a) => a.scope === "project"), ...current.projectAssets]),
      }));
    }

    // 3. Insert (or merge) the chapter into the project and switch preview
    //    to the new segment. If a chapter with the same id already exists,
    //    append the segment to it rather than duplicating chapters.
    const newAssetRefs = result.newAssets.map((a) => a.assetId);
    setProject((current) => {
      const existingIdx = current.chapters.findIndex((ch) => ch.chapterId === result.chapter.chapterId);
      let chapters: Chapter[];
      if (existingIdx >= 0) {
        const existing = current.chapters[existingIdx];
        const segmentIdx = existing.segments.findIndex((s) => s.segmentId === result.segment.segmentId);
        const segments = segmentIdx >= 0
          ? existing.segments.map((s, i) => (i === segmentIdx ? result.segment : s))
          : [...existing.segments, result.segment];
        chapters = current.chapters.map((ch, i) => (i === existingIdx ? { ...existing, segments } : ch));
      } else {
        chapters = [...current.chapters, { ...result.chapter, segments: [result.segment] }];
      }
      return {
        ...current,
        chapters,
        assetRefs: [...new Set([...current.assetRefs, ...newAssetRefs])],
        preview: { activeChapterId: result.chapter.chapterId, activeSegmentId: result.segment.segmentId },
      };
    });
    setSegmentEditorOpen(true);
    setTime(0);
    setPlaying(false);
    setNotice(`AI 已插入片段「${result.segment.name}」（${result.segment.duration}s · ${result.newAssets.length} 个新资产）。`);
  }

  function createChapter() {
    const chapterId = `chapter_${Date.now().toString(36)}`;
    const segmentId = `segment_${Date.now().toString(36)}`;
    setProject((current) => ({
      ...current,
      chapters: [
        ...current.chapters,
        {
          chapterId,
          title: `新章节 ${current.chapters.length + 1}`,
          sceneId: current.chapters[0].sceneId,
          characters: [],
          transition: { type: "cut", duration: 0 },
          segments: [{ segmentId, name: "新片段", duration: 10, timeline: [] }],
        },
      ],
      preview: { activeChapterId: chapterId, activeSegmentId: segmentId },
    }));
    setSegmentEditorOpen(true);
    setNotice("已创建章节结构，可继续补充场景、角色和时间线。");
  }

  function selectSegment(chapterId: string, segmentId: string) {
    setPlaying(false);
    setTime(0);
    setProject((current) => ({
      ...current,
      preview: { activeChapterId: chapterId, activeSegmentId: segmentId },
    }));
  }

  function openSegmentEditor(chapterId: string, segmentId: string) {
    selectSegment(chapterId, segmentId);
    setSegmentEditorOpen(true);
  }

  function updateProjectFields(patch: Partial<Pick<Project, "title" | "description">>) {
    setProject((current) => ({ ...current, ...patch }));
  }

  function updateProjectConfig(patch: Partial<Project["config"]>) {
    setProject((current) => ({
      ...current,
      config: { ...current.config, ...patch },
    }));
  }

  function updateChapter(chapterId: string, patch: Partial<Chapter>) {
    setProject((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => (chapter.chapterId === chapterId ? { ...chapter, ...patch } : chapter)),
    }));
  }

  function updateSegment(chapterId: string, segmentId: string, patch: Partial<Segment>) {
    setProject((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) =>
        chapter.chapterId === chapterId
          ? {
              ...chapter,
              segments: chapter.segments.map((segmentItem) => (segmentItem.segmentId === segmentId ? { ...segmentItem, ...patch } : segmentItem)),
            }
          : chapter,
      ),
    }));
  }

  function createSegment(chapterId: string) {
    const segmentId = `segment_${Date.now().toString(36)}`;
    setProject((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) =>
        chapter.chapterId === chapterId
          ? {
              ...chapter,
              segments: [
                ...chapter.segments,
                {
                  segmentId,
                  name: `新片段 ${chapter.segments.length + 1}`,
                  duration: 10,
                  timeline: [],
                },
              ],
            }
          : chapter,
      ),
      preview: { activeChapterId: chapterId, activeSegmentId: segmentId },
    }));
    setPlaying(false);
    setTime(0);
    setSegmentEditorOpen(true);
  }

  return (
    <main className="app-shell">
      <aside className="module-sidebar">
        <section className="brand">
          <div className="brand-mark">黄瓜</div>
          <div>
            <h1>黄瓜引擎</h1>
            <p>轻量 2.5D 短剧生产底座</p>
          </div>
        </section>

        <nav className="module-nav" aria-label="功能模块">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button
                key={module.id}
                type="button"
                className={activeModule === module.id ? "is-active" : ""}
                onClick={() => setActiveModule(module.id)}
              >
                <Icon size={18} />
                <span>{module.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="module-summary">
          <Metric label="通用资产" value={library.globalAssets.length} />
          <Metric label="项目资产" value={library.projectAssets.length} />
          <Metric label="章节" value={project.chapters.length} />
        </section>
      </aside>

      <section className="module-workspace">
        <header className="module-topbar">
          <div>
            <p className="eyebrow">Cucumber Engine MVP</p>
            <h2>{activeModuleMeta.label}</h2>
            <span>{activeModuleMeta.description}</span>
          </div>
          <div className="actions">
            {activeModule === "project" ? (
              <>
                <label className="project-picker" style={{
                  display: "flex", flexDirection: "column", gap: 2,
                  marginRight: 4, minWidth: 240,
                }}>
                  <small style={{ fontSize: 11, color: "var(--muted, #666)" }}>当前项目</small>
                  <select
                    value={project.projectId}
                    onChange={(e) => {
                      const next = availableProjects.find((p) => p.projectId === e.target.value);
                      if (next) {
                        setProject(next);
                        setTime(0);
                        setPlaying(false);
                        setNotice(`已切换到「${next.title}」`);
                      }
                    }}
                    style={{
                      padding: "6px 10px", borderRadius: 8,
                      border: "1px solid var(--border, #ccc)", fontSize: 13,
                      background: "var(--surface, #fff)",
                    }}
                  >
                    {availableProjects.length === 0 ? (
                      <option value={project.projectId}>{project.title}</option>
                    ) : availableProjects.map((p) => (
                      <option key={p.projectId} value={p.projectId}>
                        {p.title}{p.config?.styleBar ? ` · ${p.config.styleBar}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setNewProjectOpen(true)} title="新建一个项目">
                  <FilePlus2 size={17} />
                  <span>新建项目</span>
                </button>
                <button type="button" onClick={createChapter}>
                  <Sparkles size={17} />
                  <span>新章节</span>
                </button>
                <button type="button" onClick={() => setAiSegmentOpen(true)} title="AI 根据剧本要点直接生成一段">
                  <Sparkles size={17} />
                  <span>AI 生成片段</span>
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => downloadJson("cucumber-project.json", buildProjectExport(project, library))}>
              <Download size={17} />
              <span>项目 JSON</span>
            </button>
            <button type="button" onClick={() => downloadJson("asset-manifests.json", buildAssetManifestExport(library))}>
              <Download size={17} />
              <span>资产配置</span>
            </button>
          </div>
        </header>

        <div className="module-content">
          {activeModule === "assets" ? (
            <AssetLibraryModule
              notice={notice}
              globalAssets={library.globalAssets}
              selectedAssetId={selectedAssetId}
              onSpineImport={(file) => handleSpineImport(file, "global")}
              onOpenBatchImport={() => setBatchImportOpen({ scope: "global" })}
              onOpenAi={() => setAiOpen({ scope: "global" })}
              onDeleteAsset={handleDeleteAsset}
              onSelectAsset={(assetId) => {
                setSelectedAssetId(assetId);
                setAssetPreviewOpen(true);
              }}
            />
          ) : null}
          {activeModule === "project" ? (
            <ProjectModule
              project={project}
              library={library}
              activeChapterId={activeChapter.chapterId}
              activeSegmentId={segment.segmentId}
              onCreateChapter={createChapter}
              onCreateSegment={createSegment}
              onSelectSegment={selectSegment}
              onOpenSegmentEditor={openSegmentEditor}
              onUpdateProject={updateProjectFields}
              onUpdateProjectConfig={updateProjectConfig}
              onUpdateChapter={updateChapter}
              onUpdateSegment={updateSegment}
              onSpineImport={(file) => handleSpineImport(file, "project")}
              onOpenBatchImport={() => setBatchImportOpen({ scope: "project" })}
              onOpenAi={() => setAiOpen({ scope: "project" })}
              onDeleteAsset={handleDeleteAsset}
              onSelectAsset={(assetId) => {
                setSelectedAssetId(assetId);
                setAssetPreviewOpen(true);
              }}
            />
          ) : null}
          {activeModule === "export" ? <ExportModule project={project} library={library} /> : null}
        </div>
      </section>
      {segmentEditorOpen ? (
        <SegmentEditorModal
          project={project}
          library={library}
          chapter={activeChapter}
          segment={segment}
          time={time}
          playing={playing}
          onClose={() => {
            setPlaying(false);
            setSegmentEditorOpen(false);
          }}
          onPlayingChange={setPlaying}
          onTimeChange={setTime}
          onUpdateChapter={updateChapter}
          onUpdateSegment={updateSegment}
        />
      ) : null}
      {assetPreviewOpen ? <AssetPreviewModal asset={selectedAsset} onClose={() => setAssetPreviewOpen(false)} /> : null}
      {pendingImport ? (
        <ImportTypeModal
          pending={pendingImport}
          onCancel={() => setPendingImport(null)}
          onConfirm={confirmPendingImport}
        />
      ) : null}
      {aiOpen ? (
        <AiAssetGenerator
          defaultType="character"
          defaultScope={aiOpen.scope}
          onClose={() => setAiOpen(null)}
          onRegistered={(manifest) => {
            if (manifest.scope === "project") {
              setProject((current) => ({
                ...current,
                assetRefs: [...new Set([manifest.assetId, ...current.assetRefs])],
              }));
            }
            setSelectedAssetId(manifest.assetId);
            setNotice(`AI 已入库资产「${manifest.name}」。`);
            void reloadLibraryFromApi();
          }}
        />
      ) : null}
      {aiSegmentOpen ? (
        <AiSegmentGenerator
          project={project}
          library={library}
          onClose={() => setAiSegmentOpen(false)}
          onAccept={acceptAiSegment}
        />
      ) : null}
      {newProjectOpen ? (
        <NewProjectModal
          existingIds={availableProjects.map((p) => p.projectId)}
          onClose={() => setNewProjectOpen(false)}
          onCreated={async (created) => {
            await api.saveProject(created);
            await reloadLibraryFromApi();
            setProject(created);
            setTime(0);
            setPlaying(false);
            setNewProjectOpen(false);
            setNotice(`已创建项目「${created.title}」并切换。`);
          }}
        />
      ) : null}
      {batchImportOpen ? (
        <BatchImportPlanner
          defaultScope={batchImportOpen.scope}
          onClose={() => setBatchImportOpen(null)}
          onRegistered={(manifests) => {
            // Splice in via library reload so the new asset shows up everywhere.
            setNotice(`AI 已批量入库 ${manifests.length} 个资产。`);
            void reloadLibraryFromApi();
            for (const m of manifests) {
              if (m.scope === "project") {
                setProject((current) => ({ ...current, assetRefs: [...new Set([m.assetId, ...current.assetRefs])] }));
              }
            }
          }}
        />
      ) : null}
    </main>
  );
}

function AssetLibraryModule({
  notice,
  globalAssets,
  selectedAssetId,
  onSpineImport,
  onOpenBatchImport,
  onSelectAsset,
  onOpenAi,
  onDeleteAsset,
}: {
  notice: string;
  globalAssets: AssetManifest[];
  selectedAssetId: string;
  onSpineImport: (file: File | undefined) => void;
  onOpenBatchImport: () => void;
  onSelectAsset: (assetId: string) => void;
  onOpenAi: () => void;
  onDeleteAsset: (assetId: string) => void;
}) {
  return (
    <section className="asset-library-layout">
      <section className="panel asset-import-toolbar slim">
        <div className="toolbar-title">
          <Boxes size={18} />
          <span>通用素材导入</span>
        </div>
        <button type="button" className="file-button ai-trigger" onClick={onOpenBatchImport} title="选择 1 张或多张图，AI 自动归类生成 manifest（覆盖单图导入场景）">
          <Sparkles size={17} />
          <span>AI 批量图像导入</span>
        </button>
        <label className="file-button" title="Spine 2D 骨骼动画格式（Spine 3.x / 4.x JSON 导出）">
          <FileJson size={17} />
          <span>导入 Spine JSON</span>
          <input type="file" accept=".json,application/json" onChange={(event) => onSpineImport(event.target.files?.[0])} />
        </label>
        <button type="button" className="file-button ai-trigger" onClick={onOpenAi}>
          <Sparkles size={17} />
          <span>AI 生成资产</span>
        </button>
        {notice ? <p className="notice inline-notice">{notice}</p> : null}
      </section>

      <AssetTypeGallery
        title="按类型浏览（通用）"
        assets={globalAssets}
        selectedAssetId={selectedAssetId}
        onSelect={onSelectAsset}
        onDelete={onDeleteAsset}
      />
    </section>
  );
}

function ProjectModule({
  project,
  library,
  activeChapterId,
  activeSegmentId,
  onCreateChapter,
  onCreateSegment,
  onSelectSegment,
  onOpenSegmentEditor,
  onUpdateProject,
  onUpdateProjectConfig,
  onUpdateChapter,
  onUpdateSegment,
  onSpineImport,
  onOpenBatchImport,
  onOpenAi,
  onDeleteAsset,
  onSelectAsset,
}: {
  project: Project;
  library: AssetLibrary;
  activeChapterId: string;
  activeSegmentId: string;
  onCreateChapter: () => void;
  onCreateSegment: (chapterId: string) => void;
  onSelectSegment: (chapterId: string, segmentId: string) => void;
  onOpenSegmentEditor: (chapterId: string, segmentId: string) => void;
  onUpdateProject: (patch: Partial<Pick<Project, "title" | "description">>) => void;
  onUpdateProjectConfig: (patch: Partial<Project["config"]>) => void;
  onUpdateChapter: (chapterId: string, patch: Partial<Chapter>) => void;
  onUpdateSegment: (chapterId: string, segmentId: string, patch: Partial<Segment>) => void;
  onSpineImport: (file: File | undefined) => void;
  onOpenBatchImport: () => void;
  onOpenAi: () => void;
  onDeleteAsset: (assetId: string) => void;
  onSelectAsset: (assetId: string) => void;
}) {
  const allAssets = [...library.globalAssets, ...library.projectAssets];
  const activeChapter = project.chapters.find((chapter) => chapter.chapterId === activeChapterId) ?? project.chapters[0];
  const activeSegment = activeChapter.segments.find((segmentItem) => segmentItem.segmentId === activeSegmentId) ?? activeChapter.segments[0];
  const usedIds = useMemo(() => collectTimelineUsedAssetIds(project), [project]);
  const [activeTab, setActiveTab] = useState<"structure" | "assets">("structure");

  const subTabs: Array<{ id: "structure" | "assets"; label: string; hint: string }> = [
    { id: "structure", label: "项目结构", hint: "项目参数 · 章节 · 片段 · 时间线" },
    { id: "assets", label: "项目资产", hint: `${library.projectAssets.length} 个项目资产` },
  ];

  return (
    <section className="project-module-shell">
      <nav className="project-subtabs" aria-label="项目管理子模块">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "is-active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            <strong>{tab.label}</strong>
            <small>{tab.hint}</small>
          </button>
        ))}
      </nav>

      {activeTab === "assets" ? (
        <section className="data-panel project-assets-panel">
          <div className="panel-title">
            <span>项目资产</span>
            <small>{library.projectAssets.length}</small>
          </div>
          <div className="project-assets-toolbar">
            <button type="button" className="file-button ai-trigger" onClick={onOpenBatchImport} title="选择 1 张或多张图，AI 自动归类生成 manifest">
              <Sparkles size={16} />
              <span>AI 批量图像导入</span>
            </button>
            <label className="file-button" title="Spine 2D 骨骼动画格式">
              <FileJson size={16} />
              <span>导入 Spine JSON</span>
              <input type="file" accept=".json,application/json" onChange={(event) => onSpineImport(event.target.files?.[0])} />
            </label>
            <button type="button" className="file-button ai-trigger" onClick={onOpenAi}>
              <Sparkles size={16} />
              <span>AI 生成资产</span>
            </button>
          </div>
          <AssetTypeGallery
            title="按类型浏览（项目）"
            assets={library.projectAssets}
            selectedAssetId=""
            onSelect={onSelectAsset}
            onDelete={onDeleteAsset}
            isDeletable={(asset) => !usedIds.has(asset.assetId)}
            emptyHint="暂无项目资产，使用上方按钮导入或 AI 生成。"
          />
        </section>
      ) : null}

      {activeTab === "structure" ? (
        <section className="module-grid project-module-grid">
      <section className="data-panel">
        <h3>项目参数</h3>
        <div className="form-grid">
          <label>
            <span>项目名称</span>
            <input value={project.title} onChange={(event) => onUpdateProject({ title: event.target.value })} />
          </label>
          <label>
            <span>项目描述</span>
            <textarea value={project.description} onChange={(event) => onUpdateProject({ description: event.target.value })} rows={4} />
          </label>
          <div className="field-row">
            <label>
              <span>分辨率</span>
              <select value={project.config.resolution} onChange={(event) => onUpdateProjectConfig({ resolution: event.target.value as Project["config"]["resolution"] })}>
                <option value="1280x720">1280x720</option>
                <option value="1920x1080">1920x1080</option>
              </select>
            </label>
            <label>
              <span>FPS</span>
              <input
                type="number"
                min={1}
                max={120}
                value={project.config.fps}
                onChange={(event) => onUpdateProjectConfig({ fps: Number(event.target.value) || 1 })}
              />
            </label>
          </div>
        </div>
        <div className="metric-grid compact-metrics">
          <Metric label="章节" value={project.chapters.length} />
          <Metric label="资产引用" value={project.assetRefs.length} />
          <Metric label="FPS" value={project.config.fps} />
        </div>
      </section>

      <section className="data-panel">
        <div className="panel-title">
          <span>章节与片段</span>
          <button className="mini-command" type="button" onClick={onCreateChapter}>
            <Sparkles size={15} />
            <span>新章节</span>
          </button>
        </div>
        <p>当前：{activeChapter.title} · {activeSegment.name}</p>
        <div className="chapter-stack">
          {project.chapters.map((chapter) => (
            <article key={chapter.chapterId} className={`chapter-card ${chapter.chapterId === activeChapterId ? "is-selected" : ""}`}>
              <button type="button" onClick={() => onSelectSegment(chapter.chapterId, chapter.segments[0]?.segmentId ?? "")}>
                <strong>{chapter.title}</strong>
                <span>{chapter.sceneId}</span>
                <small>{labelFor(transitionLabels, chapter.transition.type)} · {chapter.segments.length} 片段 · {chapter.characters.length} 角色</small>
              </button>
              <div className="segment-stack">
                {chapter.segments.map((segmentItem) => (
                  <button
                    key={segmentItem.segmentId}
                    type="button"
                    className={segmentItem.segmentId === activeSegmentId ? "is-selected" : ""}
                    onClick={() => onOpenSegmentEditor(chapter.chapterId, segmentItem.segmentId)}
                  >
                    <span>{segmentItem.name}</span>
                    <small>{segmentItem.duration}s · {segmentItem.timeline.length} 事件</small>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="data-panel">
        <div className="panel-title">
          <span>当前章节 / 片段参数</span>
          <button className="mini-command" type="button" onClick={() => onCreateSegment(activeChapter.chapterId)}>
            <Sparkles size={15} />
            <span>新片段</span>
          </button>
        </div>
        <div className="form-grid">
          <label>
            <span>章节标题</span>
            <input value={activeChapter.title} onChange={(event) => onUpdateChapter(activeChapter.chapterId, { title: event.target.value })} />
          </label>
          <label>
            <span>使用场景</span>
            <select value={activeChapter.sceneId} onChange={(event) => onUpdateChapter(activeChapter.chapterId, { sceneId: event.target.value })}>
              {library.scenes.map((scene) => (
                <option key={scene.sceneId} value={scene.sceneId}>
                  {scene.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label>
              <span>章节过渡</span>
              <select
                value={activeChapter.transition.type}
                onChange={(event) =>
                  onUpdateChapter(activeChapter.chapterId, {
                    transition: { ...activeChapter.transition, type: event.target.value as Chapter["transition"]["type"] },
                  })
                }
              >
                {(Object.keys(transitionLabels) as Array<Chapter["transition"]["type"]>).map((value) => (
                  <option key={value} value={value}>
                    {transitionLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>过渡时长</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={activeChapter.transition.duration}
                onChange={(event) =>
                  onUpdateChapter(activeChapter.chapterId, {
                    transition: { ...activeChapter.transition, duration: Number(event.target.value) || 0 },
                  })
                }
              />
            </label>
          </div>
          <label>
            <span>片段名称</span>
            <input value={activeSegment.name} onChange={(event) => onUpdateSegment(activeChapter.chapterId, activeSegment.segmentId, { name: event.target.value })} />
          </label>
          <label>
            <span>片段时长</span>
            <input
              type="number"
              min={1}
              step={0.5}
              value={activeSegment.duration}
              onChange={(event) => onUpdateSegment(activeChapter.chapterId, activeSegment.segmentId, { duration: Number(event.target.value) || 1 })}
            />
          </label>
        </div>
        <button className="open-segment-editor" type="button" onClick={() => onOpenSegmentEditor(activeChapter.chapterId, activeSegment.segmentId)}>
          <Play size={17} />
          <span>打开片段渲染编辑</span>
          <small>{activeSegment.duration}s · {activeSegment.timeline.length} 时间轴事件</small>
        </button>
        <details className="reference-details">
          <summary>项目资产引用</summary>
          <div className="ref-list">
            {project.assetRefs.map((assetId) => {
              const asset = allAssets.find((item) => item.assetId === assetId);
              return (
                <article key={assetId} className="ref-row">
                  <strong>{asset?.name ?? assetId}</strong>
                  <span>{labelFor(assetTypeLabels, asset?.type ?? "scene")} · {assetId}</span>
                </article>
              );
            })}
          </div>
        </details>
      </section>
        </section>
      ) : null}
    </section>
  );
}

function SegmentEditorModal({
  project,
  library,
  chapter,
  segment,
  time,
  playing,
  onClose,
  onPlayingChange,
  onTimeChange,
  onUpdateChapter,
  onUpdateSegment,
}: {
  project: Project;
  library: AssetLibrary;
  chapter: Chapter;
  segment: Segment;
  time: number;
  playing: boolean;
  onClose: () => void;
  onPlayingChange: (value: boolean | ((current: boolean) => boolean)) => void;
  onTimeChange: (value: number | ((current: number) => number)) => void;
  onUpdateChapter: (chapterId: string, patch: Partial<Chapter>) => void;
  onUpdateSegment: (chapterId: string, segmentId: string, patch: Partial<Segment>) => void;
}) {
  const [selectedEventIndex, setSelectedEventIndex] = useState(0);
  const selectedEvent = segment.timeline[selectedEventIndex] ?? null;

  function updateTimelineEvent(eventIndex: number, nextEvent: TimelineEvent) {
    const nextTimeline = segment.timeline.map((eventItem, index) => (index === eventIndex ? nextEvent : eventItem));
    onUpdateSegment(chapter.chapterId, segment.segmentId, { timeline: nextTimeline });
  }

  function selectAndSeek(eventIndex: number) {
    setSelectedEventIndex(eventIndex);
    const target = segment.timeline[eventIndex];
    if (!target) return;
    onPlayingChange(false);
    onTimeChange(Math.min(Math.max(target.time, 0), segment.duration));
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="segment-modal" role="dialog" aria-modal="true" aria-label="片段渲染编辑" onMouseDown={(event) => event.stopPropagation()}>
        <header className="segment-modal-header">
          <div>
            <p className="eyebrow">Segment Render Editor</p>
            <h2>片段渲染编辑</h2>
          </div>
          <button className="icon-button" type="button" title="关闭片段编辑" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="segment-modal-body">
          <section className="preview-panel">
            <div className="preview-context">
              <div>
                <p className="eyebrow">预览</p>
                <h3>点击画面播放 / 暂停</h3>
              </div>
              <div className="asset-chip-row" style={{ alignItems: "center" }}>
                <span>{time.toFixed(1)}s</span>
                <span>{segment.duration}s</span>
                <button
                  type="button"
                  className="icon-button"
                  title="导出当前帧为 PNG"
                  onClick={() => {
                    const canvas = document.querySelector(".preview-canvas") as HTMLCanvasElement | null;
                    if (!canvas) return;
                    canvas.toBlob((blob) => {
                      if (!blob) return;
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      const stamp = `${segment.segmentId}_t${time.toFixed(2)}s`.replace(/[^a-z0-9_.-]/gi, "_");
                      a.download = `frame_${stamp}.png`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }, "image/png");
                  }}
                >
                  <Download size={16} />
                </button>
              </div>
            </div>
            <button className="preview-click-target" type="button" onClick={() => onPlayingChange((current) => !current)} title={playing ? "暂停" : "播放"}>
              <PreviewCanvas project={project} library={library} time={time} playing={playing} />
            </button>
            <section className="control-strip">
              <button className="icon-button" type="button" title={playing ? "暂停" : "播放"} onClick={() => onPlayingChange((current) => !current)}>
                {playing ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button
                className="icon-button"
                type="button"
                title="重播"
                onClick={() => {
                  onPlayingChange(false);
                  onTimeChange(0);
                }}
              >
                <RotateCcw size={19} />
              </button>
              <TimelineScrubber
                duration={segment.duration}
                time={time}
                events={segment.timeline}
                selectedEventIndex={selectedEventIndex}
                onTimeChange={onTimeChange}
                onSelectEvent={selectAndSeek}
              />
              <strong>{time.toFixed(1)}s</strong>
              <span>/ {segment.duration}s</span>
            </section>
          </section>

          <section className="segment-edit-panel">
            <section className="data-panel">
              <h3>片段参数</h3>
              <div className="form-grid">
                <label>
                  <span>章节标题</span>
                  <input value={chapter.title} onChange={(event) => onUpdateChapter(chapter.chapterId, { title: event.target.value })} />
                </label>
                <label>
                  <span>片段名称</span>
                  <input value={segment.name} onChange={(event) => onUpdateSegment(chapter.chapterId, segment.segmentId, { name: event.target.value })} />
                </label>
                <div className="field-row">
                  <label>
                    <span>使用场景</span>
                    <select value={chapter.sceneId} onChange={(event) => onUpdateChapter(chapter.chapterId, { sceneId: event.target.value })}>
                      {library.scenes.map((scene) => (
                        <option key={scene.sceneId} value={scene.sceneId}>
                          {scene.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>片段时长</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={segment.duration}
                      onChange={(event) => onUpdateSegment(chapter.chapterId, segment.segmentId, { duration: Number(event.target.value) || 1 })}
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="data-panel timeline-panel">
              <div className="panel-title">
                <span>时间轴</span>
                <small>{segment.timeline.length} 事件</small>
              </div>
              <div className="timeline-meta">
                <span>{chapter.title}</span>
                <span>{segment.name}</span>
                <span>{chapter.sceneId}</span>
              </div>
              <BatchAudioGenerator
                projectId={project.projectId}
                segmentId={segment.segmentId}
                eventCount={segment.timeline.filter((e) => (e.type === "dialogue" || e.type === "narration") && (e as { text?: string }).text).length}
                hasAudioCount={segment.timeline.filter((e) => (e.type === "dialogue" || e.type === "narration") && (e as { audioUrl?: string }).audioUrl).length}
                onSegmentUpdated={(updatedSegment) => onUpdateSegment(chapter.chapterId, segment.segmentId, {
                  timeline: updatedSegment.timeline,
                  duration: Math.max(updatedSegment.duration, segment.duration),
                })}
              />
              <InlineTimelineEvents events={segment.timeline} selectedEventIndex={selectedEventIndex} onSelectEvent={selectAndSeek} />
              <TimelineEventEditor
                event={selectedEvent}
                eventIndex={selectedEventIndex}
                onChange={(nextEvent) => updateTimelineEvent(selectedEventIndex, nextEvent)}
              />
            </section>
          </section>
        </section>
      </section>
    </div>
  );
}

/**
 * Modal-form project creation. Picks a starter template (blank / luoxiaohei),
 * collects core fields (id, title, resolution, fps, styleBar), validates that
 * the id is unique among existing projects, then hands the new Project to the
 * parent for persistence + auto-switch.
 *
 * The id auto-derives from the title (slugified + timestamp) but is editable.
 */
function NewProjectModal({
  existingIds,
  onCreated,
  onClose,
}: {
  existingIds: string[];
  onCreated: (project: Project) => void | Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectIdTouched, setProjectIdTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [resolution, setResolution] = useState<"1280x720" | "1920x1080">("1280x720");
  const [fps, setFps] = useState(30);
  const [styleBar, setStyleBar] = useState<"" | "luoxiaohei" | "shinkai" | "ghibli" | "jiangnan-baiyi">("");
  const [template, setTemplate] = useState<"blank" | "luoxiaohei-starter">("blank");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-derive projectId from title unless the user edited it directly.
  useEffect(() => {
    if (projectIdTouched) return;
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    const stamp = Date.now().toString(36).slice(-4);
    setProjectId(slug ? `project_${slug}_${stamp}` : "");
  }, [title, projectIdTouched]);

  // Choosing the luoxiaohei-starter template flips the styleBar automatically.
  useEffect(() => {
    if (template === "luoxiaohei-starter") setStyleBar("luoxiaohei");
  }, [template]);

  const idCollides = projectId && existingIds.includes(projectId);

  async function submit() {
    setErr(null);
    if (!title.trim()) { setErr("项目标题不能为空"); return; }
    if (!projectId.trim()) { setErr("项目 ID 不能为空"); return; }
    if (idCollides) { setErr(`项目 ID「${projectId}」已存在，换一个`); return; }

    setBusy(true);
    try {
      const project: Project = {
        projectId: projectId.trim(),
        title: title.trim(),
        description: description.trim() || "（暂无描述）",
        assetRefs: [],
        chapters: [{
          chapterId: `chapter_${Date.now().toString(36)}_001`,
          title: template === "luoxiaohei-starter" ? "第一章" : "新章节",
          sceneId: "",
          characters: [],
          transition: { type: "fadeIn", duration: 1 },
          segments: [{
            segmentId: `segment_${Date.now().toString(36)}_001`,
            name: "新片段",
            duration: template === "luoxiaohei-starter" ? 22 : 15,
            timeline: [],
          }],
        }],
        config: {
          resolution,
          fps,
          ...(styleBar ? { styleBar } : {}),
        },
        preview: {
          activeChapterId: "",
          activeSegmentId: "",
        },
        export: { includeAssets: true, includeTimeline: true },
        aiReserved: {
          assetGenerationEndpoint: "",
          timelineGenerationEndpoint: "",
          acceptedSchemas: ["AssetManifest", "Segment"],
        },
      };
      // Make preview point at the new (empty) chapter / segment we just stubbed.
      project.preview.activeChapterId = project.chapters[0].chapterId;
      project.preview.activeSegmentId = project.chapters[0].segments[0].segmentId;
      await onCreated(project);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="asset-modal"
        role="dialog"
        aria-modal="true"
        aria-label="新建项目"
        onMouseDown={(event) => event.stopPropagation()}
        style={{ maxWidth: 640, width: "92vw" }}
      >
        <header className="asset-preview-header">
          <div>
            <p className="eyebrow">Project</p>
            <h2>新建项目</h2>
            <span>创建后自动入库 (SQLite projects 表) 并切换到当前编辑</span>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <section className="data-panel" style={{ border: "none", boxShadow: "none", padding: "0 4px" }}>

        <div className="form-grid">
          <label>
            <span>项目标题</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：森林晨光"
              maxLength={80}
            />
          </label>

          <label>
            <span>项目 ID <small style={{ color: "var(--muted, #888)" }}>（snake_case，DB 主键）</small></span>
            <input
              type="text"
              value={projectId}
              onChange={(e) => { setProjectId(e.target.value); setProjectIdTouched(true); }}
              placeholder="自动从标题生成"
              style={idCollides ? { borderColor: "var(--err, #c0392b)" } : {}}
            />
          </label>

          <label>
            <span>项目描述（选填）</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="一两句话写清楚剧情/风格意图，AI 生成片段时会读这段。"
            />
          </label>

          <div className="field-row">
            <label>
              <span>分辨率</span>
              <select value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
                <option value="1280x720">1280×720 (720p)</option>
                <option value="1920x1080">1920×1080 (1080p)</option>
              </select>
            </label>
            <label>
              <span>FPS</span>
              <input type="number" min={15} max={60} step={1} value={fps}
                     onChange={(e) => setFps(Number(e.target.value) || 30)} />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>起始模板</span>
              <select value={template} onChange={(e) => setTemplate(e.target.value as typeof template)}>
                <option value="blank">空白项目（自己加章节）</option>
                <option value="luoxiaohei-starter">罗小黑模板（预设 22s 段位 + LX 风格档）</option>
              </select>
            </label>
            <label>
              <span>风格档位</span>
              <select value={styleBar} onChange={(e) => setStyleBar(e.target.value as typeof styleBar)}>
                <option value="">（无 — 走基线 2.5D 规则）</option>
                <option value="luoxiaohei">罗小黑战记</option>
                <option value="shinkai" disabled>新海诚（敬请期待）</option>
                <option value="ghibli" disabled>吉卜力（敬请期待）</option>
                <option value="jiangnan-baiyi" disabled>江南白衣（敬请期待）</option>
              </select>
            </label>
          </div>
        </div>

        {err ? (
          <p style={{ color: "var(--err, #c0392b)", fontSize: 13, marginTop: 12 }}>{err}</p>
        ) : null}

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button
            type="button"
            className="primary"
            disabled={busy || !title.trim() || !projectId.trim() || Boolean(idCollides)}
            onClick={submit}
          >
            {busy ? "创建中…" : "创建并进入"}
          </button>
        </div>
        </section>
      </aside>
    </div>
  );
}

function ExportModule({ project, library }: { project: Project; library: AssetLibrary }) {
  return (
    <section className="module-grid export-module-grid">
      <section className="data-panel">
        <h3>导出</h3>
        <div className="export-actions">
          <button type="button" onClick={() => downloadJson("cucumber-project.json", buildProjectExport(project, library))}>
            <Download size={17} />
            <span>导出项目 JSON</span>
          </button>
          <button type="button" onClick={() => downloadJson("asset-manifests.json", buildAssetManifestExport(library))}>
            <Download size={17} />
            <span>导出资产配置</span>
          </button>
        </div>
      </section>
      <SchemaPanel project={project} library={library} />
      <section className="data-panel">
        <h3>AI 接入预留</h3>
        <pre>{JSON.stringify(project.aiReserved, null, 2)}</pre>
      </section>
    </section>
  );
}

function AssetTypeGallery({
  title,
  assets,
  selectedAssetId,
  onSelect,
  onDelete,
  isDeletable,
  emptyHint,
}: {
  title: string;
  assets: AssetManifest[];
  selectedAssetId: string;
  onSelect: (assetId: string) => void;
  onDelete: (assetId: string) => void;
  isDeletable?: (asset: AssetManifest) => boolean;
  emptyHint?: string;
}) {
  const orderedTypes = getOrderedAssetTypes(assets);

  return (
    <section className="panel asset-type-gallery">
      <div className="panel-title">
        <span>{title}</span>
        <small>{assets.length}</small>
      </div>
      {assets.length === 0 && emptyHint ? <p className="notice inline-notice">{emptyHint}</p> : null}
      <div className="asset-type-scroll">
        {orderedTypes.map((type) => (
          <section key={type} className="asset-type-section">
            <div className="asset-type-heading">
              <strong>{labelFor(assetTypeLabels, type)}</strong>
              <span>{assets.filter((asset) => asset.type === type).length}</span>
            </div>
            <div className="asset-card-grid">
              {assets
                .filter((asset) => asset.type === type)
                .map((asset) => {
                  const deletable = isDeletable ? isDeletable(asset) : true;
                  return (
                    <div
                      key={asset.assetId}
                      className={`asset-card ${asset.assetId === selectedAssetId ? "is-selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="asset-card-body"
                        onClick={() => onSelect(asset.assetId)}
                        title={`预览 ${asset.name}`}
                      >
                        <div className="asset-card-thumb">
                          <AssetVisual asset={asset} />
                        </div>
                        <div className="asset-card-meta">
                          <strong>{asset.name}</strong>
                          <span>{labelFor(assetScopeLabels, asset.scope)} · {asset.source.format}</span>
                        </div>
                        <Eye size={15} className="asset-card-eye" />
                      </button>
                      <button
                        type="button"
                        className="asset-card-delete"
                        disabled={!deletable}
                        title={deletable ? `删除 ${asset.name}` : "仍被时间线引用，无法删除"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(asset.assetId);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function ImportTypeModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingImport;
  onCancel: () => void;
  onConfirm: (type: AssetType) => void;
}) {
  const initialType: AssetType = pending.kind === "spritesheet" ? "effect" : "character";
  const [type, setType] = useState<AssetType>(initialType);
  const kindLabel = pending.kind === "image" ? "图片" : "图集 JSON";
  const scopeLabel = labelFor(assetScopeLabels, pending.scope);
  const options: AssetType[] = pending.kind === "spritesheet" ? ["effect", "action"] : imageTypes;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div className="modal import-type-modal" role="dialog" aria-modal="true" aria-label="选择导入分类" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-title">
            <FolderInput size={18} />
            <span>选择导入分类</span>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} title="取消">
            <X size={16} />
          </button>
        </header>
        <section className="import-type-form">
          <p className="muted">
            将 <strong>{pending.file.name}</strong> 作为「{scopeLabel}」{kindLabel}入库，请选择资产分类。
          </p>
          <label>
            <span>资产分类</span>
            <select value={type} onChange={(event) => setType(event.target.value as AssetType)}>
              {options.map((value) => (
                <option key={value} value={value}>
                  {assetTypeLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>取消</button>
            <button type="button" className="primary" onClick={() => onConfirm(type)}>确认导入</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function AssetPreviewModal({ asset, onClose }: { asset: AssetManifest | null; onClose: () => void }) {
  if (!asset) return null;

  const sourceUrl = getSourceUrl(asset);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="asset-modal" role="dialog" aria-modal="true" aria-label="资产详情" onMouseDown={(event) => event.stopPropagation()}>
        <header className="asset-preview-header">
          <div>
            <p className="eyebrow">Asset Manifest</p>
            <h2>{asset.name}</h2>
            <span>{asset.assetId}</span>
          </div>
          <button className="icon-button" type="button" title="关闭预览" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {asset.metadata && (asset.metadata as Record<string, unknown>).shape ? (
          <figure className="asset-visual character-visual">
            <AssetPreviewStage asset={asset} />
          </figure>
        ) : (
          <AssetVisual asset={asset} />
        )}

        <section className="asset-preview-section">
          <div className="asset-chip-row">
            <span>{labelFor(assetScopeLabels, asset.scope)}</span>
            <span>{labelFor(assetCategoryLabels, asset.category)}</span>
            <span>{labelFor(assetTypeLabels, asset.type)}</span>
            <span>{asset.source.format}</span>
          </div>
        </section>

        <section className="asset-preview-section">
          <h3>来源与授权</h3>
          <dl className="asset-fields">
            <div>
              <dt>来源</dt>
              <dd>{labelFor(sourceKindLabels, asset.source.kind)} · {asset.source.originalFile}</dd>
            </div>
            <div>
              <dt>授权</dt>
              <dd>{asset.license.type || "unknown"}</dd>
            </div>
            <div>
              <dt>作者</dt>
              <dd>{asset.license.author || "未填写"}</dd>
            </div>
            <div>
              <dt>可商用</dt>
              <dd>{asset.license.commercialUse ? "是" : "否 / 未确认"}</dd>
            </div>
            <div>
              <dt>需署名</dt>
              <dd>{asset.license.needAttribution ? "是" : "否"}</dd>
            </div>
          </dl>
          {sourceUrl ? (
            <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              <span>打开来源</span>
            </a>
          ) : null}
        </section>

        <section className="asset-preview-section">
          <h3>标签</h3>
          <div className="asset-chip-row">
            {asset.tags.length ? asset.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>无标签</span>}
          </div>
        </section>

        <section className="asset-preview-section">
          <h3>Manifest</h3>
          <pre className="asset-json">{JSON.stringify(asset, null, 2)}</pre>
        </section>
      </aside>
    </div>
  );
}

function AssetVisual({ asset }: { asset: AssetManifest }) {
  const imageSrc = getPreviewImage(asset);
  if (imageSrc) {
    return (
      <figure className="asset-visual">
        <img src={imageSrc} alt={asset.name} />
      </figure>
    );
  }

  if (asset.metadata && (asset.metadata as Record<string, unknown>).shape) {
    return (
      <figure className="asset-visual character-visual">
        <CharacterPortrait asset={asset} />
      </figure>
    );
  }

  const palette = (asset.metadata.palette ?? {}) as Record<string, string>;
  const style = {
    "--preview-body": palette.body ?? (asset.type === "scene" ? "#7ea9a0" : "#3d6f84"),
    "--preview-accent": palette.skin ?? (asset.type === "effect" ? "#ffd558" : "#f0b985"),
    "--preview-dark": palette.hair ?? "#253132",
  } as CSSProperties;

  return (
    <figure className={`asset-visual procedural-${asset.type}`} style={style}>
      <div className="procedural-preview">
        <span>{labelFor(assetTypeLabels, asset.type)}</span>
      </div>
    </figure>
  );
}

function ProjectStructure({ project }: { project: Project }) {
  return (
    <section className="data-panel">
      <h3>项目结构</h3>
      <p>{project.description}</p>
      <div className="metric-grid">
        <Metric label="章节" value={project.chapters.length} />
        <Metric label="资产引用" value={project.assetRefs.length} />
        <Metric label="FPS" value={project.config.fps} />
      </div>
      {project.chapters.map((chapter) => (
        <div key={chapter.chapterId} className="chapter-line">
          <strong>{chapter.title}</strong>
          <span>{labelFor(transitionLabels, chapter.transition.type)} · {chapter.segments.length} 片段</span>
        </div>
      ))}
    </section>
  );
}

function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="data-panel timeline-panel">
      <h3>时间线事件</h3>
      <InlineTimelineEvents events={events} />
    </section>
  );
}

const SCRUBBER_LANES: Array<{
  id: "scene" | "character" | "audio";
  label: string;
  types: ReadonlyArray<TimelineEvent["type"]>;
}> = [
  { id: "scene", label: "场景 / 镜头 / 特效", types: ["sceneChange", "cameraChange", "effectPlay"] },
  {
    id: "character",
    label: "角色",
    types: ["characterAppear", "characterDisappear", "characterMove", "characterAction", "expressionChange", "propChange"],
  },
  { id: "audio", label: "对白 / 字幕 / 音频", types: ["dialogue", "narration", "subtitle", "bgmPlay", "soundEffect"] },
];

function getEventLane(type: TimelineEvent["type"]): "scene" | "character" | "audio" {
  for (const lane of SCRUBBER_LANES) {
    if (lane.types.includes(type)) return lane.id;
  }
  return "character";
}

function getEventDuration(event: TimelineEvent): number {
  if (event.type === "subtitle" || event.type === "dialogue" || event.type === "narration") return event.duration;
  if (event.type === "characterMove") return event.duration;
  if (event.type === "effectPlay") return event.duration;
  if (event.type === "cameraChange") return event.camera.duration;
  return 0;
}

function TimelineScrubber({
  duration,
  time,
  events,
  selectedEventIndex,
  onTimeChange,
  onSelectEvent,
}: {
  duration: number;
  time: number;
  events: TimelineEvent[];
  selectedEventIndex: number;
  onTimeChange: (value: number) => void;
  onSelectEvent: (eventIndex: number) => void;
}) {
  const safeDuration = duration > 0 ? duration : 1;
  return (
    <div className="scrubber">
      <input
        aria-label="时间线进度"
        type="range"
        min={0}
        max={duration}
        step={0.05}
        value={time}
        onChange={(event) => onTimeChange(Number(event.target.value))}
      />
      <div className="scrubber-lanes" aria-hidden="false">
        {SCRUBBER_LANES.map((lane) => {
          const items = events
            .map((event, index) => ({ event, index }))
            .filter(({ event }) => getEventLane(event.type) === lane.id);
          return (
            <div key={lane.id} className={`scrubber-lane scrubber-lane-${lane.id}`} title={lane.label}>
              {items.map(({ event, index }) => {
                const startPct = Math.min(100, Math.max(0, (event.time / safeDuration) * 100));
                const dur = getEventDuration(event);
                const widthPct = dur > 0 ? Math.min(100 - startPct, (dur / safeDuration) * 100) : 0;
                const isSelected = index === selectedEventIndex;
                const label = labelFor(timelineEventTypeLabels, event.type);
                const tooltip = dur > 0
                  ? `${event.time.toFixed(1)}s ~ ${(event.time + dur).toFixed(1)}s · ${label}`
                  : `${event.time.toFixed(1)}s · ${label}`;
                return (
                  <button
                    key={`lane-${lane.id}-${index}-${event.time}-${event.type}`}
                    type="button"
                    className={`scrubber-lane-item${isSelected ? " is-selected" : ""}${widthPct > 0 ? " has-duration" : ""}`}
                    style={{
                      left: `${startPct}%`,
                      width: widthPct > 0 ? `${widthPct}%` : undefined,
                    }}
                    title={tooltip}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onSelectEvent(index);
                    }}
                  >
                    <span className="sr-only">{tooltip}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineTimelineEvents({
  events,
  selectedEventIndex,
  onSelectEvent,
}: {
  events: TimelineEvent[];
  selectedEventIndex?: number;
  onSelectEvent?: (eventIndex: number) => void;
}) {
  const sortedEvents = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.time - b.event.time);

  return (
    <div className="timeline-list">
      {sortedEvents.map(({ event, index }) => (
        <button
          key={`${event.time}-${event.type}-${index}`}
          type="button"
          className={`event-row ${selectedEventIndex === index ? "is-selected" : ""}`}
          onClick={() => onSelectEvent?.(index)}
        >
          <time>{event.time.toFixed(1)}s</time>
          <div>
            <strong>{labelFor(timelineEventTypeLabels, event.type)}</strong>
            <span>{describeEvent(event)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

interface TtsVoice { id: string; name: string; gender: string; style: string; language: string }

/**
 * Walk the segment timeline server-side and synthesize TTS for every
 * dialogue / narration event that doesn't already carry an `audioUrl`.
 * Audio bytes land in the `tts_audio` SQLite table; the timeline gets
 * patched in place with the resulting URLs + viseme frames + duration.
 */
function BatchAudioGenerator({
  projectId,
  segmentId,
  eventCount,
  hasAudioCount,
  onSegmentUpdated,
}: {
  projectId: string;
  segmentId: string;
  eventCount: number;
  hasAudioCount: number;
  onSegmentUpdated: (segment: Segment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function runBatch() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/tts/segment-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, segmentId, defaultVoice: "longxiaochun", defaultEmotion: "calm" }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as {
        project: Project;
        generated: number;
        cached: number;
        skipped: number;
        events: Array<{ status: string; error?: string }>;
      };
      const errored = data.events.filter((e) => e.status === "error");
      // Pluck the updated segment out of the returned project and hand it up.
      for (const ch of data.project.chapters) {
        const found = ch.segments.find((s) => s.segmentId === segmentId);
        if (found) { onSegmentUpdated(found); break; }
      }
      const parts: string[] = [];
      if (data.generated) parts.push(`新生成 ${data.generated} 条`);
      if (data.cached) parts.push(`命中缓存 ${data.cached} 条`);
      if (data.skipped) parts.push(`跳过 ${data.skipped} 条`);
      if (errored.length) parts.push(`失败 ${errored.length} 条`);
      setResult(parts.join(" · ") || "无需生成");
      if (errored.length) setErr(errored[0].error ?? "部分事件生成失败");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const remaining = Math.max(eventCount - hasAudioCount, 0);
  return (
    <div className="batch-audio-bar" style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
      marginBottom: 10, background: "rgba(80, 130, 100, 0.08)",
      border: "1px solid rgba(80, 130, 100, 0.25)", borderRadius: 8,
    }}>
      <strong style={{ fontSize: 13 }}>批量音频</strong>
      <small style={{ color: "var(--muted, #666)", fontSize: 12 }}>
        {eventCount} 条带文本 · {hasAudioCount} 已生成 · {remaining} 待生成
      </small>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        className="primary"
        disabled={busy || remaining === 0}
        onClick={runBatch}
        title="为每个尚未配音的对白/旁白事件调用阿里 TTS"
      >
        {busy ? "生成中…" : remaining > 0 ? `生成 ${remaining} 条` : "全部已生成"}
      </button>
      {result ? <small style={{ color: "var(--ok, #2a7)", fontSize: 12 }}>{result}</small> : null}
      {err ? <small style={{ color: "var(--err, #c0392b)", fontSize: 12 }}>{err}</small> : null}
    </div>
  );
}

function TimelineEventEditor({
  event,
  eventIndex,
  onChange,
}: {
  event: TimelineEvent | null;
  eventIndex: number;
  onChange: (event: TimelineEvent) => void;
}) {
  if (!event) {
    return <div className="event-editor-empty">选择一个时间轴事件查看和编辑参数。</div>;
  }
  const currentEvent = event;
  const isDialogue = currentEvent.type === "dialogue" || currentEvent.type === "narration";

  function update(mutator: (draft: Record<string, unknown>) => void) {
    const draft = cloneEvent(currentEvent);
    mutator(draft);
    onChange(draft as TimelineEvent);
  }

  return (
    <section className="event-editor">
      <div className="panel-title">
        <span>事件 #{eventIndex + 1}</span>
        <small>{labelFor(timelineEventTypeLabels, currentEvent.type)}</small>
      </div>
      <div className="form-grid">
        <div className="field-row">
          <label>
            <span>时间</span>
            <input type="number" min={0} step={0.1} value={currentEvent.time} onChange={(inputEvent) => update((draft) => { draft.time = Number(inputEvent.target.value) || 0; })} />
          </label>
          <label>
            <span>类型</span>
            <input value={labelFor(timelineEventTypeLabels, currentEvent.type)} readOnly title={currentEvent.type} />
          </label>
        </div>

        {"target" in currentEvent ? (
          <label>
            <span>目标</span>
            <input value={String(currentEvent.target)} onChange={(inputEvent) => update((draft) => { draft.target = inputEvent.target.value; })} />
          </label>
        ) : null}

        {renderStringField("sceneId", "场景 ID", currentEvent, update)}
        {renderStringField("effectId", "特效 ID", currentEvent, update)}
        {renderStringField("propId", "道具 ID", currentEvent, update)}
        {renderStringField("assetId", "资产 ID", currentEvent, update)}
        {renderStringField("expression", "表情", currentEvent, update)}
        {renderStringField("text", "文本", currentEvent, update)}
        {renderNumberField("duration", "时长", currentEvent, update)}
        {renderNumberField("volume", "音量", currentEvent, update)}

        {"position" in currentEvent && isPoint(currentEvent.position) ? <PointEditor label="位置" point={currentEvent.position} onChange={(point) => update((draft) => { draft.position = point; })} /> : null}
        {"to" in currentEvent && isPoint(currentEvent.to) ? <PointEditor label="移动到" point={currentEvent.to} onChange={(point) => update((draft) => { draft.to = point; })} /> : null}
        {"camera" in currentEvent ? <CameraEventEditor event={currentEvent} onChange={update} /> : null}
      </div>

      {isDialogue ? <TtsPanel event={currentEvent as Extract<TimelineEvent, { type: "dialogue" | "narration" }>} onPatch={(patch) => update((draft) => Object.assign(draft, patch))} /> : null}

      <details className="event-json-details">
        <summary>查看完整事件 JSON</summary>
        <pre>{JSON.stringify(currentEvent, null, 2)}</pre>
      </details>
    </section>
  );
}

/**
 * TTS panel — appears for dialogue / narration events. Lets the user pick
 * voice + emotion, hit "生成", and have the resulting audioUrl / visemes
 * patched onto the event in place.
 *
 * Voices + emotion presets are fetched once from /api/tts/voices and
 * cached in module-level state via useState; we don't bother with a
 * cache key because the list is hard-coded server-side and never
 * changes during a session.
 */
function TtsPanel({
  event,
  onPatch,
}: {
  event: Extract<TimelineEvent, { type: "dialogue" | "narration" }>;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tts/voices")
      .then((r) => r.json())
      .then((data: { voices: TtsVoice[]; emotions: string[] }) => {
        if (cancelled) return;
        setVoices(data.voices ?? []);
        setEmotions(data.emotions ?? []);
      })
      .catch(() => {/* offline mode — leave defaults */});
    return () => { cancelled = true; };
  }, []);

  const voice = event.voice ?? "longxiaochun";
  const emotion = event.emotion ?? "neutral";
  const text = event.text ?? "";

  async function synthesize() {
    if (!text.trim()) {
      setErr("先填写台词文本");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, emotion }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { audioUrl: string; durationSec: number; visemes: unknown[]; voice: string };
      const newDuration = Math.max(Number(data.durationSec.toFixed(1)), 0.5);
      const patch: Record<string, unknown> = {
        audioUrl: data.audioUrl,
        voice,
        emotion,
        duration: newDuration,
      };
      if (event.type === "dialogue") patch.visemes = data.visemes;
      onPatch(patch);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function preview() {
    if (!event.audioUrl) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const a = new Audio(event.audioUrl);
    a.play().catch(() => {/* autoplay blocked, ignore */});
    audioRef.current = a;
  }

  return (
    <div className="tts-panel" style={{ marginTop: 12, padding: 12, border: "1px solid var(--border, #ddd)", borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong>TTS · 阿里语音</strong>
        {event.audioUrl ? <small style={{ color: "var(--ok, green)" }}>已生成</small> : <small style={{ color: "var(--muted, #888)" }}>未生成</small>}
      </div>
      <div className="field-row">
        <label>
          <span>音色</span>
          <select value={voice} onChange={(e) => onPatch({ voice: e.target.value })}>
            {voices.length === 0 ? <option value={voice}>{voice}</option> : voices.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.gender}, {v.style})</option>
            ))}
          </select>
        </label>
        <label>
          <span>情绪</span>
          <select value={emotion} onChange={(e) => onPatch({ emotion: e.target.value })}>
            {(emotions.length === 0 ? ["neutral", "happy", "sad", "angry", "surprised", "calm"] : emotions).map((em) => (
              <option key={em} value={em}>{em}</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="primary" disabled={busy || !text.trim()} onClick={synthesize}>
          {busy ? "生成中…" : event.audioUrl ? "重新生成" : "生成音频"}
        </button>
        {event.audioUrl ? (
          <button type="button" onClick={preview}>试听</button>
        ) : null}
        {event.audioUrl ? (
          <small style={{ alignSelf: "center", color: "var(--muted, #888)" }}>
            {event.type === "dialogue" && Array.isArray(event.visemes) ? `${event.visemes.length} viseme 帧` : "音频已就位"}
          </small>
        ) : null}
      </div>
      {err ? <div style={{ marginTop: 8, color: "var(--err, #c0392b)" }}>{err}</div> : null}
    </div>
  );
}

function PointEditor({ label, point, onChange }: { label: string; point: { x: number; y: number }; onChange: (point: { x: number; y: number }) => void }) {
  return (
    <div className="field-row">
      <label>
        <span>{label} X</span>
        <input type="number" value={point.x} onChange={(event) => onChange({ ...point, x: Number(event.target.value) || 0 })} />
      </label>
      <label>
        <span>{label} Y</span>
        <input type="number" value={point.y} onChange={(event) => onChange({ ...point, y: Number(event.target.value) || 0 })} />
      </label>
    </div>
  );
}

function CameraEventEditor({
  event,
  onChange,
}: {
  event: Extract<TimelineEvent, { type: "cameraChange" }>;
  onChange: (mutator: (draft: Record<string, unknown>) => void) => void;
}) {
  return (
    <>
      <div className="field-row">
        <label>
          <span>镜头模式</span>
          <select
            value={event.camera.mode}
            onChange={(inputEvent) =>
              onChange((draft) => {
                draft.camera = { ...event.camera, mode: inputEvent.target.value };
              })
            }
          >
            <option value="default">default</option>
            <option value="wide">wide</option>
            <option value="medium">medium</option>
            <option value="closeUp">closeUp</option>
            <option value="follow">follow</option>
          </select>
        </label>
        <label>
          <span>缩放</span>
          <input
            type="number"
            min={0.1}
            step={0.05}
            value={event.camera.zoom}
            onChange={(inputEvent) =>
              onChange((draft) => {
                draft.camera = { ...event.camera, zoom: Number(inputEvent.target.value) || 1 };
              })
            }
          />
        </label>
      </div>
      <label>
        <span>镜头目标</span>
        <input
          value={event.camera.target ?? ""}
          onChange={(inputEvent) =>
            onChange((draft) => {
              draft.camera = { ...event.camera, target: inputEvent.target.value || undefined };
            })
          }
        />
      </label>
    </>
  );
}

function renderStringField(
  key: string,
  label: string,
  event: TimelineEvent,
  update: (mutator: (draft: Record<string, unknown>) => void) => void,
) {
  if (!(key in event)) return null;
  const record = event as unknown as Record<string, unknown>;
  return (
    <label>
      <span>{label}</span>
      <input value={String(record[key] ?? "")} onChange={(inputEvent) => update((draft) => { draft[key] = inputEvent.target.value; })} />
    </label>
  );
}

function renderNumberField(
  key: string,
  label: string,
  event: TimelineEvent,
  update: (mutator: (draft: Record<string, unknown>) => void) => void,
) {
  if (!(key in event)) return null;
  const record = event as unknown as Record<string, unknown>;
  return (
    <label>
      <span>{label}</span>
      <input type="number" step={0.1} value={Number(record[key] ?? 0)} onChange={(inputEvent) => update((draft) => { draft[key] = Number(inputEvent.target.value) || 0; })} />
    </label>
  );
}

function cloneEvent(event: TimelineEvent): Record<string, unknown> {
  return JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
}

function getOrderedAssetTypes(assets: AssetManifest[]) {
  const preferred: AssetType[] = ["character", "scene", "prop", "effect", "background", "foreground", "expression", "action", "cameraTemplate"];
  const existing = new Set(assets.map((asset) => asset.type));
  return [
    ...preferred.filter((type) => existing.has(type)),
    ...[...existing].filter((type) => !preferred.includes(type)).sort(),
  ];
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { x?: unknown }).x === "number" &&
      typeof (value as { y?: unknown }).y === "number",
  );
}

function SchemaPanel({ project, library }: { project: Project; library: AssetLibrary }) {
  return (
    <section className="data-panel">
      <h3>标准 Schema</h3>
      <div className="schema-list">
        <div><Camera size={17} /> cameraChange</div>
        <div><Sparkles size={17} /> effectPlay</div>
        <div><Boxes size={17} /> Asset Manifest</div>
        <div><FileJson size={17} /> Project JSON</div>
      </div>
      <pre>{JSON.stringify({ projectId: project.projectId, assets: library.projectAssets.length, aiReserved: project.aiReserved.acceptedSchemas }, null, 2)}</pre>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function describeEvent(event: TimelineEvent) {
  if ("target" in event) return event.target;
  if (event.type === "sceneChange") return event.sceneId;
  if (event.type === "cameraChange") return labelFor(cameraModeLabels, event.camera.mode);
  if (event.type === "effectPlay") return event.effectId;
  if (event.type === "subtitle") return event.text;
  if (event.type === "soundEffect" || event.type === "bgmPlay") return event.assetId;
  if (event.type === "propChange") return event.propId;
  return labelFor(timelineEventTypeLabels, event.type);
}

function getPreviewImage(asset: AssetManifest) {
  const candidate = asset.files.preview ?? asset.files.image ?? asset.files.thumbnail;
  if (!candidate) return "";
  if (candidate.startsWith("procedural://") || candidate.startsWith("spritesheet://")) return "";
  return candidate;
}

function getSourceUrl(asset: AssetManifest) {
  const fromFiles = asset.files.sourceUrl;
  if (fromFiles?.startsWith("http")) return fromFiles;
  if (asset.license.sourceUrl.startsWith("http")) return asset.license.sourceUrl;
  if (asset.source.originalFile.startsWith("http")) return asset.source.originalFile;
  return "";
}
