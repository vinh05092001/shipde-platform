'use strict';
// AC-AI-21-03 — the invariant: the real lesson schema admits every lesson in the
// real conformance seed.
//
// The rule lives in `./lib/lesson-schema.js`, the same module the negative proof
// `ac-21-04-lesson-record-inadmissible.js` requires, so the gate and the proof of
// the gate cannot drift apart. Both files read here are real committed files:
// `tools/ai-brain/lessons/lesson-schema.json` and
// `tools/ai-brain/lessons/lesson-seed.json`. Run outside the repository this exits
// 2, not 0, so it cannot pass where nothing exists.
//
// The row asserts the invariant "every seeded lesson is admitted", never a count,
// because the seed grows; the counts are printed after the invariant as evidence.
const fs = require('fs');
const {
  SCHEMA_PATH,
  SEED_PATH,
  APPROVAL_FIELDS,
  matchesViolations,
  seedLessons,
} = require('./lib/lesson-schema');

for (const source of [SCHEMA_PATH, SEED_PATH]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source);
    process.exit(2);
  }
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const lessons = seedLessons(JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')));

// CONTROL: an empty seed would make every assertion below vacuous, and a seed
// with no approved lesson would not exercise the rule this Work Item is about.
if (lessons.length === 0) {
  console.error('CONTROL_FAILED: the seed carries no lesson to admit');
  process.exit(2);
}
if (!lessons.some((lesson) => lesson.status === 'approved')) {
  console.error('CONTROL_FAILED: the seed carries no approved lesson');
  process.exit(2);
}
for (const lesson of lessons) {
  for (const field of APPROVAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(lesson, field)) {
      console.error(
        'CONTROL_FAILED: seed lesson ' + lesson.id + ' does not state ' + field + ' at all'
      );
      process.exit(2);
    }
  }
}

const rejected = [];
for (const lesson of lessons) {
  const violations = matchesViolations(schema, lesson, '$.' + lesson.id, []);
  if (violations.length > 0) rejected.push({ id: lesson.id, violations });
}

if (rejected.length > 0) {
  for (const entry of rejected) {
    console.error('INADMISSIBLE ' + entry.id + ': ' + entry.violations[0]);
  }
  process.exit(1);
}

console.log('LESSON_SCHEMA_HOLDS: every seeded lesson is admitted by lesson-schema.json');
const byStatus = lessons.reduce((counts, lesson) => {
  counts[lesson.status] = (counts[lesson.status] || 0) + 1;
  return counts;
}, {});
console.log(
  'evidence: ' +
    lessons.length +
    ' seeded lessons admitted, by status ' +
    Object.keys(byStatus)
      .sort()
      .map((status) => status + '=' + byStatus[status])
      .join(', ')
);
process.exit(0);
