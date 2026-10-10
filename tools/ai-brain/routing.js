'use strict';

/**
 * Ship Dễ — TASK-AI-65: live routing from a task profile to a pinned candidate.
 *
 * The gap this module closes (verified on origin/main): `jev.js` was required by
 * no production module, and `cli.js dispatch` scored every candidate 26 for
 * every role, so the writer's failure domain, quota, latency and the
 * Claude-family policy never influenced a dispatch.
 *
 * The flow is the one the Controller already owns, reusing its modules rather
 * than rewriting them:
 *
 *   task profile -> JEV advisory (never a model) -> Controller ranking
 *     -> top 3 -> reservation of rank 1 -> pinned candidateKey
 *     -> structured outcome reported back -> evidence + cooldown updated
 *
 * The JEV ask function is injectable. With none configured the assessment is
 * UNDECIDED and the Controller still decides, from deterministic per-role
 * fallback weights — never from a guess, and never a crash.
 *
 * No model, provider, account or gateway id is hard-coded here. Every candidate
 * identity comes from the registry and the evidence store through the
 * Controller. The one literal family name below is the *exclusion* policy from
 * AGENTS.md (Claude models are forbidden as worker/reviewer), which is a
 * refusal rule, not a routing choice.
 */

const fs = require('fs');
const path = require('path');

const jev = require('./jev');
const evidence = require('./evidence');
const decisions = require('./decisions');
const ranking = require('./ranking');
const quotaStore = require('./quota-store');
const candidatesApi = require('./candidates');
const { loadPriors, priorFor } = require('./priors');
const {
  candidateKey,
  parseCandidateKey,
  registryPrefixes,
  modelBase,
} = require('./discovery/identity');
const sourceRegistry = require('./sources');
const BACKEND_MODEL_PREFIXES = registryPrefixes(sourceRegistry.loadSources());
const { contextRefusal } = require('./harness');
const { Cause, Scope, classifyFailure } = require('./failure-classifier');

/** Task roles a profile may name. Planner stays out: Codex plans, it is not routed. */
const TASK_ROLES = Object.freeze([
  'writer',
  'reviewer',
  'security-review',
  'scanner',
  'researcher',
  'integrator',
]);

/**
 * Roles that do the work or review it. AGENTS.md bars Claude models from
 * worker/reviewer lanes; analyst-style lanes (scanner, researcher, integrator)
 * are not covered by that bar.
 */
const WORKER_REVIEWER_ROLES = new Set(['writer', 'reviewer', 'security-review']);

/**
 * The policy pattern itself. A model id matching this family is excluded from
 * worker and reviewer roles with a named reason — it is never silently
 * down-scored, because a policy violation is a refusal, not a preference.
 */
const CLAUDE_FAMILY_PATTERN = /claude|opus|sonnet|haiku/i;
const CLAUDE_FAMILY_REASON = 'CLAUDE_FAMILY_EXCLUDED_BY_POLICY';

/** Honest proof floors, reusing evidence.js's one-way ladder. */
const PROOF_FLOORS = Object.freeze(['NONE', 'API_PASS', 'HARNESS_PASS', 'WORK_ITEM_PASS']);

/**
 * Canonical weighting profiles. These are the only options JEV is ever offered:
 * classes of trade-off, never a model, provider or account.
 */
const WEIGHT_PROFILES = Object.freeze({
  LATENCY_FIRST: { latency: 55, quality: 20, cost: 25 },
  BALANCED: { latency: 34, quality: 33, cost: 33 },
  QUALITY_FIRST: { latency: 10, quality: 65, cost: 25 },
});

/**
 * Deterministic Controller fallback per role, used when JEV is UNDECIDED. The
 * Controller still decides; it just decides from the role's evidence needs
 * rather than from an advisory that could not be obtained.
 */
const ROLE_FALLBACK_PROFILE = Object.freeze({
  writer: 'BALANCED',
  reviewer: 'QUALITY_FIRST',
  'security-review': 'QUALITY_FIRST',
  scanner: 'LATENCY_FIRST',
  researcher: 'BALANCED',
  integrator: 'BALANCED',
});

/**
 * Stall thresholds for a pinned execution (TASK-AI-65 contract):
 * a request that has not finished within 7 minutes is stalled at the request
 * level; a structured failure that has gone unresolved for 12 minutes forces
 * reselection rather than another wait.
 */
const STALL_REQUEST_FINISH_MS = 7 * 60 * 1000;
const STALL_STRUCTURED_FAILURE_MS = 12 * 60 * 1000;

/** A busy candidate loses this much score per reservation it already holds. */
const BUSY_PENALTY_PER_RESERVATION = 20;

/** Evidence older than 30 days loses trust linearly, up to this penalty. */
const EVIDENCE_AGE_PENALTY_MAX = 15;
const EVIDENCE_AGE_TRUST_MS = 30 * 24 * 60 * 60 * 1000;

/** How many rejection reasons are recorded verbatim; the rest are counted. */
const REJECTED_RECORDED_LIMIT = 50;

