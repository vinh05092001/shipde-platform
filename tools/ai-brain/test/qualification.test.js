'use strict';
// TASK-AI-30 — deterministic unit tests for the qualification rule.
// Injected functions and plain objects only; no network, no real registry.
const { describe, test } = require('node:test');
const assert = require('node:assert');
const { probeRuleFindings, resultCredentialFindings } = require('../acceptance/lib/qualification');

describe('Probe rule', () => {
  test('accepts a compliant injected configuration', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      account: { id: 'acc-1', provider: 'claude-code' },
      provider: 'claude-code',
      outcome: 'pass',
      isEntryAdmitted: () => true,
      isProviderSupported: () => true,
      recordOutcome: () => true,
    });
    assert.deepStrictEqual(findings, []);
  });

  test('refuses a configuration missing required fields', () => {
    const findings = probeRuleFindings({});
    assert.ok(findings.length >= 4);
    for (const f of findings) assert.ok(f.startsWith('PROBE_VIOLATED'));
  });

  test('refuses a configuration with non-positive timeout', () => {
    const findings = probeRuleFindings({
      timeoutMs: 0,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
    });
    assert.ok(findings.some((f) => f.includes('timeoutMs')));
  });

  test('refuses a configuration with tree kill disabled', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: false,
      cheapestModel: true,
      cacheWindowMs: 60_000,
    });
    assert.ok(findings.some((f) => f.includes('treeKill')));
  });

  test('refuses a configuration with cheapest model not selected', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: false,
      cacheWindowMs: 60_000,
    });
    assert.ok(findings.some((f) => f.includes('cheapestModel')));
  });

  test('refuses a configuration with non-positive cache window', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: -1,
    });
    assert.ok(findings.some((f) => f.includes('cacheWindowMs')));
  });

  test('refuses when the injected entry admission fails', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      account: { id: 'acc-1' },
      isEntryAdmitted: () => false,
    });
    assert.ok(findings.some((f) => f.includes('entry-admitted')));
  });

  test('refuses when the injected provider is unsupported', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      provider: 'unknown',
      isProviderSupported: () => false,
    });
    assert.ok(findings.some((f) => f.includes('provider')));
  });

  test('refuses when the injected outcome is not recorded', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      outcome: 'pass',
      recordOutcome: () => false,
    });
    assert.ok(findings.some((f) => f.includes('outcome')));
  });

  test('refuses a configuration with no entry admission at all', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
    });
    assert.ok(findings.some((f) => f.includes('entry-admitted')));
  });

  test('defaults entry admission to shared entry module when account is supplied', () => {
    const invalidAccount = { id: 'bad', provider: 'antigravity', models: [] };
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      account: invalidAccount,
    });
    assert.ok(findings.some((f) => f.includes('entry-admitted')));
  });
});

describe('Result credential rule', () => {
  test('accepts a clean well-formed result', () => {
    const result = {
      accountId: 'acc-1',
      model: 'claude-haiku-4-5-20251001',
      instant: '2026-09-17T00:00:00.000Z',
      outcome: 'pass',
      latencyMs: 1200,
      reason: 'answered',
    };
    assert.deepStrictEqual(resultCredentialFindings(result, 'super-secret'), []);
  });

  test('flags a result that carries the credential', () => {
    const result = {
      accountId: 'acc-1',
      model: 'claude-haiku-4-5-20251001',
      instant: '2026-09-17T00:00:00.000Z',
      outcome: 'pass',
      latencyMs: 1200,
      reason: 'super-secret',
    };
    const findings = resultCredentialFindings(result, 'super-secret');
    assert.ok(findings.some((f) => f.startsWith('CREDENTIAL_IN_RESULT')));
  });

  test('flags a result missing required fields', () => {
    const findings = resultCredentialFindings({ accountId: 'acc-1' }, '');
    assert.ok(findings.some((f) => f.startsWith('RESULT_SHAPE')));
  });

  test('refuses a non-object result', () => {
    assert.ok(resultCredentialFindings(null, '').some((f) => f.startsWith('RESULT_SHAPE')));
    assert.ok(
      resultCredentialFindings('not an object', '').some((f) => f.startsWith('RESULT_SHAPE'))
    );
  });
});

