// AC-AI-35-04 - dual-mode scanning honours the build and dependency directory
// exclusions. The rule is not restated here: the ignored names come from
// `IGNORED_SCAN_NAMES`, and the traversal from `getGitleaksScanTargets`, both
// exported by the real `scripts/verify-secrets.ts` module the scanner runs.
//
// The row this replaces could not be executed as written. It carried a
// JavaScript `||` inside a markdown table cell, which splits the cell, and an
// `npx tsx -e` payload whose quoting survives bash but not PowerShell. Every
// value here is passed as an argument, so no shell re-quotes anything.
//
// The check would pass vacuously over a directory with no files - zero targets
// trivially contain no ignored path - so a control proves the traversal really
// reached this repository, and a second control proves the exclusion really
// fires by traversing a fixture that does contain ignored directories.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IGNORED_SCAN_NAMES, getGitleaksScanTargets } from '../../../scripts/verify-secrets';

for (const marker of ['package.json', path.join('scripts', 'verify-secrets.ts')]) {
  if (!fs.existsSync(marker)) {
    console.error('SOURCE_MISSING: ' + marker);
    process.exit(2);
  }
}

const targets = getGitleaksScanTargets(process.cwd());

// Control 1: the traversal must have reached the repository root.
if (!targets.includes('package.json')) {
  console.error('CONTROL_FAILED: the scan traversal did not reach the repository root');
  process.exit(2);
}

// Control 2: the exclusion must remove something. Without this, an emptied
// `IGNORED_SCAN_NAMES` would satisfy the assertion below without excluding
// anything at all.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-exclusions-'));
let fixtureTargets: string[];
try {
  for (const name of IGNORED_SCAN_NAMES) {
    fs.mkdirSync(path.join(fixture, name), { recursive: true });
    fs.writeFileSync(path.join(fixture, name, 'leak.txt'), 'fixture');
  }
  fs.writeFileSync(path.join(fixture, 'clean.txt'), 'fixture');
  fixtureTargets = getGitleaksScanTargets(fixture);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

if (!fixtureTargets.includes('clean.txt')) {
  console.error('CONTROL_FAILED: the fixture traversal did not reach its own root');
  process.exit(2);
}
const leaked = fixtureTargets.filter((t) =>
  t.split(/[\\/]/).some((segment) => IGNORED_SCAN_NAMES.has(segment))
);
if (leaked.length > 0) {
  console.error('CONTROL_FAILED: the exclusion ignored nothing: ' + leaked.join(', '));
  process.exit(2);
}

const hasIgnored = targets.some((t) =>
  t.split(/[\\/]/).some((segment) => IGNORED_SCAN_NAMES.has(segment))
);
if (hasIgnored) {
  console.error('DUAL_MODE_EXCLUSIONS_VIOLATED: a scan target descends into an ignored directory');
  process.exit(1);
}
console.log(
  'DUAL_MODE_EXCLUSIONS_VERIFIED: ' +
    targets.length +
    ' scan targets, all build and dependency directories excluded'
);
