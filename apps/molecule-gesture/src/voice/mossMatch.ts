/**
 * Moss (moss.dev) semantic search over the bundled molecules, so a request
 * can name a molecule indirectly: "show me the molecule in coffee",
 * "Tylenol", "vitamin C", "the sugar in milk". The index is built once by
 * scripts/moss-index.ts. In the browser Moss downloads the index and a small
 * embedding model, then answers queries locally in a few milliseconds.
 *
 * Off unless VITE_MOSS_PROJECT_ID and VITE_MOSS_PROJECT_KEY are set (e.g. in
 * .env.local); without them voice works exactly as before (dictionary +
 * PubChem). The SDK is loaded lazily, so it costs nothing when off.
 *
 * Note: the project key ends up in the page. Fine for a demo; for
 * production Moss supports a backend that hands out short-lived tokens.
 */
import type { MossClient } from '@moss-dev/moss-web';

export const MOSS_INDEX = 'molecules';

/**
 * Minimum similarity to act on. A clear request ("show me …") with a name the
 * dictionary doesn't know takes a looser match; a loose phrase ("let's look
 * at …") or no request verb needs a confident one, so lecturing isn't
 * mistaken for a request.
 */
export const MOSS_MIN_SCORE = { request: 0.45, loose: 0.6 };

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const PROJECT_ID = env.VITE_MOSS_PROJECT_ID;
const PROJECT_KEY = env.VITE_MOSS_PROJECT_KEY;

export function mossEnabled(): boolean {
  return !!(PROJECT_ID && PROJECT_KEY);
}

export interface MossHit {
  /** Dictionary name, to look up like any spoken name. */
  name: string;
  title: string;
  score: number;
}

let ready: Promise<MossClient | null> | null = null;

/** Start loading the SDK, the index and the embedding model (once). Resolves null when off or unavailable. */
export function preloadMoss(): Promise<MossClient | null> {
  if (!mossEnabled()) return Promise.resolve(null);
  if (!ready) {
    ready = (async () => {
      try {
        const { MossClient } = await import('@moss-dev/moss-web');
        const client = new MossClient(PROJECT_ID!, PROJECT_KEY!);
        await client.loadIndex(MOSS_INDEX);
        // The first text query downloads the embedding model; do it now, not mid-sentence.
        await client.query(MOSS_INDEX, 'caffeine', { topK: 1 });
        console.info('[moss] molecule index ready');
        return client;
      } catch (err) {
        console.warn('[moss] unavailable, using the dictionary only:', err);
        return null;
      }
    })();
  }
  return ready;
}

/** Best molecule for a phrase, or null (Moss off, not loaded, or nothing close). */
export async function mossFindMolecule(phrase: string, minScore: number): Promise<MossHit | null> {
  const client = await preloadMoss();
  if (!client || !phrase.trim()) return null;
  try {
    const r = await client.query(MOSS_INDEX, phrase, { topK: 1 });
    const d = r.docs[0];
    if (!d || d.score < minScore || !d.metadata?.name) return null;
    return { name: d.metadata.name, title: d.metadata.title ?? d.metadata.name, score: d.score };
  } catch (err) {
    console.warn('[moss] query failed:', err);
    return null;
  }
}
