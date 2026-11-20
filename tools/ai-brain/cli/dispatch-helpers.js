'use strict';

const path = require('path');
const { currentBranch, headSha, commitExists } = require('../facts');
const { toPositiveInteger } = require('../source-discovery');
const { atomicRenameSync } = require('../atomic-rename');
const { maskEmailsInString } = require('../route-identity-utils');
const { pick } = require('./reconcile-manifest');

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

/**
 * Assemble candidates for a live dispatch run.
 *
 * Combines candidates generated from catalogue, openCodeIds, and accounts, with
 * gateway-derived and pool-derived candidates. Merges evidence-only candidates
 * so models seen in evidence history participate in selection.
 *
 * Injected candidates skip inventory generation, but still obey health and scope.
 */
// The ticket decides whether routes outside the combo may compete. Absent means they may.
const ROUTE_SCOPES = new Set(['combo-only', 'combo-and-routes']);
function routeScopeOf(value) {
  if (value === undefined || value === null) return 'combo-and-routes';
  if (!ROUTE_SCOPES.has(value)) throw new Error('ROUTE_SCOPE_INVALID: ' + value);
  return value;
}

function assembleForDispatch(discoveryCat, accounts, registry, options) {
  // Combo-only routing: every role calls the single 9router combo; 9router owns
  // member order, failover and health (operator decision 2026-11-19).
  const opts = options || {};
  // A caller may inject a ready candidate pool (tests, replay, a pinned route);
  // use it verbatim. Otherwise build the single 9router combo candidate.
  if (Array.isArray(opts.candidates)) return opts.candidates;
  const { comboCandidate } = require('../combo');
  const result = comboCandidate({ registry: registry || opts.registry, env: opts.env });
  return result.candidate ? [result.candidate] : [];
}

