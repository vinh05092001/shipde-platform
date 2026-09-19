/**
 * Ship Dễ — Model Fitness and Runway Test Suite
 *
 * The rule under test: use a model that is good enough for the work and has
 * quota left to finish it, not the strongest model on the list.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  Difficulty,
  gradeOf,
  isSufficient,
  runwayOf,
  estimateTokens,
  scoreOffering,
  rankByFitness,
  runwayReport,
} = require('../fitness');
const { expandOfferings, headroomForAll } = require('../offerings');
const { planDispatch } = require('../scheduler');

const NOW = Date.parse('2026-09-14T12:00:00Z');
const hoursAgo = (n) => NOW - n * 3600000;

/** Events that consumed `tokens` in total, inside the day window. */
const spent = (tokens) => [{ at: hoursAgo(1), tokens, cost: 0 }];

function headroom(limit, used) {
  return {
    status: 'open',
    windows: { tokensPerDay: { limit, used, ratio: used / limit } },
  };
}

describe('Grade and sufficiency', () => {
  test('an unrated model is treated as STANDARD, not as top grade', () => {
    assert.equal(gradeOf({ id: 'x' }), Difficulty.STANDARD);
  });

  test('a model qualified for harder work also covers easier work', () => {
    const strong = { codingGrade: Difficulty.ARCHITECTURAL };
    assert.equal(isSufficient(strong, Difficulty.MECHANICAL), true);
    assert.equal(isSufficient(strong, Difficulty.ARCHITECTURAL), true);
  });

  test('a model below the requirement is unusable at any price', () => {
    const cheap = { id: 'cheap', codingGrade: Difficulty.MECHANICAL, cost: { inputPerMillion: 0 } };
    const v = scoreOffering(cheap, Difficulty.COMPLEX, headroom(1e9, 0), {});
    assert.equal(v.usable, false);
    assert.match(v.reason, /cần COMPLEX/);
  });
});

describe('Runway', () => {
  test('runway is remaining tokens divided by task size', () => {
    assert.equal(runwayOf(headroom(1000000, 0), 250000), 4);
    assert.equal(runwayOf(headroom(1000000, 750000), 250000), 1);
  });

  test('an undeclared token budget is unknown, not unlimited', () => {
    assert.equal(runwayOf({ status: 'open', windows: {} }, 1000), null);
  });

  test('a model that cannot finish one task is excluded however strong', () => {
    // The core rule: a frontier model with almost no quota left is worse than
    // a mid model with room, because it dies halfway and costs the retry too.
    const frontier = { id: 'frontier', codingGrade: Difficulty.ARCHITECTURAL };
    const v = scoreOffering(frontier, Difficulty.STANDARD, headroom(1000000, 950000), {});
    assert.equal(v.usable, false);
    assert.match(v.reason, /không đủ quota làm hết một việc/);
  });

  test('exactly one task of runway is still usable', () => {
    const m = { id: 'm', codingGrade: Difficulty.STANDARD };
    const v = scoreOffering(m, Difficulty.STANDARD, headroom(180000, 0), {});
    assert.equal(v.usable, true);
    assert.equal(v.runway, 1);
  });

  test('measured history overrides the default task size', () => {
    const m = { id: 'm::model', codingGrade: Difficulty.STANDARD };
    const history = { 'm::model::2': { medianTokens: 20000 } };
    assert.equal(estimateTokens(m, Difficulty.STANDARD, history), 20000);
    // A model that habitually burns more really does have less runway.
    const heavy = { 'm::model::2': { medianTokens: 2000000 } };
    assert.equal(estimateTokens(m, Difficulty.STANDARD, heavy), 2000000);
  });
});

