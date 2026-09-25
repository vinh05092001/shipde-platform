'use strict';

/**
 * Ship Dễ — Model Discovery: Controller Read Interface (W2 Flow B)
 *
 * READ CONTRACT FOR THE CONTROLLER INTEGRATION:
 * ---------------------------------------------
 * This module provides the stable, read-only interface through which the controller
 * inspects discovered model candidates and their empirical evidence state.
 *
 * CANDIDATE KEY SPECIFICATION:
 *   Every candidate has a unique, deterministic 7-part composite key:
 *     harness + accessPath + gateway + upstream + account + quotaScope + modelId
 *   joined by GATEWAY_PREFIX_SEPARATOR (U+241F).
 *   Keys carry NO credentials, tokens, or environment secrets.
 *
 * CANDIDATE SHAPE:
 *   {
 *     key: string,         // Composite 7-part key
 *     harness: string,     // 'http' | 'paseo' | 'direct' | ...
 *     accessPath: string,  // '9router' | 'opencode' | 'claude' | ...
 *     gateway: string,     // '9router' | 'opencode' | ...
 *     upstream: string,    // 'gh' | 'ag' | 'kimi' | 'mistral' | ...
 *     account: string,     // Account identifier or ''
 *     quotaScope: string,  // Quota scope identifier or ''
 *     modelId: string,     // Raw model identifier as named on this path
 *     base: string,        // Normalized model name without routing prefixes
 *     sourceIds: string[], // Sources that advertised this candidate
 *     state: string,       // Discovery ledger state: 'UNKNOWN' | 'AVAILABLE' | 'REMOVED' | ...
 *     resultState: string, // Exactly one of: 'PASS' | 'FAIL' | 'DEFERRED' | 'UNTESTED'
 *     alive: boolean,      // True only if model is verified PASS / AVAILABLE and not failed
 *     isAlive: () => bool, // Helper method returning candidate.alive
 *     passes: number,      // Number of successful probe passes
 *     failures: object[],  // Recorded failure evidence objects
 *     probeInvalid: number,// Client probe invalid errors (never counted as model failures)
 *     evidence: object[],  // Recent evidence items [{ ts, status, latencyMs, reason, errorClass }]
 *     firstSeen: string,   // ISO timestamp of first recorded advertisement or evidence
 *     lastSeen: string,    // ISO timestamp of latest recorded advertisement or evidence
 *     attempts: number     // Total attempts / probes seen
 *   }
 *
 * CONTROLLER QUERY CAPABILITIES:
 *   The returned catalogue exposes candidates indexed per access path AND per account:
 *   - catalogue.hasModel(accessPath, account, modelId) -> boolean
 *       Answers: "is this model present on THIS path for THIS account?"
 *       Strictly isolated: no other path or account can satisfy the query.
 *   - catalogue.getModel(accessPath, account, modelId) -> Candidate | undefined
 *   - catalogue.isModelPresent({ accessPath, account, modelId }) -> boolean
 *   - catalogue.isModelAlive({ accessPath, account, modelId }) -> boolean
 *       Returns true ONLY if the candidate exists on that path + account AND is verified alive/PASS.
 *       A model alive on HTTP is never reported alive on OpenCode.
 *   - catalogue.candidatesFor({ accessPath, account, upstream }) -> Candidate[]
 *   - catalogue.byAccessPath -> Map<accessPath, Candidate[]>
 *   - catalogue.byAccount -> Map<account, Candidate[]>
 *   - catalogue.byPathAndAccount -> Map<`${accessPath}::${account}`, Candidate[]>
 *   - catalogue.byKey -> Map<key, Candidate>
 *   - catalogue.candidates -> Candidate[]
 *
 * RESULT STATE RULES:
 *   1. Exactly PASS, FAIL, DEFERRED, UNTESTED are result states.
 *   2. Nothing without evidence becomes PASS. Candidates without probe evidence are UNTESTED.
 *   3. PROBE_INVALID rows (client parser empty SSE, ENOENT shim spawn) do not count as model failures.
 *   4. Imported ALIVE-with-401 or 400 rows are recorded as FAIL with the real HTTP status.
 */

const fs = require('fs');
const path = require('path');
const { candidateKey, parseCandidateKey, modelBase } = require('./identity');
const { readCatalogue, currentState } = require('./store');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'discovery');

