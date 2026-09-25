'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const jev = require('../jev');
const {
  getHarness,
  handleToDir,
  DIR_HANDLE,
  runHarness,
  contextRefusal,
  MIN_CONTEXT,
} = require('../harness');
const { executePlan, Outcome } = require('../executor');
const { loadSources } = require('../sources');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-jev-'));
}

/** A transport that answers without a network, and records what was asked. */
function fakeTransport(answers) {
  const calls = [];
  const fn = async (url, body) => {
    calls.push({ url, body });
    if (answers instanceof Error) throw answers;
    return { answers };
  };
  fn.calls = calls;
  return fn;
}

const withKey = (over) => Object.assign({ env: { TYPESAFE_API_KEY: 'k' } }, over || {});

// ================================================================ Gap 6: Jev refuses non-closed questions

describe('jev — what it refuses to be asked', () => {
  test('a question with no closed option set is rejected before any call', () => {
    assert.throws(
      () => jev.validateQuestions({ plan: { type: 'text' } }),
      /must be type choice or noul/
    );
  });

  test('a choice with one option is not a decision', () => {
    assert.throws(
      () => jev.validateQuestions({ pick: { type: 'choice', criteria: { only: 'the only one' } } }),
      /at least two options/
    );
  });

  test('an empty call is rejected', () => {
    assert.throws(() => jev.validateQuestions({}), /at least one question/);
  });

  test('a valid closed question passes', () => {
    jev.validateQuestions({
      kind: { type: 'choice', criteria: { a: 'one', b: 'two' } },
      sure: { type: 'noul', criteria: { true: 'yes', false: 'no' } },
    });
  });
});

// ================================================================ Gap 7: confidence floor

describe('jev — the confidence floor', () => {
  const question = { pick: { type: 'choice', criteria: { a: 'one', b: 'two' } } };

  test('a confident answer is used', async () => {
    const t = fakeTransport({ pick: { choice: 'a', confidence: 0.92 } });
    const r = await jev.ask('state', question, withKey({ transport: t }));
    assert.equal(r.outcome, jev.Outcome.DECIDED);
    assert.equal(r.answers.pick.choice, 'a');
    assert.equal(r.answers.pick.accepted, true);
  });

  test('an unsure answer is discarded and says so', async () => {
    const t = fakeTransport({ pick: { choice: 'a', confidence: 0.4 } });
    const r = await jev.ask('state', question, withKey({ transport: t }));
    assert.equal(r.outcome, jev.Outcome.UNSURE);
    assert.equal(r.answers.pick.accepted, false);
    // The choice is still reported, so a caller can log what was rejected.
    assert.equal(r.answers.pick.choice, 'a');
    assert.match(r.detail, /confidence floor/);
  });

  test('the floor is configurable per call', async () => {
    const t = fakeTransport({ pick: { choice: 'a', confidence: 0.6 } });
    const strict = await jev.ask('s', question, withKey({ transport: t, minConfidence: 0.9 }));
    const loose = await jev.ask('s', question, withKey({ transport: t, minConfidence: 0.5 }));
    assert.equal(strict.outcome, jev.Outcome.UNSURE);
    assert.equal(loose.outcome, jev.Outcome.DECIDED);
  });

  test('a missing confidence is not confidence', async () => {
    const t = fakeTransport({ pick: { choice: 'a' } });
    const r = await jev.ask('s', question, withKey({ transport: t }));
    assert.equal(r.outcome, jev.Outcome.UNSURE);
    assert.equal(r.answers.pick.confidence, 0);
  });

  test('an answer for a question that was not asked is ignored', async () => {
    const t = fakeTransport({ somethingElse: { choice: 'x', confidence: 1 } });
    const r = await jev.ask('s', question, withKey({ transport: t }));
    assert.equal(r.answers.pick.choice, null);
    assert.equal(r.answers.somethingElse, undefined);
  });
});

// ================================================================ Gap 7: unreachable = UNDECIDED, never a guess

