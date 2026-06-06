import type { AssetManifest, AssetScope, AssetType, SceneDefinition } from "../types/schema";

const imageFormats = new Set(["png", "jpg", "jpeg", "webp"]);

export function createDefaultLicense() {
  return {
    type: "unknown",
    author: "",
    sourceUrl: "",
    commercialUse: false,
    needAttribution: false,
  };
}

export function safeId(prefix: string, name: string) {
  const base = name
    .replace(/\.[^/.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${base || "asset"}_${Date.now().toString(36)}`;
}

export async function importImageFile(file: File, type: AssetType, scope: AssetScope): Promise<AssetManifest> {
  const format = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!imageFormats.has(format)) {
    throw new Error("MVP 仅支持 PNG / JPG / WEBP 图片素材。");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const dimensions = await getImageDimensions(dataUrl);

  return {
    assetId: safeId(type, file.name),
    name: file.name.replace(/\.[^/.]+$/, ""),
    category: "visual",
    type,
    scope,
    source: {
      kind: "imported",
      format,
      originalFile: file.name,
    },
    files: {
      preview: dataUrl,
      image: dataUrl,
    },
    tags: [type, format],
    metadata: {
      width: dimensions.width,
      height: dimensions.height,
      anchor: { x: Math.round(dimensions.width / 2), y: dimensions.height },
    },
    license: createDefaultLicense(),
  };
}

export async function importSceneJsonFile(file: File): Promise<SceneDefinition> {
  const parsed = JSON.parse(await file.text()) as Partial<SceneDefinition>;
  if (!parsed.sceneId || !parsed.name || !parsed.background) {
    throw new Error("场景 JSON 需要包含 sceneId、name 和 background 字段。");
  }

  return {
    sceneId: parsed.sceneId,
    name: parsed.name,
    background: parsed.background,
    foreground: parsed.foreground,
    points: parsed.points ?? {},
    objects: parsed.objects ?? [],
    cameraPoints: parsed.cameraPoints ?? {
      wide: { x: 640, y: 360, zoom: 1 },
    },
  };
}

export async function importSpriteSheetJsonFile(
  file: File,
  scope: AssetScope,
  type: Extract<AssetType, "action" | "effect">,
): Promise<AssetManifest> {
  const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
  const frameCount = Array.isArray(parsed.frames)
    ? parsed.frames.length
    : parsed.frames && typeof parsed.frames === "object"
      ? Object.keys(parsed.frames).length
      : 0;

  return {
    assetId: safeId(type, file.name),
    name: file.name.replace(/\.[^/.]+$/, ""),
    category: "visual",
    type,
    scope,
    source: {
      kind: "imported",
      format: "spritesheet-json",
      originalFile: file.name,
    },
    files: {
      config: file.name,
      preview: "spritesheet://pending-image",
    },
    tags: [type, "spritesheet"],
    metadata: {
      frameCount,
      schema: parsed.meta ? "texture-atlas" : "custom-json",
      raw: parsed,
    },
    license: createDefaultLicense(),
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("无法读取图片尺寸。"));
    image.src = src;
  });
}
