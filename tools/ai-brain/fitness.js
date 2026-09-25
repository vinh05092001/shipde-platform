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
  PRODUCTION: 'productionResults',
  LOCAL: 'localEvaluation',
  EXTERNAL: 'externalEvidence',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
};

/** Evidence layers with fixed precedence (TASK-AI-46). */
const EVIDENCE_LAYER = {
  PRODUCTION: 'productionResults',
  LOCAL: 'localEvaluation',
  EXTERNAL: 'externalEvidence',
  INFERRED: 'inferred',
};

/** Recorded outcomes a derivation needs before it may move a grade. */
const GRADE_EVIDENCE_FLOOR = 3;

function extractGradeFromEvidence(evidence) {
  if (evidence === undefined || evidence === null) return null;
  if (typeof evidence === 'number' && Number.isFinite(evidence) && evidence >= 1 && evidence <= 4) {
    return evidence;
  }
  if (typeof evidence === 'object') {
    const candidate =
      evidence.grade !== undefined
        ? evidence.grade
        : evidence.codingGrade !== undefined
          ? evidence.codingGrade
          : evidence.class !== undefined
            ? evidence.class
            : null;
    const g = Number(candidate);
    if (Number.isFinite(g) && g >= 1 && g <= 4) return g;
    if (evidence.benchmark && Number.isFinite(Number(evidence.score))) {
      try {
        const { gradeFromBenchmark } = require('./benchmarks');
        // The score is read on the scale its record declares; an unmappable one
        // grades nothing rather than falling back to the lowest rung.
        return gradeFromBenchmark(
          evidence.benchmark,
          evidence.score,
          evidence.score_scale || evidence.scoreScale
        );
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

/**
 * A model's coding class together with its provenance and evidence layer (AI-27-R03, AI-46).
 *
 * Precedence:
 *   productionResults > localEvaluation > externalEvidence > declared > assumed/UNKNOWN
 *
 * Exposes the resolved grade plus which layer it came from, so a caller can
 * tell measurement from inference.
 */
function resolveGrade(offering, options) {
  const opts = options || {};
  const o = offering || {};

  // 1. productionResults (measured from real runs)
  const prod = o.productionResults || opts.productionResults;
  const prodGrade = extractGradeFromEvidence(prod);
  if (prodGrade !== null) {
    const r = { class: prodGrade, graded: true, source: GRADE_SOURCE.PRODUCTION };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.PRODUCTION,
      enumerable: false,
      writable: true,
    });
    return r;
  }

  // 2. localEvaluation (smoke or promptfoo run on this machine)
  const local = o.localEvaluation || opts.localEvaluation;
  const localGrade = extractGradeFromEvidence(local);
  if (localGrade !== null) {
    const r = { class: localGrade, graded: true, source: GRADE_SOURCE.LOCAL };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.LOCAL,
      enumerable: false,
      writable: true,
    });
    return r;
  }

  // 3. externalEvidence (benchmarks.json)
  let ext = o.externalEvidence || opts.externalEvidence;
  if (!ext && (o.model || o.id)) {
    // No catch: damaged evidence must fail closed, not read as "no evidence".
    const { findBenchmarkEvidence, loadBenchmarks } = require('./benchmarks');
    const bmarks = opts.benchmarks || loadBenchmarks();
    const match = findBenchmarkEvidence(bmarks, o.model || o.id, o.modelVersion);
    if (match) ext = match;
  }
  const extGrade = extractGradeFromEvidence(ext);
  if (extGrade !== null) {
    // The record travels with the grade: a grade is only as good as the evidence
    // it names, and the operator has to be able to see which record it was.
    const r = { class: extGrade, graded: true, source: GRADE_SOURCE.EXTERNAL, evidence: ext };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.EXTERNAL,
      enumerable: false,
      writable: true,
    });
    return r;
  }

  // 4. Declared grade (backward compatibility for explicit declarations)
  const declared = o.codingGrade;
  if (declared !== undefined && declared !== null) {
    const g = Number(declared);
    if (!Number.isFinite(g) || g < 1 || g > 4) {
      const r = {
        class: Difficulty.STANDARD,
        graded: false,
        source: GRADE_SOURCE.ASSUMED,
        declared,
        error: 'out-of-ladder grade: ' + (o.id || 'unknown') + ' declares ' + declared,
      };
      Object.defineProperty(r, 'layer', { value: null, enumerable: false, writable: true });
      return r;
    }
    const r = { class: g, graded: true, source: GRADE_SOURCE.DECLARED };
    Object.defineProperty(r, 'layer', { value: 'declared', enumerable: false, writable: true });
    return r;
  }

  // 5. Unrecorded model: UNKNOWN if requested, else legacy STANDARD fallback
  if (opts.strict || opts.unknownIfUnrecorded || o.unknownIfUnrecorded) {
    const r = { class: 'UNKNOWN', graded: false, source: GRADE_SOURCE.UNKNOWN };
    Object.defineProperty(r, 'layer', { value: null, enumerable: false, writable: true });
    return r;
  }

  const r = { class: Difficulty.STANDARD, graded: false, source: GRADE_SOURCE.ASSUMED };
  Object.defineProperty(r, 'layer', { value: null, enumerable: false, writable: true });
  return r;
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
function extractReviewGradeFromEvidence(evidence) {
  if (evidence === undefined || evidence === null) return null;
  if (typeof evidence === 'object') {
    const candidate =
      evidence.reviewGrade !== undefined
        ? evidence.reviewGrade
        : evidence.reviewClass !== undefined
          ? evidence.reviewClass
          : null;
    const g = Number(candidate);
    if (Number.isFinite(g) && g >= 1 && g <= 4) return g;
  }
  return null;
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
 *
 * Real review evidence (productionResults > localEvaluation > externalEvidence)
 * overrides the inferred one-below rule (TASK-AI-46).
 */
function reviewGradeOf(offering, options) {
  const opts = options || {};
  const o = offering || {};

  const prod = extractReviewGradeFromEvidence(o.productionResults || opts.productionResults);
  if (prod !== null) return prod;
  const local = extractReviewGradeFromEvidence(o.localEvaluation || opts.localEvaluation);
  if (local !== null) return local;
  const ext = extractReviewGradeFromEvidence(o.externalEvidence || opts.externalEvidence);
  if (ext !== null) return ext;

  const explicit = Number(o.reviewGrade);
  if (Number.isFinite(explicit) && explicit >= 1 && explicit <= 4) return explicit;
  return Math.max(1, gradeOf(o) - 1);
}

/**
 * A model's review class together with its provenance (AI-41-R01..R06, AI-46).
 *
 *   { class, graded, source, declared?, error? }
 *
 * Precedence:
 *   productionResults > localEvaluation > externalEvidence > declared > inferred fallback
 *
 * The existing rule in reviewGradeOf (review grade defaults one class below the
 * coding grade) is marked as INFERRED (layer: 'inferred', inferred: true) and
 * is overridden by any real review evidence.
 */
function resolveReviewGrade(offering, options) {
  const opts = options || {};
  const o = offering || {};

  // 1. Real review evidence in productionResults
  const prod = extractReviewGradeFromEvidence(o.productionResults || opts.productionResults);
  if (prod !== null) {
    const r = { class: prod, graded: true, source: GRADE_SOURCE.PRODUCTION };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.PRODUCTION,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(r, 'inferred', { value: false, enumerable: false, writable: true });
    return r;
  }

  // 2. Real review evidence in localEvaluation
  const local = extractReviewGradeFromEvidence(o.localEvaluation || opts.localEvaluation);
  if (local !== null) {
    const r = { class: local, graded: true, source: GRADE_SOURCE.LOCAL };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.LOCAL,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(r, 'inferred', { value: false, enumerable: false, writable: true });
    return r;
  }

  // 3. Real review evidence in externalEvidence
  const ext = extractReviewGradeFromEvidence(o.externalEvidence || opts.externalEvidence);
  if (ext !== null) {
    const r = { class: ext, graded: true, source: GRADE_SOURCE.EXTERNAL };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.EXTERNAL,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(r, 'inferred', { value: false, enumerable: false, writable: true });
    return r;
  }

  // 4. Declared reviewGrade
  const declared = o.reviewGrade;
  const codingClass = gradeOf(o);
  const fallback = Math.max(1, codingClass - 1);

  if (declared === undefined || declared === null) {
    const r = { class: fallback, graded: false, source: GRADE_SOURCE.ASSUMED };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.INFERRED,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(r, 'inferred', { value: true, enumerable: false, writable: true });
    return r;
  }

  const g = Number(declared);
  if (!Number.isFinite(g) || g < 1 || g > 4) {
    const r = {
      class: fallback,
      graded: false,
      source: GRADE_SOURCE.ASSUMED,
      declared,
      error: 'out-of-ladder review grade: ' + (o.id || 'unknown') + ' declares ' + declared,
    };
    Object.defineProperty(r, 'layer', {
      value: EVIDENCE_LAYER.INFERRED,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(r, 'inferred', { value: true, enumerable: false, writable: true });
    return r;
  }

  const r = { class: g, graded: true, source: GRADE_SOURCE.DECLARED };
  Object.defineProperty(r, 'layer', { value: 'declared', enumerable: false, writable: true });
  Object.defineProperty(r, 'inferred', { value: false, enumerable: false, writable: true });
  return r;
}

/**
 * Resolves capability across coding and review grades with explicit layer provenance.
 *
 * Invariants:
 * - Precedence: productionResults > localEvaluation > externalEvidence > declared > inferred
 * - A model with no record is UNKNOWN, never "weak".
 * - Review grade defaults to one-below coding grade (INFERRED) and is overridden by real evidence.
 */
function resolveCapability(offering, options) {
  const coding = resolveGrade(offering, Object.assign({ unknownIfUnrecorded: true }, options));
  const review = resolveReviewGrade(offering, options);
  const codingLayer = coding.layer || (coding.graded ? 'declared' : null);
  const reviewLayer = review.layer || (review.graded ? 'declared' : EVIDENCE_LAYER.INFERRED);

  return {
    class: coding.class,
    grade: coding.class,
    layer: codingLayer,
    source: coding.source,
    reviewGrade: review.class,
    reviewLayer,
    reviewInferred: Boolean(review.inferred),
    coding,
    review,
  };
}

/**
 * The operator-visible proof behind a grade record (TASK-AI-46 AC-46-02).
 *
 * A grade that came from anything other than verified external evidence is not
 * reported as if it had, and a grade whose evidence was rejected says so with
 * the rejection. Returns null when there is nothing to show, so the caller
 * prints no line rather than a reassuring one.
 */
function formatGradeReason(gradeRecord) {
  const record = gradeRecord || {};
  if (record.error) return `No benchmark evidence: ${record.error}`;
  if (record.source !== GRADE_SOURCE.EXTERNAL) return null;
  const evidence = record.evidence;
  if (!evidence || !evidence.benchmark) return null;
  const name =
    evidence.benchmark + (evidence.benchmarkVersion ? ` ${evidence.benchmarkVersion}` : '');
  const scale = evidence.scoreScale || evidence.score_scale;
  let shown;
  if (Number.isFinite(Number(evidence.score))) {
    shown =
      scale === 'fraction' ? `${Math.round(Number(evidence.score) * 100)}%` : `${evidence.score}%`;
  } else {
    shown = 'an unreadable score';
  }
  const url = evidence.sourceUrl || evidence.source_url || 'no source recorded';
  return `Graded from ${name} = ${shown} (${url}), not from a self-declared grade`;
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
  const costWeight = Number(opts.costWeight) >= 0 ? Number(opts.costWeight) : 1;

  if (!isDispatchable(headroom)) {
    return { usable: false, reason: headroom ? headroom.reason : 'không rõ hạn mức' };
  }

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

  const pLoad = (opts.providerLoad && opts.providerLoad[offering.provider]) || 0;
  const mLoad = (opts.modelLoad && opts.modelLoad[offering.model]) || 0;
  const sLoad = (opts.scopeLoad && opts.scopeLoad[offering.accountId]) || 0;

  if (opts.maxConcurrentPerModel !== undefined && mLoad >= opts.maxConcurrentPerModel) {
    return { usable: false, reason: 'đã đạt trần concurrent cho model' };
  }
  if (opts.maxConcurrentPerQuotaScope !== undefined && sLoad >= opts.maxConcurrentPerQuotaScope) {
    return { usable: false, reason: 'đã đạt trần concurrent cho account scope' };
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

  if (runway === null && sLoad >= comfortable) {
    return { usable: false, reason: 'không rõ hạn mức, đã đạt trần an toàn (' + comfortable + ')' };
  }

  const runwayScore = runway === null ? comfortable : Math.min(runway, comfortable * 2);
  const overqualified = grade - difficulty;
  const strengthTerm = reviewing
    ? overqualified * overqualifiedPenalty
    : -overqualified * overqualifiedPenalty;
  const c = offering.cost || {};
  const blended = Number(c.inputPerMillion || 0) * 0.8 + Number(c.outputPerMillion || 0) * 0.2;

  const recent = (opts.recentUsage && opts.recentUsage[offering.accountId]) || 0;
  const usagePenalty = recent * (opts.recentUsagePenalty !== undefined ? opts.recentUsagePenalty : 5);
  const diversityPenalty = pLoad * (opts.providerDiversity !== undefined ? opts.providerDiversity : 10);

  let explorationBonus = 0;
  if (!offering.gradeRecord || !offering.gradeRecord.graded) {
    explorationBonus = (opts.explorationBudget !== undefined ? opts.explorationBudget : 0) * 10;
  }

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
      Number(offering.preference || 0) * 100 -
      usagePenalty -
      diversityPenalty +
      explorationBonus,
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

function isCapable(offering, difficulty, options) {
  const cap = resolveCapability(offering, options);
  const grade = cap.coding ? cap.coding.class : gradeOf(offering);
  if (grade === 'UNKNOWN' || typeof grade !== 'number') return false;
  return grade >= difficulty;
}

module.exports = {
  Difficulty,
  DIFFICULTY_NAMES,
  DEFAULT_TOKENS_PER_TASK,
  GRADE_SOURCE,
  EVIDENCE_LAYER,
  GRADE_EVIDENCE_FLOOR,
  resolveGrade,
  gradeEvidence,
  deriveGrade,
  gradeOf,
  reviewGradeOf,
  resolveReviewGrade,
  resolveCapability,
  formatGradeReason,
  isCapable,
  isSufficient,
  remainingTokens,
  runwayOf,
  estimateTokens,
  scoreOffering,
  rankByFitness,
  runwayReport,
};
