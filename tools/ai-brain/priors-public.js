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

function resolveCreatorModelAlias(creator, model, config) {
  if (!creator && !model) return null;
  const cfg = config || descriptor;
  const rules = cfg?.aliasRules?.creatorModelRules;
  const cNorm = creator ? String(creator).trim().toLowerCase() : '';
  const mNorm = model ? String(model).trim().toLowerCase() : '';

  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!rule || !rule.model) continue;
      const ruleM = String(rule.model).trim().toLowerCase();
      const ruleC = rule.creator ? String(rule.creator).trim().toLowerCase() : '';
      if (ruleC) {
        if (ruleC === cNorm && ruleM === mNorm) {
          return rule.routerId || rule.target || null;
        }
      } else if (ruleM === mNorm) {
        return rule.routerId || rule.target || null;
      }
    }
  }

  const map = cfg?.aliasRules?.creatorModelMap;
  if (map && typeof map === 'object') {
    const key = `${creator || ''}/${model || ''}`;
    if (map[key]) return map[key];
    for (const [k, v] of Object.entries(map)) {
      if (k.toLowerCase() === key.toLowerCase()) return v;
    }
  }
  return null;
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

function sweBenchRows(html, config) {
  const match = html.match(/id="leaderboard-data">\s*(\[.*?\])\s*<\/script>/s);
  if (!match) throw new Error('PRIORS_SWEBENCH_SCHEMA_CHANGED');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new Error('PRIORS_SWEBENCH_SCHEMA_CHANGED');
  }
  if (!Array.isArray(data) || !data.length) throw new Error('PRIORS_SWEBENCH_SCHEMA_CHANGED');
  const board = data.find((b) => b && (b.name === 'Verified' || b.name === 'Lite')) || data[0];
  const results = board && Array.isArray(board.results) ? board.results : [];
  if (!results.length) throw new Error('PRIORS_SWEBENCH_SCHEMA_CHANGED');

  const rows = [];
  for (const item of results) {
    const score = Number(item.resolved);
    if (!Number.isFinite(score) || score < 0 || score > 100) continue;
    const modelTag = Array.isArray(item.tags)
      ? item.tags.find((t) => typeof t === 'string' && /^Model:\s*/i.test(t))
      : null;
    let modelId = modelTag
      ? modelTag.replace(/^Model:\s*/i, '').trim()
      : item.model_display || item.name;
    if (
      item.reasoning_effort &&
      typeof item.reasoning_effort === 'string' &&
      !modelId.toLowerCase().includes(item.reasoning_effort.toLowerCase())
    ) {
      modelId = `${modelId}-${item.reasoning_effort}`;
    }
    const creator = item.model_org || item.agent_org || null;
    const model = item.model_display || item.name || null;
    const alias = resolveCreatorModelAlias(creator, model, config);
    rows.push({
      modelId: alias || modelId,
      benchmarks: { sweBenchVerified: Math.round(score * 10) / 10 },
      creator,
      model,
      ...(alias ? { aliases: [alias] } : {}),
    });
  }
  if (!rows.length) throw new Error('PRIORS_SWEBENCH_SCHEMA_CHANGED');
  return rows;
}

function terminalBenchRows(html, config) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\((.*?)\);?\s*<\/script>/gs)]
    .map((m) => {
      try {
        return JSON.parse(m[1])[1] || '';
      } catch {
        return '';
      }
    })
    .join('');
  const entries = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    const accuracy =
      value.metrics && typeof value.metrics === 'object'
        ? value.metrics.accuracy
        : value.accuracy !== undefined
          ? value.accuracy
          : null;
    const modelDisplay =
      (value.metadata && value.metadata.model_display) || value.model_display || value.model;
    if (accuracy !== null && accuracy !== undefined && modelDisplay) {
      entries.push(value);
    }
    for (const child of Object.values(value)) walk(child);
  }
  for (const line of chunks.split('\n')) {
    const start = line.indexOf(':');
    try {
      walk(JSON.parse(line.slice(start + 1)));
    } catch {}
  }
  const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (nextData) {
    try {
      walk(JSON.parse(nextData[1]));
    } catch {}
  }
  if (!entries.length) throw new Error('PRIORS_TERMINALBENCH_SCHEMA_CHANGED');

  const rows = [];
  for (const item of entries) {
    const acc = Number(
      item.metrics && typeof item.metrics === 'object' ? item.metrics.accuracy : item.accuracy
    );
    if (!Number.isFinite(acc) || acc < 0 || acc > 100) continue;
    const meta = item.metadata || item;
    const display = meta.model_display;
    const modelName =
      typeof display === 'object' && display ? display.label || display.name : display;
    if (!modelName || typeof modelName !== 'string') continue;
    const org = meta.model_org || meta.agent_org;
    const creator = typeof org === 'object' && org ? org.label || org.name : org || null;
    let modelId = modelName;
    const effort = meta.reasoning_effort;
    if (
      effort &&
      typeof effort === 'string' &&
      effort !== 'none' &&
      !modelId.toLowerCase().includes(effort.toLowerCase())
    ) {
      modelId = `${modelId}-${effort}`;
    }
    const alias = resolveCreatorModelAlias(creator, modelName, config);
    rows.push({
      modelId: alias || modelId,
      benchmarks: { terminalBenchAccuracy: Math.round(acc * 10) / 10 },
      creator,
      model: modelName,
      ...(alias ? { aliases: [alias] } : {}),
    });
  }
  if (!rows.length) throw new Error('PRIORS_TERMINALBENCH_SCHEMA_CHANGED');
  return rows;
}

