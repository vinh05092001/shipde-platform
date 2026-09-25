'use strict';

/**
 * Ship Dễ — Model discovery: evidence store (W2)
 *
 * The catalogue is an append-only JSON-lines ledger under
 * `tools/ai-brain/data/discovery/catalogue.jsonl`. Every candidate state
 * transition is one line; nothing is ever rewritten in place, nothing is ever
 * deleted. Current state is by definition the last line for a candidate key,
 * so history stays readable at any point and recovery is "replay the file".
 *
 * States the discovery slice may write are deliberately the two that need no
 * judgement: UNKNOWN when a candidate is newly advertised (a listing is only
 * news, never availability) and REMOVED when a candidate stops being
 * advertised. The rest of the state machine lives in the executor's slice and
 * is only read here.
 */

const fs = require('fs');
const { candidateKey, parseCandidateKey, normalizeCandidateKey } = require('./identity');

const STATES = [
  'UNKNOWN',
  'PROBING',
  'AVAILABLE',
  'DEGRADED',
  'COOLDOWN',
  'UNAVAILABLE',
  'REMOVED',
];

const DISCOVERY_WRITABLE = new Set(['UNKNOWN', 'REMOVED']);

function stateLabel(state) {
  const s = String(state || '').toUpperCase();
  if (STATES.indexOf(s) === -1) return null;
  return s;
}

class StateMap extends Map {
  get(key) {
    if (super.has(key)) return super.get(key);
    const norm = normalizeCandidateKey(key);
    if (norm && super.has(norm)) return super.get(norm);
    return undefined;
  }
  has(key) {
    if (super.has(key)) return true;
    const norm = normalizeCandidateKey(key);
    if (norm && super.has(norm)) return true;
    return false;
  }
}

function currentState(lines) {
  const current = new StateMap();
  for (const line of lines) {
    if (!line || !line.key || line.type === 'migration') continue;
    const normKey = normalizeCandidateKey(line.key);
    const parsed = parseCandidateKey(line.key);
    const rec = {
      ...line,
      key: normKey,
      harness: line.harness || (parsed && parsed.harness) || 'http',
      accessPath: line.accessPath || (parsed && parsed.accessPath) || '9router',
      gateway: line.gateway || (parsed && parsed.gateway) || '',
      upstream: line.upstream || (parsed && parsed.upstream) || '',
      account: line.account !== undefined ? line.account : (parsed && parsed.account) || '',
      quotaScope:
        line.quotaScope !== undefined ? line.quotaScope : (parsed && parsed.quotaScope) || '',
      modelId: line.modelId || (parsed && parsed.modelId) || '',
    };
    current.set(normKey, rec);
  }
  return current;
}

function readCatalogue(filePath, io) {
  const opts = io || {};
  const readFile = opts.readFile || fs.readFileSync;
  try {
    const text = readFile(filePath, 'utf8');
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
      if (!String(raw).trim()) continue;
      try {
        lines.push(JSON.parse(raw));
      } catch (e) {
        // A malformed append is preserved as evidence, never silently dropped.
        lines.push({ malformed: true, raw: String(raw).slice(0, 2000) });
      }
    }
    return lines;
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
}

function appendLine(filePath, record, io) {
  const opts = io || {};
  const appendFile = opts.appendFile || fs.appendFileSync;
  appendFile(filePath, JSON.stringify(record) + '\n', 'utf8');
}

module.exports = {
  STATES,
  DISCOVERY_WRITABLE,
  stateLabel,
  currentState,
  readCatalogue,
  appendLine,
};
