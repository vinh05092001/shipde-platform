'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sourcesApi = require('../sources');
const agyPoolCandidates = require('../agy-pool-candidates');
const comboJev = require('../combo-jev-select');

function makeQuotaSnapshot({ gemini = 1, claude = 1, argon = null, tier = 'pro' } = {}) {
  const groups = [
    {
      name: 'Gemini Models',
      description:
        tier === 'pro'
          ? 'Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Gemini 3.8 Flash'
          : 'Models within this group: Gemini 3.8 Flash',
      buckets: [
        { window: 'weekly', remaining_fraction: gemini },
        { window: '5h', remaining_fraction: gemini },
      ],
    },
    {
      name: 'Claude and GPT models',
      description:
        tier === 'pro'
          ? 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B'
          : 'Models within this group: Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B',
      buckets: [
        { window: 'weekly', remaining_fraction: claude },
        { window: '5h', remaining_fraction: claude },
      ],
    },
  ];
  if (argon !== null) {
    groups.push({
      name: 'Gemini 4 Argon',
      description: 'Separate Argon bucket',
      buckets: [{ window: 'weekly', remaining_fraction: argon }],
    });
  }
  return { groups };
}

test('WI-A1 RED/fail-closed: missing agyPool config returns zero AGY members even when flag is enabled', async () => {
  const quotaSnapshots = {
    agy03: makeQuotaSnapshot({ gemini: 1.0, claude: 1.0, argon: 1.0, tier: 'pro' }),
  };
  assert.deepEqual(agyPoolCandidates.discoverAgyPoolMembers({ quotaSnapshots }), []);

  let captured = null;
  const res = await comboJev.selectComboMember({
    item: { id: 'FEAT-NO-CFG', complexity: 'high', risk: 'HIGH' },
    role: 'writer',
    members: ['bzl/glm-5.3', 'gcli/grok-4.7'],
    includeAgyPool: true,
    agyPoolOptions: { quotaSnapshots },
    registry: { dispatch: { nineRouterWriterCombo: 'vinh' }, sources: [] },
    jevAsk: async (q) => {
      captured = q;
      return { choice: q.options[0], confidence: 0.9, reason: 'ok' };
    },
  });
  assert.ok(captured);
  assert.equal(captured.options.length, 2, 'only 9router members when agyPool config missing');
  assert.equal(res.selected.lane, '9router');
});

// The JEV cap contract (resolveJevMaxOptions): an integer >= 2 from the call or
// the jev source, otherwise no cap. A mixed agy-pool shortlist needs a cap.
function withoutConfiguredCap(reg) {
  return {
    ...reg,
    sources: reg.sources.map((src) => {
      if (src.id !== 'jev') return src;
      const rest = { ...src };
      delete rest.maxOptions;
      return rest;
    }),
  };
}

test('WI-A1 fail-closed cap: an agy-pool opt-in without a valid JEV cap keeps 9router only', async () => {
  const reg = withoutConfiguredCap(sourcesApi.loadSources());
  const enabledReg = { ...reg, dispatch: { ...reg.dispatch, agyPoolShortlistEnabled: true } };
  const quotaSnapshots = {
    agy03: makeQuotaSnapshot({ gemini: 1.0, claude: 1.0, argon: 1.0, tier: 'pro' }),
  };
  const comboMembers = ['bzl/glm-5.3', 'gcli/grok-4.7'];
  const run = (extra) =>
    comboJev.selectComboMember({
      item: { id: 'FEAT-CAP', complexity: 'high', risk: 'HIGH' },
      role: 'writer',
      members: comboMembers,
      registry: enabledReg,
      agyPoolOptions: { quotaSnapshots },
      jevAsk: async (q) => ({ choice: q.options[0], confidence: 0.9, reason: 'ok' }),
      ...extra,
    });

  for (const badCap of [undefined, null, 0, 1, -4, 3.5, 'x']) {
    const res = await run(badCap !== undefined ? { maxOptions: badCap } : {});
    assert.equal(res.eligibleCount, 2, `cap ${String(badCap)} must keep 9router only`);
    assert.equal(res.selected.lane, '9router');
  }
  const capped = await run({ maxOptions: 4 });
  assert.ok(capped.eligibleCount > 2, 'a valid cap admits agy-pool members');
});

