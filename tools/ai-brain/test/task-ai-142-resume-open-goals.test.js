const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../../scripts/ai/goal-resume.ps1');
for (const live of [false, true])
  test(
    `scheduled resume selects an open goal and ${live ? 'skips its live owner' : 'ignores completed goals'}`,
    { skip: process.platform !== 'win32' },
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduled-goal-'));
      try {
        const goals = path.join(root, 'data', 'goals');
        for (const [id, status] of [
          ['a-completed', 'COMPLETED'],
          ['b-open', 'PLANNED'],
        ]) {
          const dir = path.join(goals, id);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'goal.json'), JSON.stringify({ id, status }));
        }
        if (live)
          fs.writeFileSync(
            path.join(goals, 'b-open', 'run.lock'),
            JSON.stringify({ pid: process.pid })
          );
        const cli = path.join(root, 'tools', 'ai-brain', 'cli.js');
        fs.mkdirSync(path.dirname(cli), { recursive: true });
        fs.writeFileSync(
          cli,
          `require('fs').appendFileSync('calls.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');`
        );
        const run = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            '-WorkDir',
            root,
            '-NodeCommand',
            process.execPath,
          ],
          {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 30000,
            env: { ...process.env, AI_BRAIN_MACHINE_DATA: 'none', NINEROUTER_API_KEY: '' },
          }
        );
        assert.equal(run.status, 0, run.stderr);
        const calls = fs.existsSync(path.join(root, 'calls.jsonl'))
          ? fs
              .readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
              .trim()
              .split('\n')
              .map(JSON.parse)
          : [];
        assert.deepEqual(
          calls,
          live
            ? []
            : [
                ['goal', 'resume', 'b-open'],
                ['goal', 'status', 'b-open'],
              ]
        );
        if (live)
          assert.equal(
            JSON.parse(fs.readFileSync(path.join(goals, 'b-open', 'run.lock'))).pid,
            process.pid
          );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  );

test(
  'GoalResume registration previews automatic selection without a fixed goal',
  { skip: process.platform !== 'win32' },
  () => {
    const scheduler = path.resolve(__dirname, '../../../scripts/ai/schedule-task.ps1');
    const run = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scheduler,
        '-Action',
        'Register',
        '-ControllerAction',
        'GoalResume',
        '-WorkingDirectory',
        os.tmpdir(),
        '-TargetScript',
        script,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, AI_BRAIN_MACHINE_DATA: 'none', NINEROUTER_API_KEY: '' },
      }
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /PREVIEW ONLY/);
    const argumentsLine = run.stdout.split(/\r?\n/).find((line) => line.startsWith('Arguments'));
    assert.ok(argumentsLine);
    assert.doesNotMatch(argumentsLine, /-GoalId/);
    assert.match(argumentsLine, /-WorkDir/);
  }
);
