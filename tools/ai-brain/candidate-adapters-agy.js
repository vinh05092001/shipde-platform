'use strict';

const fs = require('fs');
const path = require('path');
const {
  createRouteIdentity,
  getQuotaFamily,
  UNKNOWN,
  registerPrivateEmail,
  hashEmail,
} = require('./route-identity');
const { modelId, modelEvidence, modelQuotaGroup } = require('./candidate-adapters-common');

function readLaneIdentityEmail(laneId, options) {
  if (typeof options?.readLaneIdentity === 'function') {
    const res = options.readLaneIdentity(laneId);
    const em = typeof res === 'string' ? res : res?.email || res?.label;
    if (typeof em === 'string' && em.includes('@') && em !== laneId) return em.trim();
  }
  if (options?.laneIdentities && options.laneIdentities[laneId]) {
    const em = options.laneIdentities[laneId];
    if (typeof em === 'string' && em.includes('@') && em !== laneId) return em.trim();
  }
  try {
    const agyPool = require('./agy-pool-runtime');
    const dir =
      typeof agyPool.accountDir === 'function' ? agyPool.accountDir(laneId, options) : null;
    if (dir) {
      const idFile = path.join(dir, 'identity.json');
      if (fs.existsSync(idFile)) {
        const doc = JSON.parse(fs.readFileSync(idFile, 'utf8'));
        const email = doc.email || doc.label;
        if (typeof email === 'string' && email.includes('@') && email !== laneId) {
          return email.trim();
        }
      }
    }
  } catch {}
  return UNKNOWN;
}

/**
 * Loads AGY pool lanes (agy01..agy10 via Scheduled Task).
 */
