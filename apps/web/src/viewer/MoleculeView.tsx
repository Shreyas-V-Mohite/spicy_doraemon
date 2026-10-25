import { useEffect, useRef, useState } from "react";
import type { MoleculeStyle } from "../types";
import { ThreeDmolAdapter } from "./ThreeDmolAdapter";

interface Props {
  sdf: string;
  highlight: readonly number[] | null;
  style?: MoleculeStyle;
}

// Rotate, zoom and pan come from 3Dmol's mouse and touch handling.
export default function MoleculeView({ sdf, highlight, style = "ball-and-stick" }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const adapter = useRef<ThreeDmolAdapter | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let a: ThreeDmolAdapter;
    try {
      a = new ThreeDmolAdapter(el);
    } catch (err) {
      console.error("Molecule viewer unavailable", err);
      setFailed(err instanceof Error ? err.message : "Viewer failed to start");
      return;
    }
    adapter.current = a;
    setFailed(null);
    const observer = new ResizeObserver(() => a.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      a.destroy();
      adapter.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      adapter.current?.setStyle(style);
      adapter.current?.load(sdf);
      adapter.current?.setHighlight(highlight);
    } catch (err) {
      console.error("Molecule failed to render", err);
      setFailed("This molecule could not be drawn");
    }
    // highlight is applied again by the effect below when only it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdf]);

  useEffect(() => {
    adapter.current?.setHighlight(highlight);
  }, [highlight]);

  useEffect(() => {
    adapter.current?.setStyle(style);
  }, [style]);

  return (
    <div className="viewer-wrap">
      <div ref={container} className="viewer" />
      {failed && (
        <p className="error viewer-error">
          3D view unavailable ({failed}). The highlight is still verified; check
          that hardware acceleration/WebGL is on in this browser.
        </p>
      )}
      <button
        type="button"
        className="secondary reset"
        onClick={() => adapter.current?.reset()}
      >
        Reset view
      </button>
    </div>
  );
}
