'use strict';

const path = require('path');
const { currentBranch, headSha, commitExists } = require('../facts');
const { toPositiveInteger } = require('../source-discovery');
const { atomicRenameSync } = require('../atomic-rename');
const { maskEmailsInString } = require('../route-identity-utils');
const { pick } = require('./reconcile-manifest');
const {
  mergeEvidenceAccounts,
  assembleForDispatch,
  readCheckpoint,
  writeJsonFile,
  applyFailureBlocks,
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
} = require('../orchestrate/runtime-helpers');

function sameFailureDomain(candidate, failed, classification) {
  // mvp-repair.test.js:66-70 evaluates this function via new Function without CommonJS require scope.
  const failureDomain =
    typeof require === 'function'
      ? require('../failure-domain')
      : process.getBuiltinModule('module').createRequire(`${process.cwd()}/tools/ai-brain/cli.js`)(
          './failure-domain'
        );
  return failureDomain.sameFailureDomain(candidate, failed, classification);
}

// The ticket decides whether routes outside the combo may compete. Absent means they may.
const ROUTE_SCOPES = new Set(['combo-only', 'combo-and-routes']);
function routeScopeOf(value) {
  if (value === undefined || value === null) return 'combo-and-routes';
  if (!ROUTE_SCOPES.has(value)) throw new Error('ROUTE_SCOPE_INVALID: ' + value);
  return value;
}

/**
 * Where the harness writes its durable session report for one dispatch.
 *
 * The worker writes the report, so the directory has to be one the worker can
 * reach — inside the worker root for an isolated launch. It is named by the
 * operator (`--usage-dir`) or by the caller, never derived from the worker's
 * own answer, and never the host-owned launch-results directory a worker
 * cannot write.
 */
function sevenFields(candidate) {
  return {
    harness: candidate.harness || '',
    accessPath: candidate.accessPath || '',
    gateway: candidate.gateway || '',
    upstream: candidate.upstream || '',
    accountId: candidate.accountId || '*',
    quotaScope: candidate.quotaScope || '',
    modelId: candidate.modelId || candidate.model || '',
  };
}

function quotaSnapshot(candidate) {
  const key = candidate.offeringId || candidate.key || '';
  return {
    offeringId: key,
    headroom: candidate.headroom || candidate.headroomStatus || 'unknown',
    reason: candidate.headroomReason || null,
    reservations: Number(candidate.reservationsHeld || 0),
  };
}

function applyDryRunBlocks(candidates, failedKeys, failedCandidate, classification, avoidDomain) {
  return applyFailureBlocks(
    candidates,
    failedKeys,
    failedCandidate,
    classification,
    avoidDomain,
    DRY_RUN_BLOCK_CODES
  );
}

