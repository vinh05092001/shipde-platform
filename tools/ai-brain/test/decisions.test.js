'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  recordDecision,
  readDecisions,
  readDecisionsSafe,
  openWriters,
  writerFor,
  closeWriter,
  openWritersDetailed,
  scrub,
  Stage,
} = require('../decisions');
const { resourceCeiling } = require('../scheduler');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-dec-'));
}

describe('decision log', () => {
  test('a decision is written with everything needed to explain it later', () => {
    const dir = tempDir();
    recordDecision(
      {
        stage: Stage.SELECTED,
        workItemId: 'TASK-AI-49',
        role: 'author.foundation',
        candidates: ['a::m1', 'b::m2'],
        rejected: [{ offeringId: 'b::m2', reason: 'cooling until 14:00' }],
        chosen: 'a::m1',
        harness: 'paseo',
      },
      { dir }
    );
    const [record] = readDecisions({ dir });
    assert.equal(record.workItemId, 'TASK-AI-49');
    assert.equal(record.chosen, 'a::m1');
    assert.equal(record.rejected[0].reason, 'cooling until 14:00');
    assert.ok(record.at);
  });

  test('a credential never reaches the log, however deeply it is passed', () => {
    const dir = tempDir();
    recordDecision(
      {
        workItemId: 'X',
        candidates: [
          { offeringId: 'a::m', account: { id: 'a', apiKey: 'sk-live-do-not-write-this' } },
        ],
      },
      { dir }
    );
    const raw = fs.readFileSync(fs.readdirSync(dir).map((f) => path.join(dir, f))[0], 'utf8');
    assert.ok(!raw.includes('sk-live-do-not-write-this'));
    assert.ok(raw.includes('[redacted]'));
  });

  test('a half-written last line is skipped, not fatal', () => {
    const dir = tempDir();
    recordDecision({ workItemId: 'A' }, { dir });
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    fs.appendFileSync(file, '{"workItemId":"B","at":', 'utf8');
    const records = readDecisions({ dir });
    assert.equal(records.length, 1);
    assert.equal(records[0].workItemId, 'A');
  });

  test('a missing directory is an empty history, not an error', () => {
    assert.deepEqual(
      readDecisions({ dir: path.join(os.tmpdir(), 'shipde-nope-' + Date.now()) }),
      []
    );
  });

  test('readDecisionsSafe throws on a damaged log', () => {
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    // A broken line followed by a good one cannot be a half-written append.
    fs.appendFileSync(
      file,
      '{\"workItemId\":\"B\"\n{\"stage\":\"launched\",\"workItemId\":\"C\"}\n',
      'utf8'
    );
    assert.throws(() => readDecisionsSafe({ dir }), { code: 'DECISION_LOG_UNREADABLE' });
  });

  test('readDecisionsSafe returns empty array for a missing directory (fresh machine)', () => {
    const records = readDecisionsSafe({ dir: path.join(os.tmpdir(), 'shipde-nope-' + Date.now()) });
    assert.deepEqual(records, []);
  });

  test('readDecisionsSafe returns records on a clean log', () => {
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    const records = readDecisionsSafe({ dir });
    assert.equal(records.length, 1);
    assert.equal(records[0].workItemId, 'A');
  });
});

describe('open writers', () => {
  test('a launched item holds its branch until something ends it', () => {
    const dir = tempDir();
    recordDecision(
      {
        stage: Stage.LAUNCHED,
        workItemId: 'A',
        sessionId: 's1',
        branch: 'feat/a',
        harness: 'paseo',
      },
      { dir }
    );
    const writer = writerFor('A', { dir });
    assert.equal(writer.sessionId, 's1');
    assert.equal(writer.branch, 'feat/a');
  });

  test('completed and failed both release the claim', () => {
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'B', sessionId: 's2' }, { dir });
    recordDecision({ stage: Stage.COMPLETED, workItemId: 'A' }, { dir });
    recordDecision({ stage: Stage.FAILED, workItemId: 'B' }, { dir });
    assert.deepEqual(openWriters({ dir }), []);
  });

  test('a resume keeps the same claim rather than adding one', () => {
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    recordDecision({ stage: Stage.RESUMED, workItemId: 'A', sessionId: 's1' }, { dir });
    const open = openWriters({ dir });
    assert.equal(open.length, 1);
    assert.equal(open[0].sessionId, 's1');
  });

  test('a refusal is recorded but claims nothing', () => {
    const dir = tempDir();
    recordDecision(
      { stage: Stage.REFUSED, workItemId: 'A', detail: 'IMPLEMENTATION_CEILING' },
      { dir }
    );
    assert.deepEqual(openWriters({ dir }), []);
    assert.equal(readDecisions({ dir }).length, 1);
  });
});

