'use strict';
/*
 * Model source inventory builder — offline data assembly only.
 *
 * Reads ONLY the filtered inputs listed below (relative paths inside the
 * worktree). Makes no network calls, calls no model API, probes no endpoint.
 * Never copies raw scan detail/error text into the outputs: only the
 * classification produced by the canonical scan rule is kept.
 *
 * Classification rule: .inputs/reconcile-20261005.js loads its classify()
 * from 'reconcile-scan.js', which is NOT present in the filtered inputs, so
 * the function text cannot be re-read here. Instead this script reuses the
 * recorded OUTPUTS of that exact classify() run, i.e. the routes table in
 * .inputs/MODEL-SCAN-CANONICAL-20261005.json (latest attempt per
 * (source, model) wins). No new classifier is invented: lastScanClass for a
 * scan-observed candidate is the canonical status verbatim, and candidates
 * with no scan observation get lastScanClass UNKNOWN.
 *
 * Proof levels: tools/ai-brain/data/evidence/evidence.json is absent in this
 * worktree (only a .gitignore placeholder), so nothing can be promoted from
 * controller evidence. API_PASS is assigned only when the candidate's own
 * latest scan classification is API_PASS; everything else is CATALOG_ONLY.
 * HARNESS_PASS / WORK_ITEM_PASS therefore never appear in the output.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const IN = (...parts) => path.join(ROOT, '.inputs', ...parts);
const BRAIN = (...parts) => path.join(ROOT, 'tools', 'ai-brain', ...parts);
const OUTDIR = __dirname;

const SCAN_FILES = [
  '9router-probe-20261004.jsonl',
  '9router-retry-20261004.jsonl',
  '9router-cl-20261004.jsonl',
  'opencode-probe-20261004.jsonl',
  'opencode-builtin-20261004.jsonl',
  'full-scan-20261005.jsonl',
  'sources-new-20261005.jsonl',
  'thb-probe-20261005.jsonl',
  'nebius-probe-20261005.jsonl',
  'bai-retry-20261005.jsonl',
];

const fileDate = (f) => {
  if (f.includes('20261004')) return '2026-10-04';
  if (f.includes('20261005')) return '2026-10-05';
  if (f.includes('20260930')) return '2026-09-30';
  return 'UNKNOWN';
};

/* Source derivation copied from .inputs/reconcile-20261005.js (kept identical). */
const deriveSource = (r, f) =>
  r.source ||
  (f.startsWith('9router')
    ? '9router'
    : f.startsWith('opencode')
      ? 'opencode:' + (r.provider || '')
      : f.split('-')[0]);

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

const readLines = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
};

/* ---------------- inputs ---------------- */
const cliConfigs = readJson(IN('cli-configs-filtered.json'), { sources: [] });
const canonical = readJson(IN('MODEL-SCAN-CANONICAL-20261005.json'), { routes: [] });
const nrListing = (() => {
  const raw = readJson(IN('9router-models-20261004.json'), null);
  if (raw && Array.isArray(raw.data)) return raw.data.map((d) => d.id).filter(Boolean);
  return [];
})();
const ocModelsTxt = readLines(IN('opencode-models-20261004.txt')).map((s) => s.trim()).filter(Boolean);
const catalogueRows = readLines(IN('MODEL-SOURCE-CATALOGUE-20260930.jsonl'))
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const registry = readJson(BRAIN('sources.json'), { sources: [] });
const priors = readJson(BRAIN('data', 'external-model-priors.json'), { ranking: [] });
const evidence = readJson(BRAIN('data', 'evidence', 'evidence.json'), null); // absent: no upgrades possible
const priorsSet = new Set((priors.ranking || []).map((r) => r.canonical));

/* Recorded outputs of the canonical classify() run: (scanSource, model) -> {status, t, file}. */
const canonMap = new Map();
for (const r of canonical.routes || []) {
  canonMap.set(r.source + '' + r.model, { status: r.status, t: r.t, file: r.file });
}
const isoOr = (t, fallback) => {
  if (t && t > 0) {
    try {
      return new Date(t).toISOString();
    } catch {
      return fallback;
    }
  }
  return fallback;
};

/* ---------------- candidate assembly ---------------- */
const KEY_SEP = '';
const key7 = (c) =>
  [c.harness, c.accessPath, c.gateway, c.upstream, c.accountRef, c.quotaScope, c.modelId].join(KEY_SEP);

