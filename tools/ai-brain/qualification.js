'use strict';
// TASK-AI-30 — the qualification result record and the recorded probe.
//
// Mirrors how ceiling.js declares LEDGER_FILE: a stable, injectable path
// for the record this Work Item writes, so a later item (TASK-AI-31) can
// read it without this item touching capabilities.js, accounts.js or
// offerings.js — none of which is in Allowed paths.
//
// The probe here is the register key behaviour made real (`AI-30-R01`..`AI-30-R07`):
// a bounded, cheapest-model, cache-reusing real request through the
// account's own launch path, whose outcome lands in the record below. It
// never grants qualification and never writes qualifiedRoles, grades or
// quality — promotion is TASK-AI-31.
const path = require('path');
const { spawn } = require('child_process');

const RESULT_DIR =
  process.env.QUALIFICATION_RESULT_DIR ||
  path.join(require('os').homedir(), '.shipde', 'qualification-results');
const RESULT_PATH = path.join(RESULT_DIR, 'results.json');

const OUTCOMES = new Set(['pass', 'fail', 'timeout', 'refused']);

/** Required fields for a qualification result record. */
const REQUIRED_FIELDS = ['accountId', 'model', 'instant', 'outcome', 'latencyMs', 'reason'];

/** The bounded-probe defaults (`AI-30-R02`). */
const DEFAULT_PROBE_TIMEOUT_MS = 60 * 1000;
const DEFAULT_CACHE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Every way `result` fails the qualification-record shape contract.
 * Empty means the record is well-formed enough to be stored and read.
 */
function validateResultShape(result) {
  const findings = [];
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    findings.push('RESULT_SHAPE: result is not a plain object');
    return findings;
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in result)) {
      findings.push(`RESULT_SHAPE: missing field ${field}`);
    }
  }
  if ('outcome' in result && !OUTCOMES.has(result.outcome)) {
    findings.push(`RESULT_SHAPE: unknown outcome ${result.outcome}`);
  }
  // A record's latency is a measurement, or it is absent for a stated cause
  // (review finding N2). A verdict reused from the cache measured nothing this
  // time, so it reports `null` together with the `cached` marker instead of a
  // fabricated `0` that reads like a real, impossibly fast probe.
  if ('latencyMs' in result) {
    if (result.cached === true) {
      if (result.latencyMs !== null) {
        findings.push(
          'RESULT_SHAPE: a reused verdict must report latencyMs null, not a measurement'
        );
      }
    } else if (!Number.isFinite(result.latencyMs) || result.latencyMs < 0) {
      findings.push('RESULT_SHAPE: latencyMs is not a measured non-negative number');
    }
  }
  return findings;
}

/**
 * A stable key for one account/model pair. The result record is keyed by
 * account id and model (`AI-30-R07`), so the cache question "has this exact
 * offering been probed inside the window?" is a lookup, not a scan.
 */
function recordKey(accountId, model) {
  return String(accountId) + '@' + String(model);
}

/**
 * Loads the result record, tolerating absence and corruption where absence
 * is the only survivable case.
 *
 * A missing file is an empty record: the pipeline ran without this file
 * before it existed and must still run, mirroring quota-store's loadStore. A
 * directory at the path, a corrupt file or a non-object document is thrown as
 * `RESULT_UNREADABLE` / `RESULT_CORRUPT`, never swallowed into a silent "no
 * cache" — reporting those as an empty cache would let an unbounded re-probe
 * look like a first probe.
 */
function loadResults(file, io) {
  const sink = io || {};
  let text;
  try {
    text = (sink.fs || require('fs')).readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    throw Object.assign(new Error('RESULT_UNREADABLE: ' + e.message), {
      code: 'RESULT_UNREADABLE',
    });
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    throw Object.assign(new Error('RESULT_CORRUPT: ' + e.message), {
      code: 'RESULT_CORRUPT',
    });
  }
}

/**
 * Writes one outcome into the record file. Returns the shape-validated record
 * that was written, so a caller can prove the write happened and carried only
 * the declared fields. A record that fails the shape contract is never
 * written: an outcome that cannot be read back cleanly is not evidence.
 */
