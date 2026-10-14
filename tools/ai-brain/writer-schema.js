'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { candidateKey } = require('./candidates');

// This is the writer's final result, not the pool's process-state envelope.
function contract(key, nonce) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['candidateKey', 'nonce', 'status', 'artifacts'],
    properties: {
      candidateKey: { type: 'string', enum: [key] },
      nonce: { type: 'string', enum: [nonce] },
      status: { type: 'string', enum: ['completed', 'failed', 'blocked'] },
      artifacts: { type: 'array', items: { type: 'string' } },
    },
  };
}

function prepareJob(job) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const schema = contract(job.candidateKey, nonce);
  return {
    ...job,
    resultSchema: schema,
    resultSchemaPath: `.shipde/writer-result-${nonce}.schema.json`,
    prompt: `${job.prompt || ''}\nReturn your final response as JSON matching this result contract. Do not wrap it in Markdown. Artifacts are paths to evidence; use failed or blocked when work is incomplete.\n${JSON.stringify(schema)}`,
  };
}

function validate(text, schema) {
  let value;
  try {
    value = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, reason: 'WRITER_RESULT_INVALID_JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, reason: 'WRITER_RESULT_NOT_OBJECT' };
  const props = schema.properties;
  if (value.candidateKey !== props.candidateKey.enum[0])
    return { ok: false, reason: 'WRITER_RESULT_CANDIDATE_MISMATCH' };
  if (value.nonce !== props.nonce.enum[0])
    return { ok: false, reason: 'WRITER_RESULT_NONCE_MISMATCH' };
  if (
    !props.status.enum.includes(value.status) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.some((v) => typeof v !== 'string') ||
    Object.keys(value).some((k) => !schema.required.includes(k))
  )
    return { ok: false, reason: 'WRITER_RESULT_SCHEMA_MISMATCH' };
  return { ok: true, value };
}

function materialise(job, root) {
  const file = path.join(root, job.resultSchemaPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(job.resultSchema), 'utf8');
}

function poolResultText(text) {
  // Antigravity CLI wraps the final answer in response; the pool result.json
  // is only process telemetry (state, exitCode, startedAt, finishedAt).
  try {
    const envelope = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    if (typeof envelope.response === 'string') return envelope.response;
  } catch {}
  return text;
}

async function verify(candidate, options) {
  const o = options || {};
  const key = candidateKey(candidate);
  const job = prepareJob({
    candidateKey: key,
    harness: candidate.harness,
    accountId: candidate.accountId,
    model: candidate.modelId,
    cwd: o.workerRoot || o.cwd,
    prompt:
      'Read-only capability probe. Do not use tools, change files or execute commands. Return status completed and artifacts [].',
  });
  try {
    let result;
    let text;
    if (candidate.harness === 'agy-pool') {
      const pool = require('./agy-pool-runtime');
      const previous = pool.readResult(candidate.accountId, o);
      if (previous && previous.state === 'running')
        return { ok: false, reason: 'WRITER_SCHEMA_POOL_BUSY' };
      result = pool.submitJob(candidate.accountId, job, { ...o, timeoutMs: 60000 });
      if (!result || result.state !== 'ok' || result.exitCode !== 0) {
        const known = [
          'POOL_TIMEOUT',
          'CORRUPT_RESULT',
          'INVALID_ACCOUNT_ID',
          'ADAPTER_TIMEOUT',
          'UNSUPPORTED_PLATFORM',
        ];
        const adapterReason = String((result && result.reason) || '').split(':')[0];
        const state =
          result && ['quota', 'login-required', 'error'].includes(result.state)
            ? result.state
            : 'NO_SUCCESS';
        return {
          ok: false,
          reason: `WRITER_SCHEMA_POOL_${known.includes(adapterReason) ? adapterReason : state}`,
        };
      }
      text = poolResultText(pool.readOutText(candidate.accountId, o));
    } else {
      if (typeof o.run !== 'function')
        return { ok: false, reason: 'WRITER_SCHEMA_ISOLATED_LAUNCHER_MISSING' };
      result = await o.run(job);
      if (!result || result.exitCode !== 0) {
        const known = [
          'CODEX_REQUIRES_ISOLATION',
          'WRITER_RESULT_INVALID_JSON',
          'WRITER_RESULT_NONCE_MISMATCH',
          'WRITER_RESULT_CANDIDATE_MISMATCH',
          'WRITER_RESULT_SCHEMA_MISMATCH',
          'WRITER_RESULT_NOT_OBJECT',
          'WRITER_RESULT_NOT_COMPLETED',
        ];
        const reason = result && (result.failureReason || result.localFailure);
        const stderr = String((result && result.stderr) || '');
        if (/CODEX_REQUIRES_ISOLATION/.test(stderr))
          return { ok: false, reason: 'CODEX_REQUIRES_ISOLATION' };
        if (/unexpected argument.*--output-schema|unknown.*--output-schema/i.test(stderr))
          return { ok: false, reason: 'WRITER_SCHEMA_FLAG_UNSUPPORTED' };
        if (/not logged in|login required|authentication required|unauthorized/i.test(stderr))
          return { ok: false, reason: 'WRITER_SCHEMA_AUTH_NEEDED' };
        if (/rate limit|quota|usage limit/i.test(stderr))
          return { ok: false, reason: 'WRITER_SCHEMA_QUOTA_UNAVAILABLE' };
        if (/model not found|unknown model|not supported.*model/i.test(stderr))
          return { ok: false, reason: 'WRITER_SCHEMA_MODEL_UNAVAILABLE' };
        return {
          ok: false,
          reason: known.includes(reason)
            ? reason
            : result && result.timedOut
              ? 'WRITER_SCHEMA_TIMEOUT'
              : 'WRITER_SCHEMA_CODEX_LAUNCH_FAILED',
        };
      }
      text = result.stdout;
    }
    const checked = validate(text, job.resultSchema);
    if (!checked.ok) return checked;
    if (checked.value.status !== 'completed' || checked.value.artifacts.length)
      return { ok: false, reason: 'WRITER_SCHEMA_PROBE_NOT_COMPLETED' };
    return {
      ok: true,
      candidateKey: key,
      nonce: job.resultSchema.properties.nonce.enum[0],
      method: candidate.harness === 'codex' ? 'codex-exec-output-schema' : 'agy-worker-result-json',
    };
  } catch (err) {
    // No untrusted CLI output or secret-bearing error messages in evidence.
    if (err.message === 'CODEX_REQUIRES_ISOLATION') return { ok: false, reason: err.message };
    return {
      ok: false,
      reason: err.code === 'ETIMEDOUT' ? 'WRITER_SCHEMA_TIMEOUT' : 'WRITER_SCHEMA_PROBE_FAILED',
    };
  }
}

module.exports = { contract, prepareJob, validate, materialise, poolResultText, verify };
