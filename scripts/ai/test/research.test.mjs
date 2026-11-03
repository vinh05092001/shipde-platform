import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runResearch } from '../research.mjs';

const fixture = fileURLToPath(new URL('./fixtures/agent-reach.mjs', import.meta.url));
const script = fileURLToPath(new URL('../research.mjs', import.meta.url));
const invoke = (args, mode = 'ok', env = process.env, marker = '-') => {
  const result = runResearch(args, {
    binary: process.execPath,
    prefixArgs: [fixture, mode, marker],
    env,
  });
  return { ...result, exitCode: result.code };
};
const emitted = (result) => result.stdout + result.stderr;
const payload = (result) => JSON.parse(JSON.parse(result.stdout).items[0].text);

for (const [channel, action, backend, upstreamAction] of [
  ['web', 'read', 'jina', 'read'],
  ['web', 'search', 'exa', 'search'],
  ['github', 'search', 'github-api', 'search'],
  ['github', 'read', 'github-api', 'read'],
  ['reddit', 'read', 'public-web', 'read'],
  ['reddit', 'search', 'public-web', 'search'],
  ['youtube', 'transcript', 'yt-dlp', 'subtitle'],
]) {
  test(`allows ${channel} ${action} with an anonymous backend`, () => {
    const target =
      action === 'search'
        ? 'library examples'
        : {
            web: 'https://docs.example.com/reference',
            github: 'Panniantong/Agent-Reach',
            reddit: 'https://www.reddit.com/r/javascript/comments/abc123/reference/',
            youtube: 'jNQXAC9IVRw',
          }[channel];
    const result = invoke(['--', channel, action, target]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(payload(result).argv, [channel, upstreamAction, target, '--backend', backend]);
    assert.equal(result.stderr, '');
  });
}

test('forwards only action-specific safe options and joins search words', () => {
  const search = invoke(['web', 'search', 'carrier', 'api', '--limit', '3', '--max-chars=2000']);
  assert.deepEqual(payload(search).argv, [
    'web',
    'search',
    'carrier api',
    '--limit',
    '3',
    '--backend',
    'exa',
  ]);
  const transcript = invoke(['youtube', 'transcript', 'jNQXAC9IVRw', '--lang', 'en,en-orig']);
  assert.deepEqual(payload(transcript).argv, [
    'youtube',
    'subtitle',
    'jNQXAC9IVRw',
    '--lang',
    'en,en-orig',
    '--backend',
    'yt-dlp',
  ]);
});

test('refuses management, mutation, login channels, unsafe options and malformed inputs before launch', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-test-'));
  const marker = join(root, 'calls');
  try {
    for (const args of [
      [],
      ['web'],
      ['login', 'reddit'],
      ['setup', 'web'],
      ['configure', 'github-token'],
      ['browser', 'setup'],
      ['twitter', 'search', 'query'],
      ['xiaohongshu', 'read', 'post'],
      ['github', 'post', 'issue'],
      ['reddit', 'comment', 'post'],
      ['youtube', 'transcribe', 'video'],
      ['youtube', 'subtitle', 'video'],
      ['web', 'read'],
      ['web', 'read', 'url', 'another'],
      ['web', 'search', 'query', '--backend', 'opencli'],
      ['web', 'search', 'query', '--cookie', 'private-input'],
      ['web', 'search', 'query', '--token=private-input'],
      ['web', 'search', 'query', '--verbose'],
      ['web', 'search', 'query', '--', 'configure'],
      ['web', 'read', 'url', '--limit', '1'],
      ['web', 'search', 'query', '--lang', 'en'],
      ['web', 'search', 'query', '--limit', '0'],
      ['web', 'search', 'query', '--limit', '2', '--limit', '3'],
      ['youtube', 'transcript', 'video', '--lang', '--cookies'],
      ['web', 'read', 'https://user:private-input@example.com'],
      ['web', 'read', 'https://example.com?token=private-input'],
      ...['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', ''].map((n) => [
        'web',
        'search',
        'query',
        `--max-chars=${n}`,
      ]),
      ['web', 'search', 'query', '--max-chars'],
      ['web', 'search', 'query', '--max-chars', '100', '--max-chars', '200'],
    ]) {
      const result = invoke(args, 'ok', process.env, marker);
      assert.notEqual(result.exitCode, 0);
      assert.match(emitted(result), /refused/i);
      assert.doesNotMatch(emitted(result), /private-input/);
    }
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(marker), root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing executable returns only a pinned GitHub install hint', () => {
  const result = runResearch(['web', 'search', 'docs'], {
    binary: join(tmpdir(), 'absent-agent-reach-task-ai-160'),
  });
  assert.notEqual(result.code, 0);
  assert.match(emitted(result), /agent-reach.*missing/i);
  assert.match(
    emitted(result),
    /uv tool install https:\/\/github\.com\/Panniantong\/Agent-Reach\/releases\/download\/v1\.6\.1\/agent-reach\.zip/
  );
  assert.doesNotMatch(emitted(result), /pip install|releases\/latest|pypi\.org|process\.env/);
});

test('wrong CLI version is refused with the pinned install hint', () => {
  const result = invoke(['github', 'search', 'docs'], 'wrong-version');
  assert.notEqual(result.exitCode, 0);
  assert.match(emitted(result), /v1\.6\.1/);
  assert.match(emitted(result), /uv tool install/);
});

for (const mode of ['failure', 'login', 'plain']) {
  test(`upstream ${mode} is a failure without stderr or login fallback`, () => {
    const result = invoke(['reddit', 'search', 'docs'], mode);
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(emitted(result), /fixture-cookie|fixture-token|agent-reach login/);
  });
}

test('default output budget includes the truncation marker', () => {
  const result = invoke(['web', 'search', 'docs'], 'large');
  assert.equal(result.exitCode, 0);
  assert.equal(emitted(result).length, 20000);
  assert.match(result.stdout, /\[truncated\]/);
});

for (const budget of [1, 12, 13, 100, 2000]) {
  test(`custom budget ${budget} bounds output, including Unicode`, () => {
    const result = invoke(['web', 'search', 'docs', '--max-chars', String(budget)], 'unicode');
    assert.equal(result.exitCode, 0);
    assert.ok(emitted(result).length <= budget);
    assert.ok(emitted(result).isWellFormed());
  });
}

test('failure diagnostics also fit the selected output budget', () => {
  for (const mode of ['wrong-version', 'failure', 'login', 'plain']) {
    const result = invoke(['web', 'search', 'docs', '--max-chars', '20'], mode);
    assert.notEqual(result.exitCode, 0);
    assert.ok(emitted(result).length <= 20);
  }
});

test('redacts credentials and arbitrary environment values before truncation', () => {
  const env = { ...process.env, PRIVATE_RESEARCH_VALUE: 'fixture-private-env-value' };
  for (const budget of [20000, 130, 200]) {
    const result = invoke(['web', 'search', 'docs', '--max-chars', String(budget)], 'secrets', env);
    assert.equal(result.exitCode, 0);
    assert.ok(emitted(result).length <= budget);
    assert.doesNotMatch(
      emitted(result),
      /fixture-cookie|fixture-token|fixture-api-key|fixture-private-env-value|fixture-url-token/
    );
  }
});

test('child cannot inherit operator accounts, config, proxies or runtime injection variables', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-operator-fixture-'));
  try {
    mkdirSync(join(root, '.agent-reach'));
    writeFileSync(join(root, '.agent-reach', 'config.yaml'), 'github_token: fixture-only\n');
    writeFileSync(join(root, 'yt-dlp.conf'), '--cookies fixture-only\n');
    const env = {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      APPDATA: root,
      LOCALAPPDATA: root,
      GH_TOKEN: 'fixture-only',
      GITHUB_TOKEN: 'fixture-only',
      GROQ_KEY: 'fixture-only',
      OPENAI_API_KEY: 'fixture-only',
      HTTPS_PROXY: 'fixture-only',
      NODE_OPTIONS: '--not-a-real-option',
      PYTHONPATH: root,
      PRIVATE_RESEARCH_VALUE: 'fixture-only',
    };
    const result = invoke(['github', 'search', 'docs'], 'environment', env);
    assert.equal(result.exitCode, 0);
    const info = payload(result);
    assert.equal(info.credentialConfig, false);
    assert.equal(info.ytdlpConfig, false);
    assert.equal(info.isolatedCwd, true);
    for (const key of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GROQ_KEY',
      'OPENAI_API_KEY',
      'HTTPS_PROXY',
      'NODE_OPTIONS',
      'PYTHONPATH',
      'PRIVATE_RESEARCH_VALUE',
    ]) {
      assert.equal(info.keys.includes(key), false);
    }
  } finally {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});

