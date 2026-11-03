import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { defaultRetrieve, runResearch } from '../research.mjs';

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
    retrieve: options.retrieve,
    ...options,
  });
  return { ...result, exitCode: result.code };
};

// The retrieval transport keeps its own resolver so a test can prove that the
// address the wrapper approved is the address actually connected to.
const retrievalTransport = (retrieve, resolveEnteredHost = defaultTestResolver) => ({
  resolveEnteredHost,
  retrieve,
});

// Resolves public content first and a private address on every later lookup: the
// classic DNS-rebinding shape a single preflight resolution cannot catch.
const rebindingResolver = () => {
  let lookups = 0;
  return async () => {
    lookups++;
    return lookups === 1 ? ['93.184.216.34'] : ['127.0.0.1'];
  };
};

const received = [];
const retrievalTransports = {
  // The entered host resolves to a private address at the transport.
  rebindingEnteredHost: retrievalTransport(async (url) => {
    received.push(url);
    return { status: 200, body: 'public' };
  }, rebindingResolver),
  // The entered host is public but the redirect target resolves privately.
  rebindingAfterRedirect: retrievalTransport(async (url) => {
    received.push(url);
    return url.includes('rebind.example.com')
      ? { status: 302, location: 'https://rebind2.example.com/doc' }
      : { status: 200, body: 'public' };
  }, rebindingResolver),
  // A public response for one method and a private redirect for the next.
  headThenPrivateGet: retrievalTransport(async (url, { method }) =>
    method === 'GET'
      ? { status: 302, location: 'http://169.254.169.254/latest/meta-data/' }
      : { status: 200, body: 'public document' }
  ),
  // A redirect loop must be cut off, not followed forever.
  redirectLoop: retrievalTransport(async () => ({
    status: 302,
    location: 'https://public.example.com/loop',
  })),
  // A redirect to a credentialed public destination is refused.
  credentialRedirect: retrievalTransport(async () => ({
    status: 302,
    location: 'https://docs.example.com/?token=fixture-transport-token',
  })),
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
    // Redirect chains are judged by the transport that performs retrieval, so
    // the injected transport below is the only place the hops are observed.
    const redirects = [
      // 1. Redirect to private IPv4 / metadata
      { location: 'http://169.254.169.254/latest/meta-data/', secret: null },
      // 2. Redirect to private loopback
      { location: 'http://127.0.0.1:8080/private', secret: null },
      // 3. Multi-hop redirect: hop 1 -> hop 2 -> private IP
      { location: 'https://public.example.com/hop2', next: 'http://10.0.0.1/admin' },
      // 4. Redirect to credential-bearing URL
      { location: 'https://docs.example.com?token=fixture-secret', secret: 'fixture-secret' },
      // 5. Redirect to FQDN resolving to private address
      {
        location: 'https://backend.internal.example/api',
        resolveHost: async (h) =>
          h === 'backend.internal.example' ? ['172.16.0.5'] : ['93.184.216.34'],
      },
      // 6. Redirect to IPv6 loopback
      { location: 'http://[::1]:8080/private' },
      // 7. Too many redirects
      { location: 'https://public.example.com/again', loop: true },
    ];
    for (const hop of redirects) {
      const r = await invoke(
        ['web', 'read', 'https://public.example.com/start'],
        'ok',
        process.env,
        marker,
        {
          retrieve: retrievalTransport(
            async (u) => ({
              status: 302,
              location: u.includes('/start') ? hop.location : hop.next || hop.location,
            }),
            hop.resolveHost || defaultTestResolver
          ),
        }
      );
      assert.notEqual(r.exitCode, 0, `redirect ${hop.location} must be refused`);
      assert.match(emitted(r), /refused/i);
      if (hop.secret) assert.doesNotMatch(emitted(r), new RegExp(hop.secret));
    }

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

test('retrieval transport refuses a destination that rebinds to a private address after preflight', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-rebind-'));
  const marker = join(root, 'calls');
  try {
    for (const transportName of ['rebindingEnteredHost', 'rebindingAfterRedirect']) {
      const result = await invoke(
        ['web', 'read', 'https://rebind.example.com/doc'],
        'ok',
        process.env,
        marker,
        { retrieve: retrievalTransports[transportName] }
      );
      assert.notEqual(result.exitCode, 0, `${transportName} must be refused`);
      assert.match(emitted(result), /refused/i);
      assert.doesNotMatch(emitted(result), /private-input|rebind\.example\.com/);
    }
    // The transport is reached only through the wrapper's approved hop, so a
    // refused destination never yields a successful research payload.
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(marker), root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('retrieval transport cannot answer public for one method and redirect privately for the next', async () => {
  const result = await invoke(['web', 'read', 'https://public.example.com/document'], 'ok', process.env, '-', {
    retrieve: retrievalTransports.headThenPrivateGet,
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(emitted(result), /refused/i);
  assert.doesNotMatch(emitted(result), /169\.254\.169\.254/);
});

test('retrieval transport refuses redirect loops and credentialed redirect destinations', async () => {
  for (const [name, secret] of [
    ['redirectLoop', null],
    ['credentialRedirect', 'fixture-transport-token'],
  ]) {
    const result = await invoke(
      ['web', 'read', 'https://public.example.com/start'],
      'ok',
      process.env,
      '-',
      { retrieve: retrievalTransports[name] }
    );
    assert.notEqual(result.exitCode, 0, `${name} must be refused`);
    assert.match(emitted(result), /refused/i);
    if (secret) assert.doesNotMatch(emitted(result), new RegExp(secret));
  }
});

test('credential-bearing IPv6 search URLs keep their delimiters and are refused before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-ipv6-cred-'));
  const marker = join(root, 'calls');
  try {
    for (const query of [
      'reader:private-input@[::1]',
      'reader:private-input@[2606:4700::1111]',
      '(reader:private-input@[2606:4700::1111])',
      'lookup https://reader:private-input@[2606:4700::1111]/docs',
      'reader:private-input@[::1]/path',
    ]) {
      const result = await invoke(['web', 'search', query], 'ok', process.env, marker);
      assert.notEqual(result.exitCode, 0, `${query} must be refused`);
      assert.match(emitted(result), /URLs without credentials only/);
      assert.doesNotMatch(emitted(result), /private-input/);
    }
    // A public IPv6 literal without credentials remains a legitimate source.
    const allowed = await invoke(['web', 'search', 'reference https://[2606:4700::1111]/docs']);
    assert.equal(allowed.exitCode, 0);
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(marker), root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('credential-bearing bare userinfo is refused in read and search, including single-label hosts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-bare-userinfo-'));
  const marker = join(root, 'calls');
  try {
    for (const args of [
      ['web', 'search', 'SECRETVALUE@intranet?token=private-input'],
      ['web', 'search', 'reader:private-input@intranet'],
      ['web', 'search', 'shopee?token=private-input'],
      ['web', 'read', 'intranet?token=private-input'],
      ['web', 'read', 'reader:private-input@intranet'],
    ]) {
      const result = await invoke(args, 'ok', process.env, marker);
      assert.notEqual(result.exitCode, 0, `${args.join(' ')} must be refused`);
      assert.match(emitted(result), /refused/i);
      assert.doesNotMatch(emitted(result), /SECRETVALUE/);
    }
    assert.equal(existsSync(marker), false);
  } finally {
    assert.equal(dirname(marker), root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('encoded credential parameter names in returned URLs are masked before truncation', async () => {
  for (const budget of [20000, 120]) {
    const result = await invoke(
      ['web', 'search', 'docs', '--max-chars', String(budget)],
      'encoded-secret'
    );
    assert.equal(result.exitCode, 0);
    assert.ok(emitted(result).length <= budget);
    assert.doesNotMatch(
      emitted(result),
      /fixture-encoded-token|fixture-encoded-access-key|fixture-encoded-signature|fixture-double-encoded-token|fixture-encoded-fragment-token/
    );
    // The public, non-sensitive parts of the returned URL survive.
    assert.match(emitted(result), /public\.example\.org/);
  }
  for (const budget of [20000, 120]) {
    const result = await invoke(
      ['web', 'search', 'docs', '--max-chars', String(budget)],
      'spaced-name'
    );
    assert.equal(result.exitCode, 0);
    assert.ok(emitted(result).length <= budget);
    assert.doesNotMatch(emitted(result), /fixture-spaced-secret|fixture-tab-secret/);
  }
});

test('masking preserves ordinary public content', async () => {
  const env = { ...process.env, GH_TOKEN: 'test-not-a-key' };
  const result = await invoke(['web', 'search', 'docs'], 'public-content', env);
  assert.equal(result.exitCode, 0);
  const text = emitted(result);
  // API slugs, search operators, library mentions and version numbers are real
  // research evidence, not credentials: over-broad masking would corrupt them.
  for (const keep of ['?api=v3', 'C++ examples', 'react@18.2.0', 'host: docs.example.com']) {
    assert.ok(text.includes(keep), `must keep ${keep}`);
  }
  assert.equal(text.includes(env.GH_TOKEN), false);
});

test('pr_history_secret_scan: working tree contains zero leaks and test fixtures use test-not-a-key', () => {
  const fixtureContent = readFileSync(fixture, 'utf8');
  // Proves that fixture does not introduce GitHub PATs or generic api keys (e.g. ghp_ followed by high-entropy string)
  assert.doesNotMatch(fixtureContent, /ghp_[a-zA-Z0-9]{20,}/);
  assert.doesNotMatch(fixtureContent, /(?:api_key|secret_key|auth_token|access_token)\s*[:=]\s*['"][0-9a-zA-Z_\-]{24,}['"]/i);
  assert.match(fixtureContent, /GH_TOKEN=test-not-a-key/);

  const testFileContent = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  // Proves that test file itself contains no GitHub PATs or generic api keys
  assert.doesNotMatch(testFileContent, /ghp_[a-zA-Z0-9]{20,}/);
  assert.doesNotMatch(testFileContent, /GH_TOKEN\s*[:=]\s*['"]ghp_/);
  assert.match(testFileContent, /GH_TOKEN:\s*'test-not-a-key'/);

  // Gitleaks dir check on the working tree proves 0 leaks in current source and test fixtures
  const gitleaksResult = spawnSync('gitleaks', ['dir', '.', '-c', '.gitleaks.toml', '--verbose'], {
    encoding: 'utf8',
  });
  if (gitleaksResult.status !== null && gitleaksResult.status !== undefined && gitleaksResult.error?.code !== 'ENOENT') {
    assert.equal(gitleaksResult.status, 0, 'gitleaks dir on working tree must find zero leaks');
  }
});

test('search queries distinguish library identifiers from URL candidates', async () => {
  for (const query of [
    'React.useEffect cleanup',
    'useEffect cleanup in React.js',
    'Node.js streams',
    'Vue.js 3 watch',
    'How does pagination work?',
    'dns spec 1.1.1.1',
  ]) {
    const result = await invoke(['web', 'search', query]);
    assert.equal(result.exitCode, 0, `${query} must be forwardable`);
    assert.equal(payload(result).argv[2], query);
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

// In-process public listener reached through the pinned (loopback) address the
// test resolver returns, so no external network is needed. It records every
// hit and can answer with a late redirect.
async function startPublicServer(redirectTo) {
  const { createServer } = await import('node:http');
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    if (redirectTo !== undefined && hits.length >= redirectTo.after) {
      res.writeHead(302, { location: redirectTo.location });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(redirectTo?.body ?? 'public content');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return { server, hits, port: server.address().port };
}

// A separate-process listener for the private destination so that a zero-hit
// assertion is proof of transport behavior, not a blocked event loop.
async function startPrivateProbe(root) {
  const ref = join(root, 'private-listener.mjs');
  const hits = join(root, 'private-hits');
  writeFileSync(
    ref,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const [counter] = process.argv.slice(2);
const server = createServer((req, res) => {
  appendFileSync(counter, req.url + '\\n');
  res.end('private content');
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
`
  );
  const proc = spawn(process.execPath, [ref, hits]);
  const port = await new Promise((resolvePort, rejectPort) => {
    proc.stdout.once('data', (chunk) => resolvePort(Number(String(chunk).trim())));
    proc.once('exit', (code) => rejectPort(new Error(`listener exited ${code}`)));
  });
  return { proc, hits, port };
}

test('DNS rebinding between check and connect is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-rebinding-'));
  const marker = join(root, 'cli-calls');
  const privateProbe = await startPrivateProbe(root);
  // The host resolves public for the preflight, then private while the actual
  // retrieval is being connected.
  let lookups = 0;
  const rebindingResolver = async () => (++lookups === 1 ? ['93.184.216.34'] : ['127.0.0.1']);
  try {
    const result = await runResearch(
      ['web', 'read', `http://rebind.example.com:${privateProbe.port}/secret`],
      {
        binary: process.execPath,
        prefixArgs: [fixture, 'retrieve-target', marker],
        resolveHost: rebindingResolver,
      }
    );

    assert.notEqual(result.code, 0, 'Must be refused');
    assert.equal(existsSync(privateProbe.hits), false, 'Private listener must receive zero requests');
    assert.equal(existsSync(marker), false, 'CLI must not be launched for retrieval');
    assert.doesNotMatch(result.stdout + result.stderr, /private content/);
  } finally {
    privateProbe.proc.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('redirect to private address during retrieval is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-redirect-refusal-'));
  const privateProbe = await startPrivateProbe(root);
  // The public server answers 200 and only the retrieval connection sees 302 to
  // loopback. connectTo pins the transport to this local server so the boundary
  // is exercised offline; validation, redirect following and hop re-validation
  // all run for real.
  const publicServer = await startPublicServer({
    after: 1,
    location: `http://127.0.0.1:${privateProbe.port}/secret`,
  });
  try {
    await assert.rejects(
      defaultRetrieve(`http://docs.example.com:${publicServer.port}/doc`, {
        resolveHost: async () => ['93.184.216.34'],
        connectTo: '127.0.0.1',
      }),
      /Research refused: (?:destination resolves to a private or restricted address|public HTTP\(S\) URLs without credentials only)/
    );
    assert.equal(existsSync(privateProbe.hits), false, 'Private listener must receive zero requests');
    assert.ok(publicServer.hits.length > 0, 'public destination was actually retrieved');
  } finally {
    publicServer.server.close();
    privateProbe.proc.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli_redirect_after_both_preflights_never_contacts_private_destination', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-cli-redirect-'));
  const marker = join(root, 'cli-calls');
  const privateProbe = await startPrivateProbe(root);
  const publicServer = await startPublicServer({
    after: 1,
    location: `http://127.0.0.1:${privateProbe.port}/secret`,
  });
  try {
    // Both wrapper preflights pass (injected public transport), and the actual
    // retrieval uses the real boundary pinned to the local server, which then
    // redirects to loopback. The wrapper must refuse and never echo private text.
    const preflight = async () => ({ status: 200, headers: {}, body: 'public' });
    const result = await runResearch(
      ['web', 'read', `http://docs.example.com:${publicServer.port}/doc`],
      {
        binary: process.execPath,
        prefixArgs: [fixture, 'retrieve-target', marker],
        resolveHost: defaultTestResolver,
        fetchUrl: preflight,
        connectTo: '127.0.0.1',
      }
    );

    assert.notEqual(result.code, 0, 'Must be refused');
    assert.equal(existsSync(privateProbe.hits), false, 'Private listener must receive zero requests');
    // The only CLI call left is the version probe; it never receives the target.
    const calls = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
    assert.doesNotMatch(calls, /docs.example.com/, 'CLI must not receive the retrieval target');
    assert.doesNotMatch(result.stdout + result.stderr, /private content/);
  } finally {
    publicServer.server.close();
    privateProbe.proc.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('preflight_ignores_authenticated_environment_proxy', async () => {
  const { createServer } = await import('node:http');
  let proxyRequests = 0;
  let proxyAuth = null;
  const proxyServer = createServer((req, res) => {
    proxyRequests++;
    proxyAuth = req.headers['proxy-authorization'];
    res.writeHead(407, { 'Proxy-Authenticate': 'Basic' });
    res.end();
  });
  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxyServer.address().port;

  try {
    const env = {
      ...process.env,
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: `http://operator:test-not-a-key@127.0.0.1:${proxyPort}`,
      HTTP_PROXY: `http://operator:test-not-a-key@127.0.0.1:${proxyPort}`,
    };

    const result = await invoke(
      ['web', 'read', 'https://docs.example.com/doc'],
      'ok',
      env
    );

    assert.equal(proxyRequests, 0, 'Proxy must receive zero requests');
    assert.equal(proxyAuth, null, 'Proxy must receive no proxy authorization');
  } finally {
    proxyServer.close();
  }
});
test('bare_credential_patterns_are_redacted', async () => {
  const pat = 'ghp_' + 'A'.repeat(36);
  const result = await invoke(['web', 'search', 'docs'], 'bare-pat');
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(emitted(result), new RegExp(pat));
  assert.match(emitted(result), /\[REDACTED\]/);
});

test('returned_ipv6_encoded_credentials_are_masked', async () => {
  for (const budget of [20000, 150]) {
    const result = await invoke(
      ['web', 'search', 'docs', '--max-chars', String(budget)],
      'ipv6-encoded-secret'
    );
    assert.equal(result.exitCode, 0);
    assert.ok(emitted(result).length <= budget);
    assert.doesNotMatch(emitted(result), /fixture-encoded-token/);
    if (budget === 20000) {
      assert.match(emitted(result), /\[REDACTED\]/);
    }
  }
});

test('malformed_parameter_does_not_disable_redaction', async () => {
  const result = await invoke(['web', 'search', 'docs'], 'malformed-param');
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(emitted(result), /fixture-encoded-token/);
  assert.match(emitted(result), /\[REDACTED\]/);
});

test('dns_refusal_masks_inherited_values', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-dns-refusal-'));
  const marker = join(root, 'calls');
  try {
    const secret = 'fixture-private-env-value';
    const env = { ...process.env, PRIVATE_RESEARCH_VALUE: secret };
    const failingResolver = async (host) => {
      throw new Error(`cannot resolve host "${host}"`);
    };

    const result = await invoke(
      ['web', 'read', `https://${secret}.example.com/docs`],
      'ok',
      env,
      marker,
      { resolveHost: failingResolver }
    );

    assert.notEqual(result.exitCode, 0);
    assert.equal(existsSync(marker), false, 'CLI must not be launched');
    assert.equal(result.stdout, '', 'stdout must be empty');
    assert.doesNotMatch(result.stderr, new RegExp(secret), 'stderr must not contain inherited secret');
    assert.match(result.stderr, /refused/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public_ipv6_literal_skips_dns', async () => {
  let dnsLookupCalled = false;
  const result = await invoke(
    ['web', 'read', 'https://[2606:4700::1111]/docs'],
    'ok',
    process.env,
    '-',
    {
      resolveHost: async (host) => {
        dnsLookupCalled = true;
        return [host];
      },
    }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(dnsLookupCalled, false, 'public IPv6 literal must skip DNS lookup');
});

test('camel_case_api_key_target_is_refused_before_launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-camel-key-'));
  const marker = join(root, 'calls');
  let transportCalls = 0;
  const transport = async () => {
    transportCalls++;
    return { status: 200, headers: {} };
  };
  try {
    const result = await invoke(
      ['web', 'read', 'https://docs.example.com/?apiKey=fixture-account-key'],
      'ok',
      process.env,
      marker,
      { retrieve: transport, fetchUrl: transport }
    );
    assert.notEqual(result.exitCode, 0, 'Must be refused');
    assert.equal(transportCalls, 0, 'Transport must not be called');
    assert.equal(existsSync(marker), false, 'CLI must not be launched');
    assert.doesNotMatch(emitted(result), /fixture-account-key/, 'Credential must not be echoed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('inherited_session_value_is_redacted', async () => {
  const env = {
    ...process.env,
    SESSION_ID: 'fixture-private-env-value',
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const result = await invoke(['web', 'read', 'https://docs.example.com/reference'], 'secrets', env);
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.stdout, /fixture-private-env-value/);
  assert.doesNotMatch(result.stderr, /fixture-private-env-value/);
});

test('bare_openai_credential_is_redacted_before_truncation', async () => {
  const secretKey = 'sk-' + 'A'.repeat(48);
  for (const budget of [20000, 200]) {
    const result = await invoke(
      ['web', 'search', 'docs', '--max-chars', String(budget)],
      'bare-openai'
    );
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(emitted(result), new RegExp(secretKey));
    assert.match(emitted(result), /\[REDACTED\]/);
  }
});

test('serialized_client_secret_is_redacted', async () => {
  const result = await invoke(['web', 'search', 'docs'], 'json-client-secret');
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(emitted(result), /fixture-oauth-secret/);
  assert.match(emitted(result), /\[REDACTED\]/);
});

test('serialized_session_id_is_redacted', async () => {
  const env = { ...process.env };
  delete env.SESSION_ID;
  delete env.SESSION;
  for (const budget of [20000, 200]) {
    const result = await invoke(
      ['web', 'search', 'docs', '--max-chars', String(budget)],
      'json-session-id',
      env
    );
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(emitted(result), /fixture-session-secret/);
    assert.ok(emitted(result).length <= budget);
  }
  const full = await invoke(['web', 'search', 'docs'], 'json-session-id', env);
  assert.match(full.stdout, /session_id.{0,4}:.{0,4}\[REDACTED\]/);
});

// A separate-process proxy that answers 407 so that any traffic through it is
// observable while the parent keeps a live event loop for the test process.
async function startProxyFlightRecorder(ref) {
  writeFileSync(
    ref,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const [log] = process.argv.slice(2);
const server = createServer((req, res) => {
  appendFileSync(log, (req.headers['proxy-authorization'] || 'none') + '\\n');
  res.writeHead(407, { 'Proxy-Authenticate': 'Basic' });
  res.end();
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
`
  );
}

const waitForPort = (child) =>
  new Promise((resolvePort, rejectPort) => {
    child.stdout.once('data', (chunk) => resolvePort(Number(String(chunk).trim())));
    child.once('exit', (code) => rejectPort(new Error(`listener exited ${code}`)));
  });

const readProxyHits = (log) => (existsSync(log) ? readFileSync(log, 'utf8').trim() : '');

test('default_transport_ignores_startup_authenticated_proxy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-proxy-default-'));
  const proxyRef = join(root, 'proxy.mjs');
  const proxyLog = join(root, 'proxy-hits');
  const researchScript = fileURLToPath(new URL('../research.mjs', import.meta.url)).replace(/\\/g, '/');
  // The child startup inherits the authenticated proxy env; its own retrieval
  // must still bypass it. The process exits only after runResearch settles.
  const childCode = `
    import { runResearch } from 'file:///${researchScript}';
    const dummyResolver = async () => ['93.184.216.34'];
    const result = await runResearch(['web', 'read', 'https://docs.example.com/doc'], {
      resolveHost: dummyResolver,
      binary: process.execPath,
      prefixArgs: ['--version'],
    });
    process.stdout.write('SETTLED:' + result.code);
  `;
  await startProxyFlightRecorder(proxyRef);
  const proxyProc = spawn(process.execPath, [proxyRef, proxyLog]);
  const proxyPort = await waitForPort(proxyProc);
  try {
    const child = await new Promise((resolveChild) => {
      const proc = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: '1',
          HTTP_PROXY: `http://operator:test-not-a-key@127.0.0.1:${proxyPort}`,
          HTTPS_PROXY: `http://operator:test-not-a-key@127.0.0.1:${proxyPort}`,
        },
      });
      let stdout = '';
      proc.stdout.on('data', (chunk) => (stdout += chunk));
      proc.once('exit', (code) => resolveChild({ code, stdout }));
    });
    assert.equal(child.code, 0);
    assert.match(child.stdout, /^SETTLED:1$/, 'child retrieval must settle non-successfully');
    assert.equal(readProxyHits(proxyLog), '', 'Proxy must receive zero requests');
  } finally {
    proxyProc.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('inherited proxy env is never used', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipde-research-proxy-rev-'));
  const proxyRef = join(root, 'proxy.mjs');
  const proxyLog = join(root, 'proxy-hits');
  await startProxyFlightRecorder(proxyRef);
  const proxyProc = spawn(process.execPath, [proxyRef, proxyLog]);
  const proxyPort = await waitForPort(proxyProc);
  const proxyUrl = `http://operator:test-not-a-key@127.0.0.1:${proxyPort}`;
  const researchScript = fileURLToPath(new URL('../research.mjs', import.meta.url)).replace(/\\/g, '/');
  const childCode = `
    import { runResearch } from 'file:///${researchScript}';
    const dummyResolver = async () => ['93.184.216.34'];
    const result = await runResearch(['web', 'read', 'https://docs.example.com/doc'], {
      resolveHost: dummyResolver,
      binary: process.execPath,
      prefixArgs: ['--version'],
    });
    process.stdout.write('SETTLED:' + result.code);
  `;
  try {
    const child = await new Promise((resolveChild) => {
      const proc = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: '1',
          HTTP_PROXY: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          http_proxy: proxyUrl,
          https_proxy: proxyUrl,
          ALL_PROXY: proxyUrl,
        },
      });
      let stdout = '';
      proc.stdout.on('data', (chunk) => (stdout += chunk));
      proc.once('exit', (code) => resolveChild({ code, stdout }));
    });
    assert.equal(child.code, 0);
    assert.match(child.stdout, /^SETTLED:1$/, 'child retrieval must have settled with a refusal');
    assert.equal(readProxyHits(proxyLog), '', 'Proxy must receive zero requests');
  } finally {
    proxyProc.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