describe('Choosing the right-sized model', () => {
  const mid = { id: 'glm', codingGrade: Difficulty.STANDARD };
  const strong = { id: 'frontier', codingGrade: Difficulty.ARCHITECTURAL };

  test('an overqualified model loses to a sufficient one with equal runway', () => {
    const heads = { glm: headroom(1000000, 0), frontier: headroom(1000000, 0) };
    const { ranked } = rankByFitness([strong, mid], Difficulty.STANDARD, heads, {});
    assert.equal(ranked[0].offering.id, 'glm', 'scarce strong capacity is reserved');
  });

  test('more runway beats being stronger', () => {
    const heads = { glm: headroom(5000000, 0), frontier: headroom(400000, 0) };
    const { ranked } = rankByFitness([strong, mid], Difficulty.STANDARD, heads, {});
    assert.equal(ranked[0].offering.id, 'glm');
  });

  test('the strong model still runs when it is the only sufficient one', () => {
    // The penalty is a preference, never a veto.
    const heads = { glm: headroom(1000000, 0), frontier: headroom(1000000, 0) };
    const { ranked } = rankByFitness([strong, mid], Difficulty.ARCHITECTURAL, heads, {});
    assert.equal(ranked[0].offering.id, 'frontier');
  });

  test('a huge budget does not drown out everything else', () => {
    // Runway saturates, so a model with 1000 tasks left does not outrank a
    // better-fitting one with a comfortable 8.
    const heads = { glm: headroom(2000000, 0), frontier: headroom(900000000, 0) };
    const { ranked } = rankByFitness([strong, mid], Difficulty.STANDARD, heads, {});
    assert.equal(ranked[0].offering.id, 'glm');
  });

  test('every rejection carries a reason', () => {
    const weak = { id: 'weak', codingGrade: Difficulty.MECHANICAL };
    const drained = { id: 'drained', codingGrade: Difficulty.COMPLEX };
    const heads = { weak: headroom(1e9, 0), drained: headroom(100000, 99000) };
    const { ranked, rejected } = rankByFitness([weak, drained], Difficulty.COMPLEX, heads, {});
    assert.equal(ranked.length, 0);
    assert.equal(rejected.length, 2);
    assert.match(rejected.find((r) => r.offeringId === 'weak').reason, /cần COMPLEX/);
    assert.match(rejected.find((r) => r.offeringId === 'drained').reason, /không đủ quota/);
  });
});

describe('Runway monitoring', () => {
  const pool = [
    {
      id: 'a::deepseek',
      accountId: 'a',
      model: 'deepseek',
      tier: 0,
      codingGrade: Difficulty.STANDARD,
    },
    { id: 'a::glm', accountId: 'a', model: 'glm-5.3', tier: 0, codingGrade: Difficulty.STANDARD },
    {
      id: 'b::frontier',
      accountId: 'b',
      model: 'frontier',
      tier: 1,
      codingGrade: Difficulty.ARCHITECTURAL,
    },
    { id: 'c::tiny', accountId: 'c', model: 'tiny', tier: 2, codingGrade: Difficulty.MECHANICAL },
  ];
  const heads = {
    'a::deepseek': headroom(5000000, 0),
    'a::glm': headroom(400000, 200000),
    'b::frontier': headroom(10000000, 0),
    'c::tiny': headroom(1000000, 0),
  };

  test('reports how many tasks each model can still finish', () => {
    const r = runwayReport(pool, Difficulty.STANDARD, heads, {});
    const deepseek = r.rows.find((x) => x.offeringId === 'a::deepseek');
    assert.ok(deepseek.runway > 27, 'five million tokens is many standard tasks');
  });

  test('flags a model that is one task from running dry', () => {
    const r = runwayReport(pool, Difficulty.STANDARD, heads, {});
    const glm = r.rows.find((x) => x.offeringId === 'a::glm');
    assert.equal(glm.atRisk, true, '200K left against a 180K task is the moment to add capacity');
  });

  test('an insufficient model is reported but excluded from capacity', () => {
    const r = runwayReport(pool, Difficulty.STANDARD, heads, {});
    const tiny = r.rows.find((x) => x.offeringId === 'c::tiny');
    assert.equal(tiny.sufficient, false);
    assert.equal(r.summary.sufficient, 3, 'the mechanical-only model does not count');
  });

  test('total remaining work counts only models with a known budget', () => {
    const withUnknown = pool.concat([
      {
        id: 'd::mystery',
        accountId: 'd',
        model: 'mystery',
        tier: 3,
        codingGrade: Difficulty.STANDARD,
      },
    ]);
    const r = runwayReport(
      withUnknown,
      Difficulty.STANDARD,
      Object.assign({}, heads, { 'd::mystery': { status: 'open', windows: {} } }),
      {}
    );
    assert.equal(r.summary.unknownBudget, 1);
    assert.ok(
      Number.isFinite(r.summary.tasksRemaining),
      'an unknown budget never becomes infinity'
    );
  });
});

