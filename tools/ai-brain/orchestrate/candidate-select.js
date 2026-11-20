'use strict';

const fs = require('fs');
const path = require('path');
const routing = require('../routing');
const ranking = require('../ranking');
const evidence = require('../evidence');
const candidatesApi = require('../candidates');
const { candidateKey } = require('../candidates');
const decisions = require('../decisions');
const sourcesApi = require('../sources');
const jev = require('../jev');
const { exhaustedAccountKey, roleOf, routingRoleOf } = require('./shared');
const { resolveLaunchRoute, routeProbeCandidate } = require('./route-probe');
const { resolveLauncher, resolveIsolatedWorkerRoot, unique } = require('./writer-loop');
const { normalizeAccount, explicitQualityFloor } = require('./checkpoint');

function buildProfile(item, o, forbiddenFailureDomains) {
  const role = routingRoleOf(item);
  const roleCaps = (item && item.roleRequirement && item.roleRequirement.requires) || {};
  const strictProfile =
    Boolean(o && o.enforceProofFloors === true) ||
    /^TASK-AI-73\b/.test(String((item && item.id) || ''));
  const capSet = new Set();
  for (const cap of Array.isArray(item && item.requiredCapabilities)
    ? item.requiredCapabilities
    : []) {
    if (cap) capSet.add(String(cap));
  }
  for (const cap of Array.isArray(item && item.capabilities) ? item.capabilities : []) {
    if (cap) capSet.add(String(cap));
  }
  if (strictProfile) {
    for (const cap of Array.isArray(
      item && item.roleRequirement && item.roleRequirement.capabilities
    )
      ? item.roleRequirement.capabilities
      : []) {
      if (cap) capSet.add(String(cap));
    }
    for (const [cap, enabled] of Object.entries(roleCaps || {})) {
      if (cap !== 'minContext' && enabled) capSet.add(cap);
    }
  }
  const requiredCapabilities = Array.from(capSet);
  const codingOrReview = role === 'writer' || role === 'reviewer' || role === 'security-review';
  const explicitExploration = Boolean(item && item.exploration);
  const proofFloor =
    item && item.proofFloor
      ? item.proofFloor
      : role === 'writer'
        ? 'NONE'
        : explicitExploration
          ? 'HARNESS_PASS'
          : (role === 'reviewer' || role === 'security-review') && strictProfile
            ? 'WORK_ITEM_PASS'
            : 'NONE';
  return {
    taskId: item.id,
    description: item.objective || item.title || item.description || item.id,
    ...(item.skipReason ? { skipReason: item.skipReason } : {}),
    role,
    complexity: item.complexity || 'standard',
    requiredCapabilities,
    proofFloor,
    contextSize:
      item.contextSize !== null &&
      item.contextSize !== undefined &&
      Number.isFinite(Number(item.contextSize)) &&
      Number(item.contextSize) > 0
        ? Number(item.contextSize)
        : strictProfile &&
            roleCaps.minContext !== null &&
            roleCaps.minContext !== undefined &&
            Number.isFinite(Number(roleCaps.minContext)) &&
            Number(roleCaps.minContext) > 0
          ? Number(roleCaps.minContext)
          : 64000,
    expectedDuration:
      item.expectedDuration !== null &&
      item.expectedDuration !== undefined &&
      Number.isFinite(Number(item.expectedDuration)) &&
      Number(item.expectedDuration) > 0
        ? Number(item.expectedDuration)
        : 30 * 60 * 1000,
    latencyPriority: item.latencyPriority || (codingOrReview ? 'normal' : 'high'),
    qualityFloor: explicitQualityFloor(item),
    costCeiling:
      item.costCeiling !== null &&
      item.costCeiling !== undefined &&
      Number.isFinite(Number(item.costCeiling)) &&
      Number(item.costCeiling) >= 0
        ? Number(item.costCeiling)
        : 1000000,
    requiredHarness: null,
    forbiddenFailureDomains: expandForbiddenDomains(
      [].concat(
        forbiddenFailureDomains || [],
        item.forbiddenFailureDomains || [],
        item.forbiddenAreas || []
      )
    ),
    resourceCeiling:
      item.resourceCeiling !== null &&
      item.resourceCeiling !== undefined &&
      Number.isFinite(Number(item.resourceCeiling)) &&
      Number(item.resourceCeiling) > 0
        ? Number(item.resourceCeiling)
        : 4,
    currentWorkload:
      item.currentWorkload !== null &&
      item.currentWorkload !== undefined &&
      Number.isFinite(Number(item.currentWorkload)) &&
      Number(item.currentWorkload) >= 0
        ? Number(item.currentWorkload)
        : 0,
    riskDomains: Array.isArray(item.riskDomains) ? [...item.riskDomains] : [],
    allowedFiles: Array.isArray(item.allowedFiles)
      ? [...item.allowedFiles]
      : Array.isArray(item.files)
        ? [...item.files]
        : [],
    acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? [...item.acceptanceCriteria] : [],
    ...(item.ticketText ? { ticketText: item.ticketText } : {}),
    ...(item.itemSource ? { itemSource: item.itemSource } : {}),
  };
}

