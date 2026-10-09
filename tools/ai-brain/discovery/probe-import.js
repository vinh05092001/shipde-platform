'use strict';

/**
 * Ship Dễ — Model discovery: direct-HTTP probe-pass import (TASK-AI-62)
 *
 * Reads the secret-free probe result `probe_pass.json`, whose shape is
 * `{ "<sourceId>": ["<modelId>", ...] }` — for each source, the models that
 * returned the nonce over direct HTTP. Everything else in that source failed
 * or was non-chat, so only the listed models earn API_PASS.
 *
 * Proof levels are honest and one-way:
 *
 *   API_PASS        a direct HTTP nonce (this file's default)
 *   HARNESS_PASS    a nonce returned through OpenCode/Paseo (supplied as data,
 *                   never derived from an API_PASS)
 *   WORK_ITEM_PASS  real work plus independent review (never produced here)
 *
 * Nothing in this module promotes API_PASS to HARNESS_PASS. The HTTP alias and
 * the OpenCode alias are two candidates; a model that passed only over HTTP is
 * recorded on the HTTP route only, and a HARNESS_PASS is recorded on its own
 * OpenCode/Paseo route. A source marked `disposition: deferred` (a compromised
 * credential) is recorded as DEFERRED and never given a proof level.
 *
 * No credential value is read, printed, stored or committed: the registry names
 * env vars only, and this module never resolves them.
 */

const fs = require('fs');
const path = require('path');
const { candidateKey, modelBase } = require('./identity');
const { ProofLevel } = require('../evidence');

const trimId = (id) =>
  id === null || id === undefined ? null : String(id).trim().replace(/\r$/, '');

function httpIdentity(source, modelId) {
  return {
    harness: 'http',
    accessPath: source.id,
    gateway: '',
    upstream: source.id,
    account: '',
    quotaScope: '',
    modelId: trimId(modelId),
  };
}

/**
 * Import one probe-pass result file.
 *
 * @param {string} filePath path to probe_pass.json
 * @param {object} opts
 * @param {object} opts.registry loaded source registry
 * @param {string[]} [opts.prefixes] registry-declared routing prefixes
 * @param {string} [opts.now] import timestamp (ISO)
 * @param {object[]} [opts.harnessPasses] HARNESS_PASS observations, each:
 *   { sourceId, modelId, opencodeAlias, harness, accessPath, gateway, upstream,
 *     nonce, timestamp }
 * @returns {object} evidence entry + summary
 */
