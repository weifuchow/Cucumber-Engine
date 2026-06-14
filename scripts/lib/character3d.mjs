// Headless 3D character renderer (three.js + headless-gl, run under xvfb).
// Builds a posable low-poly humanoid from a colour spec and renders it cel-
// shaded (MeshToonMaterial) at a given yaw / action / time to a transparent
// PNG buffer — genuine 3D (depth, rotation, articulated limbs), not a billboard.
//
// This is the QC/bake side of the 3D asset path; the same three.js scene graph
// is what a browser WebGL layer would drive live (docs/3d-pipeline.md Path A).

import createGL from "gl";
import * as THREE from "three";
import { createCanvas } from "@napi-rs/canvas";

// --- minimal DOM polyfills three touches when given a headless gl context ---
function fakeEl() {
  const k = createCanvas(1, 1);
  return {
    style: {}, getContext: (t) => k.getContext(t), toDataURL: () => "",
    addEventListener() {}, removeEventListener() {},
    get width() { return k.width; }, set width(v) { k.width = v; },
    get height() { return k.height; }, set height(v) { k.height = v; },
  };
}
if (!globalThis.document) {
  globalThis.document = { createElementNS: () => fakeEl(), createElement: (t) => (t === "canvas" ? fakeEl() : { style: {} }) };
}

// Cel-shading ramp (3 bands) shared by all toon materials.
function toonRamp() {
  const data = new Uint8Array([66, 132, 196, 234]); // dark→light bands (top < 255 so pale materials keep form)
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.LuminanceFormat);
  tex.needsUpdate = true;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  return tex;
}
const RAMP = toonRamp();

function toon(color) {
  return new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: RAMP });
}

function capsule(r, len, mat) { return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat); }

/**
 * Build the character rig. Returns { root, parts } where parts are the posable
 * joints. Colours: coat, skin, hair, pants, accent (rim is a light, not mat).
 */
function buildRig(spec) {
  const root = new THREE.Group();
  const coat = toon(spec.coat), skin = toon(spec.skin), hair = toon(spec.hair), pants = toon(spec.pants);

  // torso
  const torso = capsule(0.42, 0.9, coat); torso.position.y = 1.15; torso.scale.set(1, 1, 0.7); root.add(torso);
  // hips
  const hips = capsule(0.36, 0.3, pants); hips.position.y = 0.7; hips.scale.set(1, 1, 0.7); root.add(hips);
  // optional harness — Orochi's dark X-straps across the bare torso
  if (spec.harness) {
    const band = toon(spec.band ?? "#1c2540");
    for (const rot of [0.6, -0.6]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.06), band);
      strap.position.set(0, 1.15, 0.32); strap.rotation.z = rot; root.add(strap);
    }
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.05, 8, 24), band);
    belt.position.y = 0.82; belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.7, 1); root.add(belt);
  }
  // neck + head
  const neck = capsule(0.12, 0.14, skin); neck.position.y = 1.66; root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 20), skin); head.position.y = 1.95; head.scale.set(0.9, 1.05, 0.9); root.add(head);
  // hair — a cap + a few spikes
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  hairCap.position.y = 2.0; root.add(hairCap);
  for (let i = 0; i < (spec.spikes ?? 0); i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.52, 6), hair);
    const a = (i / (spec.spikes)) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.2, 2.24, Math.sin(a) * 0.16);
    s.rotation.set(0.6 * Math.sin(a), 0, -0.5 * Math.cos(a));
    root.add(s);
  }

  // arms — shoulder groups (pivot at shoulder)
  function arm(side) {
    const g = new THREE.Group(); g.position.set(0.46 * side, 1.5, 0);
    const upper = capsule(0.13, 0.4, coat); upper.position.y = -0.28; g.add(upper);
    const lower = capsule(0.11, 0.4, skin); lower.position.y = -0.74; g.add(lower);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), skin); hand.position.y = -1.0; g.add(hand);
    root.add(g); return g;
  }
  // legs — hip groups
  function leg(side) {
    const g = new THREE.Group(); g.position.set(0.2 * side, 0.66, 0);
    const upper = capsule(0.16, 0.42, pants); upper.position.y = -0.3; g.add(upper);
    const lower = capsule(0.13, 0.42, pants); lower.position.y = -0.78; g.add(lower);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.4), toon(spec.shoe ?? "#15131a")); foot.position.set(0, -1.04, 0.08); g.add(foot);
    root.add(g); return g;
  }
  return { root, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1), torso, head };
}

