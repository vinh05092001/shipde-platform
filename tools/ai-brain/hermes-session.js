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
const { spawn } = require('child_process');
const { atomicRenameSync } = require('./atomic-rename');

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
    const stdoutChunks = [];
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let routeFailure = null;
    let failureScan = '';
    const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
    const redact = (value) => {
      let text = String(value);
      for (const [key, secret] of Object.entries((spawnOpts && spawnOpts.env) || {})) {
        if (
          /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key) &&
          typeof secret === 'string' &&
          secret.length >= 4
        ) {
          text = text.split(secret).join('[REDACTED]');
        }
      }
      return text.replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
    };
    const observe = (stream, chunk) => {
      const safe = Buffer.from(redact(chunk.toString('utf8')));
      const text = safe.toString('utf8').replace(ansiPattern, '');
      failureScan = (failureScan + text).slice(-8192);
      const apiFailure =
        /(?:API call failed \(attempt[^\r\n]*|Streaming failed before delivery[^\r\n]*)/i;
      const errorCode = /Error code:\s*(\d{3})\b/i;
      const lines = failureScan.split(/\r?\n/);
      const apiLine = lines.find((line) => apiFailure.test(line));
      const statusLine = lines.find((line) => errorCode.test(line));
      if (!routeFailure && apiLine && statusLine) {
        const status = Number(statusLine.match(errorCode)[1]);
        if ([401, 402, 403, 429].includes(status) || status >= 500) {
          routeFailure = `${apiLine} ${statusLine}`.slice(-400);
          try {
            cp.kill('SIGTERM');
          } catch {}
        }
      }
      // Hermes prints a missing provider login at startup and still exits 0;
      // without this the run counts as completed and the brain is never reselected.
      const missingCredentials = /^No [a-z0-9 -]*credentials stored\b[^\r\n]*/im;
      if (!routeFailure && missingCredentials.test(failureScan)) {
        routeFailure = failureScan.match(missingCredentials)[0].slice(-400);
        try {
          cp.kill('SIGTERM');
        } catch {}
      }
      if (stream === 'stderr') {
        try {
          process.stderr.write(safe);
        } catch {}
        stderrChunks.push(safe);
        stderrBytes += safe.length;
        while (stderrBytes > MAX_STDERR_BYTES && stderrChunks.length > 1)
          stderrBytes -= stderrChunks.shift().length;
      } else {
        try {
          process.stdout.write(safe);
        } catch {}
        stdoutChunks.push(safe);
        stdoutBytes += safe.length;
        while (stdoutBytes > MAX_STDERR_BYTES && stdoutChunks.length > 1)
          stdoutBytes -= stdoutChunks.shift().length;
      }
    };

    if (cp.stderr) {
      cp.stderr.on('data', (chunk) => observe('stderr', chunk));
    }
    if (cp.stdout) {
      cp.stdout.on('data', (chunk) => observe('stdout', chunk));
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
        routeFailure,
      });
    });
  });
}

const sourcesApi = require('./sources');
const priorsApi = require('./priors');
const decisionsApi = require('./decisions');
const comboApi = require('./combo');
const failureClassifier = require('./failure-classifier');
const routeProbe = require('./route-probe');
const { candidateKey, parseCandidateKey } = require('./discovery/identity');

/**
 * Extracts an account key from a candidate or candidate key.
 * Account key = candidateKey's 2nd and 3rd "::" fields (base URL + source id).
 * For 9router (base http://127.0.0.1:20128/v1), also includes the 4th field (upstream prefix).
 */
function candidateAccountKey(candidateOrKey) {
  const key =
    typeof candidateOrKey === 'string'
      ? candidateOrKey
      : (candidateOrKey && candidateOrKey.candidateKey) || candidateKey(candidateOrKey);
  if (!key || typeof key !== 'string') return '';
  const parts = key.split('::');
  const baseUrl = parts[1] || '';
  const sourceId = parts[2] || '';
  const is9router =
    baseUrl === 'http://127.0.0.1:20128/v1' || baseUrl.includes('20128') || sourceId === '9router';
  if (is9router) {
    const upstream = parts[3] || '';
    return `${baseUrl}::${sourceId}::${upstream}`;
  }
  return `${baseUrl}::${sourceId}`;
}

const HERMES_MIN_CONTEXT = 32000;
const DEFAULT_HERMES_DIR = 'data/hermes';
const CONTROLLER_SKILL_NAME = 'shipde-controller';

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

function installedSkillFilePath(rootDir) {
  return path.join(getHermesHomeDir(rootDir), 'skills', CONTROLLER_SKILL_NAME, 'SKILL.md');
}

function resolveSkillSourcePath(rootDir, options, deps) {
  const d = deps || {};
  const opts = options || {};
  const fsApi = d.fs || fs;

  if (
    opts.skillSourcePath &&
    (fsApi.existsSync(opts.skillSourcePath) || fs.existsSync(opts.skillSourcePath))
  ) {
    return opts.skillSourcePath;
  }
  const rootSkill = skillFilePath(rootDir);
  if (fsApi.existsSync(rootSkill) || fs.existsSync(rootSkill)) {
    return rootSkill;
  }
  const moduleSkill = path.join(__dirname, 'skills', 'shipde-controller', 'SKILL.md');
  if (fs.existsSync(moduleSkill)) {
    return moduleSkill;
  }
  return rootSkill;
}

/**
 * Skills (Hermes agent/prompt_builder.py build_skills_system_prompt): every enabled skill's name and
 * description is injected into the system prompt of every session; bodies load on demand through
 * skill_view. Hermes lets config.yaml `skills.disabled` (agent/skill_utils.py get_disabled_skill_names)
 * hide skills by name. Live session logs show only the Controller skill is ever loaded for this project,
 * so every other skill found in the Hermes home is disabled by name (data-driven, nothing listed by hand).
 */
function listInstalledSkillNames(homeDir, fsApi) {
  const names = new Set();
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fsApi.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      let fmName = '';
      try {
        const text = String(fsApi.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        const n = m && /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(m[1]);
        if (n) fmName = n[1];
      } catch {}
      names.add(fmName || path.basename(dir));
      return;
    }
    if (depth > 4) return;
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.join(homeDir, 'skills'), 0);
  return [...names];
}

function skillsConfigLines(homeDir, fsApi) {
  const disabled = listInstalledSkillNames(homeDir, fsApi)
    .filter((n) => n !== CONTROLLER_SKILL_NAME)
    .sort();
  if (!disabled.length) return [];
  return ['skills:', '  disabled:', ...disabled.map((n) => `    - ${JSON.stringify(n)}`)];
}

/**
 * Memory (Hermes agent/agent_init.py + tools/memory_tool_store.py): memories/MEMORY.md is loaded into the
 * system prompt every session; entries are separated by "\n§\n" and the file is bounded by
 * memory.memory_char_limit (Hermes default 2200). The Controller owns only the marked block.
 */
const MEMORY_ENTRY_DELIMITER = '\n§\n';
const HERMES_DEFAULT_MEMORY_CHAR_LIMIT = 2200;
const MEMORY_BEGIN_MARKER = '<!-- shipde-controller:begin -->';
const MEMORY_END_MARKER = '<!-- shipde-controller:end -->';

