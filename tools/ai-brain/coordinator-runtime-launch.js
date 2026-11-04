'use strict';
// External harness launch with bounded, drained output capture.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { resolveCommand } = require('./discovery/spawn');
const policy = require('./coordinator');
const { safeText } = require('./coordinator-text');
const { MAX_LOG_BYTES, MAX_LOG_LINE_BYTES, TRUNCATION } = require('./coordinator-runtime-log');

function createLauncher({ options = {}, launchLog }) {
  function launch(item, candidate, review = false, promptOverride) {
    const dir = path.join(item.cwd, '.oc');
    fs.mkdirSync(dir, { recursive: true });
    const promptFile = path.join(dir, review ? 'review-prompt.md' : 'writer-prompt.md');
    let prompt = promptOverride;
    if (!prompt) {
      const taskFile = path.resolve(item.cwd, item.task);
      prompt = fs.readFileSync(taskFile, 'utf8');
      try {
        prompt += '\n\nReview feedback:\n' + fs.readFileSync(path.join(dir, 'review.txt'), 'utf8');
      } catch {}
      if (candidate.harness === 'codex')
        prompt +=
          '\n\nSandbox handoff: edit the full working tree and run available checks. Do not run git write commands or commit; host coordinator commits output. Record exact blocked checks in .oc/pr-body.md. Never change protected gates or print secrets.';
    }
    fs.writeFileSync(promptFile, prompt + '\n');
    let command,
      args,
      env = { ...process.env };
    if (candidate.harness === 'codex') {
      command = 'codex';
      args = ['exec', '-m', candidate.model, '-s', review ? 'read-only' : 'workspace-write', '-'];
    } else if (
      candidate.harness === 'agy-pool' &&
      !review &&
      policy.family(candidate.model) !== 'claude'
    ) {
      const accountId = candidate.accountId || candidate.account;
      if (!require('./agy-pool-runtime').isValidAccountId(accountId))
        throw new Error('INVALID_ACCOUNT_ID');
      const jobFile = path.join(dir, 'pool-writer-job.json');
      fs.writeFileSync(
        jobFile,
        JSON.stringify({
          accountId,
          model: candidate.model,
          cwd: item.cwd,
          prompt,
          candidateKey: candidate.candidateKey,
        })
      );
      command = process.execPath;
      args = [path.join(__dirname, 'coordinator-pool-writer.js'), jobFile];
    } else if (candidate.harness === 'claude') {
      command = 'claude';
      args = [
        '-p',
        prompt,
        '--model',
        candidate.model,
        '--output-format',
        'json',
        ...(review ? ['--permission-mode', 'plan', '--allowedTools', 'Read,Glob,Grep'] : []),
      ];
    } else if (candidate.harness === 'opencode' && policy.family(candidate.model) !== 'claude') {
      command = 'opencode';
      args = [
        'run',
        '-m',
        candidate.model,
        '--format',
        'json',
        ...(review ? ['--agent', 'plan'] : []),
        '-f',
        promptFile,
        'Follow the attached task.',
      ];
      if (review)
        env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
          permission: { edit: 'deny', bash: 'deny', external_directory: 'deny' },
        });
    } else throw new Error('UNSUPPORTED_COORDINATOR_HARNESS');
    const resolved =
      command === process.execPath ? { file: command, args: [] } : resolveCommand(command, {});
    if (resolved.error) throw new Error('LAUNCH_COMMAND_' + resolved.error);
    const file = review ? path.join(dir, 'review-output.txt') : launchLog(item);
    fs.writeFileSync(file, '');
    let totalBytesWritten = 0;
    let logTruncated = false;
    const writeBoundedLine = (line) => {
      if (logTruncated) return;
      const text = safeText(line) + '\n';
      const byteLen = Buffer.byteLength(text, 'utf8');
      if (totalBytesWritten + byteLen > MAX_LOG_BYTES - Buffer.byteLength(TRUNCATION)) {
        fs.appendFileSync(file, TRUNCATION);
        logTruncated = true;
        return;
      }
      fs.appendFileSync(file, text);
      totalBytesWritten += byteLen;
    };

    const spawnFn = options.spawn || spawn;
    const child = spawnFn(resolved.file, [...resolved.args, ...args], {
      cwd: item.cwd,
      env,
      windowsHide: true,
      shell: false,
      detached: !review,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stdin.end(candidate.harness === 'codex' ? prompt : undefined);
    const streamDonePromises = [child.stdout, child.stderr].filter(Boolean).map((stream) => {
      return new Promise((res) => {
        let parts = [],
          bytes = 0,
          dropping = false;
        const flush = () => {
          if (!dropping && bytes)
            writeBoundedLine(Buffer.concat(parts, bytes).toString('utf8').replace(/\r$/, ''));
          parts = [];
          bytes = 0;
          dropping = false;
        };
        stream.on('data', (chunk) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (logTruncated) {
            const now = new Date();
            fs.utimesSync(file, now, now);
            return;
          }
          let offset = 0;
          while (offset < data.length) {
            const newline = data.indexOf(10, offset);
            const end = newline === -1 ? data.length : newline;
            const length = end - offset;
            if (!dropping && bytes + length > MAX_LOG_LINE_BYTES) {
              parts = [];
              bytes = 0;
              dropping = true;
              writeBoundedLine('[TRUNCATED: LOG_LINE_LIMIT_EXCEEDED]');
            } else if (!dropping && length) {
              parts.push(Buffer.from(data.subarray(offset, end)));
              bytes += length;
            }
            if (newline !== -1) flush();
            offset = end + 1;
            if (logTruncated) {
              parts = [];
              bytes = 0;
              break;
            }
          }
        });
        const onEnd = () => {
          flush();
          res();
        };
        stream.on('end', onEnd);
        stream.on('close', onEnd);
        stream.on('error', onEnd);
      });
    });

    let childExitCode = null;
    const childClosePromise = new Promise((resolve) => {
      child.on('error', (error) => {
        writeBoundedLine(error.code || 'SPAWN_FAILED');
        childExitCode = 1;
        resolve();
      });
      child.on('close', (code) => {
        childExitCode = code ?? 1;
        resolve();
      });
    });

    const completed = Promise.all([childClosePromise, ...streamDonePromises]).then(() => ({
      exitCode: childExitCode ?? 1,
    }));
    if (!review) child.unref();
    return {
      pid: child.pid,
      log: file,
      cannotCommit: candidate.harness === 'codex',
      completed,
      child,
    };
  }
  return launch;
}

module.exports = {
  createLauncher,
};