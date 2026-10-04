'use strict';

/**
 * Ship Dễ — TASK-AI-78 (Gate C): scope and drift gate. Matrix: test/task-ai-78.test.js.
 * Two questions answered with named refusals: did this writer stay inside its work item, and does its
 * claim trace back to a declared acceptance criterion?
 *
 * S-R01 parseScope(workItem) requires workItemId, acceptanceIds[], ownedGlobs[], forbiddenGlobs[],
 *   testCommands[], maxDiffLines, repairBudget, maxToolCalls; anything else is SCOPE_INVALID by name.
 * S-R02 checkDiff({repoCwd, base, head, scope}) refuses, in order, FORBIDDEN_PATH, DEPENDENCY_ADDED
 *   (a package.json dependency, devDependency, optionalDependency or peerDependency, or any lockfile,
 *   unless scope.allowDependencies), OUT_OF_OWNERSHIP, ASSERTION_WEAKENED (a test file that was modified,
 *   renamed or deleted lost assertion lines while adding none), DIFF_BUDGET_EXCEEDED and NO_EVIDENCE
 *   (SUCCESS claimed, empty diff, no test report).
 * S-R03 checkTrace(actions, scope) refuses UNTRACED_ACTION for an undeclared acceptance id and
 *   FORBIDDEN_ACTION for kind push|open_pr|merge|change_candidate.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const LOCKFILE_NAMES = 'package-lock.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb';
const LOCKFILES = new Set(LOCKFILE_NAMES.split(' '));
const ASSERTION = /\b(assert|expect|should|t\.equal|t\.deepEqual|toBe|toEqual|toThrow)\b/;
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const ORDER_NAMES =
  'FORBIDDEN_PATH DEPENDENCY_ADDED OUT_OF_OWNERSHIP ASSERTION_WEAKENED DIFF_BUDGET_EXCEEDED NO_EVIDENCE';
const REFUSAL_ORDER = ORDER_NAMES.split(' ');
const FORBIDDEN_KINDS = new Set(['push', 'open_pr', 'merge', 'change_candidate']);
// A test file that was modified, renamed or deleted can have lost assertions; a new one cannot have.
const WEAKENABLE = new Set(['M', 'R', 'D']);
const DEPENDENCY_FIELDS = 'dependencies devDependencies optionalDependencies peerDependencies';
const KIND_ALIAS = { openpr: 'open_pr', pullrequest: 'open_pr' };

function git(args, cwd) {
  const opts = { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 268435456 };
  const res = cp.spawnSync('git', ['-c', 'safe.directory=*', ...args], opts);
  if (res.error || res.status !== 0) return { ok: false, stderr: String(res.stderr || '').trim() };
  return { ok: true, stdout: res.stdout || '', stderr: '' };
}

const isName = (value) => typeof value === 'string' && value.trim() !== '';
const list = (value, allowEmpty) => Array.isArray(value) && (allowEmpty || value.length > 0);
const names = (value, allowEmpty) => list(value, allowEmpty) && value.every(isName);
const budget = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const whole = (value) => Number.isInteger(value) && value > 0;
const baseName = (file) => file.split('/').pop();
const isLock = (file) => LOCKFILES.has(baseName(file));
const isManifest = (file) => baseName(file) === 'package.json';
const isTestFile = (file) => TEST_PATH.test(file);
const clean = (glob) => String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
const refuse = (code, extra) => Object.assign({ ok: false, code }, extra);

function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c !== '*') {
      source += c === '?' ? '[^/]' : '\\^$.|+()[]{}'.includes(c) ? `\\${c}` : c;
      continue;
    }
    if (glob[i + 1] !== '*') {
      source += '[^/]*';
      continue;
    }
    if (glob[i + 2] === '/') {
      source += '(?:[^/]+/)*';
      i += 2;
    } else {
      source += '.*';
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function matchGlobs(globs, file) {
  return globs.some((glob) => {
    const re = globToRegExp(glob);
    return re.test(file) || (!glob.includes('/') && re.test(baseName(file)));
  });
}

/** S-R01 validate and normalise a work item scope; every problem is named. */
function parseScope(workItem) {
  const wrapped = workItem && typeof workItem === 'object' ? workItem : {};
  const src = wrapped.scope && typeof wrapped.scope === 'object' ? wrapped.scope : wrapped;
  const c = src && typeof src === 'object' ? src : {};
  const problems = [];
  if (!isName(c.workItemId)) problems.push('workItemId');
  if (!names(c.acceptanceIds)) problems.push('acceptanceIds');
  if (!names(c.ownedGlobs)) problems.push('ownedGlobs');
  if (!names(c.forbiddenGlobs, true)) problems.push('forbiddenGlobs');
  if (!names(c.testCommands)) problems.push('testCommands');
  if (!whole(c.maxDiffLines)) problems.push('maxDiffLines');
  if (!budget(c.repairBudget)) problems.push('repairBudget');
  if (!whole(c.maxToolCalls)) problems.push('maxToolCalls');
  if (problems.length > 0) return { ok: false, code: 'SCOPE_INVALID', problems };
  const scope = {
    workItemId: c.workItemId.trim(),
    acceptanceIds: c.acceptanceIds.map((id) => id.trim()),
    ownedGlobs: c.ownedGlobs.map(clean),
    forbiddenGlobs: c.forbiddenGlobs.map(clean),
    testCommands: c.testCommands.map((cmd) => cmd.trim()),
    maxDiffLines: c.maxDiffLines,
    repairBudget: c.repairBudget,
    maxToolCalls: c.maxToolCalls,
    allowDependencies: c.allowDependencies === true,
  };
  return { ok: true, code: 'SCOPE_PARSED', scope };
}

