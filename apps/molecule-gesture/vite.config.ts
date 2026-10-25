import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation enables SharedArrayBuffer, which lets ONNX Runtime
// Web run multi-threaded WASM when WebGPU is unavailable.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Speech-to-text proxy (server/stt-proxy.ts, `npm run voice:server`): served
// under the app's own origin, so the browser never talks to Deepgram directly.
const sttProxy = {
  '/api/stt': { target: `http://localhost:${process.env.STT_PROXY_PORT ?? 8787}`, ws: true, changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolationHeaders, proxy: sttProxy },
  preview: { headers: isolationHeaders, proxy: sttProxy },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
});