function readCheckpoint(file) {
  const fs = require('fs');
  if (!file) return null;
  // A `.tmp` next to the checkpoint is a writeJsonFile write whose rename was
  // interrupted: the file itself is complete (a torn write is not valid JSON)
  // and it is newer than the checkpoint below it. Adopt it and finish the
  // rename, so a one-step-stale checkpoint cannot silently relaunch work the
  // decision log already records as launched (TASK-AI-105 P2-4). A torn
  // half-write is dropped instead: the checkpoint is the last complete state.
  const tmp = file + '.tmp';
  if (fs.existsSync(tmp)) {
    let adopted = null;
    try {
      adopted = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    } catch (err) {
      adopted = null;
    }
    if (adopted && typeof adopted === 'object' && !Array.isArray(adopted)) {
      try {
        atomicRenameSync(tmp, file);
      } catch (err) {}
      return adopted;
    }
    try {
      fs.unlinkSync(tmp);
    } catch (err) {}
  }
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, value, options) {
  const fsApi = (options && options.fs) || require('fs');
  const path = require('path');
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fsApi.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  atomicRenameSync(tmp, file, Object.assign({}, options, { fs: fsApi }));
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
function usageReportFile(args, deps, item, now) {
  const explicit = (args && args['usage-report']) || (deps && deps.usageFile);
  if (typeof explicit === 'string' && explicit) return explicit;
  const dir = (args && args['usage-dir']) || (deps && deps.usageDir);
  if (typeof dir !== 'string' || !dir) return null;
  const stem = String((item && item.workItemId) || 'session').replace(/[^A-Za-z0-9._-]/g, '-');
  return path.join(dir, stem + '-' + (now || Date.now()) + '.json');
}

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

function candidateFromDecision(decision, key) {
  return (decision.candidates || []).find((c) => c.offeringId === key) || null;
}

function simulatedFailureFor(candidate) {
  const c = candidate || {};
  return {
    exitCode: 1,
    httpStatus: 503,
    body:
      'HTTP 503 from gateway: [402]: upstream ' +
      (c.upstream || 'unknown') +
      ' budget exhausted; reset after 1h 00m',
    stderr:
      'HTTP 503 from gateway: [402]: upstream ' +
      (c.upstream || 'unknown') +
      ' budget exhausted; reset after 1h 00m',
    accountId: c.accountId || '*',
  };
}

function sameFailureDomain(candidate, failed, classification) {
  // mvp-repair.test.js:66-70 evaluates this function via new Function without CommonJS require scope.
  const routing =
    typeof require === 'function'
      ? require('../routing')
      : process.getBuiltinModule('module').createRequire(`${process.cwd()}/tools/ai-brain/cli.js`)(
          './routing'
        );
  return routing.sameFailureDomain(candidate, failed, classification);
}

/**
 * Marks a failed candidate, and every candidate in the same failure domain, as
 * blocked, so the next ranking round cannot pick either. One implementation, two
 * vocabularies: the dry run says SIMULATED_*, a live run says the plain reason.
 * The domain rule is the Controller's (sameFailureDomain, driven by
 * failure-classifier.js), never a second, simpler "different gateway" test.
 */
function applyFailureBlocks(
  candidates,
  failedKeys,
  failedCandidate,
  classification,
  avoidDomain,
  codes
) {
  const candidatesApi = require('../candidates');
  for (const c of candidates) {
    if (c.blocked) continue;
    const key = candidatesApi.candidateKey(c);
    if (failedKeys.has(key)) {
      c.blocked = true;
      c.blockReason = codes.failed;
      c.blockScope = 'candidate';
      continue;
    }
    if (avoidDomain && sameFailureDomain(c, failedCandidate, classification)) {
      c.blocked = true;
      c.blockReason = codes.sameDomain;
      c.blockScope = classification.scope || 'unknown';
    }
  }
}

const DRY_RUN_BLOCK_CODES = Object.freeze({
  failed: 'SIMULATED_CANDIDATE_FAILED',
  sameDomain: 'SIMULATED_FAILURE_DOMAIN_AVOIDED',
});

const LIVE_BLOCK_CODES = Object.freeze({
  failed: 'CANDIDATE_FAILED',
  sameDomain: 'FAILURE_DOMAIN_AVOIDED',
});

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

function candidateContextWindow(candidate) {
  const caps = candidate && candidate.capabilities;
  return (
    candidate &&
    (candidate.contextWindow ||
      candidate.context_window ||
      (caps && (caps.contextWindow || caps.context_window || caps.contextTokens)))
  );
}

function applyHarnessVerification(candidates) {
  const { contextRefusal } = require('../harness');
  for (const c of candidates || []) {
    const reason = contextRefusal(c.harness, candidateContextWindow(c), { allowUnknown: true });
    if (!reason) continue;
    c.blocked = true;
    c.blockReason = reason;
    c.blockScope = 'model';
  }
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
      path.join(__dirname, 'data', 'discovery');
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
    (deps && deps.evidenceDir) || args['evidence-dir'] || path.join(__dirname, 'data', 'evidence');
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

function resolveExecuteBase({ targetWorktree, args = {}, deps = {}, provenance } = {}) {
  // TASK-AI-171 R2: delegate to the one shared execute-target module.
  const { resolveExecuteTarget } = require('../execute-target');
  return resolveExecuteTarget(args, {
    ...deps,
    treePath: deps?.treePath || targetWorktree || undefined,
    provenance: provenance || deps?.provenance || args?.provenance,
  });
}

function executeDispatchLaunch(context) {
  const {
    args,
    deps,
    item,
    now,
    adapter,
    finalChosenCandidate,
    finalChosenKey,
    harnessName,
    rootDir,
    decisionDir,
    checkpointFile,
    checkpoint,
    lastDecision,
    limitsEnforcement,
    launcher,
    baseResolution,
    resolvedBaseSha,
    launchTimeoutMs,
    workerTimeoutMs,
    tokenBudget,
    outputCeiling,
    selectedMode,
    log,
    exit,
    route,
    promptText,
    usageFile,
  } = context;
  const decisionsStore = require('../decisions');
  const sourcesApi = require('../sources');
  const { readSessionId, workerName } = require('../executor');
  const { parseLastJson } = require('../harness');
  let launchRes = null;
  let thrownError = null;
  let isFailure = true;
  let sessionHandle = null;
  let handedOff = false;
  let launchPending = false;
  let launchAttempted = false;
  let launchArgs = null;
  try {
    const validation = adapter.validateLaunch?.({ accountId: finalChosenCandidate.accountId });
    if (validation) launchArgs = validation;
    else if (adapter.requiresUsageReport && !usageFile) {
      throw new Error('HARNESS_USAGE_REPORT_REQUIRED');
    }
    if (!launchArgs)
      launchArgs = adapter.launch({
        candidateKey: finalChosenKey,
        provider:
          (route && route.provider) || finalChosenCandidate.source || finalChosenCandidate.upstream,
        model: sourcesApi.qualifyModel(finalChosenCandidate.modelId, route),
        accountId: finalChosenCandidate.accountId,
        gateway: finalChosenCandidate.gateway || '',
        upstream: finalChosenCandidate.upstream,
        quotaScope: finalChosenCandidate.quotaScope,
        prompt: promptText,
        branch: item.branch,
        base: resolvedBaseSha,
        cwd: baseResolution.cwd || args.cwd || (deps && deps.cwd) || rootDir,
        usageFile: usageFile,
        checkpoint: checkpointFile,
        maxAttempts: 1,
        title: workerName(item.workItemId),
        labels: {
          workItem: item.workItemId,
          role: item.role,
          project: args.project || 'shipde-platform',
        },
        printTimeoutSec:
          Number(args['timeout-sec'] || args.timeoutSec || deps?.timeoutSec) ||
          (args.timeout ? Number(args.timeout) : 3600),
        timeoutMs: launchTimeoutMs,
        workerTimeoutMs,
        tokenBudget,
        outputCeiling,
        mode: selectedMode,
        effort: finalChosenCandidate.effort || args.effort || deps?.effort,
      });
  } catch (err) {
    log('Harness launch preparation failed: ' + (err.message || String(err)));
    thrownError = err;
    launchRes = {
      exitCode: err.exitCode !== undefined ? err.exitCode : 1,
      stdout: '',
      stderr: err.stderr || err.message || String(err),
      error: err,
    };
  }

  if (launchArgs && !Array.isArray(launchArgs)) {
    const reason = launchArgs.reason || launchArgs.refusal || launchArgs.error || 'LAUNCH_REFUSED';
    log('Harness launch refused: ' + reason);
    thrownError = new Error(reason);
    launchRes = {
      exitCode: launchArgs.exitCode !== undefined ? launchArgs.exitCode : 1,
      stdout: '',
      stderr: reason,
      error: thrownError,
    };
    launchArgs = null;
  }

  if (launchArgs) {
    try {
      decisionsStore.recordDecision(
        {
          stage:
            checkpoint && checkpoint.chosen
              ? decisionsStore.Stage.RESUMED
              : decisionsStore.Stage.LAUNCHED,
          workItemId: item.workItemId,
          role: item.role,
          chosen: finalChosenKey,
          harness: harnessName,
          branch: item.branch,
          // The claim on the branch, written before the launch. It is a claim,
          // not a handle: the durable session id is only knowable once the
          // harness has written its report, and it is recorded on the line
          // below. It was `process.pid` here, which is a Node process id and
          // not a session — decisions.js then treated that value as the
          // session to resume (audit section 4, Gap C).
          sessionId: null,
          worktree: args.cwd || rootDir,
          area: item.area,
          firstChoice: lastDecision ? lastDecision.chosen || finalChosenKey : finalChosenKey,
          selected: finalChosenKey,
          excluded: lastDecision
            ? (lastDecision.rejected || []).map((r) => ({
                candidateKey: r.offeringId,
                reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
                reason: r.reason,
              }))
            : [],
          quota:
            lastDecision && lastDecision.candidates
              ? lastDecision.candidates.map((c) => ({
                  candidateKey: c.offeringId,
                  score: c.score,
                  headroom: c.headroom,
                }))
              : [],
          resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
          checkpoint: checkpointFile,
          limitsEnforcement,
        },
        { dir: decisionDir, now }
      );
    } catch (err) {
      log('Failed to append LAUNCHED to decision log');
      exit(1);
      return {
        fatal: { exitCode: 1, error: err },
        launchRes,
        thrownError,
        isFailure,
        sessionHandle,
        handedOff,
        launchPending,
      };
    }

    try {
      launchAttempted = true;
      launchRes = launcher(adapter, launchArgs, {
        cwd: baseResolution.cwd || args.cwd || (deps && deps.cwd) || rootDir,
        // The pinned base the worker root is provisioned at (AI-64-R15).
        baseSha: resolvedBaseSha,
        branch: item.branch,
        workItemId: item.workItemId,
        // TASK-AI-127 WD-R03: WORKER_DEPS_UNAVAILABLE warnings land in the
        // same decision log this dispatch records its launch in.
        decisionDir,
        checkpoint: checkpointFile,
        timeoutMs: launchTimeoutMs,
        workerTimeoutMs,
        tokenBudget,
        outputCeiling,
        mode: selectedMode,
        candidateKey: finalChosenKey,
        candidate: finalChosenCandidate,
        model: finalChosenCandidate.modelId || finalChosenCandidate.model,
        modelId: finalChosenCandidate.modelId || finalChosenCandidate.model,
        account: finalChosenCandidate.accountId || finalChosenCandidate.account,
        accountId: finalChosenCandidate.accountId || finalChosenCandidate.account,
        harness: harnessName,
        effort: finalChosenCandidate.effort || args.effort || deps?.effort,
      });
    } catch (err) {
      thrownError = err;
      launchRes = {
        exitCode: err.exitCode !== undefined ? err.exitCode : -1,
        stdout: '',
        stderr: err.stderr || err.message || String(err),
        error: err,
      };
    }
  }

  if (deps && deps.rethrow && thrownError) {
    throw thrownError;
  }

  isFailure =
    thrownError !== null ||
    !launchRes ||
    launchRes.exitCode !== 0 ||
    (typeof launchRes.httpStatus === 'number' && launchRes.httpStatus >= 400);

  // The durable handle, read from the report the launch was given. Never a
  // pid, a timestamp or a stdout guess.
  const sessionReceipt = readSessionId(
    adapter,
    {
      usageFile,
      accountId: finalChosenCandidate.accountId || finalChosenCandidate.account,
    },
    launchRes || {}
  );
  sessionHandle = sessionReceipt.id;
  if ((usageFile || adapter.backgroundLaunch) && !sessionHandle) {
    // The caller asked for a durable report and the report carries no
    // session id, so this launch cannot be resumed or stopped. A launch the
    // loop cannot find again is a failed launch (AI-64-R04), not a success
    // with a null handle.
    isFailure = true;
  }
  if (sessionHandle) {
    // The claim now carries the session it is a claim about, so a restart
    // resumes that session instead of starting a second writer.
    decisionsStore.recordDecision(
      {
        stage: decisionsStore.Stage.LAUNCHED,
        workItemId: item.workItemId,
        role: item.role,
        chosen: finalChosenKey,
        harness: harnessName,
        branch: item.branch,
        sessionId: sessionHandle,
        worktree: args.cwd || rootDir,
        area: item.area,
        detail: 'DURABLE_SESSION_ID',
      },
      { dir: decisionDir, now }
    );
  }

  const parsed = launchRes && launchRes.stdout ? parseLastJson(launchRes.stdout) : null;
  if (parsed && parsed.status && /fail|error|refus|stalled|timeout/i.test(String(parsed.status))) {
    isFailure = true;
  }

  handedOff = adapter.backgroundLaunch === true && !isFailure && Boolean(sessionHandle);
  if (adapter.backgroundLaunch === true && launchAttempted && isFailure) {
    launchPending = true;
    try {
      const reconciliation = adapter.onLaunchFailed?.(
        {
          usageFile,
          accountId: finalChosenCandidate.accountId || finalChosenCandidate.account,
          candidateKey: finalChosenKey,
        },
        launchRes
      );
      if (reconciliation?.pending === false) launchPending = false;
    } catch {
      /* Uncertainty preserves ownership. */
    }
  }

  try {
    if (!handedOff && !launchPending)
      decisionsStore.recordDecision(
        {
          stage: isFailure ? decisionsStore.Stage.FAILED : decisionsStore.Stage.COMPLETED,
          workItemId: item.workItemId,
          role: item.role,
          chosen: finalChosenKey,
          harness: harnessName,
          branch: item.branch,
          sessionId: sessionHandle,
          worktree: args.cwd || rootDir,
          area: item.area,
          outcome: isFailure ? 'failed' : 'passed',
          detail:
            (usageFile || adapter.backgroundLaunch) && !sessionHandle
              ? launchRes?.exitCode !== 0
                ? 'LAUNCH_FAILED'
                : sessionReceipt.cause || 'HARNESS_NO_SESSION_ID'
              : null,
          firstChoice: lastDecision ? lastDecision.chosen || finalChosenKey : finalChosenKey,
          selected: finalChosenKey,
          excluded: lastDecision
            ? (lastDecision.rejected || []).map((r) => ({
                candidateKey: r.offeringId,
                reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
                reason: r.reason,
              }))
            : [],
          quota:
            lastDecision && lastDecision.candidates
              ? lastDecision.candidates.map((c) => ({
                  candidateKey: c.offeringId,
                  score: c.score,
                  headroom: c.headroom,
                }))
              : [],
          resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
          checkpoint: checkpointFile,
        },
        { dir: decisionDir, now }
      );
  } catch (err) {}
  return { launchRes, thrownError, isFailure, sessionHandle, handedOff, launchPending };
}

module.exports = {
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
  mergeEvidenceAccounts,
  routeScopeOf,
  assembleForDispatch,
  readCheckpoint,
  writeJsonFile,
  usageReportFile,
  sevenFields,
  quotaSnapshot,
  candidateFromDecision,
  simulatedFailureFor,
  sameFailureDomain,
  applyFailureBlocks,
  applyDryRunBlocks,
  candidateContextWindow,
  applyHarnessVerification,
  buildDryRunLog,
  resolveFixturePaths,
  dispatchProfileCommand,
  coordinatorDispatchCommand,
  resolveExecuteBase,
  executeDispatchLaunch,
};
