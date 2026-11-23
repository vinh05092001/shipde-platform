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

/**
 * TASK-AI-65: candidate assembly for a profile dispatch. The same assembly the
 * item path uses (discovery catalogue + offerings + registry pins), so a
 * profile-ranked candidate and an item-ranked candidate are the same kind of
 * object with the same seven-part identity.
 */
async function dispatchProfileCommand(args, deps) {
  const rootDir = args.root || (deps && deps.rootDir) || process.cwd();
  const sourcesApi = require('../sources');
  const jev = require('../jev');
  const { readDiscoveryCatalogue } = require('../discovery/read');

  let discCat;
  if (deps && deps.discoveryCatalogue) {
    discCat = deps.discoveryCatalogue;
  } else if (!(deps && Array.isArray(deps.candidates))) {
    const discDir =
      (deps && deps.discoveryDataDir) ||
      args['discovery-dir'] ||
      path.join(__dirname, '..', 'data', 'discovery');
    const { catalogueFreshness } = require('../catalogue-refresh');
    const freshness = catalogueFreshness({
      dataDir: discDir,
      now: deps && deps.now,
    });
    // With --json the stale status travels in the catalogue object only: consumers parse the
    // trailing JSON decision, so no extra line may follow it.
    if (freshness.stale && !args.json) {
      const error = (deps && deps.error) || console.error;
      error(
        'STALE_CATALOGUE: last successful live enumeration is missing or older than 48h; run pnpm ai:refresh-catalogue'
      );
    }
    try {
      discCat = readDiscoveryCatalogue({
        dataDir: discDir,
      });
      if (discCat) {
        discCat.freshness = freshness;
        discCat.stale = freshness.stale;
      }
    } catch {
      discCat = { candidates: [], freshness, stale: true };
    }
  }
  const accounts = Array.isArray(deps && deps.accounts)
    ? deps.accounts
    : require('../accounts').listAccounts() || [];

  const evidenceDir =
    (deps && deps.evidenceDir) ||
    args['evidence-dir'] ||
    path.join(__dirname, '..', 'data', 'evidence');
  let evidenceData;
  try {
    evidenceData = require('../evidence').loadEvidence(evidenceDir);
  } catch (e) {
    evidenceData = {};
  }
  const {
    fixtureDir: profileFixtureDir,
    opencodeModelsFixture: profileOpencodeModelsFixture,
    comboFixture: profileComboFixture,
    hasOfflineFixture: profileOfflineFixture,
  } = resolveFixturePaths(args, deps);
  const optsWithEvidence = Object.assign({}, deps, {
    scanFile: args['scan-file'] || deps?.scanFile,
    evidenceData,
    ...(profileFixtureDir ? { fixtureDir: profileFixtureDir } : {}),
    ...(profileOpencodeModelsFixture
      ? { opencodeModelsFixture: profileOpencodeModelsFixture }
      : {}),
    ...(profileComboFixture ? { comboFixture: profileComboFixture } : {}),
    routeHealthFile: args['route-health'] || (deps && deps.routeHealthFile) || undefined,
    accounts,
    discoveryDataDir: (deps && deps.discoveryDataDir) || args['discovery-dir'] || undefined,
    fakeRunsDir:
      (deps && deps.fakeRunsDir) ||
      args['pool-runtime-dir'] ||
      args['agy-runs-dir'] ||
      process.env.AGY_POOL_RUNS_DIR ||
      process.env.AGY_RUNS_DIR ||
      undefined,
    discoverPool:
      (deps && deps.discoverPool === true) ||
      Boolean(
        args['pool-runtime-dir'] ||
        args['agy-runs-dir'] ||
        process.env.AGY_POOL_RUNS_DIR ||
        process.env.AGY_RUNS_DIR
      ),
    home: (deps && deps.home) || args.home || undefined,
    adapterScript: (deps && deps.adapterScript) || process.env.AGY_POOL_ADAPTER_SCRIPT || undefined,
    platform: (deps && deps.platform) || undefined,
  });
  if (Array.isArray(deps && deps.candidates)) {
    optsWithEvidence.allowUnprobedCandidates = true;
  }
  if (!discCat && Array.isArray(deps && deps.candidates)) discCat = { candidates: [] };

  // An unreadable profile is reported by runProfileDispatch with its usual exit code.
  let ticket = null;
  try {
    const text = require('fs').readFileSync(path.resolve(rootDir, args.profile), 'utf8');
    ticket = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    ticket = null;
  }
  optsWithEvidence.role = ticket?.role;
  optsWithEvidence.routeScope = routeScopeOf(ticket?.routeScope);

  const registry = (deps && deps.registry) || sourcesApi.loadSources();
  const candidateList = assembleForDispatch(
    discCat,
    accounts,
    registry,
    Array.isArray(deps && deps.candidates) || (deps && deps.allowUnprobedCandidates === true)
      ? optsWithEvidence
      : Object.assign({}, optsWithEvidence, { requireRouteHealth: true })
  );
  const jevSource = sourcesApi.getSource('jev', registry);
  const scoring = require('../scoring-policy');
  const scoringAssessment = scoring.loadScoringPolicy(
    args['scoring-policy'] || deps.scoringPolicyFile
  );
  scoring.joinMeasurements(candidateList, scoringAssessment, {
    ...optsWithEvidence,
    evidenceData,
    evidenceDir,
    now: deps.now,
  });
  const jevAsk =
    (deps && deps.jevAsk) ||
    (!(args.execute !== true && ((deps && deps.dryRunOffline === true) || profileOfflineFixture)) &&
      jev.buildAskFromSource(jevSource, {
        home: optsWithEvidence.home,
        env: (deps && deps.env) || process.env,
        httpClient: deps && deps.jevHttpClient,
        timeoutMs: deps && deps.jevTimeoutMs,
      })) ||
    undefined;

  return require('../routing').runProfileDispatch(
    args,
    Object.assign({}, deps, {
      candidates: require('../dispatch-output').filterPins(candidateList, args, deps),
      scoringAssessment,
      capabilityProbeAllowNetwork: args.execute === true && !Array.isArray(deps && deps.candidates),
      registry,
      rootDir,
      ask: (deps && deps.ask) || jevAsk,
      minConfidence: jevSource && jevSource.minConfidence,
      modelChoiceAsk: (deps && (deps.modelChoiceAsk || deps.ask)) || jevAsk,
      modelChoiceMinConfidence:
        (deps && (deps.modelChoiceMinConfidence || deps.minConfidence)) ||
        (jevSource && jevSource.minConfidence),
      modelChoiceTopN: (deps && deps.modelChoiceTopN) || 5,
      explorationBudget:
        args['exploration-budget'] !== undefined ? Number(args['exploration-budget']) : 0,
      home: optsWithEvidence.home,
      storePath: (deps && deps.storePath) || args['quota-store'] || undefined,
      fakeRunsDir: optsWithEvidence.fakeRunsDir,
      adapterScript: optsWithEvidence.adapterScript,
      platform: optsWithEvidence.platform,
      launcher: (deps && deps.launcher) || args.launcher || undefined,
    })
  );
}

