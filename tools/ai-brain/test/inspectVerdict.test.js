'use strict';
const { executePlan, inspectVerdict, Outcome } = require('../executor');
const { recordDecision, Stage } = require('../decisions');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

test('inspectVerdict returns STALLED when progress indicates stalled', () => {
  const res = { exitCode: 0, stdout: JSON.stringify({ progress: 'stalled' }) };
  const verdict = inspectVerdict(res);
  assert.strictEqual(verdict, 'stalled');
});

test('inspectVerdict returns UNKNOWN when no forward flags present', () => {
  const res = { exitCode: 0, stdout: JSON.stringify({}) };
  const verdict = inspectVerdict(res);
  assert.strictEqual(verdict, 'unknown');
});

test('inspectVerdict falls back to ALIVE for non‑JSON output', () => {
  const res = { exitCode: 0, stdout: 'some text output' };
  const verdict = inspectVerdict(res);
  assert.strictEqual(verdict, 'alive');
});

test('inspectVerdict extracts stalled cause from error or cause field', () => {
  const res = {
    exitCode: 0,
    stdout: JSON.stringify({ progress: 'stalled', error: 'Unavailable (reset after 151h)' }),
  };
  const verdict = inspectVerdict(res);
  assert.strictEqual(verdict, 'stalled');
  assert.strictEqual(res.cause, 'Unavailable (reset after 151h)');
});

test('executePlan refuses a stalled session and records repeated error as cause', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-stall-'));
  try {
    recordDecision(
      {
        stage: Stage.LAUNCHED,
        workItemId: 'TASK-AI-50',
        role: 'author.foundation',
        harness: 'hermes',
        sessionId: 'dir:C:/w',
        pid: 4242,
        branch: 'feat/task-ai-50-x',
      },
      { dir }
    );

    const run = (adapter, args, opts) => {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ progress: 'stalled', error: 'Unavailable (reset after 151h)' }),
        stderr: '',
      };
    };

    const plan = {
      assignments: [
        {
          workItemId: 'TASK-AI-50',
          branch: 'feat/task-ai-50-x',
          harness: 'hermes',
          provider: 'hermes',
          model: 'big',
          contextWindow: 200000,
        },
      ],
      utilisation: { maxImplementation: 1 },
    };

    const result = executePlan(plan, {
      run,
      dryRun: false,
      decisionDir: dir,
      cwd: 'C:/w',
    });

    assert.strictEqual(result.records[0].outcome, Outcome.REFUSED);
    assert.match(result.records[0].detail, /WRITER_SESSION_STALLED/);
    assert.match(result.records[0].detail, /Unavailable \(reset after 151h\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('executePlan calls progress probe alongside inspect and refuses when stalled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-prog-'));
  try {
    recordDecision(
      {
        stage: Stage.LAUNCHED,
        workItemId: 'TASK-AI-50',
        role: 'author.foundation',
        harness: 'hermes',
        sessionId: 'dir:C:/w',
        pid: 4242,
        branch: 'feat/task-ai-50-x',
      },
      { dir }
    );

    const run = (adapter, args, opts) => {
      return {
        exitCode: 0,
        stdout: 'Title  Workspace  Last Active  ID\nRow  shipde  now  ' + 'x'.repeat(12) + '\n',
        stderr: '',
      };
    };

    const plan = {
      assignments: [
        {
          workItemId: 'TASK-AI-50',
          branch: 'feat/task-ai-50-x',
          harness: 'hermes',
          provider: 'hermes',
          model: 'big',
          contextWindow: 200000,
        },
      ],
      utilisation: { maxImplementation: 1 },
    };

    const result = executePlan(plan, {
      run,
      dryRun: false,
      decisionDir: dir,
      cwd: 'C:/w',
      progressProbe: () => ({ progress: 'stalled', cause: 'retry limit exceeded' }),
    });

    assert.strictEqual(result.records[0].outcome, Outcome.REFUSED);
    assert.match(result.records[0].detail, /WRITER_SESSION_STALLED: retry limit exceeded/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