function importProbePass(filePath, opts) {
  const o = opts || {};
  const registry = o.registry || { sources: [] };
  const prefixes = o.prefixes || [];
  const now = o.now || new Date().toISOString();
  const harnessPasses = o.harnessPasses || [];

  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const doc = JSON.parse(raw);

  const byId = new Map((registry.sources || []).map((s) => [s.id, s]));
  const candidates = [];
  const perSource = {};

  for (const [sourceId, modelIds] of Object.entries(doc || {})) {
    const source = byId.get(sourceId);
    if (!source) {
      perSource[sourceId] = { sourceId, status: 'unknown-source', candidates: [] };
      continue;
    }
    const deferred =
      source.disposition === 'deferred' || source.disposition === 'compromised-credential';
    const list = [];
    for (const modelId of modelIds || []) {
      const id = trimId(modelId);
      if (!id) continue;
      const identity = httpIdentity(source, id);
      const key = candidateKey(identity);
      const evidenceItem = {
        ts: now,
        status: deferred ? 'DEFERRED' : 'PASS',
        proofLevel: deferred ? null : ProofLevel.API_PASS,
        latencyMs: null,
        errorClass: deferred ? source.dispositionReason || 'compromised_credential' : null,
        rawEvidence: { file: path.basename(filePath), sourceKey: sourceId },
      };
      const cand = {
        key,
        harness: identity.harness,
        accessPath: identity.accessPath,
        gateway: identity.gateway,
        upstream: identity.upstream,
        account: identity.account,
        quotaScope: identity.quotaScope,
        modelId: identity.modelId,
        base: modelBase(identity.modelId, prefixes),
        source: sourceId,
        proofLevel: deferred ? null : ProofLevel.API_PASS,
        status: deferred ? 'DEFERRED' : 'PASS',
        timestamp: now,
        latencyMs: null,
        errorClass: deferred ? source.dispositionReason || 'compromised_credential' : null,
        failureScope: null,
        rawEvidence: { file: path.basename(filePath), sourceKey: sourceId },
        firstSeen: now,
        lastSeen: now,
        attempts: 1,
        passes: deferred ? 0 : 1,
        deferred: deferred ? 1 : 0,
        probeInvalid: 0,
        failures: [],
        evidence: [evidenceItem],
        resultState: deferred ? 'DEFERRED' : 'PASS',
      };
      list.push(cand);
      candidates.push(cand);
    }
    perSource[sourceId] = {
      sourceId,
      status: deferred ? 'deferred' : 'api-pass',
      disposition: deferred ? source.dispositionReason || source.disposition : null,
      candidates: list,
    };
  }

  for (const hp of harnessPasses) {
    const source = byId.get(hp.sourceId);
    if (!source) continue;
    const hpDeferred =
      source.disposition === 'deferred' || source.disposition === 'compromised-credential';
    // A deferred source is never proven through the harness either: recording a
    // HARNESS_PASS would make a compromised credential look dispatchable.
    if (hpDeferred) {
      const entry =
        perSource[hp.sourceId] ||
        (perSource[hp.sourceId] = { sourceId: hp.sourceId, candidates: [] });
      entry.harnessPassDeferred =
        (source.dispositionReason || source.disposition) +
        ' (harness observation recorded as DEFERRED)';
      continue;
    }
    const identity = {
      harness: hp.harness || 'paseo',
      accessPath: hp.accessPath || 'opencode',
      gateway: hp.gateway || 'opencode',
      upstream: hp.upstream || hp.sourceId,
      account: hp.account || '',
      quotaScope: hp.quotaScope || '',
      modelId: trimId(hp.opencodeAlias || hp.modelId),
    };
    const key = candidateKey(identity);
    const evidenceItem = {
      ts: hp.timestamp || now,
      status: 'PASS',
      proofLevel: ProofLevel.HARNESS_PASS,
      latencyMs: hp.latencyMs !== undefined ? hp.latencyMs : null,
      errorClass: null,
      rawEvidence: {
        file: path.basename(filePath),
        sourceKey: hp.sourceId,
        nonce: hp.nonce || null,
      },
    };
    const cand = {
      key,
      harness: identity.harness,
      accessPath: identity.accessPath,
      gateway: identity.gateway,
      upstream: identity.upstream,
      account: identity.account,
      quotaScope: identity.quotaScope,
      modelId: identity.modelId,
      base: modelBase(identity.modelId, prefixes),
      source: hp.sourceId,
      proofLevel: ProofLevel.HARNESS_PASS,
      status: 'PASS',
      timestamp: hp.timestamp || now,
      latencyMs: hp.latencyMs !== undefined ? hp.latencyMs : null,
      errorClass: null,
      failureScope: null,
      rawEvidence: {
        file: path.basename(filePath),
        sourceKey: hp.sourceId,
        nonce: hp.nonce || null,
      },
      firstSeen: hp.timestamp || now,
      lastSeen: hp.timestamp || now,
      attempts: 1,
      passes: 1,
      deferred: 0,
      probeInvalid: 0,
      failures: [],
      evidence: [evidenceItem],
      resultState: 'PASS',
    };
    candidates.push(cand);
    const entry =
      perSource[hp.sourceId] ||
      (perSource[hp.sourceId] = { sourceId: hp.sourceId, candidates: [] });
    entry.harnessPass = true;
    entry.candidates.push(cand);
  }

  const summary = {};
  for (const [sid, rec] of Object.entries(perSource)) {
    summary[sid] = {
      apiPass: rec.candidates.filter((c) => c.proofLevel === ProofLevel.API_PASS).length,
      harnessPass: rec.candidates.filter((c) => c.proofLevel === ProofLevel.HARNESS_PASS).length,
      deferred: rec.candidates.filter((c) => c.status === 'DEFERRED').length,
      candidates: rec.candidates.length,
    };
  }

  return {
    evidenceKind: 'probe-pass-import',
    importedAt: now,
    importedFrom: path.basename(filePath),
    sources: Object.values(perSource),
    candidates,
    summary,
    candidateCount: candidates.length,
    apiPass: candidates.filter((c) => c.proofLevel === ProofLevel.API_PASS).length,
    harnessPass: candidates.filter((c) => c.proofLevel === ProofLevel.HARNESS_PASS).length,
    deferred: candidates.filter((c) => c.status === 'DEFERRED').length,
  };
}

module.exports = { importProbePass, httpIdentity };
