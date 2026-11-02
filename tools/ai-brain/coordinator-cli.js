'use strict';
const fs = require('fs');
const path = require('path');
const { coordinatorTick, metricsSummary } = require('./coordinator');
const { createRuntime, readLines } = require('./coordinator-runtime');
const { writeJson } = require('./catalogue-refresh');

async function main(args = process.argv.slice(2)) {
  const root = process.cwd();
  if (args[0] === 'metrics') {
    const file = args[1] || path.join(root, '.oc', 'coordinator', 'metrics.jsonl');
    const rows = readLines(file),
      merged = new Set();
    const { runCommand } = require('./discovery/spawn');
    for (const pr of new Set(rows.map((row) => row.pr))) {
      const result = await runCommand('gh', ['pr', 'view', String(pr), '--json', 'state'], {
        cwd: root,
        timeoutMs: 30000,
      });
      if (result.exitCode !== 0) throw new Error('METRICS_MERGE_STATE_UNAVAILABLE');
      if (JSON.parse(result.stdout).state === 'MERGED') merged.add(pr);
    }
    const summary = metricsSummary(rows, merged);
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
      !/^(?:TASK-AI|TASK-FOUND|FEAT-[A-Z]+)-\d+$/.test(item.id) ||
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
  const fd = fs.openSync(lock, 'wx');
  fs.writeSync(fd, JSON.stringify({ pid: process.pid }));
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
        state.lastError = error.code || error.message;
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
    console.error(require('./coordinator-runtime').safeText(error.code || error.message));
    process.exitCode = 1;
  });
module.exports = { main };
