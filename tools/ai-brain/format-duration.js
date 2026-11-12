'use strict';

function invalid(reason) {
  const err = new Error(`DURATION_INVALID: ${reason}`);
  err.code = 'DURATION_INVALID';
  return err;
}

function formatDuration(ms) {
  if (typeof ms !== 'number') {
    throw invalid(`expected a number of milliseconds, got ${typeof ms}`);
  }
  if (!Number.isFinite(ms)) {
    throw invalid(`expected a finite number of milliseconds, got ${String(ms)}`);
  }
  if (ms < 0) {
    throw invalid(`expected a non-negative number of milliseconds, got ${String(ms)}`);
  }

  const wholeMs = Math.floor(ms);
  if (wholeMs < 1000) {
    return `${wholeMs}ms`;
  }
  if (ms < 60000) {
    const tenths = Math.floor(ms / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}s`;
  }
  if (ms < 3600000) {
    const totalSeconds = Math.floor(ms / 1000);
    return `${Math.floor(totalSeconds / 60)}m${totalSeconds % 60}s`;
  }
  const totalMinutes = Math.floor(ms / 60000);
  return `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}m`;
}

module.exports = { formatDuration };
