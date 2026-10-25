import { FilesetResolver, HandLandmarker as MpHandLandmarker } from '@mediapipe/tasks-vision';
import type { HandFrame, HandObservation } from '../../gestures/types';
import type { HandLandmarker, LandmarkerInfo, LoadProgress } from '../types';

export interface MediaPipeHandLandmarkerOptions {
  /** Folder with the tasks-vision WASM files (copied by `npm run models`). */
  wasmBase?: string;
  modelUrl?: string;
  /** 'GPU' is much faster where WebGL2 works; falls back to 'CPU' automatically. */
  delegate?: 'GPU' | 'CPU';
}

const base = import.meta.env.BASE_URL;

const MAX_HANDS = 4;

/**
 * Google MediaPipe Hand Landmarker (palm detector + 21-keypoint landmark
 * model with built-in tracking). Same keypoint order as RTMPose hand, plus
 * metric 3D "world" landmarks, which the gesture layer uses for
 * orientation-independent finger curl and true 3D hand rotation.
 *
 * Runs on the main thread: with the GPU delegate a frame takes a few ms.
 */
export class MediaPipeHandLandmarker implements HandLandmarker {
  private landmarker: MpHandLandmarker | null = null;
  private lastTs = 0;
  private readonly opts: Required<MediaPipeHandLandmarkerOptions>;
  private canvas: HTMLCanvasElement | null = null;

  constructor(opts: MediaPipeHandLandmarkerOptions = {}) {
    this.opts = {
      wasmBase: opts.wasmBase ?? new URL(`${base}mediapipe/`, location.href).href,
      modelUrl: opts.modelUrl ?? new URL(`${base}models/hand_landmarker.task`, location.href).href,
      delegate: opts.delegate ?? 'GPU',
    };
  }

  async init(onProgress?: (p: LoadProgress) => void): Promise<LandmarkerInfo> {
    if (this.landmarker) return this.info();
    onProgress?.({ loadedBytes: 0, totalBytes: 1, label: 'Loading MediaPipe' });
    const fileset = await FilesetResolver.forVisionTasks(this.opts.wasmBase.replace(/\/$/, ''));
    const create = (delegate: 'GPU' | 'CPU') => {
      // The GPU delegate needs a WebGL2 canvas; give it its own.
      this.canvas = delegate === 'GPU' ? document.createElement('canvas') : null;
      return MpHandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.opts.modelUrl, delegate },
        canvas: this.canvas ?? undefined,
        runningMode: 'VIDEO',
        // Several, so the teacher's two hands are found even with students in view
        // (HandSelector then keeps only the teacher's).
        numHands: MAX_HANDS,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    };
    try {
      this.landmarker = await create(this.opts.delegate);
    } catch (err) {
      if (this.opts.delegate === 'CPU') throw err;
      this.opts.delegate = 'CPU';
      this.landmarker = await create('CPU');
    }
    onProgress?.({ loadedBytes: 1, totalBytes: 1, label: 'Loading MediaPipe' });
    return this.info();
  }

  private info(): LandmarkerInfo {
    return { model: 'MediaPipe Hand Landmarker', backend: `mediapipe ${this.opts.delegate.toLowerCase()}` };
  }

  async estimate(frame: ImageBitmap, timestamp: number): Promise<HandFrame> {
    const lm = this.landmarker;
    const width = frame.width;
    const height = frame.height;
    try {
      if (!lm) throw new Error('MediaPipeHandLandmarker not initialised');
      // VIDEO mode needs strictly increasing timestamps.
      const ts = Math.max(this.lastTs + 1, Math.round(timestamp));
      this.lastTs = ts;
      const t0 = performance.now();
      const res = lm.detectForVideo(frame, ts);
      const totalMs = performance.now() - t0;
      const hands: HandObservation[] = res.landmarks.map((points, i) => {
        // MediaPipe gives a hand-presence/handedness score, not per-point scores.
        const label = res.handedness[i]?.[0];
        const score = label?.score ?? 0.9;
        const keypoints = points.map((p) => ({ x: p.x * width, y: p.y * height, score }));
        const world = res.worldLandmarks[i]?.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const k of keypoints) {
          x1 = Math.min(x1, k.x);
          y1 = Math.min(y1, k.y);
          x2 = Math.max(x2, k.x);
          y2 = Math.max(y2, k.y);
        }
        const handedness = label?.categoryName === 'Left' || label?.categoryName === 'Right' ? label.categoryName : undefined;
        return { keypoints, world, handedness, bbox: { x1, y1, x2, y2 }, detScore: score, poseScore: score, fromDetector: false };
      });
      return {
        timestamp,
        frameWidth: width,
        frameHeight: height,
        hand: hands[0] ?? null,
        hands,
        timings: { detMs: 0, poseMs: totalMs, totalMs },
        backend: this.info().backend,
      };
    } finally {
      frame.close();
    }
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
