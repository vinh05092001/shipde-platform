'use strict';

/** TASK-AI-140: the repository formatter owns format findings. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const decisions = require('../decisions');
const { runFormatGateForTest } = require('../orchestrate');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tempRepo() {
  const root = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'task-ai-140-'));
  dirs.push(dir);
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || args.join(' '));
    return String(result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'TASK-AI-140 worker']);
  git(['config', 'user.email', 'task-ai-140@shipde.test']);
  fs.writeFileSync(
    path.join(dir, '.prettierrc'),
    '{"singleQuote":true,"semi":true,"printWidth":80}\n'
  );
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  const baseSha = git(['rev-parse', 'HEAD']);
  const targetSha = commit('src.js', 'const x={a:"one",b:2}\n', 'worker');
  setupPrettier(dir);
  return { dir, git, baseSha, targetSha };

  function commit(file, content, message) {
    fs.writeFileSync(path.join(dir, file), content);
    git(['add', '--', file]);
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  }
}

function setupPrettier(dir) {
  const binDir = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const entry = require.resolve('prettier/bin/prettier.cjs');
  const packageDir = path.dirname(path.dirname(entry));
  const launcher = path.join(
    path.resolve(__dirname, '..', '..', '..'),
    'node_modules',
    '.bin',
    'prettier'
  );
  if (process.platform === 'win32') {
    fs.copyFileSync(launcher + '.CMD', path.join(binDir, 'prettier.CMD'));
    fs.copyFileSync(launcher + '.ps1', path.join(binDir, 'prettier.ps1'));
  } else {
    fs.symlinkSync(launcher, path.join(binDir, 'prettier'));
  }
  fs.symlinkSync(packageDir, path.join(dir, 'node_modules', 'prettier'), 'junction');
}

function gate(repo, extra) {
  const log = { formatChecks: [] };
  const opts = {
    workerRoot: repo.dir,
    baseSha: repo.baseSha,
    targetSha: repo.targetSha,
    log,
    decisionDir: path.join(repo.dir, 'decisions'),
    item: { id: 'TASK-AI-140', role: 'author.foundation' },
    ...(extra || {}),
  };
  return runFormatGateForTest(opts).then((result) => ({ result, log }));
}

test('AF-R01: repo Prettier fixes exactly failing paths, commits, and skips model repair', async () => {
  const repo = tempRepo();
  let repairCalls = 0;
  const { result } = await gate(repo, {
    repair: async () => (repairCalls++, {}),
    o: {
      log: (code, value) => {
        if (code === 'FORMAT_AUTOFIX_FAILED') console.error(JSON.stringify(value));
      },
    },
  });
  assert.equal(result.status, 'PASSED', result.reason || JSON.stringify(result));
  assert.equal(repairCalls, 0);
  assert.equal(repo.git(['show', '--format=', '--name-only', 'HEAD']), 'src.js');
  const records = decisions.readDecisions({
    dir: path.join(repo.dir, 'decisions'),
    now: Date.parse('2026-10-10T12:00:00Z'),
  });
  assert.ok(
    records.some((entry) => entry.stage === 'format_autofixed' && entry.files.includes('src.js'))
  );
});

test('AF-R02: syntax error falls back to repair with the exact command and logic restriction', async () => {
  const repo = tempRepo();
  const syntaxSha = (() => {
    fs.writeFileSync(path.join(repo.dir, 'src.js'), 'function {\n');
    repo.git(['add', 'src.js']);
    repo.git(['commit', '-q', '-m', 'syntax error']);
    return repo.git(['rev-parse', 'HEAD']);
  })();
  let received;
  await gate(
    { ...repo, targetSha: syntaxSha },
    {
      repair: async (findings) => {
        received = findings[0];
        return {};
      },
    }
  );
  assert.match(received.detail, /\.\/node_modules\/\.bin\/prettier --write src\.js/);
  assert.match(received.detail, /do not change behavior, logic/);
});

test('AF-R02: repair logic changes are refused with REPAIR_SCOPE_EXCEEDED', async () => {
  const repo = tempRepo();
  const syntaxSha = (() => {
    fs.writeFileSync(path.join(repo.dir, 'src.js'), 'function {\n');
    repo.git(['add', 'src.js']);
    repo.git(['commit', '-q', '-m', 'introduce syntax failure']);
    return repo.git(['rev-parse', 'HEAD']);
  })();
  const { result } = await gate(repo, {
    repair: async () => {
      fs.writeFileSync(path.join(repo.dir, 'unrelated.js'), 'const logicChanged = true;\n');
      repo.git(['add', 'unrelated.js']);
      repo.git(['commit', '-q', '-m', 'logic changed']);
      return { sha: repo.git(['rev-parse', 'HEAD']) };
    },
    targetSha: syntaxSha,
  });
  assert.equal(result.status, 'REFUSED');
  assert.match(result.reason, /REPAIR_SCOPE_EXCEEDED/);
});

test('AF-R03: unrelated dirty worker changes refuse the formatter with WORKER_TREE_DIRTY', async () => {
  const repo = tempRepo();
  fs.writeFileSync(path.join(repo.dir, 'unrelated.txt'), 'unrelated\n');
  const { result } = await gate(repo);
  assert.equal(result.status, 'REFUSED');
  assert.match(result.reason, /WORKER_TREE_DIRTY/);
});

test('AF-R01: worker prettier .cmd launches correctly when .ps1 is absent', async () => {
  if (process.platform !== 'win32') return;
  const repo = tempRepo();
  const ps1Launcher = path.join(repo.dir, 'node_modules', '.bin', 'prettier.ps1');
  if (fs.existsSync(ps1Launcher)) {
    fs.unlinkSync(ps1Launcher);
  }
  const { result } = await gate(repo);
  assert.equal(result.status, 'PASSED', result.reason || JSON.stringify(result));
  assert.equal(repo.git(['show', '--format=', '--name-only', 'HEAD']), 'src.js');
});

test('AF-R02: repair logic changes inside failing files are refused with REPAIR_SCOPE_EXCEEDED', async () => {
  const repo = tempRepo();
  const unformattedSha = (() => {
    fs.writeFileSync(path.join(repo.dir, 'src.js'), 'const   val  =   "original" ;\n');
    repo.git(['add', 'src.js']);
    repo.git(['commit', '-q', '-m', 'unformatted file']);
    return repo.git(['rev-parse', 'HEAD']);
  })();
  const { result } = await gate(
    { ...repo, targetSha: unformattedSha },
    {
      commitFormatFix: async () => ({ status: 'FAILED', reason: 'prettier failed to auto-fix' }),
      repair: async () => {
        fs.writeFileSync(path.join(repo.dir, 'src.js'), 'const val = "tampered";\n');
        repo.git(['add', 'src.js']);
        repo.git(['commit', '-q', '-m', 'repair changed logic inside failing file']);
        return { sha: repo.git(['rev-parse', 'HEAD']) };
      },
    }
  );
  assert.equal(result.status, 'REFUSED');
  assert.match(
    result.reason,
    /REPAIR_SCOPE_EXCEEDED: format-only repair differs from the repository Prettier output/
  );
});

test('AF-R01 / FEAT-AUTH-05: >5 failing files in nested dirs reported with backslashes auto-fix only failing subset', async () => {
  const repo = tempRepo();
  const subDirs = ['src/auth', 'src/settings/security', 'src/components', 'src/utils'];
  for (const d of subDirs) {
    fs.mkdirSync(path.join(repo.dir, d), { recursive: true });
  }

  const baseSha = repo.git(['rev-parse', 'HEAD']);

  // More than 5 unformatted files under nested dirs
  const unformattedFiles = [
    'src/auth/mfa.controller.ts',
    'src/auth/mfa.service.ts',
    'src/auth/totp.util.ts',
    'src/settings/security/page.tsx',
    'src/components/LoginView.tsx',
    'src/utils/token.ts',
  ];
  for (let i = 0; i < unformattedFiles.length; i++) {
    fs.writeFileSync(
      path.join(repo.dir, unformattedFiles[i]),
      `export   const  item${i}  =  "val${i}" ;\n`
    );
  }

  // Already formatted file in the commit (touches more files than the failing subset)
  const formattedFile = 'src/auth/types.ts';
  fs.writeFileSync(
    path.join(repo.dir, formattedFile),
    "export type MFAStatus = 'enabled' | 'disabled';\n"
  );

  for (const f of [...unformattedFiles, formattedFile]) {
    repo.git(['add', f]);
  }
  repo.git(['commit', '-q', '-m', 'feat(auth): FEAT-AUTH-05 commit with >5 failing files']);
  const multiSha = repo.git(['rev-parse', 'HEAD']);

  let repairCalls = 0;
  const { result } = await gate(
    { ...repo, baseSha, targetSha: multiSha },
    {
      repair: async () => (repairCalls++, {}),
    }
  );

  assert.equal(result.status, 'PASSED', result.reason || JSON.stringify(result));
  assert.equal(repairCalls, 0);

  // Auto-fix commit touched ONLY the 6 failing files, NOT the already formatted file
  const headFiles = repo
    .git(['show', '--format=', '--name-only', 'HEAD'])
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .sort();
  assert.deepEqual(headFiles, unformattedFiles.slice().sort());
  assert.ok(!headFiles.includes(formattedFile));

  // Decision records show all 6 files with forward slashes (not truncated to 5)
  const records = decisions.readDecisions({
    dir: path.join(repo.dir, 'decisions'),
    now: Date.parse('2026-10-10T12:00:00Z'),
  });
  const autoFixed = records.find((entry) => entry.stage === 'format_autofixed');
  assert.ok(autoFixed, 'format_autofixed decision must exist');
  assert.equal(autoFixed.files.length, 6);
  for (const f of unformattedFiles) {
    assert.ok(autoFixed.files.includes(f), `Decision must include ${f}`);
  }
});

test('AF-R02 / FEAT-AUTH-05: repair fallback handles >5 files in nested dirs without truncation', async () => {
  const repo = tempRepo();
  const subDirs = ['src/auth', 'src/settings/security', 'src/components', 'src/utils'];
  for (const d of subDirs) {
    fs.mkdirSync(path.join(repo.dir, d), { recursive: true });
  }

  const baseSha = repo.git(['rev-parse', 'HEAD']);

  const files = [
    'src/auth/mfa.controller.ts',
    'src/auth/mfa.service.ts',
    'src/auth/totp.util.ts',
    'src/settings/security/page.tsx',
    'src/components/LoginView.tsx',
    'src/utils/token.ts',
  ];
  for (let i = 0; i < files.length; i++) {
    fs.writeFileSync(path.join(repo.dir, files[i]), `const   x${i}  =  ${i} ;\n`);
    repo.git(['add', files[i]]);
  }
  repo.git(['commit', '-q', '-m', 'commit >5 unformatted files']);
  const targetSha = repo.git(['rev-parse', 'HEAD']);

  let receivedFinding;
  const { result } = await gate(
    { ...repo, baseSha, targetSha },
    {
      commitFormatFix: async () => ({ status: 'FAILED', reason: 'prettier failed' }),
      repair: async (findings) => {
        receivedFinding = findings[0];
        for (let i = 0; i < files.length; i++) {
          fs.writeFileSync(path.join(repo.dir, files[i]), `const x${i} = ${i};\n`);
          repo.git(['add', files[i]]);
        }
        repo.git(['commit', '-q', '-m', 'repair format all 6 files']);
        return { sha: repo.git(['rev-parse', 'HEAD']) };
      },
    }
  );

  assert.ok(receivedFinding, 'repair must have received findings');
  for (const f of files) {
    assert.ok(receivedFinding.detail.includes(f), `Repair command detail must include ${f}`);
  }
  assert.equal(receivedFinding.dirtyPaths.length, 6);
  assert.equal(result.status, 'PASSED', result.reason || JSON.stringify(result));
});