function saveResult(record, file, io) {
  const shape = validateResultShape(record);
  if (shape.length > 0) {
    throw Object.assign(new Error('RESULT_SHAPE: refused to write an invalid record'), {
      code: 'RESULT_SHAPE',
      findings: shape,
    });
  }
  const sink = io || {};
  const fsMod = sink.fs || require('fs');
  const fileIo = sink.fileIo || fsMod;
  const store = loadResults(file, io);
  store[recordKey(record.accountId, record.model)] = record;
  fsMod.mkdirSync(path.dirname(file), { recursive: true });
  fileIo.writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
  return record;
}

/**
 * The verdict a repeat probe inside the cache window must reuse.
 *
 * Any cached verdict — including `timeout` and `fail` — is reused:
 * `AI-30-R04` says a timeout is cached like any other outcome, and the
 * 2026-09-14 pool drain is exactly what an eager re-probe causes. Past the
 * window the verdict is history, not standing, and the answer is `probe`
 * again: the next attempt re-runs the real client rather than assuming the
 * earlier timeout was transient. That is the whole reconciliation rule;
 * there is no same-window blind retry.
 */
function cachedVerdict(store, accountId, model, options) {
  const opts = options || {};
  const entry = (store || {})[recordKey(accountId, model)];
  if (!entry) return { action: 'probe' };
  const windowMs = opts.cacheWindowMs === undefined ? DEFAULT_CACHE_WINDOW_MS : opts.cacheWindowMs;
  const now = opts.now || Date.now();
  const taken = Date.parse(entry.instant);
  if (!Number.isFinite(taken) || now - taken >= windowMs) {
    return { action: 'probe', expired: true };
  }
  return { action: 'reuse', outcome: entry.outcome, instant: entry.instant };
}

/**
 * Cheapest-model selection, moved from doctor.ps1 into the recorded path.
 *
 * The probe still costs one real request, so it asks for the account's own
 * cheapest declared model rather than a hand-picked one: a handful of doctor
 * runs on 2026-09-14 took a budget pool from working to HTTP 402. Cost is
 * compared per million tokens on input+output, with a deterministic
 * alphabetical tiebreak so the chosen model never depends on object order.
 * An account that declares no costs names its cheapest by declaration order.
 */
function cheapestModel(account) {
  const models = (account && account.models) || [];
  if (models.length === 0) return null;
  const cost = (m) => Number((m.cost && m.cost.inputPerMillion + m.cost.outputPerMillion) || 0);
  let best = models[0];
  for (const m of models.slice(1)) {
    const a = cost(best);
    const b = cost(m);
    if (b < a || (b === a && m.model < best.model)) best = m;
  }
  return best.model;
}

/**
 * Builds the real client command line for one probe, from the account's own
 * launch declaration (`AI-30-R01`).
 *
 * No hand-built request. `seed-accounts.js` records how each account is
 * reached, and the `<prompt>` / `<model>` placeholders in that declaration
 * are filled in here — the client itself carries the credential and its own
 * headers, which is what lets a refusal mean "this credential was refused"
 * rather than "this hand-built request was malformed". The three launch kinds
 * the registry declares are covered: `cli` (host command), `docker-compose`
 * (the recorded container command, run through compose in the recorded
 * directory and service) and `openai-compatible` (curl against the gateway's
 * /v1/chat/completions with `max_tokens: 1`, so a one-token answer is all the
 * budget that is asked for). Anything else is refused, not guessed.
 */
