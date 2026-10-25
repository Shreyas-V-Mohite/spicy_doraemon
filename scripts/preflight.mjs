#!/usr/bin/env node
/**
 * Checks that everything a demo needs is in place, and says what to fix.
 * Never prints a secret: only whether each one is set.
 *
 *   npm run preflight
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg, fix) => {
  failures++;
  console.log(`  ✗ ${msg}${fix ? `\n      fix: ${fix}` : ''}`);
};
const warn = (msg) => console.log(`  ! ${msg}`);

function convexEnv(name) {
  try {
    // node + the CLI script directly: `npx` is `npx.cmd` on Windows, which execFileSync can't start.
    const out = execFileSync(process.execPath, [join(root, 'node_modules', 'convex', 'bin', 'main.js'), 'env', 'get', name], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return out.trim().split('\n').pop() || null;
  } catch {
    return null;
  }
}

async function get(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    // A brand-new tunnel name may not resolve through this machine's DNS yet
    // even though Convex (public DNS) reaches it. Ask Cloudflare's resolver.
    const u = new URL(url);
    try {
      const ip = execFileSync('dig', ['+short', '@1.1.1.1', u.hostname], { encoding: 'utf8' })
        .split('\n')
        .find((l) => /^[0-9.]+$/.test(l));
      if (!ip) throw err;
      const args = ['-s', '-m', '8', '--resolve', `${u.hostname}:443:${ip}`, '-w', '\n%{http_code}'];
      for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
      args.push(String(url));
      const out = execFileSync('curl', args, { encoding: 'utf8' });
      const cut = out.lastIndexOf('\n');
      return { status: Number(out.slice(cut + 1)), body: out.slice(0, cut), viaPublicDns: true };
    } catch {
      return { status: 0, body: String(err) };
    }
  }
}

console.log('Convex environment');
for (const name of ['PROFESSOR_PASSCODE', 'ANTHROPIC_API_KEY', 'VOYAGE_API_KEY']) {
  convexEnv(name) ? ok(`${name} is set`) : bad(`${name} is not set`, `npx convex env set ${name} <value>`);
}

console.log('Chemistry service');
const chemUrl = convexEnv('CHEM_SERVICE_URL');
if (!chemUrl) {
  bad('CHEM_SERVICE_URL is not set', 'run `npm run tunnel` (local) or set the hosted address (docs/deploy.md)');
} else {
  const health = await get(new URL('/health', chemUrl));
  if (health.status !== 200) {
    bad(
      `${new URL(chemUrl).host} does not answer /health (${health.status || 'no response'})`,
      'is the service running, and the tunnel or host up? A restarted tunnel has a new address: `npm run tunnel`',
    );
  } else {
    ok(`${new URL(chemUrl).host} answers /health${health.viaPublicDns ? ' (this machine\'s DNS is slow to learn it, public DNS has it)' : ''}`);
    const key = convexEnv('CHEM_API_KEY');
    const groups = await get(new URL('/groups', chemUrl), key ? { 'x-api-key': key } : {});
    if (groups.status === 200) ok(`/groups works (${Object.keys(JSON.parse(groups.body)).length} functional groups)${key ? ' with the key' : ''}`);
    else if (groups.status === 401) bad('the service rejects our key', 'CHEM_API_KEY in Convex must match the service');
    else bad(`/groups returned ${groups.status}`);
    if (!key) warn('CHEM_API_KEY is not set: fine for a local tunnel, but a hosted service should have one');
  }
}

console.log('Hand gestures');
const files = [
  ['apps/web/public/models/hand_landmarker.task', 'the MediaPipe hand model'],
  ['apps/web/public/mediapipe/vision_wasm_internal.wasm', 'the MediaPipe runtime'],
];
for (const [file, what] of files) {
  existsSync(join(root, file)) ? ok(`${what} is present`) : bad(`${what} is missing`, 'npm run models -w @spicy/hand-gesture');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} problem${failures === 1 ? '' : 's'} to fix.`);
process.exit(failures === 0 ? 0 : 1);
