import { useEffect, useRef } from "react";
import { ThreeDmolAdapter } from "./ThreeDmolAdapter";

interface Props {
  sdf: string;
  highlight: readonly number[] | null;
}

// Rotate, zoom and pan come from 3Dmol's mouse and touch handling.
export default function MoleculeView({ sdf, highlight }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const adapter = useRef<ThreeDmolAdapter | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const a = new ThreeDmolAdapter(el);
    adapter.current = a;
    const observer = new ResizeObserver(() => a.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      a.destroy();
      adapter.current = null;
    };
  }, []);

  useEffect(() => {
    adapter.current?.load(sdf);
    adapter.current?.setHighlight(highlight);
    // highlight is applied again by the effect below when only it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdf]);

  useEffect(() => {
    adapter.current?.setHighlight(highlight);
  }, [highlight]);

  return (
    <div className="viewer-wrap">
      <div ref={container} className="viewer" />
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