/**
 * Master-queue item 5: dispatch wiring.
 * Chooses candidate through the brain (discovery + offerings, evidence/cooldowns,
 * quota/reservations/load, ranked by ranking.js).
 */
function coordinatorDispatchCommand(args, deps) {
  try {
    const options = require('../coordinator-options').coordinatorOptions(args);
    const data = JSON.parse(require('node:fs').readFileSync(options.input, 'utf8'));
    const formatter = require('../dispatch-output');
    let decision = data;
    if (options.decision) {
      const selected = data.ranking?.find((c) => c.candidateKey === data.chosen);
      const { isDeepStrictEqual } = require('node:util');
      if (
        data.schemaVersion !== 1 ||
        !Array.isArray(data.ranking) ||
        new Set(data.ranking.map((c) => c.candidateKey)).size !== data.ranking.length ||
        !Array.isArray(data.rejected) ||
        (data.chosen === null
          ? data.selected !== null
          : !selected || !isDeepStrictEqual(data.selected, selected)) ||
        (data.codeSha && data.codeSha !== options.codeSha)
      )
        throw new Error('COORDINATOR_DECISION_INVALID');
    } else {
      if (
        !Array.isArray(data.candidates) ||
        !Array.isArray(data.launcherModels) ||
        !data.profile ||
        !data.registry
      )
        throw new Error('COORDINATOR_SNAPSHOT_INVALID');
      const profile = { ...data.profile, taskId: options.item, role: options.role };
      const registry = data.registry;
      const candidates = assembleForDispatch({ candidates: [] }, data.accounts || [], registry, {
        candidates: data.candidates,
        routeHealth: data.routeHealth || { paths: {} },
        evidenceData: data.evidenceData || {},
        role: options.role,
        routeScope: profile.routeScope,
      });
      const { dispatchRoute, qualifyModel } = require('../sources');
      const supported = (c) => {
        const route = dispatchRoute(c.gateway || c.source || c.upstream, registry);
        return (
          !String(c.harness).startsWith('opencode') ||
          Boolean(route && data.launcherModels.includes(qualifyModel(c.modelId, route)))
        );
      };
      const kept = candidates.filter(supported);
      const rejected = candidates
        .filter((c) => !supported(c))
        .map((c) => ({ ...c, reasonCode: 'LAUNCHER_MODEL_UNKNOWN' }));
      kept.filters = [
        ...candidates.filters,
        formatter.filterStage('launcher-model', candidates, kept, rejected),
      ];
      const routing = require('../routing');
      const weightProfile = routing.controllerFallbackProfile(profile);
      const assessment = data.assessment || {
        weightProfile,
        weights: routing.WEIGHT_PROFILES[weightProfile],
      };
      const result = routing.rankForProfile(kept, profile, assessment, {
        registry,
        accounts: data.accounts || [],
        evidenceData: data.evidenceData || {},
        quotaState: data.quotaState || { accounts: {} },
        priors: data.priors || { ranking: [] },
        useStoredQuota: false,
        loadQuotaState: false,
        dryRun: true,
      });
      decision = formatter.dispatchOutput(profile, assessment, kept, result);
    }
    const serialized = formatter.serializeDispatchOutput(
      { ...decision, coordinator: options },
      { codeSha: options.codeSha }
    );
    (deps.log || console.log)(serialized);
    return { exitCode: decision.chosen ? 0 : 1, dryRun: true, output: JSON.parse(serialized) };
  } catch (error) {
    (deps.error || console.error)(require('../coordinator-text').errorText(error));
    return { exitCode: 2, dryRun: true };
  }
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
  dispatchProfileCommand,
  coordinatorDispatchCommand,
};