describe('Dispatch uses fitness, not raw strength', () => {
  const CAPS = { jsonSchema: true, tools: true, contextWindow: 200000 };
  const account = {
    id: 'pool',
    provider: 'x',
    tier: 0,
    enabled: true,
    capabilities: CAPS,
    limits: {},
    models: [
      {
        model: 'astra-6',
        codingGrade: Difficulty.ARCHITECTURAL,
        quality: 99,
        limits: { tokensPerDay: 5000000 },
      },
      {
        model: 'glm-5.3',
        codingGrade: Difficulty.STANDARD,
        quality: 70,
        limits: { tokensPerDay: 5000000 },
      },
    ],
  };
  const item = { workItemId: 'A-1', role: 'author.foundation', branch: 'feat/a', riskDomains: [] };

  test('ordinary work does not take the frontier model', () => {
    const plan = planDispatch(
      [Object.assign({}, item, { difficulty: Difficulty.STANDARD })],
      [account],
      {
        now: NOW,
      }
    );
    assert.equal(
      plan.assignments[0].model,
      'glm-5.3',
      'astra-6 is reserved, not spent on standard work'
    );
  });

  test('architectural work does take it', () => {
    const plan = planDispatch(
      [Object.assign({}, item, { difficulty: Difficulty.ARCHITECTURAL })],
      [account],
      { now: NOW }
    );
    assert.equal(plan.assignments[0].model, 'astra-6');
  });

  test('a nearly drained model is skipped and the reason says so', () => {
    const drained = Object.assign({}, account, {
      models: [
        {
          model: 'astra-6',
          codingGrade: Difficulty.ARCHITECTURAL,
          limits: { tokensPerDay: 100000 },
        },
      ],
    });
    const plan = planDispatch(
      [Object.assign({}, item, { difficulty: Difficulty.ARCHITECTURAL })],
      [drained],
      { eventsByOffering: { 'pool::astra-6': spent(95000) }, now: NOW }
    );
    assert.equal(plan.assignments.length, 0);
    assert.match(plan.deferred[0].detail, /không đủ quota/);
  });

  test('the assignment records the fit it was chosen on', () => {
    const plan = planDispatch(
      [Object.assign({}, item, { difficulty: Difficulty.STANDARD })],
      [account],
      {
        now: NOW,
      }
    );
    const a = plan.assignments[0];
    assert.equal(a.difficulty, Difficulty.STANDARD);
    assert.equal(a.grade, Difficulty.STANDARD);
    assert.ok(a.runway > 0);
    assert.ok(a.tokensPerTask > 0);
    assert.match(a.fitReason, /lượt việc/);
  });
});

describe('Grade provenance (TASK-AI-27)', () => {
  const { resolveGrade } = require('../fitness');

  test('a declared ladder grade is reported as declared', () => {
    assert.deepEqual(resolveGrade({ id: 'm', codingGrade: Difficulty.COMPLEX }), {
      class: Difficulty.COMPLEX,
      graded: true,
      source: 'declared',
    });
  });

  test('an absent grade is reported as assumed STANDARD, never the top class', () => {
    const r = resolveGrade({ id: 'm' });
    assert.equal(r.class, Difficulty.STANDARD);
    assert.equal(r.graded, false);
    assert.equal(r.source, 'assumed');
    assert.notEqual(r.class, Difficulty.ARCHITECTURAL);
  });

  test('a declared grade outside the ladder is reported by model and value', () => {
    const r = resolveGrade({ id: 'typo-model', codingGrade: 9 });
    assert.equal(r.graded, false);
    assert.equal(r.source, 'assumed');
    assert.match(r.error, /typo-model/);
    assert.match(r.error, /9/);
    // The class stays STANDARD so the dispatch arithmetic is unchanged.
    assert.equal(r.class, Difficulty.STANDARD);
  });

  test('resolveGrade agrees with gradeOf on the class for every case', () => {
    for (const c of [1, 2, 3, 4, 5, -1, 'nonsense']) {
      assert.equal(
        resolveGrade({ codingGrade: c }).class,
        gradeOf({ codingGrade: c }),
        'class disagreement for ' + c
      );
    }
    assert.equal(resolveGrade({}).class, gradeOf({}));
  });

  test('evidence is counted from completed outcomes only', () => {
    const { gradeEvidence } = require('../fitness');
    const e = gradeEvidence([
      { id: 'a', class: 3, outcome: 'completed' },
      { id: 'b', class: 3, outcome: 'failed' },
      { id: 'c', class: 2, outcome: 'completed' },
    ]);
    assert.equal(e.completed, 2);
    assert.equal(e.counts[3], 1);
    assert.equal(e.counts[2], 1);
  });
});

