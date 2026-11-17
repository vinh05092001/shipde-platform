'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parseTicket } = require('./ticket-parser');
const { candidateKey, parseCandidateKey } = require('./discovery/identity');
const { getTreeProvenance } = require('./route-launch');
const { atomicRenameSync } = require('./atomic-rename');

function computeSha256(contentOrBuffer) {
  return crypto.createHash('sha256').update(contentOrBuffer).digest('hex');
}

function computeFileSha256(filePath) {
  const bytes = fs.readFileSync(filePath);
  return computeSha256(bytes);
}

function readInputSnapshots(files) {
  const snapshots = {};
  for (const [label, file] of Object.entries(files)) {
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      const error = new Error(`INPUT_READ_FAILED: ${label}`);
      error.code = 'INPUT_READ_FAILED';
      throw error;
    }
    snapshots[label] = { bytes, text: bytes.toString('utf8'), sha256: computeSha256(bytes) };
  }
  return snapshots;
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value)) return null;
  if (/^[a-zA-Z]:/.test(value)) return null;
  const parts = normalized.split('/');
  if (parts.includes('..')) return null;
  return normalized;
}

function assertContained(parentDir, relPath, label = 'path') {
  const safe = safeRelative(relPath);
  if (!safe) {
    const err = new Error(`INVALID_RELATIVE_PATH: ${label} (${relPath})`);
    err.code = 'INVALID_RELATIVE_PATH';
    throw err;
  }
  const resolved = path.resolve(parentDir, safe);
  let realParent;
  let realTarget;
  try {
    realParent = fs.realpathSync(parentDir);
    realTarget = fs.realpathSync(resolved);
  } catch (e) {
    const err = new Error(`UNRESOLVABLE_PATH: ${label}`);
    err.code = 'UNRESOLVABLE_PATH';
    throw err;
  }
  const canonical = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const rel = path.relative(canonical(realParent), canonical(realTarget));
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    const err = new Error(`PATH_OUTSIDE_ROOT: ${label} (${relPath})`);
    err.code = 'PATH_OUTSIDE_ROOT';
    throw err;
  }
  return realTarget;
}

function assertNoCredentials(obj, pathPrefix = '') {
  if (!obj || typeof obj !== 'object') return;
  const forbiddenKeys =
    /^(apiKey|api_key|password|secret|authorization|token|bearer|credentials)$/i;
  for (const [k, v] of Object.entries(obj)) {
    if (forbiddenKeys.test(k)) {
      const err = new Error(`CREDENTIALS_PROHIBITED: ${pathPrefix}${k}`);
      err.code = 'CREDENTIALS_PROHIBITED';
      throw err;
    }
    if (v && typeof v === 'object') {
      assertNoCredentials(v, `${pathPrefix}${k}.`);
    }
  }
}

function assertNoEmbeddedProviderResponses(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.choices || obj.completions || obj.rawResponse) {
    const err = new Error('EMBEDDED_PROVIDER_RESPONSE_PROHIBITED');
    err.code = 'EMBEDDED_PROVIDER_RESPONSE_PROHIBITED';
    throw err;
  }
}

function extractCandidateKey(candidateOrKey) {
  if (!candidateOrKey) return null;
  if (typeof candidateOrKey === 'string') return candidateOrKey;
  if (candidateOrKey.candidateKey) return candidateOrKey.candidateKey;
  try {
    return candidateKey(candidateOrKey);
  } catch {
    return null;
  }
}

