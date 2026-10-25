import { useEffect, useState } from "react";
import {
  HandGestureController,
  MediaPipeHandLandmarker,
  type HandGestureControllerOptions,
  type TrackingPhase,
} from "@spicy/hand-gesture";

// Going from rotating back to resizing was too hard in class: the package
// wants a full open-to-fist squeeze in 0.8 s with the palm held as when the
// turn began. Accept a shorter squeeze over a longer window and a more tilted
// palm, and let a hand dropped out of view for a moment start fresh.
const MAPPER: HandGestureControllerOptions["mapper"] = {
  resumeZoomLow: 0.35,
  resumeZoomHigh: 0.65,
  resumeZoomWindowMs: 1300,
  facingMaxDeg: 75,
  minModeDwellMs: 300,
  rotateKeepAfterLostMs: 600,
};

export interface GestureState {
  // Present only while gestures are on; hand it to the stage.
  controller: HandGestureController | null;
  phase: TrackingPhase;
  error: string | undefined;
}

// Starts hand tracking (webcam + MediaPipe) while `enabled`, and shuts the
// camera and model down when it is turned off or the page is left.
export function useGestures(enabled: boolean): GestureState {
  const [controller, setController] = useState<HandGestureController | null>(null);
  const [phase, setPhase] = useState<TrackingPhase>("idle");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!enabled) return;
    const c = new HandGestureController({
      landmarker: new MediaPipeHandLandmarker({ delegate: "GPU" }),
      mapper: MAPPER,
    });
    setController(c);
    const off = c.subscribeSnapshots((s) => {
      setPhase(s.phase);
      setError(s.error);
    });
    // start() reports its own failures through the snapshot; don't also throw.
    c.start().catch(() => undefined);
    return () => {
      off();
      c.dispose();
      setController(null);
      setPhase("idle");
      setError(undefined);
    };
  }, [enabled]);

  return { controller, phase, error };
}
