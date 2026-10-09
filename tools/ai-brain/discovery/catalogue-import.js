'use strict';

/**
 * Ship Dễ — reviewed model-audit catalogue import (TASK-AI-70)
 *
 * A model audit produces a large reviewed file of seven-part rows, each with a
 * `capability` that says what was actually observed for that row:
 *
 *   CATALOG_ONLY    it was listed. A listing is news, never availability.
 *   API_PASS        a direct-HTTP nonce came back for this exact identity.
 *   WORK_ITEM_PASS  real work plus an independent review on this identity.
 *
 * Until now that file could only be read by hand, so the Controller ranked one
 * hand-written model on one account and could never pick a reviewer from another
 * failure domain. This module turns the audit into the two stores dispatch
 * already reads — the discovery ledger and the evidence store — with the proof
 * carried exactly as the audit stated it.
 *
 * THREE RULES THIS MODULE WILL NOT BREAK
 *
 *  1. Advertisement is not proof. A `CATALOG_ONLY` row is appended to the
 *     discovery ledger as an `UNKNOWN` advertisement and produces no evidence
 *     item anywhere. A row that says "live catalogue only — not probed" is
 *     counted as `proofWithheld` even when its capability claims a proof,
 *     because its own text says the observation was a listing.
 *  2. A proof must be matchable. Evidence is matched by the seven-part key, and
 *     an advertised row carries no account: the account is minted by
 *     `candidates.gatewayAccountCandidates` for each concrete account that
 *     reaches the gateway. Proof is therefore recorded against those keys, and
 *     a row no account can reach records no proof at all rather than a proof
 *     against a wildcard that dispatch can never match.
 *  3. Nothing is promoted. The imported level is copied from the audit row and
 *     never raised; when rows repeat a key the strongest level wins, which is
 *     the same one-way ladder `evidence.js` enforces everywhere else.
 *
 * A failure row is reported, never adjudicated: importing it would write a
 * cooldown the Controller never decided on. The first real reported outcome sets
 * that cooldown instead.
 *
 * No model, provider, gateway or account id appears here. Which gateway a row
 * belongs to is resolved from `sources.json`, and which account may reach it is
 * resolved from the account registry, so adding a source or an account stays a
 * data change. A row whose gateway names no known source is skipped and
 * counted, and a source the registry has retired or deferred is skipped with the
 * registry's own reason.
 */

const fs = require('fs');
const path = require('path');

const sourcesApi = require('../sources');
const evidence = require('../evidence');
const { scrubText } = require('../decisions');
const { candidateKey, modelBase, registryPrefixes } = require('./identity');
const { currentState, readCatalogue, appendLine } = require('./store');
const { gatewayAccountCandidates } = require('../candidates');

/**
 * Capability names that mean a probe actually answered. Everything else — the
 * audit's `CATALOG_ONLY` above all — is an advertisement.
 */
const PROOF_CAPABILITIES = new Set([
  evidence.ProofLevel.API_PASS,
  evidence.ProofLevel.HARNESS_PASS,
  evidence.ProofLevel.WORK_ITEM_PASS,
]);

/**
 * A row's own text admitting it was never probed. Checked before the capability,
 * because a capability is a claim about the row while this is the row's own
 * account of how it was observed.
 */
const NOT_PROBED_PATTERN = /live catalogue only|not probed|catalogue only|not been probed/i;

/**
 * Recorded statuses that mean the observation describes a currently available
 * route. A historical pass on a route that is down now is not a proof today, so
 * it is reported rather than imported.
 */
const CURRENT_STATUSES = new Set([
  'CURRENT_AVAILABLE',
  'AVAILABLE',
  'ALIVE',
  'PASS',
  'CURRENT_PASS',
  'OK',
]);

const WITHHELD_REASONS = Object.freeze({
  NOT_A_PROOF: 'NOT_A_PROOF',
  NOT_PROBED: 'PROOF_WITHHELD_NOT_PROBED',
  NOT_CURRENT: 'PROOF_WITHHELD_NOT_CURRENT',
});

const SKIPPED_REASONS = Object.freeze({
  UNKNOWN_SOURCE: 'UNKNOWN_SOURCE',
  RETIRED: 'RETIRED',
  DEFERRED: 'DEFERRED',
  NO_MODEL_ID: 'NO_MODEL_ID',
  SOURCE_SERVES_NO_MODELS: 'SOURCE_SERVES_NO_MODELS',
});