function aiderRows(yamlText, config) {
  if (typeof yamlText !== 'string' || !yamlText.trim()) {
    throw new Error('PRIORS_AIDER_SCHEMA_CHANGED');
  }
  const lines = yamlText.split(/\r?\n/);
  const items = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (rawLine.startsWith('- ') || line.startsWith('- ')) {
      if (current) items.push(current);
      current = {};
      const rest = line.slice(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx !== -1) {
        const k = rest.slice(0, colonIdx).trim();
        const v = rest.slice(colonIdx + 1).trim();
        current[k] = v;
      }
    } else if (current) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const k = line.slice(0, colonIdx).trim();
        const v = line.slice(colonIdx + 1).trim();
        current[k] = v;
      }
    }
  }
  if (current) items.push(current);
  if (!items.length) throw new Error('PRIORS_AIDER_SCHEMA_CHANGED');

  const rows = [];
  for (const item of items) {
    const rate = Number(item.pass_rate_2 !== undefined ? item.pass_rate_2 : item.pass_rate_1);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) continue;
    const model = item.model;
    if (!model || typeof model !== 'string') continue;
    const alias = resolveCreatorModelAlias(null, model, config);
    rows.push({
      modelId: alias || model,
      benchmarks: { aiderPolyglot: Math.round(rate * 10) / 10 },
      model,
      ...(alias ? { aliases: [alias] } : {}),
    });
  }
  if (!rows.length) throw new Error('PRIORS_AIDER_SCHEMA_CHANGED');
  return rows;
}

function liveBenchRows(csvText, config) {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new Error('PRIORS_LIVEBENCH_SCHEMA_CHANGED');
  }
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('PRIORS_LIVEBENCH_SCHEMA_CHANGED');
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const modelIdx = headers.indexOf('model');
  if (modelIdx === -1) throw new Error('PRIORS_LIVEBENCH_SCHEMA_CHANGED');

  const codingIdx = headers.indexOf('coding');
  const reasoningIdx = headers.indexOf('reasoning');
  const agenticIdx = headers.indexOf('long_agentic');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p) => p.trim());
    const model = parts[modelIdx];
    if (!model) continue;
    const benchmarks = {};
    if (codingIdx !== -1) {
      const c = Number(parts[codingIdx]);
      if (Number.isFinite(c) && c >= 0 && c <= 100)
        benchmarks.liveBenchCoding = Math.round(c * 10) / 10;
    }
    if (reasoningIdx !== -1) {
      const r = Number(parts[reasoningIdx]);
      if (Number.isFinite(r) && r >= 0 && r <= 100)
        benchmarks.liveBenchReasoning = Math.round(r * 10) / 10;
    }
    if (agenticIdx !== -1) {
      const a = Number(parts[agenticIdx]);
      if (Number.isFinite(a) && a >= 0 && a <= 100)
        benchmarks.liveBenchAgentic = Math.round(a * 10) / 10;
    }
    if (Object.keys(benchmarks).length === 0) continue;
    const alias = resolveCreatorModelAlias(null, model, config);
    rows.push({
      modelId: alias || model,
      benchmarks,
      model,
      ...(alias ? { aliases: [alias] } : {}),
    });
  }
  if (!rows.length) throw new Error('PRIORS_LIVEBENCH_SCHEMA_CHANGED');
  return rows;
}

function benchlmRows(json, config) {
  const items = Array.isArray(json) ? json : json && Array.isArray(json.items) ? json.items : [];
  if (!items.length) throw new Error('PRIORS_BENCHLM_SCHEMA_CHANGED');

  const rows = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const benchmarks = {};
    const creator = item.creator || null;
    const model = item.model || null;
    const alias = resolveCreatorModelAlias(creator, model, config);

    // Official vs provisional displayScore
    const officialScore = Number(item.displayScore);
    const provScore = Number(item.provisionalDisplayScore);
    const isProvisionalOnly =
      item.rankingEligible === false ||
      item.displayScore === null ||
      item.displayScore === undefined;

    if (
      !isProvisionalOnly &&
      Number.isFinite(officialScore) &&
      officialScore >= 0 &&
      officialScore <= 100
    ) {
      benchmarks.benchlm = { score: Math.round(officialScore * 10) / 10, provisional: false };
    } else if (Number.isFinite(provScore) && provScore >= 0 && provScore <= 100) {
      benchmarks.benchlm = { score: Math.round(provScore * 10) / 10, provisional: true };
    }

    if (item.benchmarks && typeof item.benchmarks === 'object') {
      const ag = Number(item.benchmarks.agentic?.aaAgenticIndex);
      if (Number.isFinite(ag) && ag >= 0 && ag <= 100)
        benchmarks.aaAgenticIndex = Math.round(ag * 10) / 10;
      const cd = Number(item.benchmarks.coding?.aaCodingIndex);
      if (Number.isFinite(cd) && cd >= 0 && cd <= 100)
        benchmarks.aaCodingIndex = Math.round(cd * 10) / 10;
    }

    if (!Object.keys(benchmarks).length) continue;
    const rawId = alias || item.canonicalModelKey || item.slug || item.model;
    if (!rawId || typeof rawId !== 'string') continue;
    const isRowProvisional = Boolean(benchmarks.benchlm && benchmarks.benchlm.provisional);

    rows.push({
      modelId: rawId,
      benchmarks,
      creator,
      model,
      ...(alias ? { aliases: [alias] } : {}),
      ...(isRowProvisional ? { provisional: true } : {}),
    });
  }
  if (!rows.length) throw new Error('PRIORS_BENCHLM_SCHEMA_CHANGED');
  return rows;
}

