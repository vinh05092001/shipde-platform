'use strict';

/**
 * Ship Dễ — Model discovery: evidence import (W2)
 *
 * History is never rewritten: the two historical logs written by the previous
 * catalogue slice are carried forward as *evidence*, not as live truth. This
 * module reads them, attributes each row to a candidate identity, separates
 * the noise from the signal, and writes one dated evidence file per source so
 * a report can quote exactly what happened and when.
 *
 * PROBE_INVALID is the row shape `status FAIL + contentLength 0 + reason
 * "answered" + errorClass "unknown"`: the probe answered with no content, a
 * client-side empty-response bug, and it is evidence the client was confused,
 * never evidence a model failed. Such rows are counted separately and never
 * reported as model failures, but their model ids are still valid evidence of
 * advertising and are imported as candidates.
 *
 * Neither the checkpoint nor the outer log carries a credential value; the
 * outer log names env vars (never values) and this module never resolves them.
 */

const fs = require('fs');
const path = require('path');
const { candidateKey, modelBase } = require('./identity');

const trimId = (id) =>
  id === null || id === undefined ? null : String(id).trim().replace(/\r$/, '');

function isProbeInvalid(row) {
  if (!row) return false;
  // 1. Client empty-response / parser failure on SSE
  if (
    row.status === 'FAIL' &&
    row.contentLength === 0 &&
    (row.reason === 'answered' || (row.reason && /empty content|sse|parser/i.test(row.reason)))
  ) {
    return true;
  }
  if (
    row.status === 'FAIL' &&
    row.error &&
    /empty content|sse|parser/i.test(String(row.error)) &&
    (row.contentLength === 0 || row.contentLength === undefined)
  ) {
    return true;
  }
  // 2. ENOENT from spawning an npm .cmd shim without a shell
  if (
    row.enoent === true ||
    (row.errorClass && /ENOENT/i.test(String(row.errorClass))) ||
    (row.reason && /ENOENT/i.test(String(row.reason))) ||
    (row.error && /ENOENT/i.test(String(row.error))) ||
    (row.reason && /\.cmd\b/i.test(String(row.reason)) && /spawn|shell|enoent/i.test(String(row.reason))) ||
    (row.error && /\.cmd\b/i.test(String(row.error)) && /spawn|shell|enoent/i.test(String(row.error))) ||
    (row.classification && (row.classification.class === 'enoent' || /enoent/i.test(String(row.classification.innerCause || ''))))
  ) {
    return true;
  }
  return false;
}

function checkpointIdentity(row) {
  const id =
    row.harness === 'http' ? row.modelIdHttp || row.model : row.modelIdOpenCode || row.model;
  const modelId = trimId(id);
  if (!modelId) return null;
  const harness = row.harness === 'paseo' ? 'paseo' : 'http';
  const opencodePath = row.accessPath === 'opencode';
  // The paseo path names ids with their own route prefix (`agentrouter/…`,
  // `ninerouter/…`); upstream follows the id (same rule as the live paseo
  // adapter), not the row's loose label, so import and live agree.
  const upstream = opencodePath
    ? modelId.indexOf('/') === -1
      ? 'opencode'
      : modelId.slice(0, modelId.indexOf('/'))
    : trimId(row.upstreamOrAccount) || '9router';
  const gateway = opencodePath ? 'opencode' : '9router';
  const account = trimId(row.account) || '';
  const quotaScope = trimId(row.quotaScope) || '';
  const identity = {
    harness,
    accessPath: opencodePath ? 'opencode' : '9router',
    gateway,
    upstream,
    account,
    quotaScope,
    modelId,
  };
  return { identity, key: candidateKey(identity), modelId };
}

/**
 * Import the model checkpoint into one dated evidence entry.
 *
 * @param filePath checkpoint.jsonl
 * @param opts { readFileP, offsets: number, prefixes, now }
 * @returns evidence entry + summary
 */
