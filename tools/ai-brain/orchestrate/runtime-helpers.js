'use strict';

/**
 * Ship Dễ — Live runtime helpers extracted from cli/dispatch-helpers.js (Lat C-2b-1).
 *
 * Keeps checkpoint IO, failure-domain blocking, account merging, and combo
 * candidate assembly independent of the legacy `cli.js dispatch` cluster.
 */

const fs = require('fs');
const path = require('path');
const { atomicRenameSync } = require('../atomic-rename');

function mergeEvidenceAccounts(inputAccounts, registryAccounts) {
  const input = Array.isArray(inputAccounts) ? inputAccounts : [];
  const registry = Array.isArray(registryAccounts) ? registryAccounts : [];
  if (registry.length === 0) return input;
  const map = new Map();
  const noId = [];
  const hasCaps = (a) => Boolean(a && a.capabilities && Object.keys(a.capabilities).length > 0);

  for (const acc of input) {
    if (!acc || typeof acc !== 'object') continue;
    if (!acc.id) {
      noId.push(acc);
      continue;
    }
    map.set(acc.id, Object.assign({}, acc));
  }
  for (const reg of registry) {
    if (!reg || typeof reg !== 'object' || !reg.id) continue;
    if (map.has(reg.id)) {
      const existing = map.get(reg.id);
      if (!hasCaps(existing) && hasCaps(reg)) {
        map.set(reg.id, Object.assign({}, reg, existing, { capabilities: reg.capabilities }));
      }
    } else {
      map.set(reg.id, Object.assign({}, reg));
    }
  }
  return [...Array.from(map.values()), ...noId];
}

function assembleForDispatch(discoveryCat, accounts, registry, options) {
  // Combo-only routing: every role calls the single 9router combo; 9router owns
  // member order, failover and health (operator decision 2026-11-19).
  const opts = options || {};
  if (Array.isArray(opts.candidates)) return opts.candidates;
  const { comboCandidate } = require('../combo');
  const result = comboCandidate({ registry: registry || opts.registry, env: opts.env });
  return result.candidate ? [result.candidate] : [];
}

function readCheckpoint(file) {
  if (!file) return null;
  const tmp = file + '.tmp';
  if (fs.existsSync(tmp)) {
    let adopted = null;
    try {
      adopted = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    } catch {
      adopted = null;
    }
    if (adopted && typeof adopted === 'object' && !Array.isArray(adopted)) {
      try {
        atomicRenameSync(tmp, file);
      } catch {}
      return adopted;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, value, options) {
  const fsApi = (options && options.fs) || fs;
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fsApi.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  atomicRenameSync(tmp, file, Object.assign({}, options, { fs: fsApi }));
}

function sameFailureDomain(candidate, failed, classification) {
  // mvp-repair.test.js evaluates this function via new Function without CommonJS require scope.
  const failureDomain =
    typeof require === 'function'
      ? require('../failure-domain')
      : process.getBuiltinModule('module').createRequire(`${process.cwd()}/tools/ai-brain/cli.js`)(
          './failure-domain'
        );
  return failureDomain.sameFailureDomain(candidate, failed, classification);
}

function applyFailureBlocks(
  candidates,
  failedKeys,
  failedCandidate,
  classification,
  avoidDomain,
  codes
) {
  const candidatesApi = require('../candidates');
  for (const c of candidates) {
    if (c.blocked) continue;
    const key = candidatesApi.candidateKey(c);
    if (failedKeys.has(key)) {
      c.blocked = true;
      c.blockReason = codes.failed;
      c.blockScope = 'candidate';
      continue;
    }
    if (avoidDomain && sameFailureDomain(c, failedCandidate, classification)) {
      c.blocked = true;
      c.blockReason = codes.sameDomain;
      c.blockScope = classification.scope || 'unknown';
    }
  }
}

const DRY_RUN_BLOCK_CODES = Object.freeze({
  failed: 'SIMULATED_CANDIDATE_FAILED',
  sameDomain: 'SIMULATED_FAILURE_DOMAIN_AVOIDED',
});

const LIVE_BLOCK_CODES = Object.freeze({
  failed: 'CANDIDATE_FAILED',
  sameDomain: 'FAILURE_DOMAIN_AVOIDED',
});

module.exports = {
  mergeEvidenceAccounts,
  assembleForDispatch,
  readCheckpoint,
  writeJsonFile,
  sameFailureDomain,
  applyFailureBlocks,
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
};
