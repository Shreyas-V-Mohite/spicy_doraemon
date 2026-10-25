/**
 * Real-inference check for the RTMPose hand pipeline.
 *
 * Runs the same RtmHandPipeline code the browser worker uses, but on
 * onnxruntime-node, over OneHand10K sample photos from the mmpose repo, and
 * scores the predicted 21 keypoints against the ground-truth annotations with
 * PCK@0.2 (threshold = 0.2 x longest bbox side, the OneHand10K metric).
 *
 *   npm run test:inference
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import jpeg from 'jpeg-js';
import { RtmHandPipeline, type SessionLike } from '../src/hand/rtm/pipeline.ts';
import type { RgbaImage } from '../src/hand/rtm/preprocess.ts';
import { openness } from '../src/gestures/handGeometry.ts';

const root = join(import.meta.dirname, '..');
const fixtures = join(root, 'tests', 'fixtures', 'hands');

interface CocoAnn {
  image_id: number;
  bbox: [number, number, number, number];
  keypoints: number[];
}
interface CocoImg {
  id: number;
  file_name: string;
}

async function main() {
  const poseFile = process.argv[2] ?? join(root, 'public/models/rtmpose-m-hand.onnx');
  console.log('pose model:', poseFile);
  const det = await ort.InferenceSession.create(join(root, 'public/models/rtmdet-nano-hand.onnx'));
  const pose = await ort.InferenceSession.create(poseFile);
  console.log('detector inputs', det.inputNames, 'outputs', det.outputNames);
  console.log('pose     inputs', pose.inputNames, 'outputs', pose.outputNames);

  const pipeline = new RtmHandPipeline(
    det as unknown as SessionLike,
    pose as unknown as SessionLike,
    (data, dims) => new ort.Tensor('float32', data, dims),
  );

  const coco = JSON.parse(readFileSync(join(fixtures, 'test_onehand10k.json'), 'utf8')) as {
    images: CocoImg[];
    annotations: CocoAnn[];
  };

  let totalCorrect = 0;
  let totalVisible = 0;
  let failures = 0;
  const opennessDiffs: number[] = [];
  for (const im of coco.images) {
    const ann = coco.annotations.find((a) => a.image_id === im.id)!;
    const decoded = jpeg.decode(readFileSync(join(fixtures, im.file_name)), { useTArray: true });
    const img: RgbaImage = { data: decoded.data, width: decoded.width, height: decoded.height };

    pipeline.resetTracking();
    const res = await pipeline.process(img);
    if (!res.hand) {
      const loose = new RtmHandPipeline(
        det as unknown as SessionLike,
        pose as unknown as SessionLike,
        (data, dims) => new ort.Tensor('float32', data, dims),
        { minDetScore: 0.05 },
      );
      const best = await loose.detect(img);
      console.log(
        `${im.file_name}: NO HAND DETECTED (best raw candidate score=${best?.score.toFixed(3) ?? 'none'}, ` +
          `box=${best ? [best.box.x1, best.box.y1, best.box.x2, best.box.y2].map((v) => v.toFixed(0)).join(',') : '-'}, ` +
          `gtBox=${ann.bbox.join(',')})`,
      );
      failures++;
      continue;
    }
    const thr = 0.2 * Math.max(ann.bbox[2], ann.bbox[3]);
    let correct = 0;
    let visible = 0;
    let errSum = 0;
    for (let k = 0; k < 21; k++) {
      const [gx, gy, gv] = ann.keypoints.slice(k * 3, k * 3 + 3);
      if (!gv) continue;
      visible++;
      const p = res.hand.keypoints[k];
      const err = Math.hypot(p.x - gx, p.y - gy);
      errSum += err;
      if (err <= thr) correct++;
    }
    totalCorrect += correct;
    totalVisible += visible;
    // The size gesture reads hand openness from keypoints: compare model vs ground truth.
    if (visible === 21) {
      const gtKp = Array.from({ length: 21 }, (_, k) => ({ x: ann.keypoints[k * 3], y: ann.keypoints[k * 3 + 1], score: 1 }));
      const diff = Math.abs(openness(res.hand.keypoints) - openness(gtKp));
      opennessDiffs.push(diff);
      console.log(`          openness model=${openness(res.hand.keypoints).toFixed(2)} gt=${openness(gtKp).toFixed(2)}`);
    }
    const b = res.hand.bbox;
    console.log(
      `${im.file_name.padEnd(9)} ${decoded.width}x${decoded.height}  det=${res.hand.detScore.toFixed(2)} ` +
        `box=[${b.x1.toFixed(0)},${b.y1.toFixed(0)},${b.x2.toFixed(0)},${b.y2.toFixed(0)}] ` +
        `gtBox=[${ann.bbox.map((v) => v.toFixed(0)).join(',')}]  pose=${res.hand.poseScore.toFixed(2)}  ` +
        `PCK@0.2=${((100 * correct) / visible).toFixed(0)}% (${correct}/${visible})  meanErr=${(errSum / visible).toFixed(1)}px  ` +
        `det ${res.detMs.toFixed(0)}ms pose ${res.poseMs.toFixed(0)}ms`,
    );
  }

  // Tracking path: the second call on the same image reuses keypoint-derived boxes.
  const last = coco.images[coco.images.length - 1];
  const decoded = jpeg.decode(readFileSync(join(fixtures, last.file_name)), { useTArray: true });
  const img: RgbaImage = { data: decoded.data, width: decoded.width, height: decoded.height };
  pipeline.resetTracking();
  await pipeline.process(img);
  const tracked = await pipeline.process(img);
  console.log(
    `tracking frame: fromDetector=${tracked.hand?.fromDetector} pose=${tracked.hand?.poseScore.toFixed(2)} det ${tracked.detMs.toFixed(0)}ms`,
  );

  // Negative control: a blank frame must not produce a hand.
  const blank: RgbaImage = { data: new Uint8ClampedArray(640 * 480 * 4).fill(40), width: 640, height: 480 };
  pipeline.resetTracking();
  const none = await pipeline.process(blank);
  console.log(`blank frame: hand=${none.hand ? 'DETECTED (bad)' : 'none (good)'}`);

  const pck = totalCorrect / Math.max(1, totalVisible);
  console.log(`\nOverall PCK@0.2 = ${(pck * 100).toFixed(1)}% over ${totalVisible} keypoints, ${failures} missed hands`);
  const maxOpenDiff = Math.max(0, ...opennessDiffs);
  console.log(`Openness (size gesture) model vs ground truth: max |diff| = ${maxOpenDiff.toFixed(3)} over ${opennessDiffs.length} fully annotated hands`);
  const ok =
    pck >= 0.8 && failures === 0 && !none.hand && tracked.hand?.fromDetector === false && opennessDiffs.length > 0 && maxOpenDiff < 0.15;
  console.log(ok ? 'INFERENCE TEST PASSED' : 'INFERENCE TEST FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
