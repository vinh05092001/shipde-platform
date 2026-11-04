# Focused context pack

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## tools/ai-brain/coordinator-metrics.js

```
'use strict';
// Metrics identity, row validation and aggregate summary.
function metricsKey(row) {
  return [row.pr, row.sha, row.round].join('|');
}

function validMetric(row) {
  return Boolean(
    row &&
    !Array.isArray(row) &&
    typeof row.item === 'string' &&
    row.item.length > 0 &&
    Number.isSafeInteger(row.pr) &&
    row.pr > 0 &&
    typeof row.sha === 'string' &&
    /^[a-f0-9]{40}$/i.test(row.sha) &&
    Number.isSafeInteger(row.round) &&
    row.round > 0 &&
    ['PASS', 'CHANGES_REQUIRED', 'BLOCKED'].includes(row.verdict) &&
    (row.tokens == null || (Number.isFinite(row.tokens) && row.tokens >= 0)) &&
    (row.ciRed == null || typeof row.ciRed === 'boolean')
  );
}

function metricsSummary(records, merged = new Set()) {
  const rows = [...new Map(records.map((row) => [metricsKey(row), row])).values()];
  const passes = new Map();
  for (const row of rows)
    if (row.verdict === 'PASS') passes.set(row.pr, Math.max(passes.get(row.pr) || 0, row.round));
  const rounds = [...passes.values()].sort((a, b) => a - b);
  const median = rounds.length
    ? (rounds[Math.floor((rounds.length - 1) / 2)] + rounds[Math.ceil((rounds.length - 1) / 2)]) / 2
    : null;
  const mergedPRs = new Set(rows.filter((row) => merged.has(row.pr)).map((row) => row.pr));
  const knownTokens = rows.filter((row) => merged.has(row.pr));
  const completeTokens = knownTokens.every((row) => Number.isFinite(row.tokens));
  return {
    reviews: rows.length,
    medianRoundsToPass: median,
    p90RoundsToPass: rounds.length ? rounds[Math.ceil(rounds.length * 0.9) - 1] : null,
    ciRedRate: rows.length ? rows.filter((row) => row.ciRed).length / rows.length : null,
    mergedPRs: mergedPRs.size,
    tokensPerMergedPR:
      mergedPRs.size && completeTokens
        ? knownTokens.reduce((sum, row) => sum + row.tokens, 0) / mergedPRs.size
        : null,
  };
}

module.exports = {
  metricsKey,
  validMetric,
  metricsSummary,
};
```

## tools/ai-brain/coordinator-quota-state.js

```
'use strict';
// Author-family memory and per-launch quota cooldown observation.
const { POLICY, family, modelKey, quotaFromLog } = require('./coordinator-policy');

function rememberAuthor(current, writer) {
  const value = writer?.family || family(writer?.model);
  if (!value) return false;
  current.authorFamilies = [...new Set([...(current.authorFamilies || []), value])];
  return true;
}

async function observeQuota(writer, state, deps, now) {
  if (!writer?.model) return;
  const matches = (entry) => modelKey(entry.model) === modelKey(writer.model);
  const exclude = (at) => {
    state.exhausted = state.exhausted.filter((entry) => !matches(entry));
    if (at + POLICY.quotaCooldownMs > now)
      state.exhausted.push({ model: writer.model, at, until: at + POLICY.quotaCooldownMs });
  };
  // Each launch owns one classification. Persist the observation even when
  // there is no alternative writer, so restarts cannot extend an old refusal.
  if (writer.logClassifiedAt == null && deps.logText) {
    writer.logClassifiedAt = now;
    if (quotaFromLog(await deps.logText(writer))) exclude(now);
  }
  const evidence = await deps.quotaEvidence?.(writer);
  const at = Date.parse(evidence?.at);
  const previous = state.exhausted
    .filter(matches)
    .reduce(
      (latest, entry) => Math.max(latest, entry.at ?? entry.until - POLICY.quotaCooldownMs),
      0
    );
  if (
    !Number.isFinite(at) ||
    at > now ||
    at <= Math.max(previous, writer.quotaEvidenceAt || 0, writer.logClassifiedAt || 0)
  )
    return;
  writer.quotaEvidenceAt = at;
  if (evidence.code === 'OK') state.exhausted = state.exhausted.filter((entry) => !matches(entry));
  else if (['QUOTA', 'RATE'].includes(evidence.code)) exclude(at);
}

module.exports = {
  rememberAuthor,
  observeQuota,
};
```

