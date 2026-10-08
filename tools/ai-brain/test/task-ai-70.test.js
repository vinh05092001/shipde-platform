'use strict';

/**
 * TASK-AI-70: the Controller sees today's working sources as data.
 *
 * Every scenario here drives the real `cli.js` in a child process with a
 * temporary HOME, USERPROFILE and TEMP outside the worktree, so the account
 * registry, the quota store, the decision log and the discovery data are all
 * disposable and nothing touches the operator's machine. Nothing here reaches a
 * network, a scheduled task or a credential.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  importCatalogue,
  proofVerdict,
  resolveSource,
  hostOf,
} = require('../discovery/catalogue-import');
const { readDiscoveryCatalogue } = require('../discovery/read');
const sourcesApi = require('../sources');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, '..', 'cli.js');
const CATALOGUE_FIXTURE = path.join(__dirname, 'fixtures', 'task-ai-70', 'ws1-catalogue.jsonl');

/** The gateway host the audited fixture dialled; sources.json knows it as 9router. */
const GATEWAY_HOST = '127.0.0.1:20128';

/**
 * Where scratch directories go, in order of preference. `os.tmpdir()` first
 * because that is the convention, then the variables that override it, then a
 * directory under the home. Nothing is written inside the repository: a
 * worktree scratch directory is exactly what TASK-AI-69 review round 3 had to
 * undo. The first writable base wins, so the suite still runs where the OS temp
 * directory is read-only, and reports itself skipped when nothing is writable.
 */
const TEMP_BASES = [
  () => os.tmpdir(),
  () => process.env.TMPDIR,
  () => process.env.TEMP,
  () => process.env.TMP,
  () => (process.env.HOME ? path.join(process.env.HOME, '.cache', 'ai-brain-tests') : null),
  () =>
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.cache', 'ai-brain-tests') : null,
];

let tempBaseCache;

function writableTempBase() {
  if (tempBaseCache !== undefined) return tempBaseCache;
  tempBaseCache = null;
  for (const candidate of TEMP_BASES) {
    const base = candidate();
    if (!base) continue;
    const probe = path.join(base, '.ai-brain-probe-' + process.pid);
    try {
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(probe, 'x');
      fs.rmSync(probe, { force: true });
      tempBaseCache = base;
      return base;
    } catch (err) {
      // EPERM/EACCES/EROFS: try the next base rather than failing the suite.
    }
  }
  return null;
}

/** A scratch directory outside the worktree, or null when nothing is writable. */
function tmpDir(prefix) {
  const base = writableTempBase();
  if (!base) return null;
  return fs.mkdtempSync(path.join(base, prefix));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * A disposable account registry. The gateway account declares one stale model on
 * purpose — the whole point is that today's models reach the Controller from the
 * audit, not from this list. The Codex account binds the agent-cli source by
 * `sourceId` (the planner reader's binding) and names it as its `provider` (the
 * dispatch reader's binding).
 */
function writeRegistry(home) {
  writeJson(path.join(home, '.shipde', 'accounts.registry.json'), {
    version: 1,
    accounts: [
      {
        id: 'gw-local',
        provider: 'oc',
        enabled: true,
        tier: 0,
        limits: {},
        capabilities: { contextWindow: 200000, tools: true },
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
        models: [{ model: 'stale/old-model-1', quality: 70 }],
      },
      {
        id: 'codex-main',
        provider: 'codex',
        sourceId: 'codex',
        enabled: true,
        tier: 0,
        limits: {},
        capabilities: { contextWindow: 200000, tools: true },
        models: [{ model: 'codex-demo-model-a', quality: 80 }],
      },
    ],
  });
}

function profileFile(root, overrides) {
  const file = path.join(root, 'profile.json');
  writeJson(
    file,
    Object.assign(
      {
        taskId: 'TASK-AI-70-T',
        role: 'reviewer',
        complexity: 'standard',
        requiredCapabilities: [],
        proofFloor: 'API_PASS',
        contextSize: 64000,
        expectedDuration: 600000,
        latencyPriority: 'normal',
        qualityFloor: 0,
        costCeiling: 1000,
        requiredHarness: null,
        forbiddenFailureDomains: [],
        resourceCeiling: 4,
        currentWorkload: 1,
      },
      overrides || {}
    )
  );
  return file;
}

function envFor(home) {
  const temp = path.join(home, 'Temp');
  return Object.assign({}, process.env, {
    HOME: home,
    USERPROFILE: home,
    TEMP: temp,
    TMP: temp,
    AGY_POOL_RUNS_DIR: '',
    AGY_RUNS_DIR: '',
  });
}

function runCli(args, home, cwd) {
  const result = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: cwd || REPO_ROOT,
    env: envFor(home),
    encoding: 'utf8',
    timeout: 120000,
  });
  result.text = (result.stdout || '') + (result.stderr || '');
  return result;
}

