'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { captureIntakeStderr } = require('../intake');
const decisions = require('../decisions');

test('H3 child stderr keeps the final 40 lines including late close output, redacted', async () => {
  const result = {
    child: spawn(
      process.execPath,
      [
        '-e',
        "for(let i=0;i<60;i++) process.stderr.write('line '+i+'\\n'); process.stderr.write('Bearer fixture-secret\\napi_key=plain-secret\\n{\"token\":\"json-secret\"}\\nlast error'); process.exitCode=1;",
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    ),
  };
  captureIntakeStderr(result);
  await new Promise((resolve) => result.child.on('close', resolve));
  assert.equal(result.stderrTail.trimEnd().split('\n').length, 40);
  assert.match(result.stderrTail, /last error/);
  assert.doesNotMatch(result.stderrTail, /fixture-secret|plain-secret|json-secret|line 0\n/);
  assert.match(result.stderrTail, /REDACTED_SECRET/);
});

test('H3 decision reader never reads a whole daily file and preserves UTF-8 and corruption rules', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-decisions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, '2026-10-13.jsonl');
  const entry = { stage: 'launched', workItemId: 'GOAL-H3', detail: 'x'.repeat(65500) + 'Ship Dễ' };
  fs.writeFileSync(file, JSON.stringify(entry) + '\n{"partial":');
  let reads = 0;
  const reader = {
    openSync: fs.openSync,
    closeSync: fs.closeSync,
    readSync(...args) {
      assert.ok(args[3] <= 65536);
      reads += 1;
      return fs.readSync(...args);
    },
  };
  const options = { dir: root, now: Date.parse('2026-10-13'), days: 1, reader };
  const read = decisions.readDecisionsDetailed(options);
  assert.equal(read.readable, true);
  assert.deepEqual(read.records, [entry]);
  assert.ok(reads >= 2);
  fs.appendFileSync(file, '\n');
  assert.deepEqual(decisions.readDecisionsDetailed(options).damaged, [
    '2026-10-13.jsonl: unparsable line 2',
  ]);
  fs.appendFileSync(file, JSON.stringify({ stage: 'failed', workItemId: 'GOAL-H3' }) + '\n');
  assert.equal(decisions.readDecisionsDetailed(options).readable, false);
});

for (const source of ['stderr', 'checkpoint', 'child', 'long-stderr']) {
  test(`H3 next stores and logs the ${source} failure reason before writer selection`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-next-reason-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const registerPath = path.join(root, 'register.csv');
    fs.writeFileSync(
      registerPath,
      'delivery_order,work_item_id,status,dependencies\n1,GOAL-H3,READY_FOR_AUTHOR,\n'
    );
    const checkpoint = path.join(root, 'checkpoint.json');
    const reason =
      'DECISION_LOG_UNREADABLE: daily log' + (source === 'long-stderr' ? 'x'.repeat(20000) : '');
    fs.writeFileSync(checkpoint, JSON.stringify({ outcomes: [{ workItemId: 'GOAL-H3', reason }] }));
    const result = await require('../next-runner').runNext(
      { rootDir: root, registerPath, decisionDir: path.join(root, 'decisions'), run: true },
      {
        log: () => {},
        runIntake: async () => {
          if (source === 'child') {
            const intakeResult = {
              status: 'launched',
              child: spawn(
                process.execPath,
                ['-e', `process.stderr.write(${JSON.stringify(reason)}); process.exitCode=1;`],
                { stdio: ['ignore', 'ignore', 'pipe'] }
              ),
            };
            captureIntakeStderr(intakeResult);
            return intakeResult;
          }
          return {
            status: 'failed',
            exitCode: 1,
            stderrTail: source === 'stderr' || source === 'long-stderr' ? reason : '',
            runFiles: { checkpoint },
          };
        },
      }
    );
    const expected = source === 'child' ? reason + '\n' : reason.slice(0, 500);

    assert.equal(result.reason, expected);
    const records = decisions.readDecisions({ dir: path.join(root, 'decisions') });
    assert.ok(records.some((entry) => entry.stage === 'failed' && entry.detail === expected));
    if (source === 'long-stderr')
      assert.equal(
        records.find((entry) => entry.stage === 'failed').stderrTail,
        reason.slice(-16000)
      );
  });
}

test('H3 compiled redaction escapes secrets, preserves text and handles large stderr quickly', () => {
  const redact = decisions.createSecretRedactor({
    API_KEY: 'fixture.[key]+secret',
    PATH: 'ordinary-path-text',
    SHORT_TOKEN: 'tiny',
  });
  assert.equal(redact('fixture.[key]+secret'), '[REDACTED_SECRET]');
  assert.equal(
    redact('ordinary-path-text tiny fixtureXkeysecret'),
    'ordinary-path-text tiny fixtureXkeysecret'
  );
  const input = 'normal stderr fixture.[key]+secret\n'.repeat(100000);
  const start = performance.now();
  assert.doesNotMatch(redact(input), /fixture/);
  assert.ok(performance.now() - start < 2000);
});
