#!/usr/bin/env node
/**
 * Measures the retrieval floor, the question-grouping cutoff and the answer
 * pipeline against a labelled set of questions (scripts/eval-set.json) and a
 * synthetic lesson (samples/organic-chemistry-intro.md).
 *
 *   node scripts/eval.mjs                    all three
 *   node scripts/eval.mjs retrieval groups   just those
 *
 * It uses real services (Voyage embeddings, and Claude for `answers`), so it
 * costs a little money. The lesson and questions are synthetic: use this to
 * see how the thresholds behave, then re-run it on a real lesson.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envGet, convex, root, run, sleep } from './lib/convex-cli.mjs';

const phases = process.argv.slice(2);
const want = (p) => phases.length === 0 || phases.includes(p);
const set = JSON.parse(readFileSync(join(root, 'scripts', 'eval-set.json'), 'utf8'));
const pct = (n, d) => (d === 0 ? 'n/a' : `${n}/${d}`);
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---- setup: a throwaway course holding the synthetic lesson
const passcode = envGet('PROFESSOR_PASSCODE');
const token = `eval-${randomUUID()}`;
const COURSE = 'Eval (synthetic lesson)';
let course = (run('courses:list', { passcode }) ?? []).find((c) => c.name === COURSE);
if (course) run('courses:claim', { passcode, courseId: course._id, token });
else course = { _id: run('courses:create', { passcode, token, name: COURSE }) };
if (!(run('lessons:list', { courseId: course._id, token }) ?? []).length) {
  console.log('Uploading the synthetic lesson...');
  run('lessons:create', {
    courseId: course._id,
    token,
    title: 'Introduction to organic chemistry',
    text: readFileSync(join(root, set.lesson), 'utf8'),
  });
}

// ---- 1. retrieval floor
if (want('retrieval')) {
  console.log('\n=== Retrieval floor (a question below it never reaches Claude)');
  const rows = [];
  for (const kind of ['covered', 'notCovered']) {
    for (const item of set[kind]) {
      const hits = run('retrieval:search', { courseId: course._id, question: item.q });
      rows.push({ ...item, group: kind === 'covered' ? 'covered' : item.kind, top: hits[0]?.score ?? 0, hits });
    }
  }
  const covered = rows.filter((r) => r.group === 'covered');
  const hit1 = covered.filter((r) => r.hits[0]?.label.includes(r.section)).length;
  const hit3 = covered.filter((r) => r.hits.slice(0, 3).some((h) => h.label.includes(r.section))).length;
  console.log(`right section is the top result for ${pct(hit1, covered.length)} covered questions, in the top 3 for ${pct(hit3, covered.length)}`);
  for (const g of ['covered', 'chemistry, not in the lesson', 'unrelated']) {
    const xs = rows.filter((r) => r.group === g).map((r) => r.top);
    console.log(`  top score, ${g.padEnd(30)} min ${Math.min(...xs).toFixed(2)}  median ${med(xs).toFixed(2)}  max ${Math.max(...xs).toFixed(2)}`);
  }
  console.log('\n  floor  covered blocked   uncovered let through to Claude (near / unrelated)');
  for (const floor of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45]) {
    const blocked = covered.filter((r) => r.top < floor).length;
    const near = rows.filter((r) => r.group === 'chemistry, not in the lesson' && r.top >= floor).length;
    const unr = rows.filter((r) => r.group === 'unrelated' && r.top >= floor).length;
    console.log(`  ${floor.toFixed(2)}   ${pct(blocked, covered.length).padEnd(15)}  ${near} / ${unr}`);
  }
  const lowCovered = [...covered].sort((a, b) => a.top - b.top).slice(0, 3);
  console.log('\n  weakest covered:', lowCovered.map((r) => `${r.top.toFixed(2)} "${r.q}"`).join(' | '));
  const hiNear = rows.filter((r) => r.group !== 'covered').sort((a, b) => b.top - a.top).slice(0, 3);
  console.log('  strongest uncovered:', hiNear.map((r) => `${r.top.toFixed(2)} "${r.q}"`).join(' | '));
}

// ---- 2. grouping cutoff
if (want('groups')) {
  console.log('\n=== Grouping cutoff (similar questions in one card)');
  const all = [...set.samePairs, ...set.differentPairs];
  const sims = run('devtools:similarities', { pairs: all });
  const same = sims.slice(0, set.samePairs.length);
  const diff = sims.slice(set.samePairs.length);
  const show = (pairs, xs) => pairs.map((p, i) => ({ s: xs[i], a: p[0], b: p[1] })).sort((x, y) => x.s - y.s);
  console.log('  same-intent pairs:     min', Math.min(...same).toFixed(3), ' median', med(same).toFixed(3));
  console.log('  different-intent pairs: max', Math.max(...diff).toFixed(3), ' median', med(diff).toFixed(3));
  console.log('\n  cutoff  same pairs merged   different pairs wrongly merged');
  for (const t of [0.8, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.97]) {
    console.log(`  ${t.toFixed(2)}    ${pct(same.filter((s) => s >= t).length, same.length).padEnd(17)}  ${pct(diff.filter((s) => s >= t).length, diff.length)}`);
  }
  console.log('\n  hardest different pairs:');
  for (const r of show(set.differentPairs, diff).reverse().slice(0, 4)) console.log(`    ${r.s.toFixed(3)}  "${r.a}"  vs  "${r.b}"`);
  console.log('  weakest same pairs:');
  for (const r of show(set.samePairs, same).slice(0, 3)) console.log(`    ${r.s.toFixed(3)}  "${r.a}"  vs  "${r.b}"`);
}

// ---- 3. the whole answer pipeline
if (want('answers')) {
  console.log('\n=== Answers end to end (real Claude)');
  const { sessionId } = run('sessions:create', { courseId: course._id, token, topic: 'eval' });
  const items = [
    ...set.covered.map((x) => ({ ...x, expect: 'answered' })),
    ...set.notCovered.map((x) => ({ ...x, expect: 'not_covered' })),
  ].map((x, i) => ({ ...x, student: `eval-${i}` }));
  for (const x of items) run('questions:submit', { sessionId, studentId: x.student, text: x.q });

  let pending = items.length;
  for (let i = 0; i < 60 && pending > 0; i++) {
    await sleep(2000);
    const queue = run('questions:queue', { sessionId, token });
    pending = queue.flatMap((c) => c.members).filter((m) => !m.answerStatus || m.answerStatus === 'pending').length;
  }
  if (pending) console.log(`  (${pending} answers still pending after 2 minutes)`);

  const results = items.map((x) => {
    const mine = run('questions:listMine', { sessionId, studentId: x.student })[0];
    return { ...x, status: mine?.answer?.status ?? 'pending', quotes: mine?.answer?.quotes ?? [] };
  });
  const cov = results.filter((r) => r.expect === 'answered');
  const unc = results.filter((r) => r.expect === 'not_covered');
  const good = cov.filter((r) => r.status === 'answered');
  const rightQuote = good.filter((r) => r.quotes.some((q) => q.label.includes(r.section)));
  console.log(`  covered questions answered:        ${pct(good.length, cov.length)}`);
  console.log(`    of those, quoting the right section: ${pct(rightQuote.length, good.length)}`);
  console.log(`  uncovered correctly "not covered": ${pct(unc.filter((r) => r.status === 'not_covered').length, unc.length)}`);
  for (const r of cov.filter((r) => r.status !== 'answered')) console.log(`  MISSED   (${r.status}) "${r.q}"`);
  for (const r of good.filter((r) => !rightQuote.includes(r))) console.log(`  OFF-TOPIC quote "${r.q}" -> ${r.quotes.map((q) => q.label).join(', ')}`);
  for (const r of unc.filter((r) => r.status !== 'not_covered')) console.log(`  ANSWERED WHAT IT SHOULD NOT (${r.status}) "${r.q}"`);

  const rows = convex(['data', 'answers', '--limit', '500', '--format', 'jsonLines'])
    .split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((a) => a.sessionId === sessionId);
  const total = rows.map((a) => a.totalMs).filter((n) => typeof n === 'number');
  const claude = rows.map((a) => a.claudeMs).filter((n) => typeof n === 'number');
  if (total.length) console.log(`  time per answer: median ${med(total)} ms, slowest ${Math.max(...total)} ms; Claude median ${claude.length ? med(claude) : 'n/a'} ms`);
}
console.log('');