## tools/ai-brain/test/task-ai-166-refresh.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

function fixture(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    dataDir,
    freshnessFile: path.join(dataDir, 'freshness.json'),
    reportFile: path.join(dataDir, 'refresh-report.json'),
    summaryFile: path.join(dir, 'quota-scan-summary.json'),
    priorsFile: path.join(dir, 'model-priors.json'),
    quotaFile: path.join(dir, 'quota-state.json'),
  };
  const writeFresh = (record) => fs.writeFileSync(files.freshnessFile, JSON.stringify(record));
  const writeQuota = (scopes) => fs.writeFileSync(files.quotaFile, JSON.stringify({ scopes }));
  const run = async (args, context) => {
    if (args[0] === 'discovery') fs.copyFileSync(files.freshnessFile, context.discoveryFile);
    return { exitCode: 0, stderr: '' };
  };
  const refresh = (extra = {}) => refreshCatalogue({ ...files, run, ...extra });
  const fresh = () => JSON.parse(fs.readFileSync(files.freshnessFile, 'utf8'));
  return { dir, files, writeFresh, writeQuota, run, refresh, fresh };
}

// AC-166-01: Refresh runs stages in order, rejects incomplete evidence, and redacts credentials
test('AC-166-01: refresh stages run in order, reject incomplete evidence, and redact credentials', async (t) => {
  const calls = [];
  const orderedResult = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(orderedResult.ok, false);
  assert.equal(orderedResult.stages[0].error, 'fetch failed');

  const now = new Date();
  const f = fixture(t, 'ai166-ac01-');
  f.writeFresh({ lastAttemptAt: now.toISOString(), lastSuccessfulAt: null, complete: true, failedSources: [] });
  fs.writeFileSync(f.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  f.writeQuota({
    s1: {
      source: 'operator@tenant.example.com',
      scope: 'token=super-secret-12345',
      upstream: 'https://admin:my-secret-pw@api.test/v1?apikey=leak-me',
      model: 'custom-m',
      code: 'OK',
      at: now.toISOString(),
    },
  });
  const okResult = await f.refresh({ now: now.getTime() });
  assert.equal(okResult.ok, true);
  assert.equal(f.fresh().complete, true);
  assert.equal(f.fresh().lastSuccessfulAt, okResult.finishedAt);

  const summary = fs.readFileSync(f.files.summaryFile, 'utf8');
  assert.equal(/my-secret-pw|leak-me|super-secret-12345|operator@tenant/.test(summary), false);
  assert.deepEqual(JSON.parse(summary).statusCounts, { OK: 1 });

  // Incomplete evidence rejects exit 0
  const bad = fixture(t, 'ai166-ac01-bad-');
  bad.writeFresh({ lastAttemptAt: now.toISOString(), complete: false, failedSources: [{ id: 'src', reason: 'fail' }] });
  fs.writeFileSync(bad.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  bad.writeQuota({ s1: { code: 'OK', at: now.toISOString() } });
  const badResult = await bad.refresh();
  assert.equal(badResult.ok, false);
  assert.equal(badResult.stages[1].error, 'DISCOVERY_INCOMPLETE');
});

// AC-166-02: Live discovery enumerates sources, handles unknown providers, and preserves prior candidates
test('AC-166-02: live discovery enumerates sources, handles unknown providers, and preserves prior candidates', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'private-secret' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-flash\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-3-5\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, 'Bearer private-secret');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'DeepSeek-V4' }] }) };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4');
  assert.equal(output.results['agy01'].catalogs[0].account, 'agy01');
  assert.equal(output.results['agy-local'].catalogs[0].models[0], 'gemini-4-flash');
  assert.equal(JSON.stringify(output).includes('private-secret'), false);

  // Failed provider is marked unknown, does not fall back to obsolete
  const failed = await enumerateLiveSources({
    config: { provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { obsolete: {} } } } },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=leak');
    },
  });
  assert.equal(failed.results['opencode:p'].status, 'unknown');
  assert.deepEqual(failed.results['opencode:p'].catalogs, []);
  assert.equal(JSON.stringify(failed).includes('leak'), false);

  // Reconciliation: failed or unobserved listings never remove prior candidates
  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  assert.equal(reconcileRun({ ...base, results: {} }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'unknown', catalogs: [] } } }).transitions.length,
    0
  );
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'enumerated', catalogs: [] } } }).transitions[0].state,
    'REMOVED'
  );
});

