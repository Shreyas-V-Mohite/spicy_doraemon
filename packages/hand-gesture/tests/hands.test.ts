import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandSelector, palmSizePx } from '../src/gestures/HandSelector';
import type { HandObservation } from '../src/gestures/types';
import { synthHand } from './helpers';

/** A synthetic hand at (x, y), `scale` × the default size (bigger = closer to the camera). */
function hand(x: number, y: number, scale: number, handedness?: 'Left' | 'Right'): HandObservation {
  const kp = synthHand({ x: 0, y: 0 }).map((k) => ({ x: x + k.x * scale, y: y + k.y * scale, score: k.score }));
  return { keypoints: kp, bbox: { x1: 0, y1: 0, x2: 0, y2: 0 }, detScore: 0.9, poseScore: 0.9, fromDetector: false, handedness };
}

test('hands: palm size does not change when the fingers close', () => {
  const open = synthHand({ curl: 0 });
  const fist = synthHand({ curl: 1 });
  const obs = (kp: typeof open): HandObservation => ({ keypoints: kp, bbox: { x1: 0, y1: 0, x2: 0, y2: 0 }, detScore: 1, poseScore: 1, fromDetector: false });
  assert.ok(Math.abs(palmSizePx(obs(open)) - palmSizePx(obs(fist))) < 1);
});

test('hands: with several people in view, only the closest person’s two hands are used', () => {
  const sel = new HandSelector();
  const teacherL = hand(500, 400, 1.6, 'Left');
  const teacherR = hand(800, 420, 1.5, 'Right');
  const studentA = hand(200, 300, 0.7, 'Right');
  const studentB = hand(1100, 250, 0.6, 'Left');
  const { chosen, ignored } = sel.select([studentA, teacherR, studentB, teacherL], 0);
  assert.equal(chosen.length, 2);
  assert.deepEqual(new Set(chosen.map((c) => c.hand)), new Set([teacherL, teacherR]));
  assert.equal(chosen[0].hand, teacherL, 'the biggest hand is the primary');
  assert.equal(ignored.length, 2);
  assert.notEqual(chosen[0].slot, chosen[1].slot);
});

test('hands: a far-away hand of similar size is someone else’s, not the teacher’s second hand', () => {
  const sel = new HandSelector();
  const teacher = hand(300, 400, 1.0, 'Right');
  const neighbour = hand(1500, 400, 1.0, 'Left'); // 12 hand sizes away
  const { chosen } = sel.select([teacher, neighbour], 0);
  assert.equal(chosen.length, 1);
});

test('hands: each hand keeps its slot while moving, and the person doesn’t flip to a similar-size hand', () => {
  const sel = new HandSelector();
  let a = hand(400, 400, 1.2, 'Left');
  let b = hand(700, 400, 1.2, 'Right');
  const first = sel.select([a, b], 0);
  const slotOf = (sel2: typeof first, h: HandObservation) => sel2.chosen.find((c) => c.hand === h)?.slot;
  const sa = slotOf(first, a);
  const sb = slotOf(first, b);
  for (let i = 1; i <= 10; i++) {
    a = hand(400 + i * 15, 400 - i * 5, 1.2, 'Left');
    b = hand(700 - i * 10, 400 + i * 5, 1.2, 'Right');
    const other = hand(1000, 300, 1.25, 'Left'); // someone slightly bigger appears
    const s = sel.select(i % 2 ? [b, other, a] : [other, a, b], i * 33);
    assert.equal(slotOf(s, a), sa, `frame ${i}: left hand kept its slot`);
    assert.equal(slotOf(s, b), sb, `frame ${i}: right hand kept its slot`);
    assert.ok(s.chosen.every((c) => c.fresh === false));
  }
});

test('hands: when the teacher’s hands leave, the next closest person takes over (fresh slots)', () => {
  const sel = new HandSelector();
  sel.select([hand(400, 400, 1.5, 'Left')], 0);
  const student = hand(900, 300, 0.8, 'Right');
  const s = sel.select([student], 1000); // long after the teacher's hand was last seen
  assert.equal(s.chosen.length, 1);
  assert.equal(s.chosen[0].hand, student);
  assert.equal(s.chosen[0].fresh, true);
});
