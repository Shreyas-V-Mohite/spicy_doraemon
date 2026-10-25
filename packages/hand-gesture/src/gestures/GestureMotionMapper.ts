import { OneEuroFilter } from './oneEuro';
import { handRollDeg, palmBasis, rotationBetween, signedPalmWidthRatio, wrapDeg, type Mat3 } from './handGeometry';
import { HandKp, type GestureCommand, type HandFrame } from './types';
import type { Posture, RecognizerOutput } from './GestureRecognizer';
import type { FingerName } from './handGeometry';

/**
 * Interaction modes.
 *  ZOOM    – fingers opening/closing: the molecule grows / shrinks
 *  ROTATE  – fingers held at any bend for a while: turning the hand turns the molecule
 *  MOVE    – index finger only: the molecule follows the fingertip
 *  HOLD    – hand gone: nothing moves
 */
export type MotionMode = 'ZOOM' | 'ROTATE' | 'MOVE' | 'HOLD';

export interface MapperConfig {
  /**
   * Size lock → ROTATE: once the fingers stop moving (they stay within
   * `steadyBand` of openness, so a little wiggle still counts as still) for
   * `rotateHoldMs`, the size is fixed and the hand rotates the molecule.
   * After a resize this happens at any bend, fully open included; a hand that
   * has not resized anything yet must be bent at least a little
   * (openness ≤ `rotateMaxOpenness`), so an open hand just raised stays ready
   * to resize. While the fingers keep moving, it is a resize.
   */
  rotateHoldMs: number;
  steadyBand: number;
  rotateMaxOpenness: number;
  /**
   * Back to resizing from ROTATE: a deliberate full squeeze — the fingers go
   * from open (≥ resumeZoomHigh) to closed (≤ resumeZoomLow), or the other
   * way, within `resumeZoomWindowMs`, with the palm facing the camera as when
   * rotation started (finger readings are unreliable on the back of the
   * hand). Bending the fingers part way, as you do to rotate, never resizes.
   */
  resumeZoomLow: number;
  resumeZoomHigh: number;
  resumeZoomWindowMs: number;
  /** After any mode switch, no other switch for this long (no flip-flopping). */
  minModeDwellMs: number;
  /** While resizing, the size only follows the fingers for this long after they last moved. */
  scaleFollowMs: number;
  facingMaxDeg: number;
  /** ROTATE survives the hand vanishing briefly (e.g. mid-turn) for this long. */
  rotateKeepAfterLostMs: number;

  /**
   * 3D landmarks (MediaPipe): the hand's 3D rotation is applied, scaled per
   * screen axis. Tilting the hand forward/back (about screen-right, X) has a
   * smaller range and MediaPipe's depth is compressed, so X gets more gain.
   */
  rotate3dGainX: number;
  rotate3dGainY: number;
  rotate3dGainZ: number;
  rotate3dDeadZoneDeg: number;
  /** 2D fallback (RTMPose): twist → spin, turn over → turn, move → trackball. */
  rollGain: number;
  rollDeadZoneDeg: number;
  flipGain: number;
  flipDeadZoneDeg: number;
  trackballGain: number;
  trackballDeadZone: number;

