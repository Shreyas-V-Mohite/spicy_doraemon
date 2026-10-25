import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureRecognizer } from '../src/gestures/GestureRecognizer';
import { GestureMotionMapper } from '../src/gestures/GestureMotionMapper';
import { openness } from '../src/gestures/handGeometry';
import type { GestureCommand } from '../src/gestures/types';
import { keyToCommand } from '../src/gestures/ManualGestureController';
import { frameOf, synthHand, synthWorld, type SynthHandOpts } from './helpers';

const DT = 50; // 20 fps

const OPEN: SynthHandOpts = { curl: 0 };
const FIST: SynthHandOpts = { curl: 1 };
const HALF: SynthHandOpts = { curl: 0.4 };
const POINT: SynthHandOpts = { index: 'ext', middle: 'curl', ring: 'curl', pinky: 'curl', thumbTip: { x: -40, y: -60 } };

function run(rec: GestureRecognizer, frames: SynthHandOpts[]) {
  let out = rec.update(frameOf(0, null));
  frames.forEach((f, i) => (out = rec.update(frameOf((i + 1) * DT, synthHand(f)))));
  return out;
}

test('openness: fist ≈ 0, open hand ≈ 1, monotonic in between', () => {
  assert.ok(openness(synthHand({ curl: 1 })) < 0.05);
  assert.ok(openness(synthHand({ curl: 0 })) > 0.95);
  let prev = Infinity;
  for (let c = 0; c <= 1.0001; c += 0.1) {
    const o = openness(synthHand({ curl: c }));
    assert.ok(o <= prev + 1e-9);
    prev = o;
  }
});

test('recognizer: open, fist, half-closed and pointing postures', () => {
  assert.equal(run(new GestureRecognizer(), Array(8).fill(OPEN)).posture, 'OPEN');
  assert.equal(run(new GestureRecognizer(), Array(8).fill(FIST)).posture, 'FIST');
  assert.equal(run(new GestureRecognizer(), Array(8).fill(HALF)).posture, 'HALF');
  assert.equal(run(new GestureRecognizer(), Array(8).fill(POINT)).posture, 'POINT');
});

test('recognizer: half-closed must be held ~250 ms (passing through it does not switch modes)', () => {
  const rec = new GestureRecognizer();
  run(rec, Array(4).fill(OPEN));
  let t = 4 * DT;
  for (let i = 0; i < 2; i++) assert.notEqual(rec.update(frameOf((t += DT), synthHand(HALF))).posture, 'HALF');
  for (let i = 0; i < 4; i++) rec.update(frameOf((t += DT), synthHand(FIST)));
  assert.equal(rec.update(frameOf((t += DT), synthHand(FIST))).posture, 'FIST');
  for (let i = 0; i < 6; i++) rec.update(frameOf((t += DT), synthHand(HALF)));
  assert.equal(rec.update(frameOf((t += DT), synthHand(HALF))).posture, 'HALF');
});

/** Recognizer + mapper driven by synthetic hands; optional 3D world points. */
function harness(use3d = false) {
  const rec = new GestureRecognizer();
  const map = new GestureMotionMapper();
  let t = 0;
  const step = (o: SynthHandOpts | null) => {
    t += DT;
    const f = frameOf(t, o ? synthHand(o) : null, 0.8, o && use3d ? synthWorld(o) : undefined);
    return map.update(f, rec.update(f));
  };
  const steps = (n: number, o: SynthHandOpts | null | ((i: number) => SynthHandOpts | null)) => {
    const cmds: GestureCommand[] = [];
    for (let i = 0; i < n; i++) cmds.push(...step(typeof o === 'function' ? o(i) : o));
    return cmds;
  };
  /** Snap to start, then let the post-snap settle time pass with an open hand. */
  /** The molecule is called by voice (start), then the post-start settle time passes. */
  const begin = () => {
    map.reset(t); // camera started
    return steps(16, OPEN);
  };
  return { map, steps, begin };
}

const sum = (cmds: GestureCommand[], k: 'dx' | 'dy' | 'dz') =>
  cmds.reduce((s, c) => s + (c.type === 'ROTATE' ? (c[k] ?? 0) : 0), 0);
