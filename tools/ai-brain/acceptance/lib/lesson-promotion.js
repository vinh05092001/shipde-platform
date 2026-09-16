'use strict';
// TASK-AI-22 — the promotion rules for proposed memory, held in exactly one
// place.
//
// `ac-22-03-lifecycle-states.js` and `ac-22-04-proposed-state-removed.js`
// require the lifecycle half. `ac-22-05-no-self-approval.js` and
// `ac-22-06-self-approval-detected.js` require the approval half. No script
// restates a rule, so editing a rule here changes the gate and the proof of the
// gate together.
//
// Lifecycle half. A promotion gate needs a state an agent may write
// (`proposed`) that is distinct from the state only a review may write
// (`approved`). TASK-AI-21's schema declares both; if either disappears there is
// nothing to promote from or to.
//
// Approval half. TASK-AI-21 requires a non-empty `approved_by` on an approved
// lesson, but JSON Schema cannot compare two fields, so the schema accepts a
// lesson whose approver is the agent that proposed it. That is the exact case
// the register row forbids: "an agent may propose a lesson but never approve its
// own into the brain". The rule here closes it for every approved or superseded
// lesson: the approver differs from the proposer, and the approver is not an
// agent identity.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 the rule is violated   2 the rule cannot be measured

const SCHEMA_PATH = 'tools/ai-brain/lessons/lesson-schema.json';
const SEED_PATH = 'tools/ai-brain/lessons/lesson-seed.json';

// The states the gate moves between. `proposed` is written by an agent;
// `approved` only by a human review (AI-TOOL-06).
const REQUIRED_STATES = ['proposed', 'approved'];

// Identities that are agents, never human reviewers. They are the authors and
// reviewers AGENTS.md names, the harnesses the controller launches, and the
// proposer identities the committed seed already uses.
const AGENT_IDENTITIES = [
  'claude',
  'claude-code',
  'codex',
  'codex-review',
  'gemini',
  'agy',
  '9router',
  'dsh',
  'cline',
  'chatgpt-codex-connector[bot]',
];

/** Lifecycle violations of a parsed schema; empty when both states exist. */
function lifecycleViolations(schema) {
  const status = schema && schema.properties && schema.properties.status;
  const states = status && Array.isArray(status.enum) ? status.enum : null;
  if (!states) return ['LIFECYCLE_STATUS_ENUM_MISSING'];
  return REQUIRED_STATES.filter((state) => !states.includes(state)).map(
    (state) => 'LIFECYCLE_STATE_MISSING: ' + state
  );
}

function isAgentIdentity(identity) {
  const value = String(identity || '')
    .trim()
    .toLowerCase();
  return AGENT_IDENTITIES.some((agent) => value === agent || value.startsWith(agent + '/'));
}

/** Approval violations across a parsed seed; empty when no lesson is self-approved. */
function approvalViolations(seed) {
  const lessons = seed && Array.isArray(seed.lessons) ? seed.lessons : [];
  const violations = [];
  for (const lesson of lessons) {
    if (lesson.status !== 'approved' && lesson.status !== 'superseded') continue;
    const proposer = String(lesson.proposed_by || '')
      .trim()
      .toLowerCase();
    const approver = String(lesson.approved_by || '')
      .trim()
      .toLowerCase();
    if (approver && approver === proposer) {
      violations.push('SELF_APPROVAL: ' + lesson.id + ' approved by its proposer ' + approver);
    } else if (isAgentIdentity(approver)) {
      violations.push('AGENT_APPROVAL: ' + lesson.id + ' approved by agent ' + approver);
    }
  }
  return violations;
}

/** How many lessons the approval rule inspected, for evidence output only. */
function promotedCount(seed) {
  const lessons = seed && Array.isArray(seed.lessons) ? seed.lessons : [];
  return lessons.filter((l) => l.status === 'approved' || l.status === 'superseded').length;
}

module.exports = {
  SCHEMA_PATH,
  SEED_PATH,
  REQUIRED_STATES,
  AGENT_IDENTITIES,
  lifecycleViolations,
  isAgentIdentity,
  approvalViolations,
  promotedCount,
};
