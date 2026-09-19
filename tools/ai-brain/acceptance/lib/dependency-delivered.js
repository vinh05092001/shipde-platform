'use strict';
// TASK-AI-21 — the dependency claim for this Work Item, held in exactly one
// place.
//
// `ac-21-07-dependency-delivered.js` (the invariant: the register's declared
// dependency for TASK-AI-21 is really delivered on `origin/main`) and
// `ac-21-08-dependency-unproven.js` (the negative proof: a copy of the register
// that names a dependency with no merge commit is refused) both require this
// module, so the rule exists in exactly one place.
//
// Three rules are re-used rather than restated:
//   * the register's `dependencies` cell is parsed by
//     `./dependency-merged.js`, re-exported here by reference — a second CSV
//     reading of the register would be a second answer to what it declares;
//   * the merge evidence is that module's own `dependencyProven`, re-exported by
//     reference, and it is kept as ONE half of the claim rather than replaced;
//   * the dependency's deliverable is checked by the dependency's OWN rule,
//     `./reconcile-expectations.js`, re-exported by reference, so the claim about
//     TASK-AI-17 cannot drift from the claim TASK-AI-17's own rows make.
//
// The commit-name rule alone is evidence, not proof: `git log --grep=<id>`
// matches any commit whose message names the Work Item, including a commit that
// merely lists it as a dependency. `deliverableAtOriginMain` closes that gap for
// this Work Item by reading the dependency's declared artifact out of the merged
// tree and applying the dependency's own acceptance rule to it. Both halves must
// hold, so a commit that only *names* TASK-AI-17 can no longer satisfy the row.
//
// Exit codes used by the scripts that require this file:
//   0 the claim holds   1 the claim is violated   2 the claim cannot be measured

const cp = require('child_process');
const { declaredDependency, dependencyProven } = require('./dependency-merged');
const { reconciliationViolations } = require('./reconcile-expectations');

// The artifact each dependency promised to deliver, and the rule that says
// whether it did. TASK-AI-17's deliverable is the reconciled ecosystem manifest;
// the rule is the one TASK-AI-17's own acceptance rows already require.
const DELIVERABLES = {
  'TASK-AI-17': {
    path: 'tools/ecosystem-manifest.json',
    claim: reconciliationViolations,
  },
};

/** The bytes of `relativePath` as merged into `origin/main`, or an error verdict. */
function originMainFile(relativePath) {
  const res = cp.spawnSync('git', ['show', 'origin/main:' + relativePath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
  });
  if (res.error || res.status !== 0) {
    return { ok: false, why: 'origin/main does not contain ' + relativePath };
  }
  return { ok: true, text: res.stdout };
}

/**
 * Whether the dependency's declared deliverable is present on `origin/main` and
 * satisfies the dependency's own acceptance rule.
 *
 * `reader` defaults to reading the merged tree through Git. The negative proof
 * injects a reader so it can point this rule at a tampered COPY of the real
 * artifact, which is what makes the rule falsifiable: without an injectable
 * reader, a rule that reads only from Git could stop firing and no row would
 * notice.
 */
function deliverableAtOriginMain(workItemId, reader) {
  const deliverable = DELIVERABLES[workItemId];
  if (!deliverable) {
    return {
      ok: false,
      measurable: false,
      why: 'no declared deliverable rule for ' + workItemId,
    };
  }

  const read = reader || originMainFile;
  const file = read(deliverable.path);
  if (!file.ok) {
    return { ok: false, measurable: false, why: file.why };
  }

  let parsed;
  try {
    parsed = JSON.parse(file.text);
  } catch (err) {
    return {
      ok: false,
      measurable: false,
      why: deliverable.path + ' on origin/main is not readable JSON: ' + err.message,
    };
  }

  const violations = deliverable.claim(parsed);
  if (violations.length > 0) {
    return {
      ok: false,
      measurable: true,
      why:
        workItemId +
        ' is named on origin/main but its deliverable ' +
        deliverable.path +
        ' still violates its own rule: ' +
        violations[0],
    };
  }
  return { ok: true, measurable: true, path: deliverable.path };
}

/**
 * Whether the register's declared dependency for `workItemId` is delivered on
 * `origin/main`: named by a reachable commit AND present as its own deliverable.
 * `measurable` is false when Git could not be consulted at all, so a caller must
 * exit 2 rather than 1.
 */
function dependencyDelivered(registerText, workItemId, reader) {
  const dependency = declaredDependency(registerText, workItemId);
  if (!dependency) {
    return { measurable: false, ok: false, why: 'no declared dependency for ' + workItemId };
  }

  const named = dependencyProven(dependency);
  if (!named.measurable) {
    return { measurable: false, ok: false, why: named.why };
  }
  if (!named.ok) {
    return { measurable: true, ok: false, dependency, why: named.why };
  }

  // The merge commit exists. Now check the deliverable.
  const deliverable = deliverableAtOriginMain(dependency, reader);
  if (!deliverable.measurable) {
    // When the merge commit exists but there is no deliverable rule, the
    // dependency is not delivered — we can measure that it exists but has no
    // deliverable. This is how AC-AI-23-09 proves a blocked dependency.
    return { measurable: true, ok: false, dependency, why: deliverable.why };
  }
  if (!deliverable.ok) {
    return { measurable: true, ok: false, dependency, why: deliverable.why };
  }

  return {
    measurable: true,
    ok: true,
    dependency,
    deliverable: deliverable.path,
  };
}

module.exports = {
  DELIVERABLES,
  originMainFile,
  deliverableAtOriginMain,
  dependencyDelivered,
  // Re-exported by reference so callers share one parser and one merge rule.
  declaredDependency,
  dependencyProven,
  reconciliationViolations,
};
