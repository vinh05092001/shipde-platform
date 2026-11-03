import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));

const REQUIRED_HEADINGS = [
  '## Work Item',
  '## Source requirements',
  '## Scope integrity',
  '## Implementation',
  '## Acceptance evidence',
  '## Verification',
  '## Safety and recovery',
  '## Documentation and traceability',
  '## Risks and limitations',
  '## Codex review',
];

function validatePrContract({ title, body }) {
  const tmpRoot = resolve(root, '.oc/tmp');
  mkdirSync(tmpRoot, { recursive: true });
  const tmp = mkdtempSync(resolve(tmpRoot, 'ready-pr-contract-'));
  try {
    const event = resolve(tmp, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { title, body, base: { ref: 'main' } } }));
    const result = spawnSync(
      process.platform === 'win32' ? 'python' : 'python3',
      ['-B', 'docs/product-spec/scripts/validate_pr_contract.py', '--event', event],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'safe.directory',
          GIT_CONFIG_VALUE_0: '*',
        },
      }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    const errors = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2));
    return { ok: result.status === 0, errors };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('PR contract validator: rejects missing sections', () => {
  const sampleBody = [
    '## Work Item\nTASK-AI-164',
    '## Source requirements',
    '## Scope integrity',
    '## Implementation',
    '## Acceptance evidence',
    '## Verification',
    '## Risks and limitations',
    '## Codex review',
    'Review status: READY_FOR_CODEX',
  ].join('\n\n');
  const res = validatePrContract({ title: '[TASK-AI-164] Sample title', body: sampleBody });
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes('missing PR section: ## Safety and recovery'));
  assert.ok(res.errors.includes('missing PR section: ## Documentation and traceability'));
});

test('PR contract validator: rejects template placeholders and raw HTML tags', () => {
  const base =
    REQUIRED_HEADINGS.map((h) => `${h}\nContent for ${h}`).join('\n\n') +
    '\nTASK-AI-164\nReview status: READY_FOR_CODEX';
  const withTag = base + '\nLine with <br> tag';
  const res = validatePrContract({ title: '[TASK-AI-164] Sample title', body: withTag });
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes('PR body still contains required template placeholders'));
});

test('PR contract validator: rejects TBD/TODO tokens', () => {
  const base =
    REQUIRED_HEADINGS.map((h) => `${h}\nContent for ${h}`).join('\n\n') +
    '\nTASK-AI-164\nReview status: READY_FOR_CODEX';
  const withTodo = base + '\nTODO: choose a test';
  const resTodo = validatePrContract({ title: '[TASK-AI-164] Sample title', body: withTodo });
  assert.equal(resTodo.ok, false);
  assert.ok(
    resTodo.errors.includes('PR body contains TBD/TODO instead of evidence or an explicit blocker')
  );

  const withTbd = base + '\nTBD: verification command';
  const resTbd = validatePrContract({ title: '[TASK-AI-164] Sample title', body: withTbd });
  assert.equal(resTbd.ok, false);
  assert.ok(
    resTbd.errors.includes('PR body contains TBD/TODO instead of evidence or an explicit blocker')
  );
});

test('PR contract validator: rejects unchecked items or missing READY_FOR_CODEX', () => {
  const base =
    REQUIRED_HEADINGS.map((h) => `${h}\nContent for ${h}`).join('\n\n') + '\nTASK-AI-164';
  const resNoCodex = validatePrContract({ title: '[TASK-AI-164] Sample title', body: base });
  assert.equal(resNoCodex.ok, false);
  assert.ok(resNoCodex.errors.includes('PR is not marked READY_FOR_CODEX'));

  const withUnchecked = base + '\n- [ ] unchecked item\nReview status: READY_FOR_CODEX';
  const resUnchecked = validatePrContract({
    title: '[TASK-AI-164] Sample title',
    body: withUnchecked,
  });
  assert.equal(resUnchecked.ok, false);
  assert.ok(resUnchecked.errors.includes('PR contains unchecked mandatory checklist items'));
});

test('PR contract validator: committed evidence passes without local .oc/pr-body.md', () => {
  const prBodyPath = resolve(root, 'scripts/ai/test/fixtures/ready-check/pr-contract.md');
  assert.ok(existsSync(prBodyPath), 'committed PR evidence fixture must exist');
  const body = readFileSync(prBodyPath, 'utf8');
  const res = validatePrContract({
    title: '[TASK-AI-164] Definition-of-ready gate for Work Items',
    body,
  });
  assert.deepEqual(
    res.errors,
    [],
    `pr-body.md must pass contract validation: ${res.errors.join('; ')}`
  );
  assert.equal(res.ok, true);
});
