// Hand-gesture input for the molecule stage: webcam, hand tracking (MediaPipe),
// gesture recognition, and the motion that applies commands to a 3Dmol viewer.
// It owns no renderer and no UI; the host app supplies both.
export { HandGestureController } from './gestures/HandGestureController';
export type {
  HandGestureControllerOptions,
  HandTrackState,
  SnapshotListener,
  TrackingPhase,
  TrackingSnapshot,
} from './gestures/HandGestureController';
export { ManualGestureController, keyToCommand } from './gestures/ManualGestureController';
export { CommandEmitter, HAND_KEYPOINT_COUNT, HAND_SKELETON } from './gestures/types';
export type {
  CommandSource,
  GestureCommand,
  GestureCommandListener,
  GestureController,
  HandFrame,
  HandObservation,
  Keypoint,
} from './gestures/types';
export { MediaPipeHandLandmarker } from './hand/mediapipe/MediaPipeHandLandmarker';
export type { HandLandmarker } from './hand/types';
export { WebcamSource } from './hand/WebcamSource';
export { ViewMotion, coverPointToPlacement } from './motion/ViewMotion';
export type { MotionBox, MotionOptions, MotionStyle, MotionViewer } from './motion/ViewMotion';
