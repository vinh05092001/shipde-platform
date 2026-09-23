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

const { spawnSync, spawn } = require('child_process');
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
 * Hermes Agent (TASK-AI-50): a planning harness with tool use and subagents.
 *
 * Two things make it different from Paseo and both are handled here rather
 * than pushed onto the caller.
 *
 * It has no `--background`. `-z` runs the whole task and prints only the final
 * text, so the executor would sit holding a child process for the length of a
 * Work Item. The adapter is marked `detached`, and `runHarness` starts it
 * without waiting.
 *
 * It has no session id on stdout either — `-z` suppresses it deliberately. The
 * durable handle is the working directory: `--resume latest --in <dir>` picks
 * up the most recent session for that workspace with its history intact
 * (verified 2026-09-23: a number stored in one run was recalled in the next).
 * So the handle this adapter writes into the decision log is the directory,
 * which is what a later resume actually needs.
 *
 * The reasoning model is never pinned. `~/AppData/Local/hermes/config.yaml`
 * points Hermes at 9Router, and the model for each task arrives as `-m`, so
 * the pool is whatever the registry and the qualification probe currently
 * allow.
 */
const hermes = {
  id: 'hermes',
  command: 'hermes',
  detached: true,
  launch(job) {
    const args = [];
    if (job.model) args.push('-m', job.model);
    if (job.cwd) args.push('--in', job.cwd);
    // Headless: nothing is present to answer an approval or a hook prompt, and
    // an unanswered prompt hangs the run to its timeout.
    args.push('--yolo', '--accept-hooks');
    if (job.reasoning) args.push('--reasoning', job.reasoning);
    if (job.usageFile) args.push('--usage-file', job.usageFile);
    args.push('-z', job.prompt);
    return args;
  },
  resume(sessionId, prompt, job) {
    const dir = handleToDir(sessionId) || (job && job.cwd);
    const args = ['--resume', 'latest'];
    if (dir) args.push('--in', dir);
    if (job && job.model) args.push('-m', job.model);
    args.push('--yolo', '--accept-hooks', '-z', prompt);
    return args;
  },
  /**
   * Stopping a Hermes run means stopping the process, because the handle is a
   * workspace rather than a session the daemon can interrupt. The pid comes
   * from the launch record, so a caller that never kept it cannot stop the run
   * — which is the honest limitation, not something to paper over with a
   * command that does nothing.
   */
  stop(sessionId, job) {
    const pid = job && job.pid;
    if (!pid) return null;
    return { kill: Number(pid) };
  },
  sessionIdFrom(parsed, job) {
    if (job && job.cwd) return DIR_HANDLE + job.cwd;
    return pickId(parsed);
  },
};

/** Marks a handle that is a workspace rather than a provider-issued id. */
const DIR_HANDLE = 'dir:';

function handleToDir(handle) {
  const s = String(handle || '');
  return s.startsWith(DIR_HANDLE) ? s.slice(DIR_HANDLE.length) : null;
}

/**
 * The smallest context window a harness can be given a model for.
 *
 * Hermes loads its own tools, rules and memory before the task even starts, so
 * a small model answers "this conversation has grown too large" and the run is
 * lost without producing anything (observed 2026-09-23 with an 8k model). The
 * number is the harness's floor, not a model's quality: a model below it is
 * refused for this harness and may still be perfectly good for another.
 *
 * Paseo and Cline pass the prompt through to whatever the provider accepts, so
 * they state no floor.
 */
const MIN_CONTEXT = Object.freeze({ hermes: 32000 });

/**
 * Why this harness cannot take this model, or null when it can.
 * An unknown context window is not a refusal: the registry does not always
 * record one, and refusing on a missing field would ground a working model.
 */
function contextRefusal(harnessName, contextWindow) {
  const floor = MIN_CONTEXT[String(harnessName || '').toLowerCase()];
  if (!floor) return null;
  const window = Number(contextWindow);
  if (!Number.isFinite(window) || window <= 0) return null;
  if (window >= floor) return null;
  return (
    'CONTEXT_TOO_SMALL: ' +
    harnessName +
    ' needs at least ' +
    floor +
    ' tokens of context and this model has ' +
    window
  );
}

const HARNESSES = Object.freeze({ paseo, cline, hermes });

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

  const dirs = (opts.path || process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const shim = path.join(dir, command + '.cmd');
    if (!exists(shim)) continue;
    let target = null;
    try {
      // Anchored on node_modules: the shim also quotes "%dp0%\node.exe" a few
      // lines earlier, and matching that one resolves to a file which is not
      // there, so the unwrap fell back to the .cmd that cannot be spawned.
      const match = /"%dp0%\\(node_modules\\[^"]+)"/.exec(readFile(shim));
      if (match) target = path.join(dir, match[1]);
    } catch (_) {
      target = null;
    }
    if (target && exists(target)) {
      return { file: opts.nodePath || process.execPath, prefixArgs: [target] };
    }
    // A shim whose target cannot be read is still better named than nothing:
    // report the shim so the failure names a real file.
    return { file: shim, prefixArgs: [] };
  }
  return { file: command, prefixArgs: [] };
}

/**
 * Runs an adapter's argv with no shell, and reports what came back.
 *
 * A `detached` adapter is started and not waited for. That is not a
 * convenience: a harness with no background mode would otherwise hold the
 * dispatching process for the length of a Work Item, and the second assignment
 * in the plan would not start until the first one finished — which is the
 * parallelism the ceiling exists to govern, lost to an implementation detail.
 * The caller gets exit 0 and the handle, and the session's own logs are the
 * record of what happened after that.
 */
function runHarness(adapter, args, options) {
  const opts = options || {};
  const exe = executableFor(adapter.command, opts);

  if (adapter.detached) {
    const spawnFn = opts.spawn || spawn;
    let child;
    try {
      child = spawnFn(exe.file, exe.prefixArgs.concat(args), {
        windowsHide: true,
        shell: false,
        detached: true,
        stdio: 'ignore',
      });
    } catch (err) {
      return { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
    }
    if (child && typeof child.unref === 'function') child.unref();
    // The executor reads a JSON object from stdout; a detached start has none,
    // so the handle the adapter already knows is reported in that shape.
    return {
      exitCode: 0,
      stdout: JSON.stringify({ started: true, pid: child && child.pid }),
      stderr: '',
    };
  }

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
  DIR_HANDLE,
  handleToDir,
  MIN_CONTEXT,
  contextRefusal,
  parseLastJson,
  pickId,
};
