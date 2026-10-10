'use strict';

// TASK-AI-141 Part B: bounded qualification for candidates blocked only by
// the proof floor. Execution is delegated to the Controller's isolated,
// independently reviewed orchestration path; this module grants no proof on
// its own and fails closed when that path is unavailable.
const fs = require('fs');
const path = require('path');
const evidence = require('./evidence');
const { candidateKey } = require('./candidates');

const DEFAULT_CONFIG = Object.freeze({ perRun: 1, perDay: 3 });

function eligibleCandidates(candidates) {
  return (candidates || []).filter((candidate) => {
    const reasons = candidate.rejectionReasons || candidate.reasons || [];
    const codes = reasons.map((reason) => (typeof reason === 'string' ? reason : reason.code));
    return (
      candidate.status === 'rejected' &&
      codes.length === 1 &&
      codes[0] === 'PROOF_FLOOR_NOT_MET' &&
      (candidate.candidateKey || candidateKey(candidate)) &&
      candidate.blocked !== true
    );
  });
}

function loadItems(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        !item ||
        typeof item.id !== 'string' ||
        item.kind !== 'qualification' ||
        item.risk !== 'low' ||
        !Array.isArray(item.acceptanceCriteria) ||
        item.acceptanceCriteria.length === 0
    )
  )
    throw new Error('QUALIFICATION_ITEMS_INVALID');
  return parsed;
}

function loadUsage(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('QUALIFICATION_USAGE_UNREADABLE');
  }
}

async function runAutoCli(argv, deps) {
  const args = {};
  let autoSeen = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--auto') {
      if (autoSeen) return 2;
      args.auto = true;
      autoSeen = true;
    } else if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[argv[i].slice(2)] = argv[++i];
    } else return 2;
  }
  if (!args.auto || !args.candidates) return 2;
  const d = deps || {};
  const candidates = JSON.parse(fs.readFileSync(args.candidates, 'utf8'));
  const result = await runAutomaticQualification({
    candidates,
    itemsFile:
      args.items || d.itemsFile || path.join(__dirname, 'data', 'qualification-items.json'),
    usageFile:
      args.usage || d.usageFile || path.join(process.cwd(), '.shipde', 'qualification-usage.json'),
    evidenceDir: args['evidence-dir'] || d.evidenceDir || path.join(__dirname, 'data'),
    config: args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : d.config || {},
    runIsolatedReviewed: d.runIsolatedReviewed,
    recordEvidence: d.recordEvidence,
  });
  (d.out || console.log)(JSON.stringify(result));
  return result.status === 'refused' ? 1 : 0;
}

function independentPass(result, candidate) {
  return Boolean(
    result &&
    result.verdict === 'PASS' &&
    /^[a-f0-9]{40}$/i.test(result.sha || '') &&
    result.reviewedSha === result.sha &&
    result.reviewer &&
    result.reviewer !== candidate.candidateKey &&
    result.independent === true &&
    result.productItem !== true
  );
}

async function runAutomaticQualification(options) {
  const opts = options || {};
  const config = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
  if (
    !Number.isInteger(config.perRun) ||
    config.perRun < 0 ||
    !Number.isInteger(config.perDay) ||
    config.perDay < 0
  ) {
    throw new Error('QUALIFICATION_CAP_CONFIG_INVALID');
  }
  if (typeof opts.runIsolatedReviewed !== 'function') {
    return {
      status: 'refused',
      reason: 'QUALIFICATION_RUNNER_UNAVAILABLE',
      ran: true,
      selected: 0,
      qualified: [],
    };
  }
  const now = typeof opts.now === 'function' ? opts.now() : opts.now || Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const usageFile =
    opts.usageFile || path.join(process.cwd(), '.shipde', 'qualification-usage.json');
  const usage = loadUsage(usageFile);
  const today = Array.isArray(usage[day]) ? usage[day] : [];
  const remaining = Math.max(0, Math.min(config.perRun, config.perDay - today.length));
  const selected = eligibleCandidates(opts.candidates).slice(0, remaining);
  const items = loadItems(opts.itemsFile);
  const qualified = [];
  const attempted = today.slice();

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index];
    const item = items[index % items.length];
    if (!item) break;
    const key = candidate.candidateKey || candidateKey(candidate);
    const receipt = await opts.runIsolatedReviewed({ candidate, candidateKey: key, item });
    attempted.push({ candidateKey: key, itemId: item.id, at: new Date(now).toISOString() });
    if (!independentPass(receipt, candidate)) continue;
    const proof = {
      status: 'passed',
      proofLevel: 'WORK_ITEM_PASS',
      level: 3,
      qualification: true,
      qualificationItemId: item.id,
      commit: receipt.sha,
      reviewedSha: receipt.reviewedSha,
      reviewer: receipt.reviewer,
      independent: true,
    };
    if (typeof opts.recordEvidence === 'function') opts.recordEvidence(candidate, proof);
    else evidence.recordProbe(opts.evidenceDir, candidate, proof);
    qualified.push({ candidateKey: key, itemId: item.id, sha: receipt.sha });
  }
  if (attempted.length !== today.length) {
    usage[day] = attempted;
    fs.mkdirSync(path.dirname(usageFile), { recursive: true });
    fs.writeFileSync(usageFile, JSON.stringify(usage, null, 2) + '\n', 'utf8');
  }
  return { status: 'completed', ran: true, selected: selected.length, qualified };
}

module.exports = {
  DEFAULT_CONFIG,
  eligibleCandidates,
  loadItems,
  independentPass,
  runAutomaticQualification,
  runAutoCli,
};
