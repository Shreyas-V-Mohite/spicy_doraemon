#!/usr/bin/env node
/**
 * Creates the demo course and uploads the sample lesson, so a rehearsal or a
 * demo starts from a known state. Safe to run again: it does nothing for
 * pieces that already exist.
 *
 *   npm run demo:seed
 *
 * Afterwards, open /professor, enter the passcode and open the course.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envGet, root, run } from './lib/convex-cli.mjs';

const COURSE = 'Organic Chemistry (demo)';
const LESSON_FILE = join(root, 'samples', 'functional-groups.md');
const LESSON_TITLE = 'Functional groups';

const passcode = envGet('PROFESSOR_PASSCODE');
if (!passcode) {
  console.error('PROFESSOR_PASSCODE is not set in Convex: npx convex env set PROFESSOR_PASSCODE <value>');
  process.exit(1);
}

// This script gets its own token, so it can manage the course it just made.
const token = `seed-${randomUUID()}`;
const courses = run('courses:list', { passcode }) ?? [];
let course = courses.find((c) => c.name === COURSE);
if (course) {
  run('courses:claim', { passcode, courseId: course._id, token });
  console.log(`✓ course "${COURSE}" already exists`);
} else {
  const courseId = run('courses:create', { passcode, token, name: COURSE });
  course = { _id: courseId, name: COURSE };
  console.log(`✓ created course "${COURSE}"`);
}

const lessons = run('lessons:list', { courseId: course._id, token }) ?? [];
if (lessons.some((l) => l.title === LESSON_TITLE)) {
  console.log(`✓ lesson "${LESSON_TITLE}" already uploaded`);
} else {
  const text = readFileSync(LESSON_FILE, 'utf8');
  console.log(`… embedding the sample lesson (${text.split(/\s+/).length} words)`);
  run('lessons:create', { courseId: course._id, token, title: LESSON_TITLE, text });
  console.log(`✓ uploaded lesson "${LESSON_TITLE}"`);
}
console.log('\nNext: open /professor, sign in with the passcode, and open the course.');
