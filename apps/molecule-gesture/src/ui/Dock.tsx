import { useEffect, useRef, useState } from 'react';
import type { HandGestureController, TrackingSnapshot } from '../gestures/HandGestureController';
import type { MotionMode } from '../gestures/GestureMotionMapper';
import type { RenderStyle } from '../viewer/MoleculeViewerAdapter';
import { BUILTIN_MOLECULES } from '../molecules/registry';

const MODE_SHORT: Record<MotionMode, string> = {
  ZOOM: 'Resize',
  ROTATE: 'Rotate',
  MOVE: 'Move',
  HOLD: 'Ready',
};

const POSTURE_LABEL: Record<string, string> = {
  OPEN: '✋ open',
  FIST: '✊ closed',
  HALF: '🤏 half',
  POINT: '☝️ point',
  OTHER: '· between',
  NONE: 'no hand',
};

export interface DockProps {
  hand: HandGestureController | null;
  canEdit: boolean;
  addMolecule(id: string): void;
  /** Look a molecule up by name (bundled pack, then PubChem) and add it. */
  addByName(name: string): Promise<void>;
  style: RenderStyle;
  setStyle(s: RenderStyle): void;
  showLandmarks: boolean;
  setShowLandmarks(v: boolean): void;
  showPad: boolean;
  setShowPad(v: boolean): void;
  /** Only in a synced classroom. */
  lockFollow?: { value: boolean; set(v: boolean): void };
}

/**
 * Everything the teacher needs in one slim bar at the bottom centre, so the
 * camera image and the molecules stay uncovered: the camera / hand mode, and
 * two small menus (settings, help) that open only on demand.
 */
