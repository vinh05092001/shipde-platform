'use strict';

/**
 * Ship Dễ — TASK-AI-126: the Controller can launch agy-pool and AutoClaw
 * workers in live runs.
 *
 * Restores the coverage the fix commit removed and closes every review
 * finding (.upstream-tmp/findings1.md + findings2.md + findings3.md):
 *
 *   (a) HTTP 403 + body code 810002 is upstream_rate_limit, retryable, with
 *       retryAfterMs exactly 120000; a plain 403 stays upstream_entitlement;
 *       an unrelated 810002 substring never forces a rate-limit cooldown.
 *   (b) an autoclaw candidate has a concrete accountId (never '*') and the
 *       Controller selection actually picks it when it is the best candidate
 *       (no WILDCARD_ACCOUNT) — the same for the agy-pool accounts.
 *   (c) the AL-R03 launcher is proven with a fake spawn: with the
 *       --external-workers flag it builds the autoclaw/agy-pool launch
 *       (prompt file, job.json, token passed only through the
 *       OPENCLAW_GATEWAY_TOKEN env var name — never the value) and without
 *       the flag it does not.
 *   (d) the AL-R04 reviewer role may select an autoclaw candidate and the
 *       review prompt carries the diff inline (no tool use).
 *   (e) findings3 P1: every test runs under a per-test temp home with
 *       os.homedir mocked, so no test in this file can read the host
 *       ~/.openclaw-autoclaw/.gateway-token at all; the tests that drive the
 *       external launcher plant a sentinel token in the temp home and assert
 *       the launcher surfaces exactly that sentinel (never a host value).
 *   (f) findings3 P2: "AL-R05: agy account validation" is labelled baseline
 *       regression — the adapter refusal predates this Work Item and the test
 *       passes on origin/main as well; the fail-on-main instance for invalid
 *       accounts is the seam check inside "AL-R03: the agy-pool external
 *       launch writes job.json and triggers the scheduled task".
 *
 * Every spawn is faked before the harness modules capture `spawnSync`, so
 * openclaw, schtasks and taskkill never reach the real OS; no network is
 * touched; no real gateway token is read (the token file only ever exists
 * under the mocked os.homedir() temp home); and every side effect stays in
 * temp directories that the suite removes.
 */

const cp = require('child_process');

const REAL_SPAWN = cp.spawnSync;
const spawnCalls = [];
cp.spawnSync = (cmd, args, opts) => {
  spawnCalls.push({
    cmd: String(cmd),
    args: (args || []).map((a) => String(a)),
    opts: opts || {},
  });
  return { status: 0, stdout: 'ok', stderr: '' };
};

const { describe, test, mock, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getHarness } = require('../harness');
const { classifyFailure } = require('../failure-classifier');
const { generateCandidates } = require('../candidates');
const sourcesApi = require('../sources');
const orch = require('../orchestrate');
const routing = require('../routing');
const ranking = require('../ranking');
const { compileReviewPrompt } = require('../prompt-compiler');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TOKEN_SENTINEL = 'FAKE-GATEWAY-TOKEN-sentinel-123';
const ENV_TOKEN_SENTINEL = 'PREEXISTING-ENV-TOKEN-should-be-ignored';

const tmpDirs = [];
function tmpDir(prefix) {
  const upstreamDir = path.join(REPO_ROOT, '.upstream-tmp');
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  tmpDirs.push(dir);
  return dir;
}

/**
 * findings3 P1: the suite must never read the host's real
 * ~/.openclaw-autoclaw/.gateway-token. Every test runs with os.homedir()
 * pointing at its own empty temp home, so any token read resolves inside a
 * temp directory this suite created and removes.
 */
function freshTempHome() {
  return tmpDir('task-ai-126-home-');
}

/**
 * Plant a sentinel gateway token under the mocked home and return the
 * directory the launcher will look in. Tests assert the launcher surfaces
 * exactly this sentinel, which fails if the real host home leaks in.
 */
