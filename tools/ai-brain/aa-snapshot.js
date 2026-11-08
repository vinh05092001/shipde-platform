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

async function snapshot(policyFile, fetchImpl = fetch) {
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  const res = await fetchImpl(policy.source, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error('AA_HTTP_' + res.status);
  const { rows, population } = parseRows(await res.text());
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

module.exports = { parseRows, snapshot };

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
