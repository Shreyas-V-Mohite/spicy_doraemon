/**
 * End-to-end browser test: two real Chrome windows (teacher + student)
 * against the Vite dev server and a local SpacetimeDB.
 *
 * The teacher's webcam is Chrome's fake capture device fed with a Y4M built
 * from a real hand photo (scripts/make-fake-webcam.ts), so the hand pipeline
 * runs for real: getUserMedia → MediaPipe → gestures → 3Dmol → SpacetimeDB.
 * The stage starts empty; molecules come from the picker, opened with a finger
 * snap (sent as a command here) or the ＋ Molecule button.
 *
 *   npx tsx scripts/e2e.ts <fake-webcam.y4m> [screenshotDir] [--crowd=<crowd.y4m>]
 * Env: E2E_URL (default http://localhost:5173/), CHROME_PATH, E2E_TEACHER_QUERY.
 */
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';

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

async function main() {
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
  const teacher = await teacherCtx.newPage();
  const student = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  for (const [label, p] of [['teacher', teacher], ['student', student]] as const) {
    p.on('pageerror', (e) => console.log(`[${label} pageerror]`, e.message));
  }

  await teacher.goto(`${BASE}?room=${room}&role=teacher&name=Prof%20E2E${process.env.E2E_TEACHER_QUERY ?? ''}`);
  check('teacher connects to SpacetimeDB and owns the room', !!(await waitFor(teacher, (d) => d.isRoomTeacher && d.ready, 20000)), `room ${room}`);
  await student.goto(`${BASE}?room=${room}&role=student&name=Student%20E2E`);
  check('student joins the same room', !!(await waitFor(student, (d) => d.ready && d.participants >= 2, 20000)));
  // --- empty stage; a snap opens the molecule picker ---------------------------
  check('the stage starts empty (nothing until the teacher picks)', (await dbg(teacher))!.scene.length === 0 && (await dbg(student))!.scene.length === 0);
  const sb0 = (await teacher.locator('.stage').boundingBox())!;
  const FRAME = 4 / 3;
  /** Page point → camera-frame point (as displayed), inverting the backdrop's object-fit: cover. */
  const toCamera = (pageX: number, pageY: number) => {
    const w = sb0.width;
    const h = sb0.height;
    let dispW = w;
    let dispH = w / FRAME;
    if (dispH < h) {
      dispH = h;
      dispW = h * FRAME;
    }
    return { x: (pageX - sb0.x - (w - dispW) / 2) / dispW, y: (pageY - sb0.y - (h - dispH) / 2) / dispH };
  };
  const cmd = (c: object, source: object = { hand: 0 }) => teacher.evaluate(`window.__mgl.command(${JSON.stringify(c)}, ${JSON.stringify(source)})`);
  const pickerOpen = () => teacher.evaluate('window.__mgl.pickerOpen()') as Promise<boolean>;
  /** Hold an index fingertip over a picker tile for `ms` (PLACE commands, like pointing does). */
  const pointAtTile = (name: string, ms: number) => pointAt('.picker__tile:has-text("' + name + '")', ms);
  /** Hold an index fingertip over an element for `ms` (PLACE commands, like pointing does). */
  const pointAt = async (selector: string, ms: number) => {
    const b = (await teacher.locator(selector).first().boundingBox())!;
    const end = Date.now() + ms;
    for (let i = 0; Date.now() < end; i++) {
      const c = toCamera(b.x + b.width / 2 + (i % 2), b.y + b.height / 2);
      await cmd({ type: 'PLACE', x: c.x, y: c.y, frameAspect: FRAME });
      await teacher.waitForTimeout(50);
    }
  };

  await cmd({ type: 'SNAP' });
  await teacher.waitForTimeout(200);
  check('a finger snap opens the molecule picker', (await pickerOpen()) && (await teacher.locator('.picker').isVisible()));
  await cmd({ type: 'ZOOM', factor: 2 }); // other gestures while choosing: ignored
  await pointAtTile('Ethanol', 300); // a glance is not a choice
  await cmd({ type: 'STOP' });
  await teacher.waitForTimeout(500);
  check('a brief point at a tile does not choose it', (await dbg(teacher))!.scene.length === 0 && (await pickerOpen()));
  await pointAtTile('Ethanol', 1000); // hold the fingertip on it (0.7 s)
  const one = await waitFor(teacher, (d) => loadedAll(d, 1), 8000);
  check('pointing at a tile for a moment adds that molecule and closes the picker', !!one && !!byMol(one, 'builtin:ethanol') && !(await pickerOpen()));
  await cmd({ type: 'STOP' });
  await cmd({ type: 'SNAP' });
  await teacher.waitForTimeout(200);
  await cmd({ type: 'SNAP' });
  await teacher.waitForTimeout(200);
  check('snapping again closes it', !(await pickerOpen()) && (await dbg(teacher))!.scene.length === 1);
  await pointAt('[data-gesture-button="add-molecule"]', 300); // a glance
  await cmd({ type: 'STOP' });
  await teacher.waitForTimeout(400);
  const notYet = !(await pickerOpen());
  await pointAt('[data-gesture-button="add-molecule"]', 1000); // hold it
  await cmd({ type: 'STOP' });
  check('pointing at ＋ Molecule for a moment presses it (a glance does not)', notYet && (await pickerOpen()));
  await teacher.click('.picker__tile:has-text("Acetic acid")');
  await waitFor(teacher, (d) => loadedAll(d, 2), 8000);
  await teacher.click('button:has-text("＋ Molecule")');
  await teacher.click('.picker__tile:has-text("Aspirin")');
  const three = await waitFor(teacher, (d) => loadedAll(d, 3), 8000);
  check(
    'clicking works too (ethanol, acetic acid, aspirin on stage)',
    !!three && ['builtin:ethanol', 'pubchem:176', 'builtin:aspirin'].every((id) => !!byMol(three, id)),
  );
  await teacher.waitForTimeout(800);
  const t3 = (await dbg(teacher))!;
  const pl = t3.scene.map((s) => s.placement!);
  const minGap = Math.min(...pl.flatMap((a, i) => pl.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
  check('new molecules are placed apart (no overlap)', minGap > 0.12, `closest pair ${minGap.toFixed(2)} viewer-widths`);
  check('the newest molecule (aspirin) is selected', byMol(t3, 'builtin:aspirin')?.key === t3.active);
  check('student sees all 3 molecules', !!(await waitFor(student, (d) => loadedAll(d, 3), 20000)));
  await teacher.reload();
  await waitFor(teacher, (d) => d.isRoomTeacher && d.ready, 20000);
  await teacher.waitForTimeout(1500);
  check('reloading the teacher page keeps the stage as it was', (await dbg(teacher))!.scene.length === 3);

  // --- each hand works on the molecule nearest its own palm -------------------
  /** A hand command with that hand's palm over a molecule (its on-screen centre). */
  const palmAt = async (id: string) => {
    const d = (await dbg(teacher))!;
    const p = byMol(d, id)!.placement!;
    return toCamera(sb0.x + sb0.width / 2 + p.x * sb0.width, sb0.y + sb0.height / 2 + p.y * sb0.width);
  };
  const handCmd = async (hand: number, at: { x: number; y: number }, c: object) =>
    cmd(c, { hand, palm: { x: at.x, y: at.y, frameAspect: FRAME } });
  const scaleOf = (d: Snap, id: string) => byMol(d, id)!.scale!;
  const ratio = (a: Snap, b: Snap, id: string) => scaleOf(b, id) / scaleOf(a, id);
  const unchanged = (a: Snap, b: Snap, id: string) => Math.abs(ratio(a, b, id) - 1) < 0.01;
  const IDS = ['builtin:ethanol', 'pubchem:176', 'builtin:aspirin'];
  const atEthanol = await palmAt('builtin:ethanol');
  const atAspirin = await palmAt('builtin:aspirin');
  const p0 = (await dbg(teacher))!;
  await handCmd(0, atEthanol, { type: 'ZOOM', factor: 1 / 1.4 });
  await teacher.waitForTimeout(400); // let the resize ease in (STOP drops what is still pending)
  await handCmd(0, atEthanol, { type: 'STOP' });
  await teacher.waitForTimeout(400);
  const p1 = (await dbg(teacher))!;
  check(
    'a hand resizes only the molecule nearest its palm (ethanol), not the selected one',
    ratio(p0, p1, 'builtin:ethanol') < 0.8 && unchanged(p0, p1, 'builtin:aspirin') && unchanged(p0, p1, 'pubchem:176'),
    `ethanol ×${ratio(p0, p1, 'builtin:ethanol').toFixed(2)}, aspirin ×${ratio(p0, p1, 'builtin:aspirin').toFixed(2)}`,
  );
  await handCmd(1, atAspirin, { type: 'ZOOM', factor: 1 / 1.4 });
  await teacher.waitForTimeout(400);
  await handCmd(1, atAspirin, { type: 'STOP' });
  await teacher.waitForTimeout(400);
  const p2 = (await dbg(teacher))!;
  check(
    '…and the other hand, over aspirin, resizes only aspirin',
    ratio(p1, p2, 'builtin:aspirin') < 0.8 && unchanged(p1, p2, 'builtin:ethanol') && unchanged(p1, p2, 'pubchem:176'),
    `aspirin ×${ratio(p1, p2, 'builtin:aspirin').toFixed(2)}`,
  );
  // Both palms over ethanol: the first hand has it, the second takes the next nearest.
  const others = IDS.filter((id) => id !== 'builtin:ethanol');
  const pe = byMol(p2, 'builtin:ethanol')!.placement!;
  const dist = (id: string) => Math.hypot(byMol(p2, id)!.placement!.x - pe.x, byMol(p2, id)!.placement!.y - pe.y);
  const nextNearest = others.sort((a, b) => dist(a) - dist(b))[0];
  const third = others.find((id) => id !== nextNearest)!;
  await handCmd(0, atEthanol, { type: 'ZOOM', factor: 1 / 1.2 });
  await handCmd(1, atEthanol, { type: 'ZOOM', factor: 1 / 1.2 });
  await teacher.waitForTimeout(400);
  await handCmd(0, atEthanol, { type: 'STOP' });
  await handCmd(1, atEthanol, { type: 'STOP' });
  await teacher.waitForTimeout(400);
  const p3 = (await dbg(teacher))!;
  check(
    'two hands never share a molecule: the second hand takes the next nearest',
    ratio(p2, p3, 'builtin:ethanol') < 0.9 && ratio(p2, p3, nextNearest) < 0.9 && unchanged(p2, p3, third),
    `ethanol ×${ratio(p2, p3, 'builtin:ethanol').toFixed(2)}, ${nextNearest} ×${ratio(p2, p3, nextNearest).toFixed(2)}`,
  );
  await teacher.click('.mol-chip:has-text("Aspirin")'); // select aspirin again for the key tests below
  await teacher.waitForTimeout(300);

  // --- gestures/buttons act on the selected molecule only ----------------
  const asp = (d: Snap) => byMol(d, 'builtin:aspirin')!;
  const eth = (d: Snap) => byMol(d, 'builtin:ethanol')!;
  const before = (await dbg(teacher))!;
  for (let i = 0; i < 6; i++) await teacher.keyboard.press('ArrowRight');
  await teacher.waitForTimeout(1500);
  let t = (await dbg(teacher))!;
  let s = (await dbg(student))!;
  check('rotation turns the selected molecule', angleDeg(asp(before).view, asp(t).view) > 30, `${angleDeg(asp(before).view, asp(t).view).toFixed(1)}°`);
  check('…and leaves the others alone', angleDeg(eth(before).view, eth(t).view) < 0.5);
  check(
    'student follows each molecule',
    angleDeg(asp(t).view, asp(s).view) < 1 && angleDeg(eth(t).view, eth(s).view) < 1,
    `residual ${angleDeg(asp(t).view, asp(s).view).toFixed(2)}°`,
  );

  // --- throttling --------------------------------------------------------
  const seqOf = (d: Snap) => d.items.find((i) => i.moleculeId === 'builtin:aspirin')!.seq;
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
  await dragChip(teacher, 'Ethanol', { x: 0.62, y: 0.3 });
  await teacher.waitForTimeout(800);
  t = (await dbg(teacher))!;
  check(
    'a molecule can be moved',
    Math.hypot(eth(t).placement!.x - eth(before).placement!.x, eth(t).placement!.y - eth(before).placement!.y) > 0.1,
  );
  await student.waitForTimeout(800);
  s = (await dbg(student))!;
  check(
    'student sees it moved',
    Math.abs(eth(s).placement!.x - eth(t).placement!.x) < 0.05,
    `teacher x ${eth(t).placement!.x.toFixed(2)} / student x ${eth(s).placement!.x.toFixed(2)}`,
  );
  // Into the trash zone with the mouse button still held: it must go without a release.
  await dragChip(teacher, 'Ethanol', 'trash', false);
  const goneHeld = await waitFor(teacher, (d) => d.scene.length === 2 && !byMol(d, 'builtin:ethanol'), 3000);
  const trashClass = (await teacher.getAttribute('.trash', 'class')) ?? '';
  await teacher.mouse.up();
  check('entering the trash deletes it at once (no release needed)', !!goneHeld);
  check('…and the trash icon returns to normal', !/is-over|is-armed/.test(trashClass), trashClass);
  check('…for the student too', !!(await waitFor(student, (d) => d.scene.length === 2 && !byMol(d, 'builtin:ethanol'), 8000)));
  await dragChip(teacher, 'Aspirin', { x: 0.45, y: 0.55 });
  await teacher.waitForTimeout(600);
  const afterDrop = (await dbg(teacher))!;
  const stageBox = (await teacher.locator('.stage').boundingBox())!;
  const want = { x: -0.05, y: (0.05 * stageBox.height) / stageBox.width };
  const got = asp(afterDrop).placement!;
  check(
    'dropping anywhere else moves it there and keeps it',
    afterDrop.scene.length === 2 && Math.hypot(got.x - want.x, got.y - want.y) < 0.03,
    `aspirin at (${got.x.toFixed(2)}, ${got.y.toFixed(2)}), wanted (${want.x.toFixed(2)}, ${want.y.toFixed(2)})`,
  );

  // --- size limits: zooming stops where the molecule still fits on screen ---------
  const fitOf = (d: Snap) => asp(d).fit!;
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
    const cx = sb.width / 2 + asp(d).placement!.x * sb.width;
    const cy = sb.height / 2 + asp(d).placement!.y * sb.width;
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
    Math.abs(Math.log((bigger.scene.find((x) => x.key === asp(big).key)!.scale ?? 1) / (asp(big).scale ?? 1))) < 0.002,
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
  check('a moving, twisting real hand that never snaps does not open the picker', !(await pickerOpen()));
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

  // --- adding more: ⚙ → Type a name (bundled pack, no PubChem round trip) ------
  const pubchemCalls: string[] = [];
  teacher.on('request', (r) => {
    if (r.url().includes('pubchem.ncbi')) pubchemCalls.push(r.url());
  });
  const n0 = (await dbg(teacher))!.scene.length;
  await teacher.evaluate(`window.__mgl.addByName('vanillin')`);
  const withVanillin = await waitFor(teacher, (d) => loadedAll(d, n0 + 1), 10000);
  check('typing a name adds that molecule (vanillin, from the bundled pack)', !!withVanillin && pubchemCalls.length === 0, `${pubchemCalls.length} PubChem requests`);

  if (shots) {
    await teacher.screenshot({ path: `${shots}/teacher.png` });
    await student.screenshot({ path: `${shots}/student.png` });
  }
  await browser.close();

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
