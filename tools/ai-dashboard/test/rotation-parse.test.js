'use strict';

// TASK-AI-47: the dispatcher log format the rotation view actually reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseLogLines } = require('../rotation');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-parse-'));
}

test('parseLogLines reads the lines dispatch.sh writes', () => {
  const dir = tmpDir();
  const lines = [
    '=== trying xkiro qwen/qwen3-coder-plus:free 09:23:40 ===',
    '--- xkiro qwen/qwen3-coder-plus:free exhausted, falling back ---',
    '=== trying cline z-ai/glm-5.3-flash 09:31:02 ===',
    '=== finished on cline z-ai/glm-5.3-flash ===',
    '--- skip xkiro minimax/minimax-m3:free: daily free quota remaining 0 ---',
    'unrelated transcript noise',
  ];
  fs.writeFileSync(path.join(dir, 'job1.log'), lines.join(os.EOL));

  const entries = parseLogLines(dir);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].sourceId, 'xkiro');
  assert.equal(entries[0].outcome, 'quota-refused');
  assert.equal(entries[0].tokens, 'UNKNOWN');
  assert.equal(entries[1].sourceId, 'cline');
  assert.equal(entries[1].modelId, 'z-ai/glm-5.3-flash');
  assert.equal(entries[1].outcome, 'done');
  assert.equal(entries[2].outcome, 'quota-refused');
  assert.match(entries[2].reason, /remaining 0/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('tokens are summed from the run log and stay UNKNOWN without one', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'job2.log'), '=== trying cline z-ai/glm-5.3-flash 10:00:00 ===');
  fs.writeFileSync(
    path.join(dir, 'job2-run.log'),
    '{"type":"run_result","usage":{"inputTokens":120,"outputTokens":30}}'
  );
  const measured = parseLogLines(dir).find((e) => e.runId === 'job2');
  assert.equal(measured.outcome, 'live');
  assert.equal(measured.tokens, 150);

  fs.writeFileSync(
    path.join(dir, 'job3.log'),
    '=== trying agy gemini-3.8-flash-medium 10:05:00 ==='
  );
  const unmeasured = parseLogLines(dir).find((e) => e.runId === 'job3');
  assert.equal(unmeasured.sourceId, 'agy-local');
  assert.equal(unmeasured.tokens, 'UNKNOWN');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a run log is not mistaken for a dispatcher log', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'alpha.log'), '=== trying cline z-ai/glm-5.3-flash 11:00:00 ===');
  fs.writeFileSync(
    path.join(dir, 'alpha-run.log'),
    '=== trying cline z-ai/glm-5.3-flash 11:00:00 ==='
  );
  const entries = parseLogLines(dir);
  assert.equal(entries.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
