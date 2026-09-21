'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  appendAudit,
  buildProfiles,
  ensureProfiles,
  poolRoot,
  publicProfile,
  resolveProfile,
} = require('./pool');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3344;
const DEFAULT_WORKSPACE = path.resolve(__dirname, '..', '..');

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function createLauncher(scriptPath) {
  return ({ profile, mode, workspace }) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-ProfileId',
        profile.id,
        '-ProfileHome',
        profile.home,
        '-Workspace',
        workspace,
        '-Mode',
        mode,
      ],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    child.unref();
    return child.pid;
  };
}

function createPoolServer(options = {}) {
  const env = options.env || process.env;
  const profiles = options.profiles || buildProfiles(env);
  const root = options.root || poolRoot(env);
  const workspace = path.resolve(options.workspace || env.SHIPDE_WORKSPACE || DEFAULT_WORKSPACE);
  const launcher =
    options.launcher ||
    createLauncher(path.resolve(__dirname, '..', '..', 'scripts', 'ai', 'open-agy-profile.ps1'));
  const actionToken = options.actionToken || crypto.randomBytes(24).toString('hex');
  const runtimes = new Map();
  ensureProfiles(profiles);

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${HOST}`);
    } catch {
      return json(res, 400, { error: 'Invalid URL' });
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/client.js') {
      const source = fs.readFileSync(path.join(__dirname, 'client.js'));
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': source.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(source);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, {
        poolSize: profiles.length,
        workspace,
        actionToken,
        profiles: profiles.map((profile) =>
          publicProfile(profile, runtimes.get(profile.id) || null)
        ),
      });
    }

    const action = url.pathname.match(/^\/api\/profiles\/(agy-[1-4])\/(login|open)$/);
    if (req.method === 'POST' && action) {
      if (req.headers['x-shipde-action-token'] !== actionToken) {
        appendAudit(root, { event: 'AGY_POOL_ACTION_REFUSED', reason: 'invalid-action-token' });
        return json(res, 403, { error: 'Action confirmation token is invalid.' });
      }
      try {
        const profile = resolveProfile(profiles, action[1]);
        const mode = action[2] === 'login' ? 'Login' : 'Chat';
        const pid = launcher({ profile, mode, workspace });
        const runtime = { pid, mode, launchedAt: new Date().toISOString() };
        runtimes.set(profile.id, runtime);
        appendAudit(root, { event: 'AGY_PROFILE_LAUNCHED', profileId: profile.id, mode, pid });
        return json(res, 202, { ok: true, profileId: profile.id, runtime });
      } catch (error) {
        appendAudit(root, {
          event: 'AGY_PROFILE_LAUNCH_FAILED',
          profileId: action[1],
          error: error.message,
        });
        return json(res, 400, { error: error.message });
      }
    }

    if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
      return json(res, 405, { error: 'Method not allowed' });
    }
    return json(res, 404, { error: 'Not found' });
  });

  return { server, profiles, actionToken };
}

if (require.main === module) {
  const port = Number.parseInt(process.env.AGY_POOL_PORT || '', 10) || DEFAULT_PORT;
  const { server } = createPoolServer();
  server.listen(port, HOST, () => {
    console.log(`Ship De Agy Worker Pool: http://${HOST}:${port}`);
  });
}

module.exports = { createLauncher, createPoolServer, DEFAULT_PORT, HOST };
