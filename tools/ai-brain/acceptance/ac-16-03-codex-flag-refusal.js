'use strict';
// AC-AI-16-03 — a rejected override is refused, and the repository says which
// override and why.
//
// The stored row ("Simulate a rejected flag — Launch refuses, message quotes the
// flag and the CLI version — captured stderr") carried no command, and its claim
// was false on one point: neither `ao doctor` nor scripts/ai/doctor.ps1 quotes
// the Codex CLI version in the refusal message (it appears only on a separate
// harness line). See TASK-AI-16.md § Acceptance matrix audit, defect D3.
//
// What is executable is the root cause TASK-AI-16-FINDINGS.md established: the
// real codex CLI refuses a `projects` override whose path carries single
// backslashes and accepts the same override with forward slashes. This script
// probes the real installed CLI, and it asserts the repository names both the
// refused override and the cause.
//
// Exit codes: 0 the root cause still holds - 1 the CLI changed and the findings
//            are stale - 2 cannot measure (codex not installed).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DOCTOR = 'scripts/ai/doctor.ps1';
const BS = String.fromCharCode(92);
const Q = String.fromCharCode(34);
const COMMAND = ['features', 'list'];

if (!fs.existsSync(DOCTOR)) {
  console.error('SOURCE_MISSING: run from the repository root (' + DOCTOR + ')');
  process.exit(2);
}

function resolveLauncher() {
  const candidates = [];
  const npmRoot = spawnSync('npm', ['root', '-g'], {
    encoding: 'utf8',
    shell: true,
    timeout: 60000,
  });
  if (npmRoot.status === 0 && (npmRoot.stdout || '').trim()) {
    candidates.push(path.join(npmRoot.stdout.trim(), '@openai', 'codex', 'bin', 'codex.js'));
  }
  if (process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    );
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

const launcher = resolveLauncher();
if (!launcher) {
  console.error('CODEX_NOT_INSTALLED: cannot probe the launch flag surface');
  process.exit(2);
}

// The argument is handed to the CLI as one argv element, so nothing between this
// script and Codex re-escapes the backslashes. Routing the same text through a
// shell is what made the original probe read the doubling result backwards.
function probe(override) {
  const run = spawnSync(process.execPath, [launcher].concat(COMMAND, ['-c', override]), {
    encoding: 'utf8',
    timeout: 120000,
  });
  return {
    status: run.status,
    first: ((run.stdout || '') + (run.stderr || '')).trim().split('\n')[0] || '',
  };
}

const tempPath = (process.env.TEMP || '').replace(/[/]+$/, '');
if (!tempPath) {
  console.error('SOURCE_MISSING: %TEMP% is not set, so the override cannot be built');
  process.exit(2);
}
const pathForms = {
  backslash: tempPath,
  forward: tempPath.split(BS).join('/'),
  doubled: tempPath.split(BS).join(BS + BS),
};
const override = (p) => 'projects={' + Q + p + Q + '={trust_level=' + Q + 'trusted' + Q + '}}';

// Control: an override Codex cannot parse at all must also be refused, or an
// "accepted" verdict below would only mean the CLI ignores the flag.
const control = probe('projects={not-a-map');
if (control.status === 0) {
  console.error('CONTROL_FAILED: a malformed override was accepted, so no verdict is meaningful');
  process.exit(2);
}
console.log('CONTROL: malformed override refused (' + control.first.slice(0, 60) + ')');

const results = {};
for (const form of Object.keys(pathForms)) {
  results[form] = probe(override(pathForms[form]));
  console.log(
    'CODEX_' +
      form.toUpperCase() +
      '_PATH: ' +
      (results[form].status === 0 ? 'ACCEPTED' : 'REFUSED') +
      ' (' +
      results[form].first.slice(0, 60) +
      ')'
  );
}

const doctor = fs.readFileSync(DOCTOR, 'utf8');
const repoClaims = {
  overrideNamed: doctor.includes('AO must emit a forward-slash path'),
  causeNamed: doctor.includes('Windows path separators break config parsing'),
};

if (results.backslash.status === 0) {
  console.error(
    'CLAIM_STALE: the CLI now accepts a single-backslash path; TASK-AI-16-FINDINGS.md is stale'
  );
  process.exit(1);
}
if (results.forward.status !== 0) {
  console.error('CLAIM_STALE: the CLI now refuses a forward-slash path; the root cause changed');
  process.exit(1);
}
if (!repoClaims.overrideNamed || !repoClaims.causeNamed) {
  console.error(
    'REPO_CLAIM_MISSING: doctor.ps1 no longer names the refused override and its cause'
  );
  process.exit(1);
}
console.log('AC-AI-16-03 held: backslash refused, forward slash accepted, repository names both');
process.exit(0);