function buildTaskProfile(item, options) {
  const o = Object.assign({ enforceProofFloors: true }, options || {});
  return buildProfile(item || {}, o, o.forbiddenFailureDomains || []);
}

function rtkPolicyForItem(requested, riskDomains, injectedRun) {
  const isRequested =
    typeof requested === 'object' && requested !== null
      ? Boolean(requested.enabled)
      : Boolean(requested);
  const domains = Array.isArray(riskDomains) ? riskDomains : [];
  const enabled = isRequested && domains.length === 0 && !injectedRun;
  return {
    enabled,
    reason: !isRequested
      ? 'not_requested'
      : injectedRun
        ? 'injected_run_blocks_rtk'
        : enabled
          ? 'low_risk_item'
          : 'risk_domains_block_rtk',
    riskDomains: [...domains],
  };
}

function expandForbiddenDomains(domains) {
  const out = new Set();
  for (const domain of domains || []) {
    if (domain === undefined || domain === null || domain === '') continue;
    const value = String(domain);
    out.add(value);
    for (const part of value.split('/')) {
      if (part) out.add(part);
    }
  }
  return Array.from(out);
}

function hasQuotaAccountReadings(options) {
  const o = options || {};
  const rankingOpts = o.ranking || {};
  const home = o.home || rankingOpts.home;
  const storeFile =
    rankingOpts.storePath || (home ? path.join(home, '.shipde', 'agy-quota.json') : null);
  if (!storeFile) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    return Boolean(parsed && parsed.accounts && Object.keys(parsed.accounts).length > 0);
  } catch {
    return false;
  }
}

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

function buildCandidates(options) {
  // Combo-only routing (TASK-AI-171 re-plan 2026-11-19): one 9router combo
  // candidate; 9router owns member order, failover and health.
  const o = options || {};
  if (Array.isArray(o.candidates)) return o.candidates;
  const result = require('../combo').comboCandidate({ registry: o.registry, env: o.env });
  return result.candidate ? [result.candidate] : [];
}

