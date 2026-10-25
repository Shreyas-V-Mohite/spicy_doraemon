// What the app needs from a speech-to-text source. The browser's built-in
// recognition implements it today; a paid streaming service could replace it
// without touching the rest of the page.
export type TranscriberStatus = "off" | "listening" | "error" | "unsupported";

export interface TranscriberEvents {
  // A finished phrase.
  onFinal(text: string): void;
  // The phrase still being spoken (not stored).
  onInterim(text: string): void;
  onStatus(status: TranscriberStatus, detail?: string): void;
}

export interface Transcriber {
  readonly supported: boolean;
  start(): void;
  stop(): void;
}
