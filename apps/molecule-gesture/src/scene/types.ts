import type { ViewState } from '../viewer/viewState';

/** One molecule on the stage. */
export interface SceneItem {
  /** Stable key (SpacetimeDB row id, or a local id in solo mode). */
  key: string;
  /** e.g. "builtin:benzene", "pubchem:2519". */
  moleculeId: string;
  /** Last published camera; null until the teacher's viewer has laid it out. */
  view: ViewState | null;
  /** What the teacher is doing with it ("ROTATE", "MOVE", "ZOOM", "IDLE"). */
  gesture: string;
  seq: number;
}

/**
 * The stage's molecules: added by voice, removed only via the trash. Backed
 * by SpacetimeDB in a classroom (shared with students) or by local state solo.
 */
export interface SceneStore {
  items: SceneItem[];
  /** False for students and for a teacher who doesn't own the room. */
  canEdit: boolean;
  add(moleculeId: string): void;
  update(key: string, view: ViewState, gesture: string): void;
  remove(key: string): void;
  lastError?: string;
}

/** Each molecule gets its own WebGL viewer; browsers cap contexts per page. */
export const MAX_SCENE_MOLECULES = 8;
