'use strict';
// TASK-AI-08 — the dependency claim, held in exactly one place.
//
// `ac-08-03-dependency-merged.js` (the invariant: the register's declared
// dependency for TASK-AI-08 is really merged into `origin/main`) and
// `ac-08-04-dependency-unproven.js` (the negative proof: a copy of the register
// that names a dependency with no merge commit is refused) both require this
// module, so the rule exists in exactly one place.
//
// The rule is a CLAIM, not a re-implementation of a validator. The register is
// read from disk and Git supplies the merge evidence; no fixture is consulted.
//
// Exit codes used by the scripts that require this file:
//   0 the claim holds   1 the claim is violated   2 the claim cannot be measured
const cp = require('child_process');

// The register's column order, read from the header rather than assumed.
const REGISTER_HEADER = [
  'delivery_order',
  'slice',
  'group',
  'work_item_id',
  'feature_id',
  'feature_name',
  'key_behavior',
  'status',
  'dependencies',
  'work_item_path',
  'branch',
  'pr',
  'codex_verdict',
  'merge_commit',
];

/** Split one RFC 4180 CSV line into its cells. */
function csvFields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Serialize cells back into one RFC 4180 CSV line. */
function csvLine(cells) {
  return cells.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(',');
}

/** The Work Item's `dependencies` cell, or null when the register has no such row. */
function declaredDependency(registerText, workItemId) {
  const lines = registerText.split(/\r?\n/).filter(Boolean);
  const header = lines.length > 0 ? csvFields(lines[0]) : REGISTER_HEADER;
  const idIndex = header.indexOf('work_item_id');
  const depIndex = header.indexOf('dependencies');
  if (idIndex < 0 || depIndex < 0) return null;
  for (const line of lines.slice(1)) {
    const fields = csvFields(line);
    if (fields[idIndex] === workItemId) return fields[depIndex] || null;
  }
  return null;
}

/** Every commit reachable on `origin/main` whose message names the Work Item. */
function commitsMerging(workItemId) {
  const res = cp.spawnSync('git', ['log', 'origin/main', '--format=%H', '--grep=' + workItemId], {
    encoding: 'utf8',
  });
  if (res.error || res.status !== 0) return null;
  return res.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * Whether a Work Item id is proven merged. `measurable` is false when Git could
 * not be consulted at all (so a caller must exit 2, never 1).
 */
function dependencyProven(workItemId) {
  const commits = commitsMerging(workItemId);
  if (commits === null) {
    return { ok: false, measurable: false, why: 'git log origin/main could not be run' };
  }
  if (commits.length === 0) {
    return {
      ok: false,
      measurable: true,
      why: workItemId + ' has no merge commit reachable on origin/main',
    };
  }
  return { ok: true, measurable: true, commits };
}

module.exports = {
  REGISTER_HEADER,
  csvFields,
  csvLine,
  declaredDependency,
  commitsMerging,
  dependencyProven,
};
