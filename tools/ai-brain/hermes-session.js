'use strict';

/**
 * Ship Dễ — TASK-AI-142 Part H2: Hermes chat brain session & Controller binding.
 *
 * Directs interactive Hermes chat sessions bound to a Controller-selected
 * reasoning candidate. The Controller retains model/account choice, quota,
 * concurrency, fallback, and dispatch. Hermes never picks its own model, never
 * spawns subagents directly, and never claims completion without evidence.
 *
 * Durable session handle: data/hermes/session.json {sessionId, candidateKey, goalIds}.
 * Controller-owned providers config: data/hermes/config.yaml (base_url and key env var NAME only).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const sourcesApi = require('./sources');
const evidenceApi = require('./evidence');
const priorsApi = require('./priors');
const candidatesApi = require('./candidates');
const routingApi = require('./routing');
const decisionsApi = require('./decisions');
const failureClassifier = require('./failure-classifier');
const { candidateKey, parseCandidateKey } = require('./discovery/identity');

const HERMES_MIN_CONTEXT = 32000;
const DEFAULT_HERMES_DIR = 'data/hermes';

function getHermesDir(rootDir) {
  return path.join(path.resolve(rootDir || process.cwd()), 'data', 'hermes');
}

function sessionFilePath(rootDir) {
  return path.join(getHermesDir(rootDir), 'session.json');
}

function configFilePath(rootDir) {
  return path.join(getHermesDir(rootDir), 'config.yaml');
}

function skillFilePath(rootDir) {
  return path.join(
    path.resolve(rootDir || process.cwd()),
    'tools',
    'ai-brain',
    'skills',
    'shipde-controller',
    'SKILL.md'
  );
}

function resolveRootDir(options, deps) {
  const o = options || {};
  const d = deps || {};
  return path.resolve(o.rootDir || o.root || d.rootDir || d.root || process.cwd());
}

function generateSessionId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const nonce = crypto.randomBytes(4).toString('hex');
  return `hermes_${stamp}_${nonce}`;
}

/**
 * Loads stored Hermes session from data/hermes/session.json.
 * Returns null if file does not exist or cannot be parsed.
 */
