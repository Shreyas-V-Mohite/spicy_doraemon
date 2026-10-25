import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderStyle } from '../viewer/MoleculeViewerAdapter';
import { resolveMolecule, type MoleculeSource } from '../molecules/registry';
import { findMoleculeByName, MoleculeLookupError } from '../molecules/pubchem'; // also registers the pubchem: resolver
import { ManualGestureController } from '../gestures/ManualGestureController';
import type { CommandSource, GestureCommand, GestureController } from '../gestures/types';
import { useHandController, useTrackingValue } from './useHandController';
import { WebcamBackdrop } from './WebcamBackdrop';
import { ManualControls } from './ManualControls';
import { Dock } from './Dock';
import { MoleculeScene, type MoleculeSceneHandle } from '../scene/MoleculeScene';
import { DWELL_MS, MoleculePicker, type MoleculePickerHandle } from './MoleculePicker';
import { coverPointToPlacement } from '../viewer/MoleculeViewerAdapter';
import { useLocalScene } from '../scene/useLocalScene';
import { MAX_SCENE_MOLECULES } from '../scene/types';
import type { ClassroomSync } from '../sync/useClassroomSync';

export type PageRole = 'teacher' | 'student' | 'solo';

export interface ClassroomViewProps {
  role: PageRole;
  roomId?: string;
  name: string;
  /** null = no SpacetimeDB (solo mode, or sync disabled). */
  sync: ClassroomSync | null;
  /** Extra controllers to drive the selected molecule (e.g. a teammate's input). */
  extraControllers?: GestureController[];
}

const TEACHER_ACTIVITY: Record<string, string> = {
  ROTATE: 'rotating a molecule',
  MOVE: 'moving a molecule',
  ZOOM: 'resizing a molecule',
  HOLD: 'holding a molecule',
};

