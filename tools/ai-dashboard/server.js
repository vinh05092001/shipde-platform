/**
 * Ship Dễ — Realtime AI Cockpit Server
 * TASK-AI-15: AI15-R01..R09, AI15-AC01..AC11
 * Loopback-only (127.0.0.1), read-only, path-traversal protected server
 * with Server-Sent Events (SSE) realtime transport and multi-source aggregation.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { aggregateCockpitState, getLastAggregatedState } = require('./aggregator');

const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3333;
const HOST = '127.0.0.1'; // Strictly loopback only (AI15-R05)

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'"
].join('; ');

// Applied to every response before any route-specific headers (AI15-R05).
function setBaselineSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// Writes a JSON response body, correctly omitting the body for HEAD
// requests (AI15-R05) while still reporting accurate Content-Length.
function sendJson(req, res, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  }, extraHeaders || {}));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

function isPathTraversal(requestedPath, allowedRoots) {
  if (typeof requestedPath !== 'string') return true;
  // Disallow null bytes, encoded dots, and relative traversal
  if (requestedPath.includes('\0') || /%00/i.test(requestedPath)) return true;
  if (requestedPath.includes('..') || /%2e/i.test(requestedPath)) return true;

  try {
    const decoded = decodeURIComponent(requestedPath);
    if (decoded.includes('..')) return true;

    for (const root of allowedRoots) {
      const safeRoot = path.resolve(root);
      const resolved = path.resolve(safeRoot, decoded.replace(/^\/+/, ''));
      if (resolved === safeRoot || resolved.startsWith(safeRoot + path.sep)) {
        return false;
      }
    }
  } catch {
    return true;
  }
  return true;
}

function createDashboardServer(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '../..');
  const dashboardDir = path.resolve(__dirname);

  // SSE connected clients
  const sseClients = new Set();
  let pollIntervalTimer = null;
  let heartbeatTimer = null;
  let isPolling = false;
  let nextClientSeq = 1; // Deterministic, monotonic per-connection identifier (never Math.random()).

  async function pollAndBroadcast() {
    if (isPolling) return;
    isPolling = true;
    try {
      const state = await aggregateCockpitState({ rootDir });
      const payload = `id: ${state.revision}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`;

      for (const client of sseClients) {
        try {
          client.res.write(payload);
        } catch {
          sseClients.delete(client);
        }
      }
    } catch (err) {
      console.error('[AI-COCKPIT] Background aggregation error:', err.message);
    } finally {
      isPolling = false;
    }
  }

  function broadcastHeartbeat() {
    const heartbeat = `: heartbeat ${new Date().toISOString()}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(heartbeat);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // Fixed allowlist of files this service may ever serve. No repository
  // file, dotfile, or arbitrary path under rootDir is reachable — only these
  // exact dashboard assets and the one documented compatibility entry file
  // (AI15-R05, AI15-R09: read-only, no repository/dotfile browsing).
  function resolveAllowlistedStaticFile(pathname) {
    if (pathname === '/' || pathname === '/index.html') {
      return path.join(dashboardDir, 'index.html');
    }
    if (pathname === '/client.js') {
      return path.join(dashboardDir, 'client.js');
    }
    if (pathname === '/DASHBOARD.html') {
      return path.join(rootDir, 'DASHBOARD.html');
    }
    return null;
  }

  const server = http.createServer(async (req, res) => {
    setBaselineSecurityHeaders(res);

    // 1. CORS: no wildcard. Only the service's own origin (self-referential
    // fetch/EventSource from the served page) and the "null" origin used by
    // the offline DASHBOARD.html opened via file:// are ever allowed.
    const requestOrigin = req.headers.origin;
    const selfOrigin = `http://${req.headers.host || '127.0.0.1'}`;
    if (requestOrigin === 'null' || requestOrigin === selfOrigin) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 2. Strict read-only enforcement (AI15-R05, AI15-R09)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(req, res, 405, {
        error: 'Method Not Allowed: Ship Dễ AI Cockpit is an observational read-only service (AI15-R09)'
      }, { Allow: 'GET, HEAD, OPTIONS' });
      return;
    }

    // Check raw URL for path traversal attempts before parsing
    if (req.url && (req.url.includes('..') || /%2e/i.test(req.url) || req.url.includes('\0'))) {
      sendJson(req, res, 403, { error: 'Forbidden: Path traversal is prohibited (AI15-R05)' });
      return;
    }

    // Malformed request targets (bad percent-encoding, invalid URL syntax)
    // must return 400 and never crash the server (AI15-R05).
    let pathname;
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch {
      sendJson(req, res, 400, { error: 'Bad Request: Malformed URL' });
      return;
    }

    // 3. API Endpoints
    if (pathname === '/api/health') {
      const state = getLastAggregatedState() || await aggregateCockpitState({ rootDir });
      sendJson(req, res, 200, {
        status: state.overallStatus,
        schemaVersion: state.schemaVersion,
        revision: state.revision,
        observedAt: state.observedAt,
        sources: state.sources
      });
      return;
    }

    if (pathname === '/api/state') {
      const state = getLastAggregatedState() || await aggregateCockpitState({ rootDir });
      sendJson(req, res, 200, state);
      return;
    }

    // Server-Sent Events (SSE) Realtime Stream (AI15-AC04, AI15-AC10)
    if (pathname === '/api/events') {
      const sseHeaders = {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, sseHeaders);
        res.end();
        return;
      }

      res.writeHead(200, sseHeaders);

      // Deterministic, monotonic per-connection id — never Math.random().
      const client = { id: nextClientSeq++, res };
      sseClients.add(client);

      // Send initial state on connection
      const state = getLastAggregatedState() || await aggregateCockpitState({ rootDir });
      res.write(`id: ${state.revision}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);

      req.on('close', () => {
        sseClients.delete(client);
      });
      return;
    }

    // Backward-compatible endpoints without fabricated operational values
    if (pathname === '/api/tasks') {
      const state = getLastAggregatedState() || await aggregateCockpitState({ rootDir });
      sendJson(req, res, 200, {
        total: state.workItems.total,
        mergedCount: state.workItems.mergedCount,
        completionPercent: state.workItems.completionPercent,
        tasks: state.workItems.items
      });
      return;
    }

    if (pathname === '/api/status') {
      const state = getLastAggregatedState() || await aggregateCockpitState({ rootDir });
      sendJson(req, res, 200, {
        project: 'Ship Dễ Platform',
        version: state.schemaVersion,
        timestamp: state.observedAt,
        totalTasks: state.workItems.total,
        mergedTasks: state.workItems.mergedCount,
        completionPercent: state.workItems.completionPercent,
        currentActiveTask: state.workItems.activeItem ? state.workItems.activeItem.work_item_id : 'NONE',
        overallStatus: state.overallStatus,
        activeSessions: state.sessions.length
      });
      return;
    }

    if (pathname === '/api/agents') {
      const state = getLastAggregatedState() || await aggregateCockpitState({ rootDir });
      sendJson(req, res, 200, state.sessions);
      return;
    }

    // 4. Static File Resolution — fixed allowlist only (AI15-R05).
    // No repository file or dotfile is ever reachable through this server,
    // regardless of path traversal encoding.
    const filePath = resolveAllowlistedStaticFile(pathname);

    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      return;
    }

    // 404 Not Found
    sendJson(req, res, 404, { error: `Not Found: ${pathname}` });
  });

  // Start background timers
  const pollIntervalMs = options.pollIntervalMs || 5000;
  if (!options.disablePolling) {
    // Initial warm aggregation
    aggregateCockpitState({ rootDir }).catch(() => {});
    pollIntervalTimer = setInterval(pollAndBroadcast, pollIntervalMs);
    heartbeatTimer = setInterval(broadcastHeartbeat, 15000);
  }

  // Cleanup on server close
  const originalClose = server.close.bind(server);
  server.close = function (cb) {
    if (pollIntervalTimer) clearInterval(pollIntervalTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    for (const client of sseClients) {
      try { client.res.end(); } catch {}
    }
    sseClients.clear();
    return originalClose(cb);
  };

  server.getConnectedClientsCount = () => sseClients.size;
  server.pollAndBroadcast = pollAndBroadcast;

  return server;
}

if (require.main === module) {
  const port = DEFAULT_PORT;
  const server = createDashboardServer();

  server.listen(port, HOST, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Ship Dễ AI Developer Cockpit is running!`);
    console.log(`📍 Web Dashboard: http://${HOST}:${port}`);
    console.log(`🔒 Loopback Binding: ${HOST} only (AI15-R05)`);
    console.log(`📡 Realtime SSE Stream: http://${HOST}:${port}/api/events`);
    console.log(`======================================================\n`);
  });
}

module.exports = {
  createDashboardServer,
  isPathTraversal,
  DEFAULT_PORT,
  HOST
};
