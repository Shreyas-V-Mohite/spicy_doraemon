import * as $3Dmol from "3dmol";
import { ViewMotion, type GestureCommand } from "@spicy/hand-gesture";
import type { MoleculeStyle } from "../types";
import type { ViewerAdapter } from "./ViewerAdapter";

const HIGHLIGHT = "#ffb000";

// GLViewer keeps rotationGroup internal; its x/y is the on-screen offset.
type RotationGroupHolder = { rotationGroup?: { position: { x: number; y: number } } };

// One easing step from a view toward another: positions move linearly, the
// rotation by normalised quaternion interpolation along the shorter arc.
function blendView(from: readonly number[], to: readonly number[], t: number): number[] {
  const out = from.map((f, i) => f + (to[i] - f) * t);
  const dot = from[4] * to[4] + from[5] * to[5] + from[6] * to[6] + from[7] * to[7];
  const sign = dot < 0 ? -1 : 1;
  for (let i = 4; i < 8; i++) out[i] = from[i] + (sign * to[i] - from[i]) * t;
  const len = Math.hypot(out[4], out[5], out[6], out[7]) || 1;
  for (let i = 4; i < 8; i++) out[i] /= len;
  return out;
}

function viewsClose(a: readonly number[], b: readonly number[]): boolean {
  const dot = Math.abs(a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7]);
  return dot > 0.99999 && a.every((x, i) => i >= 4 && i < 8 ? true : Math.abs(x - b[i]) < 0.01);
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export class ThreeDmolAdapter implements ViewerAdapter {
  private container: HTMLElement;
  private viewer: $3Dmol.GLViewer;
  // Moves the camera for gesture commands; the one viewer stays ours.
  private motion: ViewMotion;
  private hasModel = false;
  private highlight: readonly number[] | null = null;
  private style: MoleculeStyle = "ball-and-stick";

  // Throws if the browser can't give us a WebGL context; callers show a
  // message instead of letting the error unmount the page.
  constructor(container: HTMLElement) {
    if (!webglAvailable()) throw new Error("WebGL is not available");
    this.container = container;
    this.viewer = $3Dmol.createViewer(container, { backgroundAlpha: 0 });
    // A loaded molecule already fills the view; let hands (and the wheel)
    // enlarge it up to three times that to look at a group up close.
    this.motion = new ViewMotion(this.viewer, container, { maxFill: 3 });
  }

  load(sdf: string) {
    this.stopEasing();
    this.viewer.clear();
    // keepH: hydrogens stay in the model, so `serial` equals the atom's
    // position in the SDF and RDKit indices apply unchanged.
    this.viewer.addModel(sdf, "sdf", { keepH: true });
    this.hasModel = true;
    this.applyStyle();
    this.viewer.zoomTo();
    this.viewer.render();
    this.motion.modelChanged(this.style);
  }

  applyCommand(command: GestureCommand) {
    this.motion.applyCommand(command);
  }

  setStyle(style: MoleculeStyle) {
    this.style = style;
    if (!this.hasModel) return;
    this.applyStyle();
    this.motion.styleChanged(style);
    this.viewer.render();
  }

  setHighlight(indices: readonly number[] | null) {
    this.highlight = indices;
    if (!this.hasModel) return;
    this.applyStyle();
    this.viewer.render();
  }

  // The camera as a 10-number setView array: 3Dmol's getView() plus the
  // on-screen offset (rotationGroup x/y) that the hand "move" gesture uses.
  getView(): number[] | null {
    if (!this.hasModel) return null;
    const offset = (this.viewer as unknown as RotationGroupHolder).rotationGroup?.position;
    return [...this.viewer.getView(), offset?.x ?? 0, offset?.y ?? 0];
  }

  // Moves the camera to another viewer's view. Updates arrive a few times a
  // second, so it eases toward them rather than jumping, unless `instant`.
  followView(view: readonly number[], instant = false) {
    if (!this.hasModel || view.length !== 10) return;
    if (instant) {
      this.stopEasing();
      this.viewer.setView([...view]);
      return;
    }
    this.target = [...view];
    if (!this.easing) this.easing = requestAnimationFrame(this.ease);
  }

  private target: number[] | null = null;
  private easing = 0;

  private ease = () => {
    this.easing = 0;
    const current = this.getView();
    if (!this.target || !current) return;
    const next = blendView(current, this.target, 0.25);
    this.viewer.setView(next);
    if (viewsClose(next, this.target)) this.target = null;
    else this.easing = requestAnimationFrame(this.ease);
  };

  private stopEasing() {
    cancelAnimationFrame(this.easing);
    this.easing = 0;
    this.target = null;
  }

  // Back to the size, orientation and place the molecule was loaded with.
  reset() {
    this.motion.reset();
    this.viewer.render();
  }

  resize() {
    this.viewer.resize();
    this.motion.resize();
    this.viewer.render();
  }

  destroy() {
    this.stopEasing();
    this.motion.dispose();
    this.viewer.clear();
    // Browsers cap live WebGL contexts (about 16); release ours explicitly.
    const gl = this.container
      .querySelector("canvas")
      ?.getContext("webgl2") ?? this.container.querySelector("canvas")?.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.container.replaceChildren();
  }

  private applyStyle() {
    const base = {
      stick: { stick: { radius: 0.18 } },
      "ball-and-stick": { stick: { radius: 0.14 }, sphere: { scale: 0.22 } },
      spacefill: { sphere: { scale: 1 } },
    }[this.style];
    this.viewer.setStyle({}, base);
    if (this.highlight && this.highlight.length > 0) {
      const mark =
        this.style === "spacefill"
          ? { sphere: { scale: 1, color: HIGHLIGHT } }
          : {
              stick: { radius: 0.22, color: HIGHLIGHT },
              sphere: { scale: this.style === "stick" ? 0.32 : 0.4, color: HIGHLIGHT },
            };
      this.viewer.setStyle(
        // 3Dmol matches any value in an array; its AtomSpec type says number.
        { serial: [...this.highlight] } as unknown as $3Dmol.AtomSelectionSpec,
        mark,
      );
    }
  }
}
