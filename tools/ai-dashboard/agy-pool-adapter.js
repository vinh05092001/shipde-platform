'use strict';

const fs = require('fs');
const path = require('path');

const ACCOUNT_RE = /^agy\d{2}$/;
const VALID_STATES = new Set(['ok', 'quota', 'login-required', 'error']);

function readJson(file) {
  // worker.ps1 runs under Windows PowerShell 5.1, whose `Set-Content -Encoding UTF8`
  // writes a byte-order mark. JSON.parse rejects it, so every real result.json read as
  // malformed and each account showed as an error.
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function collectAgyPoolState(options = {}) {
  const started = Date.now();
  const root = options.root || process.env.AGY_RUNS_DIR || 'C:\\Tools\\agy-runs';
  const observedAt = new Date().toISOString();
  const base = { name: 'agy-pool', provenance: root };

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    return {
      health: Object.assign({}, base, {
        status: 'unavailable',
        observedAt,
        latencyMs: Date.now() - started,
        impact: `Không đọc được thư mục pool agy: ${root}`,
        error: err.message,
      }),
      data: {
        accounts: [],
        active: null,
        counts: { total: 0, ready: 0, cooling: 0, loginRequired: 0, error: 0, neverRun: 0 },
      },
    };
  }

  let pool = {};
  let poolNote = null;
  try {
    pool = readJson(path.join(root, 'pool.json'));
  } catch (err) {
    if (err.code !== 'ENOENT') poolNote = `pool.json không hợp lệ: ${err.message}`;
  }

  const now = options.now === undefined ? Date.now() : Number(options.now);
  const poolAccounts =
    pool && typeof pool.accounts === 'object' && pool.accounts ? pool.accounts : {};
  const active = typeof pool.active === 'string' ? pool.active : null;
  const accounts = entries
    .filter((entry) => entry.isDirectory() && ACCOUNT_RE.test(entry.name))
    .map((entry) => {
      const name = entry.name;
      let result = null;
      let note = null;
      try {
        result = readJson(path.join(root, name, 'result.json'));
      } catch (err) {
        if (err.code !== 'ENOENT') note = `result.json không hợp lệ: ${err.message}`;
      }

      let state = 'never-run';
      if (note) state = 'error';
      else if (result) {
        if (VALID_STATES.has(result.state)) state = result.state;
        else {
          state = 'error';
          note = `Trạng thái result.json không hợp lệ: ${String(result.state)}`;
        }
      }

      const configuredCooldown = poolAccounts[name] && poolAccounts[name].cooldownUntil;
      if (!note && poolAccounts[name] && typeof poolAccounts[name].note === 'string') {
        note = poolAccounts[name].note;
      }
      const cooldownMs = configuredCooldown ? new Date(configuredCooldown).getTime() : NaN;
      const cooldownUntil =
        Number.isFinite(cooldownMs) && cooldownMs > now ? configuredCooldown : null;

      return {
        name,
        state,
        startedAt: result && result.startedAt ? result.startedAt : null,
        finishedAt: result && result.finishedAt ? result.finishedAt : null,
        cooldownUntil,
        active: active === name,
        note,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = {
    total: accounts.length,
    ready: accounts.filter((a) => a.state === 'ok' && !a.cooldownUntil).length,
    cooling: accounts.filter((a) => Boolean(a.cooldownUntil)).length,
    loginRequired: accounts.filter((a) => a.state === 'login-required').length,
    error: accounts.filter((a) => a.state === 'error').length,
    neverRun: accounts.filter((a) => a.state === 'never-run').length,
  };
  const impact = poolNote
    ? `${accounts.length} tài khoản agy; ${poolNote}`
    : `${accounts.length} tài khoản agy: ${counts.ready} sẵn sàng, ${counts.cooling} đang nghỉ`;

  return {
    health: Object.assign({}, base, {
      status: 'live',
      observedAt,
      latencyMs: Date.now() - started,
      impact,
      error: poolNote,
    }),
    data: { accounts, active, counts },
  };
}

module.exports = { collectAgyPoolState };
