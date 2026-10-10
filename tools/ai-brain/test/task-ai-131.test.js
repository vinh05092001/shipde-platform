'use strict';

/**
 * Ship Dễ — TASK-AI-131: Controller intake.
 *
 * One command turns a Work Item ID into a full Controller run with no
 * hand-written inputs. Every test runs against a temp repository under the
 * repo's .upstream-tmp with fake HTTP and a fake agy listing — no real
 * endpoint is ever called. On origin/main the intake module and this file do
 * not exist, so every test fails there (fail-before).
 *
 * Coverage (IN-R07): full derivation from a fixture Work Item and register row;
 * INTAKE_INCOMPLETE; live catalogue merge with one source failing;
 * CATALOGUE_UNAVAILABLE; no model id literals in the intake source; the printed
 * command matches policy; the stale isolation verdict refusal.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const intake = require('../intake');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const upstreamDir = path.join(REPO_ROOT, '.upstream-tmp');
const dirs = [];
function tmpDir(prefix) {
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const BASE_SHA = 'b'.repeat(40);
const REFRESH_COMMAND = 'run scripts/ai/isolation/Test-WorkerIsolation.ps1';

const FULL_ID = 'FIXTURE-AI-1';
const PARTIAL_ID = 'FIXTURE-AI-2';

const FULL_WORK_ITEM = `# ${FULL_ID} — a fixture work item for intake derivation

## Control

| Field | Value |
|---|---|
| Work Item ID | \`${FULL_ID}\` |
| Feature ID | \`N/A\` |
| Status | \`READY_FOR_AUTHOR\` |
| Dependencies | \`TASK-AI-900\` |
| Assigned author | \`GEMINI\` |
| Risk | \`MEDIUM\` |
| Complexity | \`complex\` |
| Allowed paths | \`tools/ai-brain/intake.js\`; \`tools/ai-brain/test/task-ai-131.test.js\` |
| Branch | \`feat/fixture-ai-1\` |

## Business Outcome

Fixture business outcome text for derivation.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| FX-R01 | First scenario | First expected result | Test |
| FX-R02 | Second scenario | Second expected result | Test |

## Verification Commands

- \`node --test tools/ai-brain/test/task-ai-131.test.js\`
`;

const PARTIAL_WORK_ITEM = `# ${PARTIAL_ID} — a fixture work item missing required sections

## Control

| Field | Value |
|---|---|
| Work Item ID | \`${PARTIAL_ID}\` |
| Assigned author | \`GEMINI\` |
| Allowed paths | \`tools/ai-brain/intake.js\` |

## Verification Commands

- \`node --test tools/ai-brain/test/task-ai-131.test.js\`
`;

const REGISTER_HEADER =
  '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"';

function makeRow(id, deps) {
  return [
    '243',
    'S00',
    'AI workflow',
    id,
    '',
    'a fixture work item',
    'fixture behavior',
    'READY_FOR_AUTHOR',
    deps,
    'docs/product-spec/work-items/' + id + '.md',
    'feat/fixture',
    '',
    '',
    '',
  ];
}

function quote(f) {
  return '"' + String(f).replace(/"/g, '""') + '"';
}

function writeRegister(root, rows) {
  const dir = path.join(root, 'docs', 'product-spec', 'docs', '10-ai-collaboration');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [REGISTER_HEADER, ...rows.map((r) => r.map(quote).join(','))];
  fs.writeFileSync(path.join(dir, 'FEATURE-DELIVERY-REGISTER.csv'), lines.join('\n') + '\n');
}

function writeWorkItem(root, id, text) {
  const dir = path.join(root, 'docs', 'product-spec', 'work-items');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.md'), text);
}

function makeFixtureRepo() {
  const root = tmpDir('task-ai-131-repo-');
  writeWorkItem(root, FULL_ID, FULL_WORK_ITEM);
  writeWorkItem(root, PARTIAL_ID, PARTIAL_WORK_ITEM);
  writeRegister(root, [
    makeRow(FULL_ID, 'TASK-AI-900, TASK-AI-901'),
    makeRow(PARTIAL_ID, 'TASK-AI-902'),
  ]);
  return root;
}

/** Fake HTTP + fake agy + fake evidence. Nothing here touches a real endpoint. */
function baseDeps(root, overrides) {
  return Object.assign(
    {
      root,
      now: () => Date.now(),
      baseSha: BASE_SHA,
      readHistory: () => [
        { sha: '9'.repeat(40), subject: '(#900) [TASK-AI-900] fixture dependency' },
        { sha: '8'.repeat(40), subject: '(#901) [TASK-AI-901] fixture dependency' },
        { sha: '7'.repeat(40), subject: '(#902) [TASK-AI-902] fixture dependency' },
      ],
      listAccounts: () => [{ id: 'acct-one', provider: 'test' }],
      hasAgyPoolQuota: true,
      isAncestorOf: () => true,
      readEvidence: async () => ({ combinations: [{ modelId: 'up-c/inv-three' }] }),
      runAgyModels: async () => 'up-b/inv-two',
      httpGet: async () => ({
        ok: true,
        status: 200,
        parsed: { data: [{ id: 'up-a/inv-one' }] },
      }),
      spawnCommand: () => {
        throw new Error('spawnCommand must not be called in this test');
      },
    },
    overrides || {}
  );
}