describe('jev — never breaks its caller', () => {
  const question = { pick: { type: 'choice', criteria: { a: 'one', b: 'two' } } };

  test('an unreachable service is undecided, not a guess', async () => {
    const t = fakeTransport(new Error('ETIMEDOUT'));
    const r = await jev.ask('s', question, withKey({ transport: t }));
    assert.equal(r.outcome, jev.Outcome.UNAVAILABLE);
    assert.deepEqual(r.answers, {});
    assert.match(r.detail, /ETIMEDOUT/);
  });

  test('no credential means unavailable, and nothing is sent', async () => {
    const t = fakeTransport({ pick: { choice: 'a', confidence: 1 } });
    const r = await jev.ask('s', question, {
      transport: t,
      env: {},
      keyFile: 'C:/nowhere/no-such-key-file',
    });
    assert.equal(r.outcome, jev.Outcome.UNAVAILABLE);
    assert.equal(t.calls.length, 0, 'transport must not be called without a key');
  });

  test('a throttled service is unavailable, never parsed as a verdict', async () => {
    // Regression guard for the HTTP-status check on the real transport: a
    // 429 is a refusal to answer, not an answer, and must surface as
    // unavailable rather than as whatever error body came back.
    const https = require('https');
    const realRequest = https.request;
    const EventEmitter = require('node:events').EventEmitter;
    https.request = (options, cb) => {
      const res = new EventEmitter();
      res.statusCode = 429;
      const req = new EventEmitter();
      process.nextTick(() => {
        cb(res);
        res.emit('data', Buffer.from('{"answers":{},"detail":"rate limited"}'));
        res.emit('end');
      });
      req.write = () => {};
      req.end = () => {};
      return req;
    };
    try {
      const r = await jev.ask(
        's',
        question,
        withKey({ endpoint: 'https://example.net/systemone' })
      );
      assert.equal(r.outcome, jev.Outcome.UNAVAILABLE);
      assert.deepEqual(r.answers, {});
      assert.match(r.detail, /HTTP 429/);
    } finally {
      https.request = realRequest;
    }
  });
});

// ================================================================ Jev modes

