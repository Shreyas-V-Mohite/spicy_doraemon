import type { Transcriber, TranscriberEvents } from "./Transcriber";

// The parts of the browser's SpeechRecognition we use (TypeScript's DOM
// types don't include it everywhere).
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
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
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);
const RESTART_MS = 300;
const ERROR_RETRY_MS = 3000;

// Chrome's recognition ends by itself after silence or about a minute, so
// it is restarted for as long as the professor wants it on.
export class WebSpeechTranscriber implements Transcriber {
  private events: TranscriberEvents;
  private ctor: RecognitionCtor | null = recognitionCtor();
  private recognition: Recognition | null = null;
  private wanted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(events: TranscriberEvents) {
    this.events = events;
  }

  get supported() {
    return this.ctor !== null;
  }

  start() {
    if (!this.ctor) {
      this.events.onStatus("unsupported", "This browser has no speech recognition (use Chrome)");
      return;
    }
    this.wanted = true;
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

  private open() {
    if (!this.ctor || !this.wanted || this.recognition) return;
    const r = new this.ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => this.events.onStatus("listening");
    r.onresult = (e) => {
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
      if (FATAL_ERRORS.has(e.error)) {
        this.wanted = false;
        this.events.onStatus("error", "Microphone access was blocked");
      } else if (e.error === "network") {
        this.events.onStatus("error", "Can't reach the speech service; retrying");
      }
      // "no-speech" and "aborted" are normal; onend restarts.
    };
    r.onend = () => {
      this.recognition = null;
      this.events.onInterim("");
      if (this.wanted) {
        this.timer = setTimeout(() => this.open(), RESTART_MS);
      }
    };
    this.recognition = r;
    try {
      r.start();
    } catch {
      // start() throws if already started; try again shortly.
      this.recognition = null;
      this.timer = setTimeout(() => this.open(), ERROR_RETRY_MS);
    }
  }
}
