import * as $3Dmol from "3dmol";
import type { MoleculeStyle } from "../types";
import type { ViewerAdapter } from "./ViewerAdapter";

const HIGHLIGHT = "#ffb000";

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
  private hasModel = false;
  private highlight: readonly number[] | null = null;
  private style: MoleculeStyle = "ball-and-stick";

  // Throws if the browser can't give us a WebGL context; callers show a
  // message instead of letting the error unmount the page.
  constructor(container: HTMLElement) {
    if (!webglAvailable()) throw new Error("WebGL is not available");
    this.container = container;
    this.viewer = $3Dmol.createViewer(container, { backgroundAlpha: 0 });
  }

  load(sdf: string) {
    this.viewer.clear();
    // keepH: hydrogens stay in the model, so `serial` equals the atom's
    // position in the SDF and RDKit indices apply unchanged.
    this.viewer.addModel(sdf, "sdf", { keepH: true });
    this.hasModel = true;
    this.applyStyle();
    this.reset();
  }

  setStyle(style: MoleculeStyle) {
    this.style = style;
    if (!this.hasModel) return;
    this.applyStyle();
    this.viewer.render();
  }

  setHighlight(indices: readonly number[] | null) {
    this.highlight = indices;
    if (!this.hasModel) return;
    this.applyStyle();
    this.viewer.render();
  }

  reset() {
    this.viewer.zoomTo();
    this.viewer.render();
  }

  resize() {
    this.viewer.resize();
    this.viewer.render();
  }

  destroy() {
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