// ---------------------------------------------------------------------------
// Production module — the recorded probe itself (TASK-AI-30).
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { EventEmitter } = require('node:events');
const q = require('../qualification');

function tmpFile() {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'q30-test-'));
  return nodePath.join(dir, 'results.json');
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

describe('Qualification record store', () => {
  test('recordKey joins account and model', () => {
    assert.strictEqual(q.recordKey('acc-1', 'm1'), 'acc-1@m1');
  });

  test('validateResultShape accepts a complete record', () => {
    const record = {
      accountId: 'acc-1',
      model: 'm1',
      instant: '2026-09-17T00:00:00.000Z',
      outcome: 'pass',
      latencyMs: 10,
      reason: 'answered',
    };
    assert.deepStrictEqual(q.validateResultShape(record), []);
  });

  test('validateResultShape flags missing fields, unknown outcomes, non-objects', () => {
    assert.ok(q.validateResultShape({ accountId: 'x' }).length >= 5);
    assert.ok(
      q
        .validateResultShape({
          accountId: 'x',
          model: 'm',
          instant: 'z',
          outcome: 'exploded',
          latencyMs: 0,
          reason: '',
        })
        .some((f) => f.includes('unknown outcome'))
    );
    assert.ok(q.validateResultShape(null).some((f) => f.includes('not a plain object')));
    assert.ok(q.validateResultShape([1]).some((f) => f.includes('not a plain object')));
  });

  test('validateResultShape refuses a latency that was not measured', () => {
    const reused = {
      accountId: 'acc-1',
      model: 'm1',
      instant: '2026-09-17T00:00:00.000Z',
      outcome: 'pass',
      latencyMs: null,
      reason: 'cached verdict reused inside the cache window',
      cached: true,
    };
    assert.deepStrictEqual(q.validateResultShape(reused), []);

    const fabricated = Object.assign({}, reused, { latencyMs: 0 });
    assert.ok(q.validateResultShape(fabricated).some((f) => f.includes('reused verdict')));

    const unmarked = Object.assign({}, reused);
    delete unmarked.cached;
    assert.ok(q.validateResultShape(unmarked).some((f) => f.includes('measured non-negative')));

    const unmeasurable = Object.assign({}, reused, { cached: false, latencyMs: 'fast' });
    assert.ok(q.validateResultShape(unmeasurable).some((f) => f.includes('measured non-negative')));
  });

  test('loadResults returns an empty record for a missing file', () => {
    assert.deepStrictEqual(q.loadResults(tmpFile(), { fs }), {});
  });

  test('loadResults refuses a corrupt file instead of pretending there is no cache', () => {
    const file = tmpFile();
    fs.writeFileSync(file, 'not json{');
    assert.throws(() => q.loadResults(file, { fs }), /RESULT_CORRUPT/);
  });

  test('loadResults refuses an unreadable path and treats a non-object document as empty', () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'q30-test-'));
    assert.throws(() => q.loadResults(dir, { fs }), /RESULT_UNREADABLE/);
    const file = nodePath.join(dir, 'arr.json');
    fs.writeFileSync(file, '[]');
    assert.deepStrictEqual(q.loadResults(file, { fs }), {});
  });

  test('saveResult writes the record and merges by account@model', () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const first = q.saveResult(
      {
        accountId: 'a',
        model: 'm1',
        instant: '2026-09-17T00:00:00.000Z',
        outcome: 'pass',
        latencyMs: 1,
        reason: 'r',
      },
      file,
      io
    );
    assert.strictEqual(first.outcome, 'pass');
    q.saveResult(
      {
        accountId: 'a',
        model: 'm2',
        instant: '2026-09-17T00:00:01.000Z',
        outcome: 'fail',
        latencyMs: 2,
        reason: 'r2',
      },
      file,
      io
    );
    q.saveResult(
      {
        accountId: 'b',
        model: 'm1',
        instant: '2026-09-17T00:00:02.000Z',
        outcome: 'timeout',
        latencyMs: 3,
        reason: 'r3',
      },
      file,
      io
    );
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(Object.keys(store).sort(), ['a@m1', 'a@m2', 'b@m1']);
    assert.strictEqual(store['a@m2'].outcome, 'fail');
  });

  test('saveResult refuses to write an invalid record', () => {
    assert.throws(
      () =>
        q.saveResult({ accountId: 'a' }, tmpFile(), {
          fs,
          fileIo: { writeFileSync: () => {} },
        }),
      /RESULT_SHAPE/
    );
  });
});

