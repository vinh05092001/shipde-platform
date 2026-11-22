'use strict';

/**
 * Ship Dễ — JEV-guided member selection inside the configured 9router combo (TASK-AI-194, Lát B2).
 *
 * Operator architecture (2026-11-21):
 *   1. Assess the task (complexity, risk, role, scope size).
 *   2. Read curated member models from the configured 9router combo (`combo-reader`).
 *   3. Attach benchmark score & reasoning/effort level for ONLY those combo members (`priors-read`).
 *   4. For reviewer role, exclude members sharing the writer's model family so review stays independent.
 *   5. Ask JEV (`jev.advise`) using opaque option labels (`M0`, `M1`, ...) carrying score & reasoning
 *      metadata -> JEV picks which combo member fits the task; deterministic fallback if JEV is offline.
 */

const combo = require('./combo');
const comboReader = require('./combo-reader');
const priorsRead = require('./priors-read');
const jev = require('./jev');
const { candidateKey } = require('./discovery/identity');

const EFFORT_RANK = Object.freeze({
  xhigh: 5,
  high: 4,
  medium: 3,
  low: 2,
  minimal: 1,
  none: 0,
});

function effortWeight(effort) {
  if (!effort) return 0;
  return EFFORT_RANK[String(effort).toLowerCase()] ?? 0;
}

/**
 * Step 1: Assess Work Item difficulty/complexity and role from item metadata.
 */
function assessComboTask(item, roleOverride) {
  const it = item || {};
  const rawRole = String(
    roleOverride || (it.roleRequirement && it.roleRequirement.role) || it.role || 'writer'
  ).toLowerCase();
  const role = rawRole.includes('review') ? 'reviewer' : 'writer';

  const rawComplexity = String(it.complexity || '').toLowerCase();
  const rawRisk = String(it.risk || '').toUpperCase();
  const allowed = Array.isArray(it.allowedPaths)
    ? it.allowedPaths
    : Array.isArray(it.files)
      ? it.files
      : [];
  const fileCount = allowed.length;

  let complexity = 'standard';
  if (rawComplexity === 'low' || rawComplexity === 'simple' || rawComplexity === 'trivial') {
    complexity = 'low';
  } else if (
    rawComplexity === 'high' ||
    rawComplexity === 'complex' ||
    rawComplexity === 'hard' ||
    rawRisk === 'HIGH' ||
    fileCount >= 8
  ) {
    complexity = 'high';
  } else if (rawRisk === 'LOW' && fileCount > 0 && fileCount <= 2 && !rawComplexity) {
    complexity = 'low';
  }

  return {
    workItemId: it.id || it.workItemId || null,
    role,
    complexity,
    risk: rawRisk || 'MEDIUM',
    fileCount,
  };
}

/**
 * Extract model family stem (e.g. `grok-4.7` -> `grok`, `claude-4.5-sonnet` -> `claude`,
 * `gpt-5.2-codex` -> `gpt`) for writer/reviewer family independence checks.
 */
function modelFamilyOf(baseOrId) {
  const norm = priorsRead.normaliseModelId(baseOrId) || String(baseOrId || '').toLowerCase();
  const leaf = norm.includes('/') ? norm.split('/').pop() : norm;
  const match = /^([a-z]+)/.exec(leaf);
  return match ? match[1] : leaf;
}

/**
 * Extract explicit upstream prefix from a `provider/model` combo member ID
 * (e.g. `gh/gpt-5.2-high` -> `gh`). Falls back to `fallbackUpstream` when unprefixed.
 */
function upstreamOfMember(modelId, fallbackUpstream = null) {
  const raw = String(modelId || '').trim();
  const slash = raw.indexOf('/');
  if (slash > 0) {
    const prefix = raw.slice(0, slash).trim().toLowerCase();
    if (prefix) return prefix;
  }
  return fallbackUpstream ? String(fallbackUpstream).trim().toLowerCase() : null;
}

/**
 * Filter combo members for independent review (different model family AND
 * different established upstream provider prefix from writer).
 * Fail-closed: never re-admits same-upstream, unprefixed/unknown-upstream,
 * same-family, or writer-only members.
 */
