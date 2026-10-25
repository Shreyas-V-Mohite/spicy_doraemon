// What the app needs from a molecule renderer. 3Dmol implements it today;
// another viewer (for example the teammate's MoleculeViewer) can replace it
// by implementing the same four methods.
import type { MoleculeStyle } from "../types";

export interface ViewerAdapter {
  // Replaces the shown molecule with the SDF text.
  load(sdf: string): void;
  // Highlights atoms by 0-based position in the SDF atom block, or clears.
  setHighlight(indices: readonly number[] | null): void;
  // How atoms are drawn.
  setStyle(style: MoleculeStyle): void;
  // Recentres and refits the camera.
  reset(): void;
  destroy(): void;
}
