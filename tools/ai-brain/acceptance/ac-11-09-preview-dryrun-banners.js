'use strict';
// AC-AI-11-09 — the invariant: the real supervisor source shows [PREVIEW]
// output when the Preview switch is active AND the [SUPERVISOR][DRY-RUN]
// output when the DryRun switch is active. These banners are the observable
// surface the agent router's callers rely on to know no mutations were
// performed.
//
// This is a textual claim about `scripts/ai/control.ps1`. No fixture stands in
// for the real file. Run outside the repository it exits 2, not 0.
const fs = require('fs');

const SOURCE = 'scripts/ai/control.ps1';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');

// Required patterns: the supervisor must contain both observable banners.
const REQUIRED = [
  {
    id: 'PREVIEW_BANNER',
    pattern: /\[PREVIEW\]/,
    label: 'a [PREVIEW] banner in the supervisor output',
  },
  {
    id: 'DRYRUN_BANNER',
    pattern: /\[SUPERVISOR\]\[DRY-RUN\]/,
    label: 'a [SUPERVISOR][DRY-RUN] banner in the supervisor output',
  },
];

const missing = REQUIRED.filter((r) => !r.pattern.test(source));
if (missing.length > 0) {
  for (const m of missing) console.error('MISSING ' + m.id + ': ' + m.label);
  process.exit(1);
}

console.log(
  'PREVIEW_DRYRUN_BANNERS_PRESENT: [PREVIEW] and [SUPERVISOR][DRY-RUN] banners found in ' + SOURCE
);
process.exit(0);
