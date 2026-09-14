'use strict';

/**
 * Ship Dễ — keeping the vendor quota cache warm
 *
 * The cache refuses readings older than thirty minutes, so without something
 * refilling it the panel is truthful for half an hour and empty afterwards.
 * Refilling it belongs here, on a timer, rather than on the request path: one
 * refresh runs a CLI per account and takes the better part of a minute, which
 * is not a wait to put in front of someone opening a page.
 *
 * The interval is deliberately shorter than the cache's own expiry. Matching
 * them exactly would leave a gap on every cycle, where the previous reading has
 * just expired and the next has not landed.
 *
 * One refresh at a time. A run that outlives its interval — the container is
 * slow to start, the network is stalling — must not have a second run stacked
 * behind it, since both would be asking the same CLI the same question.
 */

const { spawn } = require('child_process');
const path = require('path');

/** Comfortably inside the cache's thirty-minute expiry. */
const DEFAULT_INTERVAL_MS = 20 * 60 * 1000;

/** Longer than a cold container start, short enough to not wedge the timer. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function startQuotaRefresher(options) {
  const opts = options || {};
  const intervalMs = Number(opts.intervalMs) > 0 ? Number(opts.intervalMs) : DEFAULT_INTERVAL_MS;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const cli = opts.cli || path.join(__dirname, '..', 'ai-brain', 'cli.js');
  const log = opts.log || (() => {});
  const spawnFn = opts.spawn || spawn;

  let running = false;
  let lastResult = null;

  function runOnce() {
    if (running) {
      log('bỏ qua một nhịp làm mới quota: lần trước chưa xong');
      return null;
    }
    running = true;

    const child = spawnFn(process.execPath, [cli, 'quota'], {
      cwd: opts.cwd || path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    if (child.stdout) child.stdout.on('data', (d) => (out += d));
    if (child.stderr) child.stderr.on('data', (d) => (out += d));

    const killer = setTimeout(() => {
      log('làm mới quota quá lâu, đang dừng lại');
      try {
        child.kill();
      } catch (e) {
        /* already gone */
      }
    }, timeoutMs);
    // Unreferenced so a pending kill-timer cannot by itself hold the process
    // open. The refresher is a background chore; nothing should wait on it.
    if (killer.unref) killer.unref();

    const finish = (code, error) => {
      if (!running) return;
      running = false;
      clearTimeout(killer);
      lastResult = {
        at: new Date().toISOString(),
        ok: code === 0 && !error,
        // Kept so a failing refresh can be read from the dashboard rather than
        // only from whatever terminal happened to be open when it broke.
        output: String(out).trim().slice(-2000),
        error: error ? String(error.message || error) : null,
      };
      log(lastResult.ok ? 'đã làm mới quota' : 'làm mới quota hỏng: ' + (lastResult.error || 'mã thoát ' + code));
    };

    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code, null));
    return child;
  }

  // The first run is immediate: a dashboard started after a long gap should not
  // show half an hour of nothing before the first tick.
  if (opts.runImmediately !== false) runOnce();

  const timer = setInterval(runOnce, intervalMs);
  if (timer.unref) timer.unref();

  return {
    runOnce,
    stop: () => clearInterval(timer),
    isRunning: () => running,
    lastResult: () => lastResult,
  };
}

module.exports = { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS, startQuotaRefresher };