// ---------------------------------------------------------------------------
// IN-R01: full derivation from a fixture Work Item and register row.
// ---------------------------------------------------------------------------
test('IN-R01 derives every field from a fixture Work Item and register row', async () => {
  const root = makeFixtureRepo();
  const result = await intake.runIntake({ workItem: FULL_ID }, baseDeps(root));

  assert.equal(result.id, FULL_ID);
  assert.equal(result.spec.id, FULL_ID);
  assert.equal(result.spec.role, 'author.foundation');
  assert.equal(result.spec.complexity, 'complex');
  assert.deepEqual(result.spec.allowedPaths, [
    'tools/ai-brain/intake.js',
    'tools/ai-brain/test/task-ai-131.test.js',
  ]);
  // dependencies come from the register row, not the Work Item's Control table.
  assert.deepEqual(result.spec.dependencies, []);
  assert.deepEqual(
    result.resolvedDependencies.map((dependency) => dependency.id),
    ['TASK-AI-900', 'TASK-AI-901']
  );
  assert.deepEqual(result.spec.acceptanceCriteria, [
    'FX-R01 | First scenario | First expected result',
    'FX-R02 | Second scenario | Second expected result',
  ]);
  assert.equal(
    result.spec.verification.command,
    'node --test tools/ai-brain/test/task-ai-131.test.js'
  );
  assert.equal(result.goal, 'Fixture business outcome text for derivation.');

  // The inputs land in the run dir under tools/ai-brain/data/intake.
  assert.ok(result.runDir.includes(path.join('tools', 'ai-brain', 'data', 'intake')));
  assert.equal(fs.readFileSync(path.join(result.runDir, 'goal.txt'), 'utf8'), result.goal);
  const specs = JSON.parse(fs.readFileSync(path.join(result.runDir, 'specs.json'), 'utf8'));
  assert.equal(specs[0].id, FULL_ID);
  assert.equal(specs[0].complexity, 'complex');
  const catalogue = JSON.parse(fs.readFileSync(path.join(result.runDir, 'catalogue.json'), 'utf8'));
  assert.ok(catalogue.includes('up-a/inv-one'));
  const accounts = JSON.parse(fs.readFileSync(path.join(result.runDir, 'accounts.json'), 'utf8'));
  assert.equal(accounts[0].id, 'acct-one');
});