const store = new Map(); // 7-part key -> candidate accumulator
function emit(t, opts) {
  const c = {
    harness: t.harness,
    accessPath: t.accessPath,
    gateway: t.gateway,
    upstream: t.upstream,
    accountRef: t.accountRef,
    quotaScope: t.quotaScope || 'UNKNOWN',
    modelId: t.modelId,
    alias: null, // no input exposes an alias for any model id
    scanFamily: opts.scanFamily || null, // scan source name(s) for lastScanClass lookup
    observedAt: opts.observedAt || 'UNKNOWN',
    observedT: opts.observedT || 0,
    evidenceRefs: new Set(opts.evidenceRefs || []),
    sourceLinks: new Set(opts.sourceLinks || []),
  };
  const k = key7(c);
  const prev = store.get(k);
  if (!prev) {
    store.set(k, c);
    return;
  }
  for (const e of c.evidenceRefs) prev.evidenceRefs.add(e);
  for (const s of c.sourceLinks) prev.sourceLinks.add(s);
  if (!prev.scanFamily && c.scanFamily) prev.scanFamily = c.scanFamily;
  if ((c.observedT || 0) >= (prev.observedT || 0) && c.observedAt !== 'UNKNOWN') {
    prev.observedAt = c.observedAt;
    prev.observedT = c.observedT;
  }
}

const routedNs = (id) => (id.includes('/') ? id.split('/')[0] : 'combo');
const upstreamSourceId = (ns) => '9router-upstream-' + ns;

function nineRouterTuple(modelId, remainder) {
  const ns = routedNs(remainder !== undefined ? remainder : modelId);
  return {
    t: {
      harness: 'paseo',
      accessPath: 'opencode',
      gateway: '9router',
      upstream: ns,
      accountRef: 'ninerouter',
      quotaScope: 'UNKNOWN',
      modelId,
    },
    links: ['9router', upstreamSourceId(ns)],
    scanFamily: '9router',
  };
}
function opencodeTuple(provider, modelId) {
  // provider 'opencode' is the builtin service; accountRef names its source id.
  const isBuiltin = provider === 'opencode';
  return {
    t: {
      harness: 'opencode',
      accessPath: 'opencode',
      gateway: 'opencode',
      upstream: provider,
      accountRef: isBuiltin ? 'opencode-builtin' : provider,
      quotaScope: 'UNKNOWN',
      modelId,
    },
    links: [isBuiltin ? 'opencode-builtin' : provider],
    scanFamily: 'opencode:' + provider,
  };
}
function directTuple(sourceId, modelId) {
  return {
    t: {
      harness: 'direct-http',
      accessPath: 'direct-http',
      gateway: sourceId,
      upstream: sourceId,
      accountRef: sourceId,
      quotaScope: 'UNKNOWN',
      modelId,
    },
    links: [sourceId],
    scanFamily: sourceId,
  };
}

/* A. 9router /v1/models listing (2026-10-04). */
for (const id of nrListing) {
  const { t, links, scanFamily } = nineRouterTuple(id);
  emit(t, { scanFamily, observedAt: '2026-10-04', evidenceRefs: ['9router-models-20261004.json'], sourceLinks: links });
}

/* B. opencode provider configs + CLI tool configs (2026-10-06 extract). */
const cliDate = (cliConfigs.generatedAt || '2026-10-06').slice(0, 10);
for (const s of cliConfigs.sources || []) {
  if (s.tool === 'opencode') {
    for (const m of s.models || []) {
      if (s.providerId === 'ninerouter') {
        const { t, links, scanFamily } = nineRouterTuple(m);
        emit(t, { scanFamily, observedAt: cliDate, evidenceRefs: ['cli-configs-filtered.json'], sourceLinks: links });
      } else {
        const { t, links, scanFamily } = opencodeTuple(s.providerId, m);
        emit(t, { scanFamily, observedAt: cliDate, evidenceRefs: ['cli-configs-filtered.json'], sourceLinks: links });
      }
    }
  } else if (s.tool === 'codex') {
    for (const line of s.lines || []) {
      const m = line.match(/model\s*=\s*"([^"]+)"/);
      if (m) {
        emit(
          { harness: 'codex', accessPath: 'cli', gateway: 'codex', upstream: 'codex', accountRef: 'codex', quotaScope: 'UNKNOWN', modelId: m[1] },
          { observedAt: cliDate, evidenceRefs: ['cli-configs-filtered.json'], sourceLinks: ['codex'] }
        );
      }
    }
  } else if (s.tool === 'hermes') {
    for (const line of s.lines || []) {
      const m = line.match(/default:\s*"([^"]+)"/);
      if (m) {
        emit(
          { harness: 'hermes', accessPath: 'cli', gateway: 'hermes', upstream: 'hermes', accountRef: 'hermes', quotaScope: 'UNKNOWN', modelId: m[1] },
          { observedAt: cliDate, evidenceRefs: ['cli-configs-filtered.json'], sourceLinks: ['hermes'] }
        );
      }
    }
  }
}

