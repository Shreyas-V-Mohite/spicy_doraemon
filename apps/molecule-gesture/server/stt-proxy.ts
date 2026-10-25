/**
 * Speech-to-text proxy: the browser streams microphone audio here, and this
 * server relays it to Deepgram Nova-3 with the API key, which never reaches
 * the browser. Transcripts flow back the same way.
 *
 *   DEEPGRAM_API_KEY=… npm run voice:server      (or put it in .env.local)
 *
 * The Vite dev server proxies /api/stt to this server (same origin as the app).
 *   POST /api/stt/ticket           → { ticket, expiresIn }   (Origin must be the app)
 *   GET  /api/stt/health           → { deepgram: true|false }
 *   WS   /api/stt/stream?ticket=…&lang=en-US   ← audio (WebM/Opus), → Deepgram JSON
 *
 * Env: DEEPGRAM_API_KEY, STT_PROXY_PORT (8787), STT_ALLOWED_ORIGINS
 * (comma-separated, default the Vite dev/preview origins), DEEPGRAM_URL
 * (tests point it at a fake Deepgram).
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { chemistryKeyterms, DEEPGRAM_LISTEN_URL, deepgramUrl, originAllowed, TicketSigner } from './sttConfig';

const root = join(import.meta.dirname, '..');
for (const f of ['.env.local', '.env']) if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));

const KEY = process.env.DEEPGRAM_API_KEY ?? '';
const PORT = Number(process.env.STT_PROXY_PORT ?? 8787);
const UPSTREAM = process.env.DEEPGRAM_URL ?? DEEPGRAM_LISTEN_URL;
const ALLOWED = (process.env.STT_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LANGUAGES = new Set(['en-US', 'en']);
const KEYTERMS = chemistryKeyterms();

const tickets = new TicketSigner();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/api/stt/health') return json(200, { deepgram: !!KEY, model: 'nova-3', keyterms: KEYTERMS.length });
  if (url.pathname === '/api/stt/ticket' && req.method === 'POST') {
    if (!originAllowed(req.headers.origin, ALLOWED)) return json(403, { error: 'origin not allowed' });
    if (!KEY) return json(503, { error: 'DEEPGRAM_API_KEY is not set on the server' });
    return json(200, tickets.issue());
  }
  json(404, { error: 'not found' });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const reject = (code: number, msg: string) => {
    socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (url.pathname !== '/api/stt/stream') return reject(404, 'Not Found');
  if (!KEY) return reject(503, 'Service Unavailable');
  if (!originAllowed(req.headers.origin, ALLOWED) || !tickets.verify(url.searchParams.get('ticket'))) return reject(401, 'Unauthorized');
  const lang = url.searchParams.get('lang') ?? 'en-US';
  wss.handleUpgrade(req, socket, head, (client) => relay(client, LANGUAGES.has(lang) ? lang : 'en-US'));
});

/** Browser ⇄ Deepgram. Audio sent before Deepgram answers is buffered, not lost. */
function relay(client: WebSocket, language: string) {
  const upstream = new WebSocket(deepgramUrl(UPSTREAM, language, KEYTERMS), { headers: { Authorization: `Token ${KEY}` } });
  const pending: RawData[] = [];
  let lastAudio = Date.now();

  upstream.on('open', () => {
    for (const chunk of pending.splice(0)) upstream.send(chunk);
  });
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on('unexpected-response', (_req, res) => {
    console.warn(`[stt] Deepgram refused the connection: HTTP ${res.statusCode}`);
    client.close(1011, `Deepgram HTTP ${res.statusCode}`);
  });
  upstream.on('error', (err) => {
    console.warn('[stt] Deepgram error:', err.message);
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'Deepgram connection failed');
  });
  upstream.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1000, 'Deepgram closed');
  });

  client.on('message', (data, isBinary) => {
    if (!isBinary) return; // only audio from the browser
    lastAudio = Date.now();
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push(data);
  });
  client.on('close', () => {
    clearInterval(keepAlive);
    if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'CloseStream' }));
    else upstream.terminate();
  });

  // Deepgram closes a stream after ~10 s without audio (e.g. mic muted).
  const keepAlive = setInterval(() => {
    if (upstream.readyState === WebSocket.OPEN && Date.now() - lastAudio > 5000) upstream.send(JSON.stringify({ type: 'KeepAlive' }));
  }, 4000);
}

server.listen(PORT, () => {
  console.log(`[stt] proxy on http://localhost:${PORT}  (Deepgram ${KEY ? 'key set' : 'KEY MISSING — browsers will fall back to Web Speech'}, ${KEYTERMS.length} keyterms)`);
  if (UPSTREAM !== DEEPGRAM_LISTEN_URL) console.log(`[stt] upstream overridden: ${UPSTREAM}`);
});
