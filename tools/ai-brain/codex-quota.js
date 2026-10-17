'use strict';

/**
 * Ship Dễ — Real Codex CLI session quota telemetry
 *
 * Reads real quota limits from the latest Codex session rollout log
 * (~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl) without touching auth.json.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const claudeUsage = require('./claude-usage');

function resolveCodexSessionsDir(options, deps) {
  const o = options || {};
  const d = deps || {};
  if (o.sessionsDir) return o.sessionsDir;
  if (d.sessionsDir) return d.sessionsDir;

  const env = Object.assign({}, process.env, d.env, o.env);
  const home =
    o.homeDir ||
    d.homeDir ||
    o.home ||
    d.home ||
    env.CODEX_HOME ||
    env.USERPROFILE ||
    env.HOME ||
    (typeof os.homedir === 'function' ? os.homedir() : '.');

  const codexDir = o.codexDir || d.codexDir || path.join(home, '.codex');
  return path.join(codexDir, 'sessions');
}

function findRolloutFiles(dir, fsApi) {
  const results = [];
  try {
    if (!fsApi.existsSync(dir)) return results;
    const entries = fsApi.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
      const isFile = typeof entry.isFile === 'function' ? entry.isFile() : false;
      const name = typeof entry === 'string' ? entry : entry.name;
      const fullPath = path.join(dir, name);

      if (typeof entry === 'string') {
        try {
          const st = fsApi.statSync(fullPath);
          if (st && typeof st.isDirectory === 'function' && st.isDirectory()) {
            results.push(...findRolloutFiles(fullPath, fsApi));
          } else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
            results.push(fullPath);
          }
        } catch {}
      } else if (isDir) {
        results.push(...findRolloutFiles(fullPath, fsApi));
      } else if (isFile && name.startsWith('rollout-') && name.endsWith('.jsonl')) {
        results.push(fullPath);
      } else if (!isDir && !isFile && name.startsWith('rollout-') && name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

function findLatestSessionFile(options, deps) {
  const fsApi = (deps && deps.fs) || (options && options.fs) || fs;
  const sessionsDir = resolveCodexSessionsDir(options, deps);
  const files = findRolloutFiles(sessionsDir, fsApi);
  if (!files || files.length === 0) return null;

  // Rollout files start with rollout-YYYY-MM-DDTHH-mm-ss... which sort chronologically
  files.sort((a, b) => {
    const baseA = path.basename(a);
    const baseB = path.basename(b);
    return baseB.localeCompare(baseA);
  });
  return files[0];
}

function readCodexSessionQuota(options, deps) {
  const o = options || {};
  const d = deps || {};
  const fsApi = d.fs || o.fs || fs;
  const now = Number(d.now || o.now || Date.now());

  const latestFile = findLatestSessionFile(o, d);
  if (!latestFile) {
    return {
      available: false,
      status: 'unknown',
      reason: 'Chưa có log phiên Codex',
    };
  }

  let content;
  try {
    content = fsApi.readFileSync(latestFile, 'utf8');
  } catch (err) {
    return {
      available: false,
      status: 'unknown',
      reason: 'Không đọc được log phiên Codex: ' + err.message,
    };
  }

  const lines = content.trim().split('\n');
  let rateLimitsRecord = null;
  let recordTimestamp = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes('rate_limits')) continue;
    try {
      const parsed = JSON.parse(line);
      const limits = (parsed.payload && parsed.payload.rate_limits) || parsed.rate_limits;
      if (limits && limits.primary) {
        rateLimitsRecord = limits;
        recordTimestamp = parsed.timestamp || (parsed.payload && parsed.payload.timestamp);
        break;
      }
    } catch {}
  }

  if (!rateLimitsRecord || !rateLimitsRecord.primary) {
    return {
      available: false,
      status: 'unknown',
      reason: 'Log phiên Codex không có bản ghi rate_limits hợp lệ',
    };
  }

  const observedAt = recordTimestamp ? new Date(recordTimestamp).toISOString() : null;
  const observedMs = observedAt ? Date.parse(observedAt) : null;
  const primaryWindowMinutes = Number(rateLimitsRecord.primary.window_minutes) || 0;
  const windowMs = primaryWindowMinutes * 60 * 1000;

  // Stale or unmeasured timestamp check: reading older than primary window_minutes is rejected as unknown
  if (
    !observedMs ||
    !Number.isFinite(observedMs) ||
    windowMs <= 0 ||
    now - observedMs > windowMs ||
    now < observedMs - 60 * 1000
  ) {
    return {
      available: false,
      status: 'unknown',
      observedAt,
      reason: `Log phiên Codex đã quá hạn so với cửa sổ ${primaryWindowMinutes} phút`,
    };
  }

  const primaryUsed = Number(rateLimitsRecord.primary.used_percent) || 0;
  const secondaryUsed =
    rateLimitsRecord.secondary && Number.isFinite(rateLimitsRecord.secondary.used_percent)
      ? Number(rateLimitsRecord.secondary.used_percent)
      : 0;

  const isExhausted = primaryUsed >= 100 || secondaryUsed >= 100;
  if (isExhausted) {
    let resetEpoch = null;
    if (primaryUsed >= 100 && rateLimitsRecord.primary.resets_at) {
      resetEpoch = rateLimitsRecord.primary.resets_at;
    } else if (
      secondaryUsed >= 100 &&
      rateLimitsRecord.secondary &&
      rateLimitsRecord.secondary.resets_at
    ) {
      resetEpoch = rateLimitsRecord.secondary.resets_at;
    }
    const resetsAt = resetEpoch ? new Date(resetEpoch * 1000).toISOString() : null;
    return {
      available: true,
      status: 'exhausted',
      observedAt,
      maxAgeMs: windowMs,
      cooldownUntil: resetsAt,
      resetsAt,
      worstRatio: Math.max(primaryUsed, secondaryUsed) / 100,
      reason: 'Đã chạm hạn mức Codex' + (resetsAt ? '; mở lại vào ' + resetsAt : ''),
      rows: [
        {
          window: `${primaryWindowMinutes}m`,
          usedPercent: primaryUsed,
          remainingPercent: Math.max(0, 100 - primaryUsed),
          resetsAt,
        },
        ...(rateLimitsRecord.secondary
          ? [
              {
                window: `${rateLimitsRecord.secondary.window_minutes}m`,
                usedPercent: secondaryUsed,
                remainingPercent: Math.max(0, 100 - secondaryUsed),
                resetsAt: rateLimitsRecord.secondary.resets_at
                  ? new Date(rateLimitsRecord.secondary.resets_at * 1000).toISOString()
                  : null,
              },
            ]
          : []),
      ],
    };
  }

  const worstUsed = Math.max(primaryUsed, secondaryUsed);
  const remainingPercent = Math.max(0, 100 - worstUsed);

  // Use existing statusFrom logic from claudeUsage / agyQuota
  const status = claudeUsage.statusFrom(
    {
      known: true,
      remainingPercent,
      usedPercent: worstUsed,
    },
    o
  );

  return {
    available: true,
    status,
    observedAt,
    maxAgeMs: windowMs,
    worstRatio: worstUsed / 100,
    reason: status === 'tight' ? `Sắp chạm hạn mức Codex (${worstUsed}%)` : 'Còn dư',
    rows: [
      {
        window: `${primaryWindowMinutes}m`,
        usedPercent: primaryUsed,
        remainingPercent: Math.max(0, 100 - primaryUsed),
      },
      ...(rateLimitsRecord.secondary
        ? [
            {
              window: `${rateLimitsRecord.secondary.window_minutes}m`,
              usedPercent: secondaryUsed,
              remainingPercent: Math.max(0, 100 - secondaryUsed),
            },
          ]
        : []),
    ],
  };
}

module.exports = {
  findLatestSessionFile,
  readCodexSessionQuota,
};