/* C. `opencode models` catalogue listing (2026-10-04). */
for (const id of new Set(ocModelsTxt)) {
  const slash = id.indexOf('/');
  const prefix = slash === -1 ? id : id.slice(0, slash);
  if (prefix === 'ninerouter') {
    const rest = id.slice('ninerouter/'.length);
    const { t, scanFamily } = nineRouterTuple(id, rest);
    const ns = routedNs(rest);
    emit(t, { scanFamily, observedAt: '2026-10-04', evidenceRefs: ['opencode-models-20261004.txt'], sourceLinks: ['9router', upstreamSourceId(ns)] });
  } else {
    const { t, links, scanFamily } = opencodeTuple(prefix, id);
    emit(t, { scanFamily, observedAt: '2026-10-04', evidenceRefs: ['opencode-models-20261004.txt'], sourceLinks: links });
  }
}

/* D. scan observations: one candidate family per canonical route (recorded classify() output). */
const scanTuple = (scanSource, model) => {
  if (scanSource === '9router') return nineRouterTuple(model);
  if (scanSource.startsWith('opencode:')) return opencodeTuple(scanSource.slice('opencode:'.length) || 'UNKNOWN', model);
  const norm = scanSource === 'tokenharbor' ? 'thb' : scanSource;
  return directTuple(norm, model);
};
for (const r of canonical.routes || []) {
  const { t, links, scanFamily } = scanTuple(r.source, r.model);
  emit(t, {
    scanFamily: scanFamily === 'thb' ? ['thb', 'tokenharbor'] : scanFamily,
    observedAt: isoOr(r.t, fileDate(r.file || '')),
    observedT: r.t || 0,
    evidenceRefs: [r.file || 'MODEL-SCAN-CANONICAL-20261005.json'],
    sourceLinks: links,
  });
}

/* E. older catalogue (2026-09-30) rows as dated history. Harness-placeholder
 * rows ("(harness — ...)") name no model and are skipped. accountRef is always
 * the inventory source id — never a key name, email or secret from the row. */
const catalogueSourceMap = (name) => {
  const n = String(name || '');
  if (/^9Router/i.test(n)) return '9router';
  if (/^Cohere/i.test(n)) return 'cohere';
  if (/^B\.AI/i.test(n)) return 'bai';
  if (/^xKiro/i.test(n)) return 'xkiro';
  if (/^Tencent/i.test(n)) return 'tencent';
  if (/^Requesty/i.test(n)) return 'rqsty';
  if (/^TokenHarbor/i.test(n)) return 'thb';
  if (/^llmtr/i.test(n)) return 'llmtr';
  if (/^Inception/i.test(n)) return 'inception';
  if (/^AMD/i.test(n)) return 'amd-radeon';
  if (/^PGS/i.test(n)) return 'pgsgrove';
  if (/^Baseten/i.test(n)) return 'baseten';
  if (/^Regolo/i.test(n)) return 'regolo';
  if (/^Dahl/i.test(n)) return 'dahl';
  if (/^The Grid/i.test(n)) return 'thegrid';
  if (/^Scaleway/i.test(n)) return 'scaleway';
  if (/^AgentRouter/i.test(n)) return 'agentrouter';
  if (/agy/i.test(n)) return 'agy-local';
  return null;
};
for (const row of catalogueRows) {
  const modelId = row.modelId;
  if (!modelId || modelId.startsWith('(')) continue; // harness placeholder, not a model
  const sid = catalogueSourceMap(row.source);
  if (!sid) continue;
  const at = (row.ts || '2026-09-30').slice(0, 10);
  if (sid === '9router') {
    const ns = row.upstream && row.upstream !== '(combo)' ? row.upstream : routedNs(modelId);
    emit(
      { harness: 'direct-http', accessPath: '9router', gateway: '9router', upstream: ns, accountRef: 'ninerouter', quotaScope: 'UNKNOWN', modelId },
      { scanFamily: '9router', observedAt: at, evidenceRefs: ['MODEL-SOURCE-CATALOGUE-20260930.jsonl'], sourceLinks: ['9router', upstreamSourceId(ns)] }
    );
  } else if (sid === 'agy-local') {
    emit(
      { harness: 'agy', accessPath: 'cli', gateway: 'antigravity', upstream: 'antigravity', accountRef: 'agy-local', quotaScope: 'UNKNOWN', modelId },
      { observedAt: at, evidenceRefs: ['MODEL-SOURCE-CATALOGUE-20260930.jsonl'], sourceLinks: ['agy-local'] }
    );
  } else {
    emit(
      { harness: 'direct-http', accessPath: 'direct-http', gateway: sid, upstream: sid, accountRef: sid, quotaScope: 'UNKNOWN', modelId },
      { scanFamily: sid, observedAt: at, evidenceRefs: ['MODEL-SOURCE-CATALOGUE-20260930.jsonl'], sourceLinks: [sid] }
    );
  }
}

/* Resolve lastScanClass via the recorded classify() outputs (exact match only). */
const scanStatusOf = (families, modelId) => {
  const fams = Array.isArray(families) ? families : [families];
  for (const f of fams) {
    if (!f) continue;
    const hit = canonMap.get(f + '' + modelId);
    if (hit) return hit;
  }
  return null;
};

