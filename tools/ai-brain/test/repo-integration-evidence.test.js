'use strict';

// GOAL-AUTOCLAW-REPOS-1 — AC-3 checks for the repository integration evidence contract.
//
// REPO-INTEGRATION-EVIDENCE.md is the shared contract that every Work Item attaching a repository
// must follow. This test proves the document defines the five lifecycle states and the mandatory
// per-Work-Item fields, and that the contract's validator really rejects an incomplete record
// (missing field, unknown state, missing evidence file, blocked without a reason).

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const EVIDENCE_DOC_PATH = path.join(
  REPO_ROOT,
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'REPO-INTEGRATION-EVIDENCE.md'
);
const TOOL_MANIFEST_PATH = path.join(__dirname, '..', 'data', 'tool-manifest.json');

const FIVE_STATES = ['DECLARED', 'INSTALLED', 'WIRED', 'EXECUTION_VERIFIED', 'ACCEPTED'];
const MANDATORY_FIELDS = [
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

/**
 * Validates one Work Item repository-integration evidence record against the contract.
 * @param {object} record the evidence record under test
 * @param {string} rootDir repository root used to resolve evidenceRef
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEvidenceRecord(record, rootDir = REPO_ROOT) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['record must be a non-null object'] };
  }

  for (const field of MANDATORY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      errors.push(`missing mandatory field: ${field}`);
    }
  }

  if (record.state !== undefined && !FIVE_STATES.includes(record.state)) {
    errors.push(`invalid state "${record.state}"; must be one of ${FIVE_STATES.join(', ')}`);
  }

  if (record.evidenceRef !== undefined && record.evidenceRef !== null) {
    if (typeof record.evidenceRef !== 'string' || record.evidenceRef.trim() === '') {
      errors.push('evidenceRef must be a non-empty string');
    } else {
      const filePart = record.evidenceRef.split(':')[0].split('#')[0].trim();
      const resolved = path.resolve(rootDir, filePart);
      if (!fs.existsSync(resolved)) {
        errors.push(`evidenceRef file does not exist: ${filePart}`);
      }
    }
  }

  if (record.blocked === true) {
    if (typeof record.blockedReason !== 'string' || record.blockedReason.trim() === '') {
      errors.push('blockedReason is required when blocked is true');
    }
  }

  return { valid: errors.length === 0, errors };
}

function readEvidenceDoc() {
  assert.ok(fs.existsSync(EVIDENCE_DOC_PATH), 'REPO-INTEGRATION-EVIDENCE.md must exist');
  return fs.readFileSync(EVIDENCE_DOC_PATH, 'utf8');
}

describe('GOAL-AUTOCLAW-REPOS-1 — repository integration evidence contract (AC-3)', () => {
  test('AC-3: the contract document exists and is substantive', () => {
    const content = readEvidenceDoc();
    assert.ok(content.length > 800, 'the contract document must be more than a stub');
  });

  test('AC-3: the contract defines all five integration states', () => {
    const content = readEvidenceDoc();
    for (const state of FIVE_STATES) {
      assert.ok(content.includes(state), `the contract must define the ${state} state`);
    }
  });

  test('AC-3: the contract defines the monotonic transition ladder', () => {
    const content = readEvidenceDoc();
    assert.match(
      content,
      /DECLARED\s*-+>\s*INSTALLED\s*-+>\s*WIRED\s*-+>\s*EXECUTION_VERIFIED\s*-+>\s*ACCEPTED/,
      'the contract must state the forward-only ladder in order'
    );
    assert.ok(
      /transition rules/i.test(content),
      'the contract must have a transition rules section'
    );
  });

  test('AC-3: the contract lists every mandatory Work Item field', () => {
    const content = readEvidenceDoc();
    for (const field of MANDATORY_FIELDS) {
      assert.ok(content.includes(field), `the contract must specify the mandatory field: ${field}`);
    }
  });

  test('AC-3: validateEvidenceRecord accepts a complete record', () => {
    const valid = {
      workItemId: 'GOAL-AUTOCLAW-REPOS-1',
      toolId: 'gitleaks',
      repo: 'gitleaks/gitleaks',
      state: 'WIRED',
      evidenceRef: 'package.json:scripts.security:secrets',
      command: 'security:secrets',
      blocked: false,
      blockedReason: null,
      verifiedAt: '2026-10-14T12:00:00.000Z',
      verifiedBy: 'gemini',
    };
    const result = validateEvidenceRecord(valid);
    assert.deepStrictEqual(result, { valid: true, errors: [] });
  });

  test('AC-3: validateEvidenceRecord rejects each broken record', () => {
    const base = {
      workItemId: 'GOAL-AUTOCLAW-REPOS-1',
      toolId: 'gitleaks',
      repo: 'gitleaks/gitleaks',
      state: 'WIRED',
      evidenceRef: 'package.json:scripts.security:secrets',
      command: 'security:secrets',
      blocked: false,
      blockedReason: null,
      verifiedAt: '2026-10-14T12:00:00.000Z',
      verifiedBy: 'gemini',
    };

    const missingField = { ...base };
    delete missingField.state;
    const missingResult = validateEvidenceRecord(missingField);
    assert.equal(missingResult.valid, false);
    assert.ok(
      missingResult.errors.some((error) => error.includes('missing mandatory field: state'))
    );

    const invalidState = { ...base, state: 'NOT_A_STATE' };
    const invalidResult = validateEvidenceRecord(invalidState);
    assert.equal(invalidResult.valid, false);
    assert.ok(invalidResult.errors.some((error) => error.includes('invalid state')));

    const missingFile = { ...base, evidenceRef: 'does/not/exist/package.json:devDependencies' };
    const missingFileResult = validateEvidenceRecord(missingFile);
    assert.equal(missingFileResult.valid, false);
    assert.ok(missingFileResult.errors.some((error) => error.includes('does not exist')));

    const blockedNoReason = { ...base, blocked: true, blockedReason: null };
    const blockedResult = validateEvidenceRecord(blockedNoReason);
    assert.equal(blockedResult.valid, false);
    assert.ok(
      blockedResult.errors.some((error) => error.includes('blockedReason is required')),
      'blocked:true without a reason must be rejected'
    );
  });

  test('AC-3: every manifest entry satisfies the evidence contract it must be reported through', () => {
    const manifest = JSON.parse(fs.readFileSync(TOOL_MANIFEST_PATH, 'utf8'));
    for (const entry of manifest) {
      const record = {
        workItemId: 'GOAL-AUTOCLAW-REPOS-1',
        toolId: entry.id,
        repo: entry.repo,
        state: entry.installed === true ? 'INSTALLED' : 'DECLARED',
        evidenceRef: entry.evidenceRef,
        command: entry.command ?? null,
        blocked: entry.blocked === true,
        blockedReason: entry.blocked === true ? entry.blockedReason || entry.note : null,
        verifiedAt: '2026-10-14T12:00:00.000Z',
        verifiedBy: 'gemini',
      };
      const result = validateEvidenceRecord(record);
      assert.deepStrictEqual(
        result.errors,
        [],
        `${entry.id} does not satisfy the evidence contract: ${result.errors.join('; ')}`
      );
    }
  });
});
