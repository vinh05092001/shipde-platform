'use strict';
// TASK-AI-12 — the task scheduler contract the script source must satisfy,
// held in exactly one place.
//
// `ac-12-05-task-scheduler-contract.js` (the invariant: the real script satisfies
// all parameter and structure requirements) and
// `ac-12-06-task-scheduler-contract-broken.js` (the negative proof: a copy of the
// real source with a required part removed is refused) both require this module,
// so the rule exists in exactly one place.
//
// Exit codes: 0 contract holds, 1 contract violated, 2 cannot be measured.

const SOURCE = 'scripts/ai/install-task-scheduler.ps1';

const REQUIRED_PARTS = [
  {
    id: 'ACTION_PARAM',
    label: 'a [ValidateSet("Install", "Uninstall", "Status")] attribute on $Action',
    pattern: /\[ValidateSet\(\s*"Install",\s*"Uninstall",\s*"Status"\s*\)\]/i,
  },
  {
    id: 'INTERVAL_PARAM',
    label: 'a [ValidateRange(1, 1440)] [int]$IntervalMinutes parameter',
    pattern: /\[ValidateRange\(\s*1\s*,\s*1440\s*\)\].*?\$IntervalMinutes/s,
  },
  {
    id: 'DRYRUN_PARAM',
    label: 'a [switch]$DryRun parameter in the param block',
    pattern: /\[switch\]\$DryRun\b/,
  },
  {
    id: 'PREVIEW_PARAM',
    label: 'a [switch]$Preview parameter in the param block',
    pattern: /\[switch\]\$Preview\b/,
  },
  {
    id: 'APPLY_PARAM',
    label: 'a [switch]$Apply parameter in the param block',
    pattern: /\[switch\]\$Apply\b/,
  },
  {
    id: 'RESUME_ENTRYPOINT',
    label: 'an unattended entrypoint specifying control.ps1 -Action Resume per AI-TOOL-15',
    pattern: /-(?:Action\s+Resume|Action\s+"Resume")/i,
  },
  {
    id: 'PREVIEW_BANNER',
    label: 'a [PREVIEW] banner emitted when preview/dry-run is active',
    pattern: /\[PREVIEW\]/,
  },
  {
    id: 'DRYRUN_BANNER',
    label: 'a [DRY-RUN] banner emitted when preview/dry-run is active',
    pattern: /\[DRY-RUN\]/,
  },
  {
    id: 'TASK_SCHEDULER_BANNER',
    label: 'a [TASK-SCHEDULER] status banner in the output',
    pattern: /\[TASK-SCHEDULER\]/,
  },
  {
    id: 'CONTROLLER_CHECK',
    label: 'a check verifying control.ps1 existence before configuring task',
    pattern: /Test-Path.*controlScript/i,
  },
];

function missingTaskSchedulerParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.pattern.test(source));
}

module.exports = { SOURCE, REQUIRED_PARTS, missingTaskSchedulerParts };
