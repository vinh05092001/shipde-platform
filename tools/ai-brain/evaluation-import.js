'use strict';

/**
 * TASK-AI-108 — import a model evaluation file into the evidence store.
 *
 * A model evaluation file (`shipde-model-evaluation/1`) records, for every
 * candidate the Controller probed, what actually happened: `ALIVE` with an
 * `API_PASS`, `QUOTA` with a reset hint, or one of the named failures. This
 * module is the only door that turns that file into evidence — it writes
 * through `evidence.js` (never a second store, never a new file format), and
 * it is deliberately conservative:
 *
 *   - an `ALIVE` candidate records `API_PASS` and nothing stronger; a higher
 *     proof level already on the combination is never lowered;
 *   - a `QUOTA` candidate sets or refreshes a cooldown, using the explicit
 *     `resetAt` when present and the failure-classifier default otherwise;
 *   - re-importing the same file changes nothing (idempotent);
 *   - a malformed file is refused whole with a named error and nothing is
 *     written, so a partial import can never leave the store half-updated.
 */

const fs = require('fs');
const evidence = require('./evidence');
const { Cause, DEFAULT_COOLDOWNS } = require('./failure-classifier');

const SCHEMA_ID = 'shipde-model-evaluation/1';
const SOURCE = 'model-evaluation';
const SEPARATOR = '::';

const PROOF_RANK = {
  [evidence.ProofLevel.API_PASS]: 1,
  [evidence.ProofLevel.HARNESS_PASS]: 2,
  [evidence.ProofLevel.WORK_ITEM_PASS]: 3,
};

/** Named refusal with a stable machine-readable code. */
class ModelEvaluationImportError extends Error {
  constructor(code, message) {
    super(message ? code + ': ' + message : code);
    this.name = 'ModelEvaluationImportError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new ModelEvaluationImportError(code, message);
}

function readDoc(input) {
  if (input && input.doc && typeof input.doc === 'object') return input.doc;
  const file = input && input.file;
  if (typeof file !== 'string' || file.trim() === '') {
    reject('INPUT_UNREADABLE', 'no evaluation file given');
  }
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    reject('INPUT_UNREADABLE', String((err && err.message) || err));
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    reject('INPUT_UNREADABLE', 'cannot parse JSON: ' + String((err && err.message) || err));
  }
}

/** Full-file validation. Runs to completion before a single byte is written. */
function validateDoc(doc) {
  if (!doc || typeof doc !== 'object' || doc.schema !== SCHEMA_ID) {
    reject('SCHEMA_INVALID', 'expected schema "' + SCHEMA_ID + '"');
  }
  if (!Array.isArray(doc.candidates)) {
    reject('CANDIDATES_INVALID', 'candidates must be an array');
  }
  for (const cand of doc.candidates) {
    const key = cand && cand.candidateKey;
    if (typeof key !== 'string' || key.split(SEPARATOR).length !== 7) {
      reject('CANDIDATE_KEY_INVALID', 'candidateKey must have 7 parts: ' + String(key));
    }
    const proofLevel = cand.proofLevel;
    if (proofLevel !== null && proofLevel !== undefined && proofLevel !== '') {
      const rank = PROOF_RANK[proofLevel];
      if (rank === undefined || rank > PROOF_RANK[evidence.ProofLevel.API_PASS]) {
        reject('PROOF_LEVEL_TOO_HIGH', 'proofLevel ' + proofLevel + ' exceeds API_PASS');
      }
    }
    if (cand.status === 'ALIVE' && proofLevel !== evidence.ProofLevel.API_PASS) {
      reject('ALIVE_WITHOUT_API_PASS', 'ALIVE candidate requires API_PASS');
    }
  }
}

/** Build the 7-part identity from a candidateKey. */
function identityFromKey(key) {
  const parts = key.split(SEPARATOR);
  return {
    harness: parts[0],
    accessPath: parts[1],
    gateway: parts[2],
    upstream: parts[3],
    accountId: parts[4],
    quotaScope: parts[5],
    modelId: parts[6],
  };
}

