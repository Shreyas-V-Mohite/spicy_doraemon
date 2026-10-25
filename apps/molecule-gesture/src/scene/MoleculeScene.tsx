import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MoleculeViewer } from '../viewer/MoleculeViewer';
import { coverPointToPlacement, type MoleculeViewerAdapter, type RenderStyle } from '../viewer/MoleculeViewerAdapter';
import { resolveMolecule, type MoleculeSource } from '../molecules/registry';
import { viewDelta, type ViewState } from '../viewer/viewState';
import type { CommandSource, GestureCommand } from '../gestures/types';
import type { SceneItem } from './types';

export interface MoleculeSceneProps {
  items: SceneItem[];
  /** Teacher/solo: lays out new molecules, publishes views, can trash. */
  canEdit: boolean;
  /** Student following the teacher: every molecule tracks its shared view. */
  following: boolean;
  style: RenderStyle;
  /** Teacher: send a molecule's view (throttled here to ~10 Hz, only on change). */
  publish?: (key: string, view: ViewState, gesture: string) => void;
  onRemove: (key: string) => void;
  /** Called when the selected molecule changes (for titles etc.). */
  onActiveChange?: (key: string | null) => void;
}

export interface MoleculeSceneHandle {
  /**
   * Route a gesture/manual command. PLACE grabs the molecule under that
   * hand's fingertip; the rest go to the molecule that hand last held, else
   * to the selected one. Two hands never drive the same molecule at once.
   */
  applyCommand(cmd: GestureCommand, source?: CommandSource): void;
  activeKey(): string | null;
  /** Is this hand (or the mouse, without a source) carrying a molecule right now? */
  holding(source?: CommandSource): boolean;
  /** Debug/test snapshot. */
  debug(): {
    key: string;
    moleculeId: string;
    view: ViewState | null;
    placement: { x: number; y: number } | null;
    scale: number | null;
    loaded: string | null;
    fit: ReturnType<MoleculeViewerAdapter['fitInfo']> | null;
  }[];
}

interface Slot {
  adapter: MoleculeViewerAdapter | null;
  loadedId: string | null;
  laidOut: boolean;
  followSnapped: boolean;
}

/**
 * Where to put a new molecule: the candidate spot farthest from the others
 * (viewer-widths from the centre, y down). Kept clear of the side panels.
 */
const SPOTS = [
  [0, 0], [0.2, 0], [-0.2, 0], [0.2, -0.14], [-0.2, -0.14], [0, -0.16], [0.2, 0.14], [-0.2, 0.14], [0, 0.16],
] as const;

const PUBLISH_HZ = 10;
/** Input sources that aren't a tracked hand. */
const KEYS = -2;
const MOUSE = -1;
/** A hand keeps a molecule to itself this long after its last command. */
const OWNER_MS = 400;
/** What a molecule is doing, for the students' "teacher is …" line. */
const ACTIVITY_MS = 500;
/** Shrink-and-fade of a molecule dropped in the trash, before it leaves the store. */
const TRASH_FADE_MS = 180;

const activityOf = (cmd: GestureCommand) =>
  cmd.type === 'ROTATE' ? 'ROTATE' : cmd.type === 'ZOOM' || cmd.type === 'SCALE' ? 'ZOOM' : cmd.type === 'PLACE' || cmd.type === 'PAN' ? 'MOVE' : null;

/**
 * The stage: one transparent 3Dmol viewer per molecule, stacked, so every
 * molecule has its own rotation, size and placement. Molecules are added by
 * the store (voice) and removed only by dropping them in the trash.
 */
