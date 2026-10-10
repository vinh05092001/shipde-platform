'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { draftWorkItem, planWorkItem } = require('../work-item-planner');
const { nextLoop } = require('../next-runner');
const { planCommand } = require('../cli');

function fixtureRoot(name) {
  const root = fs.mkdtempSync(path.join(__dirname, name));
  const files = {
    [path.join('docs', 'product-spec', 'docs', '10-ai-collaboration', 'WORK-ITEM-TEMPLATE.md')]: [
      'Business outcome',
      'Source references',
      'Preconditions and dependencies',
      'Author boundary',
      'In scope',
      'Out of scope',
      'Business rules and edge cases',
      'UI states',
      'API, event and data impact',
      'Acceptance matrix',
      'Verification commands',
      'Codex review record',
      'Residual limitations',
    ]
      .map((heading) => '## ' + heading)
      .join('\n'),
    [path.join('docs', 'product-spec', 'docs', '01-product', 'MASTER-FEATURE-CATALOG.md')]:
      '| FEAT-AUTH-07 | Fixture feature | Approved behavior |',
    [path.join('docs', 'product-spec', 'docs', '00-control', 'BASELINE-AND-DECISIONS.md')]:
      '# Baseline\n',
    [path.join('docs', 'product-spec', 'docs', '01-product', 'PRODUCT-VISION-SCOPE.md')]:
      '# Vision\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  fs.mkdirSync(path.join(root, 'docs', 'product-spec', 'work-items'), { recursive: true });
  return root;
}

test('G1 creates a template-shaped source-complete draft without inventing a block', () => {
  const root = fixtureRoot('plan-g1-');
  try {
    const result = draftWorkItem(
      'FEAT-AUTH-07',
      {
        rootDir: root,
      },
      {
        items: [
          {
            work_item_id: 'FEAT-AUTH-07',
            feature_id: 'FEAT-AUTH-07',
            feature_name: 'Fixture feature',
            key_behavior: 'Approved behavior',
            delivery_order: 10,
            dependencies: '',
          },
        ],
      }
    );
    const draft = fs.readFileSync(result.target, 'utf8');
    assert.equal(result.status, 'DRAFT');
    assert.match(draft, /MASTER-FEATURE-CATALOG\.md#line 1/);
    assert.match(draft, /## Acceptance matrix/);
    assert.match(draft, /## Open decisions/);
    assert.match(draft, /Status \| `DRAFT`/);
    assert.match(draft, /Approved behavior/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G1 injected source reader still loads approved business and screen specifications', () => {
  const root = fixtureRoot('plan-g1-reader-');
  const businessRel = path.join('docs', 'product-spec', 'docs', '02-business', 'rules.md');
  const screenRel = path.join('docs', 'product-spec', 'docs', '03-ux', 'screen.md');
  fs.mkdirSync(path.dirname(path.join(root, businessRel)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, screenRel)), { recursive: true });
  fs.writeFileSync(path.join(root, businessRel), '# Fixture feature rules\n');
  fs.writeFileSync(path.join(root, screenRel), '# Fixture feature screen\n');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  try {
    draftWorkItem(
      'FEAT-AUTH-07',
      { rootDir: root },
      {
        readSource: read,
        items: [
          {
            work_item_id: 'FEAT-AUTH-07',
            feature_name: 'Fixture feature',
            key_behavior: 'Approved behavior',
          },
        ],
      }
    );
    const draft = fs.readFileSync(
      path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md'),
      'utf8'
    );
    assert.match(draft, /02-business[\\/]rules\.md/);
    assert.match(draft, /03-ux[\\/]screen\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G1 missing feature detail is explicitly blocked', () => {
  const root = fixtureRoot('plan-g1-blocked-');
  try {
    const result = draftWorkItem(
      'FEAT-AUTH-07',
      { rootDir: root },
      { items: [{ work_item_id: 'FEAT-AUTH-07', feature_name: 'Unknown', key_behavior: '' }] }
    );
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.blocking, true);
    assert.match(fs.readFileSync(result.target, 'utf8'), /## Open decisions[\s\S]*\n- /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G2 planning and author lanes stay independent and governed run requires its executor', async () => {
  let received;
  const result = await planWorkItem(
    'FEAT-AUTH-07',
    { run: true },
    {
      runPlanning: async (request) => {
        received = request;
        return {
          status: 'READY_FOR_AUTHOR',
          governed: true,
          independentReview: 'PASS',
          merged: true,
        };
      },
      rankPlanner: async () => ({ candidateKey: 'planner-candidate' }),
      runIsolatedPlanner: async () => ({ isolated: true }),
      reviewPlan: async () => ({ independent: true }),
      mergePlan: async () => ({ governed: true }),
    }
  );
  assert.equal(result.status, 'READY_FOR_AUTHOR');
  assert.equal(received.role, 'planner.default');
  assert.equal(received.isolatedWorker, true);
  assert.equal(received.independentReviewer, true);
  assert.equal(received.docsOnly, true);
  assert.equal(received.governedMerge, true);
  assert.equal(typeof received.rankPlanner, 'function');
  await assert.rejects(planWorkItem('FEAT-AUTH-07', { run: true }, {}), {
    code: 'PLAN_EXECUTOR_REQUIRED',
  });
});

test('G2 CLI plan --run wires its execution dependencies to the planner module', async () => {
  let called = false;
  const response = await planCommand(
    { 'work-item': 'FEAT-AUTH-07', run: true },
    {
      runPlanning: async (request) => {
        called = true;
        assert.equal(request.workItemId, 'FEAT-AUTH-07');
        return { status: 'BLOCKED', reason: 'fixture gate' };
      },
      rankPlanner: async () => ({}),
      runIsolatedPlanner: async () => ({}),
      reviewPlan: async () => ({}),
      mergePlan: async () => ({}),
    }
  );
  assert.equal(called, true);
  assert.equal(response.status, 'BLOCKED');
});

test('G3 next loop plans a dependency-ready backlog item when no author-ready item exists', async () => {
  const root = fixtureRoot('plan-g3-');
  const priorHome = os.homedir;
  let request;
  try {
    const result = await nextLoop(
      {
        rootDir: root,
        maxIterations: 1,
        decisionDir: path.join(root, 'decisions'),
      },
      {
        items: [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' }],
        records: [],
        planningDeps: {
          runPlanning: async (planRequest) => {
            request = planRequest;
            return {
              status: 'READY_FOR_AUTHOR',
              governed: true,
              independentReview: 'PASS',
              merged: true,
            };
          },
          rankPlanner: async () => ({ candidateKey: 'planner-candidate' }),
          runIsolatedPlanner: async () => ({ isolated: true }),
          reviewPlan: async () => ({ independent: true }),
          mergePlan: async () => ({ governed: true }),
        },
        log: () => {},
        now: Date.now(),
      }
    );
    assert.equal(request.workItemId, 'FEAT-AUTH-07');
    assert.equal(request.role, 'planner.default');
    assert.equal(result.completed, true);
    assert.equal(
      fs.existsSync(path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md')),
      false
    );
  } finally {
    os.homedir = priorHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 refuses to draft or mark author-ready when the governed planner is unavailable', async () => {
  const root = fixtureRoot('plan-g3-closed-');
  try {
    const result = await nextLoop(
      { rootDir: root, maxIterations: 1, decisionDir: path.join(root, 'decisions') },
      {
        items: [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' }],
        records: [],
        log: () => {},
        now: Date.now(),
      }
    );
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'PLANNING_FAILED');
    assert.equal(
      fs.existsSync(path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md')),
      false
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G4 source-limited drafting does not include uncited product claims', () => {
  const root = fixtureRoot('plan-g4-');
  try {
    const result = draftWorkItem(
      'FEAT-AUTH-07',
      { rootDir: root },
      {
        items: [
          {
            work_item_id: 'FEAT-AUTH-07',
            feature_id: 'FEAT-AUTH-07',
            feature_name: 'Fixture feature',
            key_behavior: 'Approved behavior',
            delivery_order: 10,
          },
        ],
      }
    );
    const draft = fs.readFileSync(result.target, 'utf8');
    assert.match(draft, /Approved behavior/);
    assert.doesNotMatch(draft, /Automatically transfers money/);
    assert.equal(result.status, 'DRAFT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