// AC-166-03: Catalogue freshness gate refuses absent, future or >48h observations, preserving prior success
test('AC-166-03: catalogue freshness gate refuses absent, future or >48h observations, preserving prior success', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ac03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  const write = (lastSuccessfulAt, complete = true, extra = {}) =>
    fs.writeFileSync(path.join(dir, 'freshness.json'), JSON.stringify({ lastSuccessfulAt, complete, ...extra }));

  // Missing freshness refuses STALE_CATALOGUE
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');

  // Valid 48h observation is fresh; 48h + 1ms is stale
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);

  // Future timestamp is refused
  write(new Date(now + 1000).toISOString());
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);

  // Failed later attempt preserves last good successful observation within window
  write('2026-10-31T13:00:00Z', false, {
    lastAttemptAt: '2026-11-02T11:00:00Z',
    failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
  });
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  // Same record aged past 48h from last success is stale
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 2 * 3600000 }).stale, true);
});

```

## tools/ai-brain/test/task-ai-166-review.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const parent = path.resolve(__dirname, '../../../.oc/tmp');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'ai166-rev-'));
  t.after(() => {
    if (process.cwd() === dir) process.chdir(path.resolve(__dirname, '../../..'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      configured: new Set([writer.model]),
      pidAlive: () => false,
      logMtime: () => NOW - 1000000,
      inspect: async () => ({ sha: SHA, dirty: false }),
      prepare: async () => ({ ok: true, sha: SHA }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: SHA }),
      candidates: async () => [writer],
      launch: async () => { calls.push('launch'); return { pid: 12 }; },
      review: async (w, r) => { calls.push(['review', r.family]); return { verdict: 'PASS', sha: SHA, findings: [] }; },
      save: async () => {},
      history: async () => {},
      metrics: async () => {},
      ...overrides,
    },
  };
}

function stateFor(current = {}) {
  return { lastRefreshAt: NOW, items: { [item.id]: { writer: { ...writer }, ...current } } };
}

function childFixture() {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 12345,
    stdin: Object.assign(new EventEmitter(), { end: () => {} }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    unref: () => {},
    kill: () => {},
    finish: () => { child.stdout.emit('end'); child.stderr.emit('end'); child.emit('close', 0); },
  });
  return child;
}

// AC-166-05: Publication preflight and git inspection validate branch identity, private paths, and register resolution
test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const inspector = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({ exitCode: 0, stdout: args[0] === 'branch' ? 'feat/task-ai-1660-other' : '' }),
  });
  await assert.rejects(inspector.inspect(item), /ITEM_BRANCH_MISMATCH/);

  for (const branch of ['', 'feat/task-ai-999-unrelated', 'feat/task-ai-1660-mismatch']) {
    const pushRuntime = runtimeApi.createRuntime({
      config: {},
      git: async (cwd, args) => ({ exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : branch }),
    });
    await assert.rejects(pushRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);
  }
  const calls = [];
  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const validPush = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => { calls.push(args); return { exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : validBranch }; },
  });
  await validPush.push(item, SHA);
  assert.deepEqual(calls.at(-1), ['push', 'origin', `${SHA}:refs/heads/${validBranch}`]);

  for (const file of ['.oc/writer.log', '.oc/coordinator/state.json', '.serena/cache', '.oc-codex-task.md']) {
    const preflightRuntime = runtimeApi.createRuntime({
      config: {},
      git: async (cwd, args) => ({
        exitCode: 0,
        stdout: args[0] === 'rev-list' ? '0' : args[0] === 'log' ? '[TASK-AI-166] outcome' : args.includes('--name-only') ? file : args[0] === 'rev-parse' ? SHA : '',
      }),
    });
    const result = await preflightRuntime.prepare(item);
    assert.equal(result.ok, false, file);
    assert.match(result.reason, /PRIVATE/);
  }

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  let committed = false;
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout: args[0] === 'rev-list' ? '1' : args.includes('--diff-filter=U') ? register : args[0] === 'show' ? 'work_item_id,name\nTASK-AI-166,test' : '',
    }),
    hookedGit: async () => { committed = true; },
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
  assert.equal(committed, false);
});

// AC-166-06: Two-phase review requires independent reviewer and prevents open findings from passing
test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  for (const block of [
    '1. P1 Open authorization defect; previous issue FIXED',
    '1. P2 FIXED: old issue\nP1 authorization still missing',
    '1. P1 FIXED: old issue; P1 new bypass remains',
    '1. P1 previous issue FIXED; status ambiguous',
  ]) {
    const result = runtimeApi.parseReview(`VERDICT: PASS\nReviewed SHA: ${SHA}\n${block}`);
    const { deps } = rig({
      candidates: async () => [{ model: 'reviewer', family: 'independent', harness: 'codex', score: 90 }],
      review: async () => result,
    });
    const state = stateFor();
    await policy.coordinatorTick([item], state, deps);
    assert.notEqual(state.items[item.id].status, 'PASS', block);
  }
  const fixed = runtimeApi.parseReview(`VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 FIXED: tenant check verified`);
  assert.equal(fixed.findings[0].closed, true);
});

// AC-166-07: Quota refusal cooldown is bounded and cannot renew across ticks or restart
test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { calls, deps } = rig({ inspect: async () => ({ sha: null, dirty: false }), logText: async () => 'RESOURCE_EXHAUSTED' });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted.length, 1);
  assert.equal(state.exhausted[0].until, until);
  await policy.coordinatorTick([item], state, { ...deps, now: until });
  assert.equal(calls.filter((call) => call === 'launch').length, 1);
});

// AC-166-08: Fan-out reserves launches durably before spawn and excludes all author families
test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = stateFor();
  state.launches = [];
  state.exhausted = [];
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async (work, args) => ({ exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-166-test' }),
    spawn: () => {
      beforeSpawn = JSON.parse(fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8'));
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout({ ...item, cwd }, [{ lane: 1, files: ['tools/test.js'], findings: [] }], [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }], state);
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
  assert.ok(beforeSpawn.items[item.id].lanes[0].writer.reservedAt);

  const second = { model: 'p/second', family: 'second', harness: 'opencode', score: 99 };
  const independent = { model: 'p/independent', family: 'independent', harness: 'opencode', score: 85 };
  let ci = 'pending';
  const { calls, deps } = rig({
    collectLanes: async () => ({ state: 'merged' }),
    ci: async () => ({ state: ci, sha: SHA }),
    candidates: async () => [writer, second, independent],
    configured: new Set([writer.model, second.model, independent.model]),
  });
  let multiState = stateFor({ lanes: [{ lane: 1, writer }, { lane: 2, writer: second }] });
  await policy.coordinatorTick([item], multiState, deps);
  multiState = JSON.parse(JSON.stringify(multiState));
  ci = 'green';
  await policy.coordinatorTick([item], multiState, deps);
  assert.deepEqual(calls.find((call) => Array.isArray(call)), ['review', 'independent']);
});

// AC-166-09: Metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round
test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const previousCwd = process.cwd();
  const previousConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(previousCwd);
    if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = previousConfig;
  });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  const lock = path.join(localDir, 'loop.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' }));
  const input = path.join(dir, 'items.json');
  fs.writeFileSync(input, JSON.stringify([{ ...item, cwd: dir }, { ...item, id: 'GOAL-AUTOCLAW-REPOS-1', cwd: dir }]));
  process.chdir(dir);
  const before = fs.readFileSync(lock, 'utf8');
  await assert.rejects(require('../coordinator-cli').main(['run', input]), /LOOP_LOCK_HELD.*PID 12345.*age.*inspect/i);
  assert.equal(fs.readFileSync(lock, 'utf8'), before);

  const file = path.join(dir, 'metrics.jsonl');
  const row = { item: item.id, pr: 123, sha: SHA, round: 1, verdict: 'PASS', tokens: 4 };
  fs.writeFileSync(file, [JSON.stringify(row), JSON.stringify({ ...row, item: 'legacy' }), '{"bad":', JSON.stringify({ ...row, tokens: -1 })].join('\n'));
  t.mock.method(require('../discovery/spawn'), 'runCommand', async () => ({ exitCode: 0, stdout: '{"state":"MERGED"}' }));
  const summary = await require('../coordinator-cli').main(['metrics', file]);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.malformedRowsSkipped, 2);

  const runtime = runtimeApi.createRuntime({ config: {}, root: dir });
  const metadata = { round: 1, sha: SHA, verdict: 'PASS', writer: 'person@tenant.test', text: 'checked' };
  await runtime.history({ ...item, cwd: dir }, metadata);
  await runtime.metrics({ ...metadata, item: item.id, pr: item.pr, tokens: 4 });
  for (const f of [path.join(dir, '.oc/history.md'), runtime.metricsFile]) {
    assert.equal(fs.readFileSync(f, 'utf8').includes('person@tenant.test'), false);
  }
  for (const value of ['sk-secretval', 'https://login:secretval@host.test/path?token=secretval']) {
    assert.equal(runtimeApi.safeText(value).includes('secretval'), false);
  }
});

```

