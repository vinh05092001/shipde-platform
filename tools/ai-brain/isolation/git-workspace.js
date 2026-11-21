'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

const WORKER_USERNAME = 'ShipDeWorker';
// The worker root, defined once. Every component that has to know whether a
// path is inside the worker boundary (the launcher that provisions it, the
// publisher that must never run there, the approval registry that must stay
// operator-side) reads this one definition instead of restating the path.
const WORKER_ROOT = 'C:\\ShipDeWorker';
const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60 * 1000;

/** Commit a successful native writer's file-only output on the Controller side.
 * The injected runner is for offline tests; production uses normal Git hooks.
 * A failed hook is a local failure and never becomes a reviewed worker SHA.
 */
const ALLOWED_CORE_KEYS = new Set([
  'repositoryformatversion',
  'filemode',
  'bare',
  'logallrefupdates',
  'symlinks',
  'ignorecase',
  'autocrlf',
  'eol',
  'hidedotfiles',
  'preloadindex',
  'fscache',
  'trustctime',
  'checkstat',
  'compression',
  'longpaths',
]);

const ALLOWED_REMOTE_KEYS = new Set(['url', 'fetch', 'pushurl', 'push', 'mirror', 'tagopt']);

const ALLOWED_BRANCH_KEYS = new Set(['remote', 'merge', 'rebase', 'description']);

const ALLOWED_USER_KEYS = new Set(['name', 'email', 'signingkey', 'useconfigonly']);

function isWorkerConfigKeyAllowed(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return false;
  const parts = rawKey.split('.');
  if (parts.length < 2) return false;
  const section = parts[0].toLowerCase();
  const prop = parts[parts.length - 1].toLowerCase();

  if (section === 'core') {
    return parts.length === 2 && ALLOWED_CORE_KEYS.has(prop);
  }
  if (section === 'user') {
    return parts.length === 2 && ALLOWED_USER_KEYS.has(prop);
  }
  if (section === 'remote') {
    return parts.length >= 3 && ALLOWED_REMOTE_KEYS.has(prop);
  }
  if (section === 'branch') {
    return parts.length >= 3 && ALLOWED_BRANCH_KEYS.has(prop);
  }
  return false;
}

function cleanGitEnv() {
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nul,
    GIT_CONFIG_SYSTEM: nul,
  });
  delete env.LEFTHOOK;
  delete env.LEFTHOOK_EXCLUDE;
  delete env.LEFTHOOK_SKIP;
  return env;
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function workerGitPaths(workerRoot, failure = 'WORKER_COMMIT_FAILED') {
  if (!workerRoot) {
    throw new Error(failure + ': missing or unreadable worker git directory');
  }
  const root = path.resolve(workerRoot);
  const dotGit = path.join(root, '.git');
  let stat;
  try {
    stat = fs.lstatSync(dotGit);
    fs.accessSync(dotGit, fs.constants.R_OK);
  } catch {
    throw new Error(failure + ': missing or unreadable worker git directory');
  }

  let gitDir = dotGit;
  if (stat.isFile()) {
    let gitFileContent;
    try {
      gitFileContent = fs.readFileSync(dotGit, 'utf8');
    } catch {
      throw new Error(failure + ': missing or unreadable worker git directory');
    }
    const match = gitFileContent.trim().match(/^gitdir:\s*(.+)$/i);
    if (!match) throw new Error(failure + ': invalid gitfile');
    gitDir = path.resolve(root, match[1]);
  }

  let realRoot;
  let realGitDir;
  try {
    realRoot = fs.realpathSync(root);
    realGitDir = fs.realpathSync(gitDir);
  } catch (error) {
    throw new Error(failure + ': cannot resolve git directory: ' + error.message);
  }
  if (!isPathInside(root, path.resolve(gitDir)) || !isPathInside(realRoot, realGitDir)) {
    throw new Error(failure + ': git directory resolves outside worker repository');
  }

  let commonDir = realGitDir;
  const commonFile = path.join(realGitDir, 'commondir');
  if (fs.existsSync(commonFile)) {
    let commonFileContent;
    try {
      commonFileContent = fs.readFileSync(commonFile, 'utf8').trim();
    } catch {
      throw new Error(failure + ': missing or unreadable worker git directory');
    }
    try {
      commonDir = fs.realpathSync(path.resolve(realGitDir, commonFileContent));
    } catch (error) {
      throw new Error(failure + ': cannot resolve git directory: ' + error.message);
    }
    if (!isPathInside(realRoot, commonDir)) {
      throw new Error(failure + ': git directory resolves outside worker repository');
    }
  }
  return { gitDir: realGitDir, commonDir };
}

