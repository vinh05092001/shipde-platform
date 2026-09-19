'use strict';

/**
 * Ship Dễ — Model Fitness and Runway
 *
 * Picking the strongest available model is the wrong rule. Nobody reaches for
 * a frontier reasoning model to write CRUD; they reach for DeepSeek, GLM,
 * Muse Spark or a Gemini Flash — something clearly good enough for the job,
 * with enough quota left to finish it.
 *
 * So selection runs on two axes that "quality" collapses into one:
 *
 *   sufficiency — is this model at least strong enough for this class of work.
 *                 Below the bar it cannot be used at any price. Above the bar,
 *                 being further above buys nothing.
 *
 *   runway      — how many tasks of this size the remaining quota can still
 *                 finish. A model that cannot finish even one is excluded
 *                 outright, however strong: starting work that dies halfway
 *                 costs the tokens spent plus the retry.
 *
 * Among sufficient models, the one with the most runway wins. A model far
 * above the requirement is actively penalised rather than preferred, because
 * scarce strong capacity is worth reserving for the work that genuinely needs
 * it. That penalty is a preference, never a veto — if the strong model is all
 * that is left, it runs.
 */

const { isDispatchable } = require('./quota');

/**
 * What a piece of work demands. Ordered, and the order is the whole point:
 * a model qualified at COMPLEX is implicitly fine for MECHANICAL.
 */
const Difficulty = {
  MECHANICAL: 1, // fixtures, mocks, types, lint, mechanical edits
  STANDARD: 2, // ordinary CRUD, a contained feature, focused tests
  COMPLEX: 3, // cross-layer work, migrations, non-obvious debugging
  ARCHITECTURAL: 4, // foundations, contracts, anything that sets precedent
};

const DIFFICULTY_NAMES = {
  1: 'MECHANICAL',
  2: 'STANDARD',
  3: 'COMPLEX',
  4: 'ARCHITECTURAL',
};

/** Default work size in tokens, used until measured history says otherwise. */
const DEFAULT_TOKENS_PER_TASK = {
  1: 60000,
  2: 180000,
  3: 500000,
  4: 900000,
};

/**
 * A model's coding grade: the hardest class it is trusted to complete.
 * Written by qualification runs, not guessed here — an unrated model defaults
 * to STANDARD so it is neither trusted with architecture nor barred from
 * ordinary work.
 *
 * Returns only the class. Use resolveGrade() for the same class together with
 * its provenance, so a declared grade is distinguishable from an assumed one.
 */
function gradeOf(offering) {
  const g = Number(offering && offering.codingGrade);
  return Number.isFinite(g) && g >= 1 && g <= 4 ? g : Difficulty.STANDARD;
}

/** How a coding grade was obtained. */
const GRADE_SOURCE = {
  DECLARED: 'declared',
  ASSUMED: 'assumed',
  DERIVED: 'derived',
};

/** Recorded outcomes a derivation needs before it may move a grade. */
const GRADE_EVIDENCE_FLOOR = 3;

/**
 * A model's coding class together with its provenance (AI-27-R03, R04).
 *
 *   { class, graded, source, declared?, error? }
 *
 *   - a declared ladder member  -> graded: true,  source: 'declared'
 *   - an absent grade           -> graded: false, source: 'assumed', class STANDARD
 *   - a value outside 1..4      -> graded: false, source: 'assumed', plus an
 *     `error` naming the model and the value. The class stays STANDARD so the
 *     dispatch arithmetic is unchanged, but a typo is a finding rather than a
 *     confident middle grade.
 *
 * The class always agrees with gradeOf(), so making the assumption visible never
 * changes which work the fleet may take.
 */
function resolveGrade(offering) {
  const declared = offering && offering.codingGrade;
  if (declared === undefined || declared === null) {
    return { class: Difficulty.STANDARD, graded: false, source: GRADE_SOURCE.ASSUMED };
  }

  const g = Number(declared);
  if (!Number.isFinite(g) || g < 1 || g > 4) {
    return {
      class: Difficulty.STANDARD,
      graded: false,
      source: GRADE_SOURCE.ASSUMED,
      declared,
      error:
        'out-of-ladder grade: ' +
        ((offering && offering.id) || 'unknown') +
        ' declares ' +
        declared,
    };
  }

  return { class: g, graded: true, source: GRADE_SOURCE.DECLARED };
}

