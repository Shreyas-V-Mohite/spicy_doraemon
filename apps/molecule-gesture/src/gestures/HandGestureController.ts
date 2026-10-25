import { GestureMotionMapper, type MapperConfig, type MapperStatus } from './GestureMotionMapper';
import { GestureRecognizer, type RecognizerConfig, type RecognizerOutput } from './GestureRecognizer';
import { KeypointSmoother } from './KeypointSmoother';
import { HAND_SLOTS, HandSelector } from './HandSelector';
import { CommandEmitter, type GestureController, type GestureCommand, type GestureCommandListener, type HandFrame, type HandObservation } from './types';
import type { HandLandmarker, LandmarkerInfo, LoadProgress } from '../hand/types';
import { WebcamSource } from '../hand/WebcamSource';

export type TrackingPhase = 'idle' | 'loading-models' | 'requesting-camera' | 'running' | 'error';

export interface TrackingSnapshot {
  phase: TrackingPhase;
  error?: string;
  info?: LandmarkerInfo;
  progress?: LoadProgress;
  /** Inference frames per second (smoothed). */
  fps: number;
  /** Worker-side inference time for the last frame. */
  inferenceMs: number;
  /** All of the teacher's hands (smoothed) plus the ignored ones. */
  frame: HandFrame | null;
  /** The primary hand's reading (for the one-line status). */
  recognizer: RecognizerOutput | null;
  mapper: MapperStatus;
  /** Every hand slot in view: primary first. */
  hands: HandTrackState[];
  commandsEnabled: boolean;
}

export interface HandTrackState {
  slot: number;
  hand: HandObservation;
  recognizer: RecognizerOutput;
  mapper: MapperStatus;
}

/** One hand's own gesture pipeline (each hand has its own mode). */
interface HandTrack {
  smoother: KeypointSmoother;
  recognizer: GestureRecognizer;
  mapper: GestureMotionMapper;
}

export type SnapshotListener = (s: TrackingSnapshot) => void;

export interface HandGestureControllerOptions {
  landmarker: HandLandmarker;
  webcam?: WebcamSource;
  recognizer?: Partial<RecognizerConfig>;
  mapper?: Partial<MapperConfig>;
}

/**
 * Webcam → HandLandmarker → HandSelector (the teacher's ≤2 hands) → per hand:
 * KeypointSmoother → GestureRecognizer → GestureMotionMapper → GestureCommand
 * (tagged with the hand's slot). Swap the landmarker to change
 * models; swap the whole controller to change input modality.
 */
export class HandGestureController implements GestureController {
  readonly webcam: WebcamSource;
  private readonly landmarker: HandLandmarker;
  private readonly tracks: HandTrack[];
  private readonly selector = new HandSelector();
  private readonly commands = new CommandEmitter();
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private running = false;
  private loopToken = 0;
  private snapshot: TrackingSnapshot;

  constructor(opts: HandGestureControllerOptions) {
    this.landmarker = opts.landmarker;
    this.webcam = opts.webcam ?? new WebcamSource();
    this.tracks = Array.from({ length: HAND_SLOTS }, () => ({
      smoother: new KeypointSmoother(),
      recognizer: new GestureRecognizer(opts.recognizer),
      mapper: new GestureMotionMapper(opts.mapper),
    }));
    this.snapshot = {
      phase: 'idle',
      fps: 0,
      inferenceMs: 0,
      frame: null,
      recognizer: null,
      mapper: this.tracks[0].mapper.status('NONE'),
      hands: [],
      commandsEnabled: true,
    };
  }

  subscribe(callback: GestureCommandListener): () => void {
    return this.commands.subscribe(callback);
  }

  /** Per-frame tracking state for overlays and status UI. */
  subscribeSnapshots(callback: SnapshotListener): () => void {
    this.snapshotListeners.add(callback);
    callback(this.snapshot);
    return () => {
      this.snapshotListeners.delete(callback);
    };
  }

  getSnapshot(): TrackingSnapshot {
    return this.snapshot;
  }

  /** Keep tracking (and showing landmarks) but stop emitting commands. */
  setCommandsEnabled(enabled: boolean): void {
    if (!enabled) this.releaseAll();
    this.update({ commandsEnabled: enabled });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const token = ++this.loopToken;
    try {
      this.update({ phase: 'loading-models', error: undefined });
      const info = await this.landmarker.init((progress) => this.update({ progress }));
      if (token !== this.loopToken) return;
      this.update({ phase: 'requesting-camera', info, progress: undefined });
      await this.webcam.start();
      if (token !== this.loopToken) return;
      const now = performance.now();
      this.tracks.forEach((tr) => tr.mapper.reset(now));
      this.update({ phase: 'running', mapper: this.tracks[0].mapper.status('NONE') });
      void this.loop(token);
    } catch (err) {
      this.running = false;
      const message = describeError(err);
      this.update({ phase: 'error', error: message });
      throw err;
    }
  }

