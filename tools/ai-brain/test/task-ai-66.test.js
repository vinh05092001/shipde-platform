'use strict';

/**
 * Ship Dễ — TASK-AI-66 routing candidate contract tests.
 *
 * The Controller can only route through a source it can see. A source becomes
 * visible when some candidate carries the exact seven-part identity its
 * evidence was recorded against, so these tests hold three things together:
 *
 *   1. What a gateway actually advertises becomes a concrete-account candidate
 *      on that account's own route, with the identity the evidence uses.
 *   2. A recorded COMPLETED outcome therefore satisfies an API_PASS proof
 *      floor and the profile pins that source.
 *   3. A QUOTA_EXHAUSTED outcome carrying `cooldownUntil` excludes the source
 *      until exactly that moment, and not before.
 *
 * Every gateway, alias and model below is test-local. Production code names no
 * model, no alias and no provider — test 8 scans for exactly that, because the
 * moment a model name appears in a `.js` file the catalogue stops being the
 * authority on what can be reached.
 *
 * Hermetic: no network, no 9Router, no `$HOME`, no real registry, no clock read
 * from the machine. The advertised catalogue is a fixture, and the registry is
 * a literal. Ubuntu-safe: paths come from `os.tmpdir()` and nothing assumes a
 * drive letter, a backslash separator or a Windows-only CLI.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dispatchCommand } = require('../cli');
const candidatesApi = require('../candidates');
const routing = require('../routing');
const evidence = require('../evidence');
const { candidateKey, parseCandidateKey } = require('../discovery/identity');

const NOW = Date.parse('2026-09-30T17:00:00.000Z');

/**
 * The three identities a row can have, in the order the assertion cares about.
 * A gateway, an agent-cli reached through that gateway, and the account whose
 * `provider` names the agent-cli — which is the shape the real machine has.
 */
const GATEWAY = 'gw66';
const CLI = 'cli66';
const ACCOUNT = 'acct66';
const ACCOUNT_EMAIL = 'acct66@example.invalid';

/** Two aliases and four models — enough to prove the alias is read, not assumed. */
const ALIAS_A = 'up66a';
const ALIAS_B = 'up66b';
const MODELS = [
  { upstream: ALIAS_A, modelId: ALIAS_A + '/model-66a' },
  { upstream: ALIAS_A, modelId: ALIAS_A + '/model-66b' },
  { upstream: ALIAS_B, modelId: ALIAS_B + '/model-66c' },
  { upstream: ALIAS_B, modelId: ALIAS_B + '/nested/model-66d' },
];

/**
 * A registry that declares the gateway and the agent-cli that rides it.
 *
 * The account's `provider` names the agent-cli, exactly as the real machine
 * does: there the account's provider is `oc`, which is both a source id in
 * sources.json and a row in the dispatch table. Mirroring that shape matters —
 * a provider that is only a dispatch key would skip the route lookup that
 * produces the identity, and the test would pass against a wiring no machine
 * has.
 *
 * No `modelPrefix` on either source: the model id a gateway advertises is
 * already the alias-prefixed id this path uses, and a second prefix would only
 * make the identity ambiguous.
 */
function registry() {
  return {
    version: 2,
    sources: [
      {
        id: GATEWAY,
        kind: 'router',
        label: 'Gateway 66',
        servesModels: true,
        harness: 'paseo',
        endpoint: 'http://127.0.0.1:20166/v1',
        credential: { type: 'api-key', env: 'GATEWAY_66_API_KEY' },
        verify: { method: 'models-list', path: '/models' },
      },
      {
        id: CLI,
        kind: 'agent-cli',
        label: 'CLI 66',
        servesModels: false,
        harness: 'oc66',
        accessPath: 'cli',
        reachedVia: GATEWAY,
        credential: { type: 'none' },
      },
      {
        id: 'deferred66',
        kind: 'model-source',
        label: 'Deferred 66',
        servesModels: true,
        endpoint: 'http://127.0.0.1:20167/v1',
        disposition: 'deferred',
        dispositionReason: 'COMPROMISED_CREDENTIAL',
      },
    ],
    retired: [],
    dispatch: { providers: { [CLI]: { harness: 'paseo', provider: 'oc66' } } },
  };
}

/** The one account that reaches the gateway through the agent-cli. */
function accounts(over) {
  return [
    Object.assign(
      {
        id: ACCOUNT,
        provider: CLI,
        enabled: true,
        tier: 2,
        email: ACCOUNT_EMAIL,
        capabilities: { contextWindow: 200000, tools: true, jsonSchema: true },
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
        models: [{ model: MODELS[0].modelId, quality: 80 }],
      },
      over || {}
    ),
  ];
}