const zooms = (cmds: GestureCommand[]) => cmds.flatMap((c) => (c.type === 'ZOOM' ? [c.factor] : []));
const product = (xs: number[]) => xs.reduce((p, x) => p * x, 1);

test('mapper: control starts as soon as tracking runs — no snap needed', () => {
  const h = harness();
  h.begin();
  h.steps(8, POINT);
  assert.equal(h.map.status('POINT').mode, 'MOVE');
});

/** Hold a hand shape still for `ms` and return the commands. */
const hold = (h: ReturnType<typeof harness>, o: SynthHandOpts, ms: number) => h.steps(Math.round(ms / DT), o);
const mode = (h: ReturnType<typeof harness>) => h.map.status('OTHER').mode;

test('mapper: fingers opening/closing = resize (open big, fist small), never rotate', () => {
  const h = harness();
  // A hand that appears and holds still doesn't resize anything.
  assert.equal(zooms(h.begin()).length, 0);
  // Close part way and immediately reopen (holding still ½ s would switch to rotate).
  const closing = h.steps(11, (i) => ({ curl: Math.min(0.55, (i + 1) * 0.05) }));
  const shrink = product(zooms(closing));
  assert.ok(shrink < 0.5, `open → half closed multiplies size by ${shrink.toFixed(2)}`);
  assert.ok(zooms(closing).every((f) => f < 1), 'closing only ever shrinks');
  assert.equal(closing.filter((c) => c.type === 'ROTATE' || c.type === 'PLACE').length, 0);
  assert.equal(mode(h), 'ZOOM');
  const grow = product(zooms(h.steps(11, (i) => ({ curl: Math.max(0, 0.55 - (i + 1) * 0.05) }))));
  assert.ok(grow > 1.7, `half closed → open multiplies size by ${grow.toFixed(2)}`);
  assert.equal(mode(h), 'ZOOM');
});

test('mapper: repeat zoom — after opening all the way, re-closing is free, so open-close-open keeps growing', () => {
  const h = harness();
  h.begin();
  const curlTo = (from: number, to: number) => h.steps(Math.round(Math.abs(to - from) / 0.05), (i) => ({ curl: from + Math.sign(to - from) * (i + 1) * 0.05 }));
  curlTo(0, 0.55); // part way: no ratchet yet
  const first = product(zooms(curlTo(0.55, 0)));
  assert.ok(first > 1.7, `first open grows ×${first.toFixed(2)}`);
  const back = zooms(curlTo(0, 0.6));
  assert.equal(back.length, 0, 're-closing right after a full open does not shrink it back');
  const second = product(zooms(curlTo(0.6, 0)));
  assert.ok(second > 1.7, `second open grows again ×${second.toFixed(2)} (total ×${(first * second).toFixed(1)})`);
});

test('mapper: repeat zoom out — after closing all the way, reopening is free, so close-open-close keeps shrinking', () => {
  const h = harness();
  h.begin();
  const curlTo = (from: number, to: number) => h.steps(Math.round(Math.abs(to - from) / 0.05), (i) => ({ curl: from + Math.sign(to - from) * (i + 1) * 0.05 }));
  const out1 = product(zooms(curlTo(0, 0.75)));
  const reopen = zooms(curlTo(0.75, 0.25));
  const out2 = product(zooms(curlTo(0.25, 0.75)));
  assert.ok(out1 < 0.5 && out2 < 0.6, `two closes shrink twice (×${out1.toFixed(2)}, ×${out2.toFixed(2)})`);
  assert.equal(reopen.length, 0, 'reopening in between does not grow it');
});

/**
 * Open hand → point: the other three fingers fold over `ms` while the index
 * bends only a little (as real hands do). Without the transition guards this
 * shrank the molecule to ×0.6–0.7.
 */
const toPoint = (h: ReturnType<typeof harness>, ms: number) => {
  const n = Math.round(ms / DT);
  return h.steps(n, (i) => {
    const k = (i + 1) / n;
    return { curls: { index: 0.15 * k, middle: k, ring: k, pinky: k }, thumbTip: { x: -85 + 45 * k, y: -80 + 20 * k } };
  });
};

