'use strict';
const fs = require('fs');
const path = require('path');
const descriptor = require('./priors-sources/public.json');
function liveModelIds() {
  const file = path.join(__dirname, 'data/discovery/catalogue.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const row = JSON.parse(line);
      return row.modelId || row.model || [];
    });
}
function aaRows(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)]
    .map((m) => {
      try {
        return JSON.parse(m[1])[1] || '';
      } catch {
        return '';
      }
    })
    .join('');
  const rows = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.name === 'string' && typeof value.intelligenceIndex === 'number')
      rows.push(value);
    for (const child of Object.values(value)) walk(child);
  }
  for (const line of chunks.split('\n')) {
    const start = line.indexOf(':');
    try {
      walk(JSON.parse(line.slice(start + 1)));
    } catch {
      /* non-JSON flight record */
    }
  }
  const next = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (next) walk(JSON.parse(next[1]));
  if (!rows.length) throw new Error('PRIORS_AA_SCHEMA_CHANGED');
  // Schema validation: sanitise names and reject rows with out-of-bounds scores.
  const validated = rows
    .map((row) => {
      // Strip HTML tags and limit name length to prevent injection.
      const name =
        typeof row.name === 'string'
          ? row.name
              .replace(/<[^>]*>/g, '')
              .trim()
              .slice(0, 200)
          : null;
      if (!name) return null;
      const score = Number(row.intelligenceIndex);
      if (!Number.isFinite(score) || score < 0 || score > 100) return null;
      return { name, intelligenceIndex: score };
    })
    .filter(Boolean);
  if (!validated.length) throw new Error('PRIORS_AA_SCHEMA_CHANGED');
  return validated;
}
function resolveDescriptorSources(config) {
  if (Array.isArray(config && config.sources) && config.sources.length) {
    return config.sources
      .map((s) => {
        if (!s) return null;
        const url = s.url || s.endpoint;
        if (!url) return null;
        const id = s.id || s.name || (s.kind === 'bench' ? 'benchlm' : 'artificial-analysis');
        const kind = s.kind || (url.includes('bench') ? 'bench' : 'aa');
        return { id, kind, url };
      })
      .filter(Boolean);
  }
  const items = [];
  if (config && config.endpoint) {
    items.push({
      id: config.endpointId || 'artificial-analysis',
      kind: 'aa',
      url: config.endpoint,
    });
  }
  if (config && config.benchlm) {
    items.push({
      id: config.benchlmId || 'benchlm',
      kind: 'bench',
      url: config.benchlm,
    });
  }
  return items;
}

async function publicDocuments(options = {}) {
  const config = options.descriptor || descriptor;
  const fetcher = options.fetch || globalThis.fetch;
  const retrievedAt = new Date(options.now || Date.now()).toISOString();
  const documents = [];
  const entries = resolveDescriptorSources(config);
  for (const entry of entries) {
    const { kind, url, id } = entry;
    const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('PRIORS_PUBLIC_HTTP_' + response.status);
    const rows = kind === 'aa' ? aaRows(await response.text()) : (await response.json()).items;
    if (!Array.isArray(rows) || !rows.length) throw new Error('PRIORS_PUBLIC_SCHEMA_CHANGED');
    const source = { id, url, retrievedAt };
    const models = rows
      .map((row) => {
        const benchmarks = {};
        if (kind === 'aa') benchmarks.intelligenceIndex = row.intelligenceIndex;
        else {
          for (const [name, value] of Object.entries({
            benchlm: row.displayScore,
            aaAgenticIndex: row.benchmarks?.agentic?.aaAgenticIndex,
            aaCodingIndex: row.benchmarks?.coding?.aaCodingIndex,
          }))
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
              benchmarks[name] = value;
        }
        const rawId = kind === 'aa' ? row.name : row.canonicalModelKey || row.slug;
        if (typeof rawId !== 'string' || !rawId.trim()) return null;
        return {
          modelId: rawId
            .replace(/<[^>]*>/g, '')
            .trim()
            .slice(0, 200),
          benchmarks,
          source,
        };
      })
      .filter((row) => row && Object.keys(row.benchmarks).length);
    // Preserve exact effort entries so matching can prefer published variant scores.
    models.sort(
      (a, b) => (b.benchmarks.intelligenceIndex || 0) - (a.benchmarks.intelligenceIndex || 0)
    );
    const seen = new Set();
    documents.push({
      sources: [source],
      retrievedAt,
      models: models.filter((row) => {
        const id = require('./priors').leaderboardModelId(row.modelId);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }),
    });
  }
  return documents;
}
/**
 * Validate that documents returned by publicDocuments conform to the expected
 * schema before they are passed to mergePriorDocuments. Throws on malformed data.
 */
function validatePublicDocuments(documents) {
  if (!Array.isArray(documents)) throw new Error('PRIORS_PUBLIC_DOCUMENTS_NOT_ARRAY');
  for (const doc of documents) {
    if (!doc || typeof doc !== 'object') throw new Error('PRIORS_PUBLIC_DOCUMENT_INVALID');
    if (!Array.isArray(doc.sources) || !doc.sources.length)
      throw new Error('PRIORS_PUBLIC_DOCUMENT_NO_SOURCES');
    for (const source of doc.sources) {
      if (!source || typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url))
        throw new Error('PRIORS_PUBLIC_SOURCE_URL_INVALID');
    }
    const models = doc.models || doc.ranking;
    if (!Array.isArray(models) || !models.length)
      throw new Error('PRIORS_PUBLIC_DOCUMENT_NO_MODELS');
    for (const model of models) {
      if (!model || typeof model !== 'object') throw new Error('PRIORS_PUBLIC_MODEL_INVALID');
      const id = model.modelId || model.model || model.canonical;
      if (typeof id !== 'string' || !id.trim()) throw new Error('PRIORS_PUBLIC_MODEL_NO_ID');
      const benchmarks = model.benchmarks || {};
      if (typeof benchmarks !== 'object') throw new Error('PRIORS_PUBLIC_BENCHMARKS_INVALID');
      for (const [name, value] of Object.entries(benchmarks)) {
        if (typeof name !== 'string') continue;
        const score = Number(value && typeof value === 'object' ? value.score : value);
        if (value !== null && value !== undefined && Number.isFinite(score)) {
          if (score < 0 || score > 100) throw new Error('PRIORS_PUBLIC_SCORE_OUT_OF_BOUNDS');
        }
      }
    }
  }
  return documents;
}
module.exports = { publicDocuments, aaRows, liveModelIds, validatePublicDocuments };
