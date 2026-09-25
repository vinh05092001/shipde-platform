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

const STATUS_RANK = {
  UNTESTED: 0,
  PASS: 1,
  ALIVE: 1,
  DEFERRED: 2,
  FAIL: 3,
};

function statusRank(s) {
  const norm = String(s || '').toUpperCase();
  return STATUS_RANK[norm] !== undefined ? STATUS_RANK[norm] : -1;
}

/**
 * Canonical evidence signature string for deduplication and total ordering.
 * Captures all distinguishing attributes: timestamp, status, reason, errorClass,
 * httpStatus, latencyMs, exitCode, source, route, probe, and identification fields.
 */
function getProducer(e) {
  if (!e || typeof e !== 'object') return '';
  return String(e.producer || e.source || e.sourceId || e.runId || '').trim();
}

/**
 * Returns true only if event a is provably newer than event b.
 * - timestamp is the primary time axis;
 * - sequence is comparable ONLY within the same producer;
 * - otherwise, order cannot be proven.
 */
function isProvablyNewer(a, b) {
  if (!a || !b) return false;
  const ta = a.ts || a.timestamp || '';
  const tb = b.ts || b.timestamp || '';
  if (ta > tb) return true;
  if (ta < tb) return false;

  const prodA = getProducer(a);
  const prodB = getProducer(b);
  if (!prodA || !prodB || prodA !== prodB) {
    return false;
  }

  const hasSeqA = a.sequence !== undefined || a.seq !== undefined;
  const hasSeqB = b.sequence !== undefined || b.seq !== undefined;
  if (!hasSeqA || !hasSeqB) return false;
  const seqA = Number(a.sequence !== undefined ? a.sequence : a.seq);
  const seqB = Number(b.sequence !== undefined ? b.sequence : b.seq);
  return seqA > seqB;
}

/**
 * Canonical evidence signature string for deduplication and total ordering.
 * Captures all distinguishing attributes: timestamp, status, reason, errorClass,
 * httpStatus, latencyMs, exitCode, producer, source, runId, route, probe, and identification fields.
 */
function canonicalEvidenceSignature(e) {
  if (!e || typeof e !== 'object') return String(e || '');
  return JSON.stringify({
    ts: e.ts || e.timestamp || '',
    status: String(e.status || '').toUpperCase(),
    reason: e.reason || '',
    errorClass: e.errorClass || '',
    httpStatus: e.httpStatus !== undefined && e.httpStatus !== null ? e.httpStatus : '',
    latencyMs: e.latencyMs !== undefined && e.latencyMs !== null ? e.latencyMs : '',
    exitCode: e.exitCode !== undefined && e.exitCode !== null ? e.exitCode : '',
    producer: e.producer || '',
    source: e.source || e.sourceId || '',
    runId: e.runId || '',
    route: e.route || '',
    levelName: e.levelName || '',
    probeName: e.probeName || '',
    error: e.error || '',
    eventId: e.eventId || e.id || '',
    sequence: e.sequence !== undefined ? e.sequence : e.seq !== undefined ? e.seq : '',
  });
}

/**
 * TOTAL ordering comparator for evidence events.
 * Explicit precedence:
 * 1. Timestamp (ts) ascending (primary time axis)
 * 2. Sequence (sequence/seq) ascending ONLY within the same producer (never across producers)
 * 3. Status rank fail-closed: UNTESTED: 0 < PASS: 1 < DEFERRED: 2 < FAIL: 3
 *    (when PASS and FAIL or DEFERRED share an instant and it cannot be PROVEN which came later,
 *     eligibility FAILS CLOSED - worse status sorts later so it becomes latest resultState)
 * 4. Stable tie-breaks only (must never cause evidence to be lost or fail-open):
 *    - Event ID (eventId/id) ascending
 *    - Source (source/sourceId) ascending
 *    - Canonical signature string comparison (deterministic fallback)
 */