describe('Cache verdict and cheapest model', () => {
  const now = 1_800_000_000_000;
  const fresh = (outcome) => ({
    instant: new Date(now - 60_000).toISOString(),
    outcome,
  });

  test('cachedVerdict reuses any fresh verdict, including timeout and fail', () => {
    for (const outcome of ['pass', 'fail', 'timeout']) {
      const v = q.cachedVerdict({ 'a@m': fresh(outcome) }, 'a', 'm', { now });
      assert.deepStrictEqual(v, {
        action: 'reuse',
        outcome,
        instant: fresh(outcome).instant,
      });
    }
  });

  test('cachedVerdict re-probes past the window and on an unparseable instant', () => {
    const old = { 'a@m': { instant: new Date(now - 31 * 60_000).toISOString(), outcome: 'pass' } };
    assert.deepStrictEqual(q.cachedVerdict(old, 'a', 'm', { now }), {
      action: 'probe',
      expired: true,
    });
    const broken = { 'a@m': { instant: 'not-a-date', outcome: 'pass' } };
    assert.deepStrictEqual(q.cachedVerdict(broken, 'a', 'm', { now }), {
      action: 'probe',
      expired: true,
    });
    assert.deepStrictEqual(q.cachedVerdict({}, 'a', 'm', { now }), { action: 'probe' });
  });

  test('cheapestModel compares input+output cost with an alphabetical tiebreak', () => {
    const account = {
      models: [
        { model: 'b', cost: { inputPerMillion: 1, outputPerMillion: 2 } },
        { model: 'a', cost: { inputPerMillion: 1, outputPerMillion: 2 } },
        { model: 'c', cost: { inputPerMillion: 3, outputPerMillion: 0 } },
      ],
    };
    assert.strictEqual(q.cheapestModel(account), 'a');
    assert.strictEqual(
      q.cheapestModel({
        models: [
          { model: 'b', cost: { inputPerMillion: 1, outputPerMillion: 0 } },
          { model: 'a', cost: { inputPerMillion: 2, outputPerMillion: 0 } },
        ],
      }),
      'b'
    );
  });

  test('cheapestModel falls back to declaration order and to null without models', () => {
    assert.strictEqual(q.cheapestModel({ models: [{ model: 'x' }, { model: 'y' }] }), 'x');
    assert.strictEqual(q.cheapestModel({ models: [] }), null);
    assert.strictEqual(q.cheapestModel(undefined), null);
  });
});

