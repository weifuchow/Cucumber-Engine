import type { ProceduralShape } from "../engine/proceduralShape";
import type { AssetLibrary, Project } from "../types/schema";

// Reusable human-body shape. Each character manifest embeds its own copy so the
// asset stays self-describing; templates merely deduplicate the literal at
// authoring time.
const humanCharacterShape: ProceduralShape = {
  primitives: [
    // ground shadow
    { kind: "ellipse", cx: 0, cy: 14, rx: 92, ry: 25, fill: "rgba(25, 24, 22, 0.18)" },
    // torso
    { kind: "roundedRect", x: -58, y: -245, w: 116, h: 205, r: 38, fill: { palette: "body" } },
    // arms (idle): both rest at the sides
    { when: "action != walking", kind: "roundedRect", x: -75, y: -210, w: 36, h: 128, r: 20, fill: { palette: "body", darken: 32 } },
    { when: "action != walking", kind: "roundedRect", x: 39, y: -210, w: 36, h: 128, r: 20, fill: { palette: "body", darken: 32 } },
    // arms (walking): swing around the shoulder pivot, opposite phase to matching leg
    { when: "action == walking", kind: "transform",
      translate: { x: -57, y: -195 },
      rotate: "sin(time * 8 + PI) * 0.32",
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 128, r: 20, fill: { palette: "body", darken: 32 } },
      ] },
    { when: "action == walking", kind: "transform",
      translate: { x: 57, y: -195 },
      rotate: "sin(time * 8) * 0.32",
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 128, r: 20, fill: { palette: "body", darken: 32 } },
      ] },
    // legs (idle): both stand straight
    { when: "action != walking", kind: "roundedRect", x: -48, y: -48, w: 36, h: 65, r: 13, fill: "#293038" },
    { when: "action != walking", kind: "roundedRect", x: 12, y: -48, w: 36, h: 65, r: 13, fill: "#293038" },
    // legs (walking): swing around the hip pivot
    { when: "action == walking", kind: "transform",
      translate: { x: -30, y: -48 },
      rotate: "sin(time * 8) * 0.5",
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 65, r: 13, fill: "#293038" },
      ] },
    { when: "action == walking", kind: "transform",
      translate: { x: 30, y: -48 },
      rotate: "sin(time * 8 + PI) * 0.5",
      children: [
        { kind: "roundedRect", x: -18, y: 0, w: 36, h: 65, r: 13, fill: "#293038" },
      ] },
    // head + hair
    { kind: "circle", cx: 0, cy: -310, r: 70, fill: { palette: "skin" } },
    {
      kind: "ellipse",
      cx: 0,
      cy: -344,
      rx: 72,
      ry: 44,
      startAngle: Math.PI,
      endAngle: Math.PI * 2,
      fill: { palette: "hair" },
    },
    { kind: "rect", x: -68, y: -345, w: 136, h: 28, fill: { palette: "hair" } },
    // eyebrows — angry tilts inward
    { when: "expression == angry", kind: "line", x1: -36, y1: -326, x2: -12, y2: -318, stroke: "#2b2420", lineWidth: 5, lineCap: "round" },
    { when: "expression == angry", kind: "line", x1: 36, y1: -326, x2: 12, y2: -318, stroke: "#2b2420", lineWidth: 5, lineCap: "round" },
    { when: "expression != angry", kind: "line", x1: -36, y1: -322, x2: -12, y2: -322, stroke: "#2b2420", lineWidth: 5, lineCap: "round" },
    { when: "expression != angry", kind: "line", x1: 12, y1: -322, x2: 36, y2: -322, stroke: "#2b2420", lineWidth: 5, lineCap: "round" },
    // eyes
    { kind: "circle", cx: -24, cy: -302, r: 5, fill: "#251f1c" },
    { kind: "circle", cx: 24, cy: -302, r: 5, fill: "#251f1c" },
    // mouth variants
    { when: "expression == sad", kind: "arc", cx: 0, cy: -268, r: 25, startAngle: Math.PI * 1.12, endAngle: Math.PI * 1.88, stroke: "#2b2420", lineWidth: 5 },
    { when: "expression == soft", kind: "arc", cx: 0, cy: -282, r: 26, startAngle: 0.15, endAngle: Math.PI - 0.15, stroke: "#2b2420", lineWidth: 5 },
    { when: "expression == surprised", kind: "arc", cx: 0, cy: -276, r: 11, startAngle: 0, endAngle: Math.PI * 2, stroke: "#2b2420", lineWidth: 5 },
    { when: "expression not in [sad, soft, surprised]", kind: "line", x1: -20, y1: -276, x2: 20, y2: -276, stroke: "#2b2420", lineWidth: 5, lineCap: "round" },
    // name plate
    { kind: "roundedRect", x: -72, y: -395, w: 144, h: 32, r: 10, fill: "rgba(255,255,255,0.9)" },
    { kind: "text", x: 0, y: -372, text: "${name}", fill: "#243033", size: 22, align: "center" },
  ],
};