test('transition: open hand → pointing never resizes (fast and slow changes)', () => {
  for (const ms of [150, 300, 600]) {
    const h = harness();
    h.begin();
    // Resize first (the user enlarged the molecule), then switch to pointing.
    h.steps(8, (i) => ({ curl: Math.min(0.4, (i + 1) * 0.05) }));
    h.steps(8, (i) => ({ curl: Math.max(0, 0.4 - (i + 1) * 0.05) }));
    const cmds = [...toPoint(h, ms), ...hold(h, POINT, 400)];
    assert.equal(zooms(cmds).length, 0, `${ms} ms change: no resize (got ${zooms(cmds).map((f) => f.toFixed(2)).join(', ')})`);
    assert.equal(mode(h), 'MOVE', `${ms} ms change: ends in move`);
  }
});

test('transition: pointing → open hand never resizes either', () => {
  const h = harness();
  h.begin();
  hold(h, POINT, 400);
  assert.equal(mode(h), 'MOVE');
  const n = 6;
  const cmds = h.steps(n, (i) => {
    const k = 1 - (i + 1) / n;
    return { curls: { index: 0, middle: k, ring: k, pinky: k } };
  });
  cmds.push(...hold(h, OPEN, 400));
  assert.equal(zooms(cmds).length, 0);
  assert.equal(cmds.filter((c) => c.type === 'PLACE').length > 0 && cmds.findIndex((c) => c.type === 'PLACE') > n, false, 'no fingertip-follow after leaving the point');
});

test('transition: the status names the gesture (OPEN_PALM / POINTING / TRANSITION)', () => {
  const h = harness();
  h.begin();
  assert.equal(h.map.status('OPEN').gesture, 'OPEN_PALM');
  h.steps(2, { curls: { index: 0, middle: 0.6, ring: 0.6, pinky: 0.6 } });
  assert.equal(h.map.status('OTHER').gesture, 'TRANSITION');
  hold(h, POINT, 400);
  assert.equal(h.map.status('POINT').gesture, 'POINTING');
});

test('transition: a real resize right after pointing works once the hand has settled (≥ 200 ms)', () => {
  const h = harness();
  h.begin();
  hold(h, POINT, 400);
  h.steps(6, (i) => ({ curls: { index: 0, middle: 1 - (i + 1) / 6, ring: 1 - (i + 1) / 6, pinky: 1 - (i + 1) / 6 } }));
  hold(h, OPEN, 300);
  const shrink = product(zooms(h.steps(11, (i) => ({ curl: Math.min(0.55, (i + 1) * 0.05) }))));
  assert.ok(shrink < 0.5, `closing the whole hand still shrinks (×${shrink.toFixed(2)})`);
});

test('mapper: fingers held still at ANY bend for 0.5 s → rotate (slightly, half, or fully closed)', () => {
  for (const [label, shape] of [['slightly closed', { curl: 0.3 }], ['half', HALF], ['fist', FIST]] as const) {
    const h = harness();
    h.begin();
    hold(h, shape, 150);
    assert.equal(mode(h), 'ZOOM', `${label}: not instantly`);
    // Time from the fingers stopping to rotate mode (includes keypoint-filter settling).
    let ms = 150;
    let sawProgress = false;
    while (mode(h) !== 'ROTATE' && ms < 2000) {
      hold(h, shape, DT);
      ms += DT;
      if (h.map.status('OTHER').rotateProgress > 0.3) sawProgress = true;
    }
    assert.ok(sawProgress, `${label}: progress shown`);
    assert.ok(ms <= 800, `${label}: rotate after ${ms} ms (want ≤ 800)`);
  }
});

