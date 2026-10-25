import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapDetector } from '../src/gestures/SnapDetector';
import { frameOf, synthHand, synthWorld, type SynthHandOpts } from './helpers';

const DT = 33; // 30 fps

/** Thumb tip pressed on the middle fingertip (middle half bent), the snap's start. */
const PINCH: SynthHandOpts = { curls: { index: 0.3, middle: 0.5, ring: 0.9, pinky: 0.9 }, thumbTip: { x: -10, y: -135 } };
/** Right after the snap: middle finger down in the palm, thumb slid off. */
const SNAPPED: SynthHandOpts = { curls: { index: 0.3, middle: 1, ring: 0.9, pinky: 0.9 }, thumbTip: { x: -70, y: -125 } };
const OPEN: SynthHandOpts = { curl: 0 };

function runner(use3d: boolean) {
  const d = new SnapDetector();
  let t = 0;
  const step = (o: SynthHandOpts) => {
    t += DT;
    return d.update(frameOf(t, synthHand(o), 0.9, use3d ? synthWorld(o) : undefined));
  };
  const steps = (n: number, o: SynthHandOpts | ((i: number) => SynthHandOpts)) => {
    let fired = 0;
    for (let i = 0; i < n; i++) if (step(typeof o === 'function' ? o(i) : o)) fired++;
    return fired;
  };
  return { step, steps };
}

for (const use3d of [false, true]) {
  const tag = use3d ? '(3D)' : '(2D)';

  test(`snap ${tag}: press thumb on middle, flick → one snap`, () => {
    const r = runner(use3d);
    assert.equal(r.steps(5, OPEN), 0);
    assert.equal(r.steps(5, PINCH), 0, 'pressing is not a snap yet');
    assert.equal(r.step(SNAPPED), true, 'the flick is');
    assert.equal(r.steps(10, SNAPPED), 0, 'only once');
  });

  test(`snap ${tag}: opening the pinch slowly is not a snap`, () => {
    const r = runner(use3d);
    r.steps(5, PINCH);
    const fired = r.steps(15, (i) => {
      const k = (i + 1) / 15;
      return { curls: { index: 0.3, middle: 0.5, ring: 0.9, pinky: 0.9 }, thumbTip: { x: -10 - 60 * k, y: -135 + 10 * k } };
    });
    assert.equal(fired, 0);
  });

  test(`snap ${tag}: letting go fast without the middle finger flicking is not a snap`, () => {
    const r = runner(use3d);
    r.steps(5, PINCH);
    assert.equal(r.steps(5, { curls: { index: 0.3, middle: 0.5, ring: 0.9, pinky: 0.9 }, thumbTip: { x: -85, y: -80 } }), 0);
  });

  test(`snap ${tag}: making a fist quickly is not a snap`, () => {
    const r = runner(use3d);
    r.steps(5, OPEN);
    assert.equal(r.steps(8, { curl: 1 }), 0);
  });

  test(`snap ${tag}: a touch shorter than 50 ms does not arm it`, () => {
    const r = runner(use3d);
    r.steps(5, OPEN);
    r.steps(1, PINCH);
    assert.equal(r.step(SNAPPED), false);
  });

  test(`snap ${tag}: a second snap within 0.8 s is ignored, a later one counts`, () => {
    const r = runner(use3d);
    r.steps(5, PINCH);
    assert.equal(r.step(SNAPPED), true);
    r.steps(4, PINCH);
    assert.equal(r.step(SNAPPED), false, 'too soon');
    r.steps(25, OPEN); // ~0.8 s
    r.steps(5, PINCH);
    assert.equal(r.step(SNAPPED), true);
  });
}