/**
 * Normalise a candidate record to ensure full 7-part identity.
 */
function normalizeCandidateIdentity(cand) {
  const account = cand.account === null || cand.account === undefined ? '' : String(cand.account).trim();
  const quotaScope = cand.quotaScope === null || cand.quotaScope === undefined ? '' : String(cand.quotaScope).trim();
  const harness = cand.harness || 'http';
  const accessPath = cand.accessPath || '9router';
  const gateway = cand.gateway || '';
  const upstream = cand.upstream || '';
  const modelId = cand.modelId || '';
  const identity = { harness, accessPath, gateway, upstream, account, quotaScope, modelId };
  const key = candidateKey(identity);
  return {
    ...cand,
    harness,
    accessPath,
    gateway,
    upstream,
    account,
    quotaScope,
    modelId,
    key,
  };
}

/**
 * Read the discovery catalogue with combined evidence states.
 *
 * @param {object} [opts] Options:
 *   - {string} [dataDir] Base discovery data dir
 *   - {string} [catalogueFile] Path to catalogue.jsonl
 *   - {string} [importsDir] Path to imports dir
 *   - {Array} [lines] In-memory catalogue transition records
 *   - {Array} [imports] In-memory import objects
 *   - {Array} [evidence] In-memory candidate evidence records
 *   - {Function} [filter] Optional filter predicate (candidate) => boolean
 *   - {string} [accessPath] Filter by accessPath
 *   - {string} [account] Filter by account
 * @returns {object} Catalogue view object
 */
