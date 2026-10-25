/**
 * End-to-end browser test: two real Chrome windows (teacher + student)
 * against the Vite dev server and a local SpacetimeDB.
 *
 * The teacher's webcam is Chrome's fake capture device fed with a Y4M built
 * from a real hand photo (scripts/make-fake-webcam.ts), so the hand pipeline
 * runs for real: getUserMedia → MediaPipe → gestures → 3Dmol → SpacetimeDB.
 * Speech can't be produced headless, so voice transcripts go straight into
 * the same handler the speech recogniser feeds.
 *
 *   npx tsx scripts/e2e.ts <fake-webcam.y4m> [screenshotDir] [--crowd=<crowd.y4m>]
 * Env: E2E_URL (default http://localhost:5173/), CHROME_PATH, E2E_TEACHER_QUERY.
 *
 * Speech: the real speech proxy (server/stt-proxy.ts) is started on port 8787
 * against a fake Deepgram (scripts/fakeDeepgram.ts), so the browser's real
 * microphone stream (Chrome's fake audio device) goes through the proxy.
 */
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startFakeDeepgram } from './fakeDeepgram';

const BASE = process.env.E2E_URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const y4m = process.argv[2] ? resolve(process.argv[2]) : '';
const shots = process.argv[3]?.startsWith('--') ? undefined : process.argv[3];
/** Optional: a fake webcam showing several people's hands (make-fake-webcam.ts --crowd). */
const crowdY4m = process.argv.find((a) => a.startsWith('--crowd='))?.slice('--crowd='.length);
if (!y4m) throw new Error('usage: e2e.ts <fake-webcam.y4m> [screenshotDir]');

type View = number[];
interface SlotDebug {
  key: string;
  moleculeId: string;
  view: View | null;
  placement: { x: number; y: number } | null;
  scale: number | null;
  loaded: string | null;
  fit: { radius: number; distance: number; minDistance: number; maxDistance: number } | null;
}
interface Debug {
  say(text: string): Promise<void>;
  scene(): SlotDebug[];
  items(): { key: string; moleculeId: string; seq: number; gesture: string }[];
  activeKey(): string | null;
  following: boolean;
  ready: boolean;
  isRoomTeacher: boolean;
  participants: number;
}

const READ_HAND_PANEL = `(() => {
  const h = document.querySelector('.dock__hand');
  const err = document.querySelector('.dock__error')?.textContent ?? '';
  if (!h) return { model: '', error: err, stats: {} };
  const d = h.dataset;
  return { model: d.backend, error: err, stats: { hand: d.posture, confidence: d.conf, fps: d.fps, infer: d.infer + ' ms' } };
})()`;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** Orientation difference (degrees) between two views. */
function angleDeg(a: View | null | undefined, b: View | null | undefined): number {
  if (!a || !b) return Infinity;
  const dot = Math.abs(a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7]);
  return 2 * Math.acos(Math.min(1, dot)) * 57.2958;
}

const dbg = (p: Page) =>
  p.evaluate(() => {
    const d = (window as unknown as { __mgl?: Debug }).__mgl;
    return d
      ? {
          scene: d.scene(),
          items: d.items(),
          active: d.activeKey(),
          following: d.following,
          ready: d.ready,
          isRoomTeacher: d.isRoomTeacher,
          participants: d.participants,
        }
      : null;
  });
type Snap = NonNullable<Awaited<ReturnType<typeof dbg>>>;

async function waitFor(p: Page, pred: (d: Snap) => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const d = await dbg(p);
    if (d && pred(d)) return d;
    await p.waitForTimeout(150);
  }
  return null;
}

const say = (p: Page, text: string) => p.evaluate(`window.__mgl.say(${JSON.stringify(text)})`);
const byMol = (d: Snap, id: string) => d.scene.find((s) => s.moleculeId === id);
const loadedAll = (d: Snap, n: number) => d.scene.length === n && d.scene.every((s) => s.loaded === s.moleculeId);

/** Drag a molecule's name chip with the mouse to a stage point (fractions of the stage) or the trash. */
async function dragChip(p: Page, name: string, to: { x: number; y: number } | 'trash', release = true) {
  const chip = p.locator('.mol-chip', { hasText: name }).first();
  const box = (await chip.boundingBox())!;
  let tx: number;
  let ty: number;
  if (to === 'trash') {
    const t = (await p.locator('.trash').boundingBox())!;
    tx = t.x + t.width / 2;
    ty = t.y + t.height / 2;
  } else {
    const s = (await p.locator('.stage').boundingBox())!;
    tx = s.x + s.width * to.x;
    ty = s.y + s.height * to.y;
  }
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await p.mouse.move(sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12);
    await p.waitForTimeout(30);
  }
  if (release) await p.mouse.up();
}

