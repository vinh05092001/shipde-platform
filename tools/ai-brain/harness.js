'use strict';

/**
 * Ship Dễ — Harness adapters (TASK-AI-49)
 *
 * The executor used to build one argument vector: `ao spawn …`. AO was retired
 * on 2026-09-22 because its controller held idle processes whose RAM was the
 * whole reason for removing it, and every dispatch path that still names it is
 * dispatching into nothing.
 *
 * This module is the seam that replaced it. A harness is a program that can be
 * handed a work item and will run a coding session; each adapter knows three
 * things and nothing else:
 *
 *   launch(job)      the argv that starts a session
 *   sessionIdFrom(x) the durable id to write down, so the session survives this
 *                    process exiting
 *   resume(id, text) the argv that continues that same session
 *
 * `resume` is what makes an interrupted run recoverable. Restarting a work item
 * from the prompt would put a second writer on a branch that already has
 * commits; continuing the existing agent keeps one writer and its history.
 *
 * Adding a harness is an entry in HARNESSES plus its `harness` field in
 * sources.json. Nothing downstream may branch on a harness name.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RETIRED = Object.freeze({
  ao: 'AO was retired on 2026-09-22 (idle-process RAM). Use the paseo adapter.',
});

/**
 * Paseo runs the session in the background and returns immediately with the
 * agent id, which is the point: the executor must not sit blocked holding a
 * child process for the length of a work item. `--mode full-access` is not
 * optional — the default mode stops at a permission prompt that nothing is
 * present to answer, and the session hangs until its timeout.
 */
const paseo = {
  id: 'paseo',
  command: 'paseo',
  launch(job) {
    if (job.isolatedWorker) {
      const { isWorkerPath } = require('./isolation-launcher');
      if (!isWorkerPath(job.cwd)) {
        throw new Error('ISOLATED_LAUNCH_REQUIRES_WORKER_HARNESS');
      }
      job.newWorkspace = false;
    }
    const args = ['run', '--provider', job.provider];
    if (job.model) args.push('--model', job.model);
    args.push('--mode', job.mode || 'full-access');
    if (job.cwd) args.push('--cwd', job.cwd);
    if (job.branch && job.newWorkspace !== false) {
      // One work item, one branch, one writer: Paseo makes the worktree so two
      // agents on different items never share a checkout.
      args.push(
        '--new-workspace',
        'worktree',
        '--worktree-mode',
        'branch-off',
        '--new-branch',
        job.branch
      );
      if (job.base) args.push('--base', job.base);
    }
    if (job.title) args.push('--title', job.title);
    for (const [k, v] of Object.entries(job.labels || {})) args.push('--label', k + '=' + v);
    args.push('--background', '--json', job.prompt);
    return args;
  },
  resume(sessionId, prompt) {
    return ['send', String(sessionId), '--json', prompt];
  },
  stop(sessionId) {
    return ['stop', String(sessionId)];
  },
  inspect(sessionId) {
    return ['inspect', String(sessionId), '--json'];
  },
  sessionIdFrom(parsed) {
    return pickId(parsed) || pickId(parsed && parsed.agent) || pickId(parsed && parsed.data);
  },
};

/**
 * Cline runs in the foreground and owns its own directory, so the caller
 * supplies an already-prepared worktree. It has no session id to resume from,
 * which is why it is not the default: an interrupted Cline run can only be
 * restarted, and restarting is what the writer rule forbids.
 */
const cline = {
  id: 'cline',
  command: 'cline',
  launch(job) {
    const args = ['task', '--yolo'];
    if (job.model) args.push('--model', job.model);
    args.push(job.prompt);
    return args;
  },
  resume: null,
  sessionIdFrom() {
    return null;
  },
};