/** Read a JSON-lines audit catalogue. Malformed lines are counted, not fatal. */
function readCatalogueRows(filePath, io) {
  const opts = io || {};
  const readFile = opts.readFile || fs.readFileSync;
  const text = readFile(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  const malformed = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') rows.push(parsed);
      else malformed.push({ line: String(raw).slice(0, 200) });
    } catch (err) {
      malformed.push({ line: String(raw).slice(0, 200), error: err.message });
    }
  }
  return { rows, malformed, total: rows.length + malformed.length };
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * The host of a URL, or a bare host string, lower-cased. Empty when there is
 * none.
 *
 * An audit writes placeholders where it had no network route — `n/a (local
 * process)`, `n/a (harness)` — and those must never resolve to a one-letter
 * "host" that could collide with something real. So a host has to look like one:
 * labels of host characters, at least one dot, and no space.
 */
function hostOf(value) {
  const raw = text(value);
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw;
  let host = '';
  try {
    host = new URL(withScheme).host.toLowerCase();
  } catch (err) {
    host = '';
  }
  if (!host) {
    const match = withScheme.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i);
    host = match ? match[1].split('@').pop().split(':')[0].toLowerCase() : '';
  }
  const hostname = host.split(':')[0];
  if (!hostname || /\s/.test(hostname)) return '';
  if (hostname !== 'localhost' && hostname.indexOf('.') === -1) return '';
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(hostname) ? host : '';
}

/**
 * The source a row belongs to, resolved from the registry alone.
 *
 * A gateway is matched by host, because an audit records the host it dialled
 * (`127.0.0.1:20128`, `router.requesty.ai`) while the registry records the
 * endpoint that reaches it. A row that names no host is matched by source id or
 * label. Returns `{ source, matchedBy }`, or `{ source: null }` when nothing in
 * the registry answers — an unknown gateway is refused, never invented.
 *
 * `hostCache` is `{ hosts: Map }` so an import can resolve thousands of rows
 * against one index. An index that arrives empty is treated as uninitialised and
 * rebuilt from the registry: a caller that hands over an empty map must not be
 * able to disable host resolution and have every registered row reported as an
 * unknown source.
 */
function resolveSource(row, registry, hostCache) {
  const sources = (registry && registry.sources) || [];
  let hosts = hostCache && hostCache.hosts instanceof Map ? hostCache.hosts : null;
  if (!hosts) hosts = hostIndex(sources);
  else if (hosts.size === 0) {
    for (const [host, id] of hostIndex(sources)) if (!hosts.has(host)) hosts.set(host, id);
  }
  for (const host of [hostOf(row.gateway), hostOf(row.endpoint)].filter(Boolean)) {
    const id = hosts.get(host);
    if (id) {
      const source = sources.find((s) => s.id === id);
      if (source) return { source, matchedBy: 'host' };
    }
  }

  const label = text(row.source).toLowerCase();
  if (label) {
    const byId = sources.find((s) => text(s.id).toLowerCase() === label);
    if (byId) return { source: byId, matchedBy: 'source-id' };
    const byLabel = sources.find((s) => text(s.label).toLowerCase() === label);
    if (byLabel) return { source: byLabel, matchedBy: 'source-label' };
  }
  return { source: null, matchedBy: 'none' };
}

/** Host -> source id, from the registry endpoints alone. Built once per import. */
function hostIndex(sources) {
  const hosts = new Map();
  for (const source of sources || []) {
    for (const candidate of [source.endpoint, source.accessPath]) {
      const host = hostOf(candidate);
      if (host && !hosts.has(host)) hosts.set(host, source.id);
    }
  }
  return hosts;
}

/**
 * The gateway a row's models are reached through, in the vocabulary the registry
 * and the candidate generator already use: a router is its own gateway, a source
 * that rides one names it in `reachedVia`, and a direct source names none.
 */
function gatewayOf(source) {
  if (!source) return '';
  if (source.kind === sourcesApi.Kind.ROUTER) return source.id;
  return source.reachedVia || '';
}

/**
 * What proof a row is honestly allowed to carry.
 *
 * @returns {{ level: string|null, reason: string|null, claimed: string }}
 */
