// Cut a figure out of a reference sheet: crop a rect, remove the light sheet
// background by edge flood-fill (keeps interior whites like clothing), auto-trim
// to the figure bbox, optionally mirror. Pure raster, @napi-rs/canvas.
//
// node cutout.mjs --in sheet.png --rect x,y,w,h --out fig.png [--bg 232] [--flip] [--pad 8]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }

const inPath = arg("in");
const out = arg("out");
const [rx, ry, rw, rh] = arg("rect").split(",").map(Number);
const bgT = Number(arg("bg", "232"));   // luminance above which a border-connected pixel is background
const flip = arg("flip") === "1";
const pad = Number(arg("pad", "8"));

const img = await loadImage(inPath);
const c = createCanvas(rw, rh);
const ctx = c.getContext("2d");
ctx.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);
const id = ctx.getImageData(0, 0, rw, rh);
const d = id.data;

// Sample the four corners (always sheet background, since figures are centred)
// and key by colour distance to that — robust to light-grey / gradient sheets
// without eating a pale figure (hair/skin differ from the bg colour).
function at(px, py) { const i = (py * rw + px) * 4; return [d[i], d[i + 1], d[i + 2]]; }
// Candidates around the border; the sheet bg is the LIGHTEST of them, so picking
// the brightest avoids a sample that accidentally lands on the (darker) figure.
const cand = [
  at(2, 2), at(rw - 3, 2), at(2, rh - 3), at(rw - 3, rh - 3),
  at(rw >> 1, 2), at(2, rh >> 1), at(rw - 3, rh >> 1),
];
const bg = cand.reduce((best, c) => (c[0] + c[1] + c[2] > best[0] + best[1] + best[2] ? c : best));
const [bgR, bgG, bgB] = bg;
const dist = Number(arg("dist", "46"));
const isBgLike = (i) => {
  const dr = d[i] - bgR, dg = d[i + 1] - bgG, db = d[i + 2] - bgB;
  return dr * dr + dg * dg + db * db <= dist * dist;
};

// edge flood-fill over bg-like pixels → alpha 0
const W = rw, H = rh;
const seen = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) { stack.push(x, 0); stack.push(x, H - 1); }
for (let y = 0; y < H; y++) { stack.push(0, y); stack.push(W - 1, y); }
while (stack.length) {
  const y = stack.pop(), x = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const p = y * W + x;
  if (seen[p]) continue;
  const i = p * 4;
  if (!isBgLike(i)) continue;
  seen[p] = 1;
  d[i + 3] = 0;
  stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}
ctx.putImageData(id, 0, 0);

// trim to opaque bbox
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (d[(y * W + x) * 4 + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
}
if (minX > maxX) { console.error("cutout: empty after keying"); process.exit(1); }
minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
const tw = maxX - minX + 1, th = maxY - minY + 1;

const o = createCanvas(tw, th);
const octx = o.getContext("2d");
if (flip) { octx.translate(tw, 0); octx.scale(-1, 1); }
octx.drawImage(c, minX, minY, tw, th, 0, 0, tw, th);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, o.toBuffer("image/png"));
console.log(`cutout → ${out}  (${tw}x${th})`);