function probeCommand(account, model, probeText) {
  const launch = account && account.launch;
  if (!launch) {
    throw Object.assign(new Error('PROBE_LAUNCH_MISSING'), {
      code: 'PROBE_LAUNCH_MISSING',
    });
  }
  if (launch.kind === 'cli') {
    return String(launch.command).replace('<prompt>', probeText).replace('<model>', model);
  }
  if (launch.kind === 'docker-compose') {
    const inner = String(launch.command).replace('<prompt>', probeText).replace('<model>', model);
    const composeFile = launch.dir
      ? launch.dir.replace(/[\\/]+$/, '') + '/docker-compose.yml'
      : 'docker-compose.yml';
    return (
      'docker compose -f "' +
      composeFile +
      '" run --rm ' +
      String(launch.service || '') +
      ' ' +
      inner
    );
  }
  if (launch.kind === 'openai-compatible') {
    const url = String(launch.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
    const body = JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: probeText }],
    });
    return (
      'curl -sS -X POST "' +
      url +
      '" -H "Content-Type: application/json" -d "' +
      body.replace(/"/g, '\\"') +
      '"'
    );
  }
  throw Object.assign(new Error('PROBE_LAUNCH_UNKNOWN: ' + launch.kind), {
    code: 'PROBE_LAUNCH_UNKNOWN',
  });
}

/**
 * The bounded process runner (`AI-30-R02`).
 *
 * `spawn` is injectable: the unit tests pass a double, the CLI passes this
 * default, which spawns the shell command, enforces the timeout, and on
 * timeout kills the whole Windows process tree via taskkill /T before giving
 * up — killing only the wrapper can leave the detached agent process running,
 * which is the failure mode doctor.ps1's taskkill /T /F exists for. Stdio is
 * captured and never echoed: full probe output is not logged or stored
 * (`AI-30-R05`); only a bounded reason slice reaches the record.
 */
function runBounded(command, options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_PROBE_TIMEOUT_MS : opts.timeoutMs;
  const spawnFn = opts.spawn || spawn;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let treeKilled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawnFn(command, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      finish({ outcome: 'refused', treeKilled, reason: String(e.message || e).slice(0, 160) });
      return;
    }
    let stdout = '';
    let stderr = '';
    if (child.stdout)
      child.stdout.on('data', (d) => {
        stdout += d;
      });
    if (child.stderr)
      child.stderr.on('data', (d) => {
        stderr += d;
      });
    child.on('error', (e) =>
      finish({ outcome: 'refused', treeKilled, reason: String(e.message || e).slice(0, 160) })
    );
    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        finish({ outcome: 'timeout', treeKilled, reason: 'probe exceeded its timeout' });
        return;
      }
      if (code === 0) finish({ outcome: 'pass', treeKilled, reason: 'answered' });
      else
        finish({
          outcome: 'fail',
          treeKilled,
          reason: ('exit code ' + code + ': ' + String(stderr || stdout || '')).slice(0, 160),
        });
    });
    timer = setTimeout(() => {
      if (opts.treeKill === false) {
        treeKilled = false;
        try {
          child.kill();
        } catch (e) {
          /* already dead */
        }
        finish({ outcome: 'timeout', treeKilled, reason: 'probe exceeded its timeout' });
        return;
      }
      treeKilled = true;
      if (process.platform === 'win32') {
        // Stop the wrapper and every process it spawned.
        const { execFile } = require('child_process');
        execFile(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => {
            try {
              child.kill();
            } catch (e) {
              /* already dead */
            }
            finish({ outcome: 'timeout', treeKilled, reason: 'probe exceeded its timeout' });
          }
        );
        return;
      }
      try {
        child.kill('SIGKILL');
      } catch (e) {
        /* already dead */
      }
      finish({ outcome: 'timeout', treeKilled, reason: 'probe exceeded its timeout' });
    }, timeoutMs);
  });
}

/**
 * Refuses a record that breaks the declared shape, the same way `saveResult`
 * refuses to write one: a caller that returns a record without storing it (the
 * reused-verdict path below) still owes the shape contract.
 */
function assertRecordShape(record) {
  const shape = validateResultShape(record);
  if (shape.length > 0) {
    throw Object.assign(new Error('RESULT_SHAPE: internal record refused: ' + shape.join('; ')), {
      code: 'RESULT_SHAPE',
      findings: shape,
    });
  }
  return record;
}

/**
 * The shape-validated record one probe produces. Internal, so every caller
 * of saveResult writes exactly the declared fields and nothing else.
 */
function buildRecord(accountId, model, outcome, latencyMs, reason, now) {
  return assertRecordShape({
    accountId,
    model,
    instant: new Date(now).toISOString(),
    outcome,
    latencyMs,
    reason,
  });
}