function parseCallContract(text) {
  const value = String(text);
  const contract = { notes: [value] };
  const omit = /omit\s+([A-Za-z0-9_.:-]+(?:\s*,\s*[A-Za-z0-9_.:-]+)*)/i.exec(value);
  if (omit) {
    contract.omitParams = omit[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const concurrency = /concurrency\s*<=\s*(\d+)/i.exec(value);
  if (concurrency) contract.maxConcurrency = parseInt(concurrency[1], 10);
  return contract;
}

/** Cause of a QUOTA candidate: explicit cooldown entry first, then quota state. */
function quotaCause(candidate, contractEntry) {
  if (contractEntry && contractEntry.cause) return contractEntry.cause;
  const state = candidate.quota && candidate.quota.state;
  if (state === 'RATE_LIMITED') return Cause.UPSTREAM_RATE_LIMIT;
  if (state === 'EXHAUSTED') return Cause.QUOTA_EXHAUSTED;
  return Cause.UNKNOWN;
}

function buildCooldown(candidate, key, contractEntry) {
  const cause = quotaCause(candidate, contractEntry);
  const defaultMs = DEFAULT_COOLDOWNS[cause];
  const cooldownMs =
    contractEntry && typeof contractEntry.cooldownMs === 'number'
      ? contractEntry.cooldownMs
      : defaultMs === undefined
        ? null
        : defaultMs;
  const resetAtText = candidate.quota && candidate.quota.resetAt;
  let resetTime = null;
  if (resetAtText !== null && resetAtText !== undefined && resetAtText !== '') {
    const parsed = Date.parse(resetAtText);
    if (Number.isFinite(parsed)) resetTime = parsed;
  }
  const identity = identityFromKey(key);
  return {
    lastStatus: 'blocked',
    blockedAt: candidate.observedAt || null,
    blockReason: cause,
    cause,
    scope: (candidate.quota && candidate.quota.scope) || null,
    cooldownMs,
    resetTime,
    humanAction: 'none',
    offeringId: key,
    harness: identity.harness,
    accessPath: identity.accessPath,
    gateway: identity.gateway,
    upstream: identity.upstream,
    accountId: identity.accountId,
    quotaScope: identity.quotaScope,
    modelId: identity.modelId,
  };
}

function hasAliveEvidence(data, candidate, observedAt) {
  const combo = evidence.findCombo(data, candidate);
  if (!combo) return false;
  return (combo.evidence || []).some(
    (item) =>
      item &&
      item.source === SOURCE &&
      item.proofLevel === evidence.ProofLevel.API_PASS &&
      item.observedAt === observedAt
  );
}

function isAliveSkipped(data, candidate, observedAt) {
  const combo = evidence.findCombo(data, candidate);
  if (!combo) return false;
  if (hasAliveEvidence(data, candidate, observedAt)) return true;
  const existing = evidence.proofLevelOf(combo.evidence);
  return existing !== null && PROOF_RANK[existing] > PROOF_RANK[evidence.ProofLevel.API_PASS];
}

/**
 * Import an evaluation file into the evidence store.
 *
 * Accepts either `{ file }` (read from disk) or `{ doc }` (already parsed).
 * Returns `{ importedAlive, cooldownsSet, skipped, rejected, counts }`; the
 * `counts` object is the shape the CLI prints. `rejected` is always empty on
 * success — malformed input throws instead.
 */
function importEvaluation(input) {
  const opts = input || {};
  const doc = readDoc(opts);
  validateDoc(doc);

  const dir = opts.evidenceDir;
  const dryRun = Boolean(opts.dryRun);

  const alivePlans = [];
  const quotaPlans = [];
  let skipped = 0;

  const contractEntries = (doc && doc.cooldowns) || {};
  const working = dryRun ? null : evidence.loadEvidence(dir);

  for (const candidate of doc.candidates) {
    const key = candidate.candidateKey;
    const identity = identityFromKey(key);
    const status = candidate.status;

    if (status === 'ALIVE') {
      if (working && isAliveSkipped(working, identity, candidate.observedAt)) {
        skipped += 1;
        continue;
      }
      const plan = {
        candidate: identity,
        item: {
          level: evidence.Level.API,
          proofLevel: evidence.ProofLevel.API_PASS,
          status: 'passed',
          source: SOURCE,
          observedAt: candidate.observedAt || null,
        },
        contract: candidate.callContract ? parseCallContract(candidate.callContract) : null,
      };
      alivePlans.push(plan);
      continue;
    }

    if (status === 'QUOTA') {
      const entry = contractEntries[key];
      const record = buildCooldown(candidate, key, entry);
      if (working) {
        const existing = working.cooldowns && working.cooldowns[key];
        if (existing) {
          const existingAt = Date.parse(existing.blockedAt);
          const observedAt = Date.parse(candidate.observedAt);
          const newer =
            Number.isFinite(observedAt) && Number.isFinite(existingAt)
              ? observedAt > existingAt
              : false;
          if (!newer) {
            skipped += 1;
            continue;
          }
        }
      }
      quotaPlans.push({ key, record });
      continue;
    }

    skipped += 1;
  }

  const importedAlive = alivePlans.length;
  const cooldownsSet = quotaPlans.length;

  if (!dryRun && (alivePlans.length > 0 || quotaPlans.length > 0)) {
    for (const plan of alivePlans) {
      evidence.recordProbe(dir, plan.candidate, plan.item);
    }
    const data = evidence.loadEvidence(dir);
    for (const plan of alivePlans) {
      if (!plan.contract) continue;
      const combo = evidence.findCombo(data, plan.candidate);
      if (combo) combo.callContract = plan.contract;
    }
    if (!data.cooldowns) data.cooldowns = {};
    for (const plan of quotaPlans) {
      data.cooldowns[plan.key] = plan.record;
    }
    evidence.saveEvidence(dir, data);
  }

  const counts = { importedAlive, cooldownsSet, skipped, rejected: 0 };
  return {
    importedAlive: counts.importedAlive,
    cooldownsSet: counts.cooldownsSet,
    skipped: counts.skipped,
    rejected: [],
    counts,
    dryRun,
  };
}

module.exports = {
  SCHEMA_ID,
  SOURCE,
  ModelEvaluationImportError,
  importEvaluation,
};
