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
function parseRecords(html) {
  const t = html.replace(/\\"/g, '"');
  const out = new Map();
  const re = /"intelligenceIndex":(-?[0-9.]+)/g;
  let m;
  while ((m = re.exec(t))) {
    let depth = 0;
    let start = -1;
    for (let k = m.index; k >= 0; k--) {
      if (t[k] === '}') depth++;
      else if (t[k] === '{') {
        if (depth === 0) {
          start = k;
          break;
        }
        depth--;
      }
    }
    if (start < 0) continue;
    let d = 0;
    let end = -1;
    for (let k = start; k < t.length; k++) {
      if (t[k] === '{') d++;
      else if (t[k] === '}' && --d === 0) {
        end = k;
        break;
      }
    }
    let o;
    try {
      o = JSON.parse(t.slice(start, end + 1));
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
  return [...out.values()];
}

function releaseSlugs(html) {
  const t = html.replace(/\\"/g, '"');
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
