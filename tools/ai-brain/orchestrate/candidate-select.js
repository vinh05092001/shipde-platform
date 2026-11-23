'use strict';

const fs = require('fs');
const path = require('path');
const routing = require('../failure-domain');
const evidence = require('../evidence');
const candidatesApi = require('../candidates');
const { candidateKey } = require('../candidates');
const { parseCandidateKey } = require('../discovery/identity');
const comboReader = require('../combo-reader');
const comboJev = require('../combo-jev-select');
const agyPoolCandidates = require('../agy-pool-candidates');
const decisions = require('../decisions');
const sourcesApi = require('../sources');
const jev = require('../jev');
const {
  exhaustedAccountKey,
  parseExhaustedAccountKey,
  roleOf,
  routingRoleOf,
} = require('./shared');
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

function shouldUseComboJevSelect(pool, o, comboApi) {
  if (!o || o.comboJevSelect === false) return false;
  const hasCombo = pool.some((c) => c && comboApi.isComboCandidate(c, o.registry));
  if (!hasCombo) return false;
  const explicit =
    o.comboJevSelect === true ||
    Array.isArray(o.comboMembers) ||
    typeof o.readComboConfig === 'function' ||
    Boolean(o.comboFixture);
  if (explicit) return true;
  const isLiveUninjected =
    !Array.isArray(o.candidates) && !o.injectedRun && typeof o.run !== 'function';
  return (
    isLiveUninjected &&
    pool.every((c) => c && (comboApi.isComboCandidate(c, o.registry) || c.comboMember === true))
  );
}

/**
 * Agy-pool failures for this item earlier in this run. failedKeys lives on the
 * item for one run, so this never reads failures from another run. Only an
 * account-exhausted mark excludes a whole account; a failed candidate key
 * excludes just its model on its account.
 */