## tools/ai-brain/test/task-ai-166-runtime.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const { createRuntime, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');

function dispatchRig(flags = {}) {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true, ...flags },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  return { errors, result };
}

function temporary(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'task instructions');
  return dir;
}

function launchRig(t) {
  const dir = temporary(t, 'ai166-launch-');
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = new EventEmitter();
  stdin.end = () => {};
  const child = new EventEmitter();
  Object.assign(child, { pid: 99999, stdout, stderr, stdin, unref: () => {} });
  const runtime = createRuntime({ config: {}, spawn: () => child });
  return {
    runtime,
    child,
    dir,
    finish: () => {
      stdout.emit('end');
      stderr.emit('end');
      child.emit('close', 0);
    },
  };
}

function poolWriterJob(t, prefix, job) {
  const dir = temporary(t, prefix);
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(file, JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'task', ...job }));
  return {
    dir,
    file,
    run: (extra) => require('../coordinator-pool-writer').runPoolWriter(file, extra),
  };
}

// AC-166-01: Benchmark sources retain discrete records without column-wise mean and scanner keeps errno
test('AC-166-01: benchmark sources retain discrete records without column-wise mean and scanner keeps errno', async () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const source = (id, url, score) => ({
    retrievedAt: '2026-11-01T00:00:00Z',
    sources: [{ id, url }],
    models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': score } }],
  });
  const doc = mergePriorDocuments(
    [source('skillbench', 'https://skillbench.invalid/report', 72), source('aa', 'https://aa.invalid/report', 40)],
    now,
    {}
  );
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks.filter((b) => b.name === 'SWE-bench Verified').map((b) => b.score);
  assert.deepEqual([...scores].sort((a, b) => a - b), [40, 72]);
  assert.equal(row.benchmarks.some((b) => b.score === 56), false);

  await assert.rejects(
    publicDocuments({
      descriptor: { sources: [{ id: 'aa', kind: 'aa', url: 'https://aa.invalid' }] },
      fetch: async () => {
        const error = new Error('token=must-not-print');
        error.cause = { code: 'EPERM' };
        throw error;
      },
    }),
    /PRIORS_PUBLIC_FETCH_FAILED: aa: EPERM/
  );
});

