'use strict';

/**
 * Ship Dễ — TASK-AI-129: the Controller uses the tool manifest when it
 * prompts and gates workers.
 *
 * TM-R05 proofs (every test fails on origin/main, where neither the prompt
 * section nor the gate stage exists and the decision log knows neither
 * `prompt_tools` nor `tool_gate`):
 *   - a UI file change gets the playwright/axe lines and a pure backend
 *     change does not;
 *   - the reviewer prompt gets the security tools;
 *   - a missing manifest gives a warning and an unchanged prompt;
 *   - a failing gate leads to repair and then refusal;
 *   - a gate with no command gives TOOL_GATE_UNAVAILABLE and is not a pass;
 *   - the decision entries are written.
 *
 * Prompts are unit-tested against the compiler; gates run through the real
 * orchestration with real temp git repos under .upstream-tmp and a fake spawn
 * for the gate commands only (git and everything else run for real).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const promptCompiler = require('../prompt-compiler');
const decisions = require('../decisions');
const toolManifest = require('../tool-manifest');
const { runOrchestration } = require('../orchestrate');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-09T12:00:00Z');
const REMOTE_URL = 'https://github.com/shipde/shipde-platform.git';

function tmpDir(prefix) {
  const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}

/** Tool ids from a compiled prompt's "Tools for this item" section. */
function toolsFromPrompt(prompt) {
  const lines = String(prompt).split('\n');
  const start = lines.indexOf('Tools for this item:');
  if (start === -1) return [];
  const ids = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = /^- ([^:]+): /.exec(lines[i]);
    if (!match) break;
    ids.push(match[1]);
  }
  return ids;
}

function cand(id, role, over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-' + id,
      gateway: 'gw-' + id,
      upstream: 'up-' + id,
      accountId: 'acct-' + id,
      quotaScope: 'scope-' + id,
      modelId: 'model-' + id,
      source: 'gw-' + id,
      qualifiedRoles: [role],
      capabilities: { contextWindow: 64000 },
      cost: 1,
    },
    over || {}
  );
}

/** One real git repository with a base commit. */
function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(
      result.status,
      0,
      (result.stderr || result.stdout || '') + ' [' + args.join(' ') + ']'
    );
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-129@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-129 test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  return { dir, git, base: git(['rev-parse', 'HEAD']) };
}

function commitIn(repo, name, content) {
  fs.writeFileSync(path.join(repo.dir, name), content);
  repo.git(['add', '.']);
  repo.git(['commit', '-q', '-m', 'work ' + name]);
  return repo.git(['rev-parse', 'HEAD']);
}

/**
 * A full run around one work item: the worker commits a non-prettier file
 * (so the format gate stays inert), the fake spawn answers every
 * `pnpm run <script>` gate invocation with `gateResult`, and git plus the
 * whole review lane run for real.
 */
function setupGateRun(prefix, spec, gateResult) {
  const dir = tmpDir(prefix);
  const repo = makeRepo(path.join(dir, 'repo'));
  const registryPath = path.join(dir, 'approvals.json');
  const state = { gateSpawns: [], repairs: [], calls: [], gateLogs: [] };
  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const reviewerA = cand('reviewera', 'reviewer.primary');

  const run = (job) => {
    state.calls.push({ workItemId: job.workItemId, isReview: Boolean(job.isReview) });
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + state.calls.length }));
    }
    if (job.isReview) {
      fs.writeFileSync(
        job.verdictFile || path.join(job.cwd, 'verdict.json'),
        JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
      );
      return { exitCode: 0, stdout: 'review pass' };
    }
    commitIn(repo, 'notes.txt', 'worker change for ' + job.workItemId + '\n');
    return { exitCode: 0, stdout: 'worker completed' };
  };

  const opts = {
    specs: [spec],
    candidates: [writer, reviewerA],
    registry: { sources: [] },
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    now: NOW,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.base,
    formatCheck: true,
    log: (code, payload) => {
      if (String(code).indexOf('TOOL_GATE') === 0) state.gateLogs.push({ code, payload });
    },
    ranking: {
      headrooms: {
        'acct-writer': { status: 'available' },
        'acct-reviewera': { status: 'available' },
      },
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    run,
    repairer: async (findings, sha) => {
      state.repairs.push({ findings, sha });
      const repaired = commitIn(repo, 'notes.txt', 'repair attempt\n');
      return { sha: repaired };
    },
    spawnSync: (cmd, args, spawnOpts) => {
      if (String(cmd) === 'pnpm' && Array.isArray(args) && args[0] === 'run') {
        state.gateSpawns.push({ cmd, args, result: gateResult });
        return gateResult;
      }
      return cp.spawnSync(cmd, args, spawnOpts);
    },
    publisher: (pubOpts) => ({ status: 'published', sha: pubOpts.reviewedSha }),
    publication: {
      approvalIds: ['AP-129'],
      registryPath,
      expiry: NOW + 60 * 60 * 1000,
      remoteUrl: REMOTE_URL,
    },
  };

  return { dir, repo, state, opts };
}