test('WI-A1 OFF parity: with the agy flag off the JEV shortlist contract is unchanged', async () => {
  const reg = sourcesApi.loadSources();
  assert.equal(reg.dispatch.agyPoolShortlistEnabled, false);
  const quotaSnapshots = {
    agy03: makeQuotaSnapshot({ gemini: 1.0, claude: 1.0, argon: 1.0, tier: 'pro' }),
  };
  const comboMembers = [
    'bzl/glm-5.3',
    'gcli/grok-4.7',
    'gcli/grok-4.5-high',
    'llm7/kimi-k3',
    'amd/qwen3.8-27b',
    'rc/glm-5.1',
    'rc/deepseek-r1',
    'rc/qwen3-coder',
    'rc/llama-4',
  ];
  const optionsFor = async (extra) => {
    let captured = null;
    await comboJev.selectComboMember({
      item: { id: 'FEAT-PARITY', complexity: 'standard' },
      role: 'writer',
      members: comboMembers,
      registry: reg,
      agyPoolOptions: { quotaSnapshots },
      jevAsk: async (q) => {
        captured = q;
        return { choice: q.options[0], confidence: 0.9, reason: 'ok' };
      },
      ...extra,
    });
    return captured;
  };

  const configured = await optionsFor({});
  assert.equal(configured.options.length, comboJev.resolveJevMaxOptions({ registry: reg }));
  const ev = JSON.parse(configured.evidence);
  assert.equal(
    ev.members.every((m) => m.headroomStatus === undefined),
    true
  );
  // Under the JEV contract an invalid call cap (below 2 or a fraction) falls back
  // to the configured jev cap, exactly as on the JEV base.
  for (const invalid of [1, 3.5]) {
    assert.equal(
      (await optionsFor({ maxOptions: invalid })).options.length,
      configured.options.length
    );
  }
});

test('WI-A1 single shortlist: the lane step is inert for one lane and keeps an agy slot for two', () => {
  const ranked = (lanes) =>
    lanes.map((lane, i) => ({ modelId: 'm' + i, score: 100 - i, effort: null, lane }));
  const oneLane = ranked(Array(9).fill('9router'));
  const noLaneField = oneLane.map(({ lane, ...rest }) => rest);
  assert.deepEqual(
    comboJev.shortlistForJev(oneLane, 4).map((m) => m.modelId),
    comboJev.shortlistForJev(noLaneField, 4).map((m) => m.modelId)
  );
  const mixed = ranked([...Array(8).fill('9router'), 'agy-pool']);
  const picked = comboJev.shortlistForJev(mixed, 4);
  assert.equal(picked.length, 4);
  assert.ok(
    picked.some((m) => m.lane === 'agy-pool'),
    'the agy-pool lane keeps a slot'
  );
  assert.equal(typeof comboJev.shortlistMembersForJev, 'undefined', 'one shortlist implementation');
});

test('WI-A1 config-driven discovery: 3 buckets, <minHeadroom shedding, and per-model dedup from sources.json', () => {
  const reg = sourcesApi.loadSources();
  const quotaSnapshots = {
    agy01: makeQuotaSnapshot({ gemini: 0.9, claude: 0.1, argon: 1.0, tier: 'pro' }),
    agy02: makeQuotaSnapshot({ gemini: 0.5, claude: 0.85, argon: 0.95, tier: 'pro' }),
    agy03: makeQuotaSnapshot({ gemini: 0.95, claude: 0.3, argon: 0.1, tier: 'pro' }),
  };
  const members = agyPoolCandidates.discoverAgyPoolMembers({ registry: reg, quotaSnapshots });

  const opus = members.find((m) => m.modelId === 'agy-pool/claude-opus-5-5');
  assert.ok(opus, 'claude-opus-5-5 discovered dynamically from live quota metadata');
  assert.equal(opus.accountId, 'agy02');
  assert.equal(opus.headroomStatus, 'open');
  assert.deepEqual(
    opus.eligibleAccounts.map((a) => a.accountId),
    ['agy02', 'agy03']
  );

  const argon = members.find((m) => m.modelId === 'agy-pool/gemini-4-argon');
  assert.ok(argon, 'gemini-4-argon discovered dynamically from dedicated Argon bucket');
  assert.equal(argon.accountId, 'agy01');
  assert.deepEqual(
    argon.eligibleAccounts.map((a) => a.accountId),
    ['agy01', 'agy02']
  );
});

