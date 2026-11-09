'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorktreeClaim } = require('./helpers/worktree-claim');

// Install before requiring the CLI: even a swallowed connection error fails teardown.
function offline(t, expectedAttempts = []) {
  const attempts = [];
  const deny = (api) => () => {
    attempts.push(api);
    throw new Error('OFFLINE_REPLAY_FORBIDDEN: ' + api);
  };
  t.mock.method(require('node:net').Socket.prototype, 'connect', deny('socket.connect'));
  t.mock.method(require('node:tls'), 'connect', deny('tls.connect'));
  t.mock.method(require('node:http2'), 'connect', deny('http2.connect'));
  t.mock.method(require('node:dgram'), 'createSocket', deny('dgram.createSocket'));
  for (const dns of [require('node:dns'), require('node:dns/promises')]) {
    for (const api of Object.keys(dns).filter((key) => /^(lookup|resolve|reverse)/.test(key))) {
      t.mock.method(dns, api, deny('dns.' + api));
    }
  }
  t.mock.method(globalThis, 'fetch', deny('fetch'));
  const cp = require('node:child_process');
  for (const api of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    t.mock.method(cp, api, deny('child_process.' + api));
  }
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const name = path.basename(String(file));
    if (/^(\.env.*|\.pgpass|.*auth.*\.json|credentials.*)$/i.test(name)) {
      return deny('credential read')();
    }
    return read.call(this, file, ...args);
  });
  t.after(() =>
    assert.deepEqual(
      attempts,
      expectedAttempts,
      'no unexpected network, credential reads or real workers'
    )
  );
}

test('offline guard intercepts socket connects and swallowed transport errors before dispatch', (t) => {
  offline(t, ['socket.connect', 'tls.connect', 'fetch', 'child_process.spawn', 'credential read']);
  const socket = new (require('node:net').Socket)();
  assert.throws(() => socket.connect({ host: 'fixture.invalid', port: 1 }), /FORBIDDEN/);
  socket.destroy();
  // A caller may catch these errors; the teardown still checks every attempted effect.
  assert.throws(() => require('node:tls').connect({ host: 'fixture.invalid' }), /FORBIDDEN/);
  assert.throws(() => fetch('https://fixture.invalid'), /FORBIDDEN/);
  assert.throws(() => require('node:child_process').spawn('fake-worker'), /FORBIDDEN/);
  assert.throws(() => fs.readFileSync('fake/.env.offline'), /FORBIDDEN/);
});

const fixtureDir = path.join(__dirname, 'fixtures');
const json = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
const text = (name) => fs.readFileSync(path.join(fixtureDir, 'compression-eval', name), 'utf8');

