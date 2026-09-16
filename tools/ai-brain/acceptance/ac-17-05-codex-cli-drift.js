'use strict';
// AC-AI-17-05 — the `codex-cli` pin was not moved, and the observed drift was
// recorded rather than hidden.
//
// The stored row was prose. This script measures the two halves of the claim
// against the REAL manifest and the REAL decisions document:
//   * pinned_version_or_commit is still 0.151.0, and the observed 0.154.0 is
//     written down beside it, with a note attributing the drift;
//   * AI-TOOLCHAIN-DECISIONS.md names both versions, so the drift has an owner.
// Bumping the pin to whatever is installed is the failure mode this row exists
// to catch, so a tampered COPY that does exactly that must be rejected.
//
// Exit codes: 0 the claim holds - 1 the claim is violated - 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MANIFEST = 'tools/ecosystem-manifest.json';
const DECISIONS = 'docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md';
const ID = 'codex-cli';

if (!fs.existsSync(MANIFEST) || !fs.existsSync(DECISIONS)) {
  console.error('SOURCE_MISSING: run from the repository root (' + MANIFEST + ')');
  process.exit(2);
}

/** Empty array means the drift is recorded and the pin is intact. */
function driftViolations(manifest, decisionsText) {
  const out = [];
  const entry = (manifest.adopted || []).find((e) => e.id === ID);
  if (!entry) return [ID + ': absent from the manifest'];
  const pin = String(entry.pinned_version_or_commit || '');
  const observed = String(entry.observed_version_or_commit || '');
  if (!pin) out.push(ID + ': no pin recorded');
  if (!observed) out.push(ID + ': no observed version recorded, so drift cannot be read');
  if (pin && observed && pin === observed) {
    out.push(ID + ': pin equals the observed version (' + pin + '), so no drift is recorded');
  }
  if (!entry.version_drift_note) {
    out.push(ID + ': observed drift carries no version_drift_note');
  }
  for (const version of [pin, observed]) {
    if (version && !decisionsText.includes(version)) {
      out.push(ID + ': ' + version + ' is not named in ' + DECISIONS);
    }
  }
  return out;
}

const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const decisions = fs.readFileSync(DECISIONS, 'utf8');
const entry = (real.adopted || []).find((e) => e.id === ID);
if (!entry) {
  console.error('CONTROL_FAILED: ' + ID + ' is no longer in ' + MANIFEST);
  process.exit(2);
}

// Control: re-pinning to the installed version is how the drift gets hidden.
// The checker must refuse that copy.
const tmp = path.join(os.tmpdir(), 'shipde-ac17-05-' + process.pid + '.json');
const tampered = JSON.parse(JSON.stringify(real));
tampered.adopted.find((e) => e.id === ID).pinned_version_or_commit = tampered.adopted.find(
  (e) => e.id === ID
).observed_version_or_commit;
fs.writeFileSync(tmp, JSON.stringify(tampered));
const control = driftViolations(JSON.parse(fs.readFileSync(tmp, 'utf8')), decisions);
fs.unlinkSync(tmp);
if (control.length === 0) {
  console.error(
    'CONTROL_FAILED: the checker accepted a pin silently bumped to the observed version'
  );
  process.exit(2);
}
console.log('CONTROL: silent re-pin rejected (' + control[0] + ')');

const violations = driftViolations(real, decisions);
console.log(
  'CODEX_CLI_PIN: ' +
    entry.pinned_version_or_commit +
    ' (observed ' +
    entry.observed_version_or_commit +
    ', drift documented)'
);
if (violations.length > 0) {
  for (const v of violations) console.error('VIOLATION ' + v);
  process.exit(1);
}
console.log('AC-AI-17-05 drift recorded, pin intact');
process.exit(0);