function resolveCandidateObject(chosen, parsedKey) {
  if (!parsedKey || !parsedKey.harness || !parsedKey.modelId) {
    const error = new Error('SELECTION_CHOSEN_KEY_INVALID');
    error.code = 'SELECTION_CHOSEN_KEY_INVALID';
    throw error;
  }
  if (chosen && typeof chosen === 'object') {
    for (const [field, keyField] of Object.entries({
      harness: 'harness',
      accessPath: 'accessPath',
      gateway: 'gateway',
      upstream: 'upstream',
      account: 'account',
      accountId: 'account',
      quotaScope: 'quotaScope',
      modelId: 'modelId',
      model: 'modelId',
    })) {
      if (chosen[field] !== undefined && String(chosen[field]) !== String(parsedKey[keyField])) {
        const error = new Error('SELECTION_IDENTITY_MISMATCH');
        error.code = 'SELECTION_IDENTITY_MISMATCH';
        throw error;
      }
    }
    return {
      ...chosen,
      candidateKey: extractCandidateKey(chosen),
      harness: chosen.harness || parsedKey?.harness,
      accessPath: chosen.accessPath || parsedKey?.accessPath,
      gateway: chosen.gateway || parsedKey?.gateway,
      upstream: chosen.upstream || parsedKey?.upstream,
      accountId: chosen.accountId || chosen.account || parsedKey?.account,
      quotaScope: chosen.quotaScope || parsedKey?.quotaScope,
      modelId: chosen.modelId || chosen.model || parsedKey?.modelId,
    };
  }
  return {
    candidateKey: extractCandidateKey(chosen),
    harness: parsedKey?.harness || 'paseo',
    accessPath: parsedKey?.accessPath || '',
    gateway: parsedKey?.gateway || '',
    upstream: parsedKey?.upstream || '',
    accountId: parsedKey?.account || '*',
    quotaScope: parsedKey?.quotaScope || '',
    modelId: parsedKey?.modelId || '',
  };
}

function findDiscoveryCatalogueFile(discoveryDir) {
  const jsonlPath = path.join(discoveryDir, 'catalogue.jsonl');
  if (fs.existsSync(jsonlPath)) return jsonlPath;
  const jsonPath = path.join(discoveryDir, 'catalogue.json');
  if (fs.existsSync(jsonPath)) return jsonPath;
  return null;
}

