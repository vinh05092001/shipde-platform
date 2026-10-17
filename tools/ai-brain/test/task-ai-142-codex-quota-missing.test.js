'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCodexSessionQuota } = require('../codex-quota');

function makeTempCodexDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-quota-test-'));
  const sessionsDir = path.join(dir, '.codex', 'sessions', '2026', '10', '17');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return { dir, sessionsDir };
}

test('readCodexSessionQuota returns status unknown (available false) when primary.used_percent is missing or not a finite number', (t) => {
  const { dir, sessionsDir } = makeTempCodexDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = Date.parse('2026-10-17T12:00:00.000Z');
  const rolloutFile = path.join(sessionsDir, 'rollout-2026-10-17T11-00-00-001.jsonl');

  // Case 1: primary.used_percent is completely missing (undefined)
  const lineMissingUsed = JSON.stringify({
    timestamp: '2026-10-17T11:50:00.000Z',
    payload: {
      rate_limits: {
        primary: {
          window_minutes: 300,
          resets_at: Math.floor(now / 1000) + 3600,
        },
      },
    },
  });
  fs.writeFileSync(rolloutFile, lineMissingUsed + '\n', 'utf8');

  const reading1 = readCodexSessionQuota({ homeDir: dir, now });
  assert.equal(
    reading1.available,
    false,
    'must not be available when primary.used_percent is missing'
  );
  assert.equal(
    reading1.status,
    'unknown',
    'status must be unknown when primary.used_percent is missing'
  );
  assert.match(
    reading1.reason,
    /primary\.used_percent/i,
    'reason must mention missing primary.used_percent'
  );

  // Case 2: primary.used_percent is not a number (string 'not-a-number')
  const lineInvalidUsed = JSON.stringify({
    timestamp: '2026-10-17T11:55:00.000Z',
    payload: {
      rate_limits: {
        primary: {
          window_minutes: 300,
          used_percent: 'invalid',
        },
      },
    },
  });
  fs.writeFileSync(rolloutFile, lineInvalidUsed + '\n', 'utf8');

  const reading2 = readCodexSessionQuota({ homeDir: dir, now });
  assert.equal(reading2.available, false);
  assert.equal(reading2.status, 'unknown');
  assert.match(reading2.reason, /primary\.used_percent/i);
});

test('readCodexSessionQuota relies solely on primary when secondary is missing or lacks used_percent', (t) => {
  const { dir, sessionsDir } = makeTempCodexDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = Date.parse('2026-10-17T12:00:00.000Z');
  const rolloutFile = path.join(sessionsDir, 'rollout-2026-10-17T11-00-00-002.jsonl');

  // Case 3: secondary is omitted entirely, primary is valid (50% used)
  const lineNoSecondary = JSON.stringify({
    timestamp: '2026-10-17T11:50:00.000Z',
    payload: {
      rate_limits: {
        primary: {
          window_minutes: 300,
          used_percent: 50,
          resets_at: Math.floor(now / 1000) + 3600,
        },
      },
    },
  });
  fs.writeFileSync(rolloutFile, lineNoSecondary + '\n', 'utf8');

  const reading = readCodexSessionQuota({ homeDir: dir, now });
  assert.equal(reading.available, true, 'missing secondary must still allow valid primary');
  assert.equal(reading.status, 'open', '50% primary without secondary resolves to open');

  // auth.json must NOT exist or be created/read
  assert.equal(
    fs.existsSync(path.join(dir, '.codex', 'auth.json')),
    false,
    'auth.json must not exist'
  );
});
