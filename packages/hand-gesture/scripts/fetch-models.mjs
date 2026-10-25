#!/usr/bin/env node
/**
 * Puts MediaPipe's hand tracking files where the web app serves them:
 *   apps/web/public/models/hand_landmarker.task   (downloaded, about 8 MB)
 *   apps/web/public/mediapipe/*                   (WebAssembly, copied from node_modules)
 *
 * Idempotent. The files are generated, so they are git-ignored.
 *
 *   npm run models -w @spicy/hand-gesture
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webPublic = join(here, '..', '..', '..', 'apps', 'web', 'public');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

const modelDir = join(webPublic, 'models');
mkdirSync(modelDir, { recursive: true });
const model = join(modelDir, 'hand_landmarker.task');
if (existsSync(model)) {
  console.log('✓ hand_landmarker.task already present');
} else {
  console.log(`↓ ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for hand_landmarker.task`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
  console.log('✓ hand_landmarker.task');
}

const wasmDir = join(webPublic, 'mediapipe');
mkdirSync(wasmDir, { recursive: true });
// The package may be hoisted to the repo root or kept in this package.
const candidates = [
  join(here, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
  join(here, '..', '..', '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
];
const source = candidates.find((p) => existsSync(p));
if (!source) throw new Error('@mediapipe/tasks-vision is not installed; run npm install first');
for (const f of readdirSync(source)) copyFileSync(join(source, f), join(wasmDir, f));
console.log('✓ MediaPipe WebAssembly copied to apps/web/public/mediapipe/');
