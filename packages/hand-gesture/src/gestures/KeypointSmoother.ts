import { OneEuroFilter } from './oneEuro';
import type { HandFrame, Keypoint, Point3 } from './types';

/**
 * One-Euro filters on all 21 keypoints (x and y), applied before any
 * gesture logic. Raw RTMPose output jitters by a few pixels frame to frame;
 * smoothing at the keypoint level makes finger-curl and posture decisions
 * stable, and the skeleton overlay calmer, at almost no latency cost for
 * fast motion (One-Euro opens up as speed increases).
 */
export class KeypointSmoother {
  private fx: OneEuroFilter[] = [];
  private fy: OneEuroFilter[] = [];
  private fw: OneEuroFilter[] = [];

  constructor(
    private readonly minCutoff = 2.0,
    /** In pixels/second. */
    private readonly beta = 0.01,
  ) {}

  reset(): void {
    this.fx = [];
    this.fy = [];
    this.fw = [];
  }

  apply(frame: HandFrame): HandFrame {
    const hand = frame.hand;
    if (!hand) {
      this.reset();
      return frame;
    }
    if (this.fx.length !== hand.keypoints.length) {
      this.fx = hand.keypoints.map(() => new OneEuroFilter(this.minCutoff, this.beta));
      this.fy = hand.keypoints.map(() => new OneEuroFilter(this.minCutoff, this.beta));
    }
    const keypoints: Keypoint[] = hand.keypoints.map((k, i) => ({
      x: this.fx[i].filter(k.x, frame.timestamp),
      y: this.fy[i].filter(k.y, frame.timestamp),
      score: k.score,
    }));
    let world: Point3[] | undefined;
    if (hand.world) {
      // Metric 3D points (metres): same filter, cutoff tuned for small values.
      if (this.fw.length !== hand.world.length * 3) {
        this.fw = Array.from({ length: hand.world.length * 3 }, () => new OneEuroFilter(this.minCutoff, 0.5));
      }
      world = hand.world.map((p, i) => ({
        x: this.fw[i * 3].filter(p.x, frame.timestamp),
        y: this.fw[i * 3 + 1].filter(p.y, frame.timestamp),
        z: this.fw[i * 3 + 2].filter(p.z, frame.timestamp),
      }));
    }
    return { ...frame, hand: { ...hand, keypoints, world } };
  }
}