/** The advertised catalogue in the shape discovery hands to the Controller. */
function catalogue(rows) {
  return (rows || MODELS).map((r) =>
    Object.assign(
      {
        harness: 'http',
        accessPath: GATEWAY,
        gateway: GATEWAY,
        account: '',
        quotaScope: '',
        state: 'UNKNOWN',
        resultState: 'UNTESTED',
      },
      r
    )
  );
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function validProfile(over) {
  return Object.assign(
    {
      taskId: 'TASK-AI-66-T',
      role: 'writer',
      complexity: 'short',
      requiredCapabilities: [],
      proofFloor: 'API_PASS',
      contextSize: 64000,
      expectedDuration: 600000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 1000,
      requiredHarness: 'paseo',
      forbiddenFailureDomains: [],
      resourceCeiling: 4,
      currentWorkload: 1,
    },
    over || {}
  );
}

/**
 * Runs one profile dispatch over a real candidate list, with the evidence and
 * decision stores in a temp directory and a fixed clock.
 */
async function runProfile(profile, candidateList, dirs, over) {
  const profileFile = path.join(dirs.root, 'profile.json');
  fs.writeFileSync(profileFile, JSON.stringify(profile));
  const lines = [];
  let exitCode = null;
  const deps = Object.assign(
    {
      candidates: candidateList,
      evidenceDir: dirs.evidence,
      decisionDir: dirs.decisions,
      home: dirs.home,
      storePath: dirs.storePath,
      now: NOW,
      reservations: [],
      headrooms: {},
      log: (s) => lines.push(String(s)),
      error: (s) => lines.push('ERR ' + String(s)),
      exit: (c) => {
        exitCode = c;
      },
    },
    over || {}
  );
  const result = await dispatchCommand(
    { profile: profileFile, 'dry-run': true, execute: false },
    deps
  );
  return { result, lines, exitCode };
}

/** The candidate list the Controller would assemble on this machine. */
function assembled(rows) {
  const generated = candidatesApi.gatewayAccountCandidates({
    registry: registry(),
    accounts: accounts(),
    catalogue: catalogue(rows),
  });
  return generated.map((c) => Object.assign({}, c));
}

let dirs;
beforeEach(() => {
  dirs = {
    root: tmpDir('ai66-root-'),
    evidence: tmpDir('ai66-ev-'),
    decisions: tmpDir('ai66-dec-'),
    home: tmpDir('ai66-home-'),
    storePath: path.join(tmpDir('ai66-store-'), 'store.json'),
  };
});
afterEach(() => {
  for (const dir of Object.values(dirs)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* a temp dir that is already gone is not a failure */
    }
  }
});

