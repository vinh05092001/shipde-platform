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
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function defaultSpawn(cmd, argv, spawnOpts) {
  return new Promise((resolve, reject) => {
    let cp;
    try {
      cp = spawn(cmd, argv, spawnOpts);
    } catch (err) {
      return reject(err);
    }

    cp.on('error', (err) => {
      reject(err);
    });

    const MAX_STDERR_BYTES = 64 * 1024;
    const stderrChunks = [];
    let stderrBytes = 0;

    if (cp.stderr) {
      cp.stderr.on('data', (chunk) => {
        try {
          process.stderr.write(chunk);
        } catch {}
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
        while (stderrBytes > MAX_STDERR_BYTES && stderrChunks.length > 1) {
          const removed = stderrChunks.shift();
          stderrBytes -= removed.length;
        }
      });
    }

    const stdoutChunks = [];
    if (cp.stdout) {
      cp.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk);
      });
    }

    cp.on('close', (code, signal) => {
      let finalStderr = '';
      if (stderrChunks.length > 0) {
        const fullBuf = Buffer.concat(stderrChunks);
        if (fullBuf.length > MAX_STDERR_BYTES) {
          finalStderr = fullBuf.subarray(fullBuf.length - MAX_STDERR_BYTES).toString('utf8');
        } else {
          finalStderr = fullBuf.toString('utf8');
        }
      }

      let finalStdout = '';
      if (stdoutChunks.length > 0) {
        finalStdout = Buffer.concat(stdoutChunks).toString('utf8');
      }

      const exitCode =
        code !== null
          ? code
          : signal === 'SIGINT'
            ? 130
            : signal === 'SIGTERM'
              ? 143
              : signal
                ? 1
                : 0;

      resolve({
        exitCode,
        status: exitCode,
        stdout: finalStdout,
        stderr: finalStderr,
        signal,
      });
    });
  });
}

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

function getHermesHomeDir(rootDir) {
  return path.join(
    path.resolve(rootDir || process.cwd()),
    'tools',
    'ai-brain',
    'data',
    'hermes',
    'home'
  );
}

function sessionFilePath(rootDir) {
  return path.join(getHermesDir(rootDir), 'session.json');
}

function configFilePath(rootDir) {
  return path.join(getHermesHomeDir(rootDir), 'config.yaml');
}