const candidates = [...store.values()].map((c) => {
  const hit = scanStatusOf(c.scanFamily, c.modelId);
  const lastScanClass = hit ? hit.status : 'UNKNOWN';
  // evidence.json is absent, so no HARNESS_PASS / WORK_ITEM_PASS promotion is
  // possible; API_PASS only on an exact API_PASS scan classification.
  const proofLevel = lastScanClass === 'API_PASS' ? 'API_PASS' : 'CATALOG_ONLY';
  return {
    harness: c.harness,
    accessPath: c.accessPath,
    gateway: c.gateway,
    upstream: c.upstream,
    accountRef: c.accountRef,
    quotaScope: c.quotaScope,
    modelId: c.modelId,
    alias: null,
    canonicalModelId: priorsSet.has(c.modelId) ? c.modelId : 'UNKNOWN',
    proofLevel,
    lastScanClass,
    observedAt: c.observedAt,
    evidenceRef: [...c.evidenceRefs].sort().join(', '),
    _links: [...c.sourceLinks],
  };
});
candidates.sort((a, b) =>
  (a.gateway + a.upstream + a.modelId).localeCompare(b.gateway + b.upstream + b.modelId)
);

/* ---------------- sources ---------------- */
const txtByPrefix = new Map();
for (const id of new Set(ocModelsTxt)) {
  const p = id.includes('/') ? id.split('/')[0] : '(none)';
  if (!txtByPrefix.has(p)) txtByPrefix.set(p, new Set());
  txtByPrefix.get(p).add(id);
}
const scansBySource = new Map();
for (const r of canonical.routes || []) {
  if (!scansBySource.has(r.source)) scansBySource.set(r.source, new Set());
  scansBySource.get(r.source).add(r.model);
}
const configByProvider = new Map();
for (const s of cliConfigs.sources || []) {
  if (s.tool === 'opencode') configByProvider.set(s.providerId, s);
}
const listingNs = new Map();
for (const id of nrListing) {
  const ns = routedNs(id);
  if (!listingNs.has(ns)) listingNs.set(ns, new Set());
  listingNs.get(ns).add(id);
}

const candidateCountFor = (sid) => candidates.filter((c) => c._links.includes(sid)).length;

const DOCS = {
  cohere: 'https://docs.cohere.com/docs/compatibility-api',
  inception: 'https://docs.inceptionlabs.ai/',
  'amd-radeon': 'https://developer.amd.com/radeon-ai/',
  baseten: 'https://www.baseten.co/reference/openai-api',
  tencent: 'https://cloud.tencent.com/document/product/1772',
  rqsty: 'https://docs.requesty.ai/',
  codex: 'https://developers.openai.com/codex/cli',
  qwen: 'https://github.com/QwenLM/qwen-code',
  oc: 'https://opencode.ai/docs',
  cline: 'https://docs.cline.bot/',
};
// Every URL above was found verbatim in .inputs/MODEL-SOURCE-CATALOGUE-20260930.jsonl.

const baseURLof = (pid) => {
  const p = configByProvider.get(pid);
  return p && p.baseURL ? p.baseURL : null;
};

const sources = [];
const addSource = (s) => {
  s.candidateCount = candidateCountFor(s.sourceId);
  sources.push(s);
};

/* Gateway. */
addSource({
  sourceId: '9router',
  kind: 'GATEWAY',
  publicEndpoint: 'http://127.0.0.1:20128/v1',
  officialDocs: 'UNKNOWN',
  enumerationMethod: '/v1/models listing',
  status: 'ENUMERATED',
  evidenceRef: '9router-models-20261004.json, cli-configs-filtered.json (provider ninerouter), opencode-models-20261004.txt, full-scan-20261005.jsonl',
  modelCount: new Set([
    ...nrListing,
    ...(configByProvider.get('ninerouter')?.models || []),
    ...(txtByPrefix.get('ninerouter') || []),
    ...(scansBySource.get('9router') || []),
  ]).size,
  note: 'A gateway, not a model vendor: its catalogue is the union of logged-in accounts, so a model id here is evidence of routing, never of capacity.',
});