test('real CLI entry point refuses an unsafe action without echoing arguments', () => {
  const result = spawnSync(process.execPath, [script, '--', 'github', 'post', 'private-input'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refused/i);
  assert.doesNotMatch(result.stdout + result.stderr, /private-input/);
});

test('unverifiable CLI version returns the pinned install hint without raw output', () => {
  const result = invoke(['web', 'search', 'docs'], 'invalid-version');
  assert.notEqual(result.exitCode, 0);
  assert.match(emitted(result), /uv tool install.*v1\.6\.1/);
  assert.equal(emitted(result).includes('fixture-version-cookie'), false);
});

test('quoted credentials, Basic auth, URL userinfo, access_key, passwd and environment-valued keys are redacted', () => {
  const env = { ...process.env, PRIVATE_RESEARCH_VALUE: 'fixture-private-env-value' };
  const result = invoke(['web', 'search', 'docs'], 'quoted-secrets', env);
  assert.equal(result.exitCode, 0);
  for (const value of [
    'fixture-quoted-cookie',
    'fixture-quoted-key',
    'fixture-quoted-token',
    'fixture-access-key',
    'fixture-passwd',
    'fixture-basic-token',
    'fixture-url-password',
    'fixture-private-env-value',
  ]) {
    assert.equal(emitted(result).includes(value), false);
  }
});

test('untrusted error codes cannot echo environment values', () => {
  const env = { ...process.env, PRIVATE_RESEARCH_VALUE: 'FIXTURE_PRIVATE_CODE' };
  const result = invoke(['web', 'search', 'docs'], 'secret-code', env);
  assert.notEqual(result.exitCode, 0);
  assert.equal(emitted(result).includes(env.PRIVATE_RESEARCH_VALUE), false);
});

test('validation refusals honor a valid small budget before launching the CLI', () => {
  for (const args of [
    ['github', 'post', 'private-input'],
    ['web', 'search', 'docs', '--cookie', 'private-input'],
  ]) {
    const result = invoke([...args, '--max-chars', '3']);
    assert.notEqual(result.exitCode, 0);
    assert.ok(emitted(result).length <= 3);
  }
});

test('search queries can contain a documentation URL and other words', () => {
  const query = 'examples using https://docs.example.com/api pagination';
  const result = invoke(['web', 'search', query]);
  assert.equal(result.exitCode, 0);
  assert.equal(payload(result).argv[2], query);
});

test('schemeless credential URLs are refused before launch', () => {
  for (const target of [
    'reader:private-input@youtube.com/watch?v=jNQXAC9IVRw',
    'youtube.com/watch?v=jNQXAC9IVRw&token=private-input',
  ]) {
    const result = runResearch(['youtube', 'transcript', target], {
      binary: join(tmpdir(), 'absent-agent-reach-task-ai-160'),
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(emitted(result), /URLs without credentials only/);
    assert.doesNotMatch(emitted(result), /missing|private-input/);
  }
});

test('short environment values are redacted when emitted as values', () => {
  const result = invoke(['web', 'search', 'docs'], 'short-env', {
    ...process.env,
    PRIVATE_RESEARCH_VALUE: 'xyz',
  });
  assert.equal(result.exitCode, 0);
  assert.equal(emitted(result).includes('xyz'), false);
});

test('boolean and common non-secret environment values do not corrupt payload booleans', () => {
  const result = invoke(['github', 'search', 'docs'], 'environment', {
    ...process.env,
    GIT_EDITOR: 'false',
    CI: 'true',
    TEST_ZERO: '0',
    TEST_ONE: '1',
    PYTHONIOENCODING: 'utf-8',
  });
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  const info = payload(result);
  assert.equal(info.credentialConfig, false);
  assert.equal(info.ytdlpConfig, false);
  assert.equal(info.isolatedCwd, true);
});

test('private address and unsafe redirect targets are refused before launch', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-private-target-'));
  const marker = join(root, 'calls');
  try {
    for (const args of [
      ['web', 'read', 'http://127.0.0.1:8080/private'],
      ['web', 'read', 'http://169.254.169.254/latest/meta-data/'],
      ['web', 'read', 'http://localhost:8080/private'],
      ['web', 'read', 'http://[::1]:8080/private'],
      ['web', 'read', 'http://10.0.0.1/private'],
      ['web', 'read', 'http://192.168.1.1/private'],
      ['web', 'read', 'http://172.16.0.1/private'],
      ['web', 'read', 'http://metadata.google.internal/'],
      ['web', 'read', 'http://127.0.0.1.nip.io/'],
      ['web', 'read', '127.0.0.1:8080/private'],
      ['web', 'read', 'localhost/private'],
      ['web', 'read', 'https://example.com/redirect?to=http://127.0.0.1:8080/private'],
      ['web', 'read', 'https://example.com/redirect?url=http://169.254.169.254/latest/meta-data/'],
      ['web', 'read', 'https://example.com/redirect?to=http://localhost:3000'],
      ['web', 'read', 'https://example.com/redirect?to=https://user:private-input@example.com'],
      ['web', 'read', 'https://example.com/redirect?to=https://docs.example.com?token=private-input'],
      ['web', 'read', 'https://example.com/redirect?to=http://[::1]:8080/private'],
      ['web', 'read', 'https://example.com/redirect?to=http%3A%2F%2F127.0.0.1%3A8080%2Fprivate'],
      ['web', 'search', 'http://127.0.0.1:8080/private'],
      ['web', 'search', 'http://169.254.169.254/latest/meta-data/'],
      ['web', 'search', '127.0.0.1:8080/private'],
      ['web', 'search', 'localhost:8080/private'],
    ]) {
      const result = invoke(args, 'ok', process.env, marker);
      assert.notEqual(result.exitCode, 0);
      assert.match(emitted(result), /refused/i);
      assert.doesNotMatch(emitted(result), /private-input/);
    }
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(marker), root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('schemeless credential URLs and sensitive keys (passwd, access_key) in search and read are refused before launch', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-cred-target-'));
  const marker = join(root, 'calls');
  try {
    for (const args of [
      ['web', 'search', 'docs.example.com?token=private-input'],
      ['web', 'search', 'docs.example.com?passwd=private-input'],
      ['web', 'search', 'docs.example.com?access_key=private-input'],
      ['web', 'search', 'lookup docs.example.com?token=private-input'],
      ['web', 'search', 'reader:private-input@example.com'],
      ['web', 'read', 'https://example.com?passwd=private-input'],
      ['web', 'read', 'https://example.com?access_key=private-input'],
      ['web', 'read', 'example.com?passwd=private-input'],
      ['web', 'read', 'example.com?access_key=private-input'],
    ]) {
      const result = invoke(args, 'ok', process.env, marker);
      assert.notEqual(result.exitCode, 0);
      assert.match(emitted(result), /refused/i);
      assert.doesNotMatch(emitted(result), /private-input/);
    }
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(marker), root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate budget validation honors the selected small budget', () => {
  for (const args of [
    ['web', 'search', 'docs', '--max-chars', '3', '--max-chars', '4'],
    ['web', 'search', 'docs', '--max-chars=3', '--max-chars=4'],
    ['web', 'search', 'docs', '--max-chars', '3', '--max-chars', 'invalid'],
  ]) {
    const result = invoke(args);
    assert.notEqual(result.exitCode, 0);
    assert.ok(emitted(result).length <= 3);
  }
});