/**
 * The `--json` payload the CLI prints: either the whole stdout, or the block it
 * prints after a human-readable banner.
 */
function parseJsonTail(text) {
  const trimmed = String(text).trim();
  const idx = trimmed.indexOf('\n{\n');
  const body = trimmed.startsWith('{') ? trimmed : idx >= 0 ? trimmed.slice(idx + 1) : '';
  assert.ok(body, 'no JSON payload in CLI output:\n' + text);
  return JSON.parse(body);
}

/** The failure domain a seven-part key belongs to. */
function domainOf(key) {
  const parts = String(key).split('::');
  return parts[2] + '/' + parts[3];
}

/**
 * A scenario world, or a skip. A host whose scratch directory is read-only must
 * not fail the suite — it has to say it could not run.
 */
function requireScenario(t, prefix) {
  const world = scenario(prefix);
  if (!world) {
    t.skip('no writable scratch directory on this host');
    return null;
  }
  return world;
}

/**
 * One scenario's world: a temporary home, a temporary discovery data dir, a
 * temporary evidence store, a temporary decision log, and the audited fixture.
 */
function scenario(prefix) {
  const root = tmpDir(prefix);
  if (!root) return null;
  const home = path.join(root, 'home');
  const discoveryDir = path.join(root, 'discovery');
  const evidenceDir = path.join(root, 'evidence');
  const decisionDir = path.join(root, 'decisions');
  // An empty pool runtime, so a candidate set never depends on whether the host
  // happens to have agy accounts. Nothing here reaches a scheduled task.
  const poolRunsDir = path.join(root, 'pool-runs');
  fs.mkdirSync(path.join(home, 'Temp'), { recursive: true });
  fs.mkdirSync(poolRunsDir, { recursive: true });
  writeRegistry(home);
  const world = {
    root,
    home,
    discoveryDir,
    evidenceDir,
    decisionDir,
    poolRunsDir,
    import(extra) {
      return runCli(
        [
          'discovery',
          'import',
          '--catalogue',
          CATALOGUE_FIXTURE,
          '--discovery-dir',
          discoveryDir,
          '--evidence-dir',
          evidenceDir,
        ].concat(extra || []),
        home
      );
    },
    dispatchJson(profileOverrides) {
      const profile = profileFile(root, profileOverrides);
      return runCli(
        [
          'dispatch',
          '--dry-run',
          '--profile',
          profile,
          '--discovery-dir',
          discoveryDir,
          '--evidence-dir',
          evidenceDir,
          '--decision-dir',
          decisionDir,
          '--pool-runtime-dir',
          poolRunsDir,
          '--json',
        ],
        home
      );
    },
    candidates(view) {
      return runCli(
        [
          'discovery',
          'candidates',
          '--view',
          view || 'dispatch',
          '--discovery-dir',
          discoveryDir,
          '--evidence-dir',
          evidenceDir,
          '--json',
        ],
        home
      );
    },
    ledgerLines() {
      const file = path.join(discoveryDir, 'catalogue.jsonl');
      if (!fs.existsSync(file)) return [];
      return fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim());
    },
  };
  return world;
}