function failedAgyExclusions(failedSet) {
  const accounts = new Set();
  const modelAccounts = new Set();
  for (const key of failedSet) {
    if (typeof key !== 'string') continue;
    const exhausted = parseExhaustedAccountKey(key);
    if (exhausted && exhausted.harness === 'agy-pool') {
      accounts.add(exhausted.accountId);
      continue;
    }
    const parsed = parseCandidateKey(key);
    if (parsed && parsed.harness === 'agy-pool' && parsed.account && parsed.modelId) {
      modelAccounts.add(agyPoolCandidates.modelAccountKey(parsed.modelId, parsed.account));
    }
  }
  return { accounts: Array.from(accounts), modelAccounts: Array.from(modelAccounts) };
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
  // The domain caps exist to spread attempts across routes. The single combo is
  // its own failover domain (9router fails over between members), and the
  // writer and reviewer launches alone reach the cap, which left no repair
  // candidate (#605, F4). A combo that actually failed is still refused through
  // failedSet and the exhausted-account mark.
  const comboApi = require('../combo');
  const isCandidateEligible = (c) => {
    if (!c || c.blocked || failedSet.has(candidateKey(c))) return false;
    const accMark = exhaustedAccountKey(c);
    if (accMark && failedSet.has(accMark)) return false;
    if (comboApi.isComboCandidate(c, o && o.registry)) return true;
    const dom = domainOf(c);
    if (dom && excludedDomains.has(dom)) return false;
    if (dom && (domainAttempts.get(dom) || 0) >= 2) return false;
    return true;
  };

  const poolKinds = pool.map((c) => {
    if (!c || typeof c !== 'object') return 'other';
    if (comboApi.isComboCandidate(c, o && o.registry)) return 'combo';
    if (c.comboMember === true) return 'comboMember';
    return 'other';
  });
  const jevGate = shouldUseComboJevSelect(pool, o, comboApi);
  let comboJevRan = false;
  let jevReadState = null;
  let jevReadStatus = null;
  let jevReadError = null;
  let jevRawCount = 0;
  let jevEligibleCount = 0;
  let jevSelReason = null;
  if (jevGate) {
    comboJevRan = true;
    const role = roleOf(item);
    const writerCandidate = writerKey ? pool.find((c) => c && candidateKey(c) === writerKey) : null;
    const parsedWriter = writerKey ? parseCandidateKey(writerKey) : null;
    const writerModelId =
      (item && item.writerModelId) ||
      options.writerModelId ||
      (writerCandidate && writerCandidate.modelId) ||
      (parsedWriter && parsedWriter.modelId) ||
      null;
    const writerIsOpaqueCombo = Boolean(
      writerKey &&
      (writerCandidate
        ? comboApi.isComboCandidate(writerCandidate, o.registry)
        : comboApi.isComboIdentity(writerKey, o.registry))
    );
    // M-R04 fail-closed by default on the live combo-JEV seam: concrete member
    // writers and unknown/unparseable writer identities must obtain an
    // independently established reviewer (distinct upstream + model family).
    // Only when the writer itself ran as the opaque configured combo (operator
    // decision 2026-11-19 "1 combo cho tất cả", audited as
    // REVIEWER_EQUALS_WRITER_COMBO_ACCEPTED in review-lane.js) and strict mode
    // is not forced may the reviewer fall back to the opaque configured combo.
    const requireIndependentReviewer =
      role === 'reviewer' && (!writerIsOpaqueCombo || o.strictIndependentComboReview === true);

    const refuseNoIndependentReviewer = (sel) => {
      const reason = (sel && sel.reason) || 'NO_INDEPENDENT_REVIEWER';
      // Non-empty rejected ensures review-item.js sees controllerJudgedCandidates
      // as true so an explicit o.reviewerIdentity cannot override this refusal.
      const rejected = [{ candidateKey: writerKey || 'combo-jev', reason }];
      const result = {
        chosen: null,
        reason,
        ranking: [],
        top3: [],
        rejected,
        comboJev: sel || null,
      };
      const decisionRecorded = {
        stage: decisions.Stage.SELECTED,
        workItemId: item && item.id,
        role,
        chosen: null,
        chosenCandidate: null,
        reason,
        rejected,
        selected: null,
        chosenKey: null,
      };
      decisions.recordDecision(decisionRecorded, logOpts);
      return { chosen: null, reason, result, decisionRecorded };
    };

    if (requireIndependentReviewer && !writerModelId) {
      return refuseNoIndependentReviewer(null);
    }

    let rawMembers = Array.isArray(o.comboMembers) ? o.comboMembers : null;
    // Whether the combo member list was read at all, as opposed to read but empty.
    let comboRead = Boolean(rawMembers);
    if (rawMembers) {
      jevReadState = 'PROVIDED';
    } else {
      const readCombo =
        typeof o.readComboConfig === 'function' ? o.readComboConfig : comboReader.readComboConfig;
      const cfg = comboApi.configuredCombo(o.registry);
      const comboConfig = await readCombo({
        name: o.comboName || (cfg && cfg.name) || null,
        registry: o.registry,
        env: o.env,
        fixture: o.comboFixture,
      });
      jevReadState = (comboConfig && comboConfig.state) || null;
      jevReadStatus = comboConfig && comboConfig.status !== undefined ? comboConfig.status : null;
      jevReadError =
        comboConfig && typeof comboConfig.error === 'string' && comboConfig.error
          ? comboConfig.error
          : null;
      comboRead = Array.isArray(comboConfig && comboConfig.members);
      rawMembers = comboRead ? comboConfig.members : [];
    }
    jevRawCount = rawMembers.length;

    const eligibleMembers = rawMembers
      .filter((m) => typeof m === 'string' && m.trim())
      .map((m) => m.trim())
      .filter((m) => {
        const built = comboJev.buildMemberCandidate(
          { modelId: m, base: m, effort: null, score: null, tier: null },
          { registry: o.registry, env: o.env, comboName: o.comboName }
        );
        if (!built || !built.candidate) return false;
        if (!isCandidateEligible(built.candidate)) return false;
        if (role === 'reviewer') {
          if (writerKey && candidateKey(built.candidate) === writerKey) return false;
          const dom = domainOf(built.candidate);
          if (dom && forbidden.has(dom)) return false;
        }
        return true;
      });
    jevEligibleCount = eligibleMembers.length;

    const agyExclusions = failedAgyExclusions(failedSet);
    // When the combo was read but no 9router member is eligible (all failed or
    // excluded), the agy-pool members can still be offered if that lane is on.
    // If the combo could not be read, or agy-pool is off or yields nothing,
    // selection falls back exactly as before.
    const agyOnly =
      eligibleMembers.length === 0 &&
      comboRead &&
      Boolean(o.registry && o.registry.dispatch && o.registry.dispatch.agyPoolShortlistEnabled);
    let sel = null;
    if (eligibleMembers.length > 0 || agyOnly) {
      sel = await comboJev.selectComboMember({
        item,
        role,
        writerModelId: role === 'reviewer' ? writerModelId : null,
        members: eligibleMembers,
        priors: o.priors,
        priorsFile: o.priorsFile,
        registry: o.registry,
        env: o.env,
        now,
        jevAsk: o.jevAsk,
        minConfidence: o.jevMinConfidence,
        maxOptions: o.jevMaxOptions,
        comboName: o.comboName,
        agyPoolOptions: o.agyPoolOptions,
        excludedAccounts: agyExclusions.accounts,
        excludedModelAccounts: agyExclusions.modelAccounts,
      });
      jevSelReason = (sel && (sel.reason || sel.error)) || null;
      if (agyOnly && !(sel && sel.ok)) sel = null;
    }

    if (
      sel &&
      sel.ok &&
      sel.candidate &&
      sel.selected &&
      !(requireIndependentReviewer && !sel.independentApplied)
    ) {
      const chosen = candidateKey(sel.candidate);
      if (
        Array.isArray(annotatedCandidates) &&
        !annotatedCandidates.some((c) => c && candidateKey(c) === chosen)
      ) {
        annotatedCandidates.push(sel.candidate);
      }
      const reason = 'combo-jev:' + sel.handledBy + ' (' + sel.selected.modelId + ')';
      const ranking = [{ ...sel.candidate, candidateKey: chosen }];
      const result = { chosen, reason, ranking, top3: ranking, rejected: [], comboJev: sel };
      const decisionRecorded = {
        stage: decisions.Stage.SELECTED,
        workItemId: item && item.id,
        role,
        chosen,
        chosenCandidate: sel.candidate,
        reason,
        rejected: [],
        selected: chosen,
        chosenKey: chosen,
        comboJev: {
          handledBy: sel.handledBy,
          assessment: sel.assessment,
          independentApplied: Boolean(sel.independentApplied),
          eligibleCount: sel.eligibleCount,
          shortlistCount: sel.shortlistCount,
          shortlistOptions: Array.isArray(sel.shortlistOptions) ? sel.shortlistOptions : [],
          memberScore: sel.selected.score,
          reasoningEffort: sel.selected.effort,
        },
      };
      decisions.recordDecision(decisionRecorded, logOpts);
      return { chosen, reason, result, decisionRecorded };
    }

    if (requireIndependentReviewer && (!sel || !sel.ok || !sel.independentApplied)) {
      return refuseNoIndependentReviewer(sel);
    }
  }

  // When combo-JEV selection ran and rejected every member, fall back only to
  // non-member pool entries (the configured combo), never a previously cached
  // comboMember that independence or eligibility just rejected.
  const fallbackPool = comboJevRan ? pool.filter((c) => !c || !c.comboMember) : pool;
  const eligible = fallbackPool.filter(isCandidateEligible);
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
  const comboJevFallback = {
    gate: jevGate,
    poolKinds,
    readState: jevReadState,
    readStatus: jevReadStatus,
    ...(jevReadError ? { readError: jevReadError } : {}),
    rawCount: jevRawCount,
    eligibleCount: jevEligibleCount,
    ...(jevSelReason ? { selReason: jevSelReason } : {}),
  };

  // Strict proof lane R2 guard: even when combo-JEV gate did not fire, never
  // allow a reviewer in strict mode to silently reuse the writer's key or an
  // opaque combo when an independent reviewer cannot be proven.
  const currentRole = roleOf(item);
  if (
    o &&
    o.strictIndependentComboReview === true &&
    currentRole === 'reviewer' &&
    (!chosenCandidate ||
      (writerKey && chosen === writerKey) ||
      comboApi.isComboCandidate(chosenCandidate, o.registry) ||
      !writerKey)
  ) {
    const reason = 'NO_INDEPENDENT_REVIEWER';
    const rejected = [{ candidateKey: writerKey || chosen || 'combo-jev', reason }];
    const result = {
      chosen: null,
      reason,
      ranking: [],
      top3: [],
      rejected,
      comboJevFallback,
    };
    const decisionRecorded = {
      stage: decisions.Stage.SELECTED,
      workItemId: item && item.id,
      role: currentRole,
      chosen: null,
      chosenCandidate: null,
      reason,
      rejected,
      selected: null,
      chosenKey: null,
      comboJevFallback,
    };
    decisions.recordDecision(decisionRecorded, logOpts);
    return { chosen: null, reason, result, decisionRecorded };
  }

  const ranking = chosenCandidate ? [{ ...chosenCandidate, candidateKey: chosen }] : [];
  const result = { chosen, reason, ranking, top3: ranking, rejected: [], comboJevFallback };
  const decisionRecorded = {
    stage: decisions.Stage.SELECTED,
    workItemId: item && item.id,
    role: currentRole,
    chosen,
    chosenCandidate,
    reason,
    rejected: [],
    selected: chosen,
    chosenKey: chosen,
    comboJevFallback,
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
