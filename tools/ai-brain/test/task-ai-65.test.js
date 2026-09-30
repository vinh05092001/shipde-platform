'use strict';

/**
 * Ship Dễ — TASK-AI-65 live routing contract tests.
 *
 * The flow under test is the one the Work Item requires:
 *
 *   task profile -> JEV advisory (never a model) -> Controller ranking with
 *   floors (proof, quality, capability, availability, policy, failure domain)
 *   -> top 3 -> pinned candidateKey -> structured outcome reported back into
 *   the evidence store before the next ranking round.
 *
 * Every test uses the real modules (jev.js, evidence.js, decisions.js,
 * ranking.js, quota-store.js, failure classification through
 * evidence.recordOutcome) over temp directories. No network, no agent, no
 * model literal: candidate identities are built with the same seven-part
 * candidateKey() the Controller uses, and the one place a model family name
 * appears in production code (the Claude-family exclusion policy) is asserted
 * to be a refusal rule, never a routing choice.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dispatchCommand } = require('../cli');
const routing = require('../routing');
const evidence = require('../evidence');
const { candidateKey } = require('../candidates');

const NOW = Date.parse('2026-09-30T00:00:00.000Z');
const DAY = '2026-09-30';

/** A fixed clock so every time-sensitive assertion is machine-independent. */
const iso = (ms) => new Date(ms).toISOString();

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A concrete seven-part candidate; every identity value is test-local. */
function cand(over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-65-a',
      gateway: 'gw-65-a',
      upstream: 'up-65-a',
      accountId: 'acct-65-a',
      quotaScope: 'acct-65-a',
      modelId: 'up-65-a/model-65-a',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 200000 },
      cost: 5,
      quality: 80,
      latencyMs: 30000,
    },
    over || {}
  );
}

/** A valid profile; tests override the fields the row under test exercises. */
function profile(over) {
  return Object.assign(
    {
      taskId: 'TASK-AI-65-T',
      role: 'writer',
      complexity: 'short',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 64000,
      expectedDuration: 600000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 1000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 4,
      currentWorkload: 1,
    },
    over || {}
  );
}

/**
 * Runs one profile dispatch with injected candidates and captured output.
 * `deps.over` extends the deps (ask, reservations, headrooms...).
 */
