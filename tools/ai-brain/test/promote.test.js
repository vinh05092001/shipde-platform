'use strict';

/**
 * Ship Dễ — Promotion Gate Test Suite (TASK-AI-22)
 *
 * Tests the promotion gate for proposed agent memory:
 *   AI-22-R01: An agent may propose.
 *   AI-22-R02: No one approves their own lesson (SELF_APPROVAL).
 *   AI-22-R03: No agent approves (AGENT_APPROVAL).
 *   AI-22-R04: The approver is authenticated, not declared.
 *   AI-22-R05: Only proposed can be approved or rejected.
 *   AI-22-R06: A superseding lesson must itself be approved.
 *   AI-22-R07: Every transition validates against the schema before write.
 *   AI-22-R08: Every transition is recorded in the append-only log.
 *   AI-22-R09: No PII and no credentials.
 *
 * All tests are completely offline and run without network.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const promote = require('../lessons/promote');
const {
  proposeLesson,
  approveLesson,
  rejectLesson,
  supersedeLesson,
  readLesson,
  readPromotionRecords,
  REFUSAL_CODES,
  PromotionError,
} = promote;

const VALID_COMMIT = 'e5e06918d0b6d62de988168d23bb1309fc7cf3ed';

function createTempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-promote-test-'));
  const schemaPath = path.resolve(__dirname, '..', 'lessons', 'lesson-schema.json');
  return { dir, schemaPath };
}

function cleanupTempEnv(env) {
  if (env && env.dir && fs.existsSync(env.dir)) {
    fs.rmSync(env.dir, { recursive: true, force: true });
  }
}

describe('AI-22-R01: An agent may propose', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('an agent identity can propose a lesson with approved_by null', () => {
    const res = proposeLesson(
      {
        id: 'LESSON-AGENT-PROPOSE-TEST',
        title: 'Agents can propose lessons into the memory gate',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Commit e5e0691 introduced the deterministic reconciler.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    assert.equal(res.ok, true);
    assert.equal(res.lesson.status, 'proposed');
    assert.equal(res.lesson.approved_by, null);
    assert.equal(res.lesson.proposed_by, 'gemini');
    assert.equal(res.lesson.source_commit, VALID_COMMIT);

    const loaded = readLesson('LESSON-AGENT-PROPOSE-TEST', { dir: env.dir });
    assert.ok(loaded);
    assert.equal(loaded.lesson.status, 'proposed');
    assert.equal(loaded.lesson.approved_by, null);
  });
});

describe('AI-22-R02: No one approves their own lesson (SELF_APPROVAL)', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('refuses promotion when approver equals proposer', () => {
    proposeLesson(
      {
        id: 'LESSON-SELF-APPROVAL-TEST',
        title: 'Self approval must be strictly refused by the gate',
        scope: 'security',
        source_commit: VALID_COMMIT,
        evidence: 'Self-approval creates unreviewed memory.',
        proposed_by: 'vinh05092001',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    assert.throws(
      () => {
        approveLesson('LESSON-SELF-APPROVAL-TEST', {
          dir: env.dir,
          schemaPath: env.schemaPath,
          approver: 'vinh05092001',
        });
      },
      (err) => {
        assert.ok(err instanceof PromotionError);
        assert.equal(err.code, REFUSAL_CODES.SELF_APPROVAL);
        assert.match(err.message, /SELF_APPROVAL/);
        return true;
      }
    );
  });

  test('refuses promotion case-insensitively for self approval', () => {
    proposeLesson(
      {
        id: 'LESSON-SELF-APPROVAL-CASE',
        title: 'Self approval check is case-insensitive',
        scope: 'spec',
        source_commit: VALID_COMMIT,
        evidence: 'Proposer and approver match regardless of casing.',
        proposed_by: 'Vinh05092001',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    assert.throws(
      () => {
        approveLesson('LESSON-SELF-APPROVAL-CASE', {
          dir: env.dir,
          schemaPath: env.schemaPath,
          approver: 'vinh05092001',
        });
      },
      { code: REFUSAL_CODES.SELF_APPROVAL }
    );
  });
});

describe('AI-22-R03: No agent approves (AGENT_APPROVAL)', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('refuses approval by an agent even when different from proposer', () => {
    proposeLesson(
      {
        id: 'LESSON-AGENT-APPROVAL-TEST',
        title: 'No agent may approve a lesson in shipde-brain',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Agent approval violates AI-TOOL-06.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    // claude is a different agent than gemini, but still an agent
    assert.throws(
      () => {
        approveLesson('LESSON-AGENT-APPROVAL-TEST', {
          dir: env.dir,
          schemaPath: env.schemaPath,
          approver: 'claude',
        });
      },
      (err) => {
        assert.ok(err instanceof PromotionError);
        assert.equal(err.code, REFUSAL_CODES.AGENT_APPROVAL);
        assert.match(err.message, /AGENT_APPROVAL/);
        return true;
      }
    );
  });

  test('refuses approval by agent in agent/model form', () => {
    proposeLesson(
      {
        id: 'LESSON-AGENT-MODEL-FORM',
        title: 'Agent with model suffix is recognized as agent',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Harness slash model form must not bypass gate.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    assert.throws(
      () => {
        approveLesson('LESSON-AGENT-MODEL-FORM', {
          dir: env.dir,
          schemaPath: env.schemaPath,
          approver: 'codex/o3-mini',
        });
      },
      { code: REFUSAL_CODES.AGENT_APPROVAL }
    );
  });
});

describe('AI-22-R04: Approver identity from authenticated environment', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('declared approved_by in proposal input is ignored and set to null', () => {
    const res = proposeLesson(
      {
        id: 'LESSON-IGNORED-INPUT-APPROVER',
        title: 'Declared approved_by in proposal must be ignored',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Proposer tried to forge approved_by in JSON payload.',
        proposed_by: 'gemini',
        approved_by: 'vinh05092001', // attempt to smuggle approver
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    assert.equal(res.lesson.status, 'proposed');
    assert.equal(res.lesson.approved_by, null);
    assert.ok(res.warnings.length > 0);
    assert.match(res.warnings[0], /ignored for proposal/);
  });

  test('approver is read from authenticated environment when approving', () => {
    proposeLesson(
      {
        id: 'LESSON-ENV-APPROVER-TEST',
        title: 'Approver is read from environment variable when specified',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Environment variable carries authenticated login.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    const oldEnv = process.env.GITHUB_USER;
    try {
      process.env.GITHUB_USER = 'verified-human-operator';
      const res = approveLesson('LESSON-ENV-APPROVER-TEST', {
        dir: env.dir,
        schemaPath: env.schemaPath,
      });
      assert.equal(res.lesson.status, 'approved');
      assert.equal(res.lesson.approved_by, 'verified-human-operator');
    } finally {
      if (oldEnv === undefined) delete process.env.GITHUB_USER;
      else process.env.GITHUB_USER = oldEnv;
    }
  });
});

describe('AI-22-R05: Only proposed can be approved or rejected', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('cannot approve an already approved lesson', () => {
    proposeLesson(
      {
        id: 'LESSON-ALREADY-APPROVED-TEST',
        title: 'Approving twice must be refused naming current state',
        scope: 'spec',
        source_commit: VALID_COMMIT,
        evidence: 'State transition is proposed -> approved only once.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    approveLesson('LESSON-ALREADY-APPROVED-TEST', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-reviewer',
    });

    assert.throws(
      () => {
        approveLesson('LESSON-ALREADY-APPROVED-TEST', {
          dir: env.dir,
          schemaPath: env.schemaPath,
          approver: 'other-human',
        });
      },
      (err) => {
        assert.equal(err.code, REFUSAL_CODES.INVALID_STATE);
        assert.match(err.message, /approved/);
        return true;
      }
    );
  });

  test('cannot reject an already approved lesson', () => {
    proposeLesson(
      {
        id: 'LESSON-REJECT-APPROVED-TEST',
        title: 'Cannot reject an already approved lesson',
        scope: 'spec',
        source_commit: VALID_COMMIT,
        evidence: 'Only proposed lessons can be rejected.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    approveLesson('LESSON-REJECT-APPROVED-TEST', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-reviewer',
    });

    assert.throws(
      () => {
        rejectLesson('LESSON-REJECT-APPROVED-TEST', {
          dir: env.dir,
          schemaPath: env.schemaPath,
        });
      },
      { code: REFUSAL_CODES.INVALID_STATE }
    );
  });
});

describe('AI-22-R06: A superseding lesson must itself be approved', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('refuses superseding when replacement does not exist', () => {
    proposeLesson(
      {
        id: 'LESSON-TARGET-SUPERSEDE-1',
        title: 'Old lesson that needs replacement in the future',
        scope: 'tooling',
        source_commit: VALID_COMMIT,
        evidence: 'Old behavior superseded.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    approveLesson('LESSON-TARGET-SUPERSEDE-1', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-reviewer',
    });

    assert.throws(
      () => {
        supersedeLesson('LESSON-TARGET-SUPERSEDE-1', 'LESSON-NONEXISTENT', {
          dir: env.dir,
          schemaPath: env.schemaPath,
        });
      },
      { code: REFUSAL_CODES.SUPERSEDING_LESSON_MISSING }
    );
  });

  test('refuses superseding when replacement is not approved', () => {
    proposeLesson(
      {
        id: 'LESSON-TARGET-SUPERSEDE-2',
        title: 'Target lesson to be superseded by proposed replacement',
        scope: 'tooling',
        source_commit: VALID_COMMIT,
        evidence: 'Evidence for old lesson.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    approveLesson('LESSON-TARGET-SUPERSEDE-2', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-reviewer',
    });

    proposeLesson(
      {
        id: 'LESSON-REPLACEMENT-UNAPPROVED',
        title: 'New lesson that is still in proposed status',
        scope: 'tooling',
        source_commit: VALID_COMMIT,
        evidence: 'Evidence for new lesson.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    assert.throws(
      () => {
        supersedeLesson('LESSON-TARGET-SUPERSEDE-2', 'LESSON-REPLACEMENT-UNAPPROVED', {
          dir: env.dir,
          schemaPath: env.schemaPath,
        });
      },
      { code: REFUSAL_CODES.SUPERSEDING_LESSON_NOT_APPROVED }
    );
  });

  test('succeeds superseding when replacement is approved', () => {
    proposeLesson(
      {
        id: 'LESSON-OLD-PRACTICE',
        title: 'Old practice to be superseded by verified one',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Old practice description.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    approveLesson('LESSON-OLD-PRACTICE', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-reviewer',
    });

    proposeLesson(
      {
        id: 'LESSON-NEW-PRACTICE',
        title: 'New practice that replaces the old practice',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'New practice description.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    approveLesson('LESSON-NEW-PRACTICE', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-reviewer',
    });

    const res = supersedeLesson('LESSON-OLD-PRACTICE', 'LESSON-NEW-PRACTICE', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-reviewer',
    });

    assert.equal(res.lesson.status, 'superseded');
    assert.equal(res.lesson.superseded_by, 'LESSON-NEW-PRACTICE');
  });
});

describe('AI-22-R07: Schema validation before write', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('refuses proposal with invalid commit hash', () => {
    assert.throws(
      () => {
        proposeLesson(
          {
            id: 'LESSON-BAD-COMMIT',
            title: 'Commit hash is too short and invalid',
            scope: 'repo',
            source_commit: '12345', // not 40 chars
            evidence: 'Bad commit test.',
            proposed_by: 'gemini',
          },
          { dir: env.dir, schemaPath: env.schemaPath }
        );
      },
      { code: REFUSAL_CODES.SCHEMA_VIOLATION }
    );
  });

  test('refuses proposal with invalid scope', () => {
    assert.throws(
      () => {
        proposeLesson(
          {
            id: 'LESSON-BAD-SCOPE',
            title: 'Scope is not in the governed enum',
            scope: 'arbitrary-scope',
            source_commit: VALID_COMMIT,
            evidence: 'Bad scope test.',
            proposed_by: 'gemini',
          },
          { dir: env.dir, schemaPath: env.schemaPath }
        );
      },
      { code: REFUSAL_CODES.SCHEMA_VIOLATION }
    );
  });
});

describe('AI-22-R08: Promotion record append-only log', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('every transition is appended with all required fields', () => {
    proposeLesson(
      {
        id: 'LESSON-RECORD-CYCLE',
        title: 'Lifecycle transitions are recorded in promotion log',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Promotion record testing.',
        proposed_by: 'gemini',
      },
      { dir: env.dir, schemaPath: env.schemaPath }
    );

    approveLesson('LESSON-RECORD-CYCLE', {
      dir: env.dir,
      schemaPath: env.schemaPath,
      approver: 'human-operator',
    });

    const records = readPromotionRecords({ dir: env.dir });
    assert.equal(records.length, 2);

    // First record: proposal
    assert.equal(records[0].lesson_id, 'LESSON-RECORD-CYCLE');
    assert.equal(records[0].from_state, null);
    assert.equal(records[0].to_state, 'proposed');
    assert.equal(records[0].approver, null);
    assert.equal(records[0].proposer, 'gemini');
    assert.equal(records[0].source_commit, VALID_COMMIT);
    assert.ok(records[0].instant);

    // Second record: approval
    assert.equal(records[1].lesson_id, 'LESSON-RECORD-CYCLE');
    assert.equal(records[1].from_state, 'proposed');
    assert.equal(records[1].to_state, 'approved');
    assert.equal(records[1].approver, 'human-operator');
    assert.equal(records[1].proposer, 'gemini');
    assert.equal(records[1].source_commit, VALID_COMMIT);
    assert.ok(records[1].instant);
  });
});

describe('AI-22-R09: No PII and no credentials', () => {
  let env;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('refuses lesson containing secret token in evidence', () => {
    assert.throws(
      () => {
        proposeLesson(
          {
            id: 'LESSON-SECRET-LEAK',
            title: 'Evidence contains an accidental anthropic secret key',
            scope: 'security',
            source_commit: VALID_COMMIT,
            evidence: 'Bearer sk-ant-api03-1234567890abcdefghijklmnop leaked.',
            proposed_by: 'gemini',
          },
          { dir: env.dir, schemaPath: env.schemaPath }
        );
      },
      { code: REFUSAL_CODES.CREDENTIALS_OR_PII_DETECTED }
    );
  });

  test('refuses lesson containing personal email in title', () => {
    assert.throws(
      () => {
        proposeLesson(
          {
            id: 'LESSON-EMAIL-LEAK',
            title: 'Contact user@example.com for review instructions',
            scope: 'workflow',
            source_commit: VALID_COMMIT,
            evidence: 'Email was embedded in lesson title.',
            proposed_by: 'gemini',
          },
          { dir: env.dir, schemaPath: env.schemaPath }
        );
      },
      { code: REFUSAL_CODES.CREDENTIALS_OR_PII_DETECTED }
    );
  });
});

describe('CLI Integration: tools/ai-brain/cli.js lesson', () => {
  let env;
  const cliPath = path.resolve(__dirname, '..', 'cli.js');

  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => {
    cleanupTempEnv(env);
  });

  test('propose and approve via CLI', () => {
    const lessonJson = path.join(env.dir, 'input-lesson.json');
    fs.writeFileSync(
      lessonJson,
      JSON.stringify({
        id: 'LESSON-CLI-TEST',
        title: 'Testing promotion gate via command line interface',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'CLI invocation evidence.',
        proposed_by: 'gemini',
      })
    );

    // Propose
    const proposeChild = cp.spawnSync(
      process.execPath,
      [cliPath, 'lesson', 'propose', lessonJson, '--dir', env.dir],
      { encoding: 'utf8' }
    );
    assert.equal(proposeChild.status, 0);
    assert.match(proposeChild.stdout, /proposed: LESSON-CLI-TEST/);

    // Approve with human approver
    const approveChild = cp.spawnSync(
      process.execPath,
      [
        cliPath,
        'lesson',
        'approve',
        'LESSON-CLI-TEST',
        '--approver',
        'alice-human',
        '--dir',
        env.dir,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(approveChild.status, 0);
    assert.match(approveChild.stdout, /approved: LESSON-CLI-TEST by alice-human/);

    // Attempt self-approval via CLI -> exit 1
    const secondLesson = path.join(env.dir, 'input-self.json');
    fs.writeFileSync(
      secondLesson,
      JSON.stringify({
        id: 'LESSON-CLI-SELF',
        title: 'Testing self-approval refusal via command line',
        scope: 'workflow',
        source_commit: VALID_COMMIT,
        evidence: 'Self approval CLI evidence.',
        proposed_by: 'bob-author',
      })
    );
    cp.spawnSync(process.execPath, [cliPath, 'lesson', 'propose', secondLesson, '--dir', env.dir]);

    const selfApproveChild = cp.spawnSync(
      process.execPath,
      [
        cliPath,
        'lesson',
        'approve',
        'LESSON-CLI-SELF',
        '--approver',
        'bob-author',
        '--dir',
        env.dir,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(selfApproveChild.status, 1);
    assert.match(selfApproveChild.stderr, /SELF_APPROVAL/);
  });
});
