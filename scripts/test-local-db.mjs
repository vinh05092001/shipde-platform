import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const api = join(root, 'apps/api');
const temporaryDirectory = join(root, '.oc/tmp');
mkdirSync(temporaryDirectory, { recursive: true });
const require = createRequire(import.meta.url);
const tsx = pathToFileURL(require.resolve('tsx')).href;

if (process.env.NODE_ENV === 'production') {
  console.error('Local test database runner is forbidden in production (NODE_ENV=production)');
  process.exit(1);
}

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? discover(path)
        : entry.name.endsWith('.supertest.spec.ts')
          ? [path]
          : [];
    })
    .sort();
}

const files = discover(join(api, 'src'));
if (files.length === 0) throw new Error('No API integration suites discovered');
let pass = 0;
let fail = 0;
const skips = [];
for (const file of files) {
  const name = relative(api, file).replaceAll('\\', '/');
  console.log(`RUN ${name} (TEST_DB=local)`);
  const result = spawnSync(process.execPath, ['--import', tsx, file], {
    cwd: api,
    env: {
      ...process.env,
      TEST_DB: 'local',
      NODE_ENV: process.env.NODE_ENV || 'test',
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      TMPDIR: temporaryDirectory,
      NODE_COMPILE_CACHE: join(temporaryDirectory, 'node-compile-cache'),
      TSX_TSCONFIG_PATH: join(api, 'tsconfig.json'),
      DATABASE_URL: 'postgresql://local-test.invalid/offline',
      REDIS_HOST: 'local-test.invalid',
      REDIS_PORT: '6379',
      S3_ENDPOINT: 'http://local-test.invalid',
      FRONTEND_URL: 'http://localhost:3000',
      APP_BASE_URL: 'http://localhost:3000',
      // Existing auth suites share the process-local fallback used by their test config.
      AUTH_TOKEN_SECRET: '',
      AUDIT_IDENTIFIER_HMAC_KEY: 'fixture-local-db-audit-hmac-key-32-chars',
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('SHIPDE_TEST_SKIP ')) {
      const skipped = JSON.parse(line.slice('SHIPDE_TEST_SKIP '.length));
      skips.push({ suite: name, ...skipped });
      console.log(`SKIP ${skipped.name}: ${skipped.reason}`);
    }
  }
  // Old suites can return successfully when PostgreSQL is absent. That is never local proof.
  if (
    result.error ||
    result.status !== 0 ||
    /skipped offline|Skipping live|FAIL_CLOSED/.test(output)
  ) {
    fail++;
    console.error(`FAIL ${name}: ${result.error?.message ?? `exit ${result.status}`}`);
    console.error(output);
  } else {
    pass++;
    console.log(`PASS ${name}`);
  }
}
console.log(`API integration suites: pass=${pass} skip=0 fail=${fail}`);
console.log(`CI-only scenarios skipped inside API suites: ${skips.length}`);
console.log('Redis/MinIO and worker/outbox integration: run pnpm test:integration in CI.');
console.log(
  `SHIPDE_LOCAL_DB_RESULT ${JSON.stringify({ suites: { pass, skip: 0, fail }, skippedScenarios: skips })}`
);
process.exitCode = fail ? 1 : 0;
