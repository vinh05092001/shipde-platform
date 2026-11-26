'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const manifest = json('tools/ai-brain/data/tool-manifest.json');
const pkg = json('package.json');

// Reuse item 1's actual validator; suppress only its test registration.
const validatorSandbox = {
  require: (id) => (id === 'node:test' ? { describe() {}, test() {} } : require(id)),
  __dirname,
  module: { exports: {} },
};
vm.runInNewContext(
  read('tools/ai-brain/test/repo-integration-evidence.test.js') +
    '\nmodule.exports = { validateEvidenceRecord, MANDATORY_FIELDS };',
  validatorSandbox
);
const { validateEvidenceRecord, MANDATORY_FIELDS } = validatorSandbox.module.exports;

const loadGroup = (docPath) => {
  const doc = read(docPath);
  return { doc, records: JSON.parse(doc.match(/```json\s*([\s\S]*?)```/)[1]) };
};

// ---------------------------------------------------------------------------
// Family A: Groups 1-3 (BRAIN, WORKFLOW, CODE-CONTEXT)
// ---------------------------------------------------------------------------
const FAMILY_A = [
  {
    num: 1,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md',
    workItemId: 'GOAL-AUTOCLAW-REPOS-2',
    allowInstalled: false,
    repos: [
      'vinh05092001/shipde-platform',
      'NousResearch/hermes-agent',
      'vinh05092001/shipde-brain',
      'decolua/9router',
      'anomalyco/opencode',
      'openai/codex',
      'google-gemini/gemini-cli',
      'getpaseo/paseo',
      'anthropic-ai/claude-code',
    ],
  },
  {
    num: 2,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md',
    workItemId: 'GOAL-AUTOCLAW-REPOS-3',
    allowInstalled: false,
    repos: ['obra/superpowers', 'Fission-AI/OpenSpec', 'pbakaus/impeccable', 'cli/cli'],
  },
  {
    num: 3,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-3-CODE-CONTEXT.md',
    workItemId: 'GOAL-AUTOCLAW-REPOS-4',
    allowInstalled: true,
    repos: [
      'oraios/serena',
      'ast-grep/ast-grep',
      'yamadashy/repomix',
      'upstash/context7',
      'rtk-ai/rtk',
    ],
  },
];

const loadedA = Object.fromEntries(FAMILY_A.map((g) => [g.num, { ...g, ...loadGroup(g.docPath) }]));

for (const g of Object.values(loadedA)) {
  test(`group ${g.num}: exact group inventory and shared contract, without claiming missing manifest registration`, () => {
    assert.deepEqual(
      g.records.map((r) => r.repo),
      g.repos
    );
    assert.equal(new Set(g.records.map((r) => r.repo)).size, g.records.length);
    for (const r of g.records) {
      for (const field of MANDATORY_FIELDS) assert.ok(Object.hasOwn(r, field), field);
      assert.equal(r.workItemId, g.workItemId);
      assert.equal(r.execution, 'NOT_RUN');
      assert.equal(r.acceptance, 'PENDING');
      assert.ok(Number.isFinite(Date.parse(r.verifiedAt)));
      assert.ok(fs.existsSync(path.join(root, r.caller)), r.caller);
      const entry = manifest.find((m) => m.repo.toLowerCase() === r.repo.toLowerCase());
      if (entry) {
        assert.equal(r.toolId, entry.id);
        assert.equal(r.registrationPending, false);
        if (g.allowInstalled && entry.installed) {
          assert.equal(r.state, 'INSTALLED', 'installed entry must be exactly INSTALLED');
          assert.equal(r.blocked, false);
        } else {
          assert.equal(entry.installed, false, 'state must be reconsidered if manifest changes');
          assert.equal(r.state, 'DECLARED');
          assert.equal(r.blocked, true);
          assert.ok(r.blockedReason.trim());
        }
        assert.equal(r.evidenceRef, entry.evidenceRef);
        assert.equal(r.command, entry.command);
        const result = validateEvidenceRecord(r, root);
        assert.equal(result.valid, true, result.errors.join('; '));
      } else {
        assert.equal(r.toolId, null);
        assert.equal(r.registrationPending, true);
        assert.equal(r.state, 'DECLARED');
        assert.equal(r.blocked, true);
        assert.ok(r.blockedReason.trim());
        assert.ok(g.doc.includes('incomplete contract records'));
        assert.ok(fs.existsSync(path.join(root, r.evidenceRef.split(':')[0])));
      }
    }
  });

  test(`group ${g.num}: shared validator rejects damaged evidence, with no alternate lifecycle`, () => {
    const base = { ...g.records[0] };
    delete base.evidenceRef;
    assert.equal(validateEvidenceRecord(base, root).valid, false);
    assert.equal(
      validateEvidenceRecord({ ...g.records[0], state: 'UNAVAILABLE' }, root).valid,
      false
    );
    assert.equal(
      validateEvidenceRecord({ ...g.records[0], blockedReason: null }, root).valid,
      false
    );
    assert.equal(
      validateEvidenceRecord(
        { ...g.records[0], evidenceRef: 'missing-integration-proof.json:key' },
        root
      ).valid,
      false
    );
    assert.match(g.doc, /SHA: pending Claude commit/);
  });
}

