/// <reference lib="webworker" />
/**
 * Runs RTMDet-nano + RTMPose-m hand inference off the main thread so the
 * 3D viewer keeps rendering at full frame rate.
 */
import * as ort from 'onnxruntime-web';
import { RtmHandPipeline, type SessionLike } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let pipeline: RtmHandPipeline | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function fetchModel(url: string, label: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}. Run "npm run models".`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: 'progress', label, loadedBytes: loaded, totalBytes: total });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function createSession(model: Uint8Array, providers: string[]) {
  return ort.InferenceSession.create(model, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
  });
}

/** Run a session a couple of times so its first real frame isn't a warm-up spike. */
async function warmUp(session: ort.InferenceSession, size: number): Promise<void> {
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(3 * size * size).fill(0.1), [1, 3, size, size]) };
  for (let i = 0; i < 2; i++) await session.run(feeds);
}

let backendLabel = '';

async function init(msg: Extract<WorkerRequest, { type: 'init' }>) {
  ort.env.wasm.wasmPaths = msg.ortBase;
  // Measured: the pose model stops getting faster beyond 4 WASM threads.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  const threads = `×${ort.env.wasm.numThreads}`;

  // Default is CPU INT8: measured faster than WebGPU in the app on laptop
  // iGPUs (which are also busy drawing the page), and it runs everywhere.
  // Alternating CPU and WebGPU sessions in one ORT runtime broke WebGPU
  // kernels, so the backend is fixed at start-up. ?backend=webgpu opts in.
  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  const wantGpu = msg.backend === 'webgpu' && !!gpu;
  const wantCpu = !wantGpu;

  // INT8 is ~1.5–3× faster on CPU; FP32 is needed for WebGPU (no INT8 kernels there).
  const [detBytes, int8Bytes, fp32Bytes] = await Promise.all([
    fetchModel(msg.detModelUrl, 'hand detector'),
    wantCpu ? fetchModel(msg.poseInt8ModelUrl, 'hand landmarks (int8)').catch(() => null) : Promise.resolve(null),
    wantGpu || !msg.poseInt8ModelUrl ? fetchModel(msg.poseModelUrl, 'hand landmarks') : Promise.resolve(null),
  ]);

  // The tiny detector is consistently faster on WASM (GPU dispatch overhead dominates).
  const det = await createSession(detBytes, ['wasm']);

  let pose: ort.InferenceSession;
  if (wantGpu && fp32Bytes) {
    pose = await createSession(fp32Bytes, ['webgpu', 'wasm']);
    backendLabel = 'rtmpose webgpu fp32';
  } else {
    const bytes = int8Bytes ?? fp32Bytes ?? (await fetchModel(msg.poseModelUrl, 'hand landmarks'));
    pose = await createSession(bytes, ['wasm']);
    backendLabel = `rtmpose cpu ${int8Bytes ? 'int8' : 'fp32'} ${threads}`;
  }
  await warmUp(pose, 256);

  pipeline = new RtmHandPipeline(
    det as unknown as SessionLike,
    pose as unknown as SessionLike,
    (data, dims) => new ort.Tensor('float32', data, dims),
  );
  post({ type: 'ready', backend: backendLabel });
}

async function onFrame(msg: Extract<WorkerRequest, { type: 'frame' }>) {
  const bmp = msg.bitmap;
  try {
    if (!pipeline) throw new Error('Worker not initialised');
    const { width, height } = bmp;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    ctx!.drawImage(bmp, 0, 0);
    const image = ctx!.getImageData(0, 0, width, height);
    const res = await pipeline.process({ data: image.data, width, height });
    post({
      type: 'result',
      id: msg.id,
      frame: {
        timestamp: msg.timestamp,
        frameWidth: width,
        frameHeight: height,
        hand: res.hand,
        timings: { detMs: res.detMs, poseMs: res.poseMs, totalMs: res.totalMs },
        backend: backendLabel,
      },
    });
  } finally {
    bmp.close();
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  const run = msg.type === 'init' ? init(msg) : msg.type === 'frame' ? onFrame(msg) : Promise.resolve();
  run.catch((err: unknown) => {
    post({
      type: 'error',
      id: msg.type === 'frame' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  });
};
