import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechListener, speechSupported, type ListenerState, type SpeechListenerEvents } from './SpeechListener';
import { DeepgramListener } from './DeepgramListener';
import { parseMoleculeRequests, type MoleculeRequest } from './moleculeCommands';
import { findMoleculeByName, MoleculeLookupError, type PubChemHit } from '../molecules/pubchem';

export type VoiceLang = 'ko-KR' | 'en-US';

/**
 * Speech-to-text engine. Deepgram Nova-3 (through our proxy, with chemistry
 * keyterms) is the default; the browser's Web Speech API is the fallback,
 * used automatically when the proxy or its key is missing, and for Korean.
 */
export type VoiceEngine = 'deepgram' | 'browser';

/** What happened to the last phrase, step by step (for the voice debug panel). */
export interface VoiceDebug {
  /** Engine actually in use. */
  engine: VoiceEngine;
  /** Why it isn't the chosen one, if it isn't. */
  engineNote: string;
  /** Last finished phrase, exactly as transcribed. */
  raw: string;
  /** Live words (not acted on). */
  live: string;
  /** How the phrase was interpreted (rule-based parser). */
  command: string;
  /** PubChem validation result for each requested molecule. */
  validated: string[];
}

export interface MoleculeVoice {
  supported: boolean;
  listening: boolean;
  lang: VoiceLang;
  setLang(lang: VoiceLang): void;
  /** Preferred engine (the one in use may differ; see debug.engine). */
  engine: VoiceEngine;
  setEngine(engine: VoiceEngine): void;
  toggle(): void;
  /** Live words of the phrase being spoken. */
  interim: string;
  /** Last finished phrase. */
  heard: string;
  status: { kind: 'idle' | 'busy' | 'ok' | 'error'; text: string };
  debug: VoiceDebug;
  /** Handle a finished phrase as if spoken (typed fallback, tests). */
  submit(text: string, alternatives?: string[]): Promise<void>;
  /** Feed live words as if they were being spoken (tests). Never changes the scene. */
  interimHeard(text: string): void;
}

/** Live words that stood still this long start a PubChem lookup for unfamiliar names (warm-up only). */
const INTERIM_STABLE_MS = 350;
/** The recogniser may deliver the same request twice. */
const DEDUPE_MS = 4000;

function initialEngine(): VoiceEngine {
  try {
    const q = new URLSearchParams(location.search).get('stt');
    if (q === 'browser' || q === 'deepgram') return q;
  } catch {
    /* no location (tests) */
  }
  return 'deepgram';
}

function describeCommand(reqs: MoleculeRequest[]): string {
  if (!reqs.length) return 'none — not a molecule request (ignored)';
  return reqs.map((r) => (r.query ? `ADD ${r.query}` : `ADD ? ("${r.spoken}" — no English name)`)).join(', ');
}

/**
 * "show me caffeine" → finished phrase → parser → PubChem-validated molecule →
 * onPick(hit). Only finished phrases change the scene; live words are
 * captions. Phrases that aren't molecule requests are ignored, so it can
 * listen during a lecture.
 */
