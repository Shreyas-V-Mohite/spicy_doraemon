/**
 * A stand-in for Deepgram's streaming endpoint, for scripts/e2e.ts: records
 * what the proxy sends (auth header, URL with model/keyterms, audio bytes)
 * and replies with scripted Results messages in Deepgram's format, so the
 * whole path (browser mic → proxy → "Deepgram" → transcript → scene) runs
 * without a real key.
 */
import { WebSocketServer, type WebSocket } from 'ws';

export interface FakeConnection {
  url: URL;
  auth: string | undefined;
  audioBytes: number;
  socket: WebSocket;
}

export function startFakeDeepgram(port: number) {
  const wss = new WebSocketServer({ port });
  const connections: FakeConnection[] = [];
  wss.on('connection', (socket, req) => {
    const c: FakeConnection = { url: new URL(req.url ?? '/', `ws://localhost:${port}`), auth: req.headers.authorization, audioBytes: 0, socket };
    connections.push(c);
    socket.on('message', (data, isBinary) => {
      if (isBinary) c.audioBytes += (data as Buffer).length;
    });
  });
  const send = (msg: unknown) => {
    for (const c of connections) if (c.socket.readyState === c.socket.OPEN) c.socket.send(JSON.stringify(msg));
  };
  const results = (transcript: string, isFinal: boolean, speechFinal = false) =>
    send({ type: 'Results', is_final: isFinal, speech_final: speechFinal, channel: { alternatives: [{ transcript, confidence: 0.98 }] } });
  return {
    connections,
    /** Partial words (Deepgram may still change them). */
    interim: (text: string) => results(text, false),
    /** A final segment; `endOfUtterance` = speech_final. */
    final: (text: string, endOfUtterance = true) => results(text, true, endOfUtterance),
    close: () => new Promise<void>((r) => wss.close(() => r())),
  };
}
