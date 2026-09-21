'use strict';
// TASK-AI-31 — deterministic unit tests for the qualification gate.
// Injected functions and plain objects only; no network, no real registry.
const { describe, test } = require('node:test');
const assert = require('node:assert');
const {
  evaluateGrant,
  applyGrant,
  runGate,
  QUALIFIED,
  ALREADY_QUALIFIED,
  NOT_QUALIFIED,
  RESULT_MISSING,
  RESULT_STALE,
  RESULT_CORRUPT,
  GRANT_CACHE_WINDOW_MS,
  GRANT_SOURCE,
} = require('../qualification-gate');
const {
  gateRuleFindings,
  grantCredentialFindings,
} = require('../acceptance/lib/qualification-gate');

function makeRecord(overrides) {
  return Object.assign(
    {
      accountId: 'acc-1',
      model: 'claude-code',
      instant: Date.now(),
      outcome: 'pass',
      latencyMs: 120,
      reason: 'ok',
    },
    overrides
  );
}

function makeDeps(recordOverrides, nowOverride) {
  const record = makeRecord(recordOverrides);
  const key = record.accountId + '@' + record.model;
  return {
    loadResults: () => ({ [key]: record }),
    now: () => (nowOverride != null ? nowOverride : record.instant + 1000),
    loadAccount: () => null,
    updateAccount: () => {},
    roles: ['author.lowrisk'],
  };
}

// ---------------------------------------------------------------------------
// evaluateGrant
// ---------------------------------------------------------------------------

describe('evaluateGrant', () => {
  test('grants when outcome is pass and result is fresh', () => {
    const deps = makeDeps({});
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps,
    });
    assert.strictEqual(r.status, QUALIFIED);
    assert.strictEqual(r.entry.source, GRANT_SOURCE);
    assert.strictEqual(r.entry.probeOutcome, 'pass');
    assert.strictEqual(r.entry.roleId, 'author.lowrisk');
    assert.ok(typeof r.entry.grantedAt === 'number');
  });

  test('refuses when outcome is fail', () => {
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps: makeDeps({ outcome: 'fail' }),
    });
    assert.strictEqual(r.status, NOT_QUALIFIED);
  });

  test('refuses when outcome is timeout', () => {
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps: makeDeps({ outcome: 'timeout' }),
    });
    assert.strictEqual(r.status, NOT_QUALIFIED);
  });

  test('refuses when outcome is refused', () => {
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps: makeDeps({ outcome: 'refused' }),
    });
    assert.strictEqual(r.status, NOT_QUALIFIED);
  });

  test('returns RESULT_MISSING when no record exists for the key', () => {
    const deps = { loadResults: () => ({}), now: () => Date.now(), roles: ['author.lowrisk'] };
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps,
    });
    assert.strictEqual(r.status, RESULT_MISSING);
  });

  test('returns RESULT_MISSING when loadResults returns null', () => {
    const deps = { loadResults: () => null, now: () => Date.now() };
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps,
    });
    assert.strictEqual(r.status, RESULT_MISSING);
  });

  test('returns RESULT_CORRUPT when loadResults throws with RESULT_CORRUPT code', () => {
    const deps = {
      loadResults: () => {
        const e = new Error('bad');
        e.code = 'RESULT_CORRUPT';
        throw e;
      },
      now: () => Date.now(),
    };
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps,
    });
    assert.strictEqual(r.status, RESULT_CORRUPT);
  });

  test('returns RESULT_STALE when result age exceeds GRANT_CACHE_WINDOW_MS', () => {
    const instant = Date.now() - GRANT_CACHE_WINDOW_MS - 5000;
    const deps = makeDeps({ instant }, Date.now());
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps,
    });
    assert.strictEqual(r.status, RESULT_STALE);
    assert.ok(r.age > GRANT_CACHE_WINDOW_MS);
  });

  test('entry carries no credential keys', () => {
    const deps = makeDeps({});
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps,
    });
    assert.strictEqual(r.status, QUALIFIED);
    assert.deepStrictEqual(grantCredentialFindings(r.entry), []);
  });

  test('refuses unknown roleId', () => {
    const deps = makeDeps({});
    const r = evaluateGrant({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'totally_bogus_role',
      deps,
    });
    assert.strictEqual(r.status, NOT_QUALIFIED);
    assert.ok(r.reason.includes('totally_bogus_role'));
  });
});

// ---------------------------------------------------------------------------
// runGate
// ---------------------------------------------------------------------------

