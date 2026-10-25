/**
 * SYNTHETIC hand keypoints for unit-testing gesture logic. These are
 * hand-constructed geometry, not model output — real-model inference is
 * covered separately by scripts/test-inference.ts.
 */
import type { HandFrame, Keypoint, Point3 } from '../src/gestures/types';

type FingerState = 'ext' | 'curl';

export interface SynthHandOpts {
  x?: number;
  y?: number;
  index?: FingerState;
  middle?: FingerState;
  ring?: FingerState;
  pinky?: FingerState;
  /** 0 = straight … 1 = fully curled, applied to all four fingers (overrides per-finger states). */
  curl?: number;
  /** Per-finger curl (overrides `curl` for the fingers given). */
  curls?: Partial<Record<'index' | 'middle' | 'ring' | 'pinky', number>>;
  /** Thumb tip offset from the wrist; defaults to a relaxed, open thumb. */
  thumbTip?: { x: number; y: number };
  /** In-plane rotation about the wrist, degrees, in IMAGE coordinates (clockwise positive). */
  roll?: number;
  /** Turning the hand over about its long axis, degrees (0 = palm to camera, 180 = back). */
  yaw?: number;
  /** 3D only (synthWorld): tilting the hand forward/back about the camera's x-axis, degrees. */
  pitch?: number;
  score?: number;
}

const MCP = {
  index: { x: -30, y: -100 },
  middle: { x: -10, y: -105 },
  ring: { x: 10, y: -100 },
  pinky: { x: 30, y: -90 },
};

export function synthHand(o: SynthHandOpts = {}): Keypoint[] {
  const ox = o.x ?? 320;
  const oy = o.y ?? 400;
  const s = o.score ?? 0.8;
  const cosY = Math.cos(((o.yaw ?? 0) * Math.PI) / 180);
  const r = ((o.roll ?? 0) * Math.PI) / 180;
  const p = (x: number, y: number): Keypoint => {
    // Turning the hand over foreshortens offsets across the hand (the hand's
    // long axis is vertical here), then the whole hand rotates in-plane.
    const xf = x * cosY;
    return {
      x: ox + xf * Math.cos(r) - y * Math.sin(r),
      y: oy + xf * Math.sin(r) + y * Math.cos(r),
      score: s,
    };
  };
  const kp: Keypoint[] = new Array(21);
  kp[0] = p(0, 0);
  kp[1] = p(-25, -20);
  kp[2] = p(-45, -45);
  kp[3] = p(-60, -65);
  const tt = o.thumbTip ?? { x: -85, y: -80 };
  kp[4] = p(tt.x, tt.y);
  const fingers = ['index', 'middle', 'ring', 'pinky'] as const;
  fingers.forEach((f, i) => {
    const m = MCP[f];
    const base = 5 + i * 4;
    const c = o.curls?.[f] ?? o.curl ?? ((o[f] ?? 'ext') === 'ext' ? 0 : 1);
    const lerp = (a: number, b: number) => a + (b - a) * c;
    kp[base] = p(m.x, m.y);
    kp[base + 1] = p(m.x, m.y + lerp(-40, -30));
    kp[base + 2] = p(m.x, m.y + lerp(-65, -12));
    kp[base + 3] = p(m.x, m.y + lerp(-85, 25));
  });
  return kp;
}

export function frameOf(t: number, kp: Keypoint[] | null, poseScore = 0.8, world?: Point3[]): HandFrame {
  return {
    timestamp: t,
    frameWidth: 640,
    frameHeight: 480,
    hand: kp
      ? { keypoints: kp, world, bbox: { x1: 0, y1: 0, x2: 640, y2: 480 }, detScore: 0.9, poseScore, fromDetector: true }
      : null,
  };
}

/**
 * SYNTHETIC 3D "world" keypoints like MediaPipe's (raw-image x right, y down,
 * z away from camera), built from the same hand with a real 3D turn: yaw
 * rotates the hand about its long (vertical) axis, moving one side away from
 * the camera and the other toward it.
 */
export function synthWorld(o: SynthHandOpts = {}): Point3[] {
  const flat = synthHand({ ...o, x: 0, y: 0, roll: 0, yaw: 0 });
  const yaw = ((o.yaw ?? 0) * Math.PI) / 180;
  const r = ((o.roll ?? 0) * Math.PI) / 180;
  const pitch = ((o.pitch ?? 0) * Math.PI) / 180;
  return flat.map((p) => {
    const x3 = p.x * Math.cos(yaw);
    const z3 = p.x * Math.sin(yaw);
    const x = x3 * Math.cos(r) - p.y * Math.sin(r);
    const y = x3 * Math.sin(r) + p.y * Math.cos(r);
    return {
      x: x / 1000,
      y: (y * Math.cos(pitch) - z3 * Math.sin(pitch)) / 1000,
      z: (y * Math.sin(pitch) + z3 * Math.cos(pitch)) / 1000,
    };
  });
}