describe('Probe command construction', () => {
  test('fills the declared cli command', () => {
    assert.strictEqual(
      q.probeCommand(
        { launch: { kind: 'cli', command: 'agent --model <model> --prompt <prompt>' } },
        'm1',
        'hi'
      ),
      'agent --model m1 --prompt hi'
    );
  });

  test('wraps the docker-compose declaration with its recorded dir and service', () => {
    const cmd = q.probeCommand(
      {
        launch: {
          kind: 'docker-compose',
          dir: 'C:/agent/',
          service: 'app',
          command: 'agent <model> <prompt>',
        },
      },
      'm1',
      'hi'
    );
    assert.strictEqual(
      cmd,
      'docker compose -f "C:/agent/docker-compose.yml" run --rm app agent m1 hi'
    );
  });

  test('builds the openai-compatible curl with max_tokens 1, HTTP status trailer, and no credential', () => {
    const cmd = q.probeCommand(
      { launch: { kind: 'openai-compatible', baseUrl: 'https://gw/v1/' } },
      'm1',
      'hi'
    );
    assert.ok(cmd.startsWith('curl -sS -w'));
    assert.ok(cmd.includes(q.HTTP_STATUS_TRAILER));
    assert.ok(cmd.includes('https://gw/v1/chat/completions'));
    // The JSON body is shell-embedded, so quotes are escaped in the command.
    assert.ok(/\\?"max_tokens\\?":1/.test(cmd));
    assert.ok(/\\?"content\\?":\\?"hi/.test(cmd));
    assert.ok(!/authorization|bearer|sk-/i.test(cmd));
  });

  test('refuses a missing or unknown launch kind instead of guessing', () => {
    assert.throws(() => q.probeCommand({}, 'm', 'hi'), /PROBE_LAUNCH_MISSING/);
    assert.throws(
      () => q.probeCommand({ launch: { kind: 'telepathy' } }, 'm', 'hi'),
      /PROBE_LAUNCH_UNKNOWN/
    );
  });
});

describe('Bounded run', () => {
  test('records a pass and a bounded fail reason', async () => {
    const child = fakeChild();
    const p = q.runBounded('x', { spawn: () => child });
    child.emit('close', 0, null);
    const pass = await p;
    assert.strictEqual(pass.outcome, 'pass');

    const child2 = fakeChild();
    const p2 = q.runBounded('x', { spawn: () => child2 });
    child2.stderr.emit('data', 'boom');
    child2.emit('close', 1, null);
    const fail = await p2;
    assert.strictEqual(fail.outcome, 'fail');
    assert.ok(fail.reason.includes('exit code 1'));
    assert.ok(fail.reason.includes('boom'));
    assert.ok(fail.reason.length <= 160);
  });

  test('times out and kills the child', async () => {
    const child = fakeChild();
    const p = q.runBounded('x', { timeoutMs: 5, treeKill: false, spawn: () => child });
    const result = await p;
    assert.strictEqual(result.outcome, 'timeout');
    assert.strictEqual(result.treeKilled, false);
    assert.strictEqual(child.killed, true);
  });

  test('maps a signal close and a spawn throw to timeout and refused', async () => {
    const child = fakeChild();
    const p = q.runBounded('x', { spawn: () => child });
    child.emit('close', null, 'SIGTERM');
    assert.strictEqual((await p).outcome, 'timeout');

    const refused = await q.runBounded('x', {
      spawn: () => {
        throw new Error('no shell');
      },
    });
    assert.strictEqual(refused.outcome, 'refused');
    assert.ok(refused.reason.includes('no shell'));
  });
});

describe('probeAccount — the recorded probe', () => {
  const now = 1_800_000_000_000;
  const cliAccount = {
    id: 'acc-1',
    provider: 'claude-code',
    launch: { kind: 'cli', command: 'agent <model> <prompt>' },
    capabilities: { contextWindow: 200000 },
    models: [
      { model: 'expensive', cost: { inputPerMillion: 9, outputPerMillion: 9 } },
      { model: 'cheap', cost: { inputPerMillion: 1, outputPerMillion: 1 } },
    ],
  };

  test('refuses an account the shared entry module refuses when no gate is injected', async () => {
    const file = tmpFile();
    const refused = { ...cliAccount, id: 'acc-refused', capabilities: {} };
    let spawned = 0;
    const record = await q.probeAccount({
      accountId: 'acc-refused',
      accounts: [refused],
      file,
      now,
      run: async () => {
        spawned++;
        return { outcome: 'pass', reason: 'answered' };
      },
    });
    assert.strictEqual(record.outcome, 'refused');
    assert.ok(record.reason.startsWith('entry refused: REGISTRY_VALIDATOR'));
    assert.strictEqual(spawned, 0);
  });

  test('runProbeCli with no injected gate refuses an entry-refused account', async () => {
    const file = tmpFile();
    const refused = { ...cliAccount, id: 'acc-refused', capabilities: {} };
    const lines = [];
    const exit = await q.runProbeCli(['--account', 'acc-refused', '--json', '--file', file], {
      accounts: [refused],
      out: (l) => lines.push(l),
      err: () => {},
    });
    assert.strictEqual(exit, 0);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    const [only] = Object.values(written);
    assert.strictEqual(only.outcome, 'refused');
    assert.ok(only.reason.startsWith('entry refused:'));
  });

  test('the acceptance probe rule and the shipped probe refuse the same entry-refused account', async () => {
    const refused = { ...cliAccount, id: 'acc-refused', capabilities: {} };
    // The acceptance rule, with no gate injected, must refuse the account...
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      account: refused,
      provider: refused.provider,
      outcome: 'pass',
      isProviderSupported: () => true,
      recordOutcome: () => true,
    });
    assert.ok(findings.some((f) => f.includes('entry-admitted')));
    // ...and so must the shipped probe, so the rule and the delivery cannot be
    // two different rules (review finding F2).
    const record = await q.probeAccount({
      accountId: 'acc-refused',
      accounts: [refused],
      file: tmpFile(),
      now,
      run: async () => {
        throw new Error('an entry-refused account must never be spawned');
      },
    });
    assert.strictEqual(record.outcome, 'refused');
    assert.ok(record.reason.startsWith('entry refused:'));
  });

  test('runs the cheapest model through the declared command and records the outcome', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const seen = [];
    const record = await q.probeAccount({
      accountId: 'acc-1',
      accounts: [cliAccount],
      file,
      io,
      now,
      run: async (command, opts) => {
        seen.push({ command, opts });
        return { outcome: 'pass', reason: 'answered', stdout: 'ready' };
      },
    });
    assert.strictEqual(record.model, 'cheap');
    assert.strictEqual(record.outcome, 'pass');
    assert.ok(record.latencyMs >= 0);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))['acc-1@cheap'];
    assert.strictEqual(written.outcome, 'pass');
    assert.deepStrictEqual(Object.keys(written).sort(), [
      'accountId',
      'instant',
      'latencyMs',
      'model',
      'outcome',
      'reason',
    ]);
    assert.ok(!JSON.stringify(written).includes('agent cheap'));
    assert.strictEqual(seen[0].command, 'agent cheap Reply with the single word: ready.');
    assert.strictEqual(seen[0].opts.timeoutMs, q.DEFAULT_PROBE_TIMEOUT_MS);
    assert.strictEqual(seen[0].opts.treeKill, true);
  });

  test('reuses the cached verdict inside the window without re-spending a request', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    await q.probeAccount({
      accountId: 'acc-1',
      accounts: [cliAccount],
      file,
      io,
      now,
      run: async () => ({ outcome: 'timeout', reason: 'probe exceeded its timeout' }),
    });
    let calls = 0;
    const record = await q.probeAccount({
      accountId: 'acc-1',
      accounts: [cliAccount],
      file,
      io,
      now: now + 60_000,
      run: async () => {
        calls += 1;
        return { outcome: 'pass', reason: 'answered' };
      },
    });
    assert.strictEqual(record.cached, true);
    assert.strictEqual(record.outcome, 'timeout');
    // A reused verdict is not a measurement: it carries no latency at all, and
    // the record it returns still satisfies the declared shape (review N2).
    assert.strictEqual(record.latencyMs, null);
    assert.deepStrictEqual(q.validateResultShape(record), []);
    assert.strictEqual(calls, 0);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))['acc-1@cheap'];
    assert.strictEqual(written.outcome, 'timeout');
  });

  test('re-probes once the cache window has passed', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    await q.probeAccount({
      accountId: 'acc-1',
      accounts: [cliAccount],
      file,
      io,
      now,
      run: async () => ({ outcome: 'fail', reason: 'exit code 1' }),
    });
    let calls = 0;
    const record = await q.probeAccount({
      accountId: 'acc-1',
      accounts: [cliAccount],
      file,
      io,
      now: now + 31 * 60_000,
      run: async () => {
        calls += 1;
        return { outcome: 'pass', reason: 'answered', stdout: 'ready' };
      },
    });
    assert.strictEqual(record.cached, undefined);
    assert.strictEqual(record.outcome, 'pass');
    assert.strictEqual(calls, 1);
  });

  test('records a refused outcome for an unknown account without throwing', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const record = await q.probeAccount({
      accountId: 'ghost',
      accounts: [cliAccount],
      file,
      io,
      now,
    });
    assert.strictEqual(record.outcome, 'refused');
    assert.strictEqual(record.reason, 'unknown account id');
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))['ghost@'];
    assert.strictEqual(written.outcome, 'refused');
  });

  test('refuses an unsupported provider and an entry-admission failure as recorded outcomes', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const unsupported = await q.probeAccount({
      accountId: 'acc-1',
      accounts: [{ ...cliAccount, provider: 'mystery' }],
      file,
      io,
      now,
    });
    assert.strictEqual(unsupported.outcome, 'refused');
    assert.ok(unsupported.reason.includes('has no reader'));

    const gate = await q.probeAccount({
      accountId: 'acc-1',
      accounts: [cliAccount],
      file,
      io,
      now,
      isEntryAdmitted: () => [{ rule: 'ENTRY_EXPIRED', detail: 'key expired' }],
    });
    assert.strictEqual(gate.outcome, 'refused');
    assert.ok(gate.reason.includes('ENTRY_EXPIRED'));
  });

  test('honors an explicit --model request and refuses an account with no models', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const chosen = await q.probeAccount({
      accountId: 'acc-1',
      accounts: [cliAccount],
      file,
      io,
      now,
      model: 'expensive',
      run: async () => ({ outcome: 'pass', reason: 'answered', stdout: 'ready' }),
    });
    assert.strictEqual(chosen.model, 'expensive');

    const none = await q.probeAccount({
      accountId: 'acc-1',
      accounts: [{ ...cliAccount, models: [] }],
      file,
      io,
      now,
      // The shared entry module already refuses an empty models[]; admit it
      // here so the probe's own no-model refusal stays covered.
      isEntryAdmitted: () => true,
    });
    assert.strictEqual(none.outcome, 'refused');
    assert.ok(none.reason.includes('no model'));
  });
});

