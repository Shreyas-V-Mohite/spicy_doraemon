/**
 * The 3Dmol.js view array, in the 10-number form setView() accepts:
 *   [pos.x, pos.y, pos.z, rotationGroup.position.z (zoom), q.x, q.y, q.z, q.w,
 *    rotationGroup.position.x, rotationGroup.position.y (on-screen placement)]
 * getView() only returns the first 8; the last two are tracked by the adapter.
 * Moving the rotation group (rather than the model) keeps rotation centred on
 * the molecule wherever it is placed. This compact vector is what gets
 * synchronised through SpacetimeDB (older 8-number views mean "centred").
 */
export type ViewState = [number, number, number, number, number, number, number, number, number, number];

export const VIEW_LENGTH = 10;

export function isViewState(v: unknown): v is ViewState {
  return Array.isArray(v) && v.length >= 8 && v.every((n) => Number.isFinite(n));
}

export function toViewState(v: ArrayLike<number>): ViewState {
  return [v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8] ?? 0, v[9] ?? 0];
}

type Quat = [number, number, number, number]; // x, y, z, w

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatFromAxisAngle(x: number, y: number, z: number, radians: number): Quat {
  const s = Math.sin(radians / 2);
  return [x * s, y * s, z * s, Math.cos(radians / 2)];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  // Take the short way round (q and -q are the same rotation).
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const theta = Math.acos(Math.min(1, cos));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/**
 * Rotate a view about the *screen* axes (not the model's own axes), so
 * "move hand right" always spins the visible front surface to the right no
 * matter how the molecule is currently oriented. Pre-multiplying the
 * rotation-group quaternion applies the delta in camera space, exactly like
 * 3Dmol's own mouse-drag handler.
 */
export function rotateViewScreen(view: ViewState, dxDeg: number, dyDeg: number, dzDeg = 0): ViewState {
  const toRad = Math.PI / 180;
  let q: Quat = [view[4], view[5], view[6], view[7]];
  if (dxDeg) q = quatMultiply(quatFromAxisAngle(0, 1, 0, dxDeg * toRad), q);
  if (dyDeg) q = quatMultiply(quatFromAxisAngle(1, 0, 0, dyDeg * toRad), q);
  // +z points at the viewer, so a positive angle is counter-clockwise on screen.
  if (dzDeg) q = quatMultiply(quatFromAxisAngle(0, 0, 1, -dzDeg * toRad), q);
  q = quatNormalize(q);
  return [view[0], view[1], view[2], view[3], q[0], q[1], q[2], q[3], view[8], view[9]];
}

/** Interpolate translation/zoom linearly and orientation by slerp. */
export function lerpView(a: ViewState, b: ViewState, t: number): ViewState {
  const q = quatSlerp([a[4], a[5], a[6], a[7]], [b[4], b[5], b[6], b[7]], t);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
    q[0],
    q[1],
    q[2],
    q[3],
    a[8] + (b[8] - a[8]) * t,
    a[9] + (b[9] - a[9]) * t,
  ];
}

/** Rough "distance" between views for change detection. */
export function viewDelta(a: ViewState, b: ViewState): number {
  const dq = Math.abs(a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7]);
  const angle = 2 * Math.acos(Math.min(1, dq)); // radians
  const move = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[8] - b[8], a[9] - b[9]);
  const zoom = Math.abs(a[3] - b[3]);
  return angle * 57.3 + move + zoom;
}