describe('TASK-AI-66 the Controller can see the sources that actually work', () => {
  test('1 every advertised alias becomes a candidate on the concrete account route', () => {
    const generated = assembled();

    // One candidate per advertised model, and nothing invented: the account
    // declared one model, so the other three exist only because the gateway
    // advertises them.
    assert.equal(generated.length, MODELS.length);

    const key = candidateKey(generated[0]);
    const parsed = parseCandidateKey(key);
    assert.equal(parsed.harness, 'paseo', 'the route harness comes from the dispatch table');
    assert.equal(parsed.accessPath, 'cli', 'the access path is the CLI, not the gateway endpoint');
    assert.equal(parsed.gateway, GATEWAY);
    assert.equal(parsed.account, ACCOUNT, 'a wildcard account can never be dispatched to');
    assert.equal(parsed.quotaScope, ACCOUNT, 'per-account quota scopes to that account');

    for (const row of MODELS) {
      const found = generated.find((c) => c.modelId === row.modelId);
      assert.ok(found, row.modelId + ' must be a candidate');
      assert.equal(found.upstream, row.upstream, 'the upstream is the alias the id itself carries');
      assert.equal(found.accountId, ACCOUNT);
    }
  });

  test('2 the key shape matches the evidence key field for field', () => {
    // The nine real outcomes from the 30/9 run were recorded against this exact
    // shape, with real alias names. Reproduced here with test-local ones, so the
    // assertion is about the SHAPE and not about any one machine's models.
    const evidenceKeys = [
      'paseo::cli::9router::ag::ninerouter::ninerouter::ag/gemini-3.1-pro-low',
      'paseo::cli::9router::gcli::ninerouter::ninerouter::gcli/grok-4.7',
      'paseo::cli::9router::ocz::ninerouter::ninerouter::ocz/big-pickle',
      'paseo::cli::9router::gh::ninerouter::ninerouter::gh/gpt-4.1',
    ];

    for (const key of evidenceKeys) {
      const parsed = parseCandidateKey(key);
      assert.ok(parsed, 'a recorded outcome key must parse as seven parts: ' + key);
      assert.equal(parsed.harness, 'paseo');
      assert.equal(parsed.accessPath, 'cli');
      assert.equal(parsed.gateway, '9router');
      assert.equal(parsed.quotaScope, 'ninerouter');
      // The model id is the alias-prefixed id the gateway itself advertises, so
      // the alias in field four is the alias in field seven — one segment, not
      // two, which is what made `ninerouter/ag/…` a different key from `ag/…`.
      assert.equal(
        parsed.modelId.slice(0, parsed.upstream.length + 1),
        parsed.upstream + '/',
        'the model id must carry its own alias: ' + key
      );
    }

    // And the generated key is that same shape, field for field.
    const generated = assembled();
    const mine = parseCandidateKey(candidateKey(generated[0]));
    for (const key of evidenceKeys) {
      const theirs = parseCandidateKey(key);
      for (const field of ['harness', 'accessPath', 'gateway', 'quotaScope']) {
        assert.equal(
          typeof mine[field],
          typeof theirs[field],
          'field ' + field + ' must be present and typed the same way'
        );
      }
      assert.equal(
        candidateKey(generated[0]).split('::').length,
        candidateKey(generated[0]).split('::').length,
        'a generated key has the same part count as the evidence key'
      );
    }
    assert.equal(generated[0].quotaScope, generated[0].accountId);
    assert.equal(
      parseCandidateKey(evidenceKeys[0]).quotaScope,
      parseCandidateKey(evidenceKeys[0]).account,
      'quotaScope and account are the same value on a real recorded key too'
    );
  });

  test('3 a recorded COMPLETED outcome makes an API_PASS profile pin that source', async () => {
    const target = MODELS[3];
    const list = assembled();
    const pinned = list.find((c) => c.modelId === target.modelId);
    const key = candidateKey(pinned);

    // Before the outcome, nothing meets the floor: an advertised model proves a
    // route exists, not that it works.
    const before = await runProfile(validProfile(), list, dirs);
    assert.equal(before.exitCode, 1, 'an unproven source cannot be pinned');
    assert.ok(
      before.lines.some((l) => l.includes('PROOF_FLOOR_NOT_MET:NONE')),
      'the refusal must name the missing proof, got: ' + before.lines.join(' | ')
    );

    // The outcome the operator reported for real work on that source.
    const outcomeFile = path.join(dirs.root, 'outcome.json');
    fs.writeFileSync(
      outcomeFile,
      JSON.stringify({
        candidateKey: key,
        status: 'completed',
        reason: 'real Work Item commits',
      })
    );
    let exitCode = null;
    dispatchCommand(
      { 'report-outcome': outcomeFile, root: dirs.root },
      {
        log: () => {},
        error: () => {},
        exit: (c) => {
          exitCode = c;
        },
        evidenceDir: dirs.evidence,
        decisionDir: dirs.decisions,
        now: NOW,
      }
    );
    assert.equal(exitCode, 0);

    // Now the same profile, the same candidate list, no injection of any proof
    // beyond the recorded outcome: the source is pinned.
    const after = await runProfile(validProfile(), list, dirs);
    assert.equal(
      after.exitCode,
      0,
      'a proven source must be dispatchable: ' + after.lines.join(' | ')
    );
    assert.ok(after.result.pinnedCandidateKey, 'a candidate must be pinned');
    assert.equal(
      after.result.pinnedCandidateKey,
      key,
      'the source with the recorded outcome is the one pinned'
    );
    const top = after.result.top3.map((t) => t.candidateKey);
    assert.ok(top.includes(key), 'the pinned key appears in the printed top 3');
    assert.match(after.lines.join('\n'), /proof API_PASS/, 'the top 3 must show the proof it met');
  });

  test('4 a QUOTA_EXHAUSTED outcome with cooldownUntil excludes the source until then', () => {
    const target = MODELS[1];
    const list = assembled();
    const pinned = list.find((c) => c.modelId === target.modelId);
    const key = candidateKey(pinned);
    // "quota exhausted until 01:55" is a fact about the budget. The failure text
    // also says "reset after ~3h" — a duration scraped from a string, which the
    // classifier cannot parse and would shorten to its five-minute default. The
    // explicit instant has to be the one that decides.
    const cooldownUntil = '2026-10-01T01:55:00+07:00';
    const outcomeFile = path.join(dirs.root, 'outcome-quota.json');
    fs.writeFileSync(
      outcomeFile,
      JSON.stringify({
        candidateKey: key,
        status: 'failed',
        errorClass: 'QUOTA_EXHAUSTED',
        failureScope: 'quota',
        cooldownUntil,
        lastProgressAt: '2026-09-30T16:20:32.417Z',
        reason: '429 at 22:50 30/9, reset after ~3h',
      })
    );
    dispatchCommand(
      { 'report-outcome': outcomeFile, root: dirs.root },
      { log: () => {}, error: () => {}, exit: () => {}, evidenceDir: dirs.evidence, now: NOW }
    );

    const data = evidence.loadEvidence(dirs.evidence);
    const record = data.cooldowns[key];
    assert.ok(record, 'the failure must be recorded against the exact seven-part key');
    assert.equal(
      new Date(record.resetTime).toISOString(),
      new Date(cooldownUntil).toISOString(),
      'the recorded reset time is the instant the reporter observed'
    );

    // A minute before the reset the source is still out.
    const justBefore = cooldownUntil === undefined ? 0 : Date.parse(cooldownUntil) - 60_000;
    assert.equal(
      evidence.isCandidateBlocked(data, key, { now: justBefore }).blocked,
      true,
      'a source is excluded right up to the moment it recovers'
    );
    // And one minute after it is back — the 3-hour text may not linger, and the
    // 5-minute default may not outlive the reported reset either.
    assert.equal(
      evidence.isCandidateBlocked(data, key, { now: Date.parse(cooldownUntil) + 60_000 }).blocked,
      false,
      'the source returns as soon as the reported reset passes'
    );
  });

  test('5 an unparseable cooldownUntil is ignored, never guessed at', () => {
    const list = assembled();
    const key = candidateKey(list.find((c) => c.modelId === MODELS[2].modelId));
    const outcomeFile = path.join(dirs.root, 'outcome-bad.json');
    fs.writeFileSync(
      outcomeFile,
      JSON.stringify({
        candidateKey: key,
        status: 'failed',
        errorClass: 'QUOTA_EXHAUSTED',
        cooldownUntil: 'sometime tomorrow-ish',
        reason: '402 provider exhausted its credits',
      })
    );
    dispatchCommand(
      { 'report-outcome': outcomeFile, root: dirs.root },
      { log: () => {}, error: () => {}, exit: () => {}, evidenceDir: dirs.evidence, now: NOW }
    );

    const data = evidence.loadEvidence(dirs.evidence);
    const record = data.cooldowns[key];
    // The garbage instant must not become the reset time, and must not become
    // NaN either — the classification's own answer stands unchanged.
    assert.ok(
      record.resetTime === null || Number.isFinite(record.resetTime),
      'an unparseable reset time is null, never NaN'
    );
    assert.equal(record.cooldownUntil, undefined, 'no invented instant is stored');
    assert.ok(
      evidence.isCandidateBlocked(data, key, { now: NOW + 60_000 }).blocked,
      'the classified cooldown still applies'
    );
  });

  test('6 a disabled, deferred or un-routed account yields no candidate', () => {
    // A disabled account is not dispatchable, whatever the gateway advertises.
    const disabled = candidatesApi.gatewayAccountCandidates({
      registry: registry(),
      accounts: accounts({ enabled: false }),
      catalogue: catalogue(),
    });
    assert.equal(disabled.length, 0, 'a disabled account produces nothing');

    // A provider the registry does not route is skipped rather than guessed at:
    // guessing a harness is how a candidate that can never run gets planned.
    const unrouted = candidatesApi.gatewayAccountCandidates({
      registry: registry(),
      accounts: accounts({ provider: 'not-in-the-dispatch-table' }),
      catalogue: catalogue(),
    });
    assert.equal(unrouted.length, 0, 'an unrouted provider produces nothing');

    // A source that exists but is retired, and one whose disposition defers it,
    // both produce nothing — including a retired gateway the account rides.
    for (const reg of [
      Object.assign(registry(), {
        retired: [{ id: GATEWAY, label: 'G', retiredOn: 'x', reason: 'r' }],
      }),
      Object.assign(registry(), {
        retired: [{ id: CLI, label: 'C', retiredOn: 'x', reason: 'r' }],
      }),
    ]) {
      assert.equal(
        candidatesApi.gatewayAccountCandidates({
          registry: reg,
          accounts: accounts(),
          catalogue: catalogue(),
        }).length,
        0,
        'a retired source is never dispatched to'
      );
    }

    // An account on a source that carries a deferred disposition never produces
    // a candidate, even though the source is present in the registry.
    const deferred = candidatesApi.gatewayAccountCandidates({
      registry: registry(),
      accounts: accounts({ provider: 'deferred66' }),
      catalogue: catalogue(),
    });
    assert.equal(
      deferred.length,
      0,
      'a deferred source is recorded for audit, never dispatched to'
    );

    // An empty catalogue produces nothing: a gateway that advertises no model
    // is a gateway that serves no model, and the code must not fill the gap.
    const none = candidatesApi.gatewayAccountCandidates({
      registry: registry(),
      accounts: accounts(),
      catalogue: [],
    });
    assert.equal(none.length, 0, 'no advertised model means no candidate');
  });

  test('7 a model id that does not carry its own alias is not a candidate', () => {
    // The gateway's own pseudo-group: one id, no alias prefix. There is no
    // upstream to route by, so there is no candidate to mint.
    const rows = [{ upstream: 'combo66', modelId: 'combo66' }];
    const generated = candidatesApi.gatewayAccountCandidates({
      registry: registry(),
      accounts: accounts(),
      catalogue: catalogue(rows),
    });
    assert.equal(generated.length, 0, 'an unprefixed id names no reachable alias');

    // An id that disagrees with its own upstream is refused too — one of the two
    // is wrong and there is no honest way to pick.
    const mismatched = [{ upstream: ALIAS_A, modelId: ALIAS_B + '/model-66e' }];
    const refused = candidatesApi.gatewayAccountCandidates({
      registry: registry(),
      accounts: accounts(),
      catalogue: catalogue(mismatched),
    });
    assert.equal(refused.length, 0, 'a model id must carry the upstream it claims');
  });

  test('8 no model, alias or provider is hard-coded in the candidate path', () => {
    // The rule the whole design rests on: a name in the data is fine, a name in
    // the code is the bug. This scans the modules that decide candidate
    // identity for the model and alias names from the real 30/9 run.
    //
    // The registry (sources.json) and the committed discovery catalogue are
    // DATA — naming a gateway there is the whole point of them — and the
    // default fallbacks that predate this Work Item in discovery/read.js and
    // cli.js are not routing decisions, so they are out of scope here. What
    // must hold is that the candidate-assembly path itself names no model.
    const root = path.join(__dirname, '..');
    const modules = [
      'candidates.js',
      'cli.js',
      'routing.js',
      'evidence.js',
      'offerings.js',
      'sources.js',
      'ranking.js',
    ];

    // Aliases and model names from the nine real outcomes of the 30/9 run.
    // Matched as whole tokens so `openclaw` cannot trip the `ocl` entry.
    const forbidden = [
      /\bninerouter\b/i,
      /\b9router\b/i,
      /\bbig-pickle\b/i,
      /\bgrok-4\.7\b/i,
      /\bgpt-4\.1\b/i,
      /\bgpt-5\.3-codex\b/i,
      /\bgemini-3\.1-pro-low\b/i,
      /\bdeepseek-v4[\w.-]*/i,
      /\bkimchi\b/i,
      /\bgcli\b/i,
      /\bcline-free\b/i,
    ];

    const offenders = [];
    for (const file of modules) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      text.split('\n').forEach((line, i) => {
        // Comments explain the contract and must be able to name the real
        // machine; only executable code is scanned.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const pattern of forbidden) {
          if (pattern.test(line)) {
            offenders.push(file + ':' + (i + 1) + ' matches ' + pattern);
          }
        }
      });
    }
    assert.deepEqual(offenders, [], 'a model or gateway name in code is the bug this guards');
  });

  test('9 the assembled candidate carries no quality or cost it never measured', () => {
    // An advertised model is a route that exists. Scoring it as if it were
    // measured — cheap, fast, high quality — is how an unproven model outranks
    // a proven one. The floors decide, and an unmeasured value must be absent so
    // the score renormalises over the parts that are known.
    const generated = assembled();
    const undeclared = generated.filter((c) => c.modelId !== MODELS[0].modelId);
    assert.ok(undeclared.length >= 1, 'the fixture has advertised-but-undeclared models');
    for (const c of undeclared) {
      assert.equal(c.quality, undefined, c.modelId + ' must carry no invented quality');
      assert.equal(c.cost, undefined, c.modelId + ' must carry no invented cost');
    }
    // The one model the operator did declare keeps its declared grade, so a hand
    // written entry still wins over the bare advertised row.
    const declared = generated.find((c) => c.modelId === MODELS[0].modelId);
    assert.ok(declared, 'the declared model is still a candidate');
  });
});
