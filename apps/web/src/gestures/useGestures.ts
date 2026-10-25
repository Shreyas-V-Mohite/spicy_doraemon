import { useEffect, useState } from "react";
import {
  HandGestureController,
  MediaPipeHandLandmarker,
  type TrackingPhase,
} from "@spicy/hand-gesture";

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
