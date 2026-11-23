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
 * Verify an AGY pool run's served identity using the pinned requestedModel and
 * before/after per-bucket quota snapshots (WI-B2: option (a) requested+group-delta,
 * failing closed when a different bucket drained or quota snapshots are missing).
 */
function verifyAgyServedIdentity({ requestedModel, expectedBucket, quotaBefore, quotaAfter } = {}) {
  const normModel = priorsRead.normaliseModelId(requestedModel);
  if (!normModel || !expectedBucket) {
    return {
      ok: false,
      error: 'AGY_IDENTITY_INPUT_INVALID',
      requestedModel: requestedModel || null,
      bucket: expectedBucket || null,
      identityProof: 'unverified',
    };
  }
  const groupsBefore = Array.isArray(quotaBefore && quotaBefore.groups)
    ? quotaBefore.groups
    : quotaBefore?.command?.data?.groups || null;
  const groupsAfter = Array.isArray(quotaAfter && quotaAfter.groups)
    ? quotaAfter.groups
    : quotaAfter?.command?.data?.groups || null;
  if (!Array.isArray(groupsBefore) || !Array.isArray(groupsAfter)) {
    return {
      ok: false,
      error: 'AGY_QUOTA_PROOF_MISSING',
      requestedModel: normModel,
      bucket: expectedBucket,
      identityProof: 'unverified',
    };
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
    return {
      ok: false,
      error: 'AGY_EXPECTED_BUCKET_MISSING',
      requestedModel: normModel,
      bucket: expectedBucket,
      identityProof: 'unverified',
    };
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

  if (expectedDelta < -0.0001 || (expectedDelta <= 0.0001 && foreignDrainedBucket)) {
    return {
      ok: false,
      error: 'AGY_GROUP_DELTA_MISMATCH',
      requestedModel: normModel,
      bucket: expectedBucket,
      foreignDrainedBucket,
      quotaBefore: beforeVal,
      quotaAfter: afterVal,
      delta: expectedDelta,
      identityProof: 'mismatch',
    };
  }

  return {
    ok: true,
    requestedModel: normModel,
    bucket: expectedBucket,
    quotaBefore: beforeVal,
    quotaAfter: afterVal,
    delta: expectedDelta,
    identityProof: expectedDelta > 0 ? 'requested+group-delta' : 'requested+group-unchanged',
  };
}

module.exports = {
  resolveAgyPoolConfig,
  bucketKeyFromGroup,
  modelsFromGroup,
  discoverAgyPoolMembers,
  buildAgyMemberCandidate,
  verifyAgyServedIdentity,
};