function gitConfigCheckTimeoutMs(failure) {
  const ms = Number(require('../sources.json').dispatch?.gitConfigCheckTimeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(failure + ': dispatch.gitConfigCheckTimeoutMs not configured');
  }
  return ms;
}

function validateConfigFile(configFile, workerRoot, failure) {
  let stat;
  try {
    stat = fs.lstatSync(configFile);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error(failure + ': cannot stat worker git config');
  }
  // A FIFO or device would block git forever; only a regular file is parsed.
  if (!stat.isFile()) throw new Error(failure + ': worker git config is not a regular file');
  const result = cp.spawnSync(
    'git',
    ['config', '--file', configFile, '--no-includes', '--name-only', '--null', '--list'],
    {
      cwd: os.tmpdir(),
      env: cleanGitEnv(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: gitConfigCheckTimeoutMs(failure),
    }
  );
  if (!result || result.status !== 0) throw new Error(failure + ': invalid worker git config');
  const keys = String(result.stdout || '')
    .split('\0')
    .filter(Boolean);
  for (const key of keys) {
    if (!isWorkerConfigKeyAllowed(key)) {
      throw new Error(failure + ': forbidden worker git config: ' + key);
    }
  }
}

function validateWorkerGitConfig(workerRoot, failure = 'WORKER_COMMIT_FAILED') {
  const dirs = workerGitPaths(workerRoot, failure);
  const config = path.join(dirs.commonDir, 'config');
  if (!fs.existsSync(config)) throw new Error(failure + ': worker git config missing');
  validateConfigFile(config, workerRoot, failure);
  validateConfigFile(path.join(dirs.gitDir, 'config.worktree'), workerRoot, failure);
}

function resolveInstalledHook(hostRoot, env, failure) {
  const result = cp.spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'],
    { cwd: hostRoot, env, encoding: 'utf8', windowsHide: true }
  );
  const hooks = result?.status === 0 ? String(result.stdout || '').trim() : '';
  const hook = hooks ? path.join(hooks, 'pre-commit') : '';
  if (!hook || !fs.existsSync(hook)) {
    throw new Error(failure + ': installed pre-commit hook missing');
  }
  try {
    const stat = fs.statSync(hook);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o111) === 0)) {
      throw new Error('not executable');
    }
    fs.accessSync(hook, fs.constants.X_OK);
  } catch {
    throw new Error(failure + ': installed pre-commit hook not executable');
  }
  return hooks;
}

