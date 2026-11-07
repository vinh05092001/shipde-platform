const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCheckFailureTask } = require('../check-failure-task');

test('contract-only replay names exactly missing sections and ignores RunLedger spec prose', () => {
  const task = buildCheckFailureTask(`Pull Request contract validation failed
missing PR section: ## Acceptance evidence
missing PR section: ## Known limitations
missing PR section: ## Acceptance evidence
Specification: RunLedger must record every failed check.`);
  assert.deepEqual(
    task.failures.map((f) => f.kind),
    ['contract']
  );
  assert.deepEqual(task.failures[0].missingSections, ['Acceptance evidence', 'Known limitations']);
  assert.match(task.task, /^Edit only the PR body\./);
  assert.doesNotMatch(task.task, /RunLedger|code change|source/);
});

test('unchecked checklist names the reported item without copying unrelated checklist prose', () => {
  const task = buildCheckFailureTask(`Pull Request contract validation failed
unchecked checklist item: Security and tenancy verified
Spec example: - [ ] Implement RunLedger`);
  assert.deepEqual(task.failures[0].uncheckedItems, ['Security and tenancy verified']);
  assert.match(task.task, /Security and tenancy verified/);
  assert.doesNotMatch(task.task, /RunLedger/);
});

test('test failure names check and first real error rather than process exit or TAP summary', () => {
  const task = buildCheckFailureTask(`P1 — CI failing: **brain.tests**.
##[error]Process completed with exit code 1.
not ok 1 - ledger persistence
AssertionError: expected committed row
Error: later cleanup failure`);
  assert.equal(task.failures[0].check, 'brain.tests');
  assert.equal(task.failures[0].firstError, 'AssertionError: expected committed row');
  assert.match(task.task, /brain\.tests/);
  assert.match(task.task, /AssertionError: expected committed row/);
  assert.doesNotMatch(task.task, /later cleanup|exit code|not ok/);
});

test('image pull failure is infrastructure and assigns no code change', () => {
  const task = buildCheckFailureTask(`P1 — CI failing: **integration**.
Error response from daemon: manifest for example.invalid/fake:fixture not found`);
  assert.equal(task.failures[0].kind, 'infra');
  assert.equal(task.failures[0].codeChange, false);
  assert.match(task.task, /infrastructure/i);
  assert.match(task.task, /No code change assigned/);
});

test('mixed failures preserve contract, test and infrastructure independently', () => {
  const task = buildCheckFailureTask(`Pull Request contract validation failed
missing PR section: ## Evidence
P1 — CI failing: **unit**.
TypeError: fake assertion failure
P1 — CI failing: **containers**.
Failed to pull image example.invalid/fake:fixture`);
  assert.deepEqual(
    task.failures.map((f) => f.kind),
    ['contract', 'test', 'infra']
  );
  for (const evidence of ['Evidence', 'unit', 'TypeError: fake assertion failure', 'containers']) {
    assert.ok(task.task.includes(evidence));
  }
});

test('unknown format and prose-only input say unknown without guessing', () => {
  for (const log of [
    '',
    'The RunLedger specification requires Error: handling.',
    'P1 — CI failing: **unit**.\nNo diagnostic available',
    'Pull Request contract validation failed\nSee documentation',
  ]) {
    const task = buildCheckFailureTask(log);
    assert.equal(task.failures[0].kind, 'unknown');
    assert.equal(task.failures[0].codeChange, false);
    assert.match(task.task, /unknown/i);
    assert.doesNotMatch(task.task, /RunLedger/);
  }
});

test('secrets are masked in check names, sections, evidence and rendered task', () => {
  const task = buildCheckFailureTask(`Pull Request contract validation failed
missing PR section: ## Evidence token=fake-section-secret
P1 — CI failing: **unit api_key=fake-check-secret**.
Error: Authorization: Bearer fake-bearer-secret password=fake-password-secret`);
  const serialized = JSON.stringify(task);
  for (const secret of [
    'fake-section-secret',
    'fake-check-secret',
    'fake-bearer-secret',
    'fake-password-secret',
  ]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.match(serialized, /redacted/i);
});

test('real validator format handles timestamps, bullets, colon and unnamed unchecked items', () => {
  const task =
    buildCheckFailureTask(`2026-01-01T00:00:00.000Z Pull Request contract validation failed:
2026-01-01T00:00:00.001Z - missing PR section: ## Acceptance evidence
2026-01-01T00:00:00.002Z - PR contains unchecked mandatory checklist items
2026-01-01T00:00:00.003Z - PR is not marked READY_FOR_CODEX`);
  assert.deepEqual(
    task.failures.map((f) => f.kind),
    ['contract']
  );
  assert.deepEqual(task.failures[0].missingSections, ['Acceptance evidence']);
  assert.match(task.task, /unchecked mandatory checklist items/);
  assert.match(task.task, /Set READY_FOR_CODEX/);
});

test('contract output nested in a named CI check does not invent an unknown failure', () => {
  const task = buildCheckFailureTask(`P1 — CI failing: **contract.validation**.
Pull Request contract validation failed:
- missing PR section: ## Verification`);
  assert.equal(task.failures.length, 1);
  assert.equal(task.failures[0].check, 'contract.validation');
  assert.deepEqual(task.failures[0].missingSections, ['Verification']);
});

test('raw failed check output accepts caller check metadata and prefers concrete error to summary', () => {
  const task = buildCheckFailureTask(
    `FAIL fake.test.js
AssertionError: fake expected value
Error: later failure`,
    { check: 'test.fake' }
  );
  assert.equal(task.failures[0].check, 'test.fake');
  assert.equal(task.failures[0].firstError, 'AssertionError: fake expected value');
});

test('test and infra failures within the same check are both retained', () => {
  const task = buildCheckFailureTask(`P1 — CI failing: **combined**.
Error: fake test assertion
Failed to pull image example.invalid/fake:fixture`);
  assert.deepEqual(
    task.failures.map((f) => f.kind),
    ['test', 'infra']
  );
  assert.match(task.task, /fake test assertion/);
  assert.match(task.task, /No code change assigned/);
});

test('truncated contract output preserves only observed sections and requests full evidence', () => {
  const task = buildCheckFailureTask(`Pull Request contract validation failed:
- missing PR section: ## Verification
--`);
  assert.deepEqual(task.failures[0].missingSections, ['Verification']);
  assert.match(task.task, /incomplete; obtain the full check output/);
});
