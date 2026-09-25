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

const HARNESSES = Object.freeze({ paseo, cline });

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

/** Runs an adapter's argv with no shell, and reports what came back. */
function runHarness(adapter, args, options) {
  const opts = options || {};
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
  parseLastJson,
  pickId,
};
