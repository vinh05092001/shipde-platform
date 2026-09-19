'use strict';

/**
 * Ship DỮ. — Account and quota entry path (TASK-AI-29).
 *
 * Registering an account used to mean editing ~/.shipde/accounts.registry.json
 * by hand. A hand edit bypasses accounts.validateAccount, so an account with no
 * provider, a tier outside the ladder or — worse — a credential pasted into the
 * readable registry is accepted by the file and only surfaces later, when
 * something reads it. This module is the validated, audited entry path the
 * cockpit form composes:
 *
 *   - every write goes through accounts.addAccount / updateAccount / setSecret,
 *     so the registry keeps one writer and one validator (AI-29-R02);
 *   - an entry is written only when accounts.validateAccount accepts it, and a
 *     refusal names every failing field rather than the first (AI-29-R03);
 *   - a ceiling is written as { value, provenance, assertedAt } and never a bare
 *     number; the provenance this path may assert is `operator-declared` or
 *     `vendor-documented`, never `observed` (AI-29-R05);
 *   - a window the operator leaves undeclared is written as nothing at all, so
 *     limits.resolveLimits reports it unknown rather than filled (AI-29-R06);
 *   - the credential reaches accounts.setSecret and nothing else (AI-29-R04);
 *   - a refusal on any part leaves no registry entry, no limit and no credential
 *     behind (AI-29-R08);
 *   - every write is readable back — the account id, the windows now known, the
 *     windows still unknown, the provenance of each ceiling, and whether a
 *     credential is present — and the credential itself is never printed, not
 *     even masked (AI-29-R09, AI-29-R10);
 *   - nothing here writes a lifecycle state, a register row or anything under
 *     docs/product-spec/ (AI-29-R11).
 *
 * No rule is restated. The registry rule is accounts.validateAccount, the limit
 * rule is limits.resolveLimits and the store is accounts.setSecret / getSecret;
 * this module adds only the composition an operator's entry needs.
 *
 * Exit codes used by the command surface: 0 the entry completed, 1 it was
 * refused or failed and nothing was written, 2 the invocation itself is wrong.
 */

const fs = require('fs');
const path = require('path');

const {
  REGISTRY_FILE,
  validateAccount,
  addAccount,
  updateAccount,
  removeAccount,
  setSecret,
  hasSecret,
  loadRegistry,
} = require('./accounts');
const { PROVENANCE, WINDOWS, resolveLimits } = require('./limits');

/**
 * Provenance this path may assert for a figure it did not measure.
 *
 * `observed` is deliberately absent. It is in limits.PROVENANCE because the
 * resolver can derive it from the ledger, but this path never measures
 * anything, so claiming it would be the exact fabrication AI-29-R05 forbids.
 */
const ENTRY_PROVENANCE = ['operator-declared', 'vendor-documented'];

/** The windows a ceiling can be declared for, re-exported by reference. */
const ENTRY_WINDOWS = WINDOWS;

/**
 * A refusal is not an exception to be caught and ignored: it carries the list of
 * rules that fired, each naming what to fix, and the caller must write nothing.
 */
class EntryRefused extends Error {
  constructor(findings) {
    super(
      'Entry refused: ' + findings.map((finding) => finding.rule + ' ' + finding.detail).join('; ')
    );
    this.name = 'EntryRefused';
    this.findings = findings;
  }
}

function refuse(rule, detail) {
  return new EntryRefused([{ rule, detail }]);
}

/**
 * Every reason the entry path must refuse to write `account`.
 *
 * Two rules compose here and neither is restated: the shipped registry validator
 * (a malformed account, or one carrying a credential field, is refused) and the
 * shipped limit resolution (a declared ceiling with no recognised provenance is
 * refused, naming the account and the window it came from). skipLedger keeps the
 * check independent of any ledger on the machine.
 */
function entryFindings(account) {
  const findings = [];
  for (const detail of validateAccount(account)) {
    findings.push({ rule: 'REGISTRY_VALIDATOR', detail });
  }
  for (const rejected of resolveLimits(account, { skipLedger: true }).rejected) {
    findings.push({
      rule: 'LIMIT_PROVENANCE',
      detail: rejected.accountId + ' ' + rejected.window + ': ' + rejected.reason,
    });
  }
  return findings;
}

