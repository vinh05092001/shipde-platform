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
  return rows;
}
async function publicDocuments(options = {}) {
  const config = options.descriptor || descriptor;
  const fetcher = options.fetch || globalThis.fetch;
  const retrievedAt = new Date(options.now || Date.now()).toISOString();
  const documents = [];
  for (const [kind, url] of [
    ['aa', config.endpoint],
    ['bench', config.benchlm],
  ]) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('PRIORS_PUBLIC_HTTP_' + response.status);
    const rows = kind === 'aa' ? aaRows(await response.text()) : (await response.json()).items;
    if (!Array.isArray(rows) || !rows.length) throw new Error('PRIORS_PUBLIC_SCHEMA_CHANGED');
    const source = { url, retrievedAt };
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
            if (typeof value === 'number' && Number.isFinite(value)) benchmarks[name] = value;
        }
        return {
          modelId: kind === 'aa' ? row.name : row.canonicalModelKey || row.slug,
          benchmarks,
          source,
        };
      })
      .filter((row) => Object.keys(row.benchmarks).length);
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
module.exports = { publicDocuments, aaRows, liveModelIds };