function resolveDescriptorSources(config) {
  if (Array.isArray(config && config.sources) && config.sources.length) {
    return config.sources
      .map((s) => {
        if (!s) return null;
        const url = s.url || s.endpoint;
        if (!url) return null;
        const id = s.id || s.name || (s.kind === 'bench' ? 'benchlm' : 'artificial-analysis');
        const kind =
          s.kind ||
          (url.includes('benchlm')
            ? 'benchlm'
            : url.includes('swebench')
              ? 'swebench'
              : url.includes('tbench')
                ? 'terminalbench'
                : url.includes('aider')
                  ? 'aider'
                  : url.includes('livebench')
                    ? 'livebench'
                    : url.includes('bench')
                      ? 'benchlm'
                      : 'aa');
        return {
          id,
          kind,
          url,
          metricNames: s.metricNames,
          roleWeights: s.roleWeights,
          trustLevel: s.trustLevel,
        };
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
      kind: 'benchlm',
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

    let rows;
    if (kind === 'aa') {
      rows = aaRows(await response.text());
    } else if (kind === 'bench' || kind === 'benchlm') {
      rows = benchlmRows(await response.json(), config);
    } else if (kind === 'swebench') {
      rows = sweBenchRows(await response.text(), config);
    } else if (kind === 'terminalbench') {
      rows = terminalBenchRows(await response.text(), config);
    } else if (kind === 'aider') {
      rows = aiderRows(await response.text(), config);
    } else if (kind === 'livebench') {
      rows = liveBenchRows(await response.text(), config);
    } else {
      const data = await response.json();
      rows = Array.isArray(data) ? data : data.items || [];
    }

    if (!Array.isArray(rows) || !rows.length) throw new Error('PRIORS_PUBLIC_SCHEMA_CHANGED');
    const source = { id, url, retrievedAt };
    const models = rows
      .map((row) => {
        let benchmarks = {};
        if (row.benchmarks && typeof row.benchmarks === 'object') {
          benchmarks = row.benchmarks;
        } else if (kind === 'aa') {
          benchmarks.intelligenceIndex = row.intelligenceIndex;
        } else {
          for (const [name, value] of Object.entries({
            benchlm: row.displayScore,
            aaAgenticIndex: row.benchmarks?.agentic?.aaAgenticIndex,
            aaCodingIndex: row.benchmarks?.coding?.aaCodingIndex,
          }))
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
              benchmarks[name] = value;
        }
        const rawId =
          row.modelId ||
          (kind === 'aa' ? row.name : row.canonicalModelKey || row.slug || row.model);
        if (typeof rawId !== 'string' || !rawId.trim()) return null;
        return {
          modelId: rawId
            .replace(/<[^>]*>/g, '')
            .trim()
            .slice(0, 200),
          benchmarks,
          source,
          ...(row.creator ? { creator: row.creator } : {}),
          ...(row.model ? { model: row.model } : {}),
          ...(Array.isArray(row.aliases) ? { aliases: row.aliases } : {}),
          ...(row.provisional ? { provisional: true } : {}),
        };
      })
      .filter((row) => row && Object.keys(row.benchmarks).length);

    // Preserve exact effort entries so matching can prefer published variant scores.
    models.sort((a, b) => {
      const aScore = a.benchmarks.intelligenceIndex?.score ?? a.benchmarks.intelligenceIndex ?? 0;
      const bScore = b.benchmarks.intelligenceIndex?.score ?? b.benchmarks.intelligenceIndex ?? 0;
      return bScore - aScore;
    });

    const seen = new Set();
    documents.push({
      sources: [source],
      retrievedAt,
      models: models.filter((row) => {
        const id = require('./priors').leaderboardModelId(row.modelId, config);
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

module.exports = {
  publicDocuments,
  aaRows,
  sweBenchRows,
  terminalBenchRows,
  aiderRows,
  liveBenchRows,
  benchlmRows,
  resolveCreatorModelAlias,
  liveModelIds,
  validatePublicDocuments,
};
