#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Brain CLI
 *
 *   node tools/ai-brain/cli.js reconcile [--json] [--strict]
 *   node tools/ai-brain/cli.js prove --tests "<command>" [...]
 *   node tools/ai-brain/cli.js dispatch [--dry-run | --execute] [--plan <file>]
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
const { loadRegister } = require('../ai-dashboard/register-adapter');
const { reconcileRegister, planReconciliation, applyStatusMutations } = require('./reconcile');
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

function assembleCandidates(discoveryCat, offerings, registry, accounts, injectedCandidates) {
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
  for (const dc of discCands) {
    const accountId = dc.accountId || dc.account || '*';
    const modelId = dc.modelId || dc.model;
    const c = {
      ...dc,
      accountId,
      quotaScope: dc.quotaScope || (accountId !== '*' ? accountId : dc.upstream || ''),
      modelId,
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
    const key = candidatesApi.candidateKey(c);
    c.key = key;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(c);
    }
  }

  // 2. Offerings candidates
  for (const off of offerings || []) {
    const route = sourcesApi.dispatchRoute(off.provider, registry);
    const source =
      registry &&
      registry.sources &&
      registry.sources.find((s) => s.id === off.provider || s.id === off.accountId);
    const harness =
      off.harness || (route && route.harness) || (source && source.harness) || 'paseo';
    let accessPath = off.accessPath || (source && (source.accessPath || source.endpoint));
    if (!accessPath) {
      accessPath = route && route.harness === 'paseo' ? 'http://127.0.0.1:20128/v1' : 'cli';
    }
    const gateway =
      off.gateway ||
      (source && source.reachedVia) ||
      (source && source.kind === 'router' ? source.id : '9router');
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
    const key = candidatesApi.candidateKey(c);
    c.key = key;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(c);
    }
  }

  return result;
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

  const isDryRun = dryRunFlag || !execute;

  // Pre-computed plan file fallback
  if (typeof args.plan === 'string') {
    const { executePlan } = require('./executor');
    const plan = readJsonOrExit(path.resolve(args.plan), 'plan');
    const result = executePlan(plan, {
      dryRun: isDryRun,
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
  const { expandOfferings } = require('./offerings');
  const { listAccounts } = require('./accounts');
  const { readDiscoveryCatalogue } = require('./discovery/read');
  const { getHarness, runHarness } = require('./harness');
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

  const accounts = deps && deps.accounts !== undefined ? deps.accounts : listAccounts() || [];
  let offs = deps && deps.offerings;
  if (!offs && (!deps || !deps.candidates)) {
    try {
      offs = expandOfferings(accounts);
    } catch {
      offs = [];
    }
  }

  const candidateList = assembleCandidates(
    discCat,
    offs,
    registry,
    accounts,
    deps && deps.candidates
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
    const evidenceData = evidence.loadEvidence(evidenceDir);
    const annotated = candidatesApi.annotateCandidates(
      eligibleCandidates.map((c) => Object.assign({}, c)),
      evidenceData,
      { now }
    );
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
    const decision = ranking.rankAndRecord(annotated, rankingContext);

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

    log('Ranked candidates for ' + item.workItemId + ':');
    for (let i = 0; i < decision.candidates.length; i++) {
      const c = decision.candidates[i];
      log('  ' + (i + 1) + '. ' + c.offeringId + ' (score: ' + c.score + ')');
    }
    log('Chosen: ' + decision.chosen);
    exit(0);
    return { exitCode: 0, decision, dryRun: true };
  }

  // Execution with retry/fallback
  const maxAttempts = Number(
    args['max-attempts'] || args.maxAttempts || (deps && deps.maxAttempts) || 3
  );
  const failedCandidates = new Set();
  let attempt = 0;
  let lastDecision = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const now = (deps && deps.now) || Date.now();
    const evidenceData = evidence.loadEvidence(evidenceDir);

    const annotated = candidatesApi.annotateCandidates(
      eligibleCandidates.map((c) => Object.assign({}, c)),
      evidenceData,
      { now }
    );

    // Never retry a candidate that just failed in this run
    for (const c of annotated) {
      const key = candidatesApi.candidateKey(c);
      if (failedCandidates.has(key)) {
        c.blocked = true;
        c.blockReason = 'candidate failed in current dispatch run';
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

    const chosenKey = decision.chosen;
    const chosenCandidate = annotated.find((c) => candidatesApi.candidateKey(c) === chosenKey) || {
      offeringId: chosenKey,
      harness: decision.harness,
    };

    if (isPinned) {
      log('PINNED');
    }
    log(
      'Dispatching ' +
        item.workItemId +
        ' to ' +
        chosenKey +
        ' (attempt ' +
        attempt +
        '/' +
        maxAttempts +
        ')'
    );

    const reservationOpts = {
      home: deps && deps.home,
      storePath: deps && deps.storePath,
      now,
    };

    quotaStore.recordReservation(
      item.workItemId,
      item.role,
      chosenCandidate.accountId || '*',
      chosenKey,
      100000,
      reservationOpts
    );

    let launchRes;
    let thrownError = null;
    try {
      const launcher = (deps && deps.run) || runHarness;
      const harnessName = chosenCandidate.harness || decision.harness || 'paseo';
      const adapter = getHarness(harnessName);
      const route = sourcesApi.dispatchRoute(
        chosenCandidate.source || chosenCandidate.upstream || chosenCandidate.gateway,
        registry
      );
      const launchArgs = adapter.launch({
        provider: (route && route.provider) || chosenCandidate.source || chosenCandidate.upstream,
        model: sourcesApi.qualifyModel(chosenCandidate.modelId, route),
        prompt: defaultPrompt(item),
        branch: item.branch,
        base: args.base || (deps && deps.base) || 'main',
        cwd: args.cwd || (deps && deps.cwd) || rootDir,
        title: workerName(item.workItemId),
        labels: {
          workItem: item.workItemId,
          role: item.role,
          project: args.project || 'shipde-platform',
        },
      });

      try {
        launchRes = launcher(adapter, launchArgs, { cwd: args.cwd || rootDir });
      } catch (err) {
        thrownError = err;
        launchRes = {
          exitCode: err.exitCode !== undefined ? err.exitCode : -1,
          stdout: '',
          stderr: err.stderr || err.message || String(err),
          error: err,
        };
      }
    } finally {
      quotaStore.releaseReservation(item.workItemId, reservationOpts);
    }

    if (deps && deps.rethrow && thrownError) {
      throw thrownError;
    }

    const isFailure =
      thrownError !== null ||
      !launchRes ||
      launchRes.exitCode !== 0 ||
      (typeof launchRes.httpStatus === 'number' && launchRes.httpStatus >= 400);

    if (!isFailure) {
      evidence.recordOutcome(evidenceDir, chosenCandidate, {
        status: 'passed',
        level: evidence.Level.OUTCOME,
        exitCode: 0,
        source: 'dispatch',
      });
      log('Dispatch succeeded on ' + chosenKey);
      exit(0);
      return { exitCode: 0, chosen: chosenKey, result: launchRes, attempts: attempt };
    } else {
      evidence.recordOutcome(evidenceDir, chosenCandidate, {
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
      failedCandidates.add(chosenKey);
      log(
        'Candidate failed: ' +
          chosenKey +
          (launchRes && launchRes.stderr ? ' — ' + launchRes.stderr : '')
      );
    }
  }

  log('Max dispatch attempts (' + maxAttempts + ') reached without success.');
  exit(1);
  return { exitCode: 1, decision: lastDecision, attempts: attempt };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'reconcile';

  if (command === 'reconcile') return reconcileCommand(args);
  if (command === 'manifest') return manifestCommand(args);
  if (command === 'prove') return proveCommand(args);
  if (command === 'quota') return quotaCommand(args);
  if (command === 'dispatch') return dispatchCommand(args);
  if (command === 'shadow') return shadowCommand(args);
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

  console.error('Lệnh không rõ: ' + command);
  console.error(
    'Dùng: reconcile | manifest | prove | quota | dispatch | shadow | account | probe | qualify | serena'
  );
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = {
  dispatchCommand,
  parseArgs,
  main,
};
