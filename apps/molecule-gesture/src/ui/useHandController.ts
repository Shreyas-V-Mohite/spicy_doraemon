import { useEffect, useState } from 'react';
import { HandGestureController, type TrackingSnapshot } from '../gestures/HandGestureController';
import { RtmHandLandmarker } from '../hand/rtm/RtmHandLandmarker';
import { MediaPipeHandLandmarker } from '../hand/mediapipe/MediaPipeHandLandmarker';
import type { HandLandmarker } from '../hand/types';

/** Creates (and disposes) the hand-tracking controller for this page. */
export function useHandController(enabled: boolean): HandGestureController | null {
  const [controller, setController] = useState<HandGestureController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    // Default: MediaPipe (fast GPU tracking + 3D landmarks); `?backend=cpu` forces its CPU path.
    // `?tracker=rtmpose` switches to OpenMMLab RTMPose (`&backend=webgpu` for its GPU path).
    const params = new URLSearchParams(location.search);
    const landmarker: HandLandmarker =
      params.get('tracker') === 'rtmpose'
        ? new RtmHandLandmarker({ backend: params.get('backend') === 'webgpu' ? 'webgpu' : 'auto' })
        : new MediaPipeHandLandmarker({ delegate: params.get('backend') === 'cpu' ? 'CPU' : 'GPU' });
    const c = new HandGestureController({ landmarker });
    setController(c);
    return () => {
      c.dispose();
      setController(null);
    };
  }, [enabled]);
  return controller;
}

/** Subscribe to a derived value of the tracking snapshot; re-renders only when it changes. */
export function useTrackingValue<T>(
  controller: HandGestureController | null,
  select: (s: TrackingSnapshot) => T,
  fallback: T,
): T {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    if (!controller) {
      setValue(fallback);
      return;
    }
    return controller.subscribeSnapshots((s) => {
      const next = select(s);
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    });
    // `select`/`fallback` are expected to be stable inline lambdas/literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  return value;
}