function readMemoryCharLimit(homeDir, fsApi) {
  try {
    const text = String(fsApi.readFileSync(path.join(homeDir, 'config.yaml'), 'utf8'));
    const m = /^\s+memory_char_limit:\s*(\d+)\s*$/m.exec(text);
    if (m) return Number(m[1]);
  } catch {}
  return HERMES_DEFAULT_MEMORY_CHAR_LIMIT;
}

function buildControllerMemoryBlock(state, budget) {
  const head = [
    MEMORY_BEGIN_MARKER,
    'Ship De Controller current state (auto-generated, do not edit):',
  ];
  const lines = [];
  if (state.goalId) lines.push(`goal: ${state.goalId} status ${state.status || 'unknown'}`);
  if (state.lastOutcome) lines.push(`last run: ${state.lastOutcome}`);
  const items = state.items || [];
  const render = (count) => {
    const body = lines.concat(items.slice(0, count).map((i) => `${i.workItemId}: ${i.state}`));
    if (count < items.length) body.push(`+${items.length - count} more items`);
    return head.concat(body, [MEMORY_END_MARKER]).join('\n');
  };
  let count = items.length;
  let text = render(count);
  while (count > 0 && text.length > budget) {
    count -= 1;
    text = render(count);
  }
  return text.replace(/§/g, '');
}

function readControllerMemoryState(opts, rootDir, d) {
  if (!opts.goal) return null;
  try {
    const goalsApi = d.goals || require('./goals');
    const status = goalsApi.statusGoal(String(opts.goal), Object.assign({}, opts, { rootDir }), d);
    if (!status || status.refusal)
      return { goalId: String(opts.goal), status: 'unreadable', items: [] };
    const items = status.items || [];
    const last = items.filter((i) => i.reviewVerdict || i.testResult).pop();
    return {
      goalId: status.goalId,
      status: status.status,
      items,
      lastOutcome: last
        ? `${last.workItemId} review ${last.reviewVerdict || 'none'} tests ${
            typeof last.testResult === 'string'
              ? last.testResult
              : last.testResult
                ? 'recorded'
                : 'none'
          }`
        : '',
    };
  } catch {
    return null;
  }
}

function syncControllerMemory(homeDir, state, fsApi) {
  if (!state) return null;
  const memPath = path.join(homeDir, 'memories', 'MEMORY.md');
  let existing = '';
  try {
    existing = String(fsApi.readFileSync(memPath, 'utf8'));
  } catch {}
  const b = existing.indexOf(MEMORY_BEGIN_MARKER);
  const e = existing.indexOf(MEMORY_END_MARKER);
  const hasBlock = b !== -1 && e > b;
  const before = hasBlock ? existing.slice(0, b) : existing;
  const after = hasBlock ? existing.slice(e + MEMORY_END_MARKER.length) : '';
  const sep = hasBlock ? '' : before.trim() ? MEMORY_ENTRY_DELIMITER : '';
  const limit = readMemoryCharLimit(homeDir, fsApi);
  const budget = Math.max(0, limit - before.length - after.length - sep.length);
  const block = buildControllerMemoryBlock(state, budget);
  fsApi.mkdirSync(path.dirname(memPath), { recursive: true });
  fsApi.writeFileSync(memPath, before + sep + block + after, 'utf8');
  return memPath;
}