function filterForIndependence(scoredMembers, writerModelId, allMembers, fallbackUpstream = null) {
  if (!writerModelId) return { eligible: scoredMembers, independentApplied: false };
  const writerSplit = priorsRead.splitModelEffort(writerModelId, { liveIds: allMembers });
  const writerBase =
    writerSplit.base || priorsRead.normaliseModelId(writerModelId) || writerModelId;
  const writerFamily = modelFamilyOf(writerBase);
  const explicitWriterUpstream = upstreamOfMember(writerModelId, null);
  const resolvedWriterUpstream = upstreamOfMember(writerModelId, fallbackUpstream);

  if (!explicitWriterUpstream || !resolvedWriterUpstream) {
    return { eligible: [], independentApplied: true };
  }

  const distinct = scoredMembers.filter((m) => {
    if (m.modelId === writerModelId) return false;
    if (m.base === writerBase) return false;
    if (modelFamilyOf(m.base) === writerFamily) return false;
    const explicitMemberUpstream = upstreamOfMember(m.modelId, null);
    const resolvedMemberUpstream = upstreamOfMember(m.modelId, fallbackUpstream);
    if (!explicitMemberUpstream || !resolvedMemberUpstream) return false;
    if (explicitMemberUpstream === explicitWriterUpstream) return false;
    if (resolvedMemberUpstream === resolvedWriterUpstream) return false;
    return true;
  });
  return { eligible: distinct, independentApplied: true };
}

/**
 * Deterministic fallback when JEV is unavailable or undecided:
 * - `high` complexity: highest benchmark score, tie-break by highest reasoning effort.
 * - `low` complexity: prefer a known-score member with lower reasoning effort (faster/cheaper)
 *   within 10 points of top score, else top score.
 * - `standard`: highest benchmark score (already sorted by scoreComboMembers).
 */
function deterministicPick(scoredMembers, assessment) {
  if (!Array.isArray(scoredMembers) || scoredMembers.length === 0) return null;
  if (assessment.complexity === 'high') {
    const sorted = scoredMembers.slice().sort((a, b) => {
      const aKnown = typeof a.score === 'number';
      const bKnown = typeof b.score === 'number';
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && bKnown && b.score !== a.score) return b.score - a.score;
      const effDiff = effortWeight(b.effort) - effortWeight(a.effort);
      if (effDiff !== 0) return effDiff;
      return a.modelId.localeCompare(b.modelId);
    });
    return sorted[0];
  }
  if (assessment.complexity === 'low') {
    const known = scoredMembers.filter((m) => typeof m.score === 'number');
    if (known.length > 1) {
      const topScore = known[0].score;
      const withinBand = known.filter((m) => topScore - m.score <= 10);
      withinBand.sort((a, b) => {
        const effDiff = effortWeight(a.effort) - effortWeight(b.effort);
        if (effDiff !== 0) return effDiff;
        if (b.score !== a.score) return b.score - a.score;
        return a.modelId.localeCompare(b.modelId);
      });
      return withinBand[0];
    }
  }
  return scoredMembers[0];
}

/**
 * Build a closed JEV question using opaque option IDs (`M0`, `M1`, ...) so
 * provider/account identities are never leaked to JEV (`IDENTITY_PROHIBITED`).
 */
function buildJevComboQuestion(assessment, eligibleMembers) {
  const options = [];
  const optionMap = new Map();
  const table = [];
  for (let i = 0; i < eligibleMembers.length; i += 1) {
    const optId = 'M' + i;
    const m = eligibleMembers[i];
    options.push(optId);
    optionMap.set(optId, m);
    table.push({
      option: optId,
      score: m.score,
      tier: m.tier,
      reasoningEffort: m.effort || 'default',
      priorUnknown: m.priorUnknown,
    });
  }
  return {
    question: {
      kind: 'select-combo-member',
      prompt:
        'Given the task assessment (complexity, risk, role) and the available combo members with their benchmark score and reasoning effort, pick the single best option ID.',
      evidence: JSON.stringify({ task: assessment, members: table }),
      options,
    },
    optionMap,
  };
}

/**
 * Build a 9router candidate object targeting a specific curated combo member.
 */
function buildMemberCandidate(member, options = {}) {
  const baseRes = combo.comboCandidate({
    registry: options.registry,
    env: options.env,
    comboName: options.comboName,
  });
  if (baseRes.error || !baseRes.candidate) return baseRes;
  const base = baseRes.candidate;
  const upstream = upstreamOfMember(member.modelId, base.upstream) || base.upstream;
  const candidate = {
    ...base,
    upstream,
    modelId: member.modelId,
    model: member.modelId,
    modelFamily: modelFamilyOf(member.base),
    comboMember: true,
    comboName: base.combo,
    reasoningEffort: member.effort || null,
    memberScore: member.score,
    memberTier: member.tier,
  };
  candidate.candidateKey = candidateKey(candidate);
  return { candidate };
}