function compareEvidenceTotalOrder(a, b) {
  const ta = a.ts || a.timestamp || '';
  const tb = b.ts || b.timestamp || '';
  const c = ta.localeCompare(tb);
  if (c !== 0) return c;

  const prodA = getProducer(a);
  const prodB = getProducer(b);
  const sameProducer = Boolean(prodA && prodB && prodA === prodB);

  if (sameProducer) {
    const hasSeqA = a.sequence !== undefined || a.seq !== undefined;
    const hasSeqB = b.sequence !== undefined || b.seq !== undefined;
    if (hasSeqA && hasSeqB) {
      const seqA = Number(a.sequence !== undefined ? a.sequence : a.seq);
      const seqB = Number(b.sequence !== undefined ? b.sequence : b.seq);
      if (seqA !== seqB) return seqA - seqB;
    }
  }

  const s = statusRank(a.status) - statusRank(b.status);
  if (s !== 0) return s;

  const idA = String(a.eventId || a.id || '');
  const idB = String(b.eventId || b.id || '');
  const idCmp = idA.localeCompare(idB);
  if (idCmp !== 0) return idCmp;

  const srcA = String(a.source || a.sourceId || '');
  const srcB = String(b.source || b.sourceId || '');
  const srcCmp = srcA.localeCompare(srcB);
  if (srcCmp !== 0) return srcCmp;

  return canonicalEvidenceSignature(a).localeCompare(canonicalEvidenceSignature(b));
}

/**
 * Candidate summary signature to ensure idempotent ingestion across duplicate imports.
 */
function candidateSummarySignature(c) {
  if (!c || typeof c !== 'object') return '';
  return JSON.stringify({
    key: c.key || '',
    firstSeen: c.firstSeen || '',
    lastSeen: c.lastSeen || '',
    passes: c.passes !== undefined ? c.passes : '',
    attempts: c.attempts !== undefined ? c.attempts : '',
    deferred: c.deferred !== undefined ? c.deferred : '',
    resultState: c.resultState || '',
    failures: Array.isArray(c.failures) ? c.failures.map(canonicalEvidenceSignature) : [],
    evidence: Array.isArray(c.evidence) ? c.evidence.map(canonicalEvidenceSignature) : [],
  });
}

/**
 * Normalise a candidate record to ensure full 7-part identity.
 */
