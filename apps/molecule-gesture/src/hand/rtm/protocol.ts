import type { HandFrame } from '../../gestures/types';

/** 'auto' benchmarks WebGPU against WASM at start-up and keeps the faster one. */
export type InferenceBackend = 'auto' | 'webgpu' | 'wasm';

export type WorkerRequest =
  | {
      type: 'init';
      detModelUrl: string;
      poseModelUrl: string;
      /** INT8 pose model for CPU inference; falls back to poseModelUrl if missing. */
      poseInt8ModelUrl: string;
      ortBase: string;
      backend: InferenceBackend;
    }
  | { type: 'frame'; id: number; timestamp: number; bitmap: ImageBitmap };

export type WorkerResponse =
  | { type: 'progress'; label: string; loadedBytes: number; totalBytes: number }
  | { type: 'ready'; backend: string }
  | { type: 'result'; id: number; frame: HandFrame }
  | { type: 'error'; id?: number; message: string };