function proofVerdict(row) {
  const claimed = text(row.capability || row.proofLevel).toUpperCase();
  if (!PROOF_CAPABILITIES.has(claimed)) {
    return { level: null, reason: WITHHELD_REASONS.NOT_A_PROOF, claimed: claimed || 'NONE' };
  }
  const observation = [row.evidence, row.detail, row.enumerationSource]
    .filter((v) => typeof v === 'string')
    .join(' ');
  if (NOT_PROBED_PATTERN.test(observation)) {
    return { level: null, reason: WITHHELD_REASONS.NOT_PROBED, claimed };
  }
  const status = text(row.status).toUpperCase();
  const availability = text(row.availability).toUpperCase();
  if (!CURRENT_STATUSES.has(status) && !CURRENT_STATUSES.has(availability)) {
    return { level: null, reason: WITHHELD_REASONS.NOT_CURRENT, claimed };
  }
  return { level: claimed, reason: null, claimed };
}

function isFailureRow(row) {
  const status = text(row.status).toUpperCase();
  return status === 'FAIL' || status === 'HISTORICAL_PASS_CURRENTLY_UNAVAILABLE';
}

/** The seven-part identity a row advertises. The account is never taken from a row. */
function identityFor(row, source) {
  return {
    harness: text(row.harness),
    accessPath: text(row.accessPath) || (source ? text(source.accessPath) : ''),
    gateway: gatewayOf(source),
    upstream: text(row.upstream),
    account: '',
    quotaScope: '',
    modelId: text(row.modelId || row.model),
  };
}

function identityKey(identity) {
  return candidateKey(identity);
}

/** The evidence text recorded with an imported proof, scrubbed like every other. */
function proofReason(row) {
  const evidenceText = text(row.evidence);
  const nonce = text(row.nonce);
  const parts = [evidenceText];
  if (nonce && evidenceText && !evidenceText.includes(nonce)) parts.push('nonce=' + nonce);
  const joined = parts.filter(Boolean).join(' | ');
  return joined
    ? scrubText(joined.slice(0, 500))
    : 'catalogue-import: capability recorded by audit';
}

/**
 * The evidence items already recorded through an import, per candidate key. A
 * store that cannot be read is treated as empty: the import then records, which
 * is the same direction a missing store takes.
 */
function loadEvidenceQuietly(evidenceDir, recordProbe) {
  if (recordProbe !== evidence.recordProbe) return {};
  try {
    return evidence.loadEvidence(evidenceDir);
  } catch (err) {
    return {};
  }
}