function recordLaunchFailureEvidence(
  evidenceDir,
  evidenceData,
  candidate,
  res,
  classification,
  now
) {
  const payload = {
    status: 'failed',
    exitCode: res && typeof res.exitCode === 'number' ? res.exitCode : 1,
    stderr: res ? res.stderr : undefined,
    body: res ? res.body : undefined,
    cause: classification.cause,
    scope: classification.scope,
    httpStatus: res ? res.httpStatus : undefined,
    level: evidence.Level ? evidence.Level.API : 'API',
    source: 'launch-failure',
  };
  if (evidenceDir) {
    try {
      evidence.recordOutcome(evidenceDir, candidate, payload);
      const reloaded = evidence.loadEvidence(evidenceDir);
      if (evidenceData && typeof evidenceData === 'object' && reloaded) {
        Object.assign(evidenceData, reloaded);
      }
      return reloaded || evidenceData;
    } catch (_) {}
  }
  if (evidenceData && typeof evidenceData === 'object') {
    if (!evidenceData.cooldowns) evidenceData.cooldowns = {};
    const key = candidateKey(candidate);
    evidenceData.cooldowns[key] = {
      lastStatus: 'blocked',
      failCount: ((evidenceData.cooldowns[key] && evidenceData.cooldowns[key].failCount) || 0) + 1,
      blockedAt: new Date(now).toISOString(),
      blockReason: classification.cause,
      cause: classification.cause,
      scope: classification.scope,
      // RT-R03: the applied cooldown never drops below the retryAfterMs the
      // classifier reported for this same failure.
      cooldownMs: evidence.effectiveCooldownMs(classification),
    };
    if (classification.scope === 'upstream' && candidate.upstream) {
      if (!evidenceData.upstreamStatus) evidenceData.upstreamStatus = {};
      evidenceData.upstreamStatus[candidate.upstream] = {
        lastStatus: 'blocked',
        failCount:
          ((evidenceData.upstreamStatus[candidate.upstream] &&
            evidenceData.upstreamStatus[candidate.upstream].failCount) ||
            0) + 1,
        blockedAt: new Date(now).toISOString(),
        blockReason: classification.cause,
        cause: classification.cause,
        scope: 'upstream',
        cooldownMs: evidence.effectiveCooldownMs(classification),
      };
    }
  }
  return evidenceData;
}

function resolveDomainAttempts(options, item, extra, o) {
  const da =
    (options && options.domainAttempts) ||
    (item && item.domainAttempts) ||
    (extra && extra.domainAttempts) ||
    (o && o.domainAttempts) ||
    null;
  const map =
    da instanceof Map ? da : new Map(da && typeof da === 'object' ? Object.entries(da) : []);
  if (item && !item.domainAttempts) item.domainAttempts = map;
  return map;
}

function resolveEvidenceDir(options, o) {
  return (
    (options && options.evidenceDir) ||
    (o && o.evidenceDir) ||
    (Array.isArray(o && o.candidates) ? null : path.join(__dirname, '..', 'data', 'evidence'))
  );
}

