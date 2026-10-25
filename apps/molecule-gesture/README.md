# Molecule Gesture Lab

A teacher rotates and zooms a 3D molecule with their bare hand in front of a laptop webcam; every student in the session sees the same molecule move in real time through **SpacetimeDB**.

- **Hand tracking:** **MediaPipe Hand Landmarker** (GPU, 21 keypoints + 3D world landmarks) by default. The team switched to it from the original non-Google requirement because it was faster and more accurate in testing. The OpenMMLab **RTMDet-nano + RTMPose-m** pipeline (ONNX Runtime Web, in a Web Worker) remains available with `?tracker=rtmpose`.
- **Viewer:** 3Dmol.js, with bundled 3D SDF conformers (benzene, ethanol, butane, glucose, aspirin, caffeine).
- **Sync:** SpacetimeDB 2.x TypeScript module + `spacetimedb/react` client. Rooms, roles, a teacher-authoritative camera, a follow/explore mode for students, and a teacher lock.

---

## Quick start

**Prerequisites:** Node 22+, Chrome or Edge, and the SpacetimeDB CLI.

```bash
# Windows (PowerShell):  iwr https://windows.spacetimedb.com -useb | iex
# macOS / Linux:         curl -sSf https://install.spacetimedb.com | sh
```

```bash
cd molecule-gesture
npm install
npm run models          # downloads the official RTMPose ONNX models (~60 MB) + copies ORT wasm into public/
cd spacetimedb && npm install && cd ..

# terminal 1: local SpacetimeDB
npm run stdb:start

# terminal 2
npm run stdb:publish    # builds + publishes the module to the LOCAL server as "molecule-gesture"
npm run dev             # http://localhost:5173

# optional, terminal 3: Deepgram speech recognition (otherwise the browser's own is used)
echo DEEPGRAM_API_KEY=your_key > .env.local
npm run voice:server    # speech proxy on :8787 (Vite forwards /api/stt to it)
```

> ⚠️ The CLI's *default* server is `maincloud`. All scripts here pass `--server local` explicitly.

The generated client bindings are committed in `src/module_bindings/`. Regenerate them after changing `spacetimedb/src/index.ts`:

```bash
npm run stdb:generate
```

To clear all rooms: `npm run stdb:reset`.

### No SpacetimeDB? Use Solo mode

On the lobby page, click **"Try it solo"** (or open `/?role=solo`). The viewer, webcam tracking, gestures and manual controls all work without a server.

---

## Live demo script (two windows)

1. Open `http://localhost:5173`, type a name, and click **Start class as teacher**. The top bar should show `SpacetimeDB · Live`.
2. Click **Open student window** (or **Copy student link** to open it on another machine). The student window shows `Follow Teacher`.
3. In the teacher window, click **📷 Enable webcam** in the bar at the bottom and allow camera and microphone access. Your camera feed fills the stage. All controls live in that one slim bar (🎤 status, hand mode, ⚙ settings, ? help), so the stage stays uncovered.
4. **Add molecules by voice** — the mic is always on: "show me caffeine", "add benzene and ethanol". Each one is **added** next to the others (up to 8); nothing is ever replaced. Students see them appear.
5. **Move & select:** point only your index finger at a molecule. It glides onto your fingertip, follows it, and becomes the selected one (glowing, highlighted name tag).
6. **Delete:** carry a molecule onto the **trash** (bottom left). It disappears the moment it gets there, with no need to let go, for every student too. This is the only way a molecule disappears.
7. **Resize** the selected molecule: open or close your fingers. While they move, it grows or shrinks (fist ↔ open ≈ ×4.3); a hand that appears or holds still never changes the size. **To keep growing**, open all the way, then close and open again: after a full open, closing back is ignored (a ratchet). Likewise, after a full close, reopening is ignored, so repeated closes keep shrinking. Rest your fingers for 0.7 s to change direction.
8. **Two hands:** both of your hands are tracked, and each works on its own molecule. For example, turn one molecule with the left hand while carrying another to the trash with the right. Two hands never drive the same molecule at once. If other people are in view, only the person with the **biggest hands** (the one closest to the camera, i.e. the teacher) is followed. Their hands are drawn in colour, ignored hands in faint grey.
9. **Rotate** the selected molecule: hold your fingers still at any bend (not fully open) for ½ s, then turn your hand. Showing the back of your hand keeps rotating.
10. Student: **Explore Independently**, click a molecule's name, and use the arrows; the teacher is unaffected. **↩ Return to Teacher View** glides back. The teacher can **Lock students to my view** (⚙).

