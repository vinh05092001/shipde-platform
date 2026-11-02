const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test, before } = require('node:test');

let runChecks;
before(async () => {
  ({ runChecks } = await import('../../../scripts/ai/prepush-check.mjs'));
});

const gates = [
  'pnpm format:check',
  'pnpm lint',
  'pnpm typecheck',
  'pnpm security:secrets',
  'git diff --check origin/main...HEAD',
  'pnpm test',
];
const base = 'a'.repeat(40);

function fixture(overrides = {}) {
  const calls = [];
  const lines = [];
  const run = (command, args, options) => {
    const name = [command, ...args].join(' ');
    calls.push({ name, options });
    if (Object.hasOwn(overrides, name)) {
      const value = overrides[name];
      if (value instanceof Error) throw value;
      return value;
    }
    if (args[0] === 'merge-base') return { status: 0, stdout: base };
    if (args.includes('list')) return { status: 0, stdout: '[]' };
    if (args.includes('--dry-run=json')) return { status: 1, stdout: '' };
    if (args.includes('--name-only') && args.includes(base)) {
      return { status: 0, stdout: 'apps/api/src/api.test.ts\0' };
    }
    return { status: 0, stdout: '' };
  };
  const code = runChecks({ run, write: (line) => lines.push(line), cwd: process.cwd() });
  return { calls, lines, code };
}

test('gates run in order, with exactly one summary each and a final PASS', () => {
  const { calls, lines, code } = fixture();
  assert.equal(code, 0);
  assert.deepEqual(
    calls.filter((c) => gates.includes(c.name)).map((c) => c.name),
    gates
  );
  assert.deepEqual(lines, [...gates.map((g) => `PASS ${g}`), 'PASS ai:check']);
  assert.ok(calls.every((c) => c.options.env.BASE_SHA === 'origin/main'));
  assert.ok(calls.every((c) => c.options.env.TURBO_SCM_BASE === 'origin/main'));
  assert.ok(calls.filter((c) => gates.includes(c.name)).every((c) => c.options.stdio === 'ignore'));
});

for (const [index, gate] of gates.entries()) {
  test(`fails fast at ${gate} without leaking child output`, () => {
    const { calls, lines, code } = fixture({
      [gate]: { status: 2, stdout: 'private child output', stderr: 'private environment value' },
    });
    assert.equal(code, 1);
    assert.deepEqual(
      calls.filter((c) => gates.includes(c.name)).map((c) => c.name),
      gates.slice(0, index + 1)
    );
    assert.deepEqual(lines, [
      ...gates.slice(0, index).map((g) => `PASS ${g}`),
      `FAIL ${gate}`,
      'FAIL ai:check',
    ]);
  });
}

test('spawn errors, signals and thrown errors fail closed without error text', () => {
  for (const [index, gate] of gates.entries()) {
    for (const failure of [
      { status: null, error: new Error('private spawn error') },
      { status: null, signal: 'SIGTERM' },
      { status: 0, error: new Error('private spawn error') },
      { status: 0, signal: 'SIGTERM' },
      new Error('private thrown error'),
    ]) {
      const result = fixture({ [gate]: failure });
      assert.equal(result.code, 1);
      assert.deepEqual(
        result.calls.filter((c) => gates.includes(c.name)).map((c) => c.name),
        gates.slice(0, index + 1)
      );
      assert.deepEqual(result.lines, [
        ...gates.slice(0, index).map((g) => `PASS ${g}`),
        `FAIL ${gate}`,
        'FAIL ai:check',
      ]);
    }
  }
});

const probe = `pnpm --filter ...[${base}] list --depth -1 --json`;
test('filters workspace tests and dependents from the merge-base, not the moving main tip', () => {
  const { calls, lines, code } = fixture({
    [probe]: { status: 0, stdout: JSON.stringify([{ path: `${process.cwd()}/apps/api` }]) },
  });
  assert.equal(code, 0);
  assert.equal(calls.at(-1).name, `pnpm --filter ...[${base}] test`);
  assert.equal(lines.at(-2), 'PASS pnpm test (affected workspaces)');
});