function pose(parts, action, time) {
  const { armL, armR, legL, legR, torso, head } = parts;
  // reset
  for (const p of [armL, armR, legL, legR]) p.rotation.set(0, 0, 0);
  torso.rotation.set(0, 0, 0);
  const breath = Math.sin(time * 1.6) * 0.03;
  torso.position.y = 1.15 + breath;
  head.position.y = 1.95 + breath;
  if (action === "walking") {
    const s = Math.sin(time * 8);
    legL.rotation.x = s * 0.6; legR.rotation.x = -s * 0.6;
    armL.rotation.x = -s * 0.5; armR.rotation.x = s * 0.5;
  } else if (action === "attack") {
    armR.rotation.set(-1.5, 0, 0.2);   // thrust forward (toward +z/-?), elbow out
    armR.position.z = 0.1;
    armL.rotation.set(0.3, 0, -0.5);
    torso.rotation.y = -0.3;
  } else if (action === "defend") {
    armL.rotation.set(-1.3, 0, 0.9); armR.rotation.set(-1.3, 0, -0.9);
  } else if (action === "victory") {
    armR.rotation.set(-2.6, 0, 0.2); armL.rotation.set(0.2, 0, -0.3);
  } else { // idle
    armL.rotation.z = 0.12 + Math.sin(time * 1.4) * 0.04;
    armR.rotation.z = -0.12 - Math.sin(time * 1.4 + Math.PI) * 0.04;
  }
}

let _ctx = null, _renderer = null, _W = 0, _H = 0;
function ensureRenderer(W, H) {
  if (_renderer && _W === W && _H === H) return _renderer;
  if (_renderer) _renderer.dispose?.();
  _ctx = createGL(W, H, { preserveDrawingBuffer: true, alpha: true });
  if (!_ctx) throw new Error("no GL context (run under xvfb)");
  const fc = { width: W, height: H, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return _ctx; } };
  _renderer = new THREE.WebGL1Renderer({ canvas: fc, context: _ctx, antialias: true, alpha: true });
  _renderer.setSize(W, H, false); _renderer.setClearColor(0x000000, 0); _renderer.outputEncoding = THREE.sRGBEncoding;
  _W = W; _H = H;
  return _renderer;
}

/**
 * Render one frame. yaw radians: 0 faces camera, +PI/2 faces screen-right.
 * Returns a napi Canvas (RGBA, transparent bg) sized W×H with the figure's feet
 * near the bottom.
 */
export function renderCharacter3D({ spec, yaw = 0, action = "idle", time = 0, W = 360, H = 620, rim = "#b076ff" }) {
  const renderer = ensureRenderer(W, H);
  const scene = new THREE.Scene();
  const { root, ...parts } = buildRig(spec);
  pose(parts, action, time);
  root.rotation.y = yaw;
  scene.add(root);
  // lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff2e6, 1.15); key.position.set(2.5, 4, 3); scene.add(key);
  const rl = new THREE.DirectionalLight(new THREE.Color(rim), 0.9); rl.position.set(-3, 2.2, -2.5); scene.add(rl);
  const fill = new THREE.DirectionalLight(0x88a0c0, 0.35); fill.position.set(-2, 1, 3); scene.add(fill);
  // camera — frame the ~2.3-tall figure
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  cam.position.set(0, 1.25, 6.2); cam.lookAt(0, 1.05, 0);
  renderer.render(scene, cam);

  const gl = _ctx;
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const out = createCanvas(W, H); const octx = out.getContext("2d"); const img = octx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; img.data[d] = buf[s]; img.data[d + 1] = buf[s + 1]; img.data[d + 2] = buf[s + 2]; img.data[d + 3] = buf[s + 3]; }
  octx.putImageData(img, 0, 0);
  return out;
}