describe('runProbeCli — argument handling', () => {
  test('rejects unknown flags, extra positionals, and a missing account with exit 2', async () => {
    for (const argv of [
      ['--nope'],
      ['--account', 'a', 'extra'],
      [],
      ['--account'],
      ['--account', 'a', '--timeout', 'x'],
      ['--account', 'a', '--cache-window', '0'],
    ]) {
      const lines = [];
      const exit = await q.runProbeCli(argv, {
        accounts: [],
        out: (l) => lines.push(l),
        err: (l) => lines.push(l),
      });
      assert.strictEqual(exit, 2, 'argv: ' + JSON.stringify(argv));
    }
  });

  test('prints a deterministic record line for a recorded refusal', async () => {
    const lines = [];
    const exit = await q.runProbeCli(['--account', 'ghost', '--file', tmpFile()], {
      accounts: [{ id: 'real', provider: 'claude-code' }],
      out: (l) => lines.push(l),
      err: (l) => lines.push(l),
    });
    assert.strictEqual(exit, 0);
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0].includes('refused'));
    assert.ok(lines[1].includes('unknown account id'));
  });

  test('emits valid JSON with --json and honors --file', async () => {
    const file = tmpFile();
    const lines = [];
    const exit = await q.runProbeCli(['--account', 'ghost', '--json', '--file', file], {
      accounts: [],
      out: (l) => lines.push(l),
      err: (l) => lines.push(l),
    });
    assert.strictEqual(exit, 0);
    const parsed = JSON.parse(lines[0]);
    assert.strictEqual(parsed.outcome, 'refused');
    assert.strictEqual(parsed.accountId, 'ghost');
    assert.ok(fs.existsSync(file));
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(store['ghost@'].outcome, 'refused');
  });
});

