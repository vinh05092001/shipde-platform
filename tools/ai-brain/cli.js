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

  // 2. Offerings candidates, then the gateway-advertised candidates for each
  // concrete account. The advertised ones come last so an operator's declared
  // entry for the same seven-part key wins: it carries the declared grades and
  // limits, and the advertised row only proves the route exists.
  const advertised = gatewayCandidates || [];
  for (const off of advertised) {
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
    let accessPath = off.accessPath || (source && (source.accessPath || source.endpoint));
    if (!accessPath) {
      accessPath = route && route.harness === 'paseo' ? 'http://127.0.0.1:20128/v1' : 'cli';
    }
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
function assembleForDispatch(discoveryCat, accounts, registry, options) {
  const candidatesApi = require('./candidates');
  const { expandOfferings } = require('./offerings');
  const opts = options || {};

  const resolvedRegistry = registry || require('./sources').loadSources();

  if (Array.isArray(opts.candidates)) {
    return assembleCandidates(discoveryCat, [], resolvedRegistry, accounts, opts.candidates);
  }

  let offs = opts.offerings;
  if (!offs) {
    try {
      offs = expandOfferings(accounts);
    } catch {
      offs = [];
    }
  }

  return assembleCandidates(
    discoveryCat,
    offs,
    resolvedRegistry,
    accounts,
    null,
    candidatesApi.gatewayAccountCandidates({
      registry: resolvedRegistry,
      accounts: accounts || [],
      catalogue: (discoveryCat && discoveryCat.candidates) || [],
    })
  );
}

function readCheckpoint(file) {
  const fs = require('fs');
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, value) {
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
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
  if (!candidate || !failed || !classification) return false;
  const sameConcrete = (left, right) =>
    Boolean(left && right && left !== '*' && right !== '*' && left === right);
  const scope = classification.scope || 'unknown';
  if (scope === 'upstream') {
    return candidate.upstream === failed.upstream;
  }
  if (scope === 'candidate' || scope === 'model') {
    return (candidate.modelId || candidate.model) === (failed.modelId || failed.model);
  }
  if (scope === 'account') {
    return sameConcrete(candidate.accountId, failed.accountId);
  }
  if (scope === 'gateway') {
    return candidate.gateway && candidate.gateway === failed.gateway;
  }
  if (scope === 'access_path') {
    return candidate.accessPath && candidate.accessPath === failed.accessPath;
  }
  if (scope === 'harness') {
    return candidate.harness && candidate.harness === failed.harness;
  }
  return (
    (candidate.upstream && candidate.upstream === failed.upstream) ||
    sameConcrete(candidate.accountId, failed.accountId) ||
    (candidate.gateway && candidate.gateway === failed.gateway)
  );
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
    const reason = contextRefusal(c.harness, candidateContextWindow(c));
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
    return Object.assign(sevenFields(c), {
      offeringId: key,
      status: c.status === 'passed' ? 'PASS' : c.status || 'unknown',
      score: c.score,
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
        score: c.score,
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
function dispatchProfileCommand(args, deps) {
  const rootDir = args.root || (deps && deps.rootDir) || process.cwd();
  const sourcesApi = require('./sources');
  const { listAccounts } = require('./accounts');
  const { readDiscoveryCatalogue } = require('./discovery/read');

  let discCat;
  if (!(deps && Array.isArray(deps.candidates))) {
    try {
      discCat = readDiscoveryCatalogue({
        dataDir: (deps && deps.discoveryDataDir) || path.join(__dirname, 'data', 'discovery'),
      });
    } catch {
      discCat = { candidates: [] };
    }
  }
  const accounts = listAccounts() || [];
  const candidateList = assembleForDispatch(discCat, accounts, sourcesApi.loadSources(), deps);

  return require('./routing').runProfileDispatch(
    args,
    Object.assign({}, deps, { candidates: candidateList, rootDir })
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
    });
  }

  // TASK-AI-65: profile-driven live routing. The profile names the task, its
  // floors and its constraints; JEV advises (never a model); the Controller
  // ranks; rank 1 is pinned and, under --execute, reserved. Async, because the
  // JEV advisory is.
  if (typeof args.profile === 'string') {
    return dispatchProfileCommand(args, deps);
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

  const accounts = deps && deps.accounts !== undefined ? deps.accounts : listAccounts() || [];
  const candidateList = assembleForDispatch(discCat, accounts, registry, deps);

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
    const decision = ranking.rankAndRecord(annotated, rankingContext);
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
        let fallbackDecision = ranking.rankAndRecord(
          fallbackAnnotated,
          Object.assign({}, rankingContext, { dryRun: true })
        );
        let preferredDifferentFailureDomain = true;
        if (!fallbackDecision.chosen) {
          const exactOnlyAnnotated = candidatesApi.annotateCandidates(
            eligibleCandidates.map((c) => Object.assign({}, c)),
            evidenceData,
            { now }
          );
          applyDryRunBlocks(exactOnlyAnnotated, failedKeys, chosenCandidate, classification, false);
          fallbackDecision = ranking.rankAndRecord(
            exactOnlyAnnotated,
            Object.assign({}, rankingContext, { dryRun: true })
          );
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
      log('  ' + (i + 1) + '. ' + c.offeringId + ' (score: ' + c.score + ')');
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
      const launchArgs = adapter.launch({
        candidateKey: finalChosenKey,
        provider:
          (route && route.provider) || finalChosenCandidate.source || finalChosenCandidate.upstream,
        model: sourcesApi.qualifyModel(finalChosenCandidate.modelId, route),
        accountId: finalChosenCandidate.accountId,
        gateway: finalChosenCandidate.gateway || '',
        upstream: finalChosenCandidate.upstream,
        quotaScope: finalChosenCandidate.quotaScope,
        prompt: defaultPrompt(item),
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'reconcile';

  if (command === 'reconcile') return reconcileCommand(args);
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
  if (command === 'orchestrate') {
    const { runOrchestration } = require('./orchestrate');
    const { generateCandidates } = require('./candidates');
    const sourcesApi = require('./sources');
    const decisionsApi = require('./decisions');
    const fsx = require('fs');
    let goal = typeof args.goal === 'string' ? args.goal : null;
    if (!goal) {
      console.error('orchestrate requires --goal <text|file>');
      process.exit(2);
    }
    if (fsx.existsSync(goal)) goal = fsx.readFileSync(goal, 'utf8');
    if (typeof args.specs !== 'string') {
      console.error(
        'orchestrate requires --specs <file>: the real work-item specs, as a JSON array'
      );
      process.exit(2);
    }
    const specDoc = JSON.parse(fsx.readFileSync(args.specs, 'utf8'));
    const specs = Array.isArray(specDoc) ? specDoc : specDoc.specs;
    if (!Array.isArray(specs) || specs.length === 0) {
      console.error('orchestrate: --specs carried no work items');
      process.exit(2);
    }
    const out = typeof args.out === 'string' ? args.out : null;
    const registry = sourcesApi.loadSources();
    const readJsonArg = (value) =>
      typeof value === 'string' && value ? JSON.parse(fsx.readFileSync(value, 'utf8')) : null;
    const candidates = generateCandidates({
      registry,
      catalogue: readJsonArg(args.catalogue) || [],
      accounts: readJsonArg(args.accounts) || [],
      openCodeIds: Array.isArray(args['opencode-ids'])
        ? args['opencode-ids']
        : typeof args['opencode-ids'] === 'string'
          ? args['opencode-ids'].split(',').filter(Boolean)
          : [],
    });
    // The live loop is async (TASK-AI-65): the JEV assessment behind every
    // Controller selection returns a promise. An unhandled rejection would crash
    // silently, so it is caught here and turned into a non-zero exit instead.
    runOrchestration(goal, {
      specs,
      specText: typeof args['spec-text'] === 'string' ? args['spec-text'] : null,
      candidates,
      registry,
      isolatedWorker: Boolean(args['isolated-worker']),
      decisionDir: args['decision-dir'] || decisionsApi.DEFAULT_DIR,
      checkpointFile: typeof args.checkpoint === 'string' ? args.checkpoint : null,
      usageDir: typeof args['usage-dir'] === 'string' ? args['usage-dir'] : null,
      sha: typeof args.sha === 'string' ? args.sha : null,
      baseSha: typeof args['base-sha'] === 'string' ? args['base-sha'] : null,
      branch: typeof args.branch === 'string' ? args.branch : null,
      cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
      workerRoot: typeof args['worker-root'] === 'string' ? args['worker-root'] : null,
      reviewBudget: args['review-budget'],
      publication: args.publish
        ? {
            approvalId: args.approval,
            expiry: args['approval-expiry'] ? Date.parse(args['approval-expiry']) : undefined,
            remoteUrl: args['remote-url'],
            branch: typeof args.branch === 'string' ? args.branch : null,
            draft: { workItemId: specs[0].id, outcome: String(goal).slice(0, 72) },
          }
        : null,
      out,
      now: Date.now(),
    })
      .then((result) => {
        console.log(
          JSON.stringify(
            {
              goal,
              status: result.status,
              reconciliation: result.reconciliation,
              publication: result.publication,
            },
            null,
            2
          )
        );
        if (out) console.log('Wrote run log to ' + out);
        process.exit(result.status === 'COMPLETED' || result.status === 'PUBLISHED_DRAFT' ? 0 : 1);
      })
      .catch((err) => {
        console.error(
          'Orchestrate lỗi: ' +
            (err && err.name ? err.name + ': ' : '') +
            (err && err.message ? err.message : err)
        );
        process.exit(1);
      });
    return;
  }

  console.error('Lệnh không rõ: ' + command);
  console.error(
    'Dùng: reconcile | manifest | prove | quota | dispatch | shadow | account | probe | qualify | serena'
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
  sameFailureDomain,
  applyFailureBlocks,
  applyDryRunBlocks,
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
};

if (require.main === module) {
  main();
}