Fallback controls (same command pipeline as the gestures): drag a molecule's name tag with the mouse (onto the trash to delete), the keys `← → ↑ ↓` / `Q E` / `+ −` / `R` act on the selected molecule, and ⚙ → *Arrow buttons* shows an on-screen pad. ⚙ also has *Add a molecule* and *Type a name*.

Tips: use good front lighting, keep the hand 40–80 cm from the camera, and keep the palm facing the camera. Hand tracking uses MediaPipe on the GPU by default; add `?backend=cpu` to force its CPU path, or `?tracker=rtmpose` for the OpenMMLab RTMPose pipeline (INT8 on CPU; `&backend=webgpu` for its GPU path).

---

## Architecture

```
 Teacher browser                                                     Student browser
┌──────────────────────────────────────────────────────────┐        ┌──────────────────────────────┐
│ WebcamSource ─ImageBitmap─▶ HandLandmarker                │        │                              │
│   (getUserMedia)            MediaPipe (default, 3D)       │        │  useTable(scene_molecule     │
│                             or RTMPose (worker, ORT Web)  │        │    WHERE room_id = R)        │
│                 │ HandFrame (up to 4 hands)               │        │        │ ~10 Hz rows          │
│                 ▼                                         │        │        ▼                     │
│ HandSelector: closest person's ≤2 hands, stable slots     │        │  one viewer per molecule:    │
│                 ▼ per hand:                               │        │                              │
│ KeypointSmoother → GestureRecognizer (posture by curl)    │        │                              │
│                 ▼                                         │        │  Follow: slerp/lerp to each  │
│ GestureMotionMapper (zoom / rotate / move, One-Euro)      │        │  row's view every frame      │
│                 ▼ GestureCommand  ◀── voice, keys, mouse   │        │  Explore: local commands     │
│ MoleculeScene: PLACE → molecule under that fingertip,     │        └──────────────▲───────────────┘
│   others → that hand's molecule; one 3Dmol viewer each   │                       │ subscription
│   views sampled at 10 Hz, only changed ones sent ─────────┼──▶ SpacetimeDB ───────┘
└──────────────────────────────────────────────────────────┘     room / scene_molecule / participant
```

Each concern lives in its own module, and none of them knows about the layers above it:

