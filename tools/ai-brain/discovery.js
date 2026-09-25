'use strict';

/**
 * Ship Dễ — model discovery CLI (W2)
 *
 *   node tools/ai-brain/discovery.js run [--json]
 *       Enumerate every registry source, diff against the evidence store and
 *       append state transitions; write one snapshot per run.
 *
 *   node tools/ai-brain/discovery.js import checkpoint|outer [--json]
 *       Carry one historical log forward as dated evidence (never live state).
 *
 *   node tools/ai-brain/discovery.js status [--json]
 *       Print the last written state per candidate and per-state counts.
 *
 *   node tools/ai-brain/discovery.js adapters [--json]
 *       Print the kind->adapter matrix and what each source will do.
 *
 * The registry is sources.json; nothing in this module hard-codes a source id.
 * The store belongs under tools/ai-brain/data/discovery and is committed.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const REGISTRY_FILE = path.join(ROOT, 'sources.json');
const DEFAULT_DATA_DIR = path.join(ROOT, 'data', 'discovery');

const { httpGetModels } = require('./discovery/http');
const { resolveCommand, runCommand } = require('./discovery/spawn');
const { registryPrefixes } = require('./discovery/identity');
const { enumerate } = require('./discovery/adapters');
const { reconcileRun } = require('./discovery/reconcile');
const { readCatalogue, appendLine, STATES } = require('./discovery/store');
const { importCheckpoint, importOuter } = require('./discovery/import');
const { ADAPTERS, NOT_PERMITTED, RECALL, recall } = require('./discovery/adapters');
const { readDiscoveryCatalogue } = require('./discovery/read');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
}

function slugDate(iso) {
  return String(iso)
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
    .slice(0, 15);
}

async function enumerateRegistry(registry, ctx) {
  const sources = (registry.sources || []).filter((s) => s && s.id && !recall(s.id));
  const results = new Map();
  const lookupRoute = (id) => results.get(id);
  const fullCtx = { ...ctx, lookupRoute };

  const routers = sources.filter((s) => s.kind === 'router');
  const rest = sources.filter((s) => s.kind !== 'router');
  for (const source of [...routers, ...rest]) {
    results.set(source.id, await enumerate(source, fullCtx));
  }
  return results;
}

async function cmdRun(flags) {
  const registry = loadRegistry();
  const prefixes = registryPrefixes(registry);
  const dataDir = flags['data-dir'] || DEFAULT_DATA_DIR;
  const storeFile = flags['store-file'] || path.join(dataDir, 'catalogue.jsonl');
  const snapDir = flags['snap-dir'] || path.join(dataDir, 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });

  const now = new Date().toISOString();
  const runId = `${slugDate(now)}-${Math.random().toString(36).slice(2, 8)}`;

  const ctx = {
    registry,
    httpGet: (url, opts) => httpGetModels(url, { envName: opts && opts.envName }),
    runCommand,
    resolveCommand: (name) => classifyPresence(resolveCommand(name, {})),
  };

  const results = await enumerateRegistry(registry, ctx);
  const resultsObj = {};
  for (const [id, res] of results) resultsObj[id] = res;

  const current = currentStateOf(readCatalogue(storeFile));
  const reconciled = reconcileRun({
    registry,
    prefixes,
    results: resultsObj,
    current,
    now,
    runId,
  });

  const snapFile = path.join(snapDir, `snapshot-${runId}.json`);
  fs.writeFileSync(snapFile, JSON.stringify(reconciled.snapshot, null, 2) + '\n', 'utf8');
  for (const line of reconciled.transitions) {
    appendLine(storeFile, line);
  }

  return {
    runId,
    dataDir: dataDir.replace(/\\/g, '/'),
    storeFile: storeFile.replace(/\\/g, '/'),
    snapshotFile: snapFile.replace(/\\/g, '/'),
    sources: [...results].map(([id, res]) => ({
      id,
      kind: (registry.sources.find((s) => s.id === id) || {}).kind,
      status: res.status,
      reason: res.reason,
      advertised: reconciled.perSourceNarrow[id] ? reconciled.perSourceNarrow[id].advertised : 0,
      catalogs: (res.catalogs || []).map((c) => ({ upstream: c.upstream, count: c.count })),
    })),
    perState: reconciled.perState,
    aliases: reconciled.snapshot.aliases.length,
    writeSkipped: current.size ? reconciled.transitions.length : null,
  };
}

function classifyPresence(resolved) {
  if (resolved.error) return { found: false, error: resolved.error };
  return { found: true, kind: resolved.kind, file: resolved.file };
}

function currentStateOf(lines) {
  const { currentState } = require('./discovery/store');
  return currentState(lines);
}

async function cmdImport(which, flags) {
  const registry = loadRegistry();
  const prefixes = registryPrefixes(registry);
  const dataDir = flags['data-dir'] || DEFAULT_DATA_DIR;
  const outDir = path.join(dataDir, 'imports');
  fs.mkdirSync(outDir, { recursive: true });
  const sourceFile =
    flags['file'] ||
    path.join(
      path.dirname(path.dirname(path.dirname(ROOT))),
      'logs',
      'catalogue',
      which === 'outer' ? 'outer.jsonl' : 'checkpoint.jsonl'
    );
  const now = new Date().toISOString();
  const stamp = String(now).replace(/[-:]/g, '').slice(0, 15);

  if (which === 'outer') {
    const entry = await importOuter(sourceFile, { prefixes, now });
    const outFile = path.join(outDir, `outer-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    return {
      kind: 'outer',
      file: sourceFile.replace(/\\/g, '/'),
      outFile: outFile.replace(/\\/g, '/'),
      summary: entry.summary,
      totalRows: entry.totalRows,
    };
  }

  const entry = await importCheckpoint(sourceFile, { prefixes, now });
  const outFile = path.join(outDir, `checkpoint-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return {
    kind: 'checkpoint',
    file: sourceFile.replace(/\\/g, '/'),
    outFile: outFile.replace(/\\/g, '/'),
    totalRows: entry.totalRows,
    malformedRows: entry.malformedRows,
    rowsWithModel: entry.rowsWithModel,
    probeInvalid: entry.probeInvalid,
    failuresByClass: entry.failuresByClass,
    failureTotal: entry.failureTotal,
    passes: entry.passes,
    candidateCount: entry.candidateCount,
  };
}

function cmdStatus(flags) {
  const dataDir = flags['data-dir'] || DEFAULT_DATA_DIR;
  const storeFile = flags['store-file'] || path.join(dataDir, 'catalogue.jsonl');
  const lines = readCatalogue(storeFile);
  const current = currentStateOf(lines);
  const perState = {};
  for (const [, rec] of current) {
    const s = (rec.state || '').toUpperCase();
    perState[s] = (perState[s] || 0) + 1;
  }
  const bySource = {};
  for (const [, rec] of current) {
    for (const sid of rec.sourceIds || []) {
      bySource[sid] = (bySource[sid] || 0) + 1;
    }
  }
  const lastWrite = lines.length ? lines[lines.length - 1] : null;
  const removable = [...current.values()].filter(
    (r) => (r.state || '').toUpperCase() === 'REMOVED'
  );
  return {
    dataDir: dataDir.replace(/\\/g, '/'),
    storeFile: storeFile.replace(/\\/g, '/'),
    linesInLedger: lines.length,
    currentCandidates: current.size,
    perState,
    perSource: bySource,
    malformedLines: lines.filter((l) => l.malformed).length,
    lastTransition: lastWrite
      ? { state: lastWrite.state, ts: lastWrite.ts, modelId: lastWrite.modelId }
      : null,
    removedCandidates: removable.length,
  };
}

function cmdAdapters(flags) {
  const registry = loadRegistry();
  const rows = (registry.sources || []).map((s) => {
    const kind = s && s.kind;
    const adapter = ADAPTERS[kind] ? 'yes' : 'none';
    let plan = '';
    if (recall(s.id)) plan = `>< recalled: ${recall(s.id)}`;
    else if (NOT_PERMITTED[s.id]) plan = `x  not permitted: ${NOT_PERMITTED[s.id]}`;
    else if (!adapter) plan = '?  unknown kind, no adapter';
    else if (kind === 'router')
      plan = `GET ${(s.endpoint || '') + ((s.verify && s.verify.path) || '/models')}`;
    else if (kind === 'model-source')
      plan = s.endpoint
        ? `GET ${s.endpoint}/models`
        : s.reachedVia
          ? `mapped via ${s.reachedVia}@${s.routerAlias}`
          : 'unknown — no endpoint, no route';
    else if (kind === 'agent-cli')
      plan = s.servesModels === false ? 'no-models (harness)' : 'presence only; unknown catalogue';
    else if (kind === 'orchestrator') plan = 'provider models listing via dispatch providers';
    else if (kind === 'harness') plan = 'no-models (per-task resolution)';
    else if (kind === 'decision-service') plan = 'no-models (decision only)';
    return { id: s.id, kind, adapter, plan };
  });
  return {
    matrix: rows,
    notPermitted: NOT_PERMITTED,
    recall: RECALL,
    note: 'matrices are constant maps for operator policy; source enumeration itself stays data-driven',
  };
}

function print(obj, flags) {
  if (flags['json']) {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

async function main(argv) {
  const args = argv.slice(2);
  const cmd = args.shift() || 'help';
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags['json'] = true;
    else if (a.startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      flags[a.slice(2)] = args[++i];
    }
  }

  if (cmd === 'run') return print(await cmdRun(flags), flags);
  if (cmd === 'import') {
    const which = args[0] === 'outer' ? 'outer' : args[0] === 'checkpoint' ? 'checkpoint' : null;
    if (!which) throw new Error('import requires <checkpoint|outer>');
    return print(await cmdImport(which, flags), flags);
  }
  if (cmd === 'status') return print(cmdStatus(flags), flags);
  if (cmd === 'adapters') return print(cmdAdapters(flags), flags);
  throw new Error('usage: discovery.js run|import checkpoint|outer|status|adapters [--json]');
}

if (require.main === module) {
  main(process.argv).then(
    () => process.exit(0),
    (e) => {
      process.stderr.write(String((e && e.message) || e) + '\n');
      process.exit(1);
    }
  );
}

module.exports = {
  cmdRun,
  cmdImport,
  cmdStatus,
  cmdAdapters,
  enumerateRegistry,
  loadRegistry,
  classifyPresence,
  readDiscoveryCatalogue,
  readCatalogue: readDiscoveryCatalogue,
  getCandidates: readDiscoveryCatalogue,
  readCandidates: readDiscoveryCatalogue,
};
