'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { executePlan, resolveRoute, workerName, Outcome } = require('../executor');
const { loadSources } = require('../sources');
const { recordDecision, Stage } = require('../decisions');

const registry = loadSources();

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-exec-'));
}

function assignment(over) {
  return Object.assign(
    {
      workItemId: 'TASK-AI-99',
      role: 'author.foundation',
      branch: 'feat/task-ai-99-x',
      accountId: 'ninerouter',
      provider: 'oc',
      model: 'kr/claude-sonnet-4.5-agentic',
      alternatives: ['other::model'],
    },
    over || {}
  );
}

function plan(assignments, maxImplementation) {
  return {
    assignments,
    deferred: [{ workItemId: 'TASK-AI-98', reason: 'NO_CAPACITY' }],
    utilisation: { maxImplementation: maxImplementation === undefined ? 2 : maxImplementation },
  };
}

/** A harness runner that answers like Paseo without starting anything. */
function fakeRun(responses) {
  const calls = [];
  let i = 0;
  const run = (adapter, args) => {
    calls.push({ command: adapter.command, args });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (typeof next === 'function') return next();
    return next;
  };
  run.calls = calls;
  return run;
}

const ok = (id) => ({
  exitCode: 0,
  stdout: 'starting agent…\n{"id":"' + id + '","status":"running"}\n',
  stderr: '',
});

describe('executePlan — launching', () => {
  test('defaults to dry run and starts nothing', () => {
    const run = fakeRun([ok('a')]);
    const result = executePlan(plan([assignment()]), { registry, run, decisionDir: tempDir() });
    assert.equal(result.dryRun, true);
    assert.equal(run.calls.length, 0);
    assert.equal(result.records[0].outcome, Outcome.DRY_RUN);
  });

  test('launches once per assignment and records the session id', () => {
    const dir = tempDir();
    const run = fakeRun([ok('sess-1')]);
    const result = executePlan(plan([assignment()]), {
      registry,
      run,
      dryRun: false,
      decisionDir: dir,
    });
    assert.equal(run.calls.length, 1);
    assert.equal(result.records[0].outcome, Outcome.LAUNCHED);
    assert.equal(result.records[0].sessionId, 'sess-1');
    assert.equal(result.summary.launched, 1);
  });

  test('the argument vector is a Paseo run with an explicit model and full access', () => {
    const run = fakeRun([ok('sess-2')]);
    executePlan(plan([assignment()]), { registry, run, dryRun: false, decisionDir: tempDir() });
    const { command, args } = run.calls[0];
    assert.equal(command, 'paseo');
    assert.equal(args[0], 'run');
    // The registry rewrites the model for the harness that will receive it:
    // OpenCode without an explicit ninerouter/ model silently uses a dead default.
    assert.equal(args[args.indexOf('--model') + 1], 'ninerouter/kr/claude-sonnet-4.5-agentic');
    assert.equal(args[args.indexOf('--provider') + 1], 'opencode');
    assert.equal(args[args.indexOf('--mode') + 1], 'full-access');
    assert.equal(args[args.indexOf('--new-branch') + 1], 'feat/task-ai-99-x');
    // The prompt is the last argument and stays one argument.
    assert.ok(args[args.length - 1].includes('TASK-AI-99'));
  });

  test('nothing is dispatched to the retired AO harness', () => {
    const run = fakeRun([ok('x')]);
    const result = executePlan(plan([assignment({ harness: 'ao' })]), {
      registry,
      run,
      dryRun: false,
      decisionDir: tempDir(),
    });
    assert.equal(result.records[0].outcome, Outcome.REFUSED);
    assert.match(result.records[0].detail, /RETIRED_HARNESS/);
    assert.equal(run.calls.length, 0);
  });

  test('deferred entries and alternatives are never launched', () => {
    const run = fakeRun([ok('sess-3')]);
    executePlan(plan([assignment()]), { registry, run, dryRun: false, decisionDir: tempDir() });
    assert.equal(run.calls.length, 1);
    assert.ok(!JSON.stringify(run.calls[0].args).includes('TASK-AI-98'));
  });
});

