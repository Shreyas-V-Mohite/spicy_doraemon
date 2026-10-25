import { MANUAL_ROTATE_STEP, MANUAL_ZOOM_STEP, type ManualGestureController } from '../gestures/ManualGestureController';

/**
 * On-screen fallback controls. They go through ManualGestureController, i.e.
 * the same GestureCommand pipeline the hand tracker uses.
 */
export function ManualControls({ controller, disabled }: { controller: ManualGestureController; disabled?: boolean }) {
  const s = MANUAL_ROTATE_STEP;
  return (
    <div className={`manual ${disabled ? 'is-disabled' : ''}`} role="toolbar" aria-label="Manual view controls">
      <div className="manual__pad">
        <button className="pad-btn" disabled={disabled} onClick={() => controller.rotate(0, 0, -s)} aria-label="Spin counter-clockwise" title="Spin (Q)">↺</button>
        <button className="pad-btn" disabled={disabled} onClick={() => controller.rotate(0, -s)} aria-label="Rotate up">▲</button>
        <button className="pad-btn" disabled={disabled} onClick={() => controller.rotate(0, 0, s)} aria-label="Spin clockwise" title="Spin (E)">↻</button>
        <button className="pad-btn" disabled={disabled} onClick={() => controller.rotate(-s, 0)} aria-label="Rotate left">◀</button>
        <button className="pad-btn pad-btn--center" disabled={disabled} onClick={() => controller.reset()} aria-label="Reset view" title="Reset view (R)">⟲</button>
        <button className="pad-btn" disabled={disabled} onClick={() => controller.rotate(s, 0)} aria-label="Rotate right">▶</button>
        <span />
        <button className="pad-btn" disabled={disabled} onClick={() => controller.rotate(0, s)} aria-label="Rotate down">▼</button>
        <span />
      </div>
      <div className="manual__zoom">
        <button className="pad-btn" disabled={disabled} onClick={() => controller.zoom(MANUAL_ZOOM_STEP)} aria-label="Zoom in">＋</button>
        <button className="pad-btn" disabled={disabled} onClick={() => controller.zoom(1 / MANUAL_ZOOM_STEP)} aria-label="Zoom out">－</button>
      </div>
    </div>
  );
}
