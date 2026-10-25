import { useEffect, useRef, useState } from "react";
import type { SessionStore } from "../store/sessionStore";
import type { Signal, SignalKind } from "../types";

// The professor's camera and mic go to each student over a direct WebRTC
// connection (one per student). Convex carries the signalling: offers,
// answers and ICE candidates (see convex/live.ts).
//
// Every message carries the nonce of the student's current connection, so
// messages for an older attempt (a reload, a retry) are ignored.

export const PROFESSOR = "professor";

const STUN: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

// STUN plus any TURN relay configured on the server, fetched once per page.
let icePromise: Promise<RTCIceServer[]> | null = null;
function iceServers(store: SessionStore): Promise<RTCIceServer[]> {
  icePromise ??= store.getIceServers().catch(() => {
    icePromise = null;
    return STUN;
  });
  return icePromise;
}

type Envelope = { n: string; d?: unknown };
const wrap = (nonce: string, data?: unknown) => JSON.stringify({ n: nonce, d: data });
function unwrap(payload: string): Envelope | null {
  try {
    const env = JSON.parse(payload) as Envelope;
    return typeof env.n === "string" ? env : null;
  } catch {
    return null;
  }
}

// The store object is rebuilt every render; effects read it through a ref.
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

// Handles new signals one at a time, in order, then deletes them.
function useSignalQueue(
  signals: Signal[] | undefined,
  ready: boolean,
  handle: (s: Signal) => Promise<void>,
  ack: (ids: string[]) => Promise<void>,
) {
  const seen = useRef(new Set<string>());
  const chain = useRef(Promise.resolve());
  const handleRef = useLatest(handle);
  const ackRef = useLatest(ack);
  useEffect(() => {
    if (!ready || !signals) return;
    const fresh = signals.filter((s) => !seen.current.has(s._id));
    if (fresh.length === 0) return;
    for (const s of fresh) seen.current.add(s._id);
    chain.current = chain.current.then(async () => {
      for (const s of fresh) {
        try {
          await handleRef.current(s);
        } catch (err) {
          console.warn("WebRTC signal failed", s.kind, err);
        }
      }
      await ackRef.current(fresh.map((s) => s._id)).catch(() => undefined);
    });
  }, [signals, ready, handleRef, ackRef]);
}

// Professor: sends `stream` to every student who asks for it. Returns how
// many students are connected.
export function useBroadcast(
  store: SessionStore,
  sessionId: string | undefined,
  token: string | null,
  stream: MediaStream | null,
): number {
  const signals = store.useSignals(sessionId, PROFESSOR, token);
  const storeRef = useLatest(store);
  const peers = useRef(new Map<string, { pc: RTCPeerConnection; nonce: string }>());
  const [viewers, setViewers] = useState(0);

  const recount = () =>
    setViewers([...peers.current.values()].filter((p) => p.pc.connectionState === "connected").length);

  // Off air (or a new stream, or leaving the page): drop every connection.
  useEffect(() => {
    if (!stream) return;
    const all = peers.current;
    return () => {
      for (const p of all.values()) p.pc.close();
      all.clear();
      setViewers(0);
    };
  }, [stream]);

  const send = (to: string, kind: SignalKind, payload: string) =>
    sessionId && token
      ? storeRef.current
          .sendSignal({ sessionId, from: PROFESSOR, to, kind, payload, token })
          .catch(() => undefined)
      : Promise.resolve();

  // Joins wait in the inbox until the professor goes on air.
  useSignalQueue(
    signals,
    !!(sessionId && token && stream),
    async (s) => {
      const env = unwrap(s.payload);
      if (!env || !stream) return;
      if (s.kind === "join") {
        peers.current.get(s.from)?.pc.close();
        const pc = new RTCPeerConnection({ iceServers: await iceServers(storeRef.current) });
        peers.current.set(s.from, { pc, nonce: env.n });
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
        pc.onicecandidate = (e) => {
          if (e.candidate) void send(s.from, "ice", wrap(env.n, e.candidate.toJSON()));
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            if (peers.current.get(s.from)?.pc === pc) peers.current.delete(s.from);
          }
          recount();
        };
        // A student who left without saying so never answers; let it go.
        setTimeout(() => {
          if (pc.connectionState !== "connected" && peers.current.get(s.from)?.pc === pc) {
            pc.close();
            peers.current.delete(s.from);
            recount();
          }
        }, 30_000);
        await pc.setLocalDescription(await pc.createOffer());
        await send(s.from, "offer", wrap(env.n, pc.localDescription?.toJSON()));
        return;
      }
      const peer = peers.current.get(s.from);
      if (!peer || peer.nonce !== env.n) return;
      if (s.kind === "answer") {
        await peer.pc.setRemoteDescription(env.d as RTCSessionDescriptionInit);
      } else if (s.kind === "ice") {
        await peer.pc.addIceCandidate(env.d as RTCIceCandidateInit);
      } else if (s.kind === "leave") {
        peer.pc.close();
        peers.current.delete(s.from);
        recount();
      }
    },
    async (ids) => {
      if (sessionId && token) await storeRef.current.ackSignals({ sessionId, me: PROFESSOR, token, ids });
    },
  );

  return viewers;
}

