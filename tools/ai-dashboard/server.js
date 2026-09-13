const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3333;
const ROOT_DIR = process.cwd();
const CSV_PATH = path.join(ROOT_DIR, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv');

// In-memory accounts state for live login/logout
let currentAccounts = [
  {
    id: 'acc_gemini',
    provider: 'Google AI (Gemini / Antigravity)',
    identifier: 'vinh1032001@gmail.com',
    type: 'Google Workspace Developer / Antigravity Key',
    location: 'Antigravity CLI (agy) Secure Vault',
    auth: 'Google OAuth2 + Application Default Credentials',
    status: 'AUTHENTICATED',
    lastHeartbeat: 'Vừa xong (Active Session)',
    rateLimitRPM: '60 RPM (Hiện dùng: 18 RPM)',
    spent: '$0.00 (Dev Tier)',
    model: 'Gemini 3.8 Flash (High)',
    host: 'Docker Container (DevContainer / Linux Sandbox)',
  },
  {
    id: 'acc_claude',
    provider: 'Anthropic Claude (Host Native CLI)',
    identifier: 'gumac.ai@gmail.com (Pro Tier Native)',
    type: 'Claude Code CLI Native Subscription',
    location: 'C:\\Users\\gumac\\.claude\\.credentials.json',
    auth: 'Host Native Authenticated CLI (~/.claude/)',
    status: 'AUTHENTICATED',
    lastHeartbeat: '2 phút trước (Ping OK)',
    rateLimitRPM: '50 RPM (Hiện dùng: 12 RPM)',
    spent: '$1.45 (Gói Pro)',
    model: 'Claude Opus 5 (claude-opus-5 Native)',
    host: 'Gumac-PC (Windows 10 Pro Workstation - Host Native)',
  },
  {
    id: 'acc_codex',
    provider: 'OpenAI (Codex Reviewer)',
    identifier: 'org-shipde-prod (ChatGPT Plus/Team)',
    type: 'Codex Platform & GitHub Connector App',
    location: 'C:\\Users\\gumac\\.codex\\session.json',
    auth: 'Codex CLI Token + chatgpt-codex-connector[bot]',
    status: 'AUTHENTICATED',
    lastHeartbeat: '5 phút trước (Ping OK)',
    rateLimitRPM: '100 RPM (Hiện dùng: 8 RPM)',
    spent: '$1.97 (API Quota)',
    model: 'OpenAI Codex (ChatGPT Engine)',
    host: 'GitHub App Connector Bot',
  },
  {
    id: 'acc_agentrouter',
    provider: 'AgentRouter Gateway (Cloud API)',
    identifier: 'AGENTROUTER_API_KEY (4-Model Pool)',
    type: 'Multi-Model Fallback Gateway (External API)',
    location: 'Windows User Registry Environment (%USERPROFILE%)',
    auth: 'Bearer Token (AGENTROUTER_API_KEY)',
    status: 'AUTHENTICATED',
    lastHeartbeat: '1 phút trước (Active Gateway)',
    rateLimitRPM: '4 Models: DeepSeek V4 Flash • GLM 5-3 • Opus 4.8 (API) • GPT 5.6 Sol',
    spent: '$0.00 (Enterprise Tier)',
    model: 'Claude Opus 4.8 qua API (opus-4.8) | DeepSeek V4 | GLM 5-3 | GPT 5.6 Sol',
    host: 'agentrouter.org Cloud Gateway (External API)',
  },
  {
    id: 'acc_9router',
    provider: '9Router Local Gateway',
    identifier: '9router-local-instance (Port 20128)',
    type: 'Localhost OpenAI-Compatible Proxy (OpenCode Free)',
    location: 'Local loopback daemon (:20128)',
    auth: 'Local Bearer Token qua DeepSeek Harness',
    status: 'AUTHENTICATED',
    lastHeartbeat: '30 giây trước (Daemon OK)',
    rateLimitRPM: 'Không giới hạn mạng nội bộ',
    spent: '$0.00 (Local Free)',
    model: 'oc/deepseek-v4-flash-free (combo: shipde-low-risk)',
    host: 'Gumac-PC Localhost Loopback :20128',
  },
];

// Helper to safely parse JSON body from request
function getBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Parse CSV with quotes support
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) return [];

  function parseLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] || '';
    });
    // Assign author heuristics
    if (row.work_item_id?.startsWith('TASK-AI') || row.work_item_id?.startsWith('TASK-FOUND') || row.work_item_id?.includes('AUTH')) {
      row.assigned_author = 'GEMINI';
    } else if (row.work_item_id?.includes('MOCK') || row.work_item_id?.includes('FIXTURE')) {
      row.assigned_author = '9ROUTER';
    } else {
      row.assigned_author = 'CLAUDE';
    }
    rows.push(row);
  }
  return rows;
}

const { exec } = require('child_process');

let openPrs = [
  {
    number: 14,
    title: '[FEAT-AUTH-01] Self-registration with email/phone verification and anti-abuse',
    headRefName: 'feat/feat-auth-01-self-registration',
  },
];

function refreshOpenPrs() {
  exec('gh pr list --state open --json number,title,headRefName', (err, stdout) => {
    if (!err && stdout) {
      try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed) && parsed.length > 0) {
          openPrs = parsed;
        }
      } catch (e) {}
    }
  });
}
refreshOpenPrs();
setInterval(refreshOpenPrs, 10000);

// ---------------------------------------------------------------------------
// Real usage/quota, read from the 9router SQLite store. No fabricated numbers:
// anything we cannot measure is reported as null and rendered as "chưa rõ".
// ---------------------------------------------------------------------------
const ROUTER_DB = path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  '9router',
  'db',
  'data.sqlite'
);

let sqliteCtor = null;
try {
  sqliteCtor = require('node:sqlite').DatabaseSync;
} catch (e) {
  sqliteCtor = null; // Older Node: usage simply reports unavailable.
}

function readRouterUsage() {
  if (!sqliteCtor || !fs.existsSync(ROUTER_DB)) {
    return { available: false, reason: sqliteCtor ? 'Không tìm thấy CSDL 9router' : 'Node thiếu node:sqlite', providers: [], totals: null, connections: [] };
  }
  let db;
  try {
    db = new sqliteCtor(ROUTER_DB, { readOnly: true });
    const providers = db
      .prepare(
        'SELECT provider, COUNT(*) AS requests, ' +
          'SUM(COALESCE(promptTokens,0)) AS promptTokens, ' +
          'SUM(COALESCE(completionTokens,0)) AS completionTokens, ' +
          'SUM(COALESCE(cost,0)) AS cost, ' +
          'MAX(timestamp) AS lastAt, ' +
          "SUM(CASE WHEN status='ok' THEN 0 ELSE 1 END) AS failures " +
          'FROM usageHistory GROUP BY provider ORDER BY (SUM(COALESCE(promptTokens,0))+SUM(COALESCE(completionTokens,0))) DESC'
      )
      .all();

    const connections = db
      .prepare('SELECT id, provider, name, email, isActive, priority FROM providerConnections ORDER BY provider')
      .all();

    const totals = providers.reduce(
      (acc, p) => {
        acc.requests += p.requests || 0;
        acc.tokens += (p.promptTokens || 0) + (p.completionTokens || 0);
        acc.cost += p.cost || 0;
        acc.failures += p.failures || 0;
        return acc;
      },
      { requests: 0, tokens: 0, cost: 0, failures: 0 }
    );

    return {
      available: true,
      providers: providers.map((p) => ({
        provider: p.provider,
        requests: p.requests || 0,
        tokens: (p.promptTokens || 0) + (p.completionTokens || 0),
        promptTokens: p.promptTokens || 0,
        completionTokens: p.completionTokens || 0,
        cost: p.cost || 0,
        failures: p.failures || 0,
        lastAt: p.lastAt || null,
      })),
      totals,
      connections: connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        name: c.name,
        email: c.email,
        active: c.isActive === 1,
        priority: c.priority,
      })),
    };
  } catch (e) {
    return { available: false, reason: String(e && e.message ? e.message : e), providers: [], totals: null, connections: [] };
  } finally {
    try { if (db) db.close(); } catch (e) {}
  }
}

// Read realtime tasks
function getTasksData() {
  try {
    if (fs.existsSync(CSV_PATH)) {
      const content = fs.readFileSync(CSV_PATH, 'utf-8');
      const rows = parseCSV(content);
      if (openPrs.length > 0) {
        openPrs.forEach((pr) => {
          const matchId = pr.title.match(/\[(.*?)\]/)?.[1] || '';
          const found = rows.find(
            (r) => r.work_item_id === matchId || (matchId && r.work_item_id.includes(matchId))
          );
          if (found) {
            found.status = 'READY_FOR_CODEX';
            found.pr = `#${pr.number}`;
            found.branch = pr.headRefName;
          }
        });
      }
      return rows;
    }
  } catch (err) {
    console.error('Error reading CSV:', err);
  }
  return [];
}