test('mapper: resize and rotate never overlap', () => {
  const h = harness(true);
  h.begin();
  // Close the hand (resize), then hold still (→ rotate) and turn it.
  const closing = h.steps(10, (i) => ({ curl: Math.min(0.4, (i + 1) * 0.04) }));
  const settleStart = hold(h, HALF, 300); // keypoint filters catch up
  const settleRest = hold(h, HALF, 400);
  const turning = h.steps(20, (i) => ({ ...HALF, yaw: (i + 1) * 3 }));
  const all = [...closing, ...settleStart, ...settleRest, ...turning];
  // Once a ROTATE appears, no SCALE may follow.
  const firstRot = all.findIndex((c) => c.type === 'ROTATE');
  assert.ok(firstRot > 0);
  assert.equal(all.slice(firstRot).filter((c) => c.type === 'ZOOM').length, 0);
  // The switch itself flushes any resize still easing in the viewer.
  assert.ok(settleRest.some((c) => c.type === 'STOP'), 'STOP on the switch');
  // Once the fingers have settled the size is frozen.
  assert.equal(settleRest.filter((c) => c.type === 'ZOOM').length, 0);
});

test('mapper: a fully open hand held still stays in resize', () => {
  const h = harness();
  h.begin();
  hold(h, OPEN, 3000);
  assert.equal(mode(h), 'ZOOM');
});

test('mapper: slow, continuous opening/closing never counts as "still"', () => {
  const h = harness();
  h.begin();
  // Close slowly over 3 s without stopping: always moving more than the
  // steady band, so it keeps resizing (and never locks into rotate).
  const cmds = h.steps(60, (i) => ({ curl: ((i + 1) / 60) * 0.7 }));
  assert.equal(mode(h), 'ZOOM');
  const total = product(zooms(cmds));
  assert.ok(total < 0.5, `it resized all along (×${total.toFixed(2)})`);
});

test('size lock: after resizing, fingers that stop (a little wiggle allowed) fix the size and switch to rotate', () => {
  for (const end of [0, 0.3]) {
    const h = harness(true);
    h.begin();
    // Shrink part way, then open again to enlarge (ending fully open, or slightly bent).
    h.steps(8, (i) => ({ curl: Math.min(0.5, (i + 1) * 0.0625) }));
    hold(h, { curl: 0.5 }, 150);
    const grow = h.steps(10, (i) => ({ curl: Math.max(end, 0.5 - (i + 1) * 0.05) }));
    assert.ok(product(zooms(grow)) > 1.1, `stopped at curl ${end}: it grew ×${product(zooms(grow)).toFixed(2)}`);
    // Stop, with a tiny wiggle: the size locks and rotation starts within ~0.7 s.
    const still = h.steps(14, (i) => ({ curl: end + (i % 2 ? 0.03 : 0) }));
    assert.equal(mode(h), 'ROTATE', `stopped at curl ${end}: rotate`);
    const sizeAfterStop = product(zooms(still));
    assert.ok(Math.abs(Math.log(sizeAfterStop)) < 0.05, `stopping barely changes the size (×${sizeAfterStop.toFixed(3)})`);
    // Now bend the fingers into a "holding a ball" pose and turn: the size stays.
    const bend = h.steps(10, (i) => ({ curl: end + ((i + 1) / 10) * 0.35, yaw: (i + 1) * 3 }));
    assert.equal(zooms(bend).length, 0, 'bending the fingers while rotating never resizes');
    assert.equal(mode(h), 'ROTATE');
  }
});

test('mapper (2D): in rotate, twisting spins the molecule', () => {
  const h = harness();
  h.begin();
  hold(h, HALF, 700);
  const cmds = h.steps(30, (i) => ({ ...HALF, roll: -Math.min(60, (i + 1) * 3) }));
  const dz = sum(cmds, 'dz');
  assert.ok(dz > 35 && dz < 80, `60° twist → ${dz.toFixed(1)}° spin`);
});

test('mapper (3D): tilting the hand forward/back turns the molecule about X with extra gain', () => {
  const h = harness(true);
  h.begin();
  hold(h, HALF, 700);
  const cmds = h.steps(30, (i) => ({ ...HALF, pitch: Math.min(30, (i + 1) * 1.5) }));
  const dy = sum(cmds, 'dy');
  assert.ok(Math.abs(dy) > 50, `30° tilt → ${dy.toFixed(1)}° about X (gain 2.4)`);
  assert.ok(Math.abs(sum(cmds, 'dx')) < 10, 'tilt does not turn about Y');
});

