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
  assert.ok(calls.every((c) => c.options.stdio !== 'inherit'));
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
  for (const failure of [
    { status: null, error: new Error('private spawn error') },
    { status: null, signal: 'SIGTERM' },
    new Error('private thrown error'),
  ]) {
    const result = fixture({ 'pnpm format:check': failure });
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.lines, ['FAIL pnpm format:check', 'FAIL ai:check']);
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
test('uses turborepo affected test runner when turbo can compute the affected set', () => {
  const { calls, lines, code } = fixture({
    [turboProbe]: { status: 0, stdout: '• turbo 2.10.12\n{"tasks":[{"task":"test"}]}' },
  });
  assert.equal(code, 0);
  assert.equal(calls.at(-1).name, 'pnpm exec turbo run test --affected');
  assert.equal(lines.at(-2), 'PASS pnpm test (affected workspaces)');
  assert.equal(calls.at(-1).options.env.TURBO_SCM_BASE, 'origin/main');
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