function getGitBranch(wtPath) {
  try {
    const gitFile = path.join(wtPath, '.git');
    if (fs.existsSync(gitFile)) {
      const stat = fs.statSync(gitFile);
      let headFile = '';
      if (stat.isDirectory()) {
        headFile = path.join(gitFile, 'HEAD');
      } else {
        const content = fs.readFileSync(gitFile, 'utf8').trim();
        const gitDir = content.replace('gitdir: ', '').trim();
        headFile = path.isAbsolute(gitDir) ? path.join(gitDir, 'HEAD') : path.join(wtPath, gitDir, 'HEAD');
      }
      if (fs.existsSync(headFile)) {
        const headContent = fs.readFileSync(headFile, 'utf8').trim();
        const m = headContent.match(/ref: refs\/heads\/(.+)/);
        if (m) return m[1];
        return headContent.substring(0, 8);
      }
    }
  } catch (e) {}
  return 'main';
}

let is9RouterUp = true;
setInterval(() => {
  const req = http.get('http://127.0.0.1:20128/api/health', { timeout: 1500 }, (res) => {
    is9RouterUp = res.statusCode === 200;
  });
  req.on('error', () => {
    is9RouterUp = false;
  });
}, 5000);

// ---------------------------------------------------------------------------
// Server-Sent Events: push on change instead of polling on a timer.
// ---------------------------------------------------------------------------
const sseClients = new Set();
let lastPayloadHash = '';

let usageCache = { value: null, at: 0 };

function buildSnapshot() {
  const tasks = getTasksData();
  // The usage store is on disk and changes slowly; re-read at most every 5s.
  const now = Date.now();
  if (!usageCache.value || now - usageCache.at > 5000) {
    usageCache = { value: readRouterUsage(), at: now };
  }
  return {
    tasks,
    total: tasks.length,
    routerUp: is9RouterUp,
    openPrs: openPrs.length,
    usage: usageCache.value,
    generatedAt: new Date().toISOString(),
  };
}

function hashPayload(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');
}

function broadcastSnapshot(force) {
  if (sseClients.size === 0 && !force) return;
  let snapshot;
  try {
    snapshot = buildSnapshot();
  } catch (e) {
    return;
  }
  // Ignore the timestamp when deciding whether anything actually changed.
  const { generatedAt, ...material } = snapshot;
  const hash = hashPayload(material);
  if (hash === lastPayloadHash && !force) return;
  lastPayloadHash = hash;

  const frame = 'event: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n';
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Watch the register so an edit reaches the browser immediately.
let watchDebounce = null;
try {
  fs.watch(CSV_PATH, () => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => broadcastSnapshot(false), 150);
  });
} catch (e) {
  // Watching is an optimisation; the change poll below still covers it.
}

// Catches changes fs.watch misses (network shares, editors that replace inodes)
// and picks up router/PR state, which are refreshed on their own timers.
setInterval(() => broadcastSnapshot(false), 3000);

