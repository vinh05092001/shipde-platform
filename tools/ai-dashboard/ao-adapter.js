/**
 * Ship Dễ — Agent Orchestrator (AO) Adapter
 * TASK-AI-15: AI15-R01, AI15-R04, AI15-R06, AI15-AC02
 * Queries live Agent Orchestrator daemon and session state without mock fallbacks.
 * Correctly distinguishes implementation authors, reviewers, analysts, and supervisors.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { redactPath, redactSensitive } = require('./redaction');

const CMD_TIMEOUT = 5000;
const MAX_BUFFER = 1024 * 1024;

// Canonical Windows desktop install location (scripts/ai/common.ps1
// Resolve-ShipDeAoExecutable uses the same path as its documented fallback).
const CANONICAL_AO_EXECUTABLE_WINDOWS =
  'C:\\Program Files\\agent-orchestrator\\resources\\daemon\\ao.exe';

let cachedAoExecutable = null;

/**
 * Resolves an absolute, existing AO executable path without ever invoking a
 * shell. Node's execFile does not reliably locate .cmd/.bat shims on Windows
 * unless they are found through an explicit, extension-aware PATH scan, so
 * this performs that scan itself and falls back to the documented canonical
 * install path. No client input is involved; this only reads local
 * filesystem/PATH state.
 */
function resolveAoExecutable() {
  if (cachedAoExecutable) return cachedAoExecutable;

  const isWindows = process.platform === 'win32';
  const candidateNames = isWindows ? ['ao.exe', 'ao.cmd', 'ao.bat', 'ao'] : ['ao'];
  const pathEnv = process.env.PATH || process.env.Path || '';
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    for (const name of candidateNames) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          cachedAoExecutable = candidate;
          return cachedAoExecutable;
        }
      } catch {
        // Not present in this PATH directory; keep scanning.
      }
    }
  }

  if (isWindows) {
    try {
      if (fs.statSync(CANONICAL_AO_EXECUTABLE_WINDOWS).isFile()) {
        cachedAoExecutable = CANONICAL_AO_EXECUTABLE_WINDOWS;
        return cachedAoExecutable;
      }
    } catch {
      // Canonical install path missing; AO is genuinely unavailable.
    }
  }

  // Last resort: rely on default PATH resolution (matches prior behavior).
  // If AO truly isn't installed, execFile will fail cleanly and the caller
  // reports the source as unavailable — no fabricated data results.
  cachedAoExecutable = 'ao';
  return cachedAoExecutable;
}

function resetAoExecutableCacheForTest() {
  cachedAoExecutable = null;
}

function runAoCommand(args) {
  return new Promise((resolve) => {
    execFile(
      resolveAoExecutable(),
      args,
      { timeout: CMD_TIMEOUT, maxBuffer: MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            exitCode: error.code || 1,
            stdout: stdout ? stdout.trim() : '',
            stderr: stderr ? stderr.trim() : error.message,
          });
        } else {
          resolve({
            success: true,
            exitCode: 0,
            stdout: stdout ? stdout.trim() : '',
            stderr: '',
          });
        }
      }
    );
  });
}

function classifySessionRole(session) {
  const branch = (session.branch || '').toLowerCase();
  const harness = (session.harness || '').toLowerCase();
  const id = (session.id || '').toLowerCase();
  const role = (session.role || '').toLowerCase();

  // 1. Deterministic supervisor
  if (role === 'orchestrator' || id.includes('orchestrator') || branch.includes('orchestrator')) {
    return {
      category: 'SUPERVISOR',
      displayRole: 'Deterministic AO Supervisor',
      isWriter: false,
    };
  }

  // 2. Independent reviewer
  if (
    branch.includes('codex') ||
    harness.includes('codex') ||
    id.includes('codex') ||
    role === 'reviewer'
  ) {
    return {
      category: 'REVIEWER',
      displayRole: 'Independent Codex Reviewer',
      isWriter: false,
    };
  }

  // 3. Claude Code: analyst & reviewer fallback; authorized secondary author / code repair when assigned
  if (harness.includes('claude') || branch.includes('claude') || id.includes('claude')) {
    const isAssignedRepair =
      role.includes('repair') ||
      role.includes('author') ||
      id.includes('repair') ||
      id.includes('author') ||
      branch.startsWith('fix/') ||
      branch.startsWith('feat/');

    if (isAssignedRepair) {
      return {
        category: 'REPAIR_AUTHOR',
        displayRole: 'Claude Code Repair / Secondary Author',
        isWriter: true,
      };
    }
    return {
      category: 'ANALYST',
      displayRole: 'Claude Analyst & Reviewer Fallback',
      isWriter: false,
    };
  }

  // 4. Gemini / AGY: Primary implementation author
  if (harness === 'agy' || harness === 'gemini' || id.includes('gemini')) {
    return {
      category: 'AUTHOR',
      displayRole: 'Primary Implementation Author',
      isWriter: true,
    };
  }

  // 5. 9Router / DSH: Constrained author (deterministic, low-risk only per AGENTS.md)
  if (harness === 'dsh' || branch.includes('dsh') || id.includes('dsh')) {
    return {
      category: 'CONSTRAINED_AUTHOR',
      displayRole: '9Router Constrained Author',
      isWriter: true,
    };
  }

  // 6. Unknown / Unrecognized worker — read-only, even if branch starts with feat/
  return {
    category: 'WORKER',
    displayRole: 'Autonomous Worker (Read-Only)',
    isWriter: false,
  };
}

