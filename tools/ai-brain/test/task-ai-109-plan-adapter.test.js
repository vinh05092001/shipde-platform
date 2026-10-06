'use strict';

/**
 * Ship Dễ — TASK-AI-109 lane B contract tests:
 * the plan adapter turns a writing-plans style markdown plan into ShipDe Work
 * Item specs that planner.js accepts.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adapter = require('../plan-adapter');
const planner = require('../planner');

const FENCE = '```';

const PLAN = [
  '# Shipment label reprint',
  '',
  'Goal: Let an operator reprint a shipment label without creating a new carrier order.',
  '',
  '## Context',
  'Labels are generated once at booking time.',
  '',
  '## Approach',
  'Add a pure label renderer, then an API route, then the UI action.',
  '',
  '## Task 1: Label renderer',
  'Files: `apps/web/src/labels/render.ts`, `apps/web/src/labels/render.test.ts`',
  '- Render a label from a stored booking snapshot.',
  '- Never call the carrier.',
  'Run: `pnpm vitest run apps/web/src/labels/render.test.ts`',
  '',
  '## Task 2: Reprint API route',
  'Files: `apps/web/src/app/api/labels/reprint/route.ts`, `apps/web/src/app/api/labels/reprint/route.test.ts`',
  'Depends on: Task 1',
  'Risk: tenancy, authorization',
  '- Scope the shipment lookup to the caller tenant.',
  FENCE + 'bash',
  'pnpm vitest run apps/web/src/app/api/labels/reprint/route.test.ts',
  'pnpm typecheck',
  FENCE,
  '',
  '### Task 3: Reprint button',
  'Files: `apps/web/src/components/ReprintButton.tsx`, `apps/web/e2e/reprint.spec.ts`',
  '- Show loading, error and success states.',
  'Run: `pnpm test:e2e apps/web/e2e/reprint.spec.ts`',
  '',
  '## Risks',
  '- A reprint must not create a second carrier order.',
  '- Tenant leakage through shipment id guessing.',
  '',
].join('\n');

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

describe('TASK-AI-109 plan adapter', () => {
  test('PA-R01: parsePlan extracts goal, tasks, files, tests, commands, dependencies, risks', () => {
    const plan = adapter.parsePlan(PLAN);
    assert.equal(
      plan.goal,
      'Let an operator reprint a shipment label without creating a new carrier order.'
    );
    assert.equal(plan.tasks.length, 3);

    const [t1, t2, t3] = plan.tasks;
    assert.equal(t1.title, 'Label renderer');
    assert.deepEqual(t1.files, [
      'apps/web/src/labels/render.ts',
      'apps/web/src/labels/render.test.ts',
    ]);
    assert.deepEqual(t1.tests, ['apps/web/src/labels/render.test.ts']);
    assert.deepEqual(t1.commands, ['pnpm vitest run apps/web/src/labels/render.test.ts']);
    assert.deepEqual(t1.dependsOn, []);

    assert.deepEqual(t2.dependsOn, [1]);
    assert.deepEqual(t2.commands, [
      'pnpm vitest run apps/web/src/app/api/labels/reprint/route.test.ts',
      'pnpm typecheck',
    ]);
    assert.deepEqual(t2.riskDomains, ['tenancy', 'authorization']);

    assert.equal(t3.title, 'Reprint button');
    assert.deepEqual(t3.tests, ['apps/web/e2e/reprint.spec.ts']);
    assert.deepEqual(t3.riskDomains, []);

    assert.deepEqual(plan.risks, [
      'A reprint must not create a second carrier order.',
      'Tenant leakage through shipment id guessing.',
    ]);
  });

  test('PA-R01: a plan with no tasks fails with a named PLAN_PARSE_ERROR', () => {
    let caught = null;
    try {
      adapter.parsePlan('# Plan\n\nGoal: nothing\n\n## Risks\n- none\n');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'must throw');
    assert.equal(caught.code, 'PLAN_PARSE_ERROR');
    assert.equal(caught.name, 'PLAN_PARSE_ERROR');
    assert.equal(
      codeOf(() => adapter.parsePlan('')),
      'PLAN_PARSE_ERROR'
    );
    assert.equal(
      codeOf(() => adapter.parsePlan(null)),
      'PLAN_PARSE_ERROR'
    );
  });

  test('PA-R02: toWorkItemSpecs maps ids, files, dependencies, criteria, verification, risk, budget, forbidden', () => {
    const plan = adapter.parsePlan(PLAN);
    const specs = adapter.toWorkItemSpecs(plan, {
      ids: ['FEAT-LBL-01', 'FEAT-LBL-02', 'FEAT-LBL-03'],
      role: 'author.lowrisk',
      forbidden: ['no schema change'],
    });
    assert.deepEqual(
      specs.map((s) => s.id),
      ['FEAT-LBL-01', 'FEAT-LBL-02', 'FEAT-LBL-03']
    );
    const [s1, s2, s3] = specs;
    assert.equal(s1.role, 'author.lowrisk');
    assert.deepEqual(s1.files, plan.tasks[0].files);
    assert.deepEqual(s1.dependencies, []);
    assert.deepEqual(s2.dependencies, ['FEAT-LBL-01']);
    assert.deepEqual(s3.dependencies, []);
    assert.deepEqual(s1.verification, {
      command: 'pnpm vitest run apps/web/src/labels/render.test.ts',
    });
    assert.deepEqual(s2.verification, {
      command: 'pnpm vitest run apps/web/src/app/api/labels/reprint/route.test.ts',
    });
    assert.ok(s1.acceptanceCriteria.includes('Render a label from a stored booking snapshot.'));
    assert.ok(s1.acceptanceCriteria.some((c) => c.includes('apps/web/src/labels/render.test.ts')));
    assert.deepEqual(s1.riskDomains, []);
    assert.deepEqual(s2.riskDomains, ['tenancy', 'authorization']);
    assert.equal(s1.repairBudget, 2);
    for (const fixed of adapter.SHIPDE_FORBIDDEN) assert.ok(s1.forbidden.includes(fixed));
    assert.ok(s1.forbidden.includes('no schema change'));
    assert.equal(adapter.SHIPDE_FORBIDDEN.length, 5);
    for (const word of ['push', 'merge', 'deletion', 'model selection', 'uncommitted']) {
      assert.ok(
        adapter.SHIPDE_FORBIDDEN.some((f) => f.includes(word)),
        'fixed forbidden list must mention ' + word
      );
    }
  });

  test('PA-R02: idPrefix yields deterministic ids, repairBudget is honoured, no ids is refused', () => {
    const plan = adapter.parsePlan(PLAN);
    const specs = adapter.toWorkItemSpecs(plan, { idPrefix: 'TASK-AI-109', repairBudget: 4 });
    assert.deepEqual(
      specs.map((s) => s.id),
      ['TASK-AI-109-1', 'TASK-AI-109-2', 'TASK-AI-109-3']
    );
    assert.equal(specs[0].repairBudget, 4);
    assert.equal(specs[0].role, 'author.foundation');
    assert.equal(
      codeOf(() => adapter.toWorkItemSpecs(plan, {})),
      'MISSING_IDS'
    );
    assert.equal(
      codeOf(() => adapter.toWorkItemSpecs(plan, { ids: ['ONLY-ONE'] })),
      'ID_COUNT_MISMATCH'
    );
  });

  test('PA-R03: specs pass through planner.plan without error', () => {
    const specs = adapter.toWorkItemSpecs(adapter.parsePlan(PLAN), {
      ids: ['FEAT-LBL-01', 'FEAT-LBL-02', 'FEAT-LBL-03'],
    });
    const result = planner.plan('reprint labels', { specs });
    assert.deepEqual(result.errors, []);
    assert.equal(result.workItems.length, 3);
    assert.deepEqual(result.workItems[1].dependencies, ['FEAT-LBL-01']);
    assert.deepEqual(result.workItems[1].roleRequirement.riskDomains, ['tenancy', 'authorization']);
    assert.equal(
      result.workItems[0].verification.command,
      'pnpm vitest run apps/web/src/labels/render.test.ts'
    );
  });

  test('PA-R03: two independent tasks claiming one file are rejected with OWNERSHIP_CONFLICT', () => {
    const md = [
      '## Task 1: A',
      'Files: `src/shared.ts`, `src/a.test.ts`',
      'Run: `node --test src/a.test.ts`',
      '## Task 2: B',
      'Files: `src/shared.ts`, `src/b.test.ts`',
      'Run: `node --test src/b.test.ts`',
    ].join('\n');
    assert.equal(
      codeOf(() => adapter.toWorkItemSpecs(adapter.parsePlan(md), { idPrefix: 'X' })),
      'OWNERSHIP_CONFLICT'
    );
  });

  test('PA-R03: a shared file is allowed when one task (transitively) depends on the other', () => {
    const md = [
      '## Task 1: A',
      'Files: `src/shared.ts`, `src/a.test.ts`',
      'Run: `node --test src/a.test.ts`',
      '## Task 2: B',
      'Files: `src/b.ts`, `src/b.test.ts`',
      'Depends on: Task 1',
      'Run: `node --test src/b.test.ts`',
      '## Task 3: C',
      'Files: `src/shared.ts`, `src/c.test.ts`',
      'Depends on: Task 2',
      'Run: `node --test src/c.test.ts`',
    ].join('\n');
    const specs = adapter.toWorkItemSpecs(adapter.parsePlan(md), { idPrefix: 'X' });
    assert.ok(specs[0].files.includes('src/shared.ts'));
    assert.ok(!specs[2].files.includes('src/shared.ts'));
    assert.ok(specs[2].allowedPaths.includes('src/shared.ts'));
    const result = planner.plan('g', { specs });
    assert.deepEqual(result.errors, []);
  });

  test('PA-R04: a task without a test or verification command is rejected with MISSING_VERIFICATION', () => {
    const md = [
      '## Task 1: A',
      'Files: `src/a.ts`, `src/a.test.ts`',
      'Run: `node --test src/a.test.ts`',
      '## Task 2: B',
      'Files: `src/b.ts`',
      '- Do something untested.',
    ].join('\n');
    const plan = adapter.parsePlan(md);
    assert.equal(
      codeOf(() => adapter.toWorkItemSpecs(plan, { idPrefix: 'X' })),
      'MISSING_VERIFICATION'
    );
  });

  test('PA-R05: the module is pure (no I/O, network, process or model imports)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'plan-adapter.js'), 'utf8');
    const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    assert.deepEqual(requires, []);
    for (const banned of ['process.', 'fetch(', 'import(']) {
      assert.ok(!src.includes(banned), 'plan-adapter.js must not use ' + banned);
    }
    const plan = adapter.parsePlan(PLAN);
    const frozen = JSON.stringify(plan);
    adapter.toWorkItemSpecs(plan, { idPrefix: 'P' });
    assert.equal(JSON.stringify(plan), frozen, 'input plan must not be mutated');
  });
});
