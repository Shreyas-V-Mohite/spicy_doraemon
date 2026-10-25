/**
 * Pure helpers for the speech-to-text proxy (server/stt-proxy.ts):
 * Deepgram keyterms, the streaming URL, and short-lived connection tickets.
 * Kept free of I/O so they can be unit-tested.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { COMMON_MOLECULES } from '../src/voice/moleculeCommands';

/**
 * Terms Nova-3 should expect (Keyterm Prompting). Deepgram caps the total at
 * 500 tokens and suggests a few dozen terms; we use ~220 (our estimate), so
 * even a stricter tokenizer stays under the cap. Order matters: the hardest names first,
 * then the rest of the voice dictionary while the budget lasts.
 */
export const PRIORITY_KEYTERMS = [
  'buckminsterfullerene', 'fullerene', 'cyclohexane', 'cyclohexene', 'cyclopentane', 'cyclopropane', 'cyclobutane',
  'benzene', 'ethanol', 'caffeine', 'naphthalene', 'anthracene', 'pyridine', 'pyrrole', 'pyrimidine', 'imidazole',
  'thiophene', 'tetrahydrofuran', 'dimethyl sulfoxide', 'acetaldehyde', 'formaldehyde', 'benzaldehyde',
  'cyclohexanone', 'acetic anhydride', 'methyl salicylate', 'salicylic acid', 'acetaminophen', 'ibuprofen',
  'isopropanol', 'dichloromethane', 'carbon tetrachloride', 'nitrobenzene', 'chlorobenzene', 'trimethylamine',
];

/** Rough token count of a keyterm (Deepgram counts sub-word tokens; ~4 characters each, per word). */
export function estimateTokens(term: string): number {
  return term.split(/\s+/).reduce((n, w) => n + Math.max(1, Math.ceil(w.length / 4)), 0);
}

export function chemistryKeyterms(budget = 220): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of [...PRIORITY_KEYTERMS, ...COMMON_MOLECULES]) {
    const term = t.toLowerCase();
    if (out.includes(term)) continue;
    const cost = estimateTokens(term);
    if (used + cost > budget) continue;
    out.push(term);
    used += cost;
  }
  return out;
}

export const DEEPGRAM_LISTEN_URL = 'wss://api.deepgram.com/v1/listen';

/**
 * Nova-3 streaming: interim results for live captions, final segments once
 * Deepgram is sure, utterance boundaries after ~300 ms of silence (speech_final)
 * or 1 s without words (UtteranceEnd). Audio is WebM/Opus from MediaRecorder,
 * which Deepgram detects from the container (no encoding parameters).
 */
export function deepgramUrl(base: string, language: string, keyterms: string[]): string {
  const u = new URL(base);
  const p = u.searchParams;
  p.set('model', 'nova-3');
  p.set('language', language);
  p.set('smart_format', 'true');
  p.set('interim_results', 'true');
  p.set('endpointing', '300');
  p.set('utterance_end_ms', '1000');
  p.set('vad_events', 'true');
  for (const k of keyterms) p.append('keyterm', k);
  return u.toString();
}

/**
 * Connection tickets: the browser asks the proxy (same origin) for a ticket,
 * then opens the audio WebSocket with it. Signed with a per-process secret,
 * valid for `ttlMs`. Together with the Origin check this keeps other sites
 * (and anyone without the page) from spending our Deepgram credits.
 */
export class TicketSigner {
  private readonly secret: Buffer;

  constructor(secret?: string, private readonly ttlMs = 60_000) {
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  issue(now = Date.now()): { ticket: string; expiresIn: number } {
    const exp = now + this.ttlMs;
    const nonce = randomBytes(8).toString('hex');
    const body = `${exp}.${nonce}`;
    return { ticket: `${body}.${this.sign(body)}`, expiresIn: Math.round(this.ttlMs / 1000) };
  }

  verify(ticket: string | null | undefined, now = Date.now()): boolean {
    if (!ticket) return false;
    const parts = ticket.split('.');
    if (parts.length !== 3) return false;
    const [exp, nonce, sig] = parts;
    if (!(Number(exp) > now)) return false;
    const want = Buffer.from(this.sign(`${exp}.${nonce}`));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}

/** Origins allowed to use the proxy (the app's own). */
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return !!origin && allowed.includes(origin);
}
