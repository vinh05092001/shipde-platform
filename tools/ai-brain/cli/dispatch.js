'use strict';

const path = require('path');
const { currentBranch, headSha, commitExists } = require('../facts');
const { toPositiveInteger } = require('../source-discovery');
const { atomicRenameSync } = require('../atomic-rename');
const { maskEmailsInString } = require('../route-identity-utils');
const { pick, readJsonOrExit, loadRegister, quotaCommand } = require('./reconcile-manifest');
const {
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
} = require('./dispatch-helpers');

function dispatchCommand(args, deps = {}) {
  if (args.offline !== undefined) return coordinatorDispatchCommand(args, deps);
  const fs = require('fs');
  const rootDir = args.root || (deps && deps.rootDir) || process.cwd();
  const execute = args.execute === true;
  const dryRunFlag = Boolean(args['dry-run'] || args.dryRun);
  const isDryRun = dryRunFlag || !execute;
  const { fixtureDir, opencodeModelsFixture, comboFixture, hasOfflineFixture } =
    resolveFixturePaths(args, deps);
  // Only the real CLI entry sets this: injected test seams keep their paths.
  const noInference = isDryRun && (deps.dryRunOffline === true || hasOfflineFixture);
  const output = deps.log || console.log;
  const log = args.json && !args.plan ? () => {} : output;
  const error = deps.error || console.error;
  const exit = deps.exit || process.exit;
  let item = null;
  let lastDecision = null;
  const makeExecuteResult = (code, chosen, launchedId, outcome, recorded, extra = {}) => {
    const maskValue = (v) =>
      typeof v === 'string'
        ? maskEmailsInString(v)
        : Array.isArray(v)
          ? v.map(maskValue)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v).map(([k, val]) => [maskValue(k), maskValue(val)])
              )
            : v;
    const res = maskValue({
      chosen: chosen || null,
      launchedArgvIdentity: launchedId || null,
      outcome: outcome || null,
      recorded: recorded || null,
      ...(item && item.itemSource ? { itemSource: item.itemSource } : {}),
      ...(extra.assessment || (lastDecision && lastDecision.assessment) || (deps && deps.assessment)
        ? {
            assessment:
              extra.assessment || (lastDecision && lastDecision.assessment) || deps.assessment,
          }
        : {}),
      ...extra,
    });
    if (args.json) output(JSON.stringify(res, null, 2));
    exit(code);
    return { exitCode: code, ...res };
  };

  // Combo-only routing: no catalogue freshness gate; 9router owns model health.

  // Releasing a claim is its own operation:
  const close = args.close || args.complete || args.fail;
  if (typeof close === 'string') {
    const decisions = require('../decisions');
    const outcome = args.fail ? 'failed' : 'completed';
    const released = decisions.closeWriter(close, outcome, {
      dir: args['decision-dir'] || (deps && deps.decisionDir) || undefined,
      detail: typeof args.detail === 'string' ? args.detail : null,
    });
    if (!released) {
      log('No open writer for ' + close + '; nothing to release.');
      return { exitCode: 0, released: false };
    }
    log(
      'Released ' + close + ' (' + outcome + ', session ' + (released.sessionId || 'unknown') + ')'
    );
    return { exitCode: 0, released: true };
  }

  if (execute && dryRunFlag) {
    error('Dispatch refused: --execute and --dry-run are exclusive.');
    exit(2);
    return { exitCode: 2 };
  }

  if (execute && hasOfflineFixture) {
    error('Dispatch refused: REPLAY_FIXTURE_WITH_EXECUTE (replay fixtures apply only to dry-run).');
    return makeExecuteResult(
      2,
      null,
      null,
      { status: 'refused', reason: 'REPLAY_FIXTURE_WITH_EXECUTE' },
      null,
      {
        error: 'REPLAY_FIXTURE_WITH_EXECUTE',
        code: 'REPLAY_FIXTURE_WITH_EXECUTE',
        reason: 'REPLAY_FIXTURE_WITH_EXECUTE',
      }
    );
  }

  // TASK-AI-65: report a structured execution outcome for a pinned candidate.
  // The evidence store and cooldowns are updated through routing.js before any
  // next ranking round, so a failure is seen by the Controller, not just logged.
  const reportOutcome = pick(args, 'report-outcome', 'reportOutcome');
  if (typeof reportOutcome === 'string') {
    const routing = require('../routing');
    return routing.reportDispatchOutcome(args, {
      log,
      error,
      exit,
      rootDir,
      evidenceDir:
        (deps && deps.evidenceDir) ||
        args['evidence-dir'] ||
        path.join(__dirname, '..', 'data', 'evidence'),
      decisionDir: args['decision-dir'] || (deps && deps.decisionDir) || undefined,
      now: deps && deps.now,
      storePath: deps && deps.storePath,
      home: (deps && deps.home) || args.home || undefined,
      fakeRunsDir:
        (deps && deps.fakeRunsDir) || args['pool-runtime-dir'] || args['agy-runs-dir'] || undefined,
    });
  }

  // TASK-AI-65: profile-driven live routing. The profile names the task, its
  // floors and its constraints; JEV advises (never a model); the Controller
  // ranks; rank 1 is pinned and, under --execute, reserved. Async, because the
  // JEV advisory is.
  if (
    !args.plan &&
    !Array.isArray(deps.candidates) &&
    (args['combo-config'] || deps.readDispatchComboConfig || comboFixture) &&
    deps.nineRouterComboConfig === undefined
  ) {
    const registry = deps.registry || require('../sources').loadSources();
    if (args['combo-config']) {
      const config = JSON.parse(fs.readFileSync(args['combo-config'], 'utf8'));
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Invalid combo configuration: expected an object');
      }
      return dispatchCommand(args, { ...deps, registry, nineRouterComboConfig: config });
    }
    const read = deps.readDispatchComboConfig || require('../writer-combo').readComboConfig;
    return Promise.resolve()
      .then(() =>
        read({
          registry,
          signal: AbortSignal.timeout(3000),
          comboFixture,
          fixtureDir,
          env: (deps && deps.env) || process.env,
        })
      )
      .catch(() => ({ members: null, state: 'COMBO_CONFIG_UNAVAILABLE' }))
      .then((config) =>
        dispatchCommand(args, {
          ...deps,
          registry,
          nineRouterComboConfig: config,
          ...(fixtureDir ? { fixtureDir } : {}),
          ...(comboFixture ? { comboFixture } : {}),
          ...(opencodeModelsFixture ? { opencodeModelsFixture } : {}),
        })
      );
  }

  if (typeof args.profile === 'string') {
    return dispatchProfileCommand(args, deps);
  }

  if (!noInference && deps && deps.refreshRoutes === true && !Array.isArray(deps.candidates)) {
    const routeHealthApi = require('../route-health');
    // Same order as orchestrate and next: args, then deps, then root, then default.
    const healthFile =
      (args && (args['route-health'] || args.routeHealthFile)) ||
      deps.routeHealthFile ||
      deps['route-health'] ||
      (args && args.root
        ? path.join(args.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
        : null) ||
      path.join(__dirname, '..', 'data', 'model-route-health.json');
    const registryForProbe = deps.registry || require('../sources').loadSources();
    const healthStore =
      deps.routeHealth || routeHealthApi.loadStore(healthFile, { allowMissing: true });
    return routeHealthApi
      .recheckBeforeSelection(
        healthStore,
        deps.probeRoute ||
          ((model, route, probeOptions) =>
            routeHealthApi.probeGatewayModel(
              model,
              route,
              Object.assign({ registry: registryForProbe }, probeOptions)
            )),
        {
          now: deps.now,
          cap: deps.probeCap,
          timeoutMs: deps.probeTimeoutMs,
          catalogue: (deps.discoveryCatalogue && deps.discoveryCatalogue.candidates) || [],
          registry: registryForProbe,
          accounts: deps.accounts || [],
        }
      )
      .then((result) => {
        routeHealthApi.saveStore(healthFile, healthStore);
        if (deps.onRouteRefresh) deps.onRouteRefresh(result);
        return dispatchCommand(
          Object.assign({}, args, { 'route-health-refreshed': true }),
          Object.assign({}, deps, {
            refreshRoutes: false,
            routeHealth: healthStore,
            registry: registryForProbe,
          })
        );
      });
  }

  // Pre-computed plan file fallback
  if (typeof args.plan === 'string') {
    const { executePlan } = require('../executor');
    const { resolveExecuteTarget } = require('../execute-target');
    const plan = readJsonOrExit(path.resolve(args.plan), 'plan');
    // TASK-AI-171 R2: resolve once and pass the frozen validated target.
    const planTarget = resolveExecuteTarget(
      { ...args, execute: !isDryRun },
      { ...deps, rootDir, executeMode: !isDryRun }
    );
    if (!isDryRun && !planTarget.ok) {
      error(`Plan refused: ${planTarget.code} (${planTarget.detail || 'unresolved target'})`);
      exit(1);
      return { exitCode: 1, refusal: planTarget.code };
    }
    const result = executePlan(plan, {
      dryRun: isDryRun,
      isolatedWorker: args['isolated-worker'] || false,
      project: args.project || 'shipde-platform',
      cwd: planTarget.cwd || args.cwd || (deps && deps.cwd) || undefined,
      base: (planTarget.ok && planTarget.baseSha) || args.base || (deps && deps.base) || undefined,
      baseSha:
        (planTarget.ok && planTarget.baseSha) ||
        args['base-sha'] ||
        args.baseSha ||
        (deps && deps.baseSha) ||
        undefined,
      executeTarget: planTarget,
      decisionDir: args['decision-dir'] || (deps && deps.decisionDir) || undefined,
      run: deps && deps.run,
    });
    const s = result.summary;
    if (args.json) {
      log(JSON.stringify({ plan, result }, null, 2));
      exit(s.failed > 0 ? 1 : 0);
      return { exitCode: s.failed > 0 ? 1 : 0, plan, result };
    }
    if (result.dryRun) {
      log('Dispatch dry run: ' + (plan.assignments || []).length + ' planned, 0 launched');
      exit(0);
      return { exitCode: 0, result };
    }
    exit(s.failed > 0 ? 1 : 0);
    return { exitCode: s.failed > 0 ? 1 : 0, result };
  }

  // Work items resolution
  let items = [];
  const targetItemId = args.item || args['work-item'] || (deps && deps.workItemId);
  const ticketPath = args.ticket || (deps && deps.ticket);
  if (deps && deps.items) {
    items = deps.items;
  } else if (ticketPath) {
    const { parseTicket } = require('../ticket-parser');
    const resolvedPath = path.isAbsolute(ticketPath)
      ? ticketPath
      : path.resolve(rootDir, ticketPath);
    const content =
      (deps && deps.ticketContent) ||
      (fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, 'utf8') : '');
    const parsed = parseTicket(content, ticketPath);
    items = [
      {
        ...parsed,
        workItemId: parsed.id,
        role: args.role || (deps && deps.role) || 'author.foundation',
        branch: args.branch || (deps && deps.branch) || 'feat/' + String(parsed.id).toLowerCase(),
        itemSource: ticketPath,
        priority: 0,
      },
    ];
  } else if (targetItemId) {
    items = [
      {
        workItemId: targetItemId,
        role: args.role || (deps && deps.role) || 'author.foundation',
        branch:
          args.branch || (deps && deps.branch) || 'feat/' + String(targetItemId).toLowerCase(),
        riskDomains: [],
        priority: 0,
      },
    ];
  } else {
    const csvPath =
      args.csv ||
      path.join(
        rootDir,
        'docs',
        'product-spec',
        'docs',
        '10-ai-collaboration',
        'FEATURE-DELIVERY-REGISTER.csv'
      );
    if (!fs.existsSync(csvPath)) {
      if (args.csv) {
        error('SOURCE_MISSING: ' + csvPath);
        exit(2);
        return { exitCode: 2 };
      }
      items = [];
    } else {
      const register = loadRegister(csvPath, null, rootDir);
      items = ((register.data && register.data.items) || [])
        .filter((row) => row.status === 'READY_FOR_AUTHOR')
        .map((row) => ({
          workItemId: row.work_item_id,
          role: 'author.foundation',
          branch: row.branch || null,
          riskDomains: [],
          priority: 0,
        }));
    }
  }

  if (items.length === 0 && !deps.candidates && !args.item && !ticketPath) {
    log('Dispatch: 0 assignments (0 deferred)');
    exit(0);
    return { exitCode: 0, dispatched: 0 };
  }

  item = items[0] || {
    workItemId: targetItemId || 'TASK-DISPATCH',
    role: args.role || (deps && deps.role) || 'author.foundation',
    branch: args.branch || (deps && deps.branch) || 'feat/dispatch-work',
  };

  const sourcesApi = require('../sources');
  const evidence = require('../evidence');
  const ranking = require('../ranking');
  const candidatesApi = require('../candidates');
  const quotaStore = require('../quota-store');
  const { listAccounts } = require('../accounts');
  const { readDiscoveryCatalogue } = require('../discovery/read');
  const { getHarness, runHarness, parseLastJson, structuredOutcome } = require('../harness');
  // The durable-session-id rule lives with the executor, which owns the harness
  // contract; this file reads it from there rather than keeping a second copy.
  const { readSessionId } = require('../executor');
  const { workerName, defaultPrompt } = require('../executor');

  const registry = (deps && deps.registry) || sourcesApi.loadSources();
  const evidenceDir =
    (deps && deps.evidenceDir) ||
    args['evidence-dir'] ||
    path.join(__dirname, '..', 'data', 'evidence');
  const decisionDir = (deps && deps.decisionDir) || args['decision-dir'] || undefined;

  // 1. Candidates from discovery + offerings
  let discCat = deps && deps.discoveryCatalogue;
  if (!discCat && (!deps || !deps.candidates)) {
    const discDir =
      (deps && deps.discoveryDataDir) ||
      args['discovery-dir'] ||
      path.join(__dirname, '..', 'data', 'discovery');
    try {
      discCat = readDiscoveryCatalogue({ dataDir: discDir });
      const { catalogueFreshness } = require('../catalogue-refresh');
      discCat.freshness = catalogueFreshness({ dataDir: discDir, now: deps && deps.now });
      discCat.stale = discCat.freshness?.stale;
    } catch {
      discCat = { candidates: [] };
    }
  }

  const isCandidateInjected = Array.isArray(deps && deps.candidates);
  const rollingOnboard = require('../rolling-onboard');
  const env = (deps && deps.env) || process.env;
  const evidenceData = (deps && deps.evidenceData) || evidence.loadEvidence(evidenceDir);
  const scoring = require('../scoring-policy');
  const scoringAssessment = scoring.loadScoringPolicy(
    args['scoring-policy'] || deps.scoringPolicyFile
  );
  const newSources =
    noInference ||
    (deps && deps.onboardingPrepared) ||
    isCandidateInjected ||
    args['onboarding-prepared'] ||
    args.onboardingPrepared
      ? []
      : rollingOnboard.detectNewSources(registry, evidenceData, env);

  // Like the route-refresh, JEV and capability-probe branches below, onboarding makes this
  // call asynchronous. dispatchCommand's only caller (the `dispatch` command) already
  // awaits a returned promise and turns a rejection into a non-zero exit.
  if (newSources.length > 0) {
    // Onboarding only records evidence, route health and quota. Accounts stay owned by the
    // account registry: no binding is invented here, so isolation and quota policy hold.
    return rollingOnboard
      .autoOnboardNewSources(newSources, {
        ...deps,
        evidenceData,
        evidenceDir,
        registry,
        env,
      })
      .then(() =>
        dispatchCommand(args, {
          ...deps,
          onboardingPrepared: true,
          evidenceData,
        })
      );
  }

  const accounts = deps && deps.accounts !== undefined ? deps.accounts : listAccounts() || [];
  const routeHealthApi = require('../route-health');
  const { fixtureDir: dispatchFixtureDir, opencodeModelsFixture: dispatchOpencodeModelsFixture } =
    resolveFixturePaths(args, deps);
  const ticketRoute = {
    scanFile: args['scan-file'] || deps.scanFile,
    routeHealthFile: args['route-health'] || args.routeHealthFile || deps.routeHealthFile,
    role: item.role,
    routeScope: routeScopeOf(args['route-scope'] ?? item.routeScope),
    ...(noInference ? { refreshRoutes: false } : {}),
    ...(dispatchFixtureDir ? { fixtureDir: dispatchFixtureDir } : {}),
    ...(dispatchOpencodeModelsFixture
      ? { opencodeModelsFixture: dispatchOpencodeModelsFixture }
      : {}),
  };
  const candidateList = assembleForDispatch(
    discCat,
    accounts,
    registry,
    Array.isArray(deps.candidates) || deps.allowUnprobedCandidates === true
      ? { ...deps, ...ticketRoute }
      : { ...deps, ...ticketRoute, requireRouteHealth: true }
  );

  // Filter by explicit pins (--model, --account, --harness)
  const pinModel = args.model || (deps && deps.model);
  const pinAccount = args.account || (deps && deps.account);
  const pinHarness = args.harness || (deps && deps.harness);
  const isPinned = Boolean(pinModel || pinAccount || pinHarness);

  const eligibleCandidates = require('../dispatch-output').filterPins(candidateList, args, deps);

  // Handle dry-run
  if (isDryRun) {
    const now = (deps && deps.now) || Date.now();
    const checkpointFile =
      typeof args.checkpoint === 'string'
        ? path.resolve(rootDir, args.checkpoint)
        : deps && deps.checkpointFile;
    const decisionLogFile =
      typeof args['decision-log'] === 'string'
        ? path.resolve(rootDir, args['decision-log'])
        : deps && deps.decisionLogFile;
    const checkpoint = readCheckpoint(checkpointFile);
    const failedKeys = new Set((checkpoint && checkpoint.failedCandidates) || []);
    const resumed =
      Boolean(checkpoint && checkpoint.workItemId === item.workItemId && checkpoint.step) ||
      Boolean(failedKeys.size);
    const evidenceData = evidence.loadEvidence(evidenceDir);
    const quotaStateFile =
      args['quota-state'] ||
      args['quota-state-file'] ||
      args.quotaStateFile ||
      deps?.quotaStateFile;
    const annotateOpts = {
      now,
      ...(quotaStateFile ? { quotaStateFile } : {}),
      ...(deps?.quotaState ? { quotaState: deps.quotaState } : {}),
    };
    const annotated = candidatesApi.annotateCandidates(
      eligibleCandidates.map((c) => Object.assign({}, c)),
      evidenceData,
      annotateOpts
    );
    scoring.joinMeasurements(annotated, scoringAssessment, {
      ...deps,
      evidenceData,
      evidenceDir,
      now,
      routeHealthFile: args['route-health'] || deps.routeHealthFile,
    });
    applyHarnessVerification(annotated);

    for (const c of annotated) {
      const key = candidatesApi.candidateKey(c);
      if (failedKeys.has(key)) {
        c.blocked = true;
        c.blockReason = 'checkpoint resume skipped previously failed candidate';
        c.blockScope = 'candidate';
      }
    }

    const rankingContext = {
      workItemId: item.workItemId,
      role: item.role,
      kind: item.role,
      registry,
      evidenceData,
      decisionOpts: { dir: decisionDir, now },
      dryRun: true,
      headrooms: deps && deps.headrooms,
      load: deps && deps.load,
      reservations: deps && deps.reservations,
      explorationBudget:
        args['exploration-budget'] !== undefined ? Number(args['exploration-budget']) : 1,
      home: deps && deps.home,
      storePath: deps && deps.storePath,
      accounts,
      now,
      ...(quotaStateFile ? { quotaStateFile } : {}),
      ...(deps?.quotaState ? { quotaState: deps.quotaState } : {}),
    };
    const routing = require('../routing');
    const profile =
      deps.taskProfile ||
      require('../orchestrate').buildTaskProfile(
        { ...item, id: item.workItemId },
        { ...deps, enforceProofFloors: deps.enforceProofFloors === true }
      );
    // Production uses the same cached advisory assessment as the live writer.
    // Injected candidate fixtures remain offline unless they provide an ask.
    if (
      !noInference &&
      !deps.assessment &&
      (!Array.isArray(deps.candidates) ||
        typeof deps.jevAsk === 'function' ||
        typeof deps.jevHttpClient === 'function')
    ) {
      const jevSource = sourcesApi.getSource('jev', registry);
      const ask =
        deps.jevAsk ||
        require('../jev').buildJevAsk(jevSource, {
          home: deps.home,
          env: deps.env || process.env,
          httpClient: deps.jevHttpClient,
          timeoutMs: deps.jevTimeoutMs,
        });
      return require('../writer-selection')
        .assessOnce(profile, jevSource, ask, deps, routing)
        .then((assessment) =>
          dispatchCommand(args, {
            ...deps,
            registry,
            accounts,
            candidates: candidateList,
            routeScopeExclusions: candidateList.excludedRoutes,
            assessment,
          })
        );
    }
    if (
      !deps.capabilitiesPrepared &&
      annotated.some((c) =>
        (profile.requiredCapabilities || []).some(
          (cap) =>
            c.capabilities?.[cap] === undefined ||
            (c.capabilityDeclarations?.[cap] && !c.capabilityEvidence?.[cap]?.observedAt)
        )
      )
    ) {
      const probe = deps.probeCapabilities || require('../capability-probe').probeCapabilities;
      return Promise.resolve(
        probe(annotated, profile, {
          ...deps,
          registry,
          evidenceDir,
          externalWorkers: args['external-workers'] || deps.externalWorkers,
          allowNetwork: false,
        })
      ).then(() =>
        dispatchCommand(args, {
          ...deps,
          candidates: annotated,
          routeScopeExclusions: candidateList.excludedRoutes,
          capabilitiesPrepared: true,
          registry,
          accounts,
          evidenceDir,
        })
      );
    }
    const fallbackProfile = routing.controllerFallbackProfile(profile);
    const assessment = {
      ...(deps.assessment || {
        weightProfile: fallbackProfile,
        weights: routing.WEIGHT_PROFILES[fallbackProfile],
      }),
      ...scoringAssessment,
    };
    const rankDryRun = (offered) => {
      const result = routing.rankForProfile(offered, profile, assessment, {
        ...rankingContext,
        ...(deps.ranking || {}),
        priors: deps.priors === undefined ? deps.ranking?.priors : deps.priors,
        useStoredQuota: true,
      });
      if (deps.isolatedWorker && profile.role !== 'reviewer') {
        require('../probe-order').preferKnownGood(result, offered, {
          ...deps,
          registry,
          now,
          evidenceData,
        });
      }
      // Retain the dispatch CLI's existing output/checkpoint field names.
      return {
        ...result,
        scoringPolicyStatus: scoringAssessment.scoringPolicyStatus,
        candidates: result.ranking.map((candidate) => ({
          ...candidate,
          offeringId: candidate.candidateKey,
          headroom: candidate.headroomStatus,
          qualityLabel: candidate.qualityLabel,
        })),
        rejected: [
          ...result.rejected.map((candidate) => ({
            ...candidate,
            offeringId: candidate.candidateKey,
            reason: candidate.reason || candidate.reasonCode,
          })),
          ...(
            (offered && offered.excludedRoutes) ||
            (candidateList && candidateList.excludedRoutes) ||
            []
          ).map((candidate) => ({
            ...candidate,
            offeringId: candidate.candidateKey || candidate.offeringId,
            reason: candidate.reason || candidate.reasonCode,
          })),
        ],
      };
    };
    const decision = rankDryRun(annotated);
    if (item && item.itemSource) {
      decision.itemSource = item.itemSource;
    }
    const structured = () => {
      const out = require('../dispatch-output').dispatchOutput(
        profile,
        assessment,
        eligibleCandidates,
        decision
      );
      if (item && item.itemSource) {
        out.itemSource = item.itemSource;
      }
      return out;
    };
    scoring.printSources(decision, log);
    if (
      resumed &&
      checkpoint &&
      checkpoint.step === 'fallback_selected' &&
      checkpoint.fallbackCandidate &&
      // A saved fallback is resumed only while it is still usable now: a
      // blocked or credential-less candidate is not re-chosen (TASK-AI-186).
      annotated.some(
        (c) =>
          candidatesApi.candidateKey(c) === checkpoint.fallbackCandidate &&
          !c.blocked &&
          !c.credentialEnvMissing
      )
    ) {
      const resumedCandidate = annotated.find(
        (c) => candidatesApi.candidateKey(c) === checkpoint.fallbackCandidate
      );
      decision.chosen = checkpoint.fallbackCandidate;
      decision.harness = resumedCandidate ? resumedCandidate.harness : decision.harness;
      decision.reason = 'RESUMED_CHECKPOINT_FALLBACK: continuing saved fallback candidate';
    }
    for (const c of annotated) {
      const ranked = candidateFromDecision(decision, candidatesApi.candidateKey(c));
      if (ranked) {
        c.score = ranked.score;
        c.scoreBreakdown = ranked.scoreBreakdown;
        c.headroomStatus = ranked.headroom;
      }
    }

    if (isPinned) {
      log('PINNED');
    }

    if (!decision.chosen) {
      if (args.json) output(JSON.stringify(structured(), null, 2));
      log('No eligible candidate for ' + item.workItemId);
      for (const rej of decision.rejected) {
        log(
          '  EXCLUDED ' +
            rej.offeringId +
            ' — ' +
            rej.reason +
            (rej.scope ? ' [' + rej.scope + ']' : '')
        );
      }
      exit(1);
      return {
        exitCode: 1,
        decision,
        dryRun: true,
        ...(item && item.itemSource ? { itemSource: item.itemSource } : {}),
        ...(assessment ? { assessment } : {}),
        profile,
      };
    }

    const simulateFailure = args['simulate-failure'] || (deps && deps.simulateFailure);
    let simulatedFailure = null;
    let fallback = null;
    if (simulateFailure && simulateFailure !== false) {
      const chosenCandidate =
        annotated.find((c) => candidatesApi.candidateKey(c) === decision.chosen) ||
        candidateFromDecision(decision, decision.chosen);
      const shouldFail =
        simulateFailure === true ||
        simulateFailure === 'first' ||
        simulateFailure === decision.chosen ||
        (chosenCandidate && simulateFailure === candidatesApi.candidateKey(chosenCandidate));

      if (shouldFail && chosenCandidate && !resumed && !failedKeys.has(decision.chosen)) {
        const { classifyFailure } = require('../failure-classifier');
        const failureInput = (deps && deps.failureInput) || simulatedFailureFor(chosenCandidate);
        const classification = classifyFailure(failureInput);
        failedKeys.add(decision.chosen);
        simulatedFailure = {
          candidate: decision.chosen,
          failure: failureInput,
          innermostCause: classification.cause,
          classifierScope: classification.scope,
          cooldownMs: classification.cooldownMs,
        };

        const fallbackAnnotated = candidatesApi.annotateCandidates(
          eligibleCandidates.map((c) => Object.assign({}, c)),
          evidenceData,
          annotateOpts
        );
        applyDryRunBlocks(
          fallbackAnnotated,
          failedKeys,
          chosenCandidate,
          classification,
          classification.scope !== 'candidate' && classification.scope !== 'model'
        );
        let fallbackDecision = rankDryRun(fallbackAnnotated);
        let preferredDifferentFailureDomain = true;
        if (!fallbackDecision.chosen) {
          const exactOnlyAnnotated = candidatesApi.annotateCandidates(
            eligibleCandidates.map((c) => Object.assign({}, c)),
            evidenceData,
            annotateOpts
          );
          applyDryRunBlocks(exactOnlyAnnotated, failedKeys, chosenCandidate, classification, false);
          fallbackDecision = rankDryRun(exactOnlyAnnotated);
          preferredDifferentFailureDomain = false;
        }
        fallback = {
          chosen: fallbackDecision.chosen,
          reason: fallbackDecision.chosen
            ? preferredDifferentFailureDomain
              ? 'selected highest-ranked candidate outside the simulated failure domain'
              : 'no different failure domain remained; selected highest-ranked non-failed candidate'
            : 'no fallback candidate qualifies',
          preferredDifferentFailureDomain,
          decision: fallbackDecision,
        };
      } else if (resumed) {
        fallback = {
          chosen: decision.chosen,
          reason: 'checkpoint resume continued after prior simulated failure without retrying it',
          preferredDifferentFailureDomain: false,
          decision,
        };
      }
    }

    // firstChoice must stay the ORIGINAL first choice across resume.
    const originalFirstChoice =
      resumed && checkpoint && checkpoint.firstChoice
        ? checkpoint.firstChoice
        : decision.firstChoice || decision.chosen;

    const finalChoice = fallback && fallback.chosen ? fallback.chosen : decision.chosen;
    const nextCheckpoint = checkpointFile
      ? {
          schemaVersion: 1,
          workItemId: item.workItemId,
          step: fallback && fallback.chosen ? 'fallback_selected' : 'ranked',
          updatedAt: new Date(now).toISOString(),
          failedCandidates: Array.from(failedKeys),
          selectedCandidate: finalChoice,
          firstChoice: originalFirstChoice,
          fallbackCandidate: fallback && fallback.chosen,
          decisionLog: decisionLogFile || null,
        }
      : null;
    if (nextCheckpoint) {
      writeJsonFile(checkpointFile, nextCheckpoint);
    }

    if (decisionLogFile) {
      writeJsonFile(
        decisionLogFile,
        buildDryRunLog({
          item,
          now,
          resumed,
          annotated,
          decision,
          firstChoice: originalFirstChoice,
          simulatedFailure,
          fallback,
          checkpoint: nextCheckpoint
            ? {
                path: checkpointFile,
                step: nextCheckpoint.step,
                failedCandidates: nextCheckpoint.failedCandidates,
              }
            : checkpointFile
              ? { path: checkpointFile, loaded: Boolean(checkpoint) }
              : null,
          candidatesApi,
        })
      );
    }

    if (args.json)
      output(
        JSON.stringify(
          { ...structured(), fallback, simulatedFailure, checkpoint: nextCheckpoint },
          null,
          2
        )
      );
    log('Ranked candidates for ' + item.workItemId + ':');
    for (let i = 0; i < decision.candidates.length; i++) {
      const c = decision.candidates[i];
      const isUnscored =
        c.qualityLabel === 'QUALITY_UNKNOWN' ||
        (c.scoreBreakdown &&
          (c.scoreBreakdown.quality === null ||
            c.scoreBreakdown.quality === 'QUALITY_UNKNOWN' ||
            c.scoreBreakdown.qualityLabel === 'QUALITY_UNKNOWN')) ||
        c.score === null ||
        c.score === undefined ||
        c.score === 'chưa rõ' ||
        c.score === 'QUALITY_UNKNOWN';
      const displayScore = isUnscored ? 'QUALITY_UNKNOWN' : c.score;
      log('  ' + (i + 1) + '. ' + c.offeringId + ' (score: ' + displayScore + ')');
    }
    log('Chosen: ' + decision.chosen);
    if (fallback && fallback.chosen) {
      log('Fallback: ' + fallback.chosen);
    }
    if (checkpointFile) {
      log('Checkpoint: ' + checkpointFile);
    }
    exit(0);
    return {
      exitCode: 0,
      decision,
      fallback,
      simulatedFailure,
      checkpoint: nextCheckpoint,
      dryRun: true,
      ...(item && item.itemSource ? { itemSource: item.itemSource } : {}),
      ...(assessment ? { assessment } : {}),
      profile,
    };
  }

  // Execution with retry/fallback
  const checkpointFile =
    args['checkpoint'] && typeof args['checkpoint'] === 'string'
      ? path.resolve(rootDir, args['checkpoint'])
      : deps && deps.checkpointFile;
  const checkpoint = readCheckpoint(checkpointFile);
  const failedKeys = new Set((checkpoint && checkpoint.failedCandidates) || []);

  const maxAttempts = Number(
    args['max-attempts'] || args.maxAttempts || (deps && deps.maxAttempts) || 3
  );
  let attempt = 0;
  const decisionsStore = require('../decisions');
  const failureClassifier = require('../failure-classifier');
  const nowForWriter = (deps && deps.now) || Date.now();

  if (checkpoint && checkpoint.dryRunDispatch && checkpoint.dryRunDispatch.executeTouched) {
    log(`Work item ${item.workItemId} already executed according to checkpoint`);
    return { exitCode: 0 };
  }

  const activeWriter = decisionsStore.writerFor(item.workItemId, {
    dir: decisionDir,
    now: nowForWriter,
  });
  if (activeWriter) {
    log(`Work item ${item.workItemId} is already claimed by session ${activeWriter.sessionId}`);
    exit(1);
    return { exitCode: 1 };
  }

  let finalChosenCandidate = null;
  let finalChosenKey = null;
  let launchRes = null;
  let failedAttempts = [];
  let finalDecisionLog = null;

  if (
    checkpoint &&
    (checkpoint.chosen || checkpoint.selectedCandidate || checkpoint.candidateKey)
  ) {
    finalChosenKey = checkpoint.chosen || checkpoint.selectedCandidate || checkpoint.candidateKey;
    const parsedCheckpoint =
      require('../discovery/identity').parseCandidateKey(finalChosenKey) || {};
    const currentCheckpointCandidate = eligibleCandidates.find(
      (candidate) => candidatesApi.candidateKey(candidate) === finalChosenKey
    );
    // TASK-AI-186 (#605 review, P2): the checkpoint names the candidate, but its
    // credential is a fact about this process. Re-check it before resuming, so
    // a key removed after the checkpoint is refused instead of launched.
    const envMap = (deps && deps.env) || process.env;
    const sourceId =
      (currentCheckpointCandidate &&
        (currentCheckpointCandidate.gateway || currentCheckpointCandidate.source)) ||
      checkpoint.gateway ||
      checkpoint.source ||
      parsedCheckpoint.gateway;
    const checkpointSource = (
      Array.isArray(registry && registry.sources) ? registry.sources : []
    ).find((src) => src && src.id === sourceId);
    const checkpointKeyEnv =
      (currentCheckpointCandidate && currentCheckpointCandidate.apiKeyEnv) ||
      (checkpointSource && checkpointSource.credential && checkpointSource.credential.env) ||
      null;
    const checkpointCredentialMissing = Boolean(
      (currentCheckpointCandidate &&
        (currentCheckpointCandidate.credentialEnvMissing ||
          currentCheckpointCandidate.blockReason === 'CREDENTIAL_ENV_MISSING')) ||
      (checkpointKeyEnv && !envMap[checkpointKeyEnv])
    );
    if (checkpointCredentialMissing) {
      const reason =
        'CREDENTIAL_ENV_MISSING: cannot resume ' +
        finalChosenKey +
        ' without ' +
        (checkpointKeyEnv || 'its configured credential env');
      error(reason);
      exit(1);
      return { exitCode: 1, refusal: 'CREDENTIAL_ENV_MISSING', reason };
    }
    finalChosenCandidate = {
      offeringId: finalChosenKey,
      harness: checkpoint.harness || parsedCheckpoint.harness,
      source: currentCheckpointCandidate?.source || checkpoint.source,
      accessPath: checkpoint.accessPath || parsedCheckpoint.accessPath,
      upstream: checkpoint.upstream || parsedCheckpoint.upstream,
      gateway: checkpoint.gateway || parsedCheckpoint.gateway,
      accountId: checkpoint.accountId || parsedCheckpoint.account,
      quotaScope: checkpoint.quotaScope || parsedCheckpoint.quotaScope,
      modelId: checkpoint.modelId || parsedCheckpoint.modelId,
    };
    log('Resuming checkpointed decision for ' + finalChosenKey);
  }

  while (attempt < maxAttempts) {
    attempt += 1;
    const now = (deps && deps.now) || Date.now();

    if (!finalChosenKey) {
      const evidenceData = evidence.loadEvidence(evidenceDir);
      const quotaStateFile =
        args['quota-state'] ||
        args['quota-state-file'] ||
        args.quotaStateFile ||
        deps?.quotaStateFile;
      const annotateOpts = {
        now,
        ...(quotaStateFile ? { quotaStateFile } : {}),
        ...(deps?.quotaState ? { quotaState: deps.quotaState } : {}),
      };
      const annotated = candidatesApi.annotateCandidates(
        eligibleCandidates.map((c) => Object.assign({}, c)),
        evidenceData,
        annotateOpts
      );
      scoring.joinMeasurements(annotated, scoringAssessment, {
        ...deps,
        evidenceData,
        evidenceDir,
        now,
        routeHealthFile: args['route-health'] || deps.routeHealthFile,
      });
      applyHarnessVerification(annotated);

      for (const c of annotated) {
        const key = candidatesApi.candidateKey(c);
        if (failedKeys.has(key)) {
          c.blocked = true;
          c.blockReason = 'candidate failed in current dispatch run';
          c.blockScope = 'candidate';
          continue;
        }
        for (const f of failedAttempts) {
          if (f.key === key) {
            c.blocked = true;
            c.blockReason = 'candidate failed in current dispatch run';
            c.blockScope = 'candidate';
            break;
          }
          if (
            f.classification &&
            f.classification.scope !== 'candidate' &&
            f.classification.scope !== 'model' &&
            sameFailureDomain(c, f.candidate, f.classification)
          ) {
            c.blocked = true;
            c.blockReason = 'avoiding failure domain of previous attempt';
            c.blockScope = f.classification.scope || 'unknown';
            break;
          }
        }
      }

      const rankingContext = {
        workItemId: item.workItemId,
        role: item.role,
        kind: item.role,
        registry,
        evidenceData,
        decisionOpts: { dir: decisionDir, now },
        dryRun: false,
        headrooms: deps && deps.headrooms,
        load: deps && deps.load,
        reservations: deps && deps.reservations,
        explorationBudget:
          args['exploration-budget'] !== undefined ? Number(args['exploration-budget']) : 1,
        home: deps && deps.home,
        storePath: deps && deps.storePath,
        accounts,
        now,
        ...(quotaStateFile ? { quotaStateFile } : {}),
        ...(deps?.quotaState ? { quotaState: deps.quotaState } : {}),
      };

      const decision = ranking.rankAndRecord(annotated, {
        ...rankingContext,
        assessment: { ...deps.assessment, ...scoringAssessment },
        excludedRoutes: candidateList.excludedRoutes,
        pinnedOffering: typeof args.offering === 'string' ? args.offering : undefined,
      });
      scoring.printSources(decision, log);
      lastDecision = decision;
      if (item && item.itemSource) lastDecision.itemSource = item.itemSource;
      lastDecision.assessment = { ...deps.assessment, ...scoringAssessment };

      if (!decision.chosen) {
        log(
          'No eligible candidate for ' +
            item.workItemId +
            ' (attempt ' +
            attempt +
            '/' +
            maxAttempts +
            ')'
        );
        for (const rej of decision.rejected) {
          log(
            '  EXCLUDED ' +
              rej.offeringId +
              ' — ' +
              rej.reason +
              (rej.scope ? ' [' + rej.scope + ']' : '')
          );
        }
        const lastFail = failedAttempts[failedAttempts.length - 1];
        return makeExecuteResult(
          1,
          lastFail?.key,
          lastFail?.launchedArgvIdentity,
          lastFail?.outcome || {
            status: 'failed',
            reason: decision.pinnedOffering
              ? decision.reason.replace(/^REFUSED: /, '')
              : 'NO_ELIGIBLE_CANDIDATE',
          },
          lastFail?.recorded,
          { decision, attempts: attempt }
        );
      }

      finalChosenKey = decision.chosen;
      finalChosenCandidate = annotated.find(
        (c) => candidatesApi.candidateKey(c) === finalChosenKey
      ) || {
        offeringId: finalChosenKey,
        harness: decision.harness,
      };

      const harnessNameEarly =
        finalChosenCandidate.harness || (decision && decision.harness) || 'paseo';
      const chosenIdentityEarly =
        require('../discovery/identity').parseCandidateKey(finalChosenKey) || {};
      const candEarly = finalChosenCandidate;
      const preLaunchArgvIdentity = {
        harness: candEarly.harness || chosenIdentityEarly.harness || harnessNameEarly,
        accessPath: candEarly.accessPath || chosenIdentityEarly.accessPath || '',
        gateway: candEarly.gateway || chosenIdentityEarly.gateway || '',
        upstream: candEarly.upstream || chosenIdentityEarly.upstream || '',
        account: candEarly.accountId || candEarly.account || chosenIdentityEarly.account || '*',
        quotaScope: candEarly.quotaScope || chosenIdentityEarly.quotaScope || '',
        modelId: candEarly.modelId || candEarly.model || chosenIdentityEarly.modelId || '',
      };

      finalDecisionLog = {
        item,
        now,
        annotated,
        decision: decision,
        fallback: {},
        quotaState: annotated.map((c) => quotaSnapshot(c)),
        headrooms: deps && deps.headrooms,
        resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
        candidatesApi,
      };
      if (checkpointFile) writeJsonFile(checkpointFile, buildDryRunLog(finalDecisionLog));
    }

    // P1-1: Base validation runs on every execute path, including checkpoint resume.
    // TASK-AI-171 R2: ONE shared execute target via execute-target.js.
    const baseResolution = require('../execute-target').resolveExecuteTarget(args, {
      ...deps,
      item,
      provenance: deps?.provenance || args?.provenance,
      rootDir,
    });

    if (!baseResolution.ok) {
      error(
        `Dispatch refused: ${baseResolution.code} (${baseResolution.detail || 'unresolved base'})`
      );
      log(
        `Dispatch refused: ${baseResolution.code} (${baseResolution.detail || 'unresolved base'})`
      );
      const chosenIdentityForRefusal =
        require('../discovery/identity').parseCandidateKey(finalChosenKey) || {};
      const candForRefusal = finalChosenCandidate;
      const harnessForRefusal =
        candForRefusal.harness || (lastDecision && lastDecision.harness) || 'paseo';
      const refusalArgvIdentity = {
        harness: candForRefusal.harness || chosenIdentityForRefusal.harness || harnessForRefusal,
        accessPath: candForRefusal.accessPath || chosenIdentityForRefusal.accessPath || '',
        gateway: candForRefusal.gateway || chosenIdentityForRefusal.gateway || '',
        upstream: candForRefusal.upstream || chosenIdentityForRefusal.upstream || '',
        account:
          candForRefusal.accountId ||
          candForRefusal.account ||
          chosenIdentityForRefusal.account ||
          '*',
        quotaScope: candForRefusal.quotaScope || chosenIdentityForRefusal.quotaScope || '',
        modelId:
          candForRefusal.modelId || candForRefusal.model || chosenIdentityForRefusal.modelId || '',
      };
      return makeExecuteResult(
        1,
        finalChosenKey,
        refusalArgvIdentity,
        { status: 'refused', reason: baseResolution.code },
        null,
        {
          status: 'refused',
          refusal: baseResolution.code,
          reason: baseResolution.code,
          decision: lastDecision,
        }
      );
    }
    var resolvedBaseSha = baseResolution.baseSha;

    if (isPinned) log('PINNED');
    log(
      'Dispatching ' +
        item.workItemId +
        ' to ' +
        finalChosenKey +
        ' (attempt ' +
        attempt +
        '/' +
        maxAttempts +
        ')'
    );

    const reservationOpts = { home: deps && deps.home, storePath: deps && deps.storePath, now };
    quotaStore.recordReservation(
      item.workItemId,
      item.role,
      finalChosenCandidate.accountId || '*',
      finalChosenKey,
      100000,
      reservationOpts
    );

    let thrownError = null;
    let isFailure = true;
    let sessionHandle = null;
    let handedOff = false;
    let launchPending = false;
    let launchAttempted = false;
    let launchedArgvIdentity = null;
    try {
      let launcher = (deps && deps.run) || runHarness;
      // AI-64-P03: an injected runner replaces what runs the harness process; it
      // never decides whether the worker boundary exists. The old guard let a
      // caller that injected a runner switch isolation off silently, with no log
      // line, which is a control that only holds in the configuration nobody
      // tests.
      if (args['isolated-worker'] || deps?.isolatedWorker) {
        launcher = require('../isolation-launcher').getIsolatedLauncher();
      }

      const harnessName =
        finalChosenCandidate.harness || (lastDecision && lastDecision.harness) || 'paseo';
      const adapter =
        (deps && (deps.harnessAdapter || (deps.getHarness && deps.getHarness(harnessName)))) ||
        getHarness(harnessName);
      const route = sourcesApi.dispatchRoute(
        finalChosenCandidate.source ||
          finalChosenCandidate.upstream ||
          finalChosenCandidate.gateway,
        registry
      );
      const candidateKey = candidatesApi.candidateKey(finalChosenCandidate);
      if (candidateKey !== finalChosenKey) {
        throw new Error('CANDIDATE_KEY_CHANGED_BEFORE_LAUNCH');
      }

      const chosenIdentity =
        require('../discovery/identity').parseCandidateKey(finalChosenKey) || {};
      const cand = finalChosenCandidate;
      launchedArgvIdentity = {
        harness: cand.harness || chosenIdentity.harness || harnessName,
        accessPath: cand.accessPath || chosenIdentity.accessPath || '',
        gateway: cand.gateway || chosenIdentity.gateway || '',
        upstream: cand.upstream || chosenIdentity.upstream || '',
        account: cand.accountId || cand.account || chosenIdentity.account || '*',
        quotaScope: cand.quotaScope || chosenIdentity.quotaScope || '',
        modelId: cand.modelId || cand.model || chosenIdentity.modelId || '',
      };

      const pFile = args['prompt-file'] || args.promptFile || deps?.promptFile;
      const promptText = pFile
        ? fs.readFileSync(
            fs.existsSync(pFile) ? pFile : path.resolve(args.cwd || deps?.cwd || rootDir, pFile),
            'utf8'
          )
        : args.prompt ||
          deps?.prompt ||
          defaultPrompt(item, {
            isolatedWorker: Boolean(args['isolated-worker'] || deps?.isolatedWorker),
          });

      const req = deps?.request || args?.request || (lastDecision && lastDecision.request) || {};
      const tokenBudget =
        (args && (args['token-budget'] || args.tokenBudget)) ||
        (deps && (deps['token-budget'] || deps.tokenBudget)) ||
        req.tokenBudget ||
        (lastDecision &&
          (lastDecision.tokenBudget ||
            (lastDecision.decision && lastDecision.decision.tokenBudget))) ||
        undefined;
      const outputCeiling =
        (args && (args['output-ceiling'] || args.outputCeiling)) ||
        (deps && (deps['output-ceiling'] || deps.outputCeiling)) ||
        req.outputCeiling ||
        (lastDecision &&
          (lastDecision.outputCeiling ||
            (lastDecision.decision && lastDecision.decision.outputCeiling))) ||
        undefined;
      const explicitTimeoutMs =
        Number(args['timeout-ms'] || args.timeoutMs || deps?.timeoutMs) ||
        (Number(args.timeout || deps?.timeout)
          ? Number(args.timeout || deps?.timeout) * 1000
          : undefined);
      const workerTimeoutMs =
        explicitTimeoutMs ||
        req.workerTimeoutMs ||
        (lastDecision &&
          (lastDecision.workerTimeoutMs ||
            (lastDecision.decision && lastDecision.decision.workerTimeoutMs))) ||
        undefined;
      const launchTimeoutMs = workerTimeoutMs || explicitTimeoutMs;
      const selectedMode =
        args.mode ||
        (deps && deps.mode) ||
        req.mode ||
        (lastDecision &&
          (lastDecision.mode || (lastDecision.decision && lastDecision.decision.mode))) ||
        undefined;

      const limitsEnforcement = {
        tokenBudget:
          adapter && (adapter.enforcesTokenBudget || adapter.enforces?.tokenBudget)
            ? 'enforced'
            : 'advisory',
        outputCeiling:
          adapter && (adapter.enforcesOutputCeiling || adapter.enforces?.outputCeiling)
            ? 'enforced'
            : 'advisory',
        workerTimeoutMs:
          adapter && (adapter.enforcesWorkerTimeout || adapter.enforces?.workerTimeoutMs)
            ? 'enforced'
            : 'advisory',
      };

      // The loop hands the harness a durable-report path. Under `-z` stdout is
      // the final response prose, so the session id can only come from the
      // report (TASK-AI-63), and a launch that cannot produce one is a launch
      // that cannot be resumed.
      const launchState = require('../cli').executeDispatchLaunch({
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
        usageFile: usageReportFile(args, deps, item, now),
      });
      ({ launchRes, thrownError, isFailure, sessionHandle, handedOff, launchPending } =
        launchState);
      if (launchState.fatal) return launchState.fatal;
    } finally {
      if (!handedOff && !launchPending)
        quotaStore.releaseReservation(item.workItemId, finalChosenKey, reservationOpts);
    }

    if (checkpointFile && finalDecisionLog) {
      const finalLogData = buildDryRunLog(finalDecisionLog);
      finalLogData.dryRunDispatch.executeTouched = true;
      finalLogData.dryRunDispatch.launched = true;
      finalLogData.outcome = launchPending
        ? 'unknown'
        : handedOff
          ? 'launched'
          : isFailure
            ? 'failed'
            : 'passed';
      try {
        writeJsonFile(checkpointFile, finalLogData);
      } catch (err) {}
    }

    if (launchPending) {
      return makeExecuteResult(
        1,
        finalChosenKey,
        launchedArgvIdentity,
        structuredOutcome(finalChosenKey, launchRes, null, {
          status: 'unknown',
          detail: 'LAUNCH_UNCONFIRMED',
          checkpoint: checkpointFile,
          sessionId: sessionHandle,
        }),
        { status: 'unknown' },
        { result: launchRes, attempts: attempt }
      );
    }
    if (handedOff) {
      return makeExecuteResult(
        0,
        finalChosenKey,
        launchedArgvIdentity,
        structuredOutcome(finalChosenKey, launchRes, null, {
          status: 'launched',
          checkpoint: checkpointFile,
          sessionId: sessionHandle,
        }),
        { status: 'launched' },
        { result: launchRes, attempts: attempt }
      );
    }
    if (!isFailure) {
      evidence.recordOutcome(evidenceDir, finalChosenCandidate, {
        status: 'passed',
        level: evidence.Level.OUTCOME,
        exitCode: 0,
        source: 'dispatch',
      });
      const parsedOutcome = launchRes?.stdout ? parseLastJson(launchRes.stdout) : null;
      const baseOutcome = structuredOutcome(finalChosenKey, launchRes, null, {
        status: 'completed',
        checkpoint: checkpointFile,
      });
      const outcome =
        parsedOutcome && typeof parsedOutcome === 'object'
          ? { ...baseOutcome, payload: parsedOutcome }
          : baseOutcome;
      log('Dispatch succeeded on ' + finalChosenKey);
      return makeExecuteResult(
        0,
        finalChosenKey,
        launchedArgvIdentity,
        outcome,
        { status: 'passed' },
        { result: launchRes, attempts: attempt }
      );
    } else {
      evidence.recordOutcome(evidenceDir, finalChosenCandidate, {
        status: 'failed',
        level: evidence.Level.OUTCOME,
        exitCode: launchRes ? launchRes.exitCode : -1,
        httpStatus: launchRes ? launchRes.httpStatus : undefined,
        body: launchRes
          ? launchRes.body || launchRes.stderr || launchRes.stdout
          : thrownError && thrownError.message,
        stderr: launchRes ? launchRes.stderr : thrownError && thrownError.message,
        cause: launchRes ? launchRes.body || launchRes.stderr : thrownError && thrownError.message,
        error: thrownError ? thrownError.message || String(thrownError) : undefined,
        source: 'dispatch',
      });
      const rawFail = {
        httpStatus: launchRes ? launchRes.httpStatus : undefined,
        body: launchRes
          ? launchRes.body || launchRes.stderr || launchRes.stdout
          : thrownError && thrownError.message,
        stderr: launchRes ? launchRes.stderr : thrownError && thrownError.message,
      };
      const classification = failureClassifier.classifyFailure({
        exitCode: launchRes ? launchRes.exitCode : -1,
        httpStatus: rawFail.httpStatus,
        body: rawFail.body,
        stderr: rawFail.stderr,
        accountId: finalChosenCandidate.accountId,
      });
      const isTimeout =
        classification?.cause === 'TIMEOUT' ||
        /timeout|stall|hang/i.test(
          String(rawFail.body || rawFail.stderr || (thrownError && thrownError.message) || '')
        );
      let lastRecorded = null;
      try {
        const routeHealthApi = require('../route-health');
        const storeOrPath = routeHealthApi.resolveRouteHealthFile(args, deps);
        const modelId =
          finalChosenCandidate.modelId || finalChosenCandidate.model || finalChosenCandidate.id;
        const routeId =
          finalChosenCandidate.upstream ||
          finalChosenCandidate.source ||
          finalChosenCandidate.gateway;
        const concurrency =
          deps && typeof deps.concurrency === 'number'
            ? deps.concurrency
            : deps && deps.load && typeof deps.load.activeWriters === 'number'
              ? deps.load.activeWriters
              : Array.isArray(deps && deps.load)
                ? deps.load.length
                : undefined;
        const recordResult = routeHealthApi.recordExecutionResult(
          storeOrPath,
          modelId,
          routeId,
          {
            status: isTimeout ? 408 : rawFail.httpStatus || 500,
            ok: false,
            timedOut: Boolean(isTimeout),
            reason: rawFail.body || rawFail.stderr || (thrownError && thrownError.message),
            elapsedMs: launchRes ? launchRes.elapsedMs : undefined,
            concurrency,
          },
          {
            now,
            persist: deps && deps.persistRouteHealth !== false,
            loadStore: deps && (deps.loadStore || deps.loader),
            saveStore: deps && (deps.saveStore || deps.saver),
          }
        );
        const pRec = recordResult?.store?.paths?.[recordResult?.key];
        lastRecorded = recordResult
          ? {
              key: recordResult.key,
              status: pRec?.status || recordResult.recorded?.reason,
              nextCheckAt: pRec?.nextCheckAt,
              reason: recordResult.recorded?.reason,
            }
          : null;
      } catch (_) {}
      const parsedOutcome = launchRes?.stdout ? parseLastJson(launchRes.stdout) : null;
      const baseOutcome = structuredOutcome(finalChosenKey, launchRes, classification, {
        status: 'failed',
        checkpoint: checkpointFile,
        reason: rawFail.body || rawFail.stderr || (thrownError && thrownError.message),
      });
      const outcome =
        parsedOutcome && typeof parsedOutcome === 'object'
          ? { ...baseOutcome, payload: parsedOutcome }
          : baseOutcome;
      failedAttempts.push({
        key: finalChosenKey,
        candidate: finalChosenCandidate,
        classification: classification,
        outcome,
        launchedArgvIdentity,
        recorded: lastRecorded,
      });
      const scrubbedStderr = decisionsStore.scrubText(rawFail.stderr);
      log('Candidate failed: ' + finalChosenKey + (scrubbedStderr ? ' — ' + scrubbedStderr : ''));
      finalChosenKey = null; // force re-ranking
      finalChosenCandidate = null;
    }
  }

  log('Max dispatch attempts (' + maxAttempts + ') reached without success.');
  const lastFail = failedAttempts[failedAttempts.length - 1];
  return makeExecuteResult(
    1,
    lastFail?.key || (lastDecision && lastDecision.chosen),
    lastFail?.launchedArgvIdentity,
    lastFail?.outcome || { status: 'failed', reason: 'MAX_ATTEMPTS_EXHAUSTED' },
    lastFail?.recorded,
    { decision: lastDecision, attempts: maxAttempts, failedAttempts }
  );
}

module.exports = {
  dispatchCommand,
};