// AC-166-03: Dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it
test('AC-166-03: dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it', () => {
  const { errors: err1, result: res1 } = dispatchRig();
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.warning.code, 'STALE_CATALOGUE');
  assert.match(err1[0], /STALE_CATALOGUE/);

  const evidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { errors: err2, result: res2 } = dispatchRig({ 'evidence-dir': evidenceDir });
  assert.notEqual(res2?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(err2.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});

// AC-166-04: Writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity
test('AC-166-04: writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity', async (t) => {
  const rig = launchRig(t);
  const handle = await rig.runtime.launch(
    { id: 'TASK-AI-166', cwd: rig.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  let resolved = false;
  handle.completed.then(() => { resolved = true; });
  rig.child.stdout.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  rig.child.stderr.emit('data', 'rate limit warning');
  rig.child.emit('close', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);
  rig.finish();
  assert.equal((await handle.completed).exitCode, 0);
  const drained = fs.readFileSync(handle.log, 'utf8');
  assert.ok(drained.includes('[BLOCKED_BY_SANDBOX]'));
  assert.ok(drained.includes('rate limit warning'));

  const bounded = launchRig(t);
  const capped = await bounded.runtime.launch(
    { id: 'TASK-AI-166', cwd: bounded.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  const gigabyte = ('A'.repeat(1023) + '\n').repeat(1024);
  for (let i = 0; i < 3; i++) bounded.child.stdout.emit('data', gigabyte);
  bounded.finish();
  await capped.completed;
  assert.ok(fs.statSync(capped.log).size <= 2 * 1024 * 1024);
  assert.ok(fs.readFileSync(capped.log, 'utf8').includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));

  // Pool writer validates job identity and masks credentials
  const delegated = poolWriterJob(t, 'ai166-pool-', { prompt: 'task' });
  let submitted;
  const queued = await delegated.run({
    expectedCwd: delegated.dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(submitted.job.cwd, delegated.dir);
  assert.equal(queued.jobId, 'agy01/fixture');
  assert.equal(queued.reason, 'RESOURCE_EXHAUSTED');

  const rejected = poolWriterJob(t, 'ai166-pool-bad-', { cwd: path.join(os.tmpdir(), 'ai166-bad') });
  await assert.rejects(() => rejected.run({ expectedCwd: rejected.dir }), /INVALID_JOB_CWD/);

  const sanitized = poolWriterJob(t, 'ai166-pool-sec-', { prompt: 'task' });
  const result = await sanitized.run({
    expectedCwd: sanitized.dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'Failed auth password="my-secret-pw" for user@tenant.com',
      jobId: 'agy01/test-job',
    }),
  });
  assert.equal(result.reason.includes('my-secret-pw'), false);
  assert.equal(result.reason.includes('user@tenant.com'), false);
  assert.ok(result.reason.includes('[REDACTED]'));
});

// AC-166-05: Host commit excludes private paths and merges CSV conflict via row union through hook
test('AC-166-05: host commit excludes private paths and merges CSV conflict via row union through hook', async (t) => {
  const dir = temporary(t, 'ai166-runtime-');
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  let committed = false;
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add' && args.includes(csv)) registerAdded = true;
      const stdout =
        args[0] === 'status'
          ? (committed ? '' : ' M tools/ai-brain/x.js\n')
          : args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
          ? registerAdded ? '' : csv
          : args[0] === 'show'
          ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
          : args[0] === 'log'
          ? '[TASK-AI-166] outcome'
          : args[0] === 'rev-parse'
          ? 'a'.repeat(40)
          : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => {
      committed = true;
      calls.push(['hooked', ...args]);
    },
  });

  await runtime.commit({ id: 'TASK-AI-166', cwd: dir }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md']) {
    assert.ok(add.includes(':(exclude)' + excluded));
  }
  assert.ok(
    calls.some(
      (call) =>
        call[0] === 'hooked' &&
        call[1] === 'commit' &&
        call[3] === '[TASK-AI-166] Address review: writer output (gpt-test)'
    )
  );
  assert.equal(calls.flat().includes('--no-verify'), false);

  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, csv), 'utf8').includes('"A","one"\n"B","two"'));
  assert.ok(calls.some((call) => call[0] === 'hooked'));
});