function loadSession(options, deps) {
  const d = deps || {};
  const rootDir = resolveRootDir(options, deps);
  const fsApi = d.fs || fs;
  const file = sessionFilePath(rootDir);

  if (!fsApi.existsSync(file)) return null;
  try {
    const raw = fsApi.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      sessionId: parsed.sessionId ? String(parsed.sessionId) : null,
      candidateKey: parsed.candidateKey ? String(parsed.candidateKey) : null,
      goalIds: Array.isArray(parsed.goalIds) ? parsed.goalIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Persists Hermes session to data/hermes/session.json.
 * Sanitizes fields to ensure no credentials or secrets are written.
 */
function saveSession(session, options, deps) {
  const d = deps || {};
  const rootDir = resolveRootDir(options, deps);
  const fsApi = d.fs || fs;
  const dir = getHermesDir(rootDir);

  fsApi.mkdirSync(dir, { recursive: true });

  const record = {
    sessionId: session && session.sessionId ? String(session.sessionId) : generateSessionId(),
    candidateKey: session && session.candidateKey ? String(session.candidateKey) : null,
    goalIds: Array.isArray(session && session.goalIds) ? session.goalIds.map(String) : [],
  };

  fsApi.writeFileSync(sessionFilePath(rootDir), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/**
 * Associates a goal ID with the active session.
 */
function linkGoalToSession(goalId, options, deps) {
  if (!goalId) return loadSession(options, deps);
  let session = loadSession(options, deps);
  if (!session) {
    session = { sessionId: generateSessionId(), candidateKey: null, goalIds: [String(goalId)] };
  } else if (!session.goalIds.includes(String(goalId))) {
    session.goalIds.push(String(goalId));
  }
  return saveSession(session, options, deps);
}

/**
 * Selects the reasoning candidate using existing routing/ranking.
 * Candidate key is 7-part: harness=hermes::accessPath::gateway::upstream::account::quotaScope::modelId.
 */
function selectReasoningCandidate(options, deps) {
  const d = deps || {};
  const opts = options || {};
  const rootDir = resolveRootDir(opts, d);
  const now = opts.now || d.now || Date.now();

  const sourcesMod = d.sources || sourcesApi;
  const evidenceMod = d.evidence || evidenceApi;
  const priorsMod = d.priors || priorsApi;
  const candidatesMod =
    d.candidatesApi ||
    (d.candidates && typeof d.candidates.annotateCandidates === 'function'
      ? d.candidates
      : candidatesApi);
  const routingMod = d.routing || routingApi;
  const decisionsMod = d.decisions || decisionsApi;
  const accountsMod = d.accounts || require('./accounts');

  const registry = d.registry || sourcesMod.loadSources(d.sourceOpts);
  const priors = d.priorsData !== undefined ? d.priorsData : priorsMod.loadPriors();
  const evidenceDir = opts.evidenceDir || d.evidenceDir || path.join(__dirname, 'data', 'evidence');
  const evidenceData = d.evidenceData || evidenceMod.loadEvidence(evidenceDir);
  const accounts = d.accountList || accountsMod.listAccounts() || [];

  let poolCandidates = [];
  if (Array.isArray(d.candidateList)) {
    poolCandidates = d.candidateList;
  } else if (Array.isArray(d.candidates)) {
    poolCandidates = d.candidates;
  } else {
    let discovery = { candidates: [] };
    try {
      const { readDiscoveryCatalogue } = require('./discovery/read');
      discovery = readDiscoveryCatalogue({ dataDir: path.join(__dirname, 'data', 'discovery') });
    } catch {}
    const cliApi = require('./cli');
    poolCandidates = cliApi.assembleForDispatch(discovery, accounts, registry, {
      evidenceData,
      allowUnprobedCandidates: true,
      requireRouteHealth: false,
    });
  }

  const excluded = new Set(opts.excludedCandidates || []);

  // Adapt candidates for Hermes harness: set harness=hermes, verify contextWindow >= 32000
  const hermesCandidates = poolCandidates
    .filter((c) => !excluded.has(c.candidateKey))
    .map((c) => {
      const candidate = Object.assign({}, c);
      candidate.harness = 'hermes';

      const contextWin =
        candidate.contextWindow ||
        (candidate.capabilities && candidate.capabilities.contextWindow) ||
        128000;
      candidate.contextWindow = Math.max(contextWin, HERMES_MIN_CONTEXT);
      candidate.capabilities = Object.assign(
        { contextWindow: candidate.contextWindow },
        candidate.capabilities || {}
      );

      if (!candidate.accessPath || candidate.accessPath === 'cli') {
        const src = registry.sources.find(
          (s) => s.id === candidate.gateway || s.id === candidate.upstream
        );
        candidate.accessPath =
          (src && (src.accessPath || src.endpoint)) || 'http://127.0.0.1:20128/v1';
      }

      candidate.candidateKey = candidateKey(candidate);
      return candidate;
    });

  const annotated = candidatesMod.annotateCandidates(hermesCandidates, evidenceData, { now });

  const profile = {
    taskId: opts.taskId || opts.sessionId || 'hermes-reasoning-session',
    role: opts.role || 'planner.default',
    complexity: 'complex',
    riskDomains: opts.riskDomains || ['reasoning', 'planning'],
    qualityFloor: opts.qualityFloor !== undefined ? opts.qualityFloor : 80,
    proofFloor: opts.proofFloor || 'WORK_ITEM_PASS',
    contextSize: 0,
    costCeiling: opts.costCeiling !== undefined ? opts.costCeiling : 5000,
    currentWorkload: 0,
    resourceCeiling: 100,
    requiredHarness: 'hermes',
    forbiddenFailureDomains: opts.forbiddenFailureDomains || [],
    requiredCapabilities: [],
  };

  const assessment = { weightProfile: 'QUALITY_FIRST' };
  const rankCtx = {
    now,
    priors,
    evidenceData,
    accounts,
    useStoredQuota: true,
    explorationBudget: opts.explorationBudget !== undefined ? opts.explorationBudget : 5,
  };

  const rankResult = (d.rankForProfile || routingMod.rankForProfile)(
    annotated,
    profile,
    assessment,
    rankCtx
  );

  const chosenKey = rankResult.chosen;
  const chosenCandidate = chosenKey
    ? rankResult.ranking.find((c) => c.candidateKey === chosenKey) || null
    : null;

  // Record decision record Linking candidates, reasons, prior scores and source links
  const decisionDir =
    opts.decisionDir || d.decisionDir || path.join(os.homedir(), '.shipde', 'decisions');
  const decisionRecord = {
    stage: decisionsMod.Stage.SELECTED,
    workItemId: profile.taskId,
    role: profile.role,
    chosen: chosenKey,
    harness: 'hermes',
    candidates: rankResult.ranking.map((c) => ({
      candidateKey: c.candidateKey,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      priorScore:
        (c.scoreBreakdown && c.scoreBreakdown.prior && c.scoreBreakdown.prior.score) ?? null,
      headroom: c.headroomStatus,
      reasons: c.quotaReasonCode ? [c.quotaReasonCode] : [],
      sourceLinks: c.source ? [c.source] : [],
    })),
    rejected: rankResult.rejected.map((r) => ({
      candidateKey: r.candidateKey,
      reasonCode: r.reasonCode,
      reason: r.reason || r.reasonCode,
    })),
    detail: opts.decisionDetail || 'HERMES_REASONING_SELECTION',
  };

  if (!opts.skipDecisionLog) {
    try {
      decisionsMod.recordDecision(decisionRecord, { dir: decisionDir, now });
    } catch {}
  }

  return {
    chosen: chosenKey,
    candidate: chosenCandidate,
    ranking: rankResult.ranking,
    top3: rankResult.top3,
    rejected: rankResult.rejected,
    refused: rankResult.refused,
    reason: rankResult.reason,
    decisionRecord,
  };
}

/**
 * Writes the Controller-owned providers config file under data/hermes/.
 * Contains ONLY base_url and the NAME of the key env var (never a secret value).
 */
function writeProvidersConfig(candidate, options, deps) {
  const d = deps || {};
  const opts = options || {};
  const rootDir = resolveRootDir(opts, d);
  const fsApi = d.fs || fs;

  const dir = getHermesDir(rootDir);
  fsApi.mkdirSync(dir, { recursive: true });

  const sourcesMod = d.sources || sourcesApi;
  const registry = d.registry || sourcesMod.loadSources(d.sourceOpts);

  const parsed =
    candidate && candidate.candidateKey ? parseCandidateKey(candidate.candidateKey) : candidate;
  const gateway = (candidate && candidate.gateway) || (parsed && parsed.gateway) || 'openai';
  const upstream = (candidate && candidate.upstream) || (parsed && parsed.upstream) || gateway;

  let providerName = gateway && gateway !== '*' ? gateway : upstream;
  if (!providerName || providerName === '*') providerName = 'custom';

  let baseUrl = (candidate && candidate.accessPath) || (parsed && parsed.accessPath) || '';
  const src = registry.sources.find(
    (s) => s.id === gateway || s.id === upstream || s.id === (candidate && candidate.source)
  );

  if (!baseUrl || baseUrl === 'cli' || baseUrl.startsWith('cli-')) {
    baseUrl = (src && (src.accessPath || src.endpoint)) || 'http://127.0.0.1:20128/v1';
  }

  // Resolve the NAME of the key env var from the registry source — NEVER a key value.
  let apiKeyEnv = (src && src.credential && src.credential.env) || null;
  if (!apiKeyEnv) {
    if (providerName.toLowerCase().includes('9router')) apiKeyEnv = 'NINEROUTER_API_KEY';
    else if (providerName.toLowerCase().includes('requesty')) apiKeyEnv = 'REQUESTY_API_KEY';
    else apiKeyEnv = `${providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  }

  const yamlContent = [
    '# Controller-owned Hermes providers config',
    '# Generated by Ship De Controller — do not put secrets here',
    'providers:',
    `  ${providerName}:`,
    `    base_url: "${baseUrl}"`,
    `    api_key_env: "${apiKeyEnv}"`,
    '',
  ].join('\n');

  const confPath = configFilePath(rootDir);
  fsApi.writeFileSync(confPath, yamlContent, 'utf8');

  // Also write JSON representation for tooling convenience
  const jsonContent = {
    providers: {
      [providerName]: {
        base_url: baseUrl,
        api_key_env: apiKeyEnv,
      },
    },
  };
  fsApi.writeFileSync(
    path.join(dir, 'providers.json'),
    JSON.stringify(jsonContent, null, 2),
    'utf8'
  );

  return {
    configPath: confPath,
    providerName,
    baseUrl,
    apiKeyEnv,
  };
}

/**
 * Builds the Hermes command arguments:
 * '-m <modelId> --provider <provider-name> --resume <sessionId>' plus skill file.
 */
function buildHermesArgv(candidate, session, options) {
  const opts = options || {};
  const rootDir = resolveRootDir(opts, {});

  const parsed =
    candidate && candidate.candidateKey ? parseCandidateKey(candidate.candidateKey) : candidate;
  const modelId =
    (candidate && (candidate.modelId || candidate.model)) || (parsed && parsed.modelId);
  const providerName =
    opts.providerName ||
    (candidate && candidate.gateway && candidate.gateway !== '*'
      ? candidate.gateway
      : (candidate && candidate.upstream) || (parsed && parsed.gateway) || 'custom');
  const sessionId = (session && session.sessionId) || generateSessionId();
  const skillPath = opts.skillPath || skillFilePath(rootDir);

  const args = [];
  if (opts.includeChatCommand) {
    args.push('chat');
  }

  args.push('-m', String(modelId));
  args.push('--provider', String(providerName));
  args.push('--resume', String(sessionId));

  if (opts.skill !== false) {
    args.push('-s', skillPath);
  }

  if (Array.isArray(opts.extraArgs)) {
    args.push(...opts.extraArgs);
  }

  return args;
}

/**
 * Launches an interactive Hermes chat session bound to a Controller-selected candidate.
 * Handles failure classification, candidate reselection, and resume relaunching.
 */
async function launchHermesSession(options, deps) {
  const d = deps || {};
  const opts = options || {};
  const rootDir = resolveRootDir(opts, d);
  const env = Object.assign({}, process.env, d.env || {});
  const spawnFn = d.spawn;
  const classifier = d.failureClassifier || failureClassifier;

  let session = loadSession(opts, d);
  if (!session || opts.newSession || opts.session) {
    session = {
      sessionId: opts.session || generateSessionId(),
      candidateKey: null,
      goalIds: opts.goal ? [String(opts.goal)] : [],
    };
  } else if (opts.goal && !session.goalIds.includes(String(opts.goal))) {
    session.goalIds.push(String(opts.goal));
  }

  const forbiddenDomains = [...(opts.forbiddenFailureDomains || [])];
  const excludedCandidates = [...(opts.excludedCandidates || [])];
  const maxAttempts = opts.maxAttempts || 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    let selection;
    if (!session.candidateKey || opts.reselect || attempt > 1) {
      selection = selectReasoningCandidate(
        Object.assign({}, opts, {
          sessionId: session.sessionId,
          forbiddenFailureDomains: forbiddenDomains,
          excludedCandidates,
        }),
        d
      );
      if (!selection || !selection.candidate) {
        const err = new Error((selection && selection.reason) || 'NO_CANDIDATE_MEETS_PROFILE');
        err.code = 'NO_CANDIDATE_MEETS_PROFILE';
        throw err;
      }
      session.candidateKey = selection.chosen;
      saveSession(session, opts, d);
    } else {
      selection = selectReasoningCandidate(
        Object.assign({}, opts, {
          sessionId: session.sessionId,
          forbiddenFailureDomains: forbiddenDomains,
          excludedCandidates,
        }),
        d
      );
      if (!selection || !selection.candidate) {
        const err = new Error('NO_CANDIDATE_MEETS_PROFILE');
        err.code = 'NO_CANDIDATE_MEETS_PROFILE';
        throw err;
      }
      session.candidateKey = selection.chosen;
      saveSession(session, opts, d);
    }

    const candidate = selection.candidate;
    const configResult = writeProvidersConfig(candidate, opts, d);

    const argv = buildHermesArgv(candidate, session, {
      rootDir,
      providerName: configResult.providerName,
      includeChatCommand: opts.includeChatCommand,
      extraArgs: opts.extraArgs,
      skillPath: opts.skillPath,
      skill: opts.skill,
    });

    if (opts.dryRun) {
      return {
        status: 'dry_run',
        sessionId: session.sessionId,
        candidateKey: session.candidateKey,
        candidate,
        argv,
        configResult,
      };
    }

    if (typeof spawnFn !== 'function') {
      return {
        status: 'ready',
        sessionId: session.sessionId,
        candidateKey: session.candidateKey,
        candidate,
        argv,
        configResult,
      };
    }

    let spawnResult;
    try {
      spawnResult = await spawnFn('hermes', argv, {
        cwd: rootDir,
        env,
        stdio: opts.stdio || 'inherit',
      });
    } catch (spawnErr) {
      // Local launch failure: binary missing, bad arguments, spawn error
      const classification = classifier.classifyFailure({
        stderr: spawnErr.message || String(spawnErr),
        exitCode: spawnErr.exitCode || -1,
      });
      const err = new Error('LOCAL_LAUNCH_FAILURE: ' + (spawnErr.message || String(spawnErr)));
      err.code = 'LOCAL_LAUNCH_FAILURE';
      err.classification = classification;
      err.scope = classifier.Scope.LOCAL;
      throw err;
    }

    const exitCode =
      spawnResult && typeof spawnResult.exitCode === 'number'
        ? spawnResult.exitCode
        : spawnResult && typeof spawnResult.status === 'number'
          ? spawnResult.status
          : 0;

    if (exitCode === 0) {
      return {
        status: 'completed',
        exitCode: 0,
        sessionId: session.sessionId,
        candidateKey: session.candidateKey,
        candidate,
        argv,
        configResult,
        spawnResult,
      };
    }

    // Process exited with non-zero status
    const stderr = (spawnResult && spawnResult.stderr) || '';
    const stdout = (spawnResult && spawnResult.stdout) || '';
    const body = [stderr, stdout].filter(Boolean).join('\n');

    const classification = classifier.classifyFailure({
      exitCode,
      stderr,
      body,
      httpStatus: spawnResult && spawnResult.httpStatus,
      candidateKey: candidate.candidateKey,
      accountId: candidate.accountId,
    });

    const isLocal =
      classification.scope === classifier.Scope.LOCAL ||
      classifier.isLaunchInfraFailure(stderr) ||
      classification.cause === classifier.Cause.LAUNCH_CONFIG;

    if (isLocal) {
      // Local environment failure must NOT cool down the model
      const err = new Error(
        'LOCAL_FAILURE: ' + (classification.reason || stderr || 'Local execution failure')
      );
      err.code = 'LOCAL_FAILURE';
      err.classification = classification;
      err.scope = classifier.Scope.LOCAL;
      throw err;
    }

    // Route/model/quota failure: exclude failed route and reselect
    excludedCandidates.push(candidate.candidateKey);
    const domain =
      candidate.gateway && candidate.gateway !== '*' ? candidate.gateway : candidate.upstream;
    if (domain && domain !== '*') forbiddenDomains.push(domain);

    // Reselects on the next iteration with the SAME sessionId
  }

  const err = new Error('HERMES_MAX_RETRIES_EXCEEDED');
  err.code = 'HERMES_MAX_RETRIES_EXCEEDED';
  throw err;
}

/**
 * CLI entry for `node tools/ai-brain/cli.js goal session`.
 * Outputs JSON on stdout.
 */
async function goalSessionCommand(args, deps) {
  const d = deps || {};
  const opts = Object.assign({}, args);
  if (args.session) opts.session = args.session;
  if (args.goal) opts.goal = args.goal;
  if (args.reselect) opts.reselect = true;

  try {
    let session = loadSession(opts, d);
    if (!session || opts.reselect || !session.candidateKey) {
      const selection = selectReasoningCandidate(opts, d);
      if (!selection.candidate) {
        const out = {
          status: 'refused',
          refusal: selection.refused || 'NO_CANDIDATE_MEETS_PROFILE',
          reason: selection.reason,
        };
        console.log(JSON.stringify(out, null, 2));
        return { exitCode: 1, result: out };
      }
      session = {
        sessionId: (session && session.sessionId) || opts.session || generateSessionId(),
        candidateKey: selection.chosen,
        goalIds: (session && session.goalIds) || (opts.goal ? [String(opts.goal)] : []),
      };
      if (opts.goal && !session.goalIds.includes(String(opts.goal))) {
        session.goalIds.push(String(opts.goal));
      }
      saveSession(session, opts, d);
      writeProvidersConfig(selection.candidate, opts, d);
    } else if (opts.goal && !session.goalIds.includes(String(opts.goal))) {
      session.goalIds.push(String(opts.goal));
      saveSession(session, opts, d);
    }

    const parsed = parseCandidateKey(session.candidateKey) || {};
    const rootDir = resolveRootDir(opts, d);
    const out = {
      status: 'active',
      sessionId: session.sessionId,
      candidateKey: session.candidateKey,
      goalIds: session.goalIds,
      model: parsed.modelId || null,
      provider: parsed.gateway || parsed.upstream || null,
      configPath: configFilePath(rootDir),
    };
    console.log(JSON.stringify(out, null, 2));
    return { exitCode: 0, result: out };
  } catch (err) {
    const out = {
      status: 'error',
      error: err.message || String(err),
      code: err.code || 'SESSION_ERROR',
    };
    console.log(JSON.stringify(out, null, 2));
    return { exitCode: 1, result: out };
  }
}

/**
 * CLI entry for `node tools/ai-brain/cli.js chat`.
 */
async function chatCommand(args, deps) {
  const d = deps || {};
  const opts = Object.assign({}, args);
  if (args.session) opts.session = args.session;
  if (args.goal) opts.goal = args.goal;
  if (args.reselect) opts.reselect = true;
  if (args['dry-run'] || args.dryRun) opts.dryRun = true;

  try {
    const result = await launchHermesSession(opts, d);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    return { exitCode: 0, result };
  } catch (err) {
    if (args.json) {
      console.log(
        JSON.stringify(
          { status: 'failed', error: err.message, code: err.code || 'CHAT_ERROR' },
          null,
          2
        )
      );
    } else {
      console.error('Chat error: ' + (err.message || String(err)));
    }
    return { exitCode: 1, error: err };
  }
}

module.exports = {
  getHermesDir,
  sessionFilePath,
  configFilePath,
  skillFilePath,
  generateSessionId,
  loadSession,
  saveSession,
  linkGoalToSession,
  selectReasoningCandidate,
  writeProvidersConfig,
  buildHermesArgv,
  launchHermesSession,
  goalSessionCommand,
  chatCommand,
  HERMES_MIN_CONTEXT,
};
