/**
 * The software chain end to end, with no browser, camera or model: scripted
 * hand poses go through the real HandGestureController (selection, smoothing,
 * posture, mapping) and its commands drive the real ViewMotion on a fake 3Dmol
 * viewer. It proves the pieces are wired together, not that real hands or a
 * real camera behave (that needs a person in front of a webcam).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandGestureController } from '../src/gestures/HandGestureController';
import type { GestureCommand, HandFrame } from '../src/gestures/types';
import type { HandLandmarker } from '../src/hand/types';
import type { WebcamSource } from '../src/hand/WebcamSource';
import { ViewMotion, type MotionViewer } from '../src/motion/ViewMotion';
import { frameOf, synthHand, type SynthHandOpts } from './helpers';

// The controller waits for animation frames while the camera warms up.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (cb: (t: number) => void) =>
  setTimeout(() => cb(performance.now()), 4);

const FRAME_MS = 50;
const CAMERA_Z = 150;

class ScriptedLandmarker implements HandLandmarker {
  consumed = 0;
  constructor(private readonly script: (SynthHandOpts | null)[]) {}
  async init() {
    return { model: 'scripted', backend: 'test' };
  }
  async estimate(_bitmap: ImageBitmap, timestamp: number): Promise<HandFrame> {
    const pose = this.script[Math.min(this.consumed++, this.script.length - 1)];
    return frameOf(timestamp, pose ? synthHand(pose) : null);
  }
  close() {}
}

const fakeCamera = {
  video: { readyState: 4 },
  start: async () => {},
  stop: () => {},
  grab: () => new Promise<ImageBitmap>((resolve) => setTimeout(() => resolve({} as ImageBitmap), FRAME_MS)),
} as unknown as WebcamSource;

class FakeViewer implements MotionViewer {
  view = [0, 0, 0, CAMERA_Z - 100, 0, 0, 0, 1];
  atoms = [{ x: 3, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }];
  limits: [number, number] = [0, Infinity];
  getView() { return [...this.view]; }
  setView(v: number[]) { this.view = v.slice(0, 8); }
  zoom(f: number) {
    const d = (CAMERA_Z - this.view[3]) / f;
    this.view[3] = CAMERA_Z - Math.min(this.limits[1], Math.max(this.limits[0], d));
  }
  zoomTo() {}
  render() {}
  setZoomLimits(min: number, max: number) { this.limits = [min, max]; }
  getModel() { return { selectedAtoms: () => this.atoms }; }
}

/** Plays the script through a controller wired to a ViewMotion; resolves when it has all been seen. */
async function play(script: (SynthHandOpts | null)[]) {
  const landmarker = new ScriptedLandmarker(script);
  const controller = new HandGestureController({ landmarker, webcam: fakeCamera });
  const viewer = new FakeViewer();
  const motion = new ViewMotion(viewer, { clientWidth: 800, clientHeight: 500 }, { autoTick: false });
  motion.modelChanged('ball-and-stick');
  const commands: GestureCommand[] = [];
  controller.subscribe((cmd) => {
    commands.push(cmd);
    motion.applyCommand(cmd);
  });
  // The app eases motion on every animation frame while the hands move.
  const easing = setInterval(() => motion.step(16), 16);
  await controller.start();
  const deadline = Date.now() + 20_000;
  while (landmarker.consumed < script.length) {
    const snap = controller.getSnapshot();
    if (snap.phase === 'error') throw new Error(`controller failed: ${snap.error}`);
    if (Date.now() > deadline) throw new Error(`timed out after ${landmarker.consumed}/${script.length} frames, phase ${snap.phase}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 400)); // let the last commands ease in
  clearInterval(easing);
  controller.stop(); // emits STOP, which drops anything not yet applied
  return { motion, commands, viewer };
}

const OPEN: SynthHandOpts = { curl: 0 };

test('closing the hand shrinks the molecule and opening it grows it again', async () => {
  const closing = Array.from({ length: 11 }, (_, i) => ({ curl: Math.min(0.55, (i + 1) * 0.05) }));
  const opening = Array.from({ length: 11 }, (_, i) => ({ curl: Math.max(0, 0.55 - (i + 1) * 0.05) }));

  const shrunk = await play([...Array(16).fill(OPEN), ...closing]);
  assert.ok(shrunk.commands.some((c) => c.type === 'ZOOM'), 'closing produced zoom commands');
  assert.ok(shrunk.motion.currentScale() < 0.6, `scale after closing: ${shrunk.motion.currentScale()}`);

  const regrown = await play([...Array(16).fill(OPEN), ...closing, ...opening]);
  assert.ok(
    regrown.motion.currentScale() > shrunk.motion.currentScale() * 1.5,
    `scale after reopening: ${regrown.motion.currentScale()}`,
  );
});

test('a hand that appears and holds still changes nothing', async () => {
  const { commands, viewer } = await play(Array(24).fill(OPEN));
  assert.equal(commands.filter((c) => c.type === 'ZOOM' || c.type === 'ROTATE').length, 0);
  assert.equal(viewer.view.join(), [0, 0, 0, CAMERA_Z - 100, 0, 0, 0, 1].join());
});

test('the hand leaving the camera freezes the molecule (STOP reaches the viewer)', async () => {
  const closing = Array.from({ length: 6 }, (_, i) => ({ curl: (i + 1) * 0.05 }));
  const { commands } = await play([...Array(16).fill(OPEN), ...closing, ...Array(12).fill(null)]);
  assert.ok(commands.some((c) => c.type === 'STOP'));
});