test('unsupported filtering, root changes, untracked files or malformed metadata use full tests', () => {
  for (const overrides of [
    { [probe]: { status: 1 } },
    { [probe]: { status: 0, stdout: 'invalid JSON' } },
    { [probe]: { status: 0, stdout: '[{}]' } },
    { [probe]: { status: 0, stdout: JSON.stringify([{ path: process.cwd() }]) } },
    {
      'git ls-files --others --exclude-standard -z': {
        status: 0,
        stdout: 'apps/api/new.test.ts\0',
      },
    },
    { 'git merge-base origin/main HEAD': { status: 1 } },
  ]) {
    const result = fixture(overrides);
    assert.equal(result.code, 0);
    assert.equal(result.calls.at(-1).name, 'pnpm test');
  }
});

test('a filtered test failure never falls back to disguise it as a pass', () => {
  const result = fixture({
    [probe]: { status: 0, stdout: JSON.stringify([{ path: `${process.cwd()}/apps/api` }]) },
    [`pnpm --filter ...[${base}] test`]: { status: 1 },
  });
  assert.equal(result.code, 1);
  assert.equal(result.lines.at(-2), 'FAIL pnpm test (affected workspaces)');
  assert.ok(!result.calls.some((c) => c.name === 'pnpm test'));
});

const turboProbe = 'pnpm exec turbo run test --affected --dry-run=json';
const workspaceSelection = {
  status: 0,
  stdout: JSON.stringify([{ name: '@shipde/api', path: join(process.cwd(), 'apps/api') }]),
};
const turboSelection = {
  status: 0,
  stdout:
    '• turbo 2.10.12\n{"tasks":[{"task":"test","package":"@shipde/api","command":"node test.js"}]}',
};
test('uses turborepo affected test runner when turbo can compute the affected set', () => {
  for (const stdout of [
    turboSelection.stdout,
    turboSelection.stdout.replace('\n', '\r\n'),
    turboSelection.stdout.slice(turboSelection.stdout.indexOf('{')),
  ]) {
    const { calls, lines, code } = fixture({
      [probe]: workspaceSelection,
      [turboProbe]: { status: 0, stdout },
    });
    assert.equal(code, 0);
    assert.equal(calls.at(-1).name, 'pnpm exec turbo run test --affected');
    assert.equal(lines.at(-2), 'PASS pnpm test (affected workspaces)');
    assert.equal(calls.at(-1).options.env.TURBO_SCM_BASE, 'origin/main');
  }
});

test('falls back from turbo error to pnpm filter or full tests', () => {
  const { calls, lines, code } = fixture({
    [turboProbe]: { status: 1, stdout: 'shallow clone' },
    [probe]: { status: 0, stdout: JSON.stringify([{ path: `${process.cwd()}/apps/api` }]) },
  });
  assert.equal(code, 0);
  assert.equal(calls.at(-1).name, `pnpm --filter ...[${base}] test`);
  assert.equal(lines.at(-2), 'PASS pnpm test (affected workspaces)');
});

test('empty or non-runnable Turbo task selections run full tests, never an empty success', () => {
  for (const tasks of [
    [],
    [null],
    [{}],
    [{ task: 'test', package: '@shipde/api' }],
    [{ task: 'test', package: '@shipde/api', command: '' }],
    [{ task: 'build', package: '@shipde/api', command: 'tsc' }],
    [{ task: 'test', package: '@shipde/api', command: '<NONEXISTENT>' }],
  ]) {
    const result = fixture({
      [probe]: workspaceSelection,
      [turboProbe]: { status: 0, stdout: JSON.stringify({ tasks }) },
    });
    assert.equal(result.calls.at(-1).name, 'pnpm test');
    assert.equal(result.code, 0);
  }
});

