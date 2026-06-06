import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Boxes,
  Camera,
  Download,
  ExternalLink,
  Eye,
  FileJson,
  FolderInput,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { PreviewCanvas } from "./components/PreviewCanvas";
import { AiAssetGenerator } from "./components/AiAssetGenerator";
import { sampleLibrary, sampleProject } from "./data/sampleProject";
import { getActiveSegment } from "./engine/timeline";
import { importImageFile, importSceneJsonFile, importSpriteSheetJsonFile } from "./importers/importers";
import { buildAssetManifestExport, buildProjectExport, downloadJson } from "./utils/exporters";
import { api } from "./api/client";
import type { AssetLibrary, AssetManifest, AssetScope, AssetType, Chapter, Project, Segment, TimelineEvent } from "./types/schema";

const imageTypes: AssetType[] = ["character", "scene", "prop", "expression", "effect", "foreground", "background"];
type ModuleId = "assets" | "project" | "export";

const modules: Array<{ id: ModuleId; label: string; description: string; icon: typeof Boxes }> = [
  { id: "assets", label: "资产库管理", description: "导入、分类、预览和登记 Manifest", icon: Boxes },
  { id: "project", label: "项目管理", description: "项目、章节、片段、参数编辑和片段渲染编辑", icon: FileJson },
  { id: "export", label: "导出与 AI", description: "项目 JSON、资产配置和 AI Schema 预留", icon: Sparkles },
];

