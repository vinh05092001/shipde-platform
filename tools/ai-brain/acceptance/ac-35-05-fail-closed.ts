// AC-AI-35-05 - the scanner fails closed. A spawn or argument error must be an
// operational failure, never a silent success: the pipeline blocks on it
// (`AI-35-R04`). The check is the real `executeGitleaks` exported by
// `scripts/verify-secrets.ts`, not a restatement of what it ought to return.
//
// The row this replaces carried a JavaScript `||` inside a markdown table cell,
// which splits the cell, so it could not be extracted and run as written. The
// arguments are passed as values here, so no shell re-quotes anything.
import * as fs from 'fs';
import * as path from 'path';
import { executeGitleaks } from '../../../scripts/verify-secrets';

const MARKER = path.join('scripts', 'verify-secrets.ts');
if (!fs.existsSync(MARKER)) {
  console.error('SOURCE_MISSING: ' + MARKER);
  process.exit(2);
}

const result = executeGitleaks('nonexistent-binary-xyz', ['dir', '.'], 'dummy-report.json');

// Control: a fault with no explanation is not a diagnosis an operator can act
// on, and an empty message would let the assertion below pass for the wrong
// reason.
if (!result.operationalError) {
  console.error('CONTROL_FAILED: the fault produced no operationalError message');
  process.exit(2);
}
if (result.success || result.exitCode === 0) {
  console.error('FAIL_CLOSED_VIOLATED: the scanner reported success on a fault');
  process.exit(1);
}
console.log('FAIL_CLOSED_VERIFIED: ' + result.operationalError);