  /**
   * Resizing is relative: opening the fingers by Δ (openness units) multiplies
   * the selected molecule's size by e^(zoomGain·Δ). Fist → fully open ≈ ×4.3.
   * A hand that appears, or holds still, never changes the size.
   */
  zoomGain: number;
  /** Openness change ignored as jitter. */
  zoomDeadZone: number;
  /**
   * Repeat zoom (like a ratchet): a stroke that runs out of range — opened
   * all the way (openness ≥ zoomArmOpen) or closed all the way (≤
   * zoomArmClosed) — makes the stroke back free, so open-close-open keeps
   * growing and close-open-close keeps shrinking. A stroke that stops part
   * way doesn't, so a plain open-then-close still grows then shrinks. The
   * direction is free again after any mode change (resting locks the size).
   */
  zoomArmOpen: number;
  zoomArmClosed: number;
  /**
   * A resize is all four fingers bending together. Each resize step compares
   * how far the index finger and the other three moved since the last step;
   * the smaller must be at least this fraction of the larger. Closing the
   * other fingers while the index stays straight (turning into a point) is
   * not a resize, and neither is the reverse.
   */
  zoomFingerAgreement: number;
  /**
   * Clear transition: the index is straight (curl ≤ this) while the others
   * are bent by at least `transitionSpread` more. Resizing stops at once.
   */
  transitionIndexMaxCurl: number;
  transitionSpread: number;
  /** A step that never becomes uniform is dropped once it grows this big (openness units). */
  zoomMaxPending: number;
  /** Resizing starts only this long after entering resize mode or after a transition. */
  zoomStableMs: number;
  /** Ignore resizing right after tracking starts (filters are still settling). */
  settleAfterStartMs: number;
  /** Fingertip motion (frame fraction) ignored as jitter while moving. */
  pointDeadZone: number;
  /** Mirror horizontal motion (true when the preview is a selfie view). */
  mirror: boolean;
}

export const DEFAULT_MAPPER_CONFIG: MapperConfig = {
  rotateHoldMs: 500,
  steadyBand: 0.12,
  rotateMaxOpenness: 0.85,
  resumeZoomLow: 0.25,
  resumeZoomHigh: 0.75,
  resumeZoomWindowMs: 800,
  minModeDwellMs: 400,
  scaleFollowMs: 120,
  facingMaxDeg: 55,
  rotateKeepAfterLostMs: 1500,
  rotate3dGainX: 2.4,
  rotate3dGainY: 1.2,
  rotate3dGainZ: 1.2,
  rotate3dDeadZoneDeg: 0.8,
  rollGain: 1.0,
  rollDeadZoneDeg: 2,
  flipGain: 0.6,
  flipDeadZoneDeg: 3,
  trackballGain: 120,
  trackballDeadZone: 0.006,
  zoomGain: Math.log(1.3 / 0.3),
  zoomDeadZone: 0.04,
  zoomArmOpen: 0.85,
  zoomArmClosed: 0.2,
  zoomFingerAgreement: 0.35,
  transitionIndexMaxCurl: 0.35,
  transitionSpread: 0.25,
  zoomMaxPending: 0.2,
  zoomStableMs: 200,
  settleAfterStartMs: 600,
  pointDeadZone: 0.002,
  mirror: true,
};

/**
 * What the hand is doing right now, for the UI:
 *  OPEN_PALM  – resize gesture (fingers opening/closing together)
 *  POINTING   – index only: carrying a molecule
 *  ROTATING   – turning a molecule
 *  TRANSITION – between gestures: everything is frozen
 *  NONE       – no hand
 */
export type GestureState = 'OPEN_PALM' | 'POINTING' | 'ROTATING' | 'TRANSITION' | 'NONE';

export interface MapperStatus {
  mode: MotionMode;
  gesture: GestureState;
  posture: Posture;
  /** Smoothed openness driving the size (0 = fist, 1 = open). */
  openness: number;
  /** 0–1 progress of the steady hold that switches to ROTATE. */
  rotateProgress: number;
}

export class GestureMotionMapper {
  readonly config: MapperConfig;
  private startedAt = 0;
  private mode: MotionMode = 'HOLD';
  private lastT = 0;

  private fWx = new OneEuroFilter(1.2, 4.0);
  private fWy = new OneEuroFilter(1.2, 4.0);
  private fRoll = new OneEuroFilter(1.2, 0.02);
  private fFlip = new OneEuroFilter(1.2, 0.02);
  private fOpen = new OneEuroFilter(1.5, 0.5);
  private openness = 0;

