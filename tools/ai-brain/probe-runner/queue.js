'use strict';

/**
 * Ship Dễ — Probe Runner Queue Management
 *
 * Builds and partitions the model queue keyed by:
 * harness/accessPath/gateway/upstream/account/quotaScope/modelId
 *
 * Implements progressive ordering: 1 representative model per upstream first,
 * and restart filtering: skips valid results, retries PROBE_INVALID and expired DEFERRED.
 */

const fs = require('fs');

/**
 * Builds the composite queue key:
 * harness/accessPath/gateway/upstream/account/quotaScope/modelId
 */
function buildQueueKey(item) {
  const i = item || {};
  return [
    i.harness || 'http',
    i.accessPath || '9router',
    i.gateway || '9router',
    i.upstream || '',
    i.account || '',
    i.quotaScope || '',
    i.modelId || '',
  ].join('/');
}

/**
 * Parses the composite queue key back into its components.
 * Note: modelId may contain slashes (e.g. kimchi/glm-5.3-flash).
 */
function parseQueueKey(key) {
  if (!key) return {};
  const parts = String(key).split('/');
  return {
    harness: parts[0] || 'http',
    accessPath: parts[1] || '9router',
    gateway: parts[2] || '9router',
    upstream: parts[3] || '',
    account: parts[4] || '',
    quotaScope: parts[5] || '',
    modelId: parts.slice(6).join('/'),
  };
}

/**
 * Normalizes a candidate model item into a consistent shape with key.
 */
function normalizeCandidate(raw) {
  if (!raw) return null;
  const item = typeof raw === 'string' ? { modelId: raw } : { ...raw };

  const modelId = String(item.modelId || item.id || '').trim();
  if (!modelId) return null;

  let upstream = String(item.upstream || '').trim();
  if (!upstream) {
    if (modelId.includes('/')) {
      upstream = modelId.split('/')[0];
    } else {
      upstream = 'default';
    }
  }

  const normalized = {
    harness: String(item.harness || 'http').trim(),
    accessPath: String(item.accessPath || '9router').trim(),
    gateway: String(item.gateway || '9router').trim(),
    upstream,
    account: String(item.account || '').trim(),
    quotaScope: String(item.quotaScope || '').trim(),
    modelId,
  };

  normalized.key = item.key || buildQueueKey(normalized);
  return normalized;
}

/**
 * Loads and normalizes a catalogue from a file, JSON array, JSONL string, or objects.
 */
function loadCatalogue(source) {
  if (!source) return [];

  let items = [];
  if (Array.isArray(source)) {
    items = source;
  } else if (typeof source === 'object' && source !== null) {
    if (Array.isArray(source.data)) {
      items = source.data;
    } else if (Array.isArray(source.models)) {
      items = source.models;
    } else {
      items = [source];
    }
  } else if (typeof source === 'string') {
    const trimmed = source.trim();
    // Check if it's a file path
    if (fs.existsSync(trimmed)) {
      const content = fs.readFileSync(trimmed, 'utf8');
      if (trimmed.endsWith('.jsonl') || content.includes('\n{"') || content.includes('\r\n{"')) {
        items = content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean);
      } else {
        try {
          const parsed = JSON.parse(content);
          items = Array.isArray(parsed) ? parsed : parsed.data || parsed.models || [parsed];
        } catch (e) {
          items = [];
        }
      }
    } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        items = Array.isArray(parsed) ? parsed : parsed.data || parsed.models || [parsed];
      } catch (e) {
        // Try line-delimited
        items = trimmed
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch (err) {
              return null;
            }
          })
          .filter(Boolean);
      }
    }
  }

  const seen = new Set();
  const normalized = [];
  for (const raw of items) {
    const norm = normalizeCandidate(raw);
    if (norm && !seen.has(norm.key)) {
      seen.add(norm.key);
      normalized.push(norm);
    }
  }

  return normalized;
}

/**
 * Loads previous execution history from a JSONL file.
 * Returns a Map of key -> latest recorded row.
 */
function loadHistory(filePath) {
  const history = new Map();
  if (!filePath || !fs.existsSync(filePath)) {
    return history;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row && row.key) {
        history.set(row.key, row);
      }
    } catch (e) {
      // Ignore corrupt lines
    }
  }

  return history;
}

/**
 * Checks if a DEFERRED record's cooldown has expired.
 */
function isCooldownExpired(row, now = Date.now()) {
  if (!row) return true;
  if (row.cooldownExpiresAt) {
    const expires = new Date(row.cooldownExpiresAt).getTime();
    if (Number.isFinite(expires)) {
      return now >= expires;
    }
  }
  if (row.cooldownMs && Number.isFinite(row.cooldownMs)) {
    const ts = row.ts ? new Date(row.ts).getTime() : now;
    return now >= ts + row.cooldownMs;
  }
  // If cooldown is null (never recovers) -> not expired
  return false;
}

/**
 * Decides whether a candidate should be probed given previous history.
 *
 * Rules:
 * - Untested or not in history -> PROBE
 * - PROBE_INVALID -> RETRY (PROBE)
 * - DEFERRED -> RETRY only if cooldown expired
 * - PASS or FAIL -> SKIP (valid result)
 */
function shouldProbe(item, history, now = Date.now()) {
  if (!history || !history.has(item.key)) {
    return true;
  }

  const prev = history.get(item.key);
  if (!prev) return true;

  if (prev.status === 'PROBE_INVALID' || prev.probeInvalid === true) {
    return true;
  }

  if (prev.status === 'DEFERRED') {
    return isCooldownExpired(prev, now);
  }

  if (prev.status === 'PASS' || prev.status === 'FAIL') {
    return false;
  }

  if (prev.status === 'UNTESTED') {
    return true;
  }

  return false;
}

/**
 * Organizes items into progressive upstream groups.
 * Stage 1: Exactly 1 representative model per upstream.
 * Stage 2: The remaining models inside each upstream.
 */
function buildProgressiveQueue(items, history = new Map(), now = Date.now()) {
  const eligible = (items || []).filter((item) => shouldProbe(item, history, now));

  const groups = new Map();
  for (const item of eligible) {
    const upstream = item.upstream;
    if (!groups.has(upstream)) {
      groups.set(upstream, []);
    }
    groups.get(upstream).push(item);
  }

  const representatives = [];
  const remainingByUpstream = new Map();

  for (const [upstream, list] of groups.entries()) {
    representatives.push(list[0]);
    remainingByUpstream.set(upstream, list.slice(1));
  }

  return {
    eligible,
    groups,
    representatives,
    remainingByUpstream,
  };
}

module.exports = {
  buildQueueKey,
  parseQueueKey,
  normalizeCandidate,
  loadCatalogue,
  loadHistory,
  isCooldownExpired,
  shouldProbe,
  buildProgressiveQueue,
};