test('successful Turbo probes with missing or malformed task metadata require full tests', () => {
  for (const stdout of [
    undefined,
    null,
    {},
    '',
    'private selection diagnostic',
    '{}',
    'null',
    '[]',
    '{"tasks":null}',
    '{"tasks":{}}',
    '{"tasks":[',
  ]) {
    const result = fixture({
      [probe]: workspaceSelection,
      [turboProbe]: { status: 0, stdout },
      'pnpm test': { status: 1, stderr: 'private full-test output' },
    });
    assert.equal(result.calls.at(-1).name, 'pnpm test');
    assert.equal(result.code, 1);
    assert.deepEqual(result.lines.slice(-2), ['FAIL pnpm test', 'FAIL ai:check']);
  }
});

test('Turbo JSON fragments surrounded by unexpected output cannot narrow tests', () => {
  const metadata = turboSelection.stdout.slice(turboSelection.stdout.indexOf('{'));
  for (const stdout of [
    `private diagnostic\n${metadata}`,
    `${metadata}\nprivate diagnostic`,
    `${metadata}\n[truncated`,
  ]) {
    const result = fixture({
      [probe]: workspaceSelection,
      [turboProbe]: { status: 0, stdout },
      'pnpm test': { status: 1, stderr: 'private full-test output' },
    });
    assert.equal(result.calls.at(-1).name, 'pnpm test');
    assert.equal(result.code, 1);
    assert.deepEqual(result.lines.slice(-2), ['FAIL pnpm test', 'FAIL ai:check']);
  }
});

test('Turbo cannot omit an affected dependent from the verified workspace selection', () => {
  const result = fixture({
    [probe]: {
      status: 0,
      stdout: JSON.stringify([
        { name: '@shipde/api', path: join(process.cwd(), 'apps/api') },
        { name: '@shipde/web', path: join(process.cwd(), 'apps/web') },
      ]),
    },
    [turboProbe]: turboSelection,
  });
  assert.equal(result.calls.at(-1).name, 'pnpm test');
});

test('root, empty and unknown workspace selections cannot be overridden by a Turbo success', () => {
  for (const packages of [
    [],
    [{ path: process.cwd() }],
    [{ path: join(process.cwd(), '..', 'another-worktree') }],
    [{ path: 'apps/api' }],
    [{ path: '' }],
    [null],
  ]) {
    const result = fixture({
      [probe]: { status: 0, stdout: JSON.stringify(packages) },
      [turboProbe]: turboSelection,
    });
    assert.equal(result.calls.at(-1).name, 'pnpm test');
    assert.ok(!result.calls.some((c) => c.name === turboProbe));
  }
});

const trackedDiffs = [
  `git diff --name-only --no-renames -z ${base} HEAD`,
  'git diff --name-only --no-renames -z --cached',
  'git diff --name-only --no-renames -z',
];
test('tracked staged or unstaged workspace edits remain eligible for affected tests', () => {
  for (const diff of trackedDiffs.slice(1)) {
    const result = fixture({
      [probe]: workspaceSelection,
      [turboProbe]: turboSelection,
      [trackedDiffs[0]]: { status: 0, stdout: '' },
      [diff]: { status: 0, stdout: 'apps/api/src/api.test.ts\0' },
    });
    assert.equal(result.calls.at(-1).name, 'pnpm exec turbo run test --affected');
    assert.equal(result.code, 0);
  }
});

test('shared, deleted and uncovered files in commits, index or worktree require full tests', () => {
  for (const diff of trackedDiffs) {
    for (const path of ['package.json', 'scripts/shared.mjs', 'apps/deleted/src/test.ts']) {
      const result = fixture({
        [probe]: workspaceSelection,
        [turboProbe]: turboSelection,
        [diff]: { status: 0, stdout: `${path}\0` },
      });
      assert.equal(result.calls.at(-1).name, 'pnpm test', `${diff}: ${path}`);
    }
  }
});

test('empty or truncated changed-file evidence requires full tests', () => {
  for (const stdout of ['', 'apps/api/src/api.test.ts']) {
    const result = fixture({
      [probe]: workspaceSelection,
      [turboProbe]: turboSelection,
      [trackedDiffs[0]]: { status: 0, stdout },
    });
    assert.equal(result.calls.at(-1).name, 'pnpm test');
  }
});