/** `git diff --name-status -z`: a status letter then one path, two for a rename or a copy. */
function parseNameStatus(raw) {
  const tokens = raw.split('\0').filter(Boolean);
  const rows = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!/^[A-Z]/.test(tokens[i]) || !tokens[i + 1]) continue;
    const renamed = 'RC'.includes(tokens[i][0]);
    rows.push({ status: tokens[i][0], path: renamed ? tokens[i + 2] : tokens[i + 1] });
    i += renamed ? 2 : 1;
  }
  return rows;
}

function readDiffFacts(repoCwd, base, head) {
  const names = git(['diff', '--name-status', '-z', base, head], repoCwd);
  if (!names.ok) return { ok: false, stderr: names.stderr };
  const nums = git(['-c', 'core.quotepath=false', 'diff', '--numstat', base, head], repoCwd);
  if (!nums.ok) return { ok: false, stderr: nums.stderr };
  const counts = new Map();
  for (const line of nums.stdout.split('\n')) {
    const [add, del, ...rest] = line.split('\t');
    if (rest.length === 0) continue;
    counts.set(rest.join('\t'), { added: Number(add) || 0, deleted: Number(del) || 0 });
  }
  let added = 0;
  let deleted = 0;
  const rows = parseNameStatus(names.stdout).map((row) => {
    const count = counts.get(row.path) || { added: 0, deleted: 0 };
    added += count.added;
    deleted += count.deleted;
    return Object.assign(row, count);
  });
  return { ok: true, rows, diffLines: added + deleted };
}

/**
 * Every dependency section of a package.json at one ref — dependencies, devDependencies,
 * optionalDependencies and peerDependencies — so a rename is not read as a dependency move.
 */
function manifestSections(repoCwd, ref, rel) {
  const blob = git(['show', `${ref}:${rel}`], repoCwd);
  if (!blob.ok) return null;
  try {
    const parsed = JSON.parse(blob.stdout);
    const wanted = DEPENDENCY_FIELDS.split(' ');
    return JSON.stringify(wanted.map((field) => parsed[field] || {}));
  } catch {
    return null;
  }
}

function dependenciesMoved(repoCwd, base, head, rel) {
  const after = manifestSections(repoCwd, head, rel);
  if (!after) return false;
  return after !== manifestSections(repoCwd, base, rel);
}

/** S-R02 an existing test file lost assertion lines and added none: the checks were weakened. */
function assertionLoss(repoCwd, base, head, rel) {
  const out = git(['diff', '-U0', '--no-color', base, head, '--', rel], repoCwd);
  const loss = { removed: 0, added: 0 };
  if (!out.ok) return loss;
  for (const line of out.stdout.split('\n')) {
    const sign = line[0];
    if (sign !== '-' && sign !== '+') continue;
    if (ASSERTION.test(line.slice(1))) loss[sign === '-' ? 'removed' : 'added'] += 1;
  }
  return loss;
}

