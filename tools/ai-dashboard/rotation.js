'use strict';

/**
 * Ship Dễ — Model Rotation Data Aggregator
 * TASK-AI-47: AI-47-R01..R08
 *
 * Reads real measurements from disk to build the radial dispatch topology.
 * Where a number cannot be measured, returns 'UNKNOWN' — never 0 or null.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = path.join(os.homedir(), '.shipde');

const SOURCE_DEFS = [
  { id: '9router', label: '9Router' },
  { id: 'xkiro', label: 'xKiro' },
  { id: 'agy-local', label: 'agy (local)' },
  { id: 'agy-docker', label: 'agy (docker)' },
  { id: 'cline', label: 'Cline' },
  { id: 'autoclaw', label: 'AutoClaw' },
  { id: 'ao', label: 'AO' },
];

function parseLogLines(logDir) {
  const entries = [];
  if (!fs.existsSync(logDir)) return entries;
  let files;
  try {
    files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
  } catch {
    return entries;
  }
  const lineRe = /source=([\w-]+).*?model=([\w./:-]+).*?tokens=(\d+|UNKNOWN).*?status=(done|failed|quota-refused|live)/i;
  const timeRe = /^\[([^\]]+)\]/;
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(logDir, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const m = lineRe.exec(line);
      if (!m) continue;
      const tm = timeRe.exec(line);
      entries.push({
        at: tm ? tm[1] : new Date().toISOString(),
        sourceId: m[1].toLowerCase(),
        modelId: m[2],
        tokens: m[3] === 'UNKNOWN' ? 'UNKNOWN' : Number(m[3]),
        outcome: m[4].toLowerCase(),
      });
    }
  }
  return entries;
}

function readCooldowns(ledgerFile) {
  const cooldowns = {};
  const file = ledgerFile || path.join(HOME_DIR, 'quota.observations.json');
  let observations;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    observations = Array.isArray(raw.observations) ? raw.observations : [];
  } catch {
    return cooldowns;
  }
  const now = Date.now();
  const refusals = observations.filter(
    (o) => o && o.outcome === 'refused' && o.accountId
  );
  for (const ref of refusals) {
    const id = String(ref.accountId).toLowerCase();
    const refTime = ref.at ? new Date(ref.at).getTime() : 0;
    if (!refTime || Number.isNaN(refTime)) continue;
    const untilMs = refTime + 5 * 60 * 1000;
    if (untilMs > now) {
      const existing = cooldowns[id];
      if (!existing || new Date(existing.until).getTime() < untilMs) {
        cooldowns[id] = {
          reason: ref.reason || 'quota refusal',
          until: new Date(untilMs).toISOString(),
        };
      }
    }
  }
  return cooldowns;
}

function readQuotaStore(storeFile) {
  const file = storeFile || path.join(HOME_DIR, 'agy-quota.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.accounts ? parsed.accounts : {};
  } catch {
    return {};
  }
}

function buildRotationState(options) {
  const opts = options || {};
  const rootDir = opts.rootDir || path.resolve(__dirname, '../..');
  const logDir = opts.logDir || path.join(rootDir, '.worktrees', 'logs');
  const ledgerFile = opts.ledgerFile || path.join(HOME_DIR, 'quota.observations.json');
  const quotaFile = opts.quotaFile || path.join(HOME_DIR, 'agy-quota.json');
  const now = opts.now || Date.now();

  const logEntries = parseLogLines(logDir);
  const cooldowns = readCooldowns(ledgerFile);
  const quotaAccounts = readQuotaStore(quotaFile);

  const configuredIds = new Set();
  for (const e of logEntries) configuredIds.add(e.sourceId);
  for (const id of Object.keys(cooldowns)) configuredIds.add(id);
  for (const id of Object.keys(quotaAccounts)) configuredIds.add(id.toLowerCase());

  const hasAnyData = configuredIds.size > 0;
  const sources = [];

  for (const def of SOURCE_DEFS) {
    const isConfigured = hasAnyData ? configuredIds.has(def.id) : false;
    if (hasAnyData && !isConfigured) continue;

    const sourceLogs = logEntries.filter((e) => e.sourceId === def.id);
    const recentRuns = sourceLogs
      .filter((e) => e.outcome !== 'live')
      .slice(-10)
      .map((e) => ({ outcome: e.outcome, at: e.at }));

    const liveEntries = sourceLogs.filter((e) => e.outcome === 'live');
    const activeRun = liveEntries.length > 0
      ? {
          modelId: liveEntries[liveEntries.length - 1].modelId,
          tokensSoFar: liveEntries[liveEntries.length - 1].tokens,
          startedAt: liveEntries[liveEntries.length - 1].at,
        }
      : { modelId: null, tokensSoFar: 'UNKNOWN', startedAt: null };

    const cooldown = cooldowns[def.id] || { reason: null, until: null };
    const isOnCooldown = cooldown.until && new Date(cooldown.until).getTime() > now;

    let consumption = 'UNKNOWN';
    const knownTokens = sourceLogs
      .filter((e) => e.tokens !== 'UNKNOWN')
      .map((e) => e.tokens);
    if (knownTokens.length > 0) {
      consumption = knownTokens.reduce((a, b) => a + b, 0);
    }

    let declaredLimit = 'UNKNOWN';
    let headroom = 'UNKNOWN';
    try {
      const { resolveLimits } = require('../ai-brain/limits');
      const account = { id: def.id, limits: {} };
      const resolved = resolveLimits(account, { skipLedger: true });
      const w = resolved.windows.tokensPerDay;
      if (w && !w.unknownBudget && w.ceiling > 0) {
        declaredLimit = w.ceiling;
        if (consumption !== 'UNKNOWN') {
          headroom = Math.max(0, declaredLimit - consumption);
        }
      }
    } catch {
      // limits.js not reachable; keep UNKNOWN
    }

    let status = 'idle';
    if (activeRun.modelId) status = 'live';
    if (isOnCooldown) status = 'cooldown';

    sources.push({
      id: def.id,
      label: def.label,
      configured: isConfigured || !hasAnyData,
      status,
      activeRun,
      cooldown: isOnCooldown ? cooldown : { reason: null, until: null },
      limits: { declaredLimit, consumption, headroom },
      recentRuns,
    });
  }

  return {
    observedAt: new Date(now).toISOString(),
    hub: { label: '9Router / dispatch lanes' },
    sources,
  };
}

module.exports = {
  SOURCE_DEFS,
  parseLogLines,
  readCooldowns,
  readQuotaStore,
  buildRotationState,
};