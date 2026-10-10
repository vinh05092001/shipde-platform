'use strict';

/**
 * Ship Dễ — Controller intake (TASK-AI-131)
 *
 * One command turns a Work Item ID into a full Controller run with no
 * hand-written inputs:
 *
 *   node tools/ai-brain/cli.js intake --work-item <ID> [--run] [--publish]
 *
 * Every orchestrate input is built from repository sources only. The derived
 * spec, the goal, the live catalogue and the accounts registry are written to
 * a run directory under tools/ai-brain/data/intake/<ID>-<timestamp>/, and the
 * exact orchestrate command is composed from policy (never from hand-typed
 * values). With --run the isolation pre-flight is checked and orchestrate is
 * started; without it the command is printed for the operator.
 *
 * Rules this module enforces (AGENTS.md: the controller may not invent product
 * meaning): a missing or ambiguous source section refuses with
 * INTAKE_INCOMPLETE and names exactly what is missing. Nothing here guesses a
 * business rule, an acceptance criterion or a model id — the model catalogue is
 * discovered live and no model id literal may appear in this file.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const sourcesApi = require('./sources');
const evidenceApi = require('./evidence');
const accountsApi = require('./accounts');
const factsApi = require('./facts');
const { parseDependencies } = require('./reconcile');
const { ISOLATION_VERDICT_HUMAN_ACTION } = require('./failure-classifier');
const { httpGetModels } = require('./discovery/http');

const ROLE_DEFAULT = 'author.foundation';
const COMPLEXITY_DEFAULT = 'standard';
const REVIEW_BUDGET = '2';
const WORKER_TIMEOUT_MIN = '60';
const EXTERNAL_WORKERS_VALUE = 'agy-pool';
const ISOLATION_VERDICT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const REGISTER_REL = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);
const WORK_ITEMS_REL = path.join('docs', 'product-spec', 'work-items');

function intakeError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

function stripTicks(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/`/g, '')
    .trim();
}

function unique(list) {
  return [...new Set(list)];
}

function extractBackticks(text) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].trim());
  return out;
}

function splitCells(line) {
  const cells = String(line)
    .split('|')
    .map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** Every markdown table row in the document, as trimmed cell arrays. */
function tableRows(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    rows.push(splitCells(line));
  }
  return rows;
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c));
}

/** The value cell of the Control row labelled with one of `labels`. */
function controlValue(text, labels) {
  const wanted = labels.map((l) => l.toLowerCase());
  for (const cells of tableRows(text)) {
    if (cells.length < 2 || isSeparatorRow(cells)) continue;
    const label = stripTicks(cells[0])
      .toLowerCase()
      .replace(/[:\s]+$/, '');
    if (wanted.includes(label)) return cells[1];
  }
  return null;
}

/** The body of a `##` section, up to the next `##` heading. */
function sectionBody(text, headingRe) {
  const lines = String(text || '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headingRe.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return '';
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function pathLike(token) {
  return /[\\/]/.test(token) || /\.[a-z0-9]+$/i.test(token);
}

function deriveAllowedPaths(text) {
  const value = controlValue(text, ['allowed paths', 'allowed files']);
  let tokens = value ? extractBackticks(value) : [];
  if (tokens.length === 0 && value) {
    tokens = String(value)
      .split(/[;,]/)
      .map((s) => stripTicks(s))
      .filter(Boolean);
  }
  let paths = tokens.map(stripTicks).filter(pathLike);
  if (paths.length === 0) {
    const body = sectionBody(text, /^##\s+(Allowed|Scope)\b/i);
    paths = extractBackticks(body).filter(pathLike);
  }
  return unique(paths);
}

function deriveAcceptanceCriteria(text) {
  const body = sectionBody(text, /^##\s+Acceptance\b/i);
  if (!body) return [];
  const rows = [];
  for (const line of body.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = splitCells(line);
    if (isSeparatorRow(cells)) continue;
    rows.push(cells);
  }
  // rows[0] is the header; every following row is one acceptance criterion.
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const parts = rows[i]
      .slice(0, 3)
      .map((c) => stripTicks(c))
      .filter(Boolean);
    if (parts.length) out.push(parts.join(' | '));
  }
  return out;
}

function parseCommandBullets(body) {
  const out = [];
  for (const line of String(body || '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!m) continue;
    const content = m[1].trim();
    const ticks = extractBackticks(content);
    const cmd = ticks.length ? ticks[0] : content.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (cmd) out.push(cmd);
  }
  return out;
}

function deriveVerificationCommands(text) {
  return parseCommandBullets(sectionBody(text, /^##\s+Verification\b/i));
}

function foundationCommands(root, deps) {
  if (Array.isArray(deps.foundationCommands)) return deps.foundationCommands;
  try {
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    return parseCommandBullets(sectionBody(agents, /^##\s+Foundation verification commands\b/i));
  } catch {
    return [];
  }
}

function deriveGoal(text) {
  return sectionBody(text, /^##\s+(Business\s+Outcome|Outcome)\b/i);
}

const RISK_DOMAIN_PATTERNS = Object.freeze({
  auth: /\b(?:auth(?:entication|orization)?|login|password|session|mfa|credential)\b/i,
  security: /\b(?:security|secret|encryption|vulnerability|threat|permission|access control)\b/i,
  money: /\b(?:money|payment|financial|settlement|cod|refund|billing|price|amount|bank)\b/i,
  'tenant isolation': /\b(?:tenant|multi-tenant|cross-tenant|shop isolation)\b/i,
  PII: /\b(?:pii|personal data|personal information|recipient data|phone number|email address)\b/i,
  'carrier side effects': /\b(?:carrier|waybill|shipment|redelivery|cancel|claim|pickup)\b/i,
  'database ownership': /\b(?:database|schema|migration|prisma|sql|persistence)\b/i,
});

function deriveRiskDomains(text) {
  const explicit = controlValue(text, ['risk domains', 'risk domain']);
  if (explicit) {
    const normalized = explicit.toLowerCase();
    return Object.keys(RISK_DOMAIN_PATTERNS).filter((domain) =>
      normalized.includes(domain.toLowerCase())
    );
  }
  const scope = sectionBody(text, /^##\s+(?:In Scope|Scope|Acceptance Matrix|Acceptance)\b/i);
  const acceptance = sectionBody(text, /^##\s+Acceptance(?: Matrix)?\b/i);
  const evidence = [scope, acceptance].filter(Boolean).join('\n');
  return Object.entries(RISK_DOMAIN_PATTERNS)
    .filter(([, pattern]) => pattern.test(evidence))
    .map(([domain]) => domain);
}

function deriveComplexity(text, acceptanceCriteria, riskDomains, allowedPaths) {
  const acCount = acceptanceCriteria.length;
  const layers = new Set();
  const scope = sectionBody(text, /^##\s+(?:In Scope|Scope)\b/i);
  const material = scope + '\n' + allowedPaths.join('\n');
  if (/\b(?:database|schema|migration|prisma|persistence|storage)\b/i.test(material))
    layers.add('database');
  if (/\b(?:api|endpoint|route|service|backend|controller)\b/i.test(material)) layers.add('api');
  if (/\b(?:ui|screen|page|frontend|user interface)\b/i.test(material)) layers.add('ui');
  if (/\b(?:worker|job|queue|event|webhook)\b/i.test(material)) layers.add('async');
  if (/\b(?:carrier|provider|external integration)\b/i.test(material)) layers.add('external');
  if ((riskDomains.includes('auth') || riskDomains.includes('security')) && acCount >= 15)
    return 'complex';
  if (riskDomains.length >= 2 || acCount >= 15 || layers.size >= 3) return 'complex';
  if (acCount >= 8 || layers.size >= 2 || riskDomains.length === 1) return 'large';
  return 'standard';
}

/**
 * Derive every spec field from repository sources. Returns the normalized
 * spec item, the goal, and the list of fields that could not be derived.
 */
function deriveSpec({ id, workItemText, registerItem, root, deps }) {
  const missing = [];

  const namedRole = controlValue(workItemText, ['role']);
  const role = namedRole ? stripTicks(namedRole) : ROLE_DEFAULT;

  const allowedPaths = deriveAllowedPaths(workItemText);
  if (allowedPaths.length === 0) missing.push('allowedPaths');

  if (!registerItem) missing.push('register row');
  const dependencies = registerItem ? parseDependencies(registerItem.dependencies) : [];

  const acceptanceCriteria = deriveAcceptanceCriteria(workItemText);
  if (acceptanceCriteria.length === 0) missing.push('acceptanceCriteria');

  const riskDomains = deriveRiskDomains(workItemText);
  const complexity = deriveComplexity(workItemText, acceptanceCriteria, riskDomains, allowedPaths);

  let verificationCommands = deriveVerificationCommands(workItemText);
  if (verificationCommands.length === 0) verificationCommands = foundationCommands(root, deps);
  if (verificationCommands.length === 0) missing.push('verification');

  const verification = { command: verificationCommands.join(' && '), expect: '' };

  const goal = deriveGoal(workItemText);
  if (!goal) missing.push('goal');

  const specItem = {
    id,
    role,
    complexity,
    riskDomains,
    allowedPaths: allowedPaths.slice(),
    files: allowedPaths.slice(),
    dependencies: dependencies.slice(),
    acceptanceCriteria: acceptanceCriteria.slice(),
    verification,
  };

  return {
    specItem,
    goal,
    missing,
    role,
    complexity,
    riskDomains,
    allowedPaths,
    dependencies,
    acceptanceCriteria,
    verification,
  };
}

function readRegisterRow(root, id, deps) {
  if (typeof deps.readRegisterRow === 'function') return deps.readRegisterRow(id);
  let content;
  try {
    content = fs.readFileSync(path.join(root, REGISTER_REL), 'utf8');
  } catch {
    return null;
  }
  try {
    const adapter = require('../ai-dashboard/register-adapter');
    const items = adapter.parseRegisterCsv(content, root) || [];
    return items.find((it) => it.work_item_id === id) || null;
  } catch {
    return null;
  }
}

function readRegisterRows(root, deps) {
  if (typeof deps.readRegisterRows === 'function') return deps.readRegisterRows();
  const content = fs.readFileSync(path.join(root, REGISTER_REL), 'utf8');
  const adapter = require('../ai-dashboard/register-adapter');
  return adapter.parseRegisterCsv(content, root) || [];
}

function dependencyHistory(root, baseSha, deps) {
  if (typeof deps.readHistory === 'function') return deps.readHistory(baseSha);
  return cp
    .execFileSync('git', ['log', '--format=%H%x09%s', baseSha], {
      cwd: root,
      encoding: 'utf8',
    })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

function resolveDependencies(root, baseSha, dependencies, deps) {
  const registerRows = readRegisterRows(root, deps);
  let history;
  const getHistory = () => {
    if (!history) history = dependencyHistory(root, baseSha, deps);
    return history;
  };
  const resolved = [];
  const unmerged = [];
  for (const id of dependencies) {
    const row = registerRows.find((item) => item.work_item_id === id);
    const registeredSha = row && String(row.merge_commit || '').trim();
    const registerConfirmsMerged =
      row &&
      String(row.status || '')
        .trim()
        .toUpperCase() === 'MERGED' &&
      registeredSha;
    const historical = registerConfirmsMerged
      ? null
      : getHistory().find(
          (entry) => entry.subject.includes('[' + id + ']') && /\(#\d+\)/.test(entry.subject)
        );
    if (
      row &&
      String(row.status || '')
        .trim()
        .toUpperCase() === 'MERGED'
    ) {
      const commitSha = String(row.merge_commit || '').trim() || (historical && historical.sha);
      if (!commitSha) {
        unmerged.push(id + ' (MERGED register row has no merge commit SHA)');
        continue;
      }
      resolved.push({ id, commitSha, source: 'register' });
    } else if (historical) {
      resolved.push({ id, commitSha: historical.sha, source: 'history' });
    } else {
      unmerged.push(id);
    }
  }
  if (unmerged.length) {
    throw intakeError('DEPENDENCY_NOT_MERGED', 'DEPENDENCY_NOT_MERGED: ' + unmerged.join(', '), {
      dependencies: unmerged,
    });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Live catalogue discovery (IN-R03). No model id literal appears above or
// below: every id is read from a listing at run time.
// ---------------------------------------------------------------------------

function joinUrl(root, suffix) {
  if (!suffix) return String(root || '');
  return String(root || '').replace(/\/+$/, '') + '/' + String(suffix).replace(/^\/+/, '');
}

/**
 * Extract model id strings from an arbitrary listing document. It accepts an
 * array of strings, an array of {id|model|name} objects, or a wrapper object
 * with a `models` / `data` / `items` / `results` / `list` array. It knows
 * nothing about any particular model.
 */
function extractModelIds(node) {
  if (!node) return [];
  if (typeof node === 'string') return node.trim() ? [node.trim()] : [];
  if (Array.isArray(node)) return node.flatMap(extractModelIds);
  if (typeof node === 'object') {
    for (const key of ['models', 'data', 'items', 'results', 'list']) {
      if (Array.isArray(node[key])) return node[key].flatMap(extractModelIds);
    }
    const id = node.id || node.model || node.name;
    if (typeof id === 'string' && id.trim()) return [id.trim()];
  }
  return [];
}

function parseModelListing(output) {
  const s = String(output || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!s) return [];
  try {
    return extractModelIds(JSON.parse(s));
  } catch {
    // not JSON — fall through to one id per whitespace-free line
  }
  const models = [];
  for (const line of s.split(/\r?\n/)) {
    const t = line
      .trim()
      .replace(/^[-*]\s+/, '')
      .replace(/^["']|["']$/g, '');
    if (t && !/\s/.test(t)) models.push(t);
  }
  return models;
}

async function realRead9routerModels(deps) {
  try {
    const registry = deps.sourcesRegistry || sourcesApi.loadSources();
    const source = (registry.sources || []).find(
      (s) => s && s.endpoint && s.verify && s.verify.method === 'models-list'
    );
    if (!source) return { ok: false, error: 'no models-list source registered' };
    const url = joinUrl(source.endpoint, (source.verify && source.verify.path) || '/models');
    const envName = source.credential && source.credential.env;
    const res = await (deps.httpGet || httpGetModels)(url, { envName });
    if (!res || !res.ok || !res.parsed) {
      return {
        ok: false,
        error: (res && (res.error || 'http ' + (res.status || 0))) || 'unavailable',
      };
    }
    const data = res.parsed.data;
    if (!Array.isArray(data)) return { ok: false, error: 'models listing had no data array' };
    return { ok: true, models: extractModelIds(data) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function realReadAgyModels(deps) {
  try {
    const output = deps.runAgyModels ? await deps.runAgyModels() : runAgyModelsCommand();
    return { ok: true, models: parseModelListing(output) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function runAgyModelsCommand() {
  const res = cp.spawnSync('agy', ['models'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error('agy models exited ' + res.status);
  return res.stdout || '';
}

async function realReadEvidenceModels(deps) {
  try {
    const dir = path.join(deps.root, 'tools', 'ai-brain', 'data', 'evidence');
    const data = deps.readEvidence ? await deps.readEvidence() : evidenceApi.loadEvidence(dir);
    const models = [];
    for (const combo of (data && data.combinations) || []) {
      const id = combo && (combo.modelId || combo.model);
      if (typeof id === 'string' && id.trim()) models.push(id.trim());
    }
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/**
 * Merge the live catalogue from every source. A failing source is recorded as
 * a warning and the others are used. If the merged catalogue is empty (every
 * source failed or returned nothing) it refuses with CATALOGUE_UNAVAILABLE.
 */
async function buildCatalogue(deps) {
  const collectors = [
    { name: '9router', read: () => (deps.read9routerModels || realRead9routerModels)(deps) },
    { name: 'agy', read: () => (deps.readAgyModels || realReadAgyModels)(deps) },
    { name: 'evidence', read: () => (deps.readEvidenceModels || realReadEvidenceModels)(deps) },
  ];
  const warnings = [];
  const sourceStatus = {};
  const models = new Set();
  for (const collector of collectors) {
    let result;
    try {
      result = await collector.read();
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    }
    if (result && result.ok) {
      sourceStatus[collector.name] = 'ok';
      for (const model of result.models || []) if (model) models.add(model);
    } else {
      sourceStatus[collector.name] = 'failed';
      warnings.push({ source: collector.name, error: (result && result.error) || 'unavailable' });
    }
  }
  return normalizeCatalogue([...models], warnings, sourceStatus);
}

function normalizeCatalogue(models, warnings, sourceStatus) {
  const list = [...new Set(models.filter((model) => model))].sort();
  if (list.length === 0) {
    throw intakeError(
      'CATALOGUE_UNAVAILABLE',
      'CATALOGUE_UNAVAILABLE: no live model listing source produced any model'
    );
  }
  return { models: list, warnings: warnings || [], sourceStatus: sourceStatus || {} };
}

/**
 * Build the catalogue, honouring an injected builder so hermetic callers never
 * reach a live model listing. The injected builder may return either a model
 * array or the same `{ models, warnings, sourceStatus }` shape this module
 * produces; both are normalised here and an empty catalogue still refuses with
 * CATALOGUE_UNAVAILABLE.
 */
async function resolveCatalogue(deps) {
  if (typeof deps.buildCatalogue !== 'function') return buildCatalogue(deps);
  const injected = await deps.buildCatalogue(deps);
  if (Array.isArray(injected)) return normalizeCatalogue(injected, [], {});
  const value = injected || {};
  return normalizeCatalogue(value.models || [], value.warnings, value.sourceStatus);
}

// ---------------------------------------------------------------------------
// Accounts (IN-R04) and agy-pool quota (IN-R05).
// ---------------------------------------------------------------------------

function readingHasQuota(reading) {
  if (!reading || reading.available !== true) return false;
  const rows = Array.isArray(reading.rows) ? reading.rows : [];
  const exhausted =
    rows.length > 0 &&
    rows.every(
      (row) =>
        (Number.isFinite(row.remainingPercent) && Number(row.remainingPercent) <= 0) ||
        row.disabled === true
    );
  return !exhausted;
}

function agyPoolHasQuota(deps) {
  if (typeof deps.hasAgyPoolQuota === 'function') return deps.hasAgyPoolQuota();
  if (deps.hasAgyPoolQuota !== undefined) return Boolean(deps.hasAgyPoolQuota);
  try {
    const pool = require('./agy-pool-runtime');
    const quotaStore = require('./quota-store');
    const store = quotaStore.loadStore(deps.quotaStoreOpts);
    const entries = Object.entries((store && store.accounts) || {});
    for (const [accountId, reading] of entries) {
      if (!pool.isValidAccountId(accountId)) continue;
      if (readingHasQuota(reading)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function revParseOriginMain(root, deps) {
  if (typeof deps.baseSha === 'function') return deps.baseSha();
  if (typeof deps.baseSha === 'string' && deps.baseSha) return deps.baseSha.trim();
  if (typeof deps.revParse === 'function') return deps.revParse('origin/main');
  const out = cp.execSync('git rev-parse origin/main', { cwd: root, encoding: 'utf8' });
  return out.trim();
}

// ---------------------------------------------------------------------------
// Policy command (IN-R05) and isolation pre-flight (IN-R06).
// ---------------------------------------------------------------------------

function quoteArg(value) {
  const s = String(value);
  return /\s/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
}

function composeOrchestrateCommand({
  root,
  runDir,
  baseSha,
  repoRoot,
  hasAgyPoolQuota,
  publish,
  decisionDir,
}) {
  const cli = path.join(root, 'tools', 'ai-brain', 'cli.js');
  const runFiles = {
    goal: path.join(runDir, 'goal.txt'),
    specs: path.join(runDir, 'specs.json'),
    catalogue: path.join(runDir, 'catalogue.json'),
    accounts: path.join(runDir, 'accounts.json'),
    checkpoint: path.join(runDir, 'checkpoint.json'),
    decisionDir: decisionDir || path.join(runDir, 'decisions'),
  };
  const argv = [
    'node',
    cli,
    'orchestrate',
    '--goal',
    runFiles.goal,
    '--specs',
    runFiles.specs,
    '--catalogue',
    runFiles.catalogue,
    '--accounts',
    runFiles.accounts,
    '--isolated-worker',
    '--review-budget',
    REVIEW_BUDGET,
    '--worker-timeout-min',
    WORKER_TIMEOUT_MIN,
    '--base-sha',
    baseSha,
    '--cwd',
    repoRoot,
    '--checkpoint',
    runFiles.checkpoint,
    '--decision-dir',
    runFiles.decisionDir,
  ];
  if (hasAgyPoolQuota) argv.push('--external-workers', EXTERNAL_WORKERS_VALUE);
  if (publish) argv.push('--publish');
  return { argv, command: argv.map(quoteArg).join(' '), runFiles };
}

function defaultVerdictPath() {
  return path.join(process.env.LOCALAPPDATA || '', 'ShipDe', 'isolation-verdict.json');
}

/**
 * Read-only isolation pre-flight: the verdict must be fresh (24h) and the
 * pinned base must be contained in local main. This never changes an ACL or a
 * policy; a stale verdict refuses and names the refresh command.
 */
function assertIsolationFresh({ verdictPath, now, stat, baseSha, isAncestorOf, root }) {
  const p = verdictPath;
  let st;
  try {
    st = stat(p);
  } catch {
    throw intakeError(
      'ISOLATION_VERDICT_MISSING',
      'ISOLATION_VERDICT_MISSING: cannot read ' + p + '; ' + ISOLATION_VERDICT_HUMAN_ACTION,
      { humanAction: ISOLATION_VERDICT_HUMAN_ACTION }
    );
  }
  const mtimeMs =
    st && typeof st.mtimeMs === 'number' ? st.mtimeMs : Date.parse((st && st.mtime) || 0);
  if (!(mtimeMs >= 0) || now - mtimeMs > ISOLATION_VERDICT_MAX_AGE_MS) {
    throw intakeError(
      'ISOLATION_VERDICT_STALE',
      'ISOLATION_VERDICT_STALE: ' + p + ' is older than 24h; ' + ISOLATION_VERDICT_HUMAN_ACTION,
      { humanAction: ISOLATION_VERDICT_HUMAN_ACTION }
    );
  }
  if (!isAncestorOf(baseSha, 'main', root)) {
    throw intakeError(
      'BASE_SHA_NOT_IN_LOCAL_MAIN',
      'base sha ' + baseSha + ' is not contained in local main'
    );
  }
}

function formatRunTimestamp(now) {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

function defaultSpawn(argv, root) {
  return cp.spawn(argv[0], argv.slice(1), { stdio: 'inherit', cwd: root });
}

/**
 * Build every orchestrate input from repository sources.
 *
 * @param opts { workItem, run, publish }
 * @param deps injectable collaborators (root, now, httpGet, runAgyModels,
 *   readEvidence, listAccounts, baseSha, hasAgyPoolQuota, verdictPath, stat,
 *   isAncestorOf, spawnCommand, ...) so tests never touch real endpoints.
 * @returns Promise<{ id, runDir, goal, spec, catalogue, warnings, command, ... }>
 */
async function runIntake(opts, deps) {
  const o = opts || {};
  const d = deps || {};
  const id = String(o.workItem || '').trim();
  if (!id) {
    throw intakeError('INTAKE_INCOMPLETE', 'INTAKE_INCOMPLETE: --work-item is required');
  }
  const root = path.resolve(d.root || path.join(__dirname, '..', '..'));
  const now = typeof d.now === 'function' ? d.now() : d.now || Date.now();

  let workItemText;
  try {
    workItemText = fs.readFileSync(path.join(root, WORK_ITEMS_REL, id + '.md'), 'utf8');
  } catch {
    throw intakeError('INTAKE_INCOMPLETE', 'INTAKE_INCOMPLETE: work item not found: ' + id, {
      missing: ['work item ' + id],
    });
  }

  const registerItem = readRegisterRow(root, id, d);
  const derived = deriveSpec({ id, workItemText, registerItem, root, deps: d });
  if (derived.missing.length > 0) {
    throw intakeError(
      'INTAKE_INCOMPLETE',
      'INTAKE_INCOMPLETE: missing or ambiguous derivation sources: ' + derived.missing.join('; '),
      { missing: derived.missing.slice() }
    );
  }

  const baseSha = revParseOriginMain(root, d);
  const resolvedDependencies = resolveDependencies(root, baseSha, derived.dependencies, d);
  derived.specItem.dependencies = derived.dependencies.filter(
    (dependency) => !resolvedDependencies.some((resolved) => resolved.id === dependency)
  );

  const catalogue = await resolveCatalogue(Object.assign({}, d, { root }));
  const accounts = await (typeof d.listAccounts === 'function'
    ? d.listAccounts(d.accountOptions || {})
    : accountsApi.listAccounts(d.accountOptions || {}));

  const repoRoot = path.resolve(root);
  const hasPoolQuota = Boolean(agyPoolHasQuota(d));

  const runDir = path.join(
    root,
    'tools',
    'ai-brain',
    'data',
    'intake',
    id + '-' + formatRunTimestamp(now)
  );
  const targetDecisionDir = o.decisionDir || d.decisionDir || path.join(runDir, 'decisions');
  fs.mkdirSync(path.join(runDir, 'decisions'), { recursive: true });
  if (targetDecisionDir !== path.join(runDir, 'decisions')) {
    fs.mkdirSync(targetDecisionDir, { recursive: true });
  }
  fs.writeFileSync(path.join(runDir, 'goal.txt'), derived.goal);
  fs.writeFileSync(path.join(runDir, 'specs.json'), JSON.stringify([derived.specItem], null, 2));
  fs.writeFileSync(
    path.join(runDir, 'derivation.json'),
    JSON.stringify(
      {
        complexity: derived.complexity,
        acceptanceCriteriaCount: derived.acceptanceCriteria.length,
        riskDomains: derived.riskDomains,
        riskDomainSource: controlValue(workItemText, ['risk domains', 'risk domain'])
          ? 'explicit-work-item-field'
          : 'scope-and-acceptance-keywords',
        allowedPaths: derived.allowedPaths,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(runDir, 'resolved-dependencies.json'),
    JSON.stringify(resolvedDependencies, null, 2)
  );
  fs.writeFileSync(path.join(runDir, 'catalogue.json'), JSON.stringify(catalogue.models, null, 2));
  fs.writeFileSync(path.join(runDir, 'accounts.json'), JSON.stringify(accounts, null, 2));

  const { argv, command, runFiles } = composeOrchestrateCommand({
    root,
    runDir,
    baseSha,
    repoRoot,
    hasAgyPoolQuota: hasPoolQuota,
    publish: Boolean(o.publish),
    decisionDir: o.decisionDir || d.decisionDir,
  });

  const result = {
    id,
    runDir,
    goal: derived.goal,
    spec: derived.specItem,
    resolvedDependencies,
    catalogue: catalogue.models,
    warnings: catalogue.warnings,
    sourceStatus: catalogue.sourceStatus,
    accounts,
    baseSha,
    repoRoot,
    hasAgyPoolQuota: hasPoolQuota,
    command,
    argv,
    runFiles,
    ran: false,
    status: o.run ? 'launched' : 'prepared',
  };

  if (o.run) {
    assertIsolationFresh({
      verdictPath: d.verdictPath || defaultVerdictPath(),
      now,
      stat: d.stat || ((p) => fs.statSync(p)),
      baseSha,
      isAncestorOf: d.isAncestorOf || ((sha, ref) => factsApi.isAncestorOf(sha, ref, root)),
      root,
    });
    result.child = (d.spawnCommand || defaultSpawn)(argv, root);
    result.ran = true;
    if (o.wait && result.child && typeof result.child.on === 'function') {
      const exitCode = await new Promise((resolve) => {
        let settled = false;
        const done = (code) => {
          if (!settled) {
            settled = true;
            resolve(typeof code === 'number' ? code : 0);
          }
        };
        result.child.on('close', (c) => done(c));
        result.child.on('exit', (c) => done(c));
        result.child.on('error', () => done(1));
      });
      result.exitCode = exitCode;
      result.status = exitCode === 0 ? 'completed' : 'failed';
    }
  }

  return result;
}

module.exports = {
  runIntake,
  deriveSpec,
  resolveDependencies,
  buildCatalogue,
  composeOrchestrateCommand,
  assertIsolationFresh,
  parseModelListing,
  extractModelIds,
  readingHasQuota,
  intakeError,
  ROLE_DEFAULT,
  COMPLEXITY_DEFAULT,
  REVIEW_BUDGET,
  WORKER_TIMEOUT_MIN,
  EXTERNAL_WORKERS_VALUE,
  ISOLATION_VERDICT_MAX_AGE_MS,
};