function proofSignatures(data) {
  const out = new Map();
  for (const combo of (data && data.combinations) || []) {
    const key = identityKey(combo);
    if (!out.has(key)) out.set(key, new Set());
    for (const item of combo.evidence || []) {
      if (item.source !== 'catalogue-import') continue;
      out.get(key).add([item.ts, item.proofLevel, item.status, item.source].join('|'));
    }
  }
  return out;
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

/**
 * Import a reviewed audit catalogue into the data the Controller dispatches on.
 *
 * @param {object} options
 * @param {string} options.filePath – the audit catalogue (JSON lines)
 * @param {object} [options.registry] – loaded source registry
 * @param {object[]} [options.accounts] – accounts bound to sources
 * @param {string} [options.dataDir] – discovery data dir (ledger + imports)
 * @param {string} [options.evidenceDir] – evidence store dir
 * @param {string} [options.now] – ISO timestamp for this run
 * @param {boolean} [options.dryRun] – compute the summary, write nothing
 * @param {Function} [options.recordProbe] – evidence recorder (injectable for tests)
 * @returns {object} summary
 */
function importCatalogue(options) {
  const o = options || {};
  const filePath = o.filePath;
  if (!filePath) throw new Error('importCatalogue requires filePath');

  const registry = o.registry || sourcesApi.loadSources(o.sourceOpts);
  const accounts = Array.isArray(o.accounts) ? o.accounts : [];
  const dataDir = o.dataDir || path.join(__dirname, '..', 'data', 'discovery');
  const evidenceDir = o.evidenceDir || path.join(__dirname, '..', 'data', 'evidence');
  const dryRun = o.dryRun === true;
  const now = o.now || new Date().toISOString();
  const stamp = String(now).replace(/[:.]/g, '-');
  const runId = 'catalogue-import-' + stamp;
  const catalogueFile = path.join(dataDir, 'catalogue.jsonl');
  const importsDir = path.join(dataDir, 'imports');
  const importFile = path.join(importsDir, runId + '.json');
  const recordProbe = o.recordProbe || evidence.recordProbe;

  const { rows, malformed, total } = readCatalogueRows(filePath, o.io);
  const prefixes = registryPrefixes(registry);

  const summary = {
    schema: 'shipde/catalogue-import',
    runId,
    importedAt: now,
    importedFrom: path.basename(filePath),
    dryRun,
    totalRows: total,
    malformedRows: malformed.length,
    advertised: 0,
    ledgerTransitions: 0,
    ledgerKeysAlreadyPresent: 0,
    candidates: 0,
    apiPass: 0,
    harnessPass: 0,
    workItemPass: 0,
    proofRecorded: 0,
    proofAlreadyRecorded: 0,
    proofWithoutAccount: 0,
    proofWithheld: {},
    skipped: {},
    failureRows: 0,
    sources: {},
    ledgerFile: catalogueFile,
    importFile,
    evidenceDir,
  };

  if (rows.length === 0) {
    summary.refused = 'CATALOGUE_EMPTY';
    return summary;
  }

  const advertised = new Map();
  const proven = new Map();
  // The real registry host index, built once: an audit records the host it dialled
  // while the registry records the endpoint, so host matching is the only way most
  // rows resolve at all. `resolveSource` also repairs an index that arrives empty,
  // so this can never silently degrade into "every registered row is unknown".
  const hostCache = { hosts: hostIndex(registry.sources) };

  for (const row of rows) {
    const resolved = resolveSource(row, registry, hostCache);
    if (!resolved.source) {
      bump(summary.skipped, SKIPPED_REASONS.UNKNOWN_SOURCE);
      continue;
    }
    const source = resolved.source;
    if (sourcesApi.isRetired(source.id, registry)) {
      bump(summary.skipped, SKIPPED_REASONS.RETIRED);
      continue;
    }
    const deferred = sourcesApi.isDeferred(source.id, registry);
    if (deferred) {
      bump(summary.skipped, SKIPPED_REASONS.DEFERRED);
      continue;
    }
    // A source the registry itself declares as serving no models — a harness, an
    // orchestrator, a decision service — never becomes an advertised candidate.
    // The registry already says what it can do; the import does not second-guess it.
    if (source.servesModels === false) {
      bump(summary.skipped, SKIPPED_REASONS.SOURCE_SERVES_NO_MODELS);
      continue;
    }

    const identity = identityFor(row, source);
    if (!identity.modelId || !identity.upstream) {
      bump(summary.skipped, SKIPPED_REASONS.NO_MODEL_ID);
      continue;
    }
    const key = identityKey(identity);
    const verdict = proofVerdict(row);
    if (verdict.level === null) bump(summary.proofWithheld, verdict.reason);
    if (isFailureRow(row)) summary.failureRows += 1;

    summary.sources[source.id] = (summary.sources[source.id] || 0) + 1;

    const record = advertised.get(key) || {
      key,
      identity,
      base: modelBase(identity.modelId, prefixes),
      sourceId: source.id,
      firstSeen: text(row.ts) || text(row.verifiedAt) || text(row.dateRead) || now,
      lastSeen: text(row.ts) || text(row.verifiedAt) || text(row.dateRead) || now,
      capability: verdict.claimed,
      rows: 0,
    };
    record.rows += 1;
    const rowTime = text(row.ts) || text(row.verifiedAt) || text(row.dateRead);
    if (rowTime && rowTime < record.firstSeen) record.firstSeen = rowTime;
    if (rowTime && rowTime > record.lastSeen) record.lastSeen = rowTime;
    advertised.set(key, record);

    if (verdict.level === null) continue;

    const route = gatewayOf(source);
    const existing = proven.get(key);
    const rank = evidence.ProofRank[verdict.level];
    if (
      !existing ||
      evidence.ProofRank[existing.level] < rank ||
      (evidence.ProofRank[existing.level] === rank && text(row.ts) > text(existing.ts))
    ) {
      proven.set(key, {
        key,
        level: verdict.level,
        ts: text(row.ts) || text(row.verifiedAt) || text(row.dateRead) || now,
        reason: proofReason(row),
        route,
        upstream: identity.upstream,
        modelId: identity.modelId,
      });
    }
  }

  const provenList = [...proven.values()];
  summary.candidates = advertised.size;
  summary.apiPass = provenList.filter((p) => p.level === evidence.ProofLevel.API_PASS).length;
  summary.harnessPass = provenList.filter(
    (p) => p.level === evidence.ProofLevel.HARNESS_PASS
  ).length;
  summary.workItemPass = provenList.filter(
    (p) => p.level === evidence.ProofLevel.WORK_ITEM_PASS
  ).length;
  summary.advertised = advertised.size;

  // The advertised rows become ledger advertisements. A key the ledger already
  // carries is not re-appended: the ledger is append-only history, and a repeated
  // import of the same audit must not grow it.
  const existingKeys = dryRun
    ? new Set()
    : new Set(currentState(readCatalogue(catalogueFile)).keys());
  const ledgerLines = [];
  const importCandidates = [];
  for (const record of advertised.values()) {
    if (existingKeys.has(record.key)) {
      summary.ledgerKeysAlreadyPresent += 1;
    } else if (!dryRun) {
      ledgerLines.push({
        type: 'transition',
        ts: now,
        runId,
        snapshot: runId,
        key: record.key,
        harness: record.identity.harness,
        accessPath: record.identity.accessPath,
        gateway: record.identity.gateway,
        upstream: record.identity.upstream,
        account: '',
        quotaScope: '',
        modelId: record.identity.modelId,
        base: record.base,
        sourceIds: [record.sourceId],
        state: 'UNKNOWN',
        note: 'catalogue import: capability ' + record.capability,
      });
    }
    importCandidates.push({
      key: record.key,
      harness: record.identity.harness,
      accessPath: record.identity.accessPath,
      gateway: record.identity.gateway,
      upstream: record.identity.upstream,
      account: '',
      quotaScope: '',
      modelId: record.identity.modelId,
      base: record.base,
      source: record.sourceId,
      capability: record.capability,
      firstSeen: record.firstSeen,
      lastSeen: record.lastSeen,
      attempts: record.rows,
      passes: 0,
      deferred: 0,
      probeInvalid: 0,
      failures: [],
      evidence: [],
      resultState: 'UNTESTED',
    });
  }
  summary.ledgerTransitions = ledgerLines.length;

  // A proof belongs to the key dispatch can match: the concrete account that
  // reaches the row's gateway. The advertisement carries no account on purpose.
  const proofByRoute = new Map();
  for (const p of provenList) {
    proofByRoute.set([p.route, p.upstream, p.modelId].join('|'), p);
  }
  const accountCandidates = gatewayAccountCandidates({
    registry,
    accounts,
    catalogue: [...advertised.values()].map((r) => ({
      gateway: r.identity.gateway,
      upstream: r.identity.upstream,
      modelId: r.identity.modelId,
    })),
  });
  const routesReached = new Set(
    accountCandidates.map((c) => [c.gateway, c.upstream, c.modelId].join('|'))
  );
  summary.proofWithoutAccount = provenList.filter(
    (p) => !routesReached.has([p.route, p.upstream, p.modelId].join('|'))
  ).length;

  // Re-importing the same audit must not pile up identical evidence. A proof is
  // suppressed only when the store already carries that exact observation — same
  // key, instant, level, status and producer — so a second import never rewrites
  // history and a genuinely new observation is still recorded.
  const recordedBefore =
    dryRun || recordProbe === evidence.recordProbe
      ? proofSignatures(loadEvidenceQuietly(evidenceDir, recordProbe))
      : new Map();
  const claimed = new Map();
  for (const candidate of accountCandidates) {
    const proof = proofByRoute.get(
      [candidate.gateway, candidate.upstream, candidate.modelId].join('|')
    );
    if (!proof) continue;
    if (!candidate.accountId || candidate.accountId === '*') continue;
    const signature = [proof.ts, proof.level, evidence.Status.PASSED, 'catalogue-import'].join('|');
    const key = identityKey({
      harness: candidate.harness,
      accessPath: candidate.accessPath,
      gateway: candidate.gateway,
      upstream: candidate.upstream,
      account: candidate.accountId,
      quotaScope: candidate.quotaScope,
      modelId: candidate.modelId,
    });
    if (!claimed.has(key)) claimed.set(key, new Set());
    if (claimed.get(key).has(signature) || (recordedBefore.get(key) || new Set()).has(signature)) {
      summary.proofAlreadyRecorded += 1;
      continue;
    }
    claimed.get(key).add(signature);
    summary.proofRecorded += 1;
    if (dryRun) continue;
    recordProbe(
      evidenceDir,
      {
        harness: candidate.harness,
        accessPath: candidate.accessPath,
        gateway: candidate.gateway,
        upstream: candidate.upstream,
        accountId: candidate.accountId,
        quotaScope: candidate.quotaScope,
        modelId: candidate.modelId,
      },
      {
        ts: proof.ts,
        status: evidence.Status.PASSED,
        proofLevel: proof.level,
        reason: proof.reason,
        source: 'catalogue-import',
        runId,
      }
    );
  }

  if (!dryRun) {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const line of ledgerLines) appendLine(catalogueFile, line, o.io);
    fs.mkdirSync(importsDir, { recursive: true });
    fs.writeFileSync(
      importFile,
      JSON.stringify(
        {
          evidenceKind: 'catalogue-import',
          runId,
          importedAt: now,
          importedFrom: summary.importedFrom,
          sourceIds: Object.keys(summary.sources),
          candidateCount: importCandidates.length,
          summary: {
            advertised: summary.advertised,
            apiPass: summary.apiPass,
            harnessPass: summary.harnessPass,
            workItemPass: summary.workItemPass,
            proofRecorded: summary.proofRecorded,
            proofWithoutAccount: summary.proofWithoutAccount,
            proofWithheld: summary.proofWithheld,
            skipped: summary.skipped,
            failureRows: summary.failureRows,
            malformedRows: summary.malformedRows,
          },
          candidates: importCandidates,
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  }

  summary.malformedLines = malformed;
  return summary;
}

/** The console and `--json` shape of one import run. */
function formatSummary(summary) {
  const lines = [];
  lines.push('Catalogue import ' + summary.importedFrom + (summary.dryRun ? ' (dry run)' : ''));
  if (summary.refused) {
    lines.push('  REFUSED ' + summary.refused + ': no rows were read');
    return lines.join('\n');
  }
  lines.push('  rows ' + summary.totalRows + ' (malformed ' + summary.malformedRows + ')');
  lines.push(
    '  advertised ' +
      summary.advertised +
      ' candidates from ' +
      Object.keys(summary.sources).length +
      ' registered source(s)'
  );
  lines.push(
    '  proof API_PASS ' +
      summary.apiPass +
      ' / HARNESS_PASS ' +
      summary.harnessPass +
      ' / WORK_ITEM_PASS ' +
      summary.workItemPass
  );
  lines.push('  proof recorded on ' + summary.proofRecorded + ' account-bound key(s)');
  if (summary.proofAlreadyRecorded > 0) {
    lines.push('  ' + summary.proofAlreadyRecorded + ' identical proof(s) already recorded');
  }
  if (summary.proofWithoutAccount > 0) {
    lines.push(
      '  proof withheld for ' +
        summary.proofWithoutAccount +
        ' row(s): no bound account reaches that gateway'
    );
  }
  for (const [reason, count] of Object.entries(summary.proofWithheld || {})) {
    lines.push('  withheld ' + count + 'x ' + reason);
  }
  for (const [reason, count] of Object.entries(summary.skipped || {})) {
    lines.push('  skipped ' + count + 'x ' + reason);
  }
  if (summary.failureRows > 0) {
    lines.push('  reported ' + summary.failureRows + ' failure row(s); an import sets no cooldown');
  }
  lines.push(
    '  ledger ' +
      summary.ledgerTransitions +
      ' new transition(s), ' +
      summary.ledgerKeysAlreadyPresent +
      ' already present'
  );
  if (!summary.dryRun) {
    lines.push('  wrote ' + summary.ledgerFile);
    lines.push('  wrote ' + summary.importFile);
    lines.push('  evidence ' + summary.evidenceDir);
  }
  return lines.join('\n');
}

module.exports = {
  PROOF_CAPABILITIES,
  NOT_PROBED_PATTERN,
  CURRENT_STATUSES,
  WITHHELD_REASONS,
  SKIPPED_REASONS,
  readCatalogueRows,
  resolveSource,
  hostIndex,
  gatewayOf,
  proofVerdict,
  identityFor,
  hostOf,
  importCatalogue,
  formatSummary,
};