function readDiscoveryCatalogue(opts) {
  const o = opts || {};
  const dataDir = o.dataDir || DEFAULT_DATA_DIR;
  const catalogueFile = o.catalogueFile || path.join(dataDir, 'catalogue.jsonl');
  const importsDir = o.importsDir || path.join(dataDir, 'imports');

  // 1. Load catalogue lines (from memory or file)
  const isFixtureMode = Boolean(Array.isArray(o.lines) || Array.isArray(o.imports) || Array.isArray(o.evidence));
  let rawLines = [];
  if (Array.isArray(o.lines)) {
    rawLines = o.lines;
  } else if (!isFixtureMode && fs.existsSync(catalogueFile)) {
    rawLines = readCatalogue(catalogueFile);
  }

  // Normalize lines to 7-part keys
  const normalizedLines = [];
  for (const raw of rawLines) {
    if (!raw || raw.malformed) continue;
    const parsedKey = parseCandidateKey(raw.key);
    const cand = {
      ...raw,
      harness: raw.harness || (parsedKey && parsedKey.harness) || 'http',
      accessPath: raw.accessPath || (parsedKey && parsedKey.accessPath) || '9router',
      gateway: raw.gateway || (parsedKey && parsedKey.gateway) || '',
      upstream: raw.upstream || (parsedKey && parsedKey.upstream) || '',
      account: raw.account !== undefined ? raw.account : (parsedKey && parsedKey.account) || '',
      quotaScope: raw.quotaScope !== undefined ? raw.quotaScope : (parsedKey && parsedKey.quotaScope) || '',
      modelId: raw.modelId || (parsedKey && parsedKey.modelId) || '',
    };
    normalizedLines.push(normalizeCandidateIdentity(cand));
  }

  const currentFromLedger = currentState(normalizedLines);

  // 2. Load Evidence (from memory or imports directory)
  const evidenceByKey = new Map();

  function ingestCandidateEvidence(c) {
    if (!c) return;
    const parsedKey = c.key ? parseCandidateKey(c.key) : null;
    const harness = c.harness || (parsedKey && parsedKey.harness) || 'http';
    const accessPath = c.accessPath || (parsedKey && parsedKey.accessPath) || '9router';
    const gateway = c.gateway || (parsedKey && parsedKey.gateway) || '';
    const upstream = c.upstream || (parsedKey && parsedKey.upstream) || '';
    const account = c.account !== undefined ? c.account : (parsedKey && parsedKey.account) || '';
    const quotaScope = c.quotaScope !== undefined ? c.quotaScope : (parsedKey && parsedKey.quotaScope) || '';
    const modelId = c.modelId || (parsedKey && parsedKey.modelId) || '';

    const key =
      c.key && parseCandidateKey(c.key)
        ? candidateKey({ harness, accessPath, gateway, upstream, account, quotaScope, modelId })
        : candidateKey({ harness, accessPath, gateway, upstream, account, quotaScope, modelId });

    const existing = evidenceByKey.get(key);
    if (!existing) {
      evidenceByKey.set(key, {
        ...c,
        harness,
        accessPath,
        gateway,
        upstream,
        account,
        quotaScope,
        modelId,
        key,
      });
    } else {
      existing.passes = (existing.passes || 0) + (c.passes || 0);
      existing.probeInvalid = (existing.probeInvalid || 0) + (c.probeInvalid || 0);
      if (Array.isArray(c.failures)) {
        existing.failures = (existing.failures || []).concat(c.failures);
      }
      if (Array.isArray(c.evidence)) {
        existing.evidence = (existing.evidence || []).concat(c.evidence);
      }
      if (c.resultState && c.resultState !== 'UNTESTED') {
        existing.resultState = c.resultState;
      }
    }
  }

  if (Array.isArray(o.evidence)) {
    for (const ev of o.evidence) {
      ingestCandidateEvidence(ev);
    }
  }

  if (Array.isArray(o.imports)) {
    for (const entry of o.imports) {
      if (entry && Array.isArray(entry.candidates)) {
        for (const c of entry.candidates) ingestCandidateEvidence(c);
      }
    }
  } else if (!isFixtureMode && fs.existsSync(importsDir)) {
    try {
      const files = fs.readdirSync(importsDir).filter((f) => f.endsWith('.json'));
      // Sort newest first
      files.sort().reverse();
      for (const file of files) {
        if (!file.startsWith('checkpoint-')) continue;
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(importsDir, file), 'utf8'));
          if (entry && Array.isArray(entry.candidates)) {
            for (const c of entry.candidates) ingestCandidateEvidence(c);
          }
        } catch (_) {
          // ignore corrupted import file
        }
      }
    } catch (_) {
      // ignore readdir error
    }
  }

  // 3. Assemble complete candidates list
  const candidatesMap = new Map();

  // Add ledger candidates
  for (const [key, ledgerRec] of currentFromLedger) {
    const ev = evidenceByKey.get(key);
    let passes = 0;
    let failures = [];
    let probeInvalid = 0;
    let evidenceList = [];
    let resultState = 'UNTESTED';
    let firstSeen = ledgerRec.ts || null;
    let lastSeen = ledgerRec.ts || null;
    let attempts = 0;

    if (ev) {
      passes = ev.passes || 0;
      failures = ev.failures || [];
      probeInvalid = ev.probeInvalid || 0;
      evidenceList = ev.evidence || [];
      firstSeen = ev.firstSeen || firstSeen;
      lastSeen = ev.lastSeen || lastSeen;
      attempts = ev.attempts || passes + failures.length + probeInvalid;

      if (ev.resultState) {
        resultState = ev.resultState;
      } else if (passes > 0) {
        resultState = 'PASS';
      } else if (failures.length > 0) {
        resultState = 'FAIL';
      } else if (ev.deferred > 0) {
        resultState = 'DEFERRED';
      } else {
        resultState = 'UNTESTED';
      }
    }

    const alive = (resultState === 'PASS' || ledgerRec.state === 'AVAILABLE') && resultState !== 'FAIL' && resultState !== 'UNTESTED';

    const candidate = {
      key,
      harness: ledgerRec.harness,
      accessPath: ledgerRec.accessPath,
      gateway: ledgerRec.gateway,
      upstream: ledgerRec.upstream,
      account: ledgerRec.account || '',
      quotaScope: ledgerRec.quotaScope || '',
      modelId: ledgerRec.modelId,
      base: ledgerRec.base || modelBase(ledgerRec.modelId),
      sourceIds: ledgerRec.sourceIds || [],
      state: ledgerRec.state || 'UNKNOWN',
      resultState,
      alive,
      isAlive: () => alive,
      passes,
      failures,
      probeInvalid,
      evidence: evidenceList,
      firstSeen,
      lastSeen,
      attempts,
    };
    candidatesMap.set(key, candidate);
  }

  // Also include candidates from imported evidence that had no prior ledger line
  for (const [key, ev] of evidenceByKey) {
    if (candidatesMap.has(key)) continue;
    const passes = ev.passes || 0;
    const failures = ev.failures || [];
    const probeInvalid = ev.probeInvalid || 0;
    const evidenceList = ev.evidence || [];
    let resultState = ev.resultState || 'UNTESTED';
    if (!ev.resultState) {
      if (passes > 0) resultState = 'PASS';
      else if (failures.length > 0) resultState = 'FAIL';
      else if (ev.deferred > 0) resultState = 'DEFERRED';
      else resultState = 'UNTESTED';
    }
    const alive = resultState === 'PASS';

    const candidate = {
      key,
      harness: ev.harness || 'http',
      accessPath: ev.accessPath || '9router',
      gateway: ev.gateway || '',
      upstream: ev.upstream || '',
      account: ev.account || '',
      quotaScope: ev.quotaScope || '',
      modelId: ev.modelId || '',
      base: ev.base || modelBase(ev.modelId),
      sourceIds: ev.sourceIds || [],
      state: 'UNKNOWN',
      resultState,
      alive,
      isAlive: () => alive,
      passes,
      failures,
      probeInvalid,
      evidence: evidenceList,
      firstSeen: ev.firstSeen || null,
      lastSeen: ev.lastSeen || null,
      attempts: ev.attempts || passes + failures.length + probeInvalid,
    };
    candidatesMap.set(key, candidate);
  }

  // 4. Index candidates per access path and per account
  const byKey = new Map();
  const byAccessPath = new Map();
  const byAccount = new Map();
  const byPathAndAccount = new Map();
  const allCandidates = [];

  for (const cand of candidatesMap.values()) {
    if (o.accessPath && cand.accessPath !== o.accessPath) continue;
    if (o.account !== undefined && cand.account !== o.account) continue;
    if (typeof o.filter === 'function' && !o.filter(cand)) continue;

    allCandidates.push(cand);
    byKey.set(cand.key, cand);

    // Index by accessPath
    if (!byAccessPath.has(cand.accessPath)) byAccessPath.set(cand.accessPath, []);
    byAccessPath.get(cand.accessPath).push(cand);

    // Index by account
    if (!byAccount.has(cand.account)) byAccount.set(cand.account, []);
    byAccount.get(cand.account).push(cand);

    // Index by path and account composite
    const pathAccountKey = `${cand.accessPath}::${cand.account}`;
    if (!byPathAndAccount.has(pathAccountKey)) byPathAndAccount.set(pathAccountKey, []);
    byPathAndAccount.get(pathAccountKey).push(cand);
  }

  // Helper find/query methods
  function getModel(accessPath, account, modelId) {
    if (!accessPath || modelId === undefined || modelId === null) return undefined;
    const targetAccount = account === null || account === undefined ? '' : String(account).trim();
    const targetId = String(modelId).trim();
    const group = byPathAndAccount.get(`${accessPath}::${targetAccount}`) || [];
    return group.find((c) => c.modelId === targetId);
  }

  function hasModel(accessPath, account, modelId) {
    return Boolean(getModel(accessPath, account, modelId));
  }

  function isModelPresent(query) {
    if (!query) return false;
    return hasModel(query.accessPath, query.account, query.modelId);
  }

  function isModelAlive(query) {
    if (!query) return false;
    const cand = getModel(query.accessPath, query.account, query.modelId);
    return Boolean(cand && cand.alive);
  }

  function candidatesFor(query) {
    const q = query || {};
    return allCandidates.filter((c) => {
      if (q.accessPath && c.accessPath !== q.accessPath) return false;
      if (q.account !== undefined && c.account !== q.account) return false;
      if (q.upstream && c.upstream !== q.upstream) return false;
      if (q.harness && c.harness !== q.harness) return false;
      if (q.resultState && c.resultState !== q.resultState) return false;
      if (q.alive !== undefined && c.alive !== q.alive) return false;
      return true;
    });
  }

  return {
    candidates: allCandidates,
    byKey,
    byAccessPath,
    byAccount,
    byPathAndAccount,
    get: (key) => byKey.get(key),
    getModel,
    hasModel,
    isModelPresent,
    isModelAlive,
    candidatesFor,
  };
}

module.exports = {
  readDiscoveryCatalogue,
  readCatalogue: readDiscoveryCatalogue,
  getCandidates: readDiscoveryCatalogue,
  readCandidates: readDiscoveryCatalogue,
  normalizeCandidateIdentity,
};