function computeFreshness(timestampStr) {
  if (!timestampStr) return { status: 'unknown', secondsAgo: null, label: 'Chưa có thông tin' };
  try {
    const diffMs = Date.now() - new Date(timestampStr).getTime();
    const secondsAgo = Math.max(0, Math.floor(diffMs / 1000));

    if (secondsAgo < 60) {
      return { status: 'live', secondsAgo, label: `${secondsAgo}s trước (LIVE)` };
    }
    if (secondsAgo < 300) {
      const mins = Math.floor(secondsAgo / 60);
      return { status: 'recent', secondsAgo, label: `${mins} phút trước` };
    }
    const mins = Math.floor(secondsAgo / 60);
    return { status: 'stale', secondsAgo, label: `${mins} phút trước (STALE)` };
  } catch {
    return { status: 'unknown', secondsAgo: null, label: 'Lỗi thời gian' };
  }
}

function parseAoStatus(statusJson) {
  try {
    const data = JSON.parse(statusJson);
    return {
      ready: data.state === 'ready' || data.ready === 'ready',
      state: data.state || 'unknown',
      pid: data.pid || null,
      port: data.port || null,
      uptime: data.uptime || null,
      health: data.health || 'ok',
      dataDir: data.dataDir ? redactPath(data.dataDir) : null,
    };
  } catch (err) {
    return {
      ready: false,
      state: 'malformed_json',
      error: err.message,
    };
  }
}

function parseAoSessions(sessionsJson) {
  try {
    const parsed = JSON.parse(sessionsJson);
    const rawSessions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.data)
        ? parsed.data
        : [];

    return rawSessions.map((s) => {
      const roleInfo = classifySessionRole(s);
      const activityTime = s.lastActivityAt || s.updatedAt || s.createdAt;
      const freshness = computeFreshness(activityTime);

      return {
        id: s.id,
        projectId: s.projectId || 'shipde-platform',
        rawRole: s.role || 'worker',
        roleCategory: roleInfo.category,
        displayRole: roleInfo.displayRole,
        isWriter: roleInfo.isWriter,
        status: (s.status || 'unknown').toUpperCase(),
        activity: s.activity || 'unknown',
        harness: s.harness || 'native',
        branch: s.branch || '',
        isTerminated: Boolean(s.isTerminated),
        lastActivityAt: s.lastActivityAt || null,
        createdAt: s.createdAt || null,
        updatedAt: s.updatedAt || null,
        freshness,
      };
    });
  } catch (err) {
    return [];
  }
}

async function collectAoState(projectName = 'shipde-platform') {
  const startTime = Date.now();

  try {
    const [statusRes, sessionsRes] = await Promise.all([
      runAoCommand(['status', '--json']),
      runAoCommand(['session', 'ls', '--project', projectName, '--json']),
    ]);

    if (!statusRes.success) {
      return {
        health: {
          name: 'ao',
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          latencyMs: Date.now() - startTime,
          provenance: 'ao status --json',
          impact: 'Agent Orchestrator daemon is not running or unreachable',
          error: redactSensitive(statusRes.stderr || 'AO daemon not reachable'),
        },
        data: {
          daemon: { ready: false, state: 'stopped' },
          sessions: [],
        },
      };
    }

    const daemon = parseAoStatus(statusRes.stdout);
    if (!daemon.ready) {
      return {
        health: {
          name: 'ao',
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          latencyMs: Date.now() - startTime,
          provenance: 'ao status --json',
          impact: 'Agent Orchestrator reported unready state',
          error: daemon.error || `Daemon state: ${daemon.state}`,
        },
        data: {
          daemon,
          sessions: [],
        },
      };
    }

    let sessions = [];
    let sessionsHealthNote = 'None — AO daemon and sessions healthy';
    let sourceStatus = 'live';
    let sessionError = null;

    if (sessionsRes.success) {
      try {
        JSON.parse(sessionsRes.stdout);
        sessions = parseAoSessions(sessionsRes.stdout);
      } catch (jsonErr) {
        sourceStatus = 'partial';
        sessionsHealthNote = `Daemon ready but session output returned malformed JSON: ${redactSensitive(jsonErr.message)}`;
        sessionError = sessionsHealthNote;
      }
    } else {
      sourceStatus = 'partial';
      sessionsHealthNote = `Daemon ready but session query returned error: ${redactSensitive(sessionsRes.stderr)}`;
      sessionError = redactSensitive(sessionsRes.stderr);
    }

    return {
      health: {
        name: 'ao',
        status: sourceStatus,
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: `ao status / session ls --project ${projectName}`,
        impact: sessionsHealthNote,
        error: sessionError,
      },
      data: {
        daemon,
        sessions,
      },
    };
  } catch (err) {
    return {
      health: {
        name: 'ao',
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: 'ao CLI',
        impact: 'Agent Orchestrator query failed with exception',
        error: redactSensitive(err.message),
      },
      data: {
        daemon: { ready: false, state: 'error' },
        sessions: [],
      },
    };
  }
}

module.exports = {
  runAoCommand,
  classifySessionRole,
  computeFreshness,
  parseAoStatus,
  parseAoSessions,
  collectAoState,
  resolveAoExecutable,
  resetAoExecutableCacheForTest,
};
