#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Writer claim CLI.
 *
 *   node tools/ai-guard/cli.js claim   [--owner X] [--ttl 120] [--note "..."]
 *   node tools/ai-guard/cli.js release [--branch X]
 *   node tools/ai-guard/cli.js status
 *   node tools/ai-guard/cli.js check            # exit 1 when blocked (git hook)
 *
 * `check` is the only command with a meaningful exit code, so the pre-commit
 * hook stays a one-liner.
 */

const os = require('os');
const {
  readAoHolders,
  readClaims,
  writeClaim,
  releaseClaim,
  checkWrite,
  currentBranch,
} = require('./writer-claim');

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

function defaultOwner() {
  return (
    process.env.SHIPDE_WRITER ||
    process.env.AO_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    os.userInfo().username + '@' + os.hostname()
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'status';
  const owner = args.owner || defaultOwner();
  const branch = args.branch || currentBranch();

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
    console.log('Nhánh hiện tại: ' + (branch || '(không rõ)'));
    console.log('Danh tính: ' + owner);
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

  if (command === 'check') {
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