/** S-R02 diff drift gate. Returns the first refusal by precedence plus every refusal found. */
function checkDiff(options) {
  const opts = options || {};
  const parsed = parseScope(opts.scope);
  if (!parsed.ok) return parsed;
  const scope = parsed.scope;
  const refs = [opts.base, opts.head];
  const badRef = refs.some((ref) => !isName(ref) || path.isAbsolute(ref));
  if (badRef || !isName(opts.repoCwd)) return refuse('DIFF_INPUT_INVALID');
  const repoCwd = path.resolve(opts.repoCwd);
  const [base, head] = refs.map((ref) => ref.trim());
  const facts = readDiffFacts(repoCwd, base, head);
  if (!facts.ok) return refuse('DIFF_READ_FAILED', { stderr: facts.stderr });

  const { rows, diffLines } = facts;
  const refusals = [];
  const allowed = scope.allowDependencies;
  const movedDeps = (rel) => isManifest(rel) && dependenciesMoved(repoCwd, base, head, rel);
  // A rename is judged on its post-image path, which is the file the Pull Request would carry.
  for (const rel of rows.map((row) => row.path)) {
    if (matchGlobs(scope.forbiddenGlobs, rel)) push('FORBIDDEN_PATH', rel);
    else if (isLock(rel) && !allowed) push('DEPENDENCY_ADDED', rel, 'lockfile');
    else if (!allowed && movedDeps(rel)) push('DEPENDENCY_ADDED', rel, 'manifest');
    else if (!matchGlobs(scope.ownedGlobs, rel)) push('OUT_OF_OWNERSHIP', rel);
  }

  const weakened = [];
  for (const row of rows) {
    if (!isTestFile(row.path) || !matchGlobs(scope.ownedGlobs, row.path)) continue;
    if (!WEAKENABLE.has(row.status)) continue;
    const loss = assertionLoss(repoCwd, base, head, row.path);
    if (loss.removed > 0 && loss.added === 0) {
      weakened.push(row.path);
      refusals.push(Object.assign({ code: 'ASSERTION_WEAKENED', path: row.path }, loss));
    }
  }
  if (diffLines > scope.maxDiffLines) {
    refusals.push({ code: 'DIFF_BUDGET_EXCEEDED', lines: diffLines, max: scope.maxDiffLines });
  }

  const claim = opts.claim && typeof opts.claim === 'object' ? opts.claim : {};
  const status = isName(claim.status) ? claim.status.trim().toUpperCase() : null;
  const reports = [];
  for (const entry of [].concat(opts.testReports || [], claim.evidence || [])) {
    const rel = typeof entry === 'string' ? entry : entry && entry.path;
    // a claimed report that is missing or empty is not evidence
    try {
      if (isName(rel) && fs.statSync(path.resolve(repoCwd, rel)).size > 0) reports.push(rel);
    } catch {}
  }
  if (status === 'SUCCESS' && rows.length === 0 && reports.length === 0) {
    refusals.push({ code: 'NO_EVIDENCE', claim: status });
  }

  if (refusals.length > 0) {
    refusals.sort((a, b) => REFUSAL_ORDER.indexOf(a.code) - REFUSAL_ORDER.indexOf(b.code));
    const refused = { ok: false, refusals, changedFiles: rows, diffLines };
    return Object.assign(refused, refusals[0]);
  }
  const clean = { ok: true, code: 'DIFF_OK', workItemId: scope.workItemId, changedFiles: rows };
  return Object.assign(clean, { diffLines, testsWeakened: weakened, testReports: reports });

  function push(code, rel, reason) {
    const entry = { code, path: rel };
    if (reason) entry.reason = reason;
    refusals.push(entry);
  }
}

function normaliseKind(kind) {
  const key = String(kind).trim().toLowerCase().replace(/[-\s]/g, '_');
  return KIND_ALIAS[key] || key;
}

/** S-R03 every writer action traces to a declared acceptance id, and no writer action owns the branch. */
function checkTrace(actions, scope) {
  const parsed = parseScope(scope);
  if (!parsed.ok) return parsed;
  if (!Array.isArray(actions)) return { ok: false, code: 'SCOPE_INVALID', problems: ['actions'] };
  const declared = new Set(parsed.scope.acceptanceIds);
  const refusals = [];
  const traced = [];
  actions.forEach((action, index) => {
    const raw = action && typeof action === 'object' ? action : {};
    const kind = isName(raw.kind) ? normaliseKind(raw.kind) : null;
    if (!kind) refusals.push({ code: 'UNTRACED_ACTION', index, reason: 'kind-missing' });
    else if (FORBIDDEN_KINDS.has(kind)) refusals.push({ code: 'FORBIDDEN_ACTION', index, kind });
    else if (!declared.has(String(raw.acceptanceId || '').trim())) {
      refusals.push({ code: 'UNTRACED_ACTION', index, kind, acceptanceId: raw.acceptanceId });
    } else traced.push({ index, kind, acceptanceId: String(raw.acceptanceId).trim() });
  });
  if (refusals.length > 0) return Object.assign({ ok: false, refusals, traced }, refusals[0]);
  const ok = { ok: true, code: 'TRACE_OK', workItemId: parsed.scope.workItemId, traced };
  return Object.assign(ok, { actions: actions.length });
}

module.exports = { parseScope, checkDiff, checkTrace, globToRegExp, matchGlobs, normaliseKind };