export function ClassroomView({ role, roomId, name, sync, extraControllers }: ClassroomViewProps) {
  const isStudent = role === 'student';
  const localScene = useLocalScene();
  const scene = sync ? sync.scene : localScene;
  const sceneRef = useRef<MoleculeSceneHandle>(null);
  const stageRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<MoleculePickerHandle>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [style, setStyle] = useState<RenderStyle>('ballstick');
  const [following, setFollowing] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showPad, setShowPad] = useState(false);

  const room = sync?.room ?? null;
  const lockFollow = !!room?.lockFollow;
  const studentFollowing = isStudent && (following || lockFollow);
  const canEdit = !isStudent && scene.canEdit;

  // ---- input controllers -------------------------------------------------
  const hand = useHandController(!isStudent);
  const manual = useMemo(() => new ManualGestureController(), []);
  const handRunning = useTrackingValue(hand, (s) => s.phase === 'running', false);

  const followingRef = useRef(studentFollowing);
  followingRef.current = studentFollowing;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  // Every input source drives the scene: PLACE grabs the molecule under that
  // hand's fingertip, everything else goes to the molecule nearest that hand's
  // palm (keys: the selected one). A snap opens/closes the molecule picker;
  // while it is open the fingertip aims at it and molecules stay put.
  const route = useCallback((cmd: GestureCommand, source?: CommandSource) => {
    if (followingRef.current) return; // follow mode: the teacher drives these views
    if (cmd.type === 'SNAP') {
      if (canEditRef.current) setPickerOpen((open) => !open);
      return;
    }
    if (pickerOpenRef.current) {
      if (cmd.type === 'PLACE') pickerRef.current?.point(fingertipOnPage(cmd));
      else if (cmd.type === 'STOP') pickerRef.current?.point(null);
      return;
    }
    // A fingertip resting on ＋ Molecule presses it (unless that hand is carrying a molecule).
    if (cmd.type === 'PLACE' && canEditRef.current && !sceneRef.current?.holding(source)) {
      const over = overAddButton(fingertipOnPage(cmd));
      aimAdd(over);
      if (over) return;
    } else if (cmd.type === 'STOP') {
      aimAdd(false);
    }
    sceneRef.current?.applyCommand(cmd, source);
  }, []);

  // ＋ Molecule by pointing: hold the fingertip on it for DWELL_MS.
  const [addAiming, setAddAiming] = useState(false);
  const addTimer = useRef<number | null>(null);
  const aimAdd = (on: boolean) => {
    if (on === (addTimer.current !== null)) return;
    if (on) {
      addTimer.current = window.setTimeout(() => {
        addTimer.current = null;
        setAddAiming(false);
        setPickerOpen(true);
      }, DWELL_MS);
    } else {
      window.clearTimeout(addTimer.current!);
      addTimer.current = null;
    }
    setAddAiming(on);
  };
  const overAddButton = (at: { x: number; y: number } | null) => {
    const r = document.querySelector('[data-gesture-button="add-molecule"]')?.getBoundingClientRect();
    const pad = 10; // a little slack: a fingertip is not a mouse pointer
    return !!at && !!r && at.x >= r.left - pad && at.x <= r.right + pad && at.y >= r.top - pad && at.y <= r.bottom + pad;
  };

  /** A fingertip (camera-frame point, as displayed) → page pixels, through the backdrop's object-fit: cover. */
  const fingertipOnPage = (cmd: { x: number; y: number; frameAspect: number }) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return null;
    const p = coverPointToPlacement(cmd.x, cmd.y, cmd.frameAspect, r.width, r.height);
    return { x: r.left + r.width / 2 + p.x * r.width, y: r.top + r.height / 2 + p.y * r.width };
  };

  // Esc closes the picker.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  useEffect(() => {
    const controllers: GestureController[] = [manual, ...(hand ? [hand] : []), ...(extraControllers ?? [])];
    const unsubs = controllers.map((c) => c.subscribe(route));
    void manual.start();
    return () => {
      unsubs.forEach((u) => u());
      manual.stop();
    };
  }, [manual, hand, extraControllers, route]);

  // Space pauses/resumes hand control (the camera and skeleton keep running).
  useEffect(() => {
    if (!hand) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'BUTTON')) return;
      if (hand.getSnapshot().phase !== 'running' || e.code !== 'Space') return;
      e.preventDefault();
      hand.setCommandsEnabled(!hand.getSnapshot().commandsEnabled);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hand]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  };

  // ---- molecules are only ever added (picker), removed via the trash ----------
  const addMolecule = (id: string) => {
    if (!canEdit) return;
    if (scene.items.length >= MAX_SCENE_MOLECULES) {
      showToast(`At most ${MAX_SCENE_MOLECULES} molecules — drop one in the trash first.`);
      return;
    }
    scene.add(id);
  };

  /** Picker → another molecule by name: look it up (bundled pack first, then PubChem) and add it. */
  const addByName = async (name: string) => {
    try {
      const hit = await findMoleculeByName(name);
      addMolecule(hit.id);
    } catch (err) {
      showToast(err instanceof MoleculeLookupError ? err.message : 'Could not reach PubChem (check the internet connection).');
    }
  };

  const pick = (id: string) => {
    addMolecule(id);
    setPickerOpen(false);
  };

  const activeItem = scene.items.find((i) => i.key === activeKey) ?? null;
  const activeMolecule = useResolved(activeItem?.moleculeId);

  // Students: what is the teacher doing right now?
  const teacherActivity = useMemo(() => {
    const busy = scene.items.filter((i) => i.gesture && i.gesture !== 'IDLE');
    return busy.length ? TEACHER_ACTIVITY[busy[busy.length - 1].gesture] ?? null : null;
  }, [scene.items]);

  // Dev-only hook for the end-to-end browser test (scripts/e2e.ts).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __mgl: unknown }).__mgl = {
      add: (moleculeId: string) => addMolecule(moleculeId),
      command: (cmd: GestureCommand, source?: CommandSource) => route(cmd, source),
      pickerOpen: () => pickerOpenRef.current,
      addByName: (name: string) => addByName(name),
      scene: () => sceneRef.current?.debug() ?? [],
      items: () => scene.items.map((i) => ({ key: i.key, moleculeId: i.moleculeId, seq: i.seq, gesture: i.gesture })),
      activeKey: () => sceneRef.current?.activeKey() ?? null,
      getHand: () => {
        const s = hand?.getSnapshot();
        return s
          ? {
              openness: s.mapper.openness,
              mode: s.mapper.mode,
              curls: s.recognizer?.curls,
              hands: s.hands.map((h) => ({ slot: h.slot, mode: h.mapper.mode, posture: h.recognizer.posture })),
              ignored: s.frame?.ignored?.length ?? 0,
            }
          : null;
      },
      following: studentFollowing,
      ready: !!sync?.ready,
      isRoomTeacher: !!sync?.isRoomTeacher,
      participants: sync?.participants.length ?? 0,
    };
  });

  const count = scene.items.length;

  return (
    <div className={`classroom role-${role}${handRunning ? ' has-camera' : ''}`}>
      <TopBar role={role} roomId={roomId} name={name} sync={sync} />

      <main className="stage" ref={stageRef}>
        {!isStudent && <WebcamBackdrop controller={hand} showLandmarks={showLandmarks} />}
        <MoleculeScene
          ref={sceneRef}
          items={scene.items}
          canEdit={canEdit}
          following={studentFollowing}
          style={style}
          publish={sync && canEdit ? scene.update : undefined}
          onRemove={scene.remove}
          onActiveChange={setActiveKey}
        />

        <div className="stage__title">
          <h1>{activeMolecule?.name ?? (count ? 'Loading…' : 'No molecules yet')}</h1>
          {activeMolecule && (
            <p>
              {activeMolecule.formula && <span className="formula">{activeMolecule.formula}</span>}
              {activeMolecule.description && <> · {activeMolecule.description}</>}
              {count > 1 && <> · {count} molecules on stage</>}
            </p>
          )}
          {scene.lastError && <p className="error-text">{scene.lastError}</p>}
        </div>

        {count === 0 && !pickerOpen && (
          <div className="snap-hint">
            {isStudent ? (
              <strong>Waiting for your teacher to add a molecule…</strong>
            ) : (
              <>
                <span className="snap-hint__icon">🫰</span>
                <strong>Snap your fingers to choose a molecule</strong>
                <span>or click ＋ Molecule below</span>
              </>
            )}
          </div>
        )}

        {pickerOpen && canEdit && (
          <MoleculePicker ref={pickerRef} onPick={pick} onClose={() => setPickerOpen(false)} addByName={addByName} />
        )}

        {isStudent && (
          <div className="follow-card">
            <div className="segmented" role="radiogroup" aria-label="View mode">
              <button role="radio" aria-checked={studentFollowing} className={studentFollowing ? 'is-on' : ''} onClick={() => setFollowing(true)}>
                Follow Teacher
              </button>
              <button
                role="radio"
                aria-checked={!studentFollowing}
                className={!studentFollowing ? 'is-on' : ''}
                disabled={lockFollow}
                onClick={() => setFollowing(false)}
              >
                Explore Independently
              </button>
            </div>
            {lockFollow && <p className="follow-card__note">🔒 Teacher has locked everyone to their view</p>}
            {!studentFollowing && (
              <>
                <p className="follow-card__note">Click a molecule’s name, then use the arrows.</p>
                <button className="btn btn--primary btn--block" onClick={() => setFollowing(true)}>
                  ↩ Return to Teacher View
                </button>
              </>
            )}
            {studentFollowing && (
              <p className="follow-card__note">
                {!room
                  ? 'Waiting for the teacher to open this room…'
                  : teacherActivity
                    ? `Teacher is ${teacherActivity}`
                    : `${count} molecule${count === 1 ? '' : 's'} on stage`}
              </p>
            )}
          </div>
        )}

        {(showPad || (isStudent && !studentFollowing)) && <ManualControls controller={manual} disabled={studentFollowing || count === 0} />}

        {!isStudent && (
          <Dock
            hand={hand}
            canEdit={canEdit}
            pickerOpen={pickerOpen}
            togglePicker={() => setPickerOpen((open) => !open)}
            addAiming={addAiming}
            style={style}
            setStyle={setStyle}
            showLandmarks={showLandmarks}
            setShowLandmarks={setShowLandmarks}
            showPad={showPad}
            setShowPad={setShowPad}
            lockFollow={sync ? { value: lockFollow, set: sync.setLockFollow } : undefined}
          />
        )}
        {sync && !isStudent && !sync.isRoomTeacher && sync.status === 'connected' && room && (
          <p className="toast">Another teacher controls this room.</p>
        )}

        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  );
}