// AC-166-06: Structured review output includes parsed verdict and measured token usage
test('AC-166-06: structured review output includes parsed verdict and measured token usage', () => {
  const log = [
    JSON.stringify({
      type: 'text',
      part: { text: 'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) },
    }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 4 } } }),
  ].join('\n');
  assert.equal(reviewUsage(log).tokens, 14);
  assert.equal(parseReview(reviewUsage(log).text).verdict, 'PASS');
  assert.equal(reviewUsage('plain answer').tokens, null);
});

// AC-166-08: Fan-out merges lanes in numerical order and aborts on conflict
test('AC-166-08: fan-out merges lanes in numerical order and aborts on conflict', async () => {
  const lanes = (ns) =>
    ns.map((lane) => ({
      lane,
      cwd: '/fixture/lane' + lane,
      branch: 'lane' + lane,
      base: 'a'.repeat(40),
      files: ['apps/file' + lane + '.js'],
      writer: { model: 'gpt-test' },
    }));
  const order = [];
  const ordered = createRuntime({
    config: {},
    git: async (cwd, args) => {
      order.push([cwd, args]);
      return {
        exitCode: 0,
        stdout:
          args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
            ? 'apps/file' + cwd.slice(-1) + '.js'
            : '',
      };
    },
    hookedGit: async (cwd, args) => order.push([cwd, ['hooked', ...args]]),
  });
  const main = { id: 'TASK-AI-166', cwd: '/fixture/main' };
  assert.equal((await ordered.collectLanes(main, lanes([2, 1]))).state, 'merged');
  assert.deepEqual(
    order.filter((call) => call[1][0] === 'merge').map((call) => call[1].at(-1)),
    ['lane1', 'lane2']
  );
  assert.equal(order.filter((call) => call[1][0] === 'hooked').length, 2);
  assert.equal(order.flat(2).includes('--force'), false);

  const conflict = [];
  const failing = createRuntime({
    config: {},
    git: async (cwd, args) => {
      conflict.push(args);
      return {
        exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
        stdout:
          args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
            ? 'apps/file' + cwd.slice(-1) + '.js'
            : '',
      };
    },
    hookedGit: async () => {},
  });
  assert.equal((await failing.collectLanes(main, lanes([1, 2]))).state, 'conflict');
  assert.ok(conflict.some((call) => call.join(' ') === 'merge --abort'));
  assert.equal(conflict.some((call) => call.at(-1) === 'lane2' && call[0] === 'merge'), false);
});

```