/**
 * Parse one ceiling declaration of the form <window>=<value>:<provenance>.
 *
 * The provenance is mandatory. A bare number is refused rather than assumed,
 * because an unattributed figure cannot be checked or withdrawn (AI-29-R05).
 */
function parseLimitSpec(spec) {
  const text = String(spec === undefined || spec === null ? '' : spec).trim();
  const eq = text.indexOf('=');
  if (eq <= 0) {
    throw refuse(
      'LIMIT_FORMAT',
      'a limit must be <window>=<value>:<provenance>, got "' + text + '"'
    );
  }
  const window = text.slice(0, eq).trim();
  const rest = text.slice(eq + 1).trim();
  const colon = rest.lastIndexOf(':');
  if (colon <= 0 || colon === rest.length - 1) {
    throw refuse(
      'LIMIT_PROVENANCE',
      window + ': a ceiling must name its provenance (value:provenance), never a bare number'
    );
  }
  const valueText = rest.slice(0, colon).trim();
  const provenance = rest.slice(colon + 1).trim();

  if (ENTRY_WINDOWS.indexOf(window) === -1) {
    throw refuse('LIMIT_WINDOW', window + ': not one of ' + ENTRY_WINDOWS.join(', '));
  }
  const value = Number(valueText);
  if (!Number.isFinite(value) || value <= 0) {
    throw refuse(
      'LIMIT_VALUE',
      window + ': ceiling must be a positive number, got "' + valueText + '"'
    );
  }
  if (provenance === 'observed') {
    throw refuse(
      'LIMIT_PROVENANCE',
      window + ': this path measures nothing, so it cannot claim "observed"'
    );
  }
  if (ENTRY_PROVENANCE.indexOf(provenance) === -1) {
    throw refuse(
      'LIMIT_PROVENANCE',
      window +
        ': provenance must be one of ' +
        ENTRY_PROVENANCE.join(', ') +
        ', got "' +
        provenance +
        '"'
    );
  }
  return { window, value, provenance };
}

/**
 * The `limits` object a declaration list produces.
 *
 * Only the windows named appear. Everything else is absent, which is how a
 * window the operator left undeclared stays unknown instead of being defaulted
 * to zero or to another account's median (AI-29-R06).
 */
function buildLimits(specs, now) {
  const assertedAt = Number(now) || Date.now();
  const limits = {};
  for (const spec of specs || []) {
    const parsed = parseLimitSpec(spec);
    limits[parsed.window] = {
      value: parsed.value,
      provenance: parsed.provenance,
      assertedAt,
    };
  }
  return limits;
}

/** The account object an `add` invocation describes, before validation. */
function composeAccount(fields) {
  const input = fields || {};
  const account = {};
  if (input.id !== undefined) account.id = String(input.id);
  if (input.provider !== undefined) account.provider = String(input.provider);
  if (input.model !== undefined) account.model = String(input.model);
  if (input.models !== undefined) {
    account.models = String(input.models)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ model: name }));
  }
  const capabilities = {};
  if (input.contextWindow !== undefined) capabilities.contextWindow = Number(input.contextWindow);
  if (input.tools === true) capabilities.tools = true;
  if (input.jsonSchema === true) capabilities.jsonSchema = true;
  if (Object.keys(capabilities).length > 0) account.capabilities = capabilities;
  if (input.tier !== undefined) account.tier = Number(input.tier);
  if (input.launch !== undefined) account.launch = input.launch;
  if (input.cost !== undefined) account.cost = input.cost;
  account.limits = buildLimits(input.limit || []);
  return account;
}

function prepareAdd(fields) {
  const account = composeAccount(fields);
  const findings = entryFindings(account);
  if (findings.length > 0) throw new EntryRefused(findings);
  return account;
}

/** The registry text a reader would see, or an empty string when there is none. */
function readRegistryText(options) {
  const file = (options && options.registryFile) || REGISTRY_FILE;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return '';
  }
}

/**
 * Whether a registry document exposes `credential` as readable text.
 *
 * The registry is a plain, diffable, dashboard-readable file by design, so a
 * credential inside it is readable by anything that can read the file. The
 * credential belongs in accounts.secrets.enc, written through setSecret.
 */