/** Resolve a molecule ID to its name/formula for titles (cached by the registry). */
function useResolved(moleculeId: string | undefined): MoleculeSource | null {
  const [m, setM] = useState<MoleculeSource | null>(null);
  useEffect(() => {
    if (!moleculeId) {
      setM(null);
      return;
    }
    let cancelled = false;
    resolveMolecule(moleculeId)
      .then((src) => !cancelled && setM(src))
      .catch(() => !cancelled && setM(null));
    return () => {
      cancelled = true;
    };
  }, [moleculeId]);
  return m;
}

function TopBar({ role, roomId, name, sync }: { role: PageRole; roomId?: string; name: string; sync: ClassroomSync | null }) {
  const [copied, setCopied] = useState(false);
  const studentUrl = useMemo(() => {
    if (!roomId) return '';
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('room', roomId);
    u.searchParams.set('role', 'student');
    return u.toString();
  }, [roomId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(studentUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is still visible in the tooltip */
    }
  };

  const students = sync?.participants.filter((p) => p.role === 'student').length ?? 0;
  const statusLabel =
    sync?.status === 'connected'
      ? sync.joined
        ? 'Live'
        : 'Joining…'
      : sync?.status === 'reconnecting'
        ? 'Reconnecting…'
        : sync?.status === 'offline'
          ? 'Offline'
          : 'Connecting…';

  return (
    <header className="topbar">
      <a className="brand" href={location.pathname}>
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <g fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="16" cy="16" r="4" fill="currentColor" />
            <circle cx="6" cy="8" r="3" />
            <circle cx="26" cy="8" r="3" />
            <circle cx="16" cy="28" r="3" />
            <path d="M13 14 8 10M19 14l5-4M16 20v5" />
          </g>
        </svg>
        <span>Molecule Gesture Lab</span>
      </a>

      <span className={`chip chip--role chip--${role}`}>{role === 'solo' ? 'Solo · local only' : role === 'teacher' ? 'Teacher' : 'Student'}</span>
      {roomId && (
        <span className="chip chip--mono" title="Session room ID">
          Room {roomId}
        </span>
      )}
      <span className="topbar__name">{name}</span>

      <div className="topbar__spacer" />

      {sync && (
        <span
          className={`chip chip--status status--${sync.status}${sync.status === 'connected' && !sync.joined ? '-joining' : ''}`}
          title={sync.joinError ?? sync.statusDetail ?? sync.lastPublishError ?? 'SpacetimeDB connection'}
        >
          <span className="dot" /> SpacetimeDB · {statusLabel}
        </span>
      )}
      {sync && <span className="chip">👥 {students} student{students === 1 ? '' : 's'}</span>}
      {role === 'teacher' && roomId && (
        <>
          <button className="btn btn--ghost btn--sm" onClick={copy} title={studentUrl}>
            {copied ? 'Copied!' : 'Copy student link'}
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => window.open(studentUrl, '_blank', 'width=1100,height=760')}>
            Open student window
          </button>
        </>
      )}
      {sync?.joinError && <span className="topbar__error">{sync.joinError}</span>}
    </header>
  );
}
