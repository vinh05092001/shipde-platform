'use strict';
// Fetch the Artificial Analysis leaderboard named by scoring-policy.json and write the
// runtime snapshot it points to (gitignored). Each row: name, base, variant, ii (Intelligence
// Index, provenance) and pct (midrank percentile of ii among every published row).
// Usage: node tools/ai-brain/aa-snapshot.js [--policy <file>]
const fs = require('node:fs');
const path = require('node:path');

function parseRows(html) {
  const rows = [];
  for (const tr of html.split(/<tr[ >]/).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (cells.length < 4) continue;
    const ii = Number(cells[3]);
    if (!cells[0] || !Number.isFinite(ii)) continue;
    const m = cells[0].match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    rows.push({
      name: cells[0],
      base: (m ? m[1] : cells[0]).toLowerCase().replace(/[._ ]+/g, '-'),
      variant: m ? m[2].toLowerCase().split(/\s+/)[0] : '',
      ii,
    });
  }
  const population = {};
  for (const r of rows) population[r.ii] = (population[r.ii] || 0) + 1;
  const sorted = rows.map((r) => r.ii);
  for (const r of rows) {
    const lower = sorted.filter((v) => v < r.ii).length;
    r.pct = Math.round(((lower + population[r.ii] / 2) / sorted.length) * 1000) / 10;
  }
  return { rows, population };
}

// AA pages embed full model records (slug, name, deprecated, release, intelligenceIndex) in their
// payload, including deprecated models the leaderboard table hides. Each record's own enclosing
// object is parsed; a record is identified by its own slug, never by a neighbour's.
// Next.js pages carry their data as JSON string literals in self.__next_f.push([1, "..."]);
// decode each literal so the scanner sees real JSON, not an escaped string.
function pagePayload(html) {
  const parts = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      parts.push(JSON.parse(m[1]));
    } catch {
      // A malformed chunk breaks the stream: nothing may join across it.
      parts.push(CHUNK_BREAK);
    }
  }
  return parts.length ? parts.join('') : html;
}
// U+0000 cannot appear raw in valid JSON, so it can only be a break marker.
const CHUNK_BREAK = '\u0000';

function parseRecords(html) {
  const t = pagePayload(html);
  const out = new Map();
  // One pass over structural braces only: characters inside JSON strings (with escapes) never count.
  const starts = [];
  let inString = false;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === CHUNK_BREAK) {
      starts.length = 0;
      inString = false;
      continue;
    }
    if (inString) {
      if (c === '\\') k++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') starts.push(k);
    else if (c === '}' && starts.length) {
      const start = starts.pop();
      const span = t.slice(start, k + 1);
      if (!span.includes('"intelligenceIndex":')) continue;
      let o;
      try {
        o = JSON.parse(span);
      } catch {
        continue;
      }
      if (typeof o.slug !== 'string' || typeof o.name !== 'string') continue;
      if (!Number.isFinite(o.intelligenceIndex) || out.has(o.slug)) continue;
      out.set(o.slug, {
        slug: o.slug,
        name: o.name,
        ii: o.intelligenceIndex,
        deprecated: o.deprecated === true,
        release: o.release && typeof o.release.slug === 'string' ? o.release.slug : null,
      });
    }
  }
  return [...out.values()];
}

function releaseSlugs(html) {
  const t = pagePayload(html);
  return [...new Set([...t.matchAll(/"releaseSlug":"([a-z0-9.-]+)"/g)].map((x) => x[1]))];
}

function rowsFromRecords(records) {
  const rows = records.map((r) => {
    const m = r.name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return {
      name: r.name,
      base: (m ? m[1] : r.name).toLowerCase().replace(/[._ ]+/g, '-'),
      variant: m ? m[2].toLowerCase().split(/\s+/)[0].replace(/,$/, '') : '',
      ii: r.ii,
      deprecated: r.deprecated,
    };
  });
  const population = {};
  for (const r of rows) population[r.ii] = (population[r.ii] || 0) + 1;
  for (const r of rows) {
    const lower = rows.filter((x) => x.ii < r.ii).length;
    r.pct = Math.round(((lower + population[r.ii] / 2) / rows.length) * 1000) / 10;
  }
  return { rows, population };
}

async function deepRecords(policy, html, fetchImpl, log = () => {}) {
  const records = new Map(parseRecords(html).map((r) => [r.slug, r]));
  const base = policy.modelPageBase;
  if (typeof base !== 'string' || !/^https:\/\//.test(base)) return [...records.values()];
  const queue = releaseSlugs(html);
  const workers = Array.from({ length: Number(policy.modelPageConcurrency) || 1 }, async () => {
    while (queue.length) {
      const slug = queue.shift();
      try {
        const res = await fetchImpl(base + encodeURIComponent(slug), {
          headers: { 'user-agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
          log(`${slug}: HTTP ${res.status}`);
          continue;
        }
        for (const r of parseRecords(await res.text()))
          if (!records.has(r.slug)) records.set(r.slug, r);
      } catch (e) {
        log(`${slug}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);
  return [...records.values()];
}

async function snapshot(policyFile, fetchImpl = fetch, options = {}) {
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  const res = await fetchImpl(policy.source, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error('AA_HTTP_' + res.status);
  const html = await res.text();
  // Records embedded in AA pages, including deprecated models, when the policy names the model
  // page base; otherwise only the visible leaderboard table.
  const records = policy.modelPageBase
    ? await deepRecords(policy, html, fetchImpl, options.log)
    : [];
  const { rows, population } = records.length ? rowsFromRecords(records) : parseRows(html);
  if (!rows.length) throw new Error('AA_NO_ROWS: page layout changed');
  const doc = {
    source: policy.source,
    version: policy.version.split('-percentile')[0],
    observedAt: new Date().toISOString(),
    unit: policy.dimensions.quality.unit,
    min: policy.dimensions.quality.min,
    max: policy.dimensions.quality.max,
    percentileFormula:
      'aa-snapshot.js: round(((count(ii < row.ii) + 0.5 * count(ii == row.ii)) / populationSize) * 1000) / 10',
    population,
    rows,
  };
  const out = path.resolve(path.dirname(policyFile), policy.priorsFile);
  fs.writeFileSync(out + '.tmp', JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(out + '.tmp', out);
  return { file: out, rows: rows.length };
}

module.exports = { parseRows, parseRecords, releaseSlugs, rowsFromRecords, snapshot };

if (require.main === module) {
  const i = process.argv.indexOf('--policy');
  const file =
    i > 0 ? path.resolve(process.argv[i + 1]) : path.join(__dirname, 'data', 'scoring-policy.json');
  snapshot(file)
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