export function Dock(props: DockProps) {
  const { hand } = props;
  const [menu, setMenu] = useState<'settings' | 'help' | null>(null);
  const snapRef = useRef<TrackingSnapshot | null>(null);
  const [snap, setSnap] = useState<TrackingSnapshot | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Menus close on any click outside them (or Esc), so they never linger over the stage.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!hand) return;
    let last = 0;
    return hand.subscribeSnapshots((s) => {
      const changed = s.phase !== snapRef.current?.phase || s.commandsEnabled !== snapRef.current?.commandsEnabled;
      snapRef.current = s;
      const now = performance.now();
      if (changed || now - last > 100) {
        last = now;
        setSnap(s);
      }
    });
  }, [hand]);

  const phase = snap?.phase ?? 'idle';
  const running = phase === 'running';
  const busy = phase === 'loading-models' || phase === 'requesting-camera';
  const mapper = snap?.mapper;
  const mode = mapper?.mode ?? 'HOLD';
  const paused = snap ? !snap.commandsEnabled : false;
  const progress = snap?.progress;
  const posture = snap?.recognizer?.posture ?? 'NONE';
  const hands = snap?.hands ?? [];
  const startCamera = () => void hand?.start().catch(() => {});

  return (
    <div className="dock-wrap" ref={wrapRef}>
      {menu === 'settings' && (
        <div className="dock-menu" role="dialog" aria-label="Settings">
          {props.canEdit && (
            <label className="field">
              <span>Add a molecule</span>
              <select value="" onChange={(e) => e.target.value && props.addMolecule(e.target.value)}>
                <option value="">Choose…</option>
                {BUILTIN_MOLECULES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.formula})
                  </option>
                ))}
              </select>
            </label>
          )}
          {props.canEdit && <TypeMolecule addByName={props.addByName} />}
          <label className="field">
            <span>Style</span>
            <select value={props.style} onChange={(e) => props.setStyle(e.target.value as RenderStyle)}>
              <option value="ballstick">Ball &amp; stick</option>
              <option value="stick">Sticks</option>
              <option value="spacefill">Space-filling</option>
            </select>
          </label>
          {props.lockFollow && (
            <Toggle label="Lock students to my view" checked={props.lockFollow.value} onChange={props.lockFollow.set} disabled={!props.canEdit} />
          )}
          <Toggle label="Hand skeleton" checked={props.showLandmarks} onChange={props.setShowLandmarks} />
          <Toggle label="Arrow buttons" checked={props.showPad} onChange={props.setShowPad} />
          {running && <Toggle label="Hand control" checked={!paused} onChange={(v) => hand?.setCommandsEnabled(v)} />}
          {running && (
            <button className="btn btn--ghost btn--sm" onClick={() => hand?.stop()}>
              Stop camera
            </button>
          )}
          <p className="dock-menu__meta">{snap?.info?.backend ?? ''}</p>
        </div>
      )}
      {menu === 'help' && (
        <div className="dock-menu dock-menu--help" role="dialog" aria-label="How to control">
          <p><b>⚙ Add</b> Settings → Add a molecule, or type any name</p>
          <p><b>☝️ Move</b> point your index finger at a molecule and carry it</p>
          <p><b>🗑️ Delete</b> carry it onto the trash (bottom left) — it disappears right away</p>
          <p><b>✋ Resize</b> open / close your fingers — open all the way and repeat (open, close, open…) to keep growing. Stop for ½ s and the size locks</p>
          <p><b>🔄 Rotate</b> hold your fingers still ½ s (after resizing, at any bend), then turn your hand. To resize again: squeeze fully, open ↔ fist</p>
          <p><b>🙌 Two hands</b> each hand works on the molecule nearest its palm (e.g. left hand on the left molecule)</p>
          <p className="dock-menu__meta">Keys: arrows/Q/E rotate · +/− zoom · R reset · Space pause hand</p>
        </div>
      )}

      <div className="dock" role="toolbar" aria-label="Controls">
        {!running ? (
          <button className="dock__cam" onClick={startCamera} disabled={busy} title={snap?.error}>
            {busy
              ? phase === 'loading-models'
                ? `Loading… ${progress && progress.totalBytes ? Math.round((100 * progress.loadedBytes) / progress.totalBytes) + '%' : ''}`
                : 'Allow camera…'
              : phase === 'error'
                ? '⚠ Retry camera'
                : '📷 Enable webcam'}
          </button>
        ) : (
          <span
            className={`dock__hand mode-${mode.toLowerCase()}`}
            data-posture={POSTURE_LABEL[posture] ?? posture}
            data-conf={snap?.frame?.hand ? snap.frame.hand.poseScore.toFixed(2) : ''}
            data-fps={(snap?.fps ?? 0).toFixed(0)}
            data-infer={(snap?.inferenceMs ?? 0).toFixed(0)}
            data-backend={snap?.info?.backend ?? ''}
            data-hands={hands.length}
            data-ignored={snap?.frame?.ignored?.length ?? 0}
            title={`${POSTURE_LABEL[posture] ?? ''} · ${(snap?.fps ?? 0).toFixed(0)} fps`}
          >
            {paused ? (
              <>
                <span className="mode-dot mode-dot--hold" />
                Paused
              </>
            ) : (
              // One entry per tracked hand (the teacher can use both).
              (hands.length ? hands : [{ slot: 0, mapper: { mode, gesture: 'NONE' as const } }]).map((h, i) => (
                <span key={h.slot} className="dock__hand-mode">
                  {i > 0 && <span className="dock__hand-sep">·</span>}
                  <span className={`mode-dot mode-dot--${h.mapper.mode.toLowerCase()}`} />
                  {/* Between two gestures nothing moves; say so instead of the old mode. */}
                  {h.mapper.gesture === 'TRANSITION' ? 'Switching…' : MODE_SHORT[h.mapper.mode]}
                </span>
              ))
            )}
            {mode === 'ZOOM' && (mapper?.rotateProgress ?? 0) > 0.05 && (
              <span className="dock__ring" style={{ ['--p' as string]: `${Math.round((mapper?.rotateProgress ?? 0) * 100)}` }} />
            )}
          </span>
        )}

        <span className="dock__sep" />
        <button className={`dock__icon ${menu === 'settings' ? 'is-on' : ''}`} onClick={() => setMenu(menu === 'settings' ? null : 'settings')} aria-label="Settings">
          ⚙
        </button>
        <button className={`dock__icon ${menu === 'help' ? 'is-on' : ''}`} onClick={() => setMenu(menu === 'help' ? null : 'help')} aria-label="Help">
          ?
        </button>
      </div>
      {snap?.error && phase === 'error' && <p className="dock__error">{snap.error}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
      <span>{label}</span>
    </label>
  );
}

function TypeMolecule({ addByName }: { addByName(name: string): Promise<void> }) {
  const [typed, setTyped] = useState('');
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        const text = typed.trim();
        if (!text) return;
        void addByName(text);
        setTyped('');
      }}
    >
      <span>Type a name (any molecule)</span>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. ibuprofen" />
    </form>
  );
}
