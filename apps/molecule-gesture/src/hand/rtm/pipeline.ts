import type { HandObservation } from '../../gestures/types';
import {
  bboxFromKeypoints,
  decodeDetections,
  decodeSimcc,
  preprocessDetector,
  preprocessPose,
  type BBox,
  type RgbaImage,
} from './preprocess';

/**
 * Minimal structural view of an ONNX Runtime session/tensor, satisfied by
 * both onnxruntime-web and onnxruntime-node, so this pipeline can be tested
 * in Node against the exact same pre/post-processing the browser uses.
 */
export interface TensorLike {
  readonly data: unknown;
  readonly dims: readonly number[];
}

export interface SessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, never>): Promise<Record<string, TensorLike>>;
}

export type TensorFactory = (data: Float32Array, dims: readonly number[]) => unknown;

export interface RtmHandPipelineOptions {
  detInputSize: number;
  poseInputW: number;
  poseInputH: number;
  /** Minimum detector score to accept a hand box. */
  minDetScore: number;
  /** Below this mean keypoint score the track is considered lost. */
  minTrackScore: number;
  /** Force a fresh detection every N frames even while tracking. 0 = never. */
  redetectInterval: number;
}

export const DEFAULT_PIPELINE_OPTIONS: RtmHandPipelineOptions = {
  detInputSize: 320,
  poseInputW: 256,
  poseInputH: 256,
  // rtmlib's reference threshold is 0.3; the pose-score gate below rejects
  // most non-hand boxes, so a slightly stricter 0.4 is safe for webcams.
  minDetScore: 0.4,
  minTrackScore: 0.35,
  redetectInterval: 0,
};

export interface PipelineResult {
  hand: HandObservation | null;
  detMs: number;
  poseMs: number;
  totalMs: number;
}

/**
 * Two-stage top-down hand pipeline:
 *   1. RTMDet-nano finds a hand box (only when not already tracking).
 *   2. RTMPose-m regresses 21 keypoints inside the box (SimCC heads).
 * While the hand stays confident the next box is derived from the current
 * keypoints, which skips the detector on most frames.
 */
export class RtmHandPipeline {
  private trackBox: BBox | null = null;
  private trackScore = 0;
  private framesSinceDet = 0;
  readonly options: RtmHandPipelineOptions;

  constructor(
    private readonly detSession: SessionLike,
    private poseSession: SessionLike,
    private readonly makeTensor: TensorFactory,
    options: Partial<RtmHandPipelineOptions> = {},
  ) {
    this.options = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  }

  /** Swap the landmark model (e.g. CPU INT8 ↔ GPU FP32); tracking state is kept. */
  setPoseSession(session: SessionLike): void {
    this.poseSession = session;
  }

  resetTracking(): void {
    this.trackBox = null;
    this.framesSinceDet = 0;
  }

  async detect(img: RgbaImage): Promise<{ box: BBox; score: number } | null> {
    const { detInputSize, minDetScore } = this.options;
    const prep = preprocessDetector(img, detInputSize);
    const feeds = {
      [this.detSession.inputNames[0]]: this.makeTensor(prep.tensor, [1, 3, detInputSize, detInputSize]),
    } as Record<string, never>;
    const out = await this.detSession.run(feeds);
    const dets = out[this.detSession.outputNames[0]];
    const data = dets.data as Float32Array;
    const n = dets.dims.length === 3 ? dets.dims[1] : Math.floor(data.length / 5);
    const found = decodeDetections(data, n, prep.ratio, img.width, img.height, minDetScore);
    if (found.length === 0) return null;
    const best = found[0];
    return { box: best, score: best.score };
  }

  async estimate(img: RgbaImage, box: BBox) {
    const { poseInputW, poseInputH } = this.options;
    const crop = preprocessPose(img, box, poseInputW, poseInputH);
    const feeds = {
      [this.poseSession.inputNames[0]]: this.makeTensor(crop.tensor, [1, 3, poseInputH, poseInputW]),
    } as Record<string, never>;
    const out = await this.poseSession.run(feeds);
    const sx = out[this.poseSession.outputNames[0]];
    const sy = out[this.poseSession.outputNames[1]];
    const numKp = sx.dims[1];
    const keypoints = decodeSimcc(
      sx.data as Float32Array,
      sy.data as Float32Array,
      numKp,
      sx.dims[2],
      sy.dims[2],
      crop,
    );
    const poseScore = keypoints.reduce((s, k) => s + k.score, 0) / keypoints.length;
    return { keypoints, poseScore };
  }

  async process(img: RgbaImage): Promise<PipelineResult> {
    const t0 = now();
    let detMs = 0;
    let poseMs = 0;
    const { minTrackScore, redetectInterval } = this.options;

    let box = this.trackBox;
    let detScore = this.trackScore;
    let fromDetector = false;
    const needsDetect =
      !box || (redetectInterval > 0 && this.framesSinceDet >= redetectInterval);

    if (needsDetect) {
      const td = now();
      const det = await this.detect(img);
      detMs += now() - td;
      this.framesSinceDet = 0;
      if (!det) {
        this.trackBox = null;
        return { hand: null, detMs, poseMs, totalMs: now() - t0 };
      }
      box = det.box;
      detScore = det.score;
      fromDetector = true;
    }

    let tp = now();
    let pose = await this.estimate(img, box!);
    poseMs += now() - tp;

    // A tracked box can drift off the hand; retry once with the detector.
    if (pose.poseScore < minTrackScore && !fromDetector) {
      const td = now();
      const det = await this.detect(img);
      detMs += now() - td;
      this.framesSinceDet = 0;
      if (!det) {
        this.trackBox = null;
        return { hand: null, detMs, poseMs, totalMs: now() - t0 };
      }
      box = det.box;
      detScore = det.score;
      fromDetector = true;
      tp = now();
      pose = await this.estimate(img, box);
      poseMs += now() - tp;
    }

    this.framesSinceDet++;
    if (pose.poseScore < minTrackScore) {
      this.trackBox = null;
      return { hand: null, detMs, poseMs, totalMs: now() - t0 };
    }

    this.trackBox = bboxFromKeypoints(pose.keypoints, 0.3, 1.15, img.width, img.height);
    this.trackScore = detScore;

    return {
      hand: {
        keypoints: pose.keypoints,
        bbox: { ...box! },
        detScore,
        poseScore: pose.poseScore,
        fromDetector,
      },
      detMs,
      poseMs,
      totalMs: now() - t0,
    };
  }
}

function now(): number {
  return performance.now();
}