function rejectedFor(result, upstream) {
  return result.rejected.filter((r) => r.upstream === upstream);
}

function topKeys(result) {
  return result.top3.map((entry) => entry.candidateKey);
}

describe('TASK-AI-70: catalogue import through the CLI', () => {
  test('AC-AI-70-01: an imported catalogue makes dispatch rank several candidates across failure domains', (t) => {
    const w = requireScenario(t, 'ai70-rank-');
    if (!w) return;

    const before = w.dispatchJson();
    assert.equal(before.status, 1, before.text);
    assert.match(before.text, /PROOF_FLOOR_NOT_MET:NONE|PROOF_FLOOR/);

    const imported = w.import();
    assert.equal(imported.status, 0, imported.text);
    assert.match(imported.text, /advertised 9 candidates/);
    assert.match(imported.text, /proof API_PASS 5/);

    const result = w.dispatchJson();
    assert.equal(result.status, 0, result.text);
    const payload = parseJsonTail(result.text);

    assert.ok(
      payload.top3.length >= 2,
      'expected several ranked candidates, got ' + topKeys(payload)
    );
    const domains = new Set(topKeys(payload).map(domainOf));
    assert.ok(domains.size >= 2, 'expected distinct failure domains, got ' + [...domains]);

    // Every pinned and ranked key is the seven-part identity dispatch records.
    for (const key of topKeys(payload)) {
      assert.equal(key.split('::').length, 7, 'seven-part key expected: ' + key);
    }
    const provenUpstreams = ['alpha', 'bravo', 'golf'];
    for (const key of topKeys(payload)) {
      assert.ok(
        provenUpstreams.includes(key.split('::')[3]),
        'unproven candidate ranked above the proof floor: ' + key
      );
    }
    assert.ok(provenUpstreams.includes(payload.pinned.split('::')[3]), payload.pinned);
    assert.match(result.text, /Top candidates:/);
    assert.match(result.text, /Pinned \(dry run, no reservation\): /);
  });

  test('AC-AI-70-02: CATALOG_ONLY, not-probed and historical-only rows never pass the proof floor', (t) => {
    const w = requireScenario(t, 'ai70-floor-');
    if (!w) return;
    assert.equal(w.import().status, 0);

    const result = w.dispatchJson({ proofFloor: 'API_PASS' });
    assert.equal(result.status, 0, result.text);
    const payload = parseJsonTail(result.text);
    const ranked = topKeys(payload);

    for (const upstream of ['charlie', 'delta', 'foxtrot']) {
      const rows = rejectedFor(payload, upstream);
      assert.ok(rows.length > 0, upstream + ' should be refused');
      // An advertised row without an account is refused as a wildcard; the same
      // model on the bound account is refused because nothing ever proved it.
      // Neither refusal may name a proof level.
      for (const row of rows) {
        assert.ok(
          row.reasonCode === 'WILDCARD_ACCOUNT' || row.reasonCode === 'PROOF_FLOOR_NOT_MET:NONE',
          upstream + ' refused for the wrong reason: ' + row.reasonCode
        );
        assert.ok(!ranked.some((k) => k.includes(upstream + '/')), upstream + ' was selectable');
      }
      assert.ok(
        rows.some((r) => r.reasonCode === 'PROOF_FLOOR_NOT_MET:NONE'),
        upstream + ' was never refused for its missing proof'
      );
    }

    // The advertisement is visible; proof never is. A listing is news, not
    // availability, so even a row the audit proved stays UNTESTED until the
    // account-bound key carries the evidence.
    const catalogue = readDiscoveryCatalogue({ dataDir: w.discoveryDir });
    const charlie = catalogue.candidates.find((c) => c.modelId === 'charlie/test-listing-only');
    assert.ok(charlie, 'advertised row missing from the discovery read surface');
    assert.equal(charlie.resultState, 'UNTESTED');
    assert.equal(charlie.proofLevel, null);
    assert.equal(charlie.alive, false);
    const alpha = catalogue.candidates.find((c) => c.modelId === 'alpha/test-writer-1');
    assert.ok(alpha, 'proven row missing from the discovery read surface');
    assert.equal(alpha.resultState, 'UNTESTED');
    assert.equal(alpha.proofLevel, null);

    // Proof lands on the key dispatch can match — the bound account's key — and
    // only for rows the audit actually probed.
    const evidence = JSON.parse(fs.readFileSync(path.join(w.evidenceDir, 'evidence.json'), 'utf8'));
    const proven = evidence.combinations.map((c) => c.upstream).sort();
    assert.deepEqual(proven, ['alpha', 'bravo', 'echo', 'golf']);
    for (const combo of evidence.combinations) {
      assert.equal(combo.accountId, 'gw-local');
      assert.equal(combo.quotaScope, 'gw-local');
      assert.equal(combo.evidence.length, 1);
      assert.equal(combo.evidence[0].status, 'passed');
      assert.equal(combo.evidence[0].proofLevel, 'API_PASS');
      assert.equal(combo.evidence[0].source, 'catalogue-import');
      assert.ok(Date.parse(combo.evidence[0].ts) < Date.parse('2026-10-03'), 'audit instant lost');
    }

    // An import never writes a failure, so it never sets a cooldown.
    assert.equal(evidence.cooldowns && Object.keys(evidence.cooldowns).length, 0);
    assert.equal(evidence.upstreamStatus && Object.keys(evidence.upstreamStatus).length, 0);
  });

  test('AC-AI-70-07: registered gateways import by host; unregistered ones are skipped with UNKNOWN_SOURCE', (t) => {
    const registry = sourcesApi.loadSources();
    // The rows below are resolvable ONLY by gateway host: their `source` labels
    // match no registry id or label, exactly like the real WS1 rows for tencent,
    // amd-radeon and jev. An import that did not consult the registry host index
    // would report every one of them as an unknown source.
    const hostOnlyRows = [
      {
        row: { source: 'Tencent TokenHub', gateway: 'tokenhub-intl.tencentcloudmaas.com' },
        id: 'tencent',
      },
      { row: { source: 'AMD Radeon', gateway: 'developer.amd.com.cn' }, id: 'amd-radeon' },
      { row: { source: 'Jev (typesafe /systemone)', gateway: 'api.typesafe.ai' }, id: 'jev' },
    ];
    for (const { row, id } of hostOnlyRows) {
      const resolved = resolveSource(row, registry);
      assert.equal(resolved.source && resolved.source.id, id, 'host resolution failed for ' + id);
      assert.equal(resolved.matchedBy, 'host');
      assert.ok(
        !registry.sources.some(
          (s) =>
            String(s.label).toLowerCase() === row.source.toLowerCase() ||
            String(s.id).toLowerCase() === row.source.toLowerCase()
        ),
        'fixture row for ' + id + ' must not be resolvable by label'
      );
    }

    const w = requireScenario(t, 'ai70-gateway-');
    if (!w) return;
    const imported = w.import(['--json']);
    assert.equal(imported.status, 0, imported.text);
    const summary = parseJsonTail(imported.text);

    // Registered gateways resolved by host reached the ledger.
    assert.equal(summary.sources.tencent, 1, 'a host-resolved tencent row was not imported');
    assert.equal(
      summary.sources['amd-radeon'],
      1,
      'a host-resolved amd-radeon row was not imported'
    );
    const ledgerModelIds = w.ledgerLines().map((line) => JSON.parse(line).modelId);
    assert.ok(
      ledgerModelIds.includes('tencent/test-host-resolved-source'),
      'the host-resolved tencent advertisement is missing from the ledger'
    );
    assert.ok(
      ledgerModelIds.includes('amd-radeon/test-host-resolved-source'),
      'the host-resolved amd-radeon advertisement is missing from the ledger'
    );

    // A registered gateway the registry declares as serving no models resolves,
    // and is then refused by that declaration rather than by an unknown source.
    assert.equal(
      summary.sources.jev,
      undefined,
      'a decision service was counted as a model source'
    );
    assert.equal(summary.skipped.SOURCE_SERVES_NO_MODELS, 1);
    assert.ok(!ledgerModelIds.includes('jev/test-closed-question'));

    // Unregistered gateways are skipped, and named as unknown.
    assert.equal(summary.skipped.UNKNOWN_SOURCE, 2);
    for (const modelId of ['hotel/test-unregistered', 'pgs-grove/test-unregistered-vendor']) {
      assert.ok(
        !ledgerModelIds.includes(modelId),
        modelId + ' was imported from an unknown gateway'
      );
    }
    assert.equal(summary.totalRows, 16);
    assert.equal(summary.advertised, 9);
  });

  test('AC-AI-70-04: an imported Claude-family row stays excluded by the existing policy', (t) => {
    const w = requireScenario(t, 'ai70-policy-');
    if (!w) return;
    assert.equal(w.import().status, 0);

    const result = w.dispatchJson({ role: 'writer', proofFloor: 'NONE' });
    assert.equal(result.status, 0, result.text);
    const payload = parseJsonTail(result.text);
    const claudeRows = payload.rejected.filter((r) =>
      String(r.modelId).includes('test-claude-family')
    );
    assert.ok(claudeRows.length > 0, 'the Claude-family row was not refused');
    for (const row of claudeRows) {
      assert.equal(row.reasonCode, 'CLAUDE_FAMILY_EXCLUDED_BY_POLICY', row.candidateKey);
    }
    assert.ok(!topKeys(payload).some((k) => k.includes('test-claude-family')));
    assert.ok(!String(payload.pinned).includes('test-claude-family'));
  });

  test('AC-AI-70-06: re-import is idempotent, unknown and deferred rows are skipped, malformed rows counted', (t) => {
    const w = requireScenario(t, 'ai70-idempotent-');
    if (!w) return;
    const first = w.import(['--json']);
    assert.equal(first.status, 0, first.text);
    const firstSummary = parseJsonTail(first.text);
    const linesAfterFirst = w.ledgerLines().length;
    assert.equal(linesAfterFirst, 9);

    const second = w.import(['--json']);
    assert.equal(second.status, 0, second.text);
    const summary = parseJsonTail(second.text);
    assert.equal(
      summary.ledgerTransitions,
      0,
      'a repeated import appended to an append-only ledger'
    );
    assert.equal(summary.ledgerKeysAlreadyPresent, 9);
    assert.equal(summary.proofRecorded, 0);
    assert.equal(summary.proofAlreadyRecorded, firstSummary.proofRecorded);
    assert.equal(w.ledgerLines().length, linesAfterFirst, 'ledger grew on re-import');

    assert.equal(summary.skipped.UNKNOWN_SOURCE, 2, 'unregistered gateways were not skipped');
    assert.equal(summary.skipped.DEFERRED, 1, 'deferred source was not skipped');
    assert.equal(
      summary.skipped.SOURCE_SERVES_NO_MODELS,
      1,
      'a source serving no models was imported'
    );
    assert.equal(summary.skipped.NO_MODEL_ID, 2, 'rows without a model id were not skipped');
    assert.equal(summary.malformedRows, 1, 'malformed row was not counted');
    assert.equal(summary.proofWithheld.PROOF_WITHHELD_NOT_PROBED, 1);
    assert.equal(summary.proofWithheld.PROOF_WITHHELD_NOT_CURRENT, 1);
    assert.equal(summary.proofWithheld.NOT_A_PROOF, 2);
    assert.equal(summary.failureRows, 1);

    // Ledger lines are transitions only, with the seven-part key and no account.
    for (const line of w.ledgerLines()) {
      const record = JSON.parse(line);
      assert.equal(record.state, 'UNKNOWN');
      assert.equal(record.account, '');
      assert.equal(record.quotaScope, '');
      assert.equal(record.key.split('::').length, 7);
    }
  });

  test('an empty catalogue is refused and writes nothing', (t) => {
    const w = requireScenario(t, 'ai70-empty-');
    if (!w) return;
    const empty = path.join(w.root, 'empty.jsonl');
    fs.writeFileSync(empty, '', 'utf8');
    const refused = runCli(
      [
        'discovery',
        'import',
        '--catalogue',
        empty,
        '--discovery-dir',
        w.discoveryDir,
        '--evidence-dir',
        w.evidenceDir,
      ],
      w.home
    );
    assert.equal(refused.status, 2, refused.text);
    assert.match(refused.text, /CATALOGUE_REFUSED: CATALOGUE_EMPTY/);
    assert.equal(w.ledgerLines().length, 0);
    assert.equal(fs.existsSync(path.join(w.discoveryDir, 'catalogue.jsonl')), false);
  });
});