/**
 * Hermes v0.21.4 one-shot handle contract, settled against the real binary on
 * 2026-09-29 (evidence: logs/night/hermes-durable-evidence.txt):
 *
 * `-z` prints ONLY the final response text to stdout — the CLI documents "no
 * session_id line" and neither a successful nor a failed run emitted any id
 * on stdout or stderr. The durable handle is the `session_id` field of the
 * `--usage-file` JSON report: present on a successful run, null on a failed
 * one (the report is written either way). `hermes --resume <id> -z …` was
 * verified to continue that exact session — the resumed run's report carried
 * the same session_id and the exported history holds both turns.
 *
 * Consequences: a launch without `--usage-file` can never yield a handle, so
 * the caller supplies the report path; a report whose session_id is null must
 * stay a hard HARNESS_NO_SESSION_ID downstream, never a guessed value; and
 * post-hoc `sessions list` / "latest" lookups are a human, workspace-scoped,
 * racy channel that this adapter does not use.
 *
 * There is deliberately no `inspect` here. Paseo answers a per-session probe,
 * so the executor can tell a gone session from a live one; v0.21.4 documents no
 * equivalent, and an argv invented here would be a guess at an external API —
 * the one thing a pinned adapter must not contain. Progress is therefore
 * measured host-side (supervisor.js measures the worker root) rather than by
 * asking the harness, and the executor skips its liveness probe for this
 * adapter instead of failing a resume on a fabricated probe.
 */
const hermes = {
  id: 'hermes',
  command: 'hermes',
  launch(job) {
    const j = job || {};
    if (!j.candidateKey) throw new Error('HERMES_REQUIRES_PINNED_CANDIDATE');
    if (!j.model) throw new Error('HERMES_REQUIRES_PINNED_MODEL');
    if (Array.isArray(j.subagents) && j.subagents.length > 0) {
      const accounted = Array.isArray(j.accountedSubagents) ? j.accountedSubagents : [];
      if (accounted.length < j.subagents.length) {
        throw new Error('HERMES_SUBAGENT_REQUIRES_CONTROLLER_ASSIGNMENT');
      }
    }
    const args = ['-m', j.model, '--ignore-user-config'];
    if (j.provider) args.push('--provider', j.provider);
    if (j.cwd) args.push('--in', j.cwd);
    // The only channel on which a one-shot run emits its durable session id.
    if (j.usageFile) args.push('--usage-file', j.usageFile);
    args.push('-z', j.prompt || '');
    return args;
  },
  resume(sessionId, prompt, job) {
    const j = job || {};
    if (!j.candidateKey) throw new Error('HERMES_REQUIRES_PINNED_CANDIDATE');
    const args = ['--resume', String(sessionId), '--ignore-user-config'];
    if (j.model) args.push('-m', j.model);
    if (j.provider) args.push('--provider', j.provider);
    if (j.cwd) args.push('--in', j.cwd);
    args.push('-z', prompt || '');
    return args;
  },
  stop(sessionId, job) {
    const pid = job && job.pid ? Number(job.pid) : Number(sessionId);
    return Number.isFinite(pid) && pid > 0 ? { killTree: pid } : null;
  },
  sessionIdFrom(parsed) {
    // Parses exactly what the real CLI emits: the `session_id` field of the
    // --usage-file JSON (logs/night/hermes-durable-evidence.txt). A failed
    // run writes the report with "session_id": null, and null stays null — a
    // missing handle is HARNESS_NO_SESSION_ID, never a value guessed from
    // fields the CLI does not emit (handle/session/pid guesses removed).
    const v = parsed && parsed.session_id;
    return v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : null;
  },
  progressFromInspect(parsed, options) {
    return progressVerdict(parsed, options);
  },
  writesUsageReport: true,
};

const opencodeDirect = {
  id: 'opencode-direct',
  command: 'opencode',
  launch(job) {
    if (!job.isolatedWorker) throw new Error('OPENCODE_DIRECT_REQUIRES_ISOLATION');
    if (!job.model) throw new Error('OPENCODE_DIRECT_REQUIRES_PINNED_MODEL');
    if (!job.cwd) throw new Error('OPENCODE_DIRECT_REQUIRES_DIR');
    const args = ['run', '--model', job.model, '--dir', job.cwd, '--auto', '--format', 'json'];
    if (job.title) args.push('--title', job.title);
    args.push(job.prompt);
    return args;
  },
  resume: null,
  stop: null,
  inspect: null,
  sessionIdFrom() {
    return null;
  },
  writesUsageReport: true,
};

const MIN_CONTEXT = Object.freeze({ hermes: 32000 });