export const MoleculeScene = forwardRef<MoleculeSceneHandle, MoleculeSceneProps>(function MoleculeScene(
  { items, canEdit, following, style, publish, onRemove, onActiveChange },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLDivElement>());
  const slots = useRef(new Map<string, Slot>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [active, setActiveState] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  /** Which source (hand slot / mouse) holds which molecule. */
  const grabs = useRef(new Map<number, string>());
  const [grabbed, setGrabbed] = useState<string[]>([]);
  /** Per source: is what it holds over the trash can? */
  const overTrashBy = useRef(new Map<number, boolean>());
  const [overTrash, setOverTrash] = useState(false);
  /** The molecule each hand last picked up: its rotate/resize go there. */
  const handTarget = useRef(new Map<number, string>());
  /** The molecule each hand is rotating/resizing right now (until its next STOP). */
  const handLock = useRef(new Map<number, string>());

  /**
   * The molecule nearest to a palm (camera-frame point, mirrored), measured
   * on screen. Skips molecules on their way to the trash and those `taken`
   * by the other hand.
   */
  const nearestTo = (palm: NonNullable<CommandSource['palm']>, w: number, h: number, taken: Set<string>): string | null => {
    const p = coverPointToPlacement(palm.x, palm.y, palm.frameAspect, w, h);
    let best: string | null = null;
    let bestD = Infinity;
    for (const it of itemsRef.current) {
      if (leavingRef.current.has(it.key) || taken.has(it.key)) continue;
      const a = slots.current.get(it.key)?.adapter;
      if (!a) continue;
      const c = a.placement();
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = it.key;
      }
    }
    return best;
  };
  const owner = useRef(new Map<string, { src: number; at: number }>());
  const activity = useRef(new Map<string, { label: string; at: number }>());
  const leavingRef = useRef(new Set<string>());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const setActive = useCallback(
    (key: string | null) => {
      activeRef.current = key;
      setActiveState(key);
      onActiveChange?.(key);
    },
    [onActiveChange],
  );
  const syncGrabs = () => setGrabbed([...grabs.current.values()]);
  const setTrashHover = (src: number, v: boolean) => {
    overTrashBy.current.set(src, v);
    setOverTrash([...overTrashBy.current.values()].some(Boolean));
  };

  const slot = (key: string): Slot => {
    let s = slots.current.get(key);
    if (!s) {
      s = { adapter: null, loadedId: null, laidOut: false, followSnapped: false };
      slots.current.set(key, s);
    }
    return s;
  };

  // A newly added molecule becomes the selected one (and every hand's target);
  // keep a valid selection.
  const prevKeys = useRef<string[]>([]);
  useEffect(() => {
    const keys = items.map((i) => i.key);
    const added = keys.filter((k) => !prevKeys.current.includes(k));
    for (const k of prevKeys.current) if (!keys.includes(k)) slots.current.delete(k);
    prevKeys.current = keys;
    for (const [src, k] of handTarget.current) if (!keys.includes(k) || added.length) handTarget.current.delete(src);
    // Forget everything about molecules that are gone (trashed here or by another teacher tab).
    let grabsChanged = false;
    for (const [src, k] of grabs.current) {
      if (keys.includes(k)) continue;
      grabs.current.delete(src);
      overTrashBy.current.delete(src);
      grabsChanged = true;
    }
    if (grabsChanged) {
      setGrabbed([...grabs.current.values()]);
      setOverTrash([...overTrashBy.current.values()].some(Boolean));
    }
    for (const k of [...owner.current.keys()]) if (!keys.includes(k)) owner.current.delete(k);
    for (const k of [...activity.current.keys()]) if (!keys.includes(k)) activity.current.delete(k);
    for (const [src, k] of [...handLock.current]) if (!keys.includes(k)) handLock.current.delete(src);
    if (added.length) setActive(added[added.length - 1]);
    else if (activeRef.current && !keys.includes(activeRef.current)) setActive(keys[keys.length - 1] ?? null);
  }, [items, setActive]);

  /** Pointer in stage pixels → is it over the trash can? */
  const isOverTrash = (px: number, py: number) => {
    const stage = stageRef.current?.getBoundingClientRect();
    const trash = trashRef.current?.getBoundingClientRect();
    if (!stage || !trash) return false;
    const x = stage.left + px;
    const y = stage.top + py;
    const pad = 24;
    return x >= trash.left - pad && x <= trash.right + pad && y >= trash.top - pad && y <= trash.bottom + pad;
  };

  /** Remove a molecule: a quick shrink-and-fade, then out of the store (and SpacetimeDB). Once per molecule. */
  const trash = useCallback(
    (key: string) => {
      if (leavingRef.current.has(key)) return;
      const s = slots.current.get(key);
      s?.adapter?.applyCommand({ type: 'STOP' }); // no easing left over
      s?.adapter?.setVisible(false, TRASH_FADE_MS);
      leavingRef.current.add(key);
      setLeaving(new Set(leavingRef.current));
      owner.current.delete(key);
      activity.current.delete(key);
      for (const [src, k] of handTarget.current) if (k === key) handTarget.current.delete(src);
      for (const [src, k] of handLock.current) if (k === key) handLock.current.delete(src);
      window.setTimeout(() => {
        onRemove(key);
        leavingRef.current.delete(key);
        setLeaving(new Set(leavingRef.current));
      }, TRASH_FADE_MS);
    },
    [onRemove],
  );

  /** A source lets go of what it held (the trash already took it, if it got there). */
  const release = useCallback((src: number) => {
    const g = grabs.current.get(src);
    grabs.current.delete(src);
    syncGrabs();
    setTrashHover(src, false);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The trash zone check (the same one that lights up the trash icon): the
   * moment a held molecule's pointer enters it, the molecule is deleted — no
   * release needed. Returns true when it was deleted.
   */
  const trashIfOver = (src: number, key: string, px: number, py: number): boolean => {
    if (!canEdit) return false;
    const over = isOverTrash(px, py);
    if (!over) {
      setTrashHover(src, false);
      return false;
    }
    release(src); // icon back to normal, drag cleared
    trash(key);
    return true;
  };

  // --- command routing ------------------------------------------------------
  const applyCommand = useCallback(
    (cmd: GestureCommand, source?: CommandSource) => {
      const stage = stageRef.current;
      const w = stage?.clientWidth || 1;
      const h = stage?.clientHeight || 1;
      const src = source?.hand ?? KEYS;
      const now = performance.now();
      const adapterOf = (key: string) => slots.current.get(key)?.adapter;

      if (cmd.type === 'SNAP') return; // for the molecule picker, not for molecules

      if (cmd.type === 'PLACE') {
        const p = coverPointToPlacement(cmd.x, cmd.y, cmd.frameAspect, w, h);
        let key = grabs.current.get(src);
        if (!key) {
          // Grab the molecule under the fingertip (nearest, within its radius),
          // unless the other hand is holding it.
          const held = new Set(grabs.current.values());
          let best = Infinity;
          for (const it of itemsRef.current) {
            const a = adapterOf(it.key);
            if (!a || leavingRef.current.has(it.key) || held.has(it.key)) continue;
            const c = a.placement();
            const d = Math.hypot(p.x - c.x, p.y - c.y) * w;
            if (d <= a.grabRadiusPx() && d < best) {
              best = d;
              key = it.key;
            }
          }
          if (!key) return;
          grabs.current.set(src, key);
          syncGrabs();
          if (source) handTarget.current.set(src, key);
          setActive(key);
        }
        if (trashIfOver(src, key, w / 2 + p.x * w, h / 2 + p.y * w)) return;
        adapterOf(key)?.applyCommand(cmd);
        activity.current.set(key, { label: 'MOVE', at: now });
        return;
      }

      if (cmd.type === 'STOP') {
        const held = release(src);
        if (!source) {
          for (const s of slots.current.values()) s.adapter?.applyCommand(cmd);
          return;
        }
        // Only this hand's molecules stop easing; the other hand carries on.
        const touched = new Set<string>(held ? [held] : []);
        for (const [key, o] of owner.current) {
          if (o.src !== src) continue;
          touched.add(key);
          owner.current.delete(key);
        }
        for (const key of touched) adapterOf(key)?.applyCommand(cmd);
        // The gesture is over: the next one picks the molecule nearest the palm again.
        handLock.current.delete(src);
        return;
      }

      const exists = (k: string | undefined): k is string => !!k && !leavingRef.current.has(k) && itemsRef.current.some((i) => i.key === k);
      let key: string | null | undefined;
      if (!source) {
        key = activeRef.current; // keys and buttons: the selected molecule
      } else {
        // Each hand works on the molecule nearest its own palm, picked when a
        // rotate/resize starts and kept until it ends (so it never jumps to
        // another molecule mid-gesture).
        key = handLock.current.get(src);
        if (!exists(key)) {
          const taken = new Set([...handLock.current].filter(([s]) => s !== src).map(([, k]) => k));
          key = source.palm ? nearestTo(source.palm, w, h, taken) : exists(handTarget.current.get(src)) ? handTarget.current.get(src) : activeRef.current;
          if (!key) return;
          handLock.current.set(src, key);
          if (key !== activeRef.current) setActive(key);
        }
      }
      if (!key) return;
      const o = owner.current.get(key);
      if (o && o.src !== src && now - o.at < OWNER_MS) return; // the other hand is working on it
      owner.current.set(key, { src, at: now });
      adapterOf(key)?.applyCommand(cmd);
      const label = activityOf(cmd);
      if (label) activity.current.set(key, { label, at: now });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, release, setActive, trash],
  );

  useImperativeHandle(
    ref,
    () => ({
      applyCommand,
      activeKey: () => activeRef.current,
      holding: (source) => grabs.current.has(source?.hand ?? KEYS),
      debug: () =>
        itemsRef.current.map((it) => {
          const s = slots.current.get(it.key);
          const a = s?.adapter;
          return {
            key: it.key,
            moleculeId: it.moleculeId,
            view: a ? a.getView() : null,
            placement: a ? a.placement() : null,
            scale: a ? a.currentScale() : null,
            loaded: s?.loadedId ?? null,
            fit: a ? a.fitInfo() : null,
          };
        }),
    }),
    [applyCommand],
  );

  // --- teacher: lay out new molecules, restore known ones -------------------
  const onLoaded = useCallback(
    (key: string, a: MoleculeViewerAdapter, m: MoleculeSource) => {
      const s = slot(key);
      s.loadedId = m.id;
      a.setStyle(style);
      const it = itemsRef.current.find((i) => i.key === key);
      if (!canEdit || s.laidOut) return;
      s.laidOut = true;
      if (it?.view) {
        a.setView(it.view); // teacher reloaded mid-lesson
        return;
      }
      // Pick the free spot farthest from the other (already placed) molecules.
      const others = itemsRef.current
        .filter((i) => i.key !== key && slots.current.get(i.key)?.laidOut)
        .map((i) => slots.current.get(i.key)?.adapter?.placement())
        .filter((p): p is { x: number; y: number } => !!p);
      if (others.length === 0) {
        a.layOut(0.85, 0, 0);
        return;
      }
      let best: readonly [number, number] = SPOTS[1];
      let bestD = -1;
      for (const sp of SPOTS) {
        const d = Math.min(...others.map((o) => Math.hypot(o.x - sp[0], o.y - sp[1])));
        if (d > bestD) {
          bestD = d;
          best = sp;
        }
      }
      a.layOut(0.5, best[0], best[1]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, style],
  );

  useEffect(() => {
    for (const s of slots.current.values()) s.adapter?.setStyle(style);
  }, [style]);

  // --- teacher: publish each molecule's view (~10 Hz, only on change) -------
  useEffect(() => {
    if (!canEdit || !publish) return;
    const lastSent = new Map<string, { view: ViewState; gesture: string }>();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const held = new Set(grabs.current.values());
      for (const it of itemsRef.current) {
        const s = slots.current.get(it.key);
        if (!s?.adapter || !s.laidOut || s.loadedId !== it.moleculeId) continue;
        const view = s.adapter.getView();
        const act = activity.current.get(it.key);
        const gesture = act && now - act.at < ACTIVITY_MS ? act.label : held.has(it.key) ? 'MOVE' : 'IDLE';
        const prev = lastSent.get(it.key);
        if (prev && viewDelta(prev.view, view) < 0.05 && prev.gesture === gesture) continue;
        lastSent.set(it.key, { view, gesture });
        publish(it.key, view, gesture);
      }
    }, 1000 / PUBLISH_HZ);
    return () => window.clearInterval(timer);
  }, [canEdit, publish]);

  // --- student: follow every molecule's shared view -------------------------
  useEffect(() => {
    if (canEdit) return;
    for (const it of items) {
      const s = slots.current.get(it.key);
      if (!s?.adapter || s.loadedId !== it.moleculeId) continue;
      if (!following) {
        s.adapter.setFollowTarget(null);
        continue;
      }
      if (it.view) {
        s.adapter.setFollowTarget(it.view, !s.followSnapped);
        s.followSnapped = true;
      }
    }
  });

  // --- name chips follow their molecules; drag them with the mouse ----------
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const stage = stageRef.current;
      if (!stage) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      for (const [key, el] of chipRefs.current) {
        const a = slots.current.get(key)?.adapter;
        if (!a) continue;
        const p = a.placement();
        const r = 0.36 * Math.min(w, h) * a.currentScale();
        el.style.transform = `translate(${w / 2 + p.x * w}px, ${h / 2 + p.y * w + r}px) translate(-50%, 0)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onChipDown = (key: string, e: React.PointerEvent) => {
    e.preventDefault(); // no text selection while dragging
    setActive(key);
    if (!canEdit || [...grabs.current.values()].includes(key)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grabs.current.set(MOUSE, key);
    syncGrabs();
  };
  const onChipMove = (key: string, e: React.PointerEvent) => {
    if (grabs.current.get(MOUSE) !== key || !canEdit) return;
    const stage = stageRef.current!.getBoundingClientRect();
    const px = e.clientX - stage.left;
    const py = e.clientY - stage.top;
    const w = stage.width;
    const h = stage.height;
    if (trashIfOver(MOUSE, key, px, py)) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    slots.current.get(key)?.adapter?.setPlacement((px - w / 2) / w, (py - h / 2) / w);
    activity.current.set(key, { label: 'MOVE', at: performance.now() });
  };
  const onChipUp = () => {
    if (grabs.current.has(MOUSE)) release(MOUSE);
  };

  const anyGrabbed = grabbed.length > 0;
  return (
    <div className="scene" ref={stageRef}>
      {items.map((it) => (
        <SceneSlot
          key={it.key}
          item={it}
          active={it.key === active}
          grabbed={grabbed.includes(it.key)}
          onAdapter={(a) => (slot(it.key).adapter = a)}
          onLoaded={(a, m) => onLoaded(it.key, a, m)}
        />
      ))}

      {items.map((it) => (
        <div
          key={it.key}
          ref={(el) => {
            if (el) chipRefs.current.set(it.key, el);
            else chipRefs.current.delete(it.key);
          }}
          className={`mol-chip ${it.key === active ? 'is-active' : ''} ${grabbed.includes(it.key) ? 'is-grabbed' : ''} ${leaving.has(it.key) ? 'is-leaving' : ''}`}
          onPointerDown={(e) => onChipDown(it.key, e)}
          onPointerMove={(e) => onChipMove(it.key, e)}
          onPointerUp={onChipUp}
          onPointerCancel={onChipUp}
          title={canEdit ? 'Drag to move · drag onto the trash to remove' : 'Select'}
        >
          <ChipLabel moleculeId={it.moleculeId} />
        </div>
      ))}

      {canEdit && (
        <div ref={trashRef} className={`trash ${anyGrabbed ? 'is-armed' : ''} ${overTrash ? 'is-over' : ''}`} aria-label="Trash: drop a molecule here to remove it">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden>
            <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path className="trash__lid" d="M3 6h18M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
              <path d="M5.5 6l1 13.5A2 2 0 0 0 8.5 21.5h7a2 2 0 0 0 2-1.9L18.5 6M10 10.5v7M14 10.5v7" />
            </g>
          </svg>
          <span>{anyGrabbed ? 'Drag here to delete' : 'Trash'}</span>
        </div>
      )}
    </div>
  );
});

function SceneSlot({
  item,
  active,
  grabbed,
  onAdapter,
  onLoaded,
}: {
  item: SceneItem;
  active: boolean;
  grabbed: boolean;
  onAdapter: (a: MoleculeViewerAdapter | null) => void;
  onLoaded: (a: MoleculeViewerAdapter, m: MoleculeSource) => void;
}) {
  const [molecule, setMolecule] = useState<MoleculeSource | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    resolveMolecule(item.moleculeId)
      .then((m) => !cancelled && setMolecule(m))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [item.moleculeId]);
  return (
    <div className={`scene-slot ${active ? 'is-active' : ''} ${grabbed ? 'is-grabbed' : ''}`}>
      <MoleculeViewer molecule={molecule} onReady={onAdapter} onMoleculeLoaded={onLoaded} />
      {error && <div className="molecule-viewer__error">{error}</div>}
    </div>
  );
}

function ChipLabel({ moleculeId }: { moleculeId: string }) {
  const [name, setName] = useState<string>('…');
  useEffect(() => {
    let cancelled = false;
    resolveMolecule(moleculeId)
      .then((m) => !cancelled && setName(m.name))
      .catch(() => !cancelled && setName(moleculeId));
    return () => {
      cancelled = true;
    };
  }, [moleculeId]);
  return <>{name}</>;
}
