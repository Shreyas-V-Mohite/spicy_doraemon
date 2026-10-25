/**
 * Writes calibration inputs for INT8 quantization of the pose model: real
 * hand crops (OneHand10K samples) run through the app's exact preprocessing,
 * with small box jitter and mirroring for variety.
 *
 *   npx tsx scripts/quantize/dump-calibration.ts <outDir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { preprocessPose, type RgbaImage } from '../../src/hand/rtm/preprocess.ts';

const root = join(import.meta.dirname, '..', '..');
const outDir = process.argv[2];
if (!outDir) throw new Error('usage: dump-calibration.ts <outDir>');
mkdirSync(outDir, { recursive: true });

const coco = JSON.parse(readFileSync(join(root, 'tests/fixtures/hands/test_onehand10k.json'), 'utf8')) as {
  images: { id: number; file_name: string }[];
  annotations: { image_id: number; bbox: [number, number, number, number] }[];
};

function mirror(img: RgbaImage): RgbaImage {
  const out = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = (y * img.width + (img.width - 1 - x)) * 4;
      out.set(img.data.subarray(s, s + 4), d);
    }
  return { ...img, data: out };
}

let n = 0;
for (const im of coco.images) {
  const [bx, by, bw, bh] = coco.annotations.find((a) => a.image_id === im.id)!.bbox;
  const d = jpeg.decode(readFileSync(join(root, 'tests/fixtures/hands', im.file_name)), { useTArray: true });
  const base: RgbaImage = { data: d.data, width: d.width, height: d.height };
  for (const flip of [false, true]) {
    const img = flip ? mirror(base) : base;
    const x1 = flip ? d.width - (bx + bw) : bx;
    for (const [s, dx, dy] of [[1, 0, 0], [0.85, 0.05, 0], [1.15, -0.05, 0.05], [1, 0.08, -0.06], [0.95, -0.08, 0.04]]) {
      const cx = x1 + bw / 2 + dx * bw;
      const cy = by + bh / 2 + dy * bh;
      const crop = preprocessPose(img, { x1: cx - (bw * s) / 2, y1: cy - (bh * s) / 2, x2: cx + (bw * s) / 2, y2: cy + (bh * s) / 2 });
      writeFileSync(join(outDir, `calib_${String(n++).padStart(3, '0')}.bin`), Buffer.from(crop.tensor.buffer));
    }
  }
}
console.log(`wrote ${n} calibration tensors (1x3x256x256 float32) to ${outDir}`);
