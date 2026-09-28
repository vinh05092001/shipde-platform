'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dispatchCommand } = require('../cli');
const { candidateKey, generateCandidates } = require('../candidates');
const { getHarness, runHarness, progressVerdict, ProgressStatus } = require('../harness');
const jev = require('../jev');

const NOW = Date.parse('2026-09-28T00:00:00Z');

function registry() {
  return {
    version: 1,
    sources: [
      {
        id: 'hermes',
        kind: 'harness',
        harness: 'hermes',
        accessPath: 'cli',
        credential: { type: 'none' },
        servesModels: false,
      },
      {
        id: 'gw-a',
        kind: 'router',
        harness: 'hermes',
        accessPath: 'cli-a',
        credential: { type: 'none' },
        servesModels: true,
      },
      {
        id: 'gw-b',
        kind: 'router',
        harness: 'hermes',
        accessPath: 'cli-b',
        credential: { type: 'none' },
        servesModels: true,
      },
    ],
    retired: [],
    dispatch: {
      providers: {
        hermes: { harness: 'hermes', provider: 'hermes' },
        'gw-a': { harness: 'hermes', provider: 'gw-a' },
        'gw-b': { harness: 'hermes', provider: 'gw-b' },
      },
    },
  };
}

function cand(overrides) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-a',
      gateway: 'gw-a',
      upstream: 'up-a',
      accountId: 'acct-a',
      quotaScope: 'acct-a',
      modelId: 'up-a/model-a',
      source: 'gw-a',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 64000 },
      cost: 1,
    },
    overrides || {}
  );
}