// Group 1 unique behavior tests
test('group 1: existing executor resolves only declared routes and keeps session uncertainty explicit', () => {
  const { resolveRoute, inspectVerdict } = require('../executor');
  const registry = { sources: [], dispatchRoutes: {} };
  assert.equal(resolveRoute({ provider: 'missing', model: 'fixture' }, {}, registry), null);
  const route = resolveRoute(
    { provider: 'fixture', model: 'fixture-model', harness: 'fixture-harness' },
    {},
    registry
  );
  assert.equal(route.harnessName, 'fixture-harness');
  assert.equal(route.model, 'fixture-model');
  assert.equal(inspectVerdict({ exitCode: 0, stdout: '{"status":"running"}' }), 'alive');
  assert.equal(inspectVerdict({ exitCode: 1, stderr: 'Agent not found' }), 'gone');
  assert.equal(inspectVerdict({ exitCode: 1, stderr: 'gateway timeout' }), 'unknown');
  assert.equal(inspectVerdict({ exitCode: 0, stdout: '' }), 'unknown');
});

test('group 1: handoff points to the existing Controller adapters and requires missing live artifacts', () => {
  const { doc } = loadedA[1];
  for (const file of [
    'orchestrate.js',
    'executor.js',
    'sources.js',
    'hermes-session.js',
    'route-probe.js',
    'route-health.js',
  ])
    assert.ok(doc.includes('tools/ai-brain/' + file), file);
  assert.match(
    read('tools/ai-brain/hermes-session.js'),
    /Controller retains model\/account choice/
  );
  for (const artifact of [
    'decision log',
    'launch result',
    'session ID',
    'independent review',
    'response',
  ])
    assert.ok(doc.includes(artifact), artifact);
});

// Group 2 unique behavior tests
test('group 2: existing role loader selects review/UI skills and refuses unknown roles', () => {
  const pack = require('../skill-pack');
  assert.ok(pack.skillsFor('author').some((s) => s.name === 'systematic-debugging'));
  assert.ok(pack.skillsFor('reviewer').some((s) => s.name === 'receiving-code-review'));
  assert.ok(
    pack
      .skillsFor('author.ui')
      .every((s) => s.name.startsWith('impeccable') || s.name.startsWith('vercel-'))
  );
  assert.deepEqual(pack.skillsFor('unassigned'), []);
  const previous = process.env.SHIPDE_SKILL_PACK;
  try {
    delete process.env.SHIPDE_SKILL_PACK;
    assert.ok(pack.lockedPack('author.ui').startsWith(pack.UI_AUTHORITY_HEADER));
    assert.ok(pack.lockedPack('author').startsWith(pack.LOCK_HEADER));
    process.env.SHIPDE_SKILL_PACK = 'off';
    assert.equal(pack.lockedPack('author'), '');
  } finally {
    if (previous === undefined) delete process.env.SHIPDE_SKILL_PACK;
    else process.env.SHIPDE_SKILL_PACK = previous;
  }
  for (const r of loadedA[2].records.filter((r) =>
    ['obra/superpowers', 'pbakaus/impeccable'].includes(r.repo)
  ))
    assert.ok(read(r.caller).includes(r.versionRef));
});

