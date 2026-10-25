import { FINGER_NAMES, fingerCurl, openness, type FingerName, type Pt } from './handGeometry';
import type { HandFrame } from './types';

/**
 * Hand postures (each finger's curl: 0 = straight … 1 = folded):
 *  OPEN   – all four fingers straight                          → resize (big)
 *  FIST   – all four fingers folded                            → resize (small)
 *  HALF   – all four fingers evenly half-bent (holding a ball) → rotate
 *  POINT  – index straight, middle/ring/pinky folded           → move
 *  OTHER  – a confidently tracked hand in between (e.g. mid open↔close)
 *  NONE   – no hand, or tracking not confident enough
 */
export type Posture = 'OPEN' | 'FIST' | 'HALF' | 'POINT' | 'OTHER' | 'NONE';

export interface RecognizerConfig {
  /** Minimum mean keypoint score for a frame to count at all. */
  minPoseScore: number;
  /** OPEN when every finger's curl is at most this. */
  openMaxCurl: number;
  /** FIST when every finger's curl is at least this. */
  fistMinCurl: number;
  /** HALF when every finger's curl lies in [halfMinCurl, halfMaxCurl] … */
  halfMinCurl: number;
  halfMaxCurl: number;
  /** … and the fingers are bent about equally (max − min curl). */
  halfMaxSpread: number;
  /** POINT: index curl at most this, the other three at least pointOthersMinCurl. */
  pointIndexMaxCurl: number;
  pointOthersMinCurl: number;
  /** How long a new posture must persist before it is reported (ms), per posture. */
  holdMs: Record<Exclude<Posture, 'NONE'>, number>;
  /** How long low-confidence/no-hand frames are tolerated before NONE (ms). */
  lostAfterMs: number;
}

export const DEFAULT_RECOGNIZER_CONFIG: RecognizerConfig = {
  minPoseScore: 0.35,
  openMaxCurl: 0.3,
  fistMinCurl: 0.72,
  halfMinCurl: 0.25,
  halfMaxCurl: 0.8,
  halfMaxSpread: 0.45,
  pointIndexMaxCurl: 0.3,
  pointOthersMinCurl: 0.55,
  // Resize postures react fast; rotate/move wait a little so an open↔close
  // movement passing through "half" doesn't switch modes by accident.
  holdMs: { OPEN: 80, FIST: 80, OTHER: 120, HALF: 250, POINT: 200 },
  lostAfterMs: 350,
};

export interface RecognizerOutput {
  /** Posture after the hold-time debounce — what downstream logic acts on. */
  posture: Posture;
  /** Raw per-frame posture (for the debug overlay). */
  rawPosture: Posture;
  confidence: number;
  /** 0 = fist … 1 = fully open. */
  openness: number;
  curls: Record<FingerName, number>;
}

const NO_CURLS: Record<FingerName, number> = { index: 0, middle: 0, ring: 0, pinky: 0 };

export class GestureRecognizer {
  private stable: Posture = 'NONE';
  private candidate: Posture = 'NONE';
  private candidateSince = 0;
  private lastConfidentAt = -Infinity;
  private lastOpenness = 0;
  private lastCurls = NO_CURLS;
  readonly config: RecognizerConfig;

  constructor(config: Partial<RecognizerConfig> = {}) {
    this.config = { ...DEFAULT_RECOGNIZER_CONFIG, ...config };
  }

  reset(): void {
    this.stable = 'NONE';
    this.candidate = 'NONE';
  }

  /** Classify one frame's keypoints, without any temporal logic. */
  classify(kp: Pt[]): { posture: Posture; curls: Record<FingerName, number> } {
    const c = this.config;
    const curls = {} as Record<FingerName, number>;
    for (const f of FINGER_NAMES) curls[f] = fingerCurl(kp, f);
    const all = FINGER_NAMES.map((f) => curls[f]);
    const min = Math.min(...all);
    const max = Math.max(...all);
    let posture: Posture = 'OTHER';
    if (curls.index <= c.pointIndexMaxCurl && Math.min(curls.middle, curls.ring, curls.pinky) >= c.pointOthersMinCurl) {
      posture = 'POINT';
    } else if (max <= c.openMaxCurl) {
      posture = 'OPEN';
    } else if (min >= c.fistMinCurl) {
      posture = 'FIST';
    } else if (min >= c.halfMinCurl && max <= c.halfMaxCurl && max - min <= c.halfMaxSpread) {
      posture = 'HALF';
    }
    return { posture, curls };
  }

  update(frame: HandFrame): RecognizerOutput {
    const c = this.config;
    const t = frame.timestamp;
    const hand = frame.hand;
    const confidence = hand ? hand.poseScore : 0;

    if (!hand || hand.poseScore < c.minPoseScore) {
      if (t - this.lastConfidentAt < c.lostAfterMs) {
        // Brief dropout: hold the current posture rather than flicker.
        return this.output(this.stable, confidence);
      }
      this.stable = 'NONE';
      this.candidate = 'NONE';
      return this.output('NONE', confidence);
    }
    this.lastConfidentAt = t;
    // 3D world points (MediaPipe) when available: no foreshortening when
    // fingers point toward the camera.
    const kp: Pt[] = hand.world ?? hand.keypoints;
    const { posture: raw, curls } = this.classify(kp);
    this.lastCurls = curls;
    this.lastOpenness = openness(kp);

    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = t;
    }
    // Time-based (not frame-count) hold, so behaviour is the same at 5 or 30 fps.
    const hold = c.holdMs[raw as Exclude<Posture, 'NONE'>];
    if (this.stable === 'NONE' || t - this.candidateSince >= hold) this.stable = raw;

    return this.output(raw, confidence);
  }

  private output(raw: Posture, confidence: number): RecognizerOutput {
    const lost = raw === 'NONE';
    return {
      posture: this.stable,
      rawPosture: raw,
      confidence,
      openness: lost ? 0 : this.lastOpenness,
      curls: lost ? NO_CURLS : this.lastCurls,
    };
  }
}
