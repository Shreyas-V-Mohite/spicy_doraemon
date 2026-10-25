import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface PickerItem {
  id: string;
  name: string;
  formula: string;
}

/** What the picker offers: small, classroom-staple molecules, all bundled (no network). */
export const PICKER_MOLECULES: PickerItem[] = [
  { id: 'pubchem:962', name: 'Water', formula: 'H₂O' },
  { id: 'pubchem:297', name: 'Methane', formula: 'CH₄' },
  { id: 'builtin:ethanol', name: 'Ethanol', formula: 'C₂H₅OH' },
  { id: 'pubchem:176', name: 'Acetic acid', formula: 'CH₃COOH' },
  { id: 'builtin:benzene', name: 'Benzene', formula: 'C₆H₆' },
  { id: 'builtin:aspirin', name: 'Aspirin', formula: 'C₉H₈O₄' },
  { id: 'builtin:caffeine', name: 'Caffeine', formula: 'C₈H₁₀N₄O₂' },
  { id: 'builtin:glucose', name: 'Glucose', formula: 'C₆H₁₂O₆' },
];

/** How long the fingertip must rest on a tile to choose it. */
export const DWELL_MS = 700;

export interface MoleculePickerHandle {
  /** The index fingertip is at this page point (client pixels); null = no finger. */
  point(at: { x: number; y: number } | null): void;
}

export interface MoleculePickerProps {
  onPick(id: string): void;
  onClose(): void;
  /** Any other molecule, by name (bundled pack, then PubChem). */
  addByName(name: string): Promise<void>;
}

/**
 * The molecule picker the teacher opens with a finger snap (or the
 * "＋ Molecule" button): point at a tile with the index finger and hold for
 * a moment, or click it. Snap again, Esc or × closes it.
 */
export const MoleculePicker = forwardRef<MoleculePickerHandle, MoleculePickerProps>(function MoleculePicker({ onPick, onClose, addByName }, ref) {
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const [aiming, setAiming] = useState<string | null>(null);
  const aimingRef = useRef<string | null>(null);
  const timer = useRef(0);
  const [typed, setTyped] = useState('');

  const aim = useCallback(
    (id: string | null) => {
      if (id === aimingRef.current) return;
      aimingRef.current = id;
      setAiming(id);
      window.clearTimeout(timer.current);
      if (id) timer.current = window.setTimeout(() => onPick(id), DWELL_MS);
    },
    [onPick],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useImperativeHandle(
    ref,
    () => ({
      point: (at) => {
        if (!at) return aim(null);
        for (const [id, el] of tiles.current) {
          const r = el.getBoundingClientRect();
          if (at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom) return aim(id);
        }
        aim(null);
      },
    }),
    [aim],
  );

  return (
    <div className="picker" role="dialog" aria-label="Choose a molecule">
      <header className="picker__head">
        <strong>Choose a molecule</strong>
        <span>Point at one and hold · or click · snap again to close</span>
        <button className="picker__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="picker__grid">
        {PICKER_MOLECULES.map((m) => (
          <button
            key={m.id}
            ref={(el) => {
              if (el) tiles.current.set(m.id, el);
              else tiles.current.delete(m.id);
            }}
            className={`picker__tile ${aiming === m.id ? 'is-aiming' : ''}`}
            style={{ ['--dwell' as string]: `${DWELL_MS}ms` }}
            onClick={() => onPick(m.id)}
          >
            <span className="picker__name">{m.name}</span>
            <span className="picker__formula">{m.formula}</span>
            <span className="picker__progress" aria-hidden />
          </button>
        ))}
      </div>
      <form
        className="picker__other"
        onSubmit={(e) => {
          e.preventDefault();
          const name = typed.trim();
          if (!name) return;
          setTyped('');
          void addByName(name).then(onClose);
        }}
      >
        <input id="picker-other" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Another molecule by name, e.g. ibuprofen" />
      </form>
    </div>
  );
});
