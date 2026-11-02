'use strict';
// Host-only command boundaries. Author tests inject run/git; never execute git writes.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { runCommand, resolveCommand } = require('./discovery/spawn');
const { openCodeConfig, configuredModels } = require('./discovery/live');
const { readJson, writeJson, refreshCatalogue } = require('./catalogue-refresh');
const policy = require('./coordinator');
const { sanitizeErrorSnippet } = require('./quota-scan');
const REGISTER = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const EXCLUSIONS = ['.', ':(exclude).oc', ':(exclude).serena', ':(exclude).oc-codex-task.md'];

function safeText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => sanitizeErrorSnippet(line, 100000))
    .join('\n')
    .replace(
      /(["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password)["']?\s*[:=]\s*)["'][^"'\n]*["']/gi,
      '$1"[REDACTED]"'
    )
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED_EMAIL]');
}
function readLines(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
function parseReview(text, tokens = null) {
  const verdict = text.match(/^VERDICT:\s*(PASS|CHANGES_REQUIRED|BLOCKED)\s*$/m)?.[1];
  const sha = text.match(/^Reviewed SHA:\s*([a-f0-9]{40})\s*$/im)?.[1];
  const findings = text
    .split(/\n(?=\s*(?:\d+\.|-)\s+)/)
    .filter((block) => /\bP[012]\b/.test(block))
    .map((block) => ({
      severity: block.match(/\bP[012]\b/)[0],
      closed: /\bFIXED\b/.test(block) && !/NOT FIXED/.test(block),
      files: [
        ...new Set(
          [
            ...block.matchAll(
              /(?:`|\s)((?:apps|packages|docs|scripts|tools|prisma)\/[\w./\-[\]]+)(?::\d+)?/g
            ),
          ].map((match) => match[1])
        ),
      ],
      text: safeText(block),
    }));
  return { verdict, sha, findings, tokens, text: safeText(text) };
}
function createRuntime(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const run = options.run || runCommand;
  const localDir = options.stateDir || path.join(root, '.oc', 'coordinator');
  const metricsFile = path.join(localDir, 'metrics.jsonl');
  const git =
    options.git ||
    (async (cwd, args, allowFailure = false) => {
      const result = await run('git', args, { cwd, timeoutMs: 60000 });
      if (result.exitCode !== 0 && !allowFailure)
        throw new Error('GIT_FAILED: ' + args[0] + ': ' + safeText(result.stderr));
      return result;
    });
  const checked = async (cwd, args) => String((await git(cwd, args)).stdout || '').trim();
  const statusFiles = async (cwd) =>
    String((await git(cwd, ['status', '--porcelain', '--', ...EXCLUSIONS])).stdout || '')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3));
  const hooked =
    options.hookedGit ||
    (async (cwd, args) =>
      require('./isolation-launcher').hookedControllerGit({ workerRoot: cwd, hostRoot: root })(
        args
      ));
  const config = options.config || openCodeConfig(options);
  const launchLog = (item) => path.join(item.cwd, '.oc', 'writer.log');
  const ownFiles = async (cwd, base = 'origin/main') =>
    (await checked(cwd, ['diff', '--name-only', base + '...HEAD'])).split('\n').filter(Boolean);
  const assertHead = async (cwd, sha) => {
    if ((await checked(cwd, ['rev-parse', 'HEAD'])) !== sha) throw new Error('HEAD_CHANGED');
  };
  const commit = async (item, writer) => {
    const changes = String(
      (await git(item.cwd, ['status', '--porcelain', '--', ...EXCLUSIONS])).stdout || ''
    ).trimEnd();
    if (!changes) return;
    const files = changes.split('\n').map((line) => line.slice(3).replace(/^"|"$/g, ''));
    if (files.some(policy.protectedFile)) throw new Error('PROTECTED_PATH');
    const staged = await checked(item.cwd, ['diff', '--cached', '--name-only']);
    if (
      staged
        .split('\n')
        .some((file) => /^(?:\.oc(?:\/|$)|\.serena(?:\/|$)|\.oc-codex-task\.md$)/.test(file))
    )
      throw new Error('PRIVATE_FILES_STAGED');
    const diff = await git(item.cwd, ['diff', '--check'], true);
    if (diff.exitCode !== 0) throw new Error('DIFF_CHECK_FAILED');
    await git(item.cwd, ['add', '-A', '--', ...EXCLUSIONS]);
    await hooked(item.cwd, [
      'commit',
      '-m',
      `[${item.id}] Address review: writer output (${writer.model})`,
    ]);
  };
  const prepare = async (item) => {
    if (await checked(item.cwd, ['status', '--porcelain', '--', ...EXCLUSIONS]))
      return { ok: false, reason: 'DIRTY_WORKTREE' };
    await git(item.cwd, ['fetch', 'origin', 'main']);
    const behind = Number(await checked(item.cwd, ['rev-list', '--count', 'HEAD..origin/main']));
    if (behind) {
      const merged = await git(item.cwd, ['merge', '--no-commit', '--no-ff', 'origin/main'], true);
      if (merged.exitCode !== 0) {
        const conflicts = (await checked(item.cwd, ['diff', '--name-only', '--diff-filter=U']))
          .split('\n')
          .filter(Boolean);
        if (conflicts.length !== 1 || conflicts[0] !== REGISTER) {
          await git(item.cwd, ['merge', '--abort'], true);
          return { ok: false, reason: 'MAIN_MERGE_CONFLICT: ' + conflicts.join(', ') };
        }
        try {
          const ours = await checked(item.cwd, ['show', ':2:' + REGISTER]);
          const theirs = await checked(item.cwd, ['show', ':3:' + REGISTER]);
          fs.writeFileSync(path.join(item.cwd, REGISTER), policy.unionRegister(ours, theirs));
          await git(item.cwd, ['add', '--', REGISTER]);
        } catch {
          await git(item.cwd, ['merge', '--abort'], true);
          return { ok: false, reason: 'REGISTER_CONFLICT' };
        }
      }
      // Installed hooks execute for this merge commit just as for writer output.
      await hooked(item.cwd, ['commit', '--no-edit']);
    }
    const subjects = (
      await checked(item.cwd, ['log', 'origin/main..HEAD', '--no-merges', '--format=%s'])
    )
      .split('\n')
      .filter(Boolean);
    const files = await ownFiles(item.cwd);
    const whitespace = await git(item.cwd, ['diff', '--check', 'origin/main...HEAD'], true);
    return {
      ...policy.preflight(item.id, subjects, files, whitespace.exitCode ? 'DIFF_CHECK_FAILED' : ''),
      sha: await checked(item.cwd, ['rev-parse', 'HEAD']),
    };
  };
  function launch(item, candidate, review = false, promptOverride) {
    const dir = path.join(item.cwd, '.oc');
    fs.mkdirSync(dir, { recursive: true });
    const promptFile = path.join(dir, review ? 'review-prompt.md' : 'writer-prompt.md');
    let prompt = promptOverride;
    if (!prompt) {
      const taskFile = path.resolve(item.cwd, item.task);
      prompt = fs.readFileSync(taskFile, 'utf8');
      try {
        prompt += '\n\nReview feedback:\n' + fs.readFileSync(path.join(dir, 'review.txt'), 'utf8');
      } catch {}
      if (candidate.harness === 'codex')
        prompt +=
          '\n\nSandbox handoff: edit the full working tree and run available checks. Do not run git write commands or commit; host coordinator commits output. Record exact blocked checks in .oc/pr-body.md. Never change protected gates or print secrets.';
    }
    fs.writeFileSync(promptFile, prompt + '\n');
    let command,
      args,
      env = { ...process.env };
    if (candidate.harness === 'codex') {
      command = 'codex';
      args = ['exec', '-m', candidate.model, '-s', review ? 'read-only' : 'workspace-write', '-'];
    } else if (candidate.harness === 'agy-pool' && !review && policy.family(candidate.model) !== 'claude') {
      const accountId = candidate.accountId || candidate.account;
      if (!require('./agy-pool-runtime').isValidAccountId(accountId)) throw new Error('INVALID_ACCOUNT_ID');
      const jobFile = path.join(dir, 'pool-writer-job.json');
      fs.writeFileSync(jobFile, JSON.stringify({ accountId, model: candidate.model, cwd: item.cwd, prompt, candidateKey: candidate.candidateKey }));
      command = process.execPath;
      args = [path.join(__dirname, 'coordinator-pool-writer.js'), jobFile];
    } else if (candidate.harness === 'claude') {
      command = 'claude';
      args = [
        '-p',
        prompt,
        '--model',
        candidate.model,
        '--output-format',
        'json',
        ...(review ? ['--permission-mode', 'plan', '--allowedTools', 'Read,Glob,Grep'] : []),
      ];
    } else if (candidate.harness === 'opencode' && policy.family(candidate.model) !== 'claude') {
      command = 'opencode';
      args = [
        'run',
        '-m',
        candidate.model,
        '--format',
        'json',
        ...(review ? ['--agent', 'plan'] : []),
        '-f',
        promptFile,
        'Follow the attached task.',
      ];
      if (review)
        env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
          permission: { edit: 'deny', bash: 'deny', external_directory: 'deny' },
        });
    } else throw new Error('UNSUPPORTED_COORDINATOR_HARNESS');
    const resolved = command === process.execPath ? { file: command, args: [] } : resolveCommand(command, {});
    if (resolved.error) throw new Error('LAUNCH_COMMAND_' + resolved.error);
    const file = review ? path.join(dir, 'review-output.txt') : launchLog(item);
    fs.writeFileSync(file, '');
    const child = spawn(resolved.file, [...resolved.args, ...args], {
      cwd: item.cwd,
      env,
      windowsHide: true,
      shell: false,
      detached: !review,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stdin.end(candidate.harness === 'codex' ? prompt : undefined);
    const buffers = new Map();
    for (const stream of [child.stdout, child.stderr]) {
      buffers.set(stream, '');
      stream.on('data', (chunk) => {
        const parts = (buffers.get(stream) + chunk).split(/\r?\n/);
        buffers.set(stream, parts.pop());
        for (const line of parts) fs.appendFileSync(file, safeText(line) + '\n');
      });
    }
    const completed = new Promise((resolve) => {
      child.on('error', (error) => {
        fs.appendFileSync(file, error.code || 'SPAWN_FAILED');
        resolve({ exitCode: 1 });
      });
      child.on('close', (code) => {
        for (const buffer of buffers.values())
          if (buffer) fs.appendFileSync(file, safeText(buffer) + '\n');
        resolve({ exitCode: code ?? 1 });
      });
    });
    if (!review) child.unref();
    return {
      pid: child.pid,
      log: file,
      cannotCommit: candidate.harness === 'codex',
      completed,
      child,
    };
  }
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
      if (!branch.match(/^(?:feat|fix)\/[\w-]+$/) || !branch.includes(item.id.toLowerCase()))
        throw new Error('ITEM_BRANCH_MISMATCH');
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
      await git(item.cwd, ['push', 'origin', 'HEAD']);
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
          (role === 'reviewer' ? ['opencode', 'codex', 'claude'] : ['opencode', 'codex', 'claude', 'agy-pool']).includes(row.harness) &&
            !(row.family === 'claude' && row.harness !== 'claude')
        );
    },
    launch: async (item, candidate) => {
      const { pid, log, cannotCommit } = launch(item, candidate);
      return { pid, log, cannotCommit };
    },
    logText: async (writer) => {
      try {
        return fs.readFileSync(writer.log, 'utf8');
      } catch {
        return '';
      }
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
      const usage = reviewUsage(fs.readFileSync(handle.log, 'utf8'));
      return parseReview(usage.text, usage.tokens);
    },
    history: async (item, record) => {
      const dir = path.join(item.cwd, '.oc');
      fs.mkdirSync(dir, { recursive: true });
      const marker = `## PR ${item.pr} round ${record.round} SHA ${record.sha}`;
      const history = path.join(dir, 'history.md');
      const prior = fs.existsSync(history) ? fs.readFileSync(history, 'utf8') : '';
      const body = safeText(record.text || record.reason || JSON.stringify(record.findings || []));
      const entry = `${marker}\n\nWriter: ${record.writer}\nVERDICT: ${record.verdict}\n${body}\n`;
      if (!prior.includes(marker)) fs.appendFileSync(history, '\n' + entry);
      fs.writeFileSync(path.join(dir, 'review.txt'), entry);
    },
    metrics: async (record) => {
      fs.mkdirSync(localDir, { recursive: true });
      if (
        !readLines(metricsFile).some((row) => policy.metricsKey(row) === policy.metricsKey(record))
      )
        fs.appendFileSync(metricsFile, JSON.stringify(record) + '\n');
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
        const handle = launch({ ...item, cwd }, writer, false, prompt);
        active.push({
          ...lane,
          base,
          cwd,
          branch,
          writer: { ...writer, pid: handle.pid, log: handle.log, cannotCommit: true },
        });
        state.launches.push({ item: item.id, model: writer.model, at: Date.now() });
        state.items[item.id].lanes = active;
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
function reviewUsage(log) {
  let text = '',
    tokens = null;
  for (const line of log.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && typeof event.part?.text === 'string')
        text += event.part.text + '\n';
      if (typeof event.result === 'string') text += event.result + '\n';
      const usage = event.part?.tokens || event.usage;
      if (usage) {
        const total =
          usage.total_tokens ??
          usage.total ??
          Number(usage.input ?? usage.input_tokens ?? 0) +
            Number(usage.output ?? usage.output_tokens ?? 0) +
            Number(usage.reasoning ?? 0) +
            Number(usage.cache?.read ?? usage.cache_read_input_tokens ?? 0) +
            Number(usage.cache?.write ?? usage.cache_creation_input_tokens ?? 0);
        if (Number.isFinite(total) && total >= 0) tokens = (tokens ?? 0) + total;
      }
    } catch {
      /* CLI text is read below, never interpreted as a usage record. */
    }
  }
  const match = log.match(/tokens used\s*\n([\d,]+)/i);
  if (match) tokens = Number(match[1].replace(/,/g, ''));
  return { text: text || log, tokens };
}
module.exports = { createRuntime, parseReview, safeText, readLines, reviewUsage, EXCLUSIONS };
