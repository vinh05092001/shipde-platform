'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sanitizeErrorSnippet } = require('./quota-scan');
const DATA_DIR = path.join(__dirname, 'data', 'discovery');
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}
function catalogueFreshness(options = {}) {
  const doc =
    options.freshness || readJson(path.join(options.dataDir || DATA_DIR, 'freshness.json'));
  const observed = Date.parse(doc.lastSuccessfulAt);
  const now = Number(options.now ?? Date.now());
  const ageMs = now - observed;
  const stale = !Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_AGE_MS;
  return {
    stale,
    code: stale ? 'STALE_CATALOGUE' : null,
    lastSuccessfulAt: doc.lastSuccessfulAt || null,
    ageHours: Number.isFinite(ageMs) ? ageMs / 3600000 : null,
  };
}
function runStage(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error) => resolve({ exitCode: 1, stderr: error.code || 'SPAWN_FAILED' }));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stderr }));
  });
}
async function refreshCatalogue(options = {}) {
  const startedAt = new Date(options.now ?? Date.now()).toISOString();
  const stages = [];
  for (const args of [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]) {
    let result;
    try {
      result = await (options.run || runStage)(args);
    } catch (error) {
      result = { exitCode: 1, stderr: error.code || 'REFRESH_FAILED' };
    }
    stages.push({
      command: args.join(' '),
      exitCode: result.exitCode,
      ...(result.exitCode !== 0
        ? { error: sanitizeErrorSnippet(result.stderr || 'REFRESH_FAILED', 1000) }
        : {}),
    });
  }
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: stages.every((stage) => stage.exitCode === 0),
    stages,
  };
  if (options.persist !== false && stages.at(-1).exitCode === 0) {
    const quota = readJson(path.join(__dirname, 'data', 'quota-state.json'));
    if (quota.scopes) {
      const observations = [
        ...new Map(
          Object.values(quota.scopes)
            .filter((row) => Date.parse(row.at) >= Date.parse(startedAt))
            .map((row) => [
              JSON.stringify([row.source, row.scope, row.upstream, row.model, row.code, row.at]),
              row,
            ])
        ).values(),
      ];
      const statusCounts = {};
      for (const row of observations) {
        const code = /^[A-Z_]+$/.test(row.code) ? row.code : 'UNKNOWN';
        statusCounts[code] = (statusCounts[code] || 0) + 1;
      }
      writeJson(path.join(__dirname, 'data', 'quota-scan-summary.json'), {
        scanFinishedAt: report.finishedAt,
        command: 'quota-scan',
        observedScopes: observations.length,
        statusCounts,
      });
    }
  }
  if (options.persist !== false)
    writeJson(options.reportFile || path.join(DATA_DIR, 'refresh-report.json'), report);
  return report;
}
if (require.main === module)
  refreshCatalogue()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch(() => {
      console.error('REFRESH_FAILED');
      process.exitCode = 1;
    });
module.exports = { catalogueFreshness, refreshCatalogue, readJson, writeJson, MAX_AGE_MS };