function contextRefusal(harnessName, contextWindow) {
  const floor = MIN_CONTEXT[String(harnessName || '').toLowerCase()];
  if (!floor) return null;
  const window = Number(contextWindow);
  if (!Number.isFinite(window) || window <= 0) {
    return 'CONTEXT_WINDOW_UNVERIFIED: ' + harnessName + ' requires verified context >= ' + floor;
  }
  if (window >= floor) return null;
  return 'CONTEXT_TOO_SMALL: ' + harnessName + ' requires context >= ' + floor + ', got ' + window;
}

const ProgressStatus = Object.freeze({
  RUNNING_WITH_PROGRESS: 'RUNNING_WITH_PROGRESS',
  STALLED: 'STALLED',
  UNKNOWN: 'UNKNOWN',
});

function progressVerdict(parsed, options) {
  const opts = options || {};
  const stallMs = Number.isFinite(Number(opts.stallMs)) ? Number(opts.stallMs) : 15 * 60 * 1000;
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const progress = p.progress && typeof p.progress === 'object' ? p.progress : p;
  const markers = [
    progress.diffBytes,
    progress.diffSize,
    progress.commits,
    progress.tests,
    progress.logBytes,
    progress.toolCalls,
    progress.toolActivity,
  ];
  const hasMetricProgress = markers.some((v) => Number(v) > 0);
  const lastProgressAt =
    Date.parse(progress.lastProgressAt || p.lastProgressAt || progress.updatedAt || '') || null;

  if (hasMetricProgress) {
    if (!lastProgressAt || now - lastProgressAt <= stallMs) {
      return {
        status: ProgressStatus.RUNNING_WITH_PROGRESS,
        lastProgressAt: lastProgressAt ? new Date(lastProgressAt).toISOString() : null,
      };
    }
    return {
      status: ProgressStatus.STALLED,
      lastProgressAt: new Date(lastProgressAt).toISOString(),
      reason: 'NO_RECENT_PROGRESS',
    };
  }

  const startedAt = Date.parse(p.startedAt || progress.startedAt || '') || null;
  if (startedAt && now - startedAt > stallMs) {
    return {
      status: ProgressStatus.STALLED,
      lastProgressAt: null,
      reason: 'RUNNING_WITHOUT_PROGRESS',
    };
  }
  return { status: ProgressStatus.UNKNOWN, lastProgressAt: null };
}

function structuredOutcome(candidateKey, res, classification, extra) {
  const out = extra || {};
  const status = out.status || (res && res.exitCode === 0 ? 'completed' : 'failed');
  return {
    candidateKey,
    status,
    errorClass: out.errorClass || (classification && classification.cause) || null,
    failureScope: out.failureScope || (classification && classification.scope) || null,
    retryable:
      out.retryable !== undefined
        ? Boolean(out.retryable)
        : Boolean(classification && classification.cooldownMs !== null),
    cooldownUntil: out.cooldownUntil || null,
    checkpoint: out.checkpoint || null,
    artifacts: out.artifacts || [],
    lastProgressAt: out.lastProgressAt || null,
    reason: out.reason || (res && (res.stderr || res.body || res.stdout)) || null,
  };
}