/**
 * Counts recorded outcomes per class (AI-27-R05, R06). Only a COMPLETED outcome
 * counts as evidence for the class it was completed at; a failure is not
 * evidence that a model can finish that class. The count is walked from the
 * outcomes themselves and never read from a field, so a caller cannot claim
 * evidence it did not record.
 */
function gradeEvidence(outcomes) {
  const counts = {};
  let completed = 0;
  for (const o of outcomes || []) {
    if (!o || o.outcome !== 'completed') continue;
    const c = Number(o.class);
    if (!Number.isFinite(c)) continue;
    counts[c] = (counts[c] || 0) + 1;
    completed += 1;
  }
  return { counts, completed };
}

/**
 * Derives a grade from recorded outcomes (AI-27-R05..R08).
 *
 * A class is granted only when at least `floor` completed outcomes of that
 * class are recorded, so a grade can never exceed its evidence (R06). Below the
 * floor nothing moves: the previous grade stands and the derivation is reported
 * as insufficient evidence rather than asserted (R05). When it does move, the
 * previous grade is retained alongside the new one (R08) and the outcome that
 * caused the move is named (R07). `now` may be injected so the computed instant
 * is deterministic in a test.
 */
function deriveGrade(offering, outcomes, options) {
  const opts = options || {};
  const floor = Number(opts.floor) > 0 ? Number(opts.floor) : GRADE_EVIDENCE_FLOOR;
  const current = gradeOf(offering);
  const evidence = gradeEvidence(outcomes);

  let derived = null;
  let observations = 0;
  for (const key of Object.keys(evidence.counts)) {
    const c = Number(key);
    if (evidence.counts[key] >= floor && (derived === null || c > derived)) {
      derived = c;
      observations = evidence.counts[key];
    }
  }

  if (derived === null) {
    return {
      class: current,
      previousClass: current,
      graded: false,
      source: GRADE_SOURCE.ASSUMED,
      derived: false,
      insufficientEvidence: true,
      observations: evidence.completed,
      floor,
    };
  }

  const moved = derived !== current;
  const supporting = (outcomes || []).filter(
    (o) => o && o.outcome === 'completed' && Number(o.class) === derived
  );
  const last = supporting[supporting.length - 1];

  return {
    class: derived,
    previousClass: current,
    graded: true,
    source: GRADE_SOURCE.DERIVED,
    derived: true,
    moved,
    movedBy: moved && last ? last.id || null : null,
    evidence: {
      class: derived,
      observations,
      computedAt: opts.now || new Date().toISOString(),
    },
    floor,
  };
}

/**
 * The hardest class this model may REVIEW.
 *
 * Reviewing is not the easier half of writing. An author needs to produce one
 * correct solution; a reviewer has to hold the specification, the diff and the
 * space of things that could be wrong at once, and say so against an author
 * that already believes it is done. So an unrated model reviews one class
 * BELOW what it writes, and a model must be declared explicitly to review at
 * the level it codes.
 */
function reviewGradeOf(offering) {
  const explicit = Number(offering && offering.reviewGrade);
  if (Number.isFinite(explicit) && explicit >= 1 && explicit <= 4) return explicit;
  return Math.max(1, gradeOf(offering) - 1);
}

/**
 * A model's review class together with its provenance (AI-41-R01..R06).
 *
 *   { class, graded, source, declared?, error? }
 *
 *   - a declared ladder member  -> graded: true,  source: 'declared'
 *   - an absent review grade    -> graded: false, source: 'assumed', class Math.max(1, gradeOf(offering) - 1)
 *   - a value outside 1..4      -> graded: false, source: 'assumed', class Math.max(1, gradeOf(offering) - 1),
 *     plus an `error` naming the model and the value. The class stays one-below
 *     so the dispatch arithmetic is unchanged, but a typo is a finding rather
 *     than a silent clamp.
 *
 * The class always agrees with reviewGradeOf().
 */
function resolveReviewGrade(offering) {
  const declared = offering && offering.reviewGrade;
  const fallback = Math.max(1, gradeOf(offering) - 1);
  if (declared === undefined || declared === null) {
    return { class: fallback, graded: false, source: GRADE_SOURCE.ASSUMED };
  }

  const g = Number(declared);
  if (!Number.isFinite(g) || g < 1 || g > 4) {
    return {
      class: fallback,
      graded: false,
      source: GRADE_SOURCE.ASSUMED,
      declared,
      error:
        'out-of-ladder review grade: ' +
        ((offering && offering.id) || 'unknown') +
        ' declares ' +
        declared,
    };
  }

  return { class: g, graded: true, source: GRADE_SOURCE.DECLARED };
}

