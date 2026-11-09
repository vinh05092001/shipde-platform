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

  // The caller's limits are enforced here, not trusted to the fetch adapter: the whole
  // fetch-and-read is raced against `timeoutMs` (with a cancellation signal for
  // standard fetch) and the response body is read with a byte bound, so a standard
  // `fetch` also obeys them. A non-2xx HTTP response is a fetch failure: its error
  // body never replaces the cache.
  const timeoutMs = Number(options.timeoutMs);
  const maxBufferBytes = Number(options.maxBufferBytes);
  const controller = new AbortController();
  const bounded = (promise) => {
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) return promise;
    let timer;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('FETCH_TIMEOUT'));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
  };
  const readBodyBounded = async (res) => {
    if (typeof res === 'string') {
      if (
        Number.isFinite(maxBufferBytes) &&
        maxBufferBytes > 0 &&
        Buffer.byteLength(res) > maxBufferBytes
      )
        throw new Error('RESPONSE_TOO_LARGE');
      return JSON.parse(res);
    }
    if (res && typeof res.body?.getReader === 'function') {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && Number.isFinite(value.byteLength)) bytes += value.byteLength;
        if (Number.isFinite(maxBufferBytes) && maxBufferBytes > 0 && bytes > maxBufferBytes)
          throw new Error('RESPONSE_TOO_LARGE');
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text);
    }
    return res?.json ? await res.json() : res;
  };

  try {
    const res = await bounded(
      options.fetch(options.url, {
        timeoutMs: options.timeoutMs,
        maxBufferBytes: options.maxBufferBytes,
        signal: controller.signal,
      })
    );
    const status = typeof res?.status === 'number' ? res.status : 0;
    if (res?.ok === false || status >= 400) throw new Error(`HTTP_${status || 'ERROR'}`);
    const freshData = await bounded(readBodyBounded(res));
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
