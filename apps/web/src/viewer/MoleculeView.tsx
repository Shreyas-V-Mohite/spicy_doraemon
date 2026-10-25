import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GestureController } from "@spicy/hand-gesture";
import type { MoleculeStyle } from "../types";
import Icon from "../ui/Icon";
import { ThreeDmolAdapter } from "./ThreeDmolAdapter";

interface Props {
  sdf: string;
  highlight: readonly number[] | null;
  style?: MoleculeStyle;
  // When given, its hand commands move this molecule (the same viewer the
  // mouse uses, so there is one renderer and one source of truth).
  controller?: GestureController | null;
  // Drawn behind the molecule, e.g. the professor's camera feed.
  backdrop?: ReactNode;
  // Professor: called with the camera whenever it moves (polled, so hand
  // gestures and the mouse both count). A new syncKey sends it again at once.
  onViewChange?: (view: number[]) => void;
  syncKey?: string | null;
  // Student: a camera to follow, or null to keep their own.
  followView?: readonly number[] | null;
}

const VIEW_POLL_MS = 150;

// Rotate, zoom and pan come from 3Dmol's mouse and touch handling.
export default function MoleculeView({
  sdf,
  highlight,
  style = "ball-and-stick",
  controller = null,
  backdrop,
  onViewChange,
  syncKey = null,
  followView = null,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const adapter = useRef<ThreeDmolAdapter | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  });
  const sending = onViewChange !== undefined;

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

  // Follow another viewer's camera: jump on a new molecule, ease otherwise.
  const followedSdf = useRef<string | null>(null);
  useEffect(() => {
    if (!followView) return;
    const instant = followedSdf.current !== sdf;
    followedSdf.current = sdf;
    adapter.current?.followView(followView, instant);
  }, [followView, sdf]);

  // Report this camera while it moves. Polling catches every source of motion
  // (mouse, touch, gesture easing) without hooking each one.
  useEffect(() => {
    if (!sending) return;
    let last: string | null = null;
    const timer = setInterval(() => {
      const view = adapter.current?.getView();
      if (!view) return;
      const key = view.map((x) => x.toFixed(4)).join(",");
      if (key === last) return;
      last = key;
      onViewChangeRef.current?.(view);
    }, VIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [sending, syncKey, sdf]);

  useEffect(() => {
    adapter.current?.setStyle(style);
  }, [style]);

  // Hand commands go to the viewer's camera.
  useEffect(() => {
    if (!controller) return;
    return controller.subscribe((command) => adapter.current?.applyCommand(command));
  }, [controller]);

  return (
    <div className={backdrop ? "viewer-wrap with-camera" : "viewer-wrap"}>
      {backdrop}
      <div ref={container} className="viewer" />
      {failed && (
        <p className="notice warn viewer-error">
          3D view unavailable ({failed}). The highlight is still verified; check that
          hardware acceleration (WebGL) is on in this browser.
        </p>
      )}
      <button
        type="button"
        className="secondary sm reset"
        onClick={() => adapter.current?.reset()}
      >
        <Icon name="reset" size={14} />
        Reset view
      </button>
    </div>
  );
}
