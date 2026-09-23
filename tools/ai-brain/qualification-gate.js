'use strict';
// TASK-AI-31 — Qualification gate: reads probe results and writes qualifiedRoles.
//
// This module is the only place that grants a role into account.qualifiedRoles
// from probe evidence. It never removes a role (that is TASK-AI-25), never
// writes grade/quality/cost/capabilities, and never touches credentials.
//
// The grant rule is imported from acceptance/lib/qualification-gate.js and
// re-exported by reference so acceptance scripts and this module share one copy.

const { listRoles } = require('./capabilities');
const { loadResults, recordKey } = require('./qualification');
const { loadRegistry, updateAccount } = require('./accounts');
const {
  gateRuleFindings,
  grantCredentialFindings,
  GRANT_SOURCE,
  GRANT_CACHE_WINDOW_MS,
  GRANT_WRITTEN_FIELDS,
  GRANT_ENTRY_REQUIRED_FIELDS,
} = require('./acceptance/lib/qualification-gate');

const grantRule = require('./acceptance/lib/qualification-gate');

// --- Error codes ---------------------------------------------------------

const RESULT_MISSING = 'RESULT_MISSING';
const RESULT_STALE = 'RESULT_STALE';
const RESULT_CORRUPT = 'RESULT_CORRUPT';
const NOT_QUALIFIED = 'NOT_QUALIFIED';
const ALREADY_QUALIFIED = 'ALREADY_QUALIFIED';
const QUALIFIED = 'QUALIFIED';
const CREDENTIAL_IN_GRANT = 'CREDENTIAL_IN_GRANT';

// --- Default persistence -------------------------------------------------

function defaultLoadAccount(accountId, options) {
  const accounts = loadRegistry(options);
  return accounts.find((a) => a.id === accountId) || null;
}

function defaultUpdateAccount(accountId, patch, options) {
  return updateAccount(accountId, patch, options);
}

// --- Core grant logic ----------------------------------------------------

/**
 * Evaluate whether a probe result justifies granting `roleId`.
 *
 * Returns `{ status, roleId, accountId, model, entry?, reason? }`.
 * `deps` is injectable for tests: { loadResults, now, file, roles }
 */
function evaluateGrant({ accountId, model, roleId, deps }) {
  const d = deps || {};
  const now = typeof d.now === 'function' ? d.now() : Date.now();
  const file = d.file || require('./qualification').RESULT_PATH;

  const validRoles = d.roles || listRoles();
  if (!roleId || !validRoles.includes(roleId)) {
    return {
      status: NOT_QUALIFIED,
      roleId,
      accountId,
      model,
      reason: 'unknown role: ' + roleId,
    };
  }

  let results;
  try {
    results = (d.loadResults || loadResults)(file);
  } catch (err) {
    const code = err && err.code;
    if (code === 'RESULT_UNREADABLE' || code === 'RESULT_CORRUPT') {
      return { status: RESULT_CORRUPT, roleId, accountId, model, reason: err.message };
    }
    return { status: RESULT_MISSING, roleId, accountId, model, reason: err.message };
  }

  const key = recordKey(accountId, model);
  const record = results && results[key];

  if (!record) {
    return {
      status: RESULT_MISSING,
      roleId,
      accountId,
      model,
      reason: 'no probe result found — run probe first',
    };
  }

  // AI-31-R05: staleness check.
  const age = now - record.instant;
  if (age > GRANT_CACHE_WINDOW_MS) {
    return {
      status: RESULT_STALE,
      roleId,
      accountId,
      model,
      reason: 'result is ' + age + 'ms old, re-probe required',
      age,
    };
  }

  // AI-31-R01: outcome must be pass.
  if (record.outcome !== 'pass') {
    return {
      status: NOT_QUALIFIED,
      roleId,
      accountId,
      model,
      reason: 'probe outcome was ' + record.outcome,
      outcome: record.outcome,
    };
  }

  // AI-31-R04: build the entry.
  const entry = {
    roleId,
    grantedAt: now,
    source: GRANT_SOURCE,
    probeOutcome: 'pass',
  };

  // AI-31-R06: validate via single-source rule.
  const findings = gateRuleFindings({
    outcome: record.outcome,
    resultInstant: record.instant,
    now,
    roleId,
    entry,
    writtenFields: Array.from(GRANT_WRITTEN_FIELDS),
    removesRole: false,
    knownRoles: validRoles,
  });
  if (findings.length > 0) {
    return { status: NOT_QUALIFIED, roleId, accountId, model, reason: findings[0] };
  }

  // AI-31-R09: no credentials in grant entry.
  const credFindings = grantCredentialFindings(entry);
  if (credFindings.length > 0) {
    return { status: CREDENTIAL_IN_GRANT, roleId, accountId, model, reason: credFindings[0] };
  }

  return { status: QUALIFIED, roleId, accountId, model, entry };
}

/**
 * Apply a grant to an account object (pure — does not write to disk).
 * Returns a new account object with qualifiedRoles and qualificationHistory
 * updated. Never removes roles (AI-31-R03). Never writes forbidden fields
 * (AI-31-R02).
 */
function applyGrant(account, entry) {
  const qualifiedRoles = Array.isArray(account.qualifiedRoles)
    ? account.qualifiedRoles.slice()
    : [];
  const qualificationHistory = Array.isArray(account.qualificationHistory)
    ? account.qualificationHistory.slice()
    : [];

  if (!qualifiedRoles.includes(entry.roleId)) {
    qualifiedRoles.push(entry.roleId);
  }

  const histIdx = qualificationHistory.findIndex((h) => h.roleId === entry.roleId);
  const histEntry = Object.assign({}, entry);
  if (histIdx >= 0) {
    qualificationHistory[histIdx] = histEntry;
  } else {
    qualificationHistory.push(histEntry);
  }

  return Object.assign({}, account, { qualifiedRoles, qualificationHistory });
}