async function runDispatch(p, candidates, dirs, over) {
  const profileFile = path.join(dirs.root, 'profile.json');
  fs.writeFileSync(profileFile, JSON.stringify(p));
  const lines = [];
  let exitCode = null;
  const deps = Object.assign(
    {
      candidates,
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
    { profile: profileFile, 'dry-run': !deps.execute, execute: !!deps.execute },
    deps
  );
  return { result, lines, exitCode, deps, profileFile };
}

/** Reads the decision lines the run wrote for the fixed clock's day. */
function decisionLines(dir) {
  const file = path.join(dir, DAY + '.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Seeds one passed evidence item for a candidate in an evidence dir. */
function seedPass(evidenceDir, candidate, level) {
  evidence.recordOutcome(evidenceDir, candidate, {
    status: 'passed',
    level,
    source: 'task-ai-65-test',
  });
}

describe('TASK-AI-65: live routing (profile -> JEV -> ranking -> pinned execution)', () => {
  let dirs;

  beforeEach(() => {
    dirs = {
      root: tmpDir('ai65-root-'),
      evidence: tmpDir('ai65-evidence-'),
      decisions: tmpDir('ai65-decisions-'),
      home: tmpDir('ai65-home-'),
    };
  });

  afterEach(() => {
    for (const d of Object.values(dirs)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {}
    }
  });

  test('65-01: a short task picks the fast candidate meeting the proof floor, not the strongest', async () => {
    const fast = cand({
      modelId: 'up-65-a/model-65-fast',
      latencyMs: 20000,
      quality: 70,
      cost: 5,
    });
    const strong = cand({
      modelId: 'up-65-a/model-65-strong',
      latencyMs: 300000,
      quality: 98,
      cost: 50,
    });
    seedPass(dirs.evidence, fast, evidence.Level.API);
    seedPass(dirs.evidence, strong, evidence.Level.API);

    const { result, lines, exitCode } = await runDispatch(
      profile({
        complexity: 'short',
        latencyPriority: 'high',
        proofFloor: 'API_PASS',
        qualityFloor: 60,
      }),
      [fast, strong],
      dirs
    );

    assert.equal(exitCode, 0);
    assert.equal(result.pinnedCandidateKey, candidateKey(fast));
    assert.notEqual(result.pinnedCandidateKey, candidateKey(strong));
    const strongEntry = result.ranking.find((c) => c.candidateKey === candidateKey(strong));
    assert.ok(strongEntry, 'the stronger candidate is ranked, not dropped');
    assert.ok(
      result.top3[0].score > strongEntry.score,
      'the fast candidate outscores the strong one'
    );
    assert.match(lines.join('\n'), /Pinned \(dry run, no reservation\)/);
  });

  test('65-02: a security review meets the quality floor and lands outside the writer failure domain', async () => {
    const writerDomain = { gateway: 'gw-65-writer', upstream: 'up-65-writer' };
    const onWriterDomain = cand(
      Object.assign({ modelId: 'up-65-writer/model-65-hq', quality: 96 }, writerDomain)
    );
    const claudeElsewhere = cand({
      modelId: 'up-65-x/cc-claude-sonnet-4',
      gateway: 'gw-65-x',
      upstream: 'up-65-x',
      quality: 99,
    });
    const highQualityElsewhere = cand({
      modelId: 'up-65-y/model-65-hq',
      gateway: 'gw-65-y',
      upstream: 'up-65-y',
      quality: 92,
      latencyMs: 400000,
      cost: 10,
    });
    const cheapLowQuality = cand({
      modelId: 'up-65-z/model-65-fast',
      gateway: 'gw-65-z',
      upstream: 'up-65-z',
      quality: 70,
      latencyMs: 20000,
    });

    const { result, exitCode } = await runDispatch(
      profile({
        role: 'security-review',
        qualityFloor: 85,
        forbiddenFailureDomains: ['gw-65-writer', 'up-65-writer'],
      }),
      [onWriterDomain, claudeElsewhere, highQualityElsewhere, cheapLowQuality],
      dirs
    );

    assert.equal(exitCode, 0);
    const pinned = result.pinnedCandidateKey;
    assert.equal(pinned, candidateKey(highQualityElsewhere));
    const pinnedEntry = result.top3.find((c) => c.candidateKey === pinned);
    assert.notEqual(
      pinnedEntry.gateway,
      writerDomain.gateway,
      'reviewer is off the writer gateway'
    );
    assert.notEqual(
      pinnedEntry.upstream,
      writerDomain.upstream,
      'reviewer is off the writer upstream'
    );

    const rejects = result.rejected;
    assert.ok(
      rejects.some(
        (r) =>
          r.candidateKey === candidateKey(onWriterDomain) &&
          r.reasonCode === 'FORBIDDEN_FAILURE_DOMAIN'
      )
    );
    assert.ok(
      rejects.some(
        (r) =>
          r.candidateKey === candidateKey(cheapLowQuality) &&
          r.reasonCode === 'QUALITY_FLOOR_NOT_MET'
      )
    );
    assert.ok(
      rejects.some(
        (r) =>
          r.candidateKey === candidateKey(claudeElsewhere) &&
          r.reasonCode === 'CLAUDE_FAMILY_EXCLUDED_BY_POLICY'
      )
    );
  });

  test('65-03: a quota-exhausted candidate is never chosen', async () => {
    const dry = cand({
      modelId: 'up-65-a/model-65-a',
      accountId: 'acct-65-dry',
      quotaScope: 'acct-65-dry',
    });
    const empty = cand({
      modelId: 'up-65-a/model-65-b',
      accountId: 'acct-65-empty',
      quotaScope: 'acct-65-empty',
    });

    const { result, exitCode } = await runDispatch(profile(), [dry, empty], dirs, {
      headrooms: { 'acct-65-empty': { status: 'exhausted', reason: 'QUOTA_EXHAUSTED' } },
    });

    assert.equal(exitCode, 0);
    assert.equal(result.pinnedCandidateKey, candidateKey(dry));
    assert.ok(
      result.rejected.some(
        (r) => r.candidateKey === candidateKey(empty) && r.reasonCode === 'QUOTA_EXHAUSTED'
      ),
      'the exhausted candidate is excluded with a named reason'
    );
  });

  test('65-04: a busy/reserved candidate is penalised below an equally good free one', async () => {
    const free = cand({ modelId: 'up-65-a/model-65-free' });
    const busy = cand({
      modelId: 'up-65-a/model-65-busy',
      accountId: 'acct-65-busy',
      quotaScope: 'acct-65-busy',
    });

    const { result, exitCode } = await runDispatch(profile(), [free, busy], dirs, {
      reservations: [
        {
          workItemId: 'TASK-OTHER-65',
          offeringId: candidateKey(busy),
          accountId: 'acct-65-busy',
          modelId: busy.modelId,
          upstream: busy.upstream,
        },
      ],
    });

    assert.equal(exitCode, 0);
    assert.equal(result.pinnedCandidateKey, candidateKey(free));
    const freeEntry = result.ranking.find((c) => c.candidateKey === candidateKey(free));
    const busyEntry = result.ranking.find((c) => c.candidateKey === candidateKey(busy));
    assert.ok(freeEntry.score > busyEntry.score, 'the reserved candidate scores lower');
    assert.equal(busyEntry.reservationsHeld, 1);
  });

  test('65-05: a gateway failure reported through --report-outcome switches the next ranking to another failure domain', async () => {
    const onGw1 = cand({
      modelId: 'up-65-a/model-65-a',
      gateway: 'gw-65-one',
      latencyMs: 20000,
      quality: 90,
    });
    const onGw2 = cand({
      modelId: 'up-65-b/model-65-b',
      gateway: 'gw-65-two',
      upstream: 'up-65-b',
      accountId: 'acct-65-b',
      quotaScope: 'acct-65-b',
      latencyMs: 40000,
      quality: 90,
    });

    const first = await runDispatch(profile(), [onGw1, onGw2], dirs);
    assert.equal(first.exitCode, 0);
    assert.equal(first.result.pinnedCandidateKey, candidateKey(onGw1));

    // The pinned execution fails at the gateway and reports the structured
    // outcome through the real dispatch seam.
    const outcomeFile = path.join(dirs.root, 'outcome.json');
    fs.writeFileSync(
      outcomeFile,
      JSON.stringify({
        candidateKey: candidateKey(onGw1),
        status: 'failed',
        errorClass: 'unknown',
        failureScope: 'gateway',
        retryable: true,
        cooldownUntil: null,
        checkpoint: null,
        artifacts: [],
        lastProgressAt: iso(NOW - 60 * 1000),
        reason: 'connect ECONNREFUSED 127.0.0.1:20128: gateway unreachable',
      })
    );
    const reportLines = [];
    let reportExit = null;
    const reported = dispatchCommand(
      { 'report-outcome': outcomeFile },
      {
        evidenceDir: dirs.evidence,
        decisionDir: dirs.decisions,
        home: dirs.home,
        storePath: dirs.storePath,
        now: NOW,
        log: (s) => reportLines.push(String(s)),
        error: (s) => reportLines.push('ERR ' + String(s)),
        exit: (c) => {
          reportExit = c;
        },
      }
    );
    assert.equal(reported.exitCode, 0);
    assert.equal(reportExit, 0);
    assert.match(reportLines.join('\n'), /FAILED.*gw-65-one/);

    // The next ranking round sees the failure through the evidence store
    // before it picks again.
    const second = await runDispatch(profile(), [onGw1, onGw2], dirs);
    assert.equal(second.exitCode, 0);
    assert.equal(second.result.pinnedCandidateKey, candidateKey(onGw2));
    assert.notEqual(
      second.result.pinnedCandidateKey,
      first.result.pinnedCandidateKey,
      'the failed gateway is not retried'
    );
    assert.ok(
      second.result.rejected.some(
        (r) =>
          r.candidateKey === candidateKey(onGw1) &&
          r.reasonCode === 'CANDIDATE_BLOCKED' &&
          r.scope === 'gateway'
      ),
      'the gateway-domain cooldown is the named exclusion'
    );
  });

  test('65-06: a JEV UNDECIDED advisory still ends in a Controller decision, never a crash', async () => {
    const p = profile({ taskId: 'TASK-AI-65-UNDECIDED' });
    const c = cand();

    const noAsk = await routing.assessTask(p, {});
    assert.equal(noAsk.jevOutcome, 'UNDECIDED');
    assert.equal(noAsk.decidedBy, 'controller');
    assert.equal(noAsk.weightProfile, routing.ROLE_FALLBACK_PROFILE[p.role]);

    const throwingAsk = await routing.assessTask(p, {
      ask: async () => {
        throw new Error('gateway down');
      },
    });
    assert.equal(throwingAsk.jevOutcome, 'UNDECIDED');
    assert.equal(throwingAsk.decidedBy, 'controller');

    const lowConfidence = await routing.assessTask(p, {
      ask: async () => ({ choice: 'LATENCY_FIRST', confidence: 0.2 }),
    });
    assert.equal(lowConfidence.jevOutcome, 'UNDECIDED');
    assert.equal(lowConfidence.decidedBy, 'controller');

    const decided = await routing.assessTask(p, {
      ask: async () => ({
        choice: 'QUALITY_FIRST',
        confidence: 0.9,
        reason: 'security review needs quality',
      }),
    });
    assert.equal(decided.jevOutcome, 'DECIDED');
    assert.equal(decided.decidedBy, 'jev');
    assert.equal(decided.recommendedModelClass, 'high-quality');

    // And the dispatch itself completes and pins a candidate with no ask at all.
    const { result, exitCode } = await runDispatch(p, [c], dirs);
    assert.equal(exitCode, 0);
    assert.equal(result.pinnedCandidateKey, candidateKey(c));
    assert.equal(result.assessment.jevOutcome, 'UNDECIDED');
  });

  test('65-07: no model, provider or account id is hard-coded in the routing source', () => {
    const sources = ['routing.js', 'cli.js'].map((f) => ({
      name: f,
      text: fs.readFileSync(path.join(__dirname, '..', f), 'utf8'),
    }));

    // The Claude-family policy must exist as an exclusion pattern — a refusal
    // rule, not a routing choice — and every other family name must be absent
    // from every quoted literal in the routing source.
    assert.match(
      routing.CLAUDE_FAMILY_PATTERN.source,
      /^claude\|opus\|sonnet\|haiku$/i,
      'the policy pattern names exactly the forbidden family'
    );
    assert.equal(routing.CLAUDE_FAMILY_REASON, 'CLAUDE_FAMILY_EXCLUDED_BY_POLICY');

    const policyStrings = new Set([
      routing.CLAUDE_FAMILY_REASON,
      'CLAUDE_FAMILY_EXCLUDED_BY_POLICY',
      routing.CLAUDE_FAMILY_PATTERN.source,
    ]);
    // A model/provider family name, as a whole word. Module names on require
    // paths (for example the Antigravity account reader) are code, not a
    // routing choice, so path-like literals are not routing hard-codes.
    const familyTokens =
      /\b(gpt|gemini|claude|qwen|glm|deepseek|minimax|grok|llama|kimi|opus|sonnet|haiku|codex|antigravity|ninerouter)\b/i;

    for (const { name, text } of sources) {
      const literals = text.match(/'([^'\n]*)'|"([^"\n]*)"/g) || [];
      for (const literal of literals) {
        const inner = literal.slice(1, -1);
        if (policyStrings.has(inner)) continue;
        if (/^[.\/]/.test(inner) || /^[a-z@][a-z0-9-]*[\/]/.test(inner)) continue;
        assert.doesNotMatch(
          inner,
          familyTokens,
          name + ' hard-codes a model/provider family in the literal: ' + literal
        );
      }
    }
  });

  test('65-08: the decision log records the task profile, the JEV result, the full ranking and the final candidate', async () => {
    const a = cand({ modelId: 'up-65-a/model-65-a' });
    const b = cand({ modelId: 'up-65-a/model-65-b' });
    const p = profile({ taskId: 'TASK-AI-65-LOG' });

    const { result, exitCode } = await runDispatch(p, [a, b], dirs);
    assert.equal(exitCode, 0);

    const entries = decisionLines(dirs.decisions);
    const entry = entries.find((e) => e.workItemId === 'TASK-AI-65-LOG' && e.stage === 'selected');
    assert.ok(entry, 'a selected entry exists for the profile task');
    assert.equal(entry.taskProfile.taskId, 'TASK-AI-65-LOG');
    assert.equal(entry.taskProfile.role, 'writer');
    assert.equal(entry.jev.jevOutcome, 'UNDECIDED');
    assert.ok(entry.jev.weights && entry.jev.weights.latency > 0);
    assert.ok(Array.isArray(entry.jev.reasonCodes) && entry.jev.reasonCodes.length > 0);
    assert.ok(Array.isArray(entry.ranking) && entry.ranking.length === 2);
    for (const r of entry.ranking) {
      assert.ok(r.candidateKey.includes('::'), 'ranking rows carry the 7-part candidate key');
      assert.ok(Number.isFinite(r.score));
    }
    assert.equal(entry.chosen, result.pinnedCandidateKey);
    assert.ok(entry.reason.includes('fastest candidate meeting'));
  });

  test('65-09: the Claude family is excluded from worker and reviewer roles by policy, and allowed on analyst lanes', () => {
    assert.equal(
      routing.claudeFamilyExclusion('writer', 'cc/claude-opus-5'),
      'CLAUDE_FAMILY_EXCLUDED_BY_POLICY'
    );
    assert.equal(
      routing.claudeFamilyExclusion('reviewer', 'claude-sonnet-4-6'),
      'CLAUDE_FAMILY_EXCLUDED_BY_POLICY'
    );
    assert.equal(
      routing.claudeFamilyExclusion('security-review', 'kr/claude-haiku-4-5'),
      'CLAUDE_FAMILY_EXCLUDED_BY_POLICY'
    );
    assert.equal(routing.claudeFamilyExclusion('scanner', 'cc/claude-opus-5'), null);
    assert.equal(routing.claudeFamilyExclusion('researcher', 'claude-sonnet-4-6'), null);
    assert.equal(routing.claudeFamilyExclusion('integrator', 'claude-haiku-4-5'), null);
    assert.equal(routing.claudeFamilyExclusion('writer', 'up-65-a/model-65-a'), null);
  });

  test('65-10: an invalid task profile is refused with named field errors and no ranking happens', async () => {
    const bad = profile({ role: 'planner', proofFloor: 'GUESS', qualityFloor: 140 });
    const c = cand();
    const { lines, exitCode, result } = await runDispatch(bad, [c], dirs);
    assert.equal(exitCode, 2);
    assert.match(lines.join('\n'), /PROFILE_INVALID/);
    assert.match(lines.join('\n'), /role\(UNKNOWN_ROLE\)/);
    assert.match(lines.join('\n'), /proofFloor\(UNKNOWN_PROOF_FLOOR\)/);
    assert.match(lines.join('\n'), /qualityFloor\(MALFORMED_QUALITY_FLOOR\)/);
    assert.equal(result.ranking, undefined);

    const missing = { taskId: 'TASK-AI-65-BAD' };
    const { exitCode: exit2 } = await runDispatch(missing, [c], dirs);
    assert.equal(exit2, 2);
  });

  test('65-11: the stall thresholds are the contract constants and drive reselection', () => {
    assert.equal(routing.STALL_REQUEST_FINISH_MS, 7 * 60 * 1000);
    assert.equal(routing.STALL_STRUCTURED_FAILURE_MS, 12 * 60 * 1000);

    const withinBoth = routing.stallAssessment(
      { status: 'running', lastProgressAt: iso(NOW - 3 * 60 * 1000) },
      NOW
    );
    assert.equal(withinBoth.requestFinishStalled, false);
    assert.equal(withinBoth.reselectRequired, false);

    const pastRequestFinish = routing.stallAssessment(
      { status: 'running', lastProgressAt: iso(NOW - 8 * 60 * 1000) },
      NOW
    );
    assert.equal(pastRequestFinish.requestFinishStalled, true);
    assert.equal(pastRequestFinish.reselectRequired, false);

    const failedPastWindow = routing.stallAssessment(
      { status: 'failed', lastProgressAt: iso(NOW - 13 * 60 * 1000) },
      NOW
    );
    assert.equal(failedPastWindow.requestFinishStalled, true);
    assert.equal(failedPastWindow.reselectRequired, true);

    const failedNoProgress = routing.stallAssessment({ status: 'failed' }, NOW);
    assert.equal(failedNoProgress.reselectRequired, true);
  });

  test('65-12: an invalid reported outcome is refused, a valid one updates evidence and the decision log', async () => {
    const invalidFile = path.join(dirs.root, 'bad-outcome.json');
    fs.writeFileSync(invalidFile, JSON.stringify({ status: 'failed' }));
    let invalidExit = null;
    const invalidLines = [];
    dispatchCommand(
      { 'report-outcome': invalidFile },
      {
        evidenceDir: dirs.evidence,
        decisionDir: dirs.decisions,
        home: dirs.home,
        storePath: dirs.storePath,
        now: NOW,
        log: (s) => invalidLines.push(String(s)),
        error: (s) => invalidLines.push('ERR ' + String(s)),
        exit: (c) => {
          invalidExit = c;
        },
      }
    );
    assert.equal(invalidExit, 2);
    assert.match(invalidLines.join('\n'), /OUTCOME_INVALID/);

    const c = cand({ modelId: 'up-65-a/model-65-out' });
    const goodFile = path.join(dirs.root, 'good-outcome.json');
    fs.writeFileSync(
      goodFile,
      JSON.stringify({
        candidateKey: candidateKey(c),
        status: 'failed',
        errorClass: 'upstream_credit_exhausted',
        failureScope: 'upstream',
        retryable: true,
        cooldownUntil: null,
        checkpoint: null,
        artifacts: [],
        lastProgressAt: iso(NOW - 13 * 60 * 1000),
        reason: 'HTTP 503 from gateway: [402]: upstream budget exhausted; reset after 1h 00m',
      })
    );
    let goodExit = null;
    const goodLines = [];
    dispatchCommand(
      { 'report-outcome': goodFile },
      {
        evidenceDir: dirs.evidence,
        decisionDir: dirs.decisions,
        home: dirs.home,
        storePath: dirs.storePath,
        now: NOW,
        log: (s) => goodLines.push(String(s)),
        error: (s) => goodLines.push('ERR ' + String(s)),
        exit: (c2) => {
          goodExit = c2;
        },
      }
    );
    assert.equal(goodExit, 0);
    assert.match(goodLines.join('\n'), /FAILED/);
    assert.match(goodLines.join('\n'), /RESELECT_REQUIRED/);

    const data = evidence.loadEvidence(dirs.evidence);
    const blocked = evidence.isCandidateBlocked(data, c, { now: NOW + 1000 });
    assert.equal(
      blocked.blocked,
      true,
      'the failed candidate is in cooldown before the next ranking'
    );

    const entry = decisionLines(dirs.decisions).find((e) => e.stage === 'failed');
    assert.ok(entry, 'a failed decision entry is written');
    assert.equal(entry.chosen, candidateKey(c));
    assert.equal(entry.outcome.errorClass, 'upstream_credit_exhausted');
    assert.equal(entry.stall.reselectRequired, true);
  });
  test('65-13: missing floors and penalties are asserted', async () => {
    const dirs = {
      root: tmpDir('65-root'),
      evidence: tmpDir('65-evidence'),
      decisions: tmpDir('65-decisions'),
      home: tmpDir('65-home'),
    };

    // 1. PROOF_FLOOR_NOT_MET
    const noProof = cand({ accountId: 'a', modelId: 'up/m1' });
    const p1 = profile({ proofFloor: 'API_PASS' });
    const r1 = await runDispatch(p1, [noProof], dirs);
    assert.equal(r1.result.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');

    // 2. COST_CEILING_EXCEEDED
    const highCost = cand({ accountId: 'a', modelId: 'up/m2', cost: 10000 });
    const p2 = profile({ costCeiling: 100 });
    const r2 = await runDispatch(p2, [highCost], dirs);
    assert.equal(r2.result.rejected[0].reasonCode, 'COST_CEILING_EXCEEDED');

    // 3. CAPABILITY_MISSING
    const noCap = cand({
      harness: 'openclaw',
      accountId: 'a',
      modelId: 'up/m3',
      capabilities: ['text'],
    });
    const p3 = profile({ requiredCapabilities: ['image'] });
    const r3 = await runDispatch(p3, [noCap], dirs);
    assert.equal(r3.result.rejected[0].reasonCode, 'CAPABILITY_MISSING:image');

    // 4. CONTEXT_SIZE_FLOOR_NOT_MET
    const smallCtx = cand({
      accountId: 'a',
      modelId: 'up/m4',
      capabilities: { contextWindow: 1000 },
    });
    const p4 = profile({ contextSize: 4000 });
    const r4 = await runDispatch(p4, [smallCtx], dirs);
    if (!r4.result.rejected[0]) console.log('r4 rejected:', r4.result.rejected);
    assert.ok(r4.result.rejected[0].reasonCode.startsWith('CONTEXT_TOO_SMALL'));

    // 5. WILDCARD_ACCOUNT
    const wildcard = cand({ accountId: '*', modelId: 'up/m5' });
    const p5 = profile({});
    const r5 = await runDispatch(p5, [wildcard], dirs);
    assert.equal(r5.result.rejected[0].reasonCode, 'WILDCARD_ACCOUNT');

    // 6. CANDIDATE_BLOCKED on quota cooldown
    const cooling = cand({ accountId: 'cooling', modelId: 'up/m6' });
    const p6 = profile({});
    const r6 = await runDispatch(p6, [cooling], dirs, {
      headrooms: { cooling: { status: 'cooling', reason: 'COOLDOWN_ACTIVE' } },
    });
    assert.equal(r6.result.rejected[0].reasonCode, 'COOLDOWN_ACTIVE');

    // 7. Evidence-age penalty
    const oldEv = cand({ accountId: 'a', modelId: 'up/m7' });
    const p7 = profile({});
    seedPass(dirs.evidence, oldEv, 1);
    const evData = JSON.parse(fs.readFileSync(path.join(dirs.evidence, 'evidence.json'), 'utf8'));
    evData.combinations[0].evidence[0].ts = iso(NOW - 30 * 24 * 3600 * 1000);
    fs.writeFileSync(path.join(dirs.evidence, 'evidence.json'), JSON.stringify(evData));
    const r7 = await runDispatch(p7, [oldEv], dirs);
    assert.ok(r7.result.top3[0].scoreBreakdown.evidenceAgePenalty > 0);
  });

  test('65-14: --execute reservation and latency-priority controller fallback', async () => {
    const dirs = {
      root: tmpDir('65-root'),
      evidence: tmpDir('65-evidence'),
      decisions: tmpDir('65-decisions'),
      home: tmpDir('65-home'),
      storePath: path.join(tmpDir('65-store'), 'quota.json'),
    };
    fs.mkdirSync(path.dirname(dirs.storePath), { recursive: true });
    fs.writeFileSync(dirs.storePath, '{}');

    const c = cand({ accountId: 'acct-exec', modelId: 'up/m1' });
    const p = profile({ taskId: 'TASK-EXEC', role: 'writer', latencyPriority: 'high' });

    const r = await runDispatch(p, [c], dirs, { execute: true });
    assert.equal(r.exitCode, 0);

    // Check reservation written
    const store = JSON.parse(
      fs.readFileSync(path.join(dirs.home, '.shipde', 'agy-quota.json'), 'utf8')
    ).reservations;
    assert.ok(Object.keys(store || {}).length > 0);
    assert.equal(Object.values(store)[0].workItemId, 'TASK-EXEC');

    // Latency-priority branch in controller fallback
    const entry = decisionLines(dirs.decisions).find(
      (e) => e.workItemId === 'TASK-EXEC' && e.stage === 'selected'
    );
    assert.equal(entry.jev.weights.latency, 55); // LATENCY_FIRST has latency 55
  });
});
