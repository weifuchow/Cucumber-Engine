// Load + animate + render a rigged glTF/GLB headlessly (three.js WebGL1 on
// headless-gl, under xvfb) — the HIGH-FIDELITY 3D path. A character whose
// metadata.model3d is { gltf: "path.glb" } renders through here instead of the
// procedural humanoid. Drop in any rigged .glb (e.g. an image→3D export from
// the cucumber-3d-fetcher skill) and it animates with no engine change.
//
// Textures embedded in a GLB load via blob URLs that node can't decode, so we
// stub Image/URL to no-ops: the model renders with its base material colours
// (untextured) rather than crashing. Real texture decode is a follow-up.

import createGL from "gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";

globalThis.self = globalThis;
function fakeEl() {
  const k = createCanvas(1, 1);
  return { style: {}, getContext: (t) => k.getContext(t), toDataURL: () => "", addEventListener() {}, removeEventListener() {},
    get width() { return k.width; }, set width(v) { k.width = v; }, get height() { return k.height; }, set height(v) { k.height = v; } };
}
// An <img> stand-in that FAILS fast when given a src — node can't decode the
// blob: URLs GLTFLoader makes for embedded textures, so we fire 'error' on the
// next tick. That lets the loader finish (untextured) instead of hanging.
function fakeImg() {
  const L = {};
  return {
    style: {},
    addEventListener: (e, fn) => { (L[e] = L[e] || []).push(fn); },
    removeEventListener() {},
    set src(_v) { setTimeout(() => { (L.error || []).forEach((fn) => fn({ type: "error" })); if (this.onerror) this.onerror({ type: "error" }); }, 0); },
    set onload(_f) {}, set onerror(f) { this._onerror = f; },
  };
}
if (!globalThis.document) globalThis.document = {
  createElementNS: (_ns, tag) => (tag === "img" ? fakeImg() : fakeEl()),
  createElement: (t) => (t === "img" ? fakeImg() : t === "canvas" ? fakeEl() : { style: {} }),
};
globalThis.URL = globalThis.URL ?? {};
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL ?? (() => "blob:stub");
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL ?? (() => {});

let _ctx = null, _renderer = null, _W = 0, _H = 0;
function ensureRenderer(W, H) {
  if (_renderer && _W === W && _H === H) return _renderer;
  _ctx = createGL(W, H, { preserveDrawingBuffer: true, alpha: true });
  if (!_ctx) throw new Error("no GL context (run under xvfb)");
  const fc = { width: W, height: H, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return _ctx; } };
  _renderer = new THREE.WebGL1Renderer({ canvas: fc, context: _ctx, antialias: true, alpha: true });
  _renderer.setSize(W, H, false); _renderer.setClearColor(0x000000, 0); _renderer.outputEncoding = THREE.sRGBEncoding;
  _W = W; _H = H; return _renderer;
}

// cache loaded models by path (with their own AnimationMixer + bounds).
// glTF parse is async, so models must be preloaded before sync per-frame render.
const _resolved = new Map();
export function preloadGltf(path) {
  if (_resolved.has(path)) return Promise.resolve(_resolved.get(path));
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => {
    new GLTFLoader().parse(ab, "", (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      model.position.sub(ctr); model.position.y += size.y / 2; // feet near 0
      // cache each material's original colour so per-frame tinting can't compound
      model.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of mats) if (mm.color && !mm.userData._orig) mm.userData._orig = mm.color.clone();
      });
      const mixer = gltf.animations?.length ? new THREE.AnimationMixer(model) : null;
      const actions = new Map();
      if (mixer) for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
      const entry = { model, mixer, actions, height: size.y, clips: (gltf.animations ?? []).map((a) => a.name) };
      _resolved.set(path, entry);
      res(entry);
    }, (e) => rej(new Error("glTF parse failed: " + (e?.message ?? e))));
  });
}

export async function gltfClips(path) { return (await preloadGltf(path)).clips; }

function applyClip(entry, clip, time) {
  if (!entry.mixer || !entry.actions.size) return;
  const name = entry.actions.has(clip) ? clip : entry.clips[0];
  for (const [n, a] of entry.actions) {
    const on = n === name;
    a.enabled = on; a.setEffectiveWeight(on ? 1 : 0);
    if (on) a.play();
  }
  entry.mixer.setTime(Math.max(0.0001, time));
}

function applyTint(entry, mul) {
  entry.model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mm of mats) {
      if (!mm.userData._orig) continue;
      if (mul) mm.color.copy(mm.userData._orig).multiply(new THREE.Color(mul[0], mul[1], mul[2]));
      else mm.color.copy(mm.userData._orig);
    }
  });
}

/**
 * Render one frame of a (preloaded) rigged glTF. yaw radians; `clip` selects an
 * animation by name (default first); `time` drives it; `colorMul` [r,g,b]
 * recolours while keeping material variation (two distinct fighters from one
 * model). Framed to fill ~88% of the canvas height. Returns a napi Canvas.
 */
export function renderGltf3D({ path, yaw = 0, clip, time = 0, W = 360, H = 620, rim = "#b076ff", colorMul, tint }) {
  const renderer = ensureRenderer(W, H);
  const entry = _resolved.get(path);
  if (!entry) throw new Error(`glTF not preloaded: ${path} (call preloadGltf first)`);
  const scene = new THREE.Scene();
  entry.model.rotation.y = yaw;
  applyClip(entry, clip, time);
  applyTint(entry, colorMul);
  if (tint && !colorMul) entry.model.traverse((o) => { if (o.isMesh && o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of m) { mm.color = new THREE.Color(tint); mm.map = null; } } });
  scene.add(entry.model);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xfff2e6, 1.25); key.position.set(2.5, 4, 3); scene.add(key);
  const rl = new THREE.DirectionalLight(new THREE.Color(rim), 0.95); rl.position.set(-3, 2.4, -2.5); scene.add(rl);
  const fill = new THREE.DirectionalLight(0x8098c0, 0.4); fill.position.set(-2, 1, 3); scene.add(fill);
  // frame to fill ~88% of the canvas height
  const hY = entry.height;
  const fov = 30;
  const dist = (hY * 0.5 / Math.tan((fov * Math.PI / 180) / 2)) / 0.88;
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 100);
  cam.position.set(0, hY * 0.5, dist); cam.lookAt(0, hY * 0.5, 0);
  renderer.render(scene, cam);
  scene.remove(entry.model); // reuse model next call

  const gl = _ctx; const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const out = createCanvas(W, H); const octx = out.getContext("2d"); const img = octx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; for (let i = 0; i < 4; i++) img.data[d + i] = buf[s + i]; }
  octx.putImageData(img, 0, 0);
  return out;
}
