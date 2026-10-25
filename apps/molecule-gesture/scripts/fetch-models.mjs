#!/usr/bin/env node
/**
 * Downloads the official OpenMMLab RTMPose hand ONNX exports and copies the
 * ONNX Runtime Web WASM binaries into public/. Idempotent.
 *
 *   npm run models
 *
 * Sources (OpenMMLab RTMPose model zoo, projects/rtmpose/README.md):
 *   RTMDet-nano hand detector, 320x320
 *   RTMPose-m hand5 (21 keypoints, SimCC), 256x256
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/';
const MODELS = [
  { out: 'rtmdet-nano-hand.onnx', zip: 'rtmdet_nano_8xb32-300e_hand-267f9c8f.zip' },
  { out: 'rtmpose-m-hand.onnx', zip: 'rtmpose-m_simcc-hand5_pt-aic-coco_210e-256x256-74fb594_20230320.zip' },
];

/** Extract one entry (by name suffix) from a zip buffer. Supports stored/deflate. */
function extractFromZip(buf, suffix) {
  // Find End Of Central Directory record.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith(suffix)) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
    throw new Error(`Unsupported zip compression method ${method}`);
  }
  throw new Error(`${suffix} not found in zip`);
}

async function main() {
  const modelDir = join(root, 'public', 'models');
  mkdirSync(modelDir, { recursive: true });
  for (const m of MODELS) {
    const dest = join(modelDir, m.out);
    if (existsSync(dest)) {
      console.log(`✓ ${m.out} already present`);
      continue;
    }
    console.log(`↓ ${m.zip}`);
    const res = await fetch(BASE + m.zip);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${m.zip}`);
    const zip = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, extractFromZip(zip, 'end2end.onnx'));
    console.log(`✓ ${m.out}`);
  }

  const ortDir = join(root, 'public', 'ort');
  mkdirSync(ortDir, { recursive: true });
  const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
  for (const f of [
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
  ]) {
    copyFileSync(join(ortDist, f), join(ortDir, f));
  }
  console.log('✓ ONNX Runtime Web WASM copied to public/ort/');

  // MediaPipe Hand Landmarker (the default tracker): model + tasks-vision WASM.
  const mpModel = join(modelDir, 'hand_landmarker.task');
  if (!existsSync(mpModel)) {
    const res = await fetch(
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} for hand_landmarker.task`);
    writeFileSync(mpModel, Buffer.from(await res.arrayBuffer()));
  }
  console.log('✓ hand_landmarker.task');
  const mpDir = join(root, 'public', 'mediapipe');
  mkdirSync(mpDir, { recursive: true });
  const mpWasm = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  for (const f of readdirSync(mpWasm)) copyFileSync(join(mpWasm, f), join(mpDir, f));
  console.log('✓ MediaPipe WASM copied to public/mediapipe/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