const childCharacterShape: ProceduralShape = {
  scale: 0.82,
  primitives: humanCharacterShape.primitives,
};

const flashEffectShape: ProceduralShape = {
  preview: { fit: "center" },
  primitives: [
    {
      kind: "starBurst",
      cx: 0,
      cy: 0,
      spikes: 12,
      outer: "90 + progress * 80",
      inner: 34,
      rotation: "progress * PI",
      fill: "rgba(255, 213, 88, ${1 - progress})",
      stroke: "rgba(198, 75, 58, ${1 - progress})",
      lineWidth: 8,
    },
  ],
};

const schoolbagShape: ProceduralShape = {
  preview: { fit: "center" },
  primitives: [
    { kind: "roundedRect", x: -55, y: -78, w: 110, h: 76, r: 16, fill: "#385d82" },
    { kind: "arc", cx: 0, cy: -78, r: 38, startAngle: Math.PI, endAngle: Math.PI * 2, stroke: "#243d58", lineWidth: 9 },
    { kind: "roundedRect", x: -28, y: -58, w: 56, h: 26, r: 8, fill: "#f4b457" },
  ],
};

const livingRoomShape: ProceduralShape = {
  preview: { fit: "contain" },
  primitives: [
    // wall + floor gradient
    {
      kind: "rect",
      x: 0,
      y: 0,
      w: 1280,
      h: 720,
      fill: {
        gradient: "linear",
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 720,
        stops: [
          { at: 0, color: "#d8e9e5" },
          { at: 0.58, color: "#bed4cf" },
          { at: 0.59, color: "#88664e" },
          { at: 1, color: "#5f4234" },
        ],
      },
    },
    // window frame
    { kind: "rect", x: 84, y: 80, w: 245, h: 385, fill: "#e8f3ef" },
    // window panes
    { kind: "rect", x: 105, y: 105, w: 88, h: 135, fill: "#99b8b4" },
    { kind: "rect", x: 215, y: 105, w: 88, h: 135, fill: "#99b8b4" },
    { kind: "rect", x: 105, y: 263, w: 88, h: 165, fill: "#99b8b4" },
    { kind: "rect", x: 215, y: 263, w: 88, h: 165, fill: "#99b8b4" },
    // sofa backrest + base + cushion
    { kind: "rect", x: 760, y: 365, w: 300, h: 140, fill: "#6d4d3f" },
    { kind: "roundedRect", x: 720, y: 445, w: 400, h: 115, r: 24, fill: "#80614f" },
    { kind: "roundedRect", x: 770, y: 393, w: 300, h: 80, r: 28, fill: "#3d6269" },
    // coffee table + legs
    { kind: "roundedRect", x: 510, y: 574, w: 240, h: 42, r: 14, fill: "#b98e55" },
    { kind: "rect", x: 535, y: 610, w: 18, h: 58, fill: "#6e4a35" },
    { kind: "rect", x: 705, y: 610, w: 18, h: 58, fill: "#6e4a35" },
    // floor perspective lines
    { kind: "line", x1: 0, y1: 545, x2: 1280, y2: 545, stroke: "rgba(45, 52, 51, 0.16)", lineWidth: 3 },
    { kind: "line", x1: 640, y1: 545, x2: 330, y2: 720, stroke: "rgba(45, 52, 51, 0.16)", lineWidth: 3 },
    { kind: "line", x1: 640, y1: 545, x2: 950, y2: 720, stroke: "rgba(45, 52, 51, 0.16)", lineWidth: 3 },
    // foreground shadow strip
    { kind: "rect", x: 0, y: 684, w: 1280, h: 36, fill: "rgba(30, 42, 42, 0.16)" },
  ],
};