describe('closing a writer', () => {
  test('a stopped session releases its work item', () => {
    const dir = tempDir();
    recordDecision(
      {
        stage: Stage.LAUNCHED,
        workItemId: 'A',
        sessionId: 's1',
        branch: 'feat/a',
        harness: 'paseo',
      },
      { dir }
    );
    const released = closeWriter('A', 'failed', { dir, detail: 'interrupted by the operator' });
    assert.equal(released.sessionId, 's1');
    assert.equal(released.stage, Stage.FAILED);
    assert.deepEqual(openWriters({ dir }), []);
  });

  test('closing twice is harmless', () => {
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    closeWriter('A', 'completed', { dir });
    assert.equal(closeWriter('A', 'completed', { dir }), null);
  });

  test('a released item can be claimed again', () => {
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    closeWriter('A', 'failed', { dir });
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's2' }, { dir });
    assert.equal(writerFor('A', { dir }).sessionId, 's2');
  });
});

describe('scrub', () => {
  test('an empty secret is null, not the string "[redacted]"', () => {
    assert.equal(scrub({ token: '' }).token, null);
  });

  test('ordinary fields survive untouched', () => {
    assert.deepEqual(scrub({ model: 'gpt-4.1', nested: { grade: 3 } }), {
      model: 'gpt-4.1',
      nested: { grade: 3 },
    });
  });
});

describe('resource ceiling', () => {
  test('free memory lowers the ceiling and says so', () => {
    // 350 MB per agent, 2 GB reserved for the daemons and the editor.
    assert.equal(resourceCeiling({ freeMb: 4700 }).allowed, 7);
    assert.equal(resourceCeiling({ freeMb: 2400 }).allowed, 1);
  });

  test('a machine with no room allows nothing and names the limit', () => {
    const r = resourceCeiling({ freeMb: 2048 });
    assert.equal(r.allowed, 0);
    assert.equal(r.limiting, 'ram');
  });

  test('an unmeasurable machine has no opinion rather than refusing everything', () => {
    assert.equal(resourceCeiling({ freeMb: 'not a number' }).allowed, null);
  });
});

describe('an unreadable log is unknown, not empty', () => {
  test('a directory that never existed is an empty history', () => {
    // The first dispatch on a fresh machine must not be refused because
    // nothing has been decided yet.
    const state = openWritersDetailed({
      dir: path.join(os.tmpdir(), 'shipde-never-' + Date.now()),
    });
    assert.deepEqual(state.writers, []);
    assert.equal(state.readable, true);
  });

  test('a file that cannot be parsed in the middle is damage, not interruption', () => {
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    // A broken line followed by a good one cannot be a half-written append.
    fs.appendFileSync(file, '{"workItemId":"B"\n{"stage":"launched","workItemId":"C"}\n', 'utf8');
    const state = openWritersDetailed({ dir });
    assert.equal(state.readable, false);
    assert.ok(state.damaged.length > 0);
  });

  test('a truncated final line is still a readable log', () => {
    // This is the normal shape of a file whose writer was killed mid-append,
    // and every complete line before it is still evidence.
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'A', sessionId: 's1' }, { dir });
    fs.appendFileSync(path.join(dir, fs.readdirSync(dir)[0]), '{"workItemId":"B","at":', 'utf8');
    const state = openWritersDetailed({ dir });
    assert.equal(state.readable, true);
    assert.equal(state.writers.length, 1);
  });

  test('the executor refuses to write when the log cannot be trusted', () => {
    const { executePlan, Outcome } = require('../executor');
    const { loadSources } = require('../sources');
    const dir = tempDir();
    recordDecision({ stage: Stage.LAUNCHED, workItemId: 'Z', sessionId: 's1' }, { dir });
    fs.appendFileSync(
      path.join(dir, fs.readdirSync(dir)[0]),
      'not json at all\n{"stage":"x"}\n',
      'utf8'
    );

    const calls = [];
    const plan = {
      assignments: [
        {
          workItemId: 'TASK-AI-49',
          role: 'author.foundation',
          branch: 'feat/x',
          accountId: 'ninerouter',
          provider: 'oc',
          model: 'groq/openai/gpt-oss-120b',
        },
        {
          workItemId: 'TASK-AI-49',
          role: 'reviewer.primary',
          branch: 'feat/x',
          accountId: 'ninerouter',
          provider: 'oc',
          model: 'groq/openai/gpt-oss-120b',
        },
      ],
      deferred: [],
      utilisation: { maxImplementation: 2 },
    };
    const result = executePlan(plan, {
      registry: loadSources(),
      dryRun: false,
      decisionDir: dir,
      run: (adapter, args) => {
        calls.push(args);
        return { exitCode: 0, stdout: '{"id":"s2"}', stderr: '' };
      },
    });

    assert.equal(result.records[0].outcome, Outcome.REFUSED);
    assert.match(result.records[0].detail, /DECISION_LOG_UNREADABLE/);
    // A review claims no branch, so losing the log does not stop it.
    assert.equal(result.records[1].outcome, Outcome.LAUNCHED);
    assert.equal(calls.length, 1);
  });
});
