'use strict';
// AC-AI-40-04 — independent evidence for the `sylph` retirement premise.
//
// The stored one-line row could not be executed as written: it carried
// backslash-escaped double quotes (\") around the clone target, which survive a
// bash heredoc but are handed to node verbatim by PowerShell — the documented
// shell of this Work Item — where `node -e` then dies with
// "SyntaxError: Invalid or unexpected token". This file holds the same check in
// a form no shell has to re-quote: arguments are passed as an argv array.
//
// Two premises are measured against artifacts outside this specification:
//   (a) the pinned upstream tree `getnao/sylph` at the recorded commit ships no
//       package.json and no runtime entrypoint, and the manifest pin `0.1.0`
//       resolves to no tag at all;
//   (b) the real native deliverable `tools/ai-guard` still passes its own suite.
// The native suite is asserted by the invariant "fail 0 with tests > 0" rather
// than by a pinned pass count, which drifts.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SHA = 'd31a9c05f19de0f14e255d9301bbdb0f872354b3';
const REMOTE = 'https://github.com/getnao/sylph';
const GUARD_TEST = path.join('tools', 'ai-guard', 'test', 'writer-claim.test.js');
const MANIFEST = path.join('tools', 'ecosystem-manifest.json');

if (!fs.existsSync(GUARD_TEST) || !fs.existsSync(MANIFEST)) {
  console.error('SOURCE_MISSING: ' + GUARD_TEST + ', ' + MANIFEST);
  process.exit(2);
}

function git(args, opts) {
  const r = cp.spawnSync('git', args, Object.assign({ encoding: 'utf8' }, opts || {}));
  if (r.status !== 0) {
    console.error('GIT_FAILED: git ' + args.join(' ') + ' -> ' + (r.stderr || '').trim());
    process.exit(2);
  }
  return (r.stdout || '').trim();
}

const tags = git(['ls-remote', '--tags', REMOTE]);
const pinResolvable = tags.length > 0;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-evidence-'));
let files;
try {
  git(['clone', '--quiet', '--filter=blob:none', REMOTE, dir]);
  git(['-C', dir, 'checkout', '--quiet', SHA]);
  files = git(['-C', dir, 'ls-files']).split('\n').filter(Boolean);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const markdown = files.filter((f) => f.endsWith('.md')).length;
const javascript = files.filter((f) => f.endsWith('.js')).length;
const manifests = files.filter((f) => path.basename(f) === 'package.json').length;

// Control: an empty or unreadable upstream tree would make every count below
// trivially satisfy the "documentation only" premise.
if (files.length === 0) {
  console.error('CONTROL_FAILED: upstream tree at ' + SHA + ' listed no files');
  process.exit(2);
}

const guard = cp.spawnSync(process.execPath, ['--test', GUARD_TEST], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 64,
});
const guardOut = (guard.stdout || '') + (guard.stderr || '');
function metric(name) {
  const m = guardOut.match(new RegExp('^\\D*' + name + ' (\\d+)$', 'm'));
  return m ? Number(m[1]) : -1;
}
const guardTests = metric('tests');
const guardFail = metric('fail');
const guardGreen = guardTests > 0 && guardFail === 0;

const ok = !pinResolvable && manifests === 0 && markdown > javascript && guardGreen;

console.log(
  'sylph retirement evidence: manifest pin 0.1.0 resolvable=' +
    pinResolvable +
    '; upstream ' +
    SHA +
    ' tracks ' +
    files.length +
    ' files = ' +
    markdown +
    ' markdown, ' +
    javascript +
    ' javascript, ' +
    manifests +
    ' package.json; native tools/ai-guard writer-claim fail ' +
    guardFail +
    ' of ' +
    guardTests +
    ' tests -> ' +
    ok
);
process.exit(ok ? 0 : 1);
