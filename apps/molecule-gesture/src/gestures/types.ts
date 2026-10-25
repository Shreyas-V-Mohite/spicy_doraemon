/**
 * Public gesture contract. Anything that can drive the molecule viewer —
 * hand tracking, mouse buttons, keyboard, or a teammate's future input
 * source — implements GestureController and emits GestureCommands.
 *
 * Units:
 *  - ROTATE.dx: degrees around the screen's vertical axis
 *    (positive = the front of the molecule moves to the viewer's right).
 *  - ROTATE.dy: degrees around the screen's horizontal axis
 *    (positive = the front of the molecule moves down).
 *  - ROTATE.dz: degrees around the viewing axis (positive = clockwise as
 *    the viewer sees it). Optional; omitted means 0.
 *  - ZOOM.factor: relative and multiplicative; > 1 zooms in, < 1 zooms out.
 *  - SCALE.scale: absolute size relative to the molecule's fitted "home"
 *    size (1 = home, 2 = twice as large). Used by the open/closed-hand zoom.
 *  - PAN.dx / PAN.dy: move the molecule on screen, both in fractions of the
 *    viewer's WIDTH (positive = right / down as the viewer sees it).
 *  - PLACE: a pointer (the index fingertip) in camera-frame coordinates,
 *    0–1, as displayed (mirrored). The viewer maps it through the webcam
 *    backdrop's object-fit: cover; if the pointer is on the molecule, the
 *    molecule is grabbed and follows it until a STOP.
 *  - VISIBILITY: show or hide the molecule.
 */
export type GestureCommand =
  | { type: 'ROTATE'; dx: number; dy: number; dz?: number }
  | { type: 'ZOOM'; factor: number }
  | { type: 'SCALE'; scale: number }
  | { type: 'PAN'; dx: number; dy: number }
  | { type: 'PLACE'; x: number; y: number; frameAspect: number }
  | { type: 'VISIBILITY'; visible: boolean }
  | { type: 'STOP' }
  | { type: 'RESET' };

/**
 * Where a command came from. Hand tracking follows up to two hands at once;
 * each has a stable `hand` slot (0 or 1) while it stays in view, so two
 * hands can work on two molecules. Absent for single-source inputs (keys).
 */
export interface CommandSource {
  hand: number;
}

export type GestureCommandListener = (command: GestureCommand, source?: CommandSource) => void;

export interface GestureController {
  start(): Promise<void>;
  stop(): void;
  subscribe(callback: GestureCommandListener): () => void;
}

/** Small reusable fan-out helper for GestureController implementations. */
export class CommandEmitter {
  private listeners = new Set<GestureCommandListener>();

  subscribe(callback: GestureCommandListener): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  emit(command: GestureCommand, source?: CommandSource): void {
    for (const listener of this.listeners) listener(command, source);
  }
}

/** Number of keypoints in the RTMPose hand (COCO-WholeBody hand) layout. */
export const HAND_KEYPOINT_COUNT = 21;

/**
 * 21-keypoint hand layout used by RTMPose hand5:
 * 0 wrist; 1–4 thumb (CMC, MCP, IP, tip); 5–8 index (MCP, PIP, DIP, tip);
 * 9–12 middle; 13–16 ring; 17–20 pinky.
 */
export const HandKp = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const HAND_SKELETON: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export interface Keypoint {
  /** Pixel coordinates in the source video frame. */
  x: number;
  y: number;
  /** SimCC confidence (roughly 0–1, not a calibrated probability). */
  score: number;
}

/** One frame of hand-landmark output from a landmark model. */
export interface HandObservation {
  keypoints: Keypoint[];
  /** Bounding box used for the pose crop, in source-frame pixels. */
  bbox: { x1: number; y1: number; x2: number; y2: number };
  /** Detector score if the detector ran this frame, else the tracked score. */
  detScore: number;
  /** Mean keypoint score. */
  poseScore: number;
  /** True when the box came from the detector rather than from tracking. */
  fromDetector: boolean;
  /**
   * Optional metric 3D keypoints (same 21-point order), camera-aligned axes:
   * x right and y down in the RAW (unmirrored) image, z away from the camera.
   * MediaPipe provides these; when present, finger curl and hand rotation are
   * measured in 3D (no foreshortening, no left/right ambiguity).
   */
  world?: Point3[];
  /** As the model labels it (MediaPipe); only used to tell a person's two hands apart. */
  handedness?: 'Left' | 'Right';
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface HandFrame {
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
  /** The primary hand (the one the status UI describes). */
  hand: HandObservation | null;
  /**
   * Multi-hand landmarkers: every hand in view. After HandSelector, only the
   * teacher's (up to two) hands, each tagged with its slot; the rest are in `ignored`.
   */
  hands?: HandObservation[];
  ignored?: HandObservation[];
  timings?: { detMs: number; poseMs: number; totalMs: number };
  /** Inference backend that produced this frame (it may change once, after auto-selection). */
  backend?: string;
}
