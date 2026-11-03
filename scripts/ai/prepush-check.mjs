import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
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
  try {
    // Accept Turbo's version banner, never a JSON fragment inside diagnostics.
    return JSON.parse(text.replace(/^\s*• turbo \S+[ \t]*\r?\n/, ''));
  } catch {
    return null;
  }
}

function succeeded(result) {
  return result?.status === 0 && !result.error && !result.signal;
}

function affectedTestArgs(run, options, cwd) {
  const capture = (command, args) =>
    run(command, args, { ...options, stdio: ['ignore', 'pipe', 'ignore'] });
  const probe = (command, args) => {
    const result = capture(command, args);
    if (!succeeded(result) || typeof result.stdout !== 'string') throw new Error();
    return result.stdout;
  };
  try {
    const untracked = probe('git', ['ls-files', '--others', '--exclude-standard', '-z']);
    // Filter selectors include tracked dirty files, but not untracked new files.
    if (untracked) return ['test'];

    const oid = probe('git', ['merge-base', 'origin/main', 'HEAD']).trim();
    if (!/^[a-f0-9]{40}$/.test(oid)) return ['test'];
    const filter = `...[${oid}]`;
    const packages = JSON.parse(
      probe('pnpm', ['--filter', filter, 'list', '--depth', '-1', '--json'])
    );
    if (!Array.isArray(packages) || packages.length === 0) return ['test'];
    const directories = [];
    for (const pkg of packages) {
      if (typeof pkg?.path !== 'string' || !isAbsolute(pkg.path)) return ['test'];
      const dir = relative(cwd, pkg.path).replaceAll('\\', '/');
      if (!dir || dir === '..' || dir.startsWith('../') || isAbsolute(dir)) return ['test'];
      directories.push(`${dir}/`);
    }

    // Turbo can ignore root files, deleted workspaces or staged reversions.
    // Require coverage of all three diffs before either runner narrows tests.
    const changed = [];
    for (const refs of [[oid, 'HEAD'], ['--cached'], []]) {
      const files = probe('git', ['diff', '--name-only', '--no-renames', '-z', ...refs]);
      if (files && !files.endsWith('\0')) return ['test'];
      changed.push(...files.split('\0').filter(Boolean));
    }
    if (
      !changed.length ||
      changed.some((file) => !directories.some((dir) => file.startsWith(dir)))
    ) {
      return ['test'];
    }

    // Preserve Turbo's build graph when every selected workspace has a test.
    // Unsupported Turbo probing may fall back to the already verified pnpm scope.
    let turboResult;
    try {
      turboResult = capture('pnpm', [
        'exec',
        'turbo',
        'run',
        'test',
        '--affected',
        '--dry-run=json',
      ]);
    } catch {
      // Probe errors never escape into the safe summary.
      return ['--filter', filter, 'test'];
    }
    if (!succeeded(turboResult)) return ['--filter', filter, 'test'];
    const turbo = extractJson(turboResult.stdout);
    if (Array.isArray(turbo?.tasks)) {
      const covered = packages.every(
        (pkg) =>
          typeof pkg.name === 'string' &&
          turbo.tasks.some(
            (task) =>
              task?.task === 'test' &&
              task.package === pkg.name &&
              typeof task.command === 'string' &&
              task.command.trim() &&
              task.command !== '<NONEXISTENT>'
          )
      );
      return covered ? ['exec', 'turbo', 'run', 'test', '--affected'] : ['test'];
    }
    return ['test'];
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
    const label = fixedArgs
      ? [command, ...args].join(' ')
      : `pnpm test${args.length > 1 ? ' (affected workspaces)' : ''}`;
    let passed = false;
    try {
      const result = run(command, args, options);
      passed = succeeded(result);
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