function buildDryRunLog(parts) {
  const decision = parts.decision || {};
  const fallback = parts.fallback || {};
  const finalChoice = fallback.chosen || decision.chosen || null;
  const firstChoice = parts.firstChoice || decision.chosen || null;
  const rejected = new Map();
  for (const r of decision.rejected || []) {
    rejected.set(r.offeringId, r);
  }
  for (const r of (fallback.decision && fallback.decision.rejected) || []) {
    rejected.set(r.offeringId, r);
  }
  const inputCandidates = new Map(
    (parts.annotated || []).map((c) => [parts.candidatesApi.candidateKey(c), c])
  );
  // Assembly exclusions are inputs too; retain each identity once without ranking it.
  for (const key of rejected.keys()) {
    if (inputCandidates.has(key)) continue;
    const identity = require('../discovery/identity').parseCandidateKey(key);
    inputCandidates.set(key, { ...identity, accountId: identity?.account });
  }
  const candidates = [...inputCandidates.values()].map((c) => {
    const key = parts.candidatesApi.candidateKey(c);
    const isUnscored =
      c.qualityLabel === 'QUALITY_UNKNOWN' ||
      (c.scoreBreakdown &&
        (c.scoreBreakdown.quality === null ||
          c.scoreBreakdown.quality === 'QUALITY_UNKNOWN' ||
          c.scoreBreakdown.qualityLabel === 'QUALITY_UNKNOWN')) ||
      c.score === null ||
      c.score === undefined;
    const scoreVal =
      (c.scoreBreakdown && c.scoreBreakdown.quality === null) ||
      c.score === null ||
      c.score === undefined
        ? 'chưa rõ'
        : c.score;
    return Object.assign(sevenFields(c), {
      offeringId: key,
      status: c.status === 'passed' ? 'PASS' : c.status || 'unknown',
      score: scoreVal,
      qualityLabel: isUnscored ? 'QUALITY_UNKNOWN' : undefined,
    });
  });
  for (const c of candidates) {
    if (c.offeringId === finalChoice || rejected.has(c.offeringId)) continue;
    rejected.set(c.offeringId, {
      offeringId: c.offeringId,
      reason: 'NOT_SELECTED',
      scope: 'candidate',
    });
  }
  return {
    schemaVersion: 1,
    scoringPolicyStatus: decision.scoringPolicyStatus,
    mode: 'dry-run',
    workItemId: parts.item.workItemId,
    generatedAt: new Date(parts.now).toISOString(),
    resumed: Boolean(parts.resumed),
    stages: [
      'discovery',
      '7-field candidates',
      'quota/fairness',
      'failure classifier',
      'ranking',
      'decision',
      'dry-run dispatch',
      'simulated first-source failure',
      'fallback',
      'checkpoint resume',
    ],
    candidates,
    excluded: Array.from(rejected.values()).map((r) => ({
      offeringId: r.offeringId,
      candidateKey: r.offeringId,
      reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
      reason: r.reason || 'UNKNOWN',
      scope: r.scope || null,
    })),
    excludedCandidates: Array.from(rejected.values()).map((r) => ({
      offeringId: r.offeringId,
      candidateKey: r.offeringId,
      reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
      reason: r.reason || 'UNKNOWN',
      scope: r.scope || null,
    })),
    selected: finalChoice,
    selectedCandidate: finalChoice,
    firstChoice,
    quotaState: candidates.map((c) => quotaSnapshot(c)),
    ranking: {
      reason: decision.reason,
      ordered: (decision.candidates || []).map((c) => ({
        offeringId: c.offeringId,
        scoreBreakdown: c.scoreBreakdown,
        score:
          (c.scoreBreakdown && c.scoreBreakdown.quality === null) ||
          c.score === null ||
          c.score === undefined
            ? 'chưa rõ'
            : c.score,
        qualityLabel:
          c.qualityLabel ||
          (c.scoreBreakdown && c.scoreBreakdown.qualityLabel) ||
          (c.scoreBreakdown && c.scoreBreakdown.quality === null ? 'QUALITY_UNKNOWN' : undefined),
        headroom: c.headroom || 'unknown',
      })),
    },
    dryRunDispatch: {
      launched: false,
      networkTouched: false,
      executeTouched: false,
    },
    simulatedFailure: parts.simulatedFailure || null,
    failure: parts.simulatedFailure || null,
    fallback: {
      candidateKey: fallback.chosen || null,
      chosen: fallback.chosen || null,
      reason: fallback.reason || null,
      preferredDifferentFailureDomain: Boolean(fallback.preferredDifferentFailureDomain),
      decision: fallback.decision || null,
    },
    checkpoint: parts.checkpoint || null,
  };
}

/**
 * Resolve offline fixture paths from args, deps and env once. Callers pass
 * CLI args + injected deps and get back { fixtureDir, opencodeModelsFixture,
 * comboFixture, hasOfflineFixture }. Keeps the env-var names (SHIPDE_*) as
 * the canonical overrides; the three CLI aliases collapse to one lookup each.
 */
function resolveFixturePaths(args, deps) {
  const fsMod = (deps && deps.fs) || require('fs');
  const env = (deps && deps.env) || process.env;
  const fixtureDir =
    args['fixture-dir'] || args.fixtureDir || (deps && deps.fixtureDir) || env.SHIPDE_FIXTURE_DIR;

  let dirModelsFixture;
  if (fixtureDir) {
    const txtPath = path.join(fixtureDir, 'opencode-models.txt');
    const jsonPath = path.join(fixtureDir, 'opencode-models.json');
    if (fsMod.existsSync(txtPath)) {
      dirModelsFixture = txtPath;
    } else if (fsMod.existsSync(jsonPath)) {
      dirModelsFixture = jsonPath;
    }
  }

  const opencodeModelsFixture =
    args['opencode-models-fixture'] ||
    args.opencodeModelsFixture ||
    (deps && (deps.opencodeModelsFixture || deps.modelsFixture)) ||
    (deps && deps.env && deps.env.SHIPDE_OPENCODE_MODELS_FIXTURE) ||
    env.SHIPDE_OPENCODE_MODELS_FIXTURE ||
    dirModelsFixture;

  const dirComboFixture = fixtureDir ? path.join(fixtureDir, 'combos.json') : undefined;
  const comboFixture =
    args['combo-fixture'] ||
    args.comboFixture ||
    (deps && deps.comboFixture) ||
    (deps && deps.env && deps.env.SHIPDE_COMBO_FIXTURE) ||
    env.SHIPDE_COMBO_FIXTURE ||
    dirComboFixture;

  const hasOfflineFixture = Boolean(fixtureDir || comboFixture || opencodeModelsFixture);
  return { fixtureDir, opencodeModelsFixture, comboFixture, hasOfflineFixture };
}

module.exports = {
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
  mergeEvidenceAccounts,
  routeScopeOf,
  assembleForDispatch,
  readCheckpoint,
  writeJsonFile,
  sevenFields,
  quotaSnapshot,
  sameFailureDomain,
  applyFailureBlocks,
  applyDryRunBlocks,
  buildDryRunLog,
  resolveFixturePaths,
};