describe('TASK-AI-70: an agent-cli source becomes a candidate by a bound account', () => {
  test('AC-AI-70-03: a codex account with declared models yields seven-part codex candidates', (t) => {
    const w = requireScenario(t, 'ai70-codex-');
    if (!w) return;

    const planner = w.candidates('planner');
    assert.equal(planner.status, 0, planner.text);
    const listed = parseJsonTail(planner.text);
    const codexRows = listed.candidates.filter((c) => c.candidateKey.includes('::codex::'));
    assert.ok(
      codexRows.length > 0,
      'no codex candidate in the planner view:\n' +
        listed.candidates.map((c) => c.candidateKey).join('\n')
    );
    for (const row of codexRows) {
      assert.equal(row.candidateKey.split('::').length, 7, row.candidateKey);
      assert.equal(row.upstream, 'codex');
      assert.equal(row.account, 'codex-main');
      assert.equal(row.modelId, 'codex-demo-model-a');
    }

    const dispatchView = w.candidates('dispatch');
    const dispatchRows = parseJsonTail(dispatchView.text).candidates.filter((c) =>
      c.candidateKey.includes('::codex::')
    );
    assert.ok(dispatchRows.length > 0, 'dispatch view lost the codex candidate');

    // The registry declares the source, never a model: the model came from the account.
    const registry = sourcesApi.loadSources();
    const codex = sourcesApi.getSource('codex', registry);
    assert.equal(codex.servesModels, true);
    assert.equal(codex.modelsFrom, 'account');
    assert.equal(codex.models, undefined, 'sources.json must not declare models for codex');
    assert.equal(codex.model, undefined, 'sources.json must not declare a model for codex');
    const described = sourcesApi.describeAll({ registry }).find((s) => s.id === 'codex');
    assert.equal(described.servesModels, true);
    assert.equal(described.countsAsCapacity, false, 'a CLI harness is not capacity');
  });

  test('an agent-cli source with no bound account yields only an unresolved wildcard placeholder', (t) => {
    const registry = sourcesApi.loadSources();
    const w = requireScenario(t, 'ai70-codex-unbound-');
    if (!w) return;
    const emptyAccounts = path.join(w.root, 'none.json');
    writeJson(emptyAccounts, []);
    const listed = runCli(
      [
        'discovery',
        'candidates',
        '--view',
        'planner',
        '--accounts',
        emptyAccounts,
        '--discovery-dir',
        w.discoveryDir,
        '--evidence-dir',
        w.evidenceDir,
        '--json',
      ],
      w.home
    );
    assert.equal(listed.status, 0, listed.text);
    const rows = parseJsonTail(listed.text).candidates.filter((c) => c.upstream === 'codex');
    for (const row of rows) {
      // No account declares a model, so the only candidate is the unresolved
      // wildcard the chooser must refuse — never a concrete codex candidate.
      assert.equal(row.account, '*');
      assert.equal(row.modelId, '*');
    }
    assert.ok(registry.sources.some((s) => s.id === 'codex'));

    const refused = w.dispatchJson({ proofFloor: 'NONE' });
    const payload = parseJsonTail(refused.text);
    for (const row of payload.rejected.filter((r) => r.upstream === 'codex')) {
      assert.equal(row.reasonCode, 'WILDCARD_ACCOUNT', row.candidateKey);
    }
  });
});