// ---------------------------------------------------------------------------
// Fix (a): the oc provider is now probe-supported
// ---------------------------------------------------------------------------

describe('probeAccount — oc provider support', () => {
  const now = 1_800_000_000_000;
  const ocAccount = {
    id: 'ninerouter',
    provider: 'oc',
    launch: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:20128/v1' },
    capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
    models: [
      { model: 'cc/claude-opus-5', cost: { inputPerMillion: 10, outputPerMillion: 30 } },
      { model: 'cc/claude-haiku-4-5-20251001', cost: { inputPerMillion: 0.8, outputPerMillion: 4 } },
    ],
  };

  test('the oc provider is no longer refused — the probe reaches the run step', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    let ranCommand = null;
    // Simulate a real OpenAI completion response with HTTP status trailer.
    const fakeCompletion = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }],
    });
    const fakeStdout = fakeCompletion + '\n' + q.HTTP_STATUS_TRAILER + '200';
    const record = await q.probeAccount({
      accountId: 'ninerouter',
      accounts: [ocAccount],
      file,
      io,
      now,
      isEntryAdmitted: () => true,
      run: async (command) => {
        ranCommand = command;
        return { outcome: 'pass', reason: 'answered', stdout: fakeStdout };
      },
    });
    assert.strictEqual(record.outcome, 'pass');
    assert.strictEqual(record.model, 'cc/claude-haiku-4-5-20251001');
    assert.ok(ranCommand !== null, 'the probe must have run a command');
    assert.ok(ranCommand.includes('curl'), 'an openai-compatible probe uses curl');
    assert.ok(ranCommand.includes('127.0.0.1:20128'), 'the command targets the gateway');
  });

  test('an unknown provider is still refused and no command is run', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const record = await q.probeAccount({
      accountId: 'ninerouter',
      accounts: [{ ...ocAccount, provider: 'martian' }],
      file,
      io,
      now,
      run: async () => {
        throw new Error('must not reach here');
      },
    });
    assert.strictEqual(record.outcome, 'refused');
    assert.ok(record.reason.includes('has no reader'));
  });
});