function fixture(t, kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = json('task-ai-73/sources-new-provider.json');
  const profile = json('task-ai-73/sample-task-profile.json');
  const account = json('task-ai-73/accounts-new-provider.json').accounts[0];
  const template = json('task-ai-73/catalogue-new-provider.jsonl');
  const router = registry.sources.find((s) => s.kind === 'router');
  const external = registry.sources.find((s) => s.id === account.provider);
  registry.sources = [router, external];
  // All identities are synthetic; limits and quality come from existing fake fixtures.
  const branch = 'fake/member';
  const combo = 'fake-combo';
  registry.dispatch = {
    nineRouterWriterCombo: combo,
    providers: {
      [router.id]: { harness: template.harness, provider: 'opencode', modelPrefix: 'gateway/' },
      [external.id]: { harness: template.harness, provider: 'opencode', modelPrefix: 'external/' },
    },
    launchModes: { opencode: ['full-access'] },
  };
  const route = (source, modelId, extra = {}) => ({
    source: source.id,
    gateway: source.id,
    modelId,
    upstream: source.id,
    accountId: source.id + '-fixture',
    ...extra,
  });
  const definitions = [
    route(router, branch, { upstream: 'fake' }),
    route(router, combo, { isCombo: true, comboMembers: [branch] }),
    route(external, 'fake/external'),
    route(router, 'fake/unhealthy'),
    route(external, 'fake/no-budget', { budget: 'UNKNOWN' }),
  ];
  const now = Date.parse(template.ts);
  const selectedIndex = ['individual', 'combo', 'external'].indexOf(kind);
  const rows = definitions.map((row, index) => ({
    ...template,
    ...row,
    account: undefined,
    harness: template.harness,
    accessPath: 'cli',
    contextWindow: profile.contextSize,
    latencyMs: index === selectedIndex ? template.latencyMs : profile.expectedDuration,
    capabilities: { ...account.capabilities, 'workspace-edit': true },
    capabilityEvidence: Object.fromEntries(
      profile.requiredCapabilities.map((cap) => [
        cap,
        { ok: true, observedAt: template.ts, source: 'fixture-probe' },
      ])
    ),
    qualifiedRoles: ['author.foundation'],
    cost: index === selectedIndex ? template.latencyMs : profile.costCeiling,
    evidence: [{ status: 'passed', proofLevel: template.proofLevel, at: template.ts }],
  }));
  const routeHealth = {
    paths: Object.fromEntries(
      rows.map((c) => [
        `${c.modelId}|${c.gateway}@${c.accountId}`,
        {
          status: c.modelId === definitions[3].modelId ? 'AUTH_NEEDED' : 'AVAILABLE',
          lastCheckedAt: template.ts,
        },
      ])
    ),
  };
  const request = {
    workItemId: 'TASK-AI-171',
    outputTokens: profile.contextSize,
    minProof: template.proofLevel,
    maxFallbacks: 1,
    request: {
      cwd: root,
      branch: 'feat/task-ai-171-offline-replay',
      prompt: 'Replay a synthetic ticket offline',
      base: 'origin/main',
    },
  };
  return {
    root,
    registry,
    profile: { ...profile, taskId: request.workItemId },
    now,
    rows,
    routeHealth,
    request,
    selectedIndex,
  };
}

