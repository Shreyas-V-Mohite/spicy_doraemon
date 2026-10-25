import { HandKp } from './types';

/**
 * A keypoint in 2D pixels or 3D metric coordinates. All ratios below are
 * scale-free, so they work on either; with z (MediaPipe world landmarks)
 * they are also free of perspective foreshortening.
 */
export interface Pt {
  x: number;
  y: number;
  z?: number;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

/** Palm center: mean of the wrist and the four finger MCP joints. */
export function palmCenter(kp: Pt[]): Pt {
  const ids = [HandKp.WRIST, HandKp.INDEX_MCP, HandKp.MIDDLE_MCP, HandKp.RING_MCP, HandKp.PINKY_MCP];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of ids) {
    x += kp[i].x;
    y += kp[i].y;
    z += kp[i].z ?? 0;
  }
  const n = ids.length;
  return kp[0].z === undefined ? { x: x / n, y: y / n } : { x: x / n, y: y / n, z: z / n };
}

/**
 * Hand scale used to normalise all distances so gestures work at any
 * distance from the camera: mean wrist-to-MCP length (index, middle, pinky).
 */
export function palmSize(kp: Pt[]): number {
  const w = kp[HandKp.WRIST];
  return (
    (dist(w, kp[HandKp.INDEX_MCP]) + dist(w, kp[HandKp.MIDDLE_MCP]) + dist(w, kp[HandKp.PINKY_MCP])) / 3
  );
}

export const FINGERS = {
  index: { mcp: HandKp.INDEX_MCP, pip: HandKp.INDEX_PIP, tip: HandKp.INDEX_TIP },
  middle: { mcp: HandKp.MIDDLE_MCP, pip: HandKp.MIDDLE_PIP, tip: HandKp.MIDDLE_TIP },
  ring: { mcp: HandKp.RING_MCP, pip: HandKp.RING_PIP, tip: HandKp.RING_TIP },
  pinky: { mcp: HandKp.PINKY_MCP, pip: HandKp.PINKY_PIP, tip: HandKp.PINKY_TIP },
} as const;

export type FingerName = keyof typeof FINGERS;
export const FINGER_NAMES = Object.keys(FINGERS) as FingerName[];

/**
 * Finger extension ratio = |wrist→tip| / |wrist→MCP|.
 * Straight fingers measure ~1.65 in 3D (more in flat 2D drawings); a finger
 * folded into a fist ~1.0. Independent of hand size and in-plane rotation.
 */
export function extensionRatio(kp: Pt[], finger: FingerName): number {
  const f = FINGERS[finger];
  const w = kp[HandKp.WRIST];
  return dist(w, kp[f.tip]) / Math.max(1e-6, dist(w, kp[f.mcp]));
}

/** Thumb-tip to index-tip distance in palm units. */
export function pinchRatio(kp: Pt[]): number {
  return dist(kp[HandKp.THUMB_TIP], kp[HandKp.INDEX_TIP]) / Math.max(1e-6, palmSize(kp));
}

/**
 * Hand openness in [0, 1]: 0 = closed fist, 1 = all four fingers straight.
 * One minus the mean finger curl (see fingerCurl). Unaffected by in-plane
 * rotation, hand size and distance from the camera.
 */
export function openness(kp: Pt[]): number {
  let sum = 0;
  for (const f of FINGER_NAMES) sum += 1 - fingerCurl(kp, f);
  return sum / FINGER_NAMES.length;
}

/**
 * In-plane hand angle in degrees (wrist → middle-finger MCP), measured in
 * the coordinates the user sees: mirrored when the preview is a selfie view,
 * y pointing down. Increasing angle = clockwise twist on screen.
 */
export function handRollDeg(kp: Pt[], mirror: boolean): number {
  const w = kp[HandKp.WRIST];
  const m = kp[HandKp.MIDDLE_MCP];
  const dx = (mirror ? -1 : 1) * (m.x - w.x);
  return (Math.atan2(m.y - w.y, dx) * 180) / Math.PI;
}