describe('jev — classify and pick modes', () => {
  test('classifyTask returns the role when confident', async () => {
    const sure = fakeTransport({ role: { choice: 'author.lowrisk', confidence: 0.85 } });
    const r = await jev.classifyTask({ workItemId: 'TASK-AI-50' }, withKey({ transport: sure }));
    assert.equal(r.role, 'author.lowrisk');

    const unsure = fakeTransport({ role: { choice: 'author.lowrisk', confidence: 0.3 } });
    const r2 = await jev.classifyTask({ workItemId: 'X' }, withKey({ transport: unsure }));
    assert.equal(r2.role, null, 'an unsure classification must not choose a role');
  });

  test('classifyTask offers only roles capabilities.js defines', async () => {
    const { ROLES } = require('../capabilities');
    const t = fakeTransport({ role: { choice: 'author.lowrisk', confidence: 1 } });
    await jev.classifyTask({ workItemId: 'X' }, withKey({ transport: t }));
    const offered = Object.keys(t.calls[0].body.questions.role.criteria);
    assert.ok(offered.length >= 4, 'should offer at least four roles');
    for (const role of offered) {
      assert.ok(ROLES[role], 'offered role must exist in the capability registry: ' + role);
    }
    // And the reverse: the choice set derives from the registry, so a role
    // added there appears here without a second edit (AC-AI-50-09).
    for (const id of Object.keys(ROLES)) {
      assert.ok(offered.includes(id), 'registered role must be offered to Jev: ' + id);
    }
  });

  test('pickLane with a single lane decides without spending a call', async () => {
    const t = fakeTransport({});
    const r = await jev.pickLane([{ lane: 'nine:gpt', reply: 'OK' }], withKey({ transport: t }));
    assert.equal(r.lane, 'nine:gpt');
    assert.equal(t.calls.length, 0);
  });

  test('pickLane maps the slug back to the real lane name', async () => {
    const t = fakeTransport({ pick: { choice: 'nine_groq_openai_gpt_oss_120b', confidence: 0.9 } });
    const r = await jev.pickLane(
      [
        { lane: 'nine:groq/openai/gpt-oss-120b', reply: 'OK' },
        { lane: 'nine:kr/claude-sonnet-4.5-agentic', reply: '402 reached the limit' },
      ],
      withKey({ transport: t })
    );
    assert.equal(r.lane, 'nine:groq/openai/gpt-oss-120b');
  });

  test('pickLane can answer that nothing is usable', async () => {
    const t = fakeTransport({ pick: { choice: 'none', confidence: 0.95 } });
    const r = await jev.pickLane(
      [
        { lane: 'a:m', reply: '402 spent' },
        { lane: 'b:m', reply: '429 rate limited' },
      ],
      withKey({ transport: t })
    );
    assert.equal(r.lane, null);
    assert.equal(r.outcome, jev.Outcome.DECIDED);
  });

  test('nothing probed is unsure, not "none"', async () => {
    const r = await jev.pickLane([], withKey({ transport: fakeTransport({}) }));
    assert.equal(r.outcome, jev.Outcome.UNSURE);
  });

  test('classifyFailure reports the kind and whether an agent can fix it', async () => {
    const t = fakeTransport({
      kind: { choice: 'formatting', confidence: 0.9 },
      agentCanFix: { noul: 0.95 },
    });
    const r = await jev.classifyFailure(
      ['format:check'],
      'prettier found issues',
      withKey({ transport: t })
    );
    assert.equal(r.kind, 'formatting');
    assert.equal(r.agentCanFix, 0.95);
  });

  test('classifyJob reads a transcript tail', async () => {
    const t = fakeTransport({
      state: { choice: 'wedged', confidence: 0.81 },
      worthRestarting: { noul: 0.2 },
    });
    const r = await jev.classifyJob('...retry 5...', withKey({ transport: t }));
    assert.equal(r.state, 'wedged');
    assert.equal(r.worthRestarting, 0.2);
  });
});

// ================================================================ Gap 1/2: hermes adapter — inspect, stop, pid

