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
const { candidateKey, parseCandidateKey } = require('./discovery/identity');
const { contextRefusal } = require('./harness');

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

/**
 * A candidate's failure domain, in the vocabulary the Controller's
 * failure-classifier scopes already use. The display form joins the concrete
 * parts; `null` parts are dropped so an empty domain is visible, not guessed.
 */
function failureDomainOf(candidate) {
  const parts = [candidate.gateway, candidate.upstream].filter(
    (p) => p !== undefined && p !== null && p !== '' && p !== '*'
  );
  return parts.length ? parts.join('/') : 'unknown';
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

/**
 * The strongest proof level a candidate has *passed*. Failed evidence carries a
 * proofLevel too, and counting it would let a candidate that just failed pose
 * as proven, so only passed items are considered.
 */
function proofObserved(evidenceData, candidate) {
  const passed = (evidence.getEvidence(evidenceData, candidate) || []).filter(
    (e) => e.status === 'passed'
  );
  return evidence.proofLevelOf(passed);
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
  const raw =
    candidate.latencyMs !== undefined
      ? candidate.latencyMs
      : candidate.expectedDurationMs !== undefined
        ? candidate.expectedDurationMs
        : candidate.expectedLatencyMs;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const cap = 30 * 60 * 1000;
  return Math.round(100 * (1 - Math.min(1, Math.log10(1 + ms) / Math.log10(1 + cap))));
}

function qualityScoreOf(candidate) {
  const q = Number(candidate && candidate.quality);
  if (!Number.isFinite(q)) return null;
  return Math.max(0, Math.min(100, q));
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
  const parts = [];
  const latency = latencyScoreOf(candidate);
  if (latency !== null) parts.push([assessment.weights.latency, latency]);
  const quality = qualityScoreOf(candidate);
  if (quality !== null) parts.push([assessment.weights.quality, quality]);
  const cost = costScoreOf(candidate);
  if (cost !== null) parts.push([assessment.weights.cost, cost]);

  let weightSum = 0;
  let total = 0;
  for (const [weight, value] of parts) {
    total += weight * value;
    weightSum += weight;
  }
  let score = weightSum > 0 ? Math.round(total / weightSum) : 0;

  const busy = ranking
    .reservationsForCandidate(candidate, ranking.getActiveReservations(ctx))
    .filter((r) => r && r.workItemId !== ctx.taskId).length;
  const busyPenalty = busy * BUSY_PENALTY_PER_RESERVATION;
  const agePenalty = evidenceAgePenalty(candidate, ctx.now);
  const headroomPenalty =
    candidate.headroomStatus === 'unknown' ? 15 : candidate.headroomStatus === 'tight' ? 10 : 0;
  score = Math.max(0, score - busyPenalty - agePenalty - headroomPenalty);

  return {
    score,
    breakdown: {
      latency,
      quality,
      cost,
      busyPenalty,
      evidenceAgePenalty: agePenalty,
      headroomPenalty,
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
    if (matchesForbiddenDomain(c, profile.forbiddenFailureDomains)) {
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

    if (profile.proofFloor !== 'NONE') {
      const observed = proofObserved(context.evidenceData, c);
      const observedRank = observed ? evidence.ProofRank[observed] : 0;
      if (observedRank < evidence.ProofRank[profile.proofFloor]) {
        reject('PROOF_FLOOR_NOT_MET:' + (observed || 'NONE'), 'candidate');
        continue;
      }
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

    if (!context._scoreContext)
      context._scoreContext = Object.assign({}, context, { taskId: profile.taskId, now });
    const scored = scoreForProfile(c, assessment, context._scoreContext);
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
    if (b.score !== a.score) return b.score - a.score;
    return a.candidateKey.localeCompare(b.candidateKey);
  });

  const top3 = ranked.slice(0, 3);
  const chosen = top3.length ? top3[0].candidateKey : null;
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
  const failed = ['failed', 'error', 'aborted', 'refused'].includes(
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
      level: evidence.Level.API,
      source: 'report-outcome',
    });
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

  const assessment = await assessTask(profile, { ask: d.ask });

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
    taskId: profile.taskId,
    evidenceData,
    headrooms: d.headrooms,
    reservations: d.reservations,
    accounts: d.accounts,
    useStoredQuota: false,
    home: d.home,
    storePath: d.storePath,
  };
  const result = rankForProfile(annotated, profile, assessment, rankCtx);

  // The decision log is the trace: profile, JEV result, full ranking, final
  // candidate — written even in a dry run, because the ranking decision is
  // real even when the launch is not (AI-64-R03's standard, applied here).
  const decisionRecorded = {
    stage: decisions.Stage.SELECTED,
    workItemId: profile.taskId,
    role: profile.role,
    taskProfile: profile,
    jev: assessment,
    ranking: result.ranking.map((c) => ({
      candidateKey: c.candidateKey,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      headroom: c.headroomStatus || 'unknown',
      failureDomain: failureDomainOf(c),
      reservationsHeld: c.reservationsHeld || 0,
    })),
    rejected: result.rejected.slice(0, REJECTED_RECORDED_LIMIT),
    rejectedCount: result.rejected.length,
    chosen: result.chosen,
    reason: result.reason,
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
    log('No candidate meets the profile: ' + result.reason);
    const byCode = new Map();
    for (const r of result.rejected) {
      byCode.set(r.reasonCode, (byCode.get(r.reasonCode) || 0) + 1);
    }
    for (const [code, count] of byCode) log('  EXCLUDED ' + count + 'x ' + code);
    exit(1);
    return {
      exitCode: 1,
      profile,
      assessment,
      refused: result.refused,
      rejected: result.rejected,
    };
  }

  log('Top candidates:');
  result.top3.forEach((entry, i) => log(formatTopEntry(entry, i + 1)));

  const execute = args.execute === true;
  let reserved = false;
  if (execute) {
    const chosenCandidate = result.ranking.find((c) => c.candidateKey === result.chosen);
    quotaStore.recordReservation(
      profile.taskId,
      profile.role,
      (chosenCandidate && chosenCandidate.accountId) || '*',
      result.chosen,
      100000,
      { home: d.home, path: d.storePath, now }
    );
    reserved = true;
    log('Reserved rank 1 (quota-store): ' + result.chosen);
  }

  const pinned = result.chosen;
  log((execute ? 'Pinned for execution: ' : 'Pinned (dry run, no reservation): ') + pinned);

  if (args.json) {
    log(
      JSON.stringify(
        { profile, assessment, top3: result.top3, rejected: result.rejected, pinned },
        null,
        2
      )
    );
  }

  exit(0);
  return {
    exitCode: 0,
    profile,
    assessment,
    ranking: result.ranking,
    top3: result.top3,
    rejected: result.rejected,
    pinnedCandidateKey: pinned,
    reserved,
  };
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
  failureDomainOf,
  matchesForbiddenDomain,
  proofObserved,
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