function controllerGit(options, requireHook) {
  const o = options || {};
  const failure = o.failure || 'NATIVE_WRITER_COMMIT_FAILED';
  const decisions = require('../decisions');
  if (o.run) {
    return (args) => {
      const result = o.run(args);
      if (!result || result.status !== 0) {
        const redact = decisions.createSecretRedactor(process.env);
        const safeStderr = redact(String((result && result.stderr) || ''));
        const safeStdout = redact(String((result && result.stdout) || ''));
        throw new Error(
          failure + ': ' + args[0] + ' stderr: ' + safeStderr + ' stdout: ' + safeStdout
        );
      }
      return String(result.stdout || '').trim();
    };
  }

  const env = cleanGitEnv();
  const hooksPath = requireHook ? resolveInstalledHook(o.hostRoot, env, failure) : null;
  validateWorkerGitConfig(o.workerRoot, failure);
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const prefix = [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.attributesFile=' + nul,
    '-c',
    'diff.external=',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=ShipDe Controller',
    '-c',
    'user.email=controller@shipde.invalid',
    '-c',
    'safe.directory=' + path.resolve(o.workerRoot).split(path.sep).join('/'),
  ];
  if (o.hostRoot) {
    prefix.push('-c', 'safe.directory=' + path.resolve(o.hostRoot).split(path.sep).join('/'));
  }
  if (hooksPath) {
    prefix.unshift('-c', 'core.hooksPath=' + hooksPath);
  }
  prefix.push(...(o.gitConfig || []));

  return (args) => {
    const result = cp.spawnSync('git', [...prefix, ...args], {
      cwd: o.workerRoot,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: o.timeoutMs || DEFAULT_WORKER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    if (!result || result.status !== 0) {
      const redact = decisions.createSecretRedactor(env || process.env);
      const safeStderr = redact(String((result && result.stderr) || ''));
      const safeStdout = redact(String((result && result.stdout) || ''));
      throw new Error(
        failure + ': ' + args[0] + ' stderr: ' + safeStderr + ' stdout: ' + safeStdout
      );
    }
    return String(result.stdout || '').trim();
  };
}

function hookedControllerGit(options) {
  return controllerGit(options, true);
}

/** Materialise the dependency graph locally, including pnpm's virtual store.
 * Linking a package directory to the cache would make Node resolve its peers
 * and workspace dependencies there, bypassing worker-local @shipde links.
 * Only symlinks are recreated; ordinary files are copied, never hard-linked.
 */
function retargetSharedDepsWorkspaceLinks(depsDir, workerRoot) {
  const cacheRoot = path.resolve(depsDir);
  const checkout = path.resolve(workerRoot);
  const relativeInside = (root, target) => {
    const rel = path.relative(root, target);
    return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) ? rel : null;
  };
  if (
    relativeInside(cacheRoot, checkout) !== null ||
    relativeInside(checkout, cacheRoot) !== null
  ) {
    throw new Error('WORKER_DEPS_INVALID: cache and checkout must be separate trees');
  }

  const mapTarget = (target) => {
    const rel = relativeInside(cacheRoot, target);
    if (rel !== null) return path.join(checkout, rel);
    const staged = relativeInside(path.dirname(cacheRoot), target);
    if (staged !== null) {
      const [root, ...parts] = staged.split(path.sep);
      if (root.startsWith(path.basename(cacheRoot) + '.staging-')) {
        return path.join(checkout, ...parts);
      }
    }
    // Older caches can contain absolute workspace junctions to the staging
    // tree or host checkout. Resolve them against this worker's workspaces.
    const workspace = target.match(/[\\/](packages[\\/][^\\/]+|apps[\\/][^\\/]+)([\\/].*)?$/i);
    if (workspace) {
      const local = path.join(checkout, workspace[1], workspace[2] || '');
      if (!fs.existsSync(local)) throw new Error('WORKER_DEPS_WORKSPACE_MISSING');
      return local;
    }
    throw new Error('WORKER_DEPS_LINK_OUTSIDE_CACHE');
  };

  const copyEntry = (src, dst) => {
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) {
      const target = path.resolve(path.dirname(src), fs.readlinkSync(src));
      const localTarget = mapTarget(target);
      let targetStat;
      try {
        targetStat = fs.statSync(src);
      } catch (err) {
        // pnpm can leave absolute workspace junctions to the now-renamed
        // staging directory. The worker checkout supplies their target type.
        if (err.code !== 'ENOENT') throw err;
        try {
          targetStat = fs.statSync(path.join(cacheRoot, path.relative(checkout, localTarget)));
        } catch (cacheErr) {
          if (cacheErr.code !== 'ENOENT') throw cacheErr;
          targetStat = fs.statSync(localTarget);
        }
      }
      const linkType = targetStat.isDirectory()
        ? process.platform === 'win32'
          ? 'junction'
          : 'dir'
        : 'file';
      fs.symlinkSync(localTarget, dst, linkType);
    } else if (stat.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      for (const name of fs.readdirSync(src)) copyEntry(path.join(src, name), path.join(dst, name));
    } else if (stat.isFile()) {
      fs.copyFileSync(src, dst);
    } else {
      throw new Error('WORKER_DEPS_ENTRY_UNSUPPORTED');
    }
  };

  const candidates = ['node_modules'];
  for (const ws of ['apps', 'packages']) {
    const wsDir = path.join(cacheRoot, ws);
    if (!fs.existsSync(wsDir)) continue;
    for (const item of fs.readdirSync(wsDir, { withFileTypes: true })) {
      if (item.isDirectory()) candidates.push(path.join(ws, item.name, 'node_modules'));
    }
  }
  const excluded = [];
  for (const rel of candidates) {
    const src = path.join(cacheRoot, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(checkout, rel);
    // Check parent directories before removing anything: a retained worker
    // may still have a junction from the former shared-dependency layout.
    let parent = checkout;
    for (const part of path.dirname(rel).split(path.sep)) {
      if (part === '.') continue;
      parent = path.join(parent, part);
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) {
        throw new Error('WORKER_DEPS_PARENT_LINK');
      }
    }
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // node_modules itself may be a link; materialise its directory contents
    // rather than recreating a junction over a worker-owned directory.
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copyEntry(path.join(src, name), path.join(dst, name));
    excluded.push((rel + '/').split(path.sep).join('/'));
  }
  return excluded;
}