export const sampleLibrary: AssetLibrary = {
  globalAssets: [
    {
      assetId: "character_father_template",
      name: "父亲模板",
      category: "visual",
      type: "character",
      scope: "global",
      source: { kind: "manual", format: "procedural", originalFile: "built-in" },
      files: { preview: "procedural://father" },
      tags: ["adult", "family", "template"],
      metadata: {
        width: 260,
        height: 520,
        anchor: { x: 130, y: 500 },
        palette: { body: "#2f5f91", skin: "#f0b985", hair: "#33271f" },
        parts: ["body", "face", "hair", "expression", "costume", "voice"],
        displayName: "父亲",
        shape: humanCharacterShape,
      },
      license: {
        type: "internal-demo",
        author: "Cucumber Engine",
        sourceUrl: "",
        commercialUse: true,
        needAttribution: false,
      },
    },
    {
      assetId: "effect_flash_001",
      name: "情绪闪光",
      category: "visual",
      type: "effect",
      scope: "global",
      source: { kind: "manual", format: "procedural", originalFile: "built-in" },
      files: { preview: "procedural://flash" },
      tags: ["emotion", "flash"],
      metadata: { blendMode: "screen", defaultDuration: 0.8, shape: flashEffectShape },
      license: {
        type: "internal-demo",
        author: "Cucumber Engine",
        sourceUrl: "",
        commercialUse: true,
        needAttribution: false,
      },
    },
  ],
  projectAssets: [
    {
      assetId: "scene_living_room_001",
      name: "客厅场景",
      category: "visual",
      type: "scene",
      scope: "project",
      source: { kind: "manual", format: "scene-json", originalFile: "living-room.scene.json" },
      files: { config: "living-room.scene.json", preview: "procedural://living-room" },
      tags: ["living-room", "family"],
      metadata: { width: 1280, height: 720, layers: ["background", "foreground", "objects"], shape: livingRoomShape },
      license: {
        type: "internal-demo",
        author: "Cucumber Engine",
        sourceUrl: "",
        commercialUse: true,
        needAttribution: false,
      },
    },
    {
      assetId: "character_father_001",
      name: "父亲",
      category: "visual",
      type: "character",
      scope: "project",
      source: { kind: "referenced", format: "procedural", originalFile: "character_father_template" },
      files: { preview: "procedural://father" },
      tags: ["father", "family"],
      metadata: {
        width: 260,
        height: 520,
        anchor: { x: 130, y: 500 },
        palette: { body: "#2f5f91", skin: "#f0b985", hair: "#33271f" },
        expressions: ["neutral", "angry", "soft"],
        shape: humanCharacterShape,
      },
      license: {
        type: "internal-demo",
        author: "Cucumber Engine",
        sourceUrl: "",
        commercialUse: true,
        needAttribution: false,
      },
      overrides: { role: "father", costume: "blue jacket" },
    },
    {
      assetId: "character_child_001",
      name: "孩子",
      category: "visual",
      type: "character",
      scope: "project",
      source: { kind: "manual", format: "procedural", originalFile: "built-in" },
      files: { preview: "procedural://child" },
      tags: ["child", "family"],
      metadata: {
        width: 210,
        height: 430,
        anchor: { x: 105, y: 410 },
        palette: { body: "#d05b4f", skin: "#f3c092", hair: "#403026" },
        expressions: ["neutral", "sad", "surprised"],
        shape: childCharacterShape,
      },
      license: {
        type: "internal-demo",
        author: "Cucumber Engine",
        sourceUrl: "",
        commercialUse: true,
        needAttribution: false,
      },
    },
    {
      assetId: "prop_schoolbag_001",
      name: "书包",
      category: "visual",
      type: "prop",
      scope: "project",
      source: { kind: "manual", format: "procedural", originalFile: "built-in" },
      files: { preview: "procedural://schoolbag" },
      tags: ["prop", "school"],
      metadata: { width: 130, height: 110, anchor: { x: 65, y: 100 }, shape: schoolbagShape },
      license: {
        type: "internal-demo",
        author: "Cucumber Engine",
        sourceUrl: "",
        commercialUse: true,
        needAttribution: false,
      },
    },
  ],
  scenes: [
    {
      sceneId: "scene_living_room_001",
      name: "客厅",
      background: "scene_living_room_001",
      foreground: "scene_living_room_001",
      points: {
        door: { x: 160, y: 520 },
        sofa: { x: 790, y: 535 },
        center: { x: 610, y: 535 },
        table: { x: 620, y: 585 },
      },
      objects: [
        { id: "sofa_001", type: "obstacle", movable: false, x: 820, y: 565 },
        { id: "prop_schoolbag_001", type: "prop", movable: true, assetId: "prop_schoolbag_001", x: 430, y: 615 },
      ],
      cameraPoints: {
        wide: { x: 640, y: 360, zoom: 1 },
        door: { x: 320, y: 390, zoom: 1.35 },
        sofaClose: { x: 790, y: 390, zoom: 1.55 },
      },
    },
  ],
};