test('failed or incomplete scope probes cannot narrow tests or expose their output', () => {
  const probes = {
    'git ls-files --others --exclude-standard -z': { status: 0, stdout: '' },
    'git merge-base origin/main HEAD': { status: 0, stdout: base },
    [probe]: workspaceSelection,
    ...Object.fromEntries(trackedDiffs.map((name) => [name, { status: 0, stdout: '' }])),
  };
  for (const [name, success] of Object.entries(probes)) {
    for (const failure of [
      { ...success, error: new Error('private scope error') },
      { ...success, signal: 'SIGTERM' },
      { status: 0 },
      { status: 1, stdout: 'private scope output' },
    ]) {
      const result = fixture({
        [probe]: workspaceSelection,
        [turboProbe]: turboSelection,
        [name]: failure,
      });
      assert.equal(result.calls.at(-1).name, 'pnpm test', name);
      assert.deepEqual(result.lines, [...gates.map((gate) => `PASS ${gate}`), 'PASS ai:check']);
    }
  }
});

test('malformed pnpm metadata with a JSON fragment requires full tests', () => {
  const result = fixture({
    [probe]: { status: 0, stdout: `private diagnostic\n${workspaceSelection.stdout}` },
  });
  assert.equal(result.calls.at(-1).name, 'pnpm test');
  assert.ok(result.lines.every((line) => !line.includes('private diagnostic')));
});

test('Turbo spawn errors or signals use the verified pnpm scope', () => {
  for (const failure of [
    { ...turboSelection, signal: 'SIGTERM' },
    { ...turboSelection, error: new Error('private turbo error') },
    new Error('private turbo exception'),
  ]) {
    const result = fixture({ [probe]: workspaceSelection, [turboProbe]: failure });
    assert.equal(result.calls.at(-1).name, `pnpm --filter ...[${base}] test`);
    assert.equal(result.lines.at(-2), 'PASS pnpm test (affected workspaces)');
  }
});

test('a Turbo test failure remains a failure without rerunning full or pnpm-filtered tests', () => {
  const result = fixture({
    [probe]: workspaceSelection,
    [turboProbe]: turboSelection,
    'pnpm exec turbo run test --affected': { status: 1, stderr: 'private test output' },
  });
  assert.equal(result.code, 1);
  assert.deepEqual(result.lines.slice(-2), [
    'FAIL pnpm test (affected workspaces)',
    'FAIL ai:check',
  ]);
  assert.ok(
    !result.calls.some(
      (c) => c.name === 'pnpm test' || c.name === `pnpm --filter ...[${base}] test`
    )
  );
});

test('the hook invokes ai:check and its skip command requires the exact explicit variable', () => {
  const hook = readFileSync(join(__dirname, '../../../lefthook.yml'), 'utf8');
  const command = hook.match(/- run: node -e "([^"]+)"/)[1];
  assert.match(hook, /run: pnpm ai:check/);
  for (const value of [undefined, '', '0', 'true', '1']) {
    const env = { ...process.env };
    delete env.SHIPDE_SKIP_AI_CHECK;
    if (value !== undefined) env.SHIPDE_SKIP_AI_CHECK = value;
    const result = spawnSync(process.execPath, ['-e', command], { env, encoding: 'utf8' });
    assert.equal(result.status, value === '1' ? 0 : 1);
    assert.equal(result.stdout + result.stderr, '');
  }
});

test('the direct command cannot be skipped using the hook exception', () => {
  const previous = process.env.SHIPDE_SKIP_AI_CHECK;
  process.env.SHIPDE_SKIP_AI_CHECK = '1';
  try {
    const result = fixture({ 'pnpm format:check': { status: 1 } });
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.SHIPDE_SKIP_AI_CHECK;
    else process.env.SHIPDE_SKIP_AI_CHECK = previous;
  }
});