/**
 * True when the decision log shows a writer or repair turn for this work item:
 * the evidence that a dirty retained root holds this item's own output.
 * Fail closed if required parameters, config, or record fields are missing.
 */
function retainedRootHasOwnWriterRecord(opts, extra = {}) {
  try {
    const o = opts || {};
    const decisions = require('../decisions');
    if (!o.workItemId) return false;
    const baseId = String(o.workItemId).replace(/-(repair-\d+|review)$/, '');
    const targetRoot = extra.workerRoot || o.workerRoot;
    const targetSha = extra.retainedHeadSha || extra.retainWorkerHead || o.retainWorkerHead;
    const targetRun = extra.runId || o.runId;

    if (!baseId || !targetRoot || !targetSha || !targetRun) {
      return false;
    }

    let maxAgeMs;
    try {
      const cfg = require('../sources').getDispatchConfig(o.registry, o);
      maxAgeMs = cfg && cfg.retainedRootMaxAgeMs;
    } catch {}
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      return false; // Fail closed on missing/invalid config
    }

    const now = Date.now();
    return decisions.readDecisionsSafe({ dir: o.decisionDir || undefined }).some((rec) => {
      if (!rec || !rec.workItemId) return false;
      if (String(rec.workItemId).replace(/-(repair-\d+|review)$/, '') !== baseId) return false;
      const validStage =
        rec.stage === 'writer-launch-result' ||
        (rec.stage === decisions.Stage.LAUNCHED && !!rec.sha);
      if (!validStage) return false;

      const recRoot = rec.workerRoot || rec.root || rec.worktree;
      if (!recRoot) return false;
      if (path.resolve(recRoot).toLowerCase() !== path.resolve(targetRoot).toLowerCase()) {
        return false;
      }

      const recSha = rec.sha || rec.headSha;
      if (!recSha) return false;
      if (String(recSha).toLowerCase() !== String(targetSha).toLowerCase()) {
        return false;
      }

      if (!rec.runId || rec.runId !== targetRun) {
        return false;
      }

      const recTime = rec.at || rec.timestamp || rec.time;
      if (!recTime) return false;
      const recTimeMs = new Date(recTime).getTime();
      if (!Number.isFinite(recTimeMs)) return false;
      const age = now - recTimeMs;
      if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) {
        return false;
      }

      return true;
    });
  } catch {
    return false;
  }
}

function commitNativeWriterChanges(options) {
  const o = options || {};
  const checked = hookedControllerGit(o);
  if (checked(['status', '--porcelain'])) {
    checked(['add', '--all']);
    checked(['commit', '-m', '[' + o.workItemId + '] native writer changes']);
  }
  const sha = checked(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!/^[a-f0-9]{40}$/i.test(sha) || checked(['status', '--porcelain'])) {
    throw new Error('NATIVE_WRITER_COMMIT_FAILED: invalid SHA or dirty tree');
  }
  return sha;
}