export const sampleProject: Project = {
  projectId: "project_family_argument_001",
  title: "父子争吵",
  description: "一个 25 秒家庭情感短剧片段，用于验证黄瓜引擎 MVP 的资产、章节、片段、时间线、镜头和 Web 预览闭环。",
  assetRefs: [
    "scene_living_room_001",
    "character_father_001",
    "character_child_001",
    "prop_schoolbag_001",
    "effect_flash_001",
  ],
  config: { resolution: "1280x720", fps: 30 },
  preview: { activeChapterId: "chapter_001", activeSegmentId: "segment_001" },
  export: { includeAssets: true, includeTimeline: true },
  aiReserved: {
    assetGenerationEndpoint: "",
    timelineGenerationEndpoint: "",
    acceptedSchemas: ["asset-manifest.v1", "project.v1", "timeline-event.v1"],
  },
  chapters: [
    {
      chapterId: "chapter_001",
      title: "争吵开始",
      sceneId: "scene_living_room_001",
      characters: ["character_father_001", "character_child_001"],
      transition: { type: "fadeIn", duration: 1 },
      bgm: undefined,
      segments: [
        {
          segmentId: "segment_001",
          name: "孩子进门",
          duration: 25,
          timeline: [
            { time: 0, type: "sceneChange", sceneId: "scene_living_room_001" },
            {
              time: 0,
              type: "cameraChange",
              camera: { mode: "wide", x: 640, y: 360, zoom: 1, duration: 0, transition: "cut" },
            },
            {
              time: 0.8,
              type: "characterAppear",
              target: "character_father_001",
              position: { x: 830, y: 545 },
              expression: "neutral",
              scale: 1,
            },
            {
              time: 2,
              type: "characterAppear",
              target: "character_child_001",
              position: { x: 150, y: 545 },
              expression: "neutral",
              scale: 0.9,
            },
            { time: 2.2, type: "subtitle", text: "孩子推门进来，客厅里的空气一下安静了。", duration: 3 },
            { time: 3, type: "characterAction", target: "character_child_001", action: { name: "walking", params: {} } },
            { time: 3, type: "characterMove", target: "character_child_001", to: { x: 480, y: 545 }, duration: 4 },
            { time: 7, type: "characterAction", target: "character_child_001", action: { name: "idle", params: {} } },
            {
              time: 6,
              type: "cameraChange",
              camera: { mode: "medium", x: 565, y: 405, zoom: 1.25, duration: 1.4, transition: "smooth" },
            },
            { time: 7.3, type: "expressionChange", target: "character_father_001", expression: "angry" },
            { time: 7.5, type: "dialogue", target: "character_father_001", text: "这么晚才回来？", duration: 2.2 },
            {
              time: 8,
              type: "effectPlay",
              effectId: "effect_flash_001",
              position: { x: 820, y: 250 },
              duration: 0.8,
            },
            { time: 10.2, type: "expressionChange", target: "character_child_001", expression: "sad" },
            { time: 10.5, type: "dialogue", target: "character_child_001", text: "我只是想把作业做完。", duration: 2.8 },
            {
              time: 13.5,
              type: "cameraChange",
              camera: { mode: "closeUp", target: "character_child_001", zoom: 1.65, duration: 1.2, transition: "smooth" },
            },
            { time: 15, type: "subtitle", text: "镜头推近，孩子低头攥紧了书包带。", duration: 3 },
            { time: 16.5, type: "characterAction", target: "character_child_001", action: { name: "walking", params: {} } },
            { time: 16.5, type: "characterMove", target: "character_child_001", to: { x: 560, y: 545 }, duration: 2.5 },
            { time: 19, type: "characterAction", target: "character_child_001", action: { name: "idle", params: {} } },
            {
              time: 19.2,
              type: "cameraChange",
              camera: { mode: "wide", x: 640, y: 360, zoom: 1, duration: 1.6, transition: "smooth" },
            },
            { time: 21, type: "expressionChange", target: "character_father_001", expression: "soft" },
            { time: 21.5, type: "dialogue", target: "character_father_001", text: "先坐下，我们慢慢说。", duration: 2.7 },
          ],
        },
      ],
    },
  ],
};
