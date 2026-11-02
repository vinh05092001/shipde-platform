'use strict';
// A live host process holds the existing scheduled-lane job lock while waiting.
// This gives the coordinator a real PID and retains the pool's job identity.
const fs = require('fs');
const pool = require('./agy-pool-runtime');
async function runPoolWriter(file, deps = {}) {
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!pool.isValidAccountId(job.accountId)) throw new Error('INVALID_ACCOUNT_ID');
  const result = await (deps.submitJob || pool.submitJob)(job.accountId, { cwd: job.cwd, prompt: job.prompt, model: job.model, candidateKey: job.candidateKey }, {});
  return { state: result.state, exitCode: result.exitCode, reason: result.state === 'quota' ? 'RESOURCE_EXHAUSTED' : result.reason ? require('./coordinator-runtime').safeText(result.reason) : null, jobId: result.jobId || null };
}
if (require.main === module) runPoolWriter(process.argv[2]).then((result) => { console.log(JSON.stringify(result)); process.exitCode = result.exitCode || 0; }).catch((error) => { console.error(error.code || 'POOL_WRITER_FAILED'); process.exitCode = 1; });
module.exports = { runPoolWriter };