function registryExposesCredential(registryText, credential) {
  const needle = String(credential === undefined || credential === null ? '' : credential);
  if (needle === '') return false;
  return String(registryText).includes(needle);
}

function assertCredentialFree(credential, options) {
  if (credential === undefined || credential === null) return;
  if (registryExposesCredential(readRegistryText(options), credential)) {
    throw refuse('CREDENTIAL_IN_REGISTRY', 'accounts.registry.json');
  }
}

/**
 * The readback every write prints: what is registered, what is known and what
 * is not, and whether a credential is present. The credential value never
 * appears here in any form (AI-29-R09).
 */
function readback(account, options) {
  const resolved = resolveLimits(account, { skipLedger: true });
  const known = [];
  const unknown = [];
  for (const window of ENTRY_WINDOWS) {
    const resolvedWindow = resolved.windows[window];
    if (resolvedWindow && resolvedWindow.unknownBudget === false) {
      known.push({
        window,
        ceiling: resolvedWindow.ceiling,
        provenance: resolvedWindow.provenance,
        assertedAt: resolvedWindow.assertedAt,
      });
    } else {
      unknown.push(window);
    }
  }
  return {
    accountId: (account && account.id) || null,
    hasSecret: Boolean(account && account.id && hasSecret(account.id, options)),
    known,
    unknown,
    rejected: resolved.rejected,
  };
}

/**
 * Write one account, and its credential when one was supplied, through the
 * shipped modules only.
 *
 * Everything is validated before the first byte is written, so a refusal leaves
 * nothing behind. The two failure points that can still follow the first write —
 * a credential the store refuses, or a registry that somehow carries it — are
 * undone through the registry's own writer, because a half-registered account
 * reads as usable and is not (AI-29-R08).
 */
function applyAdd(fields, options, credential) {
  const account = prepareAdd(fields);
  if (loadRegistry(options).some((candidate) => candidate.id === account.id)) {
    throw refuse('DUPLICATE_ID', account.id);
  }
  const saved = addAccount(account, options);
  if (credential !== undefined && credential !== null) {
    try {
      setSecret(saved.id, credential, options);
    } catch (error) {
      removeAccount(saved.id, options);
      throw error;
    }
  }
  try {
    assertCredentialFree(credential, options);
  } catch (error) {
    removeAccount(saved.id, options);
    throw error;
  }
  return readback(saved, options);
}

/**
 * Set ceilings on an existing entry through accounts.updateAccount.
 *
 * Only the windows named are touched; a window named earlier keeps its declared
 * ceiling and a window never named stays unknown. The credential, when supplied,
 * is stored through setSecret after the limit write; if that refuses, the limit
 * write is undone so the two do not disagree.
 */
function applyLimits(id, limitSpecs, options, credential) {
  const current = loadRegistry(options).find((candidate) => candidate.id === id);
  if (!current) throw refuse('UNKNOWN_ACCOUNT', String(id === undefined ? '' : id));

  const limits = Object.assign({}, current.limits || {}, buildLimits(limitSpecs || []));
  const findings = entryFindings(Object.assign({}, current, { limits }));
  if (findings.length > 0) throw new EntryRefused(findings);

  const previousLimits = current.limits || {};
  const updated = updateAccount(id, { limits }, options);
  if (credential !== undefined && credential !== null) {
    try {
      setSecret(id, credential, options);
    } catch (error) {
      updateAccount(id, { limits: previousLimits }, options);
      throw error;
    }
  }
  try {
    assertCredentialFree(credential, options);
  } catch (error) {
    updateAccount(id, { limits: previousLimits }, options);
    throw error;
  }
  return readback(updated, options);
}

/** Store a credential for an existing entry through accounts.setSecret. */
function applySecret(id, credential, options) {
  const current = loadRegistry(options).find((candidate) => candidate.id === id);
  if (!current) throw refuse('UNKNOWN_ACCOUNT', String(id === undefined ? '' : id));
  if (typeof credential !== 'string' || credential.length === 0) {
    throw refuse('CREDENTIAL_MISSING', 'no credential was supplied');
  }
  setSecret(id, credential, options);
  assertCredentialFree(credential, options);
  return readback(current, options);
}