test('TM-R05: a UI file change gets the playwright/axe lines and a pure backend change does not', () => {
  const uiItem = {
    id: 'FEAT-UI',
    role: 'ui',
    allowedPaths: ['src/components/button.tsx'],
    verification: { command: 'test' },
  };
  const uiPrompt = promptCompiler.compilePrompt(uiItem, {
    dirtyPaths: ['src/components/button.tsx'],
  });
  const uiTools = toolsFromPrompt(uiPrompt);
  assert.ok(uiTools.includes('axe-core'), 'ui prompt missing the axe-core line: ' + uiTools);
  assert.ok(uiTools.includes('playwright'), 'ui prompt missing the playwright line: ' + uiTools);
  assert.ok(uiTools.length <= 8, 'at most 8 tools are offered: ' + uiTools.length);

  const backendItem = {
    id: 'FEAT-BACKEND',
    role: 'author',
    allowedPaths: ['src/services/api.js'],
    verification: { command: 'test' },
  };
  const backendPrompt = promptCompiler.compilePrompt(backendItem, {});
  const backendTools = toolsFromPrompt(backendPrompt);
  assert.ok(backendTools.length > 0, 'the backend prompt still lists its own tools');
  assert.ok(
    backendTools.includes('eslint'),
    'the backend prompt lists the backend tools: ' + backendTools
  );
  assert.ok(
    !backendTools.includes('axe-core'),
    'a pure backend change gets no axe-core: ' + backendTools
  );
  assert.ok(
    !backendTools.includes('playwright'),
    'a pure backend change gets no playwright: ' + backendTools
  );
});

test('TM-R05: the reviewer prompt gets the security tools', () => {
  const item = {
    id: 'FEAT-SEC',
    role: 'security-review',
    allowedPaths: ['src/server.js'],
    riskDomains: ['secrets'],
    verification: { command: 'test' },
  };
  const prompt = promptCompiler.compileReviewPrompt(item, {
    headSha: 'b'.repeat(40),
    baseSha: 'a'.repeat(40),
    diffText: 'diff',
  });
  const tools = toolsFromPrompt(prompt);
  assert.ok(tools.includes('gitleaks'), 'review prompt missing gitleaks: ' + tools);
  assert.ok(tools.includes('semgrep'), 'review prompt missing semgrep: ' + tools);
  assert.match(
    prompt,
    /\(command: security:secrets\)/,
    'the gitleaks line carries the repo secret-scan command (TM-R02)'
  );

  // TM-R02: the manifest reuses the repo's own script; agent-scan stays
  // command null with a note.
  const manifest = toolManifest.load();
  const gitleaks = manifest.find((t) => t.id === 'gitleaks');
  assert.equal(gitleaks.command, 'security:secrets', 'gitleaks reuses the repo secret scan');
  const pkg = require('../../../package.json');
  assert.ok(pkg.scripts['security:secrets'], 'the repo script exists to reuse');
  const agentScan = manifest.find((t) => t.id === 'agent-scan');
  assert.equal(agentScan.command, null, 'agent-scan stays command null');
  assert.ok(
    typeof agentScan.note === 'string' && agentScan.note.length > 0,
    'agent-scan has a note'
  );
});

test('TM-R05: a missing manifest gives a warning and an unchanged prompt', (t) => {
  const warned = [];
  t.mock.method(console, 'warn', (...args) => {
    warned.push(args.join(' '));
  });
  t.mock.method(toolManifest, 'toolsFor', () => {
    throw new Error('manifest missing');
  });

  const dir = tmpDir('task-ai-129-warn-');
  const item = {
    id: 'FEAT-MISSING',
    role: 'author.foundation',
    allowedPaths: ['src/test.js'],
    verification: { command: 'test' },
  };
  const prompt = promptCompiler.compilePrompt(item, {
    goal: 'g',
    logOpts: { dir, now: NOW },
  });

  assert.doesNotMatch(prompt, /Tools for this item:/, 'the prompt stays unchanged');
  assert.ok(prompt.includes('Work Item: FEAT-MISSING'), 'the rest of the prompt is intact');
  assert.ok(warned.length > 0, 'a warning is recorded');
  const records = decisions.readDecisions({ dir, now: NOW });
  const warning = records.find((r) => r.warning === 'TOOL_MANIFEST_UNAVAILABLE');
  assert.ok(warning, 'the warning lands in the decision log');
  assert.equal(warning.stage, 'warning');
});

