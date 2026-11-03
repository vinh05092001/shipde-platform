import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));

const WORK_ITEM_PATTERN = /\b(?:FEAT-[A-Z0-9-]+|TASK-FOUND-[0-9]+|TASK-AI-[0-9]+|GOAL-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]+)\b/;
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

export function validatePrContract({ title, body }) {
  const errors = [];
  const titleIds = title.match(new RegExp(WORK_ITEM_PATTERN.source, 'g')) || [];
  if (titleIds.length !== 1) {
    errors.push('PR title must contain exactly one FEAT-*, TASK-FOUND-*, TASK-AI-* or GOAL-*-N Work Item ID');
  }
  const workItemId = titleIds.length === 1 ? titleIds[0] : '';

  for (const heading of REQUIRED_HEADINGS) {
    if (!body.includes(heading)) {
      errors.push(`missing PR section: ${heading}`);
    }
  }

  if (workItemId && !body.includes(workItemId)) {
    errors.push(`PR body does not reference title Work Item ${workItemId}`);
  }

  if (/<[^>\n]+>/.test(body)) {
    errors.push('PR body still contains required template placeholders');
  }
  if (/\b(?:TBD|TODO)\b/.test(body)) {
    errors.push('PR body contains TBD/TODO instead of evidence or an explicit blocker');
  }
  if (body.includes('- [ ]')) {
    errors.push('PR contains unchecked mandatory checklist items');
  }
  if (!body.includes('Review status: READY_FOR_CODEX')) {
    errors.push('PR is not marked READY_FOR_CODEX');
  }

  return { ok: errors.length === 0, errors };
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
  const base = REQUIRED_HEADINGS.map((h) => `${h}\nContent for ${h}`).join('\n\n') +
    '\nTASK-AI-164\nReview status: READY_FOR_CODEX';
  const withTag = base + '\nLine with <br> tag';
  const res = validatePrContract({ title: '[TASK-AI-164] Sample title', body: withTag });
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes('PR body still contains required template placeholders'));
});

test('PR contract validator: rejects TBD/TODO tokens', () => {
  const base = REQUIRED_HEADINGS.map((h) => `${h}\nContent for ${h}`).join('\n\n') +
    '\nTASK-AI-164\nReview status: READY_FOR_CODEX';
  const withTodo = base + '\nTODO: choose a test';
  const resTodo = validatePrContract({ title: '[TASK-AI-164] Sample title', body: withTodo });
  assert.equal(resTodo.ok, false);
  assert.ok(resTodo.errors.includes('PR body contains TBD/TODO instead of evidence or an explicit blocker'));

  const withTbd = base + '\nTBD: verification command';
  const resTbd = validatePrContract({ title: '[TASK-AI-164] Sample title', body: withTbd });
  assert.equal(resTbd.ok, false);
  assert.ok(resTbd.errors.includes('PR body contains TBD/TODO instead of evidence or an explicit blocker'));
});

test('PR contract validator: rejects unchecked items or missing READY_FOR_CODEX', () => {
  const base = REQUIRED_HEADINGS.map((h) => `${h}\nContent for ${h}`).join('\n\n') +
    '\nTASK-AI-164';
  const resNoCodex = validatePrContract({ title: '[TASK-AI-164] Sample title', body: base });
  assert.equal(resNoCodex.ok, false);
  assert.ok(resNoCodex.errors.includes('PR is not marked READY_FOR_CODEX'));

  const withUnchecked = base + '\n- [ ] unchecked item\nReview status: READY_FOR_CODEX';
  const resUnchecked = validatePrContract({ title: '[TASK-AI-164] Sample title', body: withUnchecked });
  assert.equal(resUnchecked.ok, false);
  assert.ok(resUnchecked.errors.includes('PR contains unchecked mandatory checklist items'));
});

test('PR contract validator: verifies .oc/pr-body.md passes contract', () => {
  const prBodyPath = resolve(root, '.oc/pr-body.md');
  assert.ok(existsSync(prBodyPath), '.oc/pr-body.md must exist');
  const body = readFileSync(prBodyPath, 'utf8');
  const res = validatePrContract({
    title: '[TASK-AI-164] Definition-of-ready gate for Work Items',
    body,
  });
  assert.deepEqual(res.errors, [], `pr-body.md must pass contract validation: ${res.errors.join('; ')}`);
  assert.equal(res.ok, true);
});