  // Motion anchors; null after a reset so the next frame re-anchors (no jumps).
  private anchored = false;
  private wristAnchor = { x: 0, y: 0 };
  private rollRawPrev: number | null = null;
  private rollUnwrapped = 0;
  private rollAnchor = 0;
  private flipAnchor = 0;
  private basisAnchor: Mat3 | null = null;
  // Palm-facing reference for the 2D flip measurement, learned continuously.
  private palmRatioMax = 0.3;
  private handSign = 1;

  // Steadiness of the fingers (for entering ROTATE).
  private steadySince: number | null = null;
  private steadyMin = 0;
  private steadyMax = 0;
  // ROTATE bookkeeping.
  /** Openness while rotating (recent samples), to spot the full squeeze that resumes resizing. */
  private rotateHistory: { t: number; o: number }[] = [];
  /** This resize session changed the size: stopping now locks it, at any bend. */
  private resized = false;
  private normalAtRotate: [number, number, number] | null = null;
  private flipAtRotate = 0;
  private modeSince = 0;
  private lostAt: number | null = null;

  /** Openness (and each finger's curl) the last resize step was measured from. */
  private zoomAnchor: number | null = null;
  private zoomAnchorCurls: Record<FingerName, number> | null = null;
  /** No resizing before this time (just entered resize mode, or a transition). */
  private zoomBlockedUntil = 0;
  private transition = false;
  /** Direction of the current run of zoom strokes (0 = not yet chosen). */
  private zoomDir = 0;
  private lastPoint: { x: number; y: number } | null = null;

  constructor(config: Partial<MapperConfig> = {}) {
    this.config = { ...DEFAULT_MAPPER_CONFIG, ...config };
  }

  /** Tracking (re)started: forget the past, settle before resizing. */
  reset(t: number): void {
    this.startedAt = t;
    this.mode = 'HOLD';
    this.steadySince = null;
    this.zoomAnchor = null;
    this.resetTracking();
  }

  /** Stop moving (e.g. control paused, hand gone). */
  release(): GestureCommand[] {
    const was = this.mode;
    this.mode = 'HOLD';
    this.resetTracking();
    return was === 'ROTATE' || was === 'MOVE' || was === 'ZOOM' ? [{ type: 'STOP' }] : [];
  }

  status(posture: Posture): MapperStatus {
    const c = this.config;
    const rotateProgress =
      this.mode === 'ROTATE'
        ? 1
        : this.mode === 'ZOOM' && this.steadySince !== null && (this.resized || this.openness <= c.rotateMaxOpenness)
          ? Math.min(1, (this.lastT - this.steadySince) / c.rotateHoldMs)
          : 0;
    return {
      mode: this.mode,
      gesture:
        this.mode === 'HOLD' || posture === 'NONE'
          ? 'NONE'
          : this.transition
            ? 'TRANSITION'
            : this.mode === 'MOVE'
              ? 'POINTING'
              : this.mode === 'ROTATE'
                ? 'ROTATING'
                : 'OPEN_PALM',
      posture,
      openness: this.openness,
      rotateProgress,
    };
  }

