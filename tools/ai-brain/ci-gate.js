'use strict';

/**
 * CI is the final verification (operator decision). After the draft Pull
 * Request exists, the item is only complete when every check reported for the
 * exact head SHA is green. A failing check yields the failing job log so the
 * existing repair loop can be fed with it. No check, a pending check or a head
 * that moved is never a pass.
 */

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { createSecretRedactor } = require('./decisions');

const GREEN = new Set(['SUCCESS']);
const RED = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
  'SKIPPED',
  'NEUTRAL',
]);

function defaultGh(args, cwd) {
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') {
    return {
      exitCode: -1,
      stdout: '',
      stderr: 'mock gh: test mode',
    };
  }
  const res = cp.spawnSync('gh', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return {
    exitCode: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function ciGateConfig(dispatch) {
  const d = dispatch || require('./sources.json').dispatch || {};
  const c = d.ciGate || {};
  return {
    enabled: c.enabled !== false,
    pollIntervalMs: Number(c.pollIntervalMs),
    timeoutMs: Number(c.timeoutMs),
    maxLogChars: Number(c.maxLogChars),
    requiredChecks: Array.isArray(c.requiredChecks) ? c.requiredChecks : [],
  };
}

/** Classify a rollup into PASS | FAIL | PENDING | MISSING. */
function classifyRollup(rollup, requiredChecks = []) {
  if (!Array.isArray(rollup) || rollup.length === 0) return { state: 'MISSING', failed: [] };
  const failed = [];
  let pending = false;
  for (const chk of rollup) {
    const status = String((chk && chk.status) || 'COMPLETED').toUpperCase();
    const conclusion = String((chk && (chk.conclusion || chk.state)) || '').toUpperCase();
    if (status !== 'COMPLETED' && !conclusion) {
      pending = true;
    } else if (RED.has(conclusion)) {
      failed.push(chk);
    } else if (!GREEN.has(conclusion)) {
      pending = true;
    }
  }
  if (failed.length) return { state: 'FAIL', failed };

  if (Array.isArray(requiredChecks) && requiredChecks.length > 0) {
    for (const req of requiredChecks) {
      const reqName = String(req).trim().toLowerCase();
      const match = rollup.find((chk) => {
        const name = String(chk.name || chk.context || '')
          .trim()
          .toLowerCase();
        return name === reqName;
      });
      if (!match) {
        return { state: 'PENDING', failed: [], missingChecks: [req] };
      }
      const status = String(match.status || 'COMPLETED').toUpperCase();
      const conclusion = String(match.conclusion || match.state || '').toUpperCase();
      if (status !== 'COMPLETED' || conclusion !== 'SUCCESS') {
        if (RED.has(conclusion)) {
          return { state: 'FAIL', failed: [match] };
        }
        return { state: 'PENDING', failed: [] };
      }
    }
  }

  return { state: pending ? 'PENDING' : 'PASS', failed: [] };
}

function runIdOf(chk) {
  const m = /\/runs\/(\d+)/.exec(String((chk && (chk.detailsUrl || chk.targetUrl)) || ''));
  return m ? m[1] : null;
}

function fetchFailedLog(failed, options) {
  const o = options || {};
  const gh = o.ghRunner || defaultGh;
  const redact = createSecretRedactor(o.env || process.env);
  const max = Number.isFinite(o.maxLogChars) && o.maxLogChars > 0 ? o.maxLogChars : 12000;
  const ids = Array.from(new Set(failed.map(runIdOf).filter(Boolean)));
  const parts = [];
  for (const id of ids) {
    const args = ['run', 'view', id, '--log-failed'].concat(o.repo ? ['--repo', o.repo] : []);
    const res = gh(args, o.cwd);
    if (res && res.exitCode === 0 && res.stdout) parts.push('# run ' + id + '\n' + res.stdout);
  }
  const text = redact(parts.join('\n'));
  return text.length > max ? text.slice(-max) : text;
}

/** Evaluate CI once for the exact head SHA. */
function evaluateCi(options) {
  const o = options || {};
  const gh = o.ghRunner || defaultGh;
  const sha = String(o.sha || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) return { state: 'MISSING', sha, reason: 'sha is not 40 chars' };
  const target = o.prNumber != null ? String(o.prNumber) : o.branch;
  const args = ['pr', 'view', target, '--json', 'headRefOid,statusCheckRollup'].concat(
    o.repo ? ['--repo', o.repo] : []
  );
  const res = gh(args, o.cwd);
  if (!res || res.exitCode !== 0) {
    return {
      state: 'MISSING',
      sha,
      reason: 'gh pr view failed: ' + String((res && res.stderr) || '').slice(0, 200),
    };
  }
  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch (_) {
    return { state: 'MISSING', sha, reason: 'gh pr view returned non-JSON' };
  }
  const head = String(data.headRefOid || '').toLowerCase();
  if (head !== sha) {
    return {
      state: 'HEAD_MOVED',
      sha,
      headRefOid: head,
      reason: 'PR head is not the reviewed SHA',
    };
  }
  const cfg = ciGateConfig(o.dispatch);
  const requiredChecks = o.requiredChecks !== undefined ? o.requiredChecks : cfg.requiredChecks;
  const cls = classifyRollup(data.statusCheckRollup, requiredChecks);
  const out = {
    state: cls.state,
    sha,
    headRefOid: head,
    failed: cls.failed.map((c) => c.name || c.context),
  };
  if (cls.state === 'FAIL') {
    out.log = fetchFailedLog(cls.failed, {
      ghRunner: gh,
      repo: o.repo,
      cwd: o.cwd,
      maxLogChars: o.maxLogChars,
      env: o.env,
    });
  }
  return out;
}

async function awaitCi(options) {
  const o = options || {};
  const cfg = ciGateConfig(o.dispatch);
  const isTest = Boolean(process.env.NODE_TEST_CONTEXT);
  const interval =
    o.pollIntervalMs ?? (isTest ? Math.min(cfg.pollIntervalMs || 10, 10) : cfg.pollIntervalMs);
  const timeout =
    o.timeoutMs ?? (isTest ? Math.min(cfg.timeoutMs || 1000, 1000) : cfg.timeoutMs);
  const sleep =
    o.sleep ||
    ((ms) =>
      new Promise((r) => {
        const t = setTimeout(r, ms);
        if (t && typeof t.unref === 'function') t.unref();
      }));
  const now = o.now || Date.now;
  const started = now();
  let last;
  for (;;) {
    last = evaluateCi(Object.assign({ maxLogChars: cfg.maxLogChars }, o));
    if (last.state === 'PASS' || last.state === 'FAIL' || last.state === 'HEAD_MOVED') return last;
    if (now() - started >= timeout) return Object.assign({}, last, { timedOut: true });
    await sleep(interval);
  }
}

/** Persist the failing CI log so the next repair round is fed with it. */
function writeCiFailure(dir, workItemId, result, env) {
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const redact = createSecretRedactor(env || process.env);
  const safeLog = redact(String(result.log || ''));
  const file = path.join(dir, 'ci-failure-' + workItemId + '.json');
  fs.writeFileSync(
    file,
    JSON.stringify(
      { workItemId, sha: result.sha, failed: result.failed || [], log: safeLog },
      null,
      2
    ),
    'utf8'
  );
  return file;
}

/** Findings for the repair loop from a CI failure recorded for exactly this SHA. */
function ciFindingsFor(dir, workItemId, sha, env) {
  if (!dir) return [];
  try {
    const redact = createSecretRedactor(env || process.env);
    const rec = JSON.parse(
      fs.readFileSync(path.join(dir, 'ci-failure-' + workItemId + '.json'), 'utf8')
    );
    if (String(rec.sha).toLowerCase() !== String(sha || '').toLowerCase()) return [];
    return [
      {
        id: 'CI_FAILED',
        open: true,
        detail:
          'GitHub CI failed on this exact commit (' +
          (rec.failed || []).join(', ') +
          '). Fix the failures shown in the log:\n' +
          redact(String(rec.log || '')).slice(-4000),
      },
    ];
  } catch (_) {
    return [];
  }
}

module.exports = {
  ciGateConfig,
  classifyRollup,
  evaluateCi,
  awaitCi,
  writeCiFailure,
  ciFindingsFor,
  fetchFailedLog,
};
