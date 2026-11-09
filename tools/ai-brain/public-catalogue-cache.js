'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function fetchPublicCatalogueCache(options = {}) {
  const file =
    options.file ||
    options.cacheFile ||
    (options.dir && options.name ? path.join(options.dir, `live-${options.name}.json`) : null);
  const now = Number(options.now ?? (options.clock ? options.clock() : Date.now()));
  const maxAgeMs = Number(options.maxAgeMs);
  const offline = Boolean(options.offline);

  let cachedData = null;
  let cachedMtime = null;
  let cacheCorrupt = false;
  if (file && fs.existsSync(file)) {
    try {
      cachedMtime = fs.statSync(file).mtimeMs;
      cachedData = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      cacheCorrupt = true;
    }
  }

  const hasCache = cachedMtime !== null && !cacheCorrupt;
  const ageMs = cachedMtime !== null ? Math.max(0, now - cachedMtime) : null;
  if (hasCache && Number.isFinite(maxAgeMs) && ageMs <= maxAgeMs) {
    return { data: cachedData, ageMs, stale: false, error: null };
  }

  if (offline || typeof options.fetch !== 'function') {
    const error = cacheCorrupt
      ? 'CORRUPT_CACHE'
      : offline
        ? hasCache
          ? 'OFFLINE'
          : 'CACHE_MISSING_OFFLINE'
        : hasCache
          ? 'NO_FETCH_AVAILABLE'
          : 'FETCH_FAILED';
    return {
      data: hasCache ? cachedData : null,
      ageMs: hasCache ? ageMs : null,
      stale: true,
      error,
    };
  }

  try {
    const res = await options.fetch(options.url, {
      timeoutMs: options.timeoutMs,
      maxBufferBytes: options.maxBufferBytes,
    });
    const freshData =
      typeof res === 'string' ? JSON.parse(res) : res?.json ? await res.json() : res;
    if (!freshData || typeof freshData !== 'object') throw new Error('INVALID_FETCH_RESPONSE');
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(freshData, null, 2), 'utf8');
    }
    return { data: freshData, ageMs: 0, stale: false, error: null };
  } catch (err) {
    return {
      data: hasCache ? cachedData : null,
      ageMs: hasCache ? ageMs : null,
      stale: true,
      error: cacheCorrupt ? 'CORRUPT_CACHE' : err?.message || 'FETCH_FAILED',
    };
  }
}

module.exports = {
  fetchPublicCatalogueCache,
  readPublicCatalogueCache: fetchPublicCatalogueCache,
};