export function useMoleculeVoice(
  onPick: (hit: PubChemHit) => void,
  /** Listen continuously from the start ("ears always open"). Off for students. */
  opts: { enabled: boolean; alwaysListen: boolean } = { enabled: true, alwaysListen: true },
): MoleculeVoice {
  // English is the default (the class is taught in English); Korean is optional.
  const [lang, setLangState] = useState<VoiceLang>('en-US');
  const [engine, setEngineState] = useState<VoiceEngine>(initialEngine);
  const [engineNote, setEngineNote] = useState('');
  /** Deepgram turned out to be unusable here: stay on the browser engine. */
  const [deepgramDown, setDeepgramDown] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [heard, setHeard] = useState('');
  const [status, setStatus] = useState<MoleculeVoice['status']>({ kind: 'idle', text: '' });
  const [trail, setTrail] = useState<Pick<VoiceDebug, 'raw' | 'command' | 'validated'>>({ raw: '', command: '', validated: [] });
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Deepgram streams English; Korean uses the browser's recogniser.
  const active: VoiceEngine = engine === 'deepgram' && !deepgramDown && lang === 'en-US' ? 'deepgram' : 'browser';

  const recent = useRef(new Map<string, number>());

  const addAll = useCallback(async (reqs: MoleculeRequest[]) => {
    const now = Date.now();
    const note = (line: string) => setTrail((t) => ({ ...t, validated: [...t.validated, line] }));
    await Promise.all(
      reqs.map(async (req) => {
        if (!req.query) {
          setStatus({ kind: 'error', text: `I don't know the molecule "${req.spoken}" — try its English name.` });
          note(`✗ "${req.spoken}": no English name`);
          return;
        }
        const last = recent.current.get(req.query);
        if (last && now - last < DEDUPE_MS) {
          note(`· ${req.query}: just added, skipped`);
          return;
        }
        recent.current.set(req.query, now);
        // Every request adds a molecule, so lookups run independently (in parallel).
        setStatus({ kind: 'busy', text: `Looking up ${req.query}…` });
        try {
          // Validated against PubChem (bundled PubChem data for common molecules) before it is shown.
          const hit = await findMoleculeByName(req.query);
          note(`✓ ${hit.title}${hit.cid ? ` (PubChem CID ${hit.cid})` : ' (bundled)'}`);
          setStatus({ kind: 'ok', text: `Added ${hit.title}` });
          onPickRef.current(hit);
        } catch (err) {
          recent.current.delete(req.query);
          const msg = err instanceof MoleculeLookupError ? err.message : 'Could not reach PubChem (check the internet connection).';
          note(`✗ ${req.query}: ${msg}`);
          if (req.silent) return; // a bare word that merely looked chemical
          setStatus({ kind: 'error', text: msg });
        }
      }),
    );
  }, []);

  const interimTimer = useRef(0);
  const lastInterim = useRef('');

  const submit = useCallback(
    async (text: string, alternatives: string[] = []) => {
      window.clearTimeout(interimTimer.current);
      lastInterim.current = '';
      setHeard(text);
      setInterim('');
      // Use the first of the recogniser's guesses that reads as a molecule request.
      let reqs: MoleculeRequest[] = [];
      for (const candidate of [text, ...alternatives]) {
        reqs = parseMoleculeRequests(candidate);
        if (reqs.length) break;
      }
      setTrail({ raw: text, command: describeCommand(reqs), validated: [] });
      if (reqs.length) await addAll(reqs); // else ordinary speech: ignore
    },
    [addAll],
  );

  /**
   * Live words are only captions: nothing is added until the phrase is
   * final. Unfamiliar names that stand still get their PubChem lookup
   * started early (no visible effect; the final phrase reuses it).
   */
  const interimHeard = useCallback((text: string) => {
    setInterim(text);
    if (!text || text === lastInterim.current) return;
    lastInterim.current = text;
    window.clearTimeout(interimTimer.current);
    const reqs = parseMoleculeRequests(text);
    if (!reqs.length) return;
    interimTimer.current = window.setTimeout(() => {
      for (const r of reqs) if (r.query && !r.known && !r.silent) findMoleculeByName(r.query).catch(() => {});
    }, INTERIM_STABLE_MS);
  }, []);

  const listenerRef = useRef<SpeechListener | DeepgramListener | null>(null);
  useEffect(() => {
    const events: SpeechListenerEvents = {
      onFinal: (t, alts) => void submit(t, alts),
      onInterim: interimHeard,
      onState: (s: ListenerState, detail?: string) => {
        // Still "listening" while it retries after a hiccup.
        setListening(l.listening);
        if (s === 'error' && detail) setStatus({ kind: 'error', text: detail });
        else if (s === 'listening') setStatus((st) => (st.kind === 'error' ? { kind: 'idle', text: '' } : st));
      },
    };
    const l =
      active === 'deepgram'
        ? new DeepgramListener({
            ...events,
            onUnavailable: (reason) => {
              console.warn('[voice] Deepgram unavailable, using browser speech recognition:', reason);
              setEngineNote(`Deepgram unavailable (${reason}) — using the browser's speech recognition`);
              setDeepgramDown(true);
            },
          })
        : new SpeechListener(events, lang);
    listenerRef.current = l;
    if (opts.enabled && opts.alwaysListen) l.start();
    return () => {
      window.clearTimeout(interimTimer.current);
      l.stop();
    };
    // Language changes go through setLanguage; a new engine makes a new listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, submit, interimHeard, opts.enabled, opts.alwaysListen]);

  const setLang = useCallback((l: VoiceLang) => {
    setLangState(l);
    listenerRef.current?.setLanguage(l);
  }, []);

  const setEngine = useCallback((e: VoiceEngine) => {
    setEngineState(e);
    // Choosing Deepgram again retries it.
    if (e === 'deepgram') {
      setDeepgramDown(false);
      setEngineNote('');
    }
  }, []);

  const toggle = useCallback(() => {
    const l = listenerRef.current;
    if (!l) return;
    if (l.listening) {
      l.stop();
      setInterim('');
    } else {
      setStatus({ kind: 'idle', text: '' });
      l.start();
    }
  }, []);

  return {
    supported: active === 'deepgram' || speechSupported(),
    listening,
    lang,
    setLang,
    engine,
    setEngine,
    toggle,
    interim,
    heard,
    status,
    debug: { engine: active, engineNote: active !== engine ? engineNote || (lang !== 'en-US' ? 'Korean uses the browser engine' : '') : '', live: interim, ...trail },
    submit,
    interimHeard,
  };
}
