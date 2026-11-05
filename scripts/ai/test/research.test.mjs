import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runResearch } from '../research.mjs';
import { assertPublicTarget, retrieve } from '../research-safety.mjs';

const fixture = fileURLToPath(new URL('./fixtures/agent-reach.mjs', import.meta.url));
const cli = (mode, marker) => [process.execPath, fixture, mode, marker];
const fakeRetrieve = async () => ({ status: 200, body: 'fixture-fetched-public-text' });

const invoke = (args, { mode = 'ok', env = process.env, marker = '-', retrieve } = {}) =>
  runResearch(args, {
    command: cli(mode, marker),
    env,
    retrieve: retrieve ?? fakeRetrieve,
  });

const tempMarker = () => join(mkdtempSync(join(tmpdir(), 'shipde-research-test-')), 'cli-calls');
const markerArgs = (marker) =>
  existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];

test('AC-01: each allowed pair uses the pinned anonymous backend', async () => {
  const cases = [
    ['web search', ['web', 'search', 'node', 'fetch'], 'search', 'exa'],
    ['github search', ['github', 'search', 'ssrf', 'guard'], 'search', 'github-api'],
    ['github read', ['github', 'read', 'owner/repo'], 'read', 'github-api'],
    ['reddit search', ['reddit', 'search', 'node', 'library'], 'search', 'public-web'],
    ['youtube transcript', ['youtube', 'transcript', 'jNQXAC9IVRw'], 'subtitle', 'yt-dlp'],
  ];
  for (const [name, args, action, backend] of cases) {
    const marker = tempMarker();
    const result = await invoke(args, { marker });
    assert.equal(result.code, 0, `${name} should succeed`);
    const calls = markerArgs(marker).filter((call) => call[0] !== 'version');
    assert.deepEqual(calls[0], [args[0], action, args.slice(2).join(' '), '--backend', backend]);
    rmSync(join(marker, '..'), { recursive: true, force: true });
  }
  const readMarker = tempMarker();
  const webRead = await invoke(['web', 'read', 'https://docs.example.com/guide'], { marker: readMarker });
  assert.equal(webRead.code, 0);
  assert.match(webRead.stdout, /fixture-fetched-public-text/);
  assert.equal(markerArgs(readMarker).length, 0, 'read must not let the CLI re-fetch');
});

test('AC-01: transcript preserves captions and maps to subtitle', async () => {
  const result = await invoke(['youtube', 'transcript', 'jNQXAC9IVRw'], { mode: 'transcript' });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /fixture-caption-line-one/);
  assert.doesNotMatch(result.stdout, /html/i);
});

test('AC-02: unsafe actions, options, targets and budgets are refused before launch', async () => {
  const cases = [
    [['reddit', 'login', 'https://www.reddit.com']],
    [['web', 'delete', 'https://docs.example.com']],
    [['web', 'read', 'https://docs.example.com', '--backend', 'browser']],
    [['web', 'search', 'node', '--max-chars', '0']],
    [['web', 'read', 'http://127.0.0.1/secret']],
    [['web', 'read', 'https://user:pass@docs.example.com/']],
    [['web', 'read', 'https://docs.example.com/?token=fixture-secret']],
  ];
  for (const [args] of cases) {
    const marker = tempMarker();
    const result = await invoke(args, { marker });
    assert.notEqual(result.code, 0, `${args.join(' ')} must be refused`);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(marker), false, 'CLI must not be launched for a refusal');
    assert.doesNotMatch(result.stderr, /fixture-secret|user:pass/);
    rmSync(join(marker, '..'), { recursive: true, force: true });
  }
  assert.throws(() => assertPublicTarget('https://user:pass@docs.example.com/'), /credentials/);
});

test('AC-03: missing or mismatched CLI reports only the pinned GitHub hint', async () => {
  const missing = await runResearch(['web', 'search', 'node'], {
    command: ['C:/definitely-missing/agent-reach.exe'],
  });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /releases\/download\/v1\.6\.1\/agent-reach\.zip/);
  assert.match(missing.stderr, /Never install agent-reach from PyPI/);

  for (const mode of ['wrong-version', 'invalid-version']) {
    const result = await invoke(['web', 'search', 'node'], { mode });
    assert.notEqual(result.code, 0, `${mode} must be refused`);
    assert.match(result.stderr, /releases\/download\/v1\.6\.1\/agent-reach\.zip/);
    assert.doesNotMatch(result.stderr, /fixture-cookie/);
  }
});

test('AC-04: output is redacted before truncation and fits the budget', async () => {
  const large = await invoke(['web', 'search', 'node', '--max-chars', '100'], { mode: 'large' });
  assert.ok(large.stdout.length <= 100);
  assert.match(large.stdout, /\[truncated\]/);

  const unicode = await invoke(['web', 'search', 'node', '--max-chars', '12'], { mode: 'unicode' });
  assert.ok(unicode.stdout.length <= 12);

  const env = { ...process.env, SECRET_TOKEN: 'fixture-private-env-value' };
  const secrets = await invoke(['web', 'search', 'node'], { mode: 'secrets', env });
  assert.doesNotMatch(secrets.stdout + secrets.stderr, /fixture-token|fixture-url-token|fixture-private-env-value/);
  assert.match(secrets.stdout, /\[REDACTED\]/);
});

test('AC-05: child environment cannot inherit credentials, proxies or operator config', async () => {
  const marker = tempMarker();
  const env = {
    ...process.env,
    HTTPS_PROXY: 'http://proxy-user:proxy-pass@proxy.invalid:8080',
    NODE_USE_ENV_PROXY: '1',
    SECRET_TOKEN: 'fixture-private-env-value',
  };
  const result = await invoke(['web', 'search', 'node'], { mode: 'environment', env, marker });
  assert.equal(result.code, 0);
  const report = JSON.parse(JSON.parse(result.stdout).items[0].text);
  assert.equal(report.pathPresent, true);
  assert.equal(report.proxyPresent, false);
  assert.equal(report.tokenPresent, false);
  assert.equal(report.agentConfig, false);
  assert.equal(report.gitConfig, false);
});

test('AC-05: upstream failures stay failures without raw stderr or login fallback', async () => {
  for (const mode of ['failure', 'failure-zero']) {
    const result = await invoke(['web', 'search', 'node'], { mode });
    assert.notEqual(result.code, 0, `${mode} must fail`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /TIMEOUT/);
    assert.doesNotMatch(result.stderr, /fixture-cookie|fixture-token/);
  }
});

test('AC-05: retrieval refuses a loopback destination without connecting', async () => {
  let hits = 0;
  const server = http.createServer((_request, response) => {
    hits += 1;
    response.end('private content');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await assert.rejects(() => retrieve(`http://127.0.0.1:${port}/secret`), /private or restricted/);
    assert.equal(hits, 0, 'private destination must receive zero connections');
  } finally {
    server.close();
  }
});
