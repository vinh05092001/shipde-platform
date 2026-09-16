'use strict';
// AC-AI-16-02 — the AO ledger records activity for Codex sessions.
//
// The stored row could not be run as written: it named "SQL query output" but
// carried no command. This script runs the same query the delivered check runs
// — `Get-ShipDeAoHarnessActivity` in scripts/ai/common.ps1 reads
// `<home>/.ao/data/ao.db` read-only and counts sessions by harness — and it
// reports what the ledger actually holds.
//
// Measured at audit time the Work Item's outcome is NOT delivered: the ledger
// holds agy and claude-code sessions and not one Codex session, which is the
// failure TASK-AI-16 exists to fix. Following the model of
// ac-43-08-audit-wiring.js, this row therefore asserts the measured state and
// goes red with CLAIM_STALE the moment Codex activity appears, so the prose in
// TASK-AI-16.md must be widened in the same change.
//
// Exit codes: 0 the claim is still not delivered - 1 the claim is now true and
//            the prose is stale - 2 cannot measure (no readable ledger).
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEDGER = path.join(os.homedir(), '.ao', 'data', 'ao.db');
const PEERS = ['claude-code', 'agy'];
// The query below mirrors the reader in scripts/ai/common.ps1; requiring that
// file ties this row to a repository checkout rather than any directory.
const READER = 'scripts/ai/common.ps1';

if (!fs.existsSync(READER) || !fs.existsSync(LEDGER)) {
  console.error('SOURCE_MISSING: run from the repository root, with an AO ledger at ' + LEDGER);
  process.exit(2);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('SQLITE_UNAVAILABLE: ' + e.message);
  process.exit(2);
}

let db;
try {
  db = new DatabaseSync(LEDGER, { readOnly: true });
} catch (e) {
  console.error('LEDGER_UNREADABLE: ' + e.message);
  process.exit(2);
}

// Same shape as the reader in common.ps1: sessions, how many ever recorded
// activity, and how many recorded it inside the window.
let rows;
try {
  rows = db
    .prepare(
      'SELECT harness, COUNT(*) AS sessions, ' +
        'SUM(CASE WHEN activity_last_at IS NOT NULL THEN 1 ELSE 0 END) AS withActivity, ' +
        'SUM(CASE WHEN activity_last_at IS NOT NULL ' +
        "AND activity_last_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS recentWithActivity " +
        'FROM sessions GROUP BY harness'
    )
    .all('-24 hours');
} catch (e) {
  console.error('LEDGER_QUERY_FAILED: ' + e.message);
  process.exit(2);
} finally {
  if (db && typeof db.close === 'function') db.close();
}

const byHarness = new Map(rows.map((r) => [r.harness, r]));
console.log('harness | sessions | withActivity | recentWithActivity(24h)');
for (const r of rows) {
  console.log(
    r.harness + ' | ' + r.sessions + ' | ' + r.withActivity + ' | ' + r.recentWithActivity
  );
}

const codex = byHarness.get('codex') || { sessions: 0, withActivity: 0, recentWithActivity: 0 };
const peers = PEERS.map((p) => byHarness.get(p)).filter(Boolean);
console.log(
  'CODEX_ACTIVITY: sessions ' +
    codex.sessions +
    ', withActivity ' +
    codex.withActivity +
    '; peers with activity: ' +
    peers.filter((p) => p.withActivity > 0).length
);

if (codex.withActivity > 0) {
  console.error(
    'CLAIM_STALE: a Codex session now records activity (' +
      codex.withActivity +
      '). The Business outcome and the matrix row must be widened to match.'
  );
  process.exit(1);
}
console.log('AC-AI-16-02 measured: the ledger records no Codex activity (outcome NOT DELIVERED)');
process.exit(0);