/**
 * Signed palm width / palm length. The width is the index-MCP → pinky-MCP
 * span measured perpendicular to the palm's long axis, so it is unaffected by
 * twisting. Turning the hand over (palm ↔ back of hand) sweeps this through
 * zero and flips its sign — which gives the cosine of the flip angle once
 * divided by its palm-facing value.
 */
export function signedPalmWidthRatio(kp: Pt[]): number {
  const w = kp[HandKp.WRIST];
  const m = kp[HandKp.MIDDLE_MCP];
  const i = kp[HandKp.INDEX_MCP];
  const p = kp[HandKp.PINKY_MCP];
  const ux = m.x - w.x;
  const uy = m.y - w.y;
  const len = Math.max(1e-6, Math.hypot(ux, uy));
  const lx = p.x - i.x;
  const ly = p.y - i.y;
  return (ux * ly - uy * lx) / (len * len);
}

const STRAIGHT_RATIO = 1.65;
const FOLDED_RATIO = 1.0;

/**
 * How curled one finger is, 0 = straight … 1 = fully folded into the palm.
 * The inverse of the per-finger term in openness().
 */
export function fingerCurl(kp: Pt[], finger: FingerName): number {
  // Calibrated on MediaPipe 3D landmarks of a real open hand: straight
  // fingers measure ~1.65 (not the 1.8 a flat 2D drawing gives); a fist ~1.0.
  const c = (STRAIGHT_RATIO - extensionRatio(kp, finger)) / (STRAIGHT_RATIO - FOLDED_RATIO);
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** Wrap an angle difference into (-180, 180]. */
export function wrapDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

/** Index-tip distance from the palm center in palm units (small in a fist). */
export function indexReach(kp: Pt[]): number {
  const c = palmCenter(kp);
  const t = kp[HandKp.INDEX_TIP];
  return Math.hypot(t.x - c.x, t.y - c.y) / Math.max(1e-6, palmSize(kp));
}

type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

function sub(a: Pt, b: Pt): [number, number, number] {
  return [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
}
function norm(v: [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Orientation of the palm from 3D keypoints, as a rotation matrix whose
 * columns are the palm's across (index→pinky), up (wrist→middle MCP) and
 * normal axes.
 */
export function palmBasis(w: Pt[]): Mat3 {
  const up = norm(sub(w[HandKp.MIDDLE_MCP], w[HandKp.WRIST]));
  const across0 = norm(sub(w[HandKp.PINKY_MCP], w[HandKp.INDEX_MCP]));
  const n = norm(cross(up, across0));
  const across = cross(n, up);
  return [across[0], up[0], n[0], across[1], up[1], n[1], across[2], up[2], n[2]];
}

/**
 * Rotation vector (axis × angle, degrees) taking basis `from` to basis `to`,
 * i.e. of Rd = to · fromᵀ.
 *
 * Coordinates: MediaPipe world landmarks use x right / y down in the raw
 * image and z away from the camera. The mirrored on-screen view with the
 * viewer's y up and z toward the viewer is M = −I applied to that, and since
 * M·R·Mᵀ = R the rotation vector is numerically the same in display (GL)
 * coordinates: ω.x about screen-right, ω.y about screen-up, ω.z toward viewer.
 */
export function rotationBetween(from: Mat3, to: Mat3): [number, number, number] {
  // Rd = to * from^T
  const r = (i: number, j: number) => to[i * 3] * from[j * 3] + to[i * 3 + 1] * from[j * 3 + 1] + to[i * 3 + 2] * from[j * 3 + 2];
  const tr = r(0, 0) + r(1, 1) + r(2, 2);
  const theta = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  const v: [number, number, number] = [r(2, 1) - r(1, 2), r(0, 2) - r(2, 0), r(1, 0) - r(0, 1)];
  const s = Math.sin(theta);
  const k = s < 1e-6 ? 0.5 : theta / (2 * s);
  const deg = 180 / Math.PI;
  return [v[0] * k * deg, v[1] * k * deg, v[2] * k * deg];
}

export type { Mat3 };