// ---------------------------------------------------------------------------
// IN-R02: a missing section refuses with INTAKE_INCOMPLETE and names it.
// ---------------------------------------------------------------------------
test('IN-R02 refuses with INTAKE_INCOMPLETE listing exactly what is missing', async () => {
  const root = makeFixtureRepo();
  await assert.rejects(
    () => intake.runIntake({ workItem: PARTIAL_ID }, baseDeps(root)),
    (err) => {
      assert.equal(err.code, 'INTAKE_INCOMPLETE');
      assert.ok(err.missing.includes('acceptanceCriteria'), 'names acceptanceCriteria');
      assert.ok(err.missing.includes('goal'), 'names goal');
      assert.ok(err.message.includes('acceptanceCriteria'), 'message lists acceptanceCriteria');
      assert.ok(err.message.includes('goal'), 'message lists goal');
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// IN-R03: live catalogue merge with one source failing.
// ---------------------------------------------------------------------------
test('IN-R03 merges the live catalogue and warns when one source fails', async () => {
  const root = makeFixtureRepo();
  const result = await intake.runIntake(
    { workItem: FULL_ID },
    baseDeps(root, {
      runAgyModels: async () => {
        throw new Error('agy unavailable');
      },
    })
  );
  const merged = new Set(result.catalogue);
  assert.ok(merged.has('up-a/inv-one'), 'keeps the 9router listing');
  assert.ok(merged.has('up-c/inv-three'), 'keeps the evidence listing');
  assert.ok(!merged.has('up-b/inv-two'), 'the failed source contributed nothing');
  const warning = result.warnings.find((w) => w.source === 'agy');
  assert.ok(warning, 'records a warning for the failed source');
  assert.equal(result.sourceStatus.agy, 'failed');
  assert.equal(result.sourceStatus['9router'], 'ok');
});

// ---------------------------------------------------------------------------
// IN-R03: every source failing refuses with CATALOGUE_UNAVAILABLE.
// ---------------------------------------------------------------------------
test('IN-R03 refuses with CATALOGUE_UNAVAILABLE when every source fails', async () => {
  const root = makeFixtureRepo();
  await assert.rejects(
    () =>
      intake.runIntake(
        { workItem: FULL_ID },
        baseDeps(root, {
          httpGet: async () => {
            throw new Error('router down');
          },
          runAgyModels: async () => {
            throw new Error('agy down');
          },
          readEvidence: async () => {
            throw new Error('no evidence');
          },
        })
      ),
    (err) => {
      assert.equal(err.code, 'CATALOGUE_UNAVAILABLE');
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// IN-R03: no model id literal may appear in the intake source.
// ---------------------------------------------------------------------------
test('IN-R03 the intake source contains no model id literal', () => {
  const sourcePath = path.join(__dirname, '..', 'intake.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  // A model id literal names a model family or carries a version/variant. The
  // intake module discovers ids live and must never hard-code one.
  const family =
    /\b(gemini|claude|gpt|sonnet|opus|glm|kimi|grok|deepseek|qwen|mistral|llama|falcon|gemma|phi)\b/i;
  assert.ok(!family.test(source), 'no model family token in intake.js');

  const versionVariant =
    /\d+\.\d+\s*-\s*(pro|flash|high|low|medium|thinking|mini|turbo|sonnet|opus)\b/i;
  assert.ok(!versionVariant.test(source), 'no version/variant model id in intake.js');

  // And no quoted string literal may look like a routed or bare model id.
  const literals = source.match(/'[^'\n]*'|"[^"\n]*"/g) || [];
  for (const lit of literals) {
    assert.ok(!family.test(lit), 'string literal must not be a model id: ' + lit);
  }
});

// ---------------------------------------------------------------------------
// IN-R05: the printed command matches policy.
// ---------------------------------------------------------------------------
test('IN-R05 the printed orchestrate command matches policy', async () => {
  const root = makeFixtureRepo();
  const run = async (quota) =>
    intake.runIntake(
      { workItem: FULL_ID },
      baseDeps(root, {
        hasAgyPoolQuota: quota,
        baseSha: BASE_SHA,
      })
    );

  const withQuota = await run(true);
  const cmd = withQuota.command;
  assert.ok(cmd.includes('--isolated-worker'), 'isolated worker');
  assert.ok(cmd.includes('--review-budget 2'), 'review budget 2');
  assert.ok(cmd.includes('--worker-timeout-min 60'), 'worker timeout 60');
  assert.ok(cmd.includes('--base-sha ' + BASE_SHA), 'base sha of origin/main');
  assert.ok(cmd.includes('--cwd ' + path.resolve(root)), 'cwd is the repo root, absolute');
  assert.ok(
    cmd.includes('--external-workers agy-pool'),
    'external workers when the pool has quota'
  );
  assert.ok(
    cmd.includes('--checkpoint ' + path.join(withQuota.runDir, 'checkpoint.json')),
    'checkpoint inside the run dir'
  );
  assert.ok(
    cmd.includes('--decision-dir ' + path.join(withQuota.runDir, 'decisions')),
    'decision dir inside the run dir'
  );
  assert.ok(
    cmd.includes('--goal ' + path.join(withQuota.runDir, 'goal.txt')),
    'goal from the run dir'
  );
  assert.ok(
    cmd.includes('--specs ' + path.join(withQuota.runDir, 'specs.json')),
    'specs from the run dir'
  );
  assert.ok(
    cmd.includes('--catalogue ' + path.join(withQuota.runDir, 'catalogue.json')),
    'catalogue from the run dir'
  );
  assert.ok(
    cmd.includes('--accounts ' + path.join(withQuota.runDir, 'accounts.json')),
    'accounts from the run dir'
  );

  const noQuota = await run(false);
  assert.ok(
    !noQuota.command.includes('--external-workers'),
    'no external workers when the pool has no quota'
  );
});

// ---------------------------------------------------------------------------
// IN-R06: the stale isolation verdict refusal.
// ---------------------------------------------------------------------------
test('IN-R06 refuses a stale isolation verdict with the exact refresh command', async () => {
  const root = makeFixtureRepo();
  const verdictPath = path.join(root, 'isolation-verdict.json');
  fs.writeFileSync(verdictPath, JSON.stringify({ verdict: 'CLOSED' }));
  const stale = Date.now() - 25 * 60 * 60 * 1000;
  fs.utimesSync(verdictPath, stale / 1000, stale / 1000);

  let spawned = false;
  await assert.rejects(
    () =>
      intake.runIntake(
        { workItem: FULL_ID, run: true },
        baseDeps(root, {
          verdictPath,
          isAncestorOf: () => true,
          spawnCommand: () => {
            spawned = true;
            return {};
          },
        })
      ),
    (err) => {
      assert.equal(err.code, 'ISOLATION_VERDICT_STALE');
      assert.ok(err.message.includes('ISOLATION_VERDICT_STALE'), 'names the code');
      assert.ok(err.message.includes(REFRESH_COMMAND), 'names the exact refresh command');
      return true;
    }
  );
  assert.ok(!spawned, 'a stale verdict must not start orchestrate');
});