async function gateFixture(mode) {
  const source = read('tools/ai-brain/orchestrate/gates.js');
  const start = source.indexOf('async function runToolGates(params)');
  const end = source.indexOf('\n/**', start);
  assert.ok(start > 0 && end > start);
  const tool = {
    id: 'fixture-gate',
    command: mode === 'missing' ? null : 'fixture',
    installed: mode !== 'missing',
  };
  let calls = 0;
  let repairs = 0;
  const log = {};
  const context = {
    require: (id) => {
      assert.equal(id, '../tool-manifest');
      return { gatesFor: () => [tool], appliesTo: () => true };
    },
    ToolGate: { PASSED: 'PASSED', UNAVAILABLE: 'UNAVAILABLE', REFUSED: 'REFUSED' },
    SHA_40: /^[a-f0-9]{40}$/,
    roleOf: () => 'author',
    changedFileNames: () => ({ names: ['fixture.js'], detail: null }),
    runGateCommand: () => {
      calls++;
      return { status: mode === 'fail' ? 1 : 0 };
    },
    gateUnavailableReason: () => null,
    gateOutput: () => 'fixture violation',
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.run = runToolGates;', context);
  const result = await context.run({
    o: {},
    item: { id: 'fixture' },
    log,
    workerRoot: '.',
    baseSha: 'a'.repeat(40),
    targetSha: 'b'.repeat(40),
    repair: async () => {
      repairs++;
      return { sha: 'c'.repeat(40) };
    },
  });
  return { result, log, calls, repairs };
}

test('group 2: Controller executes available gate and refuses a persistent violation after one repair', async () => {
  const pass = await gateFixture('pass');
  assert.equal(pass.result.status, 'PASSED');
  assert.equal(pass.calls, 1);
  assert.equal(pass.repairs, 0);
  assert.equal(pass.log.toolGates[0].status, 'PASSED');
  const fail = await gateFixture('fail');
  assert.equal(fail.result.status, 'REFUSED');
  assert.equal(fail.calls, 2);
  assert.equal(fail.repairs, 1);
  assert.match(fail.result.reason, /TOOL_GATE_FAILED/);
});

test('group 2: unavailable tool has an explicit unavailable record, never an individual pass', async () => {
  const missing = await gateFixture('missing');
  assert.equal(missing.calls, 0);
  assert.equal(missing.log.toolGates.length, 1);
  assert.equal(missing.log.toolGates[0].status, 'UNAVAILABLE');
  assert.ok(!missing.log.toolGates.some((r) => r.status === 'PASSED'));
  const source = require('./helpers/orchestrate-sources').readOrchestrateSources();
  const call = source.indexOf('const toolGate = await runToolGates(');
  assert.ok(call > 0);
  assert.match(source.slice(call, call + 1700), /toolGate.status === ToolGate.REFUSED/);
});

// Group 3 unique behavior tests
test('group 3: existing context builder packs explicit scope and rejects unsafe paths and oversized input', () => {
  const { createContextPack, safeRelative } = require('../context-pack');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-group3-'));
  try {
    fs.writeFileSync(path.join(temp, 'selected.js'), 'function selected() { return 1; }\n');
    fs.writeFileSync(path.join(temp, 'unrelated.js'), 'not selected');
    const packed = createContextPack([{ allowedPaths: ['selected.js', '../outside.js'] }], {
      root: temp,
      outputDir: path.join(temp, 'artifacts'),
      maxFileBytes: 100,
      maxTotalBytes: 100,
    });
    assert.deepEqual(packed.files, ['selected.js']);
    assert.ok(packed.content.includes('function selected'));
    assert.ok(!packed.content.includes('not selected'));
    assert.deepEqual(JSON.parse(fs.readFileSync(packed.path + '.manifest.json', 'utf8')).files, [
      'selected.js',
    ]);
    assert.throws(
      () =>
        createContextPack([{ allowedPaths: ['selected.js'] }], {
          root: temp,
          outputDir: path.join(temp, 'rejected'),
          maxFileBytes: 1,
        }),
      /CONTEXT_FILE_TOO_LARGE/
    );
    assert.equal(fs.existsSync(path.join(temp, 'rejected')), false);
    for (const value of ['../outside.js', '/absolute.js', 'Z:/absolute.js'])
      assert.equal(safeRelative(value), null);
    const serena = require('../serena');
    assert.throws(() => serena.assertReadOnly({ edit: true }), /MUTATION_REFUSED/);
    assert.equal(serena.estimateTokens('abcdefgh'), 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('group 3: documents byte versus token limits and the missing upstream acceptance paths', () => {
  const { doc } = loadedA[3];
  for (const phrase of [
    'NOT a token budget',
    'preview diff',
    'source citations',
    'raw fallback',
    'MUTATION_REFUSED',
    'Never pack the whole repository',
  ])
    assert.ok(doc.includes(phrase), phrase);
  const source = read('tools/ai-brain/context-pack.js');
  assert.ok(source.includes('maxTotalBytes'));
  assert.ok(!source.includes('maxTokens'), 'reassess evidence if a token gate is added');
});

// ---------------------------------------------------------------------------
// Family B: Groups 4-6 (LINT-FORMAT, TESTING, SECURITY)
// ---------------------------------------------------------------------------
const FAMILY_B = [
  {
    num: 4,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-4-LINT-FORMAT.md',
    workItemId: 'GOAL-AUTOCLAW-REPOS-5',
  },
  {
    num: 5,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-5-TESTING.md',
    workItemId: 'GOAL-AUTOCLAW-REPOS-6',
  },
  {
    num: 6,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md',
    workItemId: 'GOAL-AUTOCLAW-REPOS-7',
  },
];

const loadedB = Object.fromEntries(FAMILY_B.map((g) => [g.num, { ...g, ...loadGroup(g.docPath) }]));

const CORE_EVIDENCE_FIELDS = [
  'workItemId',
  'toolId',
  'repo',
  'state',
  'evidenceRef',
  'command',
  'blocked',
  'blockedReason',
  'verifiedAt',
  'verifiedBy',
];

for (const g of Object.values(loadedB)) {
  test(`group ${g.num}: evidence reuses item 1 validator and real manifest identity without promotion`, () => {
    assert.ok(g.records.length > 0);
    assert.equal(new Set(g.records.map((r) => r.toolId)).size, g.records.length);
    for (const record of g.records) {
      const result = validateEvidenceRecord(record, root);
      assert.equal(result.valid, true, result.errors.join('; '));
      const entry = manifest.find((m) => m.id === record.toolId);
      assert.ok(entry, record.toolId);
      assert.equal(record.repo, entry.repo);
      assert.equal(record.workItemId, g.workItemId);
      assert.equal(record.evidenceRef, entry.evidenceRef);
      assert.equal(
        record.state,
        entry.installed ? (record.command ? 'WIRED' : 'INSTALLED') : 'DECLARED'
      );
      assert.equal(record.execution, 'NOT_RUN');
      assert.equal(record.acceptance, 'PENDING');
      assert.ok(Number.isFinite(Date.parse(record.verifiedAt)));
      assert.ok(record.versionRef);
      if (record.blocked) {
        assert.equal(record.command, null);
        assert.ok(record.blockedReason.trim());
      }
      if (record.command) {
        assert.equal(record.command, entry.command);
        assert.ok(pkg.scripts[record.command]);
      }
      if (record.state === 'INSTALLED') {
        const dependency = record.evidenceRef.split(':')[0];
        const packageFile = json(dependency);
        assert.equal(
          packageFile.dependencies?.[record.toolId] || packageFile.devDependencies?.[record.toolId],
          record.versionRef
        );
      }
    }
  });

  test(`group ${g.num}: missing fields, invented states and absent evidence cannot validate`, () => {
    for (const field of CORE_EVIDENCE_FIELDS) {
      const broken = { ...g.records[0] };
      delete broken[field];
      assert.equal(validateEvidenceRecord(broken, root).valid, false, field);
    }
    assert.equal(validateEvidenceRecord({ ...g.records[0], state: 'PASS' }, root).valid, false);
    assert.equal(
      validateEvidenceRecord(
        { ...g.records[0], evidenceRef: 'missing-integration-evidence.json' },
        root
      ).valid,
      false
    );
    assert.equal(
      validateEvidenceRecord({ ...g.records[0], blocked: true, blockedReason: null }, root).valid,
      false
    );
  });
}

// Group 4 unique behavior test
test('group 4: Biome migration cannot remove legacy gates without per-scope parity', () => {
  const { doc, records } = loadedB[4];
  assert.deepEqual(records.map((r) => r.toolId).sort(), ['eslint', 'prettier']);
  assert.equal(
    manifest.some((m) => m.repo === 'biomejs/biome'),
    false
  );
  for (const file of [
    'package.json',
    'apps/web/package.json',
    'apps/api/package.json',
    'packages/testkit/package.json',
  ]) {
    const p = json(file);
    assert.equal(p.dependencies?.['@biomejs/biome'], undefined);
    assert.equal(p.devDependencies?.['@biomejs/biome'], undefined);
    assert.equal(p.devDependencies?.['oxlint'], undefined);
  }
  assert.match(pkg.scripts.lint, /eslint/);
  assert.match(pkg.scripts['format:check'], /verify-formatting/);
  assert.ok(pkg.devDependencies.eslint && pkg.devDependencies.prettier);
  assert.match(read('eslint.config.mjs'), /@typescript-eslint\/parser/);
  assert.match(read('apps/web/eslint.config.mjs'), /eslint-config-next/);
  assert.match(read('scripts/verify-contracts.ts'), /prettier\.format/);
  assert.match(read('.github/workflows/current-application.yml'), /pnpm lint/);
  assert.match(read('.github/workflows/current-application.yml'), /pnpm format:check/);
  assert.match(read('lefthook.yml'), /staged-secret-scan/);
  for (const scope of [
    'scripts and workspace lint',
    'Next.js rules/plugins',
    'formatting',
    'generated output',
    'CI',
    'hooks',
    'import organization',
  ]) {
    assert.ok(
      doc.split('\n').some((line) => line.split('|')[1]?.trim() === scope),
      scope
    );
  }
  assert.match(doc, /No scope has parity/);
  assert.match(doc, /version\/ref unresolved/);
});

// Group 5 unique behavior test
test('group 5: testing inventory preserves all nine capabilities and migration consumers', () => {
  const { doc, records } = loadedB[5];
  assert.deepEqual(
    records.map((r) => r.toolId).sort(),
    [
      'axe-core',
      'k6',
      'lighthouse-ci',
      'msw',
      'openapi-typescript',
      'playwright',
      'playwright-cli',
      'supertest',
    ].sort()
  );
  assert.match(doc, /ChromeDevTools\/chrome-devtools-mcp/);
  assert.equal(
    manifest.some((m) => /chrome-devtools-mcp/i.test(m.repo)),
    false
  );
  assert.match(doc, /absent shared manifest id/);
  assert.match(doc, /@playwright\/cli@0\.1\.2/);
  const kit = json('packages/testkit/package.json');
  assert.ok(kit.dependencies.msw && kit.dependencies.supertest);
  assert.ok(json('apps/api/package.json').devDependencies.supertest);
  assert.match(kit.scripts.test, /src\/msw\/msw.test.ts/);
  assert.match(json('apps/web/package.json').scripts['test:e2e'], /tsx/);
  assert.match(read('scripts/verify-contracts.ts'), /openapi-typescript/);
  assert.match(pkg.scripts['contract:check'], /verify-contracts/);
  assert.ok(pkg.scripts.typecheck);
  for (const p of [
    'packages/testkit/src/msw/msw.test.ts',
    'packages/testkit/src/integration.ts',
    'docs/product-spec/contracts/openapi.yaml',
    'packages/contracts/src/openapi.ts',
  ]) {
    assert.ok(fs.existsSync(path.join(root, p)), p);
  }
  for (const phrase of [
    'teardown on success, failure and timeout',
    'incomplete/violations become findings',
    'Keep MSW/Supertest',
    'exact SHA',
  ]) {
    assert.ok(doc.includes(phrase), phrase);
  }
});

// Group 6 unique behavior tests (Trivy + Gitleaks)
require('tsx/cjs');
const trivy = require('../../../scripts/verify-trivy.ts');
const secrets = require('../../../scripts/verify-secrets.ts');

test('group 6: security inventory preserves unavailable gates and existing scan authorities', () => {
  const { doc, records } = loadedB[6];
  assert.deepEqual(records.map((r) => r.toolId).sort(), [
    'agent-scan',
    'gitleaks',
    'semgrep',
    'trivy',
  ]);
  const unavailable = records.find((r) => r.toolId === 'agent-scan');
  assert.equal(unavailable.blocked, true);
  assert.equal(unavailable.command, null);
  assert.equal(manifest.find((m) => m.id === 'agent-scan').gate, true);
  assert.match(doc, /TOOL_GATE_UNAVAILABLE, never PASS/);
  assert.match(read('.github/workflows/security-baseline.yml'), /8\.24\.0/);
  assert.match(read('.github/workflows/security-baseline.yml'), /--test-negative/);
  assert.ok(read('.gitleaks.toml').length > 0);
  assert.equal(trivy.TRIVY_PINNED_VERSION, '0.75.0');
  assert.equal(trivy.TRIVY_SECURITY_CHECKS, 'vuln,misconfig');
});

test('group 6: Trivy benign, malicious and broken process fixtures preserve distinct outcomes', () => {
  const args = trivy.buildFsScanArgs('fixture-target');
  for (const [status, kind, code] of [
    [0, 'clean', 0],
    [1, 'finding', 1],
    [2, 'operational', 2],
    [null, 'operational', 2],
  ]) {
    const outcome = trivy.executeTrivy('fixture-scanner', args, () => ({
      status,
      stdout: 'fixture',
      stderr: '',
    }));
    assert.equal(outcome.kind, kind);
    assert.equal(outcome.exitCode, code);
  }
  for (const spawn of [
    () => {
      throw new Error('fixture spawn error');
    },
    () => ({ status: null, error: new Error('ENOENT') }),
  ]) {
    assert.equal(trivy.executeTrivy('fixture-scanner', args, spawn).exitCode, 2);
  }
  const missing = trivy.runTrivyVerification([], {
    getBin: () => null,
    logger: { log() {}, error() {} },
  });
  assert.equal(missing.kind, 'operational');
  assert.equal(missing.exitCode, 2);
});

test('group 6: Gitleaks clean, finding, malformed report and operational fixtures never collapse', (t) => {
  const fakeFs = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify([{ RuleID: 'synthetic-rule', File: 'fixture.js' }]),
  };
  const run = (status, fixtureFs = fakeFs) =>
    secrets.executeGitleaks(
      'fixture-scanner',
      [],
      'fixture-report.json',
      () => ({ status, stdout: '', stderr: '' }),
      fixtureFs
    );
  assert.deepEqual([run(0).success, run(0).exitCode, run(0).findings.length], [true, 0, 0]);
  assert.deepEqual([run(1).success, run(1).exitCode, run(1).findings.length], [true, 1, 1]);
  for (const status of [2, 3, null]) {
    assert.equal(run(status).success, false);
    assert.ok(run(status).operationalError);
  }
  for (const fixtureFs of [
    { existsSync: () => false, readFileSync: () => '' },
    { existsSync: () => true, readFileSync: () => '{broken' },
    { existsSync: () => true, readFileSync: () => '[]' },
  ]) {
    assert.equal(run(1, fixtureFs).success, false);
    assert.ok(run(1, fixtureFs).operationalError);
  }
  const thrown = secrets.executeGitleaks(
    'fixture-scanner',
    [],
    'fixture-report.json',
    () => {
      throw new Error('ENOENT');
    },
    fakeFs
  );
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const missing = secrets.runCliVerification([], { rootDir: root, getBin: () => null });
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.message, 'Gitleaks binary not found');
  assert.equal(thrown.success, false);
  assert.ok(thrown.operationalError);
});

// ---------------------------------------------------------------------------
// Family C: Groups 7-9 (PRODUCT-TOOLCHAIN, CONDITIONAL, CANDIDATES)
// ---------------------------------------------------------------------------
const FAMILY_C = [
  {
    num: 7,
    goalNum: 8,
    docPath:
      'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md',
    repos: [
      'git-for-windows/git',
      'nodejs/node',
      'pnpm/pnpm',
      'docker/compose',
      'nestjs/nest',
      'prisma/orm',
      'taskforcesh/bullmq',
      'vercel/turborepo',
      'evilmartians/lefthook',
      'open-telemetry/opentelemetry-js',
    ],
  },
  {
    num: 8,
    goalNum: 9,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-8-CONDITIONAL.md',
    repos: [
      'storybookjs/storybook',
      'pact-foundation/pact-js',
      'Shopify/toxiproxy',
      'SpectoLabs/hoverfly',
      'stoplightio/prism',
      'promptfoo/promptfoo',
      'renovatebot/renovate',
      'thanglequoc/vietnamese-provinces-database',
    ],
  },
  {
    num: 9,
    goalNum: 10,
    docPath: 'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-9-CANDIDATES.md',
    repos: ['DeusData/codebase-memory-mcp', 'Nox-HQ/nox'],
  },
];

const evidenceContract = read(
  'docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md'
);

for (const spec of FAMILY_C) {
  const { doc, records } = loadGroup(spec.docPath);

  test(`group ${spec.num}: exact inventory without duplicates`, () => {
    assert.deepEqual(
      records.map((r) => r.repo),
      spec.repos
    );
    assert.equal(new Set(records.map((r) => r.repo.toLowerCase())).size, records.length);
  });

  test(`group ${spec.num}: reuse shared contract and manifest evidence without state inflation`, () => {
    for (const r of records) {
      for (const k of CORE_EVIDENCE_FIELDS) assert.ok(Object.hasOwn(r, k), k);
      assert.equal(r.workItemId, `GOAL-AUTOCLAW-REPOS-${spec.goalNum}`);
      assert.ok(evidenceContract.includes(r.state));
      assert.ok(Number.isFinite(Date.parse(r.verifiedAt)));
      assert.equal(r.command, null);
      assert.equal(r.blocked, true);
      assert.ok(r.blockedReason.length > 10);
      assert.ok(r.capability.length > 5);
      assert.ok(fs.existsSync(path.join(root, r.evidenceRef.split(':')[0])));
      const m = manifest.find((entry) => entry.repo.toLowerCase() === r.repo.toLowerCase());
      if (!m) {
        assert.equal(r.toolId, null);
        assert.equal(r.registrationPending, true);
        assert.equal(r.state, 'DECLARED');
        continue;
      }
      assert.equal(r.toolId, m.id);
      assert.equal(r.evidenceRef, m.evidenceRef);
      assert.equal(r.registrationPending, false);
      assert.equal(r.state, spec.goalNum === 8 && m.installed ? 'INSTALLED' : 'DECLARED');
      if (r.state === 'INSTALLED') {
        const [file, key] = r.evidenceRef.split(':');
        assert.deepEqual(r.versionRef, json(file)[key]);
      }
    }
  });

  test(`group ${spec.num}: explicit limitations and real caller paths, entirely offline`, () => {
    for (const s of [
      'incomplete contract records',
      'SHA: pending Claude commit',
      'not live tool availability',
    ])
      assert.ok(doc.includes(s));
    for (const m of doc.matchAll(
      /(?:scripts|apps|packages|infra|prisma)\/[\w/.-]+\.(?:ts|json|yaml|yml|prisma)/g
    ))
      assert.ok(fs.existsSync(path.join(root, m[0])), m[0]);
    if (spec.goalNum !== 8) {
      assert.ok(records.every((r) => r.state === 'DECLARED'));
      assert.match(doc, /not wired/);
    }
    if (spec.goalNum === 9) {
      assert.match(doc, /Before installation/);
      assert.match(doc, /No packages installed/);
    }
    if (spec.goalNum === 10)
      for (const s of [
        'Serena',
        'semantic editing',
        'coverage parity',
        'benign and violating fixtures',
      ])
        assert.ok(doc.includes(s));
  });
}
