'use strict';
// A live host process holds the existing scheduled-lane job lock while waiting.
// This gives the coordinator a real PID and retains the pool's job identity.
const fs = require('fs');
const path = require('path');
const pool = require('./agy-pool-runtime');
const { safeText } = require('./coordinator-runtime');

async function runPoolWriter(file, deps = {}) {
  const expectedCwd = fs.realpathSync(deps.expectedCwd || process.cwd());
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!pool.isValidAccountId(job.accountId)) throw new Error('INVALID_ACCOUNT_ID');
  if (typeof job.cwd !== 'string' || !job.cwd) throw new Error('INVALID_JOB_CWD');
  // The process cwd is supplied by the host launcher, outside the job payload.
  // Existence alone does not bind a writer-writable job to its assigned tree.
  let resolvedCwd;
  try {
    resolvedCwd = fs.realpathSync(job.cwd);
    if (!fs.statSync(resolvedCwd).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('INVALID_JOB_CWD');
  }
  if (path.relative(expectedCwd, resolvedCwd) !== '') throw new Error('JOB_CWD_OUTSIDE_WORKTREE');
  const result = await (deps.submitJob || pool.submitJob)(
    job.accountId,
    { cwd: resolvedCwd, prompt: job.prompt, model: job.model, candidateKey: job.candidateKey },
    {}
  );
  return {
    state: result.state,
    exitCode: result.exitCode,
    reason:
      result.state === 'quota'
        ? 'RESOURCE_EXHAUSTED'
        : result.reason
          ? safeText(result.reason)
          : null,
    jobId: result.jobId ? safeText(result.jobId) : null,
  };
}

if (require.main === module)
  runPoolWriter(process.argv[2])
    .then((result) => {
      const sanitized = {
        state: result.state,
        exitCode: result.exitCode,
        reason: result.reason ? safeText(result.reason) : null,
        jobId: result.jobId ? safeText(result.jobId) : null,
      };
      console.log(JSON.stringify(sanitized));
      process.exitCode = result.exitCode || 0;
    })
    .catch((error) => {
      console.error(safeText(error.code || error.message || 'POOL_WRITER_FAILED'));
      process.exitCode = 1;
    });

module.exports = { runPoolWriter };