describe('executePlan — one writer', () => {
  test('a duplicate writer on the same work item is refused before the harness', () => {
    const run = fakeRun([ok('s1'), ok('s2')]);
    const result = executePlan(plan([assignment(), assignment()]), {
      registry,
      run,
      dryRun: false,
      decisionDir: tempDir(),
    });
    assert.equal(result.records[1].outcome, Outcome.REFUSED);
    assert.equal(result.records[1].detail, 'DUPLICATE_WRITER');
    assert.equal(run.calls.length, 1);
  });

  test('a review of the same item is not a duplicate writer', () => {
    const run = fakeRun([ok('s1'), ok('s2')]);
    const result = executePlan(plan([assignment(), assignment({ role: 'reviewer.primary' })]), {
      registry,
      run,
      dryRun: false,
      decisionDir: tempDir(),
    });
    assert.equal(result.records[1].outcome, Outcome.LAUNCHED);
  });

  test('two independent work items run in parallel under a ceiling of two', () => {
    const run = fakeRun([ok('s1'), ok('s2')]);
    const result = executePlan(
      plan([
        assignment({ workItemId: 'TASK-AI-90', branch: 'feat/a' }),
        assignment({ workItemId: 'TASK-AI-91', branch: 'feat/b' }),
      ]),
      { registry, run, dryRun: false, decisionDir: tempDir() }
    );
    assert.equal(result.summary.launched, 2);
    assert.equal(run.calls.length, 2);
  });

  test('implementation beyond the plan ceiling is refused', () => {
    const run = fakeRun([ok('s1'), ok('s2')]);
    const result = executePlan(
      plan(
        [
          assignment({ workItemId: 'TASK-AI-90', branch: 'feat/a' }),
          assignment({ workItemId: 'TASK-AI-91', branch: 'feat/b' }),
        ],
        1
      ),
      { registry, run, dryRun: false, decisionDir: tempDir() }
    );
    assert.equal(result.records[1].detail, 'IMPLEMENTATION_CEILING');
    assert.equal(run.calls.length, 1);
  });
});

describe('executePlan — recovery after an interruption', () => {
  test('an open writer is resumed on its own session, not launched again', () => {
    const dir = tempDir();
    recordDecision(
      {
        stage: Stage.LAUNCHED,
        workItemId: 'TASK-AI-99',
        role: 'author.foundation',
        harness: 'paseo',
        sessionId: 'sess-old',
        branch: 'feat/task-ai-99-x',
      },
      { dir }
    );

    const run = fakeRun([{ exitCode: 0, stdout: '{"ok":true}', stderr: '' }]);
    const result = executePlan(plan([assignment()]), {
      registry,
      run,
      dryRun: false,
      decisionDir: dir,
    });

    assert.equal(result.records[0].outcome, Outcome.RESUMED);
    assert.equal(result.records[0].sessionId, 'sess-old');
    assert.equal(run.calls[0].args[0], 'send');
    assert.equal(run.calls[0].args[1], 'sess-old');
    // Resuming must not create another branch: the commits are already there.
    assert.ok(!run.calls[0].args.includes('--new-branch'));
  });

  test('a finished work item is claimed fresh', () => {
    const dir = tempDir();
    recordDecision(
      { stage: Stage.LAUNCHED, workItemId: 'TASK-AI-99', sessionId: 'sess-old' },
      { dir }
    );
    recordDecision({ stage: Stage.COMPLETED, workItemId: 'TASK-AI-99' }, { dir });

    const run = fakeRun([ok('sess-new')]);
    const result = executePlan(plan([assignment()]), {
      registry,
      run,
      dryRun: false,
      decisionDir: dir,
    });
    assert.equal(result.records[0].outcome, Outcome.LAUNCHED);
    assert.equal(result.records[0].sessionId, 'sess-new');
  });

  test('a harness that cannot resume refuses rather than starting a second writer', () => {
    const dir = tempDir();
    recordDecision(
      { stage: Stage.LAUNCHED, workItemId: 'TASK-AI-99', harness: 'cline', sessionId: 'n/a' },
      { dir }
    );
    const run = fakeRun([ok('x')]);
    const result = executePlan(plan([assignment({ harness: 'cline' })]), {
      registry,
      run,
      dryRun: false,
      decisionDir: dir,
    });
    assert.equal(result.records[0].outcome, Outcome.REFUSED);
    assert.match(result.records[0].detail, /WRITER_OPEN_ELSEWHERE/);
    assert.equal(run.calls.length, 0);
  });
});

