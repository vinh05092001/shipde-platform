'use strict';
const fs = require('fs');
const path = require('path');
const { coordinatorTick, metricsSummary, validMetric } = require('./coordinator');
const { createRuntime, readLines } = require('./coordinator-runtime');
const { writeJson } = require('./catalogue-refresh');
const { errorText } = require('./coordinator-text');

async function main(args = process.argv.slice(2)) {
  const root = process.cwd();
  if (args[0] === 'metrics') {
    const file = args[1] || path.join(root, '.oc', 'coordinator', 'metrics.jsonl');
    const rawRows = readLines(file);
    // Malformed or partially written rows are skipped, not fatal: metrics is
    // read-only reporting, and one bad line must not abort the whole summary.
    const validRows = rawRows.filter(validMetric);
    const merged = new Set();
    const mergeStateUnavailable = [];
    const { runCommand } = require('./discovery/spawn');
    for (const pr of new Set(validRows.map((row) => row.pr))) {
      try {
        const result = await runCommand('gh', ['pr', 'view', String(pr), '--json', 'state'], {
          cwd: root,
          timeoutMs: 30000,
        });
        if (result.exitCode !== 0) throw new Error('METRICS_MERGE_STATE_UNAVAILABLE');
        const parsed = JSON.parse(result.stdout);
        if (!['OPEN', 'CLOSED', 'MERGED'].includes(parsed?.state))
          throw new Error('METRICS_MERGE_STATE_UNAVAILABLE');
        if (parsed.state === 'MERGED') merged.add(pr);
      } catch {
        mergeStateUnavailable.push(pr);
      }
    }
    const summary = metricsSummary(validRows, merged);
    const skipped = (rawRows.malformedRowsSkipped || 0) + rawRows.length - validRows.length;
    if (skipped) summary.malformedRowsSkipped = skipped;
    if (mergeStateUnavailable.length) summary.mergeStateUnavailable = mergeStateUnavailable;
    if (skipped || mergeStateUnavailable.length) summary.partial = true;
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }
  if (args[0] !== 'run' || !args[1])
    throw new Error('Usage: coordinator run <items.json> [--loop] | metrics [metrics.jsonl]');
  const items = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  if (!Array.isArray(items) || new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('ITEMS_INVALID');
  for (const item of items) {
    if (
      !/^(?:(?:TASK-AI|TASK-FOUND|FEAT-[A-Z]+)-\d+|GOAL-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+)$/.test(
        item.id
      ) ||
      !Number.isInteger(item.pr) ||
      item.pr <= 0 ||
      typeof item.task !== 'string'
    )
      throw new Error('ITEM_INVALID');
    item.cwd = fs.realpathSync(item.cwd);
    const task = path.resolve(item.cwd, item.task);
    if (!task.startsWith(item.cwd + path.sep)) throw new Error('TASK_OUTSIDE_WORKTREE');
  }
  const runtime = createRuntime();
  fs.mkdirSync(runtime.localDir, { recursive: true });
  const lock = path.join(runtime.localDir, 'loop.lock');
  // An existing lock requires operator inspection; never steal a live/unknown loop.
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      let heldPid = 'unknown';
      let age = 'unknown';
      try {
        const metadata = JSON.parse(fs.readFileSync(lock, 'utf8'));
        if (Number.isSafeInteger(metadata?.pid) && metadata.pid > 0) heldPid = metadata.pid;
        const at = Date.parse(metadata?.at);
        if (Number.isFinite(at) && at <= Date.now())
          age = Math.floor((Date.now() - at) / 1000) + 's';
      } catch {}
      throw new Error(
        `LOOP_LOCK_HELD: PID ${heldPid}, age ${age}; inspect the process and ${lock}. Remove the lock manually only after confirming the loop is no longer running.`
      );
    }
    throw err;
  }
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  fs.closeSync(fd);
  const state = runtime.readState();
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    do {
      try {
        await coordinatorTick(items, state, runtime);
      } catch (error) {
        state.lastError = errorText(error);
        writeJson(path.join(runtime.localDir, 'state.json'), state);
        throw error;
      }
      console.log(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(state.items).map(([id, item]) => [
              id,
              { status: item.status, rounds: item.rounds, sha: item.reviewedSha },
            ])
          )
        )
      );
      if (!args.includes('--loop') || stopping) break;
      // Short waits keep signal handling and live process/log updates responsive.
      for (let step = 0; step < 30 && !stopping; step++)
        await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (!stopping);
  } finally {
    fs.unlinkSync(lock);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  });
module.exports = { main };