/** The machine-readable form of a readback, for the cockpit's Applied state. */
function readbackJson(result) {
  return JSON.stringify(
    {
      accountId: result.accountId,
      hasSecret: result.hasSecret,
      knownWindows: result.known,
      unknownWindows: result.unknown,
      rejected: result.rejected,
    },
    null,
    2
  );
}

/** The readback as an operator reads it. The credential is never included. */
function formatReadback(result) {
  const lines = [];
  lines.push('Tài khoản: ' + result.accountId);
  lines.push(
    'Mật khẩu: ' +
      (result.hasSecret
        ? 'đã lưu (mã hoá trong accounts.secrets.enc)'
        : 'CHƯA có — tài khoản chưa thể xác thực')
  );
  if (result.known.length === 0) {
    lines.push('Cửa sổ đã biết: (không có)');
  } else {
    lines.push('Cửa sổ đã biết:');
    for (const window of result.known) {
      lines.push(
        '  - ' +
          window.window +
          ' = ' +
          window.ceiling +
          ' (' +
          window.provenance +
          (window.assertedAt ? ', assertedAt ' + new Date(window.assertedAt).toISOString() : '') +
          ')'
      );
    }
  }
  lines.push(
    result.unknown.length === 0
      ? 'Cửa sổ còn chưa biết: (không)'
      : 'Cửa sổ còn CHƯA biết: ' + result.unknown.join(', ')
  );
  return lines.join('\n');
}

/* -------------------------------------------------------------------------
 * Command surface: `node tools/ai-brain/cli.js account add|limits|secret`
 * ---------------------------------------------------------------------- */

const CANONICAL_KEYS = {
  'context-window': 'contextWindow',
  contextWindow: 'contextWindow',
  'json-schema': 'jsonSchema',
  jsonSchema: 'jsonSchema',
  'key-file': 'keyFile',
  keyFile: 'keyFile',
  'credential-file': 'credentialFile',
  credentialFile: 'credentialFile',
  'credential-fd': 'credentialFd',
  credentialFd: 'credentialFd',
  id: 'id',
  provider: 'provider',
  model: 'model',
  models: 'models',
  tier: 'tier',
  limit: 'limit',
  registry: 'registry',
  secrets: 'secrets',
  json: 'json',
  tools: 'tools',
};

const BOOLEAN_KEYS = new Set(['json', 'tools', 'jsonSchema']);
const REPEATABLE_KEYS = new Set(['limit']);

const ADD_KEYS = new Set([
  'id',
  'provider',
  'model',
  'models',
  'contextWindow',
  'tier',
  'limit',
  'registry',
  'secrets',
  'keyFile',
  'credentialFile',
  'credentialFd',
  'json',
  'tools',
  'jsonSchema',
]);
const LIMITS_KEYS = new Set([
  'id',
  'limit',
  'registry',
  'secrets',
  'keyFile',
  'credentialFile',
  'credentialFd',
  'json',
]);
const SECRET_KEYS = new Set([
  'id',
  'registry',
  'secrets',
  'keyFile',
  'credentialFile',
  'credentialFd',
  'json',
]);

/**
 * Parse the options of one sub-command, refusing anything unrecognised.
 *
 * A typo must not operate on a different account, window or provider than the
 * one the operator named, so an unknown option is a refusal rather than a
 * silently ignored token (AI-29-R07), following the reconcile sub-command.
 */
function parseOptions(argv, allowed) {
  const args = { _: [], limit: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const rawKey = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const key = CANONICAL_KEYS[rawKey];
    if (!key || !allowed.has(key)) {
      throw refuse('UNKNOWN_OPTION', '--' + rawKey);
    }
    if (BOOLEAN_KEYS.has(key)) {
      if (eq !== -1) throw refuse('UNKNOWN_OPTION', '--' + rawKey + ' does not take a value');
      args[key] = true;
      continue;
    }
    let value;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw refuse('MISSING_VALUE', '--' + rawKey);
      }
      value = next;
      i += 1;
    }
    if (REPEATABLE_KEYS.has(key)) args[key].push(value);
    else args[key] = value;
  }
  return args;
}

function storeOptions(args) {
  const options = {};
  if (args.registry !== undefined) options.registryFile = path.resolve(String(args.registry));
  if (args.secrets !== undefined) options.secretsFile = path.resolve(String(args.secrets));
  if (args.keyFile !== undefined) options.keyFile = path.resolve(String(args.keyFile));
  return options;
}