const agyPool = {
  id: 'agy-pool',
  command: 'schtasks',
  launch(job, opts) {
    const fs = require('fs');
    const path = require('path');
    const pool = require('./agy-pool-runtime');
    if (!pool.isValidAccountId(job && job.accountId)) {
      return {
        refusal: 'INVALID_ACCOUNT_ID',
        reason: `INVALID_ACCOUNT_ID: account must match /^agy\\d{2}$/, got ${JSON.stringify(job && job.accountId)}`,
        exitCode: 1,
        state: 'error',
      };
    }
    const accountDir = pool.accountDir(job.accountId, opts);
    fs.mkdirSync(accountDir, { recursive: true });

    const payload = {
      cwd: job.cwd,
      prompt: job.prompt,
      model: job.model,
      candidateKey: job.candidateKey,
      accountId: job.accountId,
      harness: 'agy-pool',
    };

    if (job.usageFile) {
      fs.writeFileSync(job.usageFile, JSON.stringify({ accountId: job.accountId }));
    }

    fs.writeFileSync(path.join(accountDir, 'job.json'), JSON.stringify(payload, null, 2), 'utf8');
    return ['/run', '/tn', `ShipDe\\ShipDe-${job.accountId}`];
  },
  quota(accountId, opts) {
    const pool = require('./agy-pool-runtime');
    const result = pool.submitJob(accountId, { command: 'quota' }, opts);
    return pool.quotaReading(accountId, Object.assign({}, opts, { result }));
  },
  resume(sessionId, prompt, job, opts) {
    return this.launch(Object.assign({}, job, { prompt }), opts);
  },
  stop(sessionId) {
    return ['/end', '/tn', `ShipDe\\ShipDe-${sessionId}`];
  },
  sessionIdFrom(parsed) {
    return parsed && parsed.accountId ? String(parsed.accountId) : null;
  },
  mapOutcome(accountId, candidateKey, opts) {
    const pool = require('./agy-pool-runtime');
    if (!pool.isValidAccountId(accountId)) {
      return structuredOutcome(
        candidateKey,
        { exitCode: 1 },
        { cause: 'INVALID_ACCOUNT_ID' },
        { status: 'failed', reason: 'INVALID_ACCOUNT_ID: account must match /^agy\\d{2}$/' }
      );
    }
    const res = pool.readResult(accountId, opts);
    if (!res)
      return structuredOutcome(
        candidateKey,
        { exitCode: 1 },
        { cause: 'UNKNOWN_STATE' },
        { status: 'failed' }
      );
    if (res.reason === 'CORRUPT_RESULT') {
      return structuredOutcome(
        candidateKey,
        { exitCode: 1 },
        { cause: 'CORRUPT_RESULT' },
        { status: 'failed' }
      );
    }

    if (res.state === 'ok') {
      return structuredOutcome(candidateKey, { exitCode: res.exitCode || 0 }, null, {
        status: 'completed',
      });
    } else if (res.state === 'quota') {
      return structuredOutcome(
        candidateKey,
        { exitCode: res.exitCode || 1 },
        { cause: 'QUOTA_EXHAUSTED' },
        { status: 'failed', cooldownUntil: res.resetsAt || null }
      );
    } else if (res.state === 'login-required') {
      return structuredOutcome(
        candidateKey,
        { exitCode: res.exitCode || 1 },
        { cause: 'AUTH_FAILED' },
        { status: 'failed' }
      );
    } else {
      return structuredOutcome(
        candidateKey,
        { exitCode: res.exitCode || 1 },
        { cause: 'FAILED' },
        { status: 'failed' }
      );
    }
  },
};

const HARNESSES = Object.freeze({
  paseo,
  cline,
  hermes,
  'opencode-direct': opencodeDirect,
  'agy-pool': agyPool,
});