  stop(): void {
    this.running = false;
    this.loopToken++;
    this.webcam.stop();
    this.releaseAll();
    this.tracks.forEach((tr) => {
      tr.recognizer.reset();
      tr.smoother.reset();
    });
    this.selector.reset();
    this.commands.emit({ type: 'STOP' });
    this.update({ phase: 'idle', frame: null, recognizer: null, hands: [], fps: 0, mapper: this.tracks[0].mapper.status('NONE') });
  }

  /** Release the model worker. Call when the controller is discarded. */
  dispose(): void {
    this.stop();
    this.landmarker.close();
  }

  private async loop(token: number) {
    let fps = 0;
    let lastT = performance.now();
    while (this.running && token === this.loopToken) {
      if (this.webcam.video.readyState < 2) {
        await nextFrame();
        continue;
      }
      let raw: HandFrame;
      try {
        const bitmap = await this.webcam.grab();
        raw = await this.landmarker.estimate(bitmap, performance.now());
      } catch (err) {
        if (token !== this.loopToken) return;
        this.update({ phase: 'error', error: describeError(err) });
        this.running = false;
        return;
      }
      if (token !== this.loopToken) return;

      const { frame, hands } = this.process(raw);

      const t = performance.now();
      const inst = 1000 / Math.max(1, t - lastT);
      lastT = t;
      fps = fps === 0 ? inst : fps * 0.9 + inst * 0.1;
      const info =
        frame.backend && this.snapshot.info && frame.backend !== this.snapshot.info.backend
          ? { ...this.snapshot.info, backend: frame.backend }
          : this.snapshot.info;
      this.update({
        info,
        frame,
        recognizer: hands[0]?.recognizer ?? null,
        mapper: hands[0]?.mapper ?? this.tracks[0].mapper.status('NONE'),
        hands,
        fps,
        inferenceMs: frame.timings?.totalMs ?? 0,
      });
      // Inference runs in the worker, so start the next frame right away;
      // just yield one macrotask (waiting for a paint here cost ~10–16 ms/frame).
      await yieldTask();
    }
  }

  /**
   * Pick the teacher's hands, then run each through its own slot's pipeline.
   * Slots without a hand still update (so their mode winds down to HOLD).
   */
  private process(raw: HandFrame): { frame: HandFrame; hands: HandTrackState[] } {
    const all = raw.hands ?? (raw.hand ? [raw.hand] : []);
    const { chosen, ignored } = this.selector.select(all, raw.timestamp);
    const hands: HandTrackState[] = [];
    for (let slot = 0; slot < this.tracks.length; slot++) {
      const tr = this.tracks[slot];
      const pick = chosen.find((ch) => ch.slot === slot);
      if (pick?.fresh) {
        // A different hand took this slot: start its gestures from scratch.
        this.emitAll(tr.mapper.release(), slot);
        tr.smoother.reset();
        tr.recognizer.reset();
      }
      const f = tr.smoother.apply({ ...raw, hand: pick?.hand ?? null, hands: undefined });
      const rec = tr.recognizer.update(f);
      if (this.snapshot.commandsEnabled) this.emitAll(tr.mapper.update(f, rec), slot);
      if (f.hand) hands.push({ slot, hand: f.hand, recognizer: rec, mapper: tr.mapper.status(rec.posture) });
    }
    // Primary (the biggest hand) first.
    const order = chosen.map((ch) => ch.slot);
    hands.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    return { frame: { ...raw, hand: hands[0]?.hand ?? null, hands: hands.map((h) => h.hand), ignored }, hands };
  }

  private emitAll(cmds: GestureCommand[], slot: number) {
    for (const cmd of cmds) this.commands.emit(cmd, { hand: slot });
  }

  private releaseAll() {
    this.tracks.forEach((tr, slot) => this.emitAll(tr.mapper.release(), slot));
  }

  private update(patch: Partial<TrackingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.snapshotListeners) l(this.snapshot);
  }
}

const yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const yieldQueue: (() => void)[] = [];
if (yieldChannel) yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();

/** Resolve on the next macrotask (no 4 ms setTimeout clamp, no paint wait). */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    if (!yieldChannel) return void setTimeout(resolve, 0);
    yieldQueue.push(resolve);
    yieldChannel.port2.postMessage(0);
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in the address bar and try again.';
    if (err.name === 'NotFoundError') return 'No webcam was found.';
    if (err.name === 'NotReadableError') return 'The webcam is in use by another application.';
  }
  return err instanceof Error ? err.message : String(err);
}
