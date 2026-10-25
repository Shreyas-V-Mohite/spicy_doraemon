import type { GestureCommand } from '../gestures/types';
import { rotateViewScreen, toViewState, type ViewState } from './viewState';

/**
 * Applies GestureCommands (rotate, zoom, size, move, reset) to a 3Dmol viewer.
 *
 * Ported from the gesture lab's MoleculeViewerAdapter (the same easing, size
 * limits and fingertip placement), minus the parts that belong to the host
 * app: it does not load molecules, choose styles, follow a remote view or
 * fade the molecule. The host owns the one 3Dmol viewer and its rendering;
 * this class only moves the camera. Call modelChanged() after the host loads
 * a molecule and styleChanged() after it changes the drawing style.
 */

/** Drawing styles the size limits know about (how far atoms extend past their centres). */
export type MotionStyle = 'ball-and-stick' | 'stick' | 'spacefill';

/** The parts of a 3Dmol viewer this class uses (so tests can supply a fake). */
export interface MotionViewer {
  getView(): number[];
  setView(view: number[]): void;
  zoom(factor: number): void;
  zoomTo(): void;
  render(): void;
  setZoomLimits(min: number, max: number): void;
  getModel(): { selectedAtoms(sel: object): { x?: number; y?: number; z?: number }[] } | null | undefined;
}

/** The parts of the viewer's container this class uses. */
export interface MotionBox {
  clientWidth: number;
  clientHeight: number;
}

export interface MotionOptions {
  /** Time constant for easing commands (ms). */
  commandSmoothingMs: number;
  /** At the largest size the whole molecule fits with this margin (fraction of the half-size). */
  fitMargin: number;
  /** At the smallest size the molecule still spans this fraction of the screen's shorter side. */
  minSizeFraction: number;
  /** At the largest size the molecule may span this many screens (1 = just fits). */
  maxFill: number;
  /** Run the easing loop on requestAnimationFrame. Tests turn this off and call step(). */
  autoTick: boolean;
}

const DEFAULTS: MotionOptions = {
  commandSmoothingMs: 45,
  fitMargin: 0.08,
  minSizeFraction: 0.1,
  maxFill: 1,
  autoTick: true,
};

const ATOM_EXTENT: Record<MotionStyle, number> = { 'ball-and-stick': 0.5, stick: 0.2, spacefill: 1.6 };

/** 3Dmol's fixed camera position along +z, and its default vertical field of view. */
const CAMERA_Z = 150;
const FOV_DEG = 20;
/** How far from the centre the molecule may be moved, as a fraction of the half-size. */
const MAX_PAN = 0.9;

/**
 * Map a pointer in camera-frame coordinates (0–1, as displayed) to a spot on
 * a viewer of size w×h that shows that camera with object-fit: cover.
 * Result is in viewer-widths from the centre (+x right, +y down).
 */
export function coverPointToPlacement(
  x: number,
  y: number,
  frameAspect: number,
  w: number,
  h: number,
): { x: number; y: number } {
  let dispW = w;
  let dispH = w / frameAspect;
  if (dispH < h) {
    dispH = h;
    dispW = h * frameAspect;
  }
  const px = (w - dispW) / 2 + x * dispW;
  const py = (h - dispH) / 2 + y * dispH;
  return { x: (px - w / 2) / w, y: (py - h / 2) / w };
}

export class ViewMotion {
  private readonly opts: MotionOptions;
  private pendingDx = 0;
  private pendingDy = 0;
  private pendingDz = 0;
  private pendingLogZoom = 0;
  /** Camera distance requested by a SCALE command, eased toward each frame. */
  private targetDistance: number | null = null;
  private homeDistance: number | null = null;
  private homeView: ViewState | null = null;
  private raf = 0;
  private lastTick = 0;
  private style: MotionStyle = 'ball-and-stick';
  /** On-screen placement: rotationGroup.position.x/y in scene units (setView slots 8–9). */
  private panX = 0;
  private panY = 0;
  private pendingPanX = 0;
  private pendingPanY = 0;
  private lastDistance: number | null = null;
  /** Fingertip grab: where the molecule's centre should go (viewer-widths from centre). */
  private placeTarget: { x: number; y: number } | null = null;
  private grabbed = false;
  /** Radius (Å) of the sphere around the rotation centre that holds the whole molecule as drawn. */
  private boundingRadius = 0;