  update(frame: HandFrame, rec: RecognizerOutput): GestureCommand[] {
    const c = this.config;
    const t = frame.timestamp;
    this.lastT = t;
    const hand = frame.hand;
    const out: GestureCommand[] = [];

    if (rec.posture === 'NONE' || !hand) {
      this.steadySince = null;
      if (this.mode === 'ROTATE') {
        // Mid-turn the hand can vanish for a moment: freeze, but stay in ROTATE.
        if (this.lostAt === null) {
          this.lostAt = t;
          out.push({ type: 'STOP' });
          this.resetTracking();
        } else if (t - this.lostAt > c.rotateKeepAfterLostMs) {
          this.mode = 'HOLD';
        }
        return out;
      }
      out.push(...this.release());
      return out;
    }
    this.lostAt = null;
    const kp = hand.keypoints;

    // --- measurements -------------------------------------------------------
    const wx = this.fWx.filter(kp[HandKp.WRIST].x / frame.frameWidth, t);
    const wy = this.fWy.filter(kp[HandKp.WRIST].y / frame.frameWidth, t);
    const rollRaw = handRollDeg(kp, c.mirror);
    if (this.rollRawPrev !== null) this.rollUnwrapped += wrapDeg(rollRaw - this.rollRawPrev);
    this.rollRawPrev = rollRaw;
    const roll = this.fRoll.filter(this.rollUnwrapped, t);
    const widthRatio = signedPalmWidthRatio(kp);
    if (Math.abs(widthRatio) > this.palmRatioMax) {
      this.palmRatioMax = Math.abs(widthRatio);
      this.handSign = widthRatio >= 0 ? 1 : -1;
    }
    const flip = this.fFlip.filter(this.flipDeg(widthRatio), t);
    this.openness = this.fOpen.filter(rec.openness, t);
    const basis = hand.world ? palmBasis(hand.world) : null;
    if (!this.anchored) this.anchor(wx, wy, roll, flip, basis);

    // --- mode -------------------------------------------------------------
    const canSwitch = t - this.modeSince >= c.minModeDwellMs;
    if (this.mode === 'ROTATE') {
      // Finger readings only count while the palm faces the camera about as it
      // did when rotation began; on the back of the hand or edge-on, stay put.
      const facing = this.facingAsAtRotate(basis, flip);
      if (facing && canSwitch && rec.posture === 'POINT') {
        this.enter('MOVE', out, wx, wy, roll, flip, basis);
      } else if (facing) {
        const h = this.rotateHistory;
        h.push({ t, o: this.openness });
        while (h.length && t - h[0].t > c.resumeZoomWindowMs) h.shift();
        const lo = Math.min(...h.map((x) => x.o));
        const hi = Math.max(...h.map((x) => x.o));
        if (canSwitch && lo <= c.resumeZoomLow && hi >= c.resumeZoomHigh) this.enter('ZOOM', out, wx, wy, roll, flip, basis);
      }
    } else if (rec.posture === 'POINT') {
      if (this.mode !== 'MOVE') this.enter('MOVE', out, wx, wy, roll, flip, basis);
    } else {
      if (this.mode === 'MOVE' && !canSwitch) return out;
      if (this.mode !== 'ZOOM') this.enter('ZOOM', out, wx, wy, roll, flip, basis);
      // Fingers stopped (a little wiggle allowed): fix the size and rotate.
      const o = this.openness;
      if (this.steadySince === null || o < this.steadyMax - c.steadyBand || o > this.steadyMin + c.steadyBand) {
        this.steadySince = t;
        this.steadyMin = this.steadyMax = o;
      } else {
        this.steadyMin = Math.min(this.steadyMin, o);
        this.steadyMax = Math.max(this.steadyMax, o);
      }
      if ((this.resized || o <= c.rotateMaxOpenness) && t - this.steadySince >= c.rotateHoldMs) {
        this.enter('ROTATE', out, wx, wy, roll, flip, basis);
      }
    }

    // --- per mode -----------------------------------------------------------
    if (this.mode === 'ZOOM') {
      // Only resize while the fingers are actually moving: once they settle the
      // size freezes, so the hold-still-to-rotate period never wobbles it.
      const fingersMoving = this.steadySince === null || t - this.steadySince < c.scaleFollowMs;
      if (this.zoomAnchor === null) this.setZoomAnchor(rec);
      if (this.isTransition(rec)) {
        // Turning into another gesture (e.g. open hand → point): freeze the
        // size, flush any resize still easing, and start over once it settles.
        if (!this.transition) out.push({ type: 'STOP' });
        this.transition = true;
        this.zoomBlockedUntil = t + c.zoomStableMs;
        this.setZoomAnchor(rec);
      } else if (fingersMoving && t - this.startedAt >= c.settleAfterStartMs && t >= this.zoomBlockedUntil) {
        this.transition = false;
        const d = this.openness - this.zoomAnchor!;
        const agree = this.fingersAgree(rec);
        if (Math.abs(d) > c.zoomMaxPending && !agree) {
          // The fingers never moved together: not a resize. Drop it.
          this.setZoomAnchor(rec);
        } else if (Math.abs(d) > c.zoomDeadZone && agree) {
          this.setZoomAnchor(rec);
          const dir = Math.sign(d);
          if (this.zoomDir === 0 || dir === this.zoomDir) {
            out.push({ type: 'ZOOM', factor: Math.exp(d * c.zoomGain) });
            this.resized = true;
            if (dir > 0 && this.openness >= c.zoomArmOpen) this.zoomDir = 1;
            else if (dir < 0 && this.openness <= c.zoomArmClosed) this.zoomDir = -1;
          }
          // else: the stroke back after running out of range — the size stays.
        }
        // else: not sure yet (e.g. the index lags a little) — keep measuring from the anchor.
      } else if (t - this.startedAt < c.settleAfterStartMs || t < this.zoomBlockedUntil) {
        // Settling (tracking just started, or a new mode): follow quietly so the next move starts from here.
        this.setZoomAnchor(rec);
      } else {
        // Fingers resting: the size holds, and the anchor stays where it was, so
        // a slow resize that pauses now and then still adds up correctly.
        this.transition = false;
      }
    } else if (this.mode === 'ROTATE' && basis) {
      // True 3D: the molecule turns the way the hand turns (scaled).
      if (!this.basisAnchor) this.basisAnchor = basis;
      const w = rotationBetween(this.basisAnchor, basis);
      if (Math.hypot(w[0], w[1], w[2]) > c.rotate3dDeadZoneDeg) {
        this.basisAnchor = basis;
        // ROTATE: dx about screen-up (Y), dy about screen-right (X), dz clockwise (= −ω.z).
        out.push({ type: 'ROTATE', dx: w[1] * c.rotate3dGainY, dy: w[0] * c.rotate3dGainX, dz: -w[2] * c.rotate3dGainZ });
      }
    } else if (this.mode === 'ROTATE') {
      let dx = 0;
      let dy = 0;
      let dz = 0;
      const dRoll = roll - this.rollAnchor;
      if (Math.abs(dRoll) > c.rollDeadZoneDeg) {
        dz += dRoll * c.rollGain;
        this.rollAnchor = roll;
      }
      const dFlip = flip - this.flipAnchor;
      if (Math.abs(dFlip) > c.flipDeadZoneDeg) {
        dx += dFlip * c.flipGain;
        this.flipAnchor = flip;
      }
      const ddx = wx - this.wristAnchor.x;
      const ddy = wy - this.wristAnchor.y;
      if (Math.hypot(ddx, ddy) > c.trackballDeadZone) {
        dx += (c.mirror ? -1 : 1) * ddx * c.trackballGain;
        dy += ddy * c.trackballGain;
        this.wristAnchor = { x: wx, y: wy };
      }
      if (dx || dy || dz) out.push({ type: 'ROTATE', dx, dy, dz });
    } else if (this.mode === 'MOVE' && rec.rawPosture !== 'POINT') {
      // The index is folding (leaving the point): the fingertip drops, so don't follow it.
      this.transition = true;
    } else if (this.mode === 'MOVE') {
      this.transition = false;
      const tip = kp[HandKp.INDEX_TIP];
      const x = c.mirror ? 1 - tip.x / frame.frameWidth : tip.x / frame.frameWidth;
      const y = tip.y / frame.frameHeight;
      if (!this.lastPoint || Math.hypot(x - this.lastPoint.x, y - this.lastPoint.y) > c.pointDeadZone) {
        this.lastPoint = { x, y };
        out.push({ type: 'PLACE', x, y, frameAspect: frame.frameWidth / frame.frameHeight });
      }
    }
    return out;
  }

