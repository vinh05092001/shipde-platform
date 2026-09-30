'use strict';

/**
 * Ship Dễ — Review / repair loop (TASK-AI-60 loop, TASK-AI-64 live level).
 *
 * code -> deterministic tests -> independent review -> repair open findings ->
 * tests -> re-review. The reviewer must differ from the writer in account,
 * model, gateway or upstream (the Controller owns that decision; this loop only
 * consumes an injected review that was already taken against an exact SHA).
 *
 * Three refusals are structural, and they are the reason this module can be
 * driven by a live run without a human watching it (AI-64-R07, AI-64-P08):
 *
 *   - a gate that is absent is a refusal, never a pass. The old defaults
 *     (`() => ({ pass: true })`) made a caller who forgot a dependency get a
 *     green loop instead of an error, so a missing gate now throws.
 *   - a review is bound to the SHA it read. A review of another commit is
 *     `STALE_REVIEW_SHA`; a review that names no commit at all is
 *     `REVIEW_SHA_UNBOUND`, because an unbound review is evidence for every
 *     commit at once. The old check was guarded on `rev.sha &&`, so omitting
 *     the field passed the review for any SHA.
 *   - PASS carrying open findings is a contradiction, not a pass, and the
 *     findings that caused it travel with the refusal so repair, the decision
 *     log and a human can all see what was refused.
 *
 * Repair is bounded: exhausting the budget returns BLOCKED with
 * REPAIR_BUDGET_EXHAUSTED, never an unbounded retry.
 */

const Status = Object.freeze({
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  IN_PROGRESS: 'IN_PROGRESS',
});

const Refusal = Object.freeze({
  SHA_UNBOUND: 'REVIEW_SHA_UNBOUND',
  STALE_SHA: 'STALE_REVIEW_SHA',
  PASS_WITH_FINDINGS: 'PASS_WITH_FINDINGS_REJECTED',
  BUDGET_EXHAUSTED: 'REPAIR_BUDGET_EXHAUSTED',
});

const DEFAULT_BUDGET = 3;

function openFindingsOf(rev) {
  if (!rev || !Array.isArray(rev.findings)) return [];
  return rev.findings.filter((f) => !f || !f.closed);
}

/**
 * @param state { sha, budget }
 * @param deps  {
 *   runTests() -> { pass, cause?, findings? },
 *   review(sha) -> { pass, sha, verdict?, reviewer?, findings? },
 *   repair(findings, sha) -> { sha }
 * }
 */
function runReviewLoop(state, deps) {
  const s = state || {};
  const d = deps || {};
  const budget = Number.isFinite(Number(s.budget)) ? Number(s.budget) : DEFAULT_BUDGET;

  // AI-64-P08: absence of evidence is never evidence of success. A gate the
  // caller forgot is a refusal, not a default that passes.
  for (const name of ['runTests', 'review', 'repair']) {
    if (typeof d[name] !== 'function') {
      throw new Error('REVIEW_LOOP_REFUSED: missing ' + name + ' (the loop has no default gate)');
    }
  }
  const runTests = d.runTests;
  const review = d.review;
  const repair = d.repair;

  // AI-64-R07: the loop is entered with the commit it is reviewing. There is no
  // 'head' placeholder: a run that cannot name its commit cannot review it.
  if (typeof s.sha !== 'string' || s.sha.trim() === '') {
    throw new Error('REVIEW_LOOP_REFUSED: missing sha (an exact-SHA review is mandatory)');
  }

  let currentSha = s.sha;
  let repairCount = 0;
  const rounds = [];
  let tests = runTests();

  for (let round = 1; round <= budget + 2; round += 1) {
    if (!tests.pass) {
      const cause = tests.cause || 'TEST_FAILURE';
      rounds.push({
        round,
        stage: 'repair',
        sha: currentSha,
        cause,
        findings: tests.findings || [],
      });
      repairCount += 1;
      if (repairCount > budget) {
        rounds.push({ round, stage: 'blocked', sha: currentSha, cause: Refusal.BUDGET_EXHAUSTED });
        return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
      }
      const rep = repair(tests.findings || [], currentSha);
      currentSha = (rep && rep.sha) || currentSha;
      tests = runTests();
      continue;
    }

    const rev = review(currentSha);

    // A review that names no commit is evidence for every commit at once.
    if (!rev || typeof rev.sha !== 'string' || rev.sha.trim() === '') {
      rounds.push({ round, stage: 'blocked', sha: currentSha, cause: Refusal.SHA_UNBOUND });
      return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
    }
    // A review of a different commit is stale evidence for this commit.
    if (rev.sha !== currentSha) {
      rounds.push({ round, stage: 'blocked', sha: currentSha, cause: Refusal.STALE_SHA });
      return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
    }

    const open = openFindingsOf(rev);
    // PASS with findings is a contradiction, not a pass, and the open findings
    // that make it contradictory travel with the refusal.
    if (rev.pass && open.length > 0) {
      rounds.push({
        round,
        stage: 'blocked',
        sha: currentSha,
        cause: Refusal.PASS_WITH_FINDINGS,
        verdict: rev.verdict || 'PASS',
        reviewer: rev.reviewer || null,
        findings: open,
      });
      return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
    }
    if (rev.pass) {
      rounds.push({
        round,
        stage: 'review-pass',
        sha: currentSha,
        verdict: rev.verdict || 'PASS',
        reviewer: rev.reviewer || null,
      });
      return {
        status: Status.COMPLETED,
        rounds,
        finalSha: currentSha,
        repairCount,
        verdict: rev.verdict || 'PASS',
        reviewer: rev.reviewer || null,
      };
    }

    rounds.push({
      round,
      stage: 'review-failed',
      sha: currentSha,
      verdict: rev.verdict || null,
      reviewer: rev.reviewer || null,
      findings: open,
    });
    repairCount += 1;
    if (repairCount > budget) {
      rounds.push({ round, stage: 'blocked', sha: currentSha, cause: Refusal.BUDGET_EXHAUSTED });
      return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
    }
    const rep = repair(open, currentSha);
    currentSha = (rep && rep.sha) || currentSha;
    tests = runTests();
  }

  return { status: Status.BLOCKED, rounds, finalSha: currentSha, repairCount };
}

module.exports = { Status, Refusal, DEFAULT_BUDGET, runReviewLoop };
