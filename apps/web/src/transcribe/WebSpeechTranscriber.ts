import type { Transcriber, TranscriberEvents } from "./Transcriber";

// The parts of the browser's SpeechRecognition we use (TypeScript's DOM
// types don't include it everywhere).
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
export interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
export type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FATAL_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in the browser's site settings.",
  "service-not-allowed": "This browser blocked the speech service.",
  "audio-capture": "No microphone was found.",
  "language-not-supported": "Speech recognition doesn't support this language.",
};

// A session that ends this fast without producing text counts as a failure.
const QUICK_END_MS = 2500;
const MAX_QUICK_FAILURES = 4;
const BASE_RESTART_MS = 400;
const MAX_RESTART_MS = 8000;

const log = (...args: unknown[]) => console.debug("[transcriber]", ...args);

// Chrome ends recognition by itself after silence or about a minute, so it is
// restarted for as long as the professor wants it on. Restarts back off, and
// repeated instant failures stop with the reason instead of looping.
export class WebSpeechTranscriber implements Transcriber {
  private events: TranscriberEvents;
  private ctor: RecognitionCtor | null = recognitionCtor();
  private recognition: Recognition | null = null;
  private wanted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private gotResult = false;
  private quickFailures = 0;
  private lastError = "";

  constructor(events: TranscriberEvents) {
    this.events = events;
  }

  get supported() {
    return this.ctor !== null;
  }

  start() {
    if (!this.ctor) {
      this.events.onStatus("unsupported", "This browser has no speech recognition. Use Google Chrome.");
      return;
    }
    this.wanted = true;
    this.quickFailures = 0;
    this.lastError = "";
    this.open();
  }

  stop() {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.recognition?.stop();
    this.recognition = null;
    this.events.onInterim("");
    this.events.onStatus("off");
  }

  private giveUp(reason: string) {
    log("giving up:", reason);
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.recognition = null;
    this.events.onInterim("");
    this.events.onStatus("error", reason);
  }

  private open() {
    if (!this.ctor || !this.wanted || this.recognition) return;
    const r = new this.ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => {
      log("started");
      this.startedAt = Date.now();
      this.gotResult = false;
      this.events.onStatus("listening");
    };
    r.onresult = (e) => {
      this.gotResult = true;
      this.quickFailures = 0;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (text) this.events.onFinal(text);
        } else {
          interim += text + " ";
        }
      }
      this.events.onInterim(interim.trim());
    };
    r.onerror = (e) => {
      log("error:", e.error);
      this.lastError = e.error;
      const fatal = FATAL_ERRORS[e.error];
      if (fatal) this.giveUp(fatal);
      // "no-speech" and "aborted" are normal; "network" is retried with a
      // backoff in onend and reported if it keeps happening.
    };
    r.onend = () => {
      const lived = Date.now() - this.startedAt;
      log("ended after", lived, "ms; result:", this.gotResult, "error:", this.lastError || "none");
      this.recognition = null;
      this.events.onInterim("");
      if (!this.wanted) return;

      // Silence timeouts are normal; instant endings with no text are not.
      if (lived < QUICK_END_MS && !this.gotResult && this.lastError !== "no-speech") {
        this.quickFailures += 1;
      } else {
        this.quickFailures = 0;
      }
      if (this.quickFailures >= MAX_QUICK_FAILURES) {
        this.giveUp(
          this.lastError === "network"
            ? "Chrome can't reach its speech service. Check your internet connection, VPN or ad blocker, and use Google Chrome (other Chromium browsers often can't)."
            : `Speech recognition keeps stopping immediately (${this.lastError || "no error given"}).`,
        );
        return;
      }
      this.lastError = "";
      const delay = Math.min(BASE_RESTART_MS * 2 ** this.quickFailures, MAX_RESTART_MS);
      if (this.quickFailures > 0) this.events.onStatus("listening", "Reconnecting…");
      this.timer = setTimeout(() => this.open(), delay);
    };
    this.recognition = r;
    try {
      r.start();
    } catch (err) {
      log("start threw:", String(err));
      this.recognition = null;
      this.quickFailures += 1;
      if (this.quickFailures >= MAX_QUICK_FAILURES) {
        this.giveUp("Speech recognition couldn't start.");
      } else {
        this.timer = setTimeout(() => this.open(), BASE_RESTART_MS * 2 ** this.quickFailures);
      }
    }
  }
}
