import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

function execute(command, args, options) {
  // Windows cannot exec a .cmd shim directly. All arguments below are fixed
  // literals or a validated Git OID, never caller-supplied shell text.
  if (process.platform === 'win32' && command === 'pnpm') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', ['pnpm.cmd', ...args].join(' ')], options);
  }
  return spawnSync(command, args, options);
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  let start = -1;
  let end = -1;
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    end = text.lastIndexOf('}');
  } else if (arrStart !== -1) {
    start = arrStart;
    end = text.lastIndexOf(']');
  }
  if (start === -1 || end === -1 || start >= end) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function affectedTestArgs(run, options, cwd) {
  const probe = (command, args) => run(command, args, { ...options, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const untracked = probe('git', ['ls-files', '--others', '--exclude-standard', '-z']);
    // Filter selectors include tracked dirty files, but not untracked new files.
    if (untracked.status !== 0 || untracked.stdout) return ['test'];

    // 1. Probe Turborepo affected run (TURBO_SCM_BASE=origin/main)
    const turboProbe = probe('pnpm', ['exec', 'turbo', 'run', 'test', '--affected', '--dry-run=json']);
    if (turboProbe && turboProbe.status === 0 && turboProbe.stdout) {
      const parsed = extractJson(turboProbe.stdout);
      if (parsed && Array.isArray(parsed.tasks)) {
        return ['exec', 'turbo', 'run', 'test', '--affected'];
      }
    }

    // 2. Fall back to pnpm workspace filter selector
    const mergeBase = probe('git', ['merge-base', 'origin/main', 'HEAD']);
    const oid = mergeBase.stdout?.trim();
    if (mergeBase.status !== 0 || !/^[a-f0-9]{40}$/.test(oid)) return ['test'];
    const filter = `...[${oid}]`;
    const selected = probe('pnpm', ['--filter', filter, 'list', '--depth', '-1', '--json']);
    if (selected.status !== 0) return ['test'];
    const packages = extractJson(selected.stdout) ?? JSON.parse(selected.stdout);
    if (!Array.isArray(packages) || packages.length === 0 || packages.some(
      (pkg) => typeof pkg.path !== 'string' || resolve(pkg.path) === resolve(cwd)
    )) return ['test'];
    return ['--filter', filter, 'test'];
  } catch {
    return ['test'];
  }
}

export function runChecks({ run = execute, write = console.log, cwd = root } = {}) {
  const options = {
    cwd,
    env: {
      ...process.env,
      BASE_SHA: 'origin/main',
      TURBO_SCM_BASE: 'origin/main',
    },
    encoding: 'utf8',
    // Gate tools may print source lines, credentials or environment values.
    // Do not inherit, retain or replay their output, even on failure.
    stdio: 'ignore',
    windowsHide: true,
  };
  const gates = [
    ['pnpm', ['format:check']],
    ['pnpm', ['lint']],
    ['pnpm', ['typecheck']],
    ['pnpm', ['security:secrets']],
    ['git', ['diff', '--check', 'origin/main...HEAD']],
    ['pnpm', null],
  ];
  for (const [command, fixedArgs] of gates) {
    const args = fixedArgs ?? affectedTestArgs(run, options, cwd);
    const label = fixedArgs ? [command, ...args].join(' ') :
      `pnpm test${args.length > 1 ? ' (affected workspaces)' : ''}`;
    let passed = false;
    try {
      const result = run(command, args, options);
      passed = result.status === 0 && !result.error && !result.signal;
    } catch {
      // Exception text can contain command output or environment values.
    }
    write(`${passed ? 'PASS' : 'FAIL'} ${label}`);
    if (!passed) {
      write('FAIL ai:check');
      return 1;
    }
  }
  write('PASS ai:check');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runChecks();
}