/**
 * Read a credential from a file descriptor or a file — never from an argument,
 * so it does not land in the shell history or a process listing.
 */
function readCredential(args) {
  if (args.credentialFile !== undefined) {
    return fs.readFileSync(path.resolve(String(args.credentialFile)), 'utf8').replace(/\r?\n$/, '');
  }
  const fd = args.credentialFd === undefined ? 0 : Number(args.credentialFd);
  if (!Number.isInteger(fd) || fd < 0) {
    throw refuse('CREDENTIAL_SOURCE', '--credential-fd must be a non-negative file descriptor');
  }
  return fs.readFileSync(fd, 'utf8').replace(/\r?\n$/, '');
}

function wantsCredential(args) {
  return args.credentialFile !== undefined || args.credentialFd !== undefined;
}

function requireNoPositional(args) {
  if (args._.length > 0) throw refuse('UNEXPECTED_ARGUMENT', args._.join(' '));
}

function printResult(result, args, io) {
  if (args.json) {
    io.out(readbackJson(result));
    return;
  }
  io.out(formatReadback(result));
}

function cliAdd(argv, io) {
  const args = parseOptions(argv, ADD_KEYS);
  requireNoPositional(args);
  const options = storeOptions(args);
  const credential = wantsCredential(args) ? readCredential(args) : undefined;
  const result = applyAdd(Object.assign({ limit: args.limit }, args), options, credential);
  io.out('Đã ghi tài khoản: ' + result.accountId);
  printResult(result, args, io);
}

function cliLimits(argv, io) {
  const args = parseOptions(argv, LIMITS_KEYS);
  requireNoPositional(args);
  if (args.id === undefined) throw refuse('MISSING_VALUE', '--id');
  const options = storeOptions(args);
  const credential = wantsCredential(args) ? readCredential(args) : undefined;
  const result = applyLimits(args.id, args.limit, options, credential);
  io.out('Đã cập nhật hạn mức cho tài khoản: ' + result.accountId);
  printResult(result, args, io);
}

function cliSecret(argv, io) {
  const args = parseOptions(argv, SECRET_KEYS);
  requireNoPositional(args);
  if (args.id === undefined) throw refuse('MISSING_VALUE', '--id');
  const options = storeOptions(args);
  // Required here, so a missing source reads fd 0: a prompt or a pipe, never an
  // argument.
  const credential = readCredential(args);
  const result = applySecret(args.id, credential, options);
  io.out('Đã lưu mật khẩu cho tài khoản: ' + result.accountId);
  printResult(result, args, io);
}

/**
 * Run one `account` invocation. `io` defaults to the process streams and may be
 * injected so the entry path can be exercised without touching them.
 */
function runAccountCli(argv, io) {
  const sink = io || {};
  const out = sink.out || ((line) => process.stdout.write(line + '\n'));
  const err = sink.err || ((line) => process.stderr.write(line + '\n'));
  const target = { out, err };

  const rest = (argv || []).slice();
  const sub = rest.shift();

  try {
    if (sub === 'add') {
      cliAdd(rest, target);
      return 0;
    }
    if (sub === 'limits') {
      cliLimits(rest, target);
      return 0;
    }
    if (sub === 'secret') {
      cliSecret(rest, target);
      return 0;
    }
    err('Lệnh không rõ: account ' + (sub === undefined ? '' : sub));
    err('Dùng: account add | account limits | account secret');
    return 2;
  } catch (error) {
    if (error && error.name === 'EntryRefused') {
      for (const finding of error.findings) {
        err('TỪ CHỐI: ' + finding.rule + ' ' + finding.detail);
      }
      err('Không có gì được ghi.');
      return 1;
    }
    err('LỖI: ' + (error && error.message ? error.message : String(error)));
    return 1;
  }
}

module.exports = {
  ENTRY_PROVENANCE,
  ENTRY_WINDOWS,
  PROVENANCE,
  EntryRefused,
  entryFindings,
  parseLimitSpec,
  buildLimits,
  composeAccount,
  prepareAdd,
  registryExposesCredential,
  readback,
  readbackJson,
  formatReadback,
  applyAdd,
  applyLimits,
  applySecret,
  runAccountCli,
};
