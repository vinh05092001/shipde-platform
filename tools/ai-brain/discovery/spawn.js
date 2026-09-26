'use strict';

/**
 * Ship Dễ — Model discovery: command runner for CLI-backed adapters (W2)
 *
 * Every harness on this machine is an npm global, and npm writes two shim
 * kinds on Windows: `name.cmd` and `name.ps1`. Neither is spawnable by Node
 * with `shell: false`: Node reports the `.cmd` as ENOENT and the `.ps1` the
 * same way, so a scan that spawns them "would have recorded four working tools
 * as missing because of this" — the exact failure mode this Work Item calls
 * out. Spawning with `shell: true` instead would make a prompt containing
 * `&&`, `|` or `$(…)` be interpreted by cmd, so the shim is unwrapped to its
 * real target and run without a shell.
 *
 * npm (`v11` writing `\AppData\Roaming\npm`) writes the real entry into the
 * shim as one of:
 *
 *   .cmd  ...  "%_prog%" "%dp0%\node_modules\opencode-ai\bin\opencode.js" %*
 *   .ps1  ...  & "$basedir/node_modules/@qwen-code/qwen-code/cli-entry.js" $args
 *
 * The shim's own directory is the npm bin dir, so `$basedir`/`%dp0%` resolves
 * to the same place. Targets ending `.exe` are executed directly; everything
 * else is a script run under `process.execPath`.
 *
 * A command that still cannot be located is reported as `ENOENT` with the
 * search path it used, so "the resolver could not find the file on PATH" is
 * distinguishable from "the tool ran and failed".
 */

const fs = require('fs');
const path = require('path');

/**
 * The real entry point behind a Windows npm shim, or null.
 *
 * @param shimPath absolute path to the .cmd or .ps1
 * @param read     injectable file reader (tests)
 */
function unwrapShim(shimPath, io) {
  const opts = io || {};
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  let text;
  try {
    text = readFile(shimPath);
  } catch (e) {
    return null;
  }
  const dir = path.dirname(shimPath);

  // Match every node_modules\... / node_modules/... reference and keep the
  // one that actually exists and is not a bare "node". Group handling is
  // defensive: an shim that quotes weirdly can produce a partial match, so
  // the whole match is used minus the optional leading separator.
  const candidates = new Set();
  const re = /["\\/]?(?:node_modules[\\/][^"\s']+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!m[0]) continue;
    candidates.add(m[0].replace(/^["\\/]/, ''));
  }
  const fileExists = opts.fileExists || ((p) => fs.existsSync(p));
  for (const rel of candidates) {
    if (/[\\/]node(\.exe)?$/i.test(rel)) continue;
    const target = path.join(dir, rel);
    if (fileExists(target)) return target;
  }
  return null;
}

/**
 * Resolve a command name on PATH into { file, args } that Node may spawn with
 * `shell: false`.
 *
 * @param command
 * @param opts { platform, path, fileExists, readFile, nodePath }
 * @returns { file, args, kind } or { error: 'ENOENT' }
 */
function resolveCommand(command, opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const nodePath = o.nodePath || process.execPath;

  if (platform !== 'win32') return { file: command, args: [], kind: 'direct' };

  const dirs = (o.path || process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const base = path.join(dir, command);
    const exe = base + '.exe';
    if (exists(exe, o)) return { file: exe, args: [], kind: 'exe' };
    const cmd = base + '.cmd';
    if (exists(cmd, o)) {
      const target = unwrapShim(cmd, o);
      if (target) return targetFor(target, nodePath);
      return { file: cmd, args: [], kind: 'shim-unreadable' };
    }
    const ps1 = base + '.ps1';
    if (exists(ps1, o)) {
      const target = unwrapShim(ps1, o);
      if (target) return targetFor(target, nodePath);
      return { file: ps1, args: [], kind: 'shim-unreadable' };
    }
    const bare = base;
    if (exists(bare, o)) return { file: bare, args: [], kind: 'direct' };
  }
  return { error: 'ENOENT', command };
}

function targetFor(target, nodePath) {
  if (/\.exe$/i.test(target)) return { file: target, args: [], kind: 'exe' };
  // A shebang'd script with no extension runs under Node like any other.
  return { file: nodePath, args: [target], kind: 'node-script' };
}

function exists(p, o) {
  const fileExists = o.fileExists || ((x) => fs.existsSync(x));
  try {
    return fileExists(p);
  } catch (_) {
    return false;
  }
}

/**
 * Run one command, no shell, bounded, capturing stdout and stderr only.
 *
 * @returns Promise<{ exitCode, signaled, stdout, stderr, enoent? }>
 */
function runCommand(command, args, opts) {
  const o = opts || {};
  const { spawn } = o.childProcess || require('child_process');
  const timeoutMs = o.timeoutMs === undefined ? 60000 : o.timeoutMs;
  const resolved = resolveCommand(command, o);
  if (resolved.error) {
    return Promise.resolve({ exitCode: -1, enoent: true, stdout: '', stderr: '' });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = o.spawn
        ? o.spawn(resolved.file, resolved.args.concat(args || []), {
            encoding: 'utf8',
            windowsHide: true,
            shell: false,
          })
        : spawn(resolved.file, resolved.args.concat(args || []), {
            encoding: 'utf8',
            windowsHide: true,
            shell: false,
          });
    } catch (e) {
      finish({
        exitCode: -1,
        enoent: e && e.code === 'ENOENT',
        stdout: '',
        stderr: String(e.message || e),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => (stdout += d));
    if (child.stderr) child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) =>
      finish({
        exitCode: -1,
        enoent: e && e.code === 'ENOENT',
        stdout: '',
        stderr: String(e.message || e),
      })
    );
    child.on('close', (code, signal) => {
      if (signal) finish({ exitCode: -1, signaled: signal, stdout, stderr });
      else finish({ exitCode: code === null ? -1 : code, stdout, stderr });
    });

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch (e) {
        /* already gone */
      }
      finish({ exitCode: -1, timedOut: true, stdout, stderr });
    }, timeoutMs);
  });
}

module.exports = { resolveCommand, unwrapShim, runCommand };
