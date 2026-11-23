'use strict';

/**
 * Ship Dễ — AGY Pool candidate discovery & per-model deduplication (WI-A1).
 *
 * Config-driven, zero-hardcode & fail-closed:
 * - Thresholds (`minHeadroom`, `openHeadroom`) come from `registry.dispatch.agyPool`.
 * - Bucket identifiers and model names are derived dynamically from live `/quota`
 *   group metadata (`group.name`, `group.description`, `group.buckets[].id`) and
 *   normalized via `priors-read.normaliseModelId`.
 * - When `agyPool` config is absent or invalid, returns [] (fail-closed).
 */

const fs = require('fs');
const path = require('path');
const agyPoolRuntime = require('./agy-pool-runtime');
const priorsRead = require('./priors-read');
const { candidateKey } = require('./discovery/identity');

function resolveAgyPoolConfig(options = {}) {
  const cfg =
    options.agyPoolConfig ||
    (options.registry && options.registry.dispatch && options.registry.dispatch.agyPool) ||
    null;
  if (!cfg || typeof cfg !== 'object') return null;
  const minHeadroom = Number(cfg.minHeadroom);
  const openHeadroom = Number(cfg.openHeadroom);
  if (
    !Number.isFinite(minHeadroom) ||
    minHeadroom < 0 ||
    !Number.isFinite(openHeadroom) ||
    openHeadroom < minHeadroom
  ) {
    return null;
  }
  return { minHeadroom, openHeadroom };
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive a neutral quota bucket key from the live group's bucket ID or name
 * without hardcoding vendor/model strings.
 */
function bucketKeyFromGroup(group) {
  const buckets = Array.isArray(group && group.buckets) ? group.buckets : [];
  for (const b of buckets) {
    if (b && typeof b.id === 'string' && b.id.trim()) {
      const stripped = b.id
        .trim()
        .toLowerCase()
        .replace(/-(?:weekly|5h|daily|session)$/i, '');
      if (stripped) return stripped;
    }
  }
  const nameSlug = slugify(group && group.name);
  return nameSlug || null;
}

/**
 * Extract normalized model IDs from live `/quota` group description
 * ("Models within this group: ...") or from the group name itself when the
 * group represents a dedicated single-model quota bucket.
 */
function modelsFromGroup(group) {
  const desc = String((group && group.description) || '');
  const m = /Models within this group:\s*([^\n]+)/i.exec(desc);
  const rawNames = m ? m[1].replace(/\.+$/, '').split(',') : [String((group && group.name) || '')];
  const out = [];
  for (const raw of rawNames) {
    const trimmed = raw.trim();
    if (!trimmed || /^orchestrator\b/i.test(trimmed)) continue;
    const norm = priorsRead.normaliseModelId(trimmed) || slugify(trimmed);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

function minBucketRemaining(group) {
  const buckets = Array.isArray(group && group.buckets) ? group.buckets : [];
  if (buckets.length === 0) return null;
  let minVal = null;
  for (const b of buckets) {
    const f = Number(b && b.remaining_fraction);
    if (!Number.isFinite(f)) return null;
    if (minVal === null || f < minVal) minVal = f;
  }
  return minVal;
}

function readAccountQuotaGroups(accountId, options = {}) {
  if (options.quotaSnapshots && options.quotaSnapshots[accountId]) {
    const snap = options.quotaSnapshots[accountId];
    if (Array.isArray(snap.groups)) return snap.groups;
    const nested = snap.command?.data?.groups;
    return Array.isArray(nested) ? nested : [];
  }
  const dir = agyPoolRuntime.accountDir(accountId, options);
  const quotaFile = path.join(dir, 'quota-out.txt');
  try {
    if (!fs.existsSync(quotaFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(quotaFile, 'utf8').replace(/^\uFEFF/, ''));
    const groups = parsed?.command?.data?.groups;
    return Array.isArray(groups) ? groups : [];
  } catch {
    return [];
  }
}

/**
 * Discover eligible AGY pool models deduplicated by model ID.
 * Fails closed (returns []) when `agyPool` config is absent or invalid.
 */
function discoverAgyPoolMembers(options = {}) {
  const cfg = resolveAgyPoolConfig(options);
  if (!cfg) return [];

  const accountIds = Array.isArray(options.accounts)
    ? options.accounts.slice().sort()
    : options.quotaSnapshots
      ? Object.keys(options.quotaSnapshots).sort()
      : agyPoolRuntime.discoverAccounts(options);

  const byModel = new Map();

  for (const accountId of accountIds) {
    const groups = readAccountQuotaGroups(accountId, options);
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      const bucket = bucketKeyFromGroup(group);
      if (!bucket) continue;
      const remaining = minBucketRemaining(group);
      if (remaining === null || remaining < cfg.minHeadroom) continue;
      const status = remaining >= cfg.openHeadroom ? 'open' : 'tight';
      const models = modelsFromGroup(group);
      for (const bareModel of models) {
        const modelId = `agy-pool/${bareModel}`;
        if (!byModel.has(modelId)) {
          byModel.set(modelId, {
            modelId,
            bareModel,
            lane: 'agy-pool',
            bucket,
            eligibleAccounts: [],
          });
        }
        const entry = byModel.get(modelId);
        if (!entry.eligibleAccounts.some((a) => a.accountId === accountId)) {
          entry.eligibleAccounts.push({
            accountId,
            headroom: Math.round(remaining * 1000) / 1000,
            status,
            bucket,
          });
        }
      }
    }
  }

  const out = [];
  for (const entry of byModel.values()) {
    entry.eligibleAccounts.sort((a, b) => {
      if (b.headroom !== a.headroom) return b.headroom - a.headroom;
      return a.accountId.localeCompare(b.accountId);
    });
    const best = entry.eligibleAccounts[0];
    out.push({
      ...entry,
      accountId: best.accountId,
      headroom: best.headroom,
      headroomStatus: best.status,
      quotaScope: `${best.accountId}:${entry.bucket}`,
    });
  }

  return out.sort((a, b) => a.modelId.localeCompare(b.modelId));
}

function buildAgyMemberCandidate(member, options = {}) {
  if (!member || !member.bareModel || !member.accountId) {
    return { error: 'AGY_POOL_MEMBER_INVALID', candidate: null };
  }
  let modelFamily;
  if (typeof options.modelFamilyOf === 'function') {
    modelFamily = options.modelFamilyOf(member.bareModel);
  } else {
    const norm =
      priorsRead.normaliseModelId(member.bareModel) || String(member.bareModel).toLowerCase();
    const leaf = norm.includes('/') ? norm.split('/').pop() : norm;
    const familyMatch = /^([a-z]+)/.exec(leaf);
    modelFamily = familyMatch ? familyMatch[1] : leaf;
  }
  const candidate = {
    harness: 'agy-pool',
    source: 'agy-pool',
    gateway: '',
    upstream: 'agy-pool',
    accessPath: agyPoolRuntime.poolTaskName(member.accountId),
    accountId: member.accountId,
    quotaScope: member.quotaScope || `${member.accountId}:${member.bucket || 'unknown'}`,
    modelId: member.bareModel,
    model: member.bareModel,
    modelFamily,
    lane: 'agy-pool',
    agyPoolMember: true,
    headroom: member.headroom,
    headroomStatus: member.headroomStatus,
    eligibleAccounts: member.eligibleAccounts || [],
    reasoningEffort: member.effort || null,
    memberScore: member.score ?? null,
    memberTier: member.tier || null,
  };
  candidate.candidateKey = candidateKey(candidate);
  return { candidate };
}

/**
 * Read one account's `/quota` snapshot together with the time it was written,
 * so a caller can tell a snapshot taken after a run from one taken before it.
 */
function readAccountQuotaSnapshot(accountId, options = {}) {
  if (options.quotaSnapshots && options.quotaSnapshots[accountId]) {
    const snap = options.quotaSnapshots[accountId];
    return {
      groups: Array.isArray(snap.groups) ? snap.groups : snap.command?.data?.groups || [],
      at: Number.isFinite(snap.at) ? snap.at : null,
    };
  }
  const quotaFile = path.join(agyPoolRuntime.accountDir(accountId, options), 'quota-out.txt');
  try {
    if (!fs.existsSync(quotaFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(quotaFile, 'utf8').replace(/^﻿/, ''));
    return { groups: parsed?.command?.data?.groups || [], at: fs.statSync(quotaFile).mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Check the evidence an AGY pool run leaves behind (WI-B2, corrected in WI-C1).
 *
 * The pool reports no served model, so quota snapshots can only show that the
 * requested model's quota group was drawn from. That is group evidence, never
 * model identity: `modelVerified` is true only when the run receipt names the
 * served model explicitly and it matches the request. The receipt must belong
 * to this account and run, and the after-snapshot must postdate the run start.
 */
function verifyAgyServedIdentity({
  requestedModel,
  expectedBucket,
  quotaBefore,
  quotaAfter,
  receipt,
  accountId,
  expectedJobId,
  runStartedAt,
  runEndedAt,
} = {}) {
  const normModel = priorsRead.normaliseModelId(requestedModel);
  const base = {
    requestedModel: normModel || requestedModel || null,
    bucket: expectedBucket || null,
    accountId: accountId || null,
    jobId: (receipt && typeof receipt.jobId === 'string' && receipt.jobId) || null,
    servedModel: null,
    modelVerified: false,
    groupVerified: false,
  };
  const refuse = (error, extra) => ({
    ...base,
    ok: false,
    verified: false,
    error,
    evidenceKind: 'none',
    ...extra,
  });
  if (!normModel || !expectedBucket || !accountId) return refuse('AGY_IDENTITY_INPUT_INVALID');
  if (!receipt || typeof receipt !== 'object') return refuse('AGY_RECEIPT_MISSING');
  if (receipt.accountId !== accountId) return refuse('AGY_ACCOUNT_MISMATCH');
  const jobId = typeof receipt.jobId === 'string' ? receipt.jobId : '';
  if (!jobId.startsWith(accountId + '/') || (expectedJobId && jobId !== expectedJobId)) {
    return refuse('AGY_RUN_BINDING_MISMATCH');
  }
  const servedModel = receipt.servedModel
    ? priorsRead.normaliseModelId(receipt.servedModel) || null
    : null;
  if (servedModel && servedModel !== normModel) {
    return refuse('AGY_SERVED_MODEL_MISMATCH', { servedModel });
  }
  const modelVerified = Boolean(servedModel);

  const groupsBefore = Array.isArray(quotaBefore && quotaBefore.groups)
    ? quotaBefore.groups
    : quotaBefore?.command?.data?.groups || null;
  const groupsAfter = Array.isArray(quotaAfter && quotaAfter.groups)
    ? quotaAfter.groups
    : quotaAfter?.command?.data?.groups || null;
  const receiptOnly = () => ({
    ...base,
    ok: true,
    verified: true,
    modelVerified: true,
    servedModel,
    evidenceKind: 'receipt',
  });
  if (!Array.isArray(groupsBefore) || !Array.isArray(groupsAfter)) {
    return modelVerified ? receiptOnly() : refuse('AGY_QUOTA_PROOF_MISSING');
  }
  // The snapshots must bracket the whole run: before at or before its start,
  // after at or after its end. Otherwise the delta may belong to another run.
  const beforeAt = quotaBefore && quotaBefore.at;
  const afterAt = quotaAfter && quotaAfter.at;
  const endedAt = Number.isFinite(runEndedAt) ? runEndedAt : runStartedAt;
  if (
    (Number.isFinite(runStartedAt) || Number.isFinite(runEndedAt)) &&
    !(
      Number.isFinite(runStartedAt) &&
      endedAt >= runStartedAt &&
      Number.isFinite(afterAt) &&
      afterAt >= endedAt &&
      (!Number.isFinite(beforeAt) || beforeAt <= runStartedAt)
    )
  ) {
    return modelVerified ? receiptOnly() : refuse('AGY_QUOTA_SNAPSHOT_STALE');
  }

  const mapBuckets = (groups) => {
    const m = new Map();
    for (const g of groups) {
      const b = bucketKeyFromGroup(g);
      const rem = minBucketRemaining(g);
      if (b && rem !== null) m.set(b, rem);
    }
    return m;
  };
  const beforeMap = mapBuckets(groupsBefore);
  const afterMap = mapBuckets(groupsAfter);
  if (!beforeMap.has(expectedBucket) || !afterMap.has(expectedBucket)) {
    return modelVerified ? receiptOnly() : refuse('AGY_EXPECTED_BUCKET_MISSING');
  }

  const beforeVal = beforeMap.get(expectedBucket);
  const afterVal = afterMap.get(expectedBucket);
  const expectedDelta = Math.round((beforeVal - afterVal) * 10000) / 10000;

  let foreignDrainedBucket = null;
  for (const [bKey, bBefore] of beforeMap.entries()) {
    if (bKey === expectedBucket) continue;
    const bAfter = afterMap.get(bKey);
    if (typeof bAfter === 'number' && bBefore - bAfter > 0.0001) {
      foreignDrainedBucket = bKey;
      break;
    }
  }

  const figures = { quotaBefore: beforeVal, quotaAfter: afterVal, delta: expectedDelta };

  // Another quota group drained during the run: the evidence points away from
  // the requested model, whatever the receipt says.
  if (foreignDrainedBucket) {
    return refuse('AGY_GROUP_DELTA_MISMATCH', { foreignDrainedBucket, ...figures });
  }
  // No drop (rounding hides small runs; a rise is a window reset): no group evidence.
  if (expectedDelta <= 0.0001) {
    return modelVerified
      ? { ...receiptOnly(), ...figures }
      : refuse('AGY_GROUP_DELTA_UNOBSERVED', {
          evidenceKind: 'requested+group-unchanged',
          ...figures,
        });
  }
  return {
    ...base,
    ok: true,
    verified: modelVerified,
    modelVerified,
    groupVerified: true,
    servedModel,
    evidenceKind: modelVerified ? 'receipt+group-delta' : 'requested+group-delta',
    ...figures,
  };
}

module.exports = {
  resolveAgyPoolConfig,
  bucketKeyFromGroup,
  modelsFromGroup,
  discoverAgyPoolMembers,
  buildAgyMemberCandidate,
  readAccountQuotaSnapshot,
  verifyAgyServedIdentity,
};
