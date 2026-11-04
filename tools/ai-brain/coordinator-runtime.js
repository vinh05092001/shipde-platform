'use strict';
// Host-only command boundaries. Author tests inject run/git; never execute git writes.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { runCommand } = require('./discovery/spawn');
const { openCodeConfig, configuredModels } = require('./discovery/live');
const { readJson, writeJson, refreshCatalogue } = require('./catalogue-refresh');
const policy = require('./coordinator');
const { safeText } = require('./coordinator-text');
const {
  readLog,
  readLines,
  parseReview,
  reviewUsage,
  MAX_LOG_BYTES,
  MAX_LOG_LINE_BYTES,
  TRUNCATION,
} = require('./coordinator-runtime-log');
const { EXCLUSIONS, createGitBoundary } = require('./coordinator-runtime-git');
const { createLauncher } = require('./coordinator-runtime-launch');

function itemBranch(item, branch) {
  const slug = /^(?:feat|fix)\/[\w-]+$/.test(branch) && branch.split('/')[1];
  const id = item.id.toLowerCase();
  return Boolean(slug && (slug === id || slug.startsWith(id + '-')));
}

function createRuntime(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const run = options.run || runCommand;
  const localDir = options.stateDir || path.join(root, '.oc', 'coordinator');
  const metricsFile = path.join(localDir, 'metrics.jsonl');
  const { git, checked, statusFiles, hooked, ownFiles, assertHead, commit, prepare } =
    createGitBoundary({ root, run, options });
  const config = options.config || openCodeConfig(options);
  const launchLog = (item) => path.join(item.cwd, '.oc', 'writer.log');
  const launch = createLauncher({ options, launchLog });

  const runtime = {
    configured: configuredModels(config),
    launchLog,
    refresh: () => refreshCatalogue(),
    save: (state) => writeJson(path.join(localDir, 'state.json'), state),
    inspect: async (item) => {
      const dirty = Boolean(
        await checked(item.cwd, ['status', '--porcelain', '--', ...EXCLUSIONS])
      );
      const branch = await checked(item.cwd, ['branch', '--show-current']);
      if (!itemBranch(item, branch)) throw new Error('ITEM_BRANCH_MISMATCH');
      const subjects = await checked(item.cwd, [
        'log',
        'origin/main..HEAD',
        '--no-merges',
        '--format=%s',
      ]);
      return { sha: subjects ? await checked(item.cwd, ['rev-parse', 'HEAD']) : null, dirty };
    },
    commit,
    prepare,
    push: async (item, sha) => {
      await assertHead(item.cwd, sha);
      const branch = await checked(item.cwd, ['branch', '--show-current']);
      if (!itemBranch(item, branch)) throw new Error('ITEM_BRANCH_MISMATCH');
      await git(item.cwd, ['push', 'origin', sha + ':refs/heads/' + branch]);
    },
    ci: async (item, sha) => {
      const head = async () =>
        JSON.parse(
          (
            await run('gh', ['pr', 'view', String(item.pr), '--json', 'headRefOid'], {
              cwd: item.cwd,
              timeoutMs: 30000,
            })
          ).stdout
        ).headRefOid;
      const before = await head();
      if (before !== sha) return { state: 'pending', sha: before };
      const result = await run(
        'gh',
        ['pr', 'checks', String(item.pr), '--json', 'bucket,name,state'],
        { cwd: item.cwd, timeoutMs: 30000 }
      );
      let checks;
      try {
        checks = JSON.parse(result.stdout);
      } catch {
        return { state: 'unknown', sha };
      }
      const after = await head();
      if (after !== sha) return { state: 'pending', sha: after };
      const red = checks.filter((check) => ['fail', 'cancel'].includes(check.bucket));
      return {
        state: red.length
          ? 'red'
          : !checks.length || checks.some((check) => !['pass', 'skipping'].includes(check.bucket))
            ? 'pending'
            : 'green',
        sha,
        reason: red.map((check) => check.name).join(', '),
      };
    },
    candidates: async (item, role = 'writer') => {
      const result = await require('./cli').dispatchCommand(
        {
          item: item.id,
          root: item.cwd,
          role: role === 'reviewer' ? 'reviewer' : 'author.foundation',
          'dry-run': true,
        },
        { log: () => {}, error: () => {}, exit: () => {} }
      );
      if (result.exitCode !== 0) return [];
      const priors = require('./priors');
      const document = priors.loadPriors();
      return (result.decision?.candidates || [])
        .map((row) => ({
          ...row,
          model: row.model || row.modelId,
          family: policy.family(row.model || row.modelId),
          score:
            priors.priorFor({ ...row, modelId: row.model || row.modelId }, role, document)?.score ??
            null,
        }))
        .filter(
          (row) =>
            (role === 'reviewer'
              ? ['opencode', 'codex', 'claude']
              : ['opencode', 'codex', 'claude', 'agy-pool']
            ).includes(row.harness) && !(row.family === 'claude' && row.harness !== 'claude')
        );
    },
    launch: async (item, candidate) => {
      const { pid, log, cannotCommit, completed } = launch(item, candidate);
      return { pid, log, cannotCommit, completed };
    },
    logText: async (writer) => {
      try {
        return readLog(writer.log);
      } catch {
        return '';
      }
    },
    quotaEvidence: async (writer) => {
      const quota = require('./quota-scan');
      const result = quota.getQuotaScopeState(
        { ...writer, modelId: writer.modelId || writer.model },
        quota.loadQuotaState({ quotaStateFile: options.quotaFile })
      );
      return result ? { at: result.at, code: result.code } : null;
    },
    review: async (item, candidate, prompt, sha) => {
      await assertHead(item.cwd, sha);
      const reviewDir = path.join(
        path.dirname(item.cwd),
        path.basename(item.cwd) + '--review-' + randomUUID().slice(0, 8)
      );
      await git(item.cwd, ['worktree', 'add', '--detach', reviewDir, sha]);
      const handle = launch({ ...item, cwd: reviewDir }, candidate, true, prompt);
      const timer = setTimeout(() => handle.child.kill(), 30 * 60 * 1000);
      let result;
      try {
        result = await handle.completed;
      } finally {
        clearTimeout(timer);
      }
      if (result.exitCode !== 0)
        return { verdict: 'BLOCKED', sha, reason: 'REVIEW_COMMAND_FAILED', tokens: null };
      const usage = reviewUsage(readLog(handle.log));
      return parseReview(usage.text, usage.tokens);
    },
    history: async (item, record) => {
      const dir = path.join(item.cwd, '.oc');
      fs.mkdirSync(dir, { recursive: true });
      const marker = `## PR ${item.pr} round ${record.round} SHA ${record.sha}`;
      const history = path.join(dir, 'history.md');
      const prior = fs.existsSync(history) ? fs.readFileSync(history, 'utf8') : '';
      const body = safeText(record.text || record.reason || JSON.stringify(record.findings || []));
      const entry = safeText(
        `${marker}\n\nWriter: ${record.writer}\nVERDICT: ${record.verdict}\n${body}\n`
      );
      if (!prior.includes(marker)) fs.appendFileSync(history, '\n' + entry);
      fs.writeFileSync(path.join(dir, 'review.txt'), entry);
    },
    metrics: async (record) => {
      fs.mkdirSync(localDir, { recursive: true });
      if (
        !readLines(metricsFile).some((row) => policy.metricsKey(row) === policy.metricsKey(record))
      )
        fs.appendFileSync(metricsFile, safeText(JSON.stringify(record)) + '\n');
    },
    fanout: async (item, lanes, candidates, state) => {
      const base = await checked(item.cwd, ['rev-parse', 'HEAD']);
      const active = [];
      for (const lane of lanes) {
        const writer = policy.chooseWriter(candidates, {
          now: Date.now(),
          configured: runtime.configured,
          exhausted: state.exhausted,
          launches: state.launches,
          failedWriters: state.items[item.id].failedWriters,
          highRisk: item.risk === 'HIGH',
        });
        if (!writer) throw new Error('FANOUT_NO_ELIGIBLE_WRITER');
        const suffix = '--lane-' + lane.lane + '-' + randomUUID().slice(0, 8);
        const cwd = path.join(path.dirname(item.cwd), path.basename(item.cwd) + suffix);
        const branch = (await checked(item.cwd, ['branch', '--show-current'])) + suffix;
        await git(item.cwd, ['worktree', 'add', '-b', branch, cwd, base]);
        fs.mkdirSync(path.join(cwd, '.oc'), { recursive: true });
        const task = fs.readFileSync(path.resolve(item.cwd, item.task), 'utf8');
        const prompt = `${task}\n\nLane ${lane.lane}. Fix only these findings: ${JSON.stringify(lane.findings)}. Edit only: ${lane.files.join(', ')}. Shared contracts belong to lane 1. Do not merge main. Do not commit; the coordinator validates file ownership and commits.\n`;
        const reservedAt = Date.now();
        const laneState = {
          ...lane,
          base,
          cwd,
          branch,
          writer: { ...writer, reservedAt, log: launchLog({ cwd }), cannotCommit: true },
        };
        active.push(laneState);
        state.launches.push({ item: item.id, model: writer.model, at: reservedAt });
        state.items[item.id].lanes = active;
        await runtime.save(state);
        const handle = launch({ ...item, cwd }, writer, false, prompt);
        Object.assign(laneState.writer, { pid: handle.pid, log: handle.log });
        await runtime.save(state);
      }
      return active;
    },
    collectLanes: async (item, lanes) => {
      if (lanes.some((lane) => policy.writerAlive(lane.writer))) return { state: 'pending' };
      for (const lane of lanes) {
        const files = [...(await ownFiles(lane.cwd, lane.base)), ...(await statusFiles(lane.cwd))];
        if (!files.length || files.some((file) => !lane.files.includes(file)))
          return { state: 'conflict', reason: 'FANOUT_FILE_OWNERSHIP_OR_NO_OUTPUT' };
        await commit({ ...item, cwd: lane.cwd }, lane.writer);
      }
      for (const lane of [...lanes].sort((a, b) => a.lane - b.lane)) {
        const merged = await git(item.cwd, ['merge', '--no-commit', '--no-ff', lane.branch], true);
        if (merged.exitCode !== 0) {
          await git(item.cwd, ['merge', '--abort'], true);
          return { state: 'conflict', reason: 'FANOUT_MERGE_CONFLICT' };
        }
        await hooked(item.cwd, ['commit', '--no-edit']);
      }
      return { state: 'merged' };
    },
  };
  return {
    ...runtime,
    localDir,
    metricsFile,
    readState: () => readJson(path.join(localDir, 'state.json')),
    run,
    root,
  };
}

module.exports = {
  createRuntime,
  parseReview,
  safeText,
  readLines,
  reviewUsage,
  EXCLUSIONS,
  MAX_LOG_BYTES,
  MAX_LOG_LINE_BYTES,
  readLog,
};
