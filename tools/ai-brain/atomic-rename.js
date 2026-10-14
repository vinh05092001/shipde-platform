'use strict';

const fs = require('fs');

const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_DELAYS_MS = [50, 100, 150, 200, 250, 300, 350, 400, 500];

function sleepSync(ms) {
  if (ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

function removeLeftoverTmp(fsApi, tmpPath) {
  try {
    const unlinkFn =
      fsApi && typeof fsApi.unlinkSync === 'function'
        ? fsApi.unlinkSync.bind(fsApi)
        : fs.unlinkSync;
    const existsFn =
      fsApi && typeof fsApi.existsSync === 'function'
        ? fsApi.existsSync.bind(fsApi)
        : fs.existsSync;
    if (existsFn(tmpPath)) {
      unlinkFn(tmpPath);
    }
  } catch (_) {}
}

/**
 * Atomically renames source (typically a .tmp file) to target with retry logic on Windows
 * for transient lock errors (EPERM, EBUSY, EACCES).
 *
 * @param {string} source Path to temporary file
 * @param {string} target Destination path
 * @param {object} [options] Options
 * @param {object} [options.fs] Custom fs implementation
 * @param {number} [options.maxAttempts=10] Max attempts
 * @param {number[]} [options.delays] Array of delays in ms between attempts
 * @param {function} [options.sleep] Custom sync sleep function
 */
function atomicRenameSync(source, target, options) {
  const fsApi = (options && options.fs) || fs;
  const maxAttempts =
    options && typeof options.maxAttempts === 'number' ? options.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  const delays = options && Array.isArray(options.delays) ? options.delays : DEFAULT_DELAYS_MS;

  let originalError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fsApi.renameSync(source, target);
      return;
    } catch (err) {
      if (!originalError) {
        originalError = err;
      }
      const isRetryable = err && RETRYABLE_CODES.has(err.code);
      if (!isRetryable || attempt >= maxAttempts) {
        removeLeftoverTmp(fsApi, source);
        throw originalError;
      }
      const delay = attempt - 1 < delays.length ? delays[attempt - 1] : delays[delays.length - 1];
      if (options && typeof options.sleep === 'function') {
        options.sleep(delay);
      } else {
        sleepSync(delay);
      }
    }
  }
}

module.exports = {
  atomicRenameSync,
  renameSync: atomicRenameSync,
  renameWithRetry: atomicRenameSync,
  sleepSync,
  removeLeftoverTmp,
  RETRYABLE_CODES,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_DELAYS_MS,
};