describe('hermes harness', () => {
  const hermes = getHarness('hermes');

  test('it is registered and runs detached', () => {
    assert.equal(hermes.id, 'hermes');
    assert.equal(hermes.detached, true);
  });

  test('a launch is headless and carries the model, with the prompt last', () => {
    const args = hermes.launch({ model: 'mistral/codestral-latest', cwd: 'C:/w', prompt: 'go' });
    assert.equal(args[args.indexOf('-m') + 1], 'mistral/codestral-latest');
    assert.equal(args[args.indexOf('--in') + 1], 'C:/w');
    // Nothing is present to answer an approval or a hook prompt.
    assert.ok(args.includes('--yolo'));
    assert.ok(args.includes('--accept-hooks'));
    assert.equal(args[args.length - 1], 'go');
    assert.equal(args[args.length - 2], '-z');
  });

  test('its durable handle is the workspace, because that is what resume needs', () => {
    assert.equal(hermes.sessionIdFrom(null, { cwd: 'C:/w' }), DIR_HANDLE + 'C:/w');
    assert.equal(handleToDir('dir:C:/w'), 'C:/w');
    assert.equal(handleToDir('abc-123'), null, 'a provider id is not a directory');
  });

  test('a resume continues the session for that workspace', () => {
    const args = hermes.resume('dir:C:/w', 'carry on', { model: 'm' });
    assert.equal(args[args.indexOf('--resume') + 1], 'latest');
    assert.equal(args[args.indexOf('--in') + 1], 'C:/w');
    assert.equal(args[args.length - 1], 'carry on');
  });

  test('a detached run does not wait, and reports the start with a pid', () => {
    const calls = [];
    const fakeSpawn = (file, args) => {
      calls.push({ file, args });
      return { pid: 4242, unref() {} };
    };
    const res = runHarness(hermes, ['-z', 'go'], { spawn: fakeSpawn });
    assert.equal(res.exitCode, 0);
    assert.equal(JSON.parse(res.stdout).pid, 4242);
    assert.equal(calls.length, 1);
  });

  test('a detached start that throws fails closed', () => {
    const res = runHarness(hermes, ['-z', 'go'], {
      spawn: () => {
        throw new Error('ENOENT');
      },
    });
    assert.equal(res.exitCode, -1);
    assert.match(res.stderr, /ENOENT/);
  });

  test('stop returns the tree-kill for the pid when a pid is known', () => {
    assert.deepEqual(hermes.stop('dir:C:/w', { pid: 7788 }), { kill: 7788, tree: true });
  });

  test('stopping a run whose pid was never kept says so rather than pretending', () => {
    assert.equal(hermes.stop('dir:C:/w', {}), null);
    assert.equal(hermes.stop('dir:C:/w', null), null);
  });

  test('inspect returns an argv probe, so the executor can run it', () => {
    // The probe is executed by the runner, not a fact this adapter asserts:
    // exit 0 with output means the CLI that would resume the session answers.
    const probe = hermes.inspect('dir:C:/w');
    assert.ok(Array.isArray(probe), 'inspect must return argv the runner can execute');
    assert.equal(probe[0], 'sessions');
  });

  test('a probe runs to completion for a detached adapter when sync is set', () => {
    const calls = [];
    const fakeSync = (file, args) => {
      calls.push({ file, args });
      return { status: 0, stdout: 'workspace arrow-table\n', stderr: '' };
    };
    const res = runHarness(hermes, hermes.inspect('dir:C:/w'), {
      sync: true,
      spawnSync: fakeSync,
      fileExists: () => false,
      path: 'C:/none',
    });
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /arrow-table/);
    assert.equal(calls.length, 1, 'sync: true runs the probe once, to completion');
  });

  test('a probe without sync must not be fire-and-forgot for a detached adapter', () => {
    const calls = [];
    const fakeSync = () => {
      calls.push('sync');
      return { status: 0, stdout: 'table\n', stderr: '' };
    };
    // If the probe were allowed to take the detached path it would return
    // exit 0 with a pid nobody reads — the fire-and-forget this is meant to
    // prevent. So the run must reach the sync path; this spawn throws to prove
    // the sync path is what the executor really needs.
    const fakeSpawn = () => {
      throw new Error('probe must not be spawned detached');
    };
    const res = runHarness(hermes, hermes.inspect('dir:C:/w'), {
      spawn: fakeSpawn,
      fileExists: () => false,
      path: 'C:/none',
    });
    assert.equal(res.exitCode, -1, 'a command that cannot be run fails closed');
    assert.match(res.stderr, /probe must not be spawned detached/);
    assert.equal(calls.length, 0, 'without sync: true the sync runner is never reached');
  });

  test('one assignment is one hermes process, counted against the implementation ceiling', () => {
    const calls = [];
    const plan = {
      assignments: [
        {
          workItemId: 'TASK-AI-90',
          role: 'author.foundation',
          branch: 'feat/a',
          accountId: 'ninerouter',
          provider: 'hermes',
          model: 'big',
          contextWindow: 200000,
        },
        {
          workItemId: 'TASK-AI-91',
          role: 'author.foundation',
          branch: 'feat/b',
          accountId: 'ninerouter',
          provider: 'hermes',
          model: 'big',
          contextWindow: 200000,
        },
      ],
      deferred: [],
      utilisation: { maxImplementation: 1 },
    };
    const result = executePlan(plan, {
      registry: loadSources(),
      dryRun: false,
      cwd: 'C:/w',
      decisionDir: tempDir(),
      run: (adapter, args) => {
        calls.push({ adapter: adapter.id, args });
        return { exitCode: 0, stdout: '{"started":true,"pid":9001}', stderr: '' };
      },
    });
    assert.equal(result.records[0].outcome, Outcome.LAUNCHED);
    assert.equal(result.records[1].outcome, Outcome.REFUSED);
    assert.match(result.records[1].detail, /IMPLEMENTATION_CEILING/);
    // Hermes internal subagents are switched off: every dispatch is one -z
    // process, so the ceiling counts processes and the second assignment was
    // refused before anything ran.
    assert.equal(calls.length, 1, 'exactly one hermes process was started');
    assert.equal(calls[0].adapter, 'hermes');
  });

  test('a hermes launch never asks for subagents or a toolset', () => {
    // `-z` is a single agent in its own process; anything Hermes fans out into
    // stays inside that process and is not dispatch's child. Dispatching with
    // a subagent flag would make one assignment many processes and the ceiling
    // a lie, so no such flag may ever ride the launch vector.
    const args = hermes.launch({ model: 'm', cwd: 'C:/w', prompt: 'go' });
    for (const flag of [
      '--toolset',
      '-t',
      '--subagents',
      '--moa',
      '--architect',
      '--pareto',
      '--pair',
      '-a',
    ]) {
      assert.ok(!args.includes(flag), 'launch must not carry subagent flag ' + flag);
    }
    assert.equal(args[args.length - 2], '-z', 'the run is a single oneshot');
  });
});

