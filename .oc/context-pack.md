# Focused context pack

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## scripts/ai/research.mjs

```
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPublicTarget,
  collectSecrets,
  redact,
  retrieve as defaultRetrieve,
  scanQueryForUnsafeUrls,
  truncate,
} from './research-safety.mjs';

const VERSION = '1.6.1';
const INSTALL_HINT = `uv tool install https://github.com/Panniantong/Agent-Reach/releases/download/v${VERSION}/agent-reach.zip\nSee https://github.com/Panniantong/Agent-Reach/blob/v${VERSION}/docs/install.md. Never install agent-reach from PyPI.\n`;
const ACTIONS = new Map([
  ['web read', ['read', 'jina']],
  ['web search', ['search', 'exa']],
  ['github read', ['read', 'github-api']],
  ['github search', ['search', 'github-api']],
  ['reddit read', ['read', 'public-web']],
  ['reddit search', ['search', 'public-web']],
  ['youtube transcript', ['subtitle', 'yt-dlp']],
]);
const DEFAULT_BUDGET = 20000;
const positiveInteger = (value) =>
  /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function refusal(message, budget = DEFAULT_BUDGET) {
  return { code: 1, exitCode: 1, stdout: '', stderr: truncate(`${message}\n`, budget) };
}

function parse(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let maxChars = DEFAULT_BUDGET;
  let budgetSeen = false;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== '--max-chars' && !arg.startsWith('--max-chars=')) {
      rest.push(arg);
      continue;
    }
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
    if (budgetSeen || !positiveInteger(value)) {
      throw new Error('Research refused: --max-chars requires one positive safe integer.');
    }
    budgetSeen = true;
    maxChars = Number(value);
  }
  const [channel, action, ...wordsAndOptions] = rest;
  const policy = ACTIONS.get(`${channel} ${action}`);
  if (!policy) {
    throw new Error(
      'Research refused: only web/github/reddit read/search and youtube transcript are allowed. Usage: pnpm ai:research -- <channel> <action> <target or query> [--max-chars N]'
    );
  }
  const words = [];
  const options = [];
  for (let i = 0; i < wordsAndOptions.length; i++) {
    const value = wordsAndOptions[i];
    if (/[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('Research refused: control characters in arguments.');
    }
    if (!value.startsWith('-')) {
      words.push(value);
      continue;
    }
    const next = wordsAndOptions[++i];
    const allowed =
      (value === '--limit' && action === 'search' && positiveInteger(next)) ||
      (value === '--lang' && action === 'transcript' && /^[A-Za-z][A-Za-z0-9,-]*$/.test(next ?? ''));
    if (!allowed || options.includes(value)) {
      throw new Error(
        'Research refused: unsupported option; login, credentials and backend overrides are prohibited.'
      );
    }
    options.push(value, next);
  }
  const target = words.join(' ').trim();
  if (!target || (action !== 'search' && words.length !== 1)) {
    throw new Error('Research refused: supply a query or one public target.');
  }
  const urls = [];
  if (action === 'search') {
    scanQueryForUnsafeUrls(target);
  } else if (channel === 'github' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(target)) {
    // Public repository path: the CLI contacts the fixed GitHub API.
  } else if (channel === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(target)) {
    // Public video id: yt-dlp contacts the fixed YouTube service.
  } else if (channel === 'youtube') {
    const url = assertPublicTarget(target);
    if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)) {
      throw new Error('Research refused: youtube transcript requires a public YouTube URL or id.');
    }
    urls.push(url.href);
  } else {
    urls.push(assertPublicTarget(target).href);
  }
  return {
    maxChars,
    action,
    channel,
    urls,
    cliArgs: [channel, policy[0], target, ...options, '--backend', policy[1]],
  };
}

function isolatedEnv(parent, home) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TMP|TEMP)$/i.test(key)) env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    PYTHONIOENCODING: 'utf-8',
  };
}

function ok(payload, budget, secrets) {
  return {
    code: 0,
    exitCode: 0,
    stdout: truncate(JSON.stringify(redact(payload, secrets), null, 2) + '\n', budget),
    stderr: '',
  };
}