/** Amend only Controller-owned goal metadata, using the installed host hook. */
function commitWorkerMetadata(options) {
  const o = options || {};
  const files = [
    'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',
    `docs/product-spec/work-items/${o.workItemId}.md`,
  ];
  const inspect = controllerGit({ ...o, failure: 'WORKER_COMMIT_FAILED' }, false);
  if (!inspect(['status', '--porcelain', '--', ...files])) return null;
  const head = inspect(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!/^[a-f0-9]{40}$/i.test(head)) throw new Error('WORKER_COMMIT_FAILED: rev-parse');
  if (o.headSha && head.toLowerCase() === String(o.headSha).trim().toLowerCase()) return null;
  const checked = hookedControllerGit({ ...o, failure: 'WORKER_COMMIT_FAILED' });
  // Some goals have no register delta: only stage metadata that exists.
  const present = files.filter((f) => fs.existsSync(path.join(o.workerRoot, f)));
  checked(['add', '--', ...present]);
  checked(['commit', '--amend', '--no-edit']);
  const sha = checked(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!/^[a-f0-9]{40}$/i.test(sha) || checked(['status', '--porcelain', '--', ...files])) {
    throw new Error('WORKER_COMMIT_FAILED: invalid SHA or dirty metadata');
  }
  return sha;
}

/** The operator-owned isolation attestation location. */
function isolationVerdictPath(options) {
  const base =
    process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || process.env.HOME || os.homedir();
  return (options && options.verdictPath) || path.join(base, 'ShipDe', 'isolation-verdict.json');
}

/** The worker root for one job: the worker never sees the operator's leaf name. */
const CONTEXT_PACK_LINE = /^(Focused context pack: read )(.+?)( before exploring files.)$/m;

/**
 * Copies the context pack named in a prompt into the worker payload directory
 * and points the prompt at the copy. A prompt without a readable pack is
 * returned unchanged.
 */
function stageContextPack(prompt, payloadDir, nonce) {
  const match = CONTEXT_PACK_LINE.exec(prompt);
  if (!match) return prompt;
  const source = match[2].trim();
  if (!path.isAbsolute(source) || !fs.existsSync(source)) return prompt;
  const name = 'context-' + nonce + '.md';
  fs.copyFileSync(source, path.join(payloadDir, name));
  return (
    prompt.slice(0, match.index) +
    match[1] +
    '.shipde/' +
    name +
    match[3] +
    prompt.slice(match.index + match[0].length)
  );
}

function workerRootFor(hostCwd) {
  const jobName = path.win32.basename(String(hostCwd || '')) || 'default';
  if (
    jobName === '.' ||
    jobName === '..' ||
    jobName.includes('/') ||
    jobName.includes('\\') ||
    jobName.includes('*') ||
    jobName.includes('?')
  ) {
    throw new Error('Invalid job name in workerRootFor');
  }
  return path.win32.join(WORKER_ROOT, jobName);
}

/**
 * True when `target` is the worker root or anything under it.
 *
 * Compared as Windows paths on every host, so the answer does not change with
 * the platform the Controller happens to run on. A refusal must be a refusal
 * everywhere, not only where the worker exists.
 */
function isWorkerPath(target) {
  if (!target) return false;
  const root = path.win32.normalize(path.win32.resolve(WORKER_ROOT));
  const full = path.win32.normalize(path.win32.resolve(String(target)));
  if (full.toLowerCase() === root.toLowerCase()) return true;
  const rel = path.win32.relative(root, full);
  return rel !== '' && !rel.startsWith('..') && !path.win32.isAbsolute(rel);
}

/** Read the current host isolation attestation and fail closed unless it is CLOSED. */
function readClosedIsolationVerdict(options) {
  const verdictPath = isolationVerdictPath(options);
  if (!fs.existsSync(verdictPath)) throw new Error('CODEX_REQUIRES_ISOLATION');
  let verdictData;
  try {
    const stat = fs.statSync(verdictPath);
    if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      throw new Error('CODEX_REQUIRES_ISOLATION');
    }
    const text = fs.readFileSync(verdictPath, 'utf8');
    verdictData = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new Error('CODEX_REQUIRES_ISOLATION');
  }
  if (verdictData.verdict !== 'CLOSED') throw new Error('CODEX_REQUIRES_ISOLATION');
  return verdictData;
}

