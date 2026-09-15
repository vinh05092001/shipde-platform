/**
 * Ship Dễ — Review Lane and Manifest Audit Test Suite
 *
 * Two rules under test. A reviewer must be strong, and reviewing is harder
 * than writing. And spare capacity should be working: review never writes to
 * a branch, so it runs alongside authoring rather than queueing behind it.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { Difficulty, gradeOf, reviewGradeOf, scoreOffering, rankByFitness } = require('../fitness');
const { planDispatch, REVIEW_ROLES } = require('../scheduler');
const { auditManifest } = require('../manifest-audit');

const NOW = Date.parse('2026-09-14T12:00:00Z');
const headroom = (limit, used) => ({
  status: 'open',
  windows: { tokensPerDay: { limit, used, ratio: used / limit } },
});
const CAPS = { jsonSchema: true, tools: true, contextWindow: 200000 };

describe('Reviewing is harder than writing', () => {
  test('an unrated model reviews one class below what it writes', () => {
    const m = { id: 'm', codingGrade: Difficulty.COMPLEX };
    assert.equal(gradeOf(m), Difficulty.COMPLEX);
    assert.equal(reviewGradeOf(m), Difficulty.STANDARD);
  });

  test('a model may be declared to review at the level it codes', () => {
    const m = { id: 'm', codingGrade: Difficulty.COMPLEX, reviewGrade: Difficulty.COMPLEX };
    assert.equal(reviewGradeOf(m), Difficulty.COMPLEX);
  });

  test('review grade never falls below the lowest class', () => {
    assert.equal(reviewGradeOf({ codingGrade: Difficulty.MECHANICAL }), Difficulty.MECHANICAL);
  });

  test('a model that may write COMPLEX may not review it unqualified', () => {
    const m = { id: 'm', codingGrade: Difficulty.COMPLEX };
    const asAuthor = scoreOffering(m, Difficulty.COMPLEX, headroom(1e9, 0), {});
    const asReviewer = scoreOffering(
      m,
      Difficulty.COMPLEX,
      headroom(1e9, 0),
      {},
      { reviewing: true }
    );
    assert.equal(asAuthor.usable, true);
    assert.equal(asReviewer.usable, false);
    assert.match(asReviewer.reason, /chỉ review được tới/);
  });

  test('for review the strongest model wins instead of being reserved', () => {
    // Authoring reserves strength; review spends it, because a review that
    // misses a defect costs more than the model that would have caught it.
    const mid = { id: 'mid', codingGrade: Difficulty.COMPLEX, reviewGrade: Difficulty.STANDARD };
    const strong = {
      id: 'strong',
      codingGrade: Difficulty.ARCHITECTURAL,
      reviewGrade: Difficulty.ARCHITECTURAL,
    };
    const heads = { mid: headroom(1e9, 0), strong: headroom(1e9, 0) };

    const authoring = rankByFitness([strong, mid], Difficulty.STANDARD, heads, {});
    assert.equal(authoring.ranked[0].offering.id, 'mid', 'authoring reserves the strong model');

    const reviewing = rankByFitness(
      [strong, mid],
      Difficulty.STANDARD,
      heads,
      {},
      { reviewing: true }
    );
    assert.equal(reviewing.ranked[0].offering.id, 'strong', 'review takes the strongest available');
  });

  test('a reviewer still cannot run without quota to finish', () => {
    const strong = {
      id: 'strong',
      codingGrade: Difficulty.ARCHITECTURAL,
      reviewGrade: Difficulty.ARCHITECTURAL,
    };
    const v = scoreOffering(
      strong,
      Difficulty.STANDARD,
      headroom(100000, 95000),
      {},
      { reviewing: true }
    );
    assert.equal(v.usable, false, 'strength does not excuse an empty budget');
  });
});

describe('Spare capacity goes to review', () => {
  const pool = [
    {
      id: 'pool',
      provider: 'x',
      tier: 0,
      enabled: true,
      capabilities: CAPS,
      limits: {},
      models: [
        { model: 'writer', codingGrade: Difficulty.COMPLEX, limits: { tokensPerDay: 9000000 } },
        {
          model: 'judge',
          codingGrade: Difficulty.ARCHITECTURAL,
          reviewGrade: Difficulty.ARCHITECTURAL,
          limits: { tokensPerDay: 9000000 },
        },
      ],
    },
  ];

  const authoring = {
    workItemId: 'A-1',
    role: 'author.foundation',
    branch: 'feat/a',
    riskDomains: [],
  };
  const review = { workItemId: 'B-1', role: 'reviewer.primary', branch: 'feat/b', riskDomains: [] };

  test('a review runs alongside authoring instead of queueing behind it', () => {
    const plan = planDispatch([authoring, review], pool, {
      limits: { maxImplementationAgents: 1, maxPerAccount: 2 },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 2, 'the implementation limit does not hold back review');
    assert.ok(plan.assignments.some((a) => REVIEW_ROLES.has(a.role)));
  });

  test('a review may target a branch another writer holds', () => {
    // A reviewer reads a pull request; it never writes, so the claim does not
    // apply to it.
    const plan = planDispatch([review], pool, {
      claims: [{ branch: 'feat/b', owner: 'another-session' }],
      now: NOW,
    });
    assert.equal(plan.assignments.length, 1);
    assert.equal(plan.deferred.length, 0);
  });

  test('a review does not occupy the Work Item, so authoring on it continues', () => {
    const sameItem = Object.assign({}, authoring, { workItemId: 'B-1' });
    const plan = planDispatch([review, sameItem], pool, {
      limits: { maxPerAccount: 2 },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 2, 'reviewing B-1 does not block authoring B-1');
  });

  test('two writers on one Work Item is still refused', () => {
    const a = Object.assign({}, authoring, { workItemId: 'C-1', branch: 'feat/c1' });
    const b = Object.assign({}, authoring, { workItemId: 'C-1', branch: 'feat/c2' });
    const plan = planDispatch([a, b], pool, {
      limits: { maxImplementationAgents: 5, maxPerAccount: 5 },
      now: NOW,
    });
    assert.equal(
      plan.assignments.length,
      1,
      'the safety invariant is untouched by the review lane'
    );
  });

  test('the review lane has its own ceiling', () => {
    const three = [1, 2, 3].map((n) =>
      Object.assign({}, review, { workItemId: 'R-' + n, branch: 'feat/r' + n })
    );
    const plan = planDispatch(three, pool, {
      limits: { maxReviewAgents: 2, maxPerAccount: 5 },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 2);
    assert.equal(plan.deferred[0].reason, 'REVIEW_LIMIT');
  });

  test('utilisation reports idle slots so waste is visible', () => {
    const plan = planDispatch([authoring], pool, {
      limits: { maxImplementationAgents: 3, maxReviewAgents: 2 },
      now: NOW,
    });
    assert.equal(plan.utilisation.idleImplementation, 2);
    assert.equal(plan.utilisation.idleReview, 2);
  });
});

describe('Manifest audit', () => {
  const base = {
    id: 'thing',
    repository: 'owner/thing',
    role: 'Does a thing.',
    install_method: 'npm-global',
    lifecycle_state: 'INSTALLED',
    pinned_version_or_commit: '1.0.0',
    blocking_policy: 'NON_BLOCKING',
  };
  const audit = (entry, deps) =>
    auditManifest(
      { adopted: [Object.assign({}, base, entry)] },
      Object.assign({ onPath: () => true, dependencies: new Set(), repoExists: () => true }, deps)
    );

  const codes = (r) => r.findings.map((f) => f.code);

  test('declared INSTALLED but absent is an error', () => {
    const r = audit({}, { onPath: () => false });
    assert.ok(codes(r).includes('DECLARED_INSTALLED_BUT_ABSENT'));
    assert.equal(r.trustworthy, false);
  });

  test('a missing quality gate is an error, not a warning', () => {
    // The pipeline believes it is being scanned; that belief is the damage.
    const r = audit(
      {
        id: 'gitleaks',
        lifecycle_state: 'ADOPTED',
        install_method: 'system',
        role: 'Secret scanner.',
      },
      { onPath: () => false }
    );
    const f = r.findings.find((x) => x.code === 'QUALITY_GATE_MISSING');
    assert.ok(f);
    assert.equal(f.severity, 'error');
  });

  test('an absent non-gate tool is only a warning', () => {
    const r = audit(
      {
        id: 'storybook',
        lifecycle_state: 'ADOPTED',
        install_method: 'npm-dev',
        role: 'Component workshop.',
      },
      { dependencies: new Set() }
    );
    assert.equal(r.findings.find((x) => x.code === 'DECLARED_ADOPTED_BUT_ABSENT').severity, 'warn');
  });

  test('a pinned commit for a repository that does not exist is an error', () => {
    const r = audit(
      { pinned_version_or_commit: '711954f9b7ceba86e890001fce97786536ac02d4' },
      { repoExists: () => false }
    );
    assert.ok(codes(r).includes('PINNED_COMMIT_FOR_MISSING_REPO'));
    assert.equal(r.trustworthy, false);
  });

  test('an unverifiable repository is reported without being called an error', () => {
    const r = audit(
      { pinned_version_or_commit: '711954f9b7ceba86e890001fce97786536ac02d4' },
      { repoExists: () => null }
    );
    assert.equal(r.findings.find((x) => x.code === 'REPO_UNVERIFIED').severity, 'info');
    assert.equal(r.trustworthy, true, 'no network is not a manifest defect');
  });

  test('an unpinned entry is a warning', () => {
    const r = audit({ pinned_version_or_commit: '' });
    assert.equal(r.findings.find((x) => x.code === 'NOT_PINNED').severity, 'warn');
  });

  test('on-demand entries are not counted as absent', () => {
    const r = audit({ install_method: 'npx-on-demand' }, { onPath: () => false });
    assert.equal(r.onDemand, 1);
    assert.equal(r.absent, 0, 'fetch-on-use is the designed state');
  });

  test('binary aliases prevent false absences', () => {
    // Reporting `claude-code` missing because no `claude-code` binary exists
    // would train the operator to ignore the audit.
    const seen = [];
    audit(
      { id: 'claude-code' },
      {
        onPath: (n) => {
          seen.push(n);
          return true;
        },
      }
    );
    assert.ok(seen.includes('claude'));
  });
});