// ---------------------------------------------------------------------------
// Response validation — a pass requires evidence the model answered
// ---------------------------------------------------------------------------

describe('parseProbeOutput — response validation', () => {
  test('an HTTP 401 error body is a fail, not a pass', () => {
    const errorBody = JSON.stringify({
      error: { message: 'Missing API key', type: 'authentication_error', code: 'invalid_api_key' },
    });
    const stdout = errorBody + '\n' + q.HTTP_STATUS_TRAILER + '401';
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout,
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('401'));
    assert.ok(result.reason.includes('Missing API key'));
  });

  test('an HTTP 403 preserves the gateway reason in the evidence', () => {
    const errorBody = JSON.stringify({
      error: { message: 'Forbidden: quota exceeded', type: 'forbidden' },
    });
    const stdout = errorBody + '\n' + q.HTTP_STATUS_TRAILER + '403';
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout,
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('403'));
    assert.ok(result.reason.includes('quota exceeded'));
  });

  test('an HTTP 500 from upstream is a fail with the error preserved', () => {
    const errorBody = JSON.stringify({
      error: { message: 'Internal server error', type: 'server_error' },
    });
    const stdout = errorBody + '\n' + q.HTTP_STATUS_TRAILER + '500';
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout,
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('500'));
  });

  test('an HTTP 502 from upstream is a fail', () => {
    const stdout = 'Bad Gateway\n' + q.HTTP_STATUS_TRAILER + '502';
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout,
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('502'));
  });

  test('a real HTTP 200 completion is a pass with the status in the reason', () => {
    const completion = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }],
    });
    const stdout = completion + '\n' + q.HTTP_STATUS_TRAILER + '200';
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout,
    });
    assert.strictEqual(result.outcome, 'pass');
    assert.ok(result.reason.includes('200'));
  });

  test('HTTP 200 with no choices array is a fail', () => {
    const stdout = '{"id":"x","object":"chat.completion"}\n' + q.HTTP_STATUS_TRAILER + '200';
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout,
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('no choices'));
  });

  test('HTTP 200 with invalid JSON body is a fail', () => {
    const stdout = 'not json at all\n' + q.HTTP_STATUS_TRAILER + '200';
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout,
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('not valid JSON'));
  });

  test('no HTTP status trailer (missing -w) is a fail', () => {
    const errorBody = JSON.stringify({
      error: { message: 'Missing API key' },
    });
    const result = q.parseProbeOutput('openai-compatible', {
      outcome: 'pass', reason: 'answered', stdout: errorBody,
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('???') || result.reason.includes('0'));
  });

  test('cli launch kind with non-empty stdout is accepted', () => {
    const result = q.parseProbeOutput('cli', {
      outcome: 'pass', reason: 'answered', stdout: 'ready',
    });
    assert.strictEqual(result, null); // no override, raw outcome stands
  });

  test('cli launch kind with empty stdout is a fail', () => {
    const result = q.parseProbeOutput('cli', {
      outcome: 'pass', reason: 'answered', stdout: '',
    });
    assert.strictEqual(result.outcome, 'fail');
    assert.ok(result.reason.includes('no output'));
  });

  test('docker-compose launch kind follows the same rule as cli', () => {
    const pass = q.parseProbeOutput('docker-compose', {
      outcome: 'pass', reason: 'answered', stdout: 'something',
    });
    assert.strictEqual(pass, null);

    const fail = q.parseProbeOutput('docker-compose', {
      outcome: 'pass', reason: 'answered', stdout: '  \n  ',
    });
    assert.strictEqual(fail.outcome, 'fail');
  });

  test('non-pass outcomes are never overridden', () => {
    for (const outcome of ['fail', 'timeout', 'refused']) {
      const result = q.parseProbeOutput('openai-compatible', {
        outcome, reason: 'already failed', stdout: '',
      });
      assert.strictEqual(result, null, `outcome ${outcome} should not be overridden`);
    }
  });
});

