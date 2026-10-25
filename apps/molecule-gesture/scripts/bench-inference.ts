/**
 * Where does hand-tracking time go? Times preprocessing vs. model execution
 * for the detector and the pose model on a real hand photo (onnxruntime-node,
 * CPU). Usage: npx tsx scripts/bench-inference.ts [modelDir]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import jpeg from 'jpeg-js';
import { preprocessDetector, preprocessPose } from '../src/hand/rtm/preprocess.ts';

const root = join(import.meta.dirname, '..');
const modelDir = process.argv[2] ?? join(root, 'public/models');
const N = 20;

function time(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

async function timeAsync(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

async function main() {
  const d = jpeg.decode(readFileSync(join(root, 'tests/fixtures/hands/784.jpg')), { useTArray: true });
  const img = { data: d.data, width: d.width, height: d.height };
  for (const name of ['rtmdet-nano-hand.onnx', 'rtmpose-m-hand.onnx']) {
    const isPose = name.includes('pose');
    const sess = await ort.InferenceSession.create(join(modelDir, name), { intraOpNumThreads: 4 });
    const size = isPose ? 256 : 320;
    const prep = () =>
      isPose ? preprocessPose(img, { x1: 50, y1: 300, x2: 430, y2: 750 }).tensor : preprocessDetector(img).tensor;
    const tensor = prep();
    const feeds = { [sess.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, size, size]) };
    for (let i = 0; i < 3; i++) await sess.run(feeds); // warm-up
    let pre = 0;
    let run = 0;
    for (let i = 0; i < N; i++) {
      pre += time(prep);
      run += await timeAsync(() => sess.run(feeds));
    }
    console.log(`${name.padEnd(24)} preprocess ${(pre / N).toFixed(1)} ms   model ${(run / N).toFixed(1)} ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
