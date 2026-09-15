#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — naming the login inside the worker container
 *
 * Quota readings have to be tied to the account that produced them, or a
 * reading survives an account switch and goes on describing someone else's
 * budget while looking perfectly current. On the host that identity is an
 * email address, read from a file that holds addresses and nothing else.
 *
 * The container has no such file. Its only record of who is signed in is the
 * OAuth credential itself. So this prints a fingerprint of that credential
 * instead of the address: enough to answer "is this the same login as last
 * time", which is the only question the cache actually asks, without the
 * address ever being known and without the credential ever leaving the
 * container.
 *
 * Only the refresh token is hashed. The access token beside it is reissued
 * roughly hourly, so hashing the whole file would produce a new fingerprint
 * every hour and invalidate every cached reading for no reason.
 *
 * What this cannot detect: two different Google accounts are distinguishable,
 * but re-authenticating the same account produces a new refresh token and so a
 * new fingerprint. That errs toward re-reading the quota, which costs a CLI
 * round trip and never produces a wrong number.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_FILE = path.join(
  process.env.HOME || '/root',
  '.gemini',
  'antigravity-cli',
  'antigravity-oauth-token'
);

function main() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch (e) {
    process.stderr.write('không đọc được credential: ' + e.code + '\n');
    process.exit(1);
  }

  // The file has been seen with the credential both at the top level and
  // nested under a wrapper key, so the field is searched for rather than
  // addressed by a fixed path.
  const token = findRefreshToken(parsed);
  if (!token) {
    process.stderr.write('không tìm thấy refresh token trong credential\n');
    process.exit(1);
  }

  const digest = crypto.createHash('sha256').update(token).digest('hex');
  process.stdout.write('fingerprint:' + digest.slice(0, 16) + '\n');
}

function findRefreshToken(node, depth) {
  const d = depth || 0;
  if (d > 4 || !node || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node)) {
    if (/refresh_?token/i.test(key) && typeof value === 'string' && value.length > 0) return value;
  }
  for (const value of Object.values(node)) {
    const found = findRefreshToken(value, d + 1);
    if (found) return found;
  }
  return null;
}

main();
