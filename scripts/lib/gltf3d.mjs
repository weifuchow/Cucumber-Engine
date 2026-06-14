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
      const mixer = gltf.animations?.length ? new THREE.AnimationMixer(model) : null;
      if (mixer) mixer.clipAction(gltf.animations[0]).play();
      const entry = { model, mixer, height: size.y, clips: (gltf.animations ?? []).map((a) => a.name) };
      _resolved.set(path, entry);
      res(entry);
    }, (e) => rej(new Error("glTF parse failed: " + (e?.message ?? e))));
  });
}

export async function gltfClips(path) { return (await preloadGltf(path)).clips; }

/**
 * Render one frame of a (preloaded) rigged glTF. yaw radians, time seconds
 * (drives the first animation clip). Returns a napi Canvas (transparent bg).
 */
export function renderGltf3D({ path, yaw = 0, time = 0, W = 360, H = 620, rim = "#b076ff", tint }) {
  const renderer = ensureRenderer(W, H);
  const entry = _resolved.get(path);
  if (!entry) throw new Error(`glTF not preloaded: ${path} (call preloadGltf first)`);
  const scene = new THREE.Scene();
  entry.model.rotation.y = yaw;
  if (entry.mixer) { entry.mixer.setTime(0); entry.mixer.update(Math.max(0, time)); }
  if (tint) entry.model.traverse((o) => { if (o.isMesh && o.material) { o.material.color = new THREE.Color(tint); o.material.map = null; } });
  scene.add(entry.model);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff2e6, 1.15); key.position.set(2.5, 4, 3); scene.add(key);
  const rl = new THREE.DirectionalLight(new THREE.Color(rim), 0.85); rl.position.set(-3, 2.2, -2.5); scene.add(rl);
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
  const hY = entry.height;
  cam.position.set(0, hY * 0.52, hY * 2.3); cam.lookAt(0, hY * 0.46, 0);
  renderer.render(scene, cam);
  scene.remove(entry.model); // reuse model next call

  const gl = _ctx; const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const out = createCanvas(W, H); const octx = out.getContext("2d"); const img = octx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; for (let i = 0; i < 4; i++) img.data[d + i] = buf[s + i]; }
  octx.putImageData(img, 0, 0);
  return out;
}