function normalizeCandidateIdentity(cand) {
  const account =
    cand.account === null || cand.account === undefined ? '' : String(cand.account).trim();
  const quotaScope =
    cand.quotaScope === null || cand.quotaScope === undefined ? '' : String(cand.quotaScope).trim();
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
  const isFixtureMode = Boolean(
    Array.isArray(o.lines) || Array.isArray(o.imports) || Array.isArray(o.evidence)
  );
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
      quotaScope:
        raw.quotaScope !== undefined ? raw.quotaScope : (parsedKey && parsedKey.quotaScope) || '',
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
    const quotaScope =
      c.quotaScope !== undefined ? c.quotaScope : (parsedKey && parsedKey.quotaScope) || '';
    const modelId = c.modelId || (parsedKey && parsedKey.modelId) || '';

    const key =
      c.key && parseCandidateKey(c.key)
        ? candidateKey({ harness, accessPath, gateway, upstream, account, quotaScope, modelId })
        : candidateKey({ harness, accessPath, gateway, upstream, account, quotaScope, modelId });

    const existing = evidenceByKey.get(key);
    const cAttempts =
      c.attempts !== undefined
        ? c.attempts
        : (c.passes || 0) +
          (Array.isArray(c.failures) ? c.failures.length : 0) +
          (c.deferred || 0) +
          (c.probeInvalid || 0);

    const candSig = candidateSummarySignature(c);

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
        passes: c.passes || 0,
        deferred: c.deferred || 0,
        probeInvalid: c.probeInvalid || 0,
        attempts: cAttempts,
        failures: Array.isArray(c.failures) ? [...c.failures] : [],
        evidence: Array.isArray(c.evidence) ? [...c.evidence] : [],
        firstSeen: c.firstSeen || null,
        lastSeen: c.lastSeen || null,
        seenSummaries: new Set([candSig]),
        _snapshots: [
          {
            passes: c.passes || 0,
            failures: Array.isArray(c.failures) ? [...c.failures] : [],
            deferred: c.deferred || 0,
            resultState: c.resultState,
            firstSeen: c.firstSeen,
            lastSeen: c.lastSeen,
            evidence: Array.isArray(c.evidence) ? [...c.evidence] : [],
          },
        ],
      });
    } else {
      if (existing.seenSummaries && existing.seenSummaries.has(candSig)) {
        // True duplicate candidate summary imported a second time is idempotent
        return;
      }
      if (existing.seenSummaries) {
        existing.seenSummaries.add(candSig);
      }

      existing.passes = (existing.passes || 0) + (c.passes || 0);
      existing.deferred = (existing.deferred || 0) + (c.deferred || 0);
      existing.probeInvalid = (existing.probeInvalid || 0) + (c.probeInvalid || 0);
      existing.attempts = (existing.attempts || 0) + cAttempts;

      if (c.firstSeen) {
        if (!existing.firstSeen || c.firstSeen < existing.firstSeen)
          existing.firstSeen = c.firstSeen;
      }
      if (c.lastSeen) {
        if (!existing.lastSeen || c.lastSeen > existing.lastSeen) existing.lastSeen = c.lastSeen;
      }

      if (Array.isArray(c.failures)) {
        const seenFailures = new Set(existing.failures.map(canonicalEvidenceSignature));
        for (const f of c.failures) {
          const sig = canonicalEvidenceSignature(f);
          if (!seenFailures.has(sig)) {
            seenFailures.add(sig);
            existing.failures.push(f);
          }
        }
      }

      if (Array.isArray(c.evidence)) {
        const seenEvidence = new Set(existing.evidence.map(canonicalEvidenceSignature));
        for (const e of c.evidence) {
          const sig = canonicalEvidenceSignature(e);
          if (!seenEvidence.has(sig)) {
            seenEvidence.add(sig);
            existing.evidence.push(e);
          }
        }
      }

      existing._snapshots.push({
        passes: c.passes || 0,
        failures: Array.isArray(c.failures) ? [...c.failures] : [],
        deferred: c.deferred || 0,
        resultState: c.resultState,
        firstSeen: c.firstSeen,
        lastSeen: c.lastSeen,
        evidence: Array.isArray(c.evidence) ? [...c.evidence] : [],
      });
    }
  }

  if (Array.isArray(o.evidence)) {
    for (const ev of o.evidence) {
      ingestCandidateEvidence(ev);
    }
  }

  const seenImportSources = new Set();
  if (Array.isArray(o.imports)) {
    for (const entry of o.imports) {
      if (entry && Array.isArray(entry.candidates)) {
        if (entry.importedFrom) {
          if (seenImportSources.has(entry.importedFrom)) continue;
          seenImportSources.add(entry.importedFrom);
        }
        for (const c of entry.candidates) ingestCandidateEvidence(c);
      }
    }
  } else if (!isFixtureMode && fs.existsSync(importsDir)) {
    try {
      const files = fs.readdirSync(importsDir).filter((f) => f.endsWith('.json'));
      // Sort deterministic
      files.sort();
      for (const file of files) {
        if (!file.startsWith('checkpoint-')) continue;
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(importsDir, file), 'utf8'));
          if (entry && Array.isArray(entry.candidates)) {
            if (entry.importedFrom) {
              if (seenImportSources.has(entry.importedFrom)) continue;
              seenImportSources.add(entry.importedFrom);
            }
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

  function resolveState(ev, ledgerRec) {
    let passes = 0;
    let failures = [];
    let deferred = 0;
    let probeInvalid = 0;
    let evidenceList = [];
    let firstSeen = (ledgerRec && ledgerRec.ts) || null;
    let lastSeen = (ledgerRec && ledgerRec.ts) || null;
    let attempts = 0;

    if (ev) {
      passes = ev.passes || 0;
      failures = Array.isArray(ev.failures) ? ev.failures : [];
      deferred = ev.deferred || 0;
      probeInvalid = ev.probeInvalid || 0;
      evidenceList = Array.isArray(ev.evidence) ? ev.evidence : [];
      firstSeen = ev.firstSeen || firstSeen;
      lastSeen = ev.lastSeen || lastSeen;
      attempts =
        ev.attempts !== undefined
          ? ev.attempts
          : passes + failures.length + deferred + probeInvalid;
    }

    const sortedEvidence = [...evidenceList]
      .filter((e) => e && e.status)
      .sort(compareEvidenceTotalOrder);

    const sortedFailures = [...failures].sort(compareEvidenceTotalOrder);

    for (const e of sortedEvidence) {
      if (e.ts) {
        if (!firstSeen || e.ts < firstSeen) firstSeen = e.ts;
        if (!lastSeen || e.ts > lastSeen) lastSeen = e.ts;
      }
    }

    let resultState = 'UNTESTED';

    if (sortedEvidence.length > 0) {
      const latest = sortedEvidence[sortedEvidence.length - 1];
      const s = String(latest.status).toUpperCase();
      if (s === 'PASS') {
        resultState = passes > 0 ? 'PASS' : 'UNTESTED';
      } else if (s === 'FAIL') {
        resultState = 'FAIL';
      } else if (s === 'DEFERRED') {
        resultState = 'DEFERRED';
      }
    } else if (ev && Array.isArray(ev._snapshots) && ev._snapshots.length > 0) {
      const validSnapshots = ev._snapshots.filter(
        (s) => s && s.resultState && s.resultState !== 'UNTESTED'
      );
      if (validSnapshots.length > 0) {
        validSnapshots.sort((a, b) => {
          const ta = a.lastSeen || a.firstSeen || '';
          const tb = b.lastSeen || b.firstSeen || '';
          const c = ta.localeCompare(tb);
          if (c !== 0) return c;
          return statusRank(a.resultState) - statusRank(b.resultState);
        });
        const latestSnap = validSnapshots[validSnapshots.length - 1];
        const s = String(latestSnap.resultState).toUpperCase();
        if ((s === 'PASS' || s === 'ALIVE') && passes > 0) {
          resultState = 'PASS';
        } else if (s === 'FAIL') {
          resultState = 'FAIL';
        } else if (s === 'DEFERRED') {
          resultState = 'DEFERRED';
        } else {
          resultState = 'UNTESTED';
        }
      } else if (failures.length > 0) {
        resultState = 'FAIL';
      } else if (passes > 0) {
        resultState = 'PASS';
      } else if (deferred > 0) {
        resultState = 'DEFERRED';
      }
    } else if (failures.length > 0) {
      resultState = 'FAIL';
    } else if (passes > 0) {
      resultState = 'PASS';
    } else if (deferred > 0) {
      resultState = 'DEFERRED';
    }

    if (!['PASS', 'FAIL', 'DEFERRED', 'UNTESTED'].includes(resultState)) {
      resultState = 'UNTESTED';
    }

    if (passes === 0 && resultState === 'PASS') {
      resultState = 'UNTESTED';
    }

    let alive = false;
    if (resultState === 'PASS' && passes > 0) {
      const latestPass =
        sortedEvidence.length > 0
          ? sortedEvidence[sortedEvidence.length - 1]
          : { ts: lastSeen || firstSeen || '', status: 'PASS' };

      let allNegativeSuperseded = true;

      for (const f of sortedFailures) {
        if (!isProvablyNewer(latestPass, f)) {
          allNegativeSuperseded = false;
          break;
        }
      }

      if (allNegativeSuperseded) {
        for (const e of sortedEvidence) {
          const s = String(e.status).toUpperCase();
          if (s === 'FAIL' || s === 'DEFERRED') {
            if (!isProvablyNewer(latestPass, e)) {
              allNegativeSuperseded = false;
              break;
            }
          }
        }
      }

      if (allNegativeSuperseded && deferred > 0) {
        const deferredInEvidence = sortedEvidence.filter(
          (e) => String(e.status).toUpperCase() === 'DEFERRED'
        ).length;
        if (deferred > deferredInEvidence) {
          allNegativeSuperseded = false;
        }
      }

      alive = allNegativeSuperseded;
    }

    return {
      passes,
      failures: sortedFailures,
      deferred,
      probeInvalid,
      evidence: sortedEvidence,
      firstSeen,
      lastSeen,
      attempts,
      resultState,
      alive,
    };
  }

  // 3. Assemble complete candidates list
  const candidatesMap = new Map();

  // Add ledger candidates
  for (const [key, ledgerRec] of currentFromLedger) {
    const ev = evidenceByKey.get(key);
    const resolved = resolveState(ev, ledgerRec);

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
      resultState: resolved.resultState,
      alive: resolved.alive,
      isAlive: () => resolved.alive,
      passes: resolved.passes,
      failures: resolved.failures,
      deferred: resolved.deferred,
      probeInvalid: resolved.probeInvalid,
      evidence: resolved.evidence,
      firstSeen: resolved.firstSeen,
      lastSeen: resolved.lastSeen,
      attempts: resolved.attempts,
    };
    candidatesMap.set(key, candidate);
  }

  // Also include candidates from imported evidence that had no prior ledger line
  for (const [key, ev] of evidenceByKey) {
    if (candidatesMap.has(key)) continue;
    const resolved = resolveState(ev, null);

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
      resultState: resolved.resultState,
      alive: resolved.alive,
      isAlive: () => resolved.alive,
      passes: resolved.passes,
      failures: resolved.failures,
      deferred: resolved.deferred,
      probeInvalid: resolved.probeInvalid,
      evidence: resolved.evidence,
      firstSeen: resolved.firstSeen,
      lastSeen: resolved.lastSeen,
      attempts: resolved.attempts,
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
  function getModel(accessPathOrQuery, account, modelId, gatewayOrOpts, upstream, quotaScope) {
    let q = {};
    if (accessPathOrQuery && typeof accessPathOrQuery === 'object') {
      q = accessPathOrQuery;
    } else {
      q = {
        accessPath: accessPathOrQuery,
        account,
        modelId,
      };
      if (gatewayOrOpts && typeof gatewayOrOpts === 'object') {
        Object.assign(q, gatewayOrOpts);
      } else {
        if (gatewayOrOpts !== undefined) q.gateway = gatewayOrOpts;
        if (upstream !== undefined) q.upstream = upstream;
        if (quotaScope !== undefined) q.quotaScope = quotaScope;
      }
    }
    if (!q.accessPath || q.modelId === undefined || q.modelId === null) return undefined;
    const targetAccount =
      q.account === null || q.account === undefined ? '' : String(q.account).trim();
    const targetId = String(q.modelId).trim();
    const group = byPathAndAccount.get(`${q.accessPath}::${targetAccount}`) || [];
    return group.find((c) => {
      if (c.modelId !== targetId) return false;
      if (q.gateway !== undefined && c.gateway !== q.gateway) return false;
      if (q.upstream !== undefined && c.upstream !== q.upstream) return false;
      if (q.quotaScope !== undefined && c.quotaScope !== q.quotaScope) return false;
      if (q.harness !== undefined && c.harness !== q.harness) return false;
      return true;
    });
  }

  function hasModel(accessPathOrQuery, account, modelId, gatewayOrOpts, upstream, quotaScope) {
    return Boolean(
      getModel(accessPathOrQuery, account, modelId, gatewayOrOpts, upstream, quotaScope)
    );
  }

  function isModelPresent(query) {
    if (!query) return false;
    return Boolean(getModel(query));
  }

  function isModelAlive(query) {
    if (!query) return false;
    const cand = getModel(query);
    return Boolean(cand && cand.alive);
  }

  function candidatesFor(query) {
    const q = query || {};
    return allCandidates.filter((c) => {
      if (q.accessPath && c.accessPath !== q.accessPath) return false;
      if (q.account !== undefined && c.account !== q.account) return false;
      if (q.quotaScope !== undefined && c.quotaScope !== q.quotaScope) return false;
      if (q.gateway && c.gateway !== q.gateway) return false;
      if (q.upstream && c.upstream !== q.upstream) return false;
      if (q.harness && c.harness !== q.harness) return false;
      if (q.modelId && c.modelId !== q.modelId) return false;
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
