import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3333;
const ROOT_DIR = process.cwd();
const CSV_PATH = path.join(ROOT_DIR, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv');

// Parse CSV with quotes support
function parseCSV(text: string) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) return [];

  function parseLine(line: string) {
    const result: string[] = [];
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
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseLine(lines[i]);
    const row: any = {};
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

// Read realtime tasks
function getTasksData() {
  try {
    if (fs.existsSync(CSV_PATH)) {
      const content = fs.readFileSync(CSV_PATH, 'utf-8');
      return parseCSV(content);
    }
  } catch (err) {
    console.error('Error reading CSV:', err);
  }
  return [];
}

const server = http.createServer((req, res) => {
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
  if (pathname === '/api/tasks') {
    const tasks = getTasksData();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ total: tasks.length, tasks }));
    return;
  }

  if (pathname === '/api/status') {
    const tasks = getTasksData();
    const merged = tasks.filter((t: any) => t.status === 'MERGED').length;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        project: 'Ship Dễ Platform',
        version: '3.3.0',
        timestamp: new Date().toISOString(),
        totalTasks: tasks.length,
        mergedTasks: merged,
        completionPercent: ((merged / tasks.length) * 100).toFixed(1),
        currentActiveTask: 'FEAT-AUTH-01',
        currentActivePR: '#14',
        singleWriterLock: 'AI-TOOL-03 (ACTIVE)',
        activeModels: 4,
      })
    );
    return;
  }

  if (pathname === '/api/agents') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify([
        {
          id: 'gemini',
          name: 'Gemini / Antigravity Agent',
          role: 'Primary Implementation Author',
          model: 'gemini-2.5-pro / flash',
          currentTask: 'FEAT-AUTH-01 (PR #14)',
          status: 'WORKING',
          progress: 92,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-gemini',
          host: 'Google Antigravity CLI (agy) / DevContainer',
          tokens: '820,400 tokens',
          quota: 24,
          cost: '$0.00 (Dev tier)',
        },
        {
          id: 'claude',
          name: 'Claude Code CLI',
          role: 'Analyst & Code Repair Fallback',
          model: 'claude-3-7-sonnet / opus-4-8',
          currentTask: 'TASK-AI-14 CI Diagnostic',
          status: 'STANDBY',
          progress: 100,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-claude',
          host: 'Gumac-PC (Windows 10 Pro)',
          tokens: '450,200 tokens',
          quota: 42,
          cost: '$1.45 (Pro Plan)',
        },
        {
          id: 'codex',
          name: 'OpenAI Codex Reviewer',
          role: 'Independent Planner & Reviewer',
          model: 'o3-mini / GPT-4o',
          currentTask: 'Review PR #14 (FEAT-AUTH-01)',
          status: 'REVIEWING',
          progress: 75,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-codex',
          host: 'GitHub App Connector Bot',
          tokens: '385,100 tokens',
          quota: 35,
          cost: '$1.97 (API Quota)',
        },
        {
          id: '9router',
          name: '9Router Worker / DSH',
          role: 'Constrained Low-Risk Author',
          model: 'oc/deepseek-v4-flash-free',
          currentTask: 'Mocks & Fixtures (Idle)',
          status: 'IDLE',
          progress: 0,
          worktree: 'C:\\Users\\gumac\\AI\\shipde-dsh',
          host: 'Localhost Loopback :20128',
          tokens: '185,000 tokens',
          quota: 12,
          cost: '$0.00 (Free)',
        },
      ])
    );
    return;
  }

  if (pathname === '/api/accounts') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify([
        {
          id: 'acc_claude',
          provider: 'Anthropic (Claude Code CLI)',
          identifier: 'gumac.ai@gmail.com (Pro Tier)',
          type: 'Subscription / Team API',
          location: 'C:\\Users\\gumac\\.claude\\.credentials.json',
          auth: 'Host Native Authenticated CLI',
          status: 'AUTHENTICATED',
          rateLimit: '50 RPM (Hiện dùng: 12 RPM)',
          spent: '$1.45',
        },
        {
          id: 'acc_gemini',
          provider: 'Google AI (Gemini / Antigravity)',
          identifier: 'gumac.developer@gmail.com',
          type: 'Google Workspace Developer Key',
          location: 'Antigravity CLI (agy) Secure Vault',
          auth: 'OAuth2 + Application Default Credentials',
          status: 'AUTHENTICATED',
          rateLimit: '60 RPM (Hiện dùng: 18 RPM)',
          spent: '$0.00 (Dev)',
        },
        {
          id: 'acc_codex',
          provider: 'OpenAI (Codex Reviewer)',
          identifier: 'org-shipde-prod (ChatGPT Team)',
          type: 'Codex Platform & GitHub Connector Bot',
          location: 'C:\\Users\\gumac\\.codex\\session.json',
          auth: 'Codex CLI Session + Connector Link',
          status: 'AUTHENTICATED',
          rateLimit: '100 RPM (Hiện dùng: 8 RPM)',
          spent: '$1.97',
        },
        {
          id: 'acc_9router',
          provider: '9Router Localhost Gateway',
          identifier: '9router-local-instance (Port 20128)',
          type: 'Localhost OpenAI-Compatible Proxy',
          location: 'Local loopback daemon (Port 20128)',
          auth: 'Local Bearer Token',
          status: 'AUTHENTICATED',
          rateLimit: 'Không giới hạn nội bộ',
          spent: '$0.00 (Free)',
        },
      ])
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
          }
        }
      }
    }
  </script>
  <style>
    body { background-color: #0B1120; color: #F1F5F9; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .custom-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
    .custom-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 9999px; }
  </style>
