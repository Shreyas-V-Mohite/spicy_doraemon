import { HandKp, type HandObservation } from './types';

/**
 * Picks the teacher's hands out of everything the camera sees.
 *
 * In a classroom other people's hands show up too. The teacher stands
 * closest to the laptop, so their hands look biggest: we take the largest
 * hand, plus at most one more hand that belongs to the same person (similar
 * size, nearby, ideally the other handedness). Everyone else is ignored.
 *
 * Each chosen hand keeps a stable slot (0 or 1) while it stays in view, so
 * the gesture pipeline per slot sees one continuous hand.
 */
export interface HandSelectorConfig {
  /** A second hand counts as the same person's if its size is within this ratio. */
  partnerMinSizeRatio: number;
  /** … and its palm is within this many hand sizes of the first hand's. */
  partnerMaxDistance: number;
  /** Keep following the current person unless someone's hand is 1/this × bigger. */
  keepPersonRatio: number;
  /** A hand is the same as last frame's if it moved less than this many hand sizes. */
  matchDistance: number;
  /** A slot is held this long for a hand that went out of view. */
  forgetMs: number;
}

export const DEFAULT_SELECTOR_CONFIG: HandSelectorConfig = {
  partnerMinSizeRatio: 0.6,
  partnerMaxDistance: 7,
  keepPersonRatio: 0.7,
  matchDistance: 1.5,
  forgetMs: 600,
};

export const HAND_SLOTS = 2;

export interface ChosenHand {
  slot: number;
  hand: HandObservation;
  /** Palm size in pixels. */
  size: number;
  /** Not the hand that held this slot before: the slot's gesture state must start over. */
  fresh: boolean;
}

export interface HandSelection {
  /** Primary hand first. */
  chosen: ChosenHand[];
  ignored: HandObservation[];
}

const PALM = [HandKp.WRIST, HandKp.INDEX_MCP, HandKp.MIDDLE_MCP, HandKp.RING_MCP, HandKp.PINKY_MCP];

/**
 * Palm size in image pixels: the largest distance between palm landmarks.
 * Unlike the hand's bounding box it doesn't change when the fingers close.
 */
export function palmSizePx(hand: HandObservation): number {
  let best = 0;
  for (let i = 0; i < PALM.length; i++) {
    for (let j = i + 1; j < PALM.length; j++) {
      const a = hand.keypoints[PALM[i]];
      const b = hand.keypoints[PALM[j]];
      best = Math.max(best, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return best;
}

function palmCentre(hand: HandObservation): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += hand.keypoints[i].x;
    y += hand.keypoints[i].y;
  }
  return { x: x / PALM.length, y: y / PALM.length };
}

interface Track {
  slot: number;
  x: number;
  y: number;
  size: number;
  seenAt: number;
}

interface Candidate {
  hand: HandObservation;
  size: number;
  x: number;
  y: number;
  track: Track | null;
}

export class HandSelector {
  readonly config: HandSelectorConfig;
  private tracks: Track[] = [];

  constructor(config: Partial<HandSelectorConfig> = {}) {
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
  }

  reset(): void {
    this.tracks = [];
  }

  select(hands: HandObservation[], t: number): HandSelection {
    const c = this.config;
    this.tracks = this.tracks.filter((tr) => t - tr.seenAt <= c.forgetMs);
    if (!hands.length) return { chosen: [], ignored: [] };

    const cands: Candidate[] = hands.map((hand) => ({ hand, size: Math.max(1, palmSizePx(hand)), ...palmCentre(hand), track: null }));

    // Re-identify last frame's hands by position (nearest first).
    const pairs: { cand: Candidate; track: Track; d: number }[] = [];
    for (const cand of cands) {
      for (const track of this.tracks) {
        const d = Math.hypot(cand.x - track.x, cand.y - track.y) / Math.max(cand.size, track.size);
        if (d <= c.matchDistance) pairs.push({ cand, track, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedTracks = new Set<Track>();
    for (const p of pairs) {
      if (p.cand.track || usedTracks.has(p.track)) continue;
      p.cand.track = p.track;
      usedTracks.add(p.track);
    }

    // The person: the biggest hand — but stay with the current person unless
    // someone else's hand is clearly bigger (no flipping between two people).
    const bySize = [...cands].sort((a, b) => b.size - a.size);
    const biggest = bySize[0];
    const current = bySize.find((x) => x.track);
    const primary = current && current.size >= c.keepPersonRatio * biggest.size ? current : biggest;

    // Their other hand, if it's in view.
    let partner: Candidate | null = null;
    let bestScore = -Infinity;
    for (const cand of cands) {
      if (cand === primary) continue;
      const ratio = cand.size / primary.size;
      if (ratio < c.partnerMinSizeRatio || ratio > 1 / c.partnerMinSizeRatio) continue;
      const dist = Math.hypot(cand.x - primary.x, cand.y - primary.y) / primary.size;
      if (dist > c.partnerMaxDistance) continue;
      const opposite = !!cand.hand.handedness && !!primary.hand.handedness && cand.hand.handedness !== primary.hand.handedness;
      const score = -Math.abs(Math.log(ratio)) + (opposite ? 0.3 : 0) + (cand.track ? 0.4 : 0) - 0.02 * dist;
      if (score > bestScore) {
        bestScore = score;
        partner = cand;
      }
    }

    const picked = partner ? [primary, partner] : [primary];
    const taken = new Set(picked.filter((p) => p.track).map((p) => p.track!.slot));
    const chosen: ChosenHand[] = picked.map((p) => {
      let slot = p.track?.slot;
      if (slot === undefined) {
        // A new hand: a free slot, preferring one no recently-seen hand holds.
        const free = [...Array(HAND_SLOTS).keys()].filter((s) => !taken.has(s));
        slot = free.find((s) => !this.tracks.some((tr) => tr.slot === s)) ?? free[0];
        taken.add(slot);
      }
      return { slot, hand: p.hand, size: p.size, fresh: !p.track };
    });

    // Chosen hands refresh their slot; unseen hands keep theirs for a while.
    const chosenSlots = new Set(chosen.map((ch) => ch.slot));
    this.tracks = [
      ...picked.map((p, i) => ({ slot: chosen[i].slot, x: p.x, y: p.y, size: p.size, seenAt: t })),
      ...this.tracks.filter((tr) => !usedTracks.has(tr) && !chosenSlots.has(tr.slot)),
    ];
    return { chosen, ignored: cands.filter((x) => !picked.includes(x)).map((x) => x.hand) };
  }
}
