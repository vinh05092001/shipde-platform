'use strict';
// AC-AI-12-07 — the invariant: install-task-scheduler.ps1 defines observable
// [PREVIEW], [DRY-RUN], and [TASK-SCHEDULER] banners so operators and harnesses
// can reliably inspect operations without mutating system state.
//
// Exit codes: 0 banners present, 1 banner missing, 2 source missing.
const fs = require('fs');

const SOURCE = 'scripts/ai/install-task-scheduler.ps1';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');

const REQUIRED = [
  { id: 'PREVIEW_BANNER', pattern: /\[PREVIEW\]/, label: 'a [PREVIEW] banner' },
  { id: 'DRYRUN_BANNER', pattern: /\[DRY-RUN\]/, label: 'a [DRY-RUN] banner' },
  {
    id: 'TASK_SCHEDULER_BANNER',
    pattern: /\[TASK-SCHEDULER\]/,
    label: 'a [TASK-SCHEDULER] banner',
  },
];

const missing = REQUIRED.filter((r) => !r.pattern.test(source));
if (missing.length > 0) {
  for (const m of missing) console.error('MISSING ' + m.id + ': ' + m.label);
  process.exit(1);
}

console.log(
  'TASK_SCHEDULER_BANNERS_PRESENT: [PREVIEW], [DRY-RUN], and [TASK-SCHEDULER] banners found in ' +
    SOURCE
);
process.exit(0);