  private readonly viewer: MotionViewer;
  private readonly container: MotionBox;

  constructor(viewer: MotionViewer, container: MotionBox, opts: Partial<MotionOptions> = {}) {
    this.viewer = viewer;
    this.container = container;
    this.opts = { ...DEFAULTS, ...opts };
    if (this.opts.autoTick && typeof requestAnimationFrame === 'function') {
      this.lastTick = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** The host loaded a new molecule (and called zoomTo): remember this as home. */
  modelChanged(style: MotionStyle): void {
    this.style = style;
    this.panX = 0;
    this.panY = 0;
    this.homeView = this.getView();
    this.setView(this.homeView);
    this.homeDistance = CAMERA_Z - this.homeView[3];
    this.lastDistance = null;
    this.clearPending();
    this.measure();
  }

  /** The host changed how atoms are drawn: the size limits change with it. */
  styleChanged(style: MotionStyle): void {
    this.style = style;
    this.measure();
  }

  /**
   * Camera distances that keep the molecule between "spans minSizeFraction
   * of the screen" and "fills the screen, less fitMargin". Uses the bounding
   * sphere, so it holds in every orientation, for small and large molecules,
   * at any viewer size.
   */
  sizeLimits(): { minDistance: number; maxDistance: number } | null {
    const r = this.boundingRadius;
    if (!r) return null;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    // Half the shorter side of the screen, per unit of camera distance.
    const halfSide = Math.tan((FOV_DEG * Math.PI) / 360) * Math.min(1, w / h);
    return {
      minDistance: r / ((1 - this.opts.fitMargin) * this.opts.maxFill * halfSide),
      maxDistance: r / (this.opts.minSizeFraction * halfSide),
    };
  }

  /** Measure the molecule and hand the limits to 3Dmol (which then clamps every zoom, mouse wheel included). */
  private measure() {
    const model = this.viewer.getModel();
    const atoms = model ? model.selectedAtoms({}) : [];
    // 3Dmol rotates about −modelGroup.position (getView slots 0–2).
    const v = this.viewer.getView();
    let r = 0;
    for (const a of atoms) r = Math.max(r, Math.hypot((a.x ?? 0) + v[0], (a.y ?? 0) + v[1], (a.z ?? 0) + v[2]));
    this.boundingRadius = atoms.length ? r + ATOM_EXTENT[this.style] : 0;
    this.applySizeLimits();
  }

  private applySizeLimits() {
    const lim = this.sizeLimits();
    if (lim) this.viewer.setZoomLimits(lim.minDistance, lim.maxDistance);
  }

  private clampDistance(d: number): number {
    const lim = this.sizeLimits();
    return lim ? Math.min(lim.maxDistance, Math.max(lim.minDistance, d)) : d;
  }

  /** Clamp a pending zoom (log of the factor) so it ends inside the limits. */
  private clampLogZoom(lz: number): number {
    const lim = this.sizeLimits();
    if (!lim) return lz;
    const d = CAMERA_Z - this.getView()[3]; // zoom(f) divides this by f
    const lo = Math.min(0, Math.log(d / lim.maxDistance));
    const hi = Math.max(0, Math.log(d / lim.minDistance));
    return Math.min(hi, Math.max(lo, lz));
  }

  applyCommand(cmd: GestureCommand): void {
    switch (cmd.type) {
      case 'ROTATE':
        this.pendingDx += cmd.dx;
        this.pendingDy += cmd.dy;
        this.pendingDz += cmd.dz ?? 0;
        break;
      case 'ZOOM':
        if (cmd.factor > 0 && Number.isFinite(cmd.factor)) {
          this.pendingLogZoom = this.clampLogZoom(this.pendingLogZoom + Math.log(cmd.factor));
        }
        this.targetDistance = null;
        break;
      case 'SCALE':
        if (cmd.scale > 0 && Number.isFinite(cmd.scale) && this.homeDistance) {
          this.targetDistance = this.clampDistance(this.homeDistance / cmd.scale);
          this.pendingLogZoom = 0;
        }
        break;
      case 'PAN':
        if (Number.isFinite(cmd.dx) && Number.isFinite(cmd.dy)) {
          this.pendingPanX += cmd.dx;
          this.pendingPanY += cmd.dy;
        }
        break;
      case 'PLACE':
        this.place(cmd.x, cmd.y, cmd.frameAspect);
        break;
      case 'STOP':
        this.clearPending();
        break;
      case 'RESET':
        this.reset();
        break;
      // VISIBILITY and SNAP belong to the lab's multi-molecule scene; one
      // molecule on one stage has nothing to show, hide or pick.
    }
  }

  /** Current size relative to the fitted home size (1 = home). */
  currentScale(): number {
    if (!this.homeDistance) return 1;
    return this.homeDistance / (CAMERA_Z - this.getView()[3]);
  }

  getView(): ViewState {
    const v = this.viewer.getView();
    return toViewState([v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], this.panX, this.panY]);
  }

  private setView(view: ViewState): void {
    this.panX = view[8];
    this.panY = view[9];
    this.viewer.setView([...view]);
  }

  /** True while a fingertip is holding the molecule. */
  get isGrabbed(): boolean {
    return this.grabbed;
  }

  /**
   * A pointer in camera-frame coordinates (0–1, mirrored as displayed). The
   * webcam backdrop fills the viewer with object-fit: cover, so map through
   * the same crop to get the screen point under the fingertip.
   */
  private place(x: number, y: number, frameAspect: number) {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const target = coverPointToPlacement(x, y, frameAspect, w, h);
    if (!this.grabbed) {
      // Only grab when the finger is actually pointing at the molecule.
      const p = this.placement();
      if (Math.hypot(target.x - p.x, target.y - p.y) * w > this.grabRadiusPx()) return;
      this.grabbed = true;
    }
    this.placeTarget = target;
  }

  /** How close (px) a pointer must be to the molecule's centre to grab it. */
  grabRadiusPx(): number {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return Math.max(0.08 * w, 0.42 * Math.min(w, h) * this.currentScale());
  }

  /** Where the molecule sits on screen, in viewer-widths from the centre (+x right, +y down). */
  placement(): { x: number; y: number } {
    const sw = this.sceneWidth(CAMERA_Z - this.getView()[3]);
    return { x: this.panX / sw, y: -this.panY / sw + 0 }; // + 0 turns -0 into 0
  }

  /** Scene units spanned by the viewer's width at the molecule's depth. */
  private sceneWidth(distance: number): number {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return 2 * distance * Math.tan((FOV_DEG * Math.PI) / 360) * (w / h);
  }

  /** Back to the fitted size, orientation and centre the molecule had when loaded. */
  reset(): void {
    this.clearPending();
    if (this.homeView) this.setView(this.homeView);
    else {
      this.viewer.zoomTo();
      this.viewer.render();
    }
  }

  /** The viewer's size changed: the limits depend on it. */
  resize(): void {
    this.applySizeLimits();
  }

  dispose(): void {
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private clearPending() {
    this.pendingDx = 0;
    this.pendingDy = 0;
    this.pendingDz = 0;
    this.pendingLogZoom = 0;
    this.pendingPanX = 0;
    this.pendingPanY = 0;
    this.targetDistance = null;
    this.placeTarget = null;
    this.grabbed = false;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = now - this.lastTick;
    this.lastTick = now;
    this.step(dt);
  };

  /** Advance the easing by dtMs. Called every animation frame; tests call it directly. */
  step(dtMs: number): void {
    const dt = Math.min(100, dtMs);
    const k = 1 - Math.exp(-dt / this.opts.commandSmoothingMs);
    let changed = false;

    if (this.pendingDx || this.pendingDy || this.pendingDz) {
      let dx = this.pendingDx * k;
      let dy = this.pendingDy * k;
      let dz = this.pendingDz * k;
      if (Math.abs(this.pendingDx) < 0.05 && Math.abs(this.pendingDy) < 0.05 && Math.abs(this.pendingDz) < 0.05) {
        dx = this.pendingDx;
        dy = this.pendingDy;
        dz = this.pendingDz;
      }
      this.pendingDx -= dx;
      this.pendingDy -= dy;
      this.pendingDz -= dz;
      this.setView(rotateViewScreen(this.getView(), dx, dy, dz));
      changed = true;
    }
    if (this.targetDistance !== null) {
      const current = CAMERA_Z - this.getView()[3];
      const ratio = current / this.targetDistance;
      if (Math.abs(Math.log(ratio)) < 0.002) this.targetDistance = null;
      // zoom(f) divides the camera distance by f.
      else {
        this.viewer.zoom(Math.pow(ratio, k));
        changed = true;
      }
    }
    if (this.pendingLogZoom) {
      let lz = this.pendingLogZoom * k;
      if (Math.abs(this.pendingLogZoom) < 0.002) lz = this.pendingLogZoom;
      this.pendingLogZoom -= lz;
      this.viewer.zoom(Math.exp(lz));
      changed = true;
    }

    // Placement: keep the molecule at the same spot on screen when it is
    // resized (perspective would otherwise push it outward), then apply PAN.
    const view = this.getView();
    const distance = CAMERA_Z - view[3];
    let px = this.panX;
    let py = this.panY;
    if (this.lastDistance && distance !== this.lastDistance) {
      px *= distance / this.lastDistance;
      py *= distance / this.lastDistance;
    }
    this.lastDistance = distance;
    const sw = this.sceneWidth(distance);
    if (this.pendingPanX || this.pendingPanY) {
      let fx = this.pendingPanX * k;
      let fy = this.pendingPanY * k;
      if (Math.abs(this.pendingPanX) < 1e-4 && Math.abs(this.pendingPanY) < 1e-4) {
        fx = this.pendingPanX;
        fy = this.pendingPanY;
      }
      this.pendingPanX -= fx;
      this.pendingPanY -= fy;
      px += fx * sw;
      py -= fy * sw; // screen y points down, scene y up
    }
    if (this.placeTarget) {
      // Glide the molecule's centre onto the fingertip.
      const tx = this.placeTarget.x * sw;
      const ty = -this.placeTarget.y * sw;
      px += (tx - px) * k;
      py += (ty - py) * k;
    }
    // Keep the whole molecule on screen (with the margin): its centre may go
    // only as far as its bounding sphere allows. A big molecule has little room.
    const aspect = (this.container.clientHeight || 1) / (this.container.clientWidth || 1);
    const halfW = sw / 2;
    const halfH = (sw * aspect) / 2;
    const keep = this.boundingRadius + this.opts.fitMargin * Math.min(halfW, halfH);
    const maxX = Math.max(0, Math.min(MAX_PAN * halfW, halfW - keep));
    const maxY = Math.max(0, Math.min(MAX_PAN * halfH, halfH - keep));
    px = Math.max(-maxX, Math.min(maxX, px));
    py = Math.max(-maxY, Math.min(maxY, py));
    if (px !== this.panX || py !== this.panY) {
      view[8] = px;
      view[9] = py;
      this.setView(view);
      changed = true;
    }
    if (changed) this.viewer.render();
  }
}