| Concern | Code |
|---|---|
| 1. Webcam acquisition | `src/hand/WebcamSource.ts` |
| 2. Landmark inference | `src/hand/rtm/` (`preprocess.ts`, `pipeline.ts`, `hand.worker.ts`, `RtmHandLandmarker.ts`), behind the `HandLandmarker` interface in `src/hand/types.ts` |
| Whose hands | `src/gestures/HandSelector.ts` (biggest person's ≤2 hands, stable slots) |
| 3. Gesture recognition | `src/gestures/GestureRecognizer.ts`, `handGeometry.ts` |
| 4. Gesture → motion | `src/gestures/GestureMotionMapper.ts`, `oneEuro.ts` |
| Composition | `src/gestures/HandGestureController.ts` (implements `GestureController`) |
| Manual fallback | `src/gestures/ManualGestureController.ts` (implements `GestureController`) |
| 5. Viewer | `src/viewer/` (one 3Dmol viewer + adapter), `src/scene/` (many molecules, selection, trash) |
| 6. Sync | `spacetimedb/src/index.ts` (server), `src/sync/` (client) |
| Voice | `src/voice/` (speech, request parsing), `src/molecules/pubchem.ts` |
| UI | `src/ui/` (`Dock.tsx` = the one control bar), `src/styles.css` |

### Hand-tracking pipeline

RTMPose is a **top-down** model: it needs a hand box. The pipeline therefore runs two models:

1. **RTMDet-nano hand detector** (320×320, letterbox, BGR mean/std; NMS is baked into the mmdeploy end-to-end ONNX).
2. **RTMPose-m hand5** (256×256 affine crop with 1.25× padding, RGB mean/std, SimCC decode with split ratio 2).

Preprocessing follows the `pipeline.json` shipped inside the official OpenMMLab ONNX SDK zips. While the hand stays confident, the next frame's box comes from the current keypoints, so the detector only runs when tracking is lost.

### Gestures

Hand tracking is **MediaPipe Hand Landmarker** by default (GPU, ~20–30 fps in our headless test, with metric 3D "world" landmarks). The OpenMMLab RTMPose pipeline is still available with `?tracker=rtmpose`. Both produce the same 21-keypoint layout, so the gesture layer is shared.

| Hand | Recognised by (finger curl 0 = straight … 1 = folded, from 3D landmarks) | Effect |
|---|---|---|
| ✋↔✊ Fingers moving | openness = 1 − mean curl, while it keeps changing | `ZOOM` on the selected molecule, relative: ×e^(1.47·Δopenness) (fist ↔ open ≈ ×4.3). Ratchet: after opening fully (≥ 0.85), the closing stroke is ignored; after closing fully (≤ 0.2), the opening stroke is. A 0.7 s rest or any mode change resets this |
| 🔄 Fingers still | openness stays within ±0.12 for 0.5 s at any bend short of fully open (≤ 0.85) | 3D palm rotation → `ROTATE` (gain 1.2 about the vertical and viewing axes, 2.4 for forward/back tilt). Stays in rotate while the back of the hand is shown or the hand vanishes < 1.5 s |
| ☝️ Index only | index straight, middle/ring/pinky folded, held ≥ 200 ms | `PLACE`: the molecule under the fingertip is grabbed (and selected), then follows it; released over the trash = deleted |
| Hand gone | no confident hand for > 350 ms | `STOP` (freeze); control stays on |

**Several hands.** MediaPipe looks for up to 4 hands. `HandSelector` keeps the person whose hand is biggest, since palm size in pixels doesn't change when the fingers close and the teacher is closest to the laptop. It switches to someone else only if their hand is ≥ 1.4× bigger. It also keeps that person's other hand: similar size (within 0.6–1.7×), within 7 hand-widths, preferring the opposite handedness. Each chosen hand keeps a slot (0/1) while it moves, and each slot has its own smoother, recognizer and mapper, so every command carries `{ hand: slot }`. A hand's rotate/resize go to the molecule that hand last picked up (else the selected one). A molecule being driven by one hand ignores the other hand for 0.4 s.

**Gesture changes freeze everything.** The status names the gesture: `OPEN_PALM` (resize), `POINTING`, `ROTATING`, `TRANSITION` or `NONE`. Three rules keep a change of gesture from moving the molecule:
- A resize step counts only if the index finger and the other three bent together, so closing the other fingers to point is not read as "zoom out", and neither is the reverse.
- When the hand is clearly between gestures (the recogniser already sees a point, or the index is straight while the others are bent), resizing stops at once and any easing is flushed.
- Resizing restarts only 200 ms after a mode change or transition. While the index is folding out of a point, the fingertip isn't followed. Every mode change re-anchors all reference values.

**Size limits** (`MoleculeViewerAdapter.sizeLimits`) are computed from the molecule's bounding sphere (every atom as drawn, about the rotation centre), the camera's field of view and the viewer's shorter side:
- At the largest, the whole molecule fits on screen with an 8% margin in any orientation; at the smallest, it still spans 10% of the screen.
- 3Dmol enforces the same limits for every zoom (mouse wheel too), and pending gesture zoom is clamped, so the limit is a soft stop with no jitter.
- The limits are recomputed on resize and style change, and moving a molecule keeps its whole sphere inside the stage.

Stability: One-Euro filtering of all 21 keypoints (2D and 3D), time-based posture hold (same behaviour at 5 or 30 fps), dead zones, and easing in the viewer adapter. Resize and rotate never overlap: every mode switch flushes pending motion, modes can't flip back within 0.4 s, and the size freezes as soon as the fingers settle. With 3D landmarks the hand's rotation is measured directly (palm basis → rotation vector), so left/right turns are never confused. Thresholds live in `DEFAULT_RECOGNIZER_CONFIG` and `DEFAULT_MAPPER_CONFIG`; finger curl is calibrated on a real open hand (straight finger ≈ 1.65 wrist-tip/wrist-MCP ratio).

### Voice: pick a molecule by name

**Speech-to-text: Deepgram Nova-3** by default, with the browser's Web Speech API as the fallback.
- **Path:** microphone → MediaRecorder (WebM/Opus, 100 ms chunks) → `server/stt-proxy.ts` → Deepgram streaming, then transcripts back the same way.
- **Credentials:** the Deepgram key lives only on the proxy (`DEEPGRAM_API_KEY` in `.env.local`). The browser gets a 60-second signed ticket from `POST /api/stt/ticket` (same origin only) to open the audio WebSocket, which also checks the Origin.
- **Keyterm Prompting:** ~77 chemistry names, hardest first (buckminsterfullerene, cyclohexane, naphthalene, …). That is about 220 tokens by our estimate, well under Deepgram's 500-token cap. The list is built in `server/sttConfig.ts`.
- **Only finished utterances change the scene.** Deepgram's interim results and unfinished final segments are captions only; a phrase is handed to the parser once Deepgram marks the utterance over (`speech_final` or `UtteranceEnd`). With the browser engine, likewise only final results act.
- **Fallback:** the browser engine is used automatically when the proxy isn't running or has no key, and for Korean. You can also choose it in ⚙ → *Speech engine*, or with `?stt=browser`.
- **Debug panel** (⚙ → *Voice debug panel*, or `?debug=voice`): the engine in use, the live caption, the raw final transcript, the interpreted command, and the PubChem-validated molecule (or why it was rejected).

Interpretation is rule-based (`src/voice/moleculeCommands.ts`); there is no LLM in the loop.

The teacher's mic is **always listening** (it starts automatically, restarts after Chrome's silence timeouts, and keeps running while hands rotate/move/resize; the 🎤 button mutes it). **English by default**, Korean selectable. Requests are found **anywhere** in a phrase (the recogniser glues phrases together: "okay so show me caffeine"), several at once work ("add benzene and ethanol"), and the recogniser's top 3 guesses are all tried. A dictionary of ~140 common molecules corrects small mis-hearings ("benzine" → benzene, "asprin" → aspirin) and lets a name said on its own count. Loose phrases ("let's look at …") only act on known molecules, so normal lecturing is ignored. Korean works too (`카페인 보여줘`). Each name is resolved to a PubChem 3D structure (free, no key, no data to provide) and added as `pubchem:<CID>`, which every student resolves the same way. **Speed:**
- **The ~140 dictionary molecules are bundled** in `public/molecules/pack.json` (241 KB, preloaded after page load; rebuild with `npm run molecules`), so they need no network at all.
- Other names: earlier lookups are cached in the browser, and new ones ask PubChem for the name's properties and 3D structure **in parallel** (2 requests at once instead of 4 one after another).
- For names not in the dictionary, the PubChem lookup starts once the live words stop changing for 350 ms. Nothing is shown until the phrase is final, which then reuses that lookup.