test('mapper (3D): in rotate, the molecule turns the way the hand turns — both directions', () => {
  const turn = (yaw: number) => {
    const h = harness(true);
    h.begin();
    hold(h, HALF, 700);
    return h.steps(30, (i) => ({ ...HALF, yaw: (yaw * Math.min(30, i + 1)) / 30 }));
  };
  const a = sum(turn(60), 'dx');
  const b = sum(turn(-60), 'dx');
  assert.ok(Math.abs(a) > 45 && Math.abs(a) < 90, `60° turn → ${a.toFixed(1)}° (gain 1.2)`);
  assert.equal(Math.sign(a), -Math.sign(b), `opposite turns give opposite rotations (${a.toFixed(1)} vs ${b.toFixed(1)})`);
});

test('mapper (3D): showing the back of the hand keeps rotating, even if the fingers read differently', () => {
  const h = harness(true);
  h.begin();
  hold(h, HALF, 700);
  assert.equal(mode(h), 'ROTATE');
  // Turn the hand over to show its back; finger readings change too.
  const cmds = h.steps(40, (i) => ({ curl: i < 20 ? 0.4 : 0.05, yaw: Math.min(160, (i + 1) * 8) }));
  assert.equal(mode(h), 'ROTATE', 'stays in rotate with the back of the hand to the camera');
  assert.equal(cmds.filter((c) => c.type === 'ZOOM').length, 0, 'no resizing while turned away');
  assert.ok(Math.abs(sum(cmds, 'dx')) > 60, 'and it keeps turning the molecule');
});

test('mapper: in rotate, only a full squeeze (open ↔ fist) goes back to resizing', () => {
  const h = harness(true);
  h.begin();
  hold(h, HALF, 700);
  assert.equal(mode(h), 'ROTATE');
  // Opening part way or all the way, and staying: still rotating.
  h.steps(10, { curl: 0 });
  assert.equal(mode(h), 'ROTATE', 'opening alone is not enough');
  // Open, then a full fist within 0.8 s: resize again.
  h.steps(5, { curl: 1 });
  assert.equal(mode(h), 'ZOOM');
  // …and opening right away resizes (resting in a fist would lock it again).
  const grow = product(zooms(h.steps(10, (i) => ({ curl: Math.max(0.5, 1 - (i + 1) * 0.05) }))));
  assert.ok(grow > 1.3, `the next opening resizes (×${grow.toFixed(2)})`);
});

test('mapper: rotate survives the hand vanishing briefly', () => {
  const h = harness(true);
  h.begin();
  hold(h, HALF, 700);
  h.steps(10, null); // 0.5 s gone
  assert.equal(mode(h), 'ROTATE');
  const back = h.steps(6, { ...HALF, yaw: 40 }); // returns already turned: no jump
  assert.ok(Math.abs(sum(back, 'dx')) < 5, `no jump: ${sum(back, 'dx').toFixed(1)}`);
  h.steps(40, null); // 2 s gone
  assert.equal(h.map.status('NONE').mode, 'HOLD');
});

test('mapper: pointing index finger drives the molecule to the fingertip (mirrored)', () => {
  const h = harness();
  h.begin();
  h.steps(8, POINT);
  assert.equal(mode(h), 'MOVE');
  const cmds = h.steps(10, (i) => ({ ...POINT, x: 320 - (i + 1) * 10 }));
  const places = cmds.flatMap((c) => (c.type === 'PLACE' ? [c] : []));
  assert.ok(places.length > 5);
  assert.ok(places[places.length - 1].x > places[0].x);
  assert.ok(Math.abs(places[0].frameAspect - 640 / 480) < 1e-9);
  assert.ok(h.steps(10, null).some((c) => c.type === 'STOP'));
});

test('manual keyboard mapping uses the same command vocabulary', () => {
  assert.deepEqual(keyToCommand('ArrowRight'), { type: 'ROTATE', dx: 12, dy: 0 });
  assert.deepEqual(keyToCommand('e'), { type: 'ROTATE', dx: 0, dy: 0, dz: 12 });
  assert.equal(keyToCommand('+')?.type, 'ZOOM');
  assert.deepEqual(keyToCommand('r'), { type: 'RESET' });
});
