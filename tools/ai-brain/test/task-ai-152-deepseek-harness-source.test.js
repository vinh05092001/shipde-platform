'use strict';

/**
 * TASK-AI-152: DeepSeek Harness Controller source registration, discovery, probe and harness mapping
 *
 * Verifies:
 * 1. DeepSeek Harness is registered in sources.json as an agent-cli source with id 'deepseek-harness',
 *    alias 'dsh', reachedVia '9router', and credential env 'DEEPSEEK_API_KEY'.
 * 2. Aliases and dispatch routing resolve bidirectionally between 'deepseek-harness' and 'dsh'.
 * 3. Credential presence checks respect DEEPSEEK_API_KEY (presence only, never returning secret value).
 * 4. Harness adapter 'dsh' in harness.js supports launch, resume, stop, inspect, and sessionIdFrom.
 * 5. Discovery discovers DSH from home config trees (~/.dsh/config.json) and operator env var.
 * 6. Probe supports CLI verification command:
 *    - Simulated successful CLI execution returns status 'available' with version.
 *    - Simulated failed CLI execution returns status 'unavailable' with failure reason.
 *    - Simulated missing CLI (ENOENT) returns status 'unavailable' with CLI_NOT_INSTALLED.
 *    - Real machine CLI probe records honest NOT_INSTALLED evidence when binary cannot be executed.
 * 7. Ranking rejects candidates when DEEPSEEK_API_KEY is absent and admits/ranks when present.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourcesApi = require('../sources');
const { getHarness, listHarnesses } = require('../harness');
const { discoverSources, probeSource } = require('../source-discovery');
const { enumerate } = require('../discovery/adapters');
const { rankAndRecord } = require('../ranking');

const registry = sourcesApi.loadSources();

describe('TASK-AI-152: DeepSeek Harness source registration', () => {
  test('sources.json contains deepseek-harness source with correct metadata', () => {
    const src = sourcesApi.getSource('deepseek-harness', registry);
    assert.ok(src, 'deepseek-harness must be in registry');
    assert.equal(src.id, 'deepseek-harness');
    assert.equal(src.label, 'DeepSeek Harness');
    assert.deepEqual(src.aliases, ['dsh']);
    assert.equal(src.kind, 'agent-cli');
    assert.equal(src.servesModels, false);
    assert.equal(src.harness, 'dsh');
    assert.equal(src.accessPath, 'cli');
    assert.equal(src.reachedVia, '9router');
    assert.equal(src.credential?.type, 'api-key');
    assert.equal(src.credential?.env, 'DEEPSEEK_API_KEY');
    assert.equal(src.verify?.method, 'version-command');
    assert.equal(src.verify?.command, 'dsh --version');
  });

  test('sources.json contains canonical deepseek-harness directly in raw JSON without path disguise', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sources.json'), 'utf8'));
    const entry = (raw.sources || []).find((s) => s.id === 'deepseek-harness');
    assert.ok(entry, 'sources.json raw JSON must contain id: deepseek-harness');
    assert.equal(entry.id, 'deepseek-harness');
    assert.equal(entry.credential?.env, 'DEEPSEEK_API_KEY');
    assert.deepEqual(entry.aliases, ['dsh']);
  });

  test('getSource and getSourceAliases resolve both deepseek-harness and dsh alias', () => {
    const byId = sourcesApi.getSource('deepseek-harness', registry);
    const byAlias = sourcesApi.getSource('dsh', registry);
    assert.ok(byId, 'getSource with primary id');
    assert.ok(byAlias, 'getSource with alias');
    assert.equal(byId.id, byAlias.id, 'both queries must return the same source entry');

    const aliases1 = sourcesApi.getSourceAliases('deepseek-harness', registry);
    assert.ok(aliases1.includes('deepseek-harness'));
    assert.ok(aliases1.includes('dsh'));

    const aliases2 = sourcesApi.getSourceAliases('dsh', registry);
    assert.ok(aliases2.includes('deepseek-harness'));
    assert.ok(aliases2.includes('dsh'));
  });

  test('dispatch route maps dsh and deepseek-harness to dsh harness', () => {
    const route1 = sourcesApi.dispatchRoute('dsh', registry);
    assert.ok(route1, 'dispatchRoute for dsh');
    assert.equal(route1.harness, 'dsh');
    assert.equal(route1.provider, 'dsh');

    const route2 = sourcesApi.dispatchRoute('deepseek-harness', registry);
    assert.ok(route2, 'dispatchRoute for deepseek-harness');
    assert.equal(route2.harness, 'dsh');
    assert.equal(route2.provider, 'dsh');
  });

  test('describeAll classifies deepseek-harness without counting as direct model capacity', () => {
    const all = sourcesApi.describeAll({ registry });
    const dshEntry = all.find((s) => s.id === 'dsh' || s.id === 'deepseek-harness');
    assert.ok(dshEntry, 'deepseek-harness / dsh must appear in describeAll output');
    assert.equal(dshEntry.kind, 'agent-cli');
    assert.equal(
      dshEntry.countsAsCapacity,
      false,
      'agent-cli harnesses do not double-count capacity'
    );
    assert.equal(dshEntry.harness, 'dsh');
    assert.equal(dshEntry.reachedVia, '9router');
  });
});

describe('TASK-AI-152: Credential presence (env var reference only, never value)', () => {
  const dshSource = sourcesApi.getSource('deepseek-harness', registry);

  test('reports present when DEEPSEEK_API_KEY is defined and non-empty (BR-DSH-04)', () => {
    const presence = sourcesApi.credentialPresence(dshSource, {
      env: { DEEPSEEK_API_KEY: 'test-not-a-secret-dsh-key' },
    });
    assert.equal(presence.required, true);
    assert.equal(presence.present, true);
    assert.equal(presence.how, 'env DEEPSEEK_API_KEY');
    // Secret value MUST NEVER appear in return object
    assert.equal(JSON.stringify(presence).includes('test-not-a-secret-dsh-key'), false);
  });

  test('reports absent when DEEPSEEK_API_KEY is missing or empty whitespace, and does NOT accept DSH_API_KEY alone (BR-DSH-04)', () => {
    const missing = sourcesApi.credentialPresence(dshSource, { env: {} });
    assert.equal(missing.required, true);
    assert.equal(missing.present, false);
    assert.equal(missing.how, 'env DEEPSEEK_API_KEY unset');

    const empty = sourcesApi.credentialPresence(dshSource, { env: { DEEPSEEK_API_KEY: '   ' } });
    assert.equal(empty.required, true);
    assert.equal(empty.present, false);
    assert.equal(empty.how, 'env DEEPSEEK_API_KEY unset');

    // Regression for Finding 2: DSH_API_KEY alone does not satisfy DEEPSEEK_API_KEY requirement
    const dshKeyOnly = sourcesApi.credentialPresence(dshSource, {
      env: { DSH_API_KEY: 'test-not-a-secret-dsh-key' },
    });
    assert.equal(dshKeyOnly.required, true);
    assert.equal(dshKeyOnly.present, false);
    assert.equal(dshKeyOnly.how, 'env DEEPSEEK_API_KEY unset');
    assert.equal(JSON.stringify(dshKeyOnly).includes('test-not-a-secret-dsh-key'), false);
  });
});

describe('TASK-AI-152: Harness adapter mapping in harness.js', () => {
  test('harness.js exports dsh and deepseek-harness adapters', () => {
    assert.ok(listHarnesses().includes('dsh'));
    const adapter1 = getHarness('dsh');
    const adapter2 = getHarness('deepseek-harness');
    assert.ok(adapter1, 'getHarness("dsh") must return adapter');
    assert.ok(adapter2, 'getHarness("deepseek-harness") must return adapter');
    assert.equal(adapter1.id, 'dsh');
    assert.equal(adapter1.command, 'dsh');
  });

  test('dsh launch builds argv correctly', () => {
    const adapter = getHarness('dsh');
    const args = adapter.launch({
      model: 'shipde-low-risk',
      cwd: 'C:/Users/gumac/AI/shipde-dsh',
      prompt: 'Implement mechanical fix',
    });
    assert.deepEqual(args, [
      '--model',
      'shipde-low-risk',
      '--cwd',
      'C:/Users/gumac/AI/shipde-dsh',
      'Implement mechanical fix',
    ]);
  });

  test('dsh resume, stop, inspect, and sessionIdFrom', () => {
    const adapter = getHarness('dsh');
    assert.deepEqual(adapter.resume('sess-123', 'continue task'), [
      'resume',
      'sess-123',
      'continue task',
    ]);
    assert.deepEqual(adapter.stop('sess-123'), ['stop', 'sess-123']);
    assert.deepEqual(adapter.inspect('sess-123'), ['status', 'sess-123']);

    assert.equal(adapter.sessionIdFrom({ id: 'dsh-session-456' }), 'dsh-session-456');
    assert.equal(adapter.sessionIdFrom({ sessionId: 'dsh-session-789' }), 'dsh-session-789');
    assert.equal(adapter.sessionIdFrom(null), null);
  });
});

describe('TASK-AI-152: Source discovery for DeepSeek Harness', () => {
  test('discovers dsh from home configuration file ~/.dsh/config.json', (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-discovery-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));

    const dshDir = path.join(home, '.dsh');
    fs.mkdirSync(dshDir, { recursive: true });
    fs.writeFileSync(
      path.join(dshDir, 'config.json'),
      JSON.stringify({
        baseURL: 'http://127.0.0.1:20128/v1',
        apiKey: '{env:DEEPSEEK_API_KEY}',
        models: ['deepseek/deepseek-chat'],
      })
    );

    const sources = discoverSources({ home, env: { DEEPSEEK_API_KEY: 'test-not-a-secret-key' } });
    const found = sources.find((s) => s.id.includes('dsh') || s.name === 'dsh');
    assert.ok(found, 'dsh config must be discovered from ~/.dsh/config.json');
    assert.equal(
      JSON.stringify(sources).includes('test-not-a-secret-key'),
      false,
      'secret must never leak'
    );
  });

  test('discovers deepseek-harness from operator environment DEEPSEEK_API_KEY with canonical ID, no HTTP endpoint, and CLI verification', () => {
    const sources = discoverSources({
      home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-env-test-')),
      env: { DEEPSEEK_API_KEY: 'test-not-a-secret-key' },
    });
    const found = sources.find((s) => s.id === 'deepseek-harness' || s.id === 'dsh');
    assert.ok(found, 'deepseek-harness must be discovered from operator env key');
    assert.equal(found.id, 'deepseek-harness', 'canonical ID must be deepseek-harness');
    assert.equal(found.endpoint, null, 'DSH must not supply an HTTP endpoint');
    assert.equal(found.credential?.name, 'DEEPSEEK_API_KEY');
    assert.ok(found.verify, 'discovered DSH must include CLI verification');
    assert.equal(found.verify.method, 'version-command');
    assert.equal(found.verify.command, 'dsh --version');
    assert.equal(JSON.stringify(sources).includes('test-env-key-never-store'), false);
  });

  test('discovery adapter enumerates deepseek-harness with no-models and presence info', async () => {
    const dshSource = sourcesApi.getSource('deepseek-harness', registry);
    const mockResolve = (cmd) => ({ file: `C:/fake/bin/${cmd}.exe`, args: [], kind: 'exe' });
    const result = await enumerate(dshSource, { resolveCommand: mockResolve, registry });
    assert.equal(result.status, 'no-models');
    assert.equal(result.catalogs.length, 0);
    assert.ok(result.presence, 'presence must be checked via resolver');
    assert.equal(result.presence.file, 'C:/fake/bin/dsh.exe');
  });
});

describe('TASK-AI-152: Probe support using CLI (fake and real execution)', () => {
  const dshSource = sourcesApi.getSource('deepseek-harness', registry);

  test('fake CLI with exitCode 0 probes as available and captures version', async () => {
    const fakeRun = async (bin, args) => ({
      exitCode: 0,
      stdout: '@deepseek-ai/dsh@0.1.1-rc.2\n',
      stderr: '',
    });

    const probe = await probeSource(dshSource, { runCommand: fakeRun });
    assert.equal(probe.status, 'available');
    assert.equal(probe.reason, null);
    assert.equal(probe.version, '@deepseek-ai/dsh@0.1.1-rc.2');
    assert.ok(probe.lastProbeAt);
  });

  test('fake CLI with non-zero exitCode probes as unavailable with CLI_PROBE_FAILED', async () => {
    const fakeRun = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Cannot find module @deepseek-ai/dsh',
    });

    const probe = await probeSource(dshSource, { runCommand: fakeRun });
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'CLI_PROBE_FAILED');
    assert.match(probe.diagnostic, /Cannot find module/);
    assert.ok(probe.nextCheckAt);
  });

  test('fake CLI with ENOENT probes as unavailable with CLI_NOT_INSTALLED', async () => {
    const fakeRun = async () => ({
      exitCode: -1,
      enoent: true,
      stdout: '',
      stderr: 'Command not found: dsh',
    });

    const probe = await probeSource(dshSource, { runCommand: fakeRun });
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'CLI_NOT_INSTALLED');
  });

  test('fake CLI with thrown ENOENT probes as unavailable with CLI_NOT_INSTALLED', async () => {
    const fakeRun = async () => {
      const err = new Error('spawn dsh ENOENT');
      err.code = 'ENOENT';
      throw err;
    };

    const probe = await probeSource(dshSource, { runCommand: fakeRun });
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'CLI_NOT_INSTALLED');
  });

  test('real machine check: records honest NOT_INSTALLED evidence when dsh runtime is uninstalled', async () => {
    // Probing without injected fake runner executes real machine environment
    const probe = await probeSource(dshSource);
    // On this machine, npm shim exists at C:\\ShipDeWorker\\npm\\dsh.ps1 but package
    // @deepseek-ai/dsh is missing from node_modules, exiting with code 1 MODULE_NOT_FOUND.
    assert.equal(
      probe.status,
      'unavailable',
      'real probe must report unavailable when package is not installed'
    );
    assert.ok(probe.reason, 'probe must have explicit non-empty failure reason');
  });
});

describe('TASK-AI-152: Finding 3 regression — Environment discovery to CLI probe complete path', () => {
  test('complete discovery-to-probe path probes available when dsh exits 0', async () => {
    const discovered = discoverSources({
      home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disc-probe-0-')),
      env: { DEEPSEEK_API_KEY: 'test-not-a-secret-key' },
    });
    const dsh = discovered.find((s) => s.id === 'deepseek-harness');
    assert.ok(dsh, 'discovered deepseek-harness must exist');

    const fakeRun = async (bin, args) => ({
      exitCode: 0,
      stdout: '@deepseek-ai/dsh@0.1.1-rc.2\n',
      stderr: '',
    });

    const probe = await probeSource(dsh, {
      runCommand: fakeRun,
      env: { DEEPSEEK_API_KEY: 'test-not-a-secret-key' },
    });
    assert.equal(probe.status, 'available');
    assert.equal(probe.reason, null);
    assert.equal(probe.version, '@deepseek-ai/dsh@0.1.1-rc.2');
  });

  test('complete discovery-to-probe path reports CLI_NOT_INSTALLED when executable is missing (ENOENT)', async () => {
    const discovered = discoverSources({
      home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disc-probe-enoent-')),
      env: { DEEPSEEK_API_KEY: 'test-not-a-secret-key' },
    });
    const dsh = discovered.find((s) => s.id === 'deepseek-harness');
    assert.ok(dsh, 'discovered deepseek-harness must exist');

    const fakeRun = async () => ({
      exitCode: -1,
      enoent: true,
      stdout: '',
      stderr: 'Command not found: dsh',
    });

    const probe = await probeSource(dsh, { runCommand: fakeRun });
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'CLI_NOT_INSTALLED');
  });

  test('complete discovery-to-probe path reports CLI_PROBE_FAILED when executable exits non-zero', async () => {
    const discovered = discoverSources({
      home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disc-probe-fail-')),
      env: { DEEPSEEK_API_KEY: 'test-secret-key' },
    });
    const dsh = discovered.find((s) => s.id === 'deepseek-harness');
    assert.ok(dsh, 'discovered deepseek-harness must exist');

    const fakeRun = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Cannot find module @deepseek-ai/dsh',
    });

    const probe = await probeSource(dsh, { runCommand: fakeRun });
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'CLI_PROBE_FAILED');
    assert.match(probe.diagnostic, /Cannot find module/);
  });
});

describe('TASK-AI-152: Finding 4 regression — Probe redacts credentials from diagnostics', () => {
  const dshSource = sourcesApi.getSource('deepseek-harness', registry);
  const secretSentinel = 'test-not-a-secret-sentinel';
  const rawSecret = 'test-not-a-secret-raw-token';

  test('redacts credential sentinels from probe stdout (version)', async () => {
    const fakeRun = async () => ({
      exitCode: 0,
      stdout: `@deepseek-ai/dsh@0.1.1-rc.2 token=${secretSentinel} Bearer ${rawSecret}\n`,
      stderr: '',
    });

    const probe = await probeSource(dshSource, {
      runCommand: fakeRun,
      env: { DEEPSEEK_API_KEY: rawSecret },
    });
    assert.equal(probe.status, 'available');
    assert.ok(probe.version, 'version must be present');
    assert.equal(
      probe.version.includes(secretSentinel),
      false,
      'sentinel must not leak in version'
    );
    assert.equal(probe.version.includes(rawSecret), false, 'rawSecret must not leak in version');
    assert.ok(
      probe.version.includes('[REDACTED_SECRET]'),
      'version must contain redaction placeholder'
    );
  });

  test('redacts credential sentinels from probe stderr (reason)', async () => {
    const fakeRun = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: `Authentication failure using api_key=${secretSentinel} and key: ${rawSecret}`,
    });

    const probe = await probeSource(dshSource, {
      runCommand: fakeRun,
      env: { DEEPSEEK_API_KEY: rawSecret },
    });
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'CLI_PROBE_FAILED');
    assert.ok(probe.diagnostic, 'diagnostic must be present');
    assert.equal(
      probe.diagnostic.includes(secretSentinel),
      false,
      'sentinel must not leak in stderr diagnostic'
    );
    assert.equal(
      probe.diagnostic.includes(rawSecret),
      false,
      'rawSecret must not leak in stderr diagnostic'
    );
    assert.ok(
      probe.diagnostic.includes('[REDACTED_SECRET]'),
      'diagnostic must contain redaction placeholder'
    );
  });

  test('redacts credential sentinels from probe thrown exception message (reason)', async () => {
    const fakeRun = async () => {
      throw new Error(`Process spawn failed: authorization=${secretSentinel} token: ${rawSecret}`);
    };

    const probe = await probeSource(dshSource, {
      runCommand: fakeRun,
      env: { DEEPSEEK_API_KEY: rawSecret },
    });
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'CLI_PROBE_FAILED');
    assert.ok(probe.diagnostic, 'diagnostic must be present');
    assert.equal(
      probe.diagnostic.includes(secretSentinel),
      false,
      'sentinel must not leak in thrown diagnostic'
    );
    assert.equal(
      probe.diagnostic.includes(rawSecret),
      false,
      'rawSecret must not leak in thrown diagnostic'
    );
    assert.ok(
      probe.diagnostic.includes('[REDACTED_SECRET]'),
      'diagnostic must contain redaction placeholder'
    );
  });

  test('probeSource strips literal credential values from returned record (Finding 4 / BR-DSH-01)', async () => {
    const srcWithLiteralSecret = {
      ...dshSource,
      credential: { type: 'api-key', value: 'test-not-a-secret-literal-val' },
    };
    const fakeRun = async () => ({
      exitCode: 0,
      stdout: '@deepseek-ai/dsh@0.1.1-rc.2\n',
      stderr: '',
    });
    const probe = await probeSource(srcWithLiteralSecret, { runCommand: fakeRun });
    assert.equal(probe.status, 'available');
    assert.equal(probe.credential?.value, undefined, 'literal credential value must be stripped');
  });
});

describe('TASK-AI-152: Ranking candidate preflight and admission', () => {
  test('rejects candidate when source credential is absent', () => {
    const candidate = {
      harness: 'dsh',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'deepseek',
      accountId: 'dsh-worker',
      quotaScope: 'dsh-worker',
      modelId: 'deepseek-v4-flash-free',
      source: 'deepseek-harness',
    };

    const result = rankAndRecord([candidate], {
      registry,
      role: 'author.mechanical',
      dryRun: true,
      explorationBudget: 1,
      credentialOpts: { env: {} },
    });

    assert.equal(result.candidates.length, 0, 'candidate must not be ranked without credential');
    assert.equal(result.rejected.length, 1, 'candidate must be rejected');
    assert.equal(result.rejected[0].reason, 'no credential: env DEEPSEEK_API_KEY unset');
    assert.equal(result.rejected[0].scope, 'source');
  });

  test('strictly rejects candidate when only DSH_API_KEY is defined (BR-DSH-04)', () => {
    const candidate = {
      harness: 'dsh',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'deepseek',
      accountId: 'dsh-worker',
      quotaScope: 'dsh-worker',
      modelId: 'deepseek-v4-flash-free',
      source: 'deepseek-harness',
    };

    const result = rankAndRecord([candidate], {
      registry,
      role: 'author.mechanical',
      dryRun: true,
      explorationBudget: 1,
      credentialOpts: { env: { DSH_API_KEY: 'test-not-a-secret-only-key' } },
    });

    assert.equal(
      result.candidates.length,
      0,
      'candidate must not be ranked when DEEPSEEK_API_KEY is missing'
    );
    assert.equal(result.rejected.length, 1, 'candidate must be rejected');
    assert.equal(result.rejected[0].reason, 'no credential: env DEEPSEEK_API_KEY unset');
    assert.equal(result.rejected[0].scope, 'source');
  });

  test('admits candidate for ranking when source credential DEEPSEEK_API_KEY is present', () => {
    const candidate = {
      harness: 'dsh',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'deepseek',
      accountId: 'dsh-worker',
      quotaScope: 'dsh-worker',
      modelId: 'deepseek-v4-flash-free',
      source: 'deepseek-harness',
    };

    const result = rankAndRecord([candidate], {
      registry,
      role: 'author.mechanical',
      dryRun: true,
      explorationBudget: 1,
      credentialOpts: { env: { DEEPSEEK_API_KEY: 'test-not-a-secret-valid-presence' } },
    });

    assert.equal(result.rejected.length, 0, 'candidate must pass credential check');
    assert.equal(result.candidates.length, 1, 'candidate must be ranked');
    assert.equal(result.candidates[0].harness, 'dsh');
  });
});

describe('TASK-AI-152: Finding 1 regression — CI preflight, registry invariants, and secret redaction integrity', () => {
  test('registry normalizes canonical deepseek-harness ID and DEEPSEEK_API_KEY credential env', () => {
    const reg = sourcesApi.loadSources();
    const src = sourcesApi.getSource('deepseek-harness', reg);
    assert.ok(src, 'deepseek-harness must be resolvable from normalized registry');
    assert.equal(src.id, 'deepseek-harness', 'primary ID must be deepseek-harness');
    assert.equal(src.credential?.type, 'api-key');
    assert.equal(src.credential?.env, 'DEEPSEEK_API_KEY');
    assert.equal(src.harness, 'dsh');
    assert.equal(src.kind, 'agent-cli');
  });

  test('probeSource diagnostic redaction scrubs arbitrary authorization headers and tokens without secret-looking literals', async () => {
    const src = sourcesApi.getSource('deepseek-harness', registry);
    const tokenVal = 'test-not-a-secret-token-fixture';
    const fakeRun = async () => ({
      exitCode: 0,
      stdout: `version: 0.1.1 Authorization: Bearer ${tokenVal} key=${tokenVal}\n`,
      stderr: '',
    });

    const probe = await probeSource(src, {
      runCommand: fakeRun,
      env: { DEEPSEEK_API_KEY: tokenVal },
    });
    assert.equal(probe.status, 'available');
    assert.equal(probe.version.includes(tokenVal), false, 'raw token must be redacted');
    assert.ok(probe.version.includes('[REDACTED_SECRET]'), 'redaction placeholder must be present');
  });

  test('credentialPresence fails closed when DEEPSEEK_API_KEY is unset or invalid', () => {
    const src = sourcesApi.getSource('deepseek-harness', registry);
    const unsetPresence = sourcesApi.credentialPresence(src, { env: {} });
    assert.equal(unsetPresence.present, false);
    assert.equal(unsetPresence.required, true);
    assert.equal(unsetPresence.how, 'env DEEPSEEK_API_KEY unset');

    const whitespacePresence = sourcesApi.credentialPresence(src, {
      env: { DEEPSEEK_API_KEY: ' \t\n ' },
    });
    assert.equal(whitespacePresence.present, false);
    assert.equal(whitespacePresence.required, true);
    assert.equal(whitespacePresence.how, 'env DEEPSEEK_API_KEY unset');
  });
});
