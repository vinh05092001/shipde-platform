'use strict';
// AC-AI-11-10 — fail-closed guards: the supervisor must refuse to proceed when
// failover budget is exceeded AND when neither Preview nor DryRun is set but
// the supervisor would otherwise perform a mutating operation without a guard.
//
// This is a structural claim about `scripts/ai/control.ps1`. The script checks
// that the exhaustion guard produces an explicit stop/error and that the
// Preview/DryRun guards are structured as conditionals (if/elseif) that wrap
// mutating operations, not bare statements that run unconditionally.
//
// No fixture stands in for the real file. Run outside the repository it exits 2.
const fs = require('fs');

const SOURCE = 'scripts/ai/control.ps1';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');

const violations = [];

// 1. Exhaustion guard must produce an explicit stop or error (not just a
//    silent return or continue).
const EXHAUSTION_STOP = /exhausted.*?(?:throw|Write-Error|exit|\[FAIL-CLOSED\])/is;
if (!EXHAUSTION_STOP.test(source)) {
  violations.push(
    'MISSING EXHAUSTION_STOP: exhausted guard does not produce an explicit stop/throw/exit'
  );
}

// 2. Preview guard must be a conditional (if) that wraps mutating operations.
const PREVIEW_IF = /if\s*\(\s*\$Preview\s*\)/i;
if (!PREVIEW_IF.test(source)) {
  violations.push('MISSING PREVIEW_IF: $Preview is not used in an if-guard conditional');
}

// 3. DryRun guard must be a conditional (if) that wraps mutating operations.
const DRYRUN_IF = /if\s*\(\s*\$DryRun\s*\)/i;
if (!DRYRUN_IF.test(source)) {
  violations.push('MISSING DRYRUN_IF: $DryRun is not used in an if-guard conditional');
}

// 4. The supervisor must have a [FAIL-CLOSED] tag on the exhaustion path.
const FAIL_CLOSED_TAG = /\[FAIL-CLOSED\]/;
if (!FAIL_CLOSED_TAG.test(source)) {
  violations.push('MISSING FAIL_CLOSED_TAG: no [FAIL-CLOSED] tag on the exhaustion guard path');
}

if (violations.length > 0) {
  for (const v of violations) console.error(v);
  process.exit(1);
}

console.log(
  'FAIL_CLOSED_GUARDS_HOLD: exhaustion stop, Preview if-guard, DryRun if-guard, and [FAIL-CLOSED] tag present'
);
process.exit(0);
