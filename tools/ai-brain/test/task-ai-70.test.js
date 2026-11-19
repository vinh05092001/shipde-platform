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
const routeHealthApi = require('../route-health');

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
  const routeHealthFile = path.join(root, 'route-health.json');
  // An empty pool runtime, so a candidate set never depends on whether the host
  // happens to have agy accounts. Nothing here reaches a scheduled task.
  const poolRunsDir = path.join(root, 'pool-runs');
  fs.mkdirSync(path.join(home, 'Temp'), { recursive: true });
  fs.mkdirSync(poolRunsDir, { recursive: true });
  writeRegistry(home);
  const at = new Date().toISOString();
  const S = (id) => ({ id, status: 'enumerated', advertised: 9, lastSuccessfulAt: at });
  writeJson(path.join(discoveryDir, 'freshness.json'), { sources: [S('9router'), S('codex')] });
  const world = {
    root,
    home,
    discoveryDir,
    evidenceDir,
    decisionDir,
    routeHealthFile,
    poolRunsDir,
    import(extra) {
      const result = runCli(
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
      if (result.status === 0) {
        const catalogue = readDiscoveryCatalogue({ dataDir: discoveryDir });
        const health = routeHealthApi.loadStore(routeHealthFile, { allowMissing: true });
        for (const row of catalogue.candidates) {
          if (!row || !row.gateway || !(row.modelId || row.model)) continue;
          routeHealthApi.recordResult(
            health,
            row.modelId || row.model,
            { id: row.gateway, accountId: 'gw-local' },
            { ok: true },
            Date.parse(row.ts || '2026-10-10T00:00:00.000Z')
          );
        }
        routeHealthApi.saveStore(routeHealthFile, health);
      }
      return result;
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
          '--route-health',
          routeHealthFile,
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