// Student: receives the professor's camera and mic while they are on air.
// `needRelay` turns on when a direct connection can't be made (strict
// firewalls); the page then falls back to the Convex relay while retrying.
export function useReceiver(
  store: SessionStore,
  sessionId: string | undefined,
  me: string,
  broadcasting: boolean,
  liveEpoch: number,
): { stream: MediaStream | null; needRelay: boolean } {
  const signals = store.useSignals(sessionId, me, null);
  const storeRef = useLatest(store);
  const conn = useRef<{ pc: RTCPeerConnection; nonce: string; pending: RTCIceCandidateInit[] } | null>(
    null,
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [connected, setConnected] = useState(false);
  const [needRelay, setNeedRelay] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sessionId || !broadcasting) return;
    const nonce = crypto.randomUUID();
    let pc: RTCPeerConnection | null = null;
    let cancelled = false;
    let retry = 0;
    let watchdog = 0;
    const send = (kind: SignalKind, data?: unknown) =>
      storeRef.current
        .sendSignal({ sessionId, from: me, to: PROFESSOR, kind, payload: wrap(nonce, data) })
        .catch(() => undefined);
    void iceServers(storeRef.current).then((servers) => {
      if (cancelled) return;
      const peer = new RTCPeerConnection({ iceServers: servers });
      pc = peer;
      conn.current = { pc: peer, nonce, pending: [] };
      peer.ontrack = (e) => setStream(e.streams[0] ?? new MediaStream([e.track]));
      peer.onicecandidate = (e) => {
        if (e.candidate) void send("ice", e.candidate.toJSON());
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setConnected(true);
          setNeedRelay(false);
        } else if (peer.connectionState === "failed") {
          setConnected(false);
          setNeedRelay(true);
          retry = window.setTimeout(() => setAttempt((a) => a + 1), 5000);
        }
      };
      // No direct connection in time: use the relay, and keep trying.
      watchdog = window.setTimeout(() => {
        if (peer.connectionState !== "connected") {
          setNeedRelay(true);
          setAttempt((a) => a + 1);
        }
      }, 12_000);
      void send("join");
    });
    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearTimeout(watchdog);
      if (pc) {
        void send("leave");
        pc.close();
        if (conn.current?.pc === pc) conn.current = null;
      }
      setStream(null);
      setConnected(false);
    };
  }, [sessionId, me, broadcasting, liveEpoch, attempt, storeRef]);

  useSignalQueue(
    signals,
    !!sessionId,
    async (s) => {
      const c = conn.current;
      const env = unwrap(s.payload);
      if (!c || !env || env.n !== c.nonce || !sessionId) return;
      if (s.kind === "offer") {
        await c.pc.setRemoteDescription(env.d as RTCSessionDescriptionInit);
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        await storeRef.current.sendSignal({
          sessionId,
          from: me,
          to: PROFESSOR,
          kind: "answer",
          payload: wrap(c.nonce, c.pc.localDescription?.toJSON()),
        });
        for (const cand of c.pending.splice(0)) await c.pc.addIceCandidate(cand);
      } else if (s.kind === "ice") {
        const cand = env.d as RTCIceCandidateInit;
        if (c.pc.remoteDescription) await c.pc.addIceCandidate(cand);
        else c.pending.push(cand);
      }
    },
    async (ids) => {
      if (sessionId) await storeRef.current.ackSignals({ sessionId, me, ids });
    },
  );

  return {
    stream: broadcasting && connected ? stream : null,
    needRelay: broadcasting && needRelay && !connected,
  };
}