describe('TASK-AI-70: nothing about the working sources is hard-coded', () => {
  test('AC-AI-70-05: no model id from the imported catalogue appears in the production modules', () => {
    const scanned = [
      'tools/ai-brain/discovery/catalogue-import.js',
      'tools/ai-brain/discovery/read.js',
      'tools/ai-brain/sources.js',
      'tools/ai-brain/candidates.js',
      'tools/ai-brain/cli.js',
      'tools/ai-brain/sources.json',
    ].map((rel) => ({ rel, text: fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8') }));

    const fixtureIds = fs
      .readFileSync(CATALOGUE_FIXTURE, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          const row = JSON.parse(line);
          return row && row.modelId ? String(row.modelId) : null;
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
    assert.ok(fixtureIds.length >= 5, 'fixture lost its rows');

    for (const modelId of fixtureIds) {
      for (const file of scanned) {
        assert.ok(!file.text.includes(modelId), modelId + ' is hard-coded in ' + file.rel);
      }
    }

    // The importer must not know any real advertised model either, so it stays a
    // data reader rather than a list that has to be edited.
    const catalogueFile = path.join(REPO_ROOT, 'tools/ai-brain/data/discovery/catalogue.jsonl');
    const known = new Set();
    for (const line of fs.readFileSync(catalogueFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const record = JSON.parse(line);
        if (record && typeof record.modelId === 'string' && record.modelId.length >= 8) {
          known.add(record.modelId);
        }
      } catch (err) {
        // A malformed ledger line names no model.
      }
    }
    assert.ok(known.size > 100, 'the committed ledger carried too few model ids to be a real scan');
    const importer = scanned[0];
    for (const modelId of known) {
      assert.ok(!importer.text.includes(modelId), 'the importer hard-codes ' + modelId);
    }

    // Adding a source stays a data change: the registry is the only place a source is
    // declared, and the importer names none of them — it resolves a row through
    // `registry.sources` and the registry's own endpoints.
    const registryFile = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'tools/ai-brain/sources.json'), 'utf8')
    );
    const declared = registryFile.sources.map((s) => s.id);
    assert.ok(declared.length > 5, 'the registry lost its sources');
    for (const id of declared) {
      assert.ok(
        !new RegExp('[\'"`]' + id + '[\'"`]').test(importer.text),
        'the importer names the source id ' + id + ' instead of resolving it from data'
      );
    }
  });
});

describe('TASK-AI-70: importer units (lowest useful level)', () => {
  const registry = sourcesApi.loadSources();

  test('proofVerdict maps the audited capability vocabulary and withholds honestly', () => {
    const probed = {
      capability: 'API_PASS',
      proofLevel: 'API_PASS',
      status: 'CURRENT_AVAILABLE',
      availability: 'AVAILABLE',
      evidence: 'probe nonce=X API_PASS',
    };
    assert.equal(proofVerdict(probed).level, 'API_PASS');
    assert.equal(proofVerdict(probed).reason, null);

    assert.equal(proofVerdict({ capability: 'CATALOG_ONLY', status: 'UNTESTED' }).level, null);
    assert.equal(
      proofVerdict({ capability: 'CATALOG_ONLY', status: 'UNTESTED' }).reason,
      'NOT_A_PROOF'
    );

    // A row that claims API_PASS while its own text says it was never probed.
    const listed = proofVerdict({
      capability: 'API_PASS',
      status: 'CURRENT_AVAILABLE',
      availability: 'AVAILABLE',
      evidence: 'live catalogue only — not probed 2026-10-01',
    });
    assert.equal(listed.level, null);
    assert.equal(listed.reason, 'PROOF_WITHHELD_NOT_PROBED');

    const historical = proofVerdict({
      capability: 'WORK_ITEM_PASS',
      status: 'HISTORICAL_PASS_CURRENTLY_UNAVAILABLE',
      availability: 'QUOTA_EXHAUSTED',
    });
    assert.equal(historical.level, null);
    assert.equal(historical.reason, 'PROOF_WITHHELD_NOT_CURRENT');

    // An unrecognised claim is never promoted into a proof.
    assert.equal(
      proofVerdict({ capability: 'HARNESS_PASS_PLUS', status: 'CURRENT_AVAILABLE' }).level,
      null
    );
  });

  test('resolveSource matches a gateway by the registry endpoint host, and refuses the rest', () => {
    const known = resolveSource({ gateway: GATEWAY_HOST, source: '9Router' }, registry);
    assert.equal(known.source.id, '9router');
    assert.equal(known.matchedBy, 'host');

    const byId = resolveSource({ source: 'cohere' }, registry);
    assert.equal(byId.source.id, 'cohere');
    assert.equal(byId.matchedBy, 'source-id');

    const unknown = resolveSource({ gateway: 'nowhere.example', source: 'nowhere' }, registry);
    assert.equal(unknown.source, null);
    assert.equal(unknown.matchedBy, 'none');

    // An index handed in empty is repaired rather than trusted: a caller must not
    // be able to switch host resolution off and see every registered row reported
    // as an unknown source. This is the regression the review found.
    const emptyCache = { hosts: new Map() };
    const repaired = resolveSource(
      { gateway: GATEWAY_HOST, source: 'an audit label no registry carries' },
      registry,
      emptyCache
    );
    assert.equal(repaired.source && repaired.source.id, '9router');
    assert.equal(repaired.matchedBy, 'host');
    assert.ok(emptyCache.hosts.size > 0, 'the supplied index was not filled from the registry');

    // An audit placeholder is not a host and resolves to nothing.
    for (const placeholder of ['n/a (local process)', 'n/a (harness)', '']) {
      assert.equal(hostOf(placeholder), '', JSON.stringify(placeholder));
    }
    assert.equal(
      hostOf('tokenhub-intl.tencentcloudmaas.com'),
      'tokenhub-intl.tencentcloudmaas.com'
    );
  });

  test('importCatalogue with no accounts records no proof and writes only advertisements', (t) => {
    const root = tmpDir('ai70-unit-');
    if (!root) {
      t.skip('no writable scratch directory on this host');
      return;
    }
    const dataDir = path.join(root, 'discovery');
    const evidenceDir = path.join(root, 'evidence');
    const recorded = [];
    const summary = importCatalogue({
      filePath: CATALOGUE_FIXTURE,
      registry,
      accounts: [],
      dataDir,
      evidenceDir,
      now: '2026-10-03T00:00:00.000Z',
      recordProbe: (dir, candidate, item) => recorded.push({ dir, candidate, item }),
    });
    assert.equal(summary.refused, undefined);
    assert.equal(summary.proofRecorded, 0);
    assert.equal(recorded.length, 0, 'proof was recorded with no account to match it');
    assert.equal(summary.proofWithoutAccount, summary.apiPass + summary.workItemPass);
    assert.equal(summary.advertised, 9);
    assert.equal(summary.ledgerTransitions, 9);
    const catalogue = readDiscoveryCatalogue({ dataDir });
    assert.equal(catalogue.candidates.length, 9);
    assert.equal(
      catalogue.candidates.every((c) => c.resultState === 'UNTESTED' && c.proofLevel === null),
      true
    );
  });
});