function plantGatewayToken(home) {
  const tokenDir = path.join(home, '.openclaw-autoclaw');
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(path.join(tokenDir, '.gateway-token'), TOKEN_SENTINEL + '\n');
  return tokenDir;
}

const ASSESSMENT = {
  weightProfile: 'BALANCED',
  weights: { latency: 34, quality: 33, cost: 33 },
};

function profile(overrides) {
  return Object.assign(
    {
      taskId: 'TASK-AI-126-TEST',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 4000,
      expectedDuration: 30000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 10000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 4,
      currentWorkload: 0,
    },
    overrides || {}
  );
}

function generated() {
  const registry = sourcesApi.loadSources({ file: path.join(__dirname, '..', 'sources.json') });
  return generateCandidates({ registry, discoverPool: false, openCodeIds: [] });
}

function rank(profileOverrides, candidates) {
  return routing.rankForProfile(candidates, profile(profileOverrides), ASSESSMENT, {
    now: Date.parse('2026-10-09T12:00:00Z'),
    headrooms: { default: 'open' },
  });
}

function spawnMatching(pred) {
  return spawnCalls.find(pred);
}

let home;

beforeEach(() => {
  spawnCalls.length = 0;
  // findings3 P1: no test in this file can reach the host gateway token.
  // os.homedir() is a fresh temp home for every test, and the host env token
  // is removed for the test's duration (removed only — never read).
  home = freshTempHome();
  mock.method(os, 'homedir', () => home);
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
});

afterEach(() => {
  mock.restoreAll();
});