function checkRepoCleanliness(repoRoot, deps = {}) {
  const provenance = (deps.getTreeProvenance || getTreeProvenance)(repoRoot, deps);
  const codeSha = provenance?.repoSha;
  if (!codeSha || !/^[0-9a-f]{40}$/i.test(codeSha)) {
    const err = new Error(`PROVENANCE_SHA_INVALID: ${codeSha}`);
    err.code = 'PROVENANCE_SHA_INVALID';
    throw err;
  }

  let statusOutput;
  if (deps.gitStatus !== undefined) {
    statusOutput = deps.gitStatus;
  } else {
    const exec = deps.execFileSync || execFileSync;
    try {
      statusOutput = exec('git', ['status', '--porcelain', '--', 'tools/ai-brain'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (err) {
      const e = new Error('GIT_STATUS_FAILED');
      e.code = 'GIT_STATUS_FAILED';
      throw e;
    }
  }

  if (statusOutput && statusOutput.trim().length > 0) {
    const err = new Error(
      `DIRTY_WORKTREE: tools/ai-brain has uncommitted changes\n${statusOutput}`
    );
    err.code = 'DIRTY_WORKTREE';
    throw err;
  }

  return codeSha;
}

function freeze(requestPath, outputPath, options = {}, deps = {}) {
  if (!requestPath || typeof requestPath !== 'string') {
    const err = new Error('FREEZE_REQUEST_PATH_REQUIRED');
    err.code = 'FREEZE_REQUEST_PATH_REQUIRED';
    throw err;
  }
  if (!outputPath || typeof outputPath !== 'string') {
    const err = new Error('FREEZE_OUTPUT_PATH_REQUIRED');
    err.code = 'FREEZE_OUTPUT_PATH_REQUIRED';
    throw err;
  }

  const resolvedRequest = path.resolve(requestPath);
  if (!fs.existsSync(resolvedRequest)) {
    const err = new Error(`FREEZE_REQUEST_NOT_FOUND: ${requestPath}`);
    err.code = 'FREEZE_REQUEST_NOT_FOUND';
    throw err;
  }

  const requestDir = path.dirname(resolvedRequest);
  const resolvedOutput = path.resolve(outputPath);
  const outputDir = path.dirname(resolvedOutput);

  if (path.resolve(requestDir).toLowerCase() !== path.resolve(outputDir).toLowerCase()) {
    const err = new Error(
      `OUTPUT_DIRECTORY_MISMATCH: output (${outputDir}) must be in same directory as request (${requestDir})`
    );
    err.code = 'OUTPUT_DIRECTORY_MISMATCH';
    throw err;
  }

  if (fs.existsSync(resolvedOutput)) {
    const err = new Error(`REFUSE_OUTPUT_EXISTS: ${outputPath}`);
    err.code = 'REFUSE_OUTPUT_EXISTS';
    throw err;
  }

  if (resolvedOutput.toLowerCase() === resolvedRequest.toLowerCase()) {
    const err = new Error('REFUSE_OUTPUT_COLLISION: output collides with request');
    err.code = 'REFUSE_OUTPUT_COLLISION';
    throw err;
  }

  let requestContent;
  try {
    requestContent = fs.readFileSync(resolvedRequest, 'utf8');
  } catch (e) {
    const err = new Error('REQUEST_UNREADABLE');
    err.code = 'REQUEST_UNREADABLE';
    throw err;
  }

  let request;
  try {
    request = JSON.parse(requestContent);
  } catch (e) {
    const err = new Error('REQUEST_INVALID_JSON');
    err.code = 'REQUEST_INVALID_JSON';
    throw err;
  }

  assertNoCredentials(request, 'request.');
  assertNoEmbeddedProviderResponses(request);

  if (!request.target || typeof request.target !== 'object') {
    const err = new Error('TARGET_INVALID: request must have target object');
    err.code = 'TARGET_INVALID';
    throw err;
  }
  const { cwd, branch, baseSha } = request.target;
  if (!cwd || typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    const err = new Error(`TARGET_CWD_INVALID: target cwd must be absolute path (${cwd})`);
    err.code = 'TARGET_CWD_INVALID';
    throw err;
  }
  let targetExists = false;
  try {
    targetExists = fs.existsSync(cwd) && fs.statSync(cwd).isDirectory();
  } catch {}
  if (!targetExists) {
    const err = new Error(`TARGET_CWD_NOT_FOUND: target cwd directory does not exist (${cwd})`);
    err.code = 'TARGET_CWD_NOT_FOUND';
    throw err;
  }
  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    const err = new Error('TARGET_BRANCH_INVALID: branch must be non-empty string');
    err.code = 'TARGET_BRANCH_INVALID';
    throw err;
  }
  if (!baseSha || typeof baseSha !== 'string' || !/^[0-9a-f]{40}$/i.test(baseSha.trim())) {
    const err = new Error(`TARGET_BASE_SHA_INVALID: baseSha must be 40-hex string (${baseSha})`);
    err.code = 'TARGET_BASE_SHA_INVALID';
    throw err;
  }

  const workerTimeoutMs = request.workerTimeoutMs;
  if (
    typeof workerTimeoutMs !== 'number' ||
    !Number.isFinite(workerTimeoutMs) ||
    workerTimeoutMs <= 0
  ) {
    const err = new Error(
      `WORKER_TIMEOUT_INVALID: workerTimeoutMs must be positive finite number (${workerTimeoutMs})`
    );
    err.code = 'WORKER_TIMEOUT_INVALID';
    throw err;
  }

  const realSelection = assertContained(requestDir, request.selection, 'selection');
  const realTicket = assertContained(requestDir, request.ticket, 'ticket');
  const realPrompt = assertContained(requestDir, request.prompt, 'prompt');
  const realCheckpoint = assertContained(requestDir, request.checkpoint, 'checkpoint');

  const discoveryRel = request.discoveryDir || request.discovery?.directory || request.discovery;
  if (!discoveryRel || typeof discoveryRel !== 'string') {
    const err = new Error('DISCOVERY_DIRECTORY_REQUIRED');
    err.code = 'DISCOVERY_DIRECTORY_REQUIRED';
    throw err;
  }
  const realDiscovery = assertContained(requestDir, discoveryRel, 'discovery');

  for (const inputPath of [realSelection, realTicket, realPrompt, realCheckpoint]) {
    if (resolvedOutput.toLowerCase() === inputPath.toLowerCase()) {
      const err = new Error(`REFUSE_OUTPUT_COLLISION: output collides with input (${inputPath})`);
      err.code = 'REFUSE_OUTPUT_COLLISION';
      throw err;
    }
  }

  const catalogueFile = findDiscoveryCatalogueFile(realDiscovery);
  if (!catalogueFile) {
    const err = new Error(`DISCOVERY_CATALOGUE_MISSING in ${realDiscovery}`);
    err.code = 'DISCOVERY_CATALOGUE_MISSING';
    throw err;
  }
  const freshnessFile = path.join(realDiscovery, 'freshness.json');
  if (!fs.existsSync(freshnessFile)) {
    const err = new Error(`DISCOVERY_FRESHNESS_MISSING in ${realDiscovery}`);
    err.code = 'DISCOVERY_FRESHNESS_MISSING';
    throw err;
  }

  const inputs = readInputSnapshots({
    selection: realSelection,
    ticket: realTicket,
    prompt: realPrompt,
    checkpoint: realCheckpoint,
    catalogue: catalogueFile,
    freshness: freshnessFile,
  });
  let selectionObj;
  try {
    selectionObj = JSON.parse(inputs.selection.text);
  } catch (e) {
    const err = new Error('SELECTION_INVALID_JSON');
    err.code = 'SELECTION_INVALID_JSON';
    throw err;
  }
  assertNoCredentials(selectionObj, 'selection.');
  assertNoEmbeddedProviderResponses(selectionObj);

  const chosen = selectionObj.chosen || selectionObj.decision?.chosen;
  if (!chosen) {
    const err = new Error('SELECTION_CHOSEN_NULL: selection must have non-null chosen candidate');
    err.code = 'SELECTION_CHOSEN_NULL';
    throw err;
  }
  const chosenKey = extractCandidateKey(chosen);
  if (!chosenKey) {
    const err = new Error('SELECTION_CHOSEN_KEY_INVALID: unable to extract candidateKey');
    err.code = 'SELECTION_CHOSEN_KEY_INVALID';
    throw err;
  }

  resolveCandidateObject(chosen, parseCandidateKey(chosenKey));
  const profile = selectionObj.profile || selectionObj.decision?.profile;
  if (!profile || typeof profile !== 'object') {
    const err = new Error('SELECTION_PROFILE_MISSING: selection must have profile');
    err.code = 'SELECTION_PROFILE_MISSING';
    throw err;
  }

  let checkpointObj;
  try {
    checkpointObj = JSON.parse(inputs.checkpoint.text);
  } catch (e) {
    const err = new Error('CHECKPOINT_INVALID_JSON');
    err.code = 'CHECKPOINT_INVALID_JSON';
    throw err;
  }
  assertNoCredentials(checkpointObj, 'checkpoint.');
  assertNoEmbeddedProviderResponses(checkpointObj);

  const checkpointCandidate =
    checkpointObj.selectedCandidate || checkpointObj.chosen || checkpointObj.candidateKey;
  if (!checkpointCandidate) {
    const err = new Error('CHECKPOINT_CANDIDATE_MISSING: checkpoint must specify candidate');
    err.code = 'CHECKPOINT_CANDIDATE_MISSING';
    throw err;
  }
  const checkpointKey = extractCandidateKey(checkpointCandidate);
  if (checkpointKey !== chosenKey) {
    const err = new Error(
      `CHECKPOINT_CANDIDATE_MISMATCH: checkpoint has ${checkpointKey}, selection has ${chosenKey}`
    );
    err.code = 'CHECKPOINT_CANDIDATE_MISMATCH';
    throw err;
  }

  const ticketContent = inputs.ticket.text;
  assertNoCredentials({ text: ticketContent });
  const parsedTicket = parseTicket(ticketContent, realTicket);

  const profileTaskId = profile.taskId || profile.workItemId || profile.id;
  if (typeof profileTaskId !== 'string' || !profileTaskId.trim()) {
    const err = new Error('SELECTION_PROFILE_ID_REQUIRED');
    err.code = 'SELECTION_PROFILE_ID_REQUIRED';
    throw err;
  }
  if (parsedTicket.id !== profileTaskId) {
    const err = new Error(
      `TICKET_ID_MISMATCH: ticket id ${parsedTicket.id} !== profile id ${profileTaskId}`
    );
    err.code = 'TICKET_ID_MISMATCH';
    throw err;
  }

  const ticketAllowed = [...(parsedTicket.allowedFiles || [])].sort();
  const profileAllowed = [...(profile.allowedFiles || [])].sort();
  if (JSON.stringify(ticketAllowed) !== JSON.stringify(profileAllowed)) {
    const err = new Error(
      `TICKET_ALLOWED_FILES_MISMATCH: ticket=${JSON.stringify(ticketAllowed)} profile=${JSON.stringify(profileAllowed)}`
    );
    err.code = 'TICKET_ALLOWED_FILES_MISMATCH';
    throw err;
  }

  const ticketAc = [...(parsedTicket.acceptanceCriteria || [])].sort();
  const profileAc = [...(profile.acceptanceCriteria || [])].sort();
  if (JSON.stringify(ticketAc) !== JSON.stringify(profileAc)) {
    const err = new Error(
      `TICKET_ACCEPTANCE_CRITERIA_MISMATCH: ticket=${JSON.stringify(ticketAc)} profile=${JSON.stringify(profileAc)}`
    );
    err.code = 'TICKET_ACCEPTANCE_CRITERIA_MISMATCH';
    throw err;
  }

  const repoRoot = deps.repoRoot || path.resolve(__dirname, '../..');
  const codeSha = checkRepoCleanliness(repoRoot, deps);

  const selectionSha = inputs.selection.sha256;
  const ticketSha = inputs.ticket.sha256;
  const promptSha = inputs.prompt.sha256;
  const checkpointSha = inputs.checkpoint.sha256;
  const catalogueSha = inputs.catalogue.sha256;
  const freshnessSha = inputs.freshness.sha256;

  const manifest = {
    schemaVersion: 1,
    kind: 'shipde.frozen-ticket-launch',
    producer: {
      codeSha,
    },
    selection: {
      file: path.relative(requestDir, realSelection).replace(/\\/g, '/'),
      sha256: selectionSha,
    },
    ticket: {
      file: path.relative(requestDir, realTicket).replace(/\\/g, '/'),
      sha256: ticketSha,
    },
    prompt: {
      file: path.relative(requestDir, realPrompt).replace(/\\/g, '/'),
      sha256: promptSha,
    },
    checkpoint: {
      file: path.relative(requestDir, realCheckpoint).replace(/\\/g, '/'),
      sha256: checkpointSha,
    },
    discovery: {
      directory: path.relative(requestDir, realDiscovery).replace(/\\/g, '/'),
      catalogueSha256: catalogueSha,
      freshnessSha256: freshnessSha,
    },
    target: {
      cwd: path.resolve(cwd),
      branch: branch.trim(),
      baseSha: baseSha.trim(),
    },
    workerTimeoutMs,
  };

  const tmpManifestPath = `${resolvedOutput}.tmp.${crypto.randomUUID()}`;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const manifestSha256 = computeSha256(manifestBytes);
  fs.writeFileSync(tmpManifestPath, manifestBytes);
  atomicRenameSync(tmpManifestPath, resolvedOutput);

  return { manifest, manifestSha256, manifestPath: resolvedOutput };
}

function validateFrozenManifest(manifestPath, options = {}, deps = {}) {
  const expectedDigest =
    options['manifest-sha256'] !== undefined ? options['manifest-sha256'] : options.manifestSha256;
  if (expectedDigest === undefined) {
    const err = new Error('MANIFEST_DIGEST_REQUIRED');
    err.code = 'MANIFEST_DIGEST_REQUIRED';
    throw err;
  }
  if (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    const err = new Error('MANIFEST_DIGEST_INVALID');
    err.code = 'MANIFEST_DIGEST_INVALID';
    throw err;
  }
  if (!manifestPath || typeof manifestPath !== 'string') {
    const err = new Error('MANIFEST_PATH_REQUIRED');
    err.code = 'MANIFEST_PATH_REQUIRED';
    throw err;
  }
  const resolvedManifest = path.resolve(manifestPath);
  if (!fs.existsSync(resolvedManifest)) {
    const err = new Error('MANIFEST_NOT_FOUND');
    err.code = 'MANIFEST_NOT_FOUND';
    throw err;
  }

  const manifestDir = path.dirname(resolvedManifest);
  let manifestBytes;
  try {
    manifestBytes = fs.readFileSync(resolvedManifest);
  } catch {
    const err = new Error('MANIFEST_UNREADABLE');
    err.code = 'MANIFEST_UNREADABLE';
    throw err;
  }
  if (computeSha256(manifestBytes) !== expectedDigest.toLowerCase()) {
    const err = new Error('MANIFEST_DIGEST_MISMATCH');
    err.code = 'MANIFEST_DIGEST_MISMATCH';
    throw err;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (e) {
    const err = new Error('MANIFEST_INVALID_JSON');
    err.code = 'MANIFEST_INVALID_JSON';
    throw err;
  }

  if (manifest.schemaVersion !== 1 || manifest.kind !== 'shipde.frozen-ticket-launch') {
    const err = new Error(
      `MANIFEST_KIND_INVALID: schemaVersion=${manifest.schemaVersion}, kind=${manifest.kind}`
    );
    err.code = 'MANIFEST_KIND_INVALID';
    throw err;
  }

  const codeSha = manifest.producer?.codeSha;
  if (!codeSha || typeof codeSha !== 'string' || !/^[0-9a-f]{40}$/i.test(codeSha)) {
    const err = new Error(`MANIFEST_PRODUCER_INVALID: producer.codeSha=${codeSha}`);
    err.code = 'MANIFEST_PRODUCER_INVALID';
    throw err;
  }

  const target = manifest.target;
  if (!target || typeof target !== 'object') {
    const err = new Error('MANIFEST_TARGET_INVALID: target must be object');
    err.code = 'MANIFEST_TARGET_INVALID';
    throw err;
  }
  if (!target.cwd || typeof target.cwd !== 'string' || !path.isAbsolute(target.cwd)) {
    const err = new Error(
      `MANIFEST_TARGET_CWD_INVALID: target cwd must be absolute (${target.cwd})`
    );
    err.code = 'MANIFEST_TARGET_CWD_INVALID';
    throw err;
  }
  let targetExists = false;
  try {
    targetExists = fs.existsSync(target.cwd) && fs.statSync(target.cwd).isDirectory();
  } catch {}
  if (!targetExists) {
    const err = new Error(
      `MANIFEST_TARGET_CWD_NOT_FOUND: target cwd directory does not exist (${target.cwd})`
    );
    err.code = 'MANIFEST_TARGET_CWD_NOT_FOUND';
    throw err;
  }
  if (!target.branch || typeof target.branch !== 'string' || !target.branch.trim()) {
    const err = new Error('MANIFEST_TARGET_BRANCH_INVALID: branch must be non-empty string');
    err.code = 'MANIFEST_TARGET_BRANCH_INVALID';
    throw err;
  }
  if (
    !target.baseSha ||
    typeof target.baseSha !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(target.baseSha)
  ) {
    const err = new Error(
      `MANIFEST_TARGET_BASE_SHA_INVALID: baseSha must be 40-hex string (${target.baseSha})`
    );
    err.code = 'MANIFEST_TARGET_BASE_SHA_INVALID';
    throw err;
  }

  const workerTimeoutMs = manifest.workerTimeoutMs;
  if (
    typeof workerTimeoutMs !== 'number' ||
    !Number.isFinite(workerTimeoutMs) ||
    workerTimeoutMs <= 0
  ) {
    const err = new Error(`MANIFEST_WORKER_TIMEOUT_INVALID: workerTimeoutMs=${workerTimeoutMs}`);
    err.code = 'MANIFEST_WORKER_TIMEOUT_INVALID';
    throw err;
  }

  const realSelection = assertContained(manifestDir, manifest.selection?.file, 'selection');
  const realTicket = assertContained(manifestDir, manifest.ticket?.file, 'ticket');
  const realPrompt = assertContained(manifestDir, manifest.prompt?.file, 'prompt');
  const realCheckpoint = assertContained(manifestDir, manifest.checkpoint?.file, 'checkpoint');
  const realDiscovery = assertContained(manifestDir, manifest.discovery?.directory, 'discovery');

  const catalogueFile = findDiscoveryCatalogueFile(realDiscovery);
  if (!catalogueFile) {
    const err = new Error(`DISCOVERY_CATALOGUE_MISSING in ${realDiscovery}`);
    err.code = 'DISCOVERY_CATALOGUE_MISSING';
    throw err;
  }
  const freshnessFile = path.join(realDiscovery, 'freshness.json');
  if (!fs.existsSync(freshnessFile)) {
    const err = new Error(`DISCOVERY_FRESHNESS_MISSING in ${realDiscovery}`);
    err.code = 'DISCOVERY_FRESHNESS_MISSING';
    throw err;
  }

  const inputs = readInputSnapshots({
    selection: realSelection,
    ticket: realTicket,
    prompt: realPrompt,
    checkpoint: realCheckpoint,
    catalogue: catalogueFile,
    freshness: freshnessFile,
  });
  // Parse and use exactly the buffers whose raw hashes are verified.
  const selectionSha = inputs.selection.sha256;
  if (selectionSha !== manifest.selection?.sha256) {
    const err = new Error(
      `DRIFT_DETECTED: selection hash mismatch (${selectionSha} !== ${manifest.selection?.sha256})`
    );
    err.code = 'DRIFT_DETECTED';
    throw err;
  }

  const ticketSha = inputs.ticket.sha256;
  if (ticketSha !== manifest.ticket?.sha256) {
    const err = new Error(
      `DRIFT_DETECTED: ticket hash mismatch (${ticketSha} !== ${manifest.ticket?.sha256})`
    );
    err.code = 'DRIFT_DETECTED';
    throw err;
  }

  const promptSha = inputs.prompt.sha256;
  if (promptSha !== manifest.prompt?.sha256) {
    const err = new Error(
      `DRIFT_DETECTED: prompt hash mismatch (${promptSha} !== ${manifest.prompt?.sha256})`
    );
    err.code = 'DRIFT_DETECTED';
    throw err;
  }

  const checkpointSha = inputs.checkpoint.sha256;
  if (checkpointSha !== manifest.checkpoint?.sha256) {
    const err = new Error(
      `DRIFT_DETECTED: checkpoint hash mismatch (${checkpointSha} !== ${manifest.checkpoint?.sha256})`
    );
    err.code = 'DRIFT_DETECTED';
    throw err;
  }

  const catalogueSha = inputs.catalogue.sha256;
  if (catalogueSha !== manifest.discovery?.catalogueSha256) {
    const err = new Error(
      `DRIFT_DETECTED: discovery catalogue hash mismatch (${catalogueSha} !== ${manifest.discovery?.catalogueSha256})`
    );
    err.code = 'DRIFT_DETECTED';
    throw err;
  }

  const freshnessSha = inputs.freshness.sha256;
  if (freshnessSha !== manifest.discovery?.freshnessSha256) {
    const err = new Error(
      `DRIFT_DETECTED: discovery freshness hash mismatch (${freshnessSha} !== ${manifest.discovery?.freshnessSha256})`
    );
    err.code = 'DRIFT_DETECTED';
    throw err;
  }

  // Check tree provenance and git status
  const repoRoot = deps.repoRoot || path.resolve(__dirname, '../..');
  const currentCodeSha = checkRepoCleanliness(repoRoot, deps);
  if (currentCodeSha.toLowerCase() !== codeSha.toLowerCase()) {
    const err = new Error(
      `PROVENANCE_MISMATCH: current repo HEAD ${currentCodeSha} !== producer ${codeSha}`
    );
    err.code = 'PROVENANCE_MISMATCH';
    throw err;
  }

  let selectionObj;
  try {
    selectionObj = JSON.parse(inputs.selection.text);
  } catch {
    const err = new Error('SELECTION_INVALID_JSON');
    err.code = 'SELECTION_INVALID_JSON';
    throw err;
  }
  const profile = selectionObj.profile || selectionObj.decision?.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    const err = new Error('SELECTION_PROFILE_MISSING');
    err.code = 'SELECTION_PROFILE_MISSING';
    throw err;
  }
  const chosen = selectionObj.chosen || selectionObj.decision?.chosen;
  const chosenKey = extractCandidateKey(chosen);
  if (!chosenKey) {
    const err = new Error('SELECTION_CHOSEN_KEY_INVALID');
    err.code = 'SELECTION_CHOSEN_KEY_INVALID';
    throw err;
  }

  let checkpointObj;
  try {
    checkpointObj = JSON.parse(inputs.checkpoint.text);
  } catch {
    const err = new Error('CHECKPOINT_INVALID_JSON');
    err.code = 'CHECKPOINT_INVALID_JSON';
    throw err;
  }
  const checkpointCandidate =
    checkpointObj.selectedCandidate || checkpointObj.chosen || checkpointObj.candidateKey;
  const checkpointKey = extractCandidateKey(checkpointCandidate);
  if (checkpointKey !== chosenKey) {
    const err = new Error(
      `CHECKPOINT_CANDIDATE_MISMATCH: checkpoint has ${checkpointKey}, selection has ${chosenKey}`
    );
    err.code = 'CHECKPOINT_CANDIDATE_MISMATCH';
    throw err;
  }

  const ticketContent = inputs.ticket.text;
  const parsedTicket = parseTicket(ticketContent, realTicket);

  const profileTaskId = profile?.taskId || profile?.workItemId || profile?.id;
  if (typeof profileTaskId !== 'string' || !profileTaskId.trim()) {
    const err = new Error('SELECTION_PROFILE_ID_REQUIRED');
    err.code = 'SELECTION_PROFILE_ID_REQUIRED';
    throw err;
  }
  if (parsedTicket.id !== profileTaskId) {
    const err = new Error(
      `TICKET_ID_MISMATCH: ticket id ${parsedTicket.id} !== profile id ${profileTaskId}`
    );
    err.code = 'TICKET_ID_MISMATCH';
    throw err;
  }

  const ticketAllowed = [...(parsedTicket.allowedFiles || [])].sort();
  const profileAllowed = [...(profile?.allowedFiles || [])].sort();
  if (JSON.stringify(ticketAllowed) !== JSON.stringify(profileAllowed)) {
    const err = new Error('TICKET_ALLOWED_FILES_MISMATCH');
    err.code = 'TICKET_ALLOWED_FILES_MISMATCH';
    throw err;
  }

  const ticketAc = [...(parsedTicket.acceptanceCriteria || [])].sort();
  const profileAc = [...(profile?.acceptanceCriteria || [])].sort();
  if (JSON.stringify(ticketAc) !== JSON.stringify(profileAc)) {
    const err = new Error('TICKET_ACCEPTANCE_CRITERIA_MISMATCH');
    err.code = 'TICKET_ACCEPTANCE_CRITERIA_MISMATCH';
    throw err;
  }

  const promptText = inputs.prompt.text;
  const parsedKey = parseCandidateKey(chosenKey);
  const chosenCandidate = resolveCandidateObject(chosen, parsedKey);

  return {
    manifest,
    manifestDir,
    realSelectionPath: realSelection,
    realTicketPath: realTicket,
    realPromptPath: realPrompt,
    realCheckpointPath: realCheckpoint,
    realDiscoveryDir: realDiscovery,
    catalogueFile,
    freshnessFile,
    selection: selectionObj,
    checkpoint: checkpointObj,
    ticket: parsedTicket,
    promptText,
    chosenKey,
    chosenCandidate,
    workerTimeoutMs,
    target: manifest.target,
  };
}

module.exports = {
  freeze,
  validateFrozenManifest,
  safeRelative,
  assertContained,
  computeSha256,
  computeFileSha256,
  extractCandidateKey,
};
