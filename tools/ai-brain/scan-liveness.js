'use strict';

const fs = require('fs');
const { Level, ProofLevel, Status } = require('./evidence');
const { classifyQuotaResponse } = require('./quota-scan');

const identity = (sourceId, accountId, modelId) => JSON.stringify([sourceId, accountId, modelId]);

// Explicit observation time wins; file order breaks ties for legacy rows.
function readScanLiveness(file) {
  const latest = new Map();
  if (!file) return latest;
  const observedAt = fs.statSync(file).mtime.toISOString();
  const lines = fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error('SCAN_INVALID_LINE:' + (index + 1));
    }
    if (
      !row ||
      ![row.sourceId, row.accountId, row.modelId].every(
        (value) => typeof value === 'string' && value.length > 0
      ) ||
      !/^[A-Z][A-Z0-9_]*$/.test(row.reason || '')
    ) {
      throw new Error('SCAN_INVALID_LINE:' + (index + 1));
    }
    const at = row.observedAt || row.at || observedAt;
    if (!Number.isFinite(Date.parse(at))) throw new Error('SCAN_INVALID_LINE:' + (index + 1));
    const classified =
      row.body !== undefined || row.snippet !== undefined
        ? classifyQuotaResponse(
            row.httpStatus,
            row.body ?? row.snippet,
            row.headers,
            Date.parse(at)
          )
        : { reason: row.reason, retryAfter: null };
    const passed =
      classified.reason === 'OK' &&
      Number.isInteger(row.httpStatus) &&
      row.httpStatus >= 200 &&
      row.httpStatus < 300;
    const key = identity(row.sourceId, row.accountId, row.modelId);
    if (Date.parse(latest.get(key)?.observedAt) > Date.parse(at)) return;
    latest.set(key, {
      reason: classified.reason,
      status: passed ? Status.PASSED : Status.FAILED,
      level: Level.API,
      proofLevel: ProofLevel.API_PASS,
      observedAt: at,
      retryAfter: classified.retryAfter,
      ...(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 ? { elapsedMs: row.elapsedMs } : {}),
    });
  });
  return latest;
}

function withScanLiveness(candidate, latest) {
  if (!latest.size) return candidate;
  const sourceId = candidate.sourceId || candidate.source || candidate.gateway;
  // A transport prefix can also be an API namespace. Never infer a different API ID.
  const record = latest.get(identity(sourceId, candidate.accountId, candidate.modelId));
  if (!record) return candidate;
  // Admission-only proof: neither serialization nor downstream candidate copies
  // may promote a scan observation into durable routing evidence.
  return Object.defineProperty({ ...candidate }, 'scanLiveness', { value: record });
}

module.exports = { readScanLiveness, withScanLiveness };
