import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerpView, rotateViewScreen, viewDelta, type ViewState } from '../src/motion/viewState';

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