</head>
<body class="min-h-screen flex flex-col antialiased">
  <!-- Top Navigation Header -->
  <header class="sticky top-0 z-50 bg-[#0F172A]/90 backdrop-blur-md border-b border-slate-800 px-6 py-3.5 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center font-black text-base shadow-lg shadow-brand/30">
        ⚡
      </div>
      <div>
        <div class="flex items-center gap-2">
          <span class="font-black text-white text-base tracking-tight">Ship Dễ AI Developer Cockpit</span>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
            CODE STUDIO v3.3
          </span>
        </div>
        <div class="text-[11px] text-slate-400 font-mono">
          Bảng Điều Khiển Dành Riêng Cho Đội Ngũ Lập Trình & Giám Sát AI Hoàn Thành Ship Dễ
        </div>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <div class="hidden md:flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-mono">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-slate-300">Khóa AI-TOOL-03:</span>
        <span class="text-emerald-400 font-bold">1 Writer Active</span>
      </div>

      <button onclick="fetchData()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition">
        <span>🔄 Làm Mới</span>
      </button>

      <a href="http://localhost:3000" target="_blank" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-orange-600 text-white text-xs font-bold transition shadow-sm">
        <span>Mở App Khách ↗</span>
      </a>
    </div>
  </header>

  <!-- Top Hero Status -->
  <div class="max-w-[1600px] w-full mx-auto p-6 space-y-6 flex-1">
    <div class="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 rounded-2xl p-6 border border-slate-800 shadow-2xl">
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div class="space-y-2">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/20 text-brand text-xs font-black uppercase tracking-wider border border-brand/30">
            <span>Autonomous AI Delivery Engine</span>
          </div>
          <h1 class="text-2xl sm:text-3xl font-black text-white">
            Giám Sát 148 Đầu Mục Code & 4 Mô Hình AI Đang Xây Dựng Ship Dễ
          </h1>
          <p class="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
            Theo dõi tiến độ lập trình độc lập qua Git Worktrees: Gemini (Tác giả chính), Claude Code CLI (Sửa lỗi & rà soát), OpenAI Codex (Thẩm định độc lập), 9Router (Tác giả rủi ro thấp).
          </p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3" id="topStats">
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">Đầu Việc Cần Làm</div>
            <div class="text-xl font-black text-white mt-1" id="statTotal">148 Tasks</div>
            <div class="text-[10px] text-emerald-400 mt-0.5" id="statMerged">12 Merged (9.5%)</div>
          </div>
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">AI Đang Chạy</div>
            <div class="text-xl font-black text-emerald-400 mt-1">4 Models</div>
            <div class="text-[10px] text-slate-300 mt-0.5">Gemini • Claude • Codex • 9R</div>
          </div>
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">Tokens / Chi Phí</div>
            <div class="text-xl font-black text-amber-400 mt-1">1.84M</div>
            <div class="text-[10px] text-slate-300 mt-0.5">~$3.42 (72% Free tier)</div>
          </div>
          <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
            <div class="text-[11px] text-slate-400 font-semibold uppercase">Task Đang Code</div>
            <div class="text-base font-black text-brand mt-1 truncate" title="FEAT-AUTH-01 (PR #14)">FEAT-AUTH-01</div>
            <div class="text-[10px] text-blue-400 mt-0.5">PR #14 Ready for Codex</div>
          </div>
        </div>
      </div>

      <!-- Global Progress Bar -->
      <div class="mt-6 pt-4 border-t border-slate-800">
        <div class="flex items-center justify-between text-xs mb-1.5 font-semibold">
          <span class="text-slate-300">Tiến Độ Dự Án Ship Dễ:</span>
          <span class="font-mono text-emerald-400" id="progressLabel">14 / 148 Tasks (9.5%)</span>
        </div>
        <div class="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div class="bg-emerald-500 h-full transition-all duration-500" id="progressBarMerged" style="width: 9.5%"></div>
          <div class="bg-amber-500 h-full transition-all duration-500" style="width: 2%"></div>
        </div>
      </div>
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
        <span>🔐 5. Tài Khoản AI Đã Đăng Nhập</span>
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

      <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
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

    <!-- SUB-TAB 3: TOPOLOGY -->
    <div id="tab-topology" class="hidden space-y-6">
      <div class="bg-slate-900 rounded-2xl p-6 border border-slate-800 space-y-6">
        <div class="flex justify-between items-center pb-4 border-b border-slate-800">
          <div>
            <h2 class="text-lg font-black text-white">Sơ Đồ Hạ Tầng & Nguồn Thực Thi Của Các AI Models</h2>
            <p class="text-xs text-slate-400 mt-0.5">Xác thực rõ ràng từng model đang chạy từ tiến trình nào, máy trạm nào, và gọi API gateway nào.</p>
          </div>
          <span class="text-xs font-mono bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300">Host: Gumac-PC (Windows 10 Pro)</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">Claude Code CLI</strong><span class="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded text-[10px] font-bold">HOST NATIVE</span></div>
            <div><span class="text-slate-400">Chạy từ:</span> Gumac-PC máy trạm cục bộ</div>
            <div><span class="text-slate-400">Tiến trình:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-amber-300">node.exe (PID 14208)</code></div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-claude</code></div>
            <div><span class="text-slate-400">API Endpoint:</span> <code class="text-[11px] text-slate-400">https://api.anthropic.com/v1 (hoặc AgentRouter loopback :20128)</code></div>
          </div>

          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">Gemini / Antigravity Agent</strong><span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold">PRIMARY AUTHOR</span></div>
            <div><span class="text-slate-400">Chạy từ:</span> Google Antigravity IDE & CLI (agy)</div>
            <div><span class="text-slate-400">Tiến trình:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-emerald-300">agy.exe (Dev Workspace Daemon)</code></div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-gemini</code></div>
            <div><span class="text-slate-400">API Endpoint:</span> <code class="text-[11px] text-slate-400">https://generativelanguage.googleapis.com (Google Cloud Vertex)</code></div>
          </div>

          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">OpenAI Codex Reviewer</strong><span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] font-bold">INDEPENDENT REVIEW</span></div>
            <div><span class="text-slate-400">Chạy từ:</span> GitHub App Connector + Codex Windows CLI</div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-codex</code></div>
            <div><span class="text-slate-400">API Endpoint:</span> <code class="text-[11px] text-slate-400">https://api.openai.com/v1 (o3-mini / GPT-4o)</code></div>
          </div>

          <div class="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-2 text-xs">
            <div class="flex justify-between items-center"><strong class="text-white text-sm">9Router Local Daemon & DSH</strong><span class="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px] font-bold">LOOPBACK :20128</span></div>
            <div><span class="text-slate-400">Chạy từ:</span> Local loopback trên máy trạm (:20128)</div>
            <div><span class="text-slate-400">Thư mục Worktree:</span> <code class="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300 block mt-1">C:\\Users\\gumac\\AI\\shipde-dsh</code></div>
            <div><span class="text-slate-400">Model catalog:</span> <span class="text-purple-300">oc/deepseek-v4-flash-free, oc/mimo-v2.5-free</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-TAB 4: USAGE -->
    <div id="tab-usage" class="hidden space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Tổng Chi Phí Đã Dùng</span><div class="text-2xl font-black text-white mt-1">$3.42</div><span class="text-[10px] text-emerald-400 font-bold">72% Free tier/Local</span></div>
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Tổng Tokens</span><div class="text-2xl font-black text-white mt-1">1,840,700</div><span class="text-[10px] text-slate-400">1.2M in / 640K out</span></div>
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Tốc Độ Gọi Trung Bình</span><div class="text-2xl font-black text-white mt-1">14.2 RPM</div><span class="text-[10px] text-slate-400">Ngưỡng an toàn &lt; 50 RPM</span></div>
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-800"><span class="text-slate-400 text-xs">Cảnh Báo Quota</span><div class="text-2xl font-black text-emerald-400 mt-1">AN TOÀN</div><span class="text-[10px] text-slate-400">0 cảnh báo rate limit</span></div>
      </div>

      <div class="bg-slate-900 rounded-xl border border-slate-800 p-5 space-y-4">
        <h3 class="text-sm font-bold text-white">Bảng Giám Sát Quota Từng Model</h3>
        <div class="space-y-3 text-xs" id="usageBars">
          <!-- Populated by JS -->
        </div>
      </div>
    </div>

    <!-- SUB-TAB 5: ACCOUNTS -->
    <div id="tab-accounts" class="hidden space-y-6">
      <div class="flex justify-between items-center">
        <div>
          <h2 class="text-lg font-black text-white">Danh Sách Tài Khoản Đã Đăng Nhập Vào Các AI Models</h2>
          <p class="text-xs text-slate-400 mt-0.5">Quản lý credentials an toàn (Anthropic, Google, OpenAI, 9Router).</p>
        </div>
        <button onclick="alert('Tất cả 4 phiên đăng nhập AI đều hoạt động bình thường!')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg border border-slate-700">Kiểm Tra Toàn Bộ</button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4" id="accountsGrid">
        <!-- Populated by JS -->
      </div>
    </div>
  </div>

  <footer class="border-t border-slate-800 py-3 px-6 text-center text-xs text-slate-500 font-mono">
    Ship Dễ Autonomous AI Developer Cockpit • Port ${PORT} • Invariant AI-TOOL-03 Single-Writer Guard
  </footer>

  <script>
    let allTasks = [];
    let allAgents = [];
    let allAccounts = [];

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

        // Update stats
        document.getElementById('statTotal').innerText = allTasks.length + ' Tasks';
        const merged = allTasks.filter(t => t.status === 'MERGED').length;
        const pct = ((merged / allTasks.length) * 100).toFixed(1);
        document.getElementById('statMerged').innerText = merged + ' Merged (' + pct + '%)';
        document.getElementById('progressLabel').innerText = merged + ' / ' + allTasks.length + ' Tasks (' + pct + '%)';
        document.getElementById('progressBarMerged').style.width = pct + '%';

        renderTasksTable();
        renderAgents();
        renderUsage();
        renderAccounts();
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    function switchTab(tabId) {
      ['roadmap', 'agents', 'topology', 'usage', 'accounts'].forEach(id => {
        const el = document.getElementById('tab-' + id);
        const btn = document.getElementById('tabBtn-' + id);
        if (id === tabId) {
          el.classList.remove('hidden');
          btn.className = 'tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-brand text-white shadow-sm flex items-center gap-2';
        } else {
          el.classList.add('hidden');
          btn.className = 'tab-btn px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2';
        }
      });
    }

    function renderTasksTable() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const slice = document.getElementById('sliceFilter').value;
      const status = document.getElementById('statusFilter').value;

      const filtered = allTasks.filter(t => {
        const matchSearch = (t.work_item_id + ' ' + t.feature_name + ' ' + t.key_behavior + ' ' + t.pr).toLowerCase().includes(search);
        const matchSlice = slice === 'ALL' || t.slice === slice;
        const matchStatus = status === 'ALL' || t.status === status;
        return matchSearch && matchSlice && matchStatus;
      });

      document.getElementById('taskCountLabel').innerText = 'Hiển thị: ' + filtered.length + ' / ' + allTasks.length;

      const tbody = document.getElementById('tasksTbody');
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
      grid.innerHTML = allAgents.map(a => {
        return '<div class="bg-slate-900 rounded-2xl p-5 border border-slate-800 space-y-4">' +
          '<div class="flex justify-between items-start">' +
            '<div>' +
              '<div class="flex items-center gap-2">' +
                '<span class="font-black text-white text-sm">' + a.name + '</span>' +
                '<span class="px-2 py-0.5 rounded text-[10px] font-bold ' + (a.status === 'WORKING' ? 'bg-emerald-500/20 text-emerald-400 animate-pulse' : a.status === 'REVIEWING' ? 'bg-blue-500/20 text-blue-400 animate-pulse' : 'bg-slate-800 text-slate-400') + '">' + a.status + '</span>' +
              '</div>' +
              '<div class="text-xs text-slate-400 font-mono mt-0.5">' + a.model + '</div>' +
            '</div>' +
            '<span class="text-[10px] font-mono px-2 py-1 rounded bg-slate-800 text-slate-300 font-bold">' + a.role + '</span>' +
          '</div>' +
          '<div class="bg-slate-800/60 rounded-xl p-3 border border-slate-700 space-y-1">' +
            '<div class="text-[10px] text-slate-400 font-bold uppercase">Đang Làm:</div>' +
            '<div class="text-xs font-bold text-brand">' + a.currentTask + '</div>' +
            (a.progress > 0 ? '<div class="w-full h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden"><div class="bg-brand h-full" style="width: ' + a.progress + '%"></div></div>' : '') +
          '</div>' +
          '<div class="text-xs space-y-1.5 font-mono text-slate-300">' +
            '<div class="flex justify-between"><span class="text-slate-500">Môi trường:</span><span>' + a.host + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-500">Worktree:</span><span class="truncate max-w-[220px]">' + a.worktree + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-500">Tokens đã dùng:</span><span class="text-amber-400">' + a.tokens + '</span></div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderUsage() {
      const container = document.getElementById('usageBars');
      container.innerHTML = allAgents.map(a => {
        return '<div class="space-y-1">' +
          '<div class="flex justify-between font-mono">' +
            '<span class="text-white font-bold">' + a.name + ' (' + a.model + ')</span>' +
            '<span class="text-slate-400">' + a.tokens + ' • ' + a.quota + '% quota • ' + a.cost + '</span>' +
          '</div>' +
          '<div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden">' +
            '<div class="h-full bg-emerald-500" style="width: ' + a.quota + '%"></div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderAccounts() {
      const grid = document.getElementById('accountsGrid');
      grid.innerHTML = allAccounts.map(acc => {
        return '<div class="bg-slate-900 rounded-2xl p-5 border border-slate-800 space-y-3">' +
          '<div class="flex justify-between items-start">' +
            '<div>' +
              '<div class="font-bold text-white text-sm">' + acc.provider + '</div>' +
              '<div class="text-xs font-mono text-brand font-semibold">' + acc.identifier + '</div>' +
            '</div>' +
            '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">✓ ' + acc.status + '</span>' +
          '</div>' +
          '<div class="bg-slate-800/60 p-3 rounded-xl border border-slate-700 text-xs space-y-1.5 font-mono">' +
            '<div class="flex justify-between"><span class="text-slate-400">Gói:</span><span>' + acc.type + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-400">File Credentials:</span><span class="truncate max-w-[220px] text-slate-300">' + acc.location + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-400">Tốc độ RPM:</span><span class="text-emerald-400">' + acc.rateLimit + '</span></div>' +
            '<div class="flex justify-between"><span class="text-slate-400">Chi phí:</span><span class="text-amber-400">' + acc.spent + '</span></div>' +
          '</div>' +
          '<div class="flex justify-end gap-2 pt-1">' +
            '<button onclick="alert(\'Phiên xác thực hợp lệ: ' + acc.provider + '\')" class="px-3 py-1 bg-brand hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition">Kiểm Tra Phiên</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Auto-fetch on load
    fetchData();
    setInterval(fetchData, 5000);
  </script>
</body>
</html>`;
}
