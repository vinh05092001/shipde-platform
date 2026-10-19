#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Brain CLI
 *
 *   node tools/ai-brain/cli.js reconcile [--json] [--strict]
 *   node tools/ai-brain/cli.js prove --tests "<command>" [...]
 *   node tools/ai-brain/cli.js dispatch [--dry-run | --execute] [--plan <file>]
 *                                       [--profile <file.json>] [--report-outcome <file.json>]
 *   node tools/ai-brain/cli.js shadow --project|--compare [--register <p>] [--shadow <p>] [--json] [--dry-run]
 *   node tools/ai-brain/cli.js probe --account <id> [--model <m>] [--json]
 *                                   [--file <p>] [--timeout <ms>] [--cache-window <ms>]
 *   node tools/ai-brain/cli.js qualify --account <id> --model <m> [--role <roleId>]
 *                                      [--json] [--file <p>]
 *
 * `reconcile` asks whether the register can back up what it claims.
 * `prove` runs the checks an agent says it ran, and reports what happened.
 * `probe` runs the one bounded, recorded account-qualification probe
 * (TASK-AI-30): a cheapest-model real request through the account's own
 * launch path, whose outcome — pass, fail, timeout or refused — is recorded
 * in tools/ai-brain/qualification-results/results.json and reused inside the
 * cache window. It never grants qualification; that is TASK-AI-31.
 * `qualify` (TASK-AI-31) reads the probe result and grants qualifiedRoles
 * only when the outcome was 'pass' and the result is within the cache window.
 *
 * Exit codes: 0 when nothing is overstated, 1 when it is. --strict also fails
 * on warnings, for use in CI where an unrecorded merge should block.
 */

const path = require('path');
const { reconcileRegister, planReconciliation, applyStatusMutations } = require('./reconcile');
const { auditManifest } = require('./manifest-audit');
const { runCheck, currentBranch, headSha } = require('./facts');
const { toPositiveInteger } = require('./source-discovery');
const { atomicRenameSync } = require('./atomic-rename');

const SEVERITY_LABEL = { error: 'LỖI ', warn: 'CẢNH', info: 'GHI ' };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(token);
  }
  return out;
}

/**
 * Options this command understands. Anything else is a typo, and a typo is
 * refused rather than ignored: silently dropping `--registr` would run the
 * reconciler against the real register while the operator believed they were
 * pointed at a fixture, which is the one mistake write-back must never make.
 */
const RECONCILE_FLAGS = new Set([
  'json',
  'strict',
  'all',
  'write',
  'dry-run',
  'dryRun',
  'allow-fixture-write',
  'allowFixtureWrite',
]);
const RECONCILE_VALUES = new Set([
  'root',
  'csv',
  'main',
  'register',
  'merge-evidence',
  'mergeEvidence',
  'audit-out',
  'auditOut',
  'revert',
]);

const PROTECTED_BRANCHES = new Set(['main', 'master']);
const PROTECTED_WORKTREE = 'shipde-platform';
const REFUSAL_PROTECTED =
  'Write-back refused: running in protected main worktree/branch. ' +
  'Mutations require a dedicated feature worktree and branch.';

function loadRegister(filePath, preferredBranch, rootDir) {
  try {
    return require('../ai-dashboard/register-adapter').loadRegister(
      filePath,
      preferredBranch,
      rootDir
    );
  } catch (err) {
    if (
      err &&
      err.code === 'MODULE_NOT_FOUND' &&
      String(err.message || '').includes('../ai-dashboard/register-adapter')
    ) {
      return {
        health: {
          name: 'register',
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          latencyMs: 0,
          provenance: filePath,
          impact: 'Register adapter is unavailable in this copied tool surface',
          error: err.message,
        },
        data: { items: [] },
      };
    }
    throw err;
  }
}

function pick(args, kebab, camel) {
  return args[kebab] === undefined ? args[camel] : args[kebab];
}

function sha256(buffer) {
  return require('crypto').createHash('sha256').update(buffer).digest('hex');
}

/**
 * Whether this checkout is the protected integration worktree.
 *
 * Two independent signals, because either alone has a blind spot: a feature
 * branch checked out inside the integration directory is still the shared
 * workspace, and the main branch is protected wherever it is checked out.
 */
function isProtectedCheckout(rootDir, branch) {
  // currentBranch may answer with a fully qualified ref depending on how the
  // checkout was made; comparing the raw string would let refs/heads/main slip
  // past a guard that is looking for main.
  const named = String(branch || '')
    .trim()
    .replace(/^refs\/heads\//, '');
  if (PROTECTED_BRANCHES.has(named)) return true;
  const base = path.basename(path.resolve(rootDir));
  return base === PROTECTED_WORKTREE;
}

function readJsonOrExit(file, label) {
  const fs = require('fs');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Không đọc được ' + label + ': ' + file + ' (' + e.message + ')');
    process.exit(1);
  }
  return null;
}

/**
 * Restore a register to the exact bytes an audit artifact recorded.
 *
 * The pre-hash is verified after the restore rather than trusted from the
 * artifact, so a corrupted or hand-edited audit file fails loudly instead of
 * writing some other content and calling it a rollback.
 */
function revertCommand(auditFile) {
  const fs = require('fs');
  const audit = readJsonOrExit(auditFile, 'audit artifact');
  const target = audit.register_path;
  if (!target || !audit.pre_content_base64 || !audit.pre_hash_sha256) {
    console.error('Audit artifact thiếu register_path, pre_content_base64 hoặc pre_hash_sha256.');
    process.exit(1);
  }

  if (!fs.existsSync(target)) {
    console.error('Không tìm thấy register để rollback: ' + target);
    process.exit(1);
  }

  // The register must still be where this audit left it. If something changed
  // it since, restoring the pre-write bytes would throw that change away, and
  // an operator asking to undo one run does not mean "discard everything after
  // it" — so this refuses and lets them look rather than deciding for them.
  const currentHash = sha256(fs.readFileSync(target));
  if (audit.post_hash_sha256 && currentHash !== audit.post_hash_sha256) {
    console.error(
      'Rollback refused: register is at ' +
        currentHash.slice(0, 12) +
        ', not the ' +
        String(audit.post_hash_sha256).slice(0, 12) +
        ' this audit wrote. Something changed it since.'
    );
    process.exit(1);
  }

  const restored = Buffer.from(audit.pre_content_base64, 'base64');
  const actual = sha256(restored);
  if (actual !== audit.pre_hash_sha256) {
    console.error(
      'Rollback refused: audit pre_content does not hash to pre_hash_sha256 (' +
        actual.slice(0, 12) +
        ' != ' +
        String(audit.pre_hash_sha256).slice(0, 12) +
        ').'
    );
    process.exit(1);
  }

  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, restored);
  atomicRenameSync(tmp, target);
  console.log('  Reverted ' + target + ' to pre_hash_sha256 ' + audit.pre_hash_sha256.slice(0, 12));
  process.exit(0);
}

function reconcileCommand(args) {
  const fs = require('fs');

  for (const key of Object.keys(args)) {
    if (key === '_') continue;
    if (!RECONCILE_FLAGS.has(key) && !RECONCILE_VALUES.has(key)) {
      console.error('Tuỳ chọn không nhận ra: --' + key);
      process.exit(1);
    }
  }

  const revert = pick(args, 'revert', 'revert');
  if (revert && revert !== true) revertCommand(revert);

  const rootDir = args.root || process.cwd();
  const registerArg = pick(args, 'register', 'register') || args.csv;
  const csvPath = registerArg
    ? path.resolve(rootDir, registerArg)
    : path.join(
        rootDir,
        'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
      );

  const write = args.write === true;
  const dryRun = pick(args, 'dry-run', 'dryRun') === true;
  const allowFixture = pick(args, 'allow-fixture-write', 'allowFixtureWrite') === true;

  // The guard runs before anything is read, so a refused run cannot have
  // touched the register even transiently.
  //
  // --allow-fixture-write is not a way past this. It only exempts a register
  // that actually lives under the test tree, so passing the flag while aimed
  // at the real register still refuses: the flag says "this target is a
  // fixture", and whether that is true is decided by the path, not the caller.
  const fixtureTarget = allowFixture && allowFixtureWriteFor(csvPath);
  if (write && isProtectedCheckout(rootDir, currentBranch(rootDir)) && !fixtureTarget) {
    console.error(REFUSAL_PROTECTED);
    process.exit(1);
  }

  const register = loadRegister(csvPath, null, rootDir);
  if (register.health.status !== 'live') {
    console.error('Không đọc được register: ' + (register.health.impact || register.health.status));
    process.exit(2);
  }

  const mainRef = args.main || 'origin/main';
  const result = reconcileRegister(register.data.items, { cwd: rootDir, mainRef });

  if (!write && !dryRun) {
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printReport(result, Boolean(args.all));
    const failed = args.strict ? result.summary.error + result.summary.warn : result.summary.error;
    if (failed > 0) process.exit(1);
    return;
  }

  // Fail-closed: an overstatement means the register already claims more than
  // the repository can prove, and reconciling on top of that would bless the
  // claim rather than surface it.
  if (result.summary.error > 0) {
    printReport(result, Boolean(args.all));
    console.error(
      'Write-back refused: register has ' + result.summary.error + ' error finding(s).'
    );
    process.exit(1);
  }

  const evidenceFile = pick(args, 'merge-evidence', 'mergeEvidence');
  const evidence =
    evidenceFile && evidenceFile !== true
      ? readJsonOrExit(path.resolve(rootDir, evidenceFile), 'merge evidence')
      : null;

  const plan = planReconciliation(register.data.items, {
    cwd: rootDir,
    mainRef,
    mergeEvidence: evidence,
  });

  for (const r of plan.refusals) {
    console.log('  Refused MERGED for ' + r.workItemId + ': ' + r.reason);
  }

  const before = fs.readFileSync(csvPath);
  const preHash = sha256(before);
  const applied = applyStatusMutations(before.toString('utf8'), plan.mutations);

  for (const m of plan.mutations) {
    console.log('  Reconciled ' + m.workItemId + ': ' + m.from + ' -> ' + m.to);
  }

  if (dryRun) {
    console.log('  Dry run: ' + plan.mutations.length + ' mutation(s) planned, nothing written.');
    process.exit(0);
  }

  // The plan and the write must agree. If a row named in the plan no longer
  // matches - the register moved between planning and applying, or an id stopped
  // resolving - then part of the decision silently did not happen, and reporting
  // the smaller number as success would record a reconciliation that was never
  // performed. Refuse before writing anything.
  if (applied.applied !== plan.mutations.length) {
    console.error(
      'Write-back refused: planned ' +
        plan.mutations.length +
        ' mutation(s) but ' +
        applied.applied +
        ' matched a row. The register changed between planning and applying.'
    );
    process.exit(1);
  }

  if (applied.applied === 0) {
    console.log('  Register unchanged: 0 mutations applied');
    writeAudit(args, rootDir, csvPath, preHash, preHash, before, plan, mainRef);
    process.exit(0);
  }

  const next = Buffer.from(applied.text, 'utf8');
  const tmp = csvPath + '.tmp';
  fs.writeFileSync(tmp, next);
  atomicRenameSync(tmp, csvPath);
  const postHash = sha256(next);

  console.log('  Register updated: ' + applied.applied + ' mutation(s) applied');
  writeAudit(args, rootDir, csvPath, preHash, postHash, before, plan, mainRef);
  process.exit(0);
}

/**
 * The durable record of what a run did, written on every --write including the
 * ones that changed nothing.
 *
 * A no-op run still produces an artifact because "the reconciler ran and found
 * nothing to do" and "the reconciler never ran" are different facts, and only
 * one of them is evidence.
 */
function allowFixtureWriteFor(csvPath) {
  return /[\/]tools[\/]ai-brain[\/]test[\/]/.test(csvPath);
}

function writeAudit(args, rootDir, csvPath, preHash, postHash, beforeBuffer, plan, mainRef) {
  const fs = require('fs');
  const out = pick(args, 'audit-out', 'auditOut');
  const stamp = 'reconcile-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  // A fixture run keeps its audit beside the fixture it wrote. Sending test
  // artifacts to the repository audit directory would leave the durable record
  // of real reconciliations interleaved with throwaway ones, and the directory
  // is meant to be readable as a history of what actually happened.
  const auditPath =
    out && out !== true
      ? path.resolve(rootDir, out)
      : allowFixtureWriteFor(csvPath)
        ? path.join(path.dirname(csvPath), stamp)
        : path.join(rootDir, 'docs/product-spec/docs/10-ai-collaboration/audit', stamp);

  const artifact = {
    run_id: require('crypto').randomUUID(),
    generated_at: new Date().toISOString(),
    operator_session: process.env.AO_SESSION_ID || process.env.USERNAME || '(unknown)',
    head_commit: headSha('HEAD', rootDir) || '(unknown)',
    main_ref: mainRef,
    register_path: csvPath,
    pre_hash_sha256: preHash,
    post_hash_sha256: postHash,
    pre_content_base64: beforeBuffer.toString('base64'),
    mutations: plan.mutations,
    refusals: plan.refusals,
  };

  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, JSON.stringify(artifact, null, 2));
  console.log('  Audit artifact: ' + auditPath);
}

function printReport(result, showInfo) {
  console.log('');
  console.log(
    '  Đã đối chiếu ' + result.checked + ' đầu mục với những gì repository chứng minh được.'
  );
  console.log('');

  const shown = result.findings.filter((f) => showInfo || f.severity !== 'info');
  if (shown.length === 0) {
    console.log('  Không có khác biệt nào đáng báo.');
  } else {
    // Group by code: 136 identical findings read as one problem, not 136.
    const groups = new Map();
    for (const f of shown) {
      if (!groups.has(f.code)) groups.set(f.code, []);
      groups.get(f.code).push(f);
    }
    const order = { error: 0, warn: 1, info: 2 };
    const sorted = [...groups.entries()].sort(
      (a, b) => order[a[1][0].severity] - order[b[1][0].severity]
    );

    for (const [code, list] of sorted) {
      const head = list[0];
      console.log('  [' + SEVERITY_LABEL[head.severity] + '] ' + code + '  (' + list.length + ')');
      console.log('         ' + head.message);
      for (const f of list.slice(0, 5)) {
        console.log('           - ' + f.workItemId + ' (' + f.status + ')');
      }
      if (list.length > 5) console.log('           … và ' + (list.length - 5) + ' đầu mục nữa');
      console.log('');
    }
  }

  console.log(
    '  Tổng: ' +
      result.summary.error +
      ' lỗi, ' +
      result.summary.warn +
      ' cảnh báo, ' +
      result.summary.info +
      ' ghi chú' +
      (showInfo ? '' : ' (dùng --all để xem ghi chú)')
  );
  console.log(
    '  Register ' +
      (result.trustworthy
        ? 'không khai quá thực tế.'
        : 'ĐANG KHAI QUÁ THỰC TẾ — có đầu mục trông như đã xong nhưng không chứng minh được.')
  );
  console.log('');
}

function manifestCommand(args) {
  const rootDir = args.root || process.cwd();
  const manifest = require(path.join(rootDir, 'tools/ecosystem-manifest.json'));
  const result = auditManifest(manifest, { rootDir });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('');
    console.log(
      '  ' +
        result.total +
        ' repo khai trong manifest · kiểm được ' +
        result.checkable +
        ' · có ' +
        result.present +
        ' · thiếu ' +
        result.absent +
        ' · nạp khi dùng ' +
        result.onDemand
    );
    console.log('');
    const order = { error: 0, warn: 1, info: 2 };
    const groups = new Map();
    for (const f of result.findings) {
      if (!args.all && f.severity === 'info') continue;
      if (!groups.has(f.code)) groups.set(f.code, []);
      groups.get(f.code).push(f);
    }
    const sorted = [...groups.entries()].sort(
      (a, b) => order[a[1][0].severity] - order[b[1][0].severity]
    );
    for (const [code, list] of sorted) {
      console.log(
        '  [' + SEVERITY_LABEL[list[0].severity] + '] ' + code + '  (' + list.length + ')'
      );
      console.log('         ' + list[0].message);
      for (const f of list.slice(0, 8)) console.log('           - ' + f.id);
      if (list.length > 8) console.log('           … và ' + (list.length - 8) + ' mục nữa');
      console.log('');
    }
    console.log(
      '  Tổng: ' +
        result.summary.error +
        ' lỗi, ' +
        result.summary.warn +
        ' cảnh báo, ' +
        result.summary.info +
        ' ghi chú'
    );
    console.log(
      '  Manifest ' +
        (result.trustworthy
          ? 'khớp thực tế ở những chỗ kiểm được.'
          : 'KHAI QUÁ THỰC TẾ — có công cụ được tin là đang chạy nhưng không tồn tại.')
    );
    console.log('');
  }

  const failed = args.strict ? result.summary.error + result.summary.warn : result.summary.error;
  if (failed > 0) process.exit(1);
}

function proveCommand(args) {
  const commands = [];
  const raw = args.tests;
  if (typeof raw === 'string') commands.push(raw);
  for (const extra of args._.slice(1)) commands.push(extra);

  if (commands.length === 0) {
    console.error('Không có lệnh nào để chạy. Dùng --tests "<lệnh>".');
    process.exit(2);
  }

  console.log('');
  console.log('  Nhánh: ' + (currentBranch() || '(không rõ)'));
  console.log('  HEAD : ' + (headSha('HEAD') || '(không rõ)'));
  console.log('');

  let allPassed = true;
  for (const command of commands) {
    const parts = command.split(/\s+/).filter(Boolean);
    const result = runCheck(parts[0], parts.slice(1), { cwd: process.cwd() });
    allPassed = allPassed && result.passed;
    console.log(
      '  ' +
        (result.passed ? 'ĐẠT ' : 'HỎNG') +
        '  ' +
        command +
        '  (' +
        result.durationMs +
        'ms, mã thoát ' +
        result.exitCode +
        ')'
    );
    if (!result.passed && result.tail) {
      for (const line of result.tail.split('\n')) console.log('          ' + line);
    }
  }

  console.log('');
  console.log(
    allPassed
      ? '  Mọi kiểm tra đều chạy thật và đều đạt.'
      : '  CÓ KIỂM TRA HỎNG — đừng ghi nhận đầu mục này là đã xong.'
  );
  console.log('');
  if (!allPassed) process.exit(1);
}

/**
 * Reads each account's quota from the provider and caches it.
 *
 * Slow by nature — one CLI round trip per account — so it is a command the
 * operator or a schedule runs, never something the dashboard does while
 * someone waits for a page.
 */
function quotaCommand(args) {
  const { refreshAll } = require('./refresh-quota');
  const { readIdentity } = require('./agy-identity');
  const { listAccounts } = require('./accounts');
  const { usableReadings, storePath } = require('./quota-store');
  const os = require('os');

  const home =
    args.home ||
    (process.platform === 'win32'
      ? process.env.USERPROFILE || process.env.HOME || os.homedir()
      : process.env.HOME || process.env.USERPROFILE || os.homedir());
  const poolTimeout = args['pool-timeout'] || args['timeout-ms'] || args.timeout;
  const runtimeOpts = {
    home,
    fakeRunsDir: args['pool-runtime-dir'] || args['agy-runs-dir'],
    adapterScript: args['pool-adapter-script'],
    ...(poolTimeout
      ? {
          timeoutMs: Math.max(1, Number(poolTimeout)),
          adapterTimeoutMs: Math.max(1, Number(poolTimeout)),
        }
      : {}),
  };
  const identity = readIdentity({ home });
  const accounts = listAccounts() || [];

  if (args.show) {
    const { reported, problems } = usableReadings(identity, runtimeOpts);
    if (args.json) return console.log(JSON.stringify({ identity, reported, problems }, null, 2));
    console.log('');
    console.log('  Số liệu quota đang dùng được — ' + storePath(runtimeOpts));
    console.log('');
    for (const [id, q] of Object.entries(reported)) {
      for (const row of q.rows) {
        console.log(
          '  ' +
            id.padEnd(14) +
            row.family.padEnd(12) +
            row.window.padEnd(10) +
            (row.disabled
              ? 'đã tắt'
              : row.remainingPercent === null ||
                  row.remainingPercent === undefined ||
                  row.remainingPercent === 'UNKNOWN' ||
                  row.known === false
                ? 'UNKNOWN'
                : row.remainingPercent + '%')
        );
      }
    }
    for (const [id, p] of Object.entries(problems)) {
      console.log('  ' + id.padEnd(14) + 'KHÔNG DÙNG ĐƯỢC — ' + p.reason);
    }
    console.log('');
    return;
  }

  if (args.json) {
    const results = refreshAll(
      accounts,
      Object.assign({ identity, discoverPool: true }, runtimeOpts)
    );
    return console.log(JSON.stringify({ identity, results }, null, 2));
  }

  console.log('');
  console.log(
    identity.known
      ? '  Account đang đăng nhập: ' + identity.email
      : '  Không xác định được account đang đăng nhập: ' + identity.reason
  );
  console.log('');
  const onProgress = (r) => {
    if (r.skipped) console.log('  BỎ QUA  ' + r.accountId + ' — ' + r.reason);
    else if (r.ok) console.log('  ĐỌC ĐƯỢC ' + r.accountId + ' — ' + r.rows + ' dòng');
    else console.log('  HỎNG    ' + r.accountId + ' — ' + r.reason);
  };
  refreshAll(accounts, Object.assign({ identity, discoverPool: true, onProgress }, runtimeOpts));
  console.log('');
}