export async function runResearch(
  argv,
  { binary = 'agent-reach', prefixArgs = [], command, env = process.env, retrieve = defaultRetrieve } = {}
) {
  const parentSecrets = collectSecrets(env);
  let request;
  try {
    request = parse(argv);
  } catch (error) {
    return refusal(redact(error.message, parentSecrets));
  }
  const fail = (message) => refusal(redact(message, parentSecrets), request.maxChars);
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), 'shipde-research-'));
    const childEnv = isolatedEnv(env, directory);
    const launch = command ?? [binary, ...prefixArgs];
    const invoke = (args) =>
      spawnSync(launch[0], [...launch.slice(1), ...args], {
        encoding: 'utf8',
        env: childEnv,
        cwd: directory,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 45000,
        maxBuffer: 8 * 1024 * 1024,
      });
    const version = invoke(['version']);
    if (version.error?.code === 'ENOENT') {
      return fail(
        `agent-reach is missing. Install only the operator-approved GitHub source:\n${INSTALL_HINT}`
      );
    }
    let metadata;
    try {
      metadata = JSON.parse(version.stdout);
    } catch {
      return fail(`Research refused: cannot verify Agent-Reach v${VERSION}.\n${INSTALL_HINT}`);
    }
    if (
      version.error ||
      version.status !== 0 ||
      metadata?.ok !== true ||
      metadata.result?.version !== VERSION
    ) {
      return fail(`Research refused: Agent-Reach v${VERSION} is required.\n${INSTALL_HINT}`);
    }
    let fetched;
    if (request.urls.length > 0) {
      try {
        fetched = await retrieve(request.urls[0]);
      } catch (error) {
        return fail(error.message);
      }
      if (fetched.status !== 200) {
        return fail(
          'Research refused: public access failed (UPSTREAM_ERROR). Use another public source; no login or automatic retry.'
        );
      }
    }
    const inProcessRead = request.action === 'read' && request.channel !== 'github';
    if (inProcessRead) {
      return ok(
        {
          ok: true,
          items: [{ title: '', url: request.urls[0], text: fetched?.body ?? '' }],
        },
        request.maxChars,
        [...parentSecrets, ...collectSecrets(childEnv)]
      );
    }
    const result = invoke(request.cliArgs);
    if (result.error || result.signal) {
      return fail('Research refused: Agent-Reach failed or exceeded its timeout/output buffer.');
    }
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      return fail('Research refused: malformed Agent-Reach output; raw diagnostics suppressed.');
    }
    if (!payload || typeof payload.ok !== 'boolean') {
      return fail('Research refused: invalid Agent-Reach response.');
    }
    if (/LOGIN|AUTH|NEED_SETUP/i.test(payload.error?.code ?? '')) {
      return fail(
        'Research refused: this request needs login or account/tool setup. No operator account may be used.'
      );
    }
    if (!payload.ok || result.status !== 0) {
      const code = payload.error?.code || 'UPSTREAM_ERROR';
      return fail(
        `Research refused: public access failed (${code}). Use another public source; no login or automatic retry.`
      );
    }
    return ok(payload, request.maxChars, [...parentSecrets, ...collectSecrets(childEnv)]);
  } catch {
    return fail('Research refused: unable to run Agent-Reach safely; raw diagnostics suppressed.');
  } finally {
    try {
      if (directory) rmSync(directory, { recursive: true, force: true });
    } catch {
      /* Suppress raw filesystem diagnostics. */
    }
  }
}

function isEntryPoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  const result = await runResearch(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

```

## scripts/ai/test/fixtures/agent-reach.mjs

```
#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Offline stand-in for the pinned Agent-Reach CLI. All credential-shaped values
// are obviously fake so the fixture never resembles a live secret.
const [mode, marker, ...argv] = process.argv.slice(2);
if (marker !== '-' && argv[0] !== 'version') appendFileSync(marker, `${JSON.stringify(argv)}\n`);

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
  console.log(JSON.stringify(payload));
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

```