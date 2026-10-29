'use strict';

/**
 * Ship Dễ - governed planning services (TASK-AI-141 G, unattended `next --loop`).
 *
 * `planWorkItem(..., {run:true})` needs four services: planner ranking, an
 * isolated planner, an independent reviewer and a governed docs-only merge.
 * This module supplies the last three from machinery the Controller already
 * owns - the isolated launcher / agy-pool launcher (orchestrate.resolveLauncher),
 * the review lane (orchestrate.reviewLane), Controller candidate selection
 * (orchestrate.selectCandidateForProfile), route-health and the quota-aware
 * ranking - and the exact-HEAD merge preflight (governed-merge.governedMerge).
 *
 * Every external effect is an injectable seam (`launcher`, `git`, `gh`,
 * `selectCandidate`, `reviewLane`, `governedMerge`) so each piece is testable
 * without a model, a network or a GitHub repository. Nothing here names a model,
 * a provider or a numeric limit: candidates, quotas and health come from live data.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const decisions = require('./decisions');

const SHA_40 = /^[0-9a-f]{40}$/i;
const REGISTER_REL = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEMS_REL = 'docs/product-spec/work-items';

function posix(p) {
  return String(p).replace(/\\/g, '/');
}

function workItemRel(workItemId) {
  return WORK_ITEMS_REL + '/' + workItemId + '.md';
}

function resolveInstalledHook(cwd) {
  try {
    const res = spawnSync(
      'git',
      [
        '-c',
        'safe.directory=' + posix(path.resolve(cwd)),
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'hooks',
      ],
      { cwd, encoding: 'utf8', windowsHide: true }
    );
    const hooksDir = res.status === 0 ? String(res.stdout || '').trim() : '';
    const hook = hooksDir ? path.join(hooksDir, 'pre-commit') : '';
    if (!hook || !fs.existsSync(hook)) {
      return { ok: false, reason: 'installed pre-commit hook missing' };
    }
    const stat = fs.statSync(hook);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o111) === 0)) {
      return { ok: false, reason: 'installed pre-commit hook not executable' };
    }
    fs.accessSync(hook, fs.constants.X_OK);
    return { ok: true, hooksDir, hook };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Controller-side git: fsmonitor and external diff are disabled, installed hooks are enforced on commit. */
function defaultGit(cwd, args) {
  const extra = [];
  if (process.platform === 'win32') {
    extra.push('-c', 'core.filemode=false');
    extra.push('-c', 'core.autocrlf=true');
  }
  if (!Array.isArray(args)) {
    return { ok: false, stdout: '', stderr: 'HOOK_CHECK_FAILED: argv must be an array' };
  }
  let normalizedArgs;
  try {
    normalizedArgs = args.map((a) => (typeof a === 'string' ? a : String(a ?? '')));
  } catch {
    return { ok: false, stdout: '', stderr: 'HOOK_CHECK_FAILED: invalid argv entry' };
  }
  const hasHooksPathOverride = normalizedArgs.some((a) => /core\.hooksPath/i.test(a));
  if (hasHooksPathOverride) {
    return {
      ok: false,
      stdout: '',
      stderr: 'HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited',
    };
  }
  if (normalizedArgs.includes('commit')) {
    const isNoVerify = normalizedArgs.some((a) => {
      if (a === '--no-verify' || a.startsWith('--no-verify') || a.startsWith('--no-ver')) {
        return true;
      }
      if (a.startsWith('-') && !a.startsWith('--') && a.length > 1) {
        for (let i = 1; i < a.length; i++) {
          const ch = a[i];
          if (ch === 'n') return true;
          if ('mFcCut'.includes(ch)) break;
        }
      }
      return false;
    });
    if (isNoVerify) {
      return {
        ok: false,
        stdout: '',
        stderr: 'HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited',
      };
    }
    const hookCheck = resolveInstalledHook(cwd);
    if (!hookCheck.ok) {
      return { ok: false, stdout: '', stderr: 'HOOK_CHECK_FAILED: ' + hookCheck.reason };
    }
    extra.push('-c', 'core.hooksPath=' + hookCheck.hooksDir);
  }
  const res = spawnSync(
    'git',
    ['-c', 'safe.directory=' + posix(path.resolve(cwd)), '-c', 'core.fsmonitor=false'].concat(
      extra,
      normalizedArgs
    ),
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: Object.assign({}, process.env, {
        GIT_CONFIG_NOSYSTEM: '1',
      }),
    }
  );
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || '').trim(),
    stderr: String(res.stderr || '').trim(),
  };
}

/**
 * The docs-only rule. A planner change may add or modify the Work Item document
 * and flip the register row of the same Work Item; nothing else, no deletion,
 * rename or mode change, and the register diff may touch only that row.
 */
function verifyDocsOnlyChange({ git, cwd, base, head, workItemId }) {
  const g = git || defaultGit;
  const status = g(cwd, [
    'diff',
    '--no-ext-diff',
    '--name-status',
    '--no-renames',
    base + '..' + head,
  ]);
  if (!status.ok) return { ok: false, code: 'DIFF_UNREADABLE', reason: status.stderr };
  const rows = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kind, ...rest] = line.split(/\s+/);
      return { kind, file: posix(rest.join(' ')) };
    });
  const docPath = workItemRel(workItemId);
  const allowed = new Set([docPath, REGISTER_REL]);
  const files = rows.map((r) => r.file);
  for (const row of rows) {
    if (!allowed.has(row.file)) {
      return {
        ok: false,
        code: 'NOT_DOCS_ONLY',
        reason:
          'change touches ' + row.file + ', outside the Work Item document and its register row',
        files,
      };
    }
    if (row.kind !== 'A' && row.kind !== 'M') {
      return {
        ok: false,
        code: 'NOT_DOCS_ONLY',
        reason: 'change kind ' + row.kind + ' on ' + row.file + ' is not an add or modify',
        files,
      };
    }
  }
  if (!files.includes(docPath)) {
    return { ok: false, code: 'NO_WORK_ITEM_CHANGE', reason: docPath + ' was not changed', files };
  }
  const modes = g(cwd, ['diff', '--no-ext-diff', '--raw', '--no-renames', base + '..' + head]);
  if (modes.ok) {
    for (const line of modes.stdout.split(/\r?\n/).filter(Boolean)) {
      const m = line.match(/^:(\d+)\s+(\d+)\s/);
      if (m && m[2] !== '100644') {
        return {
          ok: false,
          code: 'NOT_DOCS_ONLY',
          reason: 'file mode ' + m[2] + ' is not a plain file',
          files,
        };
      }
    }
  }
  if (files.includes(REGISTER_REL)) {
    const diff = g(cwd, [
      'diff',
      '--no-ext-diff',
      '-U0',
      '--no-renames',
      base + '..' + head,
      '--',
      REGISTER_REL,
    ]);
    if (!diff.ok) return { ok: false, code: 'DIFF_UNREADABLE', reason: diff.stderr, files };
    const removed = [];
    const added = [];
    for (const line of diff.stdout.split(/\r?\n/)) {
      if (line.startsWith('---') || line.startsWith('+++')) continue;
      if (line.startsWith('-')) removed.push(line.slice(1));
      else if (line.startsWith('+')) added.push(line.slice(1));
    }
    const idToken = '"' + workItemId + '"';
    if (
      removed.length !== 1 ||
      added.length !== 1 ||
      !removed[0].includes(idToken) ||
      !added[0].includes(idToken)
    ) {
      return {
        ok: false,
        code: 'NOT_DOCS_ONLY',
        reason: 'register change must replace exactly the row of ' + workItemId,
        files,
      };
    }
  }
  return { ok: true, files };
}

/** The planner prompt: complete the one document, only from the approved sources. */
function buildPlannerPrompt({ workItemId, draftText, sources, dirs, baseSha }) {
  const lines = [];
  lines.push('Work Item: ' + workItemId);
  lines.push('Role requirement: planner (documentation only)');
  lines.push('Base SHA: ' + (baseSha || ''));
  lines.push('Allowed files: ' + workItemRel(workItemId) + ', ' + REGISTER_REL);
  lines.push('');
  lines.push(
    'Task: complete the Work Item document ' +
      workItemRel(workItemId) +
      ' so that author intake no longer fails as INTAKE_INCOMPLETE: every template section must be filled, ' +
      'with acceptance criteria and allowed paths that are verifiable and bounded.'
  );
  lines.push('Approved sources (the only sources you may cite or restate):');
  for (const s of sources || []) lines.push('- ' + posix(s));
  for (const d of dirs || []) lines.push('- ' + posix(d) + '/ (specifications)');
  lines.push(
    'Rules: add no statement that an approved source does not support; leave a decision open and say so rather than inventing it; ' +
      'change no production code, test, configuration or other document; do not merge, push or select models.'
  );
  lines.push(
    'If and only if the document is complete and has no open decision, set the Status of ' +
      workItemId +
      ' to READY_FOR_AUTHOR in ' +
      REGISTER_REL +
      ' by editing that single row; otherwise leave the register untouched.'
  );
  lines.push(
    'You run unattended and non-interactive: never ask a question; finish by saving the files.'
  );
  lines.push('');
  lines.push('Current draft of ' + workItemRel(workItemId) + ':');
  lines.push(String(draftText || '(no draft)'));
  return lines.join('\n');
}

function candidateKeyOf(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'string') return candidate;
  return candidate.candidateKey || require('./candidates').candidateKey(candidate);
}

function accountMark(candidate) {
  if (!candidate || !candidate.accountId || candidate.accountId === '*') return null;
  return 'account::' + (candidate.harness || '') + '::' + candidate.accountId;
}

/** Remember a failed attempt so the next ranking skips the key, and the account when it is exhausted. */
function noteFailure(state, candidate, res) {
  const key = candidateKeyOf(candidate);
  if (key) state.failedKeys.add(key);
  try {
    const fc = require('./failure-classifier');
    const cls = fc.classifyFailure({
      exitCode: res && res.exitCode,
      httpStatus: res && res.httpStatus,
      body: res && (res.body || res.stderr),
      stdout: res && res.stdout,
      stderr: res && res.stderr,
      accountId: candidate && candidate.accountId,
    });
    if (cls && cls.scope === fc.Scope.ACCOUNT) {
      const mark = accountMark(candidate);
      if (mark) state.failedAccounts.add(mark);
    }
  } catch {
    // classification is best effort; the key itself is already excluded
  }
}

function excluded(state, candidate) {
  const key = candidateKeyOf(candidate);
  if (key && state.failedKeys.has(key)) return true;
  const mark = accountMark(candidate);
  return Boolean(mark && state.failedAccounts.has(mark));
}

function newState() {
  return { failedKeys: new Set(), failedAccounts: new Set() };
}

/** Candidate pool shared by the planner ranking and the reviewer selection. */
function loadPool(rootDir, ctx) {
  const c = ctx || {};
  if (typeof c.loadPool === 'function') return c.loadPool(rootDir);
  const sources = require('./sources');
  const evidence = require('./evidence');
  const candidatesApi = require('./candidates');
  const { readDiscoveryCatalogue } = require('./discovery/read');
  const registry = c.registry || sources.loadSources();
  const accounts = require('./accounts').listAccounts() || [];
  let discovery = { candidates: [] };
  try {
    discovery = readDiscoveryCatalogue({ dataDir: path.join(__dirname, 'data', 'discovery') });
  } catch {
    // an empty discovery leaves the pool to the remaining sources
  }
  const evidenceData = evidence.loadEvidence(path.join(__dirname, 'data', 'evidence'));
  const assembled = require('./cli').assembleForDispatch(discovery, accounts, registry, {
    evidenceData,
  });
  const annotated = candidatesApi.annotateCandidates(assembled, evidenceData, { now: Date.now() });
  return { annotated, evidenceData, accounts, registry };
}

function resolveBaseSha(git, rootDir, base) {
  const name = base || 'main';
  for (const ref of ['origin/' + name, name]) {
    const r = git(rootDir, ['rev-parse', '--verify', ref + '^{commit}']);
    if (r.ok && SHA_40.test(r.stdout)) return { sha: r.stdout, ref };
  }
  return null;
}

function isReviewerIndependent(authorKey, reviewerKey) {
  if (!authorKey || !reviewerKey) return false;
  if (authorKey === reviewerKey) return false;
  const identity = require('./discovery/identity');
  const parsedAuthor = identity.parseCandidateKey(authorKey);
  const parsedReviewer = identity.parseCandidateKey(reviewerKey);
  if (parsedAuthor && parsedReviewer) {
    if (
      parsedAuthor.harness &&
      parsedReviewer.harness &&
      parsedAuthor.harness === parsedReviewer.harness
    ) {
      return false;
    }
    if (
      parsedAuthor.account &&
      parsedReviewer.account &&
      parsedAuthor.account === parsedReviewer.account
    ) {
      return false;
    }
    if (
      parsedAuthor.upstream &&
      parsedReviewer.upstream &&
      parsedAuthor.upstream === parsedReviewer.upstream
    ) {
      return false;
    }
    if (
      parsedAuthor.gateway &&
      parsedReviewer.gateway &&
      parsedAuthor.gateway === parsedReviewer.gateway
    ) {
      return false;
    }
  }
  const routing = require('./routing');
  const dAuthor = routing.canonicalFailureDomain(authorKey);
  const dReviewer = routing.canonicalFailureDomain(reviewerKey);
  if (dAuthor && dReviewer && dAuthor === dReviewer) {
    return false;
  }
  return true;
}

function createPlanningServices(ctx) {
  const c = ctx || {};
  const rootDir = path.resolve(c.rootDir || process.cwd());
  const git = c.git || defaultGit;
  const now = c.now || (() => Date.now());
  const log = c.log || (() => {});
  const decisionDir = c.decisionDir || decisions.DEFAULT_DIR;
  const logOpts = { dir: decisionDir };
  const orchestrate = () => c.orchestrate || require('./orchestrate');
  const poolOf = () => loadPool(rootDir, c);

  function runOptions(extra) {
    const pool = poolOf();
    return Object.assign(
      {
        cwd: rootDir,
        isolatedWorker: true,
        decisionDir,
        registry: pool.registry,
        accounts: pool.accounts,
        externalWorkers: c.externalWorkers,
        workerTimeoutMs: c.workerTimeoutMs,
        base: c.base,
        env: c.env,
      },
      c.runOptions || {},
      extra || {}
    );
  }

  /**
   * A worker root of this lane's own. The host-keyed shared worker root belongs to
   * whichever Work Item is being authored, so planning and review never touch it.
   */
  function dedicatedRoot(kind, workItemId, suffix) {
    if (kind === 'plan' && c.plannerRoot) return c.plannerRoot;
    if (kind === 'review' && c.reviewRoot) return c.reviewRoot;
    const shared = orchestrate().resolveIsolatedWorkerRoot({ isolatedWorker: true }, rootDir);
    if (!shared) return null;
    return (
      shared + '-' + kind + '-' + String(workItemId).toLowerCase() + (suffix ? '-' + suffix : '')
    );
  }

  function isExternalHarness(name, o) {
    const list =
      typeof o.externalWorkers === 'string'
        ? o.externalWorkers.split(',').map((v) => v.trim())
        : Array.isArray(o.externalWorkers)
          ? o.externalWorkers
          : [];
    return list.includes(name);
  }

  /** Controller-side commit of whatever the planner left in its own root. */
  function commitPlannerChanges(planRoot, branch, workItemId) {
    const dirty = git(planRoot, ['status', '--porcelain']);
    if (!dirty.ok || !dirty.stdout) return null;
    const hookCheck = resolveInstalledHook(rootDir);
    if (!hookCheck.ok) return null;
    const planHooksDir = path.join(planRoot, '.git', 'hooks');
    fs.mkdirSync(planHooksDir, { recursive: true });
    const planHook = path.join(planHooksDir, 'pre-commit');
    if (!fs.existsSync(planHook)) {
      fs.copyFileSync(hookCheck.hook, planHook);
      try {
        fs.chmodSync(planHook, 0o755);
      } catch {}
    }
    const ident = c.gitIdentity || {
      name: 'Ship De Controller',
      email: 'controller@shipde.invalid',
    };
    git(planRoot, ['checkout', '-q', '-B', branch]);
    const added = git(planRoot, ['add', '-A']);
    if (!added.ok) return null;
    const done = git(planRoot, [
      '-c',
      'user.name=' + ident.name,
      '-c',
      'user.email=' + ident.email,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      '[' + workItemId + '] Work Item specification',
    ]);
    if (!done.ok) return null;
    const head = git(planRoot, ['rev-parse', 'HEAD']);
    return head.ok ? head.stdout : null;
  }

  function launcherFor(o) {
    if (typeof c.launcher === 'function') return c.launcher;
    const orch = orchestrate();
    return orch.resolveLauncher(o, require('./isolation-launcher').getIsolatedLauncher());
  }

  async function probeRoute(candidate, route, o) {
    if (c.probe === false) return { ok: true };
    const orch = orchestrate();
    const routeProbe = require('./route-probe');
    const probeCandidate = orch.routeProbeCandidate(candidate, route, o.registry, false);
    if (!probeCandidate) return { ok: true, skipped: true };
    const result = await routeProbe.boundedProbe(
      c.routeProbe || routeProbe.probeRoute,
      probeCandidate,
      probeCandidate.apiKeyEnv,
      Object.assign({}, process.env, o.env || {}),
      { timeoutMs: c.probeTimeoutMs, fetch: c.fetch }
    );
    require('./route-health').rememberProbe(candidate, result, o);
    return result || { ok: false };
  }

  /**
   * Isolated planner. The Controller ranks the planner (rankPlanner), the
   * candidate is probed and launched in an isolated worker root pinned to the
   * base SHA, and the resulting commit is accepted only when it is docs-only.
   * A launch or probe failure excludes the candidate (and its account when the
   * failure is account-wide) and the next ranked candidate is tried.
   */
  async function launchPlanner({ workItemId, candidate, draft }) {
    const state = newState();
    const planRoot = dedicatedRoot('plan', workItemId);
    const o = runOptions({ isolatedWorkerRoot: planRoot, workerRoot: planRoot });
    const base = resolveBaseSha(git, rootDir, c.base);
    if (!base)
      return { success: false, reason: 'PLAN_BASE_UNRESOLVED: cannot resolve the base commit' };
    const planning = require('./work-item-planner');
    const draftText = (draft && draft.text) || '';
    const prompt = buildPlannerPrompt({
      workItemId,
      draftText,
      sources: planning.APPROVED_SOURCES,
      dirs: planning.APPROVED_SPEC_DIRS,
      baseSha: base.sha,
    });
    const orch = orchestrate();
    const launcher = launcherFor(o);
    const hostWorker = planRoot;
    const branch = 'feat/' + String(workItemId).toLowerCase() + '-work-item-spec';
    let current = candidate;
    let lastReason = 'no planner candidate was usable';

    while (current && current.eligible !== false) {
      const key = candidateKeyOf(current);
      const route = orch.resolveLaunchRoute(current, o, o.registry);
      if (!route || !route.harnessName) {
        noteFailure(state, current, { exitCode: 1, stderr: 'PLANNER_ROUTE_UNRESOLVABLE' });
        lastReason = 'PLANNER_ROUTE_UNRESOLVABLE: ' + key;
      } else {
        const probe = await probeRoute(current, route, o);
        if (!probe || probe.ok !== true) {
          noteFailure(state, current, {
            exitCode: 1,
            httpStatus: probe && probe.status,
            body: probe && probe.body,
            stderr: 'PLANNER_ROUTE_PROBE_FAILED',
          });
          lastReason = 'PLANNER_ROUTE_PROBE_FAILED: ' + key;
        } else {
          decisions.recordDecision(
            {
              stage: decisions.Stage.LAUNCHED,
              workItemId,
              role: 'planner',
              chosen: key,
              branch,
              detail: 'PLANNER_LAUNCH: docs-only planning of ' + workItemId + ' at ' + base.sha,
            },
            logOpts
          );
          const job = {
            workItemId,
            candidateKey: key,
            harness: route.harnessName,
            provider: route.provider,
            model: route.model,
            accountId: String(current.accountId || ''),
            gateway: current.gateway || '',
            upstream: current.upstream,
            quotaScope: current.quotaScope,
            prompt,
            branch,
            base: c.base || 'main',
            baseSha: base.sha,
            hostWorktree: rootDir,
            workerRoot: hostWorker,
            cwd: hostWorker,
            isolatedWorker: true,
            decisionDir,
            title: String(workItemId),
            labels: { workItem: String(workItemId), role: 'author.docs' },
            workerTimeoutMs: o.workerTimeoutMs,
            lowRisk: true,
            riskDomains: ['documentation'],
          };
          let res;
          try {
            // A pool/CLI worker runs in the directory it is given and does not
            // provision one, so the Controller hands it a clean checkout of the base.
            if (isExternalHarness(route.harnessName, o)) {
              (c.provision || orch.provisionReviewRoot)(rootDir, hostWorker, base.sha, o);
            }
            res = await launcher(job);
          } catch (err) {
            res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
          }
          if (res && res.exitCode === 0) {
            let head = (res.workerSha && SHA_40.test(res.workerSha) && res.workerSha) || null;
            if (!head) {
              const dirty = git(hostWorker, ['status', '--porcelain']);
              if (dirty.ok && dirty.stdout) {
                head = commitPlannerChanges(hostWorker, branch, workItemId);
                if (!head) {
                  lastReason = 'PLANNER_COMMIT_REJECTED: pre-commit hook or commit failed';
                  noteFailure(state, current, { exitCode: 1, stderr: lastReason });
                  continue;
                }
              } else {
                head = git(hostWorker, ['rev-parse', 'HEAD']).stdout || '';
              }
            }
            if (!SHA_40.test(head) || head.toLowerCase() === base.sha.toLowerCase()) {
              lastReason = 'PLANNER_NO_COMMIT: the planner produced no commit';
              noteFailure(state, current, { exitCode: 1, stderr: lastReason });
            } else {
              const scope = verifyDocsOnlyChange({
                git,
                cwd: hostWorker,
                base: base.sha,
                head,
                workItemId,
              });
              if (!scope.ok) {
                // A scope violation is a refusal of this output, not a retry: the
                // candidate wrote outside the docs boundary.
                return {
                  success: false,
                  reason: scope.code + ': ' + scope.reason,
                  candidateKey: key,
                };
              }
              const shown = git(hostWorker, ['show', head + ':' + workItemRel(workItemId)]);
              return {
                success: true,
                candidateKey: key,
                headSha: head,
                baseSha: base.sha,
                workerRoot: hostWorker,
                branch,
                files: scope.files,
                draftText: shown.ok ? shown.stdout : null,
              };
            }
          } else {
            const redact = decisions.createSecretRedactor(process.env);
            const rawDiag =
              (res && (res.stderr || res.failureReason)) || 'exit ' + (res && res.exitCode);
            const safeDiag = redact(String(rawDiag));
            lastReason = ('PLANNER_LAUNCH_FAILED: ' + safeDiag).slice(0, 300);
            const safeRes = res ? { ...res, stderr: redact(String(res.stderr || '')) } : res;
            noteFailure(state, current, safeRes);
          }
        }
      }
      if (typeof c.rankPlanner !== 'function') break;
      const next = await c.rankPlanner({
        workItemId,
        role: 'planner.default',
        failedKeys: state.failedKeys,
        failedAccounts: state.failedAccounts,
      });
      current = next && next.eligible ? next : null;
      if (!current) lastReason += ' (no further planner candidate)';
    }
    return { success: false, reason: lastReason };
  }

  /** Item the review lane judges for a documentation-only planning change. */
  function planReviewItemFor(workItemId, title) {
    return {
      id: workItemId,
      title: title || workItemId,
      role: 'reviewer',
      allowedPaths: [workItemRel(workItemId), REGISTER_REL],
      acceptanceCriteria: [
        'Only the Work Item document and the register row of the same Work Item change.',
        'Every statement in the document is supported by an approved product-spec source it cites; nothing is invented.',
        'All template sections are filled, with verifiable acceptance criteria and bounded allowed paths.',
        'The register row is READY_FOR_AUTHOR only when the document is complete and has no open decision.',
      ],
    };
  }

  /** Item the review lane judges for an implementation change: load actual Work Item requirements. */
  function implementationReviewItemFor(workItemId, title, authorRootDir) {
    const itemPath = path.join(
      authorRootDir || rootDir,
      'docs',
      'product-spec',
      'work-items',
      workItemId + '.md'
    );
    if (!fs.existsSync(itemPath)) {
      throw new Error('WORK_ITEM_NOT_FOUND: ' + itemPath);
    }
    const text = fs.readFileSync(itemPath, 'utf8');
    const intake = require('./intake');
    const allowedPaths = intake.deriveAllowedPaths(text);
    const acceptanceCriteria = intake.deriveAcceptanceCriteria(text);
    if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
      throw new Error('WORK_ITEM_INVALID: allowedPaths missing or empty in ' + itemPath);
    }
    if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
      throw new Error('WORK_ITEM_INVALID: acceptanceCriteria missing or empty in ' + itemPath);
    }
    return {
      id: workItemId,
      title: title || workItemId,
      role: 'reviewer',
      allowedPaths,
      acceptanceCriteria,
    };
  }

  /**
   * One independent review at an exact SHA. The Controller selects the reviewer
   * (never the author's candidate or failure domain), a launch failure excludes
   * that reviewer and selects the next, and the verdict is bound to the SHA.
   */
  async function reviewAtSha({
    workItemId,
    sha,
    baseSha,
    authorKey,
    authorRoot,
    title,
    branch,
    isPlanReview,
  }) {
    if (!sha || !SHA_40.test(String(sha))) {
      return {
        verdict: 'BLOCKED',
        reason: 'REVIEW_SHA_UNPINNED: a 40-character commit is required',
      };
    }
    if (!authorKey) {
      return {
        verdict: 'BLOCKED',
        reason:
          'AUTHOR_UNKNOWN: an author or writer candidate key is required for independent review',
      };
    }
    const state = newState();
    const reviewRoot = dedicatedRoot('review', workItemId, String(sha).slice(0, 7));
    const o0 = runOptions({
      workerRoot: authorRoot,
      isolatedWorkerRoot: authorRoot,
      reviewRoot,
      baseSha,
    });
    const pool = poolOf();
    const orch = orchestrate();
    const launcher = launcherFor(o0);
    let item;
    try {
      item = isPlanReview
        ? planReviewItemFor(workItemId, title)
        : implementationReviewItemFor(workItemId, title, authorRoot || rootDir);
    } catch (err) {
      return {
        verdict: 'BLOCKED',
        reason: (err && err.message) || String(err),
      };
    }
    const parsedAuthor = authorKey
      ? require('./discovery/identity').parseCandidateKey(authorKey)
      : null;
    const authorDomain = authorKey ? require('./routing').canonicalFailureDomain(authorKey) : null;
    const forbidden = [
      parsedAuthor && parsedAuthor.upstream,
      parsedAuthor && parsedAuthor.gateway,
      parsedAuthor && parsedAuthor.account,
      parsedAuthor && parsedAuthor.harness,
      authorDomain,
    ].filter(Boolean);
    const select = c.selectCandidate || orch.selectCandidateForProfile;
    const lane = c.reviewLane || orch.reviewLane;
    const usageDir = c.usageDir || path.join(os.tmpdir(), 'shipde-plan-review');
    fs.mkdirSync(usageDir, { recursive: true });
    let lastReason = 'no independent reviewer candidate was usable';

    for (;;) {
      const pickable = pool.annotated.filter((cand) => !excluded(state, cand));
      const decision = await select(
        {
          id: workItemId + '-review',
          roleRequirement: { role: 'reviewer' },
          complexity: 'standard',
          proofFloor: 'NONE',
          writerCandidateKey: authorKey || null,
          failedKeys: state.failedKeys,
        },
        pickable,
        forbidden,
        pool.evidenceData,
        o0,
        logOpts,
        now(),
        { failedKeys: state.failedKeys }
      );
      const reviewerKey = decision && decision.chosen;
      if (!reviewerKey) {
        return {
          verdict: 'BLOCKED',
          reason: (decision && decision.reason) || 'NO_REVIEWER_CANDIDATE: ' + lastReason,
        };
      }
      if (authorKey && reviewerKey === authorKey) {
        return { verdict: 'BLOCKED', reason: 'REVIEWER_EQUALS_AUTHOR' };
      }
      if (authorKey && !isReviewerIndependent(authorKey, reviewerKey)) {
        return {
          verdict: 'BLOCKED',
          reason: 'REVIEWER_NOT_INDEPENDENT: reviewer shares identity dimensions with author',
        };
      }
      const reviewerCandidate =
        pool.annotated.find((cand) => candidateKeyOf(cand) === reviewerKey) || null;
      const o = Object.assign({}, o0, { reviewerIdentity: reviewerKey });
      const verdict = await lane(
        o,
        item,
        { candidateKey: authorKey, baseSha, worktree: authorRoot, branch },
        { goal: 'Independent review of the planning change for ' + workItemId },
        logOpts,
        launcher,
        usageDir,
        now(),
        pool.annotated,
        pool.evidenceData,
        pool.registry,
        {}
      )(sha);
      if (verdict && verdict.launchFailed) {
        noteFailure(state, reviewerCandidate || reviewerKey, verdict.res || { exitCode: 1 });
        lastReason = 'REVIEWER_LAUNCH_FAILED: ' + reviewerKey;
        continue;
      }
      const findings = (verdict && verdict.findings) || [];
      const pass = Boolean(verdict && verdict.pass === true && verdict.verdict === 'PASS');
      const boundSha = verdict && verdict.sha;
      const result = {
        verdict: pass
          ? 'PASS'
          : verdict && verdict.verdict === 'REFUSED'
            ? 'BLOCKED'
            : 'CHANGES_REQUIRED',
        sha: boundSha || null,
        reviewer: reviewerKey,
        author: authorKey || null,
        findings,
        reason: pass
          ? undefined
          : findings.map((f) => f.detail || f.id).join('; ') || 'review did not pass',
      };
      if (pass && (!boundSha || boundSha.toLowerCase() !== String(sha).toLowerCase())) {
        result.verdict = 'BLOCKED';
        result.reason = 'REVIEW_SHA_MISMATCH: verdict is not bound to ' + sha;
      }
      decisions.recordDecision(
        {
          stage: decisions.Stage.REVIEW,
          workItemId,
          role: 'reviewer',
          chosen: authorKey || null,
          reviewer: reviewerKey,
          verdict: result.verdict,
          sha,
          findings,
          detail: 'INDEPENDENT_REVIEW at ' + sha,
        },
        logOpts
      );
      return result;
    }
  }

  /** Write the review artifact and manifest the merge preflight reads. */
  function recordReviewManifest({ workItemId, sha, baseSha, repoCwd, authorKey, review }) {
    const { buildManifest } = require('./review-manifest');
    fs.mkdirSync(decisionDir, { recursive: true });
    const artifactPath = path.join(decisionDir, 'review-artifact-' + workItemId + '.md');
    fs.writeFileSync(
      artifactPath,
      [
        '# Independent review of ' + workItemId,
        '',
        'Reviewed commit: ' + sha,
        'Reviewer: ' + review.reviewer,
        'Author: ' + authorKey,
        'Verdict: ' + review.verdict,
        '',
        ...(review.findings || []).map((f) => '- ' + (f.id || 'finding') + ': ' + (f.detail || '')),
      ].join('\n') + '\n',
      'utf8'
    );
    const manifest = buildManifest({
      workItemId,
      repoCwd,
      baseSha,
      reviewedSha: sha,
      writerCandidateKey: authorKey,
      reviewerCandidateKey: review.reviewer,
      verdict: review.verdict,
      findings: review.findings || [],
      tests: [],
      artifactPath,
    });
    const manifestPath = path.join(decisionDir, 'review-manifest-' + workItemId + '.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return { manifest, manifestPath, artifactPath };
  }

  async function reviewPlan({ workItemId, candidate, plan }) {
    if (!plan || !plan.headSha) {
      return {
        verdict: 'BLOCKED',
        reason: 'Independent planner review: REVIEW_SHA_UNPINNED: no planner commit to review',
      };
    }
    const review = await reviewAtSha({
      workItemId,
      sha: plan.headSha,
      baseSha: plan.baseSha,
      authorKey: plan.candidateKey || candidateKeyOf(candidate),
      authorRoot: plan.workerRoot,
      branch: plan.branch,
      isPlanReview: true,
    });
    return Object.assign({}, review, { headSha: plan.headSha });
  }

  /**
   * Governed docs-only merge. Refuses unless: the planner commit is docs-only,
   * the independent verdict is PASS bound to that exact SHA, a non-draft PR
   * exists on that exact head, and the exact-HEAD preflight (required checks
   * SUCCESS, no unresolved threads, expectedHeadOid squash) passes.
   */
  async function mergePlan({ workItemId, candidate, plan, review }) {
    const refuse = (reason) => ({ merged: false, success: false, reason });
    if (!plan || !plan.headSha || !SHA_40.test(plan.headSha)) {
      return refuse('MERGE_SHA_UNPINNED: no planner commit');
    }
    if (
      !review ||
      review.verdict !== 'PASS' ||
      String(review.sha || '').toLowerCase() !== plan.headSha.toLowerCase()
    ) {
      return refuse(
        'MERGE_REVIEW_NOT_PASS_ON_SHA: an independent PASS on the exact commit is required'
      );
    }
    const authorKey = plan.candidateKey || candidateKeyOf(candidate);
    if (
      !review.reviewer ||
      review.reviewer === authorKey ||
      !isReviewerIndependent(authorKey, review.reviewer)
    ) {
      return refuse('MERGE_REVIEWER_NOT_INDEPENDENT');
    }
    const scope = verifyDocsOnlyChange({
      git,
      cwd: plan.workerRoot,
      base: plan.baseSha,
      head: plan.headSha,
      workItemId,
    });
    if (!scope.ok) return refuse(scope.code + ': ' + scope.reason);

    const publish = c.publishPlan || defaultPublishPlan;
    const published = await publish({
      workItemId,
      plan,
      rootDir,
      git,
      gh: c.gh,
      repo: c.repo,
      base: c.base || 'main',
    });
    if (!published || !published.ok) {
      return refuse((published && published.reason) || 'PLAN_PUBLISH_FAILED');
    }
    const recorded = recordReviewManifest({
      workItemId,
      sha: plan.headSha,
      baseSha: plan.baseSha,
      repoCwd: rootDir,
      authorKey,
      review,
    });
    const merge = c.governedMerge || require('./governed-merge').governedMerge;
    const result = await merge(
      Object.assign(
        {
          workItemId,
          repoCwd: rootDir,
          decisionDir,
          manifestPath: recorded.manifestPath,
          artifactPath: recorded.artifactPath,
          repo: c.repo,
          ghClient: c.ghClient,
          ghRunner: c.ghRunner,
          graphqlInvoker: c.graphqlInvoker,
          configPath: c.mergeConfigPath,
          config: c.mergeConfig,
          now: now(),
        },
        c.mergeOptions || {}
      )
    );
    if (!result || result.ok !== true) {
      return refuse((result && (result.reason || result.refusal)) || 'GOVERNED_MERGE_REFUSED');
    }
    return {
      merged: true,
      success: true,
      headSha: result.headSha,
      mergeCommitOid: result.mergeCommitOid,
    };
  }

  /** `review pr --pr <n> --sha <40hex>`: review an existing PR at its exact head. */
  async function reviewPullRequest(opts) {
    const o = opts || {};
    const { pr, sha, workItemId, authorKey } = o;
    const gh = o.gh || c.gh || defaultGh;
    const gitRunner = o.git || git;
    const view = gh(rootDir, [
      'pr',
      'view',
      String(pr),
      '--json',
      'headRefOid,baseRefOid,title,headRefName',
      ...(c.repo ? ['--repo', c.repo] : []),
    ]);
    if (!view.ok) return { verdict: 'BLOCKED', reason: 'PR_UNREADABLE: ' + view.stderr };
    let info;
    try {
      info = JSON.parse(view.stdout);
    } catch {
      return { verdict: 'BLOCKED', reason: 'PR_UNREADABLE: gh returned non-JSON' };
    }
    if (String(info.headRefOid || '').toLowerCase() !== String(sha).toLowerCase()) {
      return {
        verdict: 'BLOCKED',
        reason: 'PR_HEAD_MOVED: head is ' + info.headRefOid + ', requested ' + sha,
      };
    }
    const id =
      workItemId || (String(info.title || '').match(/^\[([A-Z0-9-]+)\]/) || [])[1] || 'PR-' + pr;
    const fetched = gitRunner(rootDir, ['fetch', 'origin', 'pull/' + pr + '/head']);
    if (!fetched.ok) return { verdict: 'BLOCKED', reason: 'PR_FETCH_FAILED: ' + fetched.stderr };
    const baseSha =
      info.baseRefOid ||
      gitRunner(rootDir, ['merge-base', sha, 'origin/' + (c.base || 'main')]).stdout ||
      null;
    const logWriters = require('./governed-merge')
      .getWritersFromDecisionLog(id, decisionDir)
      .filter(Boolean);
    let resolvedAuthor = null;
    if (logWriters.length > 0) {
      if (authorKey && !logWriters.includes(authorKey)) {
        return {
          verdict: 'BLOCKED',
          reason:
            'AUTHOR_MISMATCH: caller-supplied author ' +
            authorKey +
            ' does not match recorded decision log writer(s)',
        };
      }
      resolvedAuthor = logWriters[0];
    } else {
      const prBody = String(info.body || '');
      const bodyMatch = prBody.match(/(?:author|writer)(?: candidate key)?:\s*([^\r\n]+)/i);
      const prAuthor = bodyMatch ? bodyMatch[1].trim() : null;
      if (prAuthor) {
        if (authorKey && authorKey !== prAuthor) {
          return {
            verdict: 'BLOCKED',
            reason: 'AUTHOR_MISMATCH: caller-supplied author does not match PR body',
          };
        }
        resolvedAuthor = prAuthor;
      } else if (authorKey) {
        resolvedAuthor = authorKey;
      }
    }
    if (!resolvedAuthor) {
      return {
        verdict: 'BLOCKED',
        reason: 'AUTHOR_UNKNOWN: an author or writer candidate key is required to review PR ' + pr,
      };
    }
    const review = await reviewAtSha({
      workItemId: id,
      sha,
      baseSha,
      authorKey: resolvedAuthor,
      authorRoot: rootDir,
      title: info.title,
      branch: info.headRefName,
      isPlanReview: false,
    });
    if (review.verdict === 'PASS' || review.verdict === 'CHANGES_REQUIRED') {
      if (review.author) {
        recordReviewManifest({
          workItemId: id,
          sha,
          baseSha,
          repoCwd: rootDir,
          authorKey: review.author,
          review,
        });
      }
    }
    return Object.assign({ pr: Number(pr), workItemId: id }, review);
  }

  return { launchPlanner, reviewPlan, mergePlan, reviewPullRequest, reviewAtSha };
}

function defaultGh(cwd, args) {
  const res = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || '').trim(),
    stderr: String(res.stderr || '').trim(),
  };
}

/** Push the reviewed commit and open a non-draft PR titled with the Work Item. */
async function defaultPublishPlan({ workItemId, plan, rootDir, git, gh, repo, base }) {
  const run = gh || defaultGh;
  const repoArg = repo ? ['--repo', repo] : [];
  const existing = run(rootDir, [
    'pr',
    'list',
    '--head',
    plan.branch,
    '--json',
    'number,headRefOid,isDraft',
    ...repoArg,
  ]);
  if (existing.ok && existing.stdout) {
    try {
      const list = JSON.parse(existing.stdout);
      const hit =
        Array.isArray(list) &&
        list.find((p) => String(p.headRefOid).toLowerCase() === plan.headSha.toLowerCase());
      if (hit) return { ok: true, number: hit.number, existing: true };
    } catch {
      // fall through to creating the PR
    }
  }
  const push = git(plan.workerRoot, [
    'push',
    'origin',
    plan.headSha + ':refs/heads/' + plan.branch,
  ]);
  if (!push.ok) return { ok: false, reason: 'PLAN_PUSH_FAILED: ' + push.stderr };
  const fetched = git(rootDir, ['fetch', 'origin', plan.branch]);
  if (!fetched.ok) return { ok: false, reason: 'PLAN_FETCH_FAILED: ' + fetched.stderr };
  const created = run(rootDir, [
    'pr',
    'create',
    '--head',
    plan.branch,
    '--base',
    base,
    '--title',
    '[' + workItemId + '] Work Item specification ready for author',
    '--body',
    'Docs-only planning change for ' +
      workItemId +
      ' at ' +
      plan.headSha +
      '.\n\nKnown limitations: None.',
    ...repoArg,
  ]);
  if (!created.ok) return { ok: false, reason: 'PLAN_PR_CREATE_FAILED: ' + created.stderr };
  return { ok: true, url: created.stdout };
}

module.exports = {
  createPlanningServices,
  verifyDocsOnlyChange,
  buildPlannerPrompt,
  loadPool,
  noteFailure,
  excluded,
  newState,
  workItemRel,
  REGISTER_REL,
  defaultGit,
  defaultGh,
  defaultPublishPlan,
  resolveInstalledHook,
  isReviewerIndependent,
};