function installSkillFile(hermesHomeDir, options, deps) {
  const d = deps || {};
  const opts = options || {};
  const fsApi = d.fs || fs;
  const rootDir = resolveRootDir(opts, d);
  const homeDir = hermesHomeDir || opts.hermesHome || d.hermesHome || getHermesHomeDir(rootDir);

  const destSkillDir = path.join(homeDir, 'skills', CONTROLLER_SKILL_NAME);
  fsApi.mkdirSync(destSkillDir, { recursive: true });
  const destSkillPath = path.join(destSkillDir, 'SKILL.md');

  const srcPath = resolveSkillSourcePath(rootDir, opts, d);
  let content = null;
  if (fsApi.existsSync(srcPath)) {
    content = fsApi.readFileSync(srcPath, 'utf8');
  } else if (fs.existsSync(srcPath)) {
    content = fs.readFileSync(srcPath, 'utf8');
  }

  if (content !== null) {
    fsApi.writeFileSync(destSkillPath, content, 'utf8');
  }

  return destSkillPath;
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
  atomicRenameSync(tempPath, targetPath, { fs: fsApi });
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
const { PROVIDER_LEVEL_FAILURE_CAUSES } = routeProbe;

function canonicalHermesModelId(modelId) {
  return priorsApi.normaliseModelId(modelId) || '';
}

async function refreshReasoningContext(options, deps) {
  const d = { ...deps };
  // Explicit candidate/registry fixtures remain offline unless a fetcher is supplied.
  if (
    !d.fetchModels &&
    !d.fetch &&
    !(options && options.fetch) &&
    (d.registry || d.candidateList || Array.isArray(d.candidates))
  )
    return d;
  const registry = d.registry || (d.sources || sourcesApi).loadSources(d.sourceOpts);
  const { probeSource } = require('./source-discovery');
  const fetcher = d.fetchModels || d.fetch || (options && options.fetch) || globalThis.fetch;
  const sources = await Promise.all(
    (registry.sources || []).map(async (source) => {
      if (!source.endpoint || source.servesModels === false || source.enabled === false)
        return source;
      const credential = source.credential || {};
      const probed = await probeSource(
        {
          ...source,
          models: source.models || [],
          credential:
            credential.type === 'api-key' ? { type: 'env', name: credential.env } : credential,
        },
        {
          env: { ...process.env, ...options.env, ...d.env },
          fetch: (url, init) => fetcher(url, { ...init, signal: AbortSignal.timeout(5000) }),
        }
      );
      // A failed listing keeps the most recent source-scoped discovery metadata.
      return { ...source, modelMeta: probed.modelMeta || source.modelMeta || {} };
    })
  );
  return { ...d, registry: { ...registry, sources } };
}

/**
 * Creates an isolated fs-check-reasons tracker.
 * Each tracker has its own reasons array and lastReason,
 * so concurrent tests or sessions never share mutable state.
 */
function createFsCheckTracker() {
  const reasons = [];
  let lastReason = null;

  function record(targetPath, err, context) {
    const code = (err && err.code) || 'UNKNOWN';
    const reason = `${code}: ${context} check failed for '${targetPath}'`;
    lastReason = reason;
    reasons.push({ path: targetPath, code, reason, timestamp: Date.now() });
    return reason;
  }

  function get() {
    return reasons.slice();
  }

  function clear() {
    reasons.length = 0;
    lastReason = null;
  }

  return {
    record,
    get,
    clear,
    get lastReason() {
      return lastReason;
    },
  };
}

// Default module-level tracker — backward-compatible thin wrapper.
const _defaultTracker = createFsCheckTracker();
let lastFsErrorReason = null;

function recordFsCheckError(targetPath, err, context) {
  const reason = _defaultTracker.record(targetPath, err, context);
  lastFsErrorReason = reason;
  return reason;
}

function getFsCheckReasons() {
  return _defaultTracker.get();
}

function clearFsCheckReasons() {
  _defaultTracker.clear();
  lastFsErrorReason = null;
  fileExists.lastReason = null;
  dirExists.lastReason = null;
}

function fileExists(filePath, fsApi, options) {
  const f = fsApi || fs;
  try {
    if (typeof f.existsSync === 'function') {
      const exists = f.existsSync(filePath);
      if (exists) {
        if (typeof f.statSync === 'function') {
          const st = f.statSync(filePath);
          return Boolean(st && (typeof st.isFile === 'function' ? st.isFile() : true));
        }
        return true;
      }
      return false;
    }
    if (typeof f.statSync === 'function') {
      const st = f.statSync(filePath);
      return Boolean(st && (typeof st.isFile === 'function' ? st.isFile() : true));
    }
  } catch (err) {
    const reason = recordFsCheckError(filePath, err, 'fileExists');
    fileExists.lastReason = reason;
    if (options && Array.isArray(options.reasons)) {
      options.reasons.push(reason);
    }
    if (typeof options === 'function') {
      options(reason, err);
    }
    return false;
  }
  return false;
}

function dirExists(dirPath, fsApi, options) {
  const f = fsApi || fs;
  try {
    if (typeof f.existsSync === 'function') {
      const exists = f.existsSync(dirPath);
      if (exists) {
        if (typeof f.statSync === 'function') {
          const st = f.statSync(dirPath);
          return Boolean(st && (typeof st.isDirectory === 'function' ? st.isDirectory() : true));
        }
        return true;
      }
      return false;
    }
    if (typeof f.statSync === 'function') {
      const st = f.statSync(dirPath);
      return Boolean(st && (typeof st.isDirectory === 'function' ? st.isDirectory() : true));
    }
  } catch (err) {
    const reason = recordFsCheckError(dirPath, err, 'dirExists');
    dirExists.lastReason = reason;
    if (options && Array.isArray(options.reasons)) {
      options.reasons.push(reason);
    }
    if (typeof options === 'function') {
      options(reason, err);
    }
    return false;
  }
  return false;
}

function getCodexPaths(options, deps) {
  const o = options || {};
  const d = deps || {};
  const fsApi = d.fs || o.fs || fs;
  const env = Object.assign({}, process.env, d && d.env, o && o.env);

  if (o.codexAuthPath || d.codexAuthPath || o.codexAuthFile || d.codexAuthFile) {
    const authFile = o.codexAuthPath || d.codexAuthPath || o.codexAuthFile || d.codexAuthFile;
    const codexDir = o.codexDir || d.codexDir || path.dirname(authFile);
    const configFile =
      o.codexConfigPath ||
      d.codexConfigPath ||
      o.codexConfigFile ||
      d.codexConfigFile ||
      path.join(codexDir, 'config.toml');
    const home =
      o.homeDir ||
      d.homeDir ||
      (typeof o.homedir === 'function' ? o.homedir() : o.homedir) ||
      (typeof d.homedir === 'function' ? d.homedir() : d.homedir) ||
      o.home ||
      d.home ||
      path.dirname(codexDir);
    return { home, codexDir, authFile, configFile };
  }

  const explicitHome =
    o.homeDir ||
    d.homeDir ||
    (typeof o.homedir === 'function' ? o.homedir() : o.homedir) ||
    (typeof d.homedir === 'function' ? d.homedir() : d.homedir) ||
    o.home ||
    d.home;
  if (explicitHome) {
    const codexDir = o.codexDir || d.codexDir || path.join(explicitHome, '.codex');
    const authFile =
      o.codexAuthPath ||
      d.codexAuthPath ||
      o.codexAuthFile ||
      d.codexAuthFile ||
      path.join(codexDir, 'auth.json');
    const configFile =
      o.codexConfigPath ||
      d.codexConfigPath ||
      o.codexConfigFile ||
      d.codexConfigFile ||
      path.join(codexDir, 'config.toml');
    return { home: explicitHome, codexDir, authFile, configFile };
  }

  const candidateHomes = [];
  if (env.CODEX_HOME) {
    candidateHomes.push(env.CODEX_HOME);
  }
  if (process.platform === 'win32') {
    if (env.USERPROFILE) candidateHomes.push(env.USERPROFILE);
    if (env.HOME) candidateHomes.push(env.HOME);
    if (env.HOMEDRIVE && env.HOMEPATH) candidateHomes.push(path.join(env.HOMEDRIVE, env.HOMEPATH));
  } else {
    if (env.HOME) candidateHomes.push(env.HOME);
    if (env.USERPROFILE) candidateHomes.push(env.USERPROFILE);
  }
  try {
    const osHome = os.homedir();
    if (osHome) candidateHomes.push(osHome);
  } catch {}

  if (process.platform === 'win32') {
    const rootDir = resolveRootDir(o, d);
    const userMatch = (rootDir || process.cwd()).match(/^[a-zA-Z]:[\\/]Users[\\/][^\\/]+/i);
    if (userMatch && userMatch[0]) {
      candidateHomes.push(userMatch[0]);
    }
  }

  const seenHomes = new Set();
  const uniqueHomes = candidateHomes.filter((h) => {
    if (!h || typeof h !== 'string') return false;
    const norm = path.normalize(h);
    if (seenHomes.has(norm)) return false;
    seenHomes.add(norm);
    return true;
  });

  let selectedHome = uniqueHomes[0] || (typeof os.homedir === 'function' ? os.homedir() : '.');
  let selectedCodexDir = o.codexDir || d.codexDir || null;

  if (!selectedCodexDir) {
    for (const h of uniqueHomes) {
      const dir = path.basename(h).toLowerCase() === '.codex' ? h : path.join(h, '.codex');
      const testAuth = path.join(dir, 'auth.json');
      if (fileExists(testAuth, fsApi) || dirExists(dir, fsApi)) {
        selectedHome = path.basename(h).toLowerCase() === '.codex' ? path.dirname(h) : h;
        selectedCodexDir = dir;
        break;
      }
    }
  }

  const home = selectedHome;
  const codexDir = selectedCodexDir || path.join(home, '.codex');
  const authFile =
    o.codexAuthPath ||
    d.codexAuthPath ||
    o.codexAuthFile ||
    d.codexAuthFile ||
    path.join(codexDir, 'auth.json');
  const configFile =
    o.codexConfigPath ||
    d.codexConfigPath ||
    o.codexConfigFile ||
    d.codexConfigFile ||
    path.join(codexDir, 'config.toml');
  return { home, codexDir, authFile, configFile };
}

function hasCodexAuth(options, deps) {
  const o = options || {};
  const d = deps || {};
  const fsApi = d.fs || o.fs || fs;
  const { authFile } = getCodexPaths(o, d);
  try {
    return fileExists(authFile, fsApi, d.reasons || o.reasons);
  } catch (err) {
    recordFsCheckError(authFile, err, 'hasCodexAuth');
    return false;
  }
}

function parseCodexModelsFromToml(content) {
  if (typeof content !== 'string') return ['gpt-6.1-sol'];
  const match = content.match(/(?:^|\r?\n)\s*model\s*=\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/);
  if (!match) return ['gpt-6.1-sol'];
  const raw = match[1].trim();
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const items = [];
    const itemRegex = /"([^"]+)"|'([^']+)'/g;
    let m;
    while ((m = itemRegex.exec(raw)) !== null) {
      const val = (m[1] || m[2] || '').trim();
      if (val) items.push(val);
    }
    return items.length > 0 ? items : ['gpt-6.1-sol'];
  }
  const str = raw.replace(/^["']|["']$/g, '').trim();
  return str ? [str] : ['gpt-6.1-sol'];
}

function readCodexConfigModels(options, deps) {
  const o = options || {};
  const d = deps || {};
  const fsApi = d.fs || o.fs || fs;
  const { configFile } = getCodexPaths(o, d);
  try {
    if (fsApi.existsSync(configFile)) {
      const content = fsApi.readFileSync(configFile, 'utf8');
      // strict: only ids the operator's config.toml actually names, no default.
      if (o.strict && !/(?:^|\r?\n)\s*model\s*=/.test(String(content))) return [];
      return parseCodexModelsFromToml(content);
    }
  } catch {}
  return o.strict ? [] : ['gpt-6.1-sol'];
}

function isCodexContextEligible(options, deps) {
  const o = options || {};
  const d = deps || {};
  const cand = o.candidate || d.candidate;
  if (cand) {
    return cand.provider === 'openai-codex' || cand.accessPath === 'openai-codex';
  }
  // Without a concrete provider or candidate identifying a codex source,
  // session-wide flags (includeOpenAiCodex, codexAuthPath, isCodex, …) are
  // NOT eligibility evidence — they describe session auth/config, not the
  // model being resolved.  Borrowing another source's context window must
  // stay limited to an actual openai-codex candidate.
  return o.provider === 'openai-codex' || d.provider === 'openai-codex';
}

function resolveHermesContextWindow(modelId, options, deps) {
  const o = options || {};
  const d = deps || {};
  const fsApi = d.fs || o.fs || fs;
  const canonical = canonicalHermesModelId(modelId);
  const registry = d.registry || (d.sources || sourcesApi).loadSources(d.sourceOpts);

  // 0. Own source modelMeta (non-codex candidates retain their own producing source context;
  // openai-codex candidates participate in the cross-source conservative reducer below)
  if (!isCodexContextEligible(o, d)) {
    const candidate = o.candidate || d.candidate;
    const sourceId =
      (candidate && (candidate.sourceId || candidate.source || candidate.provider)) ||
      o.provider ||
      d.provider;
    const source = ((registry && registry.sources) || []).find((s) => s.id === sourceId);
    let meta =
      source &&
      source.modelMeta &&
      (source.modelMeta[modelId] || (canonical && source.modelMeta[canonical]));
    if (!meta && source && source.modelMeta && canonical) {
      for (const [id, m] of Object.entries(source.modelMeta)) {
        if (id === modelId || canonicalHermesModelId(id) === canonical) {
          meta = m;
          break;
        }
      }
    }
    if (meta) {
      const { toPositiveInteger } = require('./source-discovery');
      const cw =
        toPositiveInteger(typeof meta === 'number' ? meta : undefined) ??
        toPositiveInteger(meta.contextWindow) ??
        toPositiveInteger(meta.capabilities?.contextWindow) ??
        toPositiveInteger(meta.context_window) ??
        toPositiveInteger(meta.context_length) ??
        toPositiveInteger(meta.contextTokens);
      if (cw !== undefined) return cw;
    }
  }

  // 1. Injected hermesModelCatalogue
  const cat =
    d.hermesModelCatalogue || o.hermesModelCatalogue || d.hermesCatalogue || o.hermesCatalogue;
  if (cat && typeof cat === 'object') {
    const meta =
      cat[modelId] ||
      cat[canonical] ||
      (cat.models && (cat.models[modelId] || cat.models[canonical]));
    if (meta) {
      const cw = Number(
        typeof meta === 'number'
          ? meta
          : meta.contextWindow || meta.context_window || meta.context_length || meta.contextTokens
      );
      if (Number.isFinite(cw) && cw > 0) return cw;
    }
  }

  // 2. models_dev_cache.json in Hermes local directories
  const { home } = getCodexPaths(o, d);
  const local =
    o.localAppData ||
    d.localAppData ||
    process.env.LOCALAPPDATA ||
    path.join(home, 'AppData', 'Local');
  const hermesHome = o.hermesHome || d.hermesHome || getHermesHomeDir(resolveRootDir(o, d));
  const candidateCacheFiles = [
    path.join(local, 'hermes', 'models_dev_cache.json'),
    path.join(hermesHome, 'models_dev_cache.json'),
    path.join(home, '.hermes', 'models_dev_cache.json'),
  ];

  for (const cacheFile of candidateCacheFiles) {
    try {
      if (fsApi.existsSync(cacheFile)) {
        const raw = fsApi.readFileSync(cacheFile, 'utf8');
        const parsed = JSON.parse(raw);
        const providers = (parsed && (parsed.providers || parsed)) || {};
        for (const provKey of ['openai-codex', 'openai', 'codex']) {
          const provider = providers[provKey];
          if (provider && provider.models) {
            const m = provider.models[modelId] || provider.models[canonical];
            if (m) {
              const cw = Number(
                m.contextWindow || m.context_window || m.context_length || m.contextTokens
              );
              if (Number.isFinite(cw) && cw > 0) return cw;
            }
          }
        }
      }
    } catch {}
  }

  // 3. Same canonical model on registered provider catalogues (codex source included).
  // Allowed ONLY for openai-codex candidates when catalogue/cache metadata is absent.
  // For every other Hermes candidate, a model without window on its producing source stays unverified.
  // Keep the most conservative reported window; priors are not context evidence.
  if (isCodexContextEligible(o, d)) {
    const { toPositiveInteger } = require('./source-discovery');
    const reportedWindows = [];
    for (const source of (registry && registry.sources) || []) {
      for (const [id, meta] of Object.entries((source && source.modelMeta) || {})) {
        const isSameModel =
          id === modelId ||
          (canonical && (id === canonical || canonicalHermesModelId(id) === canonical));
        if (!isSameModel || !meta) continue;
        const cw =
          toPositiveInteger(typeof meta === 'number' ? meta : undefined) ??
          toPositiveInteger(meta.contextWindow) ??
          toPositiveInteger(meta.capabilities?.contextWindow) ??
          toPositiveInteger(meta.context_window) ??
          toPositiveInteger(meta.context_length) ??
          toPositiveInteger(meta.contextTokens);
        if (cw !== undefined) reportedWindows.push(cw);
      }
    }
    if (reportedWindows.length) return Math.min(...reportedWindows);
  }

  return undefined;
}

function selectReasoningCandidate(options, deps) {
  const d = deps || {};
  const opts = options || {};
  const decisionsMod = d.decisions || decisionsApi;
  const result = (d.combo || comboApi).comboCandidate({
    registry: d.registry || opts.registry,
    env: Object.assign({}, process.env, opts.env || {}, d.env || {}),
  });
  if (!result.candidate) {
    return {
      chosen: null,
      candidate: null,
      ranking: [],
      top3: [],
      rejected: [],
      refused: 'NO_REASONING_CANDIDATE',
      reason: result.error,
      decisionRecord: null,
    };
  }
  const candidate = result.candidate;
  const chosenRoute = {
    candidateKey: candidate.candidateKey,
    modelId: candidate.modelId,
    routeModelId: candidate.modelId,
    gateway: candidate.gateway,
    reason: 'combo-only routing',
  };
  return {
    chosen: candidate.candidateKey,
    candidate,
    ranking: [candidate],
    top3: [candidate],
    rejected: [],
    chosenRoute,
    decisionRecord: {
      stage: decisionsMod.Stage.SELECTED,
      workItemId: opts.taskId || opts.sessionId || 'hermes-reasoning-session',
      chosen: candidate.candidateKey,
      chosenCandidate: candidate,
      chosenRoute,
      reason: 'combo-only routing',
      harness: 'hermes',
      candidates: [{ candidateKey: candidate.candidateKey }],
      rejected: [],
      detail: 'HERMES_REASONING_COMBO',
    },
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
  const gateway = (candidate && candidate.gateway) || (parsed && parsed.gateway) || '';
  const upstream =
    (candidate && candidate.upstream) ||
    (parsed && parsed.upstream) ||
    (gateway && gateway !== '*' ? gateway : '');

  const isCodexProvider =
    (candidate &&
      (candidate.provider === 'openai-codex' ||
        candidate.gateway === 'openai-codex' ||
        candidate.source === 'openai-codex' ||
        candidate.sourceId === 'openai-codex')) ||
    gateway === 'openai-codex' ||
    upstream === 'openai-codex';

  let providerName = isCodexProvider
    ? 'openai-codex'
    : gateway && gateway !== '*'
      ? gateway
      : upstream && upstream !== '*'
        ? upstream
        : 'custom';
  if (!providerName || providerName === '*') providerName = 'custom';

  if (!/^[a-zA-Z0-9_.-]+$/.test(providerName)) {
    const err = new Error('INVALID_PROVIDER_NAME: ' + providerName);
    err.code = 'INVALID_PROVIDER_NAME';
    throw err;
  }

  const modelId =
    (opts && opts.modelId) ||
    (candidate && (candidate.modelId || candidate.model)) ||
    (parsed && parsed.modelId) ||
    '';

  function escapeYamlString(val) {
    const str = String(val);
    if (/[\r\n\0]/.test(str)) {
      throw new Error('YAML_VALUE_UNSAFE: contains newline or control character');
    }
    return JSON.stringify(str);
  }

  const homeDir = opts.hermesHome || d.hermesHome || getHermesHomeDir(rootDir);
  fsApi.mkdirSync(homeDir, { recursive: true });

  if (isCodexProvider) {
    const yamlContent = [
      '# Controller-owned Hermes providers config',
      '# Generated by Ship De Controller — do not put secrets here',
      'model:',
      `  default: ${escapeYamlString(modelId)}`,
      `  provider: ${escapeYamlString(providerName)}`,
      'api_max_retries: 1',
      'auto_recovery_cycles: 0',
      ...skillsConfigLines(homeDir, fsApi),
      '',
    ].join('\n');

    const homeConfPath = path.join(homeDir, 'config.yaml');
    fsApi.writeFileSync(homeConfPath, yamlContent, 'utf8');

    const legacyConfPath = path.join(dir, 'config.yaml');
    fsApi.writeFileSync(legacyConfPath, yamlContent, 'utf8');

    const jsonContent = {
      model: {
        default: modelId,
        provider: providerName,
      },
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

    const installedSkillPath = installSkillFile(homeDir, opts, d);

    return {
      configPath: homeConfPath,
      legacyConfigPath: legacyConfPath,
      hermesHome: homeDir,
      providerName: 'openai-codex',
      modelId,
      baseUrl: null,
      apiKeyEnv: null,
      installedSkillPath,
    };
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

  let baseUrl =
    (/^https?:\/\//i.test(candidate?.accessPath) && candidate.accessPath) ||
    candidate?.endpoint ||
    candidate?.sourceEndpoint ||
    (/^https?:\/\//i.test(parsed?.accessPath) && parsed.accessPath) ||
    '';
  if (
    !baseUrl ||
    baseUrl === 'cli' ||
    baseUrl.startsWith('cli-') ||
    baseUrl === '*' ||
    baseUrl === 'direct'
  ) {
    baseUrl =
      (/^https?:\/\//i.test(src?.accessPath) && src.accessPath) ||
      src?.endpoint ||
      (src && (src.accessPath || src.endpoint)) ||
      '';
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

  const yamlContent = [
    '# Controller-owned Hermes providers config',
    '# Generated by Ship De Controller — do not put secrets here',
    'model:',
    `  default: ${escapeYamlString(modelId)}`,
    `  provider: ${escapeYamlString(providerName)}`,
    'api_max_retries: 1',
    'auto_recovery_cycles: 0',
    'providers:',
    `  ${providerName}:`,
    `    name: ${escapeYamlString(providerName)}`,
    `    base_url: ${escapeYamlString(baseUrl)}`,
    `    key_env: ${escapeYamlString(apiKeyEnv)}`,
    'custom_providers:',
    `  - name: ${escapeYamlString(providerName)}`,
    `    base_url: ${escapeYamlString(baseUrl)}`,
    `    key_env: ${escapeYamlString(apiKeyEnv)}`,
    ...(src && src.headers && typeof src.headers === 'object' && Object.keys(src.headers).length
      ? [
          '    extra_headers:',
          ...Object.entries(src.headers).map(
            ([key, value]) => `      ${escapeYamlString(key)}: ${escapeYamlString(value)}`
          ),
        ]
      : []),
    ...skillsConfigLines(homeDir, fsApi),
    '',
  ].join('\n');

  const homeConfPath = path.join(homeDir, 'config.yaml');
  fsApi.writeFileSync(homeConfPath, yamlContent, 'utf8');

  // Also write legacy paths for backward compatibility with tooling
  const legacyConfPath = path.join(dir, 'config.yaml');
  fsApi.writeFileSync(legacyConfPath, yamlContent, 'utf8');

  const jsonContent = {
    model: {
      default: modelId,
      provider: providerName,
    },
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

  // Install (copy) Controller skill to <hermesHome>/skills/shipde-controller/SKILL.md
  // Overwrites each launch/write so it stays in sync with the repo
  const installedSkillPath = installSkillFile(homeDir, opts, d);

  return {
    configPath: homeConfPath,
    legacyConfigPath: legacyConfPath,
    hermesHome: homeDir,
    providerName,
    modelId,
    baseUrl,
    apiKeyEnv,
    ...(src && src.headers && typeof src.headers === 'object' ? { headers: src.headers } : {}),
    installedSkillPath,
  };
}

/**
 * Returns default prompt for Hermes when orchestrating a goal.
 */
function defaultGoalPrompt(goalId) {
  return (
    `You are the interactive orchestrator for goal ${goalId}. ` +
    `Read and follow the ${CONTROLLER_SKILL_NAME} skill. ` +
    `Check the current state via "node tools/ai-brain/cli.js goal status ${goalId}". ` +
    `If items need planning, submit the plan. Then start or resume execution via "node tools/ai-brain/cli.js goal run ${goalId}". ` +
    `Monitor execution progress and report completion or blockers with concrete evidence.`
  );
}

/**
 * Builds the Hermes command arguments:
 * 'chat -m <modelId> --provider <provider-name> --continue <sessionId> --create-if-missing' plus skill file.
 */
function buildHermesArgv(candidate, session, options) {
  const opts = options || {};
  const rootDir = resolveRootDir(opts, {});

  const parsed =
    candidate && candidate.candidateKey ? parseCandidateKey(candidate.candidateKey) : candidate;
  const modelId =
    (candidate && (candidate.modelId || candidate.model)) || (parsed && parsed.modelId);
  const isCodexProvider =
    (candidate &&
      (candidate.provider === 'openai-codex' ||
        candidate.gateway === 'openai-codex' ||
        candidate.upstream === 'openai-codex' ||
        candidate.source === 'openai-codex' ||
        candidate.sourceId === 'openai-codex')) ||
    (parsed && (parsed.gateway === 'openai-codex' || parsed.upstream === 'openai-codex'));
  const providerName =
    opts.providerName ||
    (isCodexProvider
      ? 'openai-codex'
      : candidate && candidate.gateway && candidate.gateway !== '*'
        ? candidate.gateway
        : (candidate && candidate.upstream) || (parsed && parsed.gateway) || 'custom');
  const sessionId = (session && session.sessionId) || generateSessionId();

  const args = [];
  if (opts.omitChatCommand !== true && opts.includeChatCommand !== false) {
    args.push('chat');
  }

  args.push('-m', String(modelId));
  args.push('--provider', String(providerName));
  args.push('--continue', String(sessionId), '--create-if-missing');

  if (opts.skill !== false) {
    const rawSkill =
      opts.skillName ||
      (typeof opts.skill === 'string' && opts.skill.trim()
        ? opts.skill.trim()
        : CONTROLLER_SKILL_NAME);
    const skillName =
      typeof rawSkill === 'string' && !/[/\\]/.test(rawSkill) && !rawSkill.endsWith('.md')
        ? rawSkill
        : CONTROLLER_SKILL_NAME;
    args.push('-s', skillName);
  }

  const query =
    opts.query ||
    opts.q ||
    (opts.acp ? undefined : opts.prompt) ||
    (opts.goal ? defaultGoalPrompt(opts.goal) : null);
  if (query) {
    args.push('-q', String(query));
  }

  if (opts.yolo === true) {
    args.push('--yolo');
  }
  if (opts.acceptHooks === true) {
    args.push('--accept-hooks');
  }

  if (Array.isArray(opts.extraArgs)) {
    args.push(...opts.extraArgs);
  }

  return args;
}

/**
 * Resolves the Hermes launch command and arguments.
 * Order:
 * 1. env HERMES_BIN if set (if it ends with .js, launch as process.execPath + [HERMES_BIN, ...argv]; else HERMES_BIN + argv)
 * 2. on win32, search each PATH dir for hermes.cmd; if found and <dir>/node_modules/hermes-agent/bin/hermes.js exists, launch process.execPath with [thatJs, ...argv]
 * 3. otherwise 'hermes' with argv.
 * Never uses shell:true (argv must not be shell-interpreted).
 */
function resolveHermesLaunchCommand(argv, options, deps) {
  let opts = options || {};
  let d = deps || {};
  if (!deps && options && (options.env || options.platform || options.fs || options.execPath)) {
    d = options;
    opts = {};
  }
  const envApi = d.env || opts.env || process.env;
  const platformApi = d.platform || opts.platform || process.platform;
  const fsApi = d.fs || opts.fs || fs;
  const execPath = d.execPath || opts.execPath || process.execPath;
  const chatArgv = Array.isArray(argv) ? argv : [];

  const hermesBin = envApi.HERMES_BIN || envApi.hermes_bin;
  if (hermesBin && typeof hermesBin === 'string' && hermesBin.trim()) {
    const trimmedBin = hermesBin.trim();
    let isDir = false;
    try {
      if (fsApi.existsSync(trimmedBin) && fsApi.statSync(trimmedBin).isDirectory()) {
        isDir = true;
      }
    } catch {}
    if (!isDir) {
      if (trimmedBin.toLowerCase().endsWith('.js')) {
        return {
          command: execPath,
          args: [trimmedBin, ...chatArgv],
        };
      }
      return {
        command: trimmedBin,
        args: [...chatArgv],
      };
    }
  }

  if (platformApi === 'win32') {
    const rawPath = envApi.PATH || envApi.Path || envApi.path || '';
    const pathDirs = rawPath
      .split(';')
      .map((p) => p.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);

    for (const dir of pathDirs) {
      const cmdPath = path.join(dir, 'hermes.cmd');
      if (fsApi.existsSync(cmdPath)) {
        const jsPath = path.join(dir, 'node_modules', 'hermes-agent', 'bin', 'hermes.js');
        if (fsApi.existsSync(jsPath)) {
          return {
            command: execPath,
            args: [jsPath, ...chatArgv],
          };
        }
      }
    }
  }

  return {
    command: 'hermes',
    args: [...chatArgv],
  };
}

// Eight concurrent accounts is the existing transport safety invariant, not an attempt cap.
/**
 * Launches an interactive Hermes chat session bound to a Controller-selected candidate.
 * Handles failure classification, candidate reselection, and resume relaunching.
 */
async function launchHermesSession(options, deps) {
  const opts = options || {};
  if (opts.acp && (typeof opts.prompt !== 'string' || !opts.prompt.trim())) {
    throw new Error('ACP_PROMPT_REQUIRED');
  }
  if (
    opts.acp &&
    opts.acpTimeoutMs !== undefined &&
    (!Number.isFinite(opts.acpTimeoutMs) || opts.acpTimeoutMs <= 0)
  ) {
    throw new Error('ACP_INVALID_TIMEOUT');
  }
  const d = await refreshReasoningContext(opts, deps || {});
  const rootDir = resolveRootDir(opts, d);
  const hermesHome = opts.hermesHome || d.hermesHome || getHermesHomeDir(rootDir);

  const injectedEnv = Object.assign({}, opts.env || {}, d.env || {});
  const env = Object.assign({}, process.env, injectedEnv, {
    HERMES_HOME: hermesHome,
  });

  const injectedPathKey = Object.keys(injectedEnv).find((k) => k.toLowerCase() === 'path');
  if (injectedPathKey) {
    const targetVal = injectedEnv[injectedPathKey];
    delete env.PATH;
    delete env.Path;
    delete env.path;
    env[injectedPathKey] = targetVal;
  }

  const injectedBinKey = Object.keys(injectedEnv).find((k) => k.toLowerCase() === 'hermes_bin');
  if (injectedBinKey) {
    const targetVal = injectedEnv[injectedBinKey];
    delete env.HERMES_BIN;
    delete env.hermes_bin;
    if (targetVal) {
      env[injectedBinKey] = targetVal;
    }
  }

  // Verified Fact 3: --ignore-user-config (and HERMES_IGNORE_USER_CONFIG=1) makes Hermes skip config.yaml
  delete env.HERMES_IGNORE_USER_CONFIG;

  const spawnFn = d.spawn || opts.spawn || defaultSpawn;
  const classifier = d.failureClassifier || opts.failureClassifier || failureClassifier;

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

  const probeReasons = [];
  let initialRejected;
  let attempt = 0;
  {
    const selectFn = d.selectReasoningCandidate || selectReasoningCandidate;
    const selection = selectFn(Object.assign({}, opts, { sessionId: session.sessionId }), d);
    if (!selection || !selection.candidate) {
      const err = new Error(
        (selection && (selection.reason || selection.refused)) || 'NO_REASONING_CANDIDATE'
      );
      err.code = (selection && selection.refused) || 'NO_REASONING_CANDIDATE';
      throw err;
    }
    initialRejected = selection.rejected;
    const winner = selection.candidate;
    const candidate = winner;
    selection.candidate = candidate;
    selection.chosen = candidate.candidateKey;
    selection.chosenRoute = {
      ...selection.chosenRoute,
      candidateKey: candidate.candidateKey,
      modelId: canonicalHermesModelId(candidate.modelId),
      routeModelId: candidate.modelId,
      gateway: candidate.gateway,
      ...candidate.routeSelection,
    };
    if (!opts.skipDecisionLog) {
      (d.decisions || decisionsApi).recordDecision(
        {
          ...selection.decisionRecord,
          chosen: selection.chosen,
          chosenCandidate: candidate,
          chosenRoute: selection.chosenRoute,
          detail:
            opts.dryRun && !opts.probe
              ? 'HERMES_REASONING_DRY_RUN'
              : 'HERMES_REASONING_LIVE_PROBE_SUCCEEDED',
        },
        {
          dir:
            opts.decisionDir ||
            d.decisionDir ||
            path.join(rootDir, 'tools', 'ai-brain', 'data', 'decisions'),
        }
      );
    }
    session.candidateKey = candidate.candidateKey;
    saveSession(session, opts, d);
    const configResult = writeProvidersConfig(candidate, opts, d);
    try {
      syncControllerMemory(
        hermesHome,
        readControllerMemoryState(opts, rootDir, d),
        opts.fs || d.fs || fs
      );
    } catch {}
    attempt += 1;

    const chosenModelId = candidate.modelId || candidate.model;
    const chosenScore =
      candidate.score !== undefined ? candidate.score : (selection.chosenRoute?.score ?? 'unknown');
    const chosenWhy =
      candidate.routeSelection?.reason ||
      candidate.reason ||
      (selection.chosenRoute && selection.chosenRoute.reason) ||
      'Controller selected live route';
    const decisionLine = `[HERMES_DISPATCH] model=${chosenModelId} score=${chosenScore} provider=${configResult.providerName} reason=${chosenWhy}`;
    console.log(decisionLine);

    if (opts.goal || (session.goalIds && session.goalIds.length)) {
      try {
        const goalId = String(opts.goal || session.goalIds[0]);
        const goalsMod = d.goals || require('./goals');
        const goalsDir =
          opts.goalsDir ||
          (goalsMod.resolveGoalsDir
            ? goalsMod.resolveGoalsDir(rootDir, opts)
            : path.join(rootDir, 'data', 'goals'));
        const goalDir = path.join(goalsDir, goalId);
        const fsMod = opts.fs || d.fs || fs;
        fsMod.mkdirSync(goalDir, { recursive: true });
        const runLogPath = path.join(goalDir, 'run.log');
        fsMod.appendFileSync(runLogPath, `[${new Date().toISOString()}] ${decisionLine}\n`, 'utf8');
      } catch {}
    }

    env.HERMES_MODEL = String(configResult.modelId || candidate.modelId);
    env.HERMES_PROVIDER = String(configResult.providerName);

    const argv = opts.acp
      ? ['acp']
      : buildHermesArgv(candidate, session, {
          rootDir,
          providerName: configResult.providerName,
          includeChatCommand: opts.includeChatCommand,
          omitChatCommand: opts.omitChatCommand,
          extraArgs: opts.extraArgs,
          skillName: opts.skillName,
          skill: opts.skill,
          goal: opts.goal,
          query: opts.query || opts.q || (opts.acp ? undefined : opts.prompt),
          yolo: opts.yolo,
          acceptHooks: opts.acceptHooks,
        });

    const resolverInput = Object.assign(
      {
        env,
        platform: opts.platform || d.platform || process.platform,
        fs: opts.fs || d.fs || fs,
        execPath: opts.execPath || d.execPath || process.execPath,
      },
      d,
      { env }
    );

    let resolved;
    const resolverFn =
      typeof opts.resolveHermesCommand === 'function'
        ? opts.resolveHermesCommand
        : typeof d.resolveHermesCommand === 'function'
          ? d.resolveHermesCommand
          : typeof opts.resolveHermesLaunch === 'function'
            ? opts.resolveHermesLaunch
            : typeof d.resolveHermesLaunch === 'function'
              ? d.resolveHermesLaunch
              : null;

    if (resolverFn) {
      resolved = resolverFn(argv, opts, resolverInput);
    } else if (
      opts.resolveHermesCommand &&
      typeof opts.resolveHermesCommand === 'object' &&
      opts.resolveHermesCommand.command
    ) {
      resolved = {
        command: opts.resolveHermesCommand.command,
        args: Array.isArray(opts.resolveHermesCommand.args)
          ? opts.resolveHermesCommand.args
          : [...argv],
      };
    } else if (
      d.resolveHermesCommand &&
      typeof d.resolveHermesCommand === 'object' &&
      d.resolveHermesCommand.command
    ) {
      resolved = {
        command: d.resolveHermesCommand.command,
        args: Array.isArray(d.resolveHermesCommand.args) ? d.resolveHermesCommand.args : [...argv],
      };
    } else {
      const resolverOpts =
        opts.resolveHermesCommand && typeof opts.resolveHermesCommand === 'object'
          ? Object.assign({}, opts, opts.resolveHermesCommand)
          : opts;
      resolved = resolveHermesLaunchCommand(argv, resolverOpts, resolverInput);
    }

    if (opts.dryRun) {
      return {
        status: 'dry_run',
        decisionLine,
        modelRanking: initialModelRanking,
        chosenRoute: selection.chosenRoute,
        sessionId: session.sessionId,
        candidateKey: session.candidateKey,
        candidate,
        command: resolved.command,
        args: resolved.args,
        argv,
        configResult,
        hermesHome,
        refusalReasons: probeReasons.slice(),
        rejected: initialRejected || selection.rejected || [],
      };
    }

    if (opts.acp) {
      const statusPath = path.join(getHermesDir(rootDir), 'acp-status.json');
      const fsApi = opts.fs || d.fs || fs;
      let acpStatus;
      try {
        acpStatus = await (d.runAcpTurn || require('./hermes-acp').runAcpTurn)(
          resolved.command,
          resolved.args,
          {
            cwd: rootDir,
            env,
            modelId: candidate.modelId,
            providerName: configResult.providerName,
            prompt: `Read and follow the ${CONTROLLER_SKILL_NAME} skill before acting.\n${opts.prompt}`,
            timeoutMs: opts.acpTimeoutMs,
            onStatus: (status) => {
              fsApi.mkdirSync(path.dirname(statusPath), { recursive: true });
              const temp = statusPath + '.tmp';
              fsApi.writeFileSync(
                temp,
                JSON.stringify({ ...status, sessionId: session.sessionId }),
                'utf8'
              );
              atomicRenameSync(temp, statusPath, { fs: fsApi });
            },
          },
          d
        );
      } catch (acpErr) {
        // A missing Hermes-side provider login (reported in the ACP error details) is
        // account-scoped: remember it, drop this route and reselect, as the chat path does.
        const missing = String((acpErr && acpErr.message) || '').match(
          /No [a-z0-9 -]*credentials stored\b[^\r\n]*/i
        );
        throw acpErr;
      }
      return {
        status: acpStatus.state,
        exitCode: acpStatus.stopReason === 'end_turn' ? 0 : 1,
        sessionId: session.sessionId,
        acpStatus,
        statusPath,
      };
    }

    let spawnResult;
    try {
      spawnResult = await spawnFn(resolved.command, resolved.args, {
        cwd: rootDir,
        env,
        stdio: opts.stdio || ['inherit', 'pipe', 'pipe'],
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
      spawnResult && spawnResult.routeFailure
        ? spawnResult.exitCode === 0
          ? 1
          : spawnResult.exitCode
        : spawnResult && typeof spawnResult.exitCode === 'number'
          ? spawnResult.exitCode
          : spawnResult && typeof spawnResult.status === 'number'
            ? spawnResult.status
            : 0;

    if (exitCode === 0 && !(spawnResult && spawnResult.routeFailure)) {
      return {
        status: 'completed',
        exitCode: 0,
        sessionId: session.sessionId,
        candidateKey: session.candidateKey,
        candidate,
        command: resolved.command,
        args: resolved.args,
        argv,
        configResult,
        spawnResult,
        hermesHome,
        refusalReasons: probeReasons.slice(),
        rejected: initialRejected || selection.rejected || [],
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

    const liveRouteFailure = spawnResult && spawnResult.routeFailure;
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
      Boolean(liveRouteFailure) ||
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
        command: resolved.command,
        args: resolved.args,
        argv,
        configResult,
        spawnResult,
        classification,
        hermesHome,
        refusalReasons: probeReasons.slice(),
        rejected: initialRejected || selection.rejected || [],
      };
    }

    // Route failure: 9router already failed over inside the combo, so stop here.
    const runtimeReason = liveRouteFailure
      ? `HERMES_RUNTIME_ROUTE_FAILURE ${liveRouteFailure}`
      : classification.reason || classification.cause;
    probeReasons.push(`${candidate.candidateKey}: ${runtimeReason}`);
    const err = new Error('COMBO_ROUTE_FAILURE: ' + runtimeReason);
    err.code = 'COMBO_ROUTE_FAILURE';
    err.classification = classification;
    throw err;
  }
}

/**
 * CLI entry for `node tools/ai-brain/cli.js goal session`.
 * Outputs JSON on stdout.
 */
async function goalSessionCommand(args, deps) {
  const opts = Object.assign({}, args);
  if (args.session) opts.session = args.session;
  if (args.goal) opts.goal = args.goal;
  if (args.reselect) opts.reselect = true;
  if (args['decision-dir'] || args.decisionDir)
    opts.decisionDir = args['decision-dir'] || args.decisionDir;
  if (args['skip-decision-log'] || args.skipDecisionLog) opts.skipDecisionLog = true;

  try {
    const d = await refreshReasoningContext(opts, deps || {});
    let session = loadSession(opts, d);
    if (opts.newSession) {
      session = null;
    } else if (session && opts.session && session.sessionId !== opts.session) {
      session = null;
    }
    const shouldReselect = !session || Boolean(opts.reselect) || !session.candidateKey;
    const preferredCandidateKey = shouldReselect ? null : session.candidateKey;

    const selectFn = d.selectReasoningCandidate || selectReasoningCandidate;
    const selection = selectFn(
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
      modelRanking: selection.modelRanking,
      chosenRoute: selection.chosenRoute,
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
  if (args['acp-timeout-ms'] !== undefined) opts.acpTimeoutMs = Number(args['acp-timeout-ms']);
  if (args.session) opts.session = args.session;
  if (args.goal) opts.goal = args.goal;
  if (args.reselect) opts.reselect = true;
  if (args['dry-run'] || args.dryRun) opts.dryRun = true;
  if (args.probe) opts.probe = true;
  if (args['decision-dir'] || args.decisionDir)
    opts.decisionDir = args['decision-dir'] || args.decisionDir;
  if (args['skip-decision-log'] || args.skipDecisionLog) opts.skipDecisionLog = true;
  if (args.env) opts.env = args.env;
  if (args.platform) opts.platform = args.platform;
  if (args.fs) opts.fs = args.fs;
  if (args.execPath) opts.execPath = args.execPath;
  if (args.resolveHermesCommand) opts.resolveHermesCommand = args.resolveHermesCommand;
  if (args.resolveHermesLaunch) opts.resolveHermesLaunch = args.resolveHermesLaunch;
  if (args.query) opts.query = args.query;
  if (args.q) opts.query = args.q;
  if (args.prompt) opts.prompt = args.prompt;
  if (args.yolo !== undefined) opts.yolo = Boolean(args.yolo);
  if (args['accept-hooks'] !== undefined) opts.acceptHooks = Boolean(args['accept-hooks']);
  if (Array.isArray(args._) && args._.length > 1) {
    const trailing = args._.slice(1).join(' ').trim();
    if (trailing && !opts.query && !opts.prompt) opts.query = trailing;
  }

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
  syncControllerMemory,
  skillsConfigLines,
  CONTROLLER_SKILL_NAME,
  installSkillFile,
  installedSkillFilePath,
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
  refreshReasoningContext,
  writeProvidersConfig,
  defaultGoalPrompt,
  buildHermesArgv,
  resolveHermesLaunchCommand,
  resolveHermesLaunch: resolveHermesLaunchCommand,
  resolveHermesCommand: resolveHermesLaunchCommand,
  launchHermesSession,
  goalSessionCommand,
  chatCommand,
  defaultSpawn,
  HERMES_MIN_CONTEXT,
  getCodexPaths,
  hasCodexAuth,
  parseCodexModelsFromToml,
  readCodexConfigModels,
  resolveHermesContextWindow,
  candidateAccountKey,
  fileExists,
  dirExists,
  getFsCheckReasons,
  clearFsCheckReasons,
  createFsCheckTracker,
  isCodexContextEligible,
  canonicalHermesModelId,
  PROVIDER_LEVEL_FAILURE_CAUSES,
};