describe('Deriving a grade from recorded outcomes (TASK-AI-27)', () => {
  const { deriveGrade } = require('../fitness');
  const NOWISO = '2026-09-17T00:00:00.000Z';
  const completed = (id, cls) => ({ id, class: cls, outcome: 'completed' });

  test('below the evidence floor the previous grade stands and the derivation is reported', () => {
    const r = deriveGrade({ codingGrade: Difficulty.STANDARD }, [completed('o1', 3)], {
      now: NOWISO,
    });
    assert.equal(r.insufficientEvidence, true);
    assert.equal(r.derived, false);
    assert.equal(r.class, Difficulty.STANDARD, 'a grade inferred from one outcome is a guess');
    assert.equal(r.previousClass, Difficulty.STANDARD);
  });

  test('at the floor a grade is derived, carries its evidence and retains the previous one', () => {
    const outcomes = [completed('o1', 3), completed('o2', 3), completed('o3', 3)];
    const r = deriveGrade({ codingGrade: Difficulty.STANDARD }, outcomes, { now: NOWISO });
    assert.equal(r.derived, true);
    assert.equal(r.class, Difficulty.COMPLEX);
    assert.equal(r.previousClass, Difficulty.STANDARD, 'a moved grade is retained, not erased');
    assert.equal(r.moved, true);
    assert.equal(r.movedBy, 'o3', 'the outcome that moved the grade is named');
    assert.equal(r.evidence.class, Difficulty.COMPLEX);
    assert.equal(r.evidence.observations, 3);
    assert.equal(r.evidence.computedAt, NOWISO);
  });

  test('a grade never exceeds its evidence', () => {
    const outcomes = [completed('o1', 3), completed('o2', 3), completed('o3', 3)];
    const r = deriveGrade({ codingGrade: Difficulty.MECHANICAL }, outcomes, { now: NOWISO });
    assert.equal(r.class, Difficulty.COMPLEX);
    assert.ok(r.class < Difficulty.ARCHITECTURAL, 'never grants ARCHITECTURAL');
  });

  test('a failure is not evidence the model can finish the class', () => {
    const outcomes = [
      { id: 'f1', class: 4, outcome: 'failed' },
      { id: 'f2', class: 4, outcome: 'failed' },
      { id: 'f3', class: 4, outcome: 'failed' },
    ];
    const r = deriveGrade({ codingGrade: Difficulty.STANDARD }, outcomes, { now: NOWISO });
    assert.equal(r.derived, false);
    assert.equal(r.insufficientEvidence, true);
    assert.equal(r.class, Difficulty.STANDARD);
  });

  test('the floor can be set explicitly and evidence is counted from outcomes, not a field', () => {
    const r = deriveGrade({ codingGrade: Difficulty.MECHANICAL }, [completed('o1', 2)], {
      floor: 1,
      now: NOWISO,
    });
    assert.equal(r.class, Difficulty.STANDARD);
    assert.equal(r.evidence.observations, 1);
    assert.equal(r.floor, 1);
  });
});

