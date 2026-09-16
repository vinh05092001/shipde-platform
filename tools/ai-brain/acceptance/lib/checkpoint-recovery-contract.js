'use strict';
// TASK-AI-09 — the restart-recovery contract the supervisor source must satisfy,
// held in exactly one place.
//
// `ac-09-05-recovery-contract.js` (the invariant: the real supervisor persists a
// durable checkpoint, reclaims a stale supervisor lock, and resumes from an
// existing Pull Request without duplicating work) and
// `ac-09-06-recovery-contract-broken.js` (the negative proof: a copy of the real
// source with the atomic checkpoint write removed is refused) both require this
// module, so the rule exists in exactly one place and the gate cannot drift from
// the proof of the gate.
//
// The contract is a CLAIM ABOUT THE SUPERVISOR SOURCE, not a re-implementation
// of it. The supervisor that resumes after a restart is `scripts/ai/control.ps1`;
// these scripts read that real file, and the negative proof tampers a copy. The
// claims are deliberately the properties TASK-AI-09 must PRESERVE while it
// extends restart recovery: the checkpoint exists under the handoff root, it is
// written atomically, it round-trips every recovery-critical field, a malformed
// checkpoint fails closed, superseded checkpoints are archived under a stable
// identity and restorable by it, a live supervisor is never displaced while a
// dead one's lock is reclaimed, and `Resume` consumes an existing Pull Request
// before it starts or prepares anything else.
//
// Exit codes used by the scripts that require this file:
//   0 the contract holds   1 it is violated   2 it cannot be measured

const SOURCE = 'scripts/ai/control.ps1';

// The fields a restart needs in order to resume the same Work Item, the same
// branch and the same Pull Request without duplicating either. `TASK-AI-06` § 8
// names the first five; the rest are the dispatch, review and merge intents the
// supervisor must not re-issue after a restart.
const RECOVERY_FIELDS = [
  'WorkItemId',
  'Branch',
  'SessionId',
  'State',
  'LastActivityTime',
  'PullRequestNumber',
  'HeadSha',
  'RepairCount',
  'PendingDispatch',
  'LastAcknowledgedCiRepairHead',
  'LastAcknowledgedReviewRepairHead',
  'MergeIntent',
  'MergeCommitOid',
  'CheckpointTime',
];

/**
 * The body of a PowerShell function declared at column zero, or null when the
 * source does not declare it. The supervisor closes every function with a `}`
 * on its own line, so the first such line after the declaration ends the body.
 */
function functionBody(source, name) {
  const start = source.indexOf('function ' + name + ' {');
  if (start < 0) return null;
  const end = source.indexOf('\n}', start);
  if (end < 0) return null;
  return source.slice(start, end + 2);
}

/** Whether the normalizer declares every recovery-critical field. */
function missingRecoveryFields(source) {
  const body = functionBody(source, 'Normalize-ShipDeSupervisorState');
  if (body === null) return RECOVERY_FIELDS.slice();
  return RECOVERY_FIELDS.filter((field) => !new RegExp('^\\s*' + field + '\\s*=', 'm').test(body));
}

/**
 * Whether `Resume` selects the existing open implementation Pull Request before
 * it starts a prepared Work Item or prepares a new one. That ordering is what
 * makes a restart idempotent: re-running `Resume` continues the work already in
 * flight instead of opening a second Pull Request or consuming a second row.
 */
function resumeConsumesExistingPullRequestFirst(source) {
  const body = functionBody(source, 'Invoke-ShipDeResume');
  if (body === null) return false;
  const review = body.indexOf('Invoke-ShipDeReview');
  const start = body.indexOf('Invoke-ShipDeStart');
  const prepare = body.indexOf('Invoke-ShipDePrepare');
  return review > 0 && start > review && prepare > start;
}

// Each part is one required property of the real supervisor source. `test`
// returns true when the source satisfies the property.
const REQUIRED_PARTS = [
  {
    id: 'CHECKPOINT_FILE',
    label: 'a durable checkpoint file named supervisor-state.json under the handoff root',
    test: (source) =>
      /SupervisorStateFile\s*=\s*Join-Path\s+\$script:HandoffRoot\s+"supervisor-state\.json"/.test(
        source
      ),
  },
  {
    id: 'CHECKPOINT_ROUND_TRIP',
    label: 'a checkpoint normalizer declaring every recovery-critical field',
    test: (source) => missingRecoveryFields(source).length === 0,
  },
  {
    id: 'CHECKPOINT_ATOMIC_WRITE',
    label: 'an atomic checkpoint write through a temporary file',
    test: (source) =>
      /Move-Item\s+-LiteralPath\s+\$temporaryPath\s+-Destination\s+\$script:SupervisorStateFile/.test(
        source
      ),
  },
  {
    id: 'CHECKPOINT_MALFORMED_FAIL_CLOSED',
    label: 'a fail-closed refusal to resume from a malformed checkpoint',
    test: (source) => /Supervisor checkpoint is malformed/.test(source),
  },
  {
    id: 'CHECKPOINT_ARCHIVE_KEYED',
    label: 'an archived checkpoint keyed by Work Item and Pull Request identity',
    test: (source) => /\$\{workItemId\}_PR_\$\{prNum\}/.test(source),
  },
  {
    id: 'CHECKPOINT_ARCHIVE_RESTORABLE',
    label: 'an archived checkpoint restorable by Work Item and Pull Request identity',
    test: (source) => /Test-ShipDeArchivedCheckpointMatches/.test(source),
  },
  {
    id: 'LOCK_LIVE_HOLDER_REFUSED',
    label: 'a refusal to displace a supervisor whose holding process is still alive',
    test: (source) => /Another supervisor instance/.test(source),
  },
  {
    id: 'LOCK_STALE_HOLDER_RECLAIMED',
    label: 'a stale holder reclaimed before the supervisor lock is taken',
    test: (source) =>
      /if\s*\(\$isStale\)\s*\{\s*\r?\n\s*Remove-Item\s+-LiteralPath\s+\$LockFile/.test(source),
  },
  {
    id: 'LOCK_RELEASE_OWNER_SCOPED',
    label: 'a lock release that removes the lock only for its own holder',
    test: (source) => /\$holderPid\s+-eq\s+\$CurrentPid/.test(source),
  },
  {
    id: 'RESUME_ENTRYPOINT',
    label: 'Resume exposed as a governed action routed to the recovery routine',
    test: (source) => /"Resume"\s*\{\s*Invoke-ShipDeResume\s*\}/.test(source),
  },
  {
    id: 'RESUME_CONSUMES_EXISTING_PR_FIRST',
    label:
      'Resume consuming an existing Pull Request before starting a Work Item or preparing a new one',
    test: resumeConsumesExistingPullRequestFirst,
  },
];

/** Every part of the contract missing from `source`, in declaration order. */
function missingRecoveryParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.test(source));
}

module.exports = {
  SOURCE,
  RECOVERY_FIELDS,
  functionBody,
  missingRecoveryFields,
  resumeConsumesExistingPullRequestFirst,
  REQUIRED_PARTS,
  missingRecoveryParts,
};
