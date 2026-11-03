#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [mode, marker, ...argv] = process.argv.slice(2);
if (marker !== '-') appendFileSync(marker, `${JSON.stringify(argv)}\n`);
if (argv[0] === 'version') {
  if (mode === 'invalid-version') console.log('Unverified CLI; Cookie: fixture-version-cookie');
  else
    console.log(
      JSON.stringify({
        ok: true,
        result: { version: mode === 'wrong-version' ? '1.5.0' : '1.6.1' },
      })
    );
} else if (mode === 'plain') {
  console.log('Not the pinned JSON CLI');
} else if (mode === 'failure' || mode === 'login' || mode === 'secret-code') {
  console.error('Cookie: session=fixture-cookie; Authorization: Bearer fixture-token');
  console.log(
    JSON.stringify({
      ok: false,
      error: {
        code:
          mode === 'secret-code'
            ? 'FIXTURE_PRIVATE_CODE'
            : mode === 'login'
              ? 'NEED_LOGIN'
              : 'TIMEOUT',
        hint: 'agent-reach login reddit',
      },
    })
  );
  process.exitCode = 1;
} else {
  let text = JSON.stringify({ argv });
  if (mode === 'large') text = 'research '.repeat(5000);
  if (mode === 'unicode') text = '📚'.repeat(5000);
  if (mode === 'short-env') text = 'The environment value is xyz.';
  if (mode === 'secrets') {
    text =
      'Cookie: session=fixture-cookie\nAuthorization: Bearer fixture-token\napi_key=fixture-api-key\nfixture-private-env-value\nhttps://docs.example.com?token=fixture-url-token&topic=api';
    console.error('fixture-private-env-value');
  }
  if (mode === 'quoted-secrets') {
    text =
      JSON.stringify({
        cookie: 'fixture-quoted-cookie',
        api_key: 'fixture-quoted-key',
        refresh_token: 'fixture-quoted-token',
        access_key: 'fixture-access-key',
        passwd: 'fixture-passwd',
      }) +
      '\nBasic fixture-basic-token\nhttps://reader:fixture-url-password@docs.example.com/reference\naccess_key=fixture-access-key\npasswd=fixture-passwd';
  }
  if (mode === 'environment') {
    text = JSON.stringify({
      keys: Object.keys(process.env),
      credentialConfig: existsSync(join(homedir(), '.agent-reach', 'config.yaml')),
      ytdlpConfig: existsSync(join(homedir(), 'yt-dlp.conf')),
      isolatedCwd: process.cwd() === homedir(),
    });
  }
  console.log(
    JSON.stringify({
      ok: true,
      items: [
        {
          title: 'Reference',
          url: 'https://docs.example.com',
          text,
          raw: {
            cookie: 'fixture-cookie',
            env: 'fixture-private-env-value',
            ...(mode === 'quoted-secrets'
              ? {
                  'fixture-private-env-value': 'public metadata',
                  access_key: 'fixture-access-key',
                  passwd: 'fixture-passwd',
                }
              : {}),
          },
        },
      ],
    })
  );
}