for (const kind of ['individual', 'combo', 'external']) {
  test(`offline replay: ${kind} request -> routes/scores -> decision -> argv -> diff -> test/review`, async (t) => {
    offline(t);
    const f = fixture(t, kind);
    const hostEnv = process.env;
    process.env = Object.fromEntries(
      f.registry.sources.map((s) => [s.credential.env, 'fixture-only'])
    );
    t.after(() => {
      process.env = hostEnv;
    });
    const { dispatchCommand } = require('../cli');
    const { candidateKey } = require('../candidates');
    const routing = require('../routing');
    const handoff = require('../route-handoff');
    const { getHarness } = require('../harness');
    const { readSessionId } = require('../executor');
    const { runReviewLoop, Status } = require('../review-loop');
    const onboarding = require('../rolling-onboard');
    const transcript = [{ stage: 'request', ticket: f.request }];
    const evidenceData = { combinations: [] };
    t.mock.method(onboarding, 'autoOnboardNewSources', async (sources) => {
      assert.deepEqual(
        sources.map((s) => s.id),
        f.registry.sources.map((s) => s.id)
      );
      transcript.push({ stage: 'onboarding-stub' });
      evidenceData.combinations = f.rows.map((c) => ({ ...c, model: c.modelId }));
    });
    const assessment = { weightProfile: 'BALANCED', weights: routing.WEIGHT_PROFILES.BALANCED };
    const decisionFile = path.join(f.root, 'decision.json');
    const comboConfig = {
      name: f.registry.dispatch.nineRouterWriterCombo,
      models: f.rows[1].comboMembers,
    };
    const claimHelper = createWorktreeClaim({ worktree: f.root });
    t.after(claimHelper.cleanup);
    const context = {
      ledger: {},
      evidenceData,
      now: f.now,
      quotaState: { scopes: {} },
      home: f.root,
      storePath: path.join(f.root, 'quota.json'),
      headrooms: { default: 'open' },
      ...claimHelper.context,
    };
    const dispatchArgs = {
      root: f.root,
      item: f.request.workItemId,
      'route-scope': 'combo-and-routes',
      'decision-log': decisionFile,
    };
    const dispatchDeps = {
      registry: f.registry,
      discoveryCatalogue: { candidates: f.rows },
      readDispatchComboConfig: () =>
        require('../writer-combo').readComboConfig({
          name: f.registry.dispatch.nineRouterWriterCombo,
          endpoint: 'https://fixture.invalid/v1',
          loadCliToken: () => 'fixture-only',
          httpRequest: async (req) => {
            assert.equal(req.method, 'GET');
            assert.equal(req.path, '/api/combos');
            return { status: 200, data: { combos: [comboConfig] } };
          },
        }),
      accounts: [],
      registryAccounts: [],
      offerings: [],
      discoverPool: false,
      env: process.env,
      ...context,
      routeHealth: f.routeHealth,
      evidenceDir: path.join(f.root, 'evidence'),
      decisionDir: path.join(f.root, 'decisions'),
      taskProfile: f.profile,
      assessment,
      priors: { ranking: [] },
      log: () => {},
      exit: () => {},
    };
    const result = await dispatchCommand({ ...dispatchArgs, 'dry-run': true }, dispatchDeps);
    assert.equal(result.exitCode, 0, JSON.stringify(result.decision?.rejected));
    assert.equal(transcript.filter((e) => e.stage === 'onboarding-stub').length, 1);
    const { decision } = result;
    const persisted = JSON.parse(fs.readFileSync(decisionFile, 'utf8'));
    assert.equal(persisted.workItemId, f.request.workItemId);
    for (const row of f.rows.slice(0, 3)) {
      const ranked = decision.candidates.find((c) => c.offeringId === candidateKey(row));
      assert.ok(ranked, 'all three route types are considered');
      const scored = routing.scoreForProfile(ranked, assessment, {
        ...context,
        role: f.profile.role,
        priors: { ranking: [] },
        registry: f.registry,
      });
      assert.equal(ranked.score, scored.score);
      assert.deepEqual(ranked.scoreBreakdown, scored.breakdown);
      assert.equal(ranked.scoreBreakdown.prior.priorUnknown, true);
      assert.ok(ranked.evidence.some((e) => e.proofLevel === f.request.minProof));
      transcript.push({
        stage: 'considered',
        offeringId: ranked.offeringId,
        score: ranked.score,
        source: { kind: 'fixture execution evidence', evidence: ranked.evidence },
      });
    }
    for (const [row, reason] of [
      [f.rows[3], 'AUTH_NEEDED'],
      [f.rows[4], 'BUDGET_UNKNOWN'],
    ]) {
      const excluded = decision.rejected.find((c) => c.offeringId === candidateKey(row));
      assert.equal(excluded?.reason, reason);
      assert.ok(!decision.candidates.some((c) => c.offeringId === excluded.offeringId));
      assert.ok(
        persisted.excluded.some((c) => c.offeringId === candidateKey(row) && c.reason === reason)
      );
      transcript.push({ stage: 'excluded', ...excluded });
    }
    assert.equal(persisted.selected, decision.chosen);
    const selected = decision.candidates.find((c) => c.offeringId === decision.chosen);
    if (kind === 'combo') assert.deepEqual(selected.comboMembers, f.rows[1].comboMembers);
    assert.equal(decision.chosen, candidateKey(f.rows[f.selectedIndex]));
    const replayDecision = {
      ...decision,
      workItemId: f.request.workItemId,
      selected: decision.chosen,
    };
    transcript.push({ stage: 'decision', selected: replayDecision.selected });
    const diffFile = path.join(f.root, 'worker.diff');
    const diff = text('sample-code.diff');
    const worker = (adapter, argv) => {
      assert.equal(adapter.id, selected.harness);
      const cwd = argv[argv.indexOf('--cwd') + 1];
      assert.equal(cwd, f.root);
      if (fs.existsSync(diffFile)) assert.equal(fs.readFileSync(diffFile, 'utf8'), diff);
      else fs.writeFileSync(diffFile, diff);
      return { exitCode: 0, stdout: JSON.stringify({ id: 'fake-worker-session' }) };
    };
    const calls = [];
    const executed = await dispatchCommand(
      { ...dispatchArgs, execute: true, branch: f.request.request.branch },
      {
        ...dispatchDeps,
        rethrow: true,
        run: (adapter, argv, options) => {
          calls.push({ adapter, argv, options });
          const dispatch = f.registry.dispatch.providers[selected.gateway];
          assert.equal(adapter.id, selected.harness);
          assert.equal(argv[argv.indexOf('--model') + 1], dispatch.modelPrefix + selected.modelId);
          assert.equal(argv[argv.indexOf('--provider') + 1], dispatch.provider);
          assert.equal(argv[argv.indexOf('--cwd') + 1], f.root);
          assert.equal(options.workItemId, f.request.workItemId);
          const records = require('../decisions').readDecisions({
            dir: dispatchDeps.decisionDir,
            now: f.now,
          });
          const recorded = records.find((r) => r.stage === 'selected');
          assert.equal(recorded.chosen, decision.chosen);
          assert.ok(records.some((r) => r.stage === 'launched' && r.chosen === recorded.chosen));
          transcript.push({ stage: 'argv', args: argv });
          return worker(adapter, argv);
        },
      }
    );
    assert.equal(executed.exitCode, 0);
    assert.equal(executed.chosen, decision.chosen);
    assert.equal(executed.attempts, 1);
    assert.equal(calls.length, 1, 'execute must call the injected runner exactly once');
    assert.equal(readSessionId(calls[0].adapter, {}, executed.result).id, 'fake-worker-session');
    transcript.push({ stage: 'diff', diff: fs.readFileSync(diffFile, 'utf8') });
    if (kind === 'individual') {
      context.ledger.activeWorker = { offeringId: selected.offeringId };
      const afterFailure = (failure) =>
        handoff.afterFailure(replayDecision, f.request, context, failure, f.registry);
      const fallback = afterFailure({
        offeringId: selected.offeringId,
        upstream: selected.upstream,
        status: 429,
        worktree: f.root,
        workerStopped: true,
      });
      assert.equal(fallback.action, 'LAUNCH');
      assert.notEqual(fallback.launch.offeringId, selected.offeringId);
      assert.ok(!fallback.launch.args.includes('--new-workspace'));
      worker(getHarness(fallback.launch.harness), fallback.launch.args);
      assert.equal(fs.readFileSync(diffFile, 'utf8'), diff);
      assert.equal(context.ledger.fallbacksUsed, f.request.maxFallbacks);
      transcript.push({ stage: 'fallback', ...fallback });
      const stopped = afterFailure({
        offeringId: fallback.launch.offeringId,
        status: 402,
        workerStopped: true,
      });
      assert.equal(stopped.reason, 'FALLBACK_LIMIT');
      assert.equal(stopped.worktree, f.root);
      assert.equal(fs.readFileSync(diffFile, 'utf8'), diff);
    }
    // The review helper runs real control flow against explicitly stubbed gates.
    const sha = require('node:crypto').createHash('sha256').update(diff).digest('hex');
    const reviewer = 'fixture-independent-reviewer';
    const review = await runReviewLoop(
      { sha },
      {
        runTests: () => {
          assert.equal(fs.readFileSync(diffFile, 'utf8'), diff);
          const output = text('sample-ci.txt');
          assert.match(output, /Exit code: 0/);
          transcript.push({ stage: 'test-result', output, sha });
          return { pass: true };
        },
        review: async (reviewedSha) => {
          assert.equal(reviewedSha, sha);
          const output = text('sample-review.md');
          assert.match(output, /Verdict: PASS/);
          transcript.push({ stage: 'review-result', output, sha });
          return { sha, pass: true, verdict: 'PASS', findings: [], reviewer };
        },
        repair: () => assert.fail('fixture requires no repair'),
      }
    );
    assert.equal(review.status, Status.COMPLETED);
    assert.equal(review.finalSha, sha);
    fs.writeFileSync(path.join(f.root, 'replay.json'), JSON.stringify(transcript));
    const stages = ['request', 'decision', 'argv', 'diff', 'test-result', 'review-result'];
    assert.deepEqual(
      transcript.filter((e) => stages.includes(e.stage)).map((e) => e.stage),
      stages
    );
  });
}