const PROFILE_SCHEMA = Object.freeze([
  {
    field: 'taskId',
    check: (v) => typeof v === 'string' && v.trim() !== '',
    code: 'MISSING_TASK_ID',
  },
  { field: 'role', check: (v) => TASK_ROLES.includes(v), code: 'UNKNOWN_ROLE' },
  {
    field: 'complexity',
    check: (v) => typeof v === 'string' && v.trim() !== '',
    code: 'MISSING_COMPLEXITY',
  },
  {
    field: 'requiredCapabilities',
    check: (v) => Array.isArray(v) && v.every((c) => typeof c === 'string'),
    code: 'MALFORMED_CAPABILITIES',
  },
  { field: 'proofFloor', check: (v) => PROOF_FLOORS.includes(v), code: 'UNKNOWN_PROOF_FLOOR' },
  {
    field: 'contextSize',
    check: (v) => Number.isFinite(Number(v)) && Number(v) > 0,
    code: 'MALFORMED_CONTEXT_SIZE',
  },
  {
    field: 'expectedDuration',
    check: (v) => Number.isFinite(Number(v)) && Number(v) > 0,
    code: 'MALFORMED_EXPECTED_DURATION',
  },
  {
    field: 'latencyPriority',
    check: (v) => ['high', 'normal', 'low'].includes(v),
    code: 'UNKNOWN_LATENCY_PRIORITY',
  },
  {
    field: 'qualityFloor',
    check: (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100,
    code: 'MALFORMED_QUALITY_FLOOR',
  },
  {
    field: 'costCeiling',
    check: (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
    code: 'MALFORMED_COST_CEILING',
  },
  {
    field: 'requiredHarness',
    check: (v) => v === null || typeof v === 'string',
    code: 'MALFORMED_REQUIRED_HARNESS',
  },
  {
    field: 'forbiddenFailureDomains',
    check: (v) => Array.isArray(v) && v.every((d) => typeof d === 'string'),
    code: 'MALFORMED_FORBIDDEN_DOMAINS',
  },
  {
    field: 'resourceCeiling',
    check: (v) => Number.isFinite(Number(v)) && Number(v) > 0,
    code: 'MALFORMED_RESOURCE_CEILING',
  },
  {
    field: 'currentWorkload',
    check: (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
    code: 'MALFORMED_CURRENT_WORKLOAD',
  },
]);

/**
 * Validate a task profile against the schema. Every required field is checked;
 * the result names each failing field with a code so a bad profile is refused
 * with a reason, never patched with a default.
 */
function validateTaskProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') {
    return { valid: false, errors: [{ field: 'profile', code: 'NOT_AN_OBJECT' }] };
  }
  for (const rule of PROFILE_SCHEMA) {
    const value = profile[rule.field];
    const missing = value === undefined || value === null;
    if (missing && rule.field !== 'requiredHarness') {
      errors.push({ field: rule.field, code: 'MISSING_FIELD' });
      continue;
    }
    if (!missing && !rule.check(value)) {
      errors.push({ field: rule.field, code: rule.code });
    }
  }
  return { valid: errors.length === 0, errors };
}

/** The closed question JEV is asked about a task profile. */
function jevQuestion(profile) {
  return {
    kind: 'assess-task-profile',
    prompt:
      'Assess this task profile for live routing and choose the trade-off ' +
      'weighting profile. Answer with a weighting profile only, never a model, ' +
      'provider or account.',
    evidence: JSON.stringify(profile),
    options: Object.keys(WEIGHT_PROFILES),
  };
}

/**
 * The deterministic Controller reasoning used when JEV cannot advise. Latency
 * priority can only steer non-quality-critical roles; a security review never
 * trades quality for speed by default.
 */
function controllerFallbackProfile(profile) {
  const roleDefault = ROLE_FALLBACK_PROFILE[profile.role] || 'BALANCED';
  const qualityCritical = profile.role === 'reviewer' || profile.role === 'security-review';
  if (profile.latencyPriority === 'high' && !qualityCritical) return 'LATENCY_FIRST';
  if (profile.latencyPriority === 'low' && qualityCritical) return 'BALANCED';
  return roleDefault;
}

/**
 * The JEV assessment step. Returns, regardless of the advisory's outcome, a
 * complete, deterministic assessment the Controller can rank with:
 *
 *   { jevOutcome, decidedBy, weightProfile, weights, taskClass, difficulty,
 *     recommendedModelClass, confidence, reasonCodes, reason }
 *
 * `recommendedModelClass` is a class ('fast' | 'balanced' | 'high-quality'),
 * never a model, provider or account. With no ask configured the assessment is
 * UNDECIDED and the Controller's per-role weights decide — never a crash.
 */
async function assessTask(profile, opts) {
  const options = opts || {};
  const question = jevQuestion(profile);
  const fallbackId = controllerFallbackProfile(profile);

  const result = await jev.adviseOrReason(question, {
    ask: typeof options.ask === 'function' ? options.ask : undefined,
    minConfidence: Number.isFinite(Number(options.minConfidence))
      ? Number(options.minConfidence)
      : undefined,
    reasoningController: () => ({
      outcome: jev.Outcome.DECIDED,
      choice: fallbackId,
      confidence: 0,
      reason: 'CONTROLLER_DETERMINISTIC_FALLBACK',
    }),
  });

  const jevDecided = result.handledBy === 'jev' && result.outcome === jev.Outcome.DECIDED;
  const chosenProfile =
    result.choice && WEIGHT_PROFILES[result.choice] ? result.choice : fallbackId;
  const decidedBy = jevDecided ? 'jev' : 'controller';

  const reasonCodes = [];
  if (jevDecided) reasonCodes.push('JEV_DECIDED');
  else
    reasonCodes.push(
      'JEV_UNDECIDED:' + String((result.jev && result.jev.reason) || result.reason || 'UNKNOWN')
    );
  reasonCodes.push('WEIGHTS_' + chosenProfile + (jevDecided ? '' : '_CONTROLLER_FALLBACK'));

  const weights = WEIGHT_PROFILES[chosenProfile];
  const taskClass =
    profile.complexity === 'complex' || profile.complexity === 'large'
      ? 'long-form'
      : profile.complexity === 'short' || profile.complexity === 'trivial'
        ? 'short-form'
        : 'standard';
  const recommendedModelClass =
    chosenProfile === 'LATENCY_FIRST'
      ? 'fast'
      : chosenProfile === 'QUALITY_FIRST'
        ? 'high-quality'
        : 'balanced';

  return {
    jevOutcome: jevDecided ? jev.Outcome.DECIDED : jev.Outcome.UNDECIDED,
    decidedBy,
    weightProfile: chosenProfile,
    weights,
    taskClass,
    difficulty: String(profile.complexity),
    latencyPriority: profile.latencyPriority,
    recommendedModelClass,
    confidence: jevDecided ? result.confidence : 0,
    probabilities: jevDecided && result.probabilities ? result.probabilities : null,
    jevModel: jevDecided && result.jevModel ? result.jevModel : null,
    usage: jevDecided && result.usage ? result.usage : null,
    reasonCodes,
    reason: (result.jev && result.jev.reason) || result.reason || null,
  };
}

/** The Claude-family policy refusal for a role and model id, or null. */
function claudeFamilyExclusion(role, modelId) {
  if (!WORKER_REVIEWER_ROLES.has(role)) return null;
  if (!CLAUDE_FAMILY_PATTERN.test(String(modelId || ''))) return null;
  return CLAUDE_FAMILY_REASON;
}

const publisher = require('./publisher');

function failureDomainFromCandidateKey(key) {
  if (typeof publisher.failureDomainFromCandidateKey === 'function') {
    return publisher.failureDomainFromCandidateKey(key);
  }
  const parts = String(key || '').split('::');
  if (parts.length !== 7) return null;
  const domain = [parts[2], parts[3]].filter((p) => p && p !== '*');
  return domain.length ? domain.join('/') : 'unknown';
}

let upstreamGatewayIndex = null;
function getUpstreamGatewayIndex() {
  if (upstreamGatewayIndex) return upstreamGatewayIndex;
  upstreamGatewayIndex = new Map();
  try {
    const catFile = path.join(__dirname, 'data', 'discovery', 'catalogue.jsonl');
    if (fs.existsSync(catFile)) {
      const raw = fs.readFileSync(catFile, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.upstream && entry.gateway && !upstreamGatewayIndex.has(entry.upstream)) {
            upstreamGatewayIndex.set(entry.upstream, entry.gateway);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  try {
    const { loadSources } = require('./sources');
    const loaded = loadSources();
    for (const src of (loaded && loaded.sources) || []) {
      if (src.routerAlias && src.reachedVia && !upstreamGatewayIndex.has(src.routerAlias)) {
        upstreamGatewayIndex.set(src.routerAlias, src.reachedVia);
      }
    }
  } catch (_) {}
  return upstreamGatewayIndex;
}

function resolveGatewayForUpstream(upstream) {
  if (!upstream || upstream === '*') return '';
  const idx = getUpstreamGatewayIndex();
  return idx.get(upstream) || '';
}

function canonicalFailureDomain(x) {
  if (!x) return 'unknown';
  if (typeof x === 'object') {
    if (x.gateway && x.upstream && x.gateway !== '*') {
      return `${x.gateway}/${x.upstream}`;
    }
    if (x.candidateKey) {
      const fromKey = failureDomainFromCandidateKey(x.candidateKey);
      if (fromKey && fromKey !== 'unknown') return fromKey;
    }
    const gw = x.gateway && x.gateway !== '*' ? x.gateway : resolveGatewayForUpstream(x.upstream);
    const up = x.upstream && x.upstream !== '*' ? x.upstream : '';
    const parts = [gw, up].filter(Boolean);
    return parts.length ? parts.join('/') : 'unknown';
  }

  const str = String(x).trim();
  if (str.includes('::')) {
    const fromKey = failureDomainFromCandidateKey(str);
    if (fromKey) return fromKey;
  }
  if (str.includes('/')) {
    const parts = str.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    if (parts.length === 1) return canonicalFailureDomain(parts[0]);
    return str;
  }
  const gw = resolveGatewayForUpstream(str);
  if (gw) {
    return `${gw}/${str}`;
  }
  return str;
}

/**
 * A candidate's failure domain, in the vocabulary the Controller's
 * failure-classifier scopes already use. The display form joins the concrete
 * parts; `null` parts are dropped so an empty domain is visible, not guessed.
 */
function failureDomainOf(candidate) {
  return canonicalFailureDomain(candidate);
}

/** Compare candidates using the canonical identity for a classified failure scope. */
function sameFailureDomain(candidate, failed, classification) {
  if (!candidate || !failed || !classification) return false;
  const scope = classification.scope || 'unknown';
  const sameRoute = () => {
    const leftDomain = failureDomainOf(candidate);
    const rightDomain = failureDomainOf(failed);
    return leftDomain !== 'unknown' && rightDomain !== 'unknown' && leftDomain === rightDomain;
  };

  if (scope === 'gateway') {
    if (
      !candidate.gateway ||
      !failed.gateway ||
      candidate.gateway === '*' ||
      failed.gateway === '*'
    ) {
      return false;
    }
    return candidate.gateway === failed.gateway;
  }
  if (scope === 'upstream') {
    if (candidate.gateway === '*' || failed.gateway === '*') {
      return false;
    }
    return sameRoute();
  }
  if (scope === 'account') {
    return (
      candidate.accountId &&
      failed.accountId &&
      candidate.accountId !== '*' &&
      failed.accountId !== '*' &&
      canonicalFailureDomain(candidate.accountId) === canonicalFailureDomain(failed.accountId)
    );
  }
  if (scope === 'candidate' || scope === 'model') {
    return (
      sameRoute() &&
      Boolean(
        (candidate.modelId || candidate.model) &&
        (candidate.modelId || candidate.model) === (failed.modelId || failed.model)
      )
    );
  }
  if (scope === 'access_path')
    return candidate.accessPath && candidate.accessPath === failed.accessPath;
  if (scope === 'harness') {
    if (classification.cause === 'launch_config') return false;
    return candidate.harness && candidate.harness === failed.harness;
  }
  return false;
}

/** Whether any identity dimension of the candidate is an explicitly forbidden domain. */
function matchesForbiddenDomain(candidate, forbiddenFailureDomains) {
  const domains = new Set(forbiddenFailureDomains || []);
  if (domains.size === 0) return false;
  const fields = [
    candidate.gateway,
    candidate.upstream,
    candidate.accountId,
    candidate.accessPath,
    candidate.harness,
  ];
  return fields.some((f) => f !== undefined && f !== null && f !== '*' && domains.has(f));
}

function isForbiddenCandidate(candidate, forbiddenFailureDomains) {
  if (!forbiddenFailureDomains || forbiddenFailureDomains.length === 0) return false;
  if (matchesForbiddenDomain(candidate, forbiddenFailureDomains)) return true;
  const candCanonical = canonicalFailureDomain(candidate);
  for (const f of forbiddenFailureDomains) {
    if (!f) continue;
    const fCanonical = canonicalFailureDomain(f);
    if (fCanonical && candCanonical === fCanonical) return true;
    if (typeof f === 'string') {
      const parts = f.split('/').filter(Boolean);
      for (const p of parts) {
        if (p && (candidate.upstream === p || candidate.gateway === p)) return true;
      }
    }
  }
  return false;
}

function hasQuotaAccountReadings(home, storePath) {
  try {
    const file = quotaStore.storePath({ home, path: storePath });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Boolean(parsed && parsed.accounts && Object.keys(parsed.accounts).length > 0);
  } catch {
    return false;
  }
}

/**
 * Failure causes that name the *route*, never the model. Quota exhaustion,
 * rate limits, timeouts, launch/harness configuration and a live cooldown all
 * expire on their own; the ability the model demonstrated does not expire with
 * them (TASK-AI-141 Part B).
 */
const INFRASTRUCTURE_CAUSES = new Set(
  [
    Cause.QUOTA_EXHAUSTED,
    Cause.UPSTREAM_CREDIT_EXHAUSTED,
    Cause.UPSTREAM_MONTHLY_LIMIT,
    Cause.UPSTREAM_RATE_LIMIT,
    Cause.ACCOUNT_QUOTA_EXHAUSTED,
    Cause.GENUINE_CAPACITY,
    Cause.EXHAUSTION_HIDING,
    Cause.TIMEOUT,
    Cause.LAUNCH_CONFIG,
    Cause.HARNESS_FAILED,
  ].map(failureToken)
);

/**
 * Scopes that blame this machine or the transport — launch, harness and
 * network — rather than anything the model said or produced.
 */
const INFRASTRUCTURE_SCOPES = new Set(
  [Scope.LOCAL, Scope.HARNESS, Scope.GATEWAY].map(failureToken)
);

/** A failure whose only meaning is that the model itself did not serve it. */
function isModelScopeFailure(cause, scope) {
  const normalizedCause = failureToken(cause);
  const normalizedScope = failureToken(scope);
  return (
    normalizedScope === failureToken(Scope.MODEL) ||
    normalizedCause === failureToken(Cause.MODEL_UNSUPPORTED) ||
    normalizedCause === failureToken(Cause.ALIAS_MISMATCH)
  );
}

/** Free text that can only have come from quota, rate, timeout or network. */
const INFRASTRUCTURE_TEXT =
  /quota|rate[\s_-]*limit|too many requests|\b429\b|cooldown|exhaust|capacity|timed?\s*out|timeout|econnrefused|etimedout|network|unavailable/i;

/** Review verdicts and proof states that are about quality, not availability. */
const QUALITY_VERDICTS = new Set(['changes_required', 'refused', 'refuse', 'rejected', 'reject']);

/** Normalize a cause, scope, status or block reason to its classification token. */
function failureToken(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return value
    .trim()
    .split('(')[0]
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Everything an evidence item says about why it failed, as one text. */
function failureText(item) {
  return [item && item.cause, item && item.body, item && item.message, item && item.error]
    .filter(Boolean)
    .join(' ');
}

/**
 * The classifier's answer for one failed evidence item: the stored cause and
 * scope when the recorder wrote them, otherwise the classification the item's
 * own signals produce. An unclassified failure is never assumed to be benign.
 */
function itemClassification(item) {
  const cause = failureToken(item.cause);
  const scope = failureToken(item.scope);
  if (cause || scope) return { cause, scope };
  const classification = classifyFailure({
    exitCode: item.exitCode,
    httpStatus: item.httpStatus,
    body: item.body || item.message || (typeof item.error === 'string' ? item.error : ''),
    stderr: item.stderr || '',
    accountId: item.accountId,
  });
  return { cause: failureToken(classification.cause), scope: failureToken(classification.scope) };
}

/**
 * Is this failure purely infrastructure? Fail closed: anything that is not
 * recognizably quota, rate limit, timeout, launch/harness/network/local scope
 * or an open cooldown does not clear the source path.
 */
function isInfrastructureFailure(cause, scope, text) {
  const c = failureToken(cause);
  const s = failureToken(scope);
  if (isModelScopeFailure(c, s)) return false;
  if (INFRASTRUCTURE_CAUSES.has(c)) return true;
  if (INFRASTRUCTURE_SCOPES.has(s)) return true;
  return INFRASTRUCTURE_TEXT.test(String(text || ''));
}

/** Is this blocked source path out of the way for infrastructure reasons only? */
function isInfrastructureBlock(block) {
  if (!block || !block.blocked) return true;
  return isInfrastructureFailure(block.cause, block.scope, [block.reason, block.cause].join(' '));
}

/** Did this evidence item record a quality outcome rather than an outage? */
function isQualityVerdict(item) {
  if (!item) return false;
  if (item.revoked === true || failureToken(item.status) === 'revoked') return true;
  for (const field of ['verdict', 'review', 'reviewVerdict', 'reviewStatus', 'decision']) {
    if (QUALITY_VERDICTS.has(failureToken(item[field]))) return true;
  }
  const status = failureToken(item.status);
  return status === 'changes_required' || status === 'refused';
}

/**
 * May this source path lend its WORK_ITEM_PASS to another candidate?
 *
 * A path blocked or failed for infrastructure reasons — quota exhausted, rate
 * limited, timed out, launch/harness/network/local scope, open cooldown — has
 * lost the route, not the model's ability, so the proof still transfers. Only
 * a quality failure disqualifies it: a review that came back CHANGES_REQUIRED
 * or refused, a model-scope failure, or a revoked proof.
 */
function sourcePathLendsProof(evidenceData, combo, parsed) {
  if (!isInfrastructureBlock(evidence.isCandidateBlocked(evidenceData, parsed))) return false;
  for (const item of combo.evidence || []) {
    if (isQualityVerdict(item)) return false;
    if (failureToken(item.status) !== 'failed') continue;
    const { cause, scope } = itemClassification(item);
    if (!isInfrastructureFailure(cause, scope, failureText(item))) return false;
  }
  return true;
}

/**
 * The strongest proof level a candidate has *passed*. Failed evidence carries a
 * proofLevel too, and counting it would let a candidate that just failed pose
 * as proven, so only passed items are considered.
 */
function proofObservedWithSource(evidenceData, candidate) {
  let items = evidence.getEvidence(evidenceData, candidate) || [];
  let proofSource = items.length > 0 ? candidateKey(candidate) : null;
  if (items.length === 0 && evidenceData && candidate) {
    const keyed = evidenceData[candidateKey(candidate)];
    if (Array.isArray(keyed)) {
      items = keyed;
      if (items.length > 0) proofSource = candidateKey(candidate);
    }
  }
  if (items.length === 0 && Array.isArray(candidate && candidate.evidence)) {
    items = candidate.evidence;
    if (items.length > 0) proofSource = candidateKey(candidate);
  }
  const passed = (items || []).filter((e) => e.status === 'passed');
  const direct = evidence.proofLevelOf(passed);
  const ownBlocked = evidence.isCandidateBlocked(evidenceData, candidate).blocked;
  const ownFailed = (items || []).some((item) => item.status === 'failed');
  const quotaExhausted =
    candidate &&
    (candidate.headroomStatus === 'exhausted' ||
      candidate.quotaStatus === 'exhausted' ||
      candidate.remainingPercent === 0 ||
      candidate.remainingPercent === '0' ||
      candidate.headroom === 'exhausted');
  if (ownBlocked || ownFailed || quotaExhausted) {
    return { level: null, source: null, transferred: false };
  }
  if (direct) return { level: direct, source: proofSource, transferred: false };

  // Proof describes the backend model's ability; quota, cooldown and failures
  // remain attached to the candidate identity above. Transfer only the
  // highest proof tier, and only when both model ids normalize to a known,
  // non-empty backend id under registry-declared route prefixes. A source
  // path that is out of quota or otherwise blocked for infrastructure reasons
  // keeps its proof; only a quality failure on that path takes it away.
  const targetModel = candidate && (candidate.modelId || candidate.model);
  const targetModelId = normalizedBackendModel(targetModel, BACKEND_MODEL_PREFIXES, candidate);
  if (!targetModelId) {
    return { level: null, source: null, transferred: false };
  }
  let best = null;
  for (const combo of (evidenceData && evidenceData.combinations) || []) {
    const parsed = {
      harness: combo.harness,
      accessPath: combo.accessPath,
      gateway: combo.gateway,
      upstream: combo.upstream,
      account: combo.accountId,
      quotaScope: combo.quotaScope,
      modelId: combo.modelId || combo.model,
    };
    const sourceModelId = normalizedBackendModel(parsed.modelId, BACKEND_MODEL_PREFIXES, parsed);
    if (!sourceModelId || sourceModelId !== targetModelId) continue;
    // An unprefixed historical model name does not identify which provider
    // route produced it. Keep that proof path-scoped; transfer only when the
    // recorded source model explicitly carries its own upstream alias.
    if (!parsed.upstream || !parsed.modelId.startsWith(parsed.upstream + '/')) continue;
    if (!sourcePathLendsProof(evidenceData, combo, parsed)) continue;
    const level = evidence.proofLevelOf(
      (combo.evidence || []).filter((e) => e.status === 'passed')
    );
    if (level !== evidence.ProofLevel.WORK_ITEM_PASS) continue;
    if (!best) best = { level, source: candidateKey(parsed), sourceModel: parsed.modelId };
  }
  return best
    ? { level: best.level, source: best.source, sourceModel: best.sourceModel, transferred: true }
    : { level: null, source: null, transferred: false };
}

function normalizedBackendModel(modelId, prefixes, identity) {
  if (typeof modelId !== 'string' || !modelId.trim() || modelId.includes('*')) return '';
  let normalized = modelId.trim().replace(/\r$/, '');
  const routePrefix = (identity && identity.upstream ? identity.upstream + '/' : '') || '';
  if (routePrefix && normalized.startsWith(routePrefix)) {
    normalized = normalized.slice(routePrefix.length);
  }
  const declaredPrefix = (prefixes || []).find((prefix) => normalized.startsWith(prefix));
  if (declaredPrefix) {
    if (routePrefix && !declaredPrefix.startsWith(routePrefix)) return '';
    if (!routePrefix && identity && identity.gateway) return '';
    normalized = normalized.slice(declaredPrefix.length);
  }
  if (!normalized || normalized.includes('*') || !/[a-z0-9]/i.test(normalized)) return '';
  if (normalized.includes('/')) return '';
  return normalized.toLowerCase();
}

function proofObserved(evidenceData, candidate) {
  return proofObservedWithSource(evidenceData, candidate).level;
}

function candidateContextWindow(candidate) {
  const caps = candidate && candidate.capabilities;
  return (
    candidate &&
    (candidate.contextWindow ||
      candidate.context_window ||
      (caps && (caps.contextWindow || caps.context_window || caps.contextTokens)))
  );
}

/** Blended per-million cost, accepting the numeric or the offering object form. */
function blendedCost(candidate) {
  const c = candidate && candidate.cost;
  if (c === null || c === undefined) return null;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (c && typeof c === 'object') {
    const input = Number(c.inputPerMillion);
    const output = Number(c.outputPerMillion);
    if (Number.isFinite(input) && Number.isFinite(output)) return input * 0.8 + output * 0.2;
  }
  return null;
}

function latencyScoreOf(candidate) {
  let raw =
    candidate.latencyMs !== undefined
      ? candidate.latencyMs
      : candidate.expectedDurationMs !== undefined
        ? candidate.expectedDurationMs
        : candidate.expectedLatencyMs;
  if ((raw === undefined || raw === null) && Array.isArray(candidate.evidence)) {
    for (const e of candidate.evidence) {
      if (e && Number.isFinite(Number(e.latencyMs))) {
        raw = Number(e.latencyMs);
        break;
      }
    }
  }
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const cap = 30 * 60 * 1000;
  return Math.round(100 * (1 - Math.min(1, Math.log10(1 + ms) / Math.log10(1 + cap))));
}

function qualityScoreOf(candidate, now) {
  const items = ((candidate && candidate.evidence) || []).filter((e) => e && e.status === 'passed');
  let base = null;
  let newestAt = null;

  if (items.length > 0) {
    base = 60; // API_PASS floor
    for (const e of items) {
      const level =
        e.proofLevel ||
        (e.level === 3 ? 'WORK_ITEM_PASS' : e.level === 2 ? 'HARNESS_PASS' : 'API_PASS');
      if (level === 'WORK_ITEM_PASS') {
        base = Math.max(base, 100);
      } else if (level === 'HARNESS_PASS') {
        base = Math.max(base, 80);
      } else if (level === 'API_PASS') {
        base = Math.max(base, 60);
      }
      const at = Date.parse(e.ts || e.at || '');
      if (Number.isFinite(at) && (newestAt === null || at > newestAt)) {
        newestAt = at;
      }
    }
  }

  const declared = Number(candidate && candidate.quality);
  if (Number.isFinite(declared)) {
    base = base !== null ? Math.max(base, declared) : declared;
  }

  if (base === null) return null;

  let recencyPenalty = 0;
  if (newestAt !== null) {
    const currentTime = now || Date.now();
    const ageMs = Math.max(0, currentTime - newestAt);
    recencyPenalty = Math.min(15, Math.round(15 * (ageMs / (30 * 24 * 60 * 60 * 1000))));
  }
  return Math.max(1, Math.min(100, Math.round(base - recencyPenalty)));
}

function reliabilityScoreOf(candidate) {
  const items = (candidate && candidate.evidence) || [];
  let passed = 0;
  let failed = 0;
  for (const e of items) {
    if (!e) continue;
    if (e.status === 'passed') passed += 1;
    else if (e.status === 'failed') failed += 1;
  }
  if (passed + failed === 0) return null;
  return Math.round(100 * (passed / (passed + failed)));
}

function costScoreOf(candidate) {
  const c = blendedCost(candidate);
  if (c === null) return null;
  if (c <= 0) return 100;
  return Math.round(100 * Math.max(0, 1 - Math.log10(1 + c) / Math.log10(1 + 1000000)));
}

/** Penalty for evidence whose newest passed item is old; 0 when fresh or absent. */
function evidenceAgePenalty(candidate, now) {
  const items = (candidate && candidate.evidence) || [];
  let newest = null;
  for (const e of items) {
    if (e.status !== 'passed') continue;
    const at = Date.parse(e.ts || e.at || '');
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  if (newest === null) return 0;
  const age = Math.max(0, now - newest);
  return Math.round(EVIDENCE_AGE_PENALTY_MAX * Math.min(1, age / EVIDENCE_AGE_TRUST_MS));
}

/**
 * Score one candidate against the assessment weights. Unknown sub-scores are
 * excluded and the total renormalised over the weights that are present, so an
 * unpriced candidate is never scored as cheap and an unmeasured one never as
 * fast.
 */
function scoreForProfile(candidate, assessment, ctx) {
  const now = (ctx && ctx.now) || Date.now();
  const prior = priorFor(candidate, ctx && ctx.role, ctx && ctx.priors);
  const latency = latencyScoreOf(candidate);
  const quality = qualityScoreOf(candidate, now);
  const reliability = reliabilityScoreOf(candidate);
  const cost = costScoreOf(candidate);

  const rawQualityWeight =
    assessment && assessment.weights && assessment.weights.quality !== undefined
      ? assessment.weights.quality
      : 33;
  let wQuality = rawQualityWeight;
  let wReliability = 0;
  if (assessment && assessment.weights && assessment.weights.reliability !== undefined) {
    wReliability = assessment.weights.reliability;
  } else if (rawQualityWeight > 0) {
    wReliability = Math.round(rawQualityWeight * 0.35);
    wQuality = rawQualityWeight - wReliability;
  }
  const wLatency =
    assessment && assessment.weights && assessment.weights.latency !== undefined
      ? assessment.weights.latency
      : 34;
  const wCost =
    assessment && assessment.weights && assessment.weights.cost !== undefined
      ? assessment.weights.cost
      : 33;

  const totalWeight = wQuality + wReliability + wLatency + wCost;

  let total = 0;
  if (quality !== null) total += wQuality * quality;
  if (reliability !== null) total += wReliability * reliability;
  if (latency !== null) total += wLatency * latency;
  if (cost !== null) total += wCost * cost;

  let score = totalWeight > 0 ? Math.round(total / totalWeight) : 0;

  const busy = ranking
    .reservationsForCandidate(candidate, ranking.getActiveReservations(ctx))
    .filter((r) => r && r.workItemId !== ctx.taskId).length;
  const busyPenalty = busy * BUSY_PENALTY_PER_RESERVATION;
  const agePenalty = evidenceAgePenalty(candidate, now);
  const headroomPenalty =
    candidate.headroomStatus === 'unknown' ? 15 : candidate.headroomStatus === 'tight' ? 10 : 0;
  score = Math.max(0, score - busyPenalty - agePenalty - headroomPenalty);
  if (prior) score += prior.bonus;

  return {
    score,
    breakdown: {
      latency,
      quality,
      reliability,
      cost,
      busyPenalty,
      evidenceAgePenalty: agePenalty,
      headroomPenalty,
      prior,
    },
    reservationsHeld: busy,
  };
}

/**
 * Controller ranking for a task profile.
 *
 * Filters are hard floors (proof, quality, capability, context, harness, cost,
 * availability, policy, forbidden failure domains, resource ceiling); the score
 * then optimises for the fastest candidate that meets the floors — not the
 * strongest one. Rejects are named so the caller can act on the cause.
 *
 * @returns { chosen, top3, ranking, rejected, refused, reason }
 */
function rankForProfile(candidates, profile, assessment, ctx) {
  const context = ctx || {};
  const now = context.now || Date.now();
  const priors = context.priors === undefined ? loadPriors() : context.priors;
  const explorationBudget = Number.isFinite(Number(context.explorationBudget))
    ? Number(context.explorationBudget)
    : 0;
  let quotaUnknownAdmitted = Number.isFinite(Number(context.priorUnknownQuota))
    ? Number(context.priorUnknownQuota)
    : 0;
  const ranked = [];
  const rejected = [];

  if (Number(profile.currentWorkload) >= Number(profile.resourceCeiling)) {
    return {
      chosen: null,
      top3: [],
      ranking: [],
      rejected: [],
      refused: 'RESOURCE_CEILING_REACHED',
      reason:
        'currentWorkload ' +
        profile.currentWorkload +
        ' >= resourceCeiling ' +
        profile.resourceCeiling,
    };
  }

  for (const c of candidates || []) {
    const key = candidateKey(c);
    const reject = (reasonCode, scope) =>
      rejected.push({
        candidateKey: key,
        reasonCode,
        scope: scope || 'candidate',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: c.accountId || '*',
      });

    const claudeReason = claudeFamilyExclusion(profile.role, c.modelId || c.model);
    if (claudeReason) {
      reject(claudeReason, 'model');
      continue;
    }
    if (c.blocked) {
      rejected.push({
        candidateKey: key,
        reasonCode: 'CANDIDATE_BLOCKED',
        reason: String(c.blockReason || 'upstream/candidate blocked'),
        scope: c.blockScope || 'candidate',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: c.accountId || '*',
      });
      continue;
    }
    const contextRefusalReason = contextRefusal(c.harness, candidateContextWindow(c));
    if (contextRefusalReason) {
      reject(contextRefusalReason, 'harness');
      continue;
    }
    if (profile.requiredHarness && c.harness !== profile.requiredHarness) {
      reject('HARNESS_NOT_REQUIRED', 'harness');
      continue;
    }
    if (isForbiddenCandidate(c, profile.forbiddenFailureDomains)) {
      reject('FORBIDDEN_FAILURE_DOMAIN', 'gateway');
      continue;
    }
    if (!c.accountId || c.accountId === '*') {
      reject('WILDCARD_ACCOUNT', 'account');
      continue;
    }

    const caps = c.capabilities || {};
    const missingCapability = (profile.requiredCapabilities || []).find((cap) => !caps[cap]);
    if (missingCapability) {
      reject('CAPABILITY_MISSING:' + missingCapability, 'capability');
      continue;
    }
    const contextWindow = Number(candidateContextWindow(c));
    if (Number.isFinite(contextWindow) && contextWindow < Number(profile.contextSize)) {
      reject('CONTEXT_TOO_SMALL', 'capability');
      continue;
    }

    const quality = Number(c.quality);
    if (Number.isFinite(quality) && quality < Number(profile.qualityFloor)) {
      reject('QUALITY_FLOOR_NOT_MET', 'candidate');
      continue;
    }
    const cost = blendedCost(c);
    if (cost !== null && cost > Number(profile.costCeiling)) {
      reject('COST_CEILING_EXCEEDED', 'candidate');
      continue;
    }

    const headroom = ranking.resolveCandidateHeadroom(c, context);
    c.headroomStatus = headroom.status;
    if (headroom.status === 'exhausted' || headroom.status === 'cooling') {
      reject(
        headroom.status === 'exhausted' ? 'QUOTA_EXHAUSTED' : 'COOLDOWN_ACTIVE',
        c.accountId && c.accountId !== '*' ? 'account' : 'quotaScope'
      );
      continue;
    }

    if (profile.proofFloor !== 'NONE') {
      const observedProof = proofObservedWithSource(context.evidenceData, c);
      const observed = observedProof.level;
      const observedRank = observed ? evidence.ProofRank[observed] : 0;
      if (observedRank < evidence.ProofRank[profile.proofFloor]) {
        reject('PROOF_FLOOR_NOT_MET:' + (observed || 'NONE'), 'candidate');
        continue;
      }
    }

    if (headroom.status === 'unknown') {
      if (context.enforceKnownQuota === true && quotaUnknownAdmitted >= explorationBudget) {
        reject('QUOTA_UNKNOWN_NO_EXPLORATION_BUDGET', 'quotaScope');
        continue;
      }
      quotaUnknownAdmitted += 1;
      c.quotaReasonCode =
        context.enforceKnownQuota === true
          ? 'QUOTA_UNKNOWN_EXPLORATION_BUDGET'
          : 'QUOTA_UNKNOWN_DRY_RUN_INSPECTION';
    }

    const scoreContext = Object.assign({}, context, {
      taskId: profile.taskId,
      now,
      role: profile.role,
      priors,
    });
    const scored = scoreForProfile(c, assessment, scoreContext);
    ranked.push(
      Object.assign({}, c, {
        candidateKey: key,
        score: scored.score,
        scoreBreakdown: scored.breakdown,
        reservationsHeld: scored.reservationsHeld,
        headroomStatus: headroom.status,
      })
    );
  }

  ranked.sort((a, b) => {
    const aPriorBonus = a.scoreBreakdown.prior ? a.scoreBreakdown.prior.bonus : 0;
    const bPriorBonus = b.scoreBreakdown.prior ? b.scoreBreakdown.prior.bonus : 0;
    const aBaseScore = a.score - aPriorBonus;
    const bBaseScore = b.score - bPriorBonus;
    if (bBaseScore !== aBaseScore) return bBaseScore - aBaseScore;
    if (bPriorBonus !== aPriorBonus) return bPriorBonus - aPriorBonus;
    if (a.reservationsHeld !== b.reservationsHeld) return a.reservationsHeld - b.reservationsHeld;
    return a.candidateKey.localeCompare(b.candidateKey);
  });

  const allZero =
    ranked.length > 0 &&
    ranked.every(
      (c) => c.score - (c.scoreBreakdown.prior ? c.scoreBreakdown.prior.bonus : 0) === 0
    );
  const top3 = ranked.slice(0, 3);
  const chosen = top3.length ? top3[0].candidateKey : null;
  const reasonCode = allZero ? 'MODEL_SELECTION_NOT_PROVEN' : null;
  const reason = chosen
    ? 'fastest candidate meeting quality floor ' +
      profile.qualityFloor +
      ' and proof floor ' +
      profile.proofFloor +
      ' (score ' +
      top3[0].score +
      ', weights ' +
      assessment.weightProfile +
      ')'
    : 'REFUSED: no candidate meets the profile floors';

  return {
    chosen,
    top3,
    ranking: ranked,
    rejected,
    refused: chosen ? null : 'NO_CANDIDATE_MEETS_PROFILE',
    reasonCode,
    reason,
  };
}

/** One line of the top-3 output the operator reads. */
function formatTopEntry(entry, rank) {
  const duration = entry.expectedDurationMs || entry.latencyMs;
  const durationText = Number.isFinite(Number(duration)) ? Number(duration) + 'ms' : 'unknown';
  return (
    '  ' +
    rank +
    '. ' +
    entry.candidateKey +
    ' | ' +
    durationText +
    ' | proof ' +
    (rankProofOf(entry) || 'unproven') +
    ' | quota ' +
    (entry.headroomStatus || 'unknown') +
    ' | failure-domain ' +
    failureDomainOf(entry) +
    ' | score ' +
    entry.score +
    (entry.reservationsHeld ? ' (busy: ' + entry.reservationsHeld + ' held)' : '')
  );
}

function jsonRejectedSlice(result, profile) {
  const requiredHarness = profile && profile.requiredHarness;
  const picked = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || seen.has(item.candidateKey)) return;
    seen.add(item.candidateKey);
    picked.push(item);
  };

  for (const r of result.rejected || []) {
    if (
      (requiredHarness && String(r.candidateKey || '').startsWith(requiredHarness + '::')) ||
      r.reasonCode === 'QUOTA_EXHAUSTED' ||
      r.reasonCode === 'COOLDOWN_ACTIVE'
    ) {
      add(r);
    }
  }
  for (const r of result.rejected || []) {
    if (picked.length >= REJECTED_RECORDED_LIMIT) break;
    add(r);
  }
  return picked.slice(0, REJECTED_RECORDED_LIMIT);
}

function rankProofOf(entry) {
  const items = (entry && entry.evidence) || [];
  return evidence.proofLevelOf(items.filter((e) => e.status === 'passed'));
}

/**
 * Stall assessment for a reported outcome, using the two contract thresholds.
 * `requestFinishStalled` marks a request that should have finished; a failed
 * outcome past the structured-failure window must be reselected, not awaited.
 */
function stallAssessment(outcome, now) {
  const at = Date.parse((outcome && outcome.lastProgressAt) || '');
  const hasProgress = Number.isFinite(at);
  const elapsed = hasProgress ? Math.max(0, now - at) : null;
  const failed = !['completed', 'passed', 'success'].includes(
    String((outcome && outcome.status) || '').toLowerCase()
  );
  return {
    lastProgressAt: (outcome && outcome.lastProgressAt) || null,
    elapsedMs: elapsed,
    requestFinishStalled: elapsed !== null && elapsed > STALL_REQUEST_FINISH_MS,
    reselectRequired: failed && (elapsed === null || elapsed > STALL_STRUCTURED_FAILURE_MS),
  };
}

/**
 * Apply a structured execution outcome for a pinned candidate: evidence and
 * cooldown are updated through the existing evidence store (which classifies
 * the failure and scopes the cooldown), and one decision-log line records the
 * whole outcome. The next ranking round reads exactly these stores, so it
 * sees the failure before it picks again.
 */
function reportDispatchOutcome(args, deps) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const rootDir = args.root || d.rootDir || process.cwd();
  const file = path.resolve(rootDir, args['report-outcome'] || args.reportOutcome);

  let outcome;
  try {
    outcome = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    error('OUTCOME_UNREADABLE: ' + file + ' (' + err.message + ')');
    exit(2);
    return { exitCode: 2 };
  }

  const parsedBeforeMapping =
    outcome && outcome.candidateKey ? parseCandidateKey(outcome.candidateKey) : null;
  if (
    outcome &&
    ((outcome.harness === 'agy-pool' && outcome.accountId) ||
      (parsedBeforeMapping &&
        parsedBeforeMapping.harness === 'agy-pool' &&
        parsedBeforeMapping.account))
  ) {
    const poolAccount = outcome.accountId || parsedBeforeMapping.account;
    const { isValidAccountId } = require('./agy-pool-runtime');
    if (!isValidAccountId(poolAccount)) {
      error('OUTCOME_INVALID: invalid agy-pool account: ' + String(poolAccount));
      exit(2);
      return { exitCode: 2, reason: 'INVALID_ACCOUNT_ID' };
    }
    const { getHarness } = require('./harness');
    const adapter = getHarness('agy-pool');
    const mapped = adapter.mapOutcome(poolAccount, outcome.candidateKey, {
      fakeRunsDir: d.fakeRunsDir,
      home: d.home,
    });
    outcome = Object.assign({}, outcome, mapped);
  }

  const missing = ['candidateKey', 'status'].filter(
    (f) => outcome[f] === undefined || outcome[f] === null || outcome[f] === ''
  );
  const parsed = parseCandidateKey(outcome.candidateKey);
  if (missing.length || !parsed) {
    error(
      'OUTCOME_INVALID: ' +
        (missing.length ? 'missing ' + missing.join(', ') : 'candidateKey is not a 7-part key')
    );
    exit(2);
    return { exitCode: 2, missing };
  }

  const candidate = {
    harness: parsed.harness,
    accessPath: parsed.accessPath,
    gateway: parsed.gateway,
    upstream: parsed.upstream,
    accountId: parsed.account,
    quotaScope: parsed.quotaScope,
    modelId: parsed.modelId,
  };
  const now = d.now || Date.now();
  const passed = ['completed', 'passed', 'success'].includes(String(outcome.status).toLowerCase());
  const failed = ['failed', 'error', 'aborted', 'refused', 'timeout', 'cancelled'].includes(
    String(outcome.status).toLowerCase()
  );
  const terminal = passed || failed;
  const stall = stallAssessment(outcome, now);
  const evidenceDir = d.evidenceDir || path.join(__dirname, 'data', 'evidence');

  if (terminal) {
    evidence.recordOutcome(evidenceDir, candidate, {
      status: failed ? 'failed' : 'passed',
      exitCode: failed ? 1 : 0,
      body: typeof outcome.reason === 'string' ? outcome.reason : null,
      stderr: typeof outcome.reason === 'string' ? outcome.reason : null,
      cause: typeof outcome.errorClass === 'string' ? outcome.errorClass : null,
      httpStatus: Number.isFinite(Number(outcome.httpStatus))
        ? Number(outcome.httpStatus)
        : undefined,
      // The reporter observed when this budget clears. Passing it through is what
      // keeps "quota exhausted until 01:55" from decaying into a five-minute
      // cooldown the classifier scraped out of a message.
      cooldownUntil:
        failed && outcome.cooldownUntil !== undefined ? outcome.cooldownUntil : undefined,
      level: evidence.Level.API,
      source: 'report-outcome',
    });

    const quotaStore = require('./quota-store');
    const targetPath = quotaStore.storePath({ home: d.home, path: d.storePath });
    quotaStore.releaseReservation(
      outcome.taskId || outcome.workItemId || 'TASK-REPORT-OUTCOME',
      outcome.candidateKey,
      {
        home: d.home,
        path: targetPath,
        now,
      }
    );
  }

  const recorded = {
    stage: terminal
      ? failed
        ? decisions.Stage.FAILED
        : decisions.Stage.COMPLETED
      : decisions.Stage.RESUMED,
    workItemId: outcome.taskId || 'TASK-REPORT-OUTCOME',
    role: outcome.role || null,
    chosen: outcome.candidateKey,
    outcome,
    stall,
    detail: terminal
      ? failed
        ? stall.reselectRequired
          ? 'STRUCTURED_FAILURE_RESELECT_REQUIRED'
          : 'STRUCTURED_FAILURE_REPORTED'
        : 'OUTCOME_REPORTED'
      : 'PROGRESS_REPORTED',
  };
  decisions.recordDecision(recorded, { dir: d.decisionDir, now });

  log(
    'Outcome ' +
      (terminal ? (failed ? 'FAILED' : 'COMPLETED') : 'IN_PROGRESS') +
      ' for ' +
      outcome.candidateKey +
      (outcome.errorClass ? ' (class ' + outcome.errorClass + ')' : '') +
      (terminal ? '; evidence and cooldown updated' : '; progress reported') +
      (stall.reselectRequired
        ? '; RESELECT_REQUIRED (past ' + STALL_STRUCTURED_FAILURE_MS + 'ms)'
        : '')
  );
  exit(0);
  return { exitCode: 0, failed, stall, recorded };
}

/**
 * The profile dispatch itself: validate, assess with JEV, rank with the
 * Controller, record the decision, print the top 3 and pin rank 1. In
 * `--execute` the pin carries a quota-store reservation; in `--dry-run` the
 * pinned key is returned without launching or reserving.
 */
async function runProfileDispatch(args, deps) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const rootDir = args.root || d.rootDir || process.cwd();
  const file = path.resolve(rootDir, args.profile);

  let rawProfile;
  try {
    rawProfile = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    error('PROFILE_UNREADABLE: ' + file + ' (' + err.message + ')');
    exit(2);
    return { exitCode: 2 };
  }

  const { valid, errors } = validateTaskProfile(rawProfile);
  if (!valid) {
    error('PROFILE_INVALID: ' + errors.map((e) => e.field + '(' + e.code + ')').join(', '));
    exit(2);
    return { exitCode: 2, profileErrors: errors };
  }
  const profile = rawProfile;

  const assessment = await assessTask(profile, {
    ask: d.ask,
    minConfidence: d.minConfidence,
  });

  const evidenceDir =
    d.evidenceDir || args['evidence-dir'] || path.join(__dirname, 'data', 'evidence');
  const evidenceData = evidence.loadEvidence(evidenceDir);
  const now = d.now || Date.now();
  const annotated = candidatesApi.annotateCandidates(
    (d.candidates || []).map((c) => Object.assign({}, c)),
    evidenceData,
    { now }
  );

  const rankCtx = {
    now,
    priors: d.priors,
    taskId: profile.taskId,
    evidenceData,
    headrooms: d.headrooms,
    reservations: d.reservations,
    accounts: d.accounts,
    useStoredQuota: d.useStoredQuota !== false,
    home: d.home,
    storePath: d.storePath,
    explorationBudget:
      d.explorationBudget !== undefined
        ? Number(d.explorationBudget)
        : args['exploration-budget'] !== undefined
          ? Number(args['exploration-budget'])
          : 0,
    enforceKnownQuota: args.execute === true && hasQuotaAccountReadings(d.home, d.storePath),
  };
  const result = rankForProfile(annotated, profile, assessment, rankCtx);
  const execute = args.execute === true;

  if (result.reasonCode === 'MODEL_SELECTION_NOT_PROVEN' && execute) {
    if (rankCtx.explorationBudget <= 0) {
      const refusedCode = 'MODEL_SELECTION_NOT_PROVEN';
      log('Refusing to reserve unproven candidates without exploration budget: ' + result.reason);
      if (args.json) {
        log(
          JSON.stringify(
            {
              profile,
              assessment,
              top3: result.top3,
              rejected: jsonRejectedSlice(result, profile),
              rejectedCount: result.rejected.length,
              refused: refusedCode,
              reasonCode: refusedCode,
              pinned: null,
            },
            null,
            2
          )
        );
      }
      exit(1);
      return {
        exitCode: 1,
        profile,
        assessment,
        refused: refusedCode,
        reasonCode: refusedCode,
        rejected: result.rejected,
      };
    } else {
      result.reasonCode = 'EXPLORATION';
      if (result.top3 && result.top3.length > 0) {
        result.top3[0].quotaReasonCode = 'EXPLORATION';
      }
    }
  }

  // The decision log is the trace: profile, JEV result, full ranking, final
  // candidate — written even in a dry run, because the ranking decision is
  // real even when the launch is not (AI-64-R03's standard, applied here).
  const decisionRecorded = {
    stage: decisions.Stage.SELECTED,
    workItemId: profile.taskId,
    role: profile.role,
    taskProfile: profile,
    jev: assessment,
    weightProfile: assessment.weightProfile,
    jevModel: assessment.jevModel || null,
    confidence: assessment.confidence !== undefined ? assessment.confidence : null,
    probabilities: assessment.probabilities || null,
    ranking: result.ranking.map((c) => ({
      candidateKey: c.candidateKey,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      headroom: c.headroomStatus || 'unknown',
      failureDomain: canonicalFailureDomain(c),
      account:
        !c.accountId || c.accountId === '*' || c.accountId === 'UNPINNED'
          ? 'UNPINNED'
          : c.accountId,
      reservationsHeld: c.reservationsHeld || 0,
      quotaReasonCode: c.quotaReasonCode || null,
      proof: proofObserved(evidenceData, c) || 'NONE',
      proofSource: (() => {
        const proof = proofObservedWithSource(evidenceData, c);
        return proof.transferred
          ? { candidateKey: proof.source, modelId: proof.sourceModel }
          : null;
      })(),
      capabilityEvidence: c.capabilities || {},
    })),
    rejected: jsonRejectedSlice(result, profile),
    rejectedCount: result.rejected.length,
    chosen: result.chosen,
    reason: result.reason,
    reasonCode: result.reasonCode || null,
  };
  decisions.recordDecision(decisionRecorded, {
    dir: args['decision-dir'] || d.decisionDir,
    now,
  });

  log('Task profile ' + profile.taskId + ' (role ' + profile.role + ')');
  log(
    'JEV ' +
      assessment.jevOutcome +
      (assessment.jevOutcome === jev.Outcome.DECIDED
        ? ' (confidence ' + assessment.confidence + ')'
        : ' (' + String(assessment.reasonCodes[0]) + ')') +
      ' -> Controller weights ' +
      assessment.weightProfile +
      ' (decided by ' +
      assessment.decidedBy +
      ', model class ' +
      assessment.recommendedModelClass +
      ')'
  );

  if (!result.chosen) {
    const refusedCode = result.refused || result.reasonCode || 'NO_CANDIDATE_MEETS_PROFILE';
    log('No candidate meets the profile: ' + result.reason);
    const byCode = new Map();
    for (const r of result.rejected) {
      byCode.set(r.reasonCode, (byCode.get(r.reasonCode) || 0) + 1);
    }
    for (const [code, count] of byCode) log('  EXCLUDED ' + count + 'x ' + code);
    if (args.json) {
      log(
        JSON.stringify(
          {
            profile,
            assessment,
            top3: result.top3,
            rejected: jsonRejectedSlice(result, profile),
            rejectedCount: result.rejected.length,
            refused: refusedCode,
            reasonCode: result.reasonCode || refusedCode,
            pinned: null,
          },
          null,
          2
        )
      );
    }
    exit(1);
    return {
      exitCode: 1,
      profile,
      assessment,
      refused: refusedCode,
      reasonCode: result.reasonCode || refusedCode,
      rejected: result.rejected,
    };
  }

  log('Top candidates:');
  result.top3.forEach((entry, i) => log(formatTopEntry(entry, i + 1)));

  let reserved = false;
  let reservationId = null;
  let launchRequest = null;

  if (execute) {
    const chosenCandidate = result.ranking.find((c) => c.candidateKey === result.chosen) || {};
    const parsedKey = parseCandidateKey(result.chosen) || {};
    const harness = chosenCandidate.harness || parsedKey.harness;
    const accessPath = chosenCandidate.accessPath || parsedKey.accessPath;
    const gateway =
      chosenCandidate.gateway !== undefined ? chosenCandidate.gateway : parsedKey.gateway || '';
    const upstream = chosenCandidate.upstream || parsedKey.upstream;
    let account = chosenCandidate.accountId || parsedKey.account;
    if (!account || account === '*' || account === 'UNPINNED') {
      account = 'UNPINNED';
    }
    const modelId = chosenCandidate.modelId || parsedKey.modelId;
    reservationId = `${profile.taskId}::${result.chosen}`;

    launchRequest = {
      candidateKey: result.chosen,
      harness,
      accessPath,
      gateway,
      upstream,
      account,
      modelId,
      reservationId,
    };

    quotaStore.recordReservation(profile.taskId, profile.role, account, result.chosen, 100000, {
      home: d.home,
      path: d.storePath,
      now,
    });
    reserved = true;
    log('Reserved rank 1 (quota-store): ' + result.chosen);
  }

  const pinned = result.chosen;
  log((execute ? 'Pinned for execution: ' : 'Pinned (dry run, no reservation): ') + pinned);

  if (execute && (args.launch === true || args.launch)) {
    const launcher = d.launcher || args.launcher || defaultLauncher;
    const origGw = launchRequest.gateway;
    const origUp = launchRequest.upstream;
    const origAcc = launchRequest.account;
    const origModel = launchRequest.modelId;

    let launchResult = null;
    let launchFailed = false;
    let launchError = null;

    try {
      launchResult = await launcher(launchRequest);
      if (
        launchResult &&
        (launchResult.status === 'failed' ||
          launchResult.status === 'error' ||
          launchResult.failed === true ||
          (typeof launchResult.exitCode === 'number' && launchResult.exitCode !== 0))
      ) {
        launchFailed = true;
      }
    } catch (err) {
      launchFailed = true;
      launchError = err;
    }

    if (
      launchRequest.gateway !== origGw ||
      launchRequest.upstream !== origUp ||
      launchRequest.account !== origAcc ||
      launchRequest.modelId !== origModel
    ) {
      throw new Error(
        'LAUNCHER_MUTATION_FORBIDDEN: launcher must not alter gateway/upstream/account/model'
      );
    }

    if (launchFailed) {
      quotaStore.releaseReservation(profile.taskId, launchRequest.candidateKey, {
        home: d.home,
        path: d.storePath,
        now,
      });

      decisions.recordDecision(
        {
          stage: decisions.Stage.FAILED,
          workItemId: profile.taskId,
          role: profile.role,
          chosen: launchRequest.candidateKey,
          reservationId: launchRequest.reservationId,
          launchRequest,
          outcome: launchResult || {
            status: 'failed',
            error: (launchError && launchError.message) || String(launchError),
          },
          detail: 'LAUNCH_FAILED',
        },
        { dir: args['decision-dir'] || d.decisionDir, now }
      );

      log('Launch FAILED for ' + launchRequest.candidateKey);
      exit(1);
      return {
        exitCode: 1,
        profile,
        assessment,
        ranking: result.ranking,
        top3: result.top3,
        rejected: result.rejected,
        pinnedCandidateKey: pinned,
        reserved: false,
        reservationId,
        launchRequest,
        launchResult,
        launchError,
      };
    }

    decisions.recordDecision(
      {
        stage: decisions.Stage.COMPLETED,
        workItemId: profile.taskId,
        role: profile.role,
        chosen: launchRequest.candidateKey,
        reservationId: launchRequest.reservationId,
        launchRequest,
        outcome: launchResult || { status: 'completed' },
        detail: 'LAUNCH_SUCCESS',
      },
      { dir: args['decision-dir'] || d.decisionDir, now }
    );

    log('Launch SUCCESS for ' + launchRequest.candidateKey);
  }

  if (args.json) {
    log(
      JSON.stringify(
        {
          profile,
          assessment,
          top3: result.top3,
          rejected: jsonRejectedSlice(result, profile),
          rejectedCount: result.rejected.length,
          pinned,
          launchRequest,
        },
        null,
        2
      )
    );
  }

  if (exit === process.exit) {
    process.exitCode = 0;
  } else {
    exit(0);
  }
  return {
    exitCode: 0,
    profile,
    assessment,
    ranking: result.ranking,
    top3: result.top3,
    rejected: result.rejected,
    pinnedCandidateKey: pinned,
    reserved,
    reservationId,
    launchRequest,
  };
}

async function defaultLauncher(request) {
  const { getHarness } = require('./harness');
  const adapter = getHarness(request.harness);
  if (!adapter) {
    throw new Error('UNKNOWN_HARNESS: ' + request.harness);
  }
  const job = {
    candidateKey: request.candidateKey,
    harness: request.harness,
    accessPath: request.accessPath,
    gateway: request.gateway,
    upstream: request.upstream,
    account: request.account,
    accountId: request.account,
    modelId: request.modelId,
    model: request.modelId,
    reservationId: request.reservationId,
  };
  const launchArgs = adapter.launch(job);
  if (launchArgs && !Array.isArray(launchArgs) && (launchArgs.refusal || launchArgs.error)) {
    return {
      status: 'failed',
      reason: launchArgs.reason || launchArgs.refusal || launchArgs.error,
    };
  }
  return { status: 'completed', launchArgs };
}

module.exports = {
  TASK_ROLES,
  WORKER_REVIEWER_ROLES,
  PROOF_FLOORS,
  WEIGHT_PROFILES,
  ROLE_FALLBACK_PROFILE,
  CLAUDE_FAMILY_PATTERN,
  CLAUDE_FAMILY_REASON,
  STALL_REQUEST_FINISH_MS,
  STALL_STRUCTURED_FAILURE_MS,
  PROFILE_SCHEMA,
  validateTaskProfile,
  jevQuestion,
  controllerFallbackProfile,
  assessTask,
  claudeFamilyExclusion,
  canonicalFailureDomain,
  failureDomainOf,
  sameFailureDomain,
  matchesForbiddenDomain,
  proofObserved,
  proofObservedWithSource,
  rankForProfile,
  scoreForProfile,
  latencyScoreOf,
  qualityScoreOf,
  costScoreOf,
  blendedCost,
  stallAssessment,
  reportDispatchOutcome,
  runProfileDispatch,
};