after(() => {
  cp.spawnSync = REAL_SPAWN;
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('TASK-AI-126', () => {
  test('AL-R01: autoclaw argv building without the token value', () => {
    const adapter = getHarness('autoclaw');
    assert.ok(adapter, 'the autoclaw harness adapter is registered');

    const cwd = tmpDir('task-ai-126-cwd-');
    const prompt = 'Test message';
    const usageFile = path.join(cwd, 'usage.json');
    const args = adapter.launch({
      model: 'zai/zai_auto',
      cwd,
      prompt,
      sessionId: 's123',
      usageFile,
    });

    // Check that we have the openclaw args
    assert.ok(args.includes('agent'));
    assert.ok(args.includes('--agent'));
    assert.ok(args.includes('main'));
    assert.ok(args.includes('--session-id'));
    assert.ok(args.includes('s123'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('zai/zai_auto'));
    assert.ok(args.includes('--message'));

    // Must NOT contain token
    const hasTokenArg = args.some(
      (a) => String(a).includes('gateway-token') || String(a).includes('TOKEN')
    );
    assert.ok(!hasTokenArg, 'must not pass token in argv');

    // The documented argv shape carries the pinned timeout in seconds.
    const timed = adapter.launch(
      { model: 'zai/zai_auto', cwd: tmpDir('task-ai-126-cwd-'), prompt, sessionId: 's123' },
      { timeoutMs: 1800000 }
    );
    assert.deepEqual(timed.slice(0, 9), [
      'agent',
      '--agent',
      'main',
      '--session-id',
      's123',
      '--model',
      'zai/zai_auto',
      '--timeout',
      '1800',
    ]);
    assert.equal(timed[9], '--message');
    assert.equal(timed.length, 11);

    // TASK-AI-113 prompt-file pattern: a short instruction, never the prompt.
    const messageArg = args[args.indexOf('--message') + 1];
    assert.ok(messageArg.length < 4000, 'the message arg stays short');
    assert.ok(!messageArg.includes(prompt), 'the full prompt never travels inline');
    assert.match(messageArg, /Read the file \.shipde\/prompt-[0-9a-f]{32}\.md/);

    const shipdeDir = path.join(cwd, '.shipde');
    const promptFiles = fs
      .readdirSync(shipdeDir)
      .filter((f) => /^prompt-[0-9a-f]{32}\.md$/.test(f));
    assert.equal(promptFiles.length, 1, 'exactly one prompt file is written');
    assert.equal(
      fs.readFileSync(path.join(shipdeDir, promptFiles[0]), 'utf8'),
      prompt,
      'the prompt file is byte-equal'
    );

    // AL-R01 reports the session id; the usage file carries only that id.
    assert.equal(
      adapter.sessionIdFrom({ session_id: 's123' }),
      's123',
      'the session id is reported'
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(usageFile, 'utf8')), { session_id: 's123' });
  });

  test('AL-R01: 810002 classification', () => {
    // The documented real shape: HTTP 403 with body code 810002 (findings1 #1).
    const res = classifyFailure({ stdout: 'Error 810002: high demand', httpStatus: 403 });
    assert.equal(res.cause, 'upstream_rate_limit');
    assert.equal(res.retryable, true);
    assert.equal(res.retryAfterMs, 120000);
    assert.equal(res.humanAction, 'none', 'a transient throttle never demands a human');

    const bodyShape = classifyFailure({
      body: '{"code":810002,"message":"high demand"}',
      httpStatus: 403,
    });
    assert.equal(bodyShape.cause, 'upstream_rate_limit');
    assert.equal(bodyShape.retryable, true);
    assert.equal(bodyShape.retryAfterMs, 120000);

    // A plain 403 is still entitlement (findings2 (a)).
    const plain = classifyFailure({ stdout: 'Error: subscription required', httpStatus: 403 });
    assert.equal(plain.cause, 'upstream_entitlement');
    assert.equal(plain.retryable, false);
    assert.equal(plain.humanAction, 'required');

    // Anchored rule (findings1 #2): an unrelated 6-digit match must never
    // force a 120 s rate-limit cooldown.
    const unrelated = classifyFailure({ stdout: 'Error 123810002765 broke', httpStatus: 403 });
    assert.equal(unrelated.cause, 'upstream_entitlement');
    const unrelatedNoStatus = classifyFailure({ stdout: 'x 123810002765 y' });
    assert.notEqual(unrelatedNoStatus.cause, 'upstream_rate_limit');
  });

  test('AL-R02: candidate registration with failure domains', () => {
    const candidates = generated();

    const agyCandidates = candidates.filter((c) => c.harness === 'agy-pool');
    assert.ok(agyCandidates.length > 0, 'agy-pool candidates must be registered');
    assert.deepEqual(
      [...new Set(agyCandidates.map((c) => c.accountId))].sort(),
      ['agy01', 'agy02', 'agy03', 'agy04', 'agy05', 'agy06', 'agy07', 'agy08', 'agy09', 'agy10'],
      'one candidate account per scheduled task'
    );
    for (const c of agyCandidates) {
      assert.equal(c.upstream, 'antigravity');
      assert.match(
        c.quotaScope,
        new RegExp('^' + c.accountId + ':(gemini|claude-gpt)$'),
        'the agy quota scope is <account>:<family>'
      );
      assert.match(c.accountId, /^agy\d{2}$/);
    }

    const autoCandidates = candidates.filter((c) => c.harness === 'autoclaw');
    assert.ok(autoCandidates.length > 0, 'autoclaw candidates must be registered');
    assert.deepEqual(
      [...new Set(autoCandidates.map((c) => c.modelId))].sort(),
      ['zai/zai_auto', 'zai/zai_glm-5.3-flash'],
      'both usable zai models are registered'
    );
    for (const c of autoCandidates) {
      assert.equal(c.upstream, 'zai');
      assert.equal(c.quotaScope, 'zai', 'the autoclaw failure domain is autoclaw/zai');
      assert.ok(c.accountId && c.accountId !== '*', 'the autoclaw accountId is concrete');
    }
  });

  test('AL-R02: the Controller selects an autoclaw candidate with a concrete account and no WILDCARD_ACCOUNT', () => {
    const auto = generated().filter((c) => c.harness === 'autoclaw');
    assert.ok(auto.length > 0);
    for (const c of auto) {
      assert.ok(c.accountId && c.accountId !== '*', 'concrete accountId, never *');
    }

    // The pre-fix shape (accountId '*') is the negative control: the chooser
    // must reject it with WILDCARD_ACCOUNT while picking the concrete one.
    const wildcardTwin = {
      harness: 'autoclaw',
      accessPath: 'cli',
      gateway: '',
      upstream: 'zai',
      accountId: '*',
      quotaScope: 'zai',
      modelId: 'zai/zai_auto',
    };

    const result = rank({ role: 'writer' }, auto.concat([wildcardTwin]));
    assert.ok(result.chosen, 'the Controller picks an autoclaw candidate: ' + result.reason);
    assert.ok(
      result.chosen.includes('::autoclaw::'),
      'the chosen candidate carries the concrete account: ' + result.chosen
    );
    assert.deepEqual(
      result.rejected.filter((r) => r.reasonCode === 'WILDCARD_ACCOUNT').map((r) => r.accountId),
      ['*'],
      'only the wildcard twin is WILDCARD_ACCOUNT'
    );
    assert.ok(
      !result.rejected.some(
        (r) => r.reasonCode === 'WILDCARD_ACCOUNT' && r.accountId === 'autoclaw'
      ),
      'a concrete autoclaw candidate is never WILDCARD_ACCOUNT'
    );

    // The ranking engine's own wildcard gate (ranking.js) agrees.
    const decision = ranking.rankAndRecord(auto, {
      workItemId: 'TASK-AI-126-TEST',
      role: 'reviewer',
      kind: 'reviewer',
      dryRun: true,
      explorationBudget: 1,
      useStoredQuota: false,
    });
    assert.ok(decision.chosen, 'ranking picks the autoclaw candidate: ' + decision.reason);
    assert.ok(
      decision.chosen.includes('::autoclaw::'),
      'ranking chose the concrete account: ' + decision.chosen
    );
    assert.ok(
      !decision.rejected.some((r) => r.reason === 'WILDCARD_ACCOUNT'),
      'ranking never rejects the concrete account as WILDCARD_ACCOUNT'
    );
  });

  test('AL-R02: the Controller selects an agy-pool candidate with a concrete account and no WILDCARD_ACCOUNT', () => {
    const agy = generated().filter((c) => c.harness === 'agy-pool');
    assert.ok(agy.length > 0);
    for (const c of agy) {
      assert.ok(c.accountId && c.accountId !== '*', 'concrete accountId, never *');
    }

    const result = rank({ role: 'writer' }, agy);
    assert.ok(result.chosen, 'the Controller picks an agy-pool candidate: ' + result.reason);
    assert.ok(result.chosen.startsWith('agy-pool::'), 'chosen is agy-pool: ' + result.chosen);
    assert.ok(
      !result.rejected.some((r) => r.reasonCode === 'WILDCARD_ACCOUNT'),
      'agy-pool candidates are never WILDCARD_ACCOUNT'
    );
  });

  test('AL-R03: launcher flag gating and launch correctness', () => {
    const cwd = tmpDir('task-ai-126-cwd-');
    // findings3 P1: the launch runs under the mocked temp home with a planted
    // sentinel token. Asserting the launcher surfaces exactly that sentinel
    // fails on every host if the real ~/.openclaw-autoclaw/.gateway-token is
    // ever consulted instead.
    plantGatewayToken(home);

    const noLauncher = orch.resolveLauncher({ externalWorkers: '' }, null);
    assert.equal(noLauncher, null, 'must be null if missing launcher flag');

    const launcher = orch.resolveLauncher({ externalWorkers: 'autoclaw' }, null);
    assert.equal(typeof launcher, 'function', 'the flag enables the host-sandboxed launcher');

    const job = {
      harness: 'autoclaw',
      model: 'zai/zai_auto',
      cwd,
      prompt: 'dummy',
      sessionId: 's456',
    };
    const res = launcher(job);
    assert.equal(res.exitCode, 0);

    const call = spawnMatching((c) => c.args.includes('--session-id') && c.args.includes('s456'));
    assert.ok(call, 'the launch really spawns the openclaw CLI (fake spawn)');
    assert.ok(
      String(call.cmd).includes('openclaw') || call.args.some((a) => a.includes('openclaw')),
      'the spawned command is openclaw'
    );
    assert.ok(
      call.opts.env.OPENCLAW_GATEWAY_TOKEN === TOKEN_SENTINEL,
      'the token comes from the mocked temp home, never the host gateway token'
    );
    assert.ok(!call.args.some((a) => a.includes(TOKEN_SENTINEL)), 'no token value in argv');

    // Without the flag the external launch is not built at all: the isolated
    // path keeps the job and nothing spawns.
    spawnCalls.length = 0;
    let isolatedCalls = 0;
    const isolated = orch.resolveLauncher({ externalWorkers: '' }, () => {
      isolatedCalls += 1;
      return { exitCode: 7, stdout: '', stderr: '' };
    });
    const isoRes = isolated(Object.assign({}, job, { sessionId: 's457' }));
    assert.equal(isoRes.exitCode, 7, 'the isolated launcher still handles the job');
    assert.equal(isolatedCalls, 1);
    assert.equal(spawnCalls.length, 0, 'no openclaw spawn without the external flag');

    // The flag gates per harness: agy-pool alone never launches autoclaw.
    spawnCalls.length = 0;
    const agyOnly = orch.resolveLauncher({ externalWorkers: 'agy-pool' }, null);
    assert.throws(
      () => agyOnly(Object.assign({}, job, { sessionId: 's458' })),
      /LAUNCHER_MISSING/,
      'autoclaw is not in --external-workers'
    );
    assert.equal(spawnCalls.length, 0, 'nothing spawns for a harness outside the flag');
  });

  test('AL-R03: the external launch passes the token only through the env var name', () => {
    const cwd = tmpDir('task-ai-126-cwd-');
    plantGatewayToken(home);

    const hadEnvToken = Object.prototype.hasOwnProperty.call(process.env, 'OPENCLAW_GATEWAY_TOKEN');
    const prevEnvToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    process.env.OPENCLAW_GATEWAY_TOKEN = ENV_TOKEN_SENTINEL;

    try {
      const launcher = orch.resolveLauncher({ externalWorkers: 'autoclaw' }, null);
      const usageFile = path.join(cwd, 'usage.json');
      const res = launcher({
        harness: 'autoclaw',
        model: 'zai/zai_auto',
        cwd,
        prompt: 'token-safety prompt',
        sessionId: 's-token',
        usageFile,
      });
      assert.equal(res.exitCode, 0);

      const call = spawnMatching((c) => c.args.includes('s-token'));
      assert.ok(call, 'the openclaw spawn happened (fake spawn)');

      // The token travels ONLY through the env var name. Boolean assert so a
      // leak can never echo a real token value in the failure message.
      assert.ok(
        call.opts.env.OPENCLAW_GATEWAY_TOKEN === TOKEN_SENTINEL,
        'the token file under the mocked home is the source'
      );
      const carriers = Object.keys(call.opts.env).filter((k) =>
        String(call.opts.env[k]).includes(TOKEN_SENTINEL)
      );
      assert.deepEqual(
        carriers,
        ['OPENCLAW_GATEWAY_TOKEN'],
        'the env var name is the only carrier of the token value'
      );

      // ...and never the value anywhere else: argv, prompt file, usage file.
      assert.ok(!call.args.some((a) => a.includes(TOKEN_SENTINEL)), 'no token value in argv');
      assert.ok(
        !call.args.some((a) => a.includes(ENV_TOKEN_SENTINEL)),
        'no preexisting env token in argv'
      );
      const hasTokenArg = call.args.some(
        (a) => String(a).includes('gateway-token') || String(a).includes('TOKEN')
      );
      assert.ok(!hasTokenArg, 'must not pass token in argv');
      for (const name of fs.readdirSync(path.join(cwd, '.shipde'))) {
        const body = fs.readFileSync(path.join(cwd, '.shipde', name), 'utf8');
        assert.ok(!body.includes(TOKEN_SENTINEL), 'no token value in the prompt file');
      }
      const usage = fs.readFileSync(usageFile, 'utf8');
      assert.ok(!usage.includes(TOKEN_SENTINEL), 'no token value in the usage file');
      assert.deepEqual(JSON.parse(usage), { session_id: 's-token' });
    } finally {
      if (hadEnvToken) process.env.OPENCLAW_GATEWAY_TOKEN = prevEnvToken;
      else delete process.env.OPENCLAW_GATEWAY_TOKEN;
    }
  });

  test('AL-R03: the agy-pool external launch writes job.json and triggers the scheduled task', () => {
    const cwd = tmpDir('task-ai-126-cwd-');
    const runsDir = tmpDir('task-ai-126-runs-');
    const hadRuns = Object.prototype.hasOwnProperty.call(process.env, 'AGY_POOL_RUNS_DIR');
    const prevRuns = process.env.AGY_POOL_RUNS_DIR;
    process.env.AGY_POOL_RUNS_DIR = runsDir;

    try {
      const launcher = orch.resolveLauncher({ externalWorkers: 'agy-pool' }, null);
      const res = launcher({
        harness: 'agy-pool',
        accountId: 'agy01',
        cwd,
        prompt: 'pool prompt',
        model: 'gemini-3.1-pro-low',
        candidateKey:
          'agy-pool::ShipDe\ShipDe-agy01::::antigravity::agy01::agy01:gemini::gemini-3.1-pro-low',
      });
      assert.equal(res.exitCode, 0);

      const call = spawnMatching((c) => c.args.includes('/tn'));
      assert.ok(call, 'the scheduled task is triggered (fake spawn, never real schtasks)');
      assert.ok(String(call.cmd).includes('schtasks'), 'the spawned command is schtasks');
      assert.deepEqual(call.args, ['/run', '/tn', 'ShipDe\\ShipDe-agy01'], 'schtasks argv');
      assert.ok(
        !('OPENCLAW_GATEWAY_TOKEN' in call.opts.env),
        'no gateway token reaches the agy launch env'
      );

      const jobJson = JSON.parse(fs.readFileSync(path.join(runsDir, 'agy01', 'job.json'), 'utf8'));
      assert.equal(jobJson.harness, 'agy-pool');
      assert.equal(jobJson.accountId, 'agy01');
      assert.equal(jobJson.prompt, 'pool prompt');
      assert.equal(jobJson.model, 'gemini-3.1-pro-low');

      // findings3 P2: this seam check is the fail-on-main instance of AL-R05 —
      // the launcher gate is new in this Work Item, so an invalid account that
      // must never reach a scheduled task only exists behind it.
      spawnCalls.length = 0;
      const refused = launcher({ harness: 'agy-pool', accountId: 'nope', cwd, prompt: 'p' });
      assert.equal(refused.refusal, 'INVALID_ACCOUNT_ID');
      assert.equal(spawnCalls.length, 0);
    } finally {
      if (hadRuns) process.env.AGY_POOL_RUNS_DIR = prevRuns;
      else delete process.env.AGY_POOL_RUNS_DIR;
    }
  });

  test('AL-R04: the reviewer role selects an autoclaw candidate and the review prompt carries the diff inline', () => {
    const auto = generated().filter((c) => c.harness === 'autoclaw');
    assert.ok(auto.length > 0);

    const result = rank({ role: 'reviewer' }, auto);
    assert.ok(
      result.chosen,
      'the reviewer role may select an autoclaw candidate: ' + result.reason
    );
    assert.ok(
      result.chosen.includes('::autoclaw::'),
      'reviewer selected autoclaw: ' + result.chosen
    );
    assert.ok(
      !result.rejected.some((r) => r.reasonCode === 'WILDCARD_ACCOUNT'),
      'the reviewer never sees a WILDCARD_ACCOUNT block'
    );

    // A review prompt for autoclaw includes the diff inline (no tool use).
    const diffText = 'diff --git a/src/x.js b/src/x.js\n+const SENTINEL_DIFF_LINE = 1;\n';
    const prompt = compileReviewPrompt(
      {
        id: 'ITEM-REVIEW',
        allowedPaths: ['tools/ai-brain/**'],
        acceptanceCriteria: ['AC-1 is proven by a test'],
      },
      {
        goal: 'review the diff',
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        diffText,
        verdictFile: path.join('verdict', 'verdict.json'),
        usageFile: path.join('verdict', 'usage.json'),
        candidateKey: result.chosen,
      }
    );
    assert.ok(prompt.includes('SENTINEL_DIFF_LINE'), 'the diff is inline in the review prompt');
    assert.ok(
      prompt.includes('Diff (' + 'b'.repeat(40) + '..' + 'a'.repeat(40) + '):'),
      'the prompt names the exact diff range'
    );
    assert.ok(!/git diff/i.test(prompt), 'the reviewer needs no tool to read the diff');
  });

  test('AL-R05: agy account validation (baseline regression)', () => {
    // findings3 P2: baseline regression coverage only. The agy-pool adapter's
    // INVALID_ACCOUNT_ID refusal predates this Work Item, so this direct check
    // passes on origin/main as well and is not the fail-on-main guard. The
    // fail-on-main instance for invalid accounts is the seam check inside
    // "AL-R03: the agy-pool external launch writes job.json and triggers the
    // scheduled task", which only exists behind the new launcher gate.
    const adapter = getHarness('agy-pool');
    const res = adapter.launch({ accountId: 'invalid' }, {});
    assert.equal(res.state, 'error');
    assert.equal(res.refusal, 'INVALID_ACCOUNT_ID');
  });

  test('AL-R06: every AL-R0x maps to a named test and the register row 239 is one 14-column row', () => {
    const workItem = fs.readFileSync(
      path.join(REPO_ROOT, 'docs', 'product-spec', 'work-items', 'TASK-AI-126.md'),
      'utf8'
    );
    const lines = workItem.split(/\r?\n/);
    for (const ac of ['AL-R01', 'AL-R02', 'AL-R03', 'AL-R04', 'AL-R05', 'AL-R06']) {
      const rows = lines.filter((l) => l.startsWith('| ' + ac + ' |'));
      assert.ok(rows.length > 0, ac + ' has an acceptance matrix row');
      for (const row of rows) {
        assert.ok(row.includes('task-ai-126.test.js'), ac + ' maps to the named test file');
        const named = [...row.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
        assert.ok(
          named.some((n) => n.startsWith(ac + ':')),
          ac + ' maps to a named test: ' + row
        );
      }
    }

    const register = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'docs',
        'product-spec',
        'docs',
        '10-ai-collaboration',
        'FEATURE-DELIVERY-REGISTER.csv'
      ),
      'utf8'
    );
    const rows = register.split(/\r?\n/).filter((l) => l.includes('"TASK-AI-126"'));
    assert.equal(rows.length, 1, 'exactly one register row for TASK-AI-126');
    const cols = rows[0].match(/"[^"]*"/g) || [];
    assert.equal(cols.length, 14, 'the register row keeps the 14-column quoted format');
    assert.equal(cols[0], '"239"');
    assert.equal(cols[3], '"TASK-AI-126"');
    assert.equal(cols[9], '"docs/product-spec/work-items/TASK-AI-126.md"');
    assert.equal(cols[10], '"feat/task-ai-126-agy-autoclaw-live"');
  });
});
