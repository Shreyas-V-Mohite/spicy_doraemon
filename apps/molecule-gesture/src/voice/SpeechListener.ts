/**
 * Continuous speech recognition via the browser's Web Speech API (Chrome /
 * Edge; audio is processed by the browser vendor's speech service, so it
 * needs a network connection). Chrome ends a session after silence or ~60 s;
 * this wrapper restarts it until stop() is called.
 */

interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [i: number]: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return recognitionCtor() !== null;
}

export type ListenerState = 'off' | 'listening' | 'error';

export interface SpeechListenerEvents {
  /** A finished phrase, plus the recogniser's other guesses (best first). */
  onFinal(text: string, alternatives: string[]): void;
  /** Words so far in the current phrase (for live captions). */
  onInterim?(text: string): void;
  onState?(state: ListenerState, detail?: string): void;
}

export class SpeechListener {
  private rec: Recognition | null = null;
  private wanted = false;

  constructor(
    private readonly events: SpeechListenerEvents,
    private lang = 'en-US',
  ) {}

  get listening(): boolean {
    return this.wanted;
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    if (this.wanted) {
      // Restart with the new language.
      this.rec?.stop();
    }
  }

  start(): void {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.events.onState?.('error', 'Speech recognition is not supported in this browser (use Chrome or Edge).');
      return;
    }
    this.wanted = true;
    this.open(Ctor);
  }

  stop(): void {
    this.wanted = false;
    this.rec?.stop();
    this.rec = null;
    this.events.onState?.('off');
  }

  private open(Ctor: RecognitionCtor) {
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    // Chemical names are often mis-heard; the 2nd/3rd guess is frequently right.
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          const alts: string[] = [];
          for (let a = 0; a < r.length; a++) alts.push(r[a].transcript.trim());
          if (text) this.events.onFinal(text, alts);
        } else interim += text + ' ';
      }
      this.events.onInterim?.(interim.trim());
    };
    let retryDelay = 0;
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // normal; onend restarts
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        // Can't recover by retrying: needs the user (permission / microphone).
        this.wanted = false;
        this.events.onState?.(
          'error',
          e.error === 'audio-capture' ? 'No microphone found.' : 'Microphone permission was denied — allow it and click the mic.',
        );
        return;
      }
      // e.g. 'network': keep the ears open, but don't hammer the service.
      retryDelay = Math.min(5000, (this.failures = this.failures + 1) * 1000);
      this.events.onState?.('error', `Speech recognition hiccup (${e.error}) — retrying…`);
    };
    rec.onresult = ((orig) => (e: RecognitionEvent) => {
      this.failures = 0;
      orig?.(e);
    })(rec.onresult);
    rec.onend = () => {
      if (!this.wanted || this.rec !== rec) return;
      // Chrome ends sessions after silence or ~60 s; reopen to keep listening.
      if (retryDelay) setTimeout(() => this.wanted && this.rec === rec && this.open(Ctor), retryDelay);
      else this.open(Ctor);
    };
    this.rec = rec;
    try {
      rec.start();
      this.events.onState?.('listening');
    } catch (err) {
      this.events.onState?.('error', err instanceof Error ? err.message : String(err));
    }
  }

  private failures = 0;
}
