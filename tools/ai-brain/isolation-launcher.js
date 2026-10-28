'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { executableFor } = require('./harness');
const crypto = require('crypto');
const { parseCsvRecords } = require('./reconcile');

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
  const ms = Number(require('./sources.json').dispatch?.gitConfigCheckTimeoutMs);
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
  if (o.run) {
    return (args) => {
      const result = o.run(args);
      if (!result || result.status !== 0) throw new Error(failure + ': ' + args[0]);
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
    if (!result || result.status !== 0) throw new Error(failure + ': ' + args[0]);
    return String(result.stdout || '').trim();
  };
}

function hookedControllerGit(options) {
  return controllerGit(options, true);
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

function buildBoundaryVerifyScript(sid, username, expectedRules) {
  const safeSid = String(sid || '').replace(/'/g, "''");
  const safeUsername = String(username || '').replace(/'/g, "''");
  const rules = expectedRules || EXPECTED_FIREWALL_RULES;
  const expectedList = rules
    .map((r) => "@{ n = '" + r.suffix + "'; p = '" + r.protocol + "' }")
    .join(', ');
  // P5/Q3: read firewall rules from registry (non-elevated) instead of CIM.
  // Registry values contain LUAuth=SDDL which CIM requires elevation to read.
  // Firewall profiles must be enabled; fail closed if any profile has EnableFirewall=0.
  return (
    "$fwRulesPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules'; " +
    "$profilePath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy'; " +
    "$profiles = @('DomainProfile', 'StandardProfile', 'PublicProfile'); " +
    '$fwOn = $true; ' +
    'foreach ($p in $profiles) { ' +
    '  $val = Get-ItemProperty -Path "$profilePath\\$p" -Name EnableFirewall -ErrorAction SilentlyContinue; ' +
    '  if (-not $val -or $val.EnableFirewall -ne 1) { $fwOn = $false; break; } ' +
    '}; ' +
    "if (-not $fwOn) { 'FW_OFF' } else { " +
    "$prefix = 'ShipDe-Worker-" +
    safeUsername +
    "'; " +
    '$expected = @(' +
    expectedList +
    '); ' +
    '$missing = @(); ' +
    'if (Test-Path $fwRulesPath) { ' +
    '$raw = @(); try { $raw = Get-Item -Path $fwRulesPath -ErrorAction Stop | Get-ItemProperty -ErrorAction Stop } catch {}; ' +
    'foreach ($e in $expected) { ' +
    '$ruleName = $prefix + "-" + $e.n; ' +
    '$found = $false; ' +
    'foreach ($propName in $raw.PSObject.Properties.Name) { ' +
    '$val = [string]$raw.$propName; ' +
    'if ([string]::IsNullOrEmpty($val)) { continue }; ' +
    '$fields = @{}; ' +
    'foreach ($part in ($val -split "\\|")) { ' +
    '  $eq = $part.IndexOf("="); ' +
    '  if ($eq -lt 1) { continue }; ' +
    '  $k = $part.Substring(0, $eq); ' +
    '  if (-not $fields.ContainsKey($k)) { $fields[$k] = $part.Substring($eq + 1) }; ' +
    '}; ' +
    'if ($fields["Name"] -cne $ruleName) { continue }; ' +
    'if ($fields["Active"] -cne "TRUE") { continue }; ' +
    'if ($fields["Dir"] -cne "Out") { continue }; ' +
    'if ($fields["Action"] -cne "Block") { continue }; ' +
    '$wantProto = $null; ' +
    'if ($e.p -eq "TCP") { $wantProto = "6" } ' +
    'elseif ($e.p -eq "UDP") { $wantProto = "17" } ' +
    'elseif ($e.p -eq "ICMPv4") { $wantProto = "1" } ' +
    'elseif ($e.p -eq "ICMPv6") { $wantProto = "58" }; ' +
    'if ($null -eq $wantProto -or $fields["Protocol"] -cne $wantProto) { continue }; ' +
    "$expectedLuAuth = 'D:(A;;CC;;;" +
    safeSid +
    ")'; " +
    'if ($fields["LUAuth"] -cne $expectedLuAuth) { continue }; ' +
    '$found = $true; break; ' +
    '}; ' +
    'if (-not $found) { $missing += $e.n }; ' +
    '}; ' +
    '} else { $missing = $expected.n }; ' +
    '$acl = Get-Acl $env:USERPROFILE; ' +
    '$deny = @($acl.Access | Where-Object { ' +
    '$ace = $_; ' +
    '$sidOk = $false; ' +
    "try { $sidOk = ($ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq '" +
    safeSid +
    "') } catch { $sidOk = $false }; " +
    '$r = 0; try { $r = [int]$ace.FileSystemRights } catch {}; ' +
    '$rightsOk = ((($r -band 2032127) -eq 2032127) -or ((($r -band 1) -ne 0) -and (($r -band 2) -ne 0))); ' +
    '$flagsOk = (([int]$ace.InheritanceFlags -band 3) -eq 3); ' +
    "($sidOk -and ($ace.AccessControlType -eq 'Deny') -and $rightsOk -and $flagsOk) }); " +
    "if ($missing.Count -eq 0 -and $deny.Count -ge 1) { 'OK' } else { 'MISSING:' + ($missing -join ',') }" +
    '}'
  );
}

/**
 * P5: re-verify the OS boundary at launch. The verdict file alone is not
 * evidence — a firewall rule or operator-profile Deny ACE deleted inside the
 * 24h freshness window must still block the launch. Runs on the operator
 * side; injectable via options.verifyBoundary so tests stay deterministic.
 * Q3: verifies the full expected rule set, not "at least one rule".
 */
function defaultVerifyBoundary(sid, username) {
  const res = cp.spawnSync(
    'powershell',
    ['-NoProfile', '-Command', buildBoundaryVerifyScript(sid, username)],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  return (res.stdout || '').trim() === 'OK';
}

/**
 * Builds the host-side PowerShell script that starts the worker process.
 * Pure: it only returns text, so tests can generate and parse the exact script
 * a real launch would write without provisioning a worker or starting a
 * process.
 *
 * Escaping contract: a backtick-escaped `$` is only valid INSIDE the
 * double-quoted here-string that builds run-target.ps1, where it emits a
 * literal `$env:HOME` for the worker. Outside a here-string `` `$false `` is
 * the string "$false", not the boolean $false, and PowerShell then tries to
 * run it as a command — which aborts the host script under
 * `$ErrorActionPreference = "Stop"` before the worker is ever started.
 *
 * Completion contract: run-target.ps1 writes a nonce-bound marker file only
 * AFTER the payload command returned, carrying the payload's own exit code.
 * The host copies that marker into the host-owned launch result, so a result
 * that reports success always carries positive evidence that the job ran to
 * its end. The host waits for the wrapper process AND every process it
 * started, inside workerTimeoutMs, and fails closed on timeout or a missing
 * marker.
 */
function buildWorkerLaunchScript(options) {
  const credPath = options.credPath;
  const workerRoot = options.workerRoot;
  const workerUsername = options.workerUsername || WORKER_USERNAME;
  const exeFile = options.exeFile;
  const exePrefixArgs = Array.isArray(options.exePrefixArgs) ? options.exePrefixArgs : [];
  const exePrefixArgsStr =
    exePrefixArgs.length > 0 ? exePrefixArgs.map((a) => `"${a}"`).join(' ') + ' ' : '';
  const payloadArgsPath = options.payloadArgsPath;
  const launchResultPath = options.launchResultPath;
  const workerTimeoutMs = options.workerTimeoutMs;
  const adapterId = options.adapterId;
  const isCodex = adapterId === 'codex';
  if (isCodex && (!options.isolationVerdict || options.isolationVerdict.verdict !== 'CLOSED')) {
    throw new Error('CODEX_REQUIRES_ISOLATION');
  }
  const completionNonce = options.completionNonce || crypto.randomBytes(16).toString('hex');
  const tokenBudget = options.tokenBudget || null;
  const markerPath = options.markerPath || path.join(workerRoot, 'run-target.complete.json');
  const usageLogPath =
    options.usageLogPath ||
    path.join(workerRoot, '.shipde', 'worker-output-' + completionNonce + '.log');
  // Test-only seam. The generated host script normally impersonates the worker
  // with the DPAPI credential; a regression test executes the SAME generated
  // script end to end as the current user, so this option drops only the
  // credential and impersonation lines. Production never sets it.
  const runAsCurrentUser = Boolean(options.runAsCurrentUser);
  const credentialLines = runAsCurrentUser
    ? ''
    : `$sec = Get-Content "${credPath}" | ConvertTo-SecureString
$cred = New-Object System.Management.Automation.PSCredential("${workerUsername}", $sec)
`;
  const impersonationLines = runAsCurrentUser
    ? ''
    : `$psi.UserName = "${workerUsername}"
$psi.Password = $sec
`;

  const safeWorkerRootForGit = workerRoot.replace(/\\/g, '/');
  const rtkPathPrepend = options.rtkPathPrepend || null;
  const codexLoginProbe = isCodex
    ? `if (-not (Test-Path -LiteralPath "${exeFile}")) {
  @{ nonce = "${completionNonce}"; exitCode = 1; completed = $true; localFailure = "CODEX_NOT_LOGGED_IN"; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
  exit 0
}
& "${exeFile}" ${exePrefixArgsStr}login status *> \`$null
if (-not \`$?) {
  @{ nonce = "${completionNonce}"; exitCode = 1; completed = $true; localFailure = "CODEX_NOT_LOGGED_IN"; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
  exit 0
}
if (\`$LASTEXITCODE -ne 0) {
  @{ nonce = "${completionNonce}"; exitCode = 1; completed = $true; localFailure = "CODEX_NOT_LOGGED_IN"; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
  exit 0
}
`
    : '';

  const envAllowed = [
    'PATH',
    'SystemRoot',
    'SystemDrive',
    'ALLUSERSPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'CommonProgramFiles',
    'CommonProgramFiles(x86)',
    'PUBLIC',
    'PATHEXT',
  ];
  // DS-R04: add only the selected source's credential env to the allowlist
  if (options.adapterId === 'opencode-direct') {
    if (options.credentialEnv) {
      envAllowed.push(options.credentialEnv);
    }
    envAllowed.push('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
  }
  const allowedArray = '@(' + envAllowed.map((k) => `"${k}"`).join(', ') + ')';

  const verdictJson = JSON.stringify(options.isolationVerdict || {});
  const verdictBase64 = Buffer.from(verdictJson, 'utf8').toString('base64');

  return `
$ErrorActionPreference = "Stop"
${credentialLines}$nestedScript = "${workerRoot}\\run-target.ps1"
$verdictBytes = [Convert]::FromBase64String("${verdictBase64}")
$env:SHIPDE_ISOLATION_VERDICT = [Text.Encoding]::UTF8.GetString($verdictBytes)
$markerPath = "${markerPath}"
$completionNonce = "${completionNonce}"
$usageLogPath = '${String(usageLogPath).replace(/'/g, "''")}'
$env:HOME = "${workerRoot}"
$env:USERPROFILE = "${workerRoot}"
$wrapperPid = 0
$wrapperStartTime = Get-Date
@"
\`$ErrorActionPreference = "Stop"
\`$env:HOME = "${workerRoot}"
\`$env:USERPROFILE = "${workerRoot}"
\`$env:GH_CONFIG_DIR = "${workerRoot}\\.config\\gh"
\`$env:GIT_CONFIG_GLOBAL = "NUL"
\`$env:GIT_CONFIG_COUNT = "1"
\`$env:GIT_CONFIG_KEY_0 = "safe.directory"
\`$env:GIT_CONFIG_VALUE_0 = "${safeWorkerRootForGit}"
\`$env:TEMP = "${workerRoot}\\temp"
\`$env:TMP = "${workerRoot}\\temp"
if (-not \`$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX) { \`$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "4096" }
if (-not (Test-Path "${workerRoot}\\temp")) { New-Item -ItemType Directory -Path "${workerRoot}\\temp" | Out-Null }
if (-not (Test-Path "${workerRoot}\\.shipde")) { New-Item -ItemType Directory -Path "${workerRoot}\\.shipde" | Out-Null }
Set-Location -Path "${workerRoot}"
\`$env:SHIPDE_RUN_TARGET_PID = "\`$PID"
${codexLoginProbe}
\`$usageLogDir = [System.IO.Path]::GetDirectoryName("${usageLogPath.replace(/\\/g, '\\\\')}")
if (-not (Test-Path \`$usageLogDir)) { New-Item -ItemType Directory -Path \`$usageLogDir | Out-Null }
\`$payloadArgs = @(Get-Content -LiteralPath "${payloadArgsPath}" -Raw | ConvertFrom-Json)
& "${exeFile}" @payloadArgs | Tee-Object -FilePath "${usageLogPath.replace(/\\/g, '\\\\')}"
\`$jobExit = \`$LASTEXITCODE
if (\`$null -eq \`$jobExit) { exit 1 }
@{ nonce = "${completionNonce}"; exitCode = [int]\`$jobExit; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
exit \`$jobExit
"@ | Out-File $nestedScript -Encoding UTF8

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \`"$nestedScript\`""
${impersonationLines}$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = "${workerRoot}"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

# Clear environment to avoid leaking operator tokens (F4)
$psi.EnvironmentVariables.Clear()
# PATHEXT is not a secret and must survive the scrub: without it PowerShell's
# call operator falls off the CreateProcess path for an absolute .exe, returns
# before the job ran and leaves the payload orphaned — a green result for a
# job that never finished.
$allowed = ${allowedArray}
foreach ($key in $allowed) {
    if ([Environment]::GetEnvironmentVariable($key)) {
        $psi.EnvironmentVariables[$key] = [Environment]::GetEnvironmentVariable($key)
    }
}
${rtkPathPrepend ? `$psi.EnvironmentVariables["PATH"] = "${rtkPathPrepend.replace(/\\/g, '\\\\')}" + ";" + $psi.EnvironmentVariables["PATH"]` : ''}

$process = [System.Diagnostics.Process]::Start($psi)
$wrapperPid = $process.Id
$wrapperStartTime = $process.StartTime
$usageFile = '${String(options.usageFile || '').replace(/'/g, "''")}'
$usageLogPath = '${String(usageLogPath).replace(/'/g, "''")}'
$usageModel = '${String(options.model || '').replace(/'/g, "''")}'
$usageProvider = '${String(options.upstream || '').replace(/'/g, "''")}'
$script:lastLiveUsageJson = ""
function Write-LiveUsage {
    if ([string]::IsNullOrWhiteSpace($usageFile)) { return }
    try {
        if (-not (Test-Path -LiteralPath $usageLogPath)) { return }
        $events = @(Get-Content -LiteralPath $usageLogPath -Tail 100 -ErrorAction Stop)
        $report = $null
        foreach ($line in $events) {
            try {
                $event = $line | ConvertFrom-Json
                $tokens = $event.tokens
                if ($null -eq $tokens -and $null -ne $event.part) { $tokens = $event.part.tokens }
                if ($null -eq $tokens) { continue }
                $inputTokens = [double]$tokens.input
                $outputTokens = [double]$tokens.output
                $totalTokens = [double]$tokens.total
                $cacheReadTokens = 0
                if ($null -ne $tokens.cache -and $null -ne $tokens.cache.read) {
                    $cacheReadTokens = [double]$tokens.cache.read
                } elseif ($null -ne $tokens.cache -and $null -ne $tokens.cache.read_tokens) {
                    $cacheReadTokens = [double]$tokens.cache.read_tokens
                } elseif ($null -ne $tokens.cacheRead) {
                    $cacheReadTokens = [double]$tokens.cacheRead
                } elseif ($null -ne $tokens.cache_read) {
                    $cacheReadTokens = [double]$tokens.cache_read
                } elseif ($null -ne $tokens.cache_read_tokens) {
                    $cacheReadTokens = [double]$tokens.cache_read_tokens
                }
                $accounted = $inputTokens + $cacheReadTokens + $outputTokens
                $effectiveTotal = [math]::Max($totalTokens, $accounted)
                $report = @{
                    session_id = $(if ($event.sessionID) { $event.sessionID } elseif ($event.sessionId) { $event.sessionId } else { $null })
                    model = $usageModel
                    provider = $usageProvider
                    usage = @{
                        input = $inputTokens
                        cacheRead = $cacheReadTokens
                        cache_read = $cacheReadTokens
                        cache_read_tokens = $cacheReadTokens
                        output = $outputTokens
                        total = $effectiveTotal
                    }
                } | ConvertTo-Json -Depth 5 -Compress
            } catch {}
        }
        if ($null -eq $report) { return }
        if ($script:lastLiveUsageJson -eq $report) { return }
        $script:lastLiveUsageJson = $report
        $temporary = $usageFile + '.live-' + $PID
        [System.IO.File]::WriteAllText($temporary, $report, [System.Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $usageFile -Force
    } catch {}
}
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$timeoutMs = ${workerTimeoutMs}
$tokenBudgetJson = '${JSON.stringify(tokenBudget || {}).replace(/'/g, "''")}'
$maxTokens = 0
$progressTimeoutMs = ${Number(options.progressTimeoutMs) > 0 ? Number(options.progressTimeoutMs) : 0}
$lastProgressAt = [System.Diagnostics.Stopwatch]::GetTimestamp()
$lastTotalTokens = $null
$lastCumulativeTokens = 0
$lastToolCalls = 0
$lastOutputSignature = ""
try {
    $initFiles = @(Get-ChildItem -LiteralPath $workerRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|\.shipde)[\\/]' } | Sort-Object FullName)
    if ($initFiles.Count -gt 0) { $lastOutputSignature = ($initFiles | ForEach-Object { $_.FullName + ':' + $_.Length + ':' + $_.LastWriteTimeUtc.Ticks }) -join '|' }
} catch {}
$requestTooLarge = $false
$requestTooLargeDetail = ""
try {
    $budgetConfig = $tokenBudgetJson | ConvertFrom-Json
    if ($null -ne $budgetConfig.maxTokens) { $maxTokens = [double]$budgetConfig.maxTokens }
} catch {}
$budgetExceeded = $false

function Stop-WorkerTree {
    $stragglers = @(Get-DescendantProcessIds -AncestorPid $wrapperPid -NotBefore $wrapperStartTime.AddSeconds(-2))
    foreach ($stragglerId in $stragglers) { Stop-Process -Id $stragglerId -Force -ErrorAction SilentlyContinue }
    if (-not $process.HasExited) { try { $process.Kill() } catch {} }
    try { & cmd.exe /c "taskkill /PID $wrapperPid /T /F >nul 2>&1" } catch {}
    [void]$process.WaitForExit(10000)
}

# Every process the wrapper started, walked up the parent chain. A process
# that predates the launch is never a descendant even if a recycled pid makes
# it look like one.
function Get-DescendantProcessIds {
    param([int]$AncestorPid, [datetime]$NotBefore)
    $rows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate -ErrorAction SilentlyContinue)
    $children = @{}
    $created = @{}
    foreach ($row in $rows) {
        $rowPid = [int]$row.ProcessId
        $created[$rowPid] = $row.CreationDate
        $rowParent = [int]$row.ParentProcessId
        if (-not $children.ContainsKey($rowParent)) { $children[$rowParent] = @() }
        $children[$rowParent] += $rowPid
    }
    $found = @()
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($AncestorPid)
    $seen = @{}
    $seen[$AncestorPid] = $true
    while ($queue.Count -gt 0) {
        $currentPid = $queue.Dequeue()
        if (-not $children.ContainsKey($currentPid)) { continue }
        foreach ($childPid in $children[$currentPid]) {
            if ($seen.ContainsKey($childPid)) { continue }
            $seen[$childPid] = $true
            $queue.Enqueue($childPid)
            if ($created.ContainsKey($childPid) -and $null -ne $created[$childPid] -and $created[$childPid] -ge $NotBefore) { $found += $childPid }
        }
    }
    return $found
}

function Read-UsageTotal {
    if ([string]::IsNullOrWhiteSpace($usageFile) -or -not (Test-Path -LiteralPath $usageFile)) { return $null }
    try {
        $report = Get-Content -LiteralPath $usageFile -Raw | ConvertFrom-Json
        $usage = $report.usage
        if ($null -eq $usage) { return $null }
        $reportedTotal = $null
        if ($null -ne $usage.total_tokens) { $reportedTotal = [double]$usage.total_tokens }
        elseif ($null -ne $usage.total) { $reportedTotal = [double]$usage.total }
        if ($null -ne $usage.input_tokens -or $null -ne $usage.cache_read_tokens -or $null -ne $usage.output_tokens) {
            $accounted = [double]$usage.input_tokens + [double]$usage.cache_read_tokens + [double]$usage.output_tokens
            if ($null -ne $reportedTotal) { return [math]::Max($reportedTotal, $accounted) }
            return $accounted
        }
        if ($null -ne $usage.input -or $null -ne $usage.cacheRead -or $null -ne $usage.cache_read -or $null -ne $usage.output) {
            $cacheRead = $usage.cacheRead
            if ($null -eq $cacheRead) { $cacheRead = $usage.cache_read }
            $accounted = [double]$usage.input + [double]$cacheRead + [double]$usage.output
            if ($null -ne $reportedTotal) { return [math]::Max($reportedTotal, $accounted) }
            return $accounted
        }
        if ($null -ne $reportedTotal) { return $reportedTotal }
    } catch {}
    return $null
}

function Update-SessionProgress {
    if ($script:requestTooLarge) { return }
    $script:sessionToolCalls = 0
    $script:sessionCumTokens = 0
    $script:sessionMonotonic = $true
    if ([string]::IsNullOrWhiteSpace($usageLogPath) -or -not (Test-Path -LiteralPath $usageLogPath)) { return }
    try {
        $lines = @()
        $readOk = $false
        try {
            $fs = [System.IO.File]::Open($usageLogPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
                try {
                    $rawContent = $sr.ReadToEnd()
                    if (-not [string]::IsNullOrEmpty($rawContent)) {
                        $lines = @($rawContent -split '\r?\n')
                    }
                    $readOk = $true
                } finally {
                    $sr.Dispose()
                }
            } finally {
                $fs.Dispose()
            }
        } catch {}
        if (-not $readOk) {
            $lines = @(Get-Content -LiteralPath $usageLogPath -ErrorAction SilentlyContinue)
        }
        if ($lines.Count -eq 0) { return }
        $toolCount = 0
        $sumTokens = 0
        $prevStepTokens = $null
        $hasFluctuated = $false
        $found413 = $false
        $detail413 = ""
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            $is413 = $false
            $matchText = ""
            if ($trimmed.StartsWith('{') -and $trimmed.EndsWith('}')) {
                try {
                    $ev = $trimmed | ConvertFrom-Json
                    if ($null -ne $ev) {
                        if ($ev.type -eq "tool_use" -or ($null -ne $ev.part -and $ev.part.type -eq "tool") -or
                            ($ev.type -eq "item.completed" -and $null -ne $ev.item -and
                             $ev.item.type -eq "command_execution" -and $ev.item.status -eq "completed" -and
                             $null -ne $ev.item.exit_code -and $ev.item.exit_code -eq 0)) {
                            $toolCount++
                        }
                        $err = $null
                        if ($ev.type -eq "error" -and $null -ne $ev.error) { $err = $ev.error }
                        elseif ($null -ne $ev.error) { $err = $ev.error }
                        if ($null -ne $err) {
                            $code = $null
                            if ($null -ne $err.data -and $null -ne $err.data.statusCode) { $code = [int]$err.data.statusCode }
                            elseif ($null -ne $err.statusCode) { $code = [int]$err.statusCode }
                            elseif ($null -ne $err.status) { $code = [int]$err.status }

                            $msg = ""
                            if ($null -ne $err.data -and $null -ne $err.data.message) { $msg = [string]$err.data.message }
                            elseif ($null -ne $err.message) { $msg = [string]$err.message }
                            if ($null -ne $err.data -and $null -ne $err.data.responseBody) {
                                $msg = $msg + " " + [string]$err.data.responseBody
                            }
                            if ($code -eq 413 -or $msg -match '(?i)\b413\b|request.*too.*large|payload.*too.*large|entity.*too.*large|too.*large.*request|tokens?.*per.*minute|\bTPM\b.*limit|limit.*on.*TPM') {
                                $is413 = $true
                                $matchText = if ($msg) { $msg } else { "HTTP status 413" }
                            }
                        }
                        if (-not $is413 -and $ev.type -ne "error" -and $null -eq $ev.error) {
                            $t = $ev.tokens
                            if ($null -eq $t -and $null -ne $ev.part) { $t = $ev.part.tokens }
                            if ($null -ne $t) {
                                $in = [double]$t.input
                                $out = [double]$t.output
                                $tot = [double]$t.total
                                $cr = 0
                                if ($null -ne $t.cache -and $null -ne $t.cache.read) { $cr = [double]$t.cache.read }
                                elseif ($null -ne $t.cache -and $null -ne $t.cache.read_tokens) { $cr = [double]$t.cache.read_tokens }
                                elseif ($null -ne $t.cacheRead) { $cr = [double]$t.cacheRead }
                                elseif ($null -ne $t.cache_read) { $cr = [double]$t.cache_read }
                                elseif ($null -ne $t.cache_read_tokens) { $cr = [double]$t.cache_read_tokens }
                                $stepEffective = [math]::Max($tot, $in + $cr + $out)
                                if ($null -ne $prevStepTokens -and $stepEffective -lt $prevStepTokens) {
                                    $hasFluctuated = $true
                                }
                                $prevStepTokens = $stepEffective
                                $sumTokens += $stepEffective
                            }
                        }
                    }
                } catch {}
            }
            if (-not $is413) {
                if ($trimmed -match '(?i)\b413\b.*(?:request|payload|entity|too\s+large|tpm)|(?:request|payload|entity)\s+(?:is\s+)?too\s+large|\b413\s+Request|\b413\s+Payload|rate\s+limit.*tokens?\s+per\s+minute|\bTPM\b.*limit|limit.*on.*TPM') {
                    $is413 = $true
                    $matchText = $trimmed
                }
            }
            if ($is413) {
                $found413 = $true
                $detail413 = $matchText
            }
        }
        if ($found413) {
            $script:requestTooLarge = $true
            $script:requestTooLargeDetail = if ($detail413.Length -gt 250) { $detail413.Substring(0, 250) } else { $detail413 }
        }
        $script:sessionToolCalls = $toolCount
        $script:sessionCumTokens = $sumTokens
        $script:sessionMonotonic = (-not $hasFluctuated)
    } catch {}
}

# The wrapper is waited on with the bounded wait, then every process it
# started is polled until none remain, all inside the same budget. Waiting for
# the wrapper alone is not enough: a job the wrapper no longer waits for would
# otherwise be reported as finished while it is still running.
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$timedOut = $false
$stalled = $false
$progressDetail = ""
$waitSlice = 250
while ($true) {
    Write-LiveUsage
    $totalTokens = Read-UsageTotal
    if ($null -ne $totalTokens -and $maxTokens -gt 0 -and $totalTokens -gt $maxTokens) {
        $budgetExceeded = $true
        Stop-WorkerTree
        break
    }
    Update-SessionProgress
    if ($script:requestTooLarge) {
        Stop-WorkerTree
        break
    }
    if ($progressTimeoutMs -gt 0) {
        $outputSignature = ""
        try {
            $outputFiles = @(Get-ChildItem -LiteralPath $workerRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|\.shipde)[\\/]' } | Sort-Object FullName)
            if ($outputFiles.Count -gt 0) { $outputSignature = ($outputFiles | ForEach-Object { $_.FullName + ':' + $_.Length + ':' + $_.LastWriteTimeUtc.Ticks }) -join '|' }
        } catch {}
        $madeProgress = $false
        if ($outputSignature -ne $lastOutputSignature) {
            $lastOutputSignature = $outputSignature
            $madeProgress = $true
        }
        if ($script:sessionToolCalls -gt $lastToolCalls) {
            $lastToolCalls = $script:sessionToolCalls
            $madeProgress = $true
        }
        if ($script:sessionMonotonic -and $script:sessionCumTokens -gt $lastCumulativeTokens) {
            $lastCumulativeTokens = $script:sessionCumTokens
            $madeProgress = $true
        }
        if ($madeProgress) {
            $lastProgressAt = [System.Diagnostics.Stopwatch]::GetTimestamp()
        } elseif (([System.Diagnostics.Stopwatch]::GetTimestamp() - $lastProgressAt) * 1000 / [System.Diagnostics.Stopwatch]::Frequency -ge $progressTimeoutMs) {
            $stalled = $true
            $fileCount = $outputFiles.Count
            $usageState = if ($null -eq $totalTokens) { "unavailable" } else { [string]$totalTokens }
            $progressDetail = "stall detector observed no worker file signature change ($fileCount tracked files), no verified tool progress ($lastToolCalls tool calls), and no monotonic token usage increase (usage=$usageState) for $progressTimeoutMs ms"
            Stop-WorkerTree
            break
        }
    }
    $remaining = $timeoutMs - $stopwatch.ElapsedMilliseconds
    if ($remaining -le 0) { $timedOut = $true; break }
    if ($process.HasExited) { break }
    [void]$process.WaitForExit([math]::Min($waitSlice, $remaining))
}
$quietPolls = 0
if (-not $timedOut -and -not $stalled -and -not $budgetExceeded -and -not $requestTooLarge) {
    while ($true) {
        Write-LiveUsage
        $remaining = $timeoutMs - $stopwatch.ElapsedMilliseconds
        if ($remaining -le 0) { $timedOut = $true; break }
        $pidRecycled = $false
        try {
            $holder = Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue
            if ($null -ne $holder -and [math]::Abs(($holder.StartTime - $wrapperStartTime).TotalSeconds) -gt 5) {
                $pidRecycled = $true
            }
        } catch {
            # The pid cannot be attributed to this launch any more, so nothing
            # found under it can be trusted as this launch's descendant.
            $pidRecycled = $true
        }
        if ($pidRecycled) {
            $quietPolls = $quietPolls + 1
        } else {
            $leftovers = @(Get-DescendantProcessIds -AncestorPid $wrapperPid -NotBefore $wrapperStartTime.AddSeconds(-2))
            if ($leftovers.Count -eq 0) { $quietPolls = $quietPolls + 1 } else { $quietPolls = 0 }
        }
        $totalTokens = Read-UsageTotal
        if ($null -ne $totalTokens -and $maxTokens -gt 0 -and $totalTokens -gt $maxTokens) {
            $budgetExceeded = $true
            Stop-WorkerTree
            break
        }
        Update-SessionProgress
        if ($script:requestTooLarge) {
            Stop-WorkerTree
            break
        }
        if ($quietPolls -ge 3) { break }
        Start-Sleep -Milliseconds 250
    }
}

if ($timedOut) {
    Stop-WorkerTree
}
if ($stalled) { Stop-WorkerTree }
if ($script:requestTooLarge) { Stop-WorkerTree }
# A writer the operator cannot kill (another user's process) must not hang the
# host forever: the pipes are read with a bound, and a pipe that never closed
# is itself reported as a failure.
$stdout = ""
$stderr = ""
if ($stdoutTask.Wait(15000)) { $stdout = $stdoutTask.Result }
if ($stderrTask.Wait(15000)) { $stderr = $stderrTask.Result } else { $stderr = "[ISOLATION_LAUNCHER] worker output pipes never closed" }

if (-not $script:requestTooLarge) {
    Update-SessionProgress
    if (-not $script:requestTooLarge) {
        $combined = $stdout + [Environment]::NewLine + $stderr
        if ($combined -match '(?i)\b413\b.*(?:request|payload|entity|too\s+large|tpm)|(?:request|payload|entity)\s+(?:is\s+)?too\s+large|\b413\s+Request|\b413\s+Payload|rate\s+limit.*tokens?\s+per\s+minute|\bTPM\b.*limit|limit.*on.*TPM') {
            $script:requestTooLarge = $true
            $script:requestTooLargeDetail = "worker output indicated 413 / request too large / TPM limit"
        }
    }
}

# Positive evidence: the marker is written by run-target.ps1 after the payload
# returned, so it can only exist for a job that really ran to its end.
$completed = $false
$markerNonce = ""
$jobExit = -1
$failureReason = ""
$localFailure = ""
if ($budgetExceeded) {
    $failureReason = "TOKEN_BUDGET_EXCEEDED: live worker usage exceeded configured token budget"
} elseif ($timedOut) {
    $failureReason = "[ISOLATION_LAUNCHER] worker timed out after $timeoutMs ms and was killed"
} elseif ($script:requestTooLarge) {
    $failureReason = "REQUEST_TOO_LARGE: $script:requestTooLargeDetail; worker was killed"
} elseif ($stalled) {
    $failureReason = "STALLED_NO_PROGRESS: $progressDetail; worker was killed"
} elseif (Test-Path -LiteralPath $markerPath) {
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.nonce -ceq $completionNonce -and $null -ne $marker.exitCode) {
            $completed = $true
            $markerNonce = [string]$marker.nonce
            $jobExit = [int]$marker.exitCode
            if ($null -ne $marker.localFailure) { $localFailure = [string]$marker.localFailure }
        } else {
            $failureReason = "[ISOLATION_LAUNCHER] completion marker does not belong to this launch"
        }
    } catch {
        $failureReason = "[ISOLATION_LAUNCHER] completion marker unreadable: " + $_.Exception.Message
    }
} else {
    $failureReason = "[ISOLATION_LAUNCHER] the worker job never wrote its completion marker"
}
$exitValue = -1
if ($completed -and -not $timedOut -and -not $budgetExceeded -and -not $script:requestTooLarge) { $exitValue = $jobExit }
if ($failureReason.Length -gt 0) { $stderr = $stderr + [Environment]::NewLine + $failureReason }

Update-SessionProgress
$output = @{
    verifiedToolCalls = $script:sessionToolCalls
    exitCode = $exitValue
    stdout = $stdout
    stderr = $stderr
    timedOut = $timedOut
    budgetExceeded = $budgetExceeded
    requestTooLarge = $script:requestTooLarge
    completed = $completed
    completionNonce = $markerNonce
    failureReason = $failureReason
    progressDetail = $progressDetail
    localFailure = $localFailure
}
$output | ConvertTo-Json -Depth 10 | Out-File "${launchResultPath}" -Encoding UTF8
`;
}

const CARRY_IDENTITY = [
  '-c',
  'user.name=Ship De Carry-over',
  '-c',
  'user.email=carry-over@shipde.invalid',
];

function carryRef(branch) {
  return 'refs/shipde/carry/' + branch;
}

function carryGit(cwd, args, extraSafe) {
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const safe = path.resolve(cwd).split(path.sep).join('/');
  return cp.spawnSync(
    'git',
    [
      '-c',
      'core.hooksPath=' + nul,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.attributesFile=' + nul,
      '-c',
      'diff.external=',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'safe.directory=' + safe,
      '-c',
      'safe.directory=' +
        path
          .resolve(extraSafe || cwd)
          .split(path.sep)
          .join('/'),
    ].concat(args),
    {
      cwd,
      windowsHide: true,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: nul,
        GIT_CONFIG_SYSTEM: nul,
        GIT_TERMINAL_PROMPT: '0',
      }),
    }
  );
}

/**
 * Before a worker root is deleted, keep a previous writer's work: commit any
 * uncommitted change on the target branch as a WIP commit and fetch the branch
 * into a private ref of the host repo. Fail closed: never throws.
 */
function carryOverSave(hostCwd, oldRoot, branch, headSha) {
  try {
    if (!branch || !fs.existsSync(path.join(oldRoot, '.git'))) return false;
    const cur = carryGit(oldRoot, ['symbolic-ref', '--short', 'HEAD']);
    if (cur.status !== 0 || cur.stdout.trim() !== branch) return false;
    const status = carryGit(oldRoot, [
      'status',
      '--porcelain',
      '--',
      '.',
      ':!.shipde',
      ':!run-target.ps1',
      ':!run-target.complete.json',
      ':!temp',
      ':!.config',
      ':!.local',
      ':!Microsoft',
    ]);
    if (status.status === 0 && status.stdout.trim()) {
      carryGit(oldRoot, [
        'add',
        '-A',
        '--',
        '.',
        ':!.shipde',
        ':!run-target.ps1',
        ':!run-target.complete.json',
        ':!temp',
        ':!.config',
        ':!.local',
        ':!Microsoft',
      ]);
      carryGit(
        oldRoot,
        CARRY_IDENTITY.concat([
          'commit',
          '--no-verify',
          '--no-gpg-sign',
          '-m',
          'WIP: carried over from an interrupted writer attempt',
        ])
      );
    }
    const ref = carryRef(branch);
    const fetched = carryGit(
      hostCwd,
      ['fetch', '--no-tags', oldRoot, '+refs/heads/' + branch + ':' + ref],
      oldRoot
    );
    if (fetched.status !== 0) return false;
    const anc = carryGit(hostCwd, ['merge-base', '--is-ancestor', ref, headSha]);
    if (anc.status === 0) {
      carryGit(hostCwd, ['update-ref', '-d', ref]);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * After the fresh checkout of branch at headSha: merge the carried work if any.
 * Returns 'merged' | 'conflict' | 'none'. Fail closed to the plain checkout.
 */
function carryOverRestore(hostCwd, newRoot, branch, eolConfig) {
  try {
    if (!branch) return 'none';
    const ref = carryRef(branch);
    if (carryGit(hostCwd, ['rev-parse', '--verify', '--quiet', ref]).status !== 0) return 'none';
    const local = 'refs/shipde/carry/incoming';
    const f = carryGit(newRoot, ['fetch', '--no-tags', hostCwd, '+' + ref + ':' + local], hostCwd);
    if (f.status !== 0) return 'none';
    validateWorkerGitConfig(newRoot, 'WORKER_COMMIT_FAILED');
    // Same line-ending config as the checkout, or every file looks modified.
    const eol = [];
    if (eolConfig && eolConfig.autocrlf !== null && eolConfig.autocrlf !== undefined)
      eol.push('-c', 'core.autocrlf=' + eolConfig.autocrlf);
    if (eolConfig && eolConfig.eol !== null && eolConfig.eol !== undefined)
      eol.push('-c', 'core.eol=' + eolConfig.eol);
    if (process.platform === 'win32') eol.push('-c', 'core.filemode=false');
    const commit = hookedControllerGit({
      hostRoot: hostCwd,
      workerRoot: newRoot,
      failure: 'WORKER_COMMIT_FAILED',
      gitConfig: [...CARRY_IDENTITY, ...eol],
    });
    const m = carryGit(
      newRoot,
      CARRY_IDENTITY.concat(eol, ['merge', '--no-commit', '--no-ff', local])
    );
    if (m.status === 0) {
      if (carryGit(newRoot, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).status === 0) {
        try {
          commit(['commit', '-m', 'Restore interrupted writer work']);
        } catch (error) {
          carryGit(newRoot, ['merge', '--abort']);
          throw error;
        }
      }
      carryGit(hostCwd, ['update-ref', '-d', ref]);
      carryGit(newRoot, ['update-ref', '-d', local]);
      return 'merged';
    }
    carryGit(newRoot, ['merge', '--abort']);
    carryGit(newRoot, ['reset', '--hard', 'ORIG_HEAD']);
    carryGit(newRoot, ['update-ref', '-d', local]);
    return 'conflict';
  } catch (error) {
    if (String(error.message).startsWith('WORKER_COMMIT_FAILED:')) throw error;
    return 'none';
  }
}

function appendGitInfoExclude(workerRoot, entries) {
  const excludePath = path.join(workerRoot, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const prefix = existing.length > 0 && !/\r?\n$/.test(existing) ? '\n' : '';
  fs.appendFileSync(excludePath, prefix + missing.join('\n') + '\n', 'utf8');
}

/**
 * Provisioning ends on the requested base. When carry-over merged the previous
 * attempt's work, HEAD is that merge commit and its first parent must be the
 * base; otherwise HEAD must be the base itself. Live 17/10: every retry of
 * GOAL-G-F622511E-1 failed PROVISION_BASE_MISMATCH because the carry-over
 * merge commit was compared with the base directly.
 */
function provisionedHeadMatchesBase(workerRoot, provisionedHeadSha, baseSha, carriedOver, run) {
  if (!provisionedHeadSha || !baseSha) return false;
  const head = provisionedHeadSha.toLowerCase();
  const base = baseSha.toLowerCase();
  if (head === base) return true;
  if (carriedOver !== 'merged') return false;
  const git = run || cp.spawnSync;
  const res = git('git', ['rev-parse', '--verify', '--quiet', head + '^1'], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  return Boolean(res && res.status === 0 && String(res.stdout).trim().toLowerCase() === base);
}

function ensureGoalRegistrationInWorker(hostCwd, workerRoot, workItemId) {
  if (!workItemId || typeof workItemId !== 'string') return;
  const isGoal = workItemId.toUpperCase().startsWith('GOAL-');
  if (!isGoal) return;

  const regRel = path.join(
    'docs',
    'product-spec',
    'docs',
    '10-ai-collaboration',
    'FEATURE-DELIVERY-REGISTER.csv'
  );
  const specRel = path.join('docs', 'product-spec', 'work-items', `${workItemId}.md`);

  const hostSpec = path.join(hostCwd, specRel);
  const workerSpec = path.join(workerRoot, specRel);
  if (!fs.existsSync(workerSpec) && fs.existsSync(hostSpec)) {
    fs.mkdirSync(path.dirname(workerSpec), { recursive: true });
    fs.copyFileSync(hostSpec, workerSpec);
  }

  const hostReg = path.join(hostCwd, regRel);
  const workerReg = path.join(workerRoot, regRel);
  if (fs.existsSync(hostReg) && fs.existsSync(workerReg)) {
    const workerContent = fs.readFileSync(workerReg, 'utf8');
    const workerRecords = parseCsvRecords(workerContent);
    const workerIdColumn = workerRecords[0]?.fields.indexOf('work_item_id') ?? -1;
    if (workerIdColumn < 0) return;
    if (!workerRecords.slice(1).some((record) => record.fields[workerIdColumn] === workItemId)) {
      const hostContent = fs.readFileSync(hostReg, 'utf8');
      const hostRecords = parseCsvRecords(hostContent);
      const hostIdColumn = hostRecords[0]?.fields.indexOf('work_item_id') ?? -1;
      if (hostIdColumn < 0) return;
      const matchingRecord = hostRecords
        .slice(1)
        .find((record) => record.fields[hostIdColumn] === workItemId);
      if (matchingRecord) {
        const matchingLine = matchingRecord.raw.replace(/(?:\r\n|\n|\r)$/, '');
        const eol =
          /\r\n|\n|\r/.exec(workerContent)?.[0] || /\r\n|\n|\r/.exec(hostContent)?.[0] || '\n';
        const updated = workerContent.endsWith('\n')
          ? workerContent + matchingLine + eol
          : workerContent + eol + matchingLine + eol;
        fs.writeFileSync(workerReg, updated, 'utf8');
      }
    }
  }
}

const EXERCISE_CASES = path.join(__dirname, 'exercise', 'e1-branch-name.cases.json');
const EXERCISE_RUNNER = path.join('tools', 'ai-brain', 'test', 'e1-branch-name.test.js');
const THROWS = 'THROWS:';

function exerciseCasesPath(exerciseName) {
  const name = String(exerciseName || 'e1-branch-name').trim();
  if (name === 'e1' || name === 'e1-branch-name' || name === 'true' || !name) {
    return EXERCISE_CASES;
  }
  const candidate = path.join(__dirname, 'exercise', `${name}.cases.json`);
  if (fs.existsSync(candidate)) return candidate;
  return EXERCISE_CASES;
}

/**
 * Captures fail-before host-side in workerRoot at the pinned base SHA.
 *
 * Runs the exercise runner command (node --test tools/ai-brain/test/e1-branch-name.test.js)
 * in workerRoot before the agent begins work. Because tools/ai-brain/branch-name.js
 * does not exist at the base SHA, the command exits non-zero (missing module error).
 * This real captured execution transcript provides honest fail-before evidence.
 */
function captureFailBefore(workerRoot, options) {
  const o = options || {};
  const spawn = o.spawnSync || cp.spawnSync;
  const runnerRel = path.join('tools', 'ai-brain', 'test', 'e1-branch-name.test.js');
  const runnerPosix = runnerRel.replace(/\\/g, '/');
  const runnerFull = path.join(workerRoot, runnerRel);
  if (!fs.existsSync(runnerFull)) {
    throw new Error('FAIL_BEFORE_RUNNER_MISSING: ' + runnerFull);
  }

  const baseSha = o.baseSha ? String(o.baseSha).trim() : null;
  if (baseSha) {
    const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
    const ancestryCheck = spawn(
      'git',
      [
        '-c',
        'safe.directory=' + normWorkerRoot,
        '-c',
        'core.hooksPath=' + nulDevice,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.attributesFile=' + nulDevice,
        'merge-base',
        '--is-ancestor',
        baseSha,
        'HEAD',
      ],
      {
        cwd: workerRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      }
    );
    if (!ancestryCheck || ancestryCheck.status !== 0) {
      const err = new Error(
        'FAIL_BEFORE_ANCESTRY_MISMATCH: base SHA ' +
          baseSha +
          ' is not an ancestor of worker root HEAD'
      );
      err.code = 'FAIL_BEFORE_ANCESTRY_MISMATCH';
      throw err;
    }
  }

  const command =
    (o.verification && o.verification.command) || o.exerciseCommand || `node --test ${runnerPosix}`;

  const childEnv = Object.assign({}, process.env, o.env || {});
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;

  let res;
  if (!o.verification && !o.exerciseCommand) {
    const execPath = o.nodePath || process.execPath;
    res = spawn(execPath, ['--test', runnerPosix], {
      cwd: workerRoot,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
      timeout: o.timeoutMs || 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } else {
    res = spawn(command, {
      cwd: workerRoot,
      env: childEnv,
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
      timeout: o.timeoutMs || 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  const stdout = String((res && res.stdout) || '');
  const stderr = String((res && res.stderr) || '');
  const exitCode = res ? (res.status !== null && res.status !== undefined ? res.status : -1) : -1;
  const output = (stdout + (stderr ? (stdout ? '\n' : '') + stderr : '')).slice(-2000);

  return {
    command,
    exitCode,
    stdout,
    stderr,
    output,
    capturedAt: new Date().toISOString(),
    pass: exitCode === 0,
    ancestry: true,
  };
}

/**
 * Materialises the exercise's runner INSIDE the worker root, from the committed
 * case data, AFTER the worker root has been provisioned.
 *
 * Keeps the runner untracked by adding it to .git/info/exclude in the worker clone,
 * and captures fail-before at the base SHA in the provisioned tree.
 */
function materialiseExercise(workerRoot, options) {
  const o = options || {};
  if (!workerRoot) {
    throw new Error(
      'EXERCISE_ROOT_MISSING: the exercise runner may only be written into a worker root'
    );
  }
  const root = path.resolve(workerRoot);
  const checkWorker = (o && o.isWorkerPath) || isWorkerPath;
  if (!checkWorker(root)) {
    throw new Error('EXERCISE_ROOT_INVALID: refusing to write the runner outside the worker root');
  }
  const target = path.join(root, EXERCISE_RUNNER);
  if (path.relative(root, target).startsWith('..') || !path.isAbsolute(target)) {
    throw new Error('EXERCISE_ROOT_INVALID: refusing to write the runner outside the worker root');
  }
  const casesFile = exerciseCasesPath(o.exercise);
  if (!fs.existsSync(casesFile)) {
    throw new Error('EXERCISE_CASES_MISSING: ' + casesFile);
  }
  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('EXERCISE_CASES_EMPTY: ' + casesFile);
  }
  const body = [
    "'use strict';",
    '',
    '// Materialised inside the worker root from tools/ai-brain/exercise/e1-branch-name.cases.json.',
    '// Never committed: the test:brain glob would pick this file up on the integration',
    '// branch. Run it with: node --test tools/ai-brain/test/e1-branch-name.test.js',
    '',
    "const { test } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const cases = require('../exercise/e1-branch-name.cases.json');",
    "const { normalizeWorkItemBranch } = require('../branch-name');",
    '',
    'const THROWS = ' + JSON.stringify(THROWS) + ';',
    '',
    'for (const c of cases) {',
    '  test(c.name, () => {',
    '    if (typeof c.expect === "string" && c.expect.startsWith(THROWS)) {',
    '      const code = c.expect.slice(THROWS.length);',
    '      assert.throws(',
    '        () => normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome),',
    '        (err) => {',
    '          const named = String((err && err.code) || "") + " " + String((err && err.message) || "");',
    '          assert.ok(',
    '            named.includes(code),',
    '            "expected the thrown error to be " + code + ", got: " + named',
    '          );',
    '          return true;',
    '        }',
    '      );',
    '      return;',
    '    }',
    '    assert.equal(normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome), c.expect);',
    '  });',
    '}',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');

  // Keep it untracked in git
  appendGitInfoExclude(root, ['tools/ai-brain/test/e1-branch-name.test.js']);

  let failBefore = null;
  if (!o.skipFailBefore) {
    try {
      failBefore = captureFailBefore(root, o);
    } catch (err) {
      if (err && err.code === 'FAIL_BEFORE_ANCESTRY_MISMATCH') {
        throw err;
      }
      failBefore = {
        command:
          (o.verification && o.verification.command) ||
          'node --test tools/ai-brain/test/e1-branch-name.test.js',
        exitCode: -1,
        stdout: '',
        stderr: String((err && err.message) || err),
        output: String((err && err.message) || err),
        capturedAt: new Date().toISOString(),
        pass: false,
        error: String((err && err.message) || err),
      };
    }
  }

  return { path: target, cases: cases.length, failBefore };
}

/**
 * WD-R03: a shared-deps failure must never block the launch, but it must leave
 * a warning where operators look — the real append-only decision log
 * (decisions.js), not a caller-supplied hook that nothing wires. The record is
 * best-effort: a log that cannot be written must not turn a warning into a
 * block either.
 */
function recordWorkerDepsUnavailable(opts, workerRoot, err) {
  try {
    const decisions = require('./decisions');
    const code = err && err.code ? String(err.code) : 'UNKNOWN';
    const rawMessage = String((err && err.message) || err).replace(/[\r\n]+/g, ' ');
    const detailMessage =
      err && err.code === 'WORKER_DEPS_SOURCE_MISSING'
        ? `failed to copy dependencies from host: ${rawMessage}`
        : rawMessage;
    const detail = detailMessage.replace(/[A-Za-z]:\\[^'\"]+/g, '[path]').slice(0, 220);
    const failedPath =
      err && err.relativePath ? String(err.relativePath).replace(/\\/g, '/') : null;
    decisions.recordDecision(
      {
        stage: decisions.Stage.WARNING,
        warning: 'WORKER_DEPS_UNAVAILABLE',
        detail: `code=${code}; message=${detail}${failedPath ? `; path=${failedPath}` : ''}`.slice(
          0,
          300
        ),
        workItemId: (opts && opts.workItemId) || null,
        branch: (opts && opts.branch) || null,
        worktree: workerRoot || null,
      },
      { dir: (opts && opts.decisionDir) || undefined }
    );
  } catch (logErr) {
    console.error(logErr);
  }
}

function resolvePnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm';
  const appData = process.env.APPDATA;
  if (appData) {
    const native = path.join(appData, 'npm', 'node_modules', 'pnpm', 'pnpm.exe');
    if (fs.existsSync(native)) return native;
  }
  return 'pnpm.exe';
}

function offlineStoreMiss(error) {
  const message = String((error && error.message) || '').toLowerCase();
  return /offline|no matching version|not found in.*store|missing.*store|store.*missing/.test(
    message
  );
}

function enforceTokenBudget(launchResult, tokenBudget, usageFile) {
  if (!tokenBudget || Number(tokenBudget.maxTokens) <= 0) return launchResult;
  if (launchResult && launchResult.failureReason) return launchResult;
  let failureReason = null;
  let budgetWarning = null;
  let total = null;
  try {
    if (!usageFile || !fs.existsSync(usageFile)) throw new Error('usage report missing');
    const report = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    const usage = report.usage || {};
    const hasTotal = usage.total_tokens != null || usage.total != null;
    const hasInput = usage.input_tokens != null || usage.input != null;
    const hasCacheRead =
      usage.cache_read_tokens != null || usage.cacheRead != null || usage.cache_read != null;
    const hasOutput = usage.output_tokens != null || usage.output != null;
    if (!hasTotal && !hasInput && !hasCacheRead && !hasOutput)
      throw new Error('usage total missing');
    const accountedTotal =
      Number(usage.input_tokens ?? usage.input ?? 0) +
      Number(usage.cache_read_tokens ?? usage.cacheRead ?? usage.cache_read ?? 0) +
      Number(usage.output_tokens ?? usage.output ?? 0);
    total = hasTotal
      ? Math.max(Number(usage.total_tokens ?? usage.total), accountedTotal)
      : accountedTotal;
    if (!Number.isFinite(total)) throw new Error('usage total invalid');
    if (total > Number(tokenBudget.maxTokens)) failureReason = 'TOKEN_BUDGET_EXCEEDED';
  } catch (_) {
    budgetWarning = 'TOKEN_BUDGET_UNVERIFIED';
  }
  if (budgetWarning) {
    launchResult.budgetWarning = budgetWarning;
    launchResult.budgetVerified = false;
    launchResult.stderr =
      (launchResult.stderr || '') +
      '\n' +
      budgetWarning +
      ': configured token budget could not be verified';
  }
  if (failureReason) {
    launchResult.exitCode = 1;
    launchResult.failureReason = failureReason;
    launchResult.stderr =
      (launchResult.stderr || '') +
      '\n' +
      failureReason +
      ': ' +
      (failureReason === 'TOKEN_BUDGET_EXCEEDED'
        ? 'session exceeded configured token budget'
        : 'configured token budget could not be verified');
  }
  return launchResult;
}

function getIsolatedLauncher() {
  return function isolatedLauncher(adapter, args, options) {
    if (args && !Array.isArray(args)) {
      if (args.killTree) {
        return require('./harness').runHarness(adapter, args, options);
      }
      args = [];
    }
    const opts = options || {};

    // The verdict path is injectable so tests can write the verdict where the
    // code reads it on every OS. The production default is unchanged on Windows
    // (LOCALAPPDATA\ShipDe\isolation-verdict.json); LOCALAPPDATA is unset on
    // non-Windows, so production there resolves to a relative path, exactly as
    // before this opt was added.
    const verdictPath = isolationVerdictPath(opts);
    const hostCwd = opts.cwd || process.cwd();
    const jobName = path.basename(hostCwd) || 'default';
    const workerRoot = opts.workerRoot || workerRootFor(hostCwd);
    let carriedOver = 'none';
    let currentSid;
    const verdictData = require('./isolation-refresh').refreshIsolationVerdict({
      cwd: hostCwd,
      runner: opts.refreshRunner,
      timeoutMs: opts.refreshTimeoutMs,
      decisionDir: opts.decisionDir,
      validate: () => {
        if (!fs.existsSync(verdictPath)) {
          throw new Error('ISOLATION_VERDICT_MISSING: Cannot find ' + verdictPath);
        }
        const stat = fs.statSync(verdictPath);
        if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
          throw new Error('ISOLATION_VERDICT_STALE: ' + verdictPath + ' is older than 24h');
        }
        const verdictText = fs.readFileSync(verdictPath, 'utf8');
        const verdictData = JSON.parse(
          verdictText.charCodeAt(0) === 0xfeff ? verdictText.slice(1) : verdictText
        );
        if (verdictData.verdict !== 'CLOSED') {
          throw new Error('ISOLATION_VERDICT_NOT_CLOSED: Last verdict was ' + verdictData.verdict);
        }

        // P5: bind the FULL host worktree path, not just the worker-root leaf, so
        // two jobs sharing a directory leaf cannot share one attestation.
        if (
          !verdictData.worktree ||
          String(verdictData.worktree).toLowerCase() !== String(hostCwd).toLowerCase()
        ) {
          throw new Error(
            'ISOLATION_VERDICT_INVALID: worktree mismatch or missing: ' +
              verdictData.worktree +
              ' vs ' +
              hostCwd
          );
        }
        if (!verdictData.timestamp || new Date(verdictData.timestamp).getTime() > Date.now()) {
          throw new Error('ISOLATION_VERDICT_INVALID: timestamp in future or missing');
        }
        const policyHash = getFolderHash(path.join(hostCwd, 'scripts/ai/isolation'));
        if (!verdictData.policyHash || verdictData.policyHash !== policyHash) {
          throw new Error('ISOLATION_VERDICT_INVALID: policyHash mismatch or missing');
        }
        const getWorkerSid =
          typeof opts.getWorkerSid === 'function' ? opts.getWorkerSid : queryWorkerSid;
        currentSid = getWorkerSid();
        if (!verdictData.sid || verdictData.sid !== currentSid) {
          throw new Error('ISOLATION_VERDICT_INVALID: SID mismatch or missing');
        }
        // P5: per-check granularity — the verdict must carry every isolation
        // check's outcome and each one must be PASS, not just the summary verdict.
        if (!verdictData.details || typeof verdictData.details !== 'object') {
          throw new Error('ISOLATION_VERDICT_INVALID: details missing');
        }
        for (const [key, value] of Object.entries(verdictData.details)) {
          if (!/^PASS/.test(String(value))) {
            throw new Error('ISOLATION_VERDICT_INVALID: check ' + key + ' = ' + value);
          }
        }
        // P5: re-verify the boundary is still physically present right now.
        const verifyBoundary =
          typeof opts.verifyBoundary === 'function' ? opts.verifyBoundary : defaultVerifyBoundary;
        if (!verifyBoundary(currentSid, WORKER_USERNAME, opts)) {
          throw new Error(
            'ISOLATION_BOUNDARY_MISSING: firewall rules or operator-profile Deny ACL absent; rerun Set-WorkerFirewall.ps1/Set-WorkerAcl.ps1'
          );
        }

        return verdictData;
      },
    });

    // Provision worktree using a clean clone checked out at the caller's
    // pinned base SHA (AI-64-R15). The operator worktree's current HEAD is not
    // a base: it moves under the operator's feet, and a worker provisioned at
    // "whatever HEAD was" is not a reproducible run. An absent or malformed pin
    // stops the run before the worker root is created.
    const baseSha = opts.baseSha || null;
    if (!baseSha) {
      throw new Error('ISOLATION_BASE_SHA_MISSING: the caller must pin the base SHA to provision');
    }
    if (!/^[0-9a-f]{40}$/i.test(String(baseSha))) {
      throw new Error('ISOLATION_BASE_SHA_INVALID: not a 40-character commit: ' + baseSha);
    }
    const headSha = String(baseSha);

    // Distinguish initial launch of a work item vs repair round explicitly:
    // (1) Initial launch (no repair context, retainWorkerHead is not provided):
    //     always re-provision a fresh worker root at the pinned base SHA
    //     (delete + git clone --no-checkout --no-hardlinks + checkout inside the fresh clone),
    //     regardless of what an earlier run left in workerRoot.
    // (2) Repair round (retainWorkerHead is provided, e.g. <40-char sha>):
    //     keep the existing root only if a hardened read (clean GIT_CONFIG_GLOBAL/SYSTEM=NUL,
    //     -c core.hooksPath=NUL -c core.fsmonitor=false -c core.attributesFile=NUL) shows
    //     HEAD == that sha; never run checkout or any tree-mutating git in a retained root;
    //     mismatch -> structured WORKER_HEAD_MISMATCH failure for that repair attempt.
    const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    let retainWorkerHead =
      typeof opts.retainWorkerHead === 'string'
        ? opts.retainWorkerHead.trim()
        : opts.retainWorkerHead
          ? headSha
          : null;

    if (retainWorkerHead) {
      let retainedHeadSha = null;
      let missingRoot = false;
      if (fs.existsSync(workerRoot) && fs.existsSync(path.join(workerRoot, '.git'))) {
        try {
          const { withCleanGitEnv, safeGit } = require('./supervisor');
          retainedHeadSha = withCleanGitEnv(
            workerRoot,
            (safeGitDir) => {
              const curHeadRes = safeGit(
                safeGitDir,
                workerRoot,
                ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
                20000
              );
              if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
                return curHeadRes.stdout.trim();
              }
              return null;
            },
            { workerWritable: true }
          );
        } catch {
          retainedHeadSha = null;
        }
      } else {
        missingRoot = true;
      }

      if (missingRoot) {
        const err = new Error('WORKER_ROOT_MISSING: retained worker root is missing');
        err.code = 'WORKER_ROOT_MISSING';
        throw err;
      }

      const { isTreeDirty } = require('./orchestrate');
      if (
        !retainedHeadSha ||
        retainedHeadSha.toLowerCase() !== retainWorkerHead.toLowerCase() ||
        isTreeDirty(workerRoot)
      ) {
        const workItemId = (opts && opts.workItemId) || null;
        let adopted = false;

        if (retainedHeadSha && retainWorkerHead && workItemId) {
          try {
            const { safeGit, withCleanGitEnv } = require('./supervisor');
            const { isTreeDirty } = require('./orchestrate');
            if (!isTreeDirty(workerRoot)) {
              withCleanGitEnv(
                workerRoot,
                (safeGitDir) => {
                  const mergeBaseRes = safeGit(
                    safeGitDir,
                    workerRoot,
                    ['merge-base', '--is-ancestor', retainWorkerHead, retainedHeadSha],
                    20000
                  );
                  if (mergeBaseRes && mergeBaseRes.status === 0) {
                    const logRes = safeGit(
                      safeGitDir,
                      workerRoot,
                      ['log', '--format=%H', retainWorkerHead + '..' + retainedHeadSha],
                      20000
                    );
                    if (logRes && logRes.status === 0 && logRes.stdout) {
                      const extraCommits = logRes.stdout
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      if (extraCommits.length > 0) {
                        const decisions = require('./decisions');
                        const logRecords = decisions.readDecisionsSafe({
                          dir: (opts && opts.decisionDir) || undefined,
                        });
                        const baseId = workItemId
                          ? workItemId.replace(/-(repair-\d+|review)$/, '')
                          : null;
                        const repairCommits = new Set();
                        for (const rec of logRecords) {
                          if (
                            rec.workItemId &&
                            baseId &&
                            rec.workItemId.replace(/-(repair-\d+|review)$/, '') === baseId &&
                            rec.stage === decisions.Stage.LAUNCHED &&
                            rec.detail &&
                            rec.detail.startsWith('REPAIR_ROUND:') &&
                            rec.sha &&
                            rec.worktree
                          ) {
                            const recWorktree = path.resolve(rec.worktree);
                            const currentWorktree = path.resolve(workerRoot);
                            const pathsMatch =
                              process.platform === 'win32'
                                ? recWorktree.toLowerCase() === currentWorktree.toLowerCase()
                                : recWorktree === currentWorktree;

                            if (pathsMatch) {
                              repairCommits.add(rec.sha.toLowerCase());
                            }
                          }
                        }

                        const allExtraAreRepair = extraCommits.every((c) =>
                          repairCommits.has(c.toLowerCase())
                        );
                        if (allExtraAreRepair) {
                          adopted = true;

                          if (opts.checkpoint) {
                            const cli = require('./cli');
                            const checkpointOnDisk = cli.readCheckpoint(opts.checkpoint);
                            if (
                              checkpointOnDisk &&
                              checkpointOnDisk.liveSteps &&
                              checkpointOnDisk.liveSteps[baseId]
                            ) {
                              const step = checkpointOnDisk.liveSteps[baseId];
                              let updated = false;
                              if (step.launch) {
                                step.launch.workerSha = retainedHeadSha;
                                updated = true;
                              }
                              if (step.repair) {
                                step.repair.sha = retainedHeadSha;
                                updated = true;
                              }
                              if (updated) {
                                cli.writeJsonFile(opts.checkpoint, checkpointOnDisk);
                              }
                            }
                          }

                          decisions.recordDecision(
                            {
                              stage: 'adopted_repair_head',
                              workItemId,
                              branch: (opts && opts.branch) || null,
                              worktree: workerRoot,
                              detail: 'adopted descendant repair HEAD',
                              requestedSha: retainWorkerHead,
                              adoptedSha: retainedHeadSha,
                            },
                            { dir: (opts && opts.decisionDir) || undefined }
                          );
                          retainWorkerHead = retainedHeadSha;
                        }
                      }
                    }
                  }
                },
                { workerWritable: true }
              );
            }
          } catch (e) {
            // Ignore Git errors during adoption check and fallback to WORKER_HEAD_MISMATCH failure
            // but bubble up decision log unreadable errors.
            if (e && e.code === 'DECISION_LOG_UNREADABLE') {
              throw e;
            }
          }
        }

        if (!adopted) {
          let errMsg =
            'WORKER_HEAD_MISMATCH: retained worker root HEAD (' +
            (retainedHeadSha || 'unknown') +
            ') does not match requested SHA ' +
            retainWorkerHead;

          if (
            retainedHeadSha &&
            retainedHeadSha.toLowerCase() === retainWorkerHead.toLowerCase() &&
            isTreeDirty(workerRoot)
          ) {
            errMsg =
              'WORKER_HEAD_MISMATCH: retained worker root HEAD (' + retainedHeadSha + ') is dirty';
          }

          const err = new Error(errMsg);
          err.code = 'WORKER_HEAD_MISMATCH';
          throw err;
        }
      }
      // Matching HEAD: retain worker root and its commits as-is. NEVER run checkout.
    } else {
      const carryBranch =
        opts.branch || (opts.workItemId ? 'feat/' + String(opts.workItemId).toLowerCase() : null);
      if (fs.existsSync(workerRoot)) {
        carryOverSave(hostCwd, workerRoot, carryBranch, headSha);
        fs.rmSync(workerRoot, { recursive: true, force: true });
      }

      // Q5: --no-hardlinks — a local clone hardlinks .git/objects files to
      // the operator repo; the worker root is outside the operator profile and
      // the worker is granted Modify, so a hardlinked object could be
      // rewritten in place to corrupt the OPERATOR repo's objects.
      const cloneRes = cp.spawnSync(
        'git',
        ['clone', '--no-checkout', '--no-hardlinks', hostCwd, workerRoot],
        {
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (cloneRes.status !== 0) throw new Error('Failed to clone repository');

      const { getEffectiveEolConfig } = require('./supervisor');
      const eolConfig = getEffectiveEolConfig(hostCwd, opts);

      const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
      const checkoutArgs = [
        '-c',
        'core.hooksPath=' + nulDevice,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.attributesFile=' + nulDevice,
        '-c',
        'diff.external=',
        '-c',
        'safe.directory=' + normWorkerRoot,
      ];
      if (process.platform === 'win32') {
        checkoutArgs.push('-c', 'core.filemode=false');
      }
      if (eolConfig.autocrlf !== null) {
        checkoutArgs.push('-c', 'core.autocrlf=' + eolConfig.autocrlf);
      }
      if (eolConfig.eol !== null) {
        checkoutArgs.push('-c', 'core.eol=' + eolConfig.eol);
      }
      const targetBranch =
        opts.branch || (opts.workItemId ? 'feat/' + String(opts.workItemId).toLowerCase() : null);

      if (targetBranch) {
        checkoutArgs.push('checkout', '-B', targetBranch, headSha);
      } else {
        checkoutArgs.push('checkout', headSha);
      }

      const checkoutRes = cp.spawnSync('git', checkoutArgs, {
        cwd: workerRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      });
      if (checkoutRes.status !== 0) {
        throw new Error(
          'ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: ' + headSha
        );
      }

      if (targetBranch) {
        cp.spawnSync('git', ['update-ref', 'refs/remotes/origin/' + targetBranch, headSha], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      if (targetBranch) {
        try {
          carriedOver = carryOverRestore(hostCwd, workerRoot, targetBranch, eolConfig);
        } catch (error) {
          if (String(error.message).startsWith('WORKER_COMMIT_FAILED:')) {
            return {
              exitCode: 1,
              localFailure: 'WORKER_COMMIT_FAILED',
              failureReason: String(error.message),
              stderr: String(error.message),
            };
          }
          throw error;
        }
      }

      ensureGoalRegistrationInWorker(hostCwd, workerRoot, opts.workItemId);

      if (eolConfig.autocrlf !== null) {
        cp.spawnSync('git', ['config', 'core.autocrlf', eolConfig.autocrlf], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (eolConfig.eol !== null) {
        cp.spawnSync('git', ['config', 'core.eol', eolConfig.eol], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (process.platform === 'win32') {
        cp.spawnSync('git', ['config', 'core.filemode', 'false'], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      // Provisioning must end with HEAD == requested base SHA exactly, verified with a hardened rev-parse;
      // any mismatch is a hard structured failure (PROVISION_BASE_MISMATCH) before the agent starts.
      const { withCleanGitEnv, safeGit } = require('./supervisor');
      let provisionedHeadSha = null;
      try {
        provisionedHeadSha = withCleanGitEnv(
          workerRoot,
          (safeGitDir) => {
            const curHeadRes = safeGit(
              safeGitDir,
              workerRoot,
              ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
              20000
            );
            if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
              return curHeadRes.stdout.trim();
            }
            return null;
          },
          { workerWritable: true }
        );
      } catch {
        provisionedHeadSha = null;
      }

      if (!provisionedHeadSha) {
        const revRes = (opts.spawnSync || cp.spawnSync)(
          'git',
          [
            '-c',
            'safe.directory=' + normWorkerRoot,
            '-c',
            'core.hooksPath=' + nulDevice,
            '-c',
            'core.fsmonitor=false',
            '-c',
            'core.attributesFile=' + nulDevice,
            'rev-parse',
            '--verify',
            '--quiet',
            'HEAD^{commit}',
          ],
          {
            cwd: workerRoot,
            encoding: 'utf8',
            windowsHide: true,
            env: Object.assign({}, process.env, {
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: nulDevice,
              GIT_CONFIG_SYSTEM: nulDevice,
            }),
          }
        );
        if (revRes && revRes.status === 0 && revRes.stdout) {
          provisionedHeadSha = revRes.stdout.trim();
        }
      }

      if (!provisionedHeadMatchesBase(workerRoot, provisionedHeadSha, headSha, carriedOver)) {
        const err = new Error(
          'PROVISION_BASE_MISMATCH: provisioned worker root HEAD (' +
            (provisionedHeadSha || 'unknown') +
            ') does not match requested base SHA ' +
            headSha
        );
        err.code = 'PROVISION_BASE_MISMATCH';
        throw err;
      }
    }

    // WD-R01, WD-R02, WD-R03: Shared dependency directory for pnpm
    const pnpmLockPath = path.join(workerRoot, 'pnpm-lock.yaml');
    if (fs.existsSync(pnpmLockPath)) {
      try {
        const findPackageJsons = (dir, results = []) => {
          if (!fs.existsSync(dir)) return results;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
              findPackageJsons(path.join(dir, entry.name), results);
            } else if (entry.isFile() && entry.name === 'package.json') {
              results.push(path.join(dir, entry.name));
            }
          }
          return results;
        };
        const pkgJsons = findPackageJsons(workerRoot);
        // The hash mixes each file's repo-relative name with its content and a
        // delimiter, so distinct file sets cannot collide on a bare content
        // concatenation and the value does not depend on where the clone sits.
        const hashEntries = [
          { rel: 'pnpm-lock.yaml', file: pnpmLockPath },
          ...pkgJsons.map((f) => ({
            rel: path.relative(workerRoot, f).split(path.sep).join('/'),
            file: f,
          })),
        ].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
        const hash = crypto.createHash('sha256');
        for (const entry of hashEntries) {
          hash.update(entry.rel, 'utf8');
          hash.update('\0', 'utf8');
          hash.update(fs.readFileSync(entry.file));
          hash.update('\0', 'utf8');
        }
        const depsHash = hash.digest('hex').substring(0, 16);
        const depsDir = path.join(path.dirname(workerRoot), 'deps', depsHash);
        const depsNodeModules = path.join(depsDir, 'node_modules');
        const markerFile = path.join(depsDir, '.shipde-deps-ready');
        const cacheReady = () => fs.existsSync(markerFile) && fs.existsSync(depsNodeModules);
        // Populate ONCE (WD-R01): stage only the lockfile/workspace manifests,
        // install from the host pnpm store, mark the completed tree, then
        // rename it into place. pnpm creates Windows junctions/hard links
        // without requiring the symlink privilege needed by recursive copies.
        if (!cacheReady()) {
          const stagingDir =
            depsDir + '.staging-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
          fs.mkdirSync(stagingDir, { recursive: true });
          let failedPath = 'pnpm-lock.yaml';
          try {
            for (const entry of hashEntries) {
              failedPath = entry.rel;
              const hostManifest = path.join(hostCwd, entry.rel);
              const stagedManifest = path.join(stagingDir, entry.rel);
              if (!fs.existsSync(hostManifest)) {
                const missing = new Error('host workspace manifest is missing');
                missing.code = 'WORKER_DEPS_SOURCE_MISSING';
                throw missing;
              }
              fs.mkdirSync(path.dirname(stagedManifest), { recursive: true });
              fs.copyFileSync(hostManifest, stagedManifest);
            }
            const hostWorkspaceFile = path.join(hostCwd, 'pnpm-workspace.yaml');
            if (fs.existsSync(hostWorkspaceFile)) {
              failedPath = 'pnpm-workspace.yaml';
              fs.copyFileSync(hostWorkspaceFile, path.join(stagingDir, 'pnpm-workspace.yaml'));
            }

            failedPath = 'node_modules';
            const runPnpmInstall = (offline) => {
              const args = ['install', '--frozen-lockfile'];
              if (offline) args.push('--offline');
              const pnpmExecutable = resolvePnpmCommand();
              const result = cp.spawnSync(pnpmExecutable, args, {
                cwd: stagingDir,
                encoding: 'utf8',
                windowsHide: true,
                timeout: 600000,
                maxBuffer: 10 * 1024 * 1024,
              });
              if (result.error) throw result.error;
              if (result.status !== 0) {
                const detail = (result.stderr || result.stdout || 'pnpm install failed').trim();
                const error = new Error(detail.slice(-4000));
                error.code = 'PNPM_INSTALL_FAILED';
                error.offline = offline;
                error.relativePath = failedPath;
                throw error;
              }
            };

            try {
              runPnpmInstall(true);
            } catch (offlineError) {
              if (!offlineError.offline || !offlineStoreMiss(offlineError)) throw offlineError;
              // An incomplete local store is the only reason to retry online.
              runPnpmInstall(false);
            }

            if (!fs.existsSync(path.join(stagingDir, 'node_modules'))) {
              const error = new Error('pnpm install completed without node_modules');
              error.code = 'WORKER_DEPS_SOURCE_MISSING';
              throw error;
            }
            fs.writeFileSync(path.join(stagingDir, '.shipde-deps-ready'), 'ready', 'utf8');
            try {
              if (fs.existsSync(depsDir)) {
                fs.rmSync(depsDir, { recursive: true, force: true });
              }
              fs.renameSync(stagingDir, depsDir);
            } catch (renameErr) {
              // A concurrent launch finished first: its complete tree wins.
              fs.rmSync(stagingDir, { recursive: true, force: true });
              if (!cacheReady()) throw renameErr;
            }
          } catch (provisionError) {
            provisionError.relativePath = failedPath.split(path.sep).join('/');
            fs.rmSync(stagingDir, { recursive: true, force: true });
            throw provisionError;
          }
        }

        // WD-R02 junctions: the worker root must point at the shared tree. An
        // existing path that is not that junction (a real directory left
        // behind) is replaced, never silently kept without a warning.
        const setupJunction = (relPath) => {
          const depsNm = path.join(depsDir, relPath);
          const workerNm = path.join(workerRoot, relPath);
          if (!fs.existsSync(depsNm)) return null;
          let linked = false;
          if (fs.existsSync(workerNm)) {
            try {
              const st = fs.lstatSync(workerNm);
              const target = st.isSymbolicLink() ? fs.readlinkSync(workerNm) : null;
              linked =
                target !== null &&
                path.resolve(target).toLowerCase() === path.resolve(depsNm).toLowerCase();
            } catch {
              linked = false;
            }
            if (!linked) {
              fs.rmSync(workerNm, { recursive: true, force: true });
            }
          }
          if (!linked) {
            fs.mkdirSync(path.dirname(workerNm), { recursive: true });
            fs.symlinkSync(depsNm, workerNm, 'junction');
          }
          return relPath + '/';
        };

        const excluded = [];
        const rootExcl = setupJunction('node_modules');
        if (rootExcl) excluded.push(rootExcl);

        const workspaces = ['apps', 'packages'];
        for (const ws of workspaces) {
          const workerWsPath = path.join(workerRoot, ws);
          if (fs.existsSync(workerWsPath)) {
            const pkgs = fs.readdirSync(workerWsPath, { withFileTypes: true });
            for (const pkg of pkgs) {
              if (pkg.isDirectory()) {
                const excl = setupJunction(path.join(ws, pkg.name, 'node_modules'));
                if (excl) excluded.push(excl.replace(/\\/g, '/'));
              }
            }
          }
        }

        if (excluded.length > 0) {
          appendGitInfoExclude(workerRoot, excluded);
        }
      } catch (err) {
        recordWorkerDepsUnavailable(opts, workerRoot, err);
      }
    }

    // DS-R04: store the credential env for the worker allowlist
    let selectedCredentialEnv = null;
    let directModelRewrite = null;

    if (adapter.id === 'opencode-direct') {
      const sourcesModule = require('./sources');
      const staticSources = require('./sources.json');
      const loadedSources =
        opts && opts.sources
          ? Array.isArray(opts.sources)
            ? opts.sources
            : (opts.sources && opts.sources.sources) || []
          : sourcesModule.loadSources(opts).sources;
      // Discovered (probed) direct sources are only in the merged registry.
      const sources = {
        ...staticSources,
        sources: (staticSources.sources || []).concat(
          loadedSources.filter(
            (entry) => !(staticSources.sources || []).some((s) => s.id === entry.id)
          )
        ),
      };
      const { parseCandidateKey } = require('./discovery/identity');

      // Extract pinned model id from args or options (the exact --model string opencode receives)
      const modelIdx = Array.isArray(args) ? args.indexOf('--model') : -1;
      const pinnedModel =
        modelIdx !== -1 && modelIdx + 1 < args.length
          ? args[modelIdx + 1]
          : (opts && opts.pinnedModel) || (opts && opts.model) || null;

      // SUPERVISOR FIX: resolve source from options, candidate gateway, or model prefix
      let selectedSource =
        opts && (opts.selectedSource || (typeof opts.source === 'object' ? opts.source : null));
      const candidateKey = (opts && opts.candidateKey) || null;
      let sourceId =
        (opts &&
          (opts.sourceId ||
            (typeof opts.source === 'string' ? opts.source : null) ||
            opts.gateway)) ||
        null;
      if (!sourceId && candidateKey) {
        const parsed = parseCandidateKey(candidateKey);
        sourceId = parsed && parsed.gateway ? parsed.gateway : null;
      }
      if (!sourceId && pinnedModel) {
        const prefix = sourcesModule.providerFromPrefix(pinnedModel);
        if (prefix) {
          const match = sources.sources.find(
            (s) =>
              s.id === prefix ||
              s.opencodeProvider === prefix ||
              s.modelPrefix === prefix + '/' ||
              s.modelPrefix === prefix
          );
          if (match) {
            sourceId = match.id;
          } else {
            const machineDataOff =
              process.env.AI_BRAIN_DISCOVERED_SOURCES === 'none' ||
              process.env.AI_BRAIN_MACHINE_DATA === 'none';
            if (!machineDataOff) {
              try {
                const { discoverSources } = require('./source-discovery');
                const discovered = discoverSources();
                const dMatch = discovered.find(
                  (s) => s.id === prefix || s.opencodeProvider === prefix
                );
                if (dMatch) {
                  sourceId = dMatch.id;
                  selectedSource = dMatch;
                }
              } catch (_) {}
            }
          }
        }
      }

      // No gateway (legacy callers/tests) -> use 9router unchanged
      sourceId = sourceId || '9router';

      if (!selectedSource) {
        selectedSource =
          opts && (opts.selectedSource || (typeof opts.source === 'object' ? opts.source : null));
      }
      if (!selectedSource) {
        selectedSource = sources.sources.find(
          (s) => s.id === sourceId || s.opencodeProvider === sourceId
        );
      }
      if (!selectedSource) {
        const machineDataOff =
          process.env.AI_BRAIN_DISCOVERED_SOURCES === 'none' ||
          process.env.AI_BRAIN_MACHINE_DATA === 'none';
        if (!machineDataOff) {
          try {
            const { discoverSources } = require('./source-discovery');
            const discovered = discoverSources();
            selectedSource = discovered.find(
              (s) => s.id === sourceId || s.opencodeProvider === sourceId
            );
          } catch (_) {}
        }
      }
      if (!selectedSource) {
        const err = new Error(
          `OPENCODE_DIRECT_SOURCE_UNKNOWN: gateway '${sourceId}' not found in sources.json`
        );
        err.code = 'OPENCODE_DIRECT_SOURCE_UNKNOWN';
        throw err;
      }

      // DS-R02: validate that the source has an https endpoint (or http://127.0.0.1 / localhost) and credential.env
      const isKeyless = Boolean(
        selectedSource.opencodeBuiltin &&
        selectedSource.credential &&
        selectedSource.credential.type === 'none'
      );
      const endpoint = selectedSource.endpoint;
      const credentialEnv =
        (selectedSource.credential &&
          (selectedSource.credential.env || selectedSource.credential.name)) ||
        selectedSource.apiKeyEnv;

      const isHttpsOrLocalhost =
        endpoint &&
        (endpoint.startsWith('https://') ||
          endpoint.startsWith('http://127.0.0.1') ||
          endpoint.startsWith('http://localhost'));

      if (!isHttpsOrLocalhost || (!credentialEnv && !isKeyless)) {
        const err = new Error(
          `OPENCODE_DIRECT_SOURCE_UNSUPPORTED: source '${sourceId}' does not have a valid https endpoint (or http://127.0.0.1 / localhost) and credential.env`
        );
        err.code = 'OPENCODE_DIRECT_SOURCE_UNSUPPORTED';
        throw err;
      }

      const isRouter = selectedSource.kind === 'router' || Boolean(selectedSource.modelPrefix);

      // DS-R04: verify that the credential is available in the host environment before spawning (direct sources only; router never checked)
      if (!isRouter && !isKeyless && !process.env[credentialEnv]) {
        const err = new Error(
          `OPENCODE_DIRECT_CREDENTIAL_MISSING: environment variable ${credentialEnv} is not set`
        );
        err.code = 'OPENCODE_DIRECT_CREDENTIAL_MISSING';
        throw err;
      }

      // Store for later use in buildWorkerLaunchScript
      selectedCredentialEnv = credentialEnv || null;

      // DS-R03: for direct sources, provider id must be the source id, not the model name
      const providerId =
        isRouter && pinnedModel
          ? sourcesModule.providerFromPrefix(pinnedModel) || selectedSource.id
          : selectedSource.opencodeProvider || selectedSource.id;

      // The worker config below registers only providerId, keyed by the source's own model id
      // (which may contain '/'). opencode splits --model at the first '/', so any id not already
      // qualified with providerId must be, even if it contains a slash.
      if (!isRouter && pinnedModel && !pinnedModel.startsWith(providerId + '/')) {
        directModelRewrite = providerId + '/' + pinnedModel;
      }

      if (pinnedModel && isRouter) {
        const derivedFromModel = sourcesModule.providerFromPrefix(pinnedModel);
        if (derivedFromModel && derivedFromModel !== providerId) {
          throw new Error(
            `OPENCODE_DIRECT_LAUNCH_FAILED: provider mismatch between model prefix '${derivedFromModel}' and provider '${providerId}'`
          );
        }
      }

      const modelsMap = {};
      if (pinnedModel) {
        const prefixWithSlash = providerId + '/';
        const relativeId = pinnedModel.startsWith(prefixWithSlash)
          ? pinnedModel.slice(prefixWithSlash.length)
          : pinnedModel;

        const routerProvider = selectedSource.modelPrefix
          ? sourcesModule.providerFromPrefix(selectedSource.modelPrefix)
          : null;
        const useFullWireId = isRouter && routerProvider && providerId !== routerProvider;
        const wireId = useFullWireId ? pinnedModel : relativeId;

        const outputLimit =
          (selectedSource.modelMeta && selectedSource.modelMeta[pinnedModel]?.limit?.output) ||
          (selectedSource.options && selectedSource.options.max_tokens) ||
          4096;
        const contextLimit =
          (selectedSource.modelMeta && selectedSource.modelMeta[pinnedModel]?.limit?.context) ||
          32000;

        const modelEntry = {
          id: wireId,
          name: relativeId,
          limit: {
            context: contextLimit,
            output: outputLimit,
          },
        };
        modelsMap[pinnedModel] = modelEntry;
        if (relativeId && relativeId !== pinnedModel) {
          modelsMap[relativeId] = modelEntry;
        }
      }

      const providerOptions = {
        baseURL: selectedSource.endpoint,
        ...(credentialEnv ? { apiKey: `{env:${credentialEnv}}` } : {}),
        ...(selectedSource.headers && typeof selectedSource.headers === 'object'
          ? { headers: selectedSource.headers }
          : {}),
      };
      if (selectedSource.options && typeof selectedSource.options === 'object') {
        Object.assign(providerOptions, selectedSource.options);
      }
      // Ensure apiKey is strictly {env:credentialEnv} and never leaked/overwritten.
      // On the keyless branch, delete any apiKey copied from options so no literal key is written.
      if (credentialEnv) {
        providerOptions.apiKey = `{env:${credentialEnv}}`;
      } else {
        delete providerOptions.apiKey;
      }

      // Permission scoping: strictly worker root and report dir; no whole-machine wildcard
      const normWorker = path.resolve(workerRoot).replace(/\\/g, '/');
      const workerPattern = normWorker.endsWith('/') ? normWorker + '**' : normWorker + '/**';
      const extDirPerms = {
        [workerPattern]: 'allow',
      };
      if (opts && opts.usageDir) {
        const normUsage = path.resolve(opts.usageDir).replace(/\\/g, '/');
        const usagePattern = normUsage.endsWith('/') ? normUsage + '**' : normUsage + '/**';
        extDirPerms[usagePattern] = 'allow';
      }
      if (opts && opts.usageFile) {
        const reportDir = path.dirname(path.resolve(opts.usageFile)).replace(/\\/g, '/');
        const reportPattern = reportDir.endsWith('/') ? reportDir + '**' : reportDir + '/**';
        extDirPerms[reportPattern] = 'allow';
      }

      // DS-R03: generate opencode.json with the direct source's endpoint and credential
      const configPath = path.join(workerRoot, 'opencode.json');
      const configData = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        permission: {
          external_directory: extDirPerms,
        },
        provider: {
          [providerId]: {
            npm: '@ai-sdk/openai-compatible',
            name: selectedSource.label || providerId,
            options: providerOptions,
            models: modelsMap,
          },
        },
      });
      fs.writeFileSync(configPath, configData, 'utf8');
      appendGitInfoExclude(workerRoot, ['opencode.json']);
    }

    let exerciseResult = null;
    if (opts.exercise) {
      exerciseResult = materialiseExercise(workerRoot, {
        exercise: opts.exercise,
        baseSha: headSha,
        spawnSync: opts.spawnSync,
        isWorkerPath: opts.isWorkerPath,
      });
      appendGitInfoExclude(workerRoot, ['tools/ai-brain/test/e1-branch-name.test.js']);
    }

    if (typeof opts.onProvisioned === 'function') {
      const hookRes = opts.onProvisioned(workerRoot, {
        baseSha: headSha,
        exercise: opts.exercise,
        exerciseResult,
        adapter,
        args,
      });
      if (hookRes && !exerciseResult) {
        exerciseResult = hookRes;
      }
    }

    // Final pre-launch check: verify HEAD has not moved from base SHA (or retained head) before agent starts
    const expectedActiveSha = retainWorkerHead || headSha;
    const { withCleanGitEnv, safeGit } = require('./supervisor');
    let preLaunchHead = null;
    try {
      preLaunchHead = withCleanGitEnv(
        workerRoot,
        (safeGitDir) => {
          const curHeadRes = safeGit(
            safeGitDir,
            workerRoot,
            ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
            20000
          );
          if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
            return curHeadRes.stdout.trim();
          }
          return null;
        },
        { workerWritable: true }
      );
    } catch {
      preLaunchHead = null;
    }
    if (!preLaunchHead) {
      const normWorker = path.resolve(workerRoot).replace(/\\/g, '/');
      const revRes = (opts.spawnSync || cp.spawnSync)(
        'git',
        [
          '-c',
          'safe.directory=' + normWorker,
          '-c',
          'core.hooksPath=' + nulDevice,
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.attributesFile=' + nulDevice,
          'rev-parse',
          '--verify',
          '--quiet',
          'HEAD^{commit}',
        ],
        {
          cwd: workerRoot,
          encoding: 'utf8',
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (revRes && revRes.status === 0 && revRes.stdout) {
        preLaunchHead = revRes.stdout.trim();
      }
    }
    // Same rule as provisioning: a carried-over merge on the base is the base.
    const preLaunchOk = retainWorkerHead
      ? Boolean(preLaunchHead) && preLaunchHead.toLowerCase() === expectedActiveSha.toLowerCase()
      : provisionedHeadMatchesBase(workerRoot, preLaunchHead, headSha, carriedOver);
    if (!preLaunchOk) {
      const code = retainWorkerHead ? 'WORKER_HEAD_MISMATCH' : 'PROVISION_BASE_MISMATCH';
      const err = new Error(
        code +
          ': worker root HEAD before agent start (' +
          (preLaunchHead || 'unknown') +
          ') does not match requested SHA ' +
          expectedActiveSha
      );
      err.code = code;
      throw err;
    }

    const rtkConfig = opts.rtk || null;
    let rtkEnabled = false;
    let rtkDecision = 'not_requested';
    let rtkPathPrepend = null;
    const RISK_DOMAINS = ['auth', 'tenancy', 'money', 'carrier', 'security'];

    if (rtkConfig && rtkConfig.enabled) {
      const isRepairRound = Boolean(retainWorkerHead);
      const hasRiskDomains =
        Array.isArray(opts.riskDomains) &&
        opts.riskDomains.some((d) => RISK_DOMAINS.includes(String(d).toLowerCase()));
      const isLowRisk = opts.lowRisk === true || !hasRiskDomains;

      if (isRepairRound) {
        rtkDecision = 'repair_round_blocks_rtk';
      } else if (hasRiskDomains) {
        rtkDecision = 'risk_domains_block_rtk';
      } else if (!isLowRisk) {
        rtkDecision = 'not_low_risk';
      } else {
        rtkEnabled = true;
        rtkDecision = 'provided';
        const rtkSource =
          rtkConfig.sourcePath ||
          process.env.SHIPDE_RTK_PATH ||
          path.join(
            process.env.LOCALAPPDATA || '',
            'Microsoft',
            'WinGet',
            'Packages',
            'rtk-ai.rtk_Microsoft.Winget.Source_8wekyb3d8bbwe',
            'rtk.exe'
          );
        const rtkDestBin = path.join(workerRoot, '.shipde-bin');
        const rtkDestExe = path.join(rtkDestBin, 'rtk.exe');
        try {
          if (fs.existsSync(rtkSource)) {
            fs.mkdirSync(rtkDestBin, { recursive: true });
            fs.copyFileSync(rtkSource, rtkDestExe);
            rtkPathPrepend = rtkDestBin;
          } else {
            console.error('[ISOLATION_LAUNCHER] RTK_UNAVAILABLE: source not found at ' + rtkSource);
            rtkEnabled = false;
            rtkDecision = 'rtk_unavailable_source_missing';
          }
        } catch (err) {
          console.error('[ISOLATION_LAUNCHER] RTK_UNAVAILABLE: ' + err.message);
          rtkEnabled = false;
          rtkDecision = 'rtk_copy_failed';
        }
      }
    } else {
      rtkDecision = 'rtk_not_enabled';
    }

    const credPath = path.join(process.env.LOCALAPPDATA || '', 'ShipDe', 'WorkerUser.cred');

    const exe = executableFor(adapter.command, opts);
    let fullArgs = exe.prefixArgs.concat(args);

    if (rtkEnabled && fullArgs.length > 0 && typeof fullArgs[fullArgs.length - 1] === 'string') {
      const hint =
        '\n\n# RTK is optional for reading long output (use: rtk test, rtk err, rtk git diff).\n# Final check and all evidence are produced by the host, raw.';
      fullArgs = [...fullArgs.slice(0, -1), fullArgs[fullArgs.length - 1] + hint];
    }

    // Q6: the launch result is written to a HOST-OWNED directory outside
    // workerRoot. Inside workerRoot a worker child that survives the main
    // process could overwrite launch-result.json and forge the telemetry the
    // node parent reads. LOCALAPPDATA\ShipDe\launch-results is operator-only.
    const launchResultDir = path.join(
      process.env.LOCALAPPDATA || 'C:\\temp',
      'ShipDe',
      'launch-results'
    );
    fs.mkdirSync(launchResultDir, { recursive: true });
    const launchResultPath = path.join(launchResultDir, jobName + '-' + Date.now() + '.json');

    // P6: the worker wait is bounded. A hung worker is killed after the
    // timeout instead of blocking the controller forever.
    const workerTimeoutMs =
      Number.isFinite(Number(opts.workerTimeoutMs)) && Number(opts.workerTimeoutMs) > 0
        ? Number(opts.workerTimeoutMs)
        : DEFAULT_WORKER_TIMEOUT_MS;
    const tokenBudget =
      opts.tokenBudget && typeof opts.tokenBudget === 'object' ? opts.tokenBudget : null;
    const budgetJson = tokenBudget ? JSON.stringify(tokenBudget) : '';

    // Bound to THIS launch: run-target.ps1 can only write a marker carrying
    // this nonce, so a leftover marker from an earlier job can never satisfy
    // the completion gate below.
    const completionNonce = crypto.randomBytes(16).toString('hex');
    const payloadDir = path.join(workerRoot, '.shipde');
    fs.mkdirSync(payloadDir, { recursive: true });
    appendGitInfoExclude(workerRoot, [
      '.shipde/',
      'run-target.ps1',
      'run-target.complete.json',
      'temp/',
      '.config/',
      '.local/',
      'Microsoft/',
    ]);
    const payloadArgsPath = path.join(payloadDir, 'launch-args-' + completionNonce + '.json');

    // TASK-AI-113: Windows caps a command line at ~32,767 characters. The
    // opencode-direct author prompt (TASK-AI-109 skill pack) blew past that and
    // every isolated launch failed with "The filename or extension is too
    // long". The prompt is the LAST positional arg from
    // harness.js opencodeDirect.launch; write it to a file inside workerRoot
    // and hand the model a short instruction that points at the file. The
    // file is UTF-8 with no BOM and is covered by the `.shipde/` git exclude
    // added above.
    // The isolated worker cannot read host paths, so the focused context pack
    // the Controller wrote on the host travels into .shipde/ with the prompt.
    let launchArgs = fullArgs.map((arg) =>
      typeof arg === 'string' ? stageContextPack(arg, payloadDir, completionNonce) : arg
    );
    if (adapter.id === 'opencode-direct') {
      if (directModelRewrite) {
        const modelIdx = launchArgs.indexOf('--model');
        if (modelIdx !== -1 && modelIdx + 1 < launchArgs.length) {
          launchArgs[modelIdx + 1] = directModelRewrite;
        }
      }
      if (launchArgs.length > 0) {
        const prompt = launchArgs[launchArgs.length - 1];
        if (typeof prompt === 'string' && prompt.length > 0) {
          const promptFileName = 'prompt-' + completionNonce + '.md';
          fs.writeFileSync(path.join(payloadDir, promptFileName), Buffer.from(prompt, 'utf8'));
          launchArgs = launchArgs
            .slice(0, -1)
            .concat(
              'Read the file .shipde/' +
                promptFileName +
                ' in the current directory. It is your complete task; follow it exactly.'
            );
        }
      }
    }

    fs.writeFileSync(payloadArgsPath, JSON.stringify(launchArgs), 'utf8');

    const scriptContent = buildWorkerLaunchScript({
      credPath,
      workerRoot,
      workerUsername: WORKER_USERNAME,
      exeFile: exe.file,
      exePrefixArgs: exe.prefixArgs || [],
      payloadArgsPath,
      launchResultPath,
      workerTimeoutMs,
      completionNonce,
      adapterId: adapter.id,
      model: opts.model || null,
      upstream: opts.upstream || null,
      isolationVerdict: verdictData,
      isolationVerdictPath: verdictPath,
      rtkPathPrepend,
      credentialEnv: selectedCredentialEnv,
      tokenBudget,
      progressTimeoutMs: opts.progressTimeoutMs || null,
      usageFile: opts.usageFile || null,
    });

    const tempScript = path.join(
      process.env.TEMP || 'C:\\temp',
      'isolated-launch-' + Date.now() + '.ps1'
    );
    fs.writeFileSync(tempScript, scriptContent, 'utf8');

    const hostRes = cp.spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempScript],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: workerTimeoutMs + 120000,
        maxBuffer: 16 * 1024 * 1024,
      }
    );

    try {
      fs.unlinkSync(tempScript);
    } catch (e) {}

    const launchResult = readLaunchResult(launchResultPath, completionNonce, hostRes);
    if (opts.usageFile && !fs.existsSync(opts.usageFile)) {
      const { writeUsageReportFromHarnessResult } = require('./orchestrate');
      const job = Object.assign({}, opts, opts.job, {
        harness: (adapter && adapter.id) || (opts.job && opts.job.harness),
        usageFile: opts.usageFile || (opts.job && opts.job.usageFile),
      });
      delete job.run;
      writeUsageReportFromHarnessResult(job, launchResult);
    }
    enforceTokenBudget(launchResult, opts.tokenBudget, opts.usageFile);
    if (exerciseResult) {
      launchResult.exercise = exerciseResult;
      launchResult.failBefore = exerciseResult.failBefore;
    }
    launchResult.carriedOver = carriedOver;
    launchResult.rtk = { provided: rtkEnabled, reason: rtkDecision };
    launchResult.tokenBudget = opts.tokenBudget || null;
    launchResult.workerRoot = launchResult.workerRoot || workerRoot;
    launchResult.worktree = launchResult.worktree || workerRoot;

    if (
      adapter?.id === 'codex' &&
      opts.commitFileOnlyWriter === true &&
      launchResult.exitCode === 0 &&
      !launchResult.timedOut
    ) {
      try {
        launchResult.workerSha = commitNativeWriterChanges({
          workerRoot,
          hostRoot: hostCwd,
          workItemId: opts.workItemId,
        });
        launchResult.retainedHeadSha = launchResult.workerSha;
      } catch {
        launchResult.exitCode = 1;
        launchResult.localFailure = 'NATIVE_WRITER_COMMIT_FAILED';
        launchResult.failureReason = 'NATIVE_WRITER_COMMIT_FAILED';
        delete launchResult.workerSha;
        delete launchResult.retainedHeadSha;
      }
    }

    // Ensure any modified register row or staged work item spec for a GOAL item
    // is committed into the workerSha so the PR contract passes
    if (
      adapter?.id !== 'codex' &&
      opts.workItemId &&
      typeof opts.workItemId === 'string' &&
      opts.workItemId.toUpperCase().startsWith('GOAL-') &&
      fs.existsSync(workerRoot) &&
      fs.existsSync(path.join(workerRoot, '.git'))
    ) {
      try {
        const amended = commitWorkerMetadata({
          hostRoot: hostCwd,
          workerRoot,
          workItemId: opts.workItemId,
          headSha: opts.headSha,
        });
        if (amended) {
          launchResult.workerSha = amended;
          launchResult.retainedHeadSha = amended;
        }
      } catch (error) {
        launchResult.exitCode = 1;
        launchResult.localFailure = 'WORKER_COMMIT_FAILED';
        launchResult.failureReason = String(error.message);
        launchResult.stderr = [launchResult.stderr, launchResult.failureReason]
          .filter(Boolean)
          .join('\n');
        delete launchResult.workerSha;
        delete launchResult.retainedHeadSha;
      }
    }

    if (
      !launchResult.localFailure &&
      !launchResult.workerSha &&
      fs.existsSync(workerRoot) &&
      fs.existsSync(path.join(workerRoot, '.git'))
    ) {
      try {
        const { withCleanGitEnv, safeGit } = require('./supervisor');
        const headSha = withCleanGitEnv(
          workerRoot,
          (safeGitDir) => {
            const curHeadRes = safeGit(
              safeGitDir,
              workerRoot,
              ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
              20000
            );
            return curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout
              ? curHeadRes.stdout.trim()
              : null;
          },
          { workerWritable: true }
        );
        if (headSha) {
          launchResult.workerSha = headSha;
          launchResult.retainedHeadSha = headSha;
        }
      } catch {}
    }
    return launchResult;
  };
}

/**
 * Reads the host-owned launch result for one launch.
 *
 * Q6: the file comes from LOCALAPPDATA\ShipDe\launch-results, never from
 * worker-writable workerRoot. PowerShell 5.1 writes it with a UTF-8 BOM, which
 * JSON.parse rejects, so the BOM is stripped exactly as it is for the verdict
 * and the approvals registry. Nothing here may fall back to the host process
 * status, which can be 0 for a job that never ran: an absent, unparsable,
 * timed-out or unproven result is a failed launch (exitCode -1), and only a
 * completed job carrying THIS launch's nonce returns the job's own exit code.
 */
function readLaunchResult(launchResultPath, completionNonce, hostRes) {
  const hostFailure = (reason) => ({
    exitCode: -1,
    stdout: (hostRes && hostRes.stdout) || '',
    stderr: [reason, String((hostRes && hostRes.stderr) || '').trim()].filter(Boolean).join('\n'),
    timedOut: Boolean(hostRes && hostRes.signal === 'SIGTERM'),
  });

  let resJson = null;
  try {
    if (!fs.existsSync(launchResultPath)) {
      throw new Error('the host script never wrote it');
    }
    const resultText = fs.readFileSync(launchResultPath, 'utf8');
    resJson = JSON.parse(resultText.charCodeAt(0) === 0xfeff ? resultText.slice(1) : resultText);
  } catch (e) {
    return hostFailure('[ISOLATION_LAUNCHER] launch result unreadable: ' + e.message);
  }

  const jobExit = Number(resJson.exitCode);
  let failureReason = undefined;
  if (typeof resJson.failureReason === 'string') {
    if (resJson.failureReason.startsWith('STALLED_NO_PROGRESS')) {
      failureReason = 'STALLED_NO_PROGRESS';
    } else if (resJson.failureReason.startsWith('TOKEN_BUDGET_EXCEEDED')) {
      failureReason = 'TOKEN_BUDGET_EXCEEDED';
    } else if (resJson.failureReason.startsWith('REQUEST_TOO_LARGE')) {
      failureReason = 'REQUEST_TOO_LARGE';
    } else if (resJson.failureReason.length > 0) {
      failureReason = resJson.failureReason;
    }
  } else if (resJson.budgetExceeded) {
    failureReason = 'TOKEN_BUDGET_EXCEEDED';
  } else if (resJson.requestTooLarge) {
    failureReason = 'REQUEST_TOO_LARGE';
  }

  if (
    resJson.timedOut === true ||
    resJson.completed !== true ||
    resJson.completionNonce !== completionNonce ||
    !Number.isFinite(jobExit)
  ) {
    return {
      exitCode: -1,
      stdout: String(resJson.stdout || ''),
      stderr: String(resJson.stderr || ''),
      timedOut: resJson.timedOut === true,
      ...(resJson.progressDetail ? { progressDetail: String(resJson.progressDetail) } : {}),
      ...(failureReason ? { failureReason } : {}),
    };
  }

  return {
    exitCode: resJson.localFailure ? 1 : jobExit,
    stdout: String(resJson.stdout || ''),
    stderr: [String(resJson.localFailure || ''), String(resJson.stderr || '')]
      .filter(Boolean)
      .join('\n'),
    localFailure: resJson.localFailure ? String(resJson.localFailure) : null,
    timedOut: false,
    verifiedToolCalls: Number(resJson.verifiedToolCalls) || 0,
    completionNonce: resJson.completionNonce,
    ...(resJson.sessionId ? { sessionId: resJson.sessionId } : {}),
    ...(resJson.launchHandle ? { launchHandle: resJson.launchHandle } : {}),
    ...(resJson.workerSha ? { workerSha: resJson.workerSha } : {}),
    ...(resJson.workerRoot ? { workerRoot: resJson.workerRoot } : {}),
    ...(resJson.usage ? { usage: resJson.usage } : {}),
    ...(resJson.progressDetail ? { progressDetail: String(resJson.progressDetail) } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
}

module.exports = {
  provisionedHeadMatchesBase,
  commitNativeWriterChanges,
  commitWorkerMetadata,
  validateWorkerGitConfig,
  isWorkerConfigKeyAllowed,
  getIsolatedLauncher,
  getFolderHash,
  defaultVerifyBoundary,
  buildBoundaryVerifyScript,
  buildWorkerLaunchScript,
  workerRootFor,
  isWorkerPath,
  readClosedIsolationVerdict,
  appendGitInfoExclude,
  carryOverSave,
  carryOverRestore,
  materialiseExercise,
  captureFailBefore,
  WORKER_USERNAME,
  WORKER_ROOT,
  readLaunchResult,
  EXPECTED_FIREWALL_RULES,
  DEFAULT_WORKER_TIMEOUT_MS,
  enforceTokenBudget,
  ensureGoalRegistrationInWorker,
};
