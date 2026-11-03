import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runResearch } from '../research.mjs';

const fixture = fileURLToPath(new URL('./fixtures/agent-reach.mjs', import.meta.url));
const script = fileURLToPath(new URL('../research.mjs', import.meta.url));

const defaultTestResolver = async (host) => {
  if (isIP(host)) return [host];
  return ['93.184.216.34'];
};

const defaultTestTransport = async () => {
  return { status: 200, headers: {} };
};

const invoke = async (args, mode = 'ok', env = process.env, marker = '-', options = {}) => {
  const result = await runResearch(args, {
    binary: process.execPath,
    prefixArgs: [fixture, mode, marker],
    env,
    resolveHost: options.resolveHost || defaultTestResolver,
    fetchUrl: options.fetchUrl || defaultTestTransport,
    ...options,
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
  test(`allows ${channel} ${action} with an anonymous backend`, async () => {
    const target =
      action === 'search'
        ? 'library examples'
        : {
            web: 'https://docs.example.com/reference',
            github: 'Panniantong/Agent-Reach',
            reddit: 'https://www.reddit.com/r/javascript/comments/abc123/reference/',
            youtube: 'jNQXAC9IVRw',
          }[channel];
    const result = await invoke(['--', channel, action, target]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(payload(result).argv, [channel, upstreamAction, target, '--backend', backend]);
    assert.equal(result.stderr, '');
  });
}

test('forwards only action-specific safe options and joins search words', async () => {
  const search = await invoke([
    'web',
    'search',
    'carrier',
    'api',
    '--limit',
    '3',
    '--max-chars=2000',
  ]);
  assert.deepEqual(payload(search).argv, [
    'web',
    'search',
    'carrier api',
    '--limit',
    '3',
    '--backend',
    'exa',
  ]);
  const transcript = await invoke([
    'youtube',
    'transcript',
    'jNQXAC9IVRw',
    '--lang',
    'en,en-orig',
  ]);
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

test('refuses management, mutation, login channels, unsafe options and malformed inputs before launch', async () => {
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
      const result = await invoke(args, 'ok', process.env, marker);
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

test('missing executable returns only a pinned GitHub install hint', async () => {
  const result = await runResearch(['web', 'search', 'docs'], {
    binary: join(tmpdir(), 'absent-agent-reach-task-ai-160'),
    resolveHost: defaultTestResolver,
    fetchUrl: defaultTestTransport,
  });
  assert.notEqual(result.code, 0);
  assert.match(emitted(result), /agent-reach.*missing/i);
  assert.match(
    emitted(result),
    /uv tool install https:\/\/github\.com\/Panniantong\/Agent-Reach\/releases\/download\/v1\.6\.1\/agent-reach\.zip/
  );
  assert.doesNotMatch(emitted(result), /pip install|releases\/latest|pypi\.org|process\.env/);
});

test('wrong CLI version is refused with the pinned install hint', async () => {
  const result = await invoke(['github', 'search', 'docs'], 'wrong-version');
  assert.notEqual(result.exitCode, 0);
  assert.match(emitted(result), /v1\.6\.1/);
  assert.match(emitted(result), /uv tool install/);
});

for (const mode of ['failure', 'login', 'plain']) {
  test(`upstream ${mode} is a failure without stderr or login fallback`, async () => {
    const result = await invoke(['reddit', 'search', 'docs'], mode);
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(emitted(result), /fixture-cookie|fixture-token|agent-reach login/);
  });
}

test('default output budget includes the truncation marker', async () => {
  const result = await invoke(['web', 'search', 'docs'], 'large');
  assert.equal(result.exitCode, 0);
  assert.equal(emitted(result).length, 20000);
  assert.match(result.stdout, /\[truncated\]/);
});

for (const budget of [1, 12, 13, 100, 2000]) {
  test(`custom budget ${budget} bounds output, including Unicode`, async () => {
    const result = await invoke(
      ['web', 'search', 'docs', '--max-chars', String(budget)],
      'unicode'
    );
    assert.equal(result.exitCode, 0);
    assert.ok(emitted(result).length <= budget);
    assert.ok(emitted(result).isWellFormed());
  });
}

test('failure diagnostics also fit the selected output budget', async () => {
  for (const mode of ['wrong-version', 'failure', 'login', 'plain']) {
    const result = await invoke(['web', 'search', 'docs', '--max-chars', '20'], mode);
    assert.notEqual(result.exitCode, 0);
    assert.ok(emitted(result).length <= 20);
  }
});

test('redacts credentials and arbitrary environment values before truncation', async () => {
  const env = { ...process.env, PRIVATE_RESEARCH_VALUE: 'fixture-private-env-value' };
  for (const budget of [20000, 130, 200]) {
    const result = await invoke(
      ['web', 'search', 'docs', '--max-chars', String(budget)],
      'secrets',
      env
    );
    assert.equal(result.exitCode, 0);
    assert.ok(emitted(result).length <= budget);
    assert.doesNotMatch(
      emitted(result),
      /fixture-cookie|fixture-token|fixture-api-key|fixture-private-env-value|fixture-url-token/
    );
  }
});

test('child cannot inherit operator accounts, config, proxies or runtime injection variables', async () => {
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
    const result = await invoke(['github', 'search', 'docs'], 'environment', env);
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

test('unverifiable CLI version returns the pinned install hint without raw output', async () => {
  const result = await invoke(['web', 'search', 'docs'], 'invalid-version');
  assert.notEqual(result.exitCode, 0);
  assert.match(emitted(result), /uv tool install.*v1\.6\.1/);
  assert.equal(emitted(result).includes('fixture-version-cookie'), false);
});

test('quoted credentials, Basic auth, URL userinfo, access_key, passwd and environment-valued keys are redacted', async () => {
  const env = { ...process.env, PRIVATE_RESEARCH_VALUE: 'fixture-private-env-value' };
  const result = await invoke(['web', 'search', 'docs'], 'quoted-secrets', env);
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

test('untrusted error codes cannot echo environment values', async () => {
  const env = { ...process.env, PRIVATE_RESEARCH_VALUE: 'FIXTURE_PRIVATE_CODE' };
  const result = await invoke(['web', 'search', 'docs'], 'secret-code', env);
  assert.notEqual(result.exitCode, 0);
  assert.equal(emitted(result).includes(env.PRIVATE_RESEARCH_VALUE), false);
});

test('validation refusals honor a valid small budget before launching the CLI', async () => {
  for (const args of [
    ['github', 'post', 'private-input'],
    ['web', 'search', 'docs', '--cookie', 'private-input'],
  ]) {
    const result = await invoke([...args, '--max-chars', '3']);
    assert.notEqual(result.exitCode, 0);
    assert.ok(emitted(result).length <= 3);
  }
});

test('search queries can contain a documentation URL and other words', async () => {
  const query = 'examples using https://docs.example.com/api pagination';
  const result = await invoke(['web', 'search', query]);
  assert.equal(result.exitCode, 0);
  assert.equal(payload(result).argv[2], query);
});

test('schemeless credential URLs are refused before launch', async () => {
  for (const target of [
    'reader:private-input@youtube.com/watch?v=jNQXAC9IVRw',
    'youtube.com/watch?v=jNQXAC9IVRw&token=private-input',
  ]) {
    const result = await runResearch(['youtube', 'transcript', target], {
      binary: join(tmpdir(), 'absent-agent-reach-task-ai-160'),
      resolveHost: defaultTestResolver,
      fetchUrl: defaultTestTransport,
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(emitted(result), /URLs without credentials only/);
    assert.doesNotMatch(emitted(result), /missing|private-input/);
  }
});

test('short environment values are redacted when emitted as values', async () => {
  const result = await invoke(['web', 'search', 'docs'], 'short-env', {
    ...process.env,
    PRIVATE_RESEARCH_VALUE: 'xyz',
  });
  assert.equal(result.exitCode, 0);
  assert.equal(emitted(result).includes('xyz'), false);
});

test('boolean and common non-secret environment values do not corrupt payload booleans', async () => {
  const result = await invoke(['github', 'search', 'docs'], 'environment', {
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

test('private address and unsafe redirect targets are refused before launch', async () => {
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
      const result = await invoke(args, 'ok', process.env, marker);
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

test('destination safety enforces DNS resolution to public IP and refuses private address destinations before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-dns-dest-'));
  const marker = join(root, 'calls');
  try {
    for (const [host, privateIp] of [
      ['internal.example.com', '10.0.0.1'],
      ['loopback.example.com', '127.0.0.1'],
      ['metadata.example.com', '169.254.169.254'],
      ['lan.example.com', '192.168.1.1'],
      ['cgnat.example.com', '100.64.0.1'],
      ['ipv6-loopback.example.com', '::1'],
      ['ipv6-ula.example.com', 'fc00::1'],
      ['ipv6-linklocal.example.com', 'fe80::1'],
    ]) {
      const result = await invoke(
        ['web', 'read', `https://${host}/reference`],
        'ok',
        process.env,
        marker,
        {
          resolveHost: async (h) => (h === host ? [privateIp] : ['93.184.216.34']),
        }
      );
      assert.notEqual(result.exitCode, 0);
      assert.match(emitted(result), /refused/i);
      assert.match(emitted(result), /private or restricted address/i);
    }
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});

test('destination safety follows redirect chains and refuses private or credential-bearing redirect destinations before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-redirect-dest-'));
  const marker = join(root, 'calls');
  try {
    // 1. Redirect to private IPv4 / metadata
    const r1 = await invoke(
      ['web', 'read', 'https://public.example.com/redirect-meta'],
      'ok',
      process.env,
      marker,
      {
        fetchUrl: async () => ({
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
      }
    );
    assert.notEqual(r1.exitCode, 0);
    assert.match(emitted(r1), /refused/i);

    // 2. Redirect to private loopback
    const r2 = await invoke(
      ['web', 'read', 'https://public.example.com/redirect-local'],
      'ok',
      process.env,
      marker,
      {
        fetchUrl: async () => ({
          status: 301,
          headers: { location: 'http://127.0.0.1:8080/private' },
        }),
      }
    );
    assert.notEqual(r2.exitCode, 0);
    assert.match(emitted(r2), /refused/i);

    // 3. Multi-hop redirect: hop 1 -> hop 2 -> private IP
    const r3 = await invoke(
      ['web', 'read', 'https://public.example.com/hop1'],
      'ok',
      process.env,
      marker,
      {
        fetchUrl: async (u) => {
          if (u.includes('hop1')) {
            return { status: 302, headers: { location: 'https://public.example.com/hop2' } };
          }
          return { status: 302, headers: { location: 'http://10.0.0.1/admin' } };
        },
      }
    );
    assert.notEqual(r3.exitCode, 0);
    assert.match(emitted(r3), /refused/i);

    // 4. Redirect to credential-bearing URL
    const r4 = await invoke(
      ['web', 'read', 'https://public.example.com/redirect-token'],
      'ok',
      process.env,
      marker,
      {
        fetchUrl: async () => ({
          status: 302,
          headers: { location: 'https://docs.example.com?token=fixture-secret' },
        }),
      }
    );
    assert.notEqual(r4.exitCode, 0);
    assert.match(emitted(r4), /refused/i);
    assert.doesNotMatch(emitted(r4), /fixture-secret/);

    // 5. Redirect to FQDN resolving to private address
    const r5 = await invoke(
      ['web', 'read', 'https://public.example.com/redirect-fqdn'],
      'ok',
      process.env,
      marker,
      {
        fetchUrl: async () => ({
          status: 302,
          headers: { location: 'https://backend.internal.example/api' },
        }),
        resolveHost: async (h) =>
          h === 'backend.internal.example' ? ['172.16.0.5'] : ['93.184.216.34'],
      }
    );
    assert.notEqual(r5.exitCode, 0);
    assert.match(emitted(r5), /refused/i);

    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});

test('punctuation-embedded credential URLs in search queries are recognized and refused before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-punct-'));
  const marker = join(root, 'calls');
  try {
    for (const query of [
      'lookup (docs.example.com?token=fixture-secret)',
      'lookup (https://docs.example.com?token=fixture-secret)',
      'lookup [docs.example.com?token=fixture-secret]',
      'lookup [https://docs.example.com?token=fixture-secret]',
      'lookup <docs.example.com?token=fixture-secret>',
      'lookup "docs.example.com?token=fixture-secret"',
      "lookup 'docs.example.com?token=fixture-secret'",
      'lookup {docs.example.com?token=fixture-secret}',
      'lookup (docs.example.com?token=fixture-secret).',
      'lookup (docs.example.com?token=fixture-secret), see details',
      'lookup(docs.example.com?token=fixture-secret)',
    ]) {
      const result = await invoke(['web', 'search', query], 'ok', process.env, marker);
      assert.notEqual(result.exitCode, 0);
      assert.match(emitted(result), /refused/i);
      assert.doesNotMatch(emitted(result), /fixture-secret/);
    }
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});

test('standard credential parameters (key, sig, signature) in read and search URLs are refused before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-std-cred-'));
  const marker = join(root, 'calls');
  try {
    for (const args of [
      ['web', 'read', 'https://maps.googleapis.com/maps/api/geocode/json?address=Hanoi&key=fixture-secret'],
      ['web', 'read', 'https://storage.azure.com/container/blob.txt?sv=2020-08-04&sp=r&sig=fixture-secret'],
      ['web', 'read', 'https://s3.amazonaws.com/bucket/obj?X-Amz-Signature=fixture-secret'],
      ['web', 'read', 'https://example.com/api?signature=fixture-secret'],
      ['web', 'read', 'https://example.com/#key=fixture-secret'],
      ['web', 'read', 'https://example.com/#sig=fixture-secret'],
      ['web', 'read', 'https://example.com/#signature=fixture-secret'],
      ['web', 'search', 'https://maps.googleapis.com/maps/api/geocode/json?key=fixture-secret'],
      ['web', 'search', 'https://storage.azure.com/blob?sig=fixture-secret'],
      ['web', 'search', 'maps.googleapis.com/maps/api/geocode/json?key=fixture-secret'],
      ['web', 'search', 'storage.azure.com/blob?sig=fixture-secret'],
      ['web', 'search', 'lookup (maps.googleapis.com/maps/api/geocode/json?key=fixture-secret)'],
      ['web', 'search', 'lookup (storage.azure.com/blob?sig=fixture-secret)'],
    ]) {
      const result = await invoke(args, 'ok', process.env, marker);
      assert.notEqual(result.exitCode, 0);
      assert.match(emitted(result), /refused/i);
      assert.doesNotMatch(emitted(result), /fixture-secret/);
    }
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});

test('standard credential parameters (key, sig, signature) in returned URLs, headers and JSON are masked', async () => {
  const env = { ...process.env, PRIVATE_RESEARCH_VALUE: 'fixture-private-env-value' };
  const resultSecrets = await invoke(['web', 'search', 'docs'], 'secrets', env);
  assert.equal(resultSecrets.exitCode, 0);
  for (const secret of [
    'fixture-google-key',
    'fixture-azure-sig',
    'fixture-aws-sig',
    'fixture-sig-value',
  ]) {
    assert.equal(emitted(resultSecrets).includes(secret), false, `Must not contain ${secret}`);
  }

  const resultQuoted = await invoke(['web', 'search', 'docs'], 'quoted-secrets', env);
  assert.equal(resultQuoted.exitCode, 0);
  for (const secret of [
    'fixture-quoted-single-key',
    'fixture-quoted-single-sig',
    'fixture-quoted-single-signature',
  ]) {
    assert.equal(emitted(resultQuoted).includes(secret), false, `Must not contain ${secret}`);
  }
});

test('schemeless credential URLs and sensitive keys (passwd, access_key) in search and read are refused before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-cred-target-'));
  const marker = join(root, 'calls');
  try {
    for (const args of [
      ['web', 'search', 'docs.example.com?token=private-input'],
      ['web', 'search', 'docs.example.com?passwd=private-input'],
      ['web', 'search', 'docs.example.com?access_key=private-input'],
      ['web', 'search', 'lookup docs.example.com?token=private-input'],
      ['web', 'search', 'reader:private-input@example.com'],
      ['web', 'search', 'https://docs.example.com/#access_token=private-input'],
      ['web', 'search', 'docs.example.com/#access_token=private-input'],
      ['web', 'read', 'https://docs.example.com/#access_token=private-input'],
      ['web', 'read', 'docs.example.com/#access_token=private-input'],
      ['web', 'read', 'https://example.com/#passwd=private-input'],
      ['web', 'read', 'https://example.com/#access_key=private-input'],
      ['web', 'read', 'https://example.com/#http://169.254.169.254/latest/meta-data/'],
      ['web', 'read', 'https://example.com/#http://127.0.0.1:8080/private'],
      ['web', 'read', 'https://example.com?passwd=private-input'],
      ['web', 'read', 'https://example.com?access_key=private-input'],
      ['web', 'read', 'example.com?passwd=private-input'],
      ['web', 'read', 'example.com?access_key=private-input'],
    ]) {
      const result = await invoke(args, 'ok', process.env, marker);
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

test('duplicate budget validation honors the selected small budget', async () => {
  for (const args of [
    ['web', 'search', 'docs', '--max-chars', '3', '--max-chars', '4'],
    ['web', 'search', 'docs', '--max-chars=3', '--max-chars=4'],
    ['web', 'search', 'docs', '--max-chars', '3', '--max-chars', 'invalid'],
  ]) {
    const result = await invoke(args);
    assert.notEqual(result.exitCode, 0);
    assert.ok(emitted(result).length <= 3);
  }
});

test('normal question search queries with question marks are not rejected as unsafe URLs', async () => {
  const query = 'How does pagination work?';
  const result = await invoke(['web', 'search', query]);
  assert.equal(result.exitCode, 0);
  assert.equal(payload(result).argv[2], query);
});

test('PR contract validation: .oc/pr-body.md contains no placeholders and satisfies contract gate', () => {
  const prBodyPath = resolve(fileURLToPath(new URL('../../../.oc/pr-body.md', import.meta.url)));
  assert.ok(existsSync(prBodyPath), '.oc/pr-body.md must exist');
  const body = readFileSync(prBodyPath, 'utf8');

  // Must not contain template placeholders <...>
  const placeholders = body.match(/<[^>\n]+>/g);
  assert.equal(placeholders, null, `PR body must not contain placeholders: ${placeholders}`);

  // Must not contain TBD or TODO
  assert.equal(/\b(?:TBD|TODO)\b/.test(body), false, 'PR body must not contain TBD/TODO');

  // Must not contain unchecked items
  assert.equal(body.includes('- [ ]'), false, 'PR body must not contain unchecked items');

  // Must contain READY_FOR_CODEX marker
  assert.ok(body.includes('Review status: READY_FOR_CODEX'), 'PR body must have READY_FOR_CODEX');

  // Must reference TASK-AI-160
  assert.ok(body.includes('TASK-AI-160'), 'PR body must reference TASK-AI-160');

  // Must contain all 10 required headings
  const requiredHeadings = [
    '## Work Item',
    '## Source requirements',
    '## Scope integrity',
    '## Implementation',
    '## Acceptance evidence',
    '## Verification',
    '## Safety and recovery',
    '## Documentation and traceability',
    '## Risks and limitations',
    '## Codex review',
  ];
  for (const heading of requiredHeadings) {
    assert.ok(body.includes(heading), `PR body must include heading: ${heading}`);
  }
});