function isSufficient(offering, difficulty) {
  return gradeOf(offering) >= difficulty;
}

/**
 * Tokens this model still has available, or null when no token budget is
 * declared. Cost and request limits constrain dispatch elsewhere; runway is
 * specifically about whether there is enough *work* left in the budget.
 */
function remainingTokens(headroom) {
  if (!headroom || !headroom.windows) return null;
  const candidates = ['tokensPerDay', 'tokensPerMonth'];
  let least = null;
  for (const key of candidates) {
    const w = headroom.windows[key];
    if (!w || !Number.isFinite(w.limit)) continue;
    const left = Math.max(0, w.limit - w.used);
    if (least === null || left < least) least = left;
  }
  return least;
}

/**
 * How many more tasks of this size the model can finish.
 *
 * `null` means unknown — no token budget was declared. Unknown is not
 * infinity, and callers must not treat it as such; it is reported so the
 * operator can see which models are flying blind.
 */
function runwayOf(headroom, tokensPerTask) {
  const left = remainingTokens(headroom);
  if (left === null) return null;
  const size = Number(tokensPerTask) > 0 ? Number(tokensPerTask) : DEFAULT_TOKENS_PER_TASK[2];
  return left / size;
}

/**
 * Estimated tokens for one task at this difficulty on this model.
 * Measured history wins over the default whenever it exists, because a model
 * that habitually needs three attempts really does cost three attempts.
 */
function estimateTokens(offering, difficulty, history) {
  const key = offering.id + '::' + difficulty;
  const measured = history && history[key];
  if (measured && Number(measured.medianTokens) > 0) return Number(measured.medianTokens);

  const byModel = history && history[offering.id];
  if (byModel && Number(byModel.medianTokens) > 0) return Number(byModel.medianTokens);

  return DEFAULT_TOKENS_PER_TASK[difficulty] || DEFAULT_TOKENS_PER_TASK[2];
}

/**
 * Scores one offering for one task. Higher is better; null means unusable.
 *
 * The shape of the score matters more than its magnitude:
 *   - insufficient grade      → unusable
 *   - runway below one task   → unusable, even at the top grade
 *   - overqualification       → penalised per level above the requirement
 *   - runway                  → rewarded, with diminishing returns past a
 *                               comfortable margin so an enormous budget does
 *                               not drown out every other consideration
 */
function scoreOffering(offering, difficulty, headroom, history, options) {
  const opts = options || {};
  const comfortable = Number(opts.comfortableRunway) > 0 ? Number(opts.comfortableRunway) : 5;
  const overqualifiedPenalty =
    Number(opts.overqualifiedPenalty) >= 0 ? Number(opts.overqualifiedPenalty) : 12;
  // Price still matters, it is simply not the first question. At the default
  // weight a $15/M model gives up about as much as being one grade too strong;
  // raising it makes price dominate, which is right for mechanical work.
  const costWeight = Number(opts.costWeight) >= 0 ? Number(opts.costWeight) : 1;

  if (!isDispatchable(headroom)) {
    return { usable: false, reason: headroom ? headroom.reason : 'không rõ hạn mức' };
  }

  // A reviewer is judged on its review grade, and the strongest one available
  // is wanted rather than reserved: a review that misses a defect costs more
  // than the model that would have caught it.
  const reviewing = Boolean(opts.reviewing);
  const grade = reviewing ? reviewGradeOf(offering) : gradeOf(offering);
  if (grade < difficulty) {
    return {
      usable: false,
      reason:
        (reviewing ? 'chỉ review được tới ' : 'chỉ đạt ') +
        DIFFICULTY_NAMES[grade] +
        ', việc này cần ' +
        DIFFICULTY_NAMES[difficulty],
    };
  }

  const tokensPerTask = estimateTokens(offering, difficulty, history);
  const runway = runwayOf(headroom, tokensPerTask);

  if (runway !== null && runway < 1) {
    return {
      usable: false,
      reason:
        'không đủ quota làm hết một việc (còn ~' +
        runway.toFixed(2) +
        ' lượt, cần ' +
        Math.round(tokensPerTask / 1000) +
        'K token)',
      runway,
    };
  }

  // An unknown budget is usable but never preferred over a measured one: it
  // sits at the comfortable mark rather than at the top of the scale.
  const runwayScore = runway === null ? comfortable : Math.min(runway, comfortable * 2);
  // Reserving strength makes sense for authoring, where a sufficient model
  // finishes the job. It is wrong for review, so the penalty inverts into a
  // bonus there.
  const overqualified = grade - difficulty;
  const strengthTerm = reviewing
    ? overqualified * overqualifiedPenalty
    : -overqualified * overqualifiedPenalty;
  const c = offering.cost || {};
  const blended = Number(c.inputPerMillion || 0) * 0.8 + Number(c.outputPerMillion || 0) * 0.2;

  return {
    usable: true,
    grade,
    runway,
    tokensPerTask,
    overqualified,
    reviewing,
    blendedCost: blended,
    score:
      runwayScore * 10 +
      strengthTerm -
      blended * costWeight +
      Number(offering.preference || 0) * 100,
    reason:
      runway === null ? 'chưa khai hạn mức token' : 'còn ~' + runway.toFixed(1) + ' lượt việc',
  };
}