// ================================================================ Gap 4: context window enforcement

describe('a harness that needs room to think', () => {
  test('a model below the floor is refused for hermes', () => {
    // Hermes loads its own tools, rules and memory before the task starts, so
    // an 8k model answers "this conversation has grown too large" and the run
    // produces nothing. Observed live on 2026-09-23.
    assert.match(contextRefusal('hermes', 8000), /^CONTEXT_TOO_SMALL/);
    assert.equal(contextRefusal('hermes', MIN_CONTEXT.hermes), null);
  });

  test('an unrecorded context window is not a refusal', () => {
    // The registry does not always carry one, and grounding a working model
    // over a missing field is worse than letting the harness decide.
    assert.equal(contextRefusal('hermes', undefined), null);
    assert.equal(contextRefusal('hermes', 0), null);
  });

  test('a harness with no floor accepts anything', () => {
    assert.equal(contextRefusal('paseo', 4000), null);
    assert.equal(contextRefusal('cline', 4000), null);
  });

  test('the executor refuses before launching, not after the model does', () => {
    const calls = [];
    const plan = {
      assignments: [
        {
          workItemId: 'TASK-AI-50',
          role: 'analyst.default',
          branch: 'slice/too-small',
          accountId: 'ninerouter',
          provider: 'hermes',
          model: 'tiny',
          contextWindow: 8000,
        },
      ],
      deferred: [],
      utilisation: { maxImplementation: 2 },
    };
    const result = executePlan(plan, {
      registry: loadSources(),
      dryRun: false,
      decisionDir: tempDir(),
      run: (adapter, args) => {
        calls.push(args);
        return { exitCode: 0, stdout: '{"pid":1}', stderr: '' };
      },
    });
    assert.equal(result.records[0].outcome, Outcome.REFUSED);
    assert.match(result.records[0].detail, /CONTEXT_TOO_SMALL/);
    assert.equal(calls.length, 0, 'nothing may be launched that cannot work');
  });

  test('a detached launch keeps its pid, so the run can be stopped', () => {
    const result = executePlan(
      {
        assignments: [
          {
            workItemId: 'TASK-AI-50',
            role: 'analyst.default',
            branch: 'slice/ok',
            accountId: 'ninerouter',
            provider: 'hermes',
            model: 'big',
            contextWindow: 200000,
          },
        ],
        deferred: [],
        utilisation: { maxImplementation: 2 },
      },
      {
        registry: loadSources(),
        dryRun: false,
        cwd: 'C:/w',
        decisionDir: tempDir(),
        run: () => ({ exitCode: 0, stdout: '{"started":true,"pid":7788}', stderr: '' }),
      }
    );
    assert.equal(result.records[0].outcome, Outcome.LAUNCHED);
    assert.equal(result.records[0].pid, 7788);
    assert.deepEqual(getHarness('hermes').stop('dir:C:/w', { pid: 7788 }), {
      kill: 7788,
      tree: true,
    });
  });
});