  private enter(
    mode: MotionMode,
    out: GestureCommand[],
    wx: number,
    wy: number,
    roll: number,
    flip: number,
    basis: Mat3 | null,
  ) {
    // Cut off any easing from the previous mode, so a resize never keeps
    // gliding while a rotation starts (or vice versa).
    if (this.mode === 'ROTATE' || this.mode === 'MOVE' || this.mode === 'ZOOM') out.push({ type: 'STOP' });
    this.mode = mode;
    this.modeSince = this.lastT;
    this.anchor(wx, wy, roll, flip, basis);
    this.steadySince = null;
    this.rotateHistory = [];
    this.resized = false;
    this.lastPoint = null;
    this.zoomAnchor = this.openness;
    this.zoomAnchorCurls = null;
    this.zoomDir = 0;
    this.transition = false;
    // Resizing only starts once the hand has settled into the new mode.
    if (mode === 'ZOOM') this.zoomBlockedUntil = this.lastT + this.config.zoomStableMs;
    if (mode === 'ROTATE') {
      this.normalAtRotate = basis ? [basis[2], basis[5], basis[8]] : null;
      this.flipAtRotate = flip;
    }
  }

  private setZoomAnchor(rec: RecognizerOutput) {
    this.zoomAnchor = this.openness;
    this.zoomAnchorCurls = { ...rec.curls };
  }