describe('probeAccount — HTTP error body produces fail, not pass (end-to-end)', () => {
  const now = 1_800_000_000_000;
  const ocAccount = {
    id: 'ninerouter',
    provider: 'oc',
    launch: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:20128/v1' },
    capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
    models: [
      { model: 'cc/claude-haiku-4-5-20251001', cost: { inputPerMillion: 0.8, outputPerMillion: 4 } },
    ],
  };

  test('a 401 from the gateway is recorded as fail with the error message', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const errorBody = JSON.stringify({
      error: { message: 'Missing API key', type: 'authentication_error', code: 'invalid_api_key' },
    });
    const record = await q.probeAccount({
      accountId: 'ninerouter',
      accounts: [ocAccount],
      file,
      io,
      now,
      isEntryAdmitted: () => true,
      run: async () => ({
        outcome: 'pass',
        reason: 'answered',
        stdout: errorBody + '\n' + q.HTTP_STATUS_TRAILER + '401',
      }),
    });
    assert.strictEqual(record.outcome, 'fail');
    assert.ok(record.reason.includes('401'));
    assert.ok(record.reason.includes('Missing API key'));
    // Verify the fail is written to the store, not just returned.
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(stored['ninerouter@cc/claude-haiku-4-5-20251001'].outcome, 'fail');
  });

  test('a real completion from the gateway is recorded as pass', async () => {
    const file = tmpFile();
    const io = { fs, fileIo: { writeFileSync: (p, c) => fs.writeFileSync(p, c) } };
    const completion = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }],
    });
    const record = await q.probeAccount({
      accountId: 'ninerouter',
      accounts: [ocAccount],
      file,
      io,
      now,
      isEntryAdmitted: () => true,
      run: async () => ({
        outcome: 'pass',
        reason: 'answered',
        stdout: completion + '\n' + q.HTTP_STATUS_TRAILER + '200',
      }),
    });
    assert.strictEqual(record.outcome, 'pass');
    assert.ok(record.reason.includes('200'));
  });
});