async function importCheckpoint(filePath, opts) {
  const o = opts || {};
  const read = o.readFile || fs.readFileSync;
  const prefixes = o.prefixes || [];
  const now = o.now || new Date().toISOString();
  const text = read(filePath, 'utf8');
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      rows.push(JSON.parse(raw));
    } catch (e) {
      rows.push({ malformed: true, raw: String(raw).slice(0, 1000) });
    }
  }
  const real = rows.filter((r) => !r.malformed);
  const malformedCount = rows.length - real.length;

  const candidates = new Map();
  let probeInvalidCount = 0;
  const failures = {};
  const PASS = { count: 0 };
  for (const row of real) {
    const attrs = checkpointIdentity(row);
    if (!attrs) continue;
    let cand = candidates.get(attrs.key);
    if (!cand) {
      cand = {
        key: attrs.key,
        harness: attrs.identity.harness,
        accessPath: attrs.identity.accessPath,
        gateway: attrs.identity.gateway,
        upstream: attrs.identity.upstream,
        account: attrs.identity.account,
        quotaScope: attrs.identity.quotaScope,
        modelId: attrs.modelId,
        base: modelBase(attrs.modelId, prefixes),
        firstSeen: row.timestamp,
        lastSeen: row.timestamp,
        attempts: 1,
        passes: 0,
        failures: [],
        evidence: [],
        probeInvalid: 0,
        resultState: 'UNTESTED',
      };
      candidates.set(attrs.key, cand);
    } else {
      if (row.timestamp && row.timestamp < cand.firstSeen) cand.firstSeen = row.timestamp;
      if (row.timestamp && row.timestamp > cand.lastSeen) cand.lastSeen = row.timestamp;
      cand.attempts += 1;
    }

    if (isProbeInvalid(row)) {
      cand.probeInvalid += 1;
      probeInvalidCount += 1;
      continue;
    }

    let status = row.status;
    let reason = row.reason;
    let errorClass = row.errorClass;

    // A row whose status says ALIVE while its HTTP status is 401 or 400 is wrong;
    // import it as a failure with the real status
    const is401 =
      row.httpStatus === 401 ||
      (typeof row.error === 'string' && /401/.test(row.error)) ||
      (typeof row.reason === 'string' && (/\[401\]/.test(row.reason) || /\b401\b/.test(row.reason)));
    const is400 =
      row.httpStatus === 400 ||
      (typeof row.error === 'string' && (/400/.test(row.error) || /API Error: 400/.test(row.error))) ||
      (typeof row.reason === 'string' && (/\[400\]/.test(row.reason) || /\b400\b/.test(row.reason)));

    if ((status === 'ALIVE' || status === 'PASS') && (is401 || is400)) {
      status = 'FAIL';
      errorClass = is401 ? 'unauthorized' : 'invalid_request';
      reason = is401 ? 'HTTP 401: Unauthorized' : 'HTTP 400: Bad Request';
    }

    const evidence = {
      ts: row.timestamp,
      status,
      reason,
      levelName: row.levelName,
    };
    if (typeof row.latencyMs === 'number') evidence.latencyMs = row.latencyMs;
    if (errorClass) evidence.errorClass = errorClass;
    cand.evidence.push(evidence);

    if (status === 'PASS') {
      cand.passes += 1;
      PASS.count += 1;
    } else if (status === 'DEFERRED') {
      cand.deferred = (cand.deferred || 0) + 1;
    } else {
      const key = errorClass || 'unknown';
      failures[key] = (failures[key] || 0) + 1;
      cand.failures.push({
        ts: row.timestamp,
        status,
        errorClass: key,
        reason,
      });
    }
  }

  const candidateList = [...candidates.values()].map((c) => {
    let resultState = 'UNTESTED';
    if (c.passes > 0) resultState = 'PASS';
    else if (c.failures.length > 0) resultState = 'FAIL';
    else if (c.deferred > 0) resultState = 'DEFERRED';
    return {
      ...c,
      resultState,
      evidence: c.evidence.slice(-5),
      failures: c.failures.slice(0, 5),
    };
  });

  const entry = {
    evidenceKind: 'checkpoint-import',
    importedAt: now,
    importedFrom: path.basename(filePath),
    totalRows: rows.length,
    malformedRows: malformedCount,
    rowsWithModel: candidateList.length,
    probeInvalid: probeInvalidCount,
    passes: PASS.count,
    failuresByClass: failures,
    failureTotal: Object.keys(failures).reduce((n, k) => n + failures[k], 0),
    candidateCount: candidateList.length,
    candidates: candidateList,
  };
  return entry;
}

