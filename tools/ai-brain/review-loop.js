'use strict';

/**
 * Ship Dễ — Review / repair loop (TASK-AI-60, dry-run level).
 *
 * code -> deterministic tests -> independent review -> repair open findings ->
 * tests -> re-review -> CI. The reviewer must differ from the writer in model,
 * provider or failure domain (the Controller owns that decision; this loop only
 * consumes an injected review that was already taken against an exact SHA).
 *
 * A review is bound to the exact SHA it read: a review of an old SHA is never
 * accepted for a new SHA. PASS with open findings is rejected. Repair tasks
 * carry only the open findings, and repair is bounded: exhausting the budget
 * returns BLOCKED, never an infinite retry.
 */

const Status = Object.freeze({
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  IN_PROGRESS: 'IN_PROGRESS',
});

/**
 * @param state { sha, budget }
 * @param deps  {
 *   runTests() -> { pass, cause?, findings? },
 *   review(sha) -> { pass, sha?, findings? },
 *   repair(findings, sha) -> { sha }
 * }
 */
function runReviewLoop(state, deps) {
  const s = state || {};
  const d = deps || {};
  const budget = Number.isFinite(Number(s.budget)) ? Number(s.budget) : 3;
  const runTests = typeof d.runTests === 'function' ? d.runTests : () => ({ pass: true });
  const review = typeof d.review === 'function' ? d.review : () => ({ pass: true, findings: [] });
  const repair = typeof d.repair === 'function' ? d.repair : (findings, sha) => ({ sha });

  let currentSha = s.sha || 'head';
  let repairCount = 0;
  const rounds = [];
  let tests = runTests();

  for (let round = 1; round <= budget + 2; round += 1) {
    if (!tests.pass) {
      const cause = tests.cause || 'TEST_FAILURE';
      rounds.push({ round, stage: 'repair', cause, findings: tests.findings || [] });
      repairCount += 1;
      if (repairCount > budget) {
        rounds.push({ round, stage: 'blocked', cause: 'REPAIR_BUDGET_EXHAUSTED' });
        return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
      }
      const rep = repair(tests.findings || [], currentSha);
      currentSha = (rep && rep.sha) || currentSha;
      tests = runTests();
      continue;
    }

    const rev = review(currentSha);
    // A review of a different SHA is stale evidence for this SHA.
    if (rev && rev.sha && rev.sha !== currentSha) {
      rounds.push({ round, stage: 'blocked', cause: 'STALE_REVIEW_SHA' });
      return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
    }
    // PASS with findings is a contradiction, not a pass.
    if (rev && rev.pass && Array.isArray(rev.findings) && rev.findings.length > 0) {
      rounds.push({ round, stage: 'blocked', cause: 'PASS_WITH_FINDINGS_REJECTED' });
      return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
    }
    if (rev && rev.pass) {
      rounds.push({ round, stage: 'review-pass' });
      return { status: Status.COMPLETED, rounds, finalSha: currentSha, repairCount };
    }

    const open = Array.isArray(rev && rev.findings)
      ? rev.findings.filter((f) => !f || !f.closed)
      : [];
    rounds.push({ round, stage: 'review-failed', findings: open });
    repairCount += 1;
    if (repairCount > budget) {
      rounds.push({ round, stage: 'blocked', cause: 'REPAIR_BUDGET_EXHAUSTED' });
      return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
    }
    const rep = repair(open, currentSha);
    currentSha = (rep && rep.sha) || currentSha;
    tests = runTests();
  }

  return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
}

module.exports = { Status, runReviewLoop };