Bundled molecules work offline. Large biomolecules (proteins, DNA) have no PubChem 3D structure and are reported as such. There is also a text box for typing a name. Code: `src/voice/`, `src/molecules/pubchem.ts`.

### SpacetimeDB design

Tables (all public; clients filter by room):

| Table | Key | Contents |
|---|---|---|
| `room` | `room_id` | `teacher` identity, `lock_follow`, `created_at` |
| `scene_molecule` | `id` (auto-inc) | `room_id` (btree), `molecule_id`, `view: f64[10]` (3Dmol `setView` format: translation, zoom, quaternion, screen x/y), `gesture`, `seq`, timestamps — one row per molecule on stage |
| `participant` | `connection_key` | `identity`, `room_id` (btree index), `role`, `name` |

Reducers: `join_room`, `leave_room`, `add_molecule` (max 8 per room), `update_molecule`, `remove_molecule` (the trash), `set_lock_follow`, plus the `clientDisconnected` lifecycle hook, which removes the participant row.

- **Authoritative state:** only the room's teacher identity can change the scene. The server validates the room ID, the view shape and the molecule ID.
- **Compact & throttled:** hand tracking stays local. The teacher samples each molecule's view at 10 Hz and publishes only the ones that changed, so nothing is sent while the stage is still. Webcam frames and landmarks are never sent.
- **No feedback loops:** the teacher never applies incoming views (it restores the stored view once, after a reload), and students never publish.
- **Room isolation:** every client subscription is `WHERE room_id = <room>`.
- **Student smoothing:** the student viewer eases toward the latest teacher view every frame (quaternion slerp + lerp), turning ~10 Hz updates into smooth motion. It snaps on first sight of a molecule.
- **Reconnect:** `withAutomaticReconnect()`. The client re-joins the room on every new connection ID, and the UI shows Connecting / Live / Reconnecting / Offline.
- **Identity per role:** tokens are stored per role in `localStorage`, so a teacher tab and a student tab in the same browser are different identities.