describe('executePlan — failures are failures', () => {
  const cases = [
    ['non-zero exit', { exitCode: 1, stdout: '', stderr: 'boom' }, /HARNESS_NONZERO_EXIT/],
    ['empty stdout', { exitCode: 0, stdout: '   ', stderr: '' }, /HARNESS_EMPTY_STDOUT/],
    [
      'invalid json',
      { exitCode: 0, stdout: 'not json at all', stderr: '' },
      /HARNESS_INVALID_JSON/,
    ],
    [
      'no session id',
      { exitCode: 0, stdout: '{"status":"running"}', stderr: '' },
      /HARNESS_NO_SESSION_ID/,
    ],
  ];
  for (const [label, response, pattern] of cases) {
    test(label + ' is FAILED, not LAUNCHED', () => {
      const run = fakeRun([response]);
      const result = executePlan(plan([assignment()]), {
        registry,
        run,
        dryRun: false,
        decisionDir: tempDir(),
      });
      assert.equal(result.records[0].outcome, Outcome.FAILED);
      assert.match(result.records[0].detail, pattern);
    });
  }

  test('a throwing runner fails closed', () => {
    const run = fakeRun([
      () => {
        throw new Error('spawn ENOENT');
      },
    ]);
    const result = executePlan(plan([assignment()]), {
      registry,
      run,
      dryRun: false,
      decisionDir: tempDir(),
    });
    assert.equal(result.records[0].outcome, Outcome.FAILED);
  });

  test('a prompt with shell metacharacters stays one argument', () => {
    const run = fakeRun([ok('s')]);
    executePlan(plan([assignment()]), {
      registry,
      run,
      dryRun: false,
      decisionDir: tempDir(),
      promptFor: () => 'rm -rf / && echo "; $(whoami)"',
    });
    const args = run.calls[0].args;
    assert.equal(args[args.length - 1], 'rm -rf / && echo "; $(whoami)"');
  });

  test('the plan is not mutated', () => {
    const p = plan([assignment()]);
    const before = JSON.stringify(p);
    executePlan(p, { registry, run: fakeRun([ok('s')]), dryRun: false, decisionDir: tempDir() });
    assert.equal(JSON.stringify(p), before);
  });
});

describe('resolveRoute', () => {
  test('an unknown provider resolves to nothing rather than a guess', () => {
    assert.equal(resolveRoute({ provider: 'somebody-new' }, {}, registry), null);
  });

  test('the registry decides the harness, the provider name and the model spelling', () => {
    const route = resolveRoute(
      { provider: 'antigravity', model: 'claude-sonnet-4-6' },
      {},
      registry
    );
    assert.equal(route.harnessName, 'paseo');
    assert.equal(route.provider, 'opencode');
    assert.equal(route.model, 'ninerouter/ag/claude-sonnet-4-6');
  });

  test('a prefix already present is not applied twice', () => {
    const route = resolveRoute({ provider: 'oc', model: 'ninerouter/gh/gpt-4.1' }, {}, registry);
    assert.equal(route.model, 'ninerouter/gh/gpt-4.1');
  });
});

describe('workerName', () => {
  test('stays within the 20-character limit', () => {
    assert.ok(workerName('TASK-FOUND-02-LONG-NAME').length <= 20);
  });
});
