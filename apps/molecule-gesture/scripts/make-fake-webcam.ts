/**
 * Builds a Y4M video for Chrome's fake webcam (--use-file-for-fake-video-capture)
 * from a REAL hand photo (OneHand10K sample, open hand). The photo is held
 * still (so the open-palm activation arms), then twisted in place like a
 * knob (spin gesture), then panned sideways (move gesture), and repeats.
 * Used by scripts/e2e.ts.
 *
 *   npx tsx scripts/make-fake-webcam.ts <out.y4m>
 *   npx tsx scripts/make-fake-webcam.ts <out.y4m> --crowd
 *
 * --crowd: a still scene with the teacher's two hands (big, close to the
 * camera) and another person's hand further away (small), for the
 * "use only the closest person's two hands" check.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';

const crowd = process.argv.includes('--crowd');
const W = crowd ? 640 : 480;
const H = 360;
const FPS = 30;
const root = join(import.meta.dirname, '..');
const out = process.argv[2];
if (!out) throw new Error('usage: make-fake-webcam.ts <out.y4m>');

const src = jpeg.decode(readFileSync(join(root, 'tests/fixtures/hands/9.jpg')), { useTArray: true });
const scale = (H * 0.95) / src.height;

function renderFrame(offsetX: number, angleDeg: number): Uint8Array {
  const rgb = new Uint8Array(W * H * 3);
  const dw = src.width * scale;
  const dh = src.height * scale;
  const x0 = (W - dw) / 2 + offsetX;
  const y0 = (H - dh) / 2;
  // Twist about the base of the hand (roughly the wrist), in raw image coordinates.
  const px = x0 + 112 * scale;
  const py = y0 + 285 * scale;
  const a = (-angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rx = px + (x - px) * ca - (y - py) * sa;
      const ry = py + (x - px) * sa + (y - py) * ca;
      const sx = Math.floor((rx - x0) / scale);
      const sy = Math.floor((ry - y0) / scale);
      const o = (y * W + x) * 3;
      if (sx >= 0 && sy >= 0 && sx < src.width && sy < src.height) {
        const i = (sy * src.width + sx) * 4;
        rgb[o] = src.data[i];
        rgb[o + 1] = src.data[i + 1];
        rgb[o + 2] = src.data[i + 2];
      } else {
        rgb[o] = 176;
        rgb[o + 1] = 168;
        rgb[o + 2] = 158;
      }
    }
  }
  return rgb;
}

function toYuv420(rgb: Uint8Array): Buffer {
  const y = Buffer.alloc(W * H);
  const u = Buffer.alloc((W / 2) * (H / 2));
  const v = Buffer.alloc((W / 2) * (H / 2));
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 3;
      y[j * W + i] = Math.round(0.299 * rgb[o] + 0.587 * rgb[o + 1] + 0.114 * rgb[o + 2]);
    }
  }
  for (let j = 0; j < H / 2; j++) {
    for (let i = 0; i < W / 2; i++) {
      let r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const o = ((2 * j + dy) * W + 2 * i + dx) * 3;
        r += rgb[o];
        g += rgb[o + 1];
        b += rgb[o + 2];
      }
      r /= 4; g /= 4; b /= 4;
      u[j * (W / 2) + i] = Math.round(-0.1687 * r - 0.3313 * g + 0.5 * b + 128);
      v[j * (W / 2) + i] = Math.round(0.5 * r - 0.4187 * g - 0.0813 * b + 128);
    }
  }
  return Buffer.concat([y, u, v]);
}

// [horizontal offset px, twist deg]. Negative twist = counter-clockwise in the
// raw image = clockwise as the user sees it in the mirrored preview.
const frames: [number, number][] = [];
for (let i = 0; i < 60; i++) frames.push([0, 0]); // hold still → grab
for (let i = 0; i < 30; i++) frames.push([0, -(i + 1) * 1.5]); // twist to -45°
for (let i = 0; i < 45; i++) frames.push([0, -45]); // hold twisted
for (let i = 0; i < 30; i++) frames.push([0, -45 + (i + 1) * 1.5]); // twist back
for (let i = 0; i < 40; i++) frames.push([-(i + 1) * 3, 0]); // move → rotate
for (let i = 0; i < 40; i++) frames.push([-120 + (i + 1) * 3, 0]); // move back

/** Paste photos (optionally mirrored) into one frame. */
function composite(tiles: { file: string; x: number; y: number; h: number; mirror?: boolean }[]): Uint8Array {
  const rgb = new Uint8Array(W * H * 3).fill(170);
  for (const t of tiles) {
    const img = jpeg.decode(readFileSync(join(root, 'tests/fixtures/hands', t.file)), { useTArray: true });
    const k = t.h / img.height;
    const w = Math.round(img.width * k);
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < w; x++) {
        const X = t.x + x;
        const Y = t.y + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const sx = Math.min(img.width - 1, Math.floor((t.mirror ? w - 1 - x : x) / k));
        const sy = Math.min(img.height - 1, Math.floor(y / k));
        const i = (sy * img.width + sx) * 4;
        const o = (Y * W + X) * 3;
        rgb[o] = img.data[i];
        rgb[o + 1] = img.data[i + 1];
        rgb[o + 2] = img.data[i + 2];
      }
    }
  }
  return rgb;
}

if (crowd) {
  const still = toYuv420(
    // The same real photo, mirrored, stands in for the other hand. (MediaPipe
    // found neither hand when 9.jpg was pasted twice, so 1402.jpg is used.)
    composite([
      { file: '1402.jpg', x: 20, y: 10, h: 340 }, // teacher, one hand
      { file: '1402.jpg', x: 400, y: 15, h: 330, mirror: true }, // teacher, other hand
      { file: '1402.jpg', x: 258, y: 5, h: 170 }, // someone further back: half the size
    ]),
  );
  const n = 90;
  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < n; i++) parts.push(Buffer.from('FRAME\n'), still);
  writeFileSync(out, Buffer.concat(parts));
  console.log(`wrote ${n} crowd frames (${W}x${H}) to ${out}`);
  process.exit(0);
}

const chunks: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
const cache = new Map<string, Buffer>();
for (const [off, ang] of frames) {
  const key = `${off}/${ang}`;
  let f = cache.get(key);
  if (!f) {
    f = toYuv420(renderFrame(off, ang));
    cache.set(key, f);
  }
  chunks.push(Buffer.from('FRAME\n'), f);
}
writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${frames.length} frames (${W}x${H}@${FPS}) to ${out}`);