/* Gateway upstreams: prefix before the first "/" in a 9router model id. */
for (const ns of [...listingNs.keys()].sort()) {
  const ids = new Set([
    ...(listingNs.get(ns) || []),
    ...[...(scansBySource.get('9router') || [])].filter((m) => routedNs(m) === ns),
    ...[...(configByProvider.get('ninerouter')?.models || [])].filter((m) => routedNs(m) === ns),
    ...[...(txtByPrefix.get('ninerouter') || [])].filter((m) => routedNs(m.slice('ninerouter/'.length)) === ns),
  ]);
  addSource({
    sourceId: upstreamSourceId(ns),
    kind: 'GATEWAY_UPSTREAM',
    publicEndpoint: 'UNKNOWN',
    officialDocs: 'UNKNOWN',
    enumerationMethod: '/v1/models listing (gateway union)',
    status: 'ENUMERATED',
    evidenceRef: '9router-models-20261004.json, full-scan-20261005.jsonl',
    modelCount: ids.size,
    note:
      ns === 'combo'
        ? "Unprefixed model id(s) in the gateway listing; upstream label 'combo' follows the tools/ai-brain discovery catalogue convention."
        : 'Upstream namespace inside the 9router gateway listing.',
  });
}

/* Vendor API sources (one per vendor; opencode-reached and direct paths share the vendor). */
const vendorDef = (sid, o) => {
  const cfgModels = configByProvider.get(o.configProvider || sid)?.models || [];
  const txtModels = [...(txtByPrefix.get(o.txtPrefix || sid) || [])];
  const scanModels = [...(scansBySource.get('opencode:' + (o.scanProvider || sid)) || [])];
  const directModels = [...(scansBySource.get(o.directScan || sid) || [])];
  const thruTxt = o.extraTxtPrefixes || [];
  for (const p of thruTxt) txtModels.push(...(txtByPrefix.get(p) || []));
  const modelCount = new Set([...cfgModels, ...txtModels, ...scanModels, ...directModels]).size;
  addSource({
    sourceId: sid,
    kind: 'DIRECT_API',
    publicEndpoint: o.endpoint || baseURLof(o.configProvider || sid) || 'UNKNOWN',
    officialDocs: DOCS[sid] || 'UNKNOWN',
    enumerationMethod: o.method,
    status: o.status,
    evidenceRef: o.evidenceRef,
    modelCount,
    ...(o.note ? { note: o.note } : {}),
  });
};

vendorDef('cohere', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
  note: 'Two id formats coexist: bare ids in config/direct probes vs provider-prefixed ids in opencode routes.',
});
vendorDef('baseten', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
});
vendorDef('inception', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
});
vendorDef('regolo', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
});
vendorDef('amd-radeon', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
});
vendorDef('dahl', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
});
vendorDef('thegrid', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
});
vendorDef('pgsgrove', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
});
vendorDef('scaleway', {
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, opencode-models-20261004.txt, opencode-probe-20261004.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
  note: 'Config baseURL carries a tenant path segment; recorded exactly as in the filtered config extract.',
});
vendorDef('explabs', {
  method: 'config file',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json',
  note: 'Provider is configured in the opencode config extract with zero models; no listing, no probe.',
});
vendorDef('thb', {
  configProvider: 'tokenharbor',
  method: 'config file, opencode models, probe observations',
  status: 'ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json (provider tokenharbor), opencode-models-20261004.txt, thb-probe-20261005.jsonl, sources-new-20261005.jsonl',
  note: "Scan files name this service both 'thb' and 'tokenharbor' against the same endpoint; inventoried as one source (registry id 'thb').",
});
vendorDef('xkiro', {
  method: 'probe observations only',
  status: 'PARTIAL',
  endpoint: 'https://api.xkiro.com/v1',
  evidenceRef: 'sources-new-20261005.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
  directScan: 'xkiro',
  scanProvider: 'UNKNOWN-NONE',
  note: 'A /list endpoint advertised 129 models but named none in the filtered inputs; ids come from probe observations only.',
});
vendorDef('bai', {
  method: 'probe observations only',
  status: 'PARTIAL',
  endpoint: 'https://api.b.ai/v1',
  evidenceRef: 'bai-retry-20261005.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
  directScan: 'bai',
  scanProvider: 'UNKNOWN-NONE',
  note: 'A /list endpoint advertised 59 models but named none in the filtered inputs; ids come from probe observations only.',
});
vendorDef('tencent', {
  method: 'probe observations only',
  status: 'PARTIAL',
  endpoint: 'https://tokenhub-intl.tencentcloudmaas.com/v1',
  evidenceRef: 'sources-new-20261005.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
  directScan: 'tencent',
  scanProvider: 'tencent-tokenhub',
  note: 'No model listing in the filtered inputs; ids come from probe observations only. Opencode routes use the tencent-tokenhub provider name.',
});
vendorDef('nebius', {
  method: 'probe observations only',
  status: 'PARTIAL',
  endpoint: 'UNKNOWN',
  evidenceRef: 'nebius-probe-20261005.jsonl, MODEL-SCAN-CANONICAL-20261005.json',
  directScan: 'nebius',
  scanProvider: 'UNKNOWN-NONE',
  note: 'Probed via the rqsty-nebius route; no endpoint URL and no listing in the filtered inputs.',
});
vendorDef('rqsty', {
  method: 'opencode models',
  status: 'ENUMERATED',
  endpoint: 'https://router.requesty.ai/v1',
  evidenceRef: 'opencode-models-20261004.txt, MODEL-SCAN-CANONICAL-20261005.json',
  txtPrefix: 'requesty',
  scanProvider: 'requesty',
  directScan: 'UNKNOWN-NONE',
  note: "Registry id 'rqsty'; listing and scan files use the name 'requesty'.",
});
vendorDef('llmtr', {
  method: 'opencode models',
  status: 'ENUMERATED',
  endpoint: 'https://llmtr.com/v1',
  evidenceRef: 'opencode-models-20261004.txt, MODEL-SCAN-CANONICAL-20261005.json',
  scanProvider: 'llmtr',
  directScan: 'UNKNOWN-NONE',
  note: 'Present in the opencode models listing and scans; absent from the current filtered opencode config.',
});
vendorDef('agentrouter', {
  method: 'opencode models',
  status: 'ENUMERATED',
  endpoint: 'UNKNOWN',
  evidenceRef: 'opencode-models-20261004.txt, MODEL-SCAN-CANONICAL-20261005.json, opencode-builtin-20261004.jsonl',
  scanProvider: 'agentrouter',
  directScan: 'UNKNOWN-NONE',
  note: 'Present in the opencode models listing and scans; no endpoint URL in the filtered inputs.',
});
vendorDef('regolo-ai', {
  method: 'opencode models',
  status: 'ENUMERATED',
  endpoint: 'UNKNOWN',
  evidenceRef: 'opencode-models-20261004.txt, MODEL-SCAN-CANONICAL-20261005.json',
  scanProvider: 'regolo-ai',
  directScan: 'UNKNOWN-NONE',
  note: 'A second regolo-named provider in listings/scans; kept distinct from regolo. No endpoint URL in the filtered inputs.',
});
vendorDef('tencent-tokenhub', {
  method: 'opencode models',
  status: 'ENUMERATED',
  endpoint: 'UNKNOWN',
  evidenceRef: 'opencode-models-20261004.txt, MODEL-SCAN-CANONICAL-20261005.json',
  scanProvider: 'tencent-tokenhub',
  directScan: 'UNKNOWN-NONE',
  note: 'Opencode provider name for Tencent routes; kept distinct from the direct tencent probe source.',
});
vendorDef('the-grid-ai', {
  method: 'opencode models',
  status: 'ENUMERATED',
  endpoint: 'UNKNOWN',
  evidenceRef: 'opencode-models-20261004.txt, MODEL-SCAN-CANONICAL-20261005.json',
  scanProvider: 'the-grid-ai',
  directScan: 'UNKNOWN-NONE',
  note: 'Kept distinct from thegrid (api.thegrid.ai); no endpoint URL in the filtered inputs.',
});

