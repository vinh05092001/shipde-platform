'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { recordDecision, Stage, createSecretRedactor } = require('./decisions');

// Safety invariant: bound the verifier process lifetime, never the number of probes.
const REFRESH_TIMEOUT_MS = 120000;

function refreshIsolationVerdict(options) {
  const { validate, validateRefreshed, cwd, runner = spawnSync } = options;
  let original;
  try {
    return validate();
  } catch (error) {
    if (!/^ISOLATION_VERDICT_(STALE|MISSING)\b/.test(error.code || error.message)) throw error;
    original = error;
  }
  let result;
  let value;
  let failure;
  try {
    result = runner(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve(cwd || process.cwd(), 'scripts/ai/isolation/Test-WorkerIsolation.ps1'),
      ],
      {
        cwd: cwd || process.cwd(),
        encoding: 'utf8',
        timeout: options.timeoutMs ?? REFRESH_TIMEOUT_MS,
      }
    );
    if (result.error) throw result.error;
    value = validate();
    if (validateRefreshed) {
      const refreshedValue = validateRefreshed();
      if (value === undefined && refreshedValue !== undefined) {
        value = refreshedValue;
      }
    }
  } catch (error) {
    failure = error;
  }
  const exitCode = result?.status ?? null;
  recordDecision(
    {
      stage: Stage.WARNING,
      warning: failure ? 'ISOLATION_VERDICT_REFRESH_FAILED' : 'ISOLATION_VERDICT_REFRESHED',
      exitCode,
      worktree: cwd || process.cwd(),
    },
    { dir: options.decisionDir }
  );
  if (failure) {
    const redact = createSecretRedactor(process.env);
    const stderr = redact(String(result?.stderr || failure.message || ''))
      .trimEnd()
      .split(/\r?\n/)
      .slice(-20)
      .join('\n');
    const error =
      // A verifier that could not run, or left the verdict stale or missing,
      // reports the original refusal, which names the refresh command.
      /^ISOLATION_VERDICT_(STALE|MISSING)\b/.test(failure.code || failure.message) || result?.error
        ? original
        : failure;
    error.message += `; isolation refresh exitCode=${exitCode}; stderr (last 20 lines):\n${stderr}`;
    error.refreshExitCode = exitCode;
    throw error;
  }
  return value;
}

module.exports = { refreshIsolationVerdict, REFRESH_TIMEOUT_MS };
