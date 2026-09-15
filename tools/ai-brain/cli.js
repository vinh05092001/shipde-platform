#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Brain CLI
 *
 *   node tools/ai-brain/cli.js reconcile [--json] [--strict]
 *   node tools/ai-brain/cli.js prove --tests "<command>" [...]
 *
 * `reconcile` asks whether the register can back up what it claims.
 * `prove` runs the checks an agent says it ran, and reports what happened.
 *
 * Exit codes: 0 when nothing is overstated, 1 when it is. --strict also fails
 * on warnings, for use in CI where an unrecorded merge should block.
 */

const path = require('path');
const { loadRegister } = require('../ai-dashboard/register-adapter');
const {
  reconcileRegister,
  planReconciliation,
  applyStatusMutations,
} = require('./reconcile');
const { auditManifest } = require('./manifest-audit');
const { runCheck, currentBranch, headSha } = require('./facts');

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
  if (PROTECTED_BRANCHES.has(String(branch || '').trim())) return true;
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
  fs.renameSync(tmp, target);
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
    : path.join(rootDir, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv');

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

  const plan = planReconciliation(register.data.items, { cwd: rootDir, mainRef, mergeEvidence: evidence });

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

  if (applied.applied === 0) {
    console.log('  Register unchanged: 0 mutations applied');
    writeAudit(args, rootDir, csvPath, preHash, preHash, before, plan, mainRef);
    process.exit(0);
  }

  const next = Buffer.from(applied.text, 'utf8');
  const tmp = csvPath + '.tmp';
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, csvPath);
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

  const identity = readIdentity({});
  const accounts = listAccounts() || [];

  if (args.show) {
    const { reported, problems } = usableReadings(identity, {});
    if (args.json) return console.log(JSON.stringify({ identity, reported, problems }, null, 2));
    console.log('');
    console.log('  Số liệu quota đang dùng được — ' + storePath({}));
    console.log('');
    for (const [id, q] of Object.entries(reported)) {
      for (const row of q.rows) {
        console.log(
          '  ' +
            id.padEnd(14) +
            row.family.padEnd(12) +
            row.window.padEnd(10) +
            (row.disabled ? 'đã tắt' : row.remainingPercent + '%')
        );
      }
    }
    for (const [id, p] of Object.entries(problems)) {
      console.log('  ' + id.padEnd(14) + 'KHÔNG DÙNG ĐƯỢC — ' + p.reason);
    }
    console.log('');
    return;
  }

  const results = refreshAll(accounts, { identity });
  if (args.json) return console.log(JSON.stringify({ identity, results }, null, 2));

  console.log('');
  console.log(
    identity.known
      ? '  Account đang đăng nhập: ' + identity.email
      : '  Không xác định được account đang đăng nhập: ' + identity.reason
  );
  console.log('');
  for (const r of results) {
    if (r.skipped) console.log('  BỎ QUA  ' + r.accountId + ' — ' + r.reason);
    else if (r.ok) console.log('  ĐỌC ĐƯỢC ' + r.accountId + ' — ' + r.rows + ' dòng');
    else console.log('  HỎNG    ' + r.accountId + ' — ' + r.reason);
  }
  console.log('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'reconcile';

  if (command === 'reconcile') return reconcileCommand(args);
  if (command === 'manifest') return manifestCommand(args);
  if (command === 'prove') return proveCommand(args);
  if (command === 'quota') return quotaCommand(args);

  console.error('Lệnh không rõ: ' + command);
  console.error('Dùng: reconcile | manifest | prove | quota');
  process.exit(2);
}

main();
