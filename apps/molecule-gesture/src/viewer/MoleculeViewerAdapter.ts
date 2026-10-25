import type { GLViewer } from '3dmol';
import type { GestureCommand } from '../gestures/types';
import type { MoleculeSource } from '../molecules/registry';
import { lerpView, rotateViewScreen, toViewState, viewDelta, type ViewState } from './viewState';

export type RenderStyle = 'ballstick' | 'stick' | 'spacefill';

export interface AdapterOptions {
  /** Time constant for easing locally issued commands (ms). */
  commandSmoothingMs: number;
  /** Time constant for easing toward a remote (teacher) view (ms). */
  followSmoothingMs: number;
  /**
   * Size limits, worked out from the molecule's own size and the viewer's:
   * at the largest, the whole molecule (in any orientation) still fits on
   * screen with this margin (fraction of the half-size) around it…
   */
  fitMargin: number;
  /** …and at the smallest, it still spans this fraction of the screen's shorter side. */
  minSizeFraction: number;
}

const DEFAULTS: AdapterOptions = {
  commandSmoothingMs: 45,
  followSmoothingMs: 90,
  fitMargin: 0.08,
  minSizeFraction: 0.1,
};

/** How far atoms are drawn beyond their centres in each style (Å), for the size limits. */
const ATOM_EXTENT: Record<RenderStyle, number> = { ballstick: 0.5, stick: 0.2, spacefill: 1.6 };

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
export function coverPointToPlacement(x: number, y: number, frameAspect: number, w: number, h: number): { x: number; y: number } {
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

/**
 * Bridges GestureCommands (from any controller) and remote view targets
 * (from SpacetimeDB) onto a 3Dmol.js viewer, using only its documented API:
 * getView / setView / zoom / zoomTo / render.
 *
 * Commands are eased over a few frames so 15–30 Hz tracking input still
 * renders as smooth 60 Hz motion; STOP flushes any remaining easing.
 */
export class MoleculeViewerAdapter {
  private readonly opts: AdapterOptions;
  private pendingDx = 0;
  private pendingDy = 0;
  private pendingDz = 0;
  private pendingLogZoom = 0;
  /** Camera distance requested by a SCALE command, eased toward each frame. */
  private targetDistance: number | null = null;
  private homeDistance: number | null = null;
  private followTarget: ViewState | null = null;
  private homeView: ViewState | null = null;
  private raf = 0;
  private lastTick = 0;
  private style: RenderStyle = 'ballstick';
  private currentMoleculeId: string | null = null;
  /** On-screen placement: rotationGroup.position.x/y in scene units (setView slots 8–9). */
  private panX = 0;
  private panY = 0;
  /** Pending PAN, in fractions of the viewer width. */
  private pendingPanX = 0;
  private pendingPanY = 0;
  private lastDistance: number | null = null;
  /** Fingertip grab: where the molecule's centre should go (viewer-widths from centre). */
  private placeTarget: { x: number; y: number } | null = null;
  private grabbed = false;
  private visible = true;
  /** Radius (Å) of the sphere around the rotation centre that holds the whole molecule as drawn. */
  private boundingRadius = 0;

  constructor(
    readonly viewer: GLViewer,
    /** The element the viewer renders into (for converting screen fractions to scene units). */
    private readonly container: HTMLElement,
    opts: Partial<AdapterOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  get moleculeId(): string | null {
    return this.currentMoleculeId;
  }

  loadMolecule(src: MoleculeSource): void {
    const v = this.viewer;
    v.removeAllModels();
    v.addModel(src.data, src.format);
    this.applyStyle();
    v.zoomTo();
    this.panX = 0;
    this.panY = 0;
    v.render();
    this.homeView = this.getView();
    this.setView(this.homeView);
    const homeDistance = CAMERA_Z - this.homeView[3];
    this.homeDistance = homeDistance;
    this.currentMoleculeId = src.id;
    this.clearPending();
    this.measure();
  }

  setStyle(style: RenderStyle): void {
    this.style = style;
    this.applyStyle();
    this.measure();
    this.viewer.render();
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
      minDistance: r / ((1 - this.opts.fitMargin) * halfSide),
      maxDistance: r / (this.opts.minSizeFraction * halfSide),
    };
  }

  /** For tests and debugging: the molecule's size, its camera distance, and the allowed range. */
  fitInfo(): { radius: number; distance: number; minDistance: number; maxDistance: number } {
    const lim = this.sizeLimits();
    return { radius: this.boundingRadius, distance: CAMERA_Z - this.getView()[3], minDistance: lim?.minDistance ?? 0, maxDistance: lim?.maxDistance ?? 0 };
  }

  /** Measure the molecule and hand the limits to 3Dmol (which then clamps every zoom, mouse wheel included). */
  private measure() {
    const model = this.viewer.getModel();
    const atoms = (model ? model.selectedAtoms({}) : []) as { x?: number; y?: number; z?: number }[];
    // 3Dmol rotates about −modelGroup.position (getView slots 0–2).
    const v = this.viewer.getView() as number[];
    let r = 0;
    for (const a of atoms) r = Math.max(r, Math.hypot((a.x ?? 0) + v[0], (a.y ?? 0) + v[1], (a.z ?? 0) + v[2]));
    this.boundingRadius = atoms.length ? r + ATOM_EXTENT[this.style] : 0;
    this.applySizeLimits();
  }

  private applySizeLimits() {
    const lim = this.sizeLimits();
    if (!lim) return;
    this.viewer.setZoomLimits(lim.minDistance, lim.maxDistance);
  }

  /** Clamp a camera distance to the size limits. */
  private clampDistance(d: number): number {
    const lim = this.sizeLimits();
    return lim ? Math.min(lim.maxDistance, Math.max(lim.minDistance, d)) : d;
  }

  /**
   * Clamp a pending zoom (log of the factor) so it ends inside the limits:
   * at the largest/smallest size, further zooming in/out simply does nothing.
   */
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
        if (cmd.factor > 0 && Number.isFinite(cmd.factor)) this.pendingLogZoom = this.clampLogZoom(this.pendingLogZoom + Math.log(cmd.factor));
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
      case 'VISIBILITY':
        this.setVisible(cmd.visible);
        break;
      case 'STOP':
        this.clearPending();
        break;
      case 'RESET':
        this.reset();
        break;
    }
  }

  /** Follow a remote view (student "Follow Teacher"). `null` releases control. */
  setFollowTarget(view: ViewState | null, immediate = false): void {
    this.followTarget = view;
    if (view) this.clearPending();
    if (view && immediate) this.setView(view);
  }

  /** Current size relative to the fitted home size (1 = home). */
  currentScale(): number {
    if (!this.homeDistance) return 1;
    return this.homeDistance / (CAMERA_Z - this.getView()[3]);
  }

  get following(): boolean {
    return this.followTarget !== null;
  }

  getView(): ViewState {
    const v = this.viewer.getView() as number[];
    return toViewState([v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], this.panX, this.panY]);
  }

  setView(view: ViewState): void {
    this.panX = view[8];
    this.panY = view[9];
    this.viewer.setView([...view]);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Fade/scale the molecule in or out. */
  setVisible(visible: boolean, durationMs = 450): void {
    if (visible === this.visible) return;
    this.visible = visible;
    const el = this.container;
    el.style.transition = `opacity ${durationMs}ms ease, transform ${Math.round(durationMs * 1.2)}ms cubic-bezier(0.2, 0.9, 0.3, 1.3)`;
    el.style.opacity = visible ? '1' : '0';
    el.style.transform = visible ? 'scale(1)' : 'scale(0.6)';
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

  /**
   * Put a freshly loaded molecule at a given size and spot (viewer-widths
   * from the centre), immediately — used when it is added to a busy stage.
   */
  layOut(scale: number, x: number, y: number): void {
    if (!this.homeDistance) return;
    const dist = this.clampDistance(this.homeDistance / scale);
    const view = this.getView();
    view[3] = CAMERA_Z - dist;
    const sw = this.sceneWidth(dist);
    view[8] = x * sw;
    view[9] = -y * sw;
    this.clearPending();
    this.setView(view);
    this.lastDistance = dist;
  }

  /** Move the molecule's centre to a spot (viewer-widths from the centre) right now (mouse drag). */
  setPlacement(x: number, y: number): void {
    const view = this.getView();
    const sw = this.sceneWidth(CAMERA_Z - view[3]);
    view[8] = x * sw;
    view[9] = -y * sw;
    this.placeTarget = null;
    this.setView(view);
  }

  /** Where the molecule sits on screen, in viewer-widths from the centre (+x right, +y down). */
  placement(): { x: number; y: number } {
    const sw = this.sceneWidth(CAMERA_Z - this.getView()[3]);
    return { x: this.panX / sw, y: -this.panY / sw };
  }

  /** Scene units spanned by the viewer's width at the molecule's depth. */
  private sceneWidth(distance: number): number {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return 2 * distance * Math.tan((FOV_DEG * Math.PI) / 360) * (w / h);
  }

  reset(): void {
    this.clearPending();
    if (this.homeView) this.setView(this.homeView);
    else {
      this.viewer.zoomTo();
      this.viewer.render();
    }
  }

  resize(): void {
    this.viewer.resize();
    // The limits depend on the viewer's size (a narrower window fits less).
    this.applySizeLimits();
    this.viewer.render();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.viewer.clear();
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

  private applyStyle() {
    const v = this.viewer;
    switch (this.style) {
      case 'stick':
        v.setStyle({}, { stick: { radius: 0.18, colorscheme: 'Jmol' } });
        break;
      case 'spacefill':
        v.setStyle({}, { sphere: { scale: 0.9, colorscheme: 'Jmol' } });
        break;
      default:
        v.setStyle({}, { stick: { radius: 0.14, colorscheme: 'Jmol' }, sphere: { scale: 0.28, colorscheme: 'Jmol' } });
    }
  }

  private tick = (now: number) => {
    const dt = Math.min(100, now - this.lastTick);
    this.lastTick = now;
    this.raf = requestAnimationFrame(this.tick);

    if (this.followTarget) {
      const current = this.getView();
      const d = viewDelta(current, this.followTarget);
      if (d > 1e-3) {
        const k = d < 0.05 ? 1 : 1 - Math.exp(-dt / this.opts.followSmoothingMs);
        this.setView(lerpView(current, this.followTarget, k));
      }
      this.lastDistance = CAMERA_Z - this.getView()[3];
      return;
    }

    const k = 1 - Math.exp(-dt / this.opts.commandSmoothingMs);
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
    }
    if (this.targetDistance !== null) {
      const current = CAMERA_Z - this.getView()[3];
      const ratio = current / this.targetDistance;
      if (Math.abs(Math.log(ratio)) < 0.002) this.targetDistance = null;
      // zoom(f) divides the camera distance by f.
      else this.viewer.zoom(Math.pow(ratio, k));
    }
    if (this.pendingLogZoom) {
      let lz = this.pendingLogZoom * k;
      if (Math.abs(this.pendingLogZoom) < 0.002) lz = this.pendingLogZoom;
      this.pendingLogZoom -= lz;
      this.viewer.zoom(Math.exp(lz));
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
    if (this.pendingPanX || this.pendingPanY) {
      let fx = this.pendingPanX * k;
      let fy = this.pendingPanY * k;
      if (Math.abs(this.pendingPanX) < 1e-4 && Math.abs(this.pendingPanY) < 1e-4) {
        fx = this.pendingPanX;
        fy = this.pendingPanY;
      }
      this.pendingPanX -= fx;
      this.pendingPanY -= fy;
      const sw = this.sceneWidth(distance);
      px += fx * sw;
      py -= fy * sw; // screen y points down, scene y up
    }
    const sw = this.sceneWidth(distance);
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
    }
  };
}
