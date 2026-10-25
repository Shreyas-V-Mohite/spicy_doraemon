// Small helpers for scripts that drive Convex through its CLI.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function once(args) {
  return execFileSync('npx', ['convex', ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  }).trim();
}

const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs a Convex CLI command, retrying brief network failures of the CLI itself. */
export function convex(args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return once(args);
    } catch (err) {
      const text = `${err.stderr ?? ''}${err.stdout ?? ''}`;
      if (attempt >= 4 || !/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(text)) throw err;
      wait(1500 * attempt);
    }
  }
}

const noise = (l) => l.includes('ExperimentalWarning') || l.includes('trace-warnings');

/** Runs a Convex function and parses its JSON result (null if it returns nothing). */
export function run(fn, args) {
  const out = convex(['run', fn, JSON.stringify(args)])
    .split('\n')
    .filter((l) => !noise(l))
    .join('\n')
    .trim();
  return out ? JSON.parse(out) : null;
}

export function envGet(name) {
  try {
    return convex(['env', 'get', name]).split('\n').filter((l) => !noise(l)).pop() || null;
  } catch {
    return null;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