/**
 * Import the outer health scan into one dated evidence entry. The outer log
 * probes sources, not models, so its import is source-health evidence that a
 * report may quote; it never advertises model candidates.
 */
async function importOuter(filePath, opts) {
  const o = opts || {};
  const read = o.readFile || fs.readFileSync;
  const now = o.now || new Date().toISOString();
  const text = read(filePath, 'utf8');
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      rows.push(JSON.parse(raw));
    } catch (e) {
      rows.push({ malformed: true, raw: String(raw).slice(0, 1000) });
    }
  }
  const perSource = new Map();
  let reclassifiedFails = 0;
  for (const row of rows) {
    if (row.malformed) continue;
    const sid = row.sourceId;
    if (!perSource.has(sid)) perSource.set(sid, { sourceId: sid, probes: [] });
    const rec = perSource.get(sid);

    let status = row.status;
    let tier = row.tier;
    let httpStatus = row.httpStatus;
    let error = row.error && typeof row.error === 'string' ? row.error.slice(0, 1000) : row.error;

    // Rule: a row whose status says ALIVE while its HTTP status is 401 or 400 is wrong; import it as a failure with the real status;
    const has401 = httpStatus === 401 || (typeof error === 'string' && /401/.test(error));
    const has400 = httpStatus === 400 || (typeof error === 'string' && (/400/.test(error) || /API Error: 400/.test(error)));

    if (status === 'ALIVE' && (has401 || has400 || (row.exitCode !== undefined && row.exitCode !== 0))) {
      status = 'FAIL';
      tier = 'FAIL';
      if (!httpStatus) {
        httpStatus = has401 ? 401 : 400;
      }
      reclassifiedFails++;
    } else if (status === 'ALIVE') {
      // Keep exactly PASS, FAIL, DEFERRED, UNTESTED as the result states
      status = 'PASS';
    } else if (status === 'UNTESTED') {
      status = 'UNTESTED';
    } else if (status === 'DEFERRED') {
      status = 'DEFERRED';
    } else if (status === 'FAIL') {
      status = 'FAIL';
    } else {
      status = 'UNTESTED';
    }

    rec.probes.push({
      probeName: row.probeName,
      status,
      tier,
      latencyMs: row.latencyMs,
      httpStatus,
      exitCode: row.exitCode,
      error,
      classification: row.classification,
      responseShape: row.responseShape,
      authRequired: row.authRequired,
      authHeader: row.invocation && row.invocation.authHeader,
      invocationUrl:
        row.invocation && row.invocation.url
          ? String(row.invocation.url).slice(0, 2000)
          : undefined,
      sharedUpstream: row.sharedUpstream,
      evidenceLevel: row.evidenceLevel,
    });
  }
  const sources = [...perSource.values()].map((s) => ({
    ...s,
    probes: s.probes.slice().sort((a, b) => String(a.probeName).localeCompare(String(b.probeName))),
  }));

  const summary = {};
  for (const s of sources) {
    const pass = s.probes.filter((p) => p.status === 'PASS').length;
    const fail = s.probes.filter((p) => p.status === 'FAIL').length;
    const deferred = s.probes.filter((p) => p.status === 'DEFERRED').length;
    const untested = s.probes.filter((p) => p.status === 'UNTESTED').length;
    summary[s.sourceId] = {
      pass,
      fail,
      deferred,
      untested,
      alive: pass, // backward compatibility
      probes: s.probes.length,
    };
  }

  return {
    evidenceKind: 'outer-import',
    importedAt: now,
    importedFrom: path.basename(filePath),
    totalRows: rows.length,
    reclassifiedFails,
    sources,
    summary,
    perSourceTotal: sources.length,
  };
}

module.exports = { importCheckpoint, importOuter, isProbeInvalid, checkpointIdentity, trimId };
