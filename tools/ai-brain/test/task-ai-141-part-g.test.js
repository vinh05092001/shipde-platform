'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { draftWorkItem, planWorkItem, defaultPlanningDeps } = require('../work-item-planner');
const { nextLoop } = require('../next-runner');
const { findNextWorkItem } = require('../next-runner');
const { planCommand } = require('../cli');

function nextLoopDeps(overrides) {
  return {
    records: [],
    checkCandidateLanes: () => ({ available: true }),
    openWritersDetailed: () => ({ writers: [] }),
    openReviewersDetailed: () => ({ reviewers: [] }),
    checkCeiling: () => ({ allowed: true }),
    writerFor: () => null,
    isOpenRun: () => false,
    log: () => {},
    ...(overrides || {}),
  };
}

function fixtureRoot(name) {
  const root = fs.mkdtempSync(path.join(__dirname, name));
  const files = {
    [path.join(
      'docs',
      'product-spec',
      'docs',
      '10-ai-collaboration',
      'FEATURE-DELIVERY-REGISTER.csv'
    )]:
      'delivery_order,slice,group,work_item_id,feature_id,feature_name,key_behavior,status,dependencies,work_item_path,branch,pr,codex_verdict,merge_commit\n10,fixture,auth,FEAT-AUTH-07,FEAT-AUTH-07,Fixture feature,Approved behavior,BACKLOG,,,feat/fixture,,,,\n',
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
  const root = fixtureRoot('plan-g2-lanes-');
  try {
    let received;
    const calls = [];
    const result = await planWorkItem(
      'FEAT-AUTH-07',
      { run: true, rootDir: root },
      {
        items: [
          {
            work_item_id: 'FEAT-AUTH-07',
            feature_id: 'FEAT-AUTH-07',
            feature_name: 'Fixture feature',
            key_behavior: 'Approved behavior',
            status: 'BACKLOG',
          },
        ],
        runPlanning: async (request) => {
          received = request;
          return {
            status: 'READY_FOR_AUTHOR',
            governed: true,
            independentReview: 'PASS',
            merged: true,
          };
        },
        rankPlanner: async () => (
          calls.push('rank'),
          { eligible: true, candidateKey: 'planner-candidate' }
        ),
        runIsolatedPlanner: async () => (calls.push('write'), { success: true }),
        reviewPlan: async () => (calls.push('review'), { verdict: 'PASS' }),
        mergePlan: async () => (calls.push('merge'), { success: true, merged: true }),
      }
    );
    assert.equal(result.status, 'READY_FOR_AUTHOR');
    assert.equal(received.role, 'planner.default');
    assert.equal(received.isolatedWorker, true);
    assert.equal(received.independentReviewer, true);
    assert.equal(received.docsOnly, true);
    assert.equal(received.governedMerge, true);
    assert.deepEqual(calls, ['rank', 'write', 'review', 'merge']);
    const root2 = fixtureRoot('plan-g2-lanes-exec-');
    try {
      await assert.rejects(
        planWorkItem(
          'FEAT-AUTH-07',
          { run: true, rootDir: root2 },
          { items: [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG' }] }
        ),
        { code: 'PLAN_EXECUTOR_REQUIRED' }
      );
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G2 plan --run validates register membership and existing documents before ranking', async () => {
  const root = fixtureRoot('plan-g2-guards-');
  const calls = [];
  const deps = {
    items: [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG' }],
    rankPlanner: async () => (calls.push('rank'), { candidateKey: 'planner' }),
    runIsolatedPlanner: async () => (calls.push('write'), { success: true }),
    reviewPlan: async () => (calls.push('review'), { verdict: 'PASS' }),
    mergePlan: async () => (calls.push('merge'), { merged: true }),
    runPlanning: async () => (calls.push('run'), { status: 'READY_FOR_AUTHOR' }),
  };
  try {
    await assert.rejects(planWorkItem('FEAT-AUTH-99', { run: true, rootDir: root }, deps), {
      code: 'PLAN_NOT_IN_REGISTER',
    });
    fs.writeFileSync(
      path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md'),
      '# already exists\n'
    );
    await assert.rejects(planWorkItem('FEAT-AUTH-07', { run: true, rootDir: root }, deps), {
      code: 'PLAN_ALREADY_EXISTS',
    });
    assert.deepEqual(calls, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G2 CLI plan --run wires its execution dependencies to the planner module', async () => {
  const root = fixtureRoot('plan-cli-run-');
  try {
    let called = false;
    const response = await planCommand(
      { 'work-item': 'FEAT-AUTH-07', run: true, root },
      {
        planningDeps: {
          items: [
            {
              work_item_id: 'FEAT-AUTH-07',
              feature_id: 'FEAT-AUTH-07',
              feature_name: 'Fixture feature',
              key_behavior: 'Approved behavior',
              status: 'BACKLOG',
            },
          ],
          runPlanning: async (request) => {
            called = true;
            assert.equal(request.workItemId, 'FEAT-AUTH-07');
            return { status: 'BLOCKED', reason: 'fixture gate' };
          },
          rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-fixture' }),
          runIsolatedPlanner: async () => ({ success: true }),
          reviewPlan: async () => ({ verdict: 'PASS' }),
          mergePlan: async () => ({ success: true, merged: true }),
        },
      }
    );
    assert.equal(called, true);
    assert.equal(response.status, 'BLOCKED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G2 default planner services are present and fail closed at missing external gates', async () => {
  const root = fixtureRoot('plan-g2-default-');
  try {
    const deps = defaultPlanningDeps(root, {
      items: [
        {
          work_item_id: 'FEAT-AUTH-07',
          feature_id: 'FEAT-AUTH-07',
          feature_name: 'Fixture feature',
          key_behavior: 'Approved behavior',
          status: 'BACKLOG',
        },
      ],
      candidates: [],
      rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-fake' }),
      runIsolatedPlanner: async () => ({ success: true }),
    });
    assert.equal(typeof deps.rankPlanner, 'function');
    assert.equal(typeof deps.runIsolatedPlanner, 'function');
    assert.equal(typeof deps.reviewPlan, 'function');
    assert.equal(typeof deps.mergePlan, 'function');
    assert.equal(typeof deps.runPlanning, 'function');
    const result = await planWorkItem('FEAT-AUTH-07', { run: true, rootDir: root }, deps);
    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason, /Independent planner review/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 next loop plans a dependency-ready backlog item when no author-ready item exists', async () => {
  const root = fixtureRoot('plan-g3-');
  let request;
  let authorRuns = 0;
  const register = [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' }];
  try {
    const result = await nextLoop(
      { rootDir: root, maxIterations: 1, decisionDir: path.join(root, 'decisions') },
      nextLoopDeps({
        readRegister: () => register.map((item) => ({ ...item })),
        runIntake: async () => {
          authorRuns += 1;
          return { status: 'completed' };
        },
        planningDeps: {
          runPlanning: async (planRequest) => {
            request = planRequest;
            fs.writeFileSync(
              path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md'),
              '# independently reviewed draft\n'
            );
            return {
              status: 'READY_FOR_AUTHOR',
              governed: true,
              independentReview: 'PASS',
              merged: true,
            };
          },
          rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-candidate' }),
          runIsolatedPlanner: async () => ({ success: true }),
          reviewPlan: async () => ({ verdict: 'PASS' }),
          mergePlan: async () => {
            register[0].status = 'READY_FOR_AUTHOR';
            return { merged: true };
          },
        },
      })
    );
    assert.equal(request.workItemId, 'FEAT-AUTH-07');
    assert.equal(request.role, 'planner.default');
    assert.equal(result.completed, true);
    assert.equal(authorRuns, 1);
    assert.equal(
      fs.readFileSync(
        path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md'),
        'utf8'
      ),
      '# independently reviewed draft\n'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('G3 refuses to draft or mark author-ready when the governed planner is unavailable', async () => {
  const root = fixtureRoot('plan-g3-closed-');
  try {
    const result = await nextLoop(
      { rootDir: root, maxIterations: 1, decisionDir: path.join(root, 'decisions') },
      nextLoopDeps({
        items: [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' }],
        now: Date.now(),
      })
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

test('G3 keeps the author lane selected and plans one dependency-ready item ahead', () => {
  const root = fixtureRoot('plan-g3-parallel-');
  try {
    const ready = { work_item_id: 'FEAT-AUTH-06', status: 'READY_FOR_AUTHOR', dependencies: '' };
    const backlog = { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' };
    const result = findNextWorkItem(
      { rootDir: root, loop: true },
      { items: [ready, backlog], records: [] }
    );
    assert.equal(result.item, ready);
    assert.equal(result.planCandidate, backlog);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 does not treat a draft-backed BACKLOG row as approved for authoring', () => {
  const root = fixtureRoot('plan-g3-existing-');
  try {
    const workItemDir = path.join(root, 'docs', 'product-spec', 'work-items');
    fs.writeFileSync(path.join(workItemDir, 'FEAT-AUTH-07.md'), '# existing\n');
    const result = findNextWorkItem(
      { rootDir: root, loop: true },
      {
        items: [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' }],
        records: [],
      }
    );
    assert.equal(result.item, null);
    assert.equal(result.planCandidate, null);
    assert.match(result.skipped[0].reason, /not READY_FOR_AUTHOR/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 skips an earlier ungoverned doc-backed backlog row and plans a later row', () => {
  const root = fixtureRoot('plan-g3-mixed-');
  try {
    const workItemDir = path.join(root, 'docs', 'product-spec', 'work-items');
    fs.writeFileSync(path.join(workItemDir, 'FEAT-AUTH-06.md'), '# existing\n');
    const existing = { work_item_id: 'FEAT-AUTH-06', status: 'BACKLOG', dependencies: '' };
    const needsPlan = { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' };
    const result = findNextWorkItem(
      { rootDir: root, loop: true },
      { items: [existing, needsPlan], records: [] }
    );
    assert.equal(result.item, needsPlan);
    assert.equal(result.planCandidate, needsPlan);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 next loop does not run intake for an ungoverned doc-backed BACKLOG row', async () => {
  const root = fixtureRoot('plan-g3-doc-backed-author-');
  const workItemPath = path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md');
  fs.writeFileSync(workItemPath, '# Existing Work Item\n');
  const calls = [];
  try {
    const result = await nextLoop(
      { rootDir: root, maxIterations: 1, decisionDir: path.join(root, 'decisions') },
      nextLoopDeps({
        items: [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' }],
        planningDeps: {
          runPlanning: async () => {
            calls.push('planning');
            throw new Error('draft must go through governed planning');
          },
        },
        runIntake: async (options) => {
          calls.push(`intake:${options.workItem}`);
          return { status: 'launched' };
        },
      })
    );
    assert.deepEqual(calls, []);
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'NO_READY_ITEM');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 READY author selection never starts planning an existing-doc BACKLOG row', () => {
  const root = fixtureRoot('plan-g3-ready-mixed-');
  try {
    fs.writeFileSync(
      path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md'),
      '# existing\n'
    );
    const ready = { work_item_id: 'FEAT-AUTH-06', status: 'READY_FOR_AUTHOR', dependencies: '' };
    const existing = { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' };
    const next = { work_item_id: 'FEAT-AUTH-08', status: 'BACKLOG', dependencies: '' };
    const result = findNextWorkItem(
      { rootDir: root, loop: true },
      { items: [ready, existing, next], records: [] }
    );
    assert.equal(result.item, ready);
    assert.equal(result.planCandidate, next);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G2 real CLI plan command runs as a child process without a deps ReferenceError', () => {
  const root = fixtureRoot('plan-cli-child-');
  const cli = path.resolve(__dirname, '..', 'cli.js');
  try {
    const result = spawnSync(
      process.execPath,
      [cli, 'plan', '--work-item', 'FEAT-AUTH-07', '--root', root],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /ReferenceError|deps is not defined/);
    assert.match(result.stdout, /"id": "FEAT-AUTH-07"/);
    assert.equal(
      fs.existsSync(path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md')),
      true
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 planner lane accepts a blocked result as a single planning outcome', async () => {
  const root = fixtureRoot('plan-g3-lane-blocked-');
  try {
    const calls = [];
    const result = await planWorkItem(
      'FEAT-AUTH-07',
      { run: true, rootDir: root },
      {
        items: [
          {
            work_item_id: 'FEAT-AUTH-07',
            feature_id: 'FEAT-AUTH-07',
            feature_name: 'Fixture feature',
            key_behavior: 'Approved behavior',
            status: 'BACKLOG',
          },
        ],
        runPlanning: async () => {
          calls.push('plan');
          return { status: 'BLOCKED', reason: 'source gap' };
        },
        rankPlanner: async () => ({ eligible: true, candidateKey: 'planner' }),
        runIsolatedPlanner: async () => ({ success: true }),
        reviewPlan: async () => ({ verdict: 'PASS' }),
        mergePlan: async () => ({ success: true, merged: true }),
      }
    );
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(calls, ['plan']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('G3 parallel planning failure stops the loop and records a failed decision', async () => {
  const root = fixtureRoot('plan-g3-parallel-failure-');
  try {
    const result = await nextLoop(
      { rootDir: root, maxIterations: 1, decisionDir: path.join(root, 'decisions') },
      nextLoopDeps({
        items: [
          { work_item_id: 'FEAT-AUTH-06', status: 'READY_FOR_AUTHOR', dependencies: '' },
          { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' },
        ],
        planningDeps: {
          runPlanning: async () => {
            throw new Error('parallel planner failed');
          },
          rankPlanner: async () => ({ eligible: true, candidateKey: 'planner' }),
          runIsolatedPlanner: async () => ({ success: true }),
          reviewPlan: async () => ({ verdict: 'PASS' }),
          mergePlan: async () => ({ success: true, merged: true }),
        },
        readRegister: () => [
          { work_item_id: 'FEAT-AUTH-06', status: 'READY_FOR_AUTHOR', dependencies: '' },
          { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' },
        ],
        runIntake: async () => ({ status: 'completed' }),
      })
    );
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'PLANNING_FAILED');
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
    const sourceText = fs.readFileSync(
      path.join(root, 'docs', 'product-spec', 'docs', '01-product', 'MASTER-FEATURE-CATALOG.md'),
      'utf8'
    );
    const catalogRow = sourceText.split(/\r?\n/).find((line) => line.includes('FEAT-AUTH-07'));
    const approvedClaims = new Set([
      'Approved behavior',
      'Fixture feature',
      'FEAT-AUTH-07',
      catalogRow,
    ]);
    const businessOutcome = draft.match(/## Business outcome\r?\n\r?\n> (.*)/);
    assert.ok(businessOutcome);
    assert.ok(approvedClaims.has(businessOutcome[1].replace(/^> /, '')));
    const sourceDerivedStatements = [
      'Register dependencies:',
      'Dependency merge status and feature-specific prerequisites require verification before authoring.',
      'Author and implementation boundary',
      'Do not implement behavior',
      'The catalog outcome above',
      'Any behavior not explicitly established',
      'No feature-specific rules were inferred',
      'No screen behavior inferred',
      'No API, event, entity or persistence impact inferred',
      '| TBD | Add approved acceptance criteria before authoring | TBD | Source-backed test evidence |',
      'Determine from the repository baseline and feature implementation scope.',
      'Feature detail is incomplete pending the decisions below.',
      'No matching feature-specific section was found in the approved sources.',
    ];
    for (const line of draft.split(/\r?\n/)) {
      if (line.startsWith('- ')) {
        assert.ok(
          sourceDerivedStatements.some((statement) => line.includes(statement)) ||
            line === '- None.' ||
            line.startsWith('- Status remains a draft') ||
            line.includes('No matching cited section found in approved source:') ||
            line.startsWith('- ``docs\\') ||
            line.startsWith('- ``docs/'),
          'unexpected generated claim: ' + line
        );
      }
    }
    assert.doesNotMatch(
      draft,
      /Assigned author \| `GEMINI`|Risk \| `UNASSESSED`|feat\/feat-auth-07-implementation/
    );
    assert.equal(result.status, 'DRAFT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G4 unsourced register business outcome blocks draft and is omitted', () => {
  const root = fixtureRoot('plan-g4-unsourced-');
  try {
    const result = draftWorkItem(
      'FEAT-AUTH-07',
      { rootDir: root },
      {
        items: [
          {
            work_item_id: 'FEAT-AUTH-07',
            feature_name: 'Fixture feature',
            key_behavior: 'Invented outcome',
          },
        ],
      }
    );
    const draft = fs.readFileSync(result.target, 'utf8');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.blocking, true);
    assert.match(draft, /not present in approved sources/);
    assert.doesNotMatch(draft, /> Invented outcome/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 loop re-read selects the newly READY row despite an earlier BACKLOG row', () => {
  const root = fixtureRoot('plan-g3-reread-');
  const register = [
    { work_item_id: 'FEAT-AUTH-06', status: 'BACKLOG', dependencies: '' },
    { work_item_id: 'FEAT-AUTH-07', status: 'READY_FOR_AUTHOR', dependencies: '' },
  ];
  try {
    const result = findNextWorkItem(
      { rootDir: root, loop: true },
      { items: register, records: [] }
    );
    assert.equal(result.item.work_item_id, 'FEAT-AUTH-07');
    assert.equal(result.item.status, 'READY_FOR_AUTHOR');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 parallel planning promise is always awaited/joined when loop exits early', async () => {
  const root = fixtureRoot('plan-g3-parallel-join-');
  try {
    let parallelJoined = false;
    const register = [
      { work_item_id: 'FEAT-AUTH-06', status: 'READY_FOR_AUTHOR', dependencies: '' },
      { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' },
    ];
    const result = await nextLoop(
      {
        rootDir: root,
        maxIterations: 1,
        pollIntervalMs: 5,
        decisionDir: path.join(root, 'decisions'),
      },
      nextLoopDeps({
        items: register,
        readRegister: () => register.map((item) => ({ ...item })),
        checkCandidateLanes: () => ({ available: false, earliestResetTime: 0 }),
        planningDeps: {
          runPlanning: async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            parallelJoined = true;
            return {
              status: 'READY_FOR_AUTHOR',
              governed: true,
              independentReview: 'PASS',
              merged: true,
            };
          },
          rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-cand' }),
          runIsolatedPlanner: async () => ({ success: true }),
          reviewPlan: async () => ({ verdict: 'PASS' }),
          mergePlan: async () => {
            register[1].status = 'READY_FOR_AUTHOR';
            return { success: true, merged: true };
          },
        },
      })
    );
    assert.equal(
      parallelJoined,
      true,
      'parallel planning promise must be joined before nextLoop returns on early exit'
    );
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'ALL_LANES_UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 parallel planning rejection on early exit is handled and records PLANNING_FAILED', async () => {
  const root = fixtureRoot('plan-g3-parallel-err-');
  try {
    const register = [
      { work_item_id: 'FEAT-AUTH-06', status: 'READY_FOR_AUTHOR', dependencies: '' },
      { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' },
    ];
    const result = await nextLoop(
      {
        rootDir: root,
        maxIterations: 1,
        pollIntervalMs: 5,
        decisionDir: path.join(root, 'decisions'),
      },
      nextLoopDeps({
        items: register,
        readRegister: () => register.map((item) => ({ ...item })),
        checkCandidateLanes: () => ({ available: false, earliestResetTime: 0 }),
        planningDeps: {
          runPlanning: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw new Error('parallel worker crashed');
          },
          rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-cand' }),
          runIsolatedPlanner: async () => ({ success: true }),
          reviewPlan: async () => ({ verdict: 'PASS' }),
          mergePlan: async () => ({ success: true, merged: true }),
        },
      })
    );
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'PLANNING_FAILED');
    assert.equal(result.workItemId, 'FEAT-AUTH-07');
    const decisionsApi = require('../decisions');
    const decs = decisionsApi.readDecisions({
      dir: path.join(root, 'decisions'),
      now: Date.now(),
    });
    const failedDecisions = decs.filter(
      (r) => r.workItemId === 'FEAT-AUTH-07' && r.detail === 'PLANNING_FAILED'
    );
    assert.ok(
      failedDecisions.length > 0,
      'must record PLANNING_FAILED decision on parallel planning rejection'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 loop iteration ceiling continuation does not re-plan the same item twice', async () => {
  const root = fixtureRoot('plan-g3-no-replan-');
  try {
    let planCount = 0;
    const register = [
      { work_item_id: 'FEAT-AUTH-06', status: 'READY_FOR_AUTHOR', dependencies: '' },
      { work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' },
    ];
    let iterationCall = 0;
    const result = await nextLoop(
      {
        rootDir: root,
        maxIterations: 2,
        pollIntervalMs: 5,
        decisionDir: path.join(root, 'decisions'),
      },
      nextLoopDeps({
        items: register,
        readRegister: () => register.map((item) => ({ ...item })),
        checkCeiling: (opts) => {
          iterationCall += 1;
          // Disallow author lane in iteration 1 so it continues
          return { allowed: false, reason: 'CEILING_LIMIT', detail: 'author capped' };
        },
        planningDeps: {
          runPlanning: async () => {
            planCount += 1;
            return {
              status: 'BLOCKED',
              reason: 'blocked for testing',
            };
          },
          rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-cand' }),
          runIsolatedPlanner: async () => ({ success: true }),
          reviewPlan: async () => ({ verdict: 'PASS' }),
          mergePlan: async () => ({ success: true, merged: true }),
        },
      })
    );
    assert.equal(
      planCount,
      1,
      'should not launch planner a second time for the same item across iterations'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G2 plan --run calls draftWorkItem before running planner worker', async () => {
  const root = fixtureRoot('plan-g2-draft-called-');
  try {
    let draftCalled = false;
    const registerItem = {
      work_item_id: 'FEAT-AUTH-07',
      feature_id: 'FEAT-AUTH-07',
      feature_name: 'Fixture feature',
      key_behavior: 'Approved behavior',
      status: 'BACKLOG',
    };
    const result = await planWorkItem(
      'FEAT-AUTH-07',
      { run: true, rootDir: root },
      {
        items: [registerItem],
        draftWorkItem: (id, opts, d) => {
          draftCalled = true;
          return draftWorkItem(id, opts, d);
        },
        rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-cand' }),
        runIsolatedPlanner: async () => ({ success: true }),
        reviewPlan: async () => ({ verdict: 'PASS' }),
        mergePlan: async () => ({ success: true, merged: true }),
        runPlanning: async () => ({
          status: 'READY_FOR_AUTHOR',
          governed: true,
          independentReview: 'PASS',
          merged: true,
        }),
      }
    );
    assert.equal(draftCalled, true, 'plan --run must call draftWorkItem');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G2 plan --run validates worker draft against approved sources and blocks before governed merge', async () => {
  const root = fixtureRoot('plan-g2-unsourced-worker-');
  try {
    let mergeCalled = false;
    const registerItem = {
      work_item_id: 'FEAT-AUTH-07',
      feature_id: 'FEAT-AUTH-07',
      feature_name: 'Fixture feature',
      key_behavior: 'Approved behavior',
      status: 'BACKLOG',
    };
    const result = await planWorkItem(
      'FEAT-AUTH-07',
      { run: true, rootDir: root },
      {
        items: [registerItem],
        rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-cand' }),
        runIsolatedPlanner: async ({ draft }) => {
          // Worker writes an unsourced business outcome not found in approved sources
          const target = path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md');
          fs.writeFileSync(
            target,
            '# FEAT-AUTH-07 — Fixture feature\n\n' +
              '## Control\n\n| Status | `DRAFT` |\n\n' +
              '## Business outcome\n\n> Invented outcome not in sources\n\n' +
              '## Source references\n\n- `docs/unapproved.md`\n\n' +
              '## Preconditions and dependencies\n\n- none\n\n' +
              '## Author boundary\n\n- none\n\n' +
              '## In scope\n\n- none\n\n' +
              '## Out of scope\n\n- none\n\n' +
              '## Business rules and edge cases\n\n- none\n\n' +
              '## UI states\n\n- none\n\n' +
              '## API, event and data impact\n\n- none\n\n' +
              '## Acceptance matrix\n\n- none\n\n' +
              '## Verification commands\n\n- none\n\n' +
              '## Codex review record\n\n- none\n\n' +
              '## Residual limitations\n\n- none\n\n' +
              '## Open decisions\n\n- None.\n'
          );
          return { success: true };
        },
        reviewPlan: async () => ({ verdict: 'PASS' }),
        mergePlan: async () => {
          mergeCalled = true;
          return { success: true, merged: true };
        },
        runPlanning: async () => ({
          status: 'READY_FOR_AUTHOR',
          governed: true,
          independentReview: 'PASS',
          merged: true,
        }),
      }
    );
    assert.equal(
      mergeCalled,
      false,
      'governed merge must not be called when worker draft fails source validation'
    );
    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason, /approved sources|source/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G3 next --loop validates worker draft against approved sources before governed merge', async () => {
  const root = fixtureRoot('plan-g3-unsourced-loop-');
  try {
    let mergeCalled = false;
    let draftCalled = false;
    const register = [{ work_item_id: 'FEAT-AUTH-07', status: 'BACKLOG', dependencies: '' }];
    const result = await nextLoop(
      { rootDir: root, maxIterations: 1, decisionDir: path.join(root, 'decisions') },
      nextLoopDeps({
        readRegister: () => register.map((item) => ({ ...item })),
        planningDeps: {
          draftWorkItem: (id, opts, d) => {
            draftCalled = true;
            return draftWorkItem(id, opts, d);
          },
          rankPlanner: async () => ({ eligible: true, candidateKey: 'planner-cand' }),
          runIsolatedPlanner: async () => {
            const target = path.join(root, 'docs', 'product-spec', 'work-items', 'FEAT-AUTH-07.md');
            fs.writeFileSync(
              target,
              '# FEAT-AUTH-07 — Fixture feature\n\n' +
                '## Control\n\n| Status | `DRAFT` |\n\n' +
                '## Business outcome\n\n> Invented unsourced claim\n\n' +
                '## Source references\n\n- `docs/unapproved.md`\n\n' +
                '## Preconditions and dependencies\n\n- none\n\n' +
                '## Author boundary\n\n- none\n\n' +
                '## In scope\n\n- none\n\n' +
                '## Out of scope\n\n- none\n\n' +
                '## Business rules and edge cases\n\n- none\n\n' +
                '## UI states\n\n- none\n\n' +
                '## API, event and data impact\n\n- none\n\n' +
                '## Acceptance matrix\n\n- none\n\n' +
                '## Verification commands\n\n- none\n\n' +
                '## Codex review record\n\n- none\n\n' +
                '## Residual limitations\n\n- none\n\n' +
                '## Open decisions\n\n- None.\n'
            );
            return { success: true };
          },
          reviewPlan: async () => ({ verdict: 'PASS' }),
          mergePlan: async () => {
            mergeCalled = true;
            register[0].status = 'READY_FOR_AUTHOR';
            return { merged: true };
          },
          runPlanning: async () => ({
            status: 'READY_FOR_AUTHOR',
            governed: true,
            independentReview: 'PASS',
            merged: true,
          }),
        },
      })
    );
    assert.equal(draftCalled, true, 'next --loop must call draftWorkItem');
    assert.equal(
      mergeCalled,
      false,
      'governed merge must not be called when worker draft fails source validation'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
