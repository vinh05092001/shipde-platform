'use strict';

/**
 * TASK-AI-142 PR A: direct OpenAI-compatible sources yield opencode-direct writer candidates
 *
 * Verifies:
 * 1. A source with OpenAI-compatible endpoint + credential env without opencodeProvider
 *    yields opencode-direct candidates whose route resolves and whose probe sends wire id.
 * 2. Sources missing endpoint, missing credential env, or declaring a CLI harness yield no opencode-direct.
 * 3. Opencode config generated in isolated worker contains only {env:NAME} and never leaks the secret.
 * 4. Direct sources without static models harvest model inventory from catalogue.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const { generateCandidates } = require('../candidates');
const { resolveRoute } = require('../executor');
const { routeProbeCandidate } = require('../orchestrate');
const launcher = require('../isolation-launcher');
const { getHarness } = require('../harness');

function synthSource(extra = {}) {
  return Object.assign(
    {
      id: 'synth-direct-vendor',
      label: 'Synthetic Direct Vendor',
      kind: 'model-source',
      endpoint: 'https://api.synth-direct.example/v1',
      credential: { type: 'api-key', env: 'SYNTH_VENDOR_API_KEY' },
      servesModels: true,
      models: ['synth-model-1'],
      modelMeta: { 'synth-model-1': { contextWindow: 131072 } },
    },
    extra
  );
}

describe('TASK-AI-142 PR A: direct OpenAI-compatible writer harness', () => {
  test('synthetic source without opencodeProvider yields opencode-direct writer and resolves route', () => {
    const src = synthSource();
    const registry = { version: 2, sources: [src] };
    const candidates = generateCandidates({ registry, accounts: [] });
    const directWriters = candidates.filter((c) => c.harness === 'opencode-direct');

    assert.equal(directWriters.length, 1, 'must emit exactly 1 opencode-direct candidate');
    const c = directWriters[0];
    assert.equal(c.modelId, 'synth-direct-vendor/synth-model-1');
    assert.equal(c.upstream, 'synth-direct-vendor');
    assert.equal(c.gateway, 'synth-direct-vendor');
    assert.equal(c.source, 'synth-direct-vendor');
    assert.equal(c.endpoint, 'https://api.synth-direct.example/v1');
    assert.equal(c.contextWindow, 131072);
    // Capabilities posture: tools and jsonSchema must remain undefined for Codex probe
    assert.equal(c.capabilities.tools, undefined);
    assert.equal(c.capabilities.jsonSchema, undefined);
    assert.equal(c.capabilities.contextWindow, 131072);

    // Route resolution in executor
    const route = resolveRoute(
      { provider: c.source, model: c.modelId, harness: c.harness },
      { isolatedWorker: true },
      registry
    );
    assert.ok(route, 'route must resolve');
    assert.equal(route.harnessName, 'opencode-direct');
    assert.equal(route.provider, 'synth-direct-vendor');
    assert.equal(route.model, 'synth-direct-vendor/synth-model-1');

    // Route probe sends wire id without provider prefix
    const probe = routeProbeCandidate(c, route, registry);
    assert.equal(probe.modelId, 'synth-model-1', 'probe must send wire model ID');
    assert.equal(probe.apiKeyEnv, 'SYNTH_VENDOR_API_KEY', 'probe must use source credential env');
  });

  test('sources missing endpoint or credential env do not yield opencode-direct candidates', () => {
    // Missing endpoint
    const noEndpoint = synthSource({ endpoint: undefined });
    assert.equal(
      generateCandidates({ registry: { version: 2, sources: [noEndpoint] }, accounts: [] }).filter(
        (c) => c.harness === 'opencode-direct'
      ).length,
      0
    );

    // Non-http endpoint
    const grpcEndpoint = synthSource({ endpoint: 'grpc://custom.vendor:9000' });
    assert.equal(
      generateCandidates({
        registry: { version: 2, sources: [grpcEndpoint] },
        accounts: [],
      }).filter((c) => c.harness === 'opencode-direct').length,
      0
    );

    // Missing credential
    const noCred = synthSource({ credential: undefined });
    assert.equal(
      generateCandidates({ registry: { version: 2, sources: [noCred] }, accounts: [] }).filter(
        (c) => c.harness === 'opencode-direct'
      ).length,
      0
    );

    // Credential without env
    const emptyCred = synthSource({ credential: { type: 'none' } });
    assert.equal(
      generateCandidates({ registry: { version: 2, sources: [emptyCred] }, accounts: [] }).filter(
        (c) => c.harness === 'opencode-direct'
      ).length,
      0
    );

    // CLI harness source
    const cliSource = synthSource({ kind: 'agent-cli', accessPath: 'cli' });
    assert.equal(
      generateCandidates({ registry: { version: 2, sources: [cliSource] }, accounts: [] }).filter(
        (c) => c.harness === 'opencode-direct'
      ).length,
      0
    );

    // Disabled source
    const disabled = synthSource({ enabled: false });
    assert.equal(
      generateCandidates({ registry: { version: 2, sources: [disabled] }, accounts: [] }).filter(
        (c) => c.harness === 'opencode-direct'
      ).length,
      0
    );
  });

  test('direct source collects models from catalogue when static models array is absent', () => {
    const srcWithoutModels = synthSource({ models: undefined, modelMeta: undefined });
    const catalogue = [
      {
        modelId: 'remote-model-x',
        gateway: 'synth-direct-vendor',
        capabilities: { contextWindow: 65536 },
      },
      {
        modelId: 'synth-direct-vendor/remote-model-y',
        gateway: 'synth-direct-vendor',
      },
    ];
    const registry = { version: 2, sources: [srcWithoutModels] };
    const candidates = generateCandidates({ registry, catalogue, accounts: [] });
    const directWriters = candidates.filter((c) => c.harness === 'opencode-direct');

    assert.equal(directWriters.length, 2);
    const modelIds = directWriters.map((c) => c.modelId).sort();
    assert.deepEqual(modelIds, [
      'synth-direct-vendor/remote-model-x',
      'synth-direct-vendor/remote-model-y',
    ]);
    const x = directWriters.find((c) => c.modelId.endsWith('remote-model-x'));
    assert.equal(x.contextWindow, 65536);
    assert.equal(x.capabilities.contextWindow, 65536);
  });

  test('secret protection: worker provider config writes only env template and never leaks raw key', () => {
    const sentinelSecret = 'SUPER_SECRET_RAW_KEY_DO_NOT_LEAK_TOKEN_99999';
    const envVarName = 'SYNTH_ISOLATION_SECRET_KEY';
    process.env[envVarName] = sentinelSecret;

    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-a-secret-test-'));
    const hostDir = path.join(tempBase, 'host');
    const workerDir = path.join(tempBase, 'worker');
    const verdictPath = path.join(workerDir, 'verdict.json');
    fs.mkdirSync(hostDir, { recursive: true });
    fs.mkdirSync(workerDir, { recursive: true });
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const policySrc = path.join(repoRoot, 'scripts', 'ai', 'isolation');
    const hostPolicy = path.join(hostDir, 'scripts', 'ai', 'isolation');
    fs.mkdirSync(hostPolicy, { recursive: true });
    fs.cpSync(policySrc, hostPolicy, { recursive: true });

    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        verdict: 'CLOSED',
        timestamp: Date.now(),
        worktree: hostDir,
        policyHash: launcher.getFolderHash(hostPolicy),
        sid: 'test-sid-pr-a',
        details: {},
      }),
      'utf8'
    );

    // Initialise fake git repo in worker dir for isolation launcher git commands
    cp.execSync('git init', { cwd: workerDir, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: workerDir, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: workerDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(workerDir, 'dummy.txt'), 'base', 'utf8');
    cp.execSync('git add . && git commit -m "initial"', { cwd: workerDir, stdio: 'ignore' });
    const headSha = cp.execSync('git rev-parse HEAD', { cwd: workerDir, encoding: 'utf8' }).trim();

    const origSpawn = cp.spawnSync;
    cp.spawnSync = (cmd, args, opts) => {
      if (cmd === 'git') {
        if (args && args[0] === 'clone') {
          fs.mkdirSync(path.join(args[args.length - 1], '.git', 'info'), { recursive: true });
        }
        if (args && args.includes('rev-parse')) {
          return { status: 0, stdout: headSha + '\n' };
        }
        return { status: 0, stdout: '' };
      }
      if (cmd === 'powershell.exe') {
        return { status: 0, stdout: 'worker execution simulated' };
      }
      return { status: 0, stdout: '' };
    };

    try {
      const src = synthSource({
        id: 'synth-leak-check',
        credential: { type: 'api-key', env: envVarName },
        endpoint: 'https://api.synth-leak.example/v1',
        models: ['leak-test-model'],
      });

      // Provide source via sourcesModule loadSources override if needed, or by ensuring sources registry has it
      const sourcesMod = require('../sources');
      const origLoadSources = sourcesMod.loadSources;
      sourcesMod.loadSources = () => ({
        version: 2,
        sources: [src, ...origLoadSources().sources.filter((s) => s.id !== src.id)],
      });

      const direct = getHarness('opencode-direct');
      const launchArgs = direct.launch({
        isolatedWorker: true,
        model: 'synth-leak-check/leak-test-model',
        cwd: workerDir,
        prompt: 'test prompt',
      });

      const run = launcher.getIsolatedLauncher();
      run(direct, launchArgs, {
        cwd: hostDir,
        workerRoot: workerDir,
        verdictPath,
        getWorkerSid: () => 'test-sid-pr-a',
        verifyBoundary: () => true,
        baseSha: headSha,
        candidateKey: `opencode-direct::https://api.synth-leak.example/v1::synth-leak-check::synth-leak-check::synth-leak-check::synth-leak-check::synth-leak-check/leak-test-model`,
      });

      sourcesMod.loadSources = origLoadSources;

      // Verify opencode.json
      const configPath = path.join(workerDir, 'opencode.json');
      assert.ok(fs.existsSync(configPath), 'opencode.json must be created');
      const configContent = fs.readFileSync(configPath, 'utf8');

      // MUST NOT contain the secret value
      assert.equal(
        configContent.includes(sentinelSecret),
        false,
        'opencode.json must NEVER contain the raw secret key'
      );
      // MUST contain the env template
      assert.ok(
        configContent.includes(`{env:${envVarName}}`),
        'opencode.json must contain {env:NAME} template'
      );

      // Verify NO file in workerRoot contains the secret value
      for (const entry of fs.readdirSync(workerDir)) {
        const full = path.join(workerDir, entry);
        if (fs.statSync(full).isFile()) {
          const content = fs.readFileSync(full, 'utf8');
          assert.equal(
            content.includes(sentinelSecret),
            false,
            `Worker file ${entry} must not leak sentinel secret`
          );
        }
      }
    } finally {
      cp.spawnSync = origSpawn;
      delete process.env[envVarName];
      try {
        fs.rmSync(tempBase, { recursive: true, force: true });
      } catch {}
    }
  });
});