describe('TASK-AI-50 Hermes pinned adapter and Jev advisory', () => {
  let tmp;
  let evidenceDir;
  let decisionDir;
  let home;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-50-'));
    evidenceDir = path.join(tmp, 'evidence');
    decisionDir = path.join(tmp, 'decisions');
    home = path.join(tmp, 'home');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function runDispatch(candidates, run, extraArgs, extraDeps) {
    return dispatchCommand(
      Object.assign(
        {
          execute: true,
          item: 'TASK-AI-50-X',
          branch: 'feat/task-ai-50-x',
          root: tmp,
          'decision-dir': decisionDir,
          'max-attempts': 2,
        },
        extraArgs || {}
      ),
      Object.assign(
        {
          candidates,
          registry: registry(),
          evidenceDir,
          decisionDir,
          home,
          now: NOW,
          run,
          log: () => {},
          error: () => {},
          exit: () => {},
        },
        extraDeps || {}
      )
    );
  }

  test('1 getHarness("hermes") returns the adapter', () => {
    const adapter = getHarness('hermes');
    assert.equal(adapter.id, 'hermes');
    assert.equal(typeof adapter.launch, 'function');
    assert.equal(typeof adapter.resume, 'function');
    assert.equal(typeof adapter.stop, 'function');
  });

  test('2 Controller candidate is passed intact to Hermes', () => {
    const c = cand();
    const key = candidateKey(c);
    const calls = [];
    const result = runDispatch([c], (adapter, args) => {
      calls.push({ adapter, args });
      return { exitCode: 0, stdout: JSON.stringify({ sessionId: 'hermes-1' }) };
    });
    assert.equal(result.chosen, key);
    // corrected to real Hermes CLI v0.21.4
    assert.ok(calls[0].args.includes('-m'));
    assert.equal(calls[0].args[calls[0].args.indexOf('-m') + 1], c.modelId);
  });

  test('3 Hermes never changes the candidate', () => {
    const c = cand({ modelId: 'up-a/model-fixed', accountId: 'acct-fixed' });
    const key = candidateKey(c);
    const adapter = getHarness('hermes');
    const args = adapter.launch({
      candidateKey: key,
      model: c.modelId,
      provider: c.source,
      accountId: c.accountId,
      gateway: c.gateway,
      upstream: c.upstream,
      quotaScope: c.quotaScope,
      prompt: 'do work',
    });
    // corrected to real Hermes CLI v0.21.4
    assert.equal(args[args.indexOf('-m') + 1], c.modelId);
    assert.equal(args.includes('--ignore-user-config'), true);
  });

  test('4 quota error returns structured failure', () => {
    const c = cand();
    const key = candidateKey(c);
    const result = runDispatch(
      [c],
      () => ({
        exitCode: 3,
        stderr: 'usage limit reached; reset after 1m 00s',
      }),
      { 'max-attempts': 1 }
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.failedAttempts[0].key, key);
    assert.equal(result.failedAttempts[0].outcome.candidateKey, key);
    assert.equal(result.failedAttempts[0].outcome.errorClass, 'account_quota_exhausted');
    assert.equal(result.failedAttempts[0].outcome.failureScope, 'account');
  });

  test('5 Controller selects another candidate after failure', () => {
    const first = cand({ modelId: 'up-a/first' });
    const second = cand({
      accessPath: 'cli-b',
      gateway: 'gw-b',
      upstream: 'up-b',
      accountId: 'acct-b',
      quotaScope: 'acct-b',
      modelId: 'up-b/second',
      source: 'gw-b',
      cost: 2,
    });
    const launched = [];
    const result = runDispatch([first, second], () => {
      launched.push('call');
      if (launched.length === 1) return { exitCode: 3, stderr: 'usage limit reached' };
      return { exitCode: 0, stdout: '{"sessionId":"hermes-2"}' };
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.chosen, candidateKey(second));
    assert.equal(launched.length, 2);
  });

  test('6 gateway/upstream failure prefers a different failure domain', () => {
    const first = cand({ modelId: 'up-a/first' });
    const second = cand({
      accessPath: 'cli-b',
      gateway: 'gw-b',
      upstream: 'up-b',
      accountId: 'acct-b',
      quotaScope: 'acct-b',
      modelId: 'up-b/second',
      source: 'gw-b',
      cost: 2,
    });
    const keys = [];
    const result = runDispatch([first, second], (adapter, args) => {
      // corrected to real Hermes CLI v0.21.4
      keys.push(args[args.indexOf('-m') + 1]);
      if (keys.length === 1) return { exitCode: 1, stderr: 'gateway unreachable ECONNREFUSED' };
      return { exitCode: 0, stdout: '{"sessionId":"hermes-3"}' };
    });
    assert.equal(result.exitCode, 0);
    // corrected to real Hermes CLI v0.21.4
    assert.equal(keys[0], first.modelId);
    assert.equal(keys[1], second.modelId);
  });

  test('7 resume uses the durable checkpoint', () => {
    const first = cand({ modelId: 'up-a/first' });
    const second = cand({
      accessPath: 'cli-b',
      gateway: 'gw-b',
      upstream: 'up-b',
      accountId: 'acct-b',
      quotaScope: 'acct-b',
      modelId: 'up-b/resume',
      source: 'gw-b',
    });
    const checkpoint = path.join(tmp, 'checkpoint.json');
    fs.writeFileSync(
      checkpoint,
      JSON.stringify({ schemaVersion: 1, selectedCandidate: candidateKey(second) })
    );
    let launchedKey = null;
    const result = runDispatch(
      [first, second],
      (adapter, args) => {
        // corrected to real Hermes CLI v0.21.4
        launchedKey = args[args.indexOf('-m') + 1];
        return { exitCode: 0, stdout: '{"sessionId":"hermes-resumed"}' };
      },
      { checkpoint }
    );
    assert.equal(result.exitCode, 0);
    // corrected to real Hermes CLI v0.21.4
    assert.equal(launchedKey, second.modelId);
  });

  test('8 stop kills the whole process tree', () => {
    const adapter = getHarness('hermes');
    const stop = adapter.stop('1234');
    let killed = null;
    const res = runHarness(adapter, stop, {
      killTree(pid) {
        killed = pid;
        return { exitCode: 0, stdout: 'killed tree' };
      },
    });
    assert.equal(killed, 1234);
    assert.equal(res.exitCode, 0);
  });

  test('9 running without progress -> STALLED', () => {
    const verdict = progressVerdict(
      { startedAt: new Date(NOW - 20 * 60 * 1000).toISOString(), progress: {} },
      { now: NOW, stallMs: 15 * 60 * 1000 }
    );
    assert.equal(verdict.status, ProgressStatus.STALLED);
    assert.equal(verdict.reason, 'RUNNING_WITHOUT_PROGRESS');
  });

  test('10 a Hermes subagent cannot exist outside accounting', () => {
    const adapter = getHarness('hermes');
    assert.throws(
      () =>
        adapter.launch({
          candidateKey: candidateKey(cand()),
          model: 'up-a/model-a',
          subagents: ['slice-a'],
          prompt: 'do work',
        }),
      /HERMES_SUBAGENT_REQUIRES_CONTROLLER_ASSIGNMENT/
    );
  });

  test('11 Jev low confidence -> UNDECIDED', async () => {
    const result = await jev.advise(
      { prompt: 'pick', evidence: 'probe evidence', options: ['A', 'B'] },
      { ask: async () => ({ choice: 'A', confidence: 0.69 }) }
    );
    assert.equal(result.outcome, jev.Outcome.UNDECIDED);
    assert.equal(result.reason, 'LOW_CONFIDENCE');
  });

  test('12 UNDECIDED handed to the reasoning controller', async () => {
    let handedOff = false;
    const result = await jev.adviseOrReason(
      { prompt: 'pick', evidence: 'probe evidence', options: ['A', 'B'] },
      {
        ask: async () => ({ choice: 'A', confidence: 0.1 }),
        reasoningController: async (question, jevResult) => {
          handedOff = jevResult.outcome === jev.Outcome.UNDECIDED;
          return { choice: question.options[1], confidence: 0.9, reason: 'fallback reasoning' };
        },
      }
    );
    assert.equal(handedOff, true);
    assert.equal(result.handledBy, 'reasoning-controller');
    assert.equal(result.choice, 'B');
  });

  test('13 no concrete model/provider hard-coded in the adapter', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'harness.js'), 'utf8');
    assert.equal(/gpt-|claude-|gemini-|sonnet|opus|haiku/i.test(source), false);
    assert.equal(/openai|anthropic|google/i.test(source), false);
  });

  test('14 adding a source by data needs no code change', () => {
    const reg = registry();
    reg.sources.push({
      id: 'data-only',
      kind: 'model-source',
      reachedVia: 'gw-a',
      routerAlias: 'newup',
      servesModels: true,
    });
    const generated = generateCandidates({
      registry: reg,
      catalogue: ['newup/data-model'],
      accounts: [{ id: 'acct-data', sourceId: 'data-only' }],
    });
    const found = generated.find(
      (c) => c.modelId === 'newup/data-model' && c.source === 'data-only'
    );
    assert.ok(found);
    assert.equal(found.harness, 'hermes');
    assert.equal(found.accountId, 'acct-data');
  });
});