test('TM-R05: a failing gate leads to repair and then refusal', async () => {
  const spec = {
    id: 'TASK-AI-129',
    businessOutcome: 'Tool gates run before review',
    files: ['src/feature.js'],
    verification: { command: 'test' },
    riskDomains: ['secrets'],
  };
  const f = setupGateRun('task-ai-129-fail-', spec, {
    status: 1,
    stdout: '',
    stderr: 'found secret in notes.txt\n',
  });

  const log = await runOrchestration('tool gate failure', f.opts);

  const outcome = (log.outcomes || []).find((e) => e.workItemId === 'TASK-AI-129');
  assert.ok(outcome, 'outcome exists');
  assert.equal(outcome.status, 'refused', 'the item is refused after the one repair round');

  // ONE repair round, carrying the tool output.
  assert.equal(f.state.repairs.length, 1, 'exactly one repair round');
  const finding = f.state.repairs[0].findings[0];
  assert.equal(finding.id, 'TOOL_GATE_FAILED');
  assert.match(String(finding.detail), /found secret/, 'the repair round gets the tool output');

  assert.equal((log.reviews || []).length, 0, 'the refused commit is never reviewed');
  assert.equal((log.publications || []).length, 0, 'the refused commit is never published');

  const records = decisions.readDecisions({ dir: f.opts.decisionDir, now: NOW });
  const gateFailed = records.find(
    (r) => r.stage === 'tool_gate' && r.tool === 'gitleaks' && r.toolStatus === 'FAILED'
  );
  assert.ok(gateFailed, 'the failing gate is recorded');
  assert.equal(gateFailed.code, 'TOOL_GATE_FAILED');
  const refused = records.find((r) => r.stage === 'refused' && r.workItemId === 'TASK-AI-129');
  assert.ok(refused, 'the refusal is recorded');
  assert.match(String(refused.detail), /TOOL_GATE_FAILED/, 'the refusal names the tool gate');
  for (const r of records.filter((x) => x.stage === 'tool_gate' || x.stage === 'refused')) {
    assert.ok(
      !JSON.stringify(r).includes('found secret'),
      'gate decision entries never carry raw tool output (TM-R04)'
    );
  }
});

test('TM-R05: a gate with no command gives TOOL_GATE_UNAVAILABLE and is not a pass', async () => {
  // TM-R02: agent-scan stays command null with a note.
  const agentScan = toolManifest.load().find((t) => t.id === 'agent-scan');
  assert.equal(agentScan.command, null, 'agent-scan stays command null');
  assert.ok(agentScan.note, 'agent-scan keeps its note');

  const spec = {
    id: 'TASK-AI-129',
    businessOutcome: 'Unavailable gates never pass',
    files: ['src/feature.js'],
    verification: { command: 'test' },
    riskDomains: ['secrets'],
  };
  const f = setupGateRun('task-ai-129-unavail-', spec, {
    status: 0,
    stdout: 'clean scan\n',
    stderr: '',
  });

  const log = await runOrchestration('unavailable gate', f.opts);

  const outcome = (log.outcomes || []).find((e) => e.workItemId === 'TASK-AI-129');
  assert.ok(outcome, 'outcome exists');
  assert.notEqual(outcome.status, 'refused', 'an unavailable gate does not block');
  assert.equal(outcome.status, 'completed', 'the item completes: ' + outcome.status);

  const records = decisions.readDecisions({ dir: f.opts.decisionDir, now: NOW });
  const unavailable = records.find(
    (r) => r.stage === 'tool_gate' && r.tool === 'agent-scan' && r.toolStatus === 'UNAVAILABLE'
  );
  assert.ok(unavailable, 'TOOL_GATE_UNAVAILABLE is recorded for the gate without a command');
  assert.equal(unavailable.code, 'TOOL_GATE_UNAVAILABLE');
  const agentPasses = records.filter(
    (r) => r.stage === 'tool_gate' && r.tool === 'agent-scan' && r.toolStatus === 'PASSED'
  );
  assert.equal(agentPasses.length, 0, 'an unavailable gate is never counted as a pass');
  assert.ok(
    !f.state.gateSpawns.some((s) => s.args[1] === 'security:secrets' && s.result.status !== 0),
    'the runnable gate is the only one that executed'
  );
});

test('TM-R05: the decision entries record the offered tools and the gate results', async () => {
  const spec = {
    id: 'TASK-AI-129',
    businessOutcome: 'The trace names the tools and the gates',
    files: ['src/feature.js'],
    verification: { command: 'test' },
    riskDomains: ['secrets'],
  };
  const f = setupGateRun('task-ai-129-decisions-', spec, {
    status: 0,
    stdout: 'clean scan\n',
    stderr: '',
  });

  await runOrchestration('decision entries', f.opts);

  const records = decisions.readDecisions({ dir: f.opts.decisionDir, now: NOW });

  const offered = records.filter(
    (r) => r.stage === 'prompt_tools' && r.workItemId === 'TASK-AI-129'
  );
  assert.ok(offered.length > 0, 'which tools the prompt offered is recorded');
  const authorOffer = offered.find((r) => Array.isArray(r.tools) && r.tools.includes('eslint'));
  assert.ok(
    authorOffer,
    'the author prompt entry names the tools it offered: ' + JSON.stringify(offered)
  );
  assert.ok(authorOffer.tools.length <= 8, 'at most 8 tool ids are recorded');

  const gateRun = records.find(
    (r) => r.stage === 'tool_gate' && r.tool === 'gitleaks' && r.toolStatus === 'PASSED'
  );
  assert.ok(gateRun, 'which gates ran is recorded with their result');
  assert.equal(gateRun.code, 'TOOL_GATE_PASSED');
  const unavailable = records.find(
    (r) => r.stage === 'tool_gate' && r.tool === 'agent-scan' && r.code === 'TOOL_GATE_UNAVAILABLE'
  );
  assert.ok(unavailable, 'the unavailable gate is recorded too');
});
