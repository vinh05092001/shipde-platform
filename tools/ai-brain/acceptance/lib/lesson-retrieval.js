'use strict';
// TASK-AI-23 — the retrieval admissibility predicate, held in exactly one place.
//
// `ac-23-03-lesson-retrieval.js` (the invariant: the real seed yields exactly
// the approved live lessons) and the negative proofs
// (`ac-23-04-retrieval-leak.js`, `ac-23-05-retrieval-staleness.js`,
// `ac-23-06-retrieval-requirement-missing.js`, `ac-23-07-retrieval-reasons.js`,
// `ac-23-08-retrieval-nonconforming.js`) all require this module, so the gate
// and every proof of the gate share one predicate. No row and no gate file
// restates the predicate inline — AI-23-R07.
//
// The predicate is a CLAIM ABOUT the real lesson set and the real schema, not a
// runtime service. It reads `tools/ai-brain/lessons/lesson-seed.json` and
// `tools/ai-brain/lessons/lesson-schema.json`, applies the admissibility rules
// in the precedence order AI-23-R05 names, and returns one decision per lesson.
//
// Exit codes used by the scripts that require this file:
//   0 the admissibility decision is as expected   1 it is not   2 cannot measure
const fs = require('fs');
const path = require('path');
const { matchesViolations, seedLessons } = require('./lesson-schema');

// The two real files this predicate reads.
const SEED = path.resolve(__dirname, '..', '..', 'lessons', 'lesson-seed.json');
const SCHEMA = path.resolve(__dirname, '..', '..', 'lessons', 'lesson-schema.json');

// Reason labels in the precedence order AI-23-R05 names: most-authoritative
// first. A lesson is excluded for the FIRST reason in this order that applies.
const REASON_SUPERSEDED = 'superseded';
const REASON_EXPIRED = 'expired';
const REASON_UNAPPROVED = 'unapproved';
const REASON_NONCONFORMING = 'nonconforming';

// The single status that reaches a prompt — AI-23-R01.
const ADMISSIBLE_STATUS = 'approved';

/**
 * Default retrieval date when the caller does not supply one: wall-clock UTC
 * date at the instant the predicate runs, as `YYYY-MM-DD` — AI-23-R03.
 */
function defaultRetrievalDate() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * Whether `lesson` is superseded for retrieval purposes — AI-23-R02.
 *
 * A lesson is superseded when its own `status` is `superseded`, OR when its
 * own `superseded_by` is non-null (a human already replaced it).
 */
function isSuperseded(lesson) {
  if (lesson.status === 'superseded') return true;
  if (lesson.superseded_by != null) return true;
  return false;
}

/**
 * Whether `lesson` conforms to the real schema — AI-23-R04.
 *
 * A lesson failing `matchesViolations` against the real schema is excluded even
 * when its `status` reads `approved`. The schema subset in `lib/lesson-schema.js`
 * is the single source of truth for what "conforming" means here.
 */
function conformsToSchema(lesson) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  return matchesViolations(schema, lesson).length === 0;
}

/**
 * The first applicable exclusion reason for `lesson` at `retrievalDate`, in the
 * precedence order AI-23-R05 names. Returns `null` when the lesson is admissible.
 *
 * Precedence (most-authoritative first):
 *   1. superseded — a human decision already replaced it
 *   2. expired    — a human-set time bound
 *   3. unapproved — status is not `approved`
 *   4. nonconforming — schema violation
 */
function exclusionReason(lesson, retrievalDate) {
  if (isSuperseded(lesson)) return REASON_SUPERSEDED;
  if (isExpired(lesson, retrievalDate)) return REASON_EXPIRED;
  if (lesson.status !== ADMISSIBLE_STATUS) return REASON_UNAPPROVED;
  if (!conformsToSchema(lesson)) return REASON_NONCONFORMING;
  return null;
}

/**
 * One admissibility decision for a single lesson.
 *
 * `retrievalDate` is the caller-supplied clock parameter when one is passed
 * (so a test can pin it exactly — AI-23-R03, AC-AI-23-03 pins its date), or
 * defaults to the wall-clock UTC date when none is passed.
 */
function admissibility(lesson, retrievalDate) {
  const date = retrievalDate || defaultRetrievalDate();
  const reason = exclusionReason(lesson, date);
  return {
    id: lesson.id,
    status: lesson.status,
    admissible: reason === null,
    reason: reason,
    retrievalDate: date,
  };
}

/**
 * The admissibility decisions for every lesson in the real seed, in declaration
 * order. `retrievalDate` is optional and defaults as AI-23-R03 names.
 *
 * When `seedOverride` is passed (a parsed seed object), the predicate evaluates
 * that instead of reading the real seed from disk. This is used by negative proofs
 * that build a tampered COPY under `os.tmpdir()` and must prove the predicate
 * refuses it through the SAME code path — without mutating module state.
 */
function retrieveLessons(retrievalDate, seedOverride) {
  let seed;
  if (seedOverride) {
    seed = seedOverride;
  } else {
    if (!fs.existsSync(SEED)) {
      return { ok: false, measurable: false, why: 'seed missing: ' + SEED };
    }
    if (!fs.existsSync(SCHEMA)) {
      return { ok: false, measurable: false, why: 'schema missing: ' + SCHEMA };
    }
    seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  }
  const lessons = seedLessons(seed);
  return {
    ok: true,
    measurable: true,
    lessons: lessons.map((lesson) => admissibility(lesson, retrievalDate)),
  };
}

module.exports = {
  SEED,
  SCHEMA,
  ADMISSIBLE_STATUS,
  REASON_SUPERSEDED,
  REASON_EXPIRED,
  REASON_UNAPPROVED,
  REASON_NONCONFORMING,
  defaultRetrievalDate,
  isSuperseded,
  isExpired,
  conformsToSchema,
  exclusionReason,
  admissibility,
  retrieveLessons,
};

/**
 * Whether `lesson` is expired for retrieval at `retrievalDate` — AI-23-R03.
 *
 * `expiry` before the retrieval date is excluded even when approved.
 * Explicit `null` `expiry` means not time-bounded and stays admissible.
 */
function isExpired(lesson, retrievalDate) {
  if (lesson.expiry === null) return false;
  if (lesson.expiry === undefined) return false;
  if (retrievalDate > lesson.expiry) return true;
  return false;
}
