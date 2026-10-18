const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../discovery/identity');
for (const mode of ['rounds', 'duration'])
  test(`failed routes stop at configured item ${mode} limit`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'item-limits-'));
    const originalNow = Date.now;
    let clock = originalNow();
    Date.now = () => clock;
    try {
      const candidates = Array.from({ length: 8 }, (_, i) => ({
        harness: 'opencode',
        accessPath: `https://fixture-${i}.invalid/v1`,
        gateway: `fixture-${i}`,
        upstream: `vendor-${i}`,
        accountId: `fixture-${i}`,
        quotaScope: `fixture-${i}`,
        modelId: `vendor/model-${i}`,
        source: 'oc',
        kind: 'agent-cli',
        qualifiedRoles: ['author.foundation'],
        capabilities: { contextWindow: 64000 },
        evidence: [{ status: 'passed', kind: 'WORK_ITEM_PASS', proofLevel: 'WORK_ITEM_PASS' }],
        quality: 100 - i,
        cost: 1,
      }));
      candidates.forEach((c) => {
        c.candidateKey = candidateKey(c);
      });
      let probes = 0,
        launches = 0;
      const result = await runOrchestration('fixture failing routes', {
        cwd: root,
        decisionDir: path.join(root, 'decisions'),
        evidenceDir: path.join(root, 'evidence'),
        routeHealthFile: path.join(root, 'health.json'),
        candidates,
        registry: {
          sources: candidates.map((c) => ({
            id: c.gateway,
            endpoint: c.accessPath,
            credential: { env: 'FIXTURE_KEY' },
          })),
          dispatch: {
            maxWriterSelectionRounds: mode === 'rounds' ? 2 : 8,
            maxItemDurationMs: mode === 'duration' ? 100 : 100000,
            providers: { oc: { harness: 'opencode-direct', provider: 'opencode' } },
          },
        },
        env: { FIXTURE_KEY: 'fixture-only' },
        specs: [{ id: 'FIXTURE-ITEM', files: [], qualityFloor: 0 }],
        routeProbe: async () => {
          probes++;
          clock += 60;
          return { ok: false, status: 500, body: 'fixture upstream down' };
        },
        run: () => {
          launches++;
          clock += 60;
          return { exitCode: 1, stderr: 'HTTP 500 fixture upstream unavailable' };
        },
        ranking: { priors: { ranking: [] } },
      });
      assert.equal(launches, 2);
      assert.equal(probes, 0);
      assert.match(
        JSON.stringify(result),
        new RegExp(
          mode === 'rounds' ? 'WRITER_SELECTION_LIMIT_EXCEEDED' : 'ITEM_DURATION_LIMIT_EXCEEDED'
        )
      );
      const terminal = result.outcomes.find((entry) => entry.workItemId === 'FIXTURE-ITEM');
      assert.match(terminal.reason, /rejectionReasons.*LAUNCH_FAILED/);
      assert.equal(
        terminal.reasonCode,
        mode === 'rounds' ? 'WRITER_SELECTION_LIMIT_EXCEEDED' : 'ITEM_DURATION_LIMIT_EXCEEDED'
      );
    } finally {
      Date.now = originalNow;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

test('item deadline only shortens the existing JEV timeout', async () => {
  const jev = require('../jev');
  const { selectCandidateForProfile } = require('../orchestrate');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'item-jev-timeout-'));
  const originalAsk = jev.buildJevAsk;
  let received;
  jev.buildJevAsk = (_source, options) => {
    received = options;
    return async () => {
      throw Error('fixture JEV unavailable');
    };
  };
  try {
    for (const remainingMs of [undefined, 60000, 5000]) {
      const before = Date.now();
      await selectCandidateForProfile(
        { id: 'FIXTURE-JEV', files: [] },
        [],
        [],
        {},
        {
          registry: { sources: [] },
          evidenceDir: root,
          env: {},
          itemDeadline: remainingMs === undefined ? undefined : before + remainingMs,
        },
        { dir: root },
        before
      );
      assert.ok(Number.isFinite(received.timeoutMs));
      assert.ok(received.timeoutMs > 0);
      assert.ok(received.timeoutMs <= jev.DEFAULT_HTTP_TIMEOUT_MS);
      if (remainingMs !== undefined) assert.ok(received.timeoutMs <= remainingMs);
    }
  } finally {
    jev.buildJevAsk = originalAsk;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deadline wrapping preserves a missing launcher refusal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'item-no-launcher-'));
  try {
    const result = await runOrchestration('fixture without launcher', {
      cwd: root,
      decisionDir: path.join(root, 'decisions'),
      evidenceDir: path.join(root, 'evidence'),
      registry: { sources: [] },
      candidates: [],
      specs: [{ id: 'FIXTURE-NO-LAUNCHER', files: [] }],
    });
    assert.match(result.outcomes[0].reason, /^LAUNCHER_MISSING:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
