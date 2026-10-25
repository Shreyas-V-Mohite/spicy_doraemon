# @spicy/hand-gesture

Hand-gesture input for the molecule stage: a webcam, MediaPipe hand tracking, gesture recognition, and a small motion layer that applies the resulting commands to a 3Dmol viewer.

The hand tracking, gesture recognition and view math come from the team's Molecule Gesture Lab (`feature/molecule-gesture-lab`), written by a teammate. They are copied here unchanged apart from import paths. This package keeps only the parts the classroom app uses.

## What it is, and is not

| Included | Left out on purpose |
|---|---|
| `HandGestureController`: webcam to hand frames to gesture commands | The lab's own multi-molecule scene, molecule picker and trash |
| `MediaPipeHandLandmarker` (GPU, with a CPU option) | The RTMPose tracker and its 60 MB of ONNX models and WebAssembly |
| Gesture recognizer, motion mapper, snap detector, hand selector (teacher's two hands only), One-Euro smoothing | SpacetimeDB sync (students see the shared molecule through Convex instead) |
| `ManualGestureController` (keyboard to commands) | Voice and the Deepgram proxy (dropped from the product) |
| `ViewMotion`: applies commands to a 3Dmol viewer | The lab's own viewer; the app has one renderer and this drives it |

There is no React and no renderer in this package. The web app owns the one 3Dmol viewer (`apps/web/src/viewer/ThreeDmolAdapter.ts`) and passes it to `ViewMotion`, so the mouse and the hand move the same molecule and highlights are drawn in one place.

## How it fits

```
webcam -> MediaPipe -> HandGestureController -> GestureCommand -> ThreeDmolAdapter -> ViewMotion -> 3Dmol
                                                (ROTATE, ZOOM, SCALE, PAN, PLACE, RESET, STOP)
```

- **Open and close your hand** to resize. **Hold your fingers still for half a second, then turn your hand** to rotate. **Point with your index finger** to move the molecule. A hand leaving the camera freezes everything. The thresholds are in `DEFAULT_RECOGNIZER_CONFIG` and `DEFAULT_MAPPER_CONFIG`.
- `ViewMotion` keeps the molecule between "still readable" and "fits the screen" for any molecule and window size.
- `VISIBILITY` and `SNAP` commands belong to the lab's scene and are ignored.

## Setup

MediaPipe needs two things served from the web app's `public/` folder. They are generated, so they are git-ignored:

```
npm run models -w @spicy/hand-gesture
```

This downloads `hand_landmarker.task` (about 8 MB, from Google's public MediaPipe model bucket) to `apps/web/public/models/` and copies MediaPipe's WebAssembly runtime from `node_modules` to `apps/web/public/mediapipe/`. The camera needs `localhost` or HTTPS.

## Tests

```
npm test -w @spicy/hand-gesture
```

59 tests, no browser, camera or model needed:

- The lab's tests for postures, the zoom ratchet, resize vs rotate, snap, hand selection and the view math.
- `motion.test.ts`: rotate, zoom limits, size, pan, fingertip grab, reset and stop on a fake 3Dmol viewer.
- `pipeline.test.ts`: scripted hand poses through the real controller into `ViewMotion`.

These prove the logic and the wiring. They do not prove tracking quality with a real hand, real lighting or a real laptop camera; expect to tune the thresholds on the actual demo machine.
