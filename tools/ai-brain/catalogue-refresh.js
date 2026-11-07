'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { sanitizeErrorSnippet } = require('./quota-scan');
const { safeText } = require('./coordinator-text');
const DATA_DIR = path.join(__dirname, 'data', 'discovery');
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
// Filesystem timestamp granularity tolerance when proving a stage wrote its
// evidence during this run (exFAT/NTFS rounding and host clock steps).
const EVIDENCE_SKEW_MS = 10 * 1000;

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
}

function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  return rawUrl
    .replace(/\/\/[^@/]+@/, '//[REDACTED]@')
    .replace(/\?[^#]*/, '')
    .replace(/["']?(?:api[-_]?key|token|secret|password)["']?\s*[:=]\s*[^,\s]+/gi, '[REDACTED]');
}

function sanitizeScope(rawScope) {
  if (!rawScope || typeof rawScope !== 'string') return '';
  return sanitizeErrorSnippet(rawScope, 1000)
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(
      /(["']?(?:api[-_]?key|token|secret|password)["']?\s*[:=]\s*)["'][^"'\n]*["']/gi,
      '$1"[REDACTED]"'
    );
}

/**
 * The 48h gate derives from exactly one persisted observation record
 * (freshness.json), which refreshCatalogue replaces atomically and advances
 * `lastSuccessfulAt` only after every stage of one refresh genuinely
 * succeeded (BR-166-01). A failed later attempt keeps the last good
 * observation and never advances it, so a catalogue whose last success is
 * inside the 48h window stays dispatchable even when the newest attempt
 * failed. refresh-report.json is a detail artifact, never a second gate
 * input, which removes the report/freshness disagreement window.
 */
function catalogueFreshness(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const doc = options.freshness || readJson(path.join(dataDir, 'freshness.json'), null);
  if (!doc || !doc.lastSuccessfulAt) {
    return {
      stale: true,
      code: 'STALE_CATALOGUE',
      lastSuccessfulAt: null,
      ageHours: null,
    };
  }
  const observed = Date.parse(doc.lastSuccessfulAt);
  const now = Number(options.now ?? Date.now());
  const ageMs = now - observed;
  const futureSkew = ageMs < 0;
  const expired = ageMs > MAX_AGE_MS;
  const stale = !Number.isFinite(ageMs) || futureSkew || expired;
  return {
    stale,
    code: stale ? 'STALE_CATALOGUE' : null,
    lastSuccessfulAt: doc.lastSuccessfulAt || null,
    ageHours: Number.isFinite(ageMs) && ageMs >= 0 ? ageMs / 3600000 : null,
  };
}

function runStage(args, context) {
  return new Promise((resolve) => {
    const stageArgs =
      args[0] === 'discovery' ? [...args, '--freshness-file', context.discoveryFile] : args;
    const child = spawn(process.execPath, [path.join(__dirname, 'cli.js'), ...stageArgs], {
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

function writtenThisRun(timestamp, startedEpoch) {
  const observed = Date.parse(timestamp);
  return Number.isFinite(observed) && observed >= startedEpoch - EVIDENCE_SKEW_MS;
}

async function refreshCatalogue(options = {}) {
  const startedAt = new Date(options.now ?? Date.now()).toISOString();
  const startedEpoch = Date.parse(startedAt);
  const dataDir = options.dataDir || DATA_DIR;
  const freshnessFile = options.freshnessFile || path.join(dataDir, 'freshness.json');
  const reportFile = options.reportFile || path.join(dataDir, 'refresh-report.json');
  // Last good observation before this run. A failed run preserves it and can
  // never advance it (BR-166-01); it is captured before any stage runs so a
  // stage that writes freshness mid-run cannot leak into a failed overall run.
  const previousFreshness = readJson(freshnessFile, {});
  // Discovery writes this attempt's observation, not the dispatch gate. A
  // crash or failed quota stage leaves the previous canonical success intact.
  const discoveryFile = freshnessFile + '.' + randomUUID() + '.observation.json';
  const stages = [];
  const stageDefs = [
    { args: ['priors', 'refresh'], name: 'priors refresh' },
    { args: ['discovery', 'run'], name: 'discovery run' },
    { args: ['quota-scan'], name: 'quota-scan' },
  ];

  for (const { args, name } of stageDefs) {
    let result;
    try {
      result = await (options.run || runStage)(args, { discoveryFile });
    } catch (error) {
      result = { exitCode: 1, stderr: error.code || 'REFRESH_FAILED' };
    }

    let stageExitCode = result.exitCode;
    let stageError =
      result.exitCode !== 0
        ? sanitizeErrorSnippet(safeText(result.stderr || 'REFRESH_FAILED'), 1000)
        : null;

    // An exit code of 0 only claims success; the stage-produced evidence must
    // exist, be valid and be provably written by this run. A partial run that
    // exits 0 without writing is rejected instead of reported as fresh.
    if (stageExitCode === 0 && options.verifyEvidence !== false) {
      if (name === 'priors refresh') {
        const priorsFile =
          options.priorsFile || path.join(__dirname, 'data', 'model-priors-live.json');
        let valid = false;
        try {
          const document = readJson(priorsFile, null);
          valid =
            fs.statSync(priorsFile).mtimeMs + EVIDENCE_SKEW_MS >= startedEpoch &&
            Boolean(document) &&
            Array.isArray(document.ranking);
        } catch {}
        if (!valid) {
          stageExitCode = 1;
          stageError = 'PRIORS_EVIDENCE_STALE_OR_MISSING';
        }
      } else if (name === 'discovery run') {
        const freshness = readJson(discoveryFile, null);
        if (!freshness) {
          stageExitCode = 1;
          stageError = 'DISCOVERY_FRESHNESS_MISSING';
        } else if (!writtenThisRun(freshness.lastAttemptAt, startedEpoch)) {
          stageExitCode = 1;
          stageError = 'DISCOVERY_EVIDENCE_STALE';
        } else if (
          !(freshness.listedSources > 0) &&
          (freshness.complete !== true || (freshness.failedSources || []).length > 0)
        ) {
          stageExitCode = 1;
          stageError = 'DISCOVERY_INCOMPLETE';
        }
      } else if (name === 'quota-scan') {
        const quotaFile = options.quotaFile || path.join(__dirname, 'data', 'quota-state.json');
        const quota = readJson(quotaFile, null);
        const recentRows = quota?.scopes
          ? Object.values(quota.scopes).filter((row) => writtenThisRun(row.at, startedEpoch))
          : [];
        if (!quota || recentRows.length === 0) {
          stageExitCode = 1;
          stageError = 'QUOTA_SCAN_EMPTY_EVIDENCE';
        }
      }
    }

    stages.push({
      command: args.join(' '),
      exitCode: stageExitCode,
      ...(stageError ? { error: stageError } : {}),
    });
  }

  // One failing source must not stop the Controller: a public score fetch failure keeps the
  // last scores, and discovery passes when at least one source listed its models.
  const priorsFile = options.priorsFile || path.join(__dirname, 'data', 'model-priors-live.json');
  const keptPriors = readJson(priorsFile, null);
  const allStagesOk = stages.every(
    (stage) =>
      stage.exitCode === 0 ||
      (stage.command === 'priors refresh' && Array.isArray(keptPriors?.ranking))
  );
  const finishedAt = new Date(options.now ?? Date.now()).toISOString();
  const report = {
    startedAt,
    finishedAt,
    ok: allStagesOk,
    stages,
  };

  if (options.persist !== false && stages.find((s) => s.command === 'quota-scan')?.exitCode === 0) {
    const quota = readJson(
      options.quotaFile || path.join(__dirname, 'data', 'quota-state.json'),
      null
    );
    if (quota?.scopes) {
      const observations = [
        ...new Map(
          Object.values(quota.scopes)
            .filter((row) => Date.parse(row.at) >= startedEpoch)
            .map((row) => [
              JSON.stringify([row.source, row.scope, row.upstream, row.model, row.code, row.at]),
              {
                code: /^[A-Z_]+$/.test(row.code) ? row.code : 'UNKNOWN',
              },
            ])
        ).values(),
      ];
      const statusCounts = {};
      for (const row of observations) {
        statusCounts[row.code] = (statusCounts[row.code] || 0) + 1;
      }
      writeJson(options.summaryFile || path.join(__dirname, 'data', 'quota-scan-summary.json'), {
        scanFinishedAt: report.finishedAt,
        command: 'quota-scan',
        observedScopes: observations.length,
        statusCounts,
      });
    }
  }

  if (options.persist !== false) {
    // Detail artifact first, then the single canonical observation record,
    // each replaced atomically (fsync + rename) by the same verified outcome.
    writeJson(reportFile, report);
    const stageEntries = stages
      .filter((s) => s.exitCode !== 0)
      .map((s) => ({ id: s.command, reason: s.error || 'FAILED' }));
    let failedSources = stageEntries;
    {
      // Keep the discovery stage's per-source failure detail when it is the
      // evidence this run produced; fall back to stage-level entries only when
      // the stage crashed before writing its own observation.
      const left = readJson(discoveryFile, {});
      const discoveryStage = stages.find((s) => s.command === 'discovery run');
      if (
        writtenThisRun(left.lastAttemptAt, startedEpoch) &&
        Array.isArray(left.failedSources) &&
        left.failedSources.length > 0
      ) {
        failedSources = [
          ...left.failedSources,
          ...stageEntries.filter((entry) => entry.id !== 'discovery run'),
        ];
      }
    }
    writeJson(freshnessFile, {
      lastAttemptAt: report.finishedAt,
      lastSuccessfulAt: allStagesOk
        ? report.finishedAt
        : previousFreshness.lastSuccessfulAt || null,
      complete: allStagesOk,
      failedSources,
    });
  }

  fs.rmSync(discoveryFile, { force: true });

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

module.exports = {
  catalogueFreshness,
  refreshCatalogue,
  readJson,
  writeJson,
  sanitizeUrl,
  sanitizeScope,
  MAX_AGE_MS,
};