function legacyConfigFilePath(rootDir) {
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
 * Returns null if file does not exist.
 * Fails closed with SESSION_FILE_CORRUPT if file is corrupt or invalid.
 */
function loadSession(options, deps) {
  const d = deps || {};
  const rootDir = resolveRootDir(options, deps);
  const fsApi = d.fs || fs;
  const file = sessionFilePath(rootDir);

  if (!fsApi.existsSync(file)) return null;

  let raw;
  try {
    raw = fsApi.readFileSync(file, 'utf8');
  } catch (readErr) {
    const err = new Error('SESSION_FILE_CORRUPT: Failed to read session file: ' + readErr.message);
    err.code = 'SESSION_FILE_CORRUPT';
    err.cause = readErr;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    const err = new Error(
      'SESSION_FILE_CORRUPT: Failed to parse session file JSON: ' + parseErr.message
    );
    err.code = 'SESSION_FILE_CORRUPT';
    err.cause = parseErr;
    throw err;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('SESSION_FILE_CORRUPT: Session data is not an object');
    err.code = 'SESSION_FILE_CORRUPT';
    throw err;
  }

  if (!parsed.sessionId || typeof parsed.sessionId !== 'string') {
    const err = new Error('SESSION_FILE_CORRUPT: Session file missing valid sessionId');
    err.code = 'SESSION_FILE_CORRUPT';
    throw err;
  }

  return {
    sessionId: String(parsed.sessionId),
    candidateKey: parsed.candidateKey ? String(parsed.candidateKey) : null,
    goalIds: Array.isArray(parsed.goalIds) ? parsed.goalIds.map(String) : [],
  };
}

/**
 * Persists Hermes session to data/hermes/session.json atomically.
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

  const targetPath = sessionFilePath(rootDir);
  const nonce = crypto.randomBytes(4).toString('hex');
  const tempPath = path.join(dir, `.session.${process.pid}.${Date.now()}.${nonce}.tmp`);

  fsApi.writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf8');
  try {
    fsApi.renameSync(tempPath, targetPath);
  } catch (renameErr) {
    try {
      if (fsApi.existsSync(tempPath)) fsApi.unlinkSync(tempPath);
    } catch {}
    throw renameErr;
  }
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
    let discovery;
    const readDiscoveryCatalogue =
      (d.discovery && d.discovery.readDiscoveryCatalogue) ||
      (d.discoveryRead && d.discoveryRead.readDiscoveryCatalogue) ||
      d.readDiscoveryCatalogue ||
      require('./discovery/read').readDiscoveryCatalogue;
    const discoveryDir =
      opts.discoveryDir || d.discoveryDir || path.join(__dirname, 'data', 'discovery');
    try {
      discovery = readDiscoveryCatalogue({ dataDir: discoveryDir });
    } catch (readErr) {
      const reason = 'DISCOVERY_READ_ERROR: ' + (readErr.message || String(readErr));
      return {
        chosen: null,
        candidate: null,
        ranking: [],
        top3: [],
        rejected: [],
        refused: 'DISCOVERY_READ_ERROR',
        reason,
        decisionRecord: null,
      };
    }

    const cliApi = d.cli || require('./cli');
    const assembleFn = d.assembleForDispatch || cliApi.assembleForDispatch;
    poolCandidates = assembleFn(discovery, accounts, registry, {
      evidenceData,
      requireRouteHealth: true,
      routeHealth: d.routeHealth,
      routeHealthFile: opts.routeHealthFile || d.routeHealthFile,
    });
  }

  const excluded = new Set(opts.excludedCandidates || []);

  // Adapt candidates for Hermes harness: set harness=hermes, verify contextWindow >= 32000
  const hermesCandidates = poolCandidates
    .map((c) => {
      const candidate = Object.assign({}, c);
      const preRewriteKey = candidate.candidateKey || candidateKey(candidate);
      candidate.harness = 'hermes';

      const rawContext =
        candidate.contextWindow !== undefined
          ? candidate.contextWindow
          : candidate.context_window !== undefined
            ? candidate.context_window
            : candidate.capabilities && candidate.capabilities.contextWindow !== undefined
              ? candidate.capabilities.contextWindow
              : candidate.capabilities && candidate.capabilities.context_window !== undefined
                ? candidate.capabilities.context_window
                : candidate.capabilities && candidate.capabilities.contextTokens !== undefined
                  ? candidate.capabilities.contextTokens
                  : undefined;

      candidate.contextWindow = rawContext;
      if (candidate.capabilities) {
        candidate.capabilities = Object.assign({}, candidate.capabilities, {
          contextWindow: rawContext,
        });
      }

      if (
        !candidate.accessPath ||
        candidate.accessPath === 'cli' ||
        candidate.accessPath.startsWith('cli-') ||
        candidate.accessPath === '*'
      ) {
        let src =
          (registry &&
            registry.sources &&
            registry.sources.find(
              (s) => s.id === candidate.gateway || s.id === candidate.upstream
            )) ||
          null;
        if (src && !src.endpoint && !src.accessPath && src.reachedVia) {
          const gw = registry.sources.find((s) => s.id === src.reachedVia);
          if (gw) src = gw;
        }
        candidate.accessPath = (src && (src.accessPath || src.endpoint)) || null;
      }

      candidate.candidateKey = candidateKey(candidate);
      candidate._preRewriteKey = preRewriteKey;
      return candidate;
    })
    .filter((c) => !excluded.has(c.candidateKey) && !excluded.has(c._preRewriteKey));

  const annotated = candidatesMod.annotateCandidates(hermesCandidates, evidenceData, { now });

  const profile = {
    taskId: opts.taskId || opts.sessionId || 'hermes-reasoning-session',
    role: opts.role || 'planner.default',
    complexity: 'complex',
    riskDomains: opts.riskDomains || ['reasoning', 'planning'],
    qualityFloor: opts.qualityFloor !== undefined ? opts.qualityFloor : 80,
    proofFloor: opts.proofFloor || 'WORK_ITEM_PASS',
    contextSize: opts.contextSize !== undefined ? opts.contextSize : HERMES_MIN_CONTEXT,
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
    explorationBudget: opts.explorationBudget !== undefined ? Number(opts.explorationBudget) : 0,
    enforceKnownQuota: opts.enforceKnownQuota,
  };

  const rankResult = (d.rankForProfile || routingMod.rankForProfile)(
    annotated,
    profile,
    assessment,
    rankCtx
  );

  let chosenKey = rankResult.chosen;
  if (opts.preferredCandidateKey) {
    const preferred = rankResult.ranking.find((c) => c.candidateKey === opts.preferredCandidateKey);
    if (preferred) {
      chosenKey = preferred.candidateKey;
    }
  }

  const chosenCandidate = chosenKey
    ? rankResult.ranking.find((c) => c.candidateKey === chosenKey) || null
    : null;

  const isChosen = Boolean(chosenCandidate);
  const refused = isChosen ? null : 'NO_REASONING_CANDIDATE';
  let reason = isChosen ? rankResult.reason : null;
  if (!isChosen) {
    if (rankResult.rejected && rankResult.rejected.length > 0) {
      reason =
        'NO_REASONING_CANDIDATE: ' +
        rankResult.rejected.map((r) => `${r.candidateKey}: ${r.reason || r.reasonCode}`).join('; ');
    } else {
      reason =
        'NO_REASONING_CANDIDATE: ' + (rankResult.reason || 'no candidate meets requirements');
    }
  }

  // Record decision record Linking candidates, reasons, prior scores and source links
  const decisionDir =
    opts.decisionDir ||
    d.decisionDir ||
    (opts.rootDir || d.rootDir || opts.root || d.root
      ? path.join(resolveRootDir(opts, d), 'tools', 'ai-brain', 'data', 'decisions')
      : path.join(__dirname, 'data', 'decisions'));
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
    detail:
      opts.decisionDetail ||
      (opts.preferredCandidateKey && chosenKey === opts.preferredCandidateKey
        ? 'HERMES_REASONING_REUSE_STORED_BINDING'
        : 'HERMES_REASONING_SELECTION'),
  };

  if (!opts.skipDecisionLog) {
    try {
      decisionsMod.recordDecision(decisionRecord, { dir: decisionDir, now });
    } catch (logErr) {
      const err = new Error('DECISION_LOG_WRITE_FAILURE: ' + (logErr.message || String(logErr)));
      err.code = 'DECISION_LOG_WRITE_FAILURE';
      err.cause = logErr;
      throw err;
    }
  }

  return {
    chosen: chosenCandidate ? chosenKey : null,
    candidate: chosenCandidate,
    ranking: rankResult.ranking,
    top3: rankResult.top3,
    rejected: rankResult.rejected,
    refused,
    reason,
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

  if (!/^[a-zA-Z0-9_.-]+$/.test(providerName)) {
    const err = new Error('INVALID_PROVIDER_NAME: ' + providerName);
    err.code = 'INVALID_PROVIDER_NAME';
    throw err;
  }

  let src =
    (registry &&
      registry.sources &&
      registry.sources.find(
        (s) => s.id === gateway || s.id === upstream || s.id === (candidate && candidate.source)
      )) ||
    null;

  if (src && !src.endpoint && !src.accessPath && src.reachedVia) {
    const gatewaySrc = registry.sources.find((s) => s.id === src.reachedVia);
    if (gatewaySrc) {
      src = Object.assign({}, src, {
        endpoint: gatewaySrc.endpoint,
        accessPath: gatewaySrc.accessPath,
        credential: src.credential || gatewaySrc.credential,
      });
    }
  }

  let baseUrl = (candidate && candidate.accessPath) || (parsed && parsed.accessPath) || '';
  if (!baseUrl || baseUrl === 'cli' || baseUrl.startsWith('cli-') || baseUrl === '*') {
    baseUrl = (src && (src.accessPath || src.endpoint)) || '';
  }

  // Refusal on unknown or missing endpoint — NEVER fall back to 9router http://127.0.0.1:20128/v1
  if (!baseUrl || typeof baseUrl !== 'string') {
    const err = new Error(
      'UNKNOWN_ENDPOINT: Unknown or invalid endpoint for provider ' + providerName + ': ' + baseUrl
    );
    err.code = 'UNKNOWN_ENDPOINT';
    throw err;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    const err = new Error(
      'UNKNOWN_ENDPOINT: Unknown or invalid endpoint for provider ' + providerName + ': ' + baseUrl
    );
    err.code = 'UNKNOWN_ENDPOINT';
    throw err;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    const err = new Error(
      'UNKNOWN_ENDPOINT: Unknown or invalid endpoint protocol for provider ' +
        providerName +
        ': ' +
        baseUrl
    );
    err.code = 'UNKNOWN_ENDPOINT';
    throw err;
  }

  if (
    parsedUrl.username ||
    parsedUrl.password ||
    /@/.test(baseUrl.split('?')[0]) ||
    /(?:key|token|secret|password)=/i.test(parsedUrl.search)
  ) {
    const err = new Error(
      'ENDPOINT_USERINFO_FORBIDDEN: Endpoint must not contain embedded userinfo or credentials: ' +
        providerName
    );
    err.code = 'ENDPOINT_USERINFO_FORBIDDEN';
    throw err;
  }

  // Resolve the NAME of the key env var from the registry source — NEVER guess *_API_KEY.
  let apiKeyEnv = (src && src.credential && src.credential.env) || null;
  if (!apiKeyEnv || !/^[A-Za-z0-9_]+$/.test(apiKeyEnv)) {
    const err = new Error(
      'UNKNOWN_CREDENTIAL_ENV: Unknown credential env var for provider ' + providerName
    );
    err.code = 'UNKNOWN_CREDENTIAL_ENV';
    throw err;
  }

  function escapeYamlString(val) {
    const str = String(val);
    if (/[\r\n\0]/.test(str)) {
      throw new Error('YAML_VALUE_UNSAFE: contains newline or control character');
    }
    return JSON.stringify(str);
  }

  const yamlContent = [
    '# Controller-owned Hermes providers config',
    '# Generated by Ship De Controller — do not put secrets here',
    'providers:',
    `  ${providerName}:`,
    `    name: ${escapeYamlString(providerName)}`,
    `    base_url: ${escapeYamlString(baseUrl)}`,
    `    key_env: ${escapeYamlString(apiKeyEnv)}`,
    'custom_providers:',
    `  - name: ${escapeYamlString(providerName)}`,
    `    base_url: ${escapeYamlString(baseUrl)}`,
    `    key_env: ${escapeYamlString(apiKeyEnv)}`,
    '',
  ].join('\n');

  const homeDir = getHermesHomeDir(rootDir);
  fsApi.mkdirSync(homeDir, { recursive: true });
  const homeConfPath = path.join(homeDir, 'config.yaml');
  fsApi.writeFileSync(homeConfPath, yamlContent, 'utf8');

  // Also write legacy paths for backward compatibility with tooling
  const legacyConfPath = path.join(dir, 'config.yaml');
  fsApi.writeFileSync(legacyConfPath, yamlContent, 'utf8');

  const jsonContent = {
    providers: {
      [providerName]: {
        name: providerName,
        base_url: baseUrl,
        key_env: apiKeyEnv,
      },
    },
    custom_providers: [
      {
        name: providerName,
        base_url: baseUrl,
        key_env: apiKeyEnv,
      },
    ],
  };

  fsApi.writeFileSync(
    path.join(homeDir, 'providers.json'),
    JSON.stringify(jsonContent, null, 2),
    'utf8'
  );
  fsApi.writeFileSync(
    path.join(dir, 'providers.json'),
    JSON.stringify(jsonContent, null, 2),
    'utf8'
  );

  return {
    configPath: homeConfPath,
    legacyConfigPath: legacyConfPath,
    hermesHome: homeDir,
    providerName,
    baseUrl,
    apiKeyEnv,
  };
}

/**
 * Builds the Hermes command arguments:
 * 'chat -m <modelId> --provider <provider-name> --resume <sessionId>' plus skill file.
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
  if (opts.omitChatCommand !== true && opts.includeChatCommand !== false) {
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
  const hermesHome = opts.hermesHome || d.hermesHome || getHermesHomeDir(rootDir);
  const env = Object.assign({}, process.env, d.env || {}, {
    HERMES_HOME: hermesHome,
  });
  // Verified Fact 3: --ignore-user-config (and HERMES_IGNORE_USER_CONFIG=1) makes Hermes skip config.yaml
  delete env.HERMES_IGNORE_USER_CONFIG;

  const spawnFn = d.spawn || defaultSpawn;
  const classifier = d.failureClassifier || failureClassifier;

  let session = null;
  if (opts.newSession) {
    session = {
      sessionId: opts.session || generateSessionId(),
      candidateKey: null,
      goalIds: opts.goal ? [String(opts.goal)] : [],
    };
  } else {
    session = loadSession(opts, d);
    if (opts.session) {
      if (session && session.sessionId === opts.session) {
        session.goalIds = Array.isArray(session.goalIds) ? session.goalIds : [];
        if (opts.goal && !session.goalIds.includes(String(opts.goal))) {
          session.goalIds.push(String(opts.goal));
        }
      } else {
        session = {
          sessionId: opts.session,
          candidateKey: null,
          goalIds: opts.goal ? [String(opts.goal)] : [],
        };
      }
    } else if (!session) {
      session = {
        sessionId: generateSessionId(),
        candidateKey: null,
        goalIds: opts.goal ? [String(opts.goal)] : [],
      };
    } else if (opts.goal) {
      session.goalIds = Array.isArray(session.goalIds) ? session.goalIds : [];
      if (!session.goalIds.includes(String(opts.goal))) {
        session.goalIds.push(String(opts.goal));
      }
    }
  }

  const forbiddenDomains = [...(opts.forbiddenFailureDomains || [])];
  const excludedCandidates = [...(opts.excludedCandidates || [])];
  const maxAttempts = opts.maxAttempts || 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    const isRetry = attempt > 1;
    const shouldReselect = Boolean(opts.reselect) || isRetry || !session.candidateKey;
    const preferredCandidateKey = shouldReselect ? null : session.candidateKey;

    const selection = selectReasoningCandidate(
      Object.assign({}, opts, {
        sessionId: session.sessionId,
        forbiddenFailureDomains: forbiddenDomains,
        excludedCandidates,
        preferredCandidateKey,
      }),
      d
    );

    if (!selection || !selection.candidate) {
      const err = new Error(
        (selection && (selection.reason || selection.refused)) || 'NO_REASONING_CANDIDATE'
      );
      err.code = (selection && selection.refused) || 'NO_REASONING_CANDIDATE';
      err.reasons = (selection && selection.rejected) || [];
      throw err;
    }

    session.candidateKey = selection.chosen;
    saveSession(session, opts, d);

    const candidate = selection.candidate;
    const configResult = writeProvidersConfig(candidate, opts, d);

    const argv = buildHermesArgv(candidate, session, {
      rootDir,
      providerName: configResult.providerName,
      includeChatCommand: opts.includeChatCommand,
      omitChatCommand: opts.omitChatCommand,
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
        hermesHome,
      };
    }

    let spawnResult;
    try {
      spawnResult = await spawnFn('hermes', argv, {
        cwd: rootDir,
        env,
        stdio: opts.stdio || ['inherit', 'inherit', 'pipe'],
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
        hermesHome,
      };
    }

    // Process exited with non-zero status
    const stderr = (spawnResult && spawnResult.stderr) || '';
    const stdout = (spawnResult && spawnResult.stdout) || '';
    const body = [stderr, stdout].filter(Boolean).join('\n');

    let httpStatus = spawnResult && spawnResult.httpStatus;
    if (!httpStatus) {
      const match =
        stderr.match(/\b(?:HTTP\s+|status\s*:\s*)(\d{3})\b/i) ||
        stderr.match(/\bstatus[_\s]+code[:\s]+(\d{3})\b/i);
      if (match) httpStatus = parseInt(match[1], 10);
    }

    const classification = classifier.classifyFailure({
      exitCode,
      stderr,
      body,
      httpStatus,
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

    const isRouteQuotaModel =
      classification.scope === classifier.Scope.MODEL ||
      classification.scope === classifier.Scope.UPSTREAM ||
      classification.scope === classifier.Scope.GATEWAY ||
      classification.scope === classifier.Scope.ACCESS_PATH ||
      classification.scope === classifier.Scope.ACCOUNT;

    if (!isRouteQuotaModel) {
      // Unclassified or user-exit (e.g. SIGINT 130) failures fail closed and stop with the exit code
      return {
        status: 'exited',
        exitCode,
        sessionId: session.sessionId,
        candidateKey: session.candidateKey,
        candidate,
        argv,
        configResult,
        spawnResult,
        classification,
        hermesHome,
      };
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
  if (args['decision-dir'] || args.decisionDir)
    opts.decisionDir = args['decision-dir'] || args.decisionDir;
  if (args['skip-decision-log'] || args.skipDecisionLog) opts.skipDecisionLog = true;

  try {
    let session = loadSession(opts, d);
    if (opts.newSession) {
      session = null;
    } else if (session && opts.session && session.sessionId !== opts.session) {
      session = null;
    }
    const shouldReselect = !session || Boolean(opts.reselect) || !session.candidateKey;
    const preferredCandidateKey = shouldReselect ? null : session.candidateKey;

    const selection = selectReasoningCandidate(
      Object.assign({}, opts, {
        sessionId: (session && session.sessionId) || opts.session || undefined,
        preferredCandidateKey,
      }),
      d
    );
    if (!selection.candidate) {
      const out = {
        status: 'refused',
        refusal: selection.refused || 'NO_REASONING_CANDIDATE',
        reason: selection.reason,
        reasons: selection.rejected || [],
      };
      console.log(JSON.stringify(out, null, 2));
      return { exitCode: 1, result: out };
    }

    session = {
      sessionId: (session && session.sessionId) || opts.session || generateSessionId(),
      candidateKey: selection.chosen,
      goalIds:
        (session && Array.isArray(session.goalIds) ? session.goalIds : null) ||
        (opts.goal ? [String(opts.goal)] : []),
    };
    if (opts.goal && !session.goalIds.includes(String(opts.goal))) {
      session.goalIds.push(String(opts.goal));
    }
    saveSession(session, opts, d);
    writeProvidersConfig(selection.candidate, opts, d);

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
 * Always outputs JSON status line.
 */
async function chatCommand(args, deps) {
  const d = deps || {};
  const opts = Object.assign({}, args);
  if (args.session) opts.session = args.session;
  if (args.goal) opts.goal = args.goal;
  if (args.reselect) opts.reselect = true;
  if (args['dry-run'] || args.dryRun) opts.dryRun = true;
  if (args['decision-dir'] || args.decisionDir)
    opts.decisionDir = args['decision-dir'] || args.decisionDir;
  if (args['skip-decision-log'] || args.skipDecisionLog) opts.skipDecisionLog = true;

  try {
    const result = await launchHermesSession(opts, d);
    console.log(JSON.stringify(result, null, 2));
    const exitCode =
      typeof result.exitCode === 'number'
        ? result.exitCode
        : result.status === 'completed' || result.status === 'dry_run'
          ? 0
          : 1;
    return { exitCode, result };
  } catch (err) {
    console.log(
      JSON.stringify(
        { status: 'failed', error: err.message, code: err.code || 'CHAT_ERROR' },
        null,
        2
      )
    );
    const exitCode = typeof err.exitCode === 'number' ? err.exitCode : 1;
    return { exitCode, error: err };
  }
}

module.exports = {
  getHermesDir,
  getHermesHomeDir,
  sessionFilePath,
  configFilePath,
  legacyConfigFilePath,
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
  defaultSpawn,
  HERMES_MIN_CONTEXT,
};