  /**
   * Between gestures rather than resizing: the recogniser already sees a
   * point (not yet held long enough to switch), or the index is straight
   * while the other fingers are clearly bent.
   */
  private isTransition(rec: RecognizerOutput): boolean {
    const c = this.config;
    if (rec.rawPosture === 'POINT') return true;
    const k = rec.curls;
    const others = Math.min(k.middle, k.ring, k.pinky);
    return k.index <= c.transitionIndexMaxCurl && others - k.index >= c.transitionSpread;
  }

  /** Did the index and the other three fingers move together since the anchor? */
  private fingersAgree(rec: RecognizerOutput): boolean {
    const a = this.zoomAnchorCurls;
    if (!a) return true;
    const k = rec.curls;
    const dIndex = k.index - a.index;
    const dOthers = (k.middle + k.ring + k.pinky - a.middle - a.ring - a.pinky) / 3;
    if (Math.sign(dIndex) !== Math.sign(dOthers)) return false;
    const lo = Math.min(Math.abs(dIndex), Math.abs(dOthers));
    const hi = Math.max(Math.abs(dIndex), Math.abs(dOthers));
    return hi === 0 || lo >= this.config.zoomFingerAgreement * hi;
  }

  /** Is the palm turned toward the camera about as when ROTATE began? */
  private facingAsAtRotate(basis: Mat3 | null, flip: number): boolean {
    const limit = this.config.facingMaxDeg;
    if (basis && this.normalAtRotate) {
      const n = this.normalAtRotate;
      const dot = basis[2] * n[0] + basis[5] * n[1] + basis[8] * n[2];
      return dot >= Math.cos((limit * Math.PI) / 180);
    }
    return Math.abs(flip - this.flipAtRotate) <= limit;
  }

  private anchor(wx: number, wy: number, roll: number, flip: number, basis: Mat3 | null) {
    this.wristAnchor = { x: wx, y: wy };
    this.rollAnchor = roll;
    this.flipAnchor = flip;
    this.basisAnchor = basis;
    this.anchored = true;
  }

  /** 0° = palm facing the camera, 90° = edge-on, 180° = back of hand. */
  private flipDeg(widthRatio: number): number {
    const cos = Math.max(-1, Math.min(1, (this.handSign * widthRatio) / this.palmRatioMax));
    // Linear in cos (not acos) so small noise near palm-facing isn't amplified.
    return 90 * (1 - cos);
  }

  private resetTracking() {
    this.fWx.reset();
    this.fWy.reset();
    this.fRoll.reset();
    this.fFlip.reset();
    this.fOpen.reset();
    this.rollRawPrev = null;
    this.rollUnwrapped = 0;
    this.lastPoint = null;
    this.zoomAnchor = null;
    this.zoomAnchorCurls = null;
    this.zoomDir = 0;
    this.transition = false;
    this.anchored = false;
  }
}
