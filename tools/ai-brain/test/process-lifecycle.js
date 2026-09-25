/* TASK-AI-50: before/after process list for Hermes inspect/stop/cleanup */
'use strict';
const { runHarness, getHarness } = require('../harness');
const os = require('os');

const hermes = getHarness('hermes');

// We spawn a real detached process (node --version, which exits immediately but
// demonstrates the mechanism). On a real Hermes run the process would be the
// hermes binary and stay alive.
const { spawn } = require('child_process');

console.log('=== Before launch: no Hermes process ===');
// List node processes (approximation of process list)
const beforePs = require('child_process').spawnSync(
  'tasklist',
  ['/FO', 'CSV', '/FI', 'IMAGENAME eq node.exe'],
  {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  }
);
const beforeLines = (beforePs.stdout || '').split('\n').filter((l) => l.includes('"node.exe"'));
console.log('node.exe processes before:', beforeLines.length);

// Launch a detached long-running process (ping -n 30 = sleeps ~30s)
let pid = null;
const child = spawn('ping', ['-n', '30', '127.0.0.1'], {
  detached: true,
  stdio: 'ignore',
  shell: false,
  windowsHide: true,
});
child.unref();
pid = child.pid;
console.log('\n=== After launch: pid', pid, '===');

// Show the process
const afterPs = require('child_process').spawnSync(
  'tasklist',
  ['/FO', 'CSV', '/FI', 'PID eq ' + pid],
  {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  }
);
const found = (afterPs.stdout || '').split('\n').filter((l) => l.includes(String(pid)));
console.log('Process', pid, 'in tasklist:', found.length > 0 ? 'FOUND' : 'not found');
if (found.length) console.log('  ', found[0].trim());

// Get stop instruction from adapter
const stopInstruction = hermes.stop('dir:C:/w', { pid });
console.log('\nstop instruction from adapter:', JSON.stringify(stopInstruction));

// Execute the stop: tree:true means the whole tree (taskkill /T /F), because
// the pid from the detached spawn is the node shim and Hermes spawns its own
// children; killing only the parent would orphan them. process.kill alone does
// not reap trees on Windows.
if (stopInstruction && stopInstruction.kill) {
  const killArgs = ['/PID', String(stopInstruction.kill), '/F'];
  if (stopInstruction.tree) killArgs.push('/T');
  const killed = require('child_process').spawnSync('taskkill', killArgs, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  console.log(
    'taskkill',
    killArgs.join(' '),
    '→',
    (killed.stdout || killed.stderr || '').trim().split('\n')[0]
  );
}

// Brief wait then check
setTimeout(() => {
  const cleanPs = require('child_process').spawnSync(
    'tasklist',
    ['/FO', 'CSV', '/FI', 'PID eq ' + pid],
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }
  );
  const cleanLines = (cleanPs.stdout || '').split('\n').filter((l) => l.includes(String(pid)));
  console.log('\n=== After stop: pid', pid, '===');
  console.log(
    'Process still in tasklist:',
    cleanLines.length > 0 ? 'YES (still cleaning up)' : 'GONE — no orphan'
  );
  console.log('\n=== Process list demonstration complete ===');
}, 1500);