/**
 * The one bounded, recorded probe (`AI-30-R01`..`AI-30-R07`), end to end.
 *
 * Refusals (unknown account, unsupported provider, entry not admitted, no
 * model) return an outcome `refused` with a reason naming which rule fired —
 * they are recorded outcomes, not exceptions, because a refusal an operator
 * cannot read back is indistinguishable from a probe that never ran. Latency
 * is measured around the real request only, never around a refusal. The
 * credential never enters the command line or the record (`AI-30-R05`): the
 * client reads it from its own store, or the gateway holds it.
 */
async function probeAccount(input) {
  const opts = input || {};
  const io = opts.io || {};
  const file = opts.file || RESULT_PATH;
  const now = opts.now || Date.now();
  const store = loadResults(file, io);

  const account = (opts.accounts || []).find((a) => a.id === opts.accountId);
  if (!account) {
    return saveResult(
      buildRecord(opts.accountId, opts.model || '', 'refused', 0, 'unknown account id', now),
      file,
      io
    );
  }

  // Provider support is read from refresh-quota's own table, by reference.
  const supported = opts.isProviderSupported
    ? opts.isProviderSupported(account.provider)
    : require('./refresh-quota').SUPPORTED_PROVIDERS.has(account.provider);
  if (!supported) {
    return saveResult(
      buildRecord(
        account.id,
        opts.model || '',
        'refused',
        0,
        'provider "' + account.provider + '" has no reader; unsupported providers are never probed',
        now
      ),
      file,
      io
    );
  }

  // Entry rule, by reference to the shared entry module (AI-30-R06). The
  // default is account-entry.entryFindings, so the shipped CLI path is gated;
  // an injected form may return a findings array, a boolean, or anything else
  // truthy for "admitted".
  {
    const isEntryAdmitted = opts.isEntryAdmitted || require('./account-entry').entryFindings;
    const verdict = isEntryAdmitted(account);
    const failed = verdict === false || (Array.isArray(verdict) && verdict.length > 0);
    if (failed) {
      return saveResult(
        buildRecord(
          account.id,
          opts.model || '',
          'refused',
          0,
          (
            'entry refused: ' +
            (Array.isArray(verdict)
              ? verdict.map((f) => f.rule + ' ' + f.detail).join('; ')
              : 'account is not entry-admitted')
          ).slice(0, 160),
          now
        ),
        file,
        io
      );
    }
  }

  const model = opts.model || cheapestModel(account);
  if (!model) {
    return saveResult(
      buildRecord(account.id, '', 'refused', 0, 'account declares no model to probe', now),
      file,
      io
    );
  }

  // Cache: any verdict inside the window is reused, never re-spent (AI-30-R02,
  // AI-30-R04). A timeout is cached like any other verdict; past the window
  // the next attempt re-runs the real client instead of assuming the earlier
  // timeout was transient.
  const verdict = opts.cachedVerdict
    ? opts.cachedVerdict(store, account.id, model)
    : cachedVerdict(store, account.id, model, { cacheWindowMs: opts.cacheWindowMs, now });
  if (verdict.action === 'reuse') {
    // The reused verdict is returned without being written again, so it is
    // shape-checked here rather than in saveResult. Its latency is `null`: the
    // probe spent no request this time, and a `0` would read as a measurement
    // (review finding N2).
    return assertRecordShape({
      accountId: account.id,
      model,
      instant: verdict.instant,
      outcome: verdict.outcome,
      latencyMs: null,
      reason: 'cached verdict reused inside the cache window',
      cached: true,
    });
  }

  const probeText = opts.probeText || 'Reply with the single word: ready.';
  const command = opts.buildCommand
    ? opts.buildCommand(account, model, probeText)
    : probeCommand(account, model, probeText);

  const started = Date.now();
  const ran = opts.run
    ? await opts.run(command, {
        timeoutMs: opts.timeoutMs === undefined ? DEFAULT_PROBE_TIMEOUT_MS : opts.timeoutMs,
        treeKill: opts.treeKill !== false,
      })
    : await runBounded(command, {
        timeoutMs: opts.timeoutMs,
        treeKill: opts.treeKill !== false,
      });
  const latencyMs = Date.now() - started;

  return saveResult(
    buildRecord(
      account.id,
      model,
      ran.outcome,
      latencyMs,
      String(ran.reason || '').slice(0, 160),
      now
    ),
    file,
    io
  );
}

