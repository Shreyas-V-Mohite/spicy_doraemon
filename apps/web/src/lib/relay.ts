import { useEffect, useRef, useState } from "react";
import type { SessionStore } from "../store/sessionStore";

// The fallback for students whose network blocks WebRTC: the professor's page
// sends small JPEG frames (4 a second) and 16 kHz audio (200 ms chunks)
// through Convex, only while some student asks for it (session.relayUntil).
// Lower quality and about a second behind, but it gets through anything
// that loads the page.

const FRAME_MS = 70; // up to ~14 frames a second
const FRAME_W = 288;
const FRAME_H = 162;
const MAX_IN_FLIGHT = 5; // frames sent but not yet confirmed
export const RELAY_RATE = 16_000;
const CHUNK_SAMPLES = RELAY_RATE / 10; // 100 ms of audio

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

// Professor: send frames and audio from `stream` while `active`.
export function useRelaySender(
  store: SessionStore,
  sessionId: string | undefined,
  token: string | null,
  stream: MediaStream | null,
  active: boolean,
) {
  const storeRef = useLatest(store);
  useEffect(() => {
    if (!active || !stream || !sessionId || !token) return;
    let stopped = false;
    const push = (kind: "video" | "audio", seq: number, data: ArrayBuffer) =>
      storeRef.current.pushRelay({ sessionId, token, kind, seq, data }).catch(() => undefined);

    // Video: draw the camera into a small canvas a few times a second.
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const g = canvas.getContext("2d");
    let frameSeq = 0;
    // Frames are pipelined (several in flight) so the server round trip
    // doesn't cap the frame rate; past the cap a frame is skipped, not queued.
    let inFlight = 0;
    const timer = window.setInterval(() => {
      if (inFlight >= MAX_IN_FLIGHT || !g || video.readyState < 2) return;
      inFlight++;
      g.drawImage(video, 0, 0, FRAME_W, FRAME_H);
      const seq = ++frameSeq;
      canvas.toBlob(
        (blob) => {
          if (!blob || stopped) {
            inFlight--;
            return;
          }
          void blob
            .arrayBuffer()
            .then((buf) => push("video", seq, buf))
            .finally(() => {
              inFlight--;
            });
        },
        "image/jpeg",
        0.55,
      );
    }, FRAME_MS);

    // Audio: average the mic down to 16 kHz and send 16-bit chunks.
    let audio: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let tap: ScriptProcessorNode | null = null;
    if (stream.getAudioTracks().length > 0) {
      audio = new AudioContext();
      void audio.resume();
      source = audio.createMediaStreamSource(stream);
      tap = audio.createScriptProcessor(4096, 1, 1);
      const step = audio.sampleRate / RELAY_RATE;
      let acc = 0;
      let count = 0;
      let pos = 0;
      let out = new Int16Array(CHUNK_SAMPLES);
      let filled = 0;
      let audioSeq = 0;
      tap.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          acc += input[i];
          count++;
          pos += 1;
          if (pos >= step) {
            pos -= step;
            out[filled++] = Math.max(-1, Math.min(1, acc / count)) * 32767;
            acc = 0;
            count = 0;
            if (filled === CHUNK_SAMPLES) {
              void push("audio", ++audioSeq, out.buffer);
              out = new Int16Array(CHUNK_SAMPLES);
              filled = 0;
            }
          }
        }
      };
      // The processor only runs when connected; its output is silence.
      source.connect(tap);
      tap.connect(audio.destination);
    }

    return () => {
      stopped = true;
      clearInterval(timer);
      video.srcObject = null;
      tap?.disconnect();
      source?.disconnect();
      void audio?.close();
    };
  }, [active, stream, sessionId, token, storeRef]);
}

// Student: the latest relayed frame as an image URL.
export function useRelayFrame(store: SessionStore, sessionId: string | undefined, active: boolean) {
  const chunk = store.useRelay(sessionId, "video", active);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!chunk) return;
    const next = URL.createObjectURL(new Blob([chunk.data], { type: "image/jpeg" }));
    setUrl(next);
    // Keep the old frame alive a moment so the image never shows a broken URL.
    return () => void setTimeout(() => URL.revokeObjectURL(next), 1000);
  }, [chunk]);
  return active ? url : null;
}

// Student: plays relayed audio chunks back to back. Browsers start audio only
// after a click, so `blocked` asks for one.
export function useRelayAudio(store: SessionStore, sessionId: string | undefined, active: boolean) {
  const chunk = store.useRelay(sessionId, "audio", active);
  const ctx = useRef<AudioContext | null>(null);
  const next = useRef(0);
  const lastSeq = useRef(-1);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!active) return;
    const a = new AudioContext();
    ctx.current = a;
    const update = () => setBlocked(a.state !== "running");
    a.onstatechange = update;
    void a.resume().finally(update);
    return () => {
      ctx.current = null;
      void a.close();
    };
  }, [active]);

  useEffect(() => {
    const a = ctx.current;
    if (!a || !chunk || chunk.seq === lastSeq.current || a.state !== "running") return;
    lastSeq.current = chunk.seq;
    const pcm = new Int16Array(chunk.data);
    const buffer = a.createBuffer(1, pcm.length, RELAY_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const src = a.createBufferSource();
    src.buffer = buffer;
    src.connect(a.destination);
    // Small jitter buffer; resync if we fall behind or drift too far ahead.
    const now = a.currentTime;
    if (next.current < now + 0.03 || next.current > now + 0.8) next.current = now + 0.15;
    src.start(next.current);
    next.current += buffer.duration;
  }, [chunk]);

  return {
    blocked: active && blocked,
    unblock: () => void ctx.current?.resume(),
  };
}