/* opencode builtin service. */
addSource({
  sourceId: 'opencode-builtin',
  kind: 'DIRECT_API',
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'UNKNOWN',
  enumerationMethod: 'opencode models',
  status: 'ENUMERATED',
  evidenceRef: 'opencode-models-20261004.txt, opencode-probe-20261004.jsonl, opencode-builtin-20261004.jsonl',
  modelCount: new Set([
    ...(txtByPrefix.get('opencode') || []),
    ...(scansBySource.get('opencode:opencode') || []),
  ]).size,
  note: 'Models served by the opencode builtin service (no baseURL in config); harness-level runs exist but classify CALL_CONTRACT_UNRESOLVED except via the builtin runner.',
});

/* CLI / harness sources from the Controller registry + filtered tool configs. */
const agyModels = new Set(
  catalogueRows.filter((r) => r.source === 'agy (Antigravity CLI)').map((r) => r.modelId)
);
const cliDef = (sid, o) => addSource({ sourceId: sid, kind: 'DIRECT_CLI', ...o });
cliDef('agy-local', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'UNKNOWN',
  enumerationMethod: 'older catalogue (2026-09-30)',
  status: 'PARTIAL',
  evidenceRef: 'MODEL-SOURCE-CATALOGUE-20260930.jsonl, tools/ai-brain/sources.json',
  modelCount: agyModels.size,
  note: "Task names 'agy'; the registry id is 'agy-local'. No current listing in the filtered inputs; 20 ids survive from the 2026-09-30 catalogue only.",
});
cliDef('codex', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'https://developers.openai.com/codex/cli',
  enumerationMethod: 'config file',
  status: 'PARTIAL',
  evidenceRef: 'cli-configs-filtered.json, tools/ai-brain/sources.json',
  modelCount: new Set(
    candidates.filter((c) => c._links.includes('codex')).map((c) => c.modelId)
  ).size,
  note: 'CLI pins one model in config; per the registry, further models live in accounts.registry.json, which is not in the filtered inputs.',
});
cliDef('hermes', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'UNKNOWN',
  enumerationMethod: 'config file',
  status: 'PARTIAL',
  evidenceRef: 'cli-configs-filtered.json, tools/ai-brain/sources.json',
  modelCount: new Set(
    candidates.filter((c) => c._links.includes('hermes')).map((c) => c.modelId)
  ).size,
  note: 'Config declares only a default model; the registry resolves the reasoning model per task, so no full listing exists.',
});
cliDef('qwen', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'https://github.com/QwenLM/qwen-code',
  enumerationMethod: 'config file',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json, tools/ai-brain/sources.json',
  modelCount: 0,
  note: 'Filtered qwen settings name base URLs only and declare no models.',
});
cliDef('gemini', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'UNKNOWN',
  enumerationMethod: 'config file',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'cli-configs-filtered.json',
  modelCount: 0,
  note: "No 'gemini' source in the Controller registry; the filtered gemini settings carry no models.",
});
cliDef('cline', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'https://docs.cline.bot/',
  enumerationMethod: 'UNKNOWN',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'tools/ai-brain/sources.json',
  modelCount: 0,
  note: 'A harness: per the registry it brings no models of its own; cline-routed ids appear under the 9router cl upstream.',
});
cliDef('autoclaw', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'UNKNOWN',
  enumerationMethod: 'UNKNOWN',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'tools/ai-brain/sources.json',
  modelCount: 0,
  note: 'A harness with no models of its own in the filtered inputs.',
});
cliDef('oc', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'https://opencode.ai/docs',
  enumerationMethod: 'UNKNOWN',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'tools/ai-brain/sources.json',
  modelCount: 0,
  note: 'The path Paseo uses to reach 9router models; serves no models itself.',
});
cliDef('paseo', {
  publicEndpoint: 'UNKNOWN',
  officialDocs: 'UNKNOWN',
  enumerationMethod: 'UNKNOWN',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'tools/ai-brain/sources.json',
  modelCount: 0,
  note: 'Orchestrator daemon; serves no models. Kind is structural only.',
});
cliDef('jev', {
  publicEndpoint: 'https://api.typesafe.ai/v1/systemone',
  officialDocs: 'UNKNOWN',
  enumerationMethod: 'UNKNOWN',
  status: 'NOT_ENUMERATED',
  evidenceRef: 'tools/ai-brain/sources.json',
  modelCount: 0,
  note: 'Closed decision service (checkable questions only); serves no routable models.',
});

