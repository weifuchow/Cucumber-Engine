import type {
  AssetCategory,
  AssetManifest,
  AssetScope,
  AssetType,
  Chapter,
  TimelineEvent,
} from "../types/schema";

export const timelineEventTypeLabels: Record<TimelineEvent["type"], string> = {
  characterAppear: "角色出现",
  characterDisappear: "角色消失",
  characterMove: "角色移动",
  characterAction: "角色动作",
  expressionChange: "表情切换",
  sceneChange: "场景切换",
  propChange: "道具变化",
  effectPlay: "特效播放",
  cameraChange: "镜头切换",
  subtitle: "字幕",
  bgmPlay: "背景音乐",
  dialogue: "对白",
  narration: "旁白",
  soundEffect: "音效",
};

export const cameraModeLabels: Record<string, string> = {
  default: "默认",
  wide: "广角",
  medium: "中景",
  closeUp: "特写",
  follow: "跟随",
};

export const assetTypeLabels: Record<AssetType, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  expression: "表情",
  action: "动作",
  effect: "特效",
  foreground: "前景",
  background: "背景",
  cameraTemplate: "镜头模板",
  sceneElement: "场景元素",
  bgm: "背景音乐",
  dialogue: "对白",
  narration: "旁白",
  soundEffect: "音效",
  environment: "环境音",
};

export const assetScopeLabels: Record<AssetScope, string> = {
  global: "通用",
  project: "项目",
};

export const assetCategoryLabels: Record<AssetCategory, string> = {
  visual: "视觉",
  audio: "音频",
};

export const transitionLabels: Record<Chapter["transition"]["type"], string> = {
  none: "无过渡",
  cut: "直切",
  fadeIn: "淡入",
  fadeOut: "淡出",
  fadeToBlack: "渐黑",
  dissolve: "溶解",
  titleCard: "标题卡",
};

export const sourceKindLabels: Record<AssetManifest["source"]["kind"], string> = {
  imported: "导入",
  generated: "生成",
  manual: "手工",
  referenced: "引用",
};

export function labelFor<K extends string>(dict: Record<K, string>, key: string): string {
  return (dict as Record<string, string>)[key] ?? key;
}
