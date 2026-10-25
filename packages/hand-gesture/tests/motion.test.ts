import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewMotion, coverPointToPlacement, type MotionViewer } from '../src/motion/ViewMotion';

const CAMERA_Z = 150;

/** A stand-in for 3Dmol's viewer with the same camera model: zoom(f) divides the camera distance by f. */
class FakeViewer implements MotionViewer {
  view = [0, 0, 0, CAMERA_Z - 100, 0, 0, 0, 1]; // distance 100, identity rotation
  limits: [number, number] | null = null;
  renders = 0;
  // A small molecule: atoms within about 3 Å of the origin.
  atoms = [
    { x: 3, y: 0, z: 0 },
    { x: -3, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
  ];
  getView() {
    return [...this.view];
  }
  setView(v: number[]) {
    this.view = v.slice(0, 8);
  }
  zoom(f: number) {
    const d = (CAMERA_Z - this.view[3]) / f;
    const lo = this.limits?.[0] ?? 0;
    const hi = this.limits?.[1] ?? Infinity;
    this.view[3] = CAMERA_Z - Math.min(hi, Math.max(lo, d)); // 3Dmol clamps to its zoom limits
  }
  zoomTo() {
    this.view = [0, 0, 0, CAMERA_Z - 100, 0, 0, 0, 1];
  }
  render() {
    this.renders++;
  }
  setZoomLimits(min: number, max: number) {
    this.limits = [min, max];
  }
  getModel() {
    return { selectedAtoms: () => this.atoms };
  }
}

const BOX = { clientWidth: 800, clientHeight: 500 };

function setup() {
  const viewer = new FakeViewer();
  const motion = new ViewMotion(viewer, BOX, { autoTick: false });
  motion.modelChanged('ball-and-stick');
  return { viewer, motion };
}

/** Run the easing until everything pending has settled. */
function settle(motion: ViewMotion, frames = 200) {
  for (let i = 0; i < frames; i++) motion.step(16);
}

const distance = (v: FakeViewer) => CAMERA_Z - v.view[3];

test('ROTATE turns the molecule about the screen axes and then stops', () => {
  const { viewer, motion } = setup();
  motion.applyCommand({ type: 'ROTATE', dx: 40, dy: 0 });
  settle(motion);
  const q = viewer.view.slice(4, 8);
  // 40 degrees about the vertical axis: y component = sin(20°), w = cos(20°).
  assert.ok(Math.abs(q[1] - Math.sin((20 * Math.PI) / 180)) < 1e-3, `q=${q}`);
  assert.ok(Math.abs(q[3] - Math.cos((20 * Math.PI) / 180)) < 1e-3);
  const after = viewer.view.join();
  settle(motion, 20);
  assert.equal(viewer.view.join(), after, 'nothing keeps moving once the command is spent');
});

test('ZOOM changes the camera distance and cannot pass the size limits', () => {
  const { viewer, motion } = setup();
  const lim = motion.sizeLimits()!;
  assert.ok(lim.minDistance < 100 && 100 < lim.maxDistance, 'home size is inside the limits');

  motion.applyCommand({ type: 'ZOOM', factor: 1.25 });
  settle(motion);
  assert.ok(Math.abs(distance(viewer) - 80) < 0.5, `distance ${distance(viewer)}`);

  motion.applyCommand({ type: 'ZOOM', factor: 1e6 });
  settle(motion);
  assert.ok(distance(viewer) >= lim.minDistance - 1e-6, 'zooming in stops where the molecule fills the screen');
  assert.ok(Math.abs(distance(viewer) - lim.minDistance) < 0.5);

  motion.applyCommand({ type: 'ZOOM', factor: 1e-6 });
  settle(motion);
  assert.ok(distance(viewer) <= lim.maxDistance + 1e-6, 'zooming out stops where it is still visible');
});

test('SCALE sets an absolute size relative to the home size', () => {
  const { viewer, motion } = setup();
  motion.applyCommand({ type: 'SCALE', scale: 2 });
  settle(motion);
  assert.ok(Math.abs(motion.currentScale() - 2) < 0.02, `scale ${motion.currentScale()}`);
  assert.ok(Math.abs(distance(viewer) - 50) < 0.5);
});

test('PAN moves the molecule across the stage and keeps it on screen', () => {
  const { motion } = setup();
  motion.applyCommand({ type: 'PAN', dx: 0.1, dy: 0 });
  settle(motion);
  const p = motion.placement();
  assert.ok(Math.abs(p.x - 0.1) < 0.01, `x=${p.x}`);

  motion.applyCommand({ type: 'PAN', dx: 50, dy: 50 });
  settle(motion);
  const far = motion.placement();
  assert.ok(Math.abs(far.x) < 0.5 && Math.abs(far.y) < 0.5, 'clamped inside the stage');
});

test('PLACE grabs the molecule only when the fingertip is on it, then follows', () => {
  const { motion } = setup();
  // Far from the centre of the molecule: ignored.
  motion.applyCommand({ type: 'PLACE', x: 0.95, y: 0.1, frameAspect: 16 / 10 });
  assert.equal(motion.isGrabbed, false);

  // On the molecule (camera frame centre): grabbed.
  motion.applyCommand({ type: 'PLACE', x: 0.5, y: 0.5, frameAspect: 16 / 10 });
  assert.equal(motion.isGrabbed, true);

  // Then it follows the fingertip toward the right.
  motion.applyCommand({ type: 'PLACE', x: 0.6, y: 0.5, frameAspect: 16 / 10 });
  settle(motion);
  assert.ok(motion.placement().x > 0.05, `x=${motion.placement().x}`);

  motion.applyCommand({ type: 'STOP' });
  assert.equal(motion.isGrabbed, false);
});

test('RESET returns to the size, orientation and place the molecule was loaded with', () => {
  const { viewer, motion } = setup();
  const home = viewer.view.join();
  motion.applyCommand({ type: 'ROTATE', dx: 70, dy: 30 });
  motion.applyCommand({ type: 'ZOOM', factor: 1.5 });
  motion.applyCommand({ type: 'PAN', dx: 0.1, dy: 0.05 });
  settle(motion);
  assert.notEqual(viewer.view.join(), home);
  motion.applyCommand({ type: 'RESET' });
  settle(motion, 5);
  assert.equal(viewer.view.join(), home);
  assert.deepEqual(motion.placement(), { x: 0, y: 0 });
});

test('STOP drops whatever motion was still pending', () => {
  const { viewer, motion } = setup();
  motion.applyCommand({ type: 'ROTATE', dx: 90, dy: 0 });
  motion.step(16);
  motion.applyCommand({ type: 'STOP' });
  const frozen = viewer.view.join();
  settle(motion, 50);
  assert.equal(viewer.view.join(), frozen);
});

test('a new molecule becomes the new home; a style change moves the limits', () => {
  const { viewer, motion } = setup();
  motion.applyCommand({ type: 'ZOOM', factor: 1.5 });
  settle(motion);
  viewer.atoms = [{ x: 8, y: 0, z: 0 }, { x: -8, y: 0, z: 0 }]; // a bigger molecule
  viewer.zoomTo();
  motion.modelChanged('ball-and-stick');
  assert.ok(Math.abs(motion.currentScale() - 1) < 1e-6, 'home scale is 1 again');

  const before = motion.sizeLimits()!.minDistance;
  motion.styleChanged('spacefill'); // atoms are drawn bigger, so the molecule needs more room
  assert.ok(motion.sizeLimits()!.minDistance > before);
});

test('cover mapping lines the fingertip up with a camera shown with object-fit: cover', () => {
  // A 16:9 camera in a 1:1 box is cropped left and right; the frame centre stays at the box centre.
  const c = coverPointToPlacement(0.5, 0.5, 16 / 9, 400, 400);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9);
  // The left edge of the frame is off screen (beyond -0.5 widths).
  assert.ok(coverPointToPlacement(0, 0.5, 16 / 9, 400, 400).x < -0.5);
});

test('with no easing loop and no model, commands do not throw', () => {
  const viewer = new FakeViewer();
  viewer.atoms = [];
  const motion = new ViewMotion(viewer, BOX, { autoTick: false });
  for (const type of ['ROTATE', 'ZOOM', 'SCALE', 'PAN'] as const) {
    if (type === 'ROTATE') motion.applyCommand({ type, dx: 1, dy: 1 });
    if (type === 'ZOOM') motion.applyCommand({ type, factor: 2 });
    if (type === 'SCALE') motion.applyCommand({ type, scale: 2 });
    if (type === 'PAN') motion.applyCommand({ type, dx: 0.1, dy: 0.1 });
  }
  motion.applyCommand({ type: 'RESET' });
  settle(motion, 10);
  motion.dispose();
});