/* ---------------- outputs ---------------- */
fs.mkdirSync(OUTDIR, { recursive: true });

const sourcesOut = sources.map((s) => {
  const { ...rest } = s;
  return rest;
});
fs.writeFileSync(path.join(OUTDIR, 'sources.json'), JSON.stringify(sourcesOut, null, 1) + '\n');

const jsonl = candidates
  .map(({ _links, ...c }) => JSON.stringify(c))
  .join('\n') + '\n';
fs.writeFileSync(path.join(OUTDIR, 'candidates.jsonl'), jsonl);

/* SUMMARY.md — generated from the same computed data so counts cannot drift. */
const thruGatewayCandidates = candidates.filter((c) => c.gateway === '9router').length;
const thruGatewayModels = new Set(candidates.filter((c) => c.gateway === '9router').map((c) => c.modelId)).size;
const CLI_HARNESSES = new Set(['agy', 'codex', 'qwen', 'hermes', 'cline', 'autoclaw', 'paseo']);
const isCliCandidate = (c) => c.gateway !== '9router' && CLI_HARNESSES.has(c.harness) && c.harness !== 'opencode' && c.harness !== 'direct-http';
const cliCandidates = candidates.filter(isCliCandidate).length;
const cliModels = new Set(candidates.filter(isCliCandidate).map((c) => c.modelId)).size;
const directHttpCandidates = candidates.filter(
  (c) => c.gateway !== '9router' && !isCliCandidate(c)
).length;
const directHttpModels = new Set(
  candidates.filter((c) => c.gateway !== '9router' && !isCliCandidate(c)).map((c) => c.modelId)
).size;
const uniqueRawModels = new Set(candidates.map((c) => c.modelId)).size;
const apiPass = candidates.filter((c) => c.proofLevel === 'API_PASS').length;
const notFull = sourcesOut.filter((s) => s.status !== 'ENUMERATED');

const rows = sourcesOut
  .map((s) => `| ${s.sourceId} | ${s.kind} | ${s.status} | ${s.modelCount} | ${s.candidateCount} |`)
  .join('\n');

const notFullRows = notFull
  .map((s) => `- ${s.sourceId} (${s.status}): ${s.note || s.enumerationMethod}`)
  .join('\n');