/**
 * The CLI surface for one probe: strict argv, deterministic result line.
 * Unknown options are refused here rather than dropped — a silently ignored
 * `--account` would run the probe against the wrong account while the
 * operator believed they had named one. Exit codes: 0 the outcome is
 * recorded, 2 the invocation itself is wrong.
 *
 * A `refused`, `fail` or `timeout` outcome still exits 0: the record is the
 * committed outcome either way, and a recorded refusal is a fact about the
 * account (AI-TOOL-10), not a CLI failure.
 */
const PROBE_FLAGS = new Set(['account', 'model', 'json', 'file', 'timeout', 'cache-window']);

function parseProbeArgs(argv) {
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

/**
 * Runs one `probe` invocation. `deps` is injectable so the tests never touch
 * the real registry, the real probe or the real result file.
 */
async function runProbeCli(argv, deps) {
  const sink = deps || {};
  const out = sink.out || ((line) => process.stdout.write(line + '\n'));
  const err = sink.err || ((line) => process.stderr.write(line + '\n'));
  const accounts =
    sink.accounts ||
    (() => {
      const { listAccounts } = require('./accounts');
      return listAccounts();
    })();

  const args = parseProbeArgs(argv);
  const unknown = Object.keys(args).filter((k) => k !== '_' && !PROBE_FLAGS.has(k));
  if (unknown.length > 0 || args._.length > 0) {
    err('Tuỳ chọn không nhận ra: ' + (unknown[0] ? '--' + unknown[0] : args._.join(' ')));
    err(
      'Dùng: probe --account <id> [--model <model>] [--json] [--file <path>] [--timeout <ms>] [--cache-window <ms>]'
    );
    return 2;
  }
  if (args.account === undefined || typeof args.account !== 'string') {
    err('--account là bắt buộc');
    return 2;
  }
  for (const key of ['model', 'file']) {
    if (args[key] !== undefined && typeof args[key] !== 'string') {
      err('--' + key + ' cần một giá trị');
      return 2;
    }
  }
  for (const key of ['timeout', 'cache-window']) {
    if (args[key] !== undefined && (!/^\d+$/.test(String(args[key])) || Number(args[key]) <= 0)) {
      err('--' + key + ' cần một số dương');
      return 2;
    }
  }

  const record = await probeAccount({
    accountId: args.account,
    model: args.model,
    accounts,
    file: args.file,
    timeoutMs: args.timeout ? Number(args.timeout) : undefined,
    cacheWindowMs: args['cache-window'] ? Number(args['cache-window']) : undefined,
    isEntryAdmitted: sink.isEntryAdmitted,
    isProviderSupported: sink.isProviderSupported,
  });

  if (args.json) out(JSON.stringify(record, null, 2));
  else {
    // A reused verdict measured nothing this time, so it says so instead of
    // printing a latency number that was never taken (review finding N2).
    const spent = record.cached
      ? 'không đo lại, dùng kết quả đã ghi nhớ'
      : record.latencyMs + ' ms';
    out(
      'Kết quả: ' +
        record.accountId +
        ' ' +
        record.model +
        ' → ' +
        record.outcome +
        ' (' +
        spent +
        ')'
    );
    out('  Lý do: ' + record.reason);
  }
  return 0;
}

module.exports = {
  RESULT_PATH,
  RESULT_DIR,
  OUTCOMES,
  REQUIRED_FIELDS,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_CACHE_WINDOW_MS,
  validateResultShape,
  recordKey,
  loadResults,
  saveResult,
  cachedVerdict,
  cheapestModel,
  probeCommand,
  runBounded,
  probeAccount,
  parseProbeArgs,
  runProbeCli,
};
