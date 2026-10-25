/**
 * Continuous speech recognition with Deepgram Nova-3, through our own proxy
 * (server/stt-proxy.ts), which holds the API key. Same events as
 * SpeechListener (the Web Speech API version), so either can drive the
 * voice layer.
 *
 * Microphone → MediaRecorder (WebM/Opus, 100 ms chunks) → WebSocket
 * /api/stt/stream (with a short-lived ticket) → Deepgram → transcripts back.
 * Phrases are only reported once Deepgram has finalised the utterance.
 */
import { DeepgramTranscript } from './deepgramTranscript';
import type { SpeechListenerEvents } from './SpeechListener';

export interface DeepgramListenerEvents extends SpeechListenerEvents {
  /** Deepgram can't be used here (no proxy, no key, refused): switch to another engine. */
  onUnavailable?(reason: string): void;
}

const CHUNK_MS = 100;

export class DeepgramListener {
  private wanted = false;
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private readonly transcript = new DeepgramTranscript();
  private failures = 0;
  private everConnected = false;
  private retryTimer = 0;
  private session = 0;

  constructor(
    private readonly events: DeepgramListenerEvents,
    private lang = 'en-US',
    private readonly base = '/api/stt',
  ) {}

  get listening(): boolean {
    return this.wanted;
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    if (this.wanted) {
      this.closeSocket();
      void this.open();
    }
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    void this.open();
  }

  stop(): void {
    this.wanted = false;
    this.closeSocket();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.events.onState?.('off');
  }

  private closeSocket() {
    this.session++;
    window.clearTimeout(this.retryTimer);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.ws?.close();
    this.ws = null;
    this.transcript.reset();
  }

  private unavailable(reason: string) {
    this.wanted = false;
    this.closeSocket();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.events.onUnavailable?.(reason);
  }

  private retry() {
    if (!this.wanted) return;
    this.failures++;
    // Never got through at all: Deepgram isn't usable here — let the caller fall back.
    if (!this.everConnected && this.failures >= 3) return this.unavailable('Could not connect to the speech server.');
    const delay = Math.min(5000, this.failures * 1000);
    this.events.onState?.('error', 'Speech connection dropped — reconnecting…');
    this.retryTimer = window.setTimeout(() => void this.open(), delay);
  }

  private async open() {
    const session = ++this.session;
    let ticket: string;
    try {
      const res = await fetch(`${this.base}/ticket`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return this.unavailable(body?.error ?? `Speech server unavailable (HTTP ${res.status}).`);
      }
      ticket = ((await res.json()) as { ticket: string }).ticket;
    } catch {
      return this.unavailable('Speech server not running.');
    }
    if (session !== this.session || !this.wanted) return;

    try {
      this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (err) {
      this.wanted = false;
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      this.events.onState?.('error', denied ? 'Microphone permission was denied — allow it and click the mic.' : 'No microphone found.');
      return;
    }
    if (session !== this.session || !this.wanted) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${this.base}/stream?ticket=${encodeURIComponent(ticket)}&lang=${encodeURIComponent(this.lang)}`);
    this.ws = ws;
    ws.onopen = () => {
      if (session !== this.session) return;
      this.failures = 0;
      this.everConnected = true;
      // A fresh recorder per connection: Deepgram needs the WebM header at the start of each stream.
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const rec = new MediaRecorder(this.stream!, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      rec.start(CHUNK_MS);
      this.recorder = rec;
      this.events.onState?.('listening');
    };
    ws.onmessage = (e) => {
      if (session !== this.session || typeof e.data !== 'string') return;
      let msg: unknown;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      const u = this.transcript.feed(msg as Parameters<DeepgramTranscript['feed']>[0]);
      if (u.interim !== undefined) this.events.onInterim?.(u.interim);
      if (u.final) this.events.onFinal(u.final, [u.final]);
    };
    ws.onclose = () => {
      if (session !== this.session) return;
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
      this.ws = null;
      this.retry();
    };
  }
}