const STT_PORT = 8787;
const FAKE_DEEPGRAM_PORT = 8790;
const FAKE_KEY = 'e2e-test-key';

/** The real speech proxy, pointed at the fake Deepgram. */
async function startSpeechProxy() {
  const health = () =>
    fetch(`http://localhost:${STT_PORT}/api/stt/health`)
      .then((r) => r.json() as Promise<{ deepgram: boolean }>)
      .catch(() => null);
  if (await health()) throw new Error(`port ${STT_PORT} is in use — stop \`npm run voice:server\` before the e2e test`);
  const proc = spawn(process.execPath, [join(import.meta.dirname, '../node_modules/tsx/dist/cli.mjs'), join(import.meta.dirname, '../server/stt-proxy.ts')], {
    env: { ...process.env, DEEPGRAM_API_KEY: FAKE_KEY, DEEPGRAM_URL: `ws://localhost:${FAKE_DEEPGRAM_PORT}/v1/listen`, STT_PROXY_PORT: String(STT_PORT) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100 && !(await health()); i++) await new Promise((r) => setTimeout(r, 100));
  return proc;
}

async function main() {
  const deepgram = startFakeDeepgram(FAKE_DEEPGRAM_PORT);
  const proxy = await startSpeechProxy();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${y4m}`,
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
    ],
  });
  const room = `E2E-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const teacherCtx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  // Headless Chrome's fake microphone plays beeps that the real recogniser turns
  // into random words; the test feeds words itself, so switch the real one off.
  await teacherCtx.addInitScript('delete window.SpeechRecognition; delete window.webkitSpeechRecognition;');
  const teacher = await teacherCtx.newPage();
  const student = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  for (const [label, p] of [['teacher', teacher], ['student', student]] as const) {
    p.on('pageerror', (e) => console.log(`[${label} pageerror]`, e.message));
  }

  await teacher.goto(`${BASE}?room=${room}&role=teacher&name=Prof%20E2E&debug=voice${process.env.E2E_TEACHER_QUERY ?? ''}`);
  check('teacher connects to SpacetimeDB and owns the room', !!(await waitFor(teacher, (d) => d.isRoomTeacher && d.ready, 20000)), `room ${room}`);
  await student.goto(`${BASE}?room=${room}&role=student&name=Student%20E2E`);
  check('student joins the same room', !!(await waitFor(student, (d) => d.ready && d.participants >= 2, 20000)));
  check('the stage starts empty', ((await dbg(teacher))?.scene.length ?? -1) === 0);

  // --- voice adds molecules (never replaces) ----------------------------
  await say(teacher, 'show me benzene');
  check('voice "show me benzene" adds benzene', !!(await waitFor(teacher, (d) => loadedAll(d, 1), 15000)));
  await say(teacher, 'show me acetic acid');
  check(
    'voice "show me acetic acid" adds a 2nd molecule from PubChem',
    !!(await waitFor(teacher, (d) => loadedAll(d, 2) && !!byMol(d, 'pubchem:176'), 20000)),
  );
  await say(teacher, 'so the electrons are delocalized around the ring');
  await say(teacher, 'show me caffeine');
  const three = await waitFor(teacher, (d) => loadedAll(d, 3), 15000);
  check('a 3rd molecule is added; lecture speech ignored', !!three, three?.scene.map((s) => s.moleculeId).join(', '));
  await teacher.waitForTimeout(800);
  const t3 = (await dbg(teacher))!;
  const pl = t3.scene.map((s) => s.placement!);
  const minGap = Math.min(...pl.flatMap((a, i) => pl.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
  check('new molecules are placed apart (no overlap)', minGap > 0.12, `closest pair ${minGap.toFixed(2)} viewer-widths`);
  check('the newest molecule is selected', byMol(t3, 'builtin:caffeine')?.key === t3.active);
  check('student sees all 3 molecules', !!(await waitFor(student, (d) => loadedAll(d, 3), 20000)));

  // --- gestures/buttons act on the selected molecule only ----------------
  const caf = (d: Snap) => byMol(d, 'builtin:caffeine')!;
  const ben = (d: Snap) => byMol(d, 'builtin:benzene')!;
  const before = (await dbg(teacher))!;
  for (let i = 0; i < 6; i++) await teacher.keyboard.press('ArrowRight');
  await teacher.waitForTimeout(1500);
  let t = (await dbg(teacher))!;
  let s = (await dbg(student))!;
  check('rotation turns the selected molecule', angleDeg(caf(before).view, caf(t).view) > 30, `${angleDeg(caf(before).view, caf(t).view).toFixed(1)}°`);
  check('…and leaves the others alone', angleDeg(ben(before).view, ben(t).view) < 0.5);
  check(
    'student follows each molecule',
    angleDeg(caf(t).view, caf(s).view) < 1 && angleDeg(ben(t).view, ben(s).view) < 1,
    `residual ${angleDeg(caf(t).view, caf(s).view).toFixed(2)}°`,
  );

  // --- throttling --------------------------------------------------------
  const seqOf = (d: Snap) => d.items.find((i) => i.moleculeId === 'builtin:caffeine')!.seq;
  const seqA = seqOf(t);
  const tStart = Date.now();
  while (Date.now() - tStart < 3000) await teacher.keyboard.press('ArrowLeft');
  await teacher.waitForTimeout(400);
  const rate = (seqOf((await dbg(teacher))!) - seqA) / ((Date.now() - tStart) / 1000);
  check('updates are throttled to ~10 Hz per molecule', rate > 1 && rate <= 11.5, `${rate.toFixed(1)} Hz`);

  // --- explore / return / lock -------------------------------------------
  await student.click('text=Explore Independently');
  await teacher.waitForTimeout(800);
  const tb = (await dbg(teacher))!;
  for (let i = 0; i < 6; i++) await student.click('[aria-label="Rotate down"]');
  await student.waitForTimeout(1200);
  t = (await dbg(teacher))!;
  s = (await dbg(student))!;
  const sActive = s.scene.find((x) => x.key === s.active)!;
  const tSame = t.scene.find((x) => x.key === sActive.key)!;
  check('explore: student rotates locally', angleDeg(tSame.view, sActive.view) > 30);
  check('explore: teacher untouched', angleDeg(tb.scene.find((x) => x.key === tSame.key)!.view, tSame.view) < 0.01);
  await student.click('text=Return to Teacher View');
  await student.waitForTimeout(1500);
  t = (await dbg(teacher))!;
  s = (await dbg(student))!;
  check('return to teacher view re-syncs', t.scene.every((x) => angleDeg(x.view, s.scene.find((y) => y.key === x.key)?.view) < 1));
  await teacher.click('[aria-label="Settings"]');
  await teacher.click('text=Lock students to my view');
  await student.waitForTimeout(800);
  check('teacher lock disables student explore', await student.isDisabled('text=Explore Independently'));
  await teacher.click('text=Lock students to my view');
  await teacher.keyboard.press('Escape');
  check('settings menu closes (stage uncovered)', (await teacher.locator('.dock-menu').count()) === 0);

  // --- move by dragging, delete via the trash ----------------------------
  await dragChip(teacher, 'Benzene', { x: 0.62, y: 0.3 });
  await teacher.waitForTimeout(800);
  t = (await dbg(teacher))!;
  check(
    'a molecule can be moved',
    Math.hypot(ben(t).placement!.x - ben(before).placement!.x, ben(t).placement!.y - ben(before).placement!.y) > 0.1,
  );
  await student.waitForTimeout(800);
  s = (await dbg(student))!;
  check(
    'student sees it moved',
    Math.abs(ben(s).placement!.x - ben(t).placement!.x) < 0.05,
    `teacher x ${ben(t).placement!.x.toFixed(2)} / student x ${ben(s).placement!.x.toFixed(2)}`,
  );
  // Into the trash zone with the mouse button still held: it must go without a release.
  await dragChip(teacher, 'Benzene', 'trash', false);
  const goneHeld = await waitFor(teacher, (d) => d.scene.length === 2 && !byMol(d, 'builtin:benzene'), 3000);
  const trashClass = (await teacher.getAttribute('.trash', 'class')) ?? '';
  await teacher.mouse.up();
  check('entering the trash deletes it at once (no release needed)', !!goneHeld);
  check('…and the trash icon returns to normal', !/is-over|is-armed/.test(trashClass), trashClass);
  check('…for the student too', !!(await waitFor(student, (d) => d.scene.length === 2 && !byMol(d, 'builtin:benzene'), 8000)));
  await dragChip(teacher, 'Caffeine', { x: 0.45, y: 0.55 });
  await teacher.waitForTimeout(600);
  const afterDrop = (await dbg(teacher))!;
  const stageBox = (await teacher.locator('.stage').boundingBox())!;
  const want = { x: -0.05, y: (0.05 * stageBox.height) / stageBox.width };
  const got = caf(afterDrop).placement!;
  check(
    'dropping anywhere else moves it there and keeps it',
    afterDrop.scene.length === 2 && Math.hypot(got.x - want.x, got.y - want.y) < 0.03,
    `caffeine at (${got.x.toFixed(2)}, ${got.y.toFixed(2)}), wanted (${want.x.toFixed(2)}, ${want.y.toFixed(2)})`,
  );

  // --- size limits: zooming stops where the molecule still fits on screen ---------
  const fitOf = (d: Snap) => caf(d).fit!;
  for (let i = 0; i < 40; i++) await teacher.keyboard.press('+');
  await teacher.waitForTimeout(700);
  const big = (await dbg(teacher))!;
  for (let i = 0; i < 10; i++) await teacher.keyboard.press('+');
  await teacher.waitForTimeout(700);
  const bigger = (await dbg(teacher))!;
  const sb = (await teacher.locator('.stage').boundingBox())!;
  // Projected bounding circle of the molecule, in stage pixels.
  const onScreen = (d: Snap) => {
    const f = fitOf(d);
    const pxPerUnit = sb.height / 2 / (f.distance * Math.tan((10 * Math.PI) / 180));
    const r = f.radius * pxPerUnit;
    const cx = sb.width / 2 + caf(d).placement!.x * sb.width;
    const cy = sb.height / 2 + caf(d).placement!.y * sb.width;
    return { r, inside: cx - r >= -1 && cx + r <= sb.width + 1 && cy - r >= -1 && cy + r <= sb.height + 1 };
  };
  const bigFit = onScreen(big);
  check(
    'zooming in stops at a viewport-based maximum (whole molecule still on screen)',
    fitOf(big).distance >= fitOf(big).minDistance * 0.999 && bigFit.inside,
    `radius ${bigFit.r.toFixed(0)} px on a ${sb.width.toFixed(0)}×${sb.height.toFixed(0)} stage`,
  );
  check(
    '…and more zoom-in at the maximum changes nothing (no jitter)',
    Math.abs(Math.log((bigger.scene.find((x) => x.key === caf(big).key)!.scale ?? 1) / (caf(big).scale ?? 1))) < 0.002,
  );
  for (let i = 0; i < 60; i++) await teacher.keyboard.press('-');
  await teacher.waitForTimeout(700);
  const small = (await dbg(teacher))!;
  check(
    'zooming out stops at a minimum size (never vanishes)',
    fitOf(small).distance <= fitOf(small).maxDistance * 1.001 && onScreen(small).r > 0.04 * Math.min(sb.width, sb.height),
    `radius ${onScreen(small).r.toFixed(0)} px`,
  );
  for (let i = 0; i < 18; i++) await teacher.keyboard.press('+'); // back to a normal size
  await teacher.waitForTimeout(500);

  // --- real hand tracking on the fake webcam ----------------------------
  await teacher.click('text=Enable webcam');
  const seen = { postures: new Set<string>(), maxConf: 0, backend: '', infer: '', fps: '' };
  const preHand = (await dbg(teacher))!;
  let maxRot = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await teacher.waitForTimeout(250);
    const info = (await teacher.evaluate(READ_HAND_PANEL)) as { model: string; error: string; stats: Record<string, string> };
    if (info.error) {
      check('hand tracking runs', false, info.error);
      break;
    }
    if (info.stats.hand) seen.postures.add(info.stats.hand);
    const c = parseFloat(info.stats.confidence);
    if (!Number.isNaN(c)) seen.maxConf = Math.max(seen.maxConf, c);
    seen.backend = info.model;
    if (info.stats.infer) seen.infer = info.stats.infer;
    if (info.stats.fps) seen.fps = info.stats.fps;
    const d = (await dbg(teacher))!;
    for (const x of d.scene) maxRot = Math.max(maxRot, angleDeg(preHand.scene.find((y) => y.key === x.key)?.view, x.view));
  }
  console.log('      hand panel:', seen.backend, '| infer', seen.infer, '| fps', seen.fps, '| states:', [...seen.postures].join(', '));
  check('camera on: molecules stay (only the trash removes them)', ((await dbg(teacher))?.scene.length ?? 0) === 2);
  check('real hand-landmark inference detects the hand', seen.maxConf > 0.5, `max confidence ${seen.maxConf.toFixed(2)}`);
  check('open hand recognised', [...seen.postures].some((p) => p.includes('open')));
  check('a still open hand neither rotates nor moves anything', maxRot < 5, `max rotation ${maxRot.toFixed(1)}°`);
  const sizeNow = (await dbg(teacher))!;
  const sizeDrift = Math.max(
    ...sizeNow.scene.map((x) => Math.abs(Math.log((x.scale ?? 1) / (preHand.scene.find((y) => y.key === x.key)?.scale ?? 1)))),
  );
  check('the hand appearing does not resize anything', sizeDrift < 0.02, `max size change ×${Math.exp(sizeDrift).toFixed(3)}`);
  const backdrop = (await teacher.evaluate(`(() => {
    const v = document.querySelector('.backdrop.is-live video');
    return { videoWidth: v ? v.videoWidth : 0, playing: v ? !v.paused : false };
  })()`)) as { videoWidth: number; playing: boolean };
  check('webcam fills the stage behind the molecules (AR view)', backdrop.videoWidth > 0 && backdrop.playing);

  // --- voice speed ------------------------------------------------------------
  const pubchemCalls: string[] = [];
  teacher.on('request', (r) => {
    if (r.url().includes('pubchem.ncbi')) pubchemCalls.push(r.url());
  });
  /** Speak (final or live words) and time, in the page, until the scene has `n` molecules. */
  const timeToScene = (fn: 'say' | 'sayLive', text: string, n: number) =>
    teacher.evaluate(
      `(async () => {
        const t0 = performance.now();
        window.__mgl.${fn}(${JSON.stringify(text)});
        while (window.__mgl.items().length < ${n}) {
          if (performance.now() - t0 > 8000) return -1;
          await new Promise((r) => setTimeout(r, 10));
        }
        return Math.round(performance.now() - t0);
      })()`,
    ) as Promise<number>;
  const packMs = await timeToScene('say', 'show me vanillin', 3);
  const withVanillin = await waitFor(teacher, (d) => loadedAll(d, 3), 10000);
  check(
    'a common molecule ("vanillin") comes from the bundled pack — no PubChem round trip',
    !!withVanillin && packMs >= 0 && pubchemCalls.length === 0,
    `in the scene ${packMs} ms after the phrase, ${pubchemCalls.length} PubChem requests`,
  );
  // Live (not yet final) words are captions only: nothing changes until the phrase is final.
  await teacher.evaluate(`window.__mgl.sayLive(${JSON.stringify('okay so show me menthol')})`);
  await teacher.waitForTimeout(1500);
  check('live (partial) words never change the scene', ((await dbg(teacher))?.scene.length ?? 0) === 3);
  await say(teacher, 'okay so show me menthol');
  check('…the finished phrase does', !!(await waitFor(teacher, (d) => loadedAll(d, 4), 8000)));

  // --- Deepgram Nova-3 through the proxy ------------------------------------------
  const conn = await (async () => {
    for (let i = 0; i < 100; i++) {
      const c = deepgram.connections.find((x) => x.audioBytes > 0);
      if (c) return c;
      await teacher.waitForTimeout(100);
    }
    return null;
  })();
  check(
    'the microphone streams to Deepgram through the proxy',
    !!conn,
    conn ? `${conn.audioBytes} bytes of audio so far` : `${deepgram.connections.length} connections, no audio`,
  );
  check('the proxy, not the browser, holds the Deepgram key', conn?.auth === `Token ${FAKE_KEY}` && !(await teacher.content()).includes(FAKE_KEY));
  const kt = conn?.url.searchParams.getAll('keyterm') ?? [];
  check(
    'Nova-3 with chemistry keyterms',
    conn?.url.searchParams.get('model') === 'nova-3' && ['cyclohexane', 'benzene', 'ethanol', 'caffeine', 'buckminsterfullerene'].every((k) => kt.includes(k)),
    `${kt.length} keyterms`,
  );
  const panel = (field: string) => teacher.locator(`.voice-debug [data-field="${field}"]`).innerText();
  check('debug panel shows the engine in use', (await teacher.locator('.voice-debug__engine').innerText()).includes('Deepgram'));
  const before5 = (await dbg(teacher))!.scene.length;
  deepgram.interim('show me');
  await teacher.waitForTimeout(150);
  deepgram.interim('show me cyclohexane');
  await teacher.waitForTimeout(300);
  const liveCaption = await panel('live');
  deepgram.final('show me', false); // a final segment, but the utterance goes on
  await teacher.waitForTimeout(1200);
  check(
    'Deepgram partial results and unfinished segments change nothing',
    (await dbg(teacher))!.scene.length === before5 && liveCaption.includes('cyclohexane'),
    `caption "${liveCaption}"`,
  );
  deepgram.final('cyclohexane.', true);
  const withCyclo = await waitFor(teacher, (d) => loadedAll(d, before5 + 1) && !!d.scene.find((x) => x.moleculeId === 'pubchem:8078'), 8000);
  check('the finished utterance adds the molecule ("show me cyclohexane.")', !!withCyclo);
  await teacher.waitForTimeout(300);
  const raw = await panel('raw');
  const command = await panel('command');
  const validated = await panel('validated');
  check(
    'debug panel: raw transcript, interpreted command, PubChem-validated molecule',
    raw === 'show me cyclohexane.' && command === 'ADD cyclohexane' && /Cyclohexane \(PubChem CID 8078\)/.test(validated),
    `"${raw}" → ${command} → ${validated}`,
  );
  deepgram.final('the ring flips between two chair shapes', true);
  await teacher.waitForTimeout(800);
  check('lecture speech through Deepgram is ignored', (await dbg(teacher))!.scene.length === before5 + 1 && (await panel('command')).startsWith('none'));

  // Fallback: without the proxy, voice falls back to the browser's Web Speech API.
  proxy.kill();
  await new Promise((r) => setTimeout(r, 300));
  const solo = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await solo.goto(`${BASE}?role=solo&name=Fallback&debug=voice`);
  const engineText = await solo
    .waitForFunction(() => document.querySelector('.voice-debug__engine')?.textContent?.includes('Browser'), null, { timeout: 8000 })
    .then(() => solo.locator('.voice-debug__engine').innerText())
    .catch(() => solo.locator('.voice-debug__engine').innerText().catch(() => ''));
  const note = await solo.locator('.voice-debug__note').innerText().catch(() => '');
  check('no speech server → falls back to the browser engine (Web Speech API)', engineText.includes('Browser'), note || engineText);

  if (shots) {
    await teacher.screenshot({ path: `${shots}/teacher.png` });
    await student.screenshot({ path: `${shots}/student.png` });
  }
  await browser.close();
  proxy.kill();
  await deepgram.close();

  // --- several people in view: only the closest person's two hands ------------
  if (crowdY4m) {
    const crowdBrowser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve(crowdY4m)}`, '--ignore-gpu-blocklist'],
    });
    const solo = await (await crowdBrowser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
    solo.on('pageerror', (e) => console.log('[crowd pageerror]', e.message));
    await solo.goto(`${BASE}?role=solo&name=Crowd`);
    await solo.click('text=Enable webcam');
    let maxHands = 0;
    let maxIgnored = 0;
    let bothHands = 0;
    let samples = 0;
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      await solo.waitForTimeout(250);
      const d = (await solo.evaluate(`(() => { const h = document.querySelector('.dock__hand'); return h ? { hands: +h.dataset.hands, ignored: +h.dataset.ignored } : null; })()`)) as { hands: number; ignored: number } | null;
      if (!d) continue;
      samples++;
      maxHands = Math.max(maxHands, d.hands);
      maxIgnored = Math.max(maxIgnored, d.ignored);
      if (d.hands === 2) bothHands++;
    }
    check('both of the teacher’s hands are tracked at once', maxHands === 2, `2 hands in ${bothHands}/${samples} samples`);
    check('another person’s (smaller) hand is seen but ignored', maxIgnored >= 1, `up to ${maxIgnored} ignored`);
    if (shots) await solo.screenshot({ path: `${shots}/crowd.png` });
    await crowdBrowser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
