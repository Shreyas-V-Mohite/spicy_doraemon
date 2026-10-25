import type { HandFrame } from '../gestures/types';

export interface LandmarkerInfo {
  /** Human-readable model name, e.g. "RTMDet-nano + RTMPose-m (hand5)". */
  model: string;
  /** Execution backend actually in use, e.g. "webgpu" or "wasm". */
  backend: string;
}

export interface LoadProgress {
  loadedBytes: number;
  totalBytes: number;
  label: string;
}

/**
 * Any hand-landmark model producing the 21-keypoint layout. The gesture
 * layer depends only on this interface, never on a specific model.
 */
export interface HandLandmarker {
  init(onProgress?: (p: LoadProgress) => void): Promise<LandmarkerInfo>;
  /** Takes ownership of `frame` (it may be transferred to a worker). */
  estimate(frame: ImageBitmap, timestamp: number): Promise<HandFrame>;
  close(): void;
}