function resolveModelContextMeta(modelId, gateway, ...args) {
  if (!modelId || !gateway) return null;
  let registry = null;
  for (const arg of args) {
    if (arg && Array.isArray(arg.sources)) {
      registry = arg;
      break;
    }
  }
  const sources = (registry && registry.sources) || [];
  const src = sources.find((s) => s && s.id === gateway);
  if (!src || !src.modelMeta) return null;
  const m = src.modelMeta[modelId];
  if (!m || typeof m !== 'object') return null;
  const cw = toPositiveInteger(m.contextWindow);
  if (cw === undefined) return null;
  return {
    ...m,
    contextWindow: cw,
    maxOutputTokens: toPositiveInteger(m.maxOutputTokens),
  };
}

function assembleCandidates(
  discoveryCat,
  offerings,
  registry,
  accounts,
  injectedCandidates,
  gatewayCandidates
) {
  if (Array.isArray(injectedCandidates)) {
    return injectedCandidates.map((c) => Object.assign({}, c));
  }

  const candidatesApi = require('./candidates');
  const sourcesApi = require('./sources');

  const offeringMap = new Map();
  for (const off of offerings || []) {
    const k1 = `${off.accountId || '*'}::${off.model}`;
    offeringMap.set(k1, off);
    if (!offeringMap.has(off.model)) {
      offeringMap.set(off.model, off);
    }
  }

  const result = [];
  const seenKeys = new Set();

  // 1. Discovery candidates
  const discCands = (discoveryCat && discoveryCat.candidates) || [];
  const sourceList = Array.isArray(registry)
    ? registry
    : registry && Array.isArray(registry.sources)
      ? registry.sources
      : [];
  const sourceMap = new Map(sourceList.map((s) => [s && s.id, s]));

  for (const dc of discCands) {
    let accountId = dc.accountId || dc.account || '*';
    let credentialEnvMissing = false;
    let blocked = dc.blocked;
    let blockReason = dc.blockReason;
    let blockScope = dc.blockScope;

    if (accountId === '*') {
      const sourceId =
        (dc.sourceIds && dc.sourceIds.find((id) => sourceMap.has(id))) ||
        (sourceMap.has(dc.accessPath) && dc.accessPath) ||
        (sourceMap.has(dc.upstream) && dc.upstream) ||
        (sourceMap.has(dc.gateway) && dc.gateway) ||
        (sourceMap.has(dc.source) && dc.source);
      const source = sourceId ? sourceMap.get(sourceId) : null;
      if (
        source &&
        source.kind !== 'router' &&
        source.credential &&
        source.credential.type === 'api-key' &&
        source.credential.env
      ) {
        const envName = source.credential.env;
        const envVal = process.env[envName];
        const hasKey = Boolean(envVal && String(envVal).trim().length > 0);
        const accId = candidatesApi.deriveCredentialAccountId
          ? candidatesApi.deriveCredentialAccountId(source)
          : `${source.id}-${envName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        if (hasKey) {
          accountId = accId;
        } else {
          credentialEnvMissing = true;
          blocked = true;
          blockReason = 'CREDENTIAL_ENV_MISSING';
          blockScope = 'credential';
        }
      }
    }

    const modelId = dc.modelId || dc.model;
    const c = {
      ...dc,
      accountId,
      quotaScope: dc.quotaScope || (accountId !== '*' ? accountId : dc.upstream || ''),
      modelId,
      ...(credentialEnvMissing ? { credentialEnvMissing: true } : {}),
      ...(blocked ? { blocked: true, blockReason, blockScope } : {}),
    };
    const off = offeringMap.get(`${accountId}::${modelId}`) || offeringMap.get(modelId);
    if (off) {
      if (c.qualifiedRoles === undefined && off.qualifiedRoles !== undefined) {
        c.qualifiedRoles = off.qualifiedRoles;
      }
      if (c.cost === undefined && off.cost !== undefined) c.cost = off.cost;
      if (c.tier === undefined && off.tier !== undefined) c.tier = off.tier;
      if (c.quality === undefined && off.quality !== undefined) c.quality = off.quality;
      if (c.capabilities === undefined && off.capabilities !== undefined) {
        c.capabilities = off.capabilities;
      }
    }
    if (
      (!c.capabilities || Object.keys(c.capabilities).length === 0) &&
      accountId &&
      accountId !== '*'
    ) {
      const acc = (accounts || []).find((a) => a && a.id === accountId);
      if (acc && acc.capabilities) {
        c.capabilityDeclarations = { ...acc.capabilities };
        c.capabilities = { ...c.capabilities };
      }
      if (c.cost === undefined && acc && acc.cost !== undefined) {
        c.cost = acc.cost;
      }
    }
    if (c.contextWindow !== undefined) {
      c.contextWindow = toPositiveInteger(c.contextWindow);
      if (c.capabilities && c.contextWindow !== undefined) {
        c.capabilities = Object.assign({}, c.capabilities, { contextWindow: c.contextWindow });
      } else if (c.capabilities) {
        delete c.capabilities.contextWindow;
      }
    } else if (dc.contextWindow !== undefined) {
      c.contextWindow = toPositiveInteger(dc.contextWindow);
      if (c.capabilities && c.contextWindow !== undefined) {
        c.capabilities = Object.assign({}, c.capabilities, { contextWindow: c.contextWindow });
      } else if (c.capabilities) {
        delete c.capabilities.contextWindow;
      }
    }
    if (c.contextWindow === undefined) {
      const routingSourceId = c.sourceId || c.source || c.gateway || c.provider;
      const m = candidatesApi.resolveCandidateContextMeta
        ? candidatesApi.resolveCandidateContextMeta(c, registry)
        : resolveModelContextMeta(modelId, routingSourceId, registry);
      if (m && m.contextWindow !== undefined) {
        c.contextWindow = m.contextWindow;
        if (c.capabilities) {
          c.capabilities = Object.assign({}, c.capabilities, {
            contextWindow: m.contextWindow,
          });
        } else {
          c.capabilities = { contextWindow: m.contextWindow };
        }
        if (m.maxOutputTokens !== undefined && c.maxOutputTokens === undefined) {
          c.maxOutputTokens = m.maxOutputTokens;
        }
        if (m.contextSource && !c.contextSource) {
          c.contextSource = m.contextSource;
        }
      }
    }
    const key = candidatesApi.candidateKey(c);
    c.key = key;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(c);
    }
  }

  // 2. Offerings candidates, then the gateway-advertised candidates for each
  // concrete account. The advertised ones come last so an operator's declared
  // entry for the same seven-part key wins: it carries the declared grades and
  // limits, and the advertised row only proves the route exists.
  const advertised = gatewayCandidates || [];
  for (const off of advertised) {
    if (off && off.contextWindow === undefined) {
      const routingSourceId = off.sourceId || off.source || off.gateway || off.provider;
      const m = candidatesApi.resolveCandidateContextMeta
        ? candidatesApi.resolveCandidateContextMeta(off, registry)
        : resolveModelContextMeta(off.modelId, routingSourceId, registry);
      if (m && m.contextWindow !== undefined) {
        off.contextWindow = m.contextWindow;
        if (off.capabilities) {
          off.capabilities = Object.assign({}, off.capabilities, {
            contextWindow: m.contextWindow,
          });
        } else {
          off.capabilities = { contextWindow: m.contextWindow };
        }
      }
    } else if (off && off.contextWindow !== undefined) {
      off.contextWindow = toPositiveInteger(off.contextWindow);
      if (off.capabilities && off.contextWindow !== undefined) {
        off.capabilities = Object.assign({}, off.capabilities, {
          contextWindow: off.contextWindow,
        });
      } else if (off.capabilities) {
        delete off.capabilities.contextWindow;
      }
    }
    const key = candidatesApi.candidateKey(off);
    const c = Object.assign({}, off, { key });
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(c);
    }
  }

  for (const off of offerings || []) {
    const route = sourcesApi.dispatchRoute(off.provider, registry);
    const source =
      registry &&
      registry.sources &&
      registry.sources.find((s) => s.id === off.provider || s.id === off.accountId);
    const harness =
      off.harness || (route && route.harness) || (source && source.harness) || 'paseo';
    let accessPath =
      off.accessPath || (source ? candidatesApi.accessPathOf(source, registry) : null);
    if (!accessPath && typeof off.accountId === 'string') {
      const parts = off.accountId.split('::');
      if (parts.length >= 7) accessPath = parts[1];
    }
    if (!accessPath) accessPath = 'cli';
    // The gateway is derived from the registry, never from a name written here.
    // An offering whose provider is a gateway IS that gateway; one whose
    // provider declares a `reachedVia` rides it. When the registry says neither,
    // the gateway is genuinely unknown — and an unknown gateway is recorded as
    // empty, because a guess produces a key that can never match recorded
    // evidence while looking exactly like one that can.
    const gateway =
      off.gateway ||
      (source && source.reachedVia) ||
      (source && source.kind === sourcesApi.Kind.ROUTER ? source.id : '');
    const parsed = candidatesApi.parsePrefix(off.model);
    const upstream =
      off.upstream || (parsed && parsed.upstream) || off.provider || (source && source.id) || '';
    const accountId = off.accountId || '*';
    const quotaScope = off.quotaScope || (accountId !== '*' ? accountId : upstream);
    const modelId = off.model;

    const c = {
      harness,
      accessPath,
      gateway,
      upstream,
      accountId,
      quotaScope,
      modelId,
      qualifiedRoles: off.qualifiedRoles,
      cost: off.cost,
      capabilities: off.capabilities,
      tier: off.tier,
      quality: off.quality,
      source: off.provider,
    };
    if (c.contextWindow === undefined) {
      const routingSourceId = gateway || off.provider || off.source;
      const m = candidatesApi.resolveCandidateContextMeta
        ? candidatesApi.resolveCandidateContextMeta(c, registry)
        : resolveModelContextMeta(off.model, routingSourceId, registry);
      if (m && m.contextWindow !== undefined) {
        c.contextWindow = m.contextWindow;
        if (c.capabilities) {
          c.capabilities = Object.assign({}, c.capabilities, {
            contextWindow: m.contextWindow,
          });
        } else {
          c.capabilities = { contextWindow: m.contextWindow };
        }
      }
    } else {
      c.contextWindow = toPositiveInteger(c.contextWindow);
      if (c.capabilities && c.contextWindow !== undefined) {
        c.capabilities = Object.assign({}, c.capabilities, { contextWindow: c.contextWindow });
      } else if (c.capabilities) {
        delete c.capabilities.contextWindow;
      }
    }
    const key = candidatesApi.candidateKey(c);
    c.key = key;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(c);
    }
  }

  return candidatesApi.markCapabilityDeclarations(result);
}

/**
 * The whole candidate set for one dispatch: the discovery catalogue, the
 * offerings, and the models each concrete gateway account can actually reach.
 *
 * The third part is what makes recorded evidence usable. An outcome recorded
 * against `paseo::cli::9router::ag::ninerouter::ninerouter::ag/gemini-3.1-pro-low`
 * can only ever match a candidate with that exact seven-part identity, and the
 * only thing that can mint one is the account whose route reaches the gateway
 * that advertises `ag/…`. Without this, a source that did real work tonight was
 * invisible to the Controller until an operator typed its model name into an
 * account file by hand.
 *
 * Both dispatch paths — the item path and the profile path — assemble here, so
 * a candidate is the same kind of object with the same seven-part identity
 * whichever way it was requested. An injected candidate list still wins: a
 * caller that supplies its own candidates is testing or replaying them, not
 * asking what the machine actually serves.
 */
function mergeEvidenceAccounts(inputAccounts, registryAccounts) {
  const input = Array.isArray(inputAccounts) ? inputAccounts : [];
  const registry = Array.isArray(registryAccounts) ? registryAccounts : [];
  if (registry.length === 0) return input;
  const map = new Map();
  const noId = [];
  const hasCaps = (a) => Boolean(a && a.capabilities && Object.keys(a.capabilities).length > 0);

  for (const acc of input) {
    if (!acc || typeof acc !== 'object') continue;
    if (!acc.id) {
      noId.push(acc);
      continue;
    }
    map.set(acc.id, Object.assign({}, acc));
  }
  for (const reg of registry) {
    if (!reg || typeof reg !== 'object' || !reg.id) continue;
    if (map.has(reg.id)) {
      const existing = map.get(reg.id);
      if (!hasCaps(existing) && hasCaps(reg)) {
        map.set(reg.id, Object.assign({}, reg, existing, { capabilities: reg.capabilities }));
      }
    } else {
      map.set(reg.id, Object.assign({}, reg));
    }
  }
  return [...Array.from(map.values()), ...noId];
}

function isCandidateRouteEligible(routeHealth, candidate, options, routeHealthApi, isExplicit) {
  if (
    candidate &&
    (candidate.credentialEnvMissing === true ||
      (candidate.blocked && candidate.blockReason === 'CREDENTIAL_ENV_MISSING'))
  ) {
    return false;
  }
  if (options && options.allowUnprobedCandidates === true) return true;
  if (!routeHealth) return true;
  const modelId = candidate && candidate.modelId;
  const gateway =
    candidate &&
    (candidate.gateway ||
      (options && options.harness === 'hermes' && (candidate.sourceId || candidate.source)));
  if (!modelId || !gateway) return Boolean(modelId);
  const isWildcard = !candidate.accountId || candidate.accountId === '*';
  const routePath = isWildcard ? gateway : { id: gateway, accountId: candidate.accountId };
  const rec = routeHealthApi.getPathRecord(routeHealth, modelId, routePath);
  if (rec) return rec.status === 'AVAILABLE';
  // Admission for a ranked live probe is not proof that the route is alive.
  // Known failures above still fail closed; only a missing record may pass.
  if (options && options.allowMissingRouteHealth === true) return true;
  const explicit =
    isExplicit !== undefined ? isExplicit : Boolean(options && options.routeHealth !== undefined);
  if (
    explicit ||
    (options && options.requireRouteHealth === true) ||
    Object.keys(routeHealth.paths || {}).length > 0
  ) {
    return Boolean(options && options.probeEvidence && options.probeEvidence(modelId, routePath));
  }
  return true;
}

/**
 * Assemble candidates for a live dispatch run.
 *
 * Combines candidates generated from catalogue, openCodeIds, and accounts, with
 * gateway-derived and pool-derived candidates. Merges evidence-only candidates
 * so models seen in evidence history participate in selection.
 *
 * If `options.candidates` is provided, that array is returned directly: a
 * caller that supplies its own candidates is testing or replaying them, not
 * asking what the machine actually serves.
 */
function assembleForDispatch(discoveryCat, accounts, registry, options) {
  const candidatesApi = require('./candidates');
  const { expandOfferings } = require('./offerings');
  const opts = options || {};

  const resolvedRegistry = registry || require('./sources').loadSources();
  const routeHealthApi = require('./route-health');
  const routeHealthExplicit = opts.routeHealth !== undefined;
  const requireRouteHealth = opts.requireRouteHealth === true || !Array.isArray(opts.candidates);
  const healthFile =
    opts.routeHealthFile ||
    opts['route-health'] ||
    (opts.root
      ? path.join(opts.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
      : null) ||
    path.join(__dirname, 'data', 'model-route-health.json');
  const routeHealth = routeHealthExplicit
    ? opts.routeHealth
    : routeHealthApi.loadStore(healthFile, {
        allowMissing: true,
      });
  const enforceMissingHealth =
    opts.allowUnprobedCandidates === true
      ? false
      : routeHealthExplicit ||
        requireRouteHealth ||
        Boolean(routeHealth && Object.keys(routeHealth.paths || {}).length > 0);
  const enforceEmptyHealth = routeHealthExplicit || requireRouteHealth;
  const rawCatalogueRows = (discoveryCat && discoveryCat.candidates) || [];
  const catalogueRows = rawCatalogueRows.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const row = Object.assign({}, raw);
    if (raw.capabilities && typeof raw.capabilities === 'object') {
      row.capabilities = Object.assign({}, raw.capabilities);
    }
    if (row.contextWindow === undefined) {
      const routingSourceId = row.sourceId || row.source || row.gateway || row.provider;
      const m = candidatesApi.resolveCandidateContextMeta
        ? candidatesApi.resolveCandidateContextMeta(row, resolvedRegistry)
        : resolveModelContextMeta(row.modelId || row.model, routingSourceId, resolvedRegistry);
      if (m && m.contextWindow !== undefined) {
        row.contextWindow = m.contextWindow;
        if (row.capabilities) {
          row.capabilities = Object.assign({}, row.capabilities, {
            contextWindow: m.contextWindow,
          });
        } else {
          row.capabilities = { contextWindow: m.contextWindow };
        }
        if (m.maxOutputTokens !== undefined && row.maxOutputTokens === undefined) {
          row.maxOutputTokens = m.maxOutputTokens;
        }
        if (m.contextSource && !row.contextSource) {
          row.contextSource = m.contextSource;
        }
      }
    } else {
      const valid = toPositiveInteger(row.contextWindow);
      row.contextWindow = valid;
      if (row.capabilities) {
        if (valid !== undefined) {
          row.capabilities = Object.assign({}, row.capabilities, { contextWindow: valid });
        } else {
          delete row.capabilities.contextWindow;
        }
      }
    }
    return row;
  });
  const resolvedFallbackRoutes = [];
  const probeRoute =
    opts.probeRoute ||
    ((modelId, routeId, probeOptions) =>
      routeHealthApi.probeGatewayModel(
        modelId,
        routeId,
        Object.assign({ registry }, probeOptions)
      ));
  const refresh =
    opts.refreshRoutes === true
      ? routeHealthApi.recheckBeforeSelection(routeHealth, probeRoute, {
          registry: resolvedRegistry,
          accounts: accounts || [],
          catalogue: (discoveryCat && discoveryCat.candidates) || [],
          now: opts.now,
          cap: opts.probeCap,
          timeoutMs: opts.probeTimeoutMs,
          probeEvidence: opts.probeEvidence,
          allowUnprobed: true,
        })
      : null;
  const fallbackAlreadyRefreshed = opts.refreshRoutes === true;
  const refreshedHealth = routeHealth;
  const persistHealth = () => {
    if (refresh) {
      return Promise.resolve(refresh).then((result) => {
        return resolveFallbackRoutes(
          routeHealth,
          catalogueRows,
          probeRoute,
          routeHealthApi,
          Object.assign({}, opts, {
            registry: resolvedRegistry,
            accounts: accounts || [],
            checkedBeforeFallback: Number((result && result.checked) || 0),
            preResolvedFallback: fallbackAlreadyRefreshed,
            resolvedRoutes: resolvedFallbackRoutes,
          })
        ).then(() => {
          if (opts.onRouteRefresh) opts.onRouteRefresh(result);
          if (opts.persistRouteHealth !== false) routeHealthApi.saveStore(healthFile, routeHealth);
          return routeHealth;
        });
      });
    }
    return Promise.resolve(refreshedHealth);
  };

  if (Array.isArray(opts.candidates)) {
    const buildExplicit = () => {
      const explicitCandidates = assembleCandidates(
        discoveryCat,
        [],
        resolvedRegistry,
        accounts,
        opts.candidates
      );
      const eligible = [];
      const excludedRoutes = [];
      const seenExcluded = new Set();
      for (const candidate of explicitCandidates) {
        let isEligible = true;
        if (routeHealth) {
          const modelId = candidate && candidate.modelId;
          const gateway = candidate && candidate.gateway;
          if (modelId && gateway) {
            const routePath = candidate.accountId
              ? { id: gateway, accountId: candidate.accountId }
              : gateway;
            const rec = routeHealthApi.getPathRecord(routeHealth, modelId, routePath);
            if (rec) {
              isEligible = rec.status === 'AVAILABLE';
            } else if (enforceEmptyHealth) {
              isEligible = Boolean(opts.probeEvidence && opts.probeEvidence(modelId, routePath));
            }
          }
        }
        if (isEligible) {
          eligible.push(candidate);
        } else {
          const key = candidatesApi.candidateKey(candidate);
          if (!seenExcluded.has(key)) {
            seenExcluded.add(key);
            const modelId = candidate && candidate.modelId;
            const gateway = candidate && candidate.gateway;
            const routePath =
              candidate && candidate.accountId
                ? { id: gateway, accountId: candidate.accountId }
                : gateway;
            const rec =
              routeHealth && modelId && gateway
                ? routeHealthApi.getPathRecord(routeHealth, modelId, routePath)
                : null;
            const reason = rec ? rec.status || 'ROUTE_UNAVAILABLE' : 'ROUTE_PROBE_UNPROVEN';
            excludedRoutes.push({
              offeringId: key,
              candidateKey: key,
              reason,
              reasonCode: String(reason).split(':')[0],
              scope: 'route',
            });
          }
        }
      }
      Object.defineProperty(eligible, 'excludedRoutes', {
        value: excludedRoutes,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      if (opts && Array.isArray(opts.excludedRoutes)) {
        opts.excludedRoutes.push(...excludedRoutes);
      }
      return eligible;
    };
    if (!refresh) return buildExplicit();
    return Promise.resolve(persistHealth()).then(buildExplicit);
  }

  let offs = opts.offerings;
  if (!offs) {
    try {
      offs = expandOfferings(accounts);
    } catch {
      offs = [];
    }
  }

  const registryAccounts = Array.isArray(opts.registryAccounts)
    ? opts.registryAccounts
    : typeof opts.listAccounts === 'function'
      ? opts.listAccounts()
      : require('./accounts').listAccounts();
  const evidenceAccounts = mergeEvidenceAccounts(accounts, registryAccounts);

  const buildCandidates = () => {
    const assembled = assembleCandidates(discoveryCat, offs, resolvedRegistry, accounts, null, [
      ...candidatesApi.generateCandidates({
        harness: opts.harness,
        registry: resolvedRegistry,
        accounts: accounts || [],
        openCodeIds: (accounts || []).flatMap((account) =>
          ((account && account.models) || [])
            .map((model) => (typeof model === 'string' ? model : model && model.model))
            .filter(Boolean)
        ),
        catalogue:
          catalogueRows.length > 0
            ? catalogueRows
            : (discoveryCat && discoveryCat.candidates) || [],
        evidenceData: opts.evidenceData,
        fakeRunsDir: opts.fakeRunsDir,
        home: opts.home,
        discoverPool: opts.discoverPool !== false,
        adapterScript: opts.adapterScript,
        platform: opts.platform,
        keepExhausted: true,
      }),
      ...candidatesApi.gatewayAccountCandidates({
        registry: resolvedRegistry,
        accounts: accounts || [],
        catalogue: (discoveryCat && discoveryCat.candidates) || [],
        routeHealth,
        routeHealthExplicit,
        requireRouteHealth: enforceMissingHealth,
        allowMissingRouteHealth: opts.allowMissingRouteHealth,
        probeEvidence: opts.probeEvidence,
        now: opts.now,
        onAccountCount: opts.onAccountCount,
      }),
      ...candidatesApi.poolAccountCandidates({
        registry: resolvedRegistry,
        accounts: accounts || [],
        catalogue: (discoveryCat && discoveryCat.candidates) || [],
        routeHealth,
        allowUnprobedCandidates: opts.allowUnprobedCandidates,
        now: opts.now,
        probeEvidence: opts.probeEvidence,
        requireRouteHealth: enforceMissingHealth,
        evidenceData: opts.evidenceData,
        fakeRunsDir: opts.fakeRunsDir,
        home: opts.home,
        discoverPool: opts.discoverPool !== false,
        adapterScript: opts.adapterScript,
        platform: opts.platform,
        keepExhausted: true,
      }),
      ...candidatesApi
        .candidatesFromEvidence(opts.evidenceData, { accounts: evidenceAccounts })
        .filter((c) => {
          if (c.legacy) return false;
          return Array.isArray(c.evidence) && c.evidence.some((e) => e && e.status === 'passed');
        }),
    ]);
    for (const fallback of resolvedFallbackRoutes) {
      const route = fallback.route;
      if (!route) continue;
      const matching = catalogueRows.find(
        (row) =>
          route.gateway &&
          row.gateway === route.gateway &&
          routeHealthApi.normalizeModelId(row.modelId || row.model) === fallback.modelId
      );
      if (matching) {
        assembled.push(
          ...assembleCandidates(
            { candidates: [matching] },
            offs,
            resolvedRegistry,
            accounts,
            null,
            []
          )
        );
        continue;
      }
      const source = (resolvedRegistry.sources || []).find((item) => item.id === route.id);
      if (!source) continue;
      const generated = candidatesApi.generateCandidates({
        registry: resolvedRegistry,
        accounts: accounts || [],
        openCodeIds: [fallback.modelId],
        catalogue: [],
        discoverPool: opts.discoverPool !== false,
        home: opts.home,
      });
      const directCandidates = generated.filter((candidate) => candidate.gateway === route.id);
      if (directCandidates.length === 0) {
        const source = (resolvedRegistry.sources || []).find((item) => item.id === route.id);
        const dispatch =
          resolvedRegistry.dispatch && resolvedRegistry.dispatch.providers
            ? resolvedRegistry.dispatch.providers[String(route.id).toLowerCase()]
            : null;
        const boundAccounts = (accounts || []).filter(
          (account) => account && (account.provider === route.id || account.sourceId === route.id)
        );
        for (const account of boundAccounts) {
          directCandidates.push({
            harness: route.harness || (dispatch && dispatch.harness) || (source && source.harness),
            accessPath: route.accessPath || (source && (source.accessPath || source.endpoint)),
            gateway: route.gateway || route.id,
            upstream: route.upstream || route.id,
            accountId: account.id,
            quotaScope: account.id,
            modelId: fallback.modelId,
            source: route.id,
            kind: source && source.kind,
            capabilities: account.capabilities || {},
            sharedQuota: 'unknown',
          });
        }
      }
      assembled.push(...directCandidates);
    }
    const eligible = [];
    const excludedRoutes = [];
    const seenExcluded = new Set();
    for (const candidate of assembled) {
      if (
        isCandidateRouteEligible(
          routeHealth,
          candidate,
          Object.assign({}, opts, { requireRouteHealth: enforceMissingHealth }),
          routeHealthApi
        )
      ) {
        eligible.push(candidate);
      } else {
        const key = candidatesApi.candidateKey(candidate);
        if (!seenExcluded.has(key)) {
          seenExcluded.add(key);
          const modelId = candidate && candidate.modelId;
          const gateway =
            candidate &&
            (candidate.gateway ||
              (opts && opts.harness === 'hermes' && (candidate.sourceId || candidate.source)));
          const isWildcard = !candidate.accountId || candidate.accountId === '*';
          const routePath = isWildcard ? gateway : { id: gateway, accountId: candidate.accountId };
          const rec =
            routeHealth && modelId && gateway
              ? routeHealthApi.getPathRecord(routeHealth, modelId, routePath)
              : null;
          const reason =
            candidate &&
            (candidate.credentialEnvMissing || candidate.blockReason === 'CREDENTIAL_ENV_MISSING')
              ? 'CREDENTIAL_ENV_MISSING'
              : rec
                ? rec.status || 'ROUTE_UNAVAILABLE'
                : 'ROUTE_PROBE_UNPROVEN';
          excludedRoutes.push({
            offeringId: key,
            candidateKey: key,
            reason,
            reasonCode: String(reason).split(':')[0],
            scope: candidate && candidate.blockReason ? 'account' : 'route',
          });
        }
      }
    }
    Object.defineProperty(eligible, 'excludedRoutes', {
      value: excludedRoutes,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    if (opts && Array.isArray(opts.excludedRoutes)) {
      opts.excludedRoutes.push(...excludedRoutes);
    }
    return eligible;
  };
  if (!refresh) return buildCandidates();
  return Promise.resolve(persistHealth()).then(buildCandidates);
}

async function resolveFallbackRoutes(store, catalogue, probe, routeHealthApi, options) {
  const cap = Math.max(
    0,
    Number((options && options.fallbackProbeCap) ?? (options && options.probeCap) ?? 20)
  );
  let checked = 0;
  const pathsByModel = new Map();
  const registry = options && options.registry;
  const accounts = options && options.accounts;
  const preResolved = options && options.preResolvedFallback === true;
  for (const row of catalogue || []) {
    const modelId = row && (row.modelId || row.model);
    if (!modelId || !row.gateway) continue;
    const normalized = routeHealthApi.normalizeModelId(modelId);
    if (!pathsByModel.has(normalized)) pathsByModel.set(normalized, []);
    pathsByModel.get(normalized).push({
      id: row.gateway,
      gateway: row.gateway,
      evidence: Number(row.evidence || 0),
      geoBlocked: row.geoBlocked === true,
    });
  }
  for (const normalized of pathsByModel.keys()) {
    const discovered = routeHealthApi.discoverModelPaths(normalized, registry, accounts, catalogue);
    const merged = new Map(pathsByModel.get(normalized).map((route) => [route.id, route]));
    for (const route of discovered) {
      const previous = merged.get(route.id);
      merged.set(
        route.id,
        previous
          ? Object.assign({}, route, {
              evidence: Math.max(previous.evidence || 0, route.evidence || 0),
            })
          : route
      );
    }
    pathsByModel.set(normalized, [...merged.values()]);
  }
  const now = Number(options && options.now) || Date.now();
  const resolvedRoutes = [];
  for (const [normalized, paths] of pathsByModel) {
    for (const failed of paths) {
      const health = routeHealthApi.getPathRecord(store, normalized, failed);
      if (
        !health ||
        health.status === 'AVAILABLE' ||
        routeHealthApi.isEligible(store, normalized, failed, now)
      )
        continue;
      if (preResolved) {
        const fallbackEvent = (store.events || [])
          .slice()
          .reverse()
          .find(
            (e) =>
              e &&
              e.type === 'route_fallback' &&
              e.modelId === normalized &&
              (e.failedPath === failed.id || e.from === failed.id)
          );
        let successful = null;
        if (fallbackEvent) {
          const chosenId = fallbackEvent.chosenPath || fallbackEvent.to;
          successful = paths.find(
            (route) =>
              (route.id === chosenId || route.gateway === chosenId) &&
              routeHealthApi.isEligible(store, normalized, route, now)
          );
        }
        if (!successful) {
          const ordered = paths
            .filter((route) => route.id !== failed.id)
            .sort((a, b) => Number(b.evidence || 0) - Number(a.evidence || 0));
          successful = ordered.find((route) =>
            routeHealthApi.isEligible(store, normalized, route, now)
          );
        }
        if (successful)
          resolvedRoutes.push({
            modelId: normalized,
            failedPath: failed.id,
            reason: (fallbackEvent && fallbackEvent.reason) || health.status,
            route: successful,
          });
        continue;
      }
      if (checked >= cap) {
        if (options && Array.isArray(options.resolvedRoutes))
          options.resolvedRoutes.push(...resolvedRoutes);
        return { checked, capped: true, resolvedRoutes };
      }
      checked += 1;
      const fallback = await routeHealthApi.routeFallbackDiscovered(
        normalized,
        failed.id,
        registry,
        accounts,
        catalogue,
        (model, route) => probe(model, route.id, { timeoutMs: options.probeTimeoutMs }),
        store,
        { now, failureReason: health.status, registry }
      );
      if (fallback.ok)
        resolvedRoutes.push({
          modelId: normalized,
          failedPath: failed.id,
          reason: fallback.reason,
          route: fallback.route,
        });
    }
  }
  if (options && Array.isArray(options.resolvedRoutes))
    options.resolvedRoutes.push(...resolvedRoutes);
  return { checked, capped: false, resolvedRoutes };
}

function readCheckpoint(file) {
  const fs = require('fs');
  if (!file) return null;
  // A `.tmp` next to the checkpoint is a writeJsonFile write whose rename was
  // interrupted: the file itself is complete (a torn write is not valid JSON)
  // and it is newer than the checkpoint below it. Adopt it and finish the
  // rename, so a one-step-stale checkpoint cannot silently relaunch work the
  // decision log already records as launched (TASK-AI-105 P2-4). A torn
  // half-write is dropped instead: the checkpoint is the last complete state.
  const tmp = file + '.tmp';
  if (fs.existsSync(tmp)) {
    let adopted = null;
    try {
      adopted = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    } catch (err) {
      adopted = null;
    }
    if (adopted && typeof adopted === 'object' && !Array.isArray(adopted)) {
      try {
        atomicRenameSync(tmp, file);
      } catch (err) {}
      return adopted;
    }
    try {
      fs.unlinkSync(tmp);
    } catch (err) {}
  }
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, value, options) {
  const fsApi = (options && options.fs) || require('fs');
  const path = require('path');
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fsApi.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  atomicRenameSync(tmp, file, Object.assign({}, options, { fs: fsApi }));
}

/**
 * Where the harness writes its durable session report for one dispatch.
 *
 * The worker writes the report, so the directory has to be one the worker can
 * reach — inside the worker root for an isolated launch. It is named by the
 * operator (`--usage-dir`) or by the caller, never derived from the worker's
 * own answer, and never the host-owned launch-results directory a worker
 * cannot write.
 */
function usageReportFile(args, deps, item, now) {
  const explicit = (args && args['usage-report']) || (deps && deps.usageFile);
  if (typeof explicit === 'string' && explicit) return explicit;
  const dir = (args && args['usage-dir']) || (deps && deps.usageDir);
  if (typeof dir !== 'string' || !dir) return null;
  const stem = String((item && item.workItemId) || 'session').replace(/[^A-Za-z0-9._-]/g, '-');
  return path.join(dir, stem + '-' + (now || Date.now()) + '.json');
}

function sevenFields(candidate) {
  return {
    harness: candidate.harness || '',
    accessPath: candidate.accessPath || '',
    gateway: candidate.gateway || '',
    upstream: candidate.upstream || '',
    accountId: candidate.accountId || '*',
    quotaScope: candidate.quotaScope || '',
    modelId: candidate.modelId || candidate.model || '',
  };
}

function quotaSnapshot(candidate) {
  const key = candidate.offeringId || candidate.key || '';
  return {
    offeringId: key,
    headroom: candidate.headroom || candidate.headroomStatus || 'unknown',
    reason: candidate.headroomReason || null,
    reservations: Number(candidate.reservationsHeld || 0),
  };
}

function candidateFromDecision(decision, key) {
  return (decision.candidates || []).find((c) => c.offeringId === key) || null;
}

function simulatedFailureFor(candidate) {
  const c = candidate || {};
  return {
    exitCode: 1,
    httpStatus: 503,
    body:
      'HTTP 503 from gateway: [402]: upstream ' +
      (c.upstream || 'unknown') +
      ' budget exhausted; reset after 1h 00m',
    stderr:
      'HTTP 503 from gateway: [402]: upstream ' +
      (c.upstream || 'unknown') +
      ' budget exhausted; reset after 1h 00m',
    accountId: c.accountId || '*',
  };
}

function sameFailureDomain(candidate, failed, classification) {
  // mvp-repair.test.js:66-70 evaluates this function via new Function without CommonJS require scope.
  const routing =
    typeof require === 'function'
      ? require('./routing')
      : process.getBuiltinModule('module').createRequire(`${process.cwd()}/tools/ai-brain/cli.js`)(
          './routing'
        );
  return routing.sameFailureDomain(candidate, failed, classification);
}

/**
 * Marks a failed candidate, and every candidate in the same failure domain, as
 * blocked, so the next ranking round cannot pick either. One implementation, two
 * vocabularies: the dry run says SIMULATED_*, a live run says the plain reason.
 * The domain rule is the Controller's (sameFailureDomain, driven by
 * failure-classifier.js), never a second, simpler "different gateway" test.
 */
function applyFailureBlocks(
  candidates,
  failedKeys,
  failedCandidate,
  classification,
  avoidDomain,
  codes
) {
  const candidatesApi = require('./candidates');
  for (const c of candidates) {
    if (c.blocked) continue;
    const key = candidatesApi.candidateKey(c);
    if (failedKeys.has(key)) {
      c.blocked = true;
      c.blockReason = codes.failed;
      c.blockScope = 'candidate';
      continue;
    }
    if (avoidDomain && sameFailureDomain(c, failedCandidate, classification)) {
      c.blocked = true;
      c.blockReason = codes.sameDomain;
      c.blockScope = classification.scope || 'unknown';
    }
  }
}

const DRY_RUN_BLOCK_CODES = Object.freeze({
  failed: 'SIMULATED_CANDIDATE_FAILED',
  sameDomain: 'SIMULATED_FAILURE_DOMAIN_AVOIDED',
});

const LIVE_BLOCK_CODES = Object.freeze({
  failed: 'CANDIDATE_FAILED',
  sameDomain: 'FAILURE_DOMAIN_AVOIDED',
});

function applyDryRunBlocks(candidates, failedKeys, failedCandidate, classification, avoidDomain) {
  return applyFailureBlocks(
    candidates,
    failedKeys,
    failedCandidate,
    classification,
    avoidDomain,
    DRY_RUN_BLOCK_CODES
  );
}

function candidateContextWindow(candidate) {
  const caps = candidate && candidate.capabilities;
  return (
    candidate &&
    (candidate.contextWindow ||
      candidate.context_window ||
      (caps && (caps.contextWindow || caps.context_window || caps.contextTokens)))
  );
}

function applyHarnessVerification(candidates) {
  const { contextRefusal } = require('./harness');
  for (const c of candidates || []) {
    const reason = contextRefusal(c.harness, candidateContextWindow(c), { allowUnknown: true });
    if (!reason) continue;
    c.blocked = true;
    c.blockReason = reason;
    c.blockScope = 'model';
  }
}

function buildDryRunLog(parts) {
  const decision = parts.decision || {};
  const fallback = parts.fallback || {};
  const finalChoice = fallback.chosen || decision.chosen || null;
  const firstChoice = parts.firstChoice || decision.chosen || null;
  const rejected = new Map();
  for (const r of decision.rejected || []) {
    rejected.set(r.offeringId, r);
  }
  for (const r of (fallback.decision && fallback.decision.rejected) || []) {
    rejected.set(r.offeringId, r);
  }
  const candidates = (parts.annotated || []).map((c) => {
    const key = parts.candidatesApi.candidateKey(c);
    const isUnscored =
      c.qualityLabel === 'QUALITY_UNKNOWN' ||
      (c.scoreBreakdown &&
        (c.scoreBreakdown.quality === null ||
          c.scoreBreakdown.quality === 'QUALITY_UNKNOWN' ||
          c.scoreBreakdown.qualityLabel === 'QUALITY_UNKNOWN')) ||
      c.score === null ||
      c.score === undefined;
    const scoreVal =
      (c.scoreBreakdown && c.scoreBreakdown.quality === null) ||
      c.score === null ||
      c.score === undefined
        ? 'chưa rõ'
        : c.score;
    return Object.assign(sevenFields(c), {
      offeringId: key,
      status: c.status === 'passed' ? 'PASS' : c.status || 'unknown',
      score: scoreVal,
      qualityLabel: isUnscored ? 'QUALITY_UNKNOWN' : undefined,
    });
  });
  for (const c of candidates) {
    if (c.offeringId === finalChoice || rejected.has(c.offeringId)) continue;
    rejected.set(c.offeringId, {
      offeringId: c.offeringId,
      reason: 'NOT_SELECTED',
      scope: 'candidate',
    });
  }
  return {
    schemaVersion: 1,
    mode: 'dry-run',
    workItemId: parts.item.workItemId,
    generatedAt: new Date(parts.now).toISOString(),
    resumed: Boolean(parts.resumed),
    stages: [
      'discovery',
      '7-field candidates',
      'quota/fairness',
      'failure classifier',
      'ranking',
      'decision',
      'dry-run dispatch',
      'simulated first-source failure',
      'fallback',
      'checkpoint resume',
    ],
    candidates,
    excluded: Array.from(rejected.values()).map((r) => ({
      offeringId: r.offeringId,
      candidateKey: r.offeringId,
      reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
      reason: r.reason || 'UNKNOWN',
      scope: r.scope || null,
    })),
    excludedCandidates: Array.from(rejected.values()).map((r) => ({
      offeringId: r.offeringId,
      candidateKey: r.offeringId,
      reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
      reason: r.reason || 'UNKNOWN',
      scope: r.scope || null,
    })),
    selected: finalChoice,
    selectedCandidate: finalChoice,
    firstChoice,
    quotaState: candidates.map((c) => quotaSnapshot(c)),
    ranking: {
      reason: decision.reason,
      ordered: (decision.candidates || []).map((c) => ({
        offeringId: c.offeringId,
        score:
          (c.scoreBreakdown && c.scoreBreakdown.quality === null) ||
          c.score === null ||
          c.score === undefined
            ? 'chưa rõ'
            : c.score,
        qualityLabel:
          c.qualityLabel ||
          (c.scoreBreakdown && c.scoreBreakdown.qualityLabel) ||
          (c.scoreBreakdown && c.scoreBreakdown.quality === null ? 'QUALITY_UNKNOWN' : undefined),
        headroom: c.headroom || 'unknown',
      })),
    },
    dryRunDispatch: {
      launched: false,
      networkTouched: false,
      executeTouched: false,
    },
    simulatedFailure: parts.simulatedFailure || null,
    failure: parts.simulatedFailure || null,
    fallback: {
      candidateKey: fallback.chosen || null,
      chosen: fallback.chosen || null,
      reason: fallback.reason || null,
      preferredDifferentFailureDomain: Boolean(fallback.preferredDifferentFailureDomain),
      decision: fallback.decision || null,
    },
    checkpoint: parts.checkpoint || null,
  };
}

/**
 * TASK-AI-65: candidate assembly for a profile dispatch. The same assembly the
 * item path uses (discovery catalogue + offerings + registry pins), so a
 * profile-ranked candidate and an item-ranked candidate are the same kind of
 * object with the same seven-part identity.
 */
async function dispatchProfileCommand(args, deps) {
  const rootDir = args.root || (deps && deps.rootDir) || process.cwd();
  const sourcesApi = require('./sources');
  const jev = require('./jev');
  const { readDiscoveryCatalogue } = require('./discovery/read');

  let discCat;
  if (Array.isArray(deps && deps.discoveryCatalogue)) {
    discCat = deps.discoveryCatalogue;
  } else if (!(deps && Array.isArray(deps.candidates))) {
    try {
      discCat = readDiscoveryCatalogue({
        dataDir:
          (deps && deps.discoveryDataDir) ||
          args['discovery-dir'] ||
          path.join(__dirname, 'data', 'discovery'),
      });
    } catch {
      discCat = { candidates: [] };
    }
  }
  const accounts = Array.isArray(deps && deps.accounts)
    ? deps.accounts
    : require('./accounts').listAccounts() || [];

  const evidenceDir =
    (deps && deps.evidenceDir) || args['evidence-dir'] || path.join(__dirname, 'data', 'evidence');
  let evidenceData;
  try {
    evidenceData = require('./evidence').loadEvidence(evidenceDir);
  } catch (e) {
    evidenceData = {};
  }
  const optsWithEvidence = Object.assign({}, deps, {
    evidenceData,
    routeHealthFile: args['route-health'] || (deps && deps.routeHealthFile) || undefined,
    accounts,
    discoveryDataDir: (deps && deps.discoveryDataDir) || args['discovery-dir'] || undefined,
    fakeRunsDir:
      (deps && deps.fakeRunsDir) ||
      args['pool-runtime-dir'] ||
      args['agy-runs-dir'] ||
      process.env.AGY_POOL_RUNS_DIR ||
      process.env.AGY_RUNS_DIR ||
      undefined,
    discoverPool:
      (deps && deps.discoverPool === true) ||
      Boolean(
        args['pool-runtime-dir'] ||
        args['agy-runs-dir'] ||
        process.env.AGY_POOL_RUNS_DIR ||
        process.env.AGY_RUNS_DIR
      ),
    home: (deps && deps.home) || args.home || undefined,
    adapterScript: (deps && deps.adapterScript) || process.env.AGY_POOL_ADAPTER_SCRIPT || undefined,
    platform: (deps && deps.platform) || undefined,
  });
  if (Array.isArray(deps && deps.candidates)) {
    optsWithEvidence.allowUnprobedCandidates = true;
  }
  if (!discCat && Array.isArray(deps && deps.candidates)) discCat = { candidates: [] };

  const registry = (deps && deps.registry) || sourcesApi.loadSources();
  const candidateList = assembleForDispatch(
    discCat,
    accounts,
    registry,
    Array.isArray(deps && deps.candidates) || (deps && deps.allowUnprobedCandidates === true)
      ? optsWithEvidence
      : Object.assign({}, optsWithEvidence, { requireRouteHealth: true })
  );
  const jevSource = sourcesApi.getSource('jev', registry);
  const jevAsk =
    (deps && deps.jevAsk) ||
    jev.buildAskFromSource(jevSource, {
      home: optsWithEvidence.home,
      env: (deps && deps.env) || process.env,
      httpClient: deps && deps.jevHttpClient,
      timeoutMs: deps && deps.jevTimeoutMs,
    });

  return require('./routing').runProfileDispatch(
    args,
    Object.assign({}, deps, {
      candidates: candidateList,
      capabilityProbeAllowNetwork: args.execute === true && !Array.isArray(deps && deps.candidates),
      registry,
      rootDir,
      ask: (deps && deps.ask) || jevAsk,
      minConfidence: jevSource && jevSource.minConfidence,
      modelChoiceAsk: (deps && (deps.modelChoiceAsk || deps.ask)) || jevAsk,
      modelChoiceMinConfidence:
        (deps && (deps.modelChoiceMinConfidence || deps.minConfidence)) ||
        (jevSource && jevSource.minConfidence),
      modelChoiceTopN: (deps && deps.modelChoiceTopN) || 5,
      explorationBudget:
        args['exploration-budget'] !== undefined ? Number(args['exploration-budget']) : 0,
      home: optsWithEvidence.home,
      storePath: (deps && deps.storePath) || args['quota-store'] || undefined,
      fakeRunsDir: optsWithEvidence.fakeRunsDir,
      adapterScript: optsWithEvidence.adapterScript,
      platform: optsWithEvidence.platform,
      launcher: (deps && deps.launcher) || args.launcher || undefined,
    })
  );
}

/**
 * Master-queue item 5: dispatch wiring.
 * Chooses candidate through the brain (discovery + offerings, evidence/cooldowns,
 * quota/reservations/load, ranked by ranking.js).
 */
function dispatchCommand(args, deps = {}) {
  const fs = require('fs');
  const rootDir = args.root || (deps && deps.rootDir) || process.cwd();
  const execute = args.execute === true;
  const dryRunFlag = Boolean(args['dry-run'] || args.dryRun);
  const log = deps.log || console.log;
  const error = deps.error || console.error;
  const exit = deps.exit || process.exit;

  // Releasing a claim is its own operation:
  const close = args.close || args.complete || args.fail;
  if (typeof close === 'string') {
    const decisions = require('./decisions');
    const outcome = args.fail ? 'failed' : 'completed';
    const released = decisions.closeWriter(close, outcome, {
      dir: args['decision-dir'] || (deps && deps.decisionDir) || undefined,
      detail: typeof args.detail === 'string' ? args.detail : null,
    });
    if (!released) {
      log('No open writer for ' + close + '; nothing to release.');
      return { exitCode: 0, released: false };
    }
    log(
      'Released ' + close + ' (' + outcome + ', session ' + (released.sessionId || 'unknown') + ')'
    );
    return { exitCode: 0, released: true };
  }

  if (execute && dryRunFlag) {
    error('Dispatch refused: --execute and --dry-run are exclusive.');
    exit(2);
    return { exitCode: 2 };
  }

  // TASK-AI-65: report a structured execution outcome for a pinned candidate.
  // The evidence store and cooldowns are updated through routing.js before any
  // next ranking round, so a failure is seen by the Controller, not just logged.
  const reportOutcome = pick(args, 'report-outcome', 'reportOutcome');
  if (typeof reportOutcome === 'string') {
    const routing = require('./routing');
    return routing.reportDispatchOutcome(args, {
      log,
      error,
      exit,
      rootDir,
      evidenceDir:
        (deps && deps.evidenceDir) ||
        args['evidence-dir'] ||
        path.join(__dirname, 'data', 'evidence'),
      decisionDir: args['decision-dir'] || (deps && deps.decisionDir) || undefined,
      now: deps && deps.now,
      storePath: deps && deps.storePath,
      home: (deps && deps.home) || args.home || undefined,
      fakeRunsDir:
        (deps && deps.fakeRunsDir) || args['pool-runtime-dir'] || args['agy-runs-dir'] || undefined,
    });
  }

  // TASK-AI-65: profile-driven live routing. The profile names the task, its
  // floors and its constraints; JEV advises (never a model); the Controller
  // ranks; rank 1 is pinned and, under --execute, reserved. Async, because the
  // JEV advisory is.
  if (typeof args.profile === 'string') {
    return dispatchProfileCommand(args, deps);
  }

  if (deps && deps.refreshRoutes === true && !Array.isArray(deps.candidates)) {
    const routeHealthApi = require('./route-health');
    // Same order as orchestrate and next: args, then deps, then root, then default.
    const healthFile =
      (args && (args['route-health'] || args.routeHealthFile)) ||
      deps.routeHealthFile ||
      deps['route-health'] ||
      (args && args.root
        ? path.join(args.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
        : null) ||
      path.join(__dirname, 'data', 'model-route-health.json');
    const registryForProbe = deps.registry || require('./sources').loadSources();
    const healthStore =
      deps.routeHealth || routeHealthApi.loadStore(healthFile, { allowMissing: true });
    return routeHealthApi
      .recheckBeforeSelection(
        healthStore,
        deps.probeRoute ||
          ((model, route, probeOptions) =>
            routeHealthApi.probeGatewayModel(
              model,
              route,
              Object.assign({ registry: registryForProbe }, probeOptions)
            )),
        {
          now: deps.now,
          cap: deps.probeCap,
          timeoutMs: deps.probeTimeoutMs,
          catalogue: (deps.discoveryCatalogue && deps.discoveryCatalogue.candidates) || [],
          registry: registryForProbe,
          accounts: deps.accounts || [],
        }
      )
      .then((result) => {
        routeHealthApi.saveStore(healthFile, healthStore);
        if (deps.onRouteRefresh) deps.onRouteRefresh(result);
        return dispatchCommand(
          Object.assign({}, args, { 'route-health-refreshed': true }),
          Object.assign({}, deps, {
            refreshRoutes: false,
            routeHealth: healthStore,
            registry: registryForProbe,
          })
        );
      });
  }

  const isDryRun = dryRunFlag || !execute;

  // Pre-computed plan file fallback
  if (typeof args.plan === 'string') {
    const { executePlan } = require('./executor');
    const plan = readJsonOrExit(path.resolve(args.plan), 'plan');
    const result = executePlan(plan, {
      dryRun: isDryRun,
      isolatedWorker: args['isolated-worker'] || false,
      project: args.project || 'shipde-platform',
      cwd: args.cwd || (deps && deps.cwd) || undefined,
      base: args.base || (deps && deps.base) || undefined,
      decisionDir: args['decision-dir'] || (deps && deps.decisionDir) || undefined,
      run: deps && deps.run,
    });
    const s = result.summary;
    if (args.json) {
      log(JSON.stringify({ plan, result }, null, 2));
      exit(s.failed > 0 ? 1 : 0);
      return { exitCode: s.failed > 0 ? 1 : 0, plan, result };
    }
    if (result.dryRun) {
      log('Dispatch dry run: ' + (plan.assignments || []).length + ' planned, 0 launched');
      exit(0);
      return { exitCode: 0, result };
    }
    exit(s.failed > 0 ? 1 : 0);
    return { exitCode: s.failed > 0 ? 1 : 0, result };
  }

  // Work items resolution
  let items = [];
  const targetItemId = args.item || args['work-item'] || (deps && deps.workItemId);
  if (deps && deps.items) {
    items = deps.items;
  } else if (targetItemId) {
    items = [
      {
        workItemId: targetItemId,
        role: args.role || (deps && deps.role) || 'author.foundation',
        branch:
          args.branch || (deps && deps.branch) || 'feat/' + String(targetItemId).toLowerCase(),
        riskDomains: [],
        priority: 0,
      },
    ];
  } else {
    const csvPath =
      args.csv ||
      path.join(
        rootDir,
        'docs',
        'product-spec',
        'docs',
        '10-ai-collaboration',
        'FEATURE-DELIVERY-REGISTER.csv'
      );
    if (!fs.existsSync(csvPath)) {
      if (args.csv) {
        error('SOURCE_MISSING: ' + csvPath);
        exit(2);
        return { exitCode: 2 };
      }
      items = [];
    } else {
      const register = loadRegister(csvPath, null, rootDir);
      items = ((register.data && register.data.items) || [])
        .filter((row) => row.status === 'READY_FOR_AUTHOR')
        .map((row) => ({
          workItemId: row.work_item_id,
          role: 'author.foundation',
          branch: row.branch || null,
          riskDomains: [],
          priority: 0,
        }));
    }
  }

  if (items.length === 0 && !deps.candidates && !args.item) {
    log('Dispatch: 0 assignments (0 deferred)');
    exit(0);
    return { exitCode: 0, dispatched: 0 };
  }

  const item = items[0] || {
    workItemId: targetItemId || 'TASK-DISPATCH',
    role: args.role || (deps && deps.role) || 'author.foundation',
    branch: args.branch || (deps && deps.branch) || 'feat/dispatch-work',
  };

  const sourcesApi = require('./sources');
  const evidence = require('./evidence');
  const ranking = require('./ranking');
  const candidatesApi = require('./candidates');
  const quotaStore = require('./quota-store');
  const { listAccounts } = require('./accounts');
  const { readDiscoveryCatalogue } = require('./discovery/read');
  const { getHarness, runHarness, parseLastJson, structuredOutcome } = require('./harness');
  // The durable-session-id rule lives with the executor, which owns the harness
  // contract; this file reads it from there rather than keeping a second copy.
  const { readSessionId } = require('./executor');
  const { workerName, defaultPrompt } = require('./executor');

  const registry = (deps && deps.registry) || sourcesApi.loadSources();
  const evidenceDir =
    (deps && deps.evidenceDir) || args['evidence-dir'] || path.join(__dirname, 'data', 'evidence');
  const decisionDir = (deps && deps.decisionDir) || args['decision-dir'] || undefined;

  // 1. Candidates from discovery + offerings
  let discCat = deps && deps.discoveryCatalogue;
  if (!discCat && (!deps || !deps.candidates)) {
    const discDir =
      (deps && deps.discoveryDataDir) ||
      args['discovery-dir'] ||
      path.join(__dirname, 'data', 'discovery');
    try {
      discCat = readDiscoveryCatalogue({ dataDir: discDir });
    } catch {
      discCat = { candidates: [] };
    }
  }

  const isCandidateInjected = Array.isArray(deps && deps.candidates);
  const rollingOnboard = require('./rolling-onboard');
  const env = (deps && deps.env) || process.env;
  const evidenceData = (deps && deps.evidenceData) || evidence.loadEvidence(evidenceDir);
  const newSources =
    (deps && deps.onboardingPrepared) || isCandidateInjected
      ? []
      : rollingOnboard.detectNewSources(registry, evidenceData, env);

  // Like the route-refresh, JEV and capability-probe branches below, onboarding makes this
  // call asynchronous. dispatchCommand's only caller (the `dispatch` command) already
  // awaits a returned promise and turns a rejection into a non-zero exit.
  if (newSources.length > 0) {
    // Onboarding only records evidence, route health and quota. Accounts stay owned by the
    // account registry: no binding is invented here, so isolation and quota policy hold.
    return rollingOnboard
      .autoOnboardNewSources(newSources, {
        ...deps,
        evidenceData,
        evidenceDir,
        registry,
        env,
      })
      .then(() =>
        dispatchCommand(args, {
          ...deps,
          onboardingPrepared: true,
          evidenceData,
        })
      );
  }

  const accounts = deps && deps.accounts !== undefined ? deps.accounts : listAccounts() || [];
  const routeHealthApi = require('./route-health');
  const candidateList = assembleForDispatch(
    discCat,
    accounts,
    registry,
    Array.isArray(deps.candidates) || deps.allowUnprobedCandidates === true
      ? deps
      : Object.assign({}, deps, { requireRouteHealth: true })
  );

  // Filter by explicit pins (--model, --account, --harness)
  const pinModel = args.model || (deps && deps.model);
  const pinAccount = args.account || (deps && deps.account);
  const pinHarness = args.harness || (deps && deps.harness);
  const isPinned = Boolean(pinModel || pinAccount || pinHarness);

  let eligibleCandidates = candidateList.slice();
  if (isPinned) {
    if (pinModel) {
      eligibleCandidates = eligibleCandidates.filter(
        (c) => c.modelId === pinModel || c.model === pinModel || c.base === pinModel
      );
    }
    if (pinAccount) {
      eligibleCandidates = eligibleCandidates.filter(
        (c) => c.accountId === pinAccount || c.account === pinAccount
      );
    }
    if (pinHarness) {
      eligibleCandidates = eligibleCandidates.filter((c) => c.harness === pinHarness);
    }
  }

  // Handle dry-run
  if (isDryRun) {
    const now = (deps && deps.now) || Date.now();
    const checkpointFile =
      typeof args.checkpoint === 'string'
        ? path.resolve(rootDir, args.checkpoint)
        : deps && deps.checkpointFile;
    const decisionLogFile =
      typeof args['decision-log'] === 'string'
        ? path.resolve(rootDir, args['decision-log'])
        : deps && deps.decisionLogFile;
    const checkpoint = readCheckpoint(checkpointFile);
    const failedKeys = new Set((checkpoint && checkpoint.failedCandidates) || []);
    const resumed =
      Boolean(checkpoint && checkpoint.workItemId === item.workItemId && checkpoint.step) ||
      Boolean(failedKeys.size);
    const evidenceData = evidence.loadEvidence(evidenceDir);
    const annotated = candidatesApi.annotateCandidates(
      eligibleCandidates.map((c) => Object.assign({}, c)),
      evidenceData,
      { now }
    );
    applyHarnessVerification(annotated);

    for (const c of annotated) {
      const key = candidatesApi.candidateKey(c);
      if (failedKeys.has(key)) {
        c.blocked = true;
        c.blockReason = 'checkpoint resume skipped previously failed candidate';
        c.blockScope = 'candidate';
      }
    }

    const rankingContext = {
      workItemId: item.workItemId,
      role: item.role,
      kind: item.role,
      registry,
      evidenceData,
      decisionOpts: { dir: decisionDir, now },
      dryRun: true,
      headrooms: deps && deps.headrooms,
      load: deps && deps.load,
      reservations: deps && deps.reservations,
      explorationBudget:
        args['exploration-budget'] !== undefined ? Number(args['exploration-budget']) : 1,
      home: deps && deps.home,
      storePath: deps && deps.storePath,
      accounts,
      now,
    };
    const routing = require('./routing');
    const profile =
      deps.taskProfile ||
      require('./orchestrate').buildTaskProfile(
        { ...item, id: item.workItemId },
        { ...deps, enforceProofFloors: deps.enforceProofFloors === true }
      );
    // Production uses the same cached advisory assessment as the live writer.
    // Injected candidate fixtures remain offline unless they provide an ask.
    if (
      !deps.assessment &&
      (!Array.isArray(deps.candidates) || typeof deps.jevAsk === 'function')
    ) {
      const jevSource = sourcesApi.getSource('jev', registry);
      const ask =
        deps.jevAsk ||
        require('./jev').buildJevAsk(jevSource, {
          home: deps.home,
          env: deps.env || process.env,
          httpClient: deps.jevHttpClient,
          timeoutMs: deps.jevTimeoutMs,
        });
      return require('./writer-selection')
        .assessOnce(profile, jevSource, ask, deps, routing)
        .then((assessment) =>
          dispatchCommand(args, {
            ...deps,
            registry,
            accounts,
            candidates: candidateList,
            assessment,
          })
        );
    }
    if (
      !deps.capabilitiesPrepared &&
      annotated.some((c) =>
        (profile.requiredCapabilities || []).some(
          (cap) =>
            c.capabilities?.[cap] === undefined ||
            (c.capabilityDeclarations?.[cap] && !c.capabilityEvidence?.[cap]?.observedAt)
        )
      )
    ) {
      const probe = deps.probeCapabilities || require('./capability-probe').probeCapabilities;
      return Promise.resolve(
        probe(annotated, profile, {
          ...deps,
          registry,
          evidenceDir,
          externalWorkers: args['external-workers'] || deps.externalWorkers,
          allowNetwork: false,
        })
      ).then(() =>
        dispatchCommand(args, {
          ...deps,
          candidates: annotated,
          capabilitiesPrepared: true,
          registry,
          accounts,
          evidenceDir,
        })
      );
    }
    const fallbackProfile = routing.controllerFallbackProfile(profile);
    const assessment = deps.assessment || {
      weightProfile: fallbackProfile,
      weights: routing.WEIGHT_PROFILES[fallbackProfile],
    };
    const rankDryRun = (offered) => {
      const result = routing.rankForProfile(offered, profile, assessment, {
        ...rankingContext,
        ...(deps.ranking || {}),
        priors: deps.priors === undefined ? deps.ranking?.priors : deps.priors,
        useStoredQuota: true,
      });
      if (deps.isolatedWorker && profile.role !== 'reviewer') {
        require('./probe-order').preferKnownGood(result, offered, {
          ...deps,
          registry,
          now,
          evidenceData,
        });
      }
      // Retain the dispatch CLI's existing output/checkpoint field names.
      return {
        ...result,
        candidates: result.ranking.map((candidate) => ({
          ...candidate,
          offeringId: candidate.candidateKey,
          headroom: candidate.headroomStatus,
          qualityLabel: candidate.qualityLabel,
        })),
        rejected: [
          ...result.rejected.map((candidate) => ({
            ...candidate,
            offeringId: candidate.candidateKey,
            reason: candidate.reason || candidate.reasonCode,
          })),
          ...(
            (offered && offered.excludedRoutes) ||
            (candidateList && candidateList.excludedRoutes) ||
            []
          ).map((candidate) => ({
            ...candidate,
            offeringId: candidate.candidateKey || candidate.offeringId,
            reason: candidate.reason || candidate.reasonCode,
          })),
        ],
      };
    };
    const decision = rankDryRun(annotated);
    if (
      resumed &&
      checkpoint &&
      checkpoint.step === 'fallback_selected' &&
      checkpoint.fallbackCandidate &&
      annotated.some((c) => candidatesApi.candidateKey(c) === checkpoint.fallbackCandidate)
    ) {
      const resumedCandidate = annotated.find(
        (c) => candidatesApi.candidateKey(c) === checkpoint.fallbackCandidate
      );
      decision.chosen = checkpoint.fallbackCandidate;
      decision.harness = resumedCandidate ? resumedCandidate.harness : decision.harness;
      decision.reason = 'RESUMED_CHECKPOINT_FALLBACK: continuing saved fallback candidate';
    }
    for (const c of annotated) {
      const ranked = candidateFromDecision(decision, candidatesApi.candidateKey(c));
      if (ranked) {
        c.score = ranked.score;
        c.scoreBreakdown = ranked.scoreBreakdown;
        c.headroomStatus = ranked.headroom;
      }
    }

    if (isPinned) {
      log('PINNED');
    }

    if (!decision.chosen) {
      log('No eligible candidate for ' + item.workItemId);
      for (const rej of decision.rejected) {
        log(
          '  EXCLUDED ' +
            rej.offeringId +
            ' — ' +
            rej.reason +
            (rej.scope ? ' [' + rej.scope + ']' : '')
        );
      }
      exit(1);
      return { exitCode: 1, decision, dryRun: true };
    }

    const simulateFailure = args['simulate-failure'] || (deps && deps.simulateFailure);
    let simulatedFailure = null;
    let fallback = null;
    if (simulateFailure && simulateFailure !== false) {
      const chosenCandidate =
        annotated.find((c) => candidatesApi.candidateKey(c) === decision.chosen) ||
        candidateFromDecision(decision, decision.chosen);
      const shouldFail =
        simulateFailure === true ||
        simulateFailure === 'first' ||
        simulateFailure === decision.chosen ||
        (chosenCandidate && simulateFailure === candidatesApi.candidateKey(chosenCandidate));

      if (shouldFail && chosenCandidate && !resumed && !failedKeys.has(decision.chosen)) {
        const { classifyFailure } = require('./failure-classifier');
        const failureInput = (deps && deps.failureInput) || simulatedFailureFor(chosenCandidate);
        const classification = classifyFailure(failureInput);
        failedKeys.add(decision.chosen);
        simulatedFailure = {
          candidate: decision.chosen,
          failure: failureInput,
          innermostCause: classification.cause,
          classifierScope: classification.scope,
          cooldownMs: classification.cooldownMs,
        };

        const fallbackAnnotated = candidatesApi.annotateCandidates(
          eligibleCandidates.map((c) => Object.assign({}, c)),
          evidenceData,
          { now }
        );
        applyDryRunBlocks(
          fallbackAnnotated,
          failedKeys,
          chosenCandidate,
          classification,
          classification.scope !== 'candidate' && classification.scope !== 'model'
        );
        let fallbackDecision = rankDryRun(fallbackAnnotated);
        let preferredDifferentFailureDomain = true;
        if (!fallbackDecision.chosen) {
          const exactOnlyAnnotated = candidatesApi.annotateCandidates(
            eligibleCandidates.map((c) => Object.assign({}, c)),
            evidenceData,
            { now }
          );
          applyDryRunBlocks(exactOnlyAnnotated, failedKeys, chosenCandidate, classification, false);
          fallbackDecision = rankDryRun(exactOnlyAnnotated);
          preferredDifferentFailureDomain = false;
        }
        fallback = {
          chosen: fallbackDecision.chosen,
          reason: fallbackDecision.chosen
            ? preferredDifferentFailureDomain
              ? 'selected highest-ranked candidate outside the simulated failure domain'
              : 'no different failure domain remained; selected highest-ranked non-failed candidate'
            : 'no fallback candidate qualifies',
          preferredDifferentFailureDomain,
          decision: fallbackDecision,
        };
      } else if (resumed) {
        fallback = {
          chosen: decision.chosen,
          reason: 'checkpoint resume continued after prior simulated failure without retrying it',
          preferredDifferentFailureDomain: false,
          decision,
        };
      }
    }

    // firstChoice must stay the ORIGINAL first choice across resume.
    const originalFirstChoice =
      resumed && checkpoint && checkpoint.firstChoice
        ? checkpoint.firstChoice
        : decision.firstChoice || decision.chosen;

    const finalChoice = fallback && fallback.chosen ? fallback.chosen : decision.chosen;
    const nextCheckpoint = checkpointFile
      ? {
          schemaVersion: 1,
          workItemId: item.workItemId,
          step: fallback && fallback.chosen ? 'fallback_selected' : 'ranked',
          updatedAt: new Date(now).toISOString(),
          failedCandidates: Array.from(failedKeys),
          selectedCandidate: finalChoice,
          firstChoice: originalFirstChoice,
          fallbackCandidate: fallback && fallback.chosen,
          decisionLog: decisionLogFile || null,
        }
      : null;
    if (nextCheckpoint) {
      writeJsonFile(checkpointFile, nextCheckpoint);
    }

    if (decisionLogFile) {
      writeJsonFile(
        decisionLogFile,
        buildDryRunLog({
          item,
          now,
          resumed,
          annotated,
          decision,
          firstChoice: originalFirstChoice,
          simulatedFailure,
          fallback,
          checkpoint: nextCheckpoint
            ? {
                path: checkpointFile,
                step: nextCheckpoint.step,
                failedCandidates: nextCheckpoint.failedCandidates,
              }
            : checkpointFile
              ? { path: checkpointFile, loaded: Boolean(checkpoint) }
              : null,
          candidatesApi,
        })
      );
    }

    log('Ranked candidates for ' + item.workItemId + ':');
    for (let i = 0; i < decision.candidates.length; i++) {
      const c = decision.candidates[i];
      const isUnscored =
        c.qualityLabel === 'QUALITY_UNKNOWN' ||
        (c.scoreBreakdown &&
          (c.scoreBreakdown.quality === null ||
            c.scoreBreakdown.quality === 'QUALITY_UNKNOWN' ||
            c.scoreBreakdown.qualityLabel === 'QUALITY_UNKNOWN')) ||
        c.score === null ||
        c.score === undefined ||
        c.score === 'chưa rõ' ||
        c.score === 'QUALITY_UNKNOWN';
      const displayScore = isUnscored ? 'QUALITY_UNKNOWN' : c.score;
      log('  ' + (i + 1) + '. ' + c.offeringId + ' (score: ' + displayScore + ')');
    }
    log('Chosen: ' + decision.chosen);
    if (fallback && fallback.chosen) {
      log('Fallback: ' + fallback.chosen);
    }
    if (checkpointFile) {
      log('Checkpoint: ' + checkpointFile);
    }
    exit(0);
    return {
      exitCode: 0,
      decision,
      fallback,
      simulatedFailure,
      checkpoint: nextCheckpoint,
      dryRun: true,
    };
  }

  // Execution with retry/fallback
  const checkpointFile =
    args['checkpoint'] && typeof args['checkpoint'] === 'string'
      ? path.resolve(rootDir, args['checkpoint'])
      : deps && deps.checkpointFile;
  const checkpoint = readCheckpoint(checkpointFile);
  const failedKeys = new Set((checkpoint && checkpoint.failedCandidates) || []);

  const maxAttempts = Number(
    args['max-attempts'] || args.maxAttempts || (deps && deps.maxAttempts) || 3
  );
  let attempt = 0;
  let lastDecision = null;
  const decisionsStore = require('./decisions');
  const failureClassifier = require('./failure-classifier');
  const nowForWriter = (deps && deps.now) || Date.now();

  if (checkpoint && checkpoint.dryRunDispatch && checkpoint.dryRunDispatch.executeTouched) {
    log(`Work item ${item.workItemId} already executed according to checkpoint`);
    return { exitCode: 0 };
  }

  const activeWriter = decisionsStore.writerFor(item.workItemId, {
    dir: decisionDir,
    now: nowForWriter,
  });
  if (activeWriter) {
    log(`Work item ${item.workItemId} is already claimed by session ${activeWriter.sessionId}`);
    exit(1);
    return { exitCode: 1 };
  }

  let finalChosenCandidate = null;
  let finalChosenKey = null;
  let launchRes = null;
  let failedAttempts = [];
  let finalDecisionLog = null;

  if (
    checkpoint &&
    (checkpoint.chosen || checkpoint.selectedCandidate || checkpoint.candidateKey)
  ) {
    finalChosenKey = checkpoint.chosen || checkpoint.selectedCandidate || checkpoint.candidateKey;
    const parsedCheckpoint =
      require('./discovery/identity').parseCandidateKey(finalChosenKey) || {};
    finalChosenCandidate = {
      offeringId: finalChosenKey,
      harness: checkpoint.harness || parsedCheckpoint.harness,
      source: checkpoint.source,
      accessPath: checkpoint.accessPath || parsedCheckpoint.accessPath,
      upstream: checkpoint.upstream || parsedCheckpoint.upstream,
      gateway: checkpoint.gateway || parsedCheckpoint.gateway,
      accountId: checkpoint.accountId || parsedCheckpoint.account,
      quotaScope: checkpoint.quotaScope || parsedCheckpoint.quotaScope,
      modelId: checkpoint.modelId || parsedCheckpoint.modelId,
    };
    log('Resuming checkpointed decision for ' + finalChosenKey);
  }

  while (attempt < maxAttempts) {
    attempt += 1;
    const now = (deps && deps.now) || Date.now();

    if (!finalChosenKey) {
      const evidenceData = evidence.loadEvidence(evidenceDir);
      const annotated = candidatesApi.annotateCandidates(
        eligibleCandidates.map((c) => Object.assign({}, c)),
        evidenceData,
        { now }
      );
      applyHarnessVerification(annotated);

      for (const c of annotated) {
        const key = candidatesApi.candidateKey(c);
        if (failedKeys.has(key)) {
          c.blocked = true;
          c.blockReason = 'candidate failed in current dispatch run';
          c.blockScope = 'candidate';
          continue;
        }
        for (const f of failedAttempts) {
          if (f.key === key) {
            c.blocked = true;
            c.blockReason = 'candidate failed in current dispatch run';
            c.blockScope = 'candidate';
            break;
          }
          if (
            f.classification &&
            f.classification.scope !== 'candidate' &&
            f.classification.scope !== 'model' &&
            sameFailureDomain(c, f.candidate, f.classification)
          ) {
            c.blocked = true;
            c.blockReason = 'avoiding failure domain of previous attempt';
            c.blockScope = f.classification.scope || 'unknown';
            break;
          }
        }
      }

      const rankingContext = {
        workItemId: item.workItemId,
        role: item.role,
        kind: item.role,
        registry,
        evidenceData,
        decisionOpts: { dir: decisionDir, now },
        dryRun: false,
        headrooms: deps && deps.headrooms,
        load: deps && deps.load,
        reservations: deps && deps.reservations,
        explorationBudget:
          args['exploration-budget'] !== undefined ? Number(args['exploration-budget']) : 1,
        home: deps && deps.home,
        storePath: deps && deps.storePath,
        accounts,
        now,
      };

      const decision = ranking.rankAndRecord(annotated, rankingContext);
      lastDecision = decision;

      if (!decision.chosen) {
        log(
          'No eligible candidate for ' +
            item.workItemId +
            ' (attempt ' +
            attempt +
            '/' +
            maxAttempts +
            ')'
        );
        for (const rej of decision.rejected) {
          log(
            '  EXCLUDED ' +
              rej.offeringId +
              ' — ' +
              rej.reason +
              (rej.scope ? ' [' + rej.scope + ']' : '')
          );
        }
        exit(1);
        return { exitCode: 1, decision, attempts: attempt };
      }

      finalChosenKey = decision.chosen;
      finalChosenCandidate = annotated.find(
        (c) => candidatesApi.candidateKey(c) === finalChosenKey
      ) || {
        offeringId: finalChosenKey,
        harness: decision.harness,
      };

      finalDecisionLog = {
        item,
        now,
        annotated,
        decision: decision,
        fallback: {},
        quotaState: annotated.map((c) => quotaSnapshot(c)),
        headrooms: deps && deps.headrooms,
        resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
        candidatesApi,
      };
      if (checkpointFile) writeJsonFile(checkpointFile, buildDryRunLog(finalDecisionLog));
    }

    if (isPinned) log('PINNED');
    log(
      'Dispatching ' +
        item.workItemId +
        ' to ' +
        finalChosenKey +
        ' (attempt ' +
        attempt +
        '/' +
        maxAttempts +
        ')'
    );

    const reservationOpts = { home: deps && deps.home, storePath: deps && deps.storePath, now };
    quotaStore.recordReservation(
      item.workItemId,
      item.role,
      finalChosenCandidate.accountId || '*',
      finalChosenKey,
      100000,
      reservationOpts
    );

    let thrownError = null;
    let isFailure = true;
    let sessionHandle = null;
    try {
      let launcher = (deps && deps.run) || runHarness;
      // AI-64-P03: an injected runner replaces what runs the harness process; it
      // never decides whether the worker boundary exists. The old guard let a
      // caller that injected a runner switch isolation off silently, with no log
      // line, which is a control that only holds in the configuration nobody
      // tests.
      if (args['isolated-worker']) {
        launcher = require('./isolation-launcher').getIsolatedLauncher();
      }

      const harnessName =
        finalChosenCandidate.harness || (lastDecision && lastDecision.harness) || 'paseo';
      const adapter = getHarness(harnessName);
      const route = sourcesApi.dispatchRoute(
        finalChosenCandidate.source ||
          finalChosenCandidate.upstream ||
          finalChosenCandidate.gateway,
        registry
      );
      const candidateKey = candidatesApi.candidateKey(finalChosenCandidate);
      if (candidateKey !== finalChosenKey) {
        throw new Error('CANDIDATE_KEY_CHANGED_BEFORE_LAUNCH');
      }

      // The loop hands the harness a durable-report path. Under `-z` stdout is
      // the final response prose, so the session id can only come from the
      // report (TASK-AI-63), and a launch that cannot produce one is a launch
      // that cannot be resumed.
      const usageFile = usageReportFile(args, deps, item, now);
      let launchArgs = null;
      try {
        launchArgs = adapter.launch({
          candidateKey: finalChosenKey,
          provider:
            (route && route.provider) ||
            finalChosenCandidate.source ||
            finalChosenCandidate.upstream,
          model: sourcesApi.qualifyModel(finalChosenCandidate.modelId, route),
          accountId: finalChosenCandidate.accountId,
          gateway: finalChosenCandidate.gateway || '',
          upstream: finalChosenCandidate.upstream,
          quotaScope: finalChosenCandidate.quotaScope,
          prompt: defaultPrompt(item, { isolatedWorker: Boolean(args['isolated-worker']) }),
          branch: item.branch,
          base: args.base || (deps && deps.base) || 'main',
          cwd: args.cwd || (deps && deps.cwd) || rootDir,
          usageFile: usageFile,
          checkpoint: checkpointFile,
          maxAttempts: 1,
          title: workerName(item.workItemId),
          labels: {
            workItem: item.workItemId,
            role: item.role,
            project: args.project || 'shipde-platform',
          },
        });
      } catch (err) {
        log('Harness launch preparation failed: ' + (err.message || String(err)));
        thrownError = err;
        launchRes = {
          exitCode: err.exitCode !== undefined ? err.exitCode : 1,
          stdout: '',
          stderr: err.stderr || err.message || String(err),
          error: err,
        };
      }

      if (launchArgs && !Array.isArray(launchArgs)) {
        const reason =
          launchArgs.reason || launchArgs.refusal || launchArgs.error || 'LAUNCH_REFUSED';
        log('Harness launch refused: ' + reason);
        thrownError = new Error(reason);
        launchRes = {
          exitCode: launchArgs.exitCode !== undefined ? launchArgs.exitCode : 1,
          stdout: '',
          stderr: reason,
          error: thrownError,
        };
        launchArgs = null;
      }

      if (launchArgs) {
        try {
          decisionsStore.recordDecision(
            {
              stage:
                checkpoint && checkpoint.chosen
                  ? decisionsStore.Stage.RESUMED
                  : decisionsStore.Stage.LAUNCHED,
              workItemId: item.workItemId,
              role: item.role,
              chosen: finalChosenKey,
              harness: harnessName,
              branch: item.branch,
              // The claim on the branch, written before the launch. It is a claim,
              // not a handle: the durable session id is only knowable once the
              // harness has written its report, and it is recorded on the line
              // below. It was `process.pid` here, which is a Node process id and
              // not a session — decisions.js then treated that value as the
              // session to resume (audit section 4, Gap C).
              sessionId: null,
              worktree: args.cwd || rootDir,
              area: item.area,
              firstChoice: lastDecision ? lastDecision.chosen || finalChosenKey : finalChosenKey,
              selected: finalChosenKey,
              excluded: lastDecision
                ? (lastDecision.rejected || []).map((r) => ({
                    candidateKey: r.offeringId,
                    reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
                    reason: r.reason,
                  }))
                : [],
              quota:
                lastDecision && lastDecision.candidates
                  ? lastDecision.candidates.map((c) => ({
                      candidateKey: c.offeringId,
                      score: c.score,
                      headroom: c.headroom,
                    }))
                  : [],
              resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
              checkpoint: checkpointFile,
            },
            { dir: decisionDir, now }
          );
        } catch (err) {
          log('Failed to append LAUNCHED to decision log');
          exit(1);
          return { exitCode: 1, error: err };
        }

        try {
          launchRes = launcher(adapter, launchArgs, {
            cwd: args.cwd || rootDir,
            // The pinned base the worker root is provisioned at (AI-64-R15).
            baseSha: args['base-sha'] || (deps && deps.baseSha) || undefined,
            branch: item.branch,
            workItemId: item.workItemId,
            // TASK-AI-127 WD-R03: WORKER_DEPS_UNAVAILABLE warnings land in the
            // same decision log this dispatch records its launch in.
            decisionDir,
            checkpoint: checkpointFile,
          });
        } catch (err) {
          thrownError = err;
          launchRes = {
            exitCode: err.exitCode !== undefined ? err.exitCode : -1,
            stdout: '',
            stderr: err.stderr || err.message || String(err),
            error: err,
          };
        }
      }

      if (deps && deps.rethrow && thrownError) {
        throw thrownError;
      }

      isFailure =
        thrownError !== null ||
        !launchRes ||
        launchRes.exitCode !== 0 ||
        (typeof launchRes.httpStatus === 'number' && launchRes.httpStatus >= 400);

      // The durable handle, read from the report the launch was given. Never a
      // pid, a timestamp or a stdout guess.
      sessionHandle = readSessionId(adapter, { usageFile: usageFile }, launchRes || {}).id;
      if (usageFile && !sessionHandle) {
        // The caller asked for a durable report and the report carries no
        // session id, so this launch cannot be resumed or stopped. A launch the
        // loop cannot find again is a failed launch (AI-64-R04), not a success
        // with a null handle.
        isFailure = true;
      }
      if (sessionHandle) {
        // The claim now carries the session it is a claim about, so a restart
        // resumes that session instead of starting a second writer.
        decisionsStore.recordDecision(
          {
            stage: decisionsStore.Stage.LAUNCHED,
            workItemId: item.workItemId,
            role: item.role,
            chosen: finalChosenKey,
            harness: harnessName,
            branch: item.branch,
            sessionId: sessionHandle,
            worktree: args.cwd || rootDir,
            area: item.area,
            detail: 'DURABLE_SESSION_ID',
          },
          { dir: decisionDir, now }
        );
      }

      const parsed = launchRes && launchRes.stdout ? parseLastJson(launchRes.stdout) : null;
      if (
        parsed &&
        parsed.status &&
        /fail|error|refus|stalled|timeout/i.test(String(parsed.status))
      ) {
        isFailure = true;
      }

      try {
        decisionsStore.recordDecision(
          {
            stage: isFailure ? decisionsStore.Stage.FAILED : decisionsStore.Stage.COMPLETED,
            workItemId: item.workItemId,
            role: item.role,
            chosen: finalChosenKey,
            harness: harnessName,
            branch: item.branch,
            sessionId: sessionHandle,
            worktree: args.cwd || rootDir,
            area: item.area,
            outcome: isFailure ? 'failed' : 'passed',
            detail: usageFile && !sessionHandle ? 'HARNESS_NO_SESSION_ID' : null,
            firstChoice: lastDecision ? lastDecision.chosen || finalChosenKey : finalChosenKey,
            selected: finalChosenKey,
            excluded: lastDecision
              ? (lastDecision.rejected || []).map((r) => ({
                  candidateKey: r.offeringId,
                  reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
                  reason: r.reason,
                }))
              : [],
            quota:
              lastDecision && lastDecision.candidates
                ? lastDecision.candidates.map((c) => ({
                    candidateKey: c.offeringId,
                    score: c.score,
                    headroom: c.headroom,
                  }))
                : [],
            resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
            checkpoint: checkpointFile,
          },
          { dir: decisionDir, now }
        );
      } catch (err) {}
    } finally {
      quotaStore.releaseReservation(item.workItemId, finalChosenKey, reservationOpts);
    }

    if (checkpointFile && finalDecisionLog) {
      const finalLogData = buildDryRunLog(finalDecisionLog);
      finalLogData.dryRunDispatch.executeTouched = true;
      finalLogData.dryRunDispatch.launched = true;
      finalLogData.outcome = isFailure ? 'failed' : 'passed';
      try {
        writeJsonFile(checkpointFile, finalLogData);
      } catch (err) {}
    }

    if (!isFailure) {
      evidence.recordOutcome(evidenceDir, finalChosenCandidate, {
        status: 'passed',
        level: evidence.Level.OUTCOME,
        exitCode: 0,
        source: 'dispatch',
      });
      log('Dispatch succeeded on ' + finalChosenKey);
      exit(0);
      return { exitCode: 0, chosen: finalChosenKey, result: launchRes, attempts: attempt };
    } else {
      evidence.recordOutcome(evidenceDir, finalChosenCandidate, {
        status: 'failed',
        level: evidence.Level.OUTCOME,
        exitCode: launchRes ? launchRes.exitCode : -1,
        httpStatus: launchRes ? launchRes.httpStatus : undefined,
        body: launchRes
          ? launchRes.body || launchRes.stderr || launchRes.stdout
          : thrownError && thrownError.message,
        stderr: launchRes ? launchRes.stderr : thrownError && thrownError.message,
        cause: launchRes ? launchRes.body || launchRes.stderr : thrownError && thrownError.message,
        error: thrownError ? thrownError.message || String(thrownError) : undefined,
        source: 'dispatch',
      });
      const rawFail = {
        httpStatus: launchRes ? launchRes.httpStatus : undefined,
        body: launchRes
          ? launchRes.body || launchRes.stderr || launchRes.stdout
          : thrownError && thrownError.message,
        stderr: launchRes ? launchRes.stderr : thrownError && thrownError.message,
      };
      const classification = failureClassifier.classifyFailure({
        exitCode: launchRes ? launchRes.exitCode : -1,
        httpStatus: rawFail.httpStatus,
        body: rawFail.body,
        stderr: rawFail.stderr,
        accountId: finalChosenCandidate.accountId,
      });
      const parsedOutcome = launchRes && launchRes.stdout ? parseLastJson(launchRes.stdout) : null;
      const outcome =
        parsedOutcome && parsedOutcome.candidateKey
          ? parsedOutcome
          : structuredOutcome(finalChosenKey, launchRes, classification, {
              status: 'failed',
              checkpoint: checkpointFile,
              reason: rawFail.body || rawFail.stderr || (thrownError && thrownError.message),
            });
      failedAttempts.push({
        key: finalChosenKey,
        candidate: finalChosenCandidate,
        classification: classification,
        outcome,
      });
      const scrubbedStderr = decisionsStore.scrubText(rawFail.stderr);
      log('Candidate failed: ' + finalChosenKey + (scrubbedStderr ? ' — ' + scrubbedStderr : ''));
      finalChosenKey = null; // force re-ranking
      finalChosenCandidate = null;
    }
  }

  log('Max dispatch attempts (' + maxAttempts + ') reached without success.');
  exit(1);
  return { exitCode: 1, decision: lastDecision, attempts: attempt, failedAttempts };
}

const SHADOW_FLAGS = new Set(['project', 'compare', 'json', 'dry-run', 'dryRun']);
const SHADOW_VALUES = new Set(['register', 'shadow']);

/**
 * TASK-AI-33 — projects the register's dependency graph into a local shadow
 * store, or compares a store against the register. The register is never
 * written; every pass proves that by hash.
 *
 * Exit codes: 0 projected or in agreement, 1 divergent or refused.
 */
function shadowCommand(args) {
  const shadow = require('./shadow');
  const refuse = (why) => {
    console.error(why);
    process.exit(1);
  };

  for (const key of Object.keys(args)) {
    if (key === '_') continue;
    if (!SHADOW_FLAGS.has(key) && !SHADOW_VALUES.has(key)) {
      refuse('Tuỳ chọn không nhận ra: --' + key);
    }
    if (SHADOW_VALUES.has(key) && typeof args[key] !== 'string') {
      refuse('--' + key + ' cần một đường dẫn');
    }
  }
  if (args._.length > 1) refuse('Đối số thừa: ' + args._.slice(1).join(' '));
  if (Boolean(args.project) === Boolean(args.compare)) {
    refuse('Chọn đúng một trong --project hoặc --compare');
  }

  const cwd = process.cwd();
  const registerPath = path.resolve(
    cwd,
    args.register ||
      path.join(
        'docs',
        'product-spec',
        'docs',
        '10-ai-collaboration',
        'FEATURE-DELIVERY-REGISTER.csv'
      )
  );
  const shadowPath = path.resolve(cwd, args.shadow || shadow.DEFAULT_SHADOW_PATH);
  const dryRun = Boolean(args['dry-run'] || args.dryRun);
  if (dryRun && args.compare) {
    refuse('--dry-run chỉ dùng với --project; --compare không bao giờ ghi gì');
  }

  let result;
  try {
    result = args.project
      ? shadow.project({ registerPath, shadowPath, dryRun })
      : shadow.compare({ registerPath, shadowPath });
  } catch (err) {
    if (err instanceof shadow.ShadowError) refuse(err.message);
    throw err;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.mode === 'project') {
    console.log(
      (dryRun ? 'Would project ' : 'Projected ') +
        result.nodes +
        ' nodes, ' +
        result.edges +
        ' edges to ' +
        result.shadowPath +
        (result.unchanged ? ' (unchanged)' : '')
    );
  } else if (result.divergences.length === 0) {
    console.log(
      'Shadow agrees with the register: ' +
        result.nodes +
        ' nodes, ' +
        result.edges +
        ' edges, 0 divergences'
    );
  } else {
    for (const d of result.divergences) console.log(d.type + '  ' + d.from + ' -> ' + d.to);
    console.log(
      result.divergences.length +
        ' divergences; fix the shadow or investigate the register, never edit the register to match'
    );
  }

  if (result.mode === 'compare' && result.divergences.length > 0) process.exit(1);
}

/**
 * `discovery import` and `discovery candidates` (TASK-AI-70).
 *
 * The Controller ranked one candidate at a time because the sources and models
 * that work today were never visible to it as data. `import` turns a reviewed
 * model audit into the two stores dispatch already reads, with the proof
 * carried exactly as the audit stated it; `candidates` prints what the two
 * production readers produce, so "what does the Controller see" is inspectable
 * without dispatching anything.
 *
 * `import` is the only writer here and it writes only where it is told: the
 * discovery ledger and import file under `--discovery-dir`, and the evidence
 * store under `--evidence-dir`. It performs no network call, reads no
 * credential, and never fabricates or promotes a proof.
 */
function discoveryCommand(args, deps) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const fsx = require('fs');
  const { listAccounts } = require('./accounts');
  const sub = args._[1] || 'candidates';
  const dataDir = args['discovery-dir'] || path.join(__dirname, 'data', 'discovery');
  const evidenceDir = args['evidence-dir'] || path.join(__dirname, 'data', 'evidence');
  const rootDir = args.root || d.rootDir || process.cwd();

  if (sub === 'import') {
    const { importCatalogue, formatSummary } = require('./discovery/catalogue-import');
    if (typeof args.catalogue !== 'string' || !args.catalogue) {
      error('discovery import requires --catalogue <audit catalogue.jsonl>');
      exit(2);
      return { exitCode: 2 };
    }
    const filePath = path.resolve(rootDir, args.catalogue);
    if (!fsx.existsSync(filePath)) {
      error('CATALOGUE_MISSING: ' + filePath);
      exit(2);
      return { exitCode: 2 };
    }
    const accounts = Array.isArray(d.accounts) ? d.accounts : listAccounts() || [];
    let summary;
    try {
      summary = importCatalogue({
        filePath,
        accounts,
        dataDir,
        evidenceDir,
        home: args.home || d.home,
        dryRun: args['dry-run'] === true || args.dryRun === true,
        now: d.now,
      });
    } catch (err) {
      error('CATALOGUE_UNREADABLE: ' + (err && err.message ? err.message : err));
      exit(2);
      return { exitCode: 2 };
    }
    if (summary.refused) {
      error('CATALOGUE_REFUSED: ' + summary.refused);
      log(formatSummary(summary));
      exit(2);
      return { exitCode: 2, summary };
    }
    if (args.json) log(JSON.stringify(summary, null, 2));
    else log(formatSummary(summary));
    exit(0);
    return { exitCode: 0, summary };
  }

  if (sub !== 'candidates') {
    error('Lệnh không rõ: discovery ' + sub);
    error(
      'Dùng: discovery import --catalogue <file> | discovery candidates [--view dispatch|planner]'
    );
    exit(2);
    return { exitCode: 2 };
  }

  const sourcesApi = require('./sources');
  const candidatesApi = require('./candidates');
  const routing = require('./routing');
  const evidence = require('./evidence');
  const { readDiscoveryCatalogue } = require('./discovery/read');

  const view = typeof args.view === 'string' ? args.view : 'dispatch';
  if (view !== 'dispatch' && view !== 'planner') {
    error('UNKNOWN_VIEW: ' + view + ' (expected dispatch or planner)');
    exit(2);
    return { exitCode: 2 };
  }

  let accounts;
  if (typeof args.accounts === 'string') {
    accounts = readJsonOrExit(path.resolve(rootDir, args.accounts), 'accounts');
    if (!Array.isArray(accounts)) {
      error('ACCOUNTS_INVALID: --accounts must hold a JSON array');
      exit(2);
      return { exitCode: 2 };
    }
  } else if (Array.isArray(d.accounts)) {
    accounts = d.accounts;
  } else {
    accounts = listAccounts() || [];
  }

  const registry = sourcesApi.loadSources();
  let discCat = { candidates: [] };
  try {
    discCat = readDiscoveryCatalogue({ dataDir });
  } catch {
    discCat = { candidates: [] };
  }
  let evidenceData = {};
  try {
    evidenceData = evidence.loadEvidence(evidenceDir);
  } catch {
    evidenceData = {};
  }

  const poolRuntimeDir = args['pool-runtime-dir'] || args['agy-runs-dir'] || undefined;
  const home = args.home || d.home;
  const catalogueIds = discCat.candidates.map((c) => c.modelId).filter(Boolean);
  const candidates =
    view === 'planner'
      ? candidatesApi.generateCandidates({
          registry,
          accounts,
          catalogue: catalogueIds,
          home,
          fakeRunsDir: poolRuntimeDir,
          discoverPool: Boolean(poolRuntimeDir),
        })
      : assembleForDispatch(discCat, accounts, registry, {
          evidenceData,
          home,
          fakeRunsDir: poolRuntimeDir,
          discoverPool: Boolean(poolRuntimeDir),
        });

  const annotated = candidatesApi.annotateCandidates(
    candidates.map((c) => Object.assign({}, c)),
    evidenceData,
    { now: d.now }
  );
  const rows = annotated.map((c) => ({
    candidateKey: candidatesApi.candidateKey(c),
    harness: c.harness || '',
    accessPath: c.accessPath || '',
    gateway: c.gateway || '',
    upstream: c.upstream || '',
    account: c.accountId || '*',
    quotaScope: c.quotaScope || '',
    modelId: c.modelId || c.model || '',
    proof: routing.proofObserved(evidenceData, c) || null,
    failureDomain: routing.failureDomainOf(c),
    blocked: Boolean(c.blocked),
  }));

  if (args.json) {
    log(
      JSON.stringify(
        { view, discoveryDir: dataDir, evidenceDir, count: rows.length, candidates: rows },
        null,
        2
      )
    );
  } else {
    log('Discovery candidates (' + view + ' view): ' + rows.length);
    for (const r of rows) {
      log(
        '  ' +
          r.candidateKey +
          ' | proof ' +
          (r.proof || 'unproven') +
          ' | failure-domain ' +
          r.failureDomain +
          ' | account ' +
          r.account
      );
    }
  }
  if (exit === process.exit) process.exitCode = 0;
  else exit(0);
  return { exitCode: 0, view, candidates: rows };
}

/**
 * evidence import-work (TASK-AI-75): turn real merged, independently reviewed
 * work into WORK_ITEM_PASS evidence. Never fabricates.
 *
 *   node tools/ai-brain/cli.js evidence import-work \
 *     --sha <40-hex> \
 *     --manifest <path to review-manifest.json> \
 *     --writer <7-part candidateKey harness::accessPath::gateway::upstream::account::quotaScope::modelId> \
 *     --review <path to review md> \
 *     --reviewer <reviewer identity string> \
 *     --work-item <id> \
 *     [--pr-head <40-hex>] \
 *     [--main-ref origin/main] \
 *     [--evidence-dir <dir>] \
 *     [--json]
 *
 * TASK-AI-77: --manifest is what authorises the import. It is refused as
 * MANIFEST_REQUIRED (exit 1) rather than as bad argv, so a caller that forgot it
 * sees why instead of a usage error.
 */
function evidenceCommand(args, deps) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const rootDir = args.root || d.rootDir || process.cwd();
  const sub = args._[1];

  if (sub === 'import-evaluation') {
    const file = args.file;
    if (typeof file !== 'string' || file.trim() === '') {
      error('evidence import-evaluation requires --file <path>');
      error(
        'Dùng: evidence import-evaluation --file <path> [--evidence-dir <dir>] [--dry-run] [--json]'
      );
      exit(2);
      return { exitCode: 2 };
    }
    const { importEvaluation } = require('./evaluation-import');
    const dir =
      args['evidence-dir'] ||
      args.evidenceDir ||
      d.evidenceDir ||
      path.join(__dirname, 'data', 'evidence');
    let result;
    try {
      result = importEvaluation({ file, evidenceDir: dir, dryRun: Boolean(args['dry-run']) });
    } catch (err) {
      error('REFUSED: ' + ((err && err.code) || 'ERROR') + ' - ' + ((err && err.message) || err));
      exit(1);
      return { exitCode: 1 };
    }
    const counts = result.counts || result;
    const rejected = Array.isArray(counts.rejected) ? counts.rejected.length : counts.rejected || 0;
    if (args.json) {
      log(
        JSON.stringify({
          ok: true,
          counts: {
            importedAlive: counts.importedAlive,
            cooldownsSet: counts.cooldownsSet,
            skipped: counts.skipped,
            rejected,
          },
        })
      );
    } else {
      log('imported alive ' + counts.importedAlive);
      log('cooldowns set ' + counts.cooldownsSet);
      log('skipped ' + counts.skipped);
      log('rejected ' + rejected);
    }
    exit(0);
    return { exitCode: 0, result };
  }

  if (sub !== 'import-work') {
    error('Lệnh không rõ: evidence ' + (sub || ''));
    error(
      'Dùng: evidence import-work --sha <40-hex> --manifest <file> --writer <key> --review <file> --reviewer <identity> --work-item <id> [--pr-head <sha>] [--main-ref <ref>] [--evidence-dir <dir>] [--json]'
    );
    error(
      'Dùng: evidence import-evaluation --file <path> [--evidence-dir <dir>] [--dry-run] [--json]'
    );
    exit(2);
    return { exitCode: 2 };
  }

  const sha = args.sha;
  const writer = args.writer;
  const review = args.review;
  const reviewer = args.reviewer;
  const workItem = args['work-item'] || args.workItem;

  if (
    typeof sha !== 'string' ||
    !sha ||
    typeof writer !== 'string' ||
    !writer ||
    typeof review !== 'string' ||
    !review ||
    typeof reviewer !== 'string' ||
    !reviewer ||
    typeof workItem !== 'string' ||
    !workItem
  ) {
    error('evidence import-work requires --sha, --writer, --review, --reviewer, --work-item');
    exit(2);
    return { exitCode: 2 };
  }

  const { importWorkItemPass } = require('./work-evidence');
  const evidenceDir =
    args['evidence-dir'] ||
    args.evidenceDir ||
    d.evidenceDir ||
    path.join(__dirname, 'data', 'evidence');
  const mainRef = args['main-ref'] || args.mainRef || 'origin/main';
  const reviewPath = path.isAbsolute(review) ? review : path.resolve(rootDir, review);

  const result = importWorkItemPass({
    sha,
    writer,
    review: reviewPath,
    manifest: args.manifest || args['manifest-path'] || null,
    prHead: args['pr-head'] || args.prHead || null,
    reviewer,
    workItem,
    mainRef,
    evidenceDir,
    cwd: rootDir,
  });

  if (!result.ok) {
    if (args.json) {
      log(JSON.stringify(result, null, 2));
    } else {
      error('REFUSED: ' + result.code + (result.reason ? ' - ' + result.reason : ''));
    }
    exit(1);
    return { exitCode: 1, result };
  }

  if (args.json) {
    log(JSON.stringify(result, null, 2));
  } else {
    if (result.status === 'ALREADY_RECORDED') {
      log('ALREADY_RECORDED: ' + result.candidateKey + ' sha ' + result.sha);
    } else {
      log(
        'IMPORTED: ' + result.candidateKey + ' sha ' + result.sha + ' proof ' + result.mergeProof
      );
    }
  }
  exit(0);
  return { exitCode: 0, result };
}

/**
 * review manifest validate (TASK-AI-77): check a structured review manifest
 * against git and against the markdown review it accompanies, before anything is
 * published or promoted on the strength of it.
 *
 *   node tools/ai-brain/cli.js review manifest validate \
 *     --manifest <path to review-manifest.json> --artifact <path to the review> \
 *     --work-item <id> --sha <40-hex reviewed commit> [--json]
 *
 * Exit 0 when the manifest is a faithful binding, 1 when it is refused (the
 * refusal code is printed), 2 on bad argv.
 */
function reviewCommand(args, deps) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const rootDir = args.root || d.rootDir || process.cwd();
  const sub = args._[1];
  const action = args._[2];

  if (sub !== 'manifest' || action !== 'validate') {
    error('Lệnh không rõ: review ' + [sub, action].filter(Boolean).join(' '));
    error(
      'Dùng: review manifest validate --manifest <file> --artifact <file.md> --work-item <id> --sha <40-hex> [--json]'
    );
    if (exit === process.exit) process.exitCode = 2;
    else exit(2);
    return { exitCode: 2 };
  }

  const manifest = args.manifest;
  const artifact = args.artifact;
  const workItem = args['work-item'] || args.workItem;
  const sha = args.sha;
  const missing = [manifest, artifact, workItem, sha].some(
    (value) => typeof value !== 'string' || value.trim() === ''
  );
  if (missing) {
    error('review manifest validate requires --manifest, --artifact, --work-item, --sha');
    if (exit === process.exit) process.exitCode = 2;
    else exit(2);
    return { exitCode: 2 };
  }

  const { validateManifestFile } = require('./review-manifest');
  const resolveArg = (value) => (path.isAbsolute(value) ? value : path.resolve(rootDir, value));
  const result = validateManifestFile(resolveArg(manifest), {
    repoCwd: rootDir,
    expected: { workItemId: workItem, commit: sha },
    artifactPath: resolveArg(artifact),
  });

  if (args.json) {
    log(JSON.stringify(result, null, 2));
  } else if (!result.ok) {
    error('REFUSED: ' + result.code + (result.reason ? ' - ' + result.reason : ''));
  } else {
    log(
      'OK: ' +
        result.workItemId +
        ' ' +
        result.reviewedCommit +
        ' verdict ' +
        result.verdict +
        ' (' +
        result.openFindings +
        ' open finding(s))'
    );
  }

  const code = result.ok ? 0 : 1;
  if (exit === process.exit) process.exitCode = code;
  else exit(code);
  return { exitCode: code, result };
}

/**
 * orchestrate (TASK-AI-64, TASK-AI-85): the live autonomous loop —
 *   node tools/ai-brain/cli.js orchestrate --goal <text|file> --specs <file>
 *     [--isolated-worker --base-sha <40-hex>] [--checkpoint <file>] [--out <file>]
 *     [--evidence-dir <dir>] [--worker-timeout-min <1..240>]
 */
async function orchestrateCommand(args, deps = {}) {
  const d = deps || {};
  const { runOrchestration } = d.runOrchestration ? d : require('./orchestrate');
  const { generateCandidates } = require('./candidates');
  const sourcesApi = require('./sources');
  const decisionsApi = require('./decisions');
  const fsx = require('fs');
  const log = d.log || console.log;
  const exit = d.exit || process.exit;
  let goal = typeof args.goal === 'string' ? args.goal : null;
  if (!goal) {
    console.error('orchestrate requires --goal <text|file>');
    exit(2);
    return Promise.resolve({ exitCode: 2 });
  }
  if (fsx.existsSync(goal)) goal = fsx.readFileSync(goal, 'utf8');
  if (typeof args.specs !== 'string') {
    console.error('orchestrate requires --specs <file>: the real work-item specs, as a JSON array');
    exit(2);
    return Promise.resolve({ exitCode: 2 });
  }
  const specDoc = JSON.parse(fsx.readFileSync(args.specs, 'utf8'));
  const specs = Array.isArray(specDoc) ? specDoc : specDoc.specs;
  if (!Array.isArray(specs) || specs.length === 0) {
    console.error('orchestrate: --specs carried no work items');
    exit(2);
    return Promise.resolve({ exitCode: 2 });
  }
  const out = typeof args.out === 'string' ? args.out : null;
  // TASK-AI-121 LF-R03: --worker-timeout-min N (1..240, default 30) is the
  // worker timeout every isolated launch (writer, reviewer, repair) uses.
  // A value outside the range is a typo, and a typo is refused rather than
  // clamped into a timeout nobody asked for.
  const workerTimeoutMinRaw = args['worker-timeout-min'];
  let workerTimeoutMs = 30 * 60 * 1000;
  if (workerTimeoutMinRaw !== undefined) {
    const minutes = Number(workerTimeoutMinRaw);
    if (
      workerTimeoutMinRaw === true ||
      workerTimeoutMinRaw === '' ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 240
    ) {
      console.error('orchestrate: --worker-timeout-min must be an integer between 1 and 240');
      exit(2);
      return Promise.resolve({ exitCode: 2 });
    }
    workerTimeoutMs = minutes * 60 * 1000;
  }
  const registry = (d && d.registry) || sourcesApi.loadSources();
  const readJsonArg = (value) =>
    typeof value === 'string' && value ? JSON.parse(fsx.readFileSync(value, 'utf8')) : null;
  const inputAccounts = readJsonArg(args.accounts) || (Array.isArray(d.accounts) ? d.accounts : []);
  const poolEnabled =
    typeof args['external-workers'] === 'string' &&
    args['external-workers']
      .split(',')
      .map((s) => s.trim())
      .includes('agy-pool');
  const catSourcesPath =
    args['catalogue-sources'] ||
    (typeof args.catalogue === 'string' &&
    fsx.existsSync(path.join(path.dirname(args.catalogue), 'catalogue-sources.json'))
      ? path.join(path.dirname(args.catalogue), 'catalogue-sources.json')
      : null);
  const sourceModels = readJsonArg(catSourcesPath) || undefined;
  const discDir =
    (d && d.discoveryDataDir) || args['discovery-dir'] || path.join(__dirname, 'data', 'discovery');
  let discoveryCatalogue = null;
  if (fsx.existsSync(discDir)) {
    try {
      const { readDiscoveryCatalogue } = require('./discovery/read');
      discoveryCatalogue = readDiscoveryCatalogue({ dataDir: discDir });
    } catch {}
  }
  const candidates = Array.isArray(d.candidates)
    ? d.candidates
    : generateCandidates({
        registry,
        catalogue: readJsonArg(args.catalogue) || [],
        sourceModels,
        discoveryCatalogue,
        accounts: inputAccounts,
        externalWorkers: args['external-workers'],
        openCodeIds: Array.isArray(args['opencode-ids'])
          ? args['opencode-ids']
          : typeof args['opencode-ids'] === 'string'
            ? args['opencode-ids'].split(',').filter(Boolean)
            : [],
      });
  const pool = require('./agy-pool-runtime');
  const discoveryWarning = poolEnabled ? pool.getLastDiscoveryWarning() : null;
  if (discoveryWarning && typeof console !== 'undefined' && console.warn) {
    console.warn(`[agy-pool] discovery warning: ${discoveryWarning}`);
  }
  const evidenceDir =
    typeof args['evidence-dir'] === 'string' && args['evidence-dir']
      ? args['evidence-dir']
      : path.join(__dirname, 'data', 'evidence');
  const registryAccounts = Array.isArray(d.registryAccounts)
    ? d.registryAccounts
    : typeof d.listAccounts === 'function'
      ? d.listAccounts()
      : require('./accounts').listAccounts();
  const evidenceAccounts = mergeEvidenceAccounts(inputAccounts, registryAccounts);
  if (d.refreshRoutes === true) {
    const healthFile =
      args['route-health'] ||
      args.routeHealthFile ||
      d.routeHealthFile ||
      d['route-health'] ||
      (args.root
        ? path.join(args.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
        : null) ||
      path.join(__dirname, 'data', 'model-route-health.json');
    const healthStore = require('./route-health').loadStore(healthFile, { allowMissing: true });
    const routeHealthApi = require('./route-health');
    const probeRoute =
      d.probeRoute ||
      ((model, route, probeOptions) =>
        routeHealthApi.probeGatewayModel(model, route, Object.assign({ registry }, probeOptions)));
    await routeHealthApi.recheckBeforeSelection(healthStore, probeRoute, {
      now: d.now,
      cap: d.probeCap,
      timeoutMs: d.probeTimeoutMs,
      catalogue: readJsonArg(args.catalogue) || [],
      registry,
      accounts: inputAccounts,
    });
    routeHealthApi.saveStore(healthFile, healthStore);
    d.refreshRoutes = false;
  }
  let tokenBudgets = null;
  if (typeof args['token-budgets'] === 'string') {
    try {
      tokenBudgets = JSON.parse(fsx.readFileSync(args['token-budgets'], 'utf8'));
    } catch (err) {
      console.error(
        `orchestrate: failed to parse token budgets from ${args['token-budgets']}: ${err.message}`
      );
      exit(2);
      return Promise.resolve({ exitCode: 2 });
    }
  } else if (args['isolated-worker']) {
    tokenBudgets = require('./intake').DEFAULT_TOKEN_BUDGETS;
  }
  // The live loop is async (TASK-AI-65): the JEV assessment behind every
  // Controller selection returns a promise. An unhandled rejection would crash
  // silently, so it is caught here and turned into a non-zero exit instead.
  return runOrchestration(goal, {
    specs,
    refreshWriterModels:
      d.refreshWriterModels ??
      (!Array.isArray(d.candidates) &&
        !d.registry &&
        typeof d.run !== 'function' &&
        typeof d.runOrchestration !== 'function'),
    fetchModels: d.fetchModels,
    env: d.env,
    specText: typeof args['spec-text'] === 'string' ? args['spec-text'] : null,
    candidates,
    accounts: evidenceAccounts,
    registryAccounts,
    registry,
    catalogue: readJsonArg(args.catalogue) || [],
    sourceModels,
    discoveryCatalogue,
    evidenceDir,
    run: d.run,
    tests: d.tests,
    reviewer: d.reviewer,
    measureFailBefore: d.measureFailBefore,
    home: typeof args.home === 'string' ? args.home : undefined,
    enforceProofFloors: true,
    isolatedWorker: Boolean(args['isolated-worker']),
    externalWorkers: args['external-workers'],
    routeHealthFile: args['route-health'] || d.routeHealthFile,
    workerTimeoutMs,
    ...(args.rtk ? { rtk: args.rtk } : {}),
    ...(tokenBudgets ? { tokenBudgets } : {}),
    ...(typeof args['context-manifest'] === 'string'
      ? { contextManifest: args['context-manifest'] }
      : {}),
    ...(args['isolated-worker'] || args['context-manifest'] ? { enableContextPack: true } : {}),
    ...(typeof d.run === 'function' ? { injectedRun: true } : {}),
    decisionDir: args['decision-dir'] || decisionsApi.DEFAULT_DIR,
    checkpointFile: typeof args.checkpoint === 'string' ? args.checkpoint : null,
    usageDir: typeof args['usage-dir'] === 'string' ? args['usage-dir'] : null,
    sha: typeof args.sha === 'string' ? args.sha : (d && d.sha) || null,
    baseSha: typeof args['base-sha'] === 'string' ? args['base-sha'] : (d && d.baseSha) || null,
    branch: typeof args.branch === 'string' ? args.branch : null,
    cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
    workerRoot: typeof args['worker-root'] === 'string' ? args['worker-root'] : null,
    exercise: typeof args.exercise === 'string' ? args.exercise : null,
    reviewBudget: args['review-budget'],
    // TASK-AI-122 PI-R02: --approval accepts several comma-separated ids, one
    // per reviewed commit. PI-R03: the draft title comes from each item's own
    // spec at publish time, never from specs[0] or the run-level goal.
    publication: args.publish
      ? {
          approvalIds: String(args.approval || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
          expiry: args['approval-expiry'] ? Date.parse(args['approval-expiry']) : undefined,
          remoteUrl: args['remote-url'],
          branch: typeof args.branch === 'string' ? args.branch : null,
          draft: {},
        }
      : null,
    autoMerge: Boolean(args['auto-merge'] || args.merge),
    mergeConfig: args['merge-config'] || args.config,
    out,
    now: (d && d.now) || Date.now(),
  })
    .then((result) => {
      if (result.status !== 'COMPLETED' && result.status !== 'PUBLISHED_DRAFT') {
        for (const entry of result.outcomes || []) {
          if (entry.reason)
            console.error(decisionsApi.scrubText(`${entry.workItemId}: ${entry.reason}`));
        }
      }
      log(
        JSON.stringify(
          {
            goal,
            status: result.status,
            plan: result.plan,
            refusal: result.refusal || null,
            reconciliation: result.reconciliation,
            publication: result.publication,
          },
          null,
          2
        )
      );
      if (out) log('Wrote run log to ' + out);
      const exitCode = result.status === 'COMPLETED' || result.status === 'PUBLISHED_DRAFT' ? 0 : 1;
      exit(exitCode);
      return Object.assign({ exitCode }, result);
    })
    .catch((err) => {
      console.error(
        'Orchestrate lỗi: ' +
          (err && err.name ? err.name + ': ' : '') +
          (err && err.message ? err.message : err)
      );
      exit(1);
      return { exitCode: 1, error: err };
    });
}

function tokenReportCommand(args, deps = {}) {
  const fsx = (deps && deps.fs) || require('fs');
  const dir = typeof args.dir === 'string' ? args.dir : path.join(__dirname, 'data', 'usage');
  const records = [];
  const decisionsDir = typeof args['decision-dir'] === 'string' ? args['decision-dir'] : null;
  if (decisionsDir && fsx.existsSync(decisionsDir)) {
    const decisionLog = require('./decisions');
    for (const name of decisionLog.decisionFiles(decisionsDir)) {
      for (const { line } of decisionLog.decisionLines(path.join(decisionsDir, name), fsx)) {
        try {
          const row = JSON.parse(line);
          if (!row.tokenUsage) continue;
          records.push({
            workItem: row.workItemId || 'unknown',
            model: row.model || 'unknown',
            input: Number(row.tokenUsage.input || 0),
            cacheRead: Number(row.tokenUsage.cacheRead || 0),
            output: Number(row.tokenUsage.output || 0),
          });
        } catch (_) {
          /* Ignore a truncated final line. */
        }
      }
    }
  }
  function visit(folder) {
    if (!fsx.existsSync(folder)) return;
    for (const name of fsx.readdirSync(folder)) {
      const file = path.join(folder, name);
      let stat;
      try {
        stat = fsx.statSync(file);
      } catch (_) {
        continue;
      }
      if (stat.isDirectory()) visit(file);
      else if (name.endsWith('.json')) {
        try {
          const row = JSON.parse(fsx.readFileSync(file, 'utf8'));
          const usage = row.usage || row;
          records.push({
            workItem: row.workItemId || row.work_item_id || name.replace(/-\\d+.*$/, ''),
            model: row.model || row.modelId || 'unknown',
            input: Number(usage.input_tokens ?? usage.input ?? 0) || 0,
            cacheRead:
              Number(usage.cache_read_tokens ?? usage.cacheRead ?? usage.cache_read ?? 0) || 0,
            output: Number(usage.output_tokens ?? usage.output ?? 0) || 0,
          });
        } catch (_) {
          /* Ignore incomplete session exports. */
        }
      }
    }
  }
  visit(dir);
  const totals = new Map();
  for (const row of records) {
    for (const group of ['model', 'workItem']) {
      const key = row[group];
      const current = totals.get(group + ':' + key) || {
        group,
        key,
        input: 0,
        cacheRead: 0,
        output: 0,
        sessions: 0,
      };
      current.input += row.input;
      current.cacheRead += row.cacheRead;
      current.output += row.output;
      current.sessions += 1;
      totals.set(group + ':' + key, current);
    }
  }
  const report = { records: records.length, totals: [...totals.values()] };
  if (args.json) (deps.log || console.log)(JSON.stringify(report, null, 2));
  else {
    (deps.log || console.log)('Token usage (' + records.length + ' sessions)');
    for (const row of report.totals)
      (deps.log || console.log)(
        row.group +
          ' ' +
          row.key +
          ': input=' +
          row.input +
          ' cache-read=' +
          row.cacheRead +
          ' output=' +
          row.output +
          ' sessions=' +
          row.sessions
      );
  }
  return report;
}

async function mergeCommand(args) {
  const workItemId = args['work-item'] || args.workItem || args.w;
  if (!workItemId || typeof workItemId !== 'string') {
    console.error('Lỗi: merge yêu cầu cờ --work-item <ID>');
    process.exitCode = 2;
    return { exitCode: 2, error: 'Thiếu --work-item' };
  }

  const { governedMerge } = require('./governed-merge');
  const repoCwd = args['repo-cwd'] || args.root || process.cwd();
  const decisionDir = args['decision-dir'] || args.decisionDir;
  const configPath = args.config || args['config-path'];
  const manifestPath = args.manifest || args['manifest-path'];
  const artifactPath = args.artifact || args['artifact-path'];
  const repo = args.repo;

  try {
    const res = await governedMerge({
      workItemId,
      repoCwd,
      decisionDir,
      configPath,
      manifestPath,
      artifactPath,
      repo,
    });

    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.ok) {
      console.log(
        `Đã merge thành công ${workItemId} tại exact HEAD ${res.headSha} (merge commit: ${res.mergeCommitOid || 'squash'})`
      );
    } else {
      console.error(`Từ chối merge ${workItemId}: ${res.refusal} (${res.reason})`);
    }

    if (!res.ok) {
      process.exitCode = 1;
    }
    return { exitCode: res.ok ? 0 : 1, result: res };
  } catch (err) {
    console.error('Lỗi khi merge: ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
    return { exitCode: 1, error: err };
  }
}

/**
 * intake (TASK-AI-131): one command turns a Work Item ID into a full Controller
 * run with no hand-written inputs —
 *   node tools/ai-brain/cli.js intake --work-item <ID> [--run] [--publish]
 *
 * Every orchestrate input (goal, specs, catalogue, accounts) is built from
 * repository sources only and written to tools/ai-brain/data/intake/<ID>-<ts>/.
 * The orchestrate command comes from policy. Without --run it prints the exact
 * command and the inputs dir; with --run it checks the isolation pre-flight and
 * starts orchestrate. It never invents product meaning: a missing or ambiguous
 * source refuses with INTAKE_INCOMPLETE naming what is missing.
 */
function intakeCommand(args, deps = {}) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const { runIntake } = d.runIntake ? d : require('./intake');

  const workItem = typeof args['work-item'] === 'string' ? args['work-item'] : null;
  const run = Boolean(args.run);
  const publish = Boolean(args.publish);

  return Promise.resolve()
    .then(() => runIntake({ workItem, run, publish }, { liveDiscovery: true, ...d }))
    .then((result) => {
      for (const warning of result.warnings || []) {
        log('CẢNH catalogue source ' + warning.source + ': ' + warning.error);
      }
      if (run) {
        log('Inputs dir: ' + result.runDir);
        log('Started orchestrate with ' + result.command);
        return result;
      }
      log('Inputs dir: ' + result.runDir);
      log('Command: ' + result.command);
      return result;
    })
    .catch((err) => {
      error((err && err.code ? err.code + ': ' : '') + ((err && err.message) || err));
      const code = err && err.code === 'INTAKE_INCOMPLETE' ? 2 : 1;
      if (exit === process.exit) process.exitCode = code;
      else exit(code);
      return { exitCode: code, error: err };
    });
}

function planCommand(args, deps = {}) {
  const id = args['work-item'] || args.workItem;
  if (typeof id !== 'string' || !id.trim()) {
    const error = new Error('plan requires --work-item <ID>');
    error.code = 'PLAN_INVALID_ID';
    return Promise.reject(error);
  }
  const planner = require('./work-item-planner');
  const rootDir = args.root || process.cwd();
  const planningDeps = deps.__planningDepsReady
    ? deps
    : planner.defaultPlanningDeps(rootDir, deps.planningDeps || deps);
  return Promise.resolve(
    planner.planWorkItem(
      id.trim(),
      {
        rootDir,
        run: Boolean(args.run),
      },
      planningDeps
    )
  );
}

function buildQualificationCandidates(rootDir) {
  const fsx = require('fs');
  const intakeRoot = path.join(rootDir, 'tools', 'ai-brain', 'data', 'intake');
  if (!fsx.existsSync(intakeRoot)) return [];
  const intakeRuns = fsx
    .readdirSync(intakeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      mtimeMs: fsx.statSync(path.join(intakeRoot, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (intakeRuns.length === 0) return [];
  const catalogue = [];
  const sourceModels = {};
  const inputAccounts = [];
  for (const intakeRun of intakeRuns) {
    const runDir = path.join(intakeRoot, intakeRun.name);
    try {
      const perSource = JSON.parse(
        fsx.readFileSync(path.join(runDir, 'catalogue-sources.json'), 'utf8')
      );
      for (const [id, ids] of Object.entries(perSource || {})) {
        if (Array.isArray(ids)) sourceModels[id] = (sourceModels[id] || []).concat(ids);
      }
    } catch {
      // Older snapshots carry no per-source listing.
    }
    try {
      catalogue.push(...JSON.parse(fsx.readFileSync(path.join(runDir, 'catalogue.json'), 'utf8')));
      inputAccounts.push(
        ...JSON.parse(fsx.readFileSync(path.join(runDir, 'accounts.json'), 'utf8'))
      );
    } catch {
      // A partial or damaged intake run contributes nothing; other snapshots remain usable.
    }
  }
  const registryAccounts = require('./accounts').listAccounts() || [];
  const accounts = mergeEvidenceAccounts(inputAccounts, registryAccounts);
  const registry = require('./sources').loadSources();
  const candidatesApi = require('./candidates');
  const candidates = candidatesApi.generateCandidates({
    registry,
    catalogue,
    sourceModels,
    accounts,
    externalWorkers: 'agy-pool',
    openCodeIds: accounts.flatMap((account) =>
      (account.models || [])
        .map((model) => (typeof model === 'string' ? model : model.model))
        .filter(Boolean)
    ),
  });
  const evidenceData = require('./evidence').loadEvidence(
    path.join(rootDir, 'tools', 'ai-brain', 'data', 'evidence')
  );
  const annotated = candidatesApi.annotateCandidates(candidates, evidenceData, { now: Date.now() });
  const profile = {
    taskId: 'TASK-AI-141-QUALIFICATION',
    role: 'writer',
    complexity: 'complex',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    contextSize: 32000,
    expectedDuration: 1,
    latencyPriority: 'normal',
    qualityFloor: 0,
    costCeiling: 1000000000,
    requiredHarness: null,
    forbiddenFailureDomains: [],
    resourceCeiling: Number.MAX_SAFE_INTEGER,
    currentWorkload: 0,
  };
  const decision = require('./routing').rankForProfile(
    annotated,
    profile,
    {},
    {
      workItemId: 'TASK-AI-141-QUALIFICATION',
      registry,
      evidenceData,
      explorationBudget: annotated.length,
      accounts,
      now: Date.now(),
      useStoredQuota: true,
    }
  );
  const rejectedByKey = new Map();
  const rankedByKey = new Map((decision.ranking || []).map((row) => [row.candidateKey, row.score]));
  for (const row of decision.rejected || []) {
    const key = row.candidateKey;
    const list = rejectedByKey.get(key) || [];
    list.push(String(row.reasonCode || row.reason || '').split(':')[0]);
    rejectedByKey.set(key, list);
  }
  return annotated
    .map((candidate) => {
      const key = candidatesApi.candidateKey(candidate);
      const reasons = rejectedByKey.get(key) || [];
      if (candidate.blocked === true && !reasons.includes('CANDIDATE_BLOCKED')) {
        reasons.push('CANDIDATE_BLOCKED');
      }
      return Object.assign({}, candidate, {
        candidateKey: key,
        status: reasons.length ? 'rejected' : 'ranked',
        rejectionReasons: reasons,
        controllerRank: rankedByKey.get(key),
        blocked: candidate.blocked === true,
      });
    })
    .filter(
      (candidate) =>
        !candidate.blocked &&
        candidate.rejectionReasons.length === 1 &&
        candidate.rejectionReasons[0] === 'PROOF_FLOOR_NOT_MET'
    )
    .sort((a, b) => {
      const rankDiff = (b.controllerRank || 0) - (a.controllerRank || 0);
      if (rankDiff !== 0) return rankDiff;
      return (
        (Date.parse(b.lastUpdated || b.updatedAt || b.createdAt || 0) || 0) -
        (Date.parse(a.lastUpdated || a.updatedAt || a.createdAt || 0) || 0)
      );
    });
}
function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const command = args._[0] || 'reconcile';

  if (command === 'priors' && args._[1] === 'refresh') {
    const { refreshPriors } = require('./priors');
    const sourceFile =
      args.source ||
      process.env.AI_BRAIN_PRIORS_SOURCE ||
      path.join(__dirname, 'priors-sources', 'public.json');
    if (!sourceFile) {
      console.error(
        'PRIORS_SEARCH_SOURCE_REQUIRED: set AI_BRAIN_PRIORS_SOURCE to a JSON source descriptor'
      );
      process.exitCode = 2;
      return;
    }
    const resolvedSource = path.resolve(sourceFile);
    let realSource = null;
    try {
      realSource = require('fs').realpathSync(resolvedSource);
    } catch {
      console.error('PRIORS_SEARCH_SOURCE_NOT_FOUND');
      process.exitCode = 2;
      return;
    }
    const allowedRoots = [path.resolve(__dirname, 'priors-sources')];
    if (
      !allowedRoots.some((root) => {
        let realRoot = root;
        try {
          realRoot = require('fs').realpathSync(root);
        } catch {}
        return realSource.startsWith(realRoot + path.sep);
      })
    ) {
      console.error('PRIORS_SEARCH_SOURCE_OUTSIDE_ALLOWLIST');
      process.exitCode = 2;
      return;
    }
    let provider;
    try {
      provider = JSON.parse(require('fs').readFileSync(realSource, 'utf8'));
    } catch {
      console.error('PRIORS_SEARCH_SOURCE_INVALID_JSON');
      process.exitCode = 2;
      return;
    }
    if (
      !provider ||
      typeof provider.endpoint !== 'string' ||
      !/^https:\/\//i.test(provider.endpoint)
    ) {
      console.error('PRIORS_SEARCH_SOURCE_INVALID_DESCRIPTOR');
      process.exitCode = 2;
      return;
    }
    const livePriorsFile = path.resolve(__dirname, 'data', 'model-priors-live.json');
    const outputFile = args.file ? path.resolve(args.file) : livePriorsFile;
    const isTempOutput = outputFile.startsWith(path.resolve(require('os').tmpdir()) + path.sep);
    if (outputFile !== livePriorsFile && !isTempOutput) {
      console.error('PRIORS_OUTPUT_OUTSIDE_ALLOWLIST');
      process.exitCode = 2;
      return;
    }
    const search = async (query) => {
      if (provider.kind === 'public-leaderboards') {
        const docs = await require('./priors-public').publicDocuments({ descriptor: provider });
        return require('./priors-public').validatePublicDocuments(docs);
      }
      const headers = { 'content-type': 'application/json' };
      const allowedHeaders = new Set(['accept', 'user-agent']);
      for (const [name, value] of Object.entries(provider.headers || {})) {
        const lowerName = name.toLowerCase();
        if (allowedHeaders.has(lowerName) && typeof value === 'string') {
          headers[lowerName] = value;
        }
      }
      if (typeof provider.authEnv === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(provider.authEnv)) {
        const token = process.env[provider.authEnv];
        if (token) headers.authorization = `Bearer ${token}`;
      }
      const timeoutMs = Number.isFinite(Number(provider.timeoutMs))
        ? Math.max(100, Math.min(30000, Number(provider.timeoutMs)))
        : 10000;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(provider.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error('PRIORS_SEARCH_TIMEOUT');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error('PRIORS_SEARCH_HTTP_' + response.status);
      return response.json();
    };
    refreshPriors({
      search,
      sourceId: path.relative(allowedRoots[0], resolvedSource),
      preserveHistory: true,
      file: outputFile,
    })
      .then((document) =>
        console.log(
          JSON.stringify({
            models: document.ranking.length,
            unmatchedLiveModels: document.unmatchedLiveModels,
            stale: document.ranking.filter((item) => item.stale).length,
            file: args.file || 'default',
          })
        )
      )
      .catch((err) => {
        console.error((err && err.message) || String(err));
        process.exitCode = 1;
      });
    return;
  }

  if (command === 'agy-gateway') {
    require('./agy-gateway')
      .start({ port: args.port ? Number(args.port) : undefined })
      .then((srv) =>
        console.log(`agy-gateway listening on http://127.0.0.1:${srv.address().port}/v1`)
      )
      .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
      });
    return;
  }

  if (command === 'reconcile') return reconcileCommand(args);
  if (command === 'report' && args._[1] === 'tokens') return tokenReportCommand(args);
  if (command === 'manifest') return manifestCommand(args);
  if (command === 'prove') return proveCommand(args);
  if (command === 'quota') return quotaCommand(args);
  if (command === 'dispatch') {
    const result = dispatchCommand(args);
    // The profile path (TASK-AI-65) is async: the JEV advisory returns a
    // promise. An unhandled rejection would crash silently, so it is caught
    // here and turned into a non-zero exit instead.
    if (result && typeof result.then === 'function') {
      result.then(
        () => {},
        (err) => {
          console.error('Dispatch lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return;
  }
  if (command === 'shadow') return shadowCommand(args);
  // discovery import | discovery candidates (TASK-AI-70): bring a reviewed
  // model audit into the stores dispatch reads, then show what the Controller
  // sees. Synchronous, like reconcile and quota.
  if (command === 'discovery') return discoveryCommand(args);
  // evidence import-work (TASK-AI-75): turn real merged, independently reviewed
  // work into WORK_ITEM_PASS evidence.
  if (command === 'evidence') return evidenceCommand(args);
  // review manifest validate (TASK-AI-77): check a review manifest against git
  // before anything is published or promoted on the strength of it.
  if (command === 'review') return reviewCommand(args);
  // account add | account limits | account secret (TASK-AI-29). The account
  // surface parses its own argv strictly, so a mistyped flag is refused
  // rather than dropped, and never routes through reconcile allowlists.
  if (command === 'account') {
    const { runAccountCli } = require('./account-entry');
    process.exit(runAccountCli(process.argv.slice(3)));
  }
  // probe (TASK-AI-30): one bounded, recorded qualification probe. Async, so
  // the exit code is set via process.exitCode instead of process.exit — an
  // abrupt exit could truncate the result line or the record write. A
  // refused, fail or timeout outcome still exits 0: the record is the
  // committed outcome either way, and exit 2 is reserved for bad argv.
  if (command === 'probe') {
    if (process.argv.slice(3).includes('--due')) {
      require('./route-health')
        .runDueCli()
        .then((code) => {
          process.exitCode = code;
        })
        .catch((e) => {
          console.error('Probe due lỗi: ' + (e && e.message ? e.message : e));
          process.exitCode = 1;
        });
      return;
    }
    const { runProbeCli } = require('./qualification');
    runProbeCli(process.argv.slice(3))
      .then((code) => {
        process.exitCode = code;
      })
      .catch((e) => {
        console.error('Probe lỗi: ' + (e && e.message ? e.message : e));
        process.exitCode = 1;
      });
    return;
  }
  // qualify (TASK-AI-31): reads the probe result written by TASK-AI-30 and
  // grants qualifiedRoles only when the probe outcome was 'pass' and the
  // result is within the cache window. Exit 0 for any recorded outcome
  // (QUALIFIED, ALREADY_QUALIFIED, NOT_QUALIFIED, RESULT_STALE,
  // RESULT_MISSING); exit 2 for bad argv.
  if (command === 'qualify') {
    if (process.argv[3] === '--auto') {
      const { runAutoCli } = require('./qualification-auto');
      const rootDir = parseArgs(process.argv.slice(3)).root || process.cwd();
      const { loadConfig } = require('./next-runner');
      runAutoCli(process.argv.slice(3), {
        runIsolatedReviewed: (input) =>
          require('./intake').runIsolatedReviewed(input, {
            root: rootDir,
            baseSha: require('./intake').revParseOriginMain(rootDir, {}),
          }),
        assertIsolationClosed: (options) =>
          require('./intake').assertIsolationClosed({ ...options, root: rootDir }),
        buildCandidates: () => buildQualificationCandidates(rootDir),
        evidenceDir: path.join(rootDir, 'tools', 'ai-brain', 'data', 'evidence'),
        config: loadConfig(rootDir).qualification || {},
        usageFile: path.join(rootDir, '.shipde', 'qualification-usage.json'),
      })
        .then((code) => {
          process.exitCode = code;
        })
        .catch((e) => {
          console.error('Qualify failed: ' + (e && e.message ? e.message : e));
          process.exitCode = 1;
        });
      return;
    }
    if (process.argv.slice(3).some((arg) => arg === '--auto')) {
      console.error('Invalid qualify argv: --auto must be the first option');
      process.exitCode = 2;
      return;
    }
    const { runQualifyCli } = require('./qualification-gate');
    runQualifyCli(process.argv.slice(3))
      .then((code) => {
        process.exitCode = code;
      })
      .catch((e) => {
        console.error('Qualify lỗi: ' + (e && e.message ? e.message : e));
        process.exitCode = 1;
      });
    return;
  }
  // serena (TASK-AI-32): Serena read-only pilot for code retrieval
  // Symbol and reference lookup for authors, measured against TokenPerMergedItem
  if (command === 'serena') {
    const { runSerenaCli } = require('./serena');
    process.exit(runSerenaCli(process.argv.slice(3)));
  }

  // sources:
  // - sources onboard <sourceId> [--record|--replay] [--json]
  // - sources onboard --all --replay
  // - sources --discover [--probe] [--json]
  if (command === 'sources') {
    if (args._[1] === 'onboard') {
      const { runSourcesOnboardCli } = require('./source-onboarding');
      runSourcesOnboardCli(args)
        .then((code) => {
          if (typeof code === 'number') process.exitCode = code;
        })
        .catch((err) => {
          console.error('Sources onboard failed: ' + String((err && err.message) || err));
          process.exitCode = 1;
        });
      return;
    }
    const discovery = require('./source-discovery');
    if (!args.discover) {
      console.error(
        'Dùng: sources onboard <sourceId> [--record|--replay] [--json] | sources onboard --all --replay | sources --discover [--probe] [--json]'
      );
      process.exit(2);
    }
    discovery
      .discover({ probe: Boolean(args.probe), root: path.join(__dirname) })
      .then((result) => {
        if (args.json) console.log(JSON.stringify(result, null, 2));
        else console.log('Discovered ' + result.sources.length + ' configured model sources.');
      })
      .catch((err) => {
        console.error('Source discovery failed: ' + String((err && err.message) || 'error'));
        process.exitCode = 1;
      });
    return;
  }

  // orchestrate (TASK-AI-64): the live autonomous loop —
  //   node tools/ai-brain/cli.js orchestrate --goal <text|file> --specs <file>
  //     [--isolated-worker --base-sha <40-hex>] [--checkpoint <file>] [--out <file>]
  //
  // The specs are the real work items the operator named and the candidates come
  // from the live registry: the old command synthesised one DRY-RUN-GOAL item and
  // two demo candidates, injected a launcher that failed once on a counter, and
  // injected three green gates, so the goal text never became work and no identity
  // came from the registry. Nothing is injected here any more — a live run either
  // launches for real or is refused.
  if (command === 'orchestrate') return orchestrateCommand(args);

  // merge (TASK-AI-133): governed exact-HEAD auto-merge without supervisor
  //   node tools/ai-brain/cli.js merge --work-item <ID> [--config <file>] [--repo <owner/repo>]
  if (command === 'merge') {
    const result = mergeCommand(args);
    if (result && typeof result.then === 'function') {
      result.then(
        () => {},
        (err) => {
          console.error('Merge lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return;
  }

  // intake (TASK-AI-131): build every orchestrate input from repository sources.
  // Async (the catalogue merge awaits its live listings), so the exit code is
  // set via process.exitCode and any rejection is caught rather than crashing.
  if (command === 'intake') {
    const result = intakeCommand(args);
    if (result && typeof result.then === 'function') {
      result.then(
        () => {},
        (err) => {
          console.error('Intake lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return;
  }

  // plan (TASK-AI-141 G): draft only from approved, cited repository sources.
  if (command === 'plan') {
    const rootDir = args.root || process.cwd();
    const planningDeps = require('./work-item-planner').defaultPlanningDeps(
      rootDir,
      deps.planningDeps || deps
    );
    planCommand(args, Object.assign({}, planningDeps, { __planningDepsReady: true }))
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        if (result && (result.blocking || result.status === 'BLOCKED')) process.exitCode = 1;
      })
      .catch((err) => {
        console.error(
          (err && err.code ? err.code + ': ' : '') + (err && err.message ? err.message : err)
        );
        process.exitCode = 1;
      });
    return;
  }

  // next (TASK-AI-132): pick the next dependency-ready Work Item and run through intake.
  if (command === 'next') {
    const { nextCommand } = require('./next-runner');
    const result = nextCommand(args);
    if (result && typeof result.then === 'function') {
      result.then(
        (res) => {
          if (
            res &&
            (res.status === 'failed' ||
              res.failed ||
              (typeof res.exitCode === 'number' && res.exitCode !== 0))
          ) {
            process.exitCode =
              typeof res.exitCode === 'number' && res.exitCode !== 0 ? res.exitCode : 1;
          }
        },
        (err) => {
          console.error('Next lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return;
  }

  // chat (TASK-AI-142 H2): interactive Hermes chat session bound to Controller-selected candidate
  if (command === 'chat') {
    const { chatCommand } = require('./hermes-session');
    const result = chatCommand(args, deps);
    if (result && typeof result.then === 'function') {
      result.then(
        (res) => {
          if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
            process.exitCode = res.exitCode;
          }
        },
        (err) => {
          console.error('Chat error: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return result;
  }

  // goal (TASK-AI-142 H1/H2): goal store and session management
  if (command === 'goal') {
    const sub = args._[1];
    if (sub === 'session') {
      const { goalSessionCommand } = require('./hermes-session');
      const result = goalSessionCommand(args, deps);
      if (result && typeof result.then === 'function') {
        result.then(
          (res) => {
            if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
              process.exitCode = res.exitCode;
            }
          },
          (err) => {
            console.error(
              JSON.stringify({
                status: 'error',
                error: err && err.message ? err.message : String(err),
              })
            );
            process.exitCode = 1;
          }
        );
      }
      return result;
    }
    let goals;
    try {
      if (deps && deps.loadGoals) {
        goals = deps.loadGoals();
      } else if (deps && deps.goals !== undefined) {
        goals = deps.goals;
        if (goals instanceof Error) throw goals;
      } else {
        goals = require('./goals');
      }
    } catch (loadErr) {
      console.error(
        JSON.stringify({
          status: 'error',
          error:
            'GOAL_MODULE_UNAVAILABLE: ' +
            (loadErr && loadErr.message ? loadErr.message : String(loadErr)),
        })
      );
      process.exitCode = 1;
      return;
    }
    // H1 runGoalCli prints its own JSON document and returns the exit code; it
    // is terminal, so its number must become the process exit code untouched.
    if (
      goals &&
      typeof goals.goalCommand !== 'function' &&
      typeof goals.runGoalCli === 'function'
    ) {
      try {
        const code = goals.runGoalCli(args, deps);
        if (typeof code === 'number') process.exitCode = code;
        return code;
      } catch (cmdErr) {
        console.error(
          JSON.stringify({
            status: 'error',
            error: cmdErr && cmdErr.message ? cmdErr.message : String(cmdErr),
          })
        );
        process.exitCode = 1;
        return;
      }
    }
    if (goals && typeof goals.goalCommand === 'function') {
      try {
        const result = goals.goalCommand(args, deps);
        if (result && typeof result.then === 'function') {
          result.then(
            (res) => {
              if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
                process.exitCode = res.exitCode;
              }
            },
            (err) => {
              console.error(
                JSON.stringify({
                  status: 'error',
                  error: err && err.message ? err.message : String(err),
                })
              );
              process.exitCode = 1;
            }
          );
        }
        return;
      } catch (cmdErr) {
        console.error(
          JSON.stringify({
            status: 'error',
            error: cmdErr && cmdErr.message ? cmdErr.message : String(cmdErr),
          })
        );
        process.exitCode = 1;
        return;
      }
    }
    console.error(
      JSON.stringify({
        status: 'error',
        error: 'UNKNOWN_GOAL_SUBCOMMAND: ' + (sub || 'missing subcommand'),
      })
    );
    process.exitCode = 1;
    return;
  }

  if (command === 'decisions' && args._[1] === 'compact') {
    console.log(JSON.stringify(require('./decisions').compactDecisions({ dir: args.dir })));
    return;
  }

  console.error('Lệnh không rõ: ' + command);
  console.error(
    'Dùng: reconcile | manifest | prove | quota | dispatch | shadow | discovery | account | probe | qualify | serena | sources | evidence | review | orchestrate | intake | plan | next | merge | goal | priors refresh | chat | goal session'
  );
  process.exit(2);
}

module.exports = {
  dispatchCommand,
  parseArgs,
  main,
  // The Controller seams the live loop consumes rather than reimplements: the
  // ranking decision, the failure-domain rule, the atomic checkpoint store.
  readCheckpoint,
  writeJsonFile,
  buildDryRunLog,
  sameFailureDomain,
  applyFailureBlocks,
  applyDryRunBlocks,
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
  // TASK-AI-70: one candidate assembly for both dispatch paths and for the
  // read-only `discovery candidates` listing, so what is listed is what dispatch
  // would rank.
  assembleCandidates,
  assembleForDispatch,
  discoveryCommand,
  evidenceCommand,
  reviewCommand,
  orchestrateCommand,
  mergeCommand,
  intakeCommand,
  dispatchProfileCommand,
  tokenReportCommand,
  planCommand,
  nextCommand: (args, deps) => {
    const nextDeps = Object.assign({}, deps || {});
    const rootDir = args.root || process.cwd();
    nextDeps.planningDeps = require('./work-item-planner').defaultPlanningDeps(
      rootDir,
      nextDeps.planningDeps || nextDeps
    );
    if (!nextDeps.qualificationSlot) {
      nextDeps.qualificationSlot = async () => {
        const { runAutoCli } = require('./qualification-auto');
        const rootDir = args.root || process.cwd();
        const { loadConfig } = require('./next-runner');
        const code = await runAutoCli(['--auto'], {
          runIsolatedReviewed: (input) =>
            require('./intake').runIsolatedReviewed(input, {
              root: rootDir,
              baseSha: require('./intake').revParseOriginMain(rootDir, {}),
            }),
          assertIsolationClosed: (options) =>
            require('./intake').assertIsolationClosed({ ...options, root: rootDir }),
          buildCandidates: () => buildQualificationCandidates(rootDir),
          evidenceDir: path.join(rootDir, 'tools', 'ai-brain', 'data', 'evidence'),
          config: loadConfig(rootDir).qualification || {},
        });
        return { ran: true, status: code === 0 ? 'completed' : 'refused' };
      };
    }
    if (args.loop && !nextDeps.refreshRouteHealth) {
      const fs = require('fs');
      nextDeps.refreshRouteHealth = async ({ now }) => {
        const routeHealthApi = require('./route-health');
        const healthFile =
          args['route-health'] ||
          args.routeHealthFile ||
          nextDeps.routeHealthFile ||
          nextDeps['route-health'] ||
          (args.root
            ? path.join(args.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
            : null) ||
          path.join(__dirname, 'data', 'model-route-health.json');
        const registry = nextDeps.registry || require('./sources').loadSources();
        const store = routeHealthApi.loadStore(healthFile, { allowMissing: true });
        let catalogue = [];
        if (args.catalogue) {
          const cataloguePath = path.resolve(args.catalogue);
          if (fs.existsSync(cataloguePath))
            catalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf8')).candidates || [];
        }
        const accounts = nextDeps.accounts || require('./accounts').listAccounts();
        const probe =
          nextDeps.probeRoute ||
          ((model, route, probeOptions) =>
            routeHealthApi.probeGatewayModel(
              model,
              route,
              Object.assign({ registry }, probeOptions)
            ));
        const result = await routeHealthApi.recheckBeforeSelection(store, probe, {
          now,
          cap: nextDeps.probeCap,
          timeoutMs: nextDeps.probeTimeoutMs,
          catalogue,
          registry,
          accounts,
          allowUnprobed: true,
        });
        routeHealthApi.saveStore(healthFile, store);
        if (nextDeps.onRouteRefresh) nextDeps.onRouteRefresh(result);
        return result;
      };
    }
    return require('./next-runner').nextCommand(args, nextDeps);
  },
  goalCommand: (args, deps) => require('./goals').runGoalCli(args, deps),
  _buildQualificationCandidates: buildQualificationCandidates,
  _resolveFallbackRoutes: resolveFallbackRoutes,
  chatCommand: (args, deps) => require('./hermes-session').chatCommand(args, deps),
  goalSessionCommand: (args, deps) => require('./hermes-session').goalSessionCommand(args, deps),
};

if (require.main === module) {
  main();
}
