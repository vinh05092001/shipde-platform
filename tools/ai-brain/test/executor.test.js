'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  executePlan,
  buildSpawnArgs,
  sessionIdFromResponse,
  workerName,
  Outcome,
} = require('../executor');

function assignment(over) {
  return Object.assign(
    {
      workItemId: 'TASK-AI-99',
      role: 'author.foundation',
      branch: 'feat/task-ai-99-x',
      accountId: 'agy-a',
      provider: 'antigravity',
      model: 'gemini-pro',
      alternatives: ['other::model'],
    },
    over || {}
  );
}

function plan(assignments, over) {
  return Object.assign(
    {
      assignments,
      deferred: [{ workItemId: 'TASK-AI-98', reason: 'IMPLEMENTATION_LIMIT' }],
      utilisation: { maxImplementation: 1 },
    },
    over || {}
  );
}

function stub(response) {
  const calls = [];
  const runAo = (args) => {
    calls.push(args);
    return typeof response === 'function' ? response(args) : response;
  };
  return { calls, runAo };
}

const OK = { exitCode: 0, stdout: JSON.stringify({ session: { id: 's-1' } }), stderr: '' };

describe('executePlan', () => {
  test('defaults to dry run and never calls AO', () => {
    const s = stub(OK);
    const result = executePlan(plan([assignment()]), { runAo: s.runAo });
    assert.equal(s.calls.length, 0);
    assert.equal(result.records[0].outcome, Outcome.DRY_RUN);
    assert.equal(result.records[0].args[0], 'spawn');
  });

  test('execute launches once per assignment and records the session id', () => {
    const s = stub(OK);
    const result = executePlan(plan([assignment()]), { runAo: s.runAo, dryRun: false });
    assert.equal(s.calls.length, 1);
    assert.equal(result.records[0].outcome, Outcome.LAUNCHED);
    assert.equal(result.records[0].sessionId, 's-1');
    assert.equal(result.records[0].offeringId, 'agy-a::gemini-pro');
    assert.deepEqual(result.summary, { launched: 1, refused: 0, failed: 0 });
  });

  test('argument vector matches New-ShipDeAoSpawnArguments', () => {
    const s = stub(OK);
    executePlan(plan([assignment()]), {
      runAo: s.runAo,
      dryRun: false,
      promptFor: () => 'do it',
    });
    assert.deepEqual(s.calls[0], [
      'spawn',
      '--project',
      'shipde-platform',
      '--kind',
      'worker',
      '--name',
      'task-ai-99-worker',
      '--mode',
      'tui',
      '--branch',
      'feat/task-ai-99-x',
      '--harness',
      'agy',
      '--prompt',
      'do it',
    ]);
    assert.equal(
      buildSpawnArgs({
        project: 'p',
        name: 'n',
        harness: 'claude-code',
        branch: 'b',
        prompt: 'x',
      })[8],
      'chat'
    );
    assert.equal(workerName('TASK-AI-100-LONGNAME').length, 20);
  });

  test('deferred entries and alternatives are never launched', () => {
    const s = stub(OK);
    executePlan(plan([]), { runAo: s.runAo, dryRun: false });
    assert.equal(s.calls.length, 0);
  });

  test('duplicate writer on the same work item or branch is refused before AO', () => {
    const s = stub(OK);
    const result = executePlan(
      plan(
        [
          assignment({ role: 'author.lowrisk' }),
          assignment({ workItemId: 'TASK-AI-97', role: 'research.x' }),
        ],
        { utilisation: { maxImplementation: 5 } }
      ),
      { runAo: s.runAo, dryRun: false }
    );
    assert.equal(s.calls.length, 1);
    assert.equal(result.records[1].outcome, Outcome.REFUSED);
    assert.equal(result.records[1].detail, 'DUPLICATE_WRITER');
  });

  test('a review of the same item is not a duplicate writer', () => {
    const s = stub(OK);
    const result = executePlan(plan([assignment(), assignment({ role: 'reviewer.primary' })]), {
      runAo: s.runAo,
      dryRun: false,
    });
    assert.equal(result.summary.launched, 2);
  });

  test('implementation beyond the plan ceiling is refused', () => {
    const s = stub(OK);
    const result = executePlan(
      plan([assignment(), assignment({ workItemId: 'TASK-AI-96', branch: 'feat/other' })]),
      { runAo: s.runAo, dryRun: false }
    );
    assert.equal(s.calls.length, 1);
    assert.equal(result.records[1].detail, 'IMPLEMENTATION_CEILING');
  });

  test('incomplete assignments are refused before AO', () => {
    const s = stub(OK);
    const result = executePlan(
      plan(
        [
          assignment({ branch: null }),
          assignment({ workItemId: null, branch: 'b2' }),
          assignment({ workItemId: 'W3', branch: 'b3', provider: 'unknown' }),
        ],
        { utilisation: { maxImplementation: 9 } }
      ),
      { runAo: s.runAo, dryRun: false }
    );
    assert.equal(s.calls.length, 0);
    for (const r of result.records) assert.equal(r.detail, 'INCOMPLETE_ASSIGNMENT');
  });

  for (const [label, res] of [
    ['non-zero exit', { exitCode: 3, stdout: '{"id":"x"}', stderr: 'boom' }],
    ['empty stdout', { exitCode: 0, stdout: '', stderr: '' }],
    ['invalid json', { exitCode: 0, stdout: 'not json', stderr: '' }],
    ['missing id', { exitCode: 0, stdout: '{"status":"ok"}', stderr: '' }],
  ]) {
    test('AO failure is FAILED, not LAUNCHED: ' + label, () => {
      const s = stub(res);
      const result = executePlan(plan([assignment()]), { runAo: s.runAo, dryRun: false });
      assert.equal(result.records[0].outcome, Outcome.FAILED);
      assert.equal(result.records[0].sessionId, null);
      assert.match(result.records[0].detail, /exit/);
      assert.equal(s.calls.length, 1);
    });
  }

  test('a throwing runAo fails closed', () => {
    const result = executePlan(plan([assignment()]), {
      dryRun: false,
      runAo: () => {
        throw new Error('ENOENT');
      },
    });
    assert.equal(result.records[0].outcome, Outcome.FAILED);
  });

  test('prompts with shell metacharacters stay one argument', () => {
    const s = stub(OK);
    const prompt = 'a "b" | rm -rf / ; & c';
    executePlan(plan([assignment()]), { runAo: s.runAo, dryRun: false, promptFor: () => prompt });
    assert.equal(s.calls[0][s.calls[0].length - 1], prompt);
    assert.equal(s.calls[0].length, 15);
  });

  test('the plan is not mutated', () => {
    const p = plan([assignment()]);
    const before = JSON.stringify(p);
    executePlan(p, { runAo: stub(OK).runAo, dryRun: false });
    assert.equal(JSON.stringify(p), before);
  });
});

describe('sessionIdFromResponse', () => {
  test('accepts the control.ps1 shapes', () => {
    assert.equal(sessionIdFromResponse({ id: 'a' }), 'a');
    assert.equal(sessionIdFromResponse({ sessionId: 'b' }), 'b');
    assert.equal(sessionIdFromResponse({ session_id: 'c' }), 'c');
    assert.equal(sessionIdFromResponse({ session: { id: 'd' } }), 'd');
    assert.equal(sessionIdFromResponse({ data: { session: { sessionId: 'e' } } }), 'e');
    assert.equal(sessionIdFromResponse({ result: { id: 'f' } }), 'f');
  });

  test('rejects responses without an id', () => {
    assert.equal(sessionIdFromResponse({}), null);
    assert.equal(sessionIdFromResponse(null), null);
    assert.equal(sessionIdFromResponse({ id: '  ' }), null);
    assert.equal(sessionIdFromResponse([]), null);
  });
});
