#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Offline stand-in for the pinned Agent-Reach CLI. All credential-shaped values
// are obviously fake so the fixture never resembles a live secret.
const [mode, marker, ...argv] = process.argv.slice(2);
if (marker !== '-') appendFileSync(marker, `${JSON.stringify(argv)}\n`);

if (argv[0] === 'version') {
  if (mode === 'invalid-version') console.log('Unverified CLI; Cookie: fixture-cookie');
  else
    console.log(
      JSON.stringify({
        ok: true,
        result: { version: mode === 'wrong-version' ? '1.5.0' : '1.6.1' },
      })
    );
  process.exit(0);
}

let payload;
if (mode === 'plain') {
  console.log('Not the pinned JSON CLI');
  process.exit(0);
} else if (mode === 'failure' || mode === 'failure-zero') {
  console.error('Cookie: session=fixture-cookie; Authorization: Bearer fixture-token');
  payload = { ok: false, error: { code: 'TIMEOUT', hint: 'test-not-a-key' } };
  console.log(JSON.stringify(payload));
  process.exitCode = mode === 'failure' ? 1 : 0;
  process.exit();
} else if (mode === 'transcript') {
  payload = {
    ok: true,
    items: [
      {
        title: 'captions',
        url: argv[argv.length - 1],
        text: 'fixture-caption-line-one\nfixture-caption-line-two',
      },
    ],
  };
} else {
  let text = JSON.stringify({ argv });
  if (mode === 'unicode') text = '📚'.repeat(5000);
  if (mode === 'large') text = 'research '.repeat(5000);
  if (mode === 'secrets') {
    text =
      'Cookie: session=fixture-cookie\nAuthorization: Bearer fixture-token\n' +
      'https://docs.example.com?token=fixture-url-token&topic=api\n' +
      'fixture-private-env-value';
    console.error('fixture-private-env-value');
  }
  if (mode === 'environment') {
    text = JSON.stringify({
      pathPresent: Boolean(process.env.PATH),
      proxyPresent: Boolean(process.env.HTTPS_PROXY || process.env.NODE_USE_ENV_PROXY),
      tokenPresent: Boolean(process.env.SECRET_TOKEN),
      agentConfig: existsSync(join(homedir(), '.agent-reach', 'config.yaml')),
      gitConfig: existsSync(join(homedir(), '.gitconfig')),
    });
  }
  payload = { ok: true, items: [{ title: 'Reference', url: 'https://docs.example.com', text }] };
  console.log(JSON.stringify(payload));
}