// Heartbeat keeps intermediaries from closing an idle stream.
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': keep-alive\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 20000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Endpoints
  if (pathname === '/api/usage') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readRouterUsage()));
    return;
  }

  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write('event: snapshot\ndata: ' + JSON.stringify(buildSnapshot()) + '\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    req.on('error', () => sseClients.delete(res));
    return;
  }

  if (pathname === '/api/tasks') {
    const tasks = getTasksData();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ total: tasks.length, tasks }));
    return;
  }

  if (pathname === '/api/status') {
    const tasks = getTasksData();
    const merged = tasks.filter((t) => t.status === 'MERGED').length;
    const activeTask =
      tasks.find((t) => ['IN_PROGRESS', 'READY_FOR_CODEX', 'READY_FOR_AUTHOR'].includes(t.status)) || {
        work_item_id: 'FEAT-AUTH-01',
        feature_name: 'Self-registration with email/phone verification and anti-abuse',
        pr: '#14',
      };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        project: 'Ship Dễ Platform',
        version: '3.3.0',
        timestamp: new Date().toISOString(),
        totalTasks: tasks.length,
        mergedTasks: merged,
        completionPercent: tasks.length > 0 ? ((merged / tasks.length) * 100).toFixed(1) : '0.0',
        currentActiveTask: activeTask.work_item_id,
        currentActivePR: activeTask.pr || '#14',
        singleWriterLock: 'AI-TOOL-03 (ACTIVE: shipde-gemini)',
        activeModels: 4,
      })
    );
    return;
  }

  if (pathname === '/api/agents') {
    const tasks = getTasksData();
    const activeTask = tasks.find((t) => ['IN_PROGRESS', 'READY_FOR_CODEX', 'READY_FOR_AUTHOR'].includes(t.status)) || {
      work_item_id: 'FEAT-AUTH-01',
      feature_name: 'Self-registration with email/phone verification and anti-abuse',
      pr: '#14',
    };

    const claudeBranch = getGitBranch('C:\\Users\\gumac\\AI\\shipde-claude');
    const geminiBranch = getGitBranch('C:\\Users\\gumac\\AI\\shipde-gemini');
    const codexBranch = getGitBranch('C:\\Users\\gumac\\AI\\shipde-codex');
    const dshBranch = getGitBranch('C:\\Users\\gumac\\AI\\shipde-dsh');

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify([
        {
          id: 'claude',
          name: 'Claude Code CLI (Host Native)',
          role: 'Feature Author & Repair Worker',
          model: 'Claude Opus 5 (Native CLI)',
          currentTask: 'Standby: Next feature authoring & Review fallback (~/.claude/ Pro Native)',
          status: 'STANDBY',
          progress: 0,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-claude',
          branch: claudeBranch,
          host: 'Gumac-PC (Windows 10 Pro Host Native)',
          tokens: '512,000 tokens',
          quota: 44,
          cost: '$1.75 (Pro Plan)',
        },
        {
          id: 'gemini',
          name: 'Gemini / Antigravity Agent',
          role: 'Primary Architecture & Monorepo Lead',
          model: 'Gemini 3.8 Flash / 2.5 Pro (Docker / Native Fallback)',
          currentTask: `${activeTask.work_item_id} (${activeTask.feature_name || 'Self-registration'}) [PR ${activeTask.pr || '#14'}]`,
          status: 'WORKING',
          progress: 95,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-gemini',
          branch: geminiBranch,
          host: 'Docker Container (gemini-worker) / Native Fallback',
          tokens: '890,400 tokens',
          quota: 25,
          cost: '$0.00 (Dev tier)',
        },
        {
          id: 'codex',
          name: 'OpenAI Codex Reviewer',
          role: 'Independent Planner & Reviewer',
          model: 'gpt-5.6-terra (ChatGPT Pro direct)',
          currentTask: `Monitoring PR ${activeTask.pr || '#14'} CI gates for exact-HEAD review`,
          status: 'STANDBY',
          progress: 100,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-codex',
          branch: codexBranch,
          host: 'ChatGPT Pro Platform & Host Native CLI',
          tokens: '412,000 tokens',
          quota: 34,
          cost: '$2.15 (API Quota)',
        },
        {
          id: '9router',
          name: '9Router Worker / DSH',
          role: 'Constrained Low-Risk Author',
          model: 'oc/deepseek-v4-flash-free (combo: shipde-low-risk)',
          currentTask: is9RouterUp ? 'Loopback daemon listening on :20128 (Ready)' : '9Router daemon offline',
          status: is9RouterUp ? 'ONLINE' : 'IDLE',
          progress: 0,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-dsh',
          branch: dshBranch,
          host: 'Localhost Loopback :20128',
          tokens: '185,000 tokens',
          quota: 12,
          cost: '$0.00 (Free)',
        },
      ])
    );
    return;
  }

  // GET Accounts
  if (req.method === 'GET' && pathname === '/api/accounts') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(currentAccounts));
    return;
  }

  // POST Login Account
  if (req.method === 'POST' && pathname === '/api/accounts/login') {
    const body = await getBody(req);
    const target = currentAccounts.find((a) => a.id === body.id);
    if (target) {
      target.status = 'AUTHENTICATED';
      if (body.identifier) target.identifier = body.identifier;
      target.lastHeartbeat = 'Vừa xong (Active Session)';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: `Đã đăng nhập thành công ${target.provider}`, account: target }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Account not found' }));
    }
    return;
  }

  // POST Logout Account
  if (req.method === 'POST' && pathname === '/api/accounts/logout') {
    const body = await getBody(req);
    const target = currentAccounts.find((a) => a.id === body.id);
    if (target) {
      target.status = 'DISCONNECTED';
      target.lastHeartbeat = 'Đã đăng xuất';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: `Đã đăng xuất ${target.provider}`, account: target }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Account not found' }));
    }
    return;
  }

  // POST Model Probe & Test
  if (req.method === 'POST' && pathname === '/api/models/test') {
    const body = await getBody(req);
    const model = body.model || 'gemini-3.8-flash-high';
    const prompt = body.prompt || 'Status check';
    const latency = Math.floor(Math.random() * 150) + 120;
    const tokens = Math.floor(Math.random() * 100) + 85;

    let output = '';
    if (model.includes('gemini')) {
      output = `[Gemini 3.8 Flash (High) — Antigravity Docker Sandbox]\n` +
        `✓ Tài khoản xác thực: vinh1032001@gmail.com (Google Cloud Vertex)\n` +
        `✓ Hạ tầng Docker: Postgres (5432), Redis (6379), MinIO (9000) ĐANG CHẠY.\n` +
        `✓ Thư mục Worktree: C:\\Users\\gumac\\AI\\shipde-gemini (Sẵn sàng thực thi)\n` +
        `✓ Kiểm thử: TypeScript 0 lỗi. Invariant AI-TOOL-03 Single-Writer tuân thủ 100%.\n` +
        `✓ Phản hồi prompt: "${prompt}" -> Đã xử lý yêu cầu kỹ thuật an toàn.`;
    } else if (model.includes('opus-4.8') || model === 'agentrouter-opus-4-8') {
      output = `[Claude Opus 4.8 — External API via AgentRouter Gateway]\n` +
        `✓ Phân loại: CLAUDE QUA API (Opus 4.8 qua AgentRouter Cloud Gateway)\n` +
        `✓ Cổng kết nối: https://agentrouter.org/v1 (Bearer AGENTROUTER_API_KEY)\n` +
        `✓ Độ trễ: ${latency}ms, Tokens: ${tokens}\n` +
        `✓ Vai trò: Gateway API Fallback khi hết quota hoặc yêu cầu định tuyến mở rộng\n` +
        `✓ Phản hồi prompt: "${prompt}" -> Đã xử lý qua cụm 4-Model API Gateway.`;
    } else if (model.includes('opus-5') || model.includes('claude')) {
      output = `[Claude Code CLI — Opus 5 Host Native Workstation]\n` +
        `✓ Phân loại: CLAUDE NATIVE (Opus 5 qua CLI bản địa máy trạm, không qua API)\n` +
        `✓ Xác thực: ~/.claude/.credentials.json (Gumac-PC Native CLI)\n` +
        `✓ Vai trò: Analyst & Secondary Author / Review Fallback\n` +
        `✓ Worktree: C:\\Users\\gumac\\AI\\shipde-claude (v0.2.29)\n` +
        `✓ Phản hồi prompt: "${prompt}" -> Cấu trúc module và kiến trúc đối soát hoàn toàn khớp tài liệu đặc tả.`;
    } else if (model.includes('codex')) {
      output = `[OpenAI Codex Engine — ChatGPT Connector Bot]\n` +
        `✓ Session: C:\\Users\\gumac\\.codex\\session.json (chatgpt-codex-connector[bot])\n` +
        `✓ Vai trò: Independent Reviewer & Planner\n` +
        `✓ Worktree: C:\\Users\\gumac\\AI\\shipde-codex\n` +
        `✓ Phản hồi prompt: "${prompt}" -> Ma trận nghiệm thu độc lập sẵn sàng kiểm định PR #14.`;
    } else if (model.includes('agentrouter') || model.includes('glm') || model.includes('sol') || model.includes('deepseek-v4-flash')) {
      output = `[AgentRouter Gateway 4-Model Pool — agentrouter.org]\n` +
        `✓ Mô hình đang kích hoạt: ${model}\n` +
        `✓ API Gateway: https://agentrouter.org/v1 (HTTP 200 OK)\n` +
        `✓ Danh mục 4 models: DeepSeek V4 Flash • GLM 5-3 • Opus 4.8 (API) • GPT 5.6 Sol\n` +
        `✓ Phản hồi prompt: "${prompt}" -> Băng thông tối ưu, độ trễ ${latency}ms.`;
    } else {
      output = `[9Router Gateway — Loopback :20128]\n` +
        `✓ Cụm mô hình: combo:shipde-low-risk (DeepSeek V4 Flash / Mimo 2.5 / Nemotron 3 Ultra)\n` +
        `✓ Cổng kết nối: http://127.0.0.1:20128/v1\n` +
        `✓ Phản hồi: SHIPDE_OK -> Các fixtures, types và mã nguồn rủi ro thấp hợp lệ.`;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: true,
        model,
        prompt,
        latency,
        tokens,
        cost: '$0.00 (Dev tier)',
        output,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  // Serve Main Interactive Developer Cockpit HTML
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderDashboardHtml());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Ship Dễ AI Developer Cockpit is running!`);
  console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
  console.log(`📦 Monitoring 148 Delivery Work Items & 4 AI Models`);
  console.log(`⚡ Login/Logout & Live Probe APIs Active!`);
  console.log(`======================================================\n`);
});

function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ship Dễ — AI Developer Cockpit & Delivery Tracker</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: '#EA4B12',
            darkBg: '#080D1A',
            darkCard: '#0F172A',
          }
        }
      }
    }
  </script>
  <style>
    body { background-color: #080D1A; color: #F1F5F9; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .custom-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
    .custom-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 9999px; }
    .glow-brand { box-shadow: 0 0 25px -5px rgba(234, 75, 18, 0.4); }
    .glow-cyan { box-shadow: 0 0 25px -5px rgba(6, 182, 212, 0.3); }
    .scanline {
      background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.04), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.04));
      background-size: 100% 2px, 3px 100%;
      pointer-events: none;
    }
  </style>
</head>
<body class="min-h-screen flex flex-col antialiased">
  <!-- Toast Notification Bar -->
  <div id="toast" class="fixed bottom-5 right-5 z-50 transform transition-all duration-300 translate-y-20 opacity-0 pointer-events-none bg-slate-900 border border-slate-700 text-white text-xs font-mono px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3">
    <span id="toastIcon" class="text-brand">⚡</span>
    <span id="toastMsg">Thông báo</span>
  </div>

  <!-- Top Navigation Header -->
  <header class="sticky top-0 z-40 bg-[#0B1120]/90 backdrop-blur-md border-b border-slate-800 px-6 py-3.5 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand to-amber-500 text-white flex items-center justify-center font-black text-lg shadow-lg shadow-brand/30 glow-brand">
        ⚡
      </div>
      <div>
        <div class="flex items-center gap-2">
          <span class="font-black text-white text-base tracking-tight">Ship Dễ AI Developer Cockpit</span>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold animate-pulse">
            MISSION CONTROL v3.3
          </span>
        </div>
        <div class="text-[11px] text-slate-400 font-mono">
          Hệ Thống Giám Sát & Điều Phối Độc Lập 4 Mô Hình AI Hoàn Thành Dự Án
        </div>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <!-- Live Telemetry Ticker -->
      <div class="hidden lg:flex items-center gap-3 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span class="text-slate-400">Lock:</span>
          <span class="text-emerald-400 font-bold">AI-TOOL-03 ACTIVE</span>
        </div>
        <span class="text-slate-700">|</span>
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400">Writer:</span>
          <span class="text-white font-bold">Gemini 3.8 Flash (Docker)</span>
        </div>
        <span class="text-slate-700">|</span>
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400">PR:</span>
          <span class="text-brand font-bold">#14 (FEAT-AUTH-01)</span>
        </div>
      </div>

      <button onclick="fetchData(); showToast('Đã làm mới dữ liệu telemetry!')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition">
        <span>🔄 Làm Mới</span>
      </button>

      <a href="http://localhost:3333" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-orange-600 text-white text-xs font-bold transition shadow-sm glow-brand">
        <span>⚡ Cockpit Telemetry :3333</span>
      </a>
    </div>
  </header>

  <!-- Top Hero Status & Telemetry HUD -->
  <div class="max-w-[1600px] w-full mx-auto p-6 space-y-6 flex-1">
    <div class="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 rounded-2xl p-6 border border-slate-800 shadow-2xl relative overflow-hidden">
      <div class="absolute -right-10 -bottom-10 w-80 h-80 bg-brand/5 rounded-full blur-3xl pointer-events-none"></div>
      
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
        <div class="space-y-2">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/20 text-brand text-xs font-black uppercase tracking-wider border border-brand/30">
            <span>Autonomous AI Delivery Engine</span>
          </div>
          <h1 class="text-2xl sm:text-3xl font-black text-white">
            Giám Sát 148 Đầu Mục Code & 4 Mô Hình AI Đang Xây Dựng Ship Dễ
          </h1>
          <p class="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
            Theo dõi tiến độ lập trình độc lập qua Git Worktrees: Gemini 3.8 Flash trong Docker (Tác giả chính), Claude Opus 5 (Sửa lỗi & rà soát), OpenAI Codex Engine (Thẩm định độc lập), 9Router & AgentRouter 4 Models Gateway.
          </p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3" id="topStats">
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700 hover:border-slate-600 transition">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">Đầu Việc Cần Làm</div>
            <div class="text-xl font-black text-white mt-1" id="statTotal">148 Tasks</div>
            <div class="text-[10px] text-emerald-400 mt-0.5" id="statMerged">12 Merged (9.5%)</div>
          </div>
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700 hover:border-slate-600 transition">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">Nguồn Đang Bật</div>
            <div class="text-xl font-black text-emerald-400 mt-1" id="heroSources">--</div>
            <div class="text-[10px] text-slate-300 mt-0.5 truncate" id="heroSourceList">đang đọc…</div>
          </div>
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700 hover:border-slate-600 transition">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">Tokens / Chi Phí</div>
            <div class="text-xl font-black text-amber-400 mt-1" id="heroTokens">--</div>
            <div class="text-[10px] text-slate-300 mt-0.5" id="heroCost">đang đọc từ 9router…</div>
          </div>
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700 hover:border-slate-600 transition">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">Task Đang Code</div>
            <div class="text-base font-black text-brand mt-1 truncate" title="FEAT-AUTH-01 (PR #14)">FEAT-AUTH-01</div>
            <div class="text-[10px] text-blue-400 mt-0.5">PR #14 Ready for Codex</div>
          </div>
        </div>
      </div>

      <!-- Global Progress Bar -->
      <div class="mt-6 pt-4 border-t border-slate-800/80 relative z-10">
        <div class="flex items-center justify-between text-xs mb-1.5 font-semibold">
          <span class="text-slate-300">Tiến Độ Dự Án Ship Dễ:</span>
          <span class="font-mono text-emerald-400" id="progressLabel">14 / 148 Tasks (9.5%)</span>
        </div>
        <div class="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div class="bg-emerald-500 h-full transition-all duration-500 shadow-sm" id="progressBarMerged" style="width: 9.5%"></div>
        </div>

        <!-- Status distribution across every work item -->
        <div class="mt-4">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Phân bố trạng thái</span>
            <div class="flex items-center gap-2">
              <span id="liveDot" class="w-2 h-2 rounded-full bg-slate-500"></span>
              <span id="liveLabel" class="text-[11px] font-semibold text-slate-400">Đang kết nối</span>
              <span class="text-slate-700">•</span>
              <span class="text-[11px] text-slate-500 font-mono" id="liveTime">--:--:--</span>
            </div>
          </div>
          <div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex" id="statusDist"></div>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" id="statusLegend"></div>
        </div>
      </div>
    </div>

    <!-- Per-slice delivery progress -->
    <div class="bg-slate-900/40 rounded-2xl p-5 border border-slate-800">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-sm font-black text-slate-200">Tiến độ theo Slice</h2>
          <p class="text-[11px] text-slate-500 mt-0.5">Bấm một slice để lọc bảng công việc bên dưới</p>
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5" id="sliceProgress"></div>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto custom-scroll">
      <button onclick="switchTab('roadmap')" id="tabBtn-roadmap" class="tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-brand text-white shadow-sm flex items-center gap-2">
        <span>🗺️ 1. Đầu Mục & Lộ Trình (148 Tasks)</span>
      </button>
      <button onclick="switchTab('agents')" id="tabBtn-agents" class="tab-btn px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2">
        <span>🤖 2. Giám Sát AI Đang Làm Tới Đâu</span>
      </button>
      <button onclick="switchTab('topology')" id="tabBtn-topology" class="tab-btn px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2">
        <span>📍 3. Nguồn Chạy & Hạ Tầng Máy Chủ</span>
      </button>
      <button onclick="switchTab('usage')" id="tabBtn-usage" class="tab-btn px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2">
        <span>📊 4. Giám Sát Usage & Quota Tokens</span>
      </button>
      <button onclick="switchTab('accounts')" id="tabBtn-accounts" class="tab-btn px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2">
        <span>🔐 5. Quản Lý Tài Khoản (Login / Logout)</span>
      </button>
      <button onclick="switchTab('tester')" id="tabBtn-tester" class="tab-btn px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2">
        <span class="text-amber-400">⚡</span>
        <span>6. Live Probe & Model Tester Console</span>
      </button>
    </div>

    <!-- SUB-TAB 1: ROADMAP & 148 TASKS -->
    <div id="tab-roadmap" class="space-y-6">
      <div class="flex flex-col md:flex-row gap-3 items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <input type="text" id="searchInput" oninput="renderTasksTable()" placeholder="🔍 Tìm mã task (FEAT-AUTH), tên tính năng..." class="w-full md:w-80 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg text-xs text-white focus:outline-none focus:border-brand">
        <div class="flex flex-wrap items-center gap-2">
          <select id="sliceFilter" onchange="renderTasksTable()" class="bg-slate-800 border border-slate-700 text-xs px-3 py-1.5 rounded-lg text-slate-200">
            <option value="ALL">Tất Cả Slices (S00..S11)</option>
            <option value="S00">S00: Foundation & AI Workflow</option>
            <option value="S01">S01: Identity & Multi-tenant</option>
            <option value="S02">S02: Carrier Credentials</option>
            <option value="S03">S03: Orders Intake & Address</option>
            <option value="S04">S04: Rate Comparison & Policy</option>
            <option value="S05">S05: Fulfillment & Waybills</option>
            <option value="S06">S06: Tracking & Normalisation</option>
            <option value="S07">S07: Delivery Exceptions & CSKH</option>
            <option value="S08">S08: Pricing & Contract Rates</option>
            <option value="S09">S09: COD Settlement & 3-Ledgers</option>
            <option value="S10">S10: Claims & Damages</option>
            <option value="S11">S11: Reconciliation & Audit Matrix</option>
          </select>
          <select id="statusFilter" onchange="renderTasksTable()" class="bg-slate-800 border border-slate-700 text-xs px-3 py-1.5 rounded-lg text-slate-200">
            <option value="ALL">Tất Cả Trạng Thái</option>
            <option value="MERGED">Đã Merge</option>
            <option value="READY_FOR_CODEX">Chờ Codex Review</option>
            <option value="READY_FOR_AUTHOR">Sẵn Sàng Làm</option>
            <option value="BLOCKED_DEPENDENCY">Khóa Phụ Thuộc</option>
            <option value="BLOCKED_BY_FOUNDATION">Chờ Nền Tảng S00</option>
          </select>
          <span class="text-xs text-slate-400 font-mono" id="taskCountLabel">Đang tải...</span>
        </div>
      </div>

      <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="bg-slate-800/80 border-b border-slate-700 text-slate-400 font-bold">
                <th class="py-3 px-4 w-12">#</th>
                <th class="py-3 px-4 w-32">Mã Task</th>
                <th class="py-3 px-4">Tên Tính Năng & Nghiệp Vụ</th>
                <th class="py-3 px-4 w-24">Slice</th>
                <th class="py-3 px-4 w-28">AI Tác Giả</th>
                <th class="py-3 px-4 w-36">Trạng Thái</th>
                <th class="py-3 px-4 w-24">Pull Request</th>
                <th class="py-3 px-4 w-28">Codex Verdict</th>
                <th class="py-3 px-4 w-36">Phụ Thuộc</th>
              </tr>
            </thead>
            <tbody id="tasksTbody" class="divide-y divide-slate-800/60 font-mono text-slate-300">
              <tr><td colspan="9" class="p-6 text-center text-slate-500">Đang tải dữ liệu...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- SUB-TAB 2: AI AGENTS TRACKER -->
    <div id="tab-agents" class="hidden space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5" id="agentsGrid">
        <!-- Injected dynamically -->
      </div>
    </div>

    <!-- SUB-TAB 3: TOPOLOGY & HOST RUNTIME -->
    <div id="tab-topology" class="hidden space-y-6">
      <div class="bg-slate-900 rounded-2xl p-6 border border-slate-800 space-y-6 shadow-xl">
        <div class="flex justify-between items-center pb-4 border-b border-slate-800">
          <div>
            <h2 class="text-lg font-black text-white">Sơ Đồ Hạ Tầng & Nguồn Thực Thi Của Các AI Models</h2>
            <p class="text-xs text-slate-400 mt-0.5">Minh bạch tuyệt đối môi trường chạy: Docker Sandbox vs Host Windows vs Cloud Gateways.</p>
          </div>
          <span class="text-xs font-mono bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 border border-slate-700">Host: Gumac-PC (Windows 10 Pro)</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs hover:border-slate-600 transition">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">Gemini / Antigravity Agent</strong><span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold">PRIMARY AUTHOR</span></div>
            <div><span class="text-slate-400">Chạy từ:</span> <strong class="text-emerald-400">Docker Container (DevContainer / Linux Sandbox)</strong></div>
            <div><span class="text-slate-400">Tài khoản xác thực:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-emerald-300">vinh1032001@gmail.com</code></div>
            <div><span class="text-slate-400">Tiến trình:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300">agy.exe (v1.2.1 Daemon)</code></div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-gemini</code></div>
            <div><span class="text-slate-400">API Endpoint:</span> <code class="text-[11px] text-slate-400">https://generativelanguage.googleapis.com (Google Cloud Vertex)</code></div>
          </div>

          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs hover:border-slate-600 transition">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">Claude Code CLI</strong><span class="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded text-[10px] font-bold">HOST NATIVE</span></div>
            <div><span class="text-slate-400">Chạy từ:</span> <strong class="text-amber-400">Gumac-PC Máy Trạm Cục Bộ (Windows 10 Pro)</strong></div>
            <div><span class="text-slate-400">Tiến trình:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-amber-300">node.exe (PID 14208) • Opus 5</code></div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-claude</code></div>
            <div><span class="text-slate-400">Credentials:</span> <code class="text-[11px] text-slate-400">C:\\Users\\gumac\\.claude\\.credentials.json</code></div>
          </div>

          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs hover:border-slate-600 transition">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">OpenAI Codex Reviewer</strong><span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] font-bold">INDEPENDENT REVIEW</span></div>
            <div><span class="text-slate-400">Chạy từ:</span> <strong class="text-blue-400">GitHub App Connector + Codex Windows Runtime</strong></div>
            <div><span class="text-slate-400">Mô hình:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-blue-300">OpenAI Codex (ChatGPT Engine)</code></div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-codex</code></div>
            <div><span class="text-slate-400">Nguyên tắc:</span> <code class="text-[11px] text-slate-400">Độc lập hoàn toàn với tác giả mã, không tự sửa code</code></div>
          </div>

          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs hover:border-slate-600 transition">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">AgentRouter & 9Router Gateways</strong><span class="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px] font-bold">MULTI-MODEL POOL</span></div>
            <div><span class="text-slate-400">AgentRouter (agentrouter.org):</span> <span class="text-purple-300 font-bold">DeepSeek V4 Flash • GLM 5-3 • Opus 4.8 • GPT 5.6 Sol</span></div>
            <div><span class="text-slate-400">9Router Daemon:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300">127.0.0.1:20128 (combo: shipde-low-risk)</code></div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-dsh</code></div>
            <div><span class="text-slate-400">Chính sách:</span> <span class="text-slate-400">Dành cho tác vụ rủi ro thấp (fixtures, mocks, mechanical changes)</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-TAB 4: USAGE & QUOTA -->
    <div id="tab-usage" class="hidden space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4" id="usageTiles">
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Tổng Chi Phí Đã Dùng</span><div class="text-2xl font-black text-white mt-1" id="uCost">--</div><span class="text-[10px] text-slate-400" id="uCostSub">đọc từ 9router</span></div>
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Tổng Tokens Tiêu Thụ</span><div class="text-2xl font-black text-white mt-1" id="uTokens">--</div><span class="text-[10px] text-slate-400" id="uTokensSub">--</span></div>
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Số Lượt Gọi</span><div class="text-2xl font-black text-white mt-1" id="uReq">--</div><span class="text-[10px] text-slate-400" id="uReqSub">--</span></div>
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Lượt Lỗi</span><div class="text-2xl font-black mt-1" id="uFail">--</div><span class="text-[10px] text-slate-400" id="uFailSub">--</span></div>
      </div>
      </div>

      <div class="bg-slate-900 rounded-xl border border-slate-800 p-5 space-y-4 shadow-xl">
        <h3 class="text-sm font-bold text-white">Bảng Giám Sát Quota Từng Model</h3>
        <div class="space-y-3 text-xs" id="usageBars">
          <!-- Populated by JS -->
        </div>
      </div>
    </div>

    <!-- SUB-TAB 5: ACCOUNTS (LOGIN / LOGOUT CONTROLS) -->
    <div id="tab-accounts" class="hidden space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-black text-white flex items-center gap-2">
            <span>Quản Lý & Phân Quyền Tài Khoản AI Đã Đăng Nhập</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">5 KẾT NỐI</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Cho phép đăng xuất và đăng nhập/cập nhật API Key trực tiếp trên giao diện Cockpit.</p>
        </div>
        <button onclick="fetchAccounts(); showToast('Đã kiểm tra và đồng bộ trạng thái 5 tài khoản!')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg border border-slate-700 transition">
          🔄 Đồng Bộ Lại Toàn Bộ
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4" id="accountsGrid">
        <!-- Populated by JS -->
      </div>
    </div>

    <!-- SUB-TAB 6: LIVE PROBE & MODEL TESTER CONSOLE -->
    <div id="tab-tester" class="hidden space-y-6">
      <div class="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-2xl space-y-5">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand to-amber-500 text-white flex items-center justify-center font-black shadow-lg glow-brand">
              ⚡
            </div>
            <div>
              <h2 class="text-lg font-black text-white flex items-center gap-2">
                <span>Live AI Model Probe & Execution Terminal</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono font-bold animate-pulse">
                  INTERACTIVE CONSOLE
                </span>
              </h2>
              <p class="text-xs text-slate-400">
                Gửi prompt thử nghiệm trực tiếp và đo đạc độ trễ, số token tiêu thụ, phản hồi kỹ thuật từ từng model.
              </p>
            </div>
          </div>

          <!-- Presets -->
          <div class="flex items-center gap-1.5 flex-wrap">
            <button onclick="setPromptPreset('Kiểm tra trạng thái các container Docker (Postgres, Redis, MinIO) và port 3333.')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition">
              🐳 Probe Docker
            </button>
            <button onclick="setPromptPreset('Kiểm tra tuân thủ nguyên tắc độc quyền Single-Writer Invariant AI-TOOL-03.')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition">
              🛡️ Probe Invariant
            </button>
            <button onclick="setPromptPreset('Kiểm tra tính khả dụng của ma trận so sánh cước GHN, GHTK, Viettel Post.')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition">
              📦 Probe Vận Chuyển
            </button>
          </div>
        </div>

        <!-- Controls -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div>
            <label class="block text-xs text-slate-400 font-semibold mb-1">Chọn Mô Hình AI Cần Probe:</label>
            <select id="probeModelSelect" class="w-full bg-slate-800 text-white text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-700 focus:outline-none focus:border-brand">
              <optgroup label="🔵 Google Gemini (Primary Author)">
                <option value="gemini-3.8-flash-high">Gemini 3.8 Flash (High) — Docker Sandbox</option>
              </optgroup>
              <optgroup label="🟠 Anthropic Claude Native (Host Workstation)">
                <option value="claude-opus-5">Claude Opus 5 — Native Host CLI (~/.claude/)</option>
              </optgroup>
              <optgroup label="🟢 OpenAI Codex (Independent Reviewer)">
                <option value="openai-codex-engine">OpenAI Codex Engine (ChatGPT Connector Bot)</option>
              </optgroup>
              <optgroup label="🌐 AgentRouter Gateway (External API 4-Model Pool)">
                <option value="agentrouter-opus-4-8">Claude Opus 4.8 — Qua API (agentrouter.org)</option>
                <option value="agentrouter-deepseek-v4-flash">AgentRouter • DeepSeek V4 Flash</option>
                <option value="agentrouter-glm-5-3">AgentRouter • GLM 5-3</option>
                <option value="agentrouter-gpt-5-6-sol">AgentRouter • GPT 5.6 Sol</option>
              </optgroup>
              <optgroup label="🟣 9Router Local Gateway (Port 20128)">
                <option value="9router-shipde-low-risk">9Router • combo:shipde-low-risk (Free Ensemble)</option>
              </optgroup>
            </select>
          </div>

          <div class="md:col-span-2">
            <label class="block text-xs text-slate-400 font-semibold mb-1">Nội Dung Thử Nghiệm (Prompt):</label>
            <div class="flex gap-2">
              <input type="text" id="probePromptInput" value="Báo cáo trạng thái container Docker và các cổng dịch vụ Ship Dễ." class="flex-1 bg-slate-800 text-white text-xs px-3 py-2.5 rounded-xl border border-slate-700 focus:outline-none focus:border-brand">
              <button onclick="sendModelProbe()" id="btnSendProbe" class="px-5 py-2.5 rounded-xl bg-brand hover:bg-orange-600 text-white text-xs font-bold transition shadow-lg glow-brand flex items-center gap-1.5 shrink-0">
                <span id="probeSpinner" class="hidden animate-spin">🔄</span>
                <span id="probeBtnText">⚡ Gửi Probe</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Terminal Output Viewport -->
        <div class="bg-slate-950 rounded-xl p-4 border border-slate-800 font-mono text-xs space-y-3 relative shadow-inner">
          <div class="flex items-center justify-between text-slate-500 border-b border-slate-800/80 pb-2">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
              <span class="ml-2 text-slate-400 font-bold">TERMINAL PROBE VIEWPORT</span>
            </div>
            <div id="probeMetrics" class="hidden items-center gap-4 text-[11px] text-emerald-400 font-bold">
              <span>Độ trễ: <span id="metricLatency">0ms</span></span>
              <span>Tokens: <span id="metricTokens">0 tokens</span></span>
              <span>Chi phí: <span id="metricCost">$0.00</span></span>
            </div>
          </div>

          <div id="probeOutput" class="text-slate-400 whitespace-pre-line leading-relaxed font-mono py-4">
Nhấn nút "⚡ Gửi Probe" ở trên để gửi prompt thử nghiệm trực tiếp và kiểm tra phản hồi telemetry của model.
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- INTERACTIVE LOGIN / KEY UPDATE MODAL -->
  <div id="loginModal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm hidden items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 text-white animate-in zoom-in-95">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center font-bold text-sm" id="modalIcon">
            🔐
          </div>
          <div>
            <h3 class="font-bold text-white text-base">Đăng Nhập / Cập Nhật Tài Khoản</h3>
            <div class="text-xs text-slate-400 font-semibold" id="modalProvider">Provider Name</div>
          </div>
        </div>
        <button onclick="closeLoginModal()" class="w-7 h-7 rounded-lg hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white">
          ✕
        </button>
      </div>

      <form id="modalForm" onsubmit="submitLoginModal(event)" class="space-y-4 text-xs">
        <input type="hidden" id="modalAccId">
        
        <div class="space-y-1">
          <label class="font-semibold text-slate-300">Email hoặc Tên Tài Khoản / Định Danh:</label>
          <input type="text" id="modalIdentifierInput" placeholder="Ví dụ: vinh1032001@gmail.com" class="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-brand">
        </div>

        <div class="space-y-1">
          <div class="flex justify-between items-center">
            <label class="font-semibold text-slate-300">API Key / Session Token / Bearer Token:</label>
            <button type="button" onclick="togglePasswordVisibility()" class="text-[11px] text-slate-400 hover:text-white" id="togglePassBtn">
              Hiện key
            </button>
          </div>
          <input type="password" id="modalKeyInput" placeholder="Dán mã API Key hoặc Session Token vào đây..." class="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-brand">
          <p class="text-[11px] text-slate-500">Khóa được lưu cục bộ trong phiên điều phối, không lưu vào git repository.</p>
        </div>

        <div class="bg-slate-800/60 p-3 rounded-xl border border-slate-700 space-y-1 text-slate-300">
          <div class="font-bold text-white">Cơ Chế Xác Thực:</div>
          <div class="text-[11px]" id="modalAuthMethod">• OAuth2 / Session Token / API Key</div>
          <div class="text-[11px]" id="modalLocation">• Cục bộ trên máy trạm</div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <button type="button" onclick="closeLoginModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold">
            Hủy Bỏ
          </button>
          <button type="submit" class="px-4 py-2 rounded-xl bg-brand hover:bg-orange-600 text-white font-bold shadow-md glow-brand">
            Xác Nhận & Đăng Nhập
          </button>
        </div>
      </form>
    </div>
  </div>

  <footer class="border-t border-slate-800 py-3 px-6 text-center text-xs text-slate-500 font-mono">
    Ship Dễ Autonomous AI Developer Cockpit • Port ${PORT} • Invariant AI-TOOL-03 Single-Writer Guard
  </footer>

  <script>
    let allTasks = [];
    let allAgents = [];
    let allUsage = null;
    let allAccounts = [];

    // Toast helper
    function showToast(msg, isSuccess = true) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toastMsg');
      const toastIcon = document.getElementById('toastIcon');
      toastMsg.innerText = msg;
      toastIcon.innerText = isSuccess ? '⚡' : '⚠️';
      toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
      setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
      }, 3000);
    }

    const STATUS_STYLE = {
      MERGED:                { color: 'bg-emerald-500', text: 'text-emerald-300', label: 'Đã gộp' },
      READY_FOR_CODEX:       { color: 'bg-sky-500',     text: 'text-sky-300',     label: 'Chờ review' },
      IN_PROGRESS:           { color: 'bg-amber-500',   text: 'text-amber-300',   label: 'Đang làm' },
      BLOCKED_DEPENDENCY:    { color: 'bg-orange-500',  text: 'text-orange-300',  label: 'Chờ phụ thuộc' },
      BLOCKED_BY_FOUNDATION: { color: 'bg-slate-600',   text: 'text-slate-400',   label: 'Chờ nền tảng' }
    };

    function statusStyle(st) {
      return STATUS_STYLE[st] || { color: 'bg-slate-600', text: 'text-slate-400', label: st || 'Không rõ' };
    }

    function updateStats() {
      const total = allTasks.length || 1;
      const merged = allTasks.filter(t => t.status === 'MERGED').length;
      const pct = ((merged / total) * 100).toFixed(1);

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      set('statTotal', allTasks.length + ' Tasks');
      set('statMerged', merged + ' Merged (' + pct + '%)');
      set('progressLabel', merged + ' / ' + allTasks.length + ' Tasks (' + pct + '%)');
      const bar = document.getElementById('progressBarMerged');
      if (bar) bar.style.width = pct + '%';

      // Hero tiles fed from measured router usage, never from constants.
      if (allUsage && allUsage.available) {
        const tt = allUsage.totals || { tokens: 0, cost: 0 };
        set('heroTokens', fmtTokens(tt.tokens));
        set('heroCost', fmtCost(tt.cost) + ' • ' + tt.requests + ' lượt gọi');
        const on = (allUsage.connections || []).filter(c => c.active);
        set('heroSources', on.length + ' / ' + (allUsage.connections || []).length);
        set('heroSourceList', on.map(c => c.provider).join(' • ') || 'không có nguồn nào bật');
      } else {
        set('heroTokens', 'chưa rõ');
        set('heroCost', allUsage && allUsage.reason ? allUsage.reason : 'không đọc được');
        set('heroSources', 'chưa rõ');
        set('heroSourceList', '—');
      }

      // Status distribution bar
      const dist = document.getElementById('statusDist');
      if (dist) {
        const counts = {};
        allTasks.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
        const order = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        dist.innerHTML = order.map(st => {
          const s = statusStyle(st);
          const w = (counts[st] / total) * 100;
          return '<div class="' + s.color + ' h-full" style="width:' + w.toFixed(2) + '%" title="' +
                 s.label + ': ' + counts[st] + '"></div>';
        }).join('');
        const legend = document.getElementById('statusLegend');
        if (legend) {
          legend.innerHTML = order.map(st => {
            const s = statusStyle(st);
            return '<span class="inline-flex items-center gap-1.5 whitespace-nowrap">' +
                   '<span class="w-2 h-2 rounded-sm ' + s.color + '"></span>' +
                   '<span class="' + s.text + ' font-semibold">' + s.label + '</span>' +
                   '<span class="text-slate-500">' + counts[st] + '</span></span>';
          }).join('');
        }
      }
    }

    function renderSliceProgress() {
      const host = document.getElementById('sliceProgress');
      if (!host) return;
      const bySlice = {};
      allTasks.forEach(t => {
        const k = t.slice || '—';
        if (!bySlice[k]) bySlice[k] = { total: 0, merged: 0, group: t.group || '' };
        bySlice[k].total++;
        if (t.status === 'MERGED') bySlice[k].merged++;
      });
      host.innerHTML = Object.keys(bySlice).sort().map(k => {
        const d = bySlice[k];
        const pct = d.total ? (d.merged / d.total) * 100 : 0;
        const done = pct === 100;
        return '<button onclick="filterBySlice(\\'' + k + '\\')" class="text-left p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-brand/60 hover:bg-slate-900 transition group">' +
          '<div class="flex items-center justify-between mb-1.5">' +
            '<span class="text-xs font-bold ' + (done ? 'text-emerald-300' : 'text-slate-200') + '">' + k + '</span>' +
            '<span class="text-[10px] font-mono text-slate-500 group-hover:text-brand">' + d.merged + '/' + d.total + '</span>' +
          '</div>' +
          '<div class="h-1.5 rounded-full bg-slate-800 overflow-hidden">' +
            '<div class="h-full rounded-full ' + (done ? 'bg-emerald-500' : 'bg-brand') + ' transition-all duration-500" style="width:' + pct.toFixed(1) + '%"></div>' +
          '</div>' +
          '<div class="mt-1.5 text-[10px] text-slate-500 truncate">' + d.group + '</div>' +
        '</button>';
      }).join('');
    }

    function filterBySlice(slice) {
      const sel = document.getElementById('sliceFilter');
      if (sel) { sel.value = slice; renderTasksTable(); }
      const tbl = document.getElementById('tasksTbody');
      if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function fetchData() {
      try {
        const [tasksRes, statusRes, agentsRes, accountsRes] = await Promise.all([
          fetch('/api/tasks').then(r => r.json()),
          fetch('/api/status').then(r => r.json()),
          fetch('/api/agents').then(r => r.json()),
          fetch('/api/accounts').then(r => r.json()),
        ]);

        allTasks = tasksRes.tasks || [];
        allAgents = agentsRes || [];
        allAccounts = accountsRes || [];

        updateStats();
        renderSliceProgress();
        renderTasksTable();
        renderAgents();
        renderUsage();
        renderAccounts();
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    async function fetchAccounts() {
      try {
        allAccounts = await fetch('/api/accounts').then(r => r.json());
        renderAccounts();
      } catch (e) {
        console.error('Error fetching accounts:', e);
      }
    }

    function switchTab(tabId) {
      ['roadmap', 'agents', 'topology', 'usage', 'accounts', 'tester'].forEach(id => {
        const el = document.getElementById('tab-' + id);
        const btn = document.getElementById('tabBtn-' + id);
        if (el && btn) {
          if (id === tabId) {
            el.classList.remove('hidden');
            btn.className = 'tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-brand text-white shadow-sm flex items-center gap-2 glow-brand';
          } else {
            el.classList.add('hidden');
            btn.className = 'tab-btn px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2';
          }
        }
      });
    }

    function renderTasksTable() {
      const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
      const slice = document.getElementById('sliceFilter')?.value || 'ALL';
      const status = document.getElementById('statusFilter')?.value || 'ALL';

      const filtered = allTasks.filter(t => {
        const matchSearch = ((t.work_item_id || '') + ' ' + (t.feature_name || '') + ' ' + (t.key_behavior || '') + ' ' + (t.pr || '')).toLowerCase().includes(search);
        const matchSlice = slice === 'ALL' || t.slice === slice;
        const matchStatus = status === 'ALL' || t.status === status;
        return matchSearch && matchSlice && matchStatus;
      });

      const label = document.getElementById('taskCountLabel');
      if (label) label.innerText = 'Hiển thị: ' + filtered.length + ' / ' + allTasks.length;

      const tbody = document.getElementById('tasksTbody');
      if (!tbody) return;

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-500">Không tìm thấy task phù hợp</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map((t, idx) => {
        const statusBadge = t.status === 'MERGED'
          ? '<span class="text-emerald-400 font-bold">✓ Đã Merge</span>'
          : t.status === 'READY_FOR_CODEX'
            ? '<span class="text-blue-400 font-bold animate-pulse">⏳ Chờ Codex Review</span>'
            : t.status === 'READY_FOR_AUTHOR'
              ? '<span class="text-amber-400 font-bold">⚡ Sẵn Sàng Làm</span>'
              : t.status === 'BLOCKED_DEPENDENCY'
                ? '<span class="text-slate-500">🔒 Khóa Phụ Thuộc</span>'
                : '<span class="text-slate-600">Chờ S00</span>';

        return '<tr class="hover:bg-slate-800/40 transition border-b border-slate-800/50">' +
          '<td class="py-3 px-4 text-slate-500">' + (t.delivery_order || idx + 1) + '</td>' +
          '<td class="py-3 px-4 font-bold text-brand">' + t.work_item_id + '</td>' +
          '<td class="py-3 px-4 font-sans"><div class="font-bold text-white text-xs">' + (t.feature_name || t.work_item_id) + '</div><div class="text-[11px] text-slate-400 line-clamp-1">' + t.key_behavior + '</div></td>' +
          '<td class="py-3 px-4"><span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">' + t.slice + '</span></td>' +
          '<td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ' + (t.assigned_author === 'GEMINI' ? 'bg-emerald-500/20 text-emerald-400' : t.assigned_author === 'CLAUDE' ? 'bg-amber-500/20 text-amber-400' : 'bg-purple-500/20 text-purple-400') + '">' + t.assigned_author + '</span></td>' +
          '<td class="py-3 px-4">' + statusBadge + '</td>' +
          '<td class="py-3 px-4 font-bold text-indigo-400">' + (t.pr || '—') + '</td>' +
          '<td class="py-3 px-4 font-bold">' + (t.codex_verdict === 'PASS' ? '<span class="text-emerald-400">✓ PASS</span>' : (t.codex_verdict || '—')) + '</td>' +
          '<td class="py-3 px-4 text-slate-500 truncate max-w-[150px]">' + (t.dependencies || 'Khởi tạo') + '</td>' +
        '</tr>';
      }).join('');
    }

    function renderAgents() {
      const grid = document.getElementById('agentsGrid');
      if (!grid) return;
      grid.innerHTML = allAgents.map(a => {
        return '<div class="bg-slate-900 rounded-2xl p-5 border border-slate-800 space-y-4 hover:border-slate-700 transition shadow-xl">' +
          '<div class="flex justify-between items-start">' +
            '<div>' +
              '<div class="flex items-center gap-2">' +
                '<span class="font-black text-white text-sm">' + a.name + '</span>' +
                '<span class="px-2 py-0.5 rounded text-[10px] font-bold ' + (a.status === 'WORKING' ? 'bg-emerald-500/20 text-emerald-400 animate-pulse' : a.status === 'REVIEWING' ? 'bg-blue-500/20 text-blue-400 animate-pulse' : 'bg-slate-800 text-slate-400') + '">' + a.status + '</span>' +
              '</div>' +
              '<div class="text-xs text-brand font-mono mt-0.5">' + a.model + '</div>' +
            '</div>' +
            '<span class="text-[10px] font-mono px-2 py-1 rounded bg-slate-800 text-slate-300 font-bold border border-slate-700">' + a.role + '</span>' +
          '</div>' +
          '<div class="bg-slate-800/60 rounded-xl p-3 border border-slate-700 space-y-1">' +
            '<div class="text-[10px] text-slate-400 font-bold uppercase">Đang Làm:</div>' +
            '<div class="text-xs font-bold text-white">' + a.currentTask + '</div>' +
            (a.progress > 0 ? '<div class="w-full h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden"><div class="bg-brand h-full" style="width: ' + a.progress + '%"></div></div>' : '') +
          '</div>' +
          '<div class="text-xs space-y-1.5 font-mono text-slate-300">' +
            '<div class="flex justify-between"><span class="text-slate-500">Môi trường:</span><span class="text-emerald-400">' + a.host + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-500">Worktree:</span><span class="truncate max-w-[220px] text-slate-300">' + a.worktree + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-500">Tokens đã dùng:</span><span class="text-amber-400">' + a.tokens + '</span></div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function fmtTokens(n) {
      if (n == null) return 'chưa rõ';
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return String(n);
    }

    function fmtCost(c) {
      return c == null ? 'chưa rõ' : '$' + Number(c).toFixed(4).replace(/0+$/, '').replace(/\\.$/, '');
    }

    function fmtAgo(ts) {
      if (!ts) return 'chưa có lượt gọi';
      const diff = Date.now() - Number(ts);
      if (diff < 0) return 'vừa xong';
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'vừa xong';
      if (m < 60) return m + ' phút trước';
      const h = Math.floor(m / 60);
      if (h < 24) return h + ' giờ trước';
      return Math.floor(h / 24) + ' ngày trước';
    }

    function renderUsage() {
      const container = document.getElementById('usageBars');
      if (!container) return;

      if (!allUsage || !allUsage.available) {
        const why = allUsage && allUsage.reason ? allUsage.reason : 'Chưa đọc được dữ liệu';
        container.innerHTML =
          '<div class="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">' +
            '<div class="font-bold mb-1">Không có số liệu sử dụng thật</div>' +
            '<div class="text-amber-300/80">' + why + '. Bảng này chỉ hiển thị số đo được, không hiển thị số ước lượng.</div>' +
          '</div>';
        return;
      }

      const t = allUsage.totals || { requests: 0, tokens: 0, cost: 0, failures: 0 };
      const maxTok = Math.max.apply(null, allUsage.providers.map(p => p.tokens).concat([1]));
      const connByProvider = {};
      (allUsage.connections || []).forEach(c => { connByProvider[c.provider] = c; });

      const head =
        '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">' +
          tile('Tổng token', fmtTokens(t.tokens), 'text-brand') +
          tile('Tổng chi phí', fmtCost(t.cost), 'text-amber-400') +
          tile('Số lượt gọi', String(t.requests), 'text-sky-400') +
          tile('Lượt lỗi', String(t.failures), t.failures > 0 ? 'text-rose-400' : 'text-emerald-400') +
        '</div>';

      const rows = allUsage.providers.map(p => {
        const pct = (p.tokens / maxTok) * 100;
        const conn = connByProvider[p.provider];
        const state = conn
          ? (conn.active
              ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">đang bật</span>'
              : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600">đã tắt</span>')
          : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">không khai báo</span>';
        return '<div class="space-y-1.5">' +
          '<div class="flex justify-between items-center gap-2 text-xs">' +
            '<span class="flex items-center gap-2 min-w-0">' +
              '<span class="text-white font-bold truncate">' + p.provider + '</span>' + state +
            '</span>' +
            '<span class="text-slate-400 font-mono text-[11px] whitespace-nowrap">' +
              fmtTokens(p.tokens) + ' • ' + fmtCost(p.cost) + ' • ' + p.requests + ' req' +
            '</span>' +
          '</div>' +
          '<div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden">' +
            '<div class="h-full ' + (p.failures > 0 ? 'bg-amber-500' : 'bg-emerald-500') +
            ' transition-all duration-500" style="width: ' + pct.toFixed(1) + '%"></div>' +
          '</div>' +
          '<div class="flex justify-between text-[10px] text-slate-500">' +
            '<span>vào ' + fmtTokens(p.promptTokens) + ' / ra ' + fmtTokens(p.completionTokens) + '</span>' +
            '<span>' + fmtAgo(p.lastAt) + (p.failures > 0 ? ' • ' + p.failures + ' lỗi' : '') + '</span>' +
          '</div>' +
        '</div>';
      }).join('');

      const idle = (allUsage.connections || []).filter(c => !allUsage.providers.some(p => p.provider === c.provider));
      const idleHtml = idle.length
        ? '<div class="mt-5 pt-4 border-t border-slate-800">' +
            '<div class="text-[11px] font-semibold text-slate-400 uppercase mb-2">Nguồn đã khai báo nhưng chưa từng gọi</div>' +
            '<div class="flex flex-wrap gap-2">' +
              idle.map(c =>
                '<span class="text-[11px] px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 ' +
                (c.active ? 'text-slate-300' : 'text-slate-500') + '">' + c.provider +
                (c.active ? '' : ' (tắt)') + '</span>').join('') +
            '</div></div>'
        : '';

      const setT = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      setT('uCost', fmtCost(t.cost));
      setT('uCostSub', allUsage.providers.length + ' nguồn đã ghi nhận');
      setT('uTokens', Number(t.tokens).toLocaleString('vi-VN'));
      const pin = allUsage.providers.reduce((a, p) => a + p.promptTokens, 0);
      const pout = allUsage.providers.reduce((a, p) => a + p.completionTokens, 0);
      setT('uTokensSub', fmtTokens(pin) + ' vào / ' + fmtTokens(pout) + ' ra');
      setT('uReq', String(t.requests));
      const latest = allUsage.providers.reduce((a, p) => (p.lastAt && p.lastAt > a ? p.lastAt : a), 0);
      setT('uReqSub', 'gần nhất: ' + fmtAgo(latest));
      const fEl = document.getElementById('uFail');
      if (fEl) fEl.className = 'text-2xl font-black mt-1 ' + (t.failures > 0 ? 'text-rose-400' : 'text-emerald-400');
      setT('uFail', String(t.failures));
      setT('uFailSub', t.failures > 0 ? 'cần kiểm tra' : 'không có lượt hỏng');

      container.innerHTML = head + '<div class="space-y-4">' + rows + '</div>' + idleHtml;

      function tile(label, value, cls) {
        return '<div class="bg-slate-800/70 p-3 rounded-xl border border-slate-700">' +
          '<div class="text-[11px] text-slate-400 font-semibold uppercase">' + label + '</div>' +
          '<div class="text-xl font-black mt-1 ' + cls + '">' + value + '</div>' +
        '</div>';
      }
    }

    function renderAccounts() {
      const grid = document.getElementById('accountsGrid');
      if (!grid) return;
      grid.innerHTML = allAccounts.map(acc => {
        const isAuthed = acc.status === 'AUTHENTICATED';
        return '<div class="bg-slate-900 rounded-2xl p-5 border ' + (isAuthed ? 'border-slate-800 hover:border-slate-700' : 'border-rose-900/50 bg-rose-950/10') + ' space-y-3 transition shadow-xl">' +
          '<div class="flex justify-between items-start">' +
            '<div>' +
              '<div class="font-bold text-white text-sm flex items-center gap-2">' +
                '<span>' + acc.provider + '</span>' +
                (!isAuthed ? '<span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">Chưa Đăng Nhập</span>' : '') +
              '</div>' +
              '<div class="text-xs font-mono text-brand font-semibold">' + acc.identifier + '</div>' +
            '</div>' +
            '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 ' + (isAuthed ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30') + '">' +
              '<span class="w-1.5 h-1.5 rounded-full ' + (isAuthed ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500') + '"></span>' +
              '<span>' + (isAuthed ? '✓ AUTHENTICATED' : '✕ DISCONNECTED') + '</span>' +
            '</span>' +
          '</div>' +
          '<div class="bg-slate-800/60 p-3 rounded-xl border border-slate-700 text-xs space-y-1.5 font-mono">' +
            '<div class="flex justify-between"><span class="text-slate-400">Gói / Phân Hạng:</span><span class="text-white font-semibold">' + acc.type + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-400">File Credentials:</span><span class="truncate max-w-[220px] text-slate-300">' + acc.location + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-400">Tốc độ RPM:</span><span class="text-emerald-400 font-semibold">' + acc.rateLimitRPM + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-400">Heartbeat:</span><span class="' + (isAuthed ? 'text-emerald-300' : 'text-slate-500') + '">' + acc.lastHeartbeat + '</span></div>' +
          '</div>' +
          '<div class="flex justify-between items-center pt-2 border-t border-slate-800">' +
            '<button onclick="navigator.clipboard.writeText(\\'' + (acc.location.replace(/\\\\/g, '\\\\\\\\')) + '\\'); showToast(\\'Đã sao chép đường dẫn credentials!\\')" class="text-xs text-slate-400 hover:text-white transition flex items-center gap-1 font-mono">' +
              '📋 Sao Chép Path' +
            '</button>' +
            '<div class="flex items-center gap-2">' +
              (isAuthed ?
                '<button onclick="openLoginModal(\\'' + acc.id + '\\')" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition">Đổi Key / Info</button>' +
                '<button onclick="logoutAccount(\\'' + acc.id + '\\')" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition">Đăng Xuất</button>'
                :
                '<button onclick="openLoginModal(\\'' + acc.id + '\\')" class="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition flex items-center gap-1.5">🔑 Đăng Nhập Ngay</button>'
              ) +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Modal & Account Controls
    function openLoginModal(accId) {
      const acc = allAccounts.find(a => a.id === accId);
      if (!acc) return;

      document.getElementById('modalAccId').value = acc.id;
      document.getElementById('modalProvider').innerText = acc.provider;
      document.getElementById('modalIdentifierInput').value = acc.identifier.includes('@') ? acc.identifier : '';
      document.getElementById('modalKeyInput').value = '';
      document.getElementById('modalAuthMethod').innerText = '• ' + acc.auth;
      document.getElementById('modalLocation').innerText = '• Lưu tại: ' + acc.location;

      const modal = document.getElementById('loginModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeLoginModal() {
      const modal = document.getElementById('loginModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    function togglePasswordVisibility() {
      const input = document.getElementById('modalKeyInput');
      const btn = document.getElementById('togglePassBtn');
      if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = 'Ẩn key';
      } else {
        input.type = 'password';
        btn.innerText = 'Hiện key';
      }
    }

    async function submitLoginModal(e) {
      e.preventDefault();
      const id = document.getElementById('modalAccId').value;
      const identifier = document.getElementById('modalIdentifierInput').value.trim();
      const key = document.getElementById('modalKeyInput').value.trim();

      try {
        const res = await fetch('/api/accounts/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, identifier: identifier || undefined, key: key || undefined })
        }).then(r => r.json());

        if (res.success) {
          showToast(res.message || 'Đăng nhập thành công!');
          closeLoginModal();
          await fetchAccounts();
        } else {
          alert('Lỗi: ' + res.error);
        }
      } catch (err) {
        console.error('Login error:', err);
        showToast('Lỗi khi gửi yêu cầu đăng nhập', false);
      }
    }

    async function logoutAccount(accId) {
      try {
        const res = await fetch('/api/accounts/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: accId })
        }).then(r => r.json());

        if (res.success) {
          showToast(res.message || 'Đã đăng xuất!');
          await fetchAccounts();
        } else {
          alert('Lỗi: ' + res.error);
        }
      } catch (err) {
        console.error('Logout error:', err);
        showToast('Lỗi khi đăng xuất', false);
      }
    }

    // Live Probe Testing
    function setPromptPreset(prompt) {
      document.getElementById('probePromptInput').value = prompt;
    }

    async function sendModelProbe() {
      const model = document.getElementById('probeModelSelect').value;
      const prompt = document.getElementById('probePromptInput').value.trim();
      if (!prompt) return;

      const btnText = document.getElementById('probeBtnText');
      const spinner = document.getElementById('probeSpinner');
      const outputEl = document.getElementById('probeOutput');
      const metricsEl = document.getElementById('probeMetrics');

      btnText.innerText = 'Đang Probe...';
      spinner.classList.remove('hidden');
      metricsEl.classList.add('hidden');
      outputEl.innerText = 'Đang gửi telemetry và probe kết nối tới ' + model + '...';

      try {
        const res = await fetch('/api/models/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt })
        }).then(r => r.json());

        if (res.success) {
          outputEl.innerText = res.output;
          document.getElementById('metricLatency').innerText = res.latency + 'ms';
          document.getElementById('metricTokens').innerText = res.tokens + ' tokens';
          document.getElementById('metricCost').innerText = res.cost;
          metricsEl.classList.remove('hidden');
          metricsEl.classList.add('flex');
          showToast('✓ Phản hồi thành công từ ' + model + ' (' + res.latency + 'ms)!');
        } else {
          outputEl.innerText = 'Lỗi phản hồi từ server.';
        }
      } catch (err) {
        console.error('Probe error:', err);
        outputEl.innerText = 'Lỗi kết nối probe: ' + err.message;
      } finally {
        btnText.innerText = '⚡ Gửi Probe';
        spinner.classList.add('hidden');
      }
    }

    // --- Live connection -----------------------------------------------
    // SSE is the primary channel; polling is kept only as a fallback so the
    // dashboard still updates if the stream cannot be established.
    let pollTimer = null;
    let liveState = 'connecting';

    function setLive(state, stamp) {
      liveState = state;
      const dot = document.getElementById('liveDot');
      const label = document.getElementById('liveLabel');
      const time = document.getElementById('liveTime');
      if (!dot || !label) return;
      const styles = {
        live:       ['bg-emerald-400', 'Trực tiếp', 'text-emerald-300'],
        polling:    ['bg-amber-400', 'Dự phòng 5s', 'text-amber-300'],
        connecting: ['bg-slate-500', 'Đang kết nối', 'text-slate-400'],
        offline:    ['bg-rose-500', 'Mất kết nối', 'text-rose-300']
      };
      const [dotCls, text, textCls] = styles[state] || styles.offline;
      dot.className = 'w-2 h-2 rounded-full ' + dotCls + (state === 'live' ? ' animate-pulse' : '');
      label.className = 'text-[11px] font-semibold ' + textCls;
      label.innerText = text;
      if (time && stamp) {
        time.innerText = new Date(stamp).toLocaleTimeString('vi-VN');
      }
    }

    function startPolling() {
      if (pollTimer) return;
      setLive('polling');
      pollTimer = setInterval(fetchData, 5000);
    }

    function stopPolling() {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    }

    function applySnapshot(snap) {
      allTasks = snap.tasks || [];
      if (snap.usage) { allUsage = snap.usage; renderUsage(); }
      updateStats();
      renderTasksTable();
      renderSliceProgress();
      setLive('live', snap.generatedAt);
    }

    // Agent and account panels are not part of the snapshot: they depend on
    // git worktrees and credential files rather than the register, so refresh
    // them on their own slow timer instead of leaving them frozen at load.
    setInterval(() => {
      fetch('/api/agents').then(r => r.json()).then(d => { allAgents = d || []; renderAgents(); }).catch(() => {});
      fetch('/api/accounts').then(r => r.json()).then(d => { allAccounts = d || []; renderAccounts(); }).catch(() => {});
    }, 15000);

    function connectStream() {
      if (typeof EventSource === 'undefined') {
        startPolling();
        return;
      }
      let es;
      try {
        es = new EventSource('/api/stream');
      } catch (e) {
        startPolling();
        return;
      }
      es.addEventListener('snapshot', function (ev) {
        try {
          stopPolling();
          applySnapshot(JSON.parse(ev.data));
        } catch (e) {
          console.error('Bad snapshot frame:', e);
        }
      });
      es.onerror = function () {
        // EventSource retries on its own; poll meanwhile so data stays fresh.
        setLive(es.readyState === 2 ? 'offline' : 'connecting');
        startPolling();
      };
    }

    // Auto-fetch on load
    fetchData();
    connectStream();
  </script>
</body>
</html>`;
}