export function App() {
  const [project, setProject] = useState<Project>(sampleProject);
  const [library, setLibrary] = useState<AssetLibrary>(sampleLibrary);
  const [activeModule, setActiveModule] = useState<ModuleId>("assets");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>("character");
  const [scope, setScope] = useState<AssetScope>("project");
  const [notice, setNotice] = useState("已载入最小演示项目：客厅、两个角色、道具、镜头、表情和特效。");
  const [selectedAssetId, setSelectedAssetId] = useState("character_child_001");
  const [assetPreviewOpen, setAssetPreviewOpen] = useState(false);
  const [segmentEditorOpen, setSegmentEditorOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

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

  async function handleImageImport(file: File | undefined) {
    if (!file) return;
    try {
      const manifest = await importImageFile(file, assetType, scope);
      await api.saveAsset(manifest);
      setLibrary((current) =>
        scope === "global"
          ? { ...current, globalAssets: [manifest, ...current.globalAssets] }
          : { ...current, projectAssets: [manifest, ...current.projectAssets] },
      );
      if (scope === "project") setProject((current) => ({ ...current, assetRefs: [...new Set([manifest.assetId, ...current.assetRefs])] }));
      setSelectedAssetId(manifest.assetId);
      setAssetPreviewOpen(true);
      setActiveModule("assets");
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

  async function handleSpriteSheetImport(file: File | undefined) {
    if (!file) return;
    try {
      const manifest = await importSpriteSheetJsonFile(file, scope, "effect");
      await api.saveAsset(manifest);
      setLibrary((current) =>
        scope === "global"
          ? { ...current, globalAssets: [manifest, ...current.globalAssets] }
          : { ...current, projectAssets: [manifest, ...current.projectAssets] },
      );
      setSelectedAssetId(manifest.assetId);
      setAssetPreviewOpen(true);
      setActiveModule("assets");
      setNotice(`已入库图集 JSON，登记为 ${manifest.type} 资产。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "图集 JSON 导入失败。");
    }
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
              <button type="button" onClick={createChapter}>
                <Sparkles size={17} />
                <span>新章节</span>
              </button>
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
              assetType={assetType}
              scope={scope}
              notice={notice}
              library={library}
              selectedAssetId={selectedAssetId}
              onAssetTypeChange={setAssetType}
              onScopeChange={setScope}
              onImageImport={handleImageImport}
              onSceneImport={handleSceneImport}
              onSpriteSheetImport={handleSpriteSheetImport}
              onOpenAi={() => setAiOpen(true)}
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
      {aiOpen ? (
        <AiAssetGenerator
          defaultType={assetType}
          defaultScope={scope}
          onClose={() => setAiOpen(false)}
          onRegistered={() => {
            void reloadLibraryFromApi();
          }}
        />
      ) : null}
    </main>
  );
}

function AssetLibraryModule({
  assetType,
  scope,
  notice,
  library,
  selectedAssetId,
  onAssetTypeChange,
  onScopeChange,
  onImageImport,
  onSceneImport,
  onSpriteSheetImport,
  onSelectAsset,
  onOpenAi,
}: {
  assetType: AssetType;
  scope: AssetScope;
  notice: string;
  library: AssetLibrary;
  selectedAssetId: string;
  onAssetTypeChange: (type: AssetType) => void;
  onScopeChange: (scope: AssetScope) => void;
  onImageImport: (file: File | undefined) => void;
  onSceneImport: (file: File | undefined) => void;
  onSpriteSheetImport: (file: File | undefined) => void;
  onSelectAsset: (assetId: string) => void;
  onOpenAi: () => void;
}) {
  return (
    <section className="asset-library-layout">
      <section className="panel asset-import-toolbar">
        <div className="toolbar-title">
          <Boxes size={18} />
          <span>素材导入</span>
        </div>
        <div className="asset-import-controls">
          <select value={assetType} onChange={(event) => onAssetTypeChange(event.target.value as AssetType)}>
            {imageTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select value={scope} onChange={(event) => onScopeChange(event.target.value as AssetScope)}>
            <option value="project">项目</option>
            <option value="global">通用</option>
          </select>
        </div>
        <label className="file-button">
          <ImagePlus size={17} />
          <span>导入图片</span>
          <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(event) => onImageImport(event.target.files?.[0])} />
        </label>
        <label className="file-button">
          <FileJson size={17} />
          <span>导入场景 JSON</span>
          <input type="file" accept=".json,application/json" onChange={(event) => onSceneImport(event.target.files?.[0])} />
        </label>
        <label className="file-button">
          <FolderInput size={17} />
          <span>导入图集 JSON</span>
          <input type="file" accept=".json,application/json" onChange={(event) => onSpriteSheetImport(event.target.files?.[0])} />
        </label>
        <button type="button" className="file-button ai-trigger" onClick={onOpenAi}>
          <Sparkles size={17} />
          <span>AI 生成资产</span>
        </button>
        <p className="notice inline-notice">{notice}</p>
      </section>

      <AssetTypeGallery
        globalAssets={library.globalAssets}
        projectAssets={library.projectAssets}
        selectedAssetId={selectedAssetId}
        onSelect={onSelectAsset}
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
}) {
  const allAssets = [...library.globalAssets, ...library.projectAssets];
  const activeChapter = project.chapters.find((chapter) => chapter.chapterId === activeChapterId) ?? project.chapters[0];
  const activeSegment = activeChapter.segments.find((segmentItem) => segmentItem.segmentId === activeSegmentId) ?? activeChapter.segments[0];

  return (
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
                <small>{chapter.transition.type} · {chapter.segments.length} 片段 · {chapter.characters.length} 角色</small>
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
                <option value="none">none</option>
                <option value="cut">cut</option>
                <option value="fadeIn">fadeIn</option>
                <option value="fadeOut">fadeOut</option>
                <option value="fadeToBlack">fadeToBlack</option>
                <option value="dissolve">dissolve</option>
                <option value="titleCard">titleCard</option>
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
                  <span>{asset?.type ?? "scene"} · {assetId}</span>
                </article>
              );
            })}
          </div>
        </details>
      </section>
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
              <div className="asset-chip-row">
                <span>{time.toFixed(1)}s</span>
                <span>{segment.duration}s</span>
              </div>
            </div>
            <button className="preview-click-target" type="button" onClick={() => onPlayingChange((current) => !current)} title={playing ? "暂停" : "播放"}>
              <PreviewCanvas project={project} library={library} time={time} />
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
              <input
                aria-label="时间线进度"
                type="range"
                min={0}
                max={segment.duration}
                step={0.05}
                value={time}
                onChange={(event) => onTimeChange(Number(event.target.value))}
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
              <InlineTimelineEvents events={segment.timeline} selectedEventIndex={selectedEventIndex} onSelectEvent={setSelectedEventIndex} />
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
  globalAssets,
  projectAssets,
  selectedAssetId,
  onSelect,
}: {
  globalAssets: AssetManifest[];
  projectAssets: AssetManifest[];
  selectedAssetId: string;
  onSelect: (assetId: string) => void;
}) {
  const assets = [...globalAssets, ...projectAssets];
  const orderedTypes = getOrderedAssetTypes(assets);

  return (
    <section className="panel asset-type-gallery">
      <div className="panel-title">
        <span>按类型浏览</span>
        <small>{assets.length}</small>
      </div>
      <div className="asset-type-scroll">
        {orderedTypes.map((type) => (
          <section key={type} className="asset-type-section">
            <div className="asset-type-heading">
              <strong>{type}</strong>
              <span>{assets.filter((asset) => asset.type === type).length}</span>
            </div>
            <div className="asset-card-grid">
              {assets
                .filter((asset) => asset.type === type)
                .map((asset) => (
                  <button
                    key={asset.assetId}
                    type="button"
                    className={`asset-card ${asset.assetId === selectedAssetId ? "is-selected" : ""}`}
                    onClick={() => onSelect(asset.assetId)}
                    title={`预览 ${asset.name}`}
                  >
                    <div className="asset-card-thumb">
                      <AssetVisual asset={asset} />
                    </div>
                    <div className="asset-card-meta">
                      <strong>{asset.name}</strong>
                      <span>{asset.scope} · {asset.source.format}</span>
                    </div>
                    <Eye size={15} />
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    </section>
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

        <AssetVisual asset={asset} />

        <section className="asset-preview-section">
          <div className="asset-chip-row">
            <span>{asset.scope}</span>
            <span>{asset.category}</span>
            <span>{asset.type}</span>
            <span>{asset.source.format}</span>
          </div>
        </section>

        <section className="asset-preview-section">
          <h3>来源与授权</h3>
          <dl className="asset-fields">
            <div>
              <dt>来源</dt>
              <dd>{asset.source.kind} · {asset.source.originalFile}</dd>
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

  const palette = (asset.metadata.palette ?? {}) as Record<string, string>;
  const style = {
    "--preview-body": palette.body ?? (asset.type === "scene" ? "#7ea9a0" : "#3d6f84"),
    "--preview-accent": palette.skin ?? (asset.type === "effect" ? "#ffd558" : "#f0b985"),
    "--preview-dark": palette.hair ?? "#253132",
  } as CSSProperties;

  return (
    <figure className={`asset-visual procedural-${asset.type}`} style={style}>
      <div className="procedural-preview">
        <span>{asset.type}</span>
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
          <span>{chapter.transition.type} · {chapter.segments.length} 片段</span>
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
            <strong>{event.type}</strong>
            <span>{describeEvent(event)}</span>
          </div>
        </button>
      ))}
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

  function update(mutator: (draft: Record<string, unknown>) => void) {
    const draft = cloneEvent(currentEvent);
    mutator(draft);
    onChange(draft as TimelineEvent);
  }

  return (
    <section className="event-editor">
      <div className="panel-title">
        <span>事件 #{eventIndex + 1}</span>
        <small>{currentEvent.type}</small>
      </div>
      <div className="form-grid">
        <div className="field-row">
          <label>
            <span>时间</span>
            <input type="number" min={0} step={0.1} value={currentEvent.time} onChange={(inputEvent) => update((draft) => { draft.time = Number(inputEvent.target.value) || 0; })} />
          </label>
          <label>
            <span>类型</span>
            <input value={currentEvent.type} readOnly />
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

      <details className="event-json-details">
        <summary>查看完整事件 JSON</summary>
        <pre>{JSON.stringify(currentEvent, null, 2)}</pre>
      </details>
    </section>
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
  if (event.type === "cameraChange") return event.camera.mode;
  if (event.type === "effectPlay") return event.effectId;
  if (event.type === "subtitle") return event.text;
  if (event.type === "soundEffect" || event.type === "bgmPlay") return event.assetId;
  if (event.type === "propChange") return event.propId;
  return event.type;
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
