'use strict';
// TASK-AI-20 — the rule that decides whether a register row is specified, in
// exactly one place.
//
// AC-AI-20-01 (the positive row) counts the rows that are NOT specified, and
// AC-AI-20-02 (its negative proof) shows the same rule rejecting a spec whose
// Control table belongs to another row. Both `require` this module, so the rule
// exists once: editing it here changes both the gate and the proof of the gate.
// A private copy in each script would let the two drift while both stayed green.
//
// Two rules are re-used rather than restated:
//   * the register is read by the canonical RFC 4180 parser in
//     tools/ai-dashboard/register-adapter.js — a second CSV parser is a second
//     answer to what the register says;
//   * the Control-table cell shape matches the one the reconciler's rows and
//     TASK-AI-37's alignment script already parse.
//
// Exit codes used by the scripts that require this file:
//   0 the row is specified   1 it is not   2 the question cannot be measured

const fs = require('fs');
const path = require('path');
const { parseRegisterCsv } = require('../../../ai-dashboard/register-adapter');

const REGISTER_PATH = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);

// The Control-table cell a Work Item document uses to name itself.
const WORK_ITEM_ID_CELL = /^\|\s*Work Item ID\s*\|\s*`?([^`|\s]+)`?\s*\|\s*$/m;

/** The Work Item ID a Work Item document's Control table declares, or null. */
function controlWorkItemId(markdown) {
  const match = String(markdown).match(WORK_ITEM_ID_CELL);
  return match ? match[1].trim() : null;
}

/** Register rows, parsed by the canonical adapter. `rootDir` is not consulted. */
function registerRows(text) {
  return parseRegisterCsv(text, null);
}

/** Whether `row.work_item_path` resolves to a file under `root`. */
function specExists(row, root) {
  const rel = (row && row.work_item_path) || '';
  if (!rel) return false;
  try {
    return fs.statSync(path.resolve(root, rel)).isFile();
  } catch (err) {
    return false;
  }
}

/**
 * The identity of one row's specification: does the file exist, and does its
 * Control table declare the row's own Work Item ID? A file that exists under the
 * right name but belongs to another row is not this row's specification.
 */
function specIdentity(row, root) {
  const rel = (row && row.work_item_path) || '';
  const exists = specExists(row, root);
  const declaredId = exists
    ? controlWorkItemId(fs.readFileSync(path.resolve(root, rel), 'utf8'))
    : null;
  return {
    path: rel,
    exists,
    declaredId,
    matches: exists && declaredId === (row.work_item_id || ''),
  };
}

/**
 * Register rows whose `work_item_path` resolves to a file on disk. The set is
 * derived by `coverageByPath`, never recomputed, so "specified" cannot drift
 * away from "unspecified" inside this module.
 */
function specifiedRows(rows, root) {
  return coverageByPath(rows, root).specified;
}

/**
 * Register rows that are not specified: either the declared path resolves to no
 * file, or the row declares no path at all. A row with a blank `work_item_path`
 * names no document, so treating it as outside the measure would understate
 * exactly the count this Work Item exists to drive to zero (AI-20-R01), and a
 * row that names no file is the clearest case of "a line that looks like work
 * and is not".
 */
function unspecifiedRows(rows, root) {
  return coverageByPath(rows, root).unspecified;
}

/**
 * The one partition the coverage measure is built from: every register row lands
 * in exactly one of the two sets, so `specified.length + unspecified.length`
 * always equals the number of rows handed in. The equality is a relation, not a
 * pinned count, so it holds however the register drifts (AI-20-R08).
 */
function coverageByPath(rows, root) {
  const specified = [];
  const unspecified = [];
  for (const row of rows) {
    if (row && row.work_item_path && specExists(row, root)) {
      specified.push(row);
    } else {
      unspecified.push(row);
    }
  }
  return { specified, unspecified };
}

/** Register rows whose spec file exists but declares a different Work Item ID. */
function identityMismatches(rows, root) {
  return rows
    .filter((row) => row.work_item_path && specExists(row, root))
    .map((row) => ({ row, identity: specIdentity(row, root) }))
    .filter((entry) => !entry.identity.matches);
}

module.exports = {
  REGISTER_PATH,
  WORK_ITEM_ID_CELL,
  controlWorkItemId,
  registerRows,
  specExists,
  specIdentity,
  coverageByPath,
  specifiedRows,
  unspecifiedRows,
  identityMismatches,
};
