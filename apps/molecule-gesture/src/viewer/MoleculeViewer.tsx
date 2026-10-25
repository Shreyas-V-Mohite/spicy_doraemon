import { useEffect, useRef, useState } from 'react';
import { createViewer } from '3dmol';
import { MoleculeViewerAdapter } from './MoleculeViewerAdapter';
import type { MoleculeSource } from '../molecules/registry';

export interface MoleculeViewerProps {
  molecule: MoleculeSource | null;
  /** Called once the 3Dmol viewer exists; the adapter is the control surface. */
  onReady?: (adapter: MoleculeViewerAdapter | null) => void;
  /** Called after a molecule finishes loading into the viewer. */
  onMoleculeLoaded?: (adapter: MoleculeViewerAdapter, molecule: MoleculeSource) => void;
  /** When false, mouse/touch interaction with the canvas is blocked. */
  interactive?: boolean;
  /** Shown over the canvas when interaction is blocked and the user tries. */
  blockedHint?: string;
  onBlockedInteraction?: () => void;
  className?: string;
}

/**
 * Reusable 3Dmol.js viewer. Knows nothing about gestures, hand models or
 * SpacetimeDB — it renders a MoleculeSource and exposes an adapter.
 */
export function MoleculeViewer({
  molecule,
  onReady,
  onMoleculeLoaded,
  interactive = true,
  blockedHint,
  onBlockedInteraction,
  className,
}: MoleculeViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<MoleculeViewerAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onLoadedRef = useRef(onMoleculeLoaded);
  onLoadedRef.current = onMoleculeLoaded;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let a: MoleculeViewerAdapter;
    try {
      const viewer = createViewer(host, { backgroundColor: 'black', backgroundAlpha: 0, antialias: true } as never);
      viewer.setBackgroundColor(0x000000, 0);
      a = new MoleculeViewerAdapter(viewer, host);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WebGL is not available in this browser.');
      return;
    }
    setAdapter(a);
    onReadyRef.current?.(a);
    const ro = new ResizeObserver(() => a.resize());
    ro.observe(host);
    return () => {
      ro.disconnect();
      onReadyRef.current?.(null);
      a.dispose();
      host.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!adapter || !molecule || adapter.moleculeId === molecule.id) return;
    try {
      adapter.loadMolecule(molecule);
      onLoadedRef.current?.(adapter, molecule);
    } catch (e) {
      setError(`Could not parse ${molecule.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [adapter, molecule]);

  return (
    <div className={`molecule-viewer ${className ?? ''}`}>
      <div ref={hostRef} className="molecule-viewer__canvas" />
      {!interactive && (
        <div
          className="molecule-viewer__blocker"
          onPointerDown={() => onBlockedInteraction?.()}
          onWheel={() => onBlockedInteraction?.()}
          title={blockedHint}
        />
      )}
      {error && <div className="molecule-viewer__error">{error}</div>}
    </div>
  );
}