/**
 * Ranks offerings for a task, best fit first, and reports why each rejected
 * one was rejected. Nothing is dropped silently: the operator needs to see
 * that the strong model was skipped because it was nearly out, not because
 * something went wrong.
 */
function rankByFitness(offerings, difficulty, headrooms, history, options) {
  const usable = [];
  const rejected = [];

  for (const o of offerings) {
    const verdict = scoreOffering(o, difficulty, headrooms[o.id], history, options);
    if (verdict.usable) usable.push({ offering: o, verdict });
    else rejected.push({ offeringId: o.id, reason: verdict.reason });
  }

  usable.sort((a, b) => {
    if (b.verdict.score !== a.verdict.score) return b.verdict.score - a.verdict.score;
    // Stable, explainable tiebreak rather than whatever order they arrived in.
    return a.offering.id.localeCompare(b.offering.id);
  });

  return { ranked: usable, rejected };
}

/**
 * Monitoring view: for every offering, how much work it can still do.
 *
 * This is the thing the operator watches. A model with `atRisk` true is one
 * task away from running out, which is the moment to add capacity rather than
 * the moment after the queue stalls.
 */
function runwayReport(offerings, difficulty, headrooms, history, options) {
  const opts = options || {};
  const atRiskBelow = Number(opts.atRiskBelow) > 0 ? Number(opts.atRiskBelow) : 2;

  const rows = offerings.map((o) => {
    const headroom = headrooms[o.id];
    const tokensPerTask = estimateTokens(o, difficulty, history);
    const runway = runwayOf(headroom, tokensPerTask);
    const grade = gradeOf(o);
    return {
      offeringId: o.id,
      accountId: o.accountId,
      model: o.model,
      tier: o.tier,
      grade,
      gradeName: DIFFICULTY_NAMES[grade],
      sufficient: grade >= difficulty,
      status: headroom ? headroom.status : 'unknown',
      boundBy: headroom ? headroom.boundBy : null,
      tokensPerTask,
      runway,
      atRisk: runway !== null && runway < atRiskBelow,
      unknownBudget: runway === null,
    };
  });

  const sufficient = rows.filter(
    (r) => r.sufficient && r.status !== 'exhausted' && r.status !== 'cooling'
  );
  const knownRunway = sufficient.filter((r) => r.runway !== null);

  return {
    difficulty,
    difficultyName: DIFFICULTY_NAMES[difficulty],
    rows,
    summary: {
      total: rows.length,
      sufficient: sufficient.length,
      // Total capacity is only meaningful over models whose budget is known.
      tasksRemaining: knownRunway.reduce((sum, r) => sum + r.runway, 0),
      unknownBudget: sufficient.filter((r) => r.runway === null).length,
      atRisk: sufficient.filter((r) => r.atRisk).length,
    },
  };
}

module.exports = {
  Difficulty,
  DIFFICULTY_NAMES,
  DEFAULT_TOKENS_PER_TASK,
  GRADE_SOURCE,
  GRADE_EVIDENCE_FLOOR,
  resolveGrade,
  gradeEvidence,
  deriveGrade,
  gradeOf,
  reviewGradeOf,
  resolveReviewGrade,
  isSufficient,
  remainingTokens,
  runwayOf,
  estimateTokens,
  scoreOffering,
  rankByFitness,
  runwayReport,
};
