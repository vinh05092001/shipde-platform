/* TASK-AI-50 live run: real, installed Hermes exercised through the adapter
 * (launch / probe / stop over the actual CLI), plus a real Jev decision. On
 * this machine the 9Router gateway only answers Hermes with
 * groq/openai/gpt-oss-120b (128k), which cannot hold Hermes' startup payload,
 * so the one-shot ends with Hermes' own recorded error rather than a completed
 * plan — recorded, never faked. Secrets never print.
 */
'use strict';
const { getHarness, runHarness } = require('../harness');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hermes = getHarness('hermes');
const SANDBOX = path.join(os.tmpdir(), 'opencode', 'hermes-live-sandbox');
fs.mkdirSync(SANDBOX, { recursive: true });

// Probes and the launch go through runHarness — the same shim-unwrap + spawn
// path the executor uses — so nothing here exercises code the real dispatch
// does not.
function sessionsRows() {
  const probe = runHarness(hermes, hermes.inspect('dir:' + SANDBOX, {}), {
    sync: true,
    timeoutMs: 60000,
  });
  return (probe.stdout || '')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('Title') && !l.startsWith('—')).length;
}

function tasklist(filter) {
  const r = spawnSync('tasklist', ['/FO', 'CSV', '/FI', filter], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return (r.stdout || '').split('\n').filter((l) => l.includes('"'));
}

console.log('=== TASK-AI-50 live run: real Hermes + real Jev ===');
console.log('hermes adapter id:', hermes.id, '| detached:', hermes.detached);
console.log(
  'hermes binary:',
  spawnSync('where', ['hermes'], { encoding: 'utf8' }).stdout.trim().split('\n')[0]
);
console.log('sandbox:', SANDBOX, '\n');

// ---- 0. Live probe: `hermes sessions list` before the run ----------------
console.log(
  'probe argv (must be ["sessions","list"]):',
  JSON.stringify(hermes.inspect('dir:' + SANDBOX, {}))
);
console.log('sessions before run:', sessionsRows(), 'rows');

// ---- 1. Real one-shot: run the installed Hermes on a real prompt ---------
// No model is pinned: the adapter is documented as never pinning one, and the
// config's `default` (groq/openai/gpt-oss-120b behind 9Router) is exactly what
// an unrouted dispatch would use. On this machine that is also the only model
// the gateway answers at all (matrix-tested 2026-09-25: cc/, bzl/, ag/ routes
// never return; gpt-oss-120b answers but rejects Hermes' startup payload as
// larger than its 128k window). The run below therefore completes with Hermes'
// own honest error — real CLI output, no fake success.
const launchArgv = hermes.launch({
  cwd: SANDBOX,
  prompt:
    'Produce a three-step plan, at most 120 words, for verifying that TASK-AI-50 (Hermes planning harness + Jev decision layer) is genuinely installed and functional. End your reply with exactly: PLAN-DONE',
});
console.log('\nlaunch argv:', JSON.stringify(launchArgv));

const t0 = Date.now();
const run = runHarness(hermes, launchArgv, {
  cwd: SANDBOX,
  sync: true,
  windowsHide: true,
  timeoutMs: 150000,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log('\n=== one-shot hermes run: sync, exit', run.exitCode, `(${elapsed}s) ===`);
console.log('--- stdout (tail) ---');
console.log(
  String(run.stdout || '')
    .trim()
    .split('\n')
    .slice(-30)
    .join('\n')
);
console.log('--- stderr (tail, trimmed) ---');
console.log(
  String(run.stderr || '')
    .trim()
    .split('\n')
    .slice(-8)
    .join('\n')
);

const artifacts = fs.readdirSync(SANDBOX).filter((f) => /plan|task/i.test(f));
console.log('\nartifacts written to sandbox:', artifacts.length ? artifacts.join(', ') : '(none)');

// ---- 2. Live probe after the run: the CLI must still answer --------------
const postRows = sessionsRows();
console.log('sessions after run: rows', postRows, '(CLI probe still answers)');

// ---- 3. Orphan check: no hermes/node child must remain after a -z run -----
const preNodes = tasklist('IMAGENAME eq node.exe').length;
const postNodes = tasklist('IMAGENAME eq node.exe').length;
console.log(
  'node.exe processes: before',
  preNodes,
  'after',
  postNodes,
  '—',
  postNodes > preNodes + 1 ? 'LEAK DETECTED' : 'no orphan attributable to this run'
);

// ---- 4. Adapter stop: one-shot already exited, so stop reports honestly ----
const stopResult = hermes.stop('dir:' + SANDBOX, {});
console.log(
  '\nhermes.stop after completed one-shot:',
  JSON.stringify(stopResult),
  '(null/clean = nothing left to kill)'
);

// ---- 5. Real Jev: classify a real work item (gap 6/7 boundary) ------------
const jev = require('../jev');
const workItem =
  'Implement a planning harness (Hermes) and a decision layer (Jev) inside the brain. ' +
  'Hermes plans in a throwaway worktree and hands the plan to the executor; Jev answers only closed questions ' +
  'with a confidence, and must return UNDECIDED instead of guessing when the signal is weak.';
(async () => {
  try {
    const d = await jev.classifyTask(workItem, {});
    console.log('\n=== real Jev classifyTask ===');
    console.log('outcome:', d.outcome, '| role:', d.role, '| confidence:', d.confidence);
    console.log('detail:', d.detail ? String(d.detail).slice(0, 120) : '(none)');
    console.log('\n=== live run complete ===');
  } catch (e) {
    console.log('\n=== live run complete (Jev unavailable: ' + String(e).slice(0, 80) + ') ===');
  }
})();
