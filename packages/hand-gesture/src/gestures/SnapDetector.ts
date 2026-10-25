import { dist, fingerCurl, type Pt } from './handGeometry';
import { HandKp, type HandFrame } from './types';

/**
 * Finger snap: the thumb and middle fingertip press together, then the
 * middle finger flicks down into the palm and the two separate fast.
 *
 *   1. pinch   – thumb tip ↔ middle tip closer than `pinchMax` (in palm
 *                lengths, wrist → middle knuckle) for at least `armMs`
 *   2. release – within `snapWithinMs` of the last pinched frame they are
 *                more than `releaseMin` apart, and the middle finger curled
 *                by `middleCurlRise` or more (the flick)
 *
 * Opening a pinch slowly, making a fist, or an OK sign (thumb + index) is
 * not a snap. Feed it the raw (unsmoothed) landmarks: a snap lasts one or
 * two frames, and smoothing would stretch the separation out.
 */
export interface SnapConfig {
  pinchMax: number;
  releaseMin: number;
  armMs: number;
  snapWithinMs: number;
  middleCurlRise: number;
  /** One snap per this long (a snap toggles a menu; no double toggles). */
  cooldownMs: number;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  pinchMax: 0.35,
  releaseMin: 0.55,
  armMs: 50,
  snapWithinMs: 170,
  middleCurlRise: 0.2,
  cooldownMs: 800,
};

export class SnapDetector {
  readonly config: SnapConfig;
  private pinchedSince: number | null = null;
  private lastPinchAt = -Infinity;
  private curlAtPinch = 0;
  private lastSnapAt = -Infinity;

  constructor(config: Partial<SnapConfig> = {}) {
    this.config = { ...DEFAULT_SNAP_CONFIG, ...config };
  }

  reset(): void {
    this.pinchedSince = null;
    this.lastPinchAt = -Infinity;
  }

  /** True on the frame a snap completes. */
  update(frame: HandFrame): boolean {
    const c = this.config;
    const hand = frame.hand;
    if (!hand) {
      this.reset();
      return false;
    }
    const p: Pt[] = hand.world ?? hand.keypoints;
    const t = frame.timestamp;
    const palm = dist(p[HandKp.WRIST], p[HandKp.MIDDLE_MCP]) || 1;
    const gap = dist(p[HandKp.THUMB_TIP], p[HandKp.MIDDLE_TIP]) / palm;
    const curl = fingerCurl(p, 'middle');

    if (gap <= c.pinchMax) {
      if (this.pinchedSince === null) this.pinchedSince = t;
      this.lastPinchAt = t;
      this.curlAtPinch = curl;
      return false;
    }
    const armed = this.pinchedSince !== null && this.lastPinchAt - this.pinchedSince >= c.armMs;
    if (gap >= c.releaseMin) {
      const fast = t - this.lastPinchAt <= c.snapWithinMs;
      const flicked = curl - this.curlAtPinch >= c.middleCurlRise;
      this.pinchedSince = null;
      if (armed && fast && flicked && t - this.lastSnapAt >= c.cooldownMs) {
        this.lastSnapAt = t;
        return true;
      }
      return false;
    }
    // In between: if the fingers linger here, that pinch was not a snap.
    if (t - this.lastPinchAt > c.snapWithinMs) this.pinchedSince = null;
    return false;
  }
}