describe('Review grade rules (TASK-AI-41)', () => {
  const { reviewGradeOf, scoreOffering, rankByFitness } = require('../fitness');

  test('reviewGrade is separate from codingGrade (AI-41-R01)', () => {
    const o = { id: 'm', codingGrade: Difficulty.STANDARD, reviewGrade: Difficulty.ARCHITECTURAL };
    assert.equal(gradeOf(o), Difficulty.STANDARD);
    assert.equal(reviewGradeOf(o), Difficulty.ARCHITECTURAL);
  });

  test('an unrated model reviews one class below what it writes (AI-41-R02)', () => {
    assert.equal(reviewGradeOf({ codingGrade: Difficulty.ARCHITECTURAL }), Difficulty.COMPLEX);
    assert.equal(reviewGradeOf({ codingGrade: Difficulty.COMPLEX }), Difficulty.STANDARD);
    assert.equal(reviewGradeOf({ codingGrade: Difficulty.STANDARD }), Difficulty.MECHANICAL);
    assert.equal(reviewGradeOf({ codingGrade: Difficulty.MECHANICAL }), Difficulty.MECHANICAL);
  });

  test('an undeclared model defaults to MECHANICAL review (AI-41-R02)', () => {
    assert.equal(reviewGradeOf({}), Difficulty.MECHANICAL);
  });

  test('explicit declaration is required to review at coding level (AI-41-R03)', () => {
    const coder = { codingGrade: Difficulty.COMPLEX };
    assert.equal(reviewGradeOf(coder), Difficulty.STANDARD);

    const explicit = { codingGrade: Difficulty.COMPLEX, reviewGrade: Difficulty.COMPLEX };
    assert.equal(reviewGradeOf(explicit), Difficulty.COMPLEX);
  });

  test('reviewers are selected on review grade, not coding grade (AI-41-R04)', () => {
    const hd = {
      status: 'open',
      windows: { tokensPerDay: { limit: 1000000, used: 0, ratio: 0 } },
    };
    const unratedComplexCoder = {
      id: 'coder',
      codingGrade: Difficulty.COMPLEX,
      cost: { inputPerMillion: 0 },
    };
    const v = scoreOffering(unratedComplexCoder, Difficulty.COMPLEX, hd, {}, { reviewing: true });
    assert.equal(v.usable, false);
    assert.match(v.reason, /chỉ review được tới STANDARD/);

    const declaredComplexReviewer = {
      id: 'reviewer',
      codingGrade: Difficulty.STANDARD,
      reviewGrade: Difficulty.COMPLEX,
      cost: { inputPerMillion: 0 },
    };
    const v2 = scoreOffering(
      declaredComplexReviewer,
      Difficulty.COMPLEX,
      hd,
      {},
      { reviewing: true }
    );
    assert.equal(v2.usable, true);
    assert.equal(v2.grade, Difficulty.COMPLEX);
  });

  test('an out-of-ladder review grade falls back to one-below, not clamped (AI-41-R06)', () => {
    const typo = { id: 'typo', codingGrade: Difficulty.STANDARD, reviewGrade: 5 };
    assert.equal(reviewGradeOf(typo), Difficulty.MECHANICAL);

    const negative = { id: 'neg', codingGrade: Difficulty.COMPLEX, reviewGrade: -1 };
    assert.equal(reviewGradeOf(negative), Difficulty.STANDARD);
  });
});

describe('Review grade provenance (TASK-AI-41)', () => {
  const { resolveReviewGrade, reviewGradeOf } = require('../fitness');

  test('a declared ladder review grade is reported as declared', () => {
    const r = resolveReviewGrade({ id: 'm', reviewGrade: Difficulty.COMPLEX });
    assert.deepEqual(r, {
      class: Difficulty.COMPLEX,
      graded: true,
      source: 'declared',
    });
  });

  test('an absent review grade is reported as assumed one-below', () => {
    const r = resolveReviewGrade({ id: 'm', codingGrade: Difficulty.ARCHITECTURAL });
    assert.equal(r.class, Difficulty.COMPLEX);
    assert.equal(r.graded, false);
    assert.equal(r.source, 'assumed');
  });

  test('an out-of-ladder review grade reports an error and falls back to one-below', () => {
    const r = resolveReviewGrade({
      id: 'bad-rev',
      codingGrade: Difficulty.STANDARD,
      reviewGrade: 99,
    });
    assert.equal(r.class, Difficulty.MECHANICAL);
    assert.equal(r.graded, false);
    assert.equal(r.source, 'assumed');
    assert.match(r.error, /bad-rev/);
    assert.match(r.error, /99/);
  });

  test('resolveReviewGrade agrees with reviewGradeOf on the class for every case', () => {
    for (const c of [1, 2, 3, 4, 5, -1, 'nonsense', undefined, null]) {
      for (const cg of [1, 2, 3, 4, undefined]) {
        const offering = { codingGrade: cg, reviewGrade: c };
        assert.equal(
          resolveReviewGrade(offering).class,
          reviewGradeOf(offering),
          'disagreement for reviewGrade ' + c + ', codingGrade ' + cg
        );
      }
    }
  });
});
