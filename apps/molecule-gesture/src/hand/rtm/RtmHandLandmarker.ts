import type { HandFrame } from '../../gestures/types';
import type { HandLandmarker, LandmarkerInfo, LoadProgress } from '../types';
import type { InferenceBackend, WorkerRequest, WorkerResponse } from './protocol';

export interface RtmHandLandmarkerOptions {
  detModelUrl?: string;
  poseModelUrl?: string;
  poseInt8ModelUrl?: string;
  ortBase?: string;
  backend?: InferenceBackend;
}

const base = import.meta.env.BASE_URL;

/**
 * OpenMMLab RTMDet-nano (hand) + RTMPose-m (hand5, 21 keypoints) via
 * ONNX Runtime Web, running inside a dedicated worker.
 */
export class RtmHandLandmarker implements HandLandmarker {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (f: HandFrame) => void; reject: (e: Error) => void }>();
  private readonly opts: Required<RtmHandLandmarkerOptions>;
  private initPromise: Promise<LandmarkerInfo> | null = null;

  constructor(opts: RtmHandLandmarkerOptions = {}) {
    this.opts = {
      detModelUrl: opts.detModelUrl ?? new URL(`${base}models/rtmdet-nano-hand.onnx`, location.href).href,
      poseModelUrl: opts.poseModelUrl ?? new URL(`${base}models/rtmpose-m-hand.onnx`, location.href).href,
      poseInt8ModelUrl: opts.poseInt8ModelUrl ?? new URL(`${base}models/rtmpose-m-hand-int8.onnx`, location.href).href,
      ortBase: opts.ortBase ?? new URL(`${base}ort/`, location.href).href,
      backend: opts.backend ?? 'auto',
    };
  }

  init(onProgress?: (p: LoadProgress) => void): Promise<LandmarkerInfo> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise<LandmarkerInfo>((resolve, reject) => {
      const worker = new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const progress = new Map<string, LoadProgress>();
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress': {
            progress.set(msg.label, msg);
            let loaded = 0;
            let total = 0;
            for (const p of progress.values()) {
              loaded += p.loadedBytes;
              total += p.totalBytes;
            }
            onProgress?.({ loadedBytes: loaded, totalBytes: total, label: 'Downloading RTMPose models' });
            break;
          }
          case 'ready':
            resolve({ model: 'RTMDet-nano + RTMPose-m (hand5)', backend: msg.backend });
            break;
          case 'result':
            this.pending.get(msg.id)?.resolve(msg.frame);
            this.pending.delete(msg.id);
            break;
          case 'error':
            if (msg.id !== undefined) {
              this.pending.get(msg.id)?.reject(new Error(msg.message));
              this.pending.delete(msg.id);
            } else {
              reject(new Error(msg.message));
            }
            break;
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Hand tracking worker failed to start'));
      const init: WorkerRequest = { type: 'init', ...this.opts };
      worker.postMessage(init);
    });
    this.initPromise.catch(() => {
      this.initPromise = null;
      this.close();
    });
    return this.initPromise;
  }

  estimate(frame: ImageBitmap, timestamp: number): Promise<HandFrame> {
    const worker = this.worker;
    if (!worker) {
      frame.close();
      return Promise.reject(new Error('RtmHandLandmarker not initialised'));
    }
    const id = this.nextId++;
    return new Promise<HandFrame>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: WorkerRequest = { type: 'frame', id, timestamp, bitmap: frame };
      worker.postMessage(msg, [frame]);
    });
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    for (const p of this.pending.values()) p.reject(new Error('Landmarker closed'));
    this.pending.clear();
  }
}
