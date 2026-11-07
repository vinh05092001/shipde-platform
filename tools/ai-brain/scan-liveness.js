'use strict';

const fs = require('fs');
const { Level, ProofLevel, Status } = require('./evidence');

const identity = (sourceId, accountId, modelId) => JSON.stringify([sourceId, accountId, modelId]);

// File order is observation order. No alias expansion, credential reads or persistence.
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
    const passed =
      row.reason === 'OK' &&
      Number.isInteger(row.httpStatus) &&
      row.httpStatus >= 200 &&
      row.httpStatus < 300;
    latest.set(identity(row.sourceId, row.accountId, row.modelId), {
      reason: row.reason,
      status: passed ? Status.PASSED : Status.FAILED,
      level: Level.API,
      proofLevel: ProofLevel.API_PASS,
      observedAt,
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