function loadAgyPoolCandidates(options = {}) {
  const candidates = [];
  const unconnected = [];

  let lanes = options.lanes;
  let models = options.models;

  if (!lanes || !models) {
    try {
      const agyPool = require('./agy-pool-runtime');
      if (!lanes && typeof agyPool.discoverAccounts === 'function') {
        const accountIds = agyPool.discoverAccounts(options);
        lanes = accountIds.map((laneId) => {
          let quota;
          try {
            quota =
              typeof agyPool.quotaReading === 'function'
                ? agyPool.quotaReading(laneId, options)
                : null;
          } catch {}
          const realAccountRef = readLaneIdentityEmail(laneId, options);
          return {
            laneId,
            accountRef: realAccountRef,
            quota,
          };
        });
      }
      if (!models && typeof agyPool.discoverPoolModels === 'function') {
        models = agyPool.discoverPoolModels();
      }
    } catch {}
  }

  if (!lanes || lanes.length === 0 || !models || models.length === 0) {
    unconnected.push({
      sourceId: 'agy-pool',
      gatewayId: 'direct',
      reason: 'NO_AGY_LANES_OR_MODELS_DISCOVERED',
    });
    return { candidates, unconnected };
  }

  for (const lane of lanes) {
    if (lane.quotaExhausted) {
      unconnected.push({
        sourceId: 'agy-pool',
        laneId: lane.laneId,
        reason: 'AGY_LANE_QUOTA_EXHAUSTED',
      });
      continue;
    }

    let laneEmail = UNKNOWN;
    if (
      lane.accountRef &&
      lane.accountRef !== lane.laneId &&
      lane.accountRef !== UNKNOWN &&
      String(lane.accountRef).includes('@')
    ) {
      laneEmail = lane.accountRef;
    } else {
      laneEmail = readLaneIdentityEmail(lane.laneId, options);
    }
    const safeAccountHash =
      laneEmail && laneEmail !== UNKNOWN && String(laneEmail).includes('@')
        ? hashEmail(laneEmail)
        : UNKNOWN;

    if (laneEmail && laneEmail !== UNKNOWN && String(laneEmail).includes('@')) {
      registerPrivateEmail(lane.laneId, laneEmail);
      registerPrivateEmail(safeAccountHash, laneEmail);
      registerPrivateEmail(lane.laneId + '::' + safeAccountHash, laneEmail);
    }

    for (const rawModel of models) {
      const m = modelId(rawModel);
      if (!m || String(m).toLowerCase() === 'default') continue;

      const rows = lane.quota?.rows || lane.rows || [];
      const evidence = modelEvidence(rawModel, options);

      const explicitGroup =
        rawModel.quotaGroup ||
        rawModel.metadata?.quotaGroup ||
        options.modelMetadata?.[m]?.quotaGroup ||
        evidence.quotaGroup;
      const explicitFamily =
        rawModel.quotaFamily ||
        rawModel.metadata?.quotaFamily ||
        options.modelMetadata?.[m]?.quotaFamily ||
        evidence.quotaFamily;
      const explicitGroupFromFamily = explicitFamily
        ? /argon/i.test(explicitFamily)
          ? 'argon'
          : /claude|gpt|3p|external/i.test(explicitFamily)
            ? 'external'
            : /gemini/i.test(explicitFamily)
              ? 'gemini'
              : explicitFamily
        : null;
      const explicitDataGroup = explicitGroup || explicitGroupFromFamily;

      const membershipRow = rows.find((r) => Array.isArray(r.models) && r.models.includes(m));
      const membershipGroup =
        membershipRow?.group ||
        (membershipRow?.family
          ? /argon/i.test(membershipRow.family)
            ? 'argon'
            : /claude|gpt|3p|external/i.test(membershipRow.family)
              ? 'external'
              : /gemini/i.test(membershipRow.family)
                ? 'gemini'
                : membershipRow.family
          : null);
      const laneGroups = Array.isArray(lane.quota?.groups)
        ? lane.quota.groups
        : Array.isArray(lane.groups)
          ? lane.groups
          : [];
      const membershipFromGroup = laneGroups.find(
        (g) => Array.isArray(g.models) && g.models.includes(m)
      );
      const parsedGroupFromLane = membershipFromGroup?.id || membershipFromGroup?.group;
      const parsedGroup =
        membershipGroup ||
        (parsedGroupFromLane
          ? /argon/i.test(parsedGroupFromLane)
            ? 'argon'
            : /claude|gpt|3p|external/i.test(parsedGroupFromLane)
              ? 'external'
              : /gemini/i.test(parsedGroupFromLane)
                ? 'gemini'
                : parsedGroupFromLane
          : null);

      const targetGroup = explicitDataGroup || parsedGroup || modelQuotaGroup(m);
      const targetFamily = explicitFamily || getQuotaFamily(targetGroup);

      const matchingRows = rows.filter((r) => {
        if (modelId(r) === m) return true;
        if (Array.isArray(r.models) && r.models.includes(m)) return true;
        const rowGroup =
          r.group ||
          (r.family
            ? /argon/i.test(r.family)
              ? 'argon'
              : /claude|gpt|3p|external/i.test(r.family)
                ? 'external'
                : /gemini/i.test(r.family)
                  ? 'gemini'
                  : r.family
            : null);
        if (rowGroup && rowGroup === targetGroup) return true;
        if (r.family && (r.family === targetGroup || r.family === getQuotaFamily(targetGroup)))
          return true;
        return false;
      });
      const exhausted = matchingRows.some(
        (r) =>
          r.disabled === true ||
          (r.remainingPercent != null &&
            Number.isFinite(Number(r.remainingPercent)) &&
            Number(r.remainingPercent) <= 0)
      );
      const known =
        matchingRows.length > 0 &&
        matchingRows.every(
          (r) =>
            r.known !== false &&
            r.remainingPercent != null &&
            r.remainingPercent !== '' &&
            Number.isFinite(Number(r.remainingPercent))
        );
      if (lane.quota?.available === false || exhausted || !known) {
        unconnected.push({
          sourceId: 'agy-pool',
          laneId: lane.laneId,
          configuredModelId: m,
          reason: exhausted ? 'AGY_MODEL_QUOTA_EXHAUSTED' : 'AGY_MODEL_QUOTA_UNKNOWN',
        });
        continue;
      }
      const quotaScopeKey = `agy-quota::${lane.laneId}::${targetGroup}`;
      candidates.push(
        createRouteIdentity({
          harness: 'agy-pool',
          sourceId: 'agy-pool',
          gatewayId: 'direct',
          upstreamProviderId: 'antigravity',
          configuredModelId: m,
          outboundModelId: m,
          accountRef: lane.laneId,
          connectionId: lane.laneId,
          quotaScopeId: quotaScopeKey,
          metadata: {
            laneId: lane.laneId,
            realAccountRef: safeAccountHash !== UNKNOWN ? safeAccountHash : undefined,
            ...evidence,
            accountRef: lane.laneId,
            quotaGroup: targetGroup,
            quotaFamily: targetFamily,
          },
        })
      );
    }
  }

  return { candidates, unconnected };
}

module.exports = {
  readLaneIdentityEmail,
  loadAgyPoolCandidates,
};