/**
 * Run the qualification gate for one account, one or all roles.
 *
 * opts: { accountId, model, roleId?, deps? }
 *   deps: { loadResults, loadAccount, updateAccount, now, file, roles }
 *
 * Returns an array of grant result objects, one per evaluated role.
 */
function runGate({ accountId, model, roleId, deps }) {
  const d = deps || {};
  const roles = d.roles || (roleId ? [roleId] : listRoles());
  const registryOptions = d.registryFile ? { registryFile: d.registryFile } : undefined;
  const loadAccount = d.loadAccount || ((id) => defaultLoadAccount(id, registryOptions));
  const updateAccountFn =
    d.updateAccount || ((id, patch) => defaultUpdateAccount(id, patch, registryOptions));

  const results = [];
  for (const rid of roles) {
    const evaluation = evaluateGrant({ accountId, model, roleId: rid, deps: d });
    if (evaluation.status === QUALIFIED) {
      const account = loadAccount(accountId) || { id: accountId };
      const already = Array.isArray(account.qualifiedRoles) && account.qualifiedRoles.includes(rid);
      if (already) {
        results.push(Object.assign({}, evaluation, { status: ALREADY_QUALIFIED }));
      } else {
        const updated = applyGrant(account, evaluation.entry);
        updateAccountFn(accountId, updated);
        results.push(evaluation);
      }
    } else {
      results.push(evaluation);
    }
  }
  return results;
}

// --- Public surface ------------------------------------------------------

module.exports = {
  evaluateGrant,
  applyGrant,
  runGate,
  defaultLoadAccount,
  defaultUpdateAccount,
  RESULT_MISSING,
  RESULT_STALE,
  RESULT_CORRUPT,
  NOT_QUALIFIED,
  ALREADY_QUALIFIED,
  QUALIFIED,
  CREDENTIAL_IN_GRANT,
  // Re-exported rule (AI-31-R06: single source)
  grantRule,
  GRANT_CACHE_WINDOW_MS,
  GRANT_WRITTEN_FIELDS,
  GRANT_ENTRY_REQUIRED_FIELDS,
  GRANT_SOURCE,
  runQualifyCli,
};

// --- CLI -----------------------------------------------------------------

const QUALIFY_FLAGS = new Set(['account', 'model', 'role', 'json', 'file']);

function parseQualifyArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(token);
  }
  return out;
}

async function runQualifyCli(argv, deps) {
  const sink = deps || {};
  const out = sink.out || ((line) => process.stdout.write(line + '\n'));
  const err = sink.err || ((line) => process.stderr.write(line + '\n'));

  const args = parseQualifyArgs(argv);
  const unknown = Object.keys(args).filter((k) => k !== '_' && !QUALIFY_FLAGS.has(k));
  if (unknown.length > 0 || args._.length > 0) {
    err('Tuỳ chọn không nhận ra: ' + (unknown[0] ? '--' + unknown[0] : args._.join(' ')));
    err('Dùng: qualify --account <id> --model <model> [--role <roleId>] [--json] [--file <path>]');
    return 2;
  }
  if (!args.account || typeof args.account !== 'string') {
    err('--account là bắt buộc');
    err('Dùng: qualify --account <id> --model <model> [--role <roleId>] [--json] [--file <path>]');
    return 2;
  }
  if (!args.model || typeof args.model !== 'string') {
    err('--model là bắt buộc');
    err('Dùng: qualify --account <id> --model <model> [--role <roleId>] [--json] [--file <path>]');
    return 2;
  }

  const results = runGate({
    accountId: args.account,
    model: args.model,
    roleId: args.role,
    deps: Object.assign({}, sink, { file: args.file || sink.file }),
  });

  if (args.json) {
    out(JSON.stringify(results, null, 2));
    return 0;
  }

  for (const r of results) {
    if (r.status === QUALIFIED) {
      out(
        'QUALIFIED: ' +
          r.accountId +
          ' ' +
          r.model +
          ' → ' +
          r.roleId +
          ' (granted at ' +
          new Date(r.entry.grantedAt).toISOString() +
          ')'
      );
    } else if (r.status === ALREADY_QUALIFIED) {
      out('ALREADY_QUALIFIED: ' + r.accountId + ' ' + r.model + ' → ' + r.roleId + ' (idempotent)');
    } else if (r.status === RESULT_MISSING) {
      out('RESULT_MISSING: ' + r.accountId + ' ' + r.model + ' — run probe first');
    } else if (r.status === RESULT_STALE) {
      out(
        'RESULT_STALE: ' +
          r.accountId +
          ' ' +
          r.model +
          ' — result is ' +
          (r.age || '?') +
          'ms old, re-probe required'
      );
    } else if (r.status === NOT_QUALIFIED) {
      out(
        'NOT_QUALIFIED: ' +
          r.accountId +
          ' ' +
          r.model +
          ' → ' +
          r.roleId +
          ' — probe outcome was ' +
          (r.outcome || r.reason)
      );
    } else {
      out(
        r.status +
          ': ' +
          r.accountId +
          ' ' +
          r.model +
          ' → ' +
          r.roleId +
          (r.reason ? ' — ' + r.reason : '')
      );
    }
  }
  return 0;
}