> **Security is demo-level.** The first identity to open a room as teacher owns it. Another teacher can take over only while that teacher is offline. There are no passwords or accounts, and tables are public (anyone can read any room's camera). This is fine for a hackathon demo, but not for production.

---

## Integrating with the rest of the platform

### Use or replace the gesture controller

```ts
import type { GestureController, GestureCommand } from './src/gestures/types';

// type GestureCommand =
//   | { type: 'ROTATE'; dx: number; dy: number }   // degrees about screen Y / X axes
//   | { type: 'ZOOM'; factor: number }             // >1 zoom in
//   | { type: 'STOP' } | { type: 'RESET' };

import { HandGestureController } from './src/gestures/HandGestureController';
import { RtmHandLandmarker } from './src/hand/rtm/RtmHandLandmarker';

const hand = new HandGestureController({ landmarker: new RtmHandLandmarker() });
const unsubscribe = hand.subscribe((cmd) => adapter.applyCommand(cmd));
await hand.start();                 // loads models, asks for the camera
hand.subscribeSnapshots((s) => {}); // landmarks, posture, fps, for your own UI
hand.stop();
```

- **A different hand model:** implement `HandLandmarker` (`init`, `estimate(ImageBitmap) → HandFrame`, `close`) and pass it to `HandGestureController`.
- **A different input modality** (for example, the voice team's commands): implement `GestureController`, then pass it to `<ClassroomView extraControllers={[voiceController]} />`. Its commands share the routing used by hand and manual input, including follow-mode blocking for students.

### Use the viewer with other molecules

`<MoleculeViewer molecule={source} onReady={(adapter) => ...} />` accepts any `MoleculeSource { id, name, format, data }` in a format 3Dmol reads (`sdf`, `mol2`, `pdb`, `xyz`, `cif`, …). Molecule IDs are synced as strings with a prefix. To add PubChem or your backend, register a resolver and use IDs like `pubchem:2519`:

```ts
import { registerMoleculeResolver } from './src/molecules/registry';
registerMoleculeResolver('pubchem', async (cid) => ({
  id: `pubchem:${cid}`, name: `CID ${cid}`, format: 'sdf',
  data: await (await fetch(`/api/pubchem/${cid}.sdf`)).text(),
}));
```

The server accepts any `prefix:key` molecule ID. Every client resolves it locally.

---

## Testing

| Command | What it actually tests |
|---|---|
| `npm test` | 48 unit tests (synthetic keypoints, no network):<br>• Deepgram: utterance assembly (only finished utterances are handed on), keyterms (required names, token budget), the Nova-3 URL, proxy tickets (expiry, forgery) and the Origin check.<br>• Gestures: postures, open hand ↔ point transitions never resize (fast and slow changes), resize vs rotate (never overlapping), the zoom ratchet (open-close-open keeps growing; close-open-close keeps shrinking), 3D turn direction and gains, back of the hand, hand-loss freeze, pointing → move.<br>• Hand selection: the closest person's two hands are kept and the rest ignored, slots stay stable, there is no flipping to a similar-size hand, and someone else takes over when the teacher leaves.<br>• Voice parsing, and the molecule pack covering the whole dictionary.<br>• Quaternion/view math and SimCC decode. |
| `npm run test:inference` | **Real model inference** (onnxruntime-node, using the same pre/post-processing code as the browser) on four OneHand10K photos with ground truth. Result: all hands detected, **PCK@0.2 = 100%** over 63 annotated keypoints, tracking skips the detector, and a blank frame yields no hand, and the openness used for sizing matches ground truth (0.66 vs 0.66). |
| `npm run test:e2e` | **Two real Chrome windows** (needs `npm run dev` + a local SpacetimeDB with the module published). The teacher's webcam is Chrome's fake capture device playing a video built from a **real hand photo**, so the full in-browser path runs: getUserMedia → MediaPipe → gestures → 3Dmol → reducer → student subscription. 47 checks:<br>• Speech: the real proxy runs against a fake Deepgram (`scripts/fakeDeepgram.ts`). The browser's mic audio streams through it, the key stays on the proxy, Nova-3 gets its keyterms, partial and unfinished results change nothing, the finished utterance adds the molecule, the debug panel shows transcript → command → PubChem validation, and with no proxy it falls back to the browser engine.<br>• Voice adds molecules; follow, throttling, explore/return and lock work.<br>• Dragging works, and entering the trash deletes a molecule with the button still held (for the student too).<br>• Zoom stops at a size where the whole molecule is still on screen (no jitter at the limit), and at a minimum size.<br>• The webcam AR backdrop shows.<br>• The real hand is detected, and a still or appearing hand changes nothing.<br>• A dictionary molecule loads with **0 PubChem requests**; live (partial) words never change the scene, only the finished phrase does.<br>• A second Chrome is fed a "crowd" video (`make-fake-webcam.ts --crowd`: two big hands plus a smaller person's hand). Both big hands are tracked and the small one is ignored.<br>Set `CHROME_PATH` if Chrome isn't at the default Windows path. |
| `npm run typecheck` / `npm run build` | Client, tests, scripts and server module with zero TypeScript errors. |

---

## Known limitations / unfinished

- **Not yet tested with a live human hand in front of a physical webcam.** Real inference was verified on real photos (Node) and on a real photo streamed through Chrome's fake webcam. Gesture thresholds were tuned on synthetic geometry and those photos. Expect to spend a few minutes tuning `DEFAULT_RECOGNIZER_CONFIG` / `DEFAULT_MAPPER_CONFIG` with real hands and lighting before the demo.
- **Measured speed in headless test Chrome:** ~100–200 ms per inference (6–9 fps) on both WebGPU and 4-thread WASM. Headless Chrome may be using a software WebGPU adapter, so this is likely a floor, but speed on a real laptop GPU is unmeasured. At 6–9 fps the easing keeps motion smooth, but it adds a little latency. RTMPose-m (≈55 MB) is the only official hand5 ONNX; a smaller variant would need a custom MMDeploy export.
- Tilting the hand forward or back (pitch) is not used: with 2D keypoints it can't be separated from moving the hand closer to or farther from the camera. Move the hand up or down to tilt the molecule instead.
- While the hand is engaged, it owns the molecule's size, and the +/− buttons are overridden until you release.
- "Whose hands" is a heuristic (hand size + distance), not person detection. Two people at the same distance with hands close together could be mixed up.
- Students follow the view, not the render style (style is per viewer by design).
- Auth is demo-level (see above). Old rooms are never garbage-collected (`npm run stdb:reset` clears them).
- The production bundle is ~1 MB of JS (3Dmol accounts for most of it) plus the 24 MB ORT WASM binary and the models. Fine on a LAN or localhost, but slow on a poor connection the first time.
- Mobile layout works but is not polished. The webcam needs `localhost` or HTTPS.

## Troubleshooting

- **`SpacetimeDB · Connecting…` forever:** is `npm run stdb:start` running, and did `npm run stdb:publish` succeed? Override the host or database name with `VITE_SPACETIMEDB_HOST` / `VITE_SPACETIMEDB_DB_NAME`.
- **"Failed to fetch …onnx":** run `npm run models`.
- **"This room already has an active teacher":** another tab is teaching that room. Pick a new room ID.
- **Hand not detected:** improve the lighting, move closer, show your whole hand, and check that the confidence value in the panel rises above ~0.45.