function getFolderHash(folder) {
  const files = [];
  function readDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        readDir(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  readDir(folder);
  const fileHashes = [];
  for (const file of files) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(file));
    fileHashes.push(hash.digest('hex'));
  }
  fileHashes.sort();
  const finalHash = crypto.createHash('sha256');
  finalHash.update(fileHashes.join(''), 'utf8');
  return finalHash.digest('hex');
}

// WD-R01 constraint: "Never copy credentials, .env files or tokens into the
// worker area". The shared-deps copy source is node_modules only, and a
// substring rule on package paths pruned real dependency content (whole
// @aws-sdk/credential-provider-* store trees, `.../credentials.js` modules)
// while stamping the cache READY — so the filter matches exact secret
// filenames only, never package paths.
const SECRET_BASENAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  '.pgpass',
  'credentials.json',
  'credentials.xml',
  'credentials.yml',
  'credentials.yaml',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'id_ed25519.pub',
  'id_ecdsa',
  'id_ecdsa.pub',
  'id_dsa',
  'id_dsa.pub',
]);
const SECRET_EXTENSIONS = new Set(['.pem', '.p12', '.pfx', '.jks', '.keystore', '.ppk', '.key']);
const SECRET_TOKEN_FILE =
  /^(?:auth[-_]?|access[-_]?|refresh[-_]?|api[-_]?)?tokens?\.(?:json|txt|ya?ml|ini|cfg|conf|env|properties)$/;

/** True only for names that are unambiguously credential/token material. */
function isSecretFileName(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  if (SECRET_BASENAMES.has(n)) return true;
  if (n.startsWith('.env.')) return true;
  if (SECRET_EXTENSIONS.has(path.extname(n))) return true;
  return SECRET_TOKEN_FILE.test(n);
}

function queryWorkerSid() {
  const sidRes = cp.spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-LocalUser -Name ${WORKER_USERNAME}).SID.Value`],
    { encoding: 'utf8', windowsHide: true }
  );
  return (sidRes.stdout || '').trim();
}

/**
 * Q3: every firewall rule Set-WorkerFirewall.ps1 deterministically creates
 * must still be present (by exact name) with Direction Outbound and Action
 * Block, and the expected protocol. A partially deleted rule set (e.g. only
 * one ShipDe rule left standing) must NOT verify as OK — hence the gate is
 * "$missing.Count -eq 0", never "some rule exists". Block-GitHub-IPs is
 * intentionally absent: its creation depends on live DNS resolution.
 */
const EXPECTED_FIREWALL_RULES = [
  { suffix: 'Block-TCP-IPv4', protocol: 'TCP' },
  { suffix: 'Block-TCP-IPv6-1', protocol: 'TCP' },
  { suffix: 'Block-TCP-IPv6-2', protocol: 'TCP' },
  { suffix: 'Block-TCP-Ports', protocol: 'TCP' },
  { suffix: 'Block-UDP', protocol: 'UDP' },
  { suffix: 'Block-ICMPv4', protocol: 'ICMPv4' },
  { suffix: 'Block-ICMPv6', protocol: 'ICMPv6' },
  { suffix: 'Block-SSH', protocol: 'TCP' },
];

module.exports = {
  WORKER_USERNAME,
  WORKER_ROOT,
  DEFAULT_WORKER_TIMEOUT_MS,
  EXPECTED_FIREWALL_RULES,
  isWorkerConfigKeyAllowed,
  cleanGitEnv,
  isPathInside,
  workerGitPaths,
  gitConfigCheckTimeoutMs,
  validateConfigFile,
  validateWorkerGitConfig,
  resolveInstalledHook,
  controllerGit,
  hookedControllerGit,
  retargetSharedDepsWorkspaceLinks,
  retainedRootHasOwnWriterRecord,
  commitNativeWriterChanges,
  commitWorkerMetadata,
  isolationVerdictPath,
  stageContextPack,
  workerRootFor,
  isWorkerPath,
  readClosedIsolationVerdict,
  getFolderHash,
  isSecretFileName,
  queryWorkerSid,
};