/**
 * End-to-end 5-step combo-member selector:
 *   assess task -> read combo members -> score & effort -> filter independence -> ask JEV (with fallback).
 */
async function selectComboMember(options = {}) {
  const assessment = assessComboTask(options.item, options.role);
  const readCombo = options.readComboConfig || comboReader.readComboConfig;
  const cfg = combo.configuredCombo(options.registry);
  const comboName = options.comboName || (cfg && cfg.name) || null;
  const fallbackUpstream = (cfg && cfg.source && cfg.source.id) || null;

  let rawMembers = Array.isArray(options.members) ? options.members : null;
  let comboConfig = null;
  if (!rawMembers) {
    comboConfig = await readCombo({
      name: comboName,
      registry: options.registry,
      env: options.env,
      fixture: options.comboFixture,
    });
    rawMembers = Array.isArray(comboConfig && comboConfig.members) ? comboConfig.members : [];
  }

  const members = rawMembers.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim());

  const scored =
    members.length > 0
      ? priorsRead.scoreComboMembers(members, assessment.role, {
          priors: options.priors,
          priorsFile: options.priorsFile,
          registry: options.registry,
          now: options.now,
        })
      : [];

  if (scored.length === 0) {
    if (assessment.role === 'reviewer' && options.writerModelId) {
      return {
        ok: false,
        assessment,
        selected: null,
        candidate: null,
        eligibleCount: 0,
        independentApplied: true,
        handledBy: 'refused',
        reason: 'NO_INDEPENDENT_REVIEWER',
        error: 'NO_INDEPENDENT_REVIEWER',
      };
    }
    const fallback = combo.comboCandidate({
      registry: options.registry,
      env: options.env,
      comboName,
    });
    return {
      ok: Boolean(fallback.candidate),
      assessment,
      selected: null,
      candidate: fallback.candidate || null,
      handledBy: 'combo-fallback',
      reason: (comboConfig && comboConfig.status) || 'COMBO_MEMBERS_EMPTY',
      error: fallback.error || null,
    };
  }

  const { eligible, independentApplied } =
    assessment.role === 'reviewer' && options.writerModelId
      ? filterForIndependence(scored, options.writerModelId, members, fallbackUpstream)
      : { eligible: scored, independentApplied: false };

  if (eligible.length === 0) {
    return {
      ok: false,
      assessment,
      selected: null,
      candidate: null,
      eligibleCount: 0,
      independentApplied,
      handledBy: 'refused',
      reason: 'NO_INDEPENDENT_REVIEWER',
      error: 'NO_INDEPENDENT_REVIEWER',
    };
  }

  let chosen = null;
  let handledBy = 'fallback';
  let jevOutcome = null;

  if (eligible.length === 1) {
    chosen = eligible[0];
    handledBy = 'single-eligible';
  } else if (typeof options.jevAsk === 'function') {
    const { question, optionMap } = buildJevComboQuestion(assessment, eligible);
    jevOutcome = await jev.advise(question, {
      ask: options.jevAsk,
      minConfidence: options.minConfidence,
    });
    if (jevOutcome.outcome === jev.Outcome.DECIDED && optionMap.has(jevOutcome.choice)) {
      chosen = optionMap.get(jevOutcome.choice);
      handledBy = 'jev';
    }
  }

  if (!chosen) {
    chosen = deterministicPick(eligible, assessment);
    handledBy = 'fallback';
  }

  const built = buildMemberCandidate(chosen, {
    registry: options.registry,
    env: options.env,
    comboName,
  });

  return {
    ok: Boolean(built.candidate),
    assessment,
    selected: chosen,
    candidate: built.candidate || null,
    eligibleCount: eligible.length,
    independentApplied,
    handledBy,
    jevOutcome,
    error: built.error || null,
  };
}

module.exports = {
  assessComboTask,
  modelFamilyOf,
  upstreamOfMember,
  filterForIndependence,
  deterministicPick,
  buildJevComboQuestion,
  buildMemberCandidate,
  selectComboMember,
};
