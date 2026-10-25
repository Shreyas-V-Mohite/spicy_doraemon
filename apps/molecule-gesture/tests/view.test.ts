import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerpView, rotateViewScreen, viewDelta, type ViewState } from '../src/viewer/viewState';
import { decodeSimcc, preprocessPose } from '../src/hand/rtm/preprocess';

const IDENTITY: ViewState = [0, 0, 0, 100, 0, 0, 0, 1, 0, 0];

/** Rotate vector v by quaternion q (x, y, z, w). */
function rotate(q: number[], v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('rotateViewScreen: positive dx moves the front of the molecule to the right', () => {
  const v = rotateViewScreen(IDENTITY, 90, 0);
  const front = rotate(v.slice(4), [0, 0, 1]);
  close(front[0], 1);
  close(front[2], 0);
});

test('rotateViewScreen: positive dy moves the front of the molecule down', () => {
  const v = rotateViewScreen(IDENTITY, 0, 90);
  const front = rotate(v.slice(4), [0, 0, 1]);
  close(front[1], -1);
});

test('rotateViewScreen: axes are screen-relative regardless of current orientation', () => {
  // Turn 90° about Y first, then a screen-X rotation must still tip the front down.
  const turned = rotateViewScreen(IDENTITY, 90, 0);
  const v = rotateViewScreen(turned, 0, 90);
  // Whatever model point is now facing the camera (+z) should move to -y.
  const facingModel = rotate([-turned[4], -turned[5], -turned[6], turned[7]], [0, 0, 1]);
  const moved = rotate(v.slice(4), facingModel);
  close(moved[1], -1);
});

test('rotateViewScreen: positive dz spins clockwise on screen', () => {
  const v = rotateViewScreen(IDENTITY, 0, 0, 90);
  const right = rotate(v.slice(4), [1, 0, 0]);
  close(right[1], -1); // a point on the right moves down
});

test('lerpView endpoints and zoom interpolation', () => {
  const b = rotateViewScreen([1, 2, 3, 50, 0, 0, 0, 1, 4, -2], 120, 30);
  assert.ok(viewDelta(lerpView(IDENTITY, b, 0), IDENTITY) < 1e-6);
  assert.ok(viewDelta(lerpView(IDENTITY, b, 1), b) < 1e-4);
  close(lerpView(IDENTITY, b, 0.5)[3], 75);
});

test('SimCC decode maps a peak back to source-frame pixels', () => {
  const img = { data: new Uint8ClampedArray(640 * 480 * 4), width: 640, height: 480 };
  const crop = preprocessPose(img, { x1: 100, y1: 100, x2: 300, y2: 300 }); // 200px box → 250px crop
  const bins = 512;
  const sx = new Float32Array(bins).fill(0);
  const sy = new Float32Array(bins).fill(0);
  sx[256] = 0.9; // input x = 128 → crop center
  sy[128] = 0.7; // input y = 64 → quarter height
  const [kp] = decodeSimcc(sx, sy, 1, bins, bins, crop);
  close(kp.x, 200, 1e-3);
  close(kp.y, 200 - 250 / 4, 1e-3);
  close(kp.score, 0.7, 1e-6);
});
