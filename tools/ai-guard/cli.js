#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Writer claim CLI.
 *
 *   node tools/ai-guard/cli.js install   [--global] [--strict]
 *   node tools/ai-guard/cli.js uninstall [--global] [--strict]
 *   node tools/ai-guard/cli.js claim     [--owner X] [--ttl 120] [--note "..."]
 *   node tools/ai-guard/cli.js release   [--branch X]
 *   node tools/ai-guard/cli.js status
 *   node tools/ai-guard/cli.js check     # exit 1 when blocked (git hook)
 *   node tools/ai-guard/cli.js secret-surface [--root <dir>]
 *   node tools/ai-guard/cli.js staged-secrets [--root <dir>]
 *
 * `check` also runs the secret-surface scan, so the installed pre-commit hook
 * refuses a forbidden credential read with the same command that refuses a
 * concurrent writer (AI-18-R09).
 *
 * `check` is the only command with a meaningful exit code, so the pre-commit
 * hook stays a one-liner.
 */

const {
  readAoHolders,
  readClaims,
  writeClaim,
  releaseClaim,
  checkWrite,
  currentBranch,
  defaultOwner,
  getHookStatus,
  installHook,
  uninstallHook,
} = require('./writer-claim');
const { runSecretSurface } = require('./secret-surface');
const { runStagedSecrets } = require('./staged-secrets');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'status';
  const owner = args.owner || defaultOwner();
  const branch = args.branch || currentBranch();

  if (command === 'install') {
    const result = installHook({ global: args.global });
    if (result.success) {
      // installHook reports whether the hook file is actually there. Printing
      // success regardless would announce a clean install on a checkout whose
      // commits run unguarded, which is the one thing that function exists to
      // distinguish.
      if (!result.hookPresent) {
        console.error(
          'Cảnh báo: đã đặt core.hooksPath = .githooks nhưng không có .githooks/pre-commit; ' +
            'hook chưa bảo vệ điều gì.'
        );
        if (args.strict) {
          process.exit(1);
        }
        return;
      }
      console.log('Đã cài đặt pre-commit hook (core.hooksPath = .githooks).');
      return;
    }
    console.error('Cảnh báo: Không thể cấu hình core.hooksPath: ' + result.error);
    if (args.strict) {
      process.exit(1);
    }
    return;
  }

  if (command === 'uninstall') {
    const result = uninstallHook({ global: args.global });
    if (result.success) {
      console.log('Đã gỡ cấu hình core.hooksPath.');
      return;
    }
    console.error('Cảnh báo: Không thể gỡ core.hooksPath: ' + result.error);
    if (args.strict) {
      process.exit(1);
    }
    return;
  }

  if (command === 'claim') {
    if (!branch) {
      console.error('Không xác định được nhánh. Truyền --branch.');
      process.exit(2);
    }
    const check = await checkWrite({ branch, owner });
    if (!check.allowed) {
      console.error('KHÔNG THỂ NHẬN: ' + check.reason);
      process.exit(1);
    }
    const claim = writeClaim({
      branch,
      owner,
      harness: args.harness || 'direct',
      note: typeof args.note === 'string' ? args.note : null,
      ttlMinutes: Number(args.ttl) || undefined,
    });
    console.log('Đã nhận nhánh "' + claim.branch + '" cho ' + claim.owner);
    console.log('Hết hạn: ' + claim.expiresAt);
    return;
  }

  if (command === 'release') {
    if (!branch) {
      console.error('Không xác định được nhánh. Truyền --branch.');
      process.exit(2);
    }
    console.log(
      releaseClaim(branch)
        ? 'Đã trả nhánh "' + branch + '"'
        : 'Không có claim nào cho "' + branch + '"'
    );
    return;
  }

  if (command === 'status') {
    const ao = await readAoHolders();
    const claims = readClaims();
    const hook = getHookStatus();
    console.log('Nhánh hiện tại: ' + (branch || '(không rõ)'));
    console.log('Danh tính: ' + owner);
    console.log(
      'Git hook: ' +
        (hook.installed
          ? 'ĐÃ CÀI ĐẶT (' + hook.hooksPath + ')'
          : 'CHƯA CÀI ĐẶT (chạy: node tools/ai-guard/cli.js install)')
    );
    console.log('');
    console.log(
      'Phiên AO đang sống (' +
        ao.holders.length +
        ')' +
        (ao.reachable ? '' : ' — daemon không phản hồi')
    );
    for (const h of ao.holders) {
      console.log(
        '  ' + h.id + ' [' + h.harness + '/' + h.kind + '] ' + h.state + ' -> ' + h.branch
      );
    }
    console.log('');
    console.log('Claim trực tiếp (' + claims.length + ')');
    for (const c of claims) {
      console.log(
        '  ' + c.owner + ' [' + c.harness + '] -> ' + c.branch + ' (đến ' + c.expiresAt + ')'
      );
    }
    return;
  }

  if (command === 'secret-surface') {
    const root = typeof args.root === 'string' ? args.root : process.cwd();
    const report = runSecretSurface(root, { excludeFixtures: typeof args.root !== 'string' });
    for (const line of report.lines) console.log(line);
    process.exit(report.exitCode);
  }

  if (command === 'staged-secrets') {
    // The scan runs in the repository being committed to, which is the current
    // working directory and not this tool's own repository: a hook installed in
    // one worktree must judge that worktree's index.
    const root = typeof args.root === 'string' ? args.root : process.cwd();
    const report = runStagedSecrets(root);
    for (const line of report.lines) console.log(line);
    process.exit(report.exitCode);
  }

  if (command === 'check') {
    // The scan runs before the writer claim. A forbidden credential read is a
    // property of the code being committed; a writer collision is a property of
    // who is committing. Reporting the first one first keeps the more serious
    // finding from being hidden behind a lock message.
    const surfaceRoot =
      typeof args['secret-surface-root'] === 'string' ? args['secret-surface-root'] : process.cwd();
    const surface = runSecretSurface(surfaceRoot, {
      excludeFixtures: typeof args['secret-surface-root'] !== 'string',
    });
    if (surface.exitCode !== 0) {
      for (const line of surface.lines) console.log(line);
      process.exit(surface.exitCode);
    }
    for (const line of surface.lines) console.log(line);

    const result = await checkWrite({ branch, owner });
    if (result.allowed) {
      if (result.degraded) console.error('Cảnh báo: ' + result.reason);
      return;
    }
    console.error('');
    console.error('  CHẶN GHI — ' + result.reason);
    console.error('');
    for (const h of result.holders) {
      console.error(
        '    ' +
          (h.owner || h.id) +
          ' [' +
          (h.harness || '?') +
          ']' +
          (h.lastActivityAt ? ' hoạt động lúc ' + h.lastActivityAt : '')
      );
    }
    console.error('');
    console.error('  Nếu đây là nhầm lẫn: node tools/ai-guard/cli.js release --branch ' + branch);
    console.error('  Bỏ qua một lần: git commit --no-verify');
    console.error('');
    process.exit(1);
  }

  console.error('Lệnh không rõ: ' + command);
  process.exit(2);
}

main().catch((err) => {
  // A guard that crashes must not block work; report and let the commit through.
  console.error('Bộ kiểm tra lỗi, bỏ qua: ' + (err && err.message ? err.message : err));
});
