'use strict';
// AC-AI-43-09 — the enforcement boundary claimed by TASK-AI-43: no file under
// .github/workflows/ and no line of scripts/ai/control.ps1 invokes doctor.ps1
// or ecosystem.ps1, so those two scripts are manually-run verification
// surfaces, not enforced delivery gates.
//
// The logic is unchanged from the row this replaces. What changed is where it
// lives: the command was stored inline in a markdown table and contained an
// unescaped `|` inside the regular expression /(doctor|ecosystem)\.ps1/, which
// splits the table cell. Copied out of the table, the command ended mid-regex
// and could not run at all. A command that cannot survive being copied out of
// its own specification is not evidence.
//
// Exit codes: 0 boundary holds (zero callers) - 1 a caller now exists -
// 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKFLOWS = '.github/workflows';
const CONTROL = 'scripts/ai/control.ps1';
const CALLER = /(doctor|ecosystem)\.ps1/;

if (!fs.existsSync(WORKFLOWS) || !fs.existsSync(CONTROL)) {
  console.error(
    'SOURCE_MISSING: ' + WORKFLOWS + ' and ' + CONTROL + ' (run from the repository root)'
  );
  process.exit(2);
}

const files = fs
  .readdirSync(WORKFLOWS)
  .map((f) => path.join(WORKFLOWS, f))
  .concat([CONTROL]);
if (files.length < 2) {
  console.error('SOURCE_MISSING: no workflow file found under ' + WORKFLOWS);
  process.exit(2);
}

// Control: a COPY of a real workflow, given a call to doctor.ps1, must be
// flagged. Without this, "0 callers" is indistinguishable from a dead regex.
const sample = files[0];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac43-09-'));
const tmp = path.join(tmpDir, path.basename(sample));
fs.writeFileSync(
  tmp,
  fs.readFileSync(sample, 'utf8') + '\n      - run: pwsh scripts/ai/doctor.ps1\n'
);
const controlFlagged = CALLER.test(fs.readFileSync(tmp, 'utf8'));
fs.rmSync(tmpDir, { recursive: true, force: true });
if (!controlFlagged) {
  console.error(
    'CONTROL_FAILED: an injected doctor.ps1 call in a copy of ' + sample + ' was not detected'
  );
  process.exit(2);
}
console.log('CONTROL: an injected doctor.ps1 call in a copy of ' + sample + ' was detected');

const callers = files.filter((f) => CALLER.test(fs.readFileSync(f, 'utf8')));
console.log(
  'Enforced-path callers of doctor.ps1/ecosystem.ps1 outside scripts/ai: ' +
    callers.length +
    ' ' +
    JSON.stringify(callers)
);
if (callers.length !== 0) {
  console.error(
    'ENFORCEMENT_BOUNDARY_WIDENED: update the Business outcome of TASK-AI-43 before merging.'
  );
  process.exit(1);
}
console.log('ENFORCEMENT_BOUNDARY_HOLDS: 0 callers');
process.exit(0);