test('WI-A1 enabled shortlist: caps at maxOptions with lane diversity and enforces cross-lane family independence', async () => {
  const reg = sourcesApi.loadSources();
  const enabledReg = {
    ...reg,
    dispatch: { ...reg.dispatch, agyPoolShortlistEnabled: true },
  };
  const quotaSnapshots = {
    agy03: makeQuotaSnapshot({ gemini: 1.0, claude: 1.0, argon: 1.0, tier: 'pro' }),
  };
  const comboMembers = [
    'bzl/glm-5.3',
    'gcli/grok-4.7',
    'gcli/grok-4.5-high',
    'llm7/kimi-k3',
    'amd/qwen3.8-27b',
  ];

  let captured = null;
  const res = await comboJev.selectComboMember({
    item: { id: 'FEAT-MIXED', complexity: 'high', risk: 'HIGH' },
    role: 'writer',
    members: comboMembers,
    registry: enabledReg,
    agyPoolOptions: { quotaSnapshots },
    maxOptions: 6,
    jevAsk: async (q) => {
      captured = q;
      const ev = JSON.parse(q.evidence);
      const agyOpt = ev.members.find((m) => m.headroomStatus === 'open');
      const routerOpt = ev.members.find((m) => !m.headroomStatus);
      assert.ok(agyOpt && routerOpt, 'shortlist must mix both lanes');
      return { choice: agyOpt.option, confidence: 0.9, reason: 'agy peer' };
    },
  });

  assert.equal(captured.options.length, 6);
  assert.doesNotMatch(captured.evidence, /agy03|9router|http:/i);
  assert.equal(res.ok, true);
  assert.equal(res.selected.lane, 'agy-pool');
  assert.equal(res.candidate.harness, 'agy-pool');
  assert.equal(res.candidate.accountId, 'agy03');

  // Cross-lane same-family independence: 9router claude writer blocks agy-pool claude
  const rev = await comboJev.selectComboMember({
    item: { id: 'FEAT-REV', complexity: 'high', risk: 'HIGH' },
    role: 'reviewer',
    writerModelId: 'rc/claude-opus-5.5',
    members: ['rc/claude-sonnet-5.5', 'gcli/grok-4.7'],
    registry: enabledReg,
    agyPoolOptions: { quotaSnapshots },
    maxOptions: 8,
  });
  assert.equal(rev.ok, true);
  assert.equal(rev.independentApplied, true);
  assert.notEqual(comboJev.modelFamilyOf(rev.selected.base), 'claude');
});

test('WI-A1 fail-closed: malformed non-array quota groups are skipped and 9router selection still succeeds', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const reg = sourcesApi.loadSources();
  const enabledReg = {
    ...reg,
    dispatch: { ...reg.dispatch, agyPoolShortlistEnabled: true },
  };

  // 1) In-memory quotaSnapshots with non-array command.data.groups (object instead of array)
  const malformedSnaps = {
    agy03: { command: { data: { groups: { unexpected: true } } } },
    agy04: { groups: 'not-an-array', command: { data: { groups: { broken: 1 } } } },
    agy06: { groups: [null, 42, 'bad-entry'] },
  };
  assert.deepEqual(
    agyPoolCandidates.discoverAgyPoolMembers({
      registry: enabledReg,
      quotaSnapshots: malformedSnaps,
    }),
    []
  );

  // 2) File-based quota-out.txt with valid JSON whose command.data.groups is an object
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-a1-malformed-'));
  try {
    const accDir = path.join(tmpDir, 'agy05');
    fs.mkdirSync(accDir, { recursive: true });
    fs.writeFileSync(
      path.join(accDir, 'quota-out.txt'),
      JSON.stringify({ command: { data: { groups: { notAnArray: true } } } }),
      'utf8'
    );
    assert.deepEqual(
      agyPoolCandidates.discoverAgyPoolMembers({
        registry: enabledReg,
        accounts: ['agy05'],
        runsDir: tmpDir,
      }),
      []
    );

    // 3) selectComboMember with agy-pool enabled + malformed AGY snapshot still picks 9router member
    const res = await comboJev.selectComboMember({
      item: { id: 'FEAT-MALFORMED-SNAP', complexity: 'standard', risk: 'LOW' },
      role: 'writer',
      members: ['gcli/grok-4.7', 'bzl/glm-5.3'],
      registry: enabledReg,
      env: { NINEROUTER_API_KEY: 'test-key' },
      agyPoolOptions: { accounts: ['agy05'], runsDir: tmpDir },
      maxOptions: 6,
    });
    assert.equal(res.ok, true);
    assert.equal(res.selected.lane, '9router');
    assert.equal(res.candidate.source, '9router');
    assert.notEqual(res.candidate.harness, 'agy-pool');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