const summary = `# Model source inventory — 2026-10-06

Offline assembly from filtered inputs only. No endpoint was probed and no
model API was called to build this inventory.

## Sources (model count = unique modelId per source; candidate count = linked 7-part candidates)

| sourceId | kind | status | models | candidates |
|---|---|---|---|---|
${rows}

## Totals by access family

- DIRECT_API (vendor APIs reached directly or through the opencode harness): ${directHttpCandidates} candidates, ${directHttpModels} unique raw modelIds.
- DIRECT_CLI (models pinned by CLI tool configs or the older agy catalogue): ${cliCandidates} candidates, ${cliModels} unique raw modelIds.
- Through-gateway (gateway == 9router, all upstreams): ${thruGatewayCandidates} candidates, ${thruGatewayModels} unique raw modelIds.
- Overall: ${sourcesOut.length} sources, ${candidates.length} unique 7-part candidates, ${uniqueRawModels} unique raw modelIds.
- Proof split: ${apiPass} API_PASS, ${candidates.length - apiPass} CATALOG_ONLY. No candidate carries HARNESS_PASS or WORK_ITEM_PASS.
- Canonical-model split: ${candidates.filter((c) => c.canonicalModelId !== 'UNKNOWN').length} candidates with an exact benchmark-prior match, the rest UNKNOWN.

Candidate buckets are disjoint by construction (the 7-part key differs in
harness/accessPath/gateway), while raw modelIds overlap across buckets (the
same vendor id can appear direct, via opencode and via the gateway).

## Counting and dedupe

- modelCount: unique exact-string modelId per source across current
  enumeration inputs (listings, config files, scan observations). The older
  2026-09-30 catalogue does not contribute to modelCount.
- candidates: unique full 7-part key
  (harness, accessPath, gateway, upstream, accountRef, quotaScope, modelId).
  The same modelId reached by two paths is two candidates; identical tuples
  from listing + scan + catalogue merge into one candidate whose evidenceRef
  lists every input file.
- unique raw modelId overall: exact-string distinct modelId across all candidates.
- canonicalModelId: exact string equality against
  tools/ai-brain/data/external-model-priors.json only; prefixes are never
  stripped to guess, so most values are UNKNOWN.
- Scan source derivation (which scan rows belong to which source) copies
  .inputs/reconcile-20261005.js exactly. Scan file names map to sources as:
  9router-* -> 9router; opencode-probe / opencode-builtin -> opencode:&lt;provider&gt;;
  full-scan / sources-new / bai-retry carry their own source field;
  thb-probe -> thb; nebius-probe -> nebius. The names 'tokenharbor' and 'thb'
  denote the same service and are inventoried under source 'thb'.

## Sources not fully enumerated

${notFullRows}

This inventory is NOT complete: ${notFull.length} of ${sourcesOut.length} sources are PARTIAL or NOT_ENUMERATED (listed above).

## Past observations, not current liveness

Scan results reused here are past observations dated 2026-10-04 and
2026-10-05 (see observedAt per candidate). They say nothing about whether a
model answers today: quotas reset, keys rotate and upstreams change. Nothing
in candidates.jsonl may be read as a live availability claim.

## Catalogue (listing) vs evidence (scan/evidence.json)

- Catalogue inputs (listings, config files, the 2026-09-30 catalogue) say a
  model id exists somewhere. They never prove it answers.
- Evidence inputs (scan classifications, tools/ai-brain evidence) say what a
  past call returned. The Controller evidence file
  (tools/ai-brain/data/evidence/evidence.json) is absent in this worktree, so
  no candidate is promoted above what its own scan classification supports:
  API_PASS requires a latest scan class of API_PASS, everything else stays
  CATALOG_ONLY, and older catalogue proof claims (including WORK_ITEM_PASS
  rows from 2026-09-30) are deliberately NOT carried over. Catalogue and
  evidence are kept apart by construction: proofLevel comes only from the
  scan rule, never from a listing.
- FINAL-MODEL-REGISTRY.md and WS1-FINAL-REPORT-20261001.md are human-readable
  evidence summaries, not machine-readable enumerations, and contribute no
  model ids to this inventory.
`;
fs.writeFileSync(path.join(OUTDIR, 'SUMMARY.md'), summary);

/* accountRef hygiene: never an email or key. */
for (const c of candidates) {
  if (/@/.test(c.accountRef) || /key/i.test(c.accountRef)) {
    throw new Error('sensitive accountRef leaked for ' + c.modelId);
  }
}

console.log(
  JSON.stringify(
    {
      sources: sourcesOut.length,
      candidates: candidates.length,
      uniqueRawModelIds: uniqueRawModels,
      directApi: { candidates: directHttpCandidates, models: directHttpModels },
      directCli: { candidates: cliCandidates, models: cliModels },
      throughGateway: { candidates: thruGatewayCandidates, models: thruGatewayModels },
      apiPass,
      notFullyEnumerated: notFull.map((s) => s.sourceId),
      evidenceJsonPresent: evidence !== null,
    },
    null,
    1
  )
);