async function selectCandidateForProfile(
  item,
  annotatedCandidates,
  forbiddenDomains,
  evidenceData,
  o,
  logOpts,
  now,
  opts
) {
  // Combo-only routing: take the first candidate that has not failed this item.
  const options = opts || {};
  const failed = options.failedKeys || (item && item.failedKeys) || [];
  const failedSet = failed instanceof Set ? failed : new Set(failed);
  const pool = Array.isArray(annotatedCandidates) ? annotatedCandidates : [];
  const blocked = pool.find((c) => c && c.blocked);
  // Combo-only still selects per profile: the reviewer passes the writer's key
  // and forbidden failure domain so, when the pool has a distinct candidate, the
  // review lane does not resolve to the writer. When only the single combo
  // candidate is available it is reused for every role (operator decision
  // 2026-11-19 "1 combo cho tất cả", which accepts reviewer == writer).
  const writerKey = (item && item.writerCandidateKey) || options.writerCandidateKey || null;
  const forbidden = new Set(
    (Array.isArray(forbiddenDomains) ? forbiddenDomains : []).filter(Boolean)
  );
  const domainOf = (c) => {
    try {
      return routing.canonicalFailureDomain(c);
    } catch (_) {
      return null;
    }
  };
  // Honor the same exclusions the retry loop records (restored after the
  // combo-only carve, agy09 P1-3): an exhausted-account mark blocks every route
  // under that account, an excluded failure domain is off-limits, and a domain
  // that has already had two attempts is spent.
  const excludedDomains =
    options.excludedDomains instanceof Set
      ? options.excludedDomains
      : new Set(Array.isArray(options.excludedDomains) ? options.excludedDomains : []);
  const domainAttempts =
    options.domainAttempts instanceof Map
      ? options.domainAttempts
      : new Map(
          options.domainAttempts && typeof options.domainAttempts === 'object'
            ? Object.entries(options.domainAttempts)
            : []
        );
  const eligible = pool.filter((c) => {
    if (!c || c.blocked || failedSet.has(candidateKey(c))) return false;
    const accMark = exhaustedAccountKey(c);
    if (accMark && failedSet.has(accMark)) return false;
    const dom = domainOf(c);
    if (dom && excludedDomains.has(dom)) return false;
    if (dom && (domainAttempts.get(dom) || 0) >= 2) return false;
    return true;
  });
  const chosenCandidate =
    eligible.find(
      (c) => (!writerKey || candidateKey(c) !== writerKey) && !forbidden.has(domainOf(c))
    ) ||
    eligible.find((c) => !writerKey || candidateKey(c) !== writerKey) ||
    eligible[0] ||
    null;
  const chosen = chosenCandidate ? candidateKey(chosenCandidate) : null;
  const reason = chosen
    ? 'combo-only routing'
    : 'NO_ELIGIBLE_CANDIDATE: ' +
      ((blocked && blocked.blockReason) || 'combo unavailable or failed');
  const ranking = chosenCandidate ? [{ ...chosenCandidate, candidateKey: chosen }] : [];
  const result = { chosen, reason, ranking, top3: ranking, rejected: [] };
  const decisionRecorded = {
    stage: decisions.Stage.SELECTED,
    workItemId: item && item.id,
    role: roleOf(item),
    chosen,
    chosenCandidate,
    reason,
    rejected: [],
    selected: chosen,
    chosenKey: chosen,
  };
  decisions.recordDecision(decisionRecorded, logOpts);
  return { chosen, reason, result, decisionRecorded };
}

/**
 * TASK-AI-114 (D3): dependencies first, dependents after them, plan order
 * preserved for everything else. A dependency the planner already refused
 * (unknown id or cycle) cannot appear here; the visiting mark still keeps a
 * malformed edge from recursing forever.
 */
function orderDependenciesFirst(items) {
  const list = Array.isArray(items) ? items : [];
  const byId = new Map();
  for (const item of list) {
    if (item && item.id) byId.set(item.id, item);
  }
  const state = new Map();
  const ordered = [];
  const visit = (item) => {
    const mark = state.get(item.id);
    if (mark === 'done' || mark === 'visiting') return;
    state.set(item.id, 'visiting');
    for (const depId of item.dependencies || []) {
      const depItem = byId.get(depId);
      if (depItem) visit(depItem);
    }
    state.set(item.id, 'done');
    ordered.push(item);
  };
  for (const item of list) visit(item);
  return ordered;
}

/**
 * @param goal  user goal text
 * @param opts  {
 *   specs, specText, candidates, registry, run, isolatedWorker, tests, reviewer,
 *   repairer, reviewerIdentity, sha, baseSha, base, branch, cwd, workerRoot,
 *   usageDir, reviewBudget, decisionDir, checkpointFile, out, now, publication,
 *   ranking (Controller ranking inputs: headrooms, load, reservations, ...),
 *   jevAsk (optional JEV advisory; absent means the Controller decides)
 * }
 * @returns a promise for the run record: the JEV assessment is an async call, so
 *   the loop is too.
 */
module.exports = {
  buildProfile,
  buildTaskProfile,
  rtkPolicyForItem,
  expandForbiddenDomains,
  hasQuotaAccountReadings,
  mergeEvidenceAccounts,
  buildCandidates,
  recordLaunchFailureEvidence,
  resolveDomainAttempts,
  resolveEvidenceDir,
  selectCandidateForProfile,
  orderDependenciesFirst,
};