describe('runGate', () => {
  test('returns one result per evaluated role', () => {
    const results = runGate({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps: makeDeps({}),
    });
    assert.strictEqual(results.length, 1);
  });

  test('marks already-qualified accounts as ALREADY_QUALIFIED', () => {
    const deps = Object.assign(makeDeps({}), {
      loadAccount: () => ({ id: 'acc-1', qualifiedRoles: ['author.lowrisk'] }),
    });
    const results = runGate({
      accountId: 'acc-1',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps,
    });
    assert.strictEqual(results[0].status, ALREADY_QUALIFIED);
  });

  test('calls updateAccount for a fresh grant', () => {
    let saved = null;
    const deps = Object.assign(makeDeps({}), {
      updateAccount: (_id, acc) => {
        saved = acc;
      },
    });
    runGate({ accountId: 'acc-1', model: 'claude-code', roleId: 'author.lowrisk', deps });
    assert.ok(saved !== null);
    assert.ok(saved.qualifiedRoles.includes('author.lowrisk'));
  });

  test('persists to registry when default persistence functions are used', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qgate-test-'));
    const registryFile = path.join(tmpDir, 'accounts.registry.json');
    fs.writeFileSync(
      registryFile,
      JSON.stringify({
        version: 1,
        accounts: [
          {
            id: 'acc-real',
            provider: 'anthropic',
            model: 'claude-code',
            capabilities: { contextWindow: 200000 },
          },
        ],
      })
    );

    const now = Date.now();
    const probeRecord = {
      accountId: 'acc-real',
      model: 'claude-code',
      instant: now,
      outcome: 'pass',
      latencyMs: 100,
      reason: 'ok',
    };

    const results = runGate({
      accountId: 'acc-real',
      model: 'claude-code',
      roleId: 'author.lowrisk',
      deps: {
        loadResults: () => ({ 'acc-real@claude-code': probeRecord }),
        now: () => now + 1000,
        registryFile,
        roles: ['author.lowrisk'],
      },
    });

    assert.strictEqual(results[0].status, QUALIFIED);
    const updatedRegistry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const acc = updatedRegistry.accounts.find((a) => a.id === 'acc-real');
    assert.ok(acc.qualifiedRoles.includes('author.lowrisk'));
    assert.strictEqual(acc.qualificationHistory.length, 1);
    assert.strictEqual(acc.qualificationHistory[0].roleId, 'author.lowrisk');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('evaluates all roles in deps.roles when roleId is omitted', () => {
    const now = Date.now();
    const deps = {
      loadResults: () => ({
        'acc-1@claude-code': {
          accountId: 'acc-1',
          model: 'claude-code',
          instant: now,
          outcome: 'pass',
          latencyMs: 100,
          reason: 'ok',
        },
      }),
      now: () => now + 1000,
      loadAccount: () => null,
      updateAccount: () => {},
      roles: ['author.lowrisk', 'reviewer.primary'],
    };
    const results = runGate({ accountId: 'acc-1', model: 'claude-code', deps });
    assert.strictEqual(results.length, 2);
  });
});

// ---------------------------------------------------------------------------
// gateRuleFindings
// ---------------------------------------------------------------------------

describe('gateRuleFindings', () => {
  const now = Date.now();
  const fresh = now - 1000;
  const goodEntry = {
    roleId: 'author.lowrisk',
    grantedAt: now,
    source: GRANT_SOURCE,
    probeOutcome: 'pass',
  };

  test('accepts a fully compliant configuration', () => {
    const findings = gateRuleFindings({
      outcome: 'pass',
      resultInstant: fresh,
      now,
      roleId: 'author.lowrisk',
      entry: goodEntry,
      writtenFields: ['qualifiedRoles', 'qualificationHistory'],
      removesRole: false,
    });
    assert.deepStrictEqual(findings, []);
  });

  test('refuses non-pass outcome', () => {
    const findings = gateRuleFindings({
      outcome: 'fail',
      resultInstant: fresh,
      now,
      entry: goodEntry,
      writtenFields: ['qualifiedRoles'],
      removesRole: false,
    });
    assert.ok(findings.some((f) => f.includes('outcome')));
  });

  test('refuses stale result', () => {
    const findings = gateRuleFindings({
      outcome: 'pass',
      resultInstant: now - GRANT_CACHE_WINDOW_MS - 1,
      now,
      entry: goodEntry,
      writtenFields: ['qualifiedRoles'],
      removesRole: false,
    });
    assert.ok(findings.some((f) => f.includes('stale')));
  });

  test('refuses forbidden written field', () => {
    const findings = gateRuleFindings({
      outcome: 'pass',
      resultInstant: fresh,
      now,
      entry: goodEntry,
      writtenFields: ['grade'],
      removesRole: false,
    });
    assert.ok(findings.some((f) => f.includes('grade')));
  });

  test('refuses removesRole true', () => {
    const findings = gateRuleFindings({
      outcome: 'pass',
      resultInstant: fresh,
      now,
      entry: goodEntry,
      writtenFields: ['qualifiedRoles'],
      removesRole: true,
    });
    assert.ok(findings.some((f) => f.includes('remove')));
  });

  test('refuses wrong source in entry', () => {
    const bad = Object.assign({}, goodEntry, { source: 'operator' });
    const findings = gateRuleFindings({
      outcome: 'pass',
      resultInstant: fresh,
      now,
      entry: bad,
      writtenFields: ['qualifiedRoles'],
      removesRole: false,
    });
    assert.ok(findings.some((f) => f.includes('source')));
  });

  test('refuses unknown role', () => {
    const findings = gateRuleFindings({
      outcome: 'pass',
      resultInstant: fresh,
      now,
      roleId: 'totally_bogus_role',
      entry: goodEntry,
      writtenFields: ['qualifiedRoles'],
      removesRole: false,
    });
    assert.ok(findings.some((f) => f.includes('unknown role')));
  });

  test('refuses roleId mismatch between config and entry', () => {
    const findings = gateRuleFindings({
      outcome: 'pass',
      resultInstant: fresh,
      now,
      roleId: 'reviewer.primary',
      entry: goodEntry,
      writtenFields: ['qualifiedRoles'],
      removesRole: false,
    });
    assert.ok(findings.some((f) => f.includes('mismatch')));
  });
});

// ---------------------------------------------------------------------------
// grantCredentialFindings
// ---------------------------------------------------------------------------

describe('grantCredentialFindings', () => {
  test('returns empty for a clean entry', () => {
    assert.deepStrictEqual(
      grantCredentialFindings({
        roleId: 'author.lowrisk',
        grantedAt: Date.now(),
        source: GRANT_SOURCE,
        probeOutcome: 'pass',
      }),
      []
    );
  });

  test('flags apiKey', () => {
    assert.ok(grantCredentialFindings({ apiKey: 'sk-abc' }).some((f) => f.includes('apiKey')));
  });

  test('flags secret', () => {
    assert.ok(grantCredentialFindings({ secret: 'x' }).some((f) => f.includes('secret')));
  });

  test('flags token', () => {
    assert.ok(grantCredentialFindings({ token: 'x' }).some((f) => f.includes('token')));
  });
});

describe('applyGrant', () => {
  const entry = {
    roleId: 'author.lowrisk',
    grantedAt: 1000,
    source: GRANT_SOURCE,
    probeOutcome: 'pass',
  };

  test('adds role when not present', () => {
    const updated = applyGrant({ id: 'acc-1', qualifiedRoles: [] }, entry);
    assert.ok(updated.qualifiedRoles.includes('author.lowrisk'));
  });

  test('does not duplicate role when already present', () => {
    const updated = applyGrant({ id: 'acc-1', qualifiedRoles: ['author.lowrisk'] }, entry);
    assert.strictEqual(updated.qualifiedRoles.filter((r) => r === 'author.lowrisk').length, 1);
  });

  test('does not remove existing roles', () => {
    const updated = applyGrant({ id: 'acc-1', qualifiedRoles: ['reviewer.primary'] }, entry);
    assert.ok(updated.qualifiedRoles.includes('reviewer.primary'));
    assert.ok(updated.qualifiedRoles.includes('author.lowrisk'));
  });

  test('initialises qualifiedRoles when absent', () => {
    const updated = applyGrant({ id: 'acc-1' }, entry);
    assert.ok(Array.isArray(updated.qualifiedRoles));
    assert.ok(updated.qualifiedRoles.includes('author.lowrisk'));
  });

  test('appends qualificationHistory entry', () => {
    const updated = applyGrant({ id: 'acc-1' }, entry);
    assert.ok(Array.isArray(updated.qualificationHistory));
    assert.strictEqual(updated.qualificationHistory.length, 1);
    assert.strictEqual(updated.qualificationHistory[0].roleId, 'author.lowrisk');
  });

  test('updates existing history entry rather than duplicating', () => {
    const old = {
      roleId: 'author.lowrisk',
      grantedAt: 500,
      source: GRANT_SOURCE,
      probeOutcome: 'pass',
    };
    const updated = applyGrant(
      { id: 'acc-1', qualifiedRoles: ['author.lowrisk'], qualificationHistory: [old] },
      entry
    );
    assert.strictEqual(updated.qualificationHistory.length, 1);
    assert.strictEqual(updated.qualificationHistory[0].grantedAt, 1000);
  });

  test('does not write forbidden fields', () => {
    const updated = applyGrant({ id: 'acc-1', grade: 'A', cost: { inputPerMillion: 0 } }, entry);
    assert.strictEqual(updated.grade, 'A');
    assert.deepStrictEqual(updated.cost, { inputPerMillion: 0 });
  });
});