function pickId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of ['id', 'agentId', 'sessionId', 'session_id']) {
    const v = obj[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return null;
}

/**
 * The adapter for a harness name.
 *
 * A retired name throws rather than returning null. The difference matters:
 * null reads as "not configured yet" and invites a fallback, while AO is a
 * decision that was made and must not be walked back by accident.
 */
function getHarness(name) {
  const key = String(name || '').toLowerCase();
  if (RETIRED[key]) throw new Error('RETIRED_HARNESS: ' + RETIRED[key]);
  return HARNESSES[key] || null;
}

function listHarnesses() {
  return Object.keys(HARNESSES);
}

/**
 * What this platform must actually execute to run `command`, as
 * { file, prefixArgs }.
 *
 * Every harness here is an npm global. On Windows that is a `.cmd` shim, and
 * Node refuses to spawn a `.cmd` without a shell — the call comes back
 * EINVAL, which reads as "the harness is broken" rather than "the name was
 * wrong". Turning on `shell: true` would fix the spawn and break something
 * worse: a prompt containing `&&`, `|` or `$(…)` would be interpreted by cmd
 * instead of reaching the agent as text.
 *
 * So the shim is unwrapped instead. npm writes the real entry point into it as
 *   "%_prog%" ... "%dp0%\node_modules\<pkg>\bin\<name>" %*
 * and running that file under the current Node keeps `shell: false` and an
 * argv the shell never sees.
 */
function executableFor(command, options) {
  const opts = options || {};
  const platform = opts.platform || process.platform;
  const exists = opts.fileExists || ((p) => fs.existsSync(p));
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  if (platform !== 'win32') return { file: command, prefixArgs: [] };

  // The path module must follow the injected platform, not the host: on Linux
  // the posix delimiter is ':' (which splits "C:\bin" on the drive colon) and
  // join() emits forward slashes, so a win32 test — or any caller that pins
  // platform — must resolve with path.win32 to see the real shim layout.
  const p = path.win32;
  const dirs = (opts.path || process.env.PATH || '').split(p.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const shim = p.join(dir, command + '.cmd');
    if (!exists(shim)) continue;
    let target = null;
    try {
      // Anchored on node_modules: the shim also quotes "%dp0%\node.exe" a few
      // lines earlier, and matching that one resolves to a file which is not
      // there, so only match entries referencing node_modules. Handles
      // "%dp0%\", "%~dp0%\", "%~dp0\", "%~dp0", space-bearing quoted paths,
      // and unquoted/forward-slash variants.
      const content = readFile(shim);
      const re =
        /"%~?dp0%?[\\/]?(node_modules[\\/][^"\r\n]+)"|%~?dp0%?[\\/]?(node_modules[\\/][^\s"\r\n]+)/gi;
      let m;
      while ((m = re.exec(content)) !== null) {
        const candidate = p.join(dir, m[1] || m[2]);
        if (exists(candidate)) {
          target = candidate;
          break;
        }
        if (!target) target = candidate;
      }
    } catch (_) {
      target = null;
    }
    if (target && exists(target)) {
      if (/\.(exe|com)$/i.test(target)) {
        return { file: target, prefixArgs: [] };
      }
      return { file: opts.nodePath || process.execPath, prefixArgs: [target] };
    }
    // A shim whose target cannot be read is still better named than nothing:
    // report the shim so the failure names a real file.
    return { file: shim, prefixArgs: [] };
  }
  return { file: command, prefixArgs: [] };
}

/** Runs an adapter's argv with no shell, and reports what came back. */
function runHarness(adapter, args, options) {
  const opts = options || {};
  if (args && !Array.isArray(args) && args.killTree) {
    const killTree = opts.killTree || defaultKillTree;
    return killTree(args.killTree, opts);
  }
  const exe = executableFor(adapter.command, opts);
  const res = spawnSync(exe.file, exe.prefixArgs.concat(args), {
    encoding: 'utf8',
    timeout: opts.timeoutMs || 120000,
    windowsHide: true,
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    exitCode: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function defaultKillTree(pid, opts) {
  const platform = (opts && opts.platform) || process.platform;
  const command =
    platform === 'win32'
      ? { file: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }
      : { file: 'pkill', args: ['-TERM', '-P', String(pid)] };
  const res = spawnSync(command.file, command.args, {
    encoding: 'utf8',
    timeout: (opts && opts.timeoutMs) || 30000,
    windowsHide: true,
    shell: false,
  });
  return {
    exitCode: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

/**
 * Paseo prints progress lines before its JSON, so the last balanced object in
 * the stream is the result. Parsing only the first line lost the id and made a
 * launched session look failed, which then launched a second one.
 */
function parseLastJson(text) {
  const body = String(text || '');
  let found = null;
  for (let i = 0; i < body.length; i += 1) {
    const open = body[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < body.length; j += 1) {
      const ch = body[j];
      if (inString) {
        // Brace counting has to respect strings: a `{` inside a prompt echoed
        // back in the JSON would otherwise never balance.
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(body.slice(i, j + 1));
            if (parsed && typeof parsed === 'object') found = parsed;
          } catch (_) {
            /* not JSON after all; keep scanning */
          }
          i = j;
          break;
        }
      }
    }
  }
  return found;
}

module.exports = {
  HARNESSES,
  RETIRED,
  getHarness,
  listHarnesses,
  runHarness,
  executableFor,
  MIN_CONTEXT,
  contextRefusal,
  ProgressStatus,
  progressVerdict,
  structuredOutcome,
  parseLastJson,
  pickId,
};
