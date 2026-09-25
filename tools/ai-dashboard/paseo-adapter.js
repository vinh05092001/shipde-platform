'use strict';

// Paseo replaced Agent Orchestrator as the agent daemon (AO was uninstalled on
// 2026-09-22). This adapter returns the same { health, data: { daemon, sessions } }
// shape the AO adapter did, so every panel that read AO sessions keeps working.
//
// Only `paseo ls -g --json` is called. `paseo daemon status --json` costs ~6s
// per call, while a successful `ls` already proves the daemon is reachable —
// the CLI cannot list agents without it.

const { execFile } = require('child_process');
const { classifySessionRole, computeFreshness } = require('./ao-adapter');
const { redactSensitive } = require('./redaction');

const TIMEOUT_MS = 15000;

function runPaseo(args) {
  return new Promise((resolve) => {
    // paseo ships as an npm .cmd shim, which execFile cannot launch directly on
    // Windows; going through cmd.exe avoids shell:true and its per-call warning.
    const win = process.platform === 'win32';
    execFile(
      win ? 'cmd.exe' : 'paseo',
      win ? ['/d', '/s', '/c', 'paseo', ...args] : args,
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ success: !err, stdout: stdout || '', stderr: stderr || (err ? err.message : '') });
      }
    );
  });
}

const UNIT_MS = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };

/** `ls` reports age as text ("15 hours ago"); turn it back into an approximate timestamp. */
function relativeToIso(text, now = Date.now()) {
  if (typeof text !== 'string') return null;
  const t = text.trim().toLowerCase();
  if (t === 'just now' || t === 'now') return new Date(now).toISOString();
  const m = t.match(/^(an?|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (!m) return null;
  const n = m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1]);
  return new Date(now - n * UNIT_MS[m[2]]).toISOString();
}

/** Maps Paseo's provider ("codex/gpt-5.6-sol") onto the harness names the role classifier knows. */
function harnessOf(provider) {
  const p = String(provider || '').toLowerCase();
  if (p.startsWith('codex')) return 'codex';
  if (p.startsWith('claude')) return 'claude';
  if (p.startsWith('opencode')) return 'dsh';
  return p.split('/')[0] || 'native';
}

function parsePaseoAgents(json, now = Date.now()) {
  const parsed = JSON.parse(json);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : [];
  return list.map((a) => {
    const harness = harnessOf(a.provider);
    const createdAt = relativeToIso(a.created, now);
    const session = { id: a.shortId || a.id, harness, role: a.label || '', branch: '' };
    const role = classifySessionRole(session);
    const status = String(a.status || 'unknown').toUpperCase();
    return {
      id: a.shortId || a.id,
      projectId: 'shipde-platform',
      rawRole: a.name || 'agent',
      roleCategory: role.category,
      displayRole: role.displayRole,
      isWriter: role.isWriter,
      status,
      activity: a.status || 'unknown',
      harness,
      model: a.provider || '',
      branch: '',
      cwd: a.cwd ? redactSensitive(a.cwd) : '',
      isTerminated: status === 'ARCHIVED' || status === 'CLOSED',
      lastActivityAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      freshness: computeFreshness(createdAt),
    };
  });
}

async function collectPaseoState() {
  const started = Date.now();
  const base = { name: 'paseo', provenance: 'paseo ls -g --json' };
  const res = await runPaseo(['ls', '-g', '--json']);
  const observedAt = new Date().toISOString();

  if (!res.success) {
    return {
      health: Object.assign({}, base, {
        status: 'unavailable',
        observedAt,
        latencyMs: Date.now() - started,
        impact: 'Daemon Paseo không chạy hoặc không kết nối được (paseo daemon start)',
        error: redactSensitive(res.stderr.slice(0, 300)),
      }),
      data: { daemon: { ready: false, state: 'stopped' }, sessions: [] },
    };
  }

  try {
    const sessions = parsePaseoAgents(res.stdout);
    const running = sessions.filter((s) => s.status === 'RUNNING').length;
    return {
      health: Object.assign({}, base, {
        status: 'live',
        observedAt,
        latencyMs: Date.now() - started,
        impact: `Daemon Paseo sẵn sàng — ${sessions.length} agent, ${running} đang chạy`,
        error: null,
      }),
      data: { daemon: { ready: true, state: 'ready', engine: 'paseo' }, sessions },
    };
  } catch (err) {
    return {
      health: Object.assign({}, base, {
        status: 'partial',
        observedAt,
        latencyMs: Date.now() - started,
        impact: 'Daemon Paseo trả về JSON lỗi',
        error: redactSensitive(err.message),
      }),
      data: { daemon: { ready: true, state: 'ready', engine: 'paseo' }, sessions: [] },
    };
  }
}

module.exports = { collectPaseoState, parsePaseoAgents, relativeToIso, harnessOf };
