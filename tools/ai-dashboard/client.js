/**
 * Ship Dễ — Realtime AI Cockpit Client
 * TASK-AI-15: AI15-R01..R09, AI15-AC04, AI15-AC08, AI15-AC10
 * Deterministic SSE realtime updates with revision tracking, reconnect backoff,
 * scroll/focus preservation, and non-color-only accessible status indicators.
 */

let state = null;
let eventSource = null;
let sseReconnectTimeout = null;
let reconnectAttempts = 0;
let lastReceivedRevision = 0;
let activeTab = 'roster';
let searchFilter = '';
let sliceFilter = 'ALL';
let statusFilter = 'ALL';

// Initialize on DOM load. Guarded so this file can also be `require()`d by
// the Node test suite (no `document` there) purely for its pure helper
// functions (e.g. deriveWriterState) without booting the browser app.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initRealtime();
    // If static data pre-embedded (offline mode), load it first
    if (window.__STATIC_STATE__) {
      applyState(window.__STATIC_STATE__);
    } else if (window.__STATIC_TASKS__) {
      // Fallback minimal tasks array
      renderMinimalStaticTasks(window.__STATIC_TASKS__);
    }
    // No pane is visible until switchTab runs: every tabPane ships with `hidden`.
    switchTab(activeTab || 'progress');

    // Initial API poll to ensure data is fresh
    fetchState();
  });
}

function initUI() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchFilter = e.target.value.toLowerCase().trim();
      renderQueueTable();
    });
  }

  const sFilter = document.getElementById('sliceFilter');
  if (sFilter) {
    sFilter.addEventListener('change', (e) => {
      sliceFilter = e.target.value;
      renderQueueTable();
    });
  }

  const stFilter = document.getElementById('statusFilter');
  if (stFilter) {
    stFilter.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      renderQueueTable();
    });
  }

  // Set up tab keyboard navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        btn.click();
      }
    });
  });
}

function initRealtime() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  updateConnectionBadge('reconnecting', 'Đang kết nối SSE...');

  const sseUrl =
    lastReceivedRevision > 0 ? `/api/events?lastEventId=${lastReceivedRevision}` : '/api/events';
  try {
    eventSource = new EventSource(sseUrl);

    // The state event only fires when something actually changed, which can be minutes
    // apart. Without this the page looks frozen even while the server polls every 5s, so
    // show the heartbeat as a separate "checked at" line next to the data's own timestamp.
    eventSource.addEventListener('heartbeat', (event) => {
      reconnectAttempts = 0;
      try {
        const { at } = JSON.parse(event.data);
        const el = document.getElementById('lastCheckedAt');
        if (el && at) {
          el.textContent = `Kiểm tra lúc: ${new Date(at).toLocaleTimeString()}`;
        }
      } catch {
        /* a malformed heartbeat must never break the live connection */
      }
    });

    eventSource.addEventListener('state', (event) => {
      reconnectAttempts = 0;
      try {
        const newState = JSON.parse(event.data);
        if (newState.revision && newState.revision <= lastReceivedRevision) {
          return;
        }
        lastReceivedRevision = newState.revision || lastReceivedRevision + 1;
        applyState(newState);
        updateConnectionBadge('live', `● LIVE (SSE r${newState.revision || 1})`);
      } catch (err) {
        console.error('[COCKPIT] Failed to parse SSE state:', err);
      }
    });

    eventSource.onopen = () => {
      reconnectAttempts = 0;
      updateConnectionBadge('live', '● LIVE (SSE Đã Kết Nối)');
    };

    eventSource.onerror = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      reconnectAttempts++;
      const backoffMs = Math.min(10000, 1000 * Math.pow(1.5, reconnectAttempts));
      updateConnectionBadge(
        'reconnecting',
        `⚠ Mất kết nối. Thử lại sau ${Math.round(backoffMs / 1000)}s...`
      );

      if (sseReconnectTimeout) clearTimeout(sseReconnectTimeout);
      sseReconnectTimeout = setTimeout(() => {
        initRealtime();
      }, backoffMs);
    };
  } catch (err) {
    console.warn('[COCKPIT] EventSource error, falling back to polling:', err);
    updateConnectionBadge('polling', '○ POLLING (Fallback)');
    setInterval(fetchState, 5000);
  }
}

async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const data = await res.json();
      applyState(data);
    }
  } catch (err) {
    console.warn('[COCKPIT] /api/state fetch error:', err);
  }
}

function updateConnectionBadge(type, label) {
  const badge = document.getElementById('connectionBadge');
  if (!badge) return;

  badge.className =
    'text-[11px] font-mono px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1.5 transition';

  if (type === 'live') {
    badge.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/40');
  } else if (type === 'reconnecting') {
    badge.classList.add(
      'bg-amber-500/20',
      'text-amber-400',
      'border-amber-500/40',
      'animate-pulse'
    );
  } else {
    badge.classList.add('bg-base-200', 'text-base-content/70', 'border-base-300');
  }

  badge.innerText = label;
}

function applyState(newState) {
  if (!newState) return;
  state = newState;

  // Save current active element ID and cursor position to preserve focus
  const activeEl = document.activeElement;
  const activeId = activeEl ? activeEl.id : null;
  const selStart =
    activeEl && activeEl.selectionStart !== undefined ? activeEl.selectionStart : null;
  const selEnd = activeEl && activeEl.selectionEnd !== undefined ? activeEl.selectionEnd : null;

  renderHUD();
  renderWriterState();
  renderSourceHealth();
  renderActiveWorkItem();
  renderGatePipeline();
  renderConflicts();
  renderSessions();
  renderQueueTable();
  renderActivity();
  renderDiagnostics();
  renderCapacity();

  // Restore focus if element still exists
  if (activeId) {
    const restoreEl = document.getElementById(activeId);
    if (restoreEl) {
      restoreEl.focus();
      if (selStart !== null && selEnd !== null) {
        try {
          restoreEl.setSelectionRange(selStart, selEnd);
        } catch {}
      }
    }
  }
}

// Derives the single-writer badge state honestly from Paseo source health and
// real session data — never a hardcoded assertion. Paseo source not live means
// writer state is genuinely unknown/unavailable, not "1 Writer Active".
function deriveWriterState(currentState) {
  const paseoStatus = currentState?.sources?.paseo?.status;
  if (paseoStatus !== 'live') {
    return { level: 'unavailable', label: 'PASEO KHÔNG KHẢ DỤNG', countLabel: 'Không có' };
  }

  const sessions = Array.isArray(currentState.sessions) ? currentState.sessions : [];
  const activeWriters = sessions.filter((s) => s.isWriter && !s.isTerminated);

  if (activeWriters.length === 0) {
    return { level: 'idle', label: 'Không Có Writer', countLabel: '0 Writer' };
  }
  if (activeWriters.length === 1) {
    return { level: 'single', label: '1 Writer Active', countLabel: '1 Writer' };
  }
  return {
    level: 'conflict',
    label: `⚠ ${activeWriters.length} WRITER (VI PHẠM)`,
    countLabel: `⚠ ${activeWriters.length} Writer`,
  };
}

const WRITER_STATE_DOT_CLASS = {
  unavailable: 'bg-base-200',
  idle: 'bg-base-200',
  single: 'bg-emerald-400',
  conflict: 'bg-rose-500 animate-pulse',
};

const WRITER_STATE_TEXT_CLASS = {
  unavailable: 'text-base-content/70',
  idle: 'text-base-content/70',
  single: 'text-emerald-400',
  conflict: 'text-rose-400',
};

function renderWriterState() {
  if (!state) return;
  const writer = deriveWriterState(state);
  const dotColor = WRITER_STATE_DOT_CLASS[writer.level] || 'bg-base-200';
  const textColor = WRITER_STATE_TEXT_CLASS[writer.level] || 'text-base-content/70';

  const dot = document.getElementById('writerStateDot');
  if (dot) dot.className = `w-2 h-2 rounded-full ${dotColor}`;

  const label = document.getElementById('writerStateLabel');
  if (label) {
    label.className = `${textColor} font-bold`;
    label.innerText = writer.label;
  }

  const countValue = document.getElementById('writerCountValue');
  if (countValue) {
    countValue.className = `text-xl font-black mt-1 ${textColor}`;
    countValue.innerText = writer.countLabel;
  }
}

function renderHUD() {
  if (!state) return;

  // Timestamp and revision
  const obsTimeEl = document.getElementById('observedAtLabel');
  if (obsTimeEl && state.observedAt) {
    const date = new Date(state.observedAt);
    obsTimeEl.innerText = `Cập nhật lúc: ${date.toLocaleTimeString()} (r${state.revision || 1})`;
  }

  // Merged progress
  const total = state.workItems?.total || 0;
  const merged = state.workItems?.mergedCount || 0;
  const pct = state.workItems?.completionPercent || '0.0';

  const statTotal = document.getElementById('statTotal');
  if (statTotal) statTotal.innerText = `${total} Tasks`;

  // Dynamic task-count labels that must never be hardcoded in the markup.
  const heroTaskCount = document.getElementById('heroTaskCount');
  if (heroTaskCount) heroTaskCount.innerText = state.workItems ? String(total) : '—';

  const tabQueueCountLabel = document.getElementById('tabQueueCountLabel');
  if (tabQueueCountLabel) tabQueueCountLabel.innerText = state.workItems ? String(total) : '—';

  const statMerged = document.getElementById('statMerged');
  if (statMerged) statMerged.innerText = `${merged} Merged (${pct}%)`;

  const progressLabel = document.getElementById('progressLabel');
  if (progressLabel) progressLabel.innerText = `${merged} / ${total} Tasks (${pct}%)`;

  const progressBarMerged = document.getElementById('progressBarMerged');
  if (progressBarMerged) progressBarMerged.style.width = `${pct}%`;

  // Active Sessions count
  const statSessions = document.getElementById('statSessions');
  if (statSessions) {
    const count = state.sessions ? state.sessions.length : 0;
    statSessions.innerText = `${count} Phiên`;
  }

  // Active task title in HUD
  const statActiveTask = document.getElementById('statActiveTask');
  if (statActiveTask) {
    const active = state.workItems?.activeItem;
    if (active) {
      statActiveTask.innerText = active.work_item_id;
      statActiveTask.title = `${active.work_item_id}: ${active.feature_name || active.key_behavior}`;
    } else {
      statActiveTask.innerText = 'Hàng Đợi Trống';
    }
  }

  // Overall status alert banner (Partial / Stale / Conflict)
  const overallBanner = document.getElementById('overallStatusBanner');
  if (overallBanner) {
    if (state.overallStatus === 'partial') {
      overallBanner.className =
        'p-3 rounded-xl bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs flex items-center justify-between gap-3';
      overallBanner.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="text-amber-400 font-bold">[⚠ HOẠT ĐỘNG MỘT PHẦN]</span>
          <span>Một hoặc nhiều nguồn dữ liệu đang gián đoạn; các phần còn lại vẫn hoạt động bình thường.</span>
        </div>
        <button onclick="switchTab('system')" class="px-2.5 py-1 bg-amber-800/60 hover:bg-amber-700 rounded text-[11px] font-bold">Xem Chi Tiết ↗</button>
      `;
      overallBanner.classList.remove('hidden');
    } else if (state.overallStatus === 'conflict') {
      overallBanner.className =
        'p-3 rounded-xl bg-rose-950/40 border border-rose-700/60 text-rose-200 text-xs flex items-center justify-between gap-3';
      overallBanner.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="text-rose-400 font-bold">[⚡ XUNG ĐỘT TRẠNG THÁI]</span>
          <span>Phát hiện bất đồng giữa Register, Git hoặc GitHub PR. Xem xét giải quyết trước khi merge!</span>
        </div>
        <button onclick="switchTab('progress')" class="px-2.5 py-1 bg-rose-800/60 hover:bg-rose-700 rounded text-[11px] font-bold">Xem Xung Đột ↗</button>
      `;
      overallBanner.classList.remove('hidden');
    } else if (state.overallStatus === 'stale') {
      overallBanner.className =
        'p-3 rounded-xl bg-yellow-950/40 border border-yellow-700/60 text-yellow-200 text-xs flex items-center gap-2';
      overallBanner.innerHTML = `
        <span class="text-yellow-400 font-bold">[⌛ DỮ LIỆU CŨ]</span>
        <span>Dữ liệu quan sát vượt quá ngưỡng thời gian. Đang chờ cập nhật mới...</span>
      `;
      overallBanner.classList.remove('hidden');
    } else {
      overallBanner.classList.add('hidden');
    }
  }
}

// Formats a real observation age in milliseconds into a short label.
// null/undefined age (no successful observation) reads as "N/A", never "0s".
function formatSourceAge(ageMs) {
  if (ageMs === null || ageMs === undefined || Number.isNaN(ageMs)) return 'N/A';
  if (ageMs < 1000) return '<1s';
  const totalSeconds = Math.floor(ageMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function freshnessLabel(f) {
  if (f === 'live') return 'Trực tiếp';
  if (f === 'stale') return 'Dữ liệu cũ';
  return 'Không có';
}

const FRESHNESS_BADGE = {
  live: { cls: 'badge badge-success badge-sm', text: '● Trực tiếp' },
  stale: { cls: 'badge badge-warning badge-sm', text: '◐ Cũ' },
  unavailable: { cls: 'badge badge-error badge-sm', text: '○ Không có' },
};

function renderSourceHealth() {
  const container = document.getElementById('sourceHealthBar');
  if (!container || !state || !state.sources) return;

  const sources = [
    { key: 'register', label: '1. Register CSV', icon: '📋' },
    { key: 'git', label: '2. Git & Worktree', icon: '🌿' },
    { key: 'paseo', label: '3. Paseo', icon: '🤖' },
    { key: 'github', label: '4. GitHub PR / CI', icon: '🐙' },
  ];

  container.innerHTML = sources
    .map((s) => {
      const src = state.sources[s.key] || { status: 'unavailable', impact: 'Chưa có dữ liệu' };
      const status = src.status || 'unavailable';

      let badgeClass = 'badge badge-ghost badge-sm';
      let statusText = 'Chưa rõ';

      if (status === 'live') {
        badgeClass = 'badge badge-success badge-sm';
        statusText = 'Trực tiếp';
      } else if (status === 'stale') {
        badgeClass = 'badge badge-warning badge-sm';
        statusText = 'Dữ liệu cũ';
      } else if (status === 'partial') {
        badgeClass = 'badge badge-warning badge-sm';
        statusText = 'Một phần';
      } else if (status === 'unavailable') {
        badgeClass = 'badge badge-error badge-sm';
        statusText = 'Không có';
      }

      // Per-source freshness — a real, derived age/state (AI15-R01), distinct
      // from the collection status badge above: a source can report a live
      // collection status yet be serving an older observation.
      const freshness = src.freshness || 'unavailable';
      const freshnessBadge = FRESHNESS_BADGE[freshness] || FRESHNESS_BADGE.unavailable;
      const ageLabel = formatSourceAge(src.ageMs);

      return `
      <div class="bg-base-200 p-3 rounded-xl border border-base-300 flex flex-col justify-between hover:border-base-300 transition">
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-bold text-base-content/70 flex items-center gap-1.5">${s.icon} ${s.label}</span>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${badgeClass}">${statusText}</span>
        </div>
        <div class="text-[11px] text-base-content/70 truncate mt-1" title="${escapeHtml(src.impact || '')}">${escapeHtml(src.impact || 'Hoạt động bình thường')}</div>
        <div class="flex items-center justify-between text-[10px] font-mono mt-1.5 pt-1.5 border-t border-base-300">
          <span class="px-1.5 py-0.5 rounded border font-bold ${freshnessBadge.cls}" title="Độ tươi dữ liệu nguồn (observedAt/ageMs thực)">${freshnessBadge.text}</span>
          <span class="text-base-content/70">Độ trễ: ${escapeHtml(ageLabel)}${src.latencyMs !== undefined ? ` • ${src.latencyMs}ms` : ''}</span>
        </div>
      </div>
    `;
    })
    .join('');
}

function renderActiveWorkItem() {
  const container = document.getElementById('activeWorkItemCard');
  if (!container || !state) return;

  const active = state.workItems?.activeItem;
  if (!active) {
    container.innerHTML = `
      <div class="p-6 text-center text-base-content/70 text-xs bg-base-200 rounded-xl border border-base-300">
        <span class="text-2xl mb-2 block">📭</span>
        <div class="font-bold text-base-content mb-1">Không có việc đang xử lý</div>
      </div>
    `;
    return;
  }

  const assignedAuthor = active.assigned_author || 'CHƯA PHÂN CÔNG';
  let authorColor = 'bg-base-200 text-base-content/70 border-base-300';
  if (assignedAuthor === 'GEMINI')
    authorColor = 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
  if (assignedAuthor === 'CLAUDE')
    authorColor = 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  if (assignedAuthor === '9ROUTER') authorColor = 'bg-teal-500/20 text-teal-400 border-teal-500/30';

  let statusBadgeColor = 'bg-base-200 text-base-content/70 border-base-300';
  if (active.status === 'READY_FOR_AUTHOR')
    statusBadgeColor = 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  if (active.status === 'IN_PROGRESS')
    statusBadgeColor = 'bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse';
  if (active.status === 'READY_FOR_CODEX')
    statusBadgeColor = 'bg-purple-500/20 text-purple-400 border-purple-500/30';
  if (active.status === 'MERGED')
    statusBadgeColor = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

  container.innerHTML = `
    <div class="card bg-base-100 border border-base-300 p-5 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-base-300">
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono font-bold px-2.5 py-1 rounded bg-brand/20 text-brand border border-brand/30">
            [${escapeHtml(active.work_item_id)}]
          </span>
          <span class="text-xs font-mono px-2 py-0.5 rounded border ${authorColor} font-bold">
            ${escapeHtml(assignedAuthor)}
          </span>
          <span class="text-xs font-mono px-2 py-0.5 rounded border ${statusBadgeColor} font-bold">
            [${escapeHtml(formatWorkItemStatus(active.status))}]
          </span>
        </div>
        <div class="text-xs text-base-content/70 font-mono">
          #${escapeHtml(active.delivery_order || '0')} • Slice: ${escapeHtml(active.slice || 'S00')}
        </div>
      </div>

      <div>
        <h2 class="text-lg sm:text-xl font-black text-base-content leading-snug">
          ${escapeHtml(active.feature_name || active.key_behavior || 'Chi tiết công việc')}
        </h2>
        ${
          active.key_behavior && active.key_behavior !== active.feature_name
            ? `<p class="text-xs sm:text-sm text-base-content/70 mt-2 leading-relaxed truncate">${escapeHtml(active.key_behavior)}</p>`
            : ''
        }
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs font-mono">
        <div class="bg-base-200 p-2.5 rounded-lg border border-base-300">
          <div class="text-[10px] text-base-content/70 uppercase">Nhánh</div>
          <div class="text-base-content/70 truncate mt-0.5" title="${escapeHtml(active.branch || 'Chưa có nhánh')}">${escapeHtml(active.branch || '—')}</div>
        </div>
        <div class="bg-base-200 p-2.5 rounded-lg border border-base-300">
          <div class="text-[10px] text-base-content/70 uppercase">Đặc tả</div>
          <div class="text-base-content/70 truncate mt-0.5" title="${escapeHtml(active.work_item_path || '')}">
            ${escapeHtml(active.work_item_path ? active.work_item_path.split('/').pop() : '—')}
          </div>
        </div>
        <div class="bg-base-200 p-2.5 rounded-lg border border-base-300">
          <div class="text-[10px] text-base-content/70 uppercase">PR / Thẩm định</div>
          <div class="text-base-content/70 mt-0.5">
            ${escapeHtml(active.pr || 'Chưa có PR')} ${active.codex_verdict ? `(${escapeHtml(active.codex_verdict)})` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

// Human-readable labels for currentGate values that are not self-explanatory
// codes — most notably EVIDENCE_UNAVAILABLE, which must read clearly as
// "cannot verify", not as a fabricated PASS state (AI15-R03).
// Work item statuses as the register spells them, in the dashboard's language.
// renderActiveWorkItem and renderQueueTable both call this; without it they throw and
// applyState aborts, blanking every panel rendered after them.
// Orchestrator session states, in the dashboard's language. renderSessions calls this
// inside a map, so a missing definition threw and aborted applyState before the activity,
// diagnostics and capacity panels were ever rendered.
const SESSION_STATUS_LABELS = {
  IDLE: 'NGHỈ',
  ACTIVE: 'ĐANG CHẠY',
  WORKING: 'ĐANG LÀM',
  EXITED: 'ĐÃ THOÁT',
  TERMINATED: 'ĐÃ DỪNG',
  MERGED: 'ĐÃ MERGE',
  NO_SIGNAL: 'MẤT TÍN HIỆU',
  ERROR: 'LỖI',
};

function formatSessionStatus(status) {
  if (!status) return 'KHÔNG RÕ';
  return SESSION_STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
}

const WORK_ITEM_STATUS_LABELS = {
  BACKLOG: 'CHỜ XẾP',
  BLOCKED_BY_FOUNDATION: 'CHỜ NỀN TẢNG',
  BLOCKED_DEPENDENCY: 'BỊ CHẶN PHỤ THUỘC',
  BLOCKED: 'BỊ CHẶN',
  READY_FOR_AUTHOR: 'SẴN SÀNG SOẠN',
  IN_PROGRESS: 'ĐANG LÀM',
  READY_FOR_CODEX: 'CHỜ THẨM ĐỊNH',
  CHANGES_REQUIRED: 'CẦN SỬA',
  CODEX_PASS: 'THẨM ĐỊNH ĐẠT',
  READY_FOR_HUMAN_MERGE: 'CHỜ MERGE',
  MERGED: 'ĐÃ MERGE',
  SUPERSEDED: 'ĐÃ THAY THẾ',
};

function formatWorkItemStatus(status) {
  if (!status) return 'KHÔNG RÕ';
  return WORK_ITEM_STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
}

const GATE_STAGE_LABELS = {
  IDLE: 'NGHỈ',
  AUTHORING: 'ĐANG SOẠN',
  CODEX_REVIEW: 'CODEX THẨM ĐỊNH',
  CI_GATES: 'CỔNG CI',
  HUMAN_MERGE: 'CHỜ MERGE',
  MERGED: 'ĐÃ MERGE',
  BLOCKED: 'BỊ CHẶN',
  EVIDENCE_UNAVAILABLE: 'CHỜ BẰNG CHỨNG TỪ GITHUB',
};

function renderGatePipeline() {
  const container = document.getElementById('gatePipelineCard');
  if (!container || !state) return;

  const pipeline = state.workItems?.gatePipeline;
  if (!pipeline || !pipeline.gates) return;

  const currentGateKey = pipeline.currentGate || 'IDLE';
  const currentGateLabel = GATE_STAGE_LABELS[currentGateKey] || currentGateKey;
  const currentGateColor =
    currentGateKey === 'EVIDENCE_UNAVAILABLE' ? 'text-amber-400' : 'text-brand';

  container.innerHTML = `
    <div class="bg-base-200 p-6 rounded-2xl border border-base-300 shadow-xl space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-base-300">
        <h3 class="text-sm font-bold text-base-content uppercase tracking-wider flex items-center gap-2">
          <span>🛡️ Cổng chất lượng</span>
        </h3>
        <span class="text-xs font-mono px-2 py-0.5 rounded bg-base-200 text-base-content/70 border border-base-300">
          <span class="${currentGateColor} font-bold">${escapeHtml(currentGateLabel)}</span>
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
        ${pipeline.gates
          .map((g, idx) => {
            let badge = 'bg-base-200 text-base-content/70 border-base-300';
            let icon = '○';
            let statusText = 'CHỜ';

            if (g.status === 'PASSED') {
              badge = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
              icon = '✓';
              statusText = 'ĐẠT';
            } else if (g.status === 'IN_PROGRESS') {
              badge = 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse';
              icon = '⚡';
              statusText = 'ĐANG CHẠY';
            } else if (g.status === 'READY') {
              badge = 'bg-blue-500/20 text-blue-400 border-blue-500/40';
              icon = '▶';
              statusText = 'SẴN SÀNG';
            } else if (g.status === 'FAILED') {
              badge = 'bg-rose-500/20 text-rose-400 border-rose-500/40';
              icon = '✕';
              statusText = 'KHÔNG ĐẠT';
            } else if (g.status === 'BLOCKED') {
              badge = 'bg-base-200 text-rose-400 border-rose-900';
              icon = '⛔';
              statusText = 'BỊ CHẶN';
            } else if (g.status === 'UNAVAILABLE') {
              badge = 'bg-base-200 text-amber-400 border-amber-900/60';
              icon = '⊘';
              statusText = 'KHÔNG CÓ';
            }

            return `
            <div class="bg-base-200 p-3 rounded-xl border border-base-300 flex flex-col justify-between space-y-2">
              <div class="text-[10px] text-base-content/70 font-mono font-bold">${escapeHtml(g.label)}</div>
              <div class="flex items-center justify-between">
                <span class="text-sm font-bold text-base-content/70">${icon}</span>
                <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${badge}">${statusText}</span>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>

      ${renderPrEvidenceContent()}
    </div>
  `;
}

function renderPrEvidenceContent() {
  if (!state || !state.github) return '';

  const prs = state.github.pullRequests || [];
  if (prs.length === 0) {
    if (!state.github.authenticated) {
      return `
        <div class="mt-4 p-4 rounded-xl bg-base-200 border border-base-300 text-xs text-base-content/70 flex items-center gap-2">
          <span>🔒</span>
          <span>GitHub CLI chưa xác thực. PR/CI: Không khả dụng.</span>
        </div>
      `;
    }
    return `
      <div class="mt-4 p-4 rounded-xl bg-base-200 border border-base-300 text-xs text-base-content/70 flex items-center gap-2">
        <span>ℹ️</span>
        <span>Không có PR đang mở.</span>
      </div>
    `;
  }

  const primaryPr = prs[0];
  const checks = primaryPr.checks || { list: [], summary: 'NO_CHECKS' };
  const reviews = primaryPr.reviews || { reviewList: [] };

  let checksBadge = 'bg-base-200 text-base-content/70 border-base-300';
  let checksSummaryText = checks.summary;
  if (checks.summary === 'PASSED') {
    checksBadge = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
    checksSummaryText = 'ĐẠT';
  } else if (checks.summary === 'FAILED') {
    checksBadge = 'bg-rose-500/20 text-rose-400 border-rose-500/40';
    checksSummaryText = 'LỖI';
  } else if (checks.summary === 'PENDING') {
    checksBadge = 'bg-amber-500/20 text-amber-400 border-amber-500/40';
    checksSummaryText = 'ĐANG CHẠY';
  } else if (checks.summary === 'NO_CHECKS') {
    checksSummaryText = 'KHÔNG CÓ CI';
  }

  let codexBadge = 'bg-base-200 text-base-content/70 border-base-300';
  let codexVerdictText = reviews.trustedCodexVerdict;
  if (reviews.trustedCodexVerdict === 'PASS') {
    codexBadge = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
    codexVerdictText = 'ĐẠT';
  } else if (reviews.trustedCodexVerdict === 'CHANGES_REQUIRED') {
    codexBadge = 'bg-rose-500/20 text-rose-400 border-rose-500/40';
    codexVerdictText = 'CẦN SỬA';
  } else if (!reviews.trustedCodexVerdict) {
    codexVerdictText = 'CHỜ';
  }

  return `
    <div class="mt-4 pt-4 border-t border-base-300 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2 font-mono">
          <span class="font-bold text-base-content">PR #${primaryPr.number}:</span>
          <span class="text-base-content/70">${escapeHtml(primaryPr.title)}</span>
          <a href="${primaryPr.url}" target="_blank" class="text-brand hover:underline">GitHub ↗</a>
        </div>
        <div class="flex items-center gap-2 font-mono text-[11px]">
          <span class="px-2 py-0.5 rounded border ${checksBadge} font-bold">
            CI: [${checksSummaryText} (${checks.passCount || 0}/${checks.totalCount || 0})]
          </span>
          <span class="px-2 py-0.5 rounded border ${codexBadge} font-bold">
            Codex: [${escapeHtml(codexVerdictText)}]
          </span>
          <span class="px-2 py-0.5 rounded border bg-base-200 text-base-content/70 border-base-300">
            HEAD: ${primaryPr.headRefOidShort || '—'}
          </span>
        </div>
      </div>

      ${
        checks.list && checks.list.length > 0
          ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs font-mono">
          ${checks.list
            .map((c) => {
              let icon = '○';
              let color = 'text-base-content/70';
              let concText = c.conclusion || c.status;
              if (c.conclusion === 'SUCCESS') {
                icon = '✓';
                color = 'text-emerald-400';
                concText = 'ĐẠT';
              } else if (c.conclusion === 'FAILURE') {
                icon = '✕';
                color = 'text-rose-400';
                concText = 'LỖI';
              } else if (c.status !== 'COMPLETED') {
                icon = '⚡';
                color = 'text-amber-400';
                concText = 'ĐANG CHẠY';
              }

              return `
              <div class="bg-base-200 px-3 py-2 rounded-lg border border-base-300 flex items-center justify-between">
                <span class="text-base-content/70 truncate" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
                <span class="font-bold ${color} ml-2">${icon} ${escapeHtml(concText)}</span>
              </div>
            `;
            })
            .join('')}
        </div>
      `
          : ''
      }
    </div>
  `;
}

function renderConflicts() {
  const container = document.getElementById('conflictsContainer');
  if (!container || !state) return;

  const conflicts = state.conflicts || [];
  if (conflicts.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="card bg-base-100 border border-error/40 p-4 space-y-3">
      <div class="flex items-center gap-2 text-error font-bold text-xs uppercase tracking-wide">
        <span>⚡ Phát hiện ${conflicts.length} xung đột trạng thái giữa các nguồn</span>
      </div>
      <div class="space-y-2">
        ${conflicts
          .map(
            (c) => `
          <div class="rounded-box border border-base-300 bg-base-200/60 p-3 text-xs space-y-1">
            <div class="font-bold text-error">${escapeHtml(c.title)}</div>
            <div class="text-base-content/80">${escapeHtml(c.description)}</div>
            <div class="text-[11px] text-warning font-mono">Tác động: ${escapeHtml(c.impact)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderSessions() {
  const container = document.getElementById('sessionsTableBody');
  if (!container || !state) return;

  const sessions = state.sessions || [];
  if (sessions.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="9" class="p-6 text-center text-base-content/70 text-xs">
          Không có agent Paseo nào đang chạy. Trạng thái Paseo: ${escapeHtml(state.daemon?.state || 'đã dừng')}.
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = sessions
    .map((s) => {
      const isWriter = s.isWriter;
      const writerBadge = isWriter
        ? '<span class="px-2 py-0.5 rounded bg-brand/20 text-brand border border-brand/30 text-[10px] font-bold">1 TÁC GIẢ GHI</span>'
        : '<span class="px-2 py-0.5 rounded bg-base-200 text-base-content/70 border border-base-300 text-[10px]">CHỈ ĐỌC</span>';

      return `
      <tr class="border-b border-base-300 hover:bg-base-200 transition">
        <td data-label="Session ID" class="p-3 font-mono text-base-content font-bold">${escapeHtml(s.id)}</td>
        <td data-label="Vai Trò" class="p-3 text-base-content/70 font-semibold">${escapeHtml(s.displayRole)}</td>
        <td data-label="Harness" class="p-3 font-mono text-base-content/70">${escapeHtml(s.harness)}</td>
        <td data-label="Source" class="p-3 font-mono text-base-content/70">${escapeHtml(s.source || 'unknown')}</td>
        <td data-label="Model" class="p-3 font-mono text-base-content/70">${escapeHtml(s.model || 'unknown')}</td>
        <td data-label="Nhánh / Worktree" class="p-3 font-mono text-base-content/70 truncate max-w-xs" title="${escapeHtml(s.branch)}">${escapeHtml(s.branch || '—')}</td>
        <td data-label="Trạng Thái" class="p-3 font-mono">${escapeHtml(formatSessionStatus(s.status))}</td>
        <td data-label="Quyền Ghi" class="p-3 text-xs">${writerBadge}</td>
        <td data-label="Độ Tươi" class="p-3 font-mono text-xs text-base-content/70">${escapeHtml(s.freshness?.label || '—')}</td>
      </tr>
    `;
    })
    .join('');
}

function renderQueueTable() {
  const container = document.getElementById('tasksTableBody');
  if (!container || !state || !state.workItems) return;

  let items = state.workItems.items || [];

  // Filter
  if (sliceFilter !== 'ALL') {
    items = items.filter((it) => it.slice === sliceFilter);
  }
  if (statusFilter !== 'ALL') {
    items = items.filter((it) => it.status === statusFilter);
  }
  if (searchFilter) {
    items = items.filter(
      (it) =>
        (it.work_item_id && it.work_item_id.toLowerCase().includes(searchFilter)) ||
        (it.feature_name && it.feature_name.toLowerCase().includes(searchFilter)) ||
        (it.key_behavior && it.key_behavior.toLowerCase().includes(searchFilter)) ||
        (it.slice && it.slice.toLowerCase().includes(searchFilter))
    );
  }

  const countLabel = document.getElementById('taskCountLabel');
  if (countLabel) {
    countLabel.innerText = `Hiển thị ${items.length} / ${state.workItems.total} đầu việc`;
  }

  if (items.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="8" class="p-8 text-center text-base-content/70 text-xs">
          Không tìm thấy công việc phù hợp với bộ lọc.
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      let statusClass = 'bg-base-200 text-base-content/70 border-base-300';
      if (item.status === 'MERGED')
        statusClass = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      else if (item.status === 'READY_FOR_CODEX')
        statusClass = 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      else if (item.status === 'READY_FOR_AUTHOR')
        statusClass = 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      else if (item.status === 'IN_PROGRESS')
        statusClass = 'bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse';
      else if (item.status?.startsWith('BLOCKED'))
        statusClass = 'bg-rose-950/40 text-rose-400 border-rose-800';

      return `
      <tr class="border-b border-base-300 hover:bg-base-200 text-xs transition">
        <td data-label="#" class="p-3 font-mono text-base-content/70">#${escapeHtml(item.delivery_order || '')}</td>
        <td data-label="Slice" class="p-3 font-mono font-bold text-base-content/70">${escapeHtml(item.slice || '')}</td>
        <td data-label="Mã Task" class="p-3 font-mono font-bold text-base-content">${escapeHtml(item.work_item_id || '')}</td>
        <td data-label="Tính Năng" class="p-3 text-base-content/70 font-semibold max-w-sm">
          <div class="truncate" title="${escapeHtml(item.feature_name || item.key_behavior || '')}">
            ${escapeHtml(item.feature_name || item.key_behavior || '')}
          </div>
        </td>
        <td data-label="Trạng Thái" class="p-3 font-mono">
          <span class="px-2 py-0.5 rounded border text-[10px] font-bold ${statusClass}">
            ${escapeHtml(formatWorkItemStatus(item.status))}
          </span>
        </td>
        <td data-label="Tác Giả" class="p-3 font-mono text-base-content/70">${escapeHtml(item.assigned_author || '')}</td>
        <td data-label="PR" class="p-3 font-mono text-base-content/70">${escapeHtml(item.pr || '—')}</td>
        <td data-label="Codex" class="p-3 font-mono text-base-content/70">${escapeHtml(item.codex_verdict || '—')}</td>
      </tr>
    `;
    })
    .join('');
}

function renderActivity() {
  const container = document.getElementById('activityStreamList');
  if (!container || !state) return;

  const activities = state.activity || [];
  if (activities.length === 0) {
    container.innerHTML =
      '<div class="p-4 text-center text-base-content/70 text-xs">Chưa có nhật ký hoạt động.</div>';
    return;
  }

  container.innerHTML = activities
    .map((act) => {
      const timeStr = act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : '';
      let badgeColor = 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      if (act.badge === 'Paseo') badgeColor = 'bg-purple-500/20 text-purple-400 border-purple-500/30';

      return `
      <div class="flex items-start gap-3 p-3 rounded-xl bg-base-200 border border-base-300 text-xs">
        <span class="px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${badgeColor}">${escapeHtml(act.badge || 'ACT')}</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-base-content/70 leading-snug">${escapeHtml(act.title)}</div>
          <div class="text-[11px] text-base-content/70 font-mono mt-0.5">${escapeHtml(act.actor || '')} • ${escapeHtml(act.detail || '')}</div>
        </div>
        <div class="text-[10px] font-mono text-base-content/70 whitespace-nowrap">${timeStr}</div>
      </div>
    `;
    })
    .join('');
}

const FAMILY_LABEL = {
  gemini: 'Gemini',
  'claude-gpt': 'Claude / GPT',
  // Not a model family: every model on the plan draws from one session and one
  // weekly budget, so naming it after a family would imply a split that is not
  // there.
  'claude-code': 'Claude Code',
};
const WINDOW_LABEL = { weekly: 'tuần', fiveHour: '5 giờ', session: 'phiên' };

/**
 * What each provider says is left, shown beside our own accounting rather than
 * folded into it.
 *
 * These are percentages of a ceiling the provider never discloses, so they
 * cannot be added to a token count without inventing that ceiling. What they
 * can do is account for spend this pipeline never saw — the operator working in
 * the IDE on the same account, or a pool switched off outright — which is why a
 * model can read "đã cạn" here while our own ledger for it is spotless.
 *
 * A figure the cache refused is shown as a refusal with its reason. Leaving it
 * blank would read as zero, and "we do not know" and "there is none left" call
 * for opposite responses.
 */
function renderVendorQuota(vendor) {
  const el = document.getElementById('capacityVendor');
  if (!el) return;
  if (!vendor || ((vendor.accounts || []).length === 0 && (vendor.problems || []).length === 0)) {
    el.innerHTML = '';
    return;
  }

  const bar = (percent, disabled) => {
    const pct = Math.max(0, Math.min(100, Number(percent) || 0));
    const colour =
      disabled || pct <= 2 ? 'bg-rose-500' : pct < 20 ? 'bg-amber-400' : 'bg-emerald-500';
    return (
      '<div class="h-1.5 rounded-full bg-base-200 overflow-hidden w-full">' +
      '<div class="h-full ' +
      colour +
      '" style="width:' +
      pct +
      '%"></div></div>'
    );
  };

  const rowHtml = (row) => {
    // Shown as remaining everywhere, because that is what every reader ranks
    // on. Where the provider stated spend instead, its own number is kept in
    // the tooltip so a figure here can be checked against the CLI without
    // anyone having to recall which direction the subtraction went.
    const value = row.disabled ? 'đã tắt' : row.remainingPercent + '%';
    const title =
      typeof row.usedPercent === 'number'
        ? ' title="' + escapeHtml('nhà cung cấp báo: đã dùng ' + row.usedPercent + '%') + '"'
        : '';
    const tone =
      row.disabled || row.remainingPercent <= 2
        ? 'text-rose-300'
        : row.remainingPercent < 20
          ? 'text-amber-300'
          : 'text-emerald-300';
    return (
      '<div class="grid grid-cols-[7.5rem_3rem_1fr_auto] items-center gap-2 text-[11px]">' +
      '<span class="text-base-content/70">' +
      escapeHtml(FAMILY_LABEL[row.family] || row.family) +
      '</span>' +
      '<span class="text-base-content/70">' +
      escapeHtml(WINDOW_LABEL[row.window] || row.window) +
      '</span>' +
      bar(row.remainingPercent, row.disabled) +
      '<span class="font-mono font-bold ' +
      tone +
      ' tabular-nums"' +
      title +
      '>' +
      escapeHtml(value) +
      '</span>' +
      '</div>'
    );
  };

  const accountHtml = (acc) => {
    // What is shown is what is actually known. Two of these providers cannot
    // name their account at all: the container reports a credential
    // fingerprint, and the Antigravity CLI keeps no readable record of its
    // login, so its readings are identified by the budget that answered.
    // Printing an address in those cases would be inventing one.
    const who = acc.label
      ? acc.label + ' (nhãn khai tay)'
      : acc.account
        ? String(acc.account).indexOf('fingerprint:') === 0
          ? 'đăng nhập riêng trong container'
          : String(acc.account).indexOf('budget:') === 0
            ? 'nhận diện theo mốc reset của hạn mức'
            : acc.account
        : 'không rõ account';
    return (
      '<div class="bg-base-200 rounded-xl p-3 border border-base-300 space-y-2">' +
      '<div class="flex items-baseline justify-between gap-2">' +
      '<span class="text-xs font-bold text-base-content">' +
      escapeHtml(acc.accountId) +
      '</span>' +
      '<span class="text-[10px] text-base-content/70">' +
      escapeHtml(who) +
      '</span></div>' +
      (acc.rows || []).map(rowHtml).join('') +
      ((acc.rows || []).some((r) => r.resetsAtText)
        ? '<div class="text-[10px] text-base-content/70">Reset: ' +
          escapeHtml(
            (acc.rows || [])
              .filter((r) => r.resetsAtText)
              .map((r) => (WINDOW_LABEL[r.window] || r.window) + ' — ' + r.resetsAtText)
              .join(' · ')
          ) +
          '</div>'
        : '') +
      '<div class="text-[10px] text-base-content/70">Đọc lúc ' +
      escapeHtml(acc.observedAt ? new Date(acc.observedAt).toLocaleTimeString() : 'không rõ') +
      '</div>' +
      '</div>'
    );
  };

  const problemHtml = (p) =>
    '<div class="text-[11px] px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200">' +
    '<span class="font-bold">' +
    escapeHtml(p.accountId) +
    '</span> — ' +
    escapeHtml(p.reason) +
    (p.switched ? ' <span class="text-amber-300/70">(cần chạy lại lệnh quota)</span>' : '') +
    '</div>';

  const id = vendor.identity || {};
  el.innerHTML =
    '<div class="bg-base-200 rounded-2xl p-5 border border-base-300 space-y-3">' +
    '<div class="flex items-start justify-between flex-wrap gap-2">' +
    '<div><h3 class="text-sm font-black text-base-content">Hạn mức nhà cung cấp tự báo</h3>' +
    '<p class="text-[11px] text-base-content/70 mt-0.5">Phần trăm còn lại trên trần mà nhà cung cấp không công bố — ' +
    'đọc riêng, không cộng vào số token bên dưới</p></div>' +
    '<span class="text-[10px] px-2 py-1 rounded-lg ' +
    (id.known
      ? 'bg-base-200 text-base-content/70 border border-base-300'
      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30') +
    '">' +
    escapeHtml(
      id.known ? 'đăng nhập Google (theo file cũ): ' + id.email : 'không rõ account host'
    ) +
    '</span></div>' +
    '<div class="grid sm:grid-cols-2 gap-2.5">' +
    (vendor.accounts || []).map(accountHtml).join('') +
    '</div>' +
    (vendor.problems || []).map(problemHtml).join('') +
    '</div>';
}

/**
 * Capacity panel: how much work the pool can still dispatch, and which model
 * runs out next. Reports "chưa rõ" wherever no limit was declared rather than
 * implying capacity nobody measured.
 */
function renderCapacity() {
  const summaryEl = document.getElementById('capacitySummary');
  const tableEl = document.getElementById('capacityTable');
  const claudeEl = document.getElementById('capacityClaude');
  const tabLabel = document.getElementById('tabCapacityLabel');
  if (!summaryEl || !tableEl) return;

  const cap = state && state.capacity;
  const health = state && state.sources && state.sources.capacity;

  const tile = (label, value, cls, note) =>
    '<div class="bg-base-200 p-3 rounded-xl border border-base-300">' +
    '<div class="text-[11px] text-base-content/70 font-semibold uppercase">' +
    label +
    '</div>' +
    '<div class="text-xl font-black mt-1 ' +
    cls +
    '">' +
    value +
    '</div>' +
    '<div class="text-[10px] text-base-content/70 mt-0.5">' +
    note +
    '</div></div>';

  if (!cap) {
    summaryEl.innerHTML =
      '<div class="bg-base-200 rounded-2xl p-5 border border-amber-500/30 text-amber-200 text-sm">' +
      '<div class="font-bold mb-1">Chưa đo được sức chứa</div><div class="text-amber-300/80">' +
      escapeHtml((health && health.impact) || 'Không có dữ liệu') +
      '</div></div>';
    tableEl.innerHTML = '';
    if (claudeEl) claudeEl.innerHTML = '';
    if (tabLabel) tabLabel.textContent = '—';
    return;
  }

  const s = cap.summary;
  const known = s.sufficient - s.unknownBudget;
  if (tabLabel) {
    tabLabel.textContent = known > 0 ? Math.floor(s.tasksRemaining) + ' lượt' : '?';
  }

  summaryEl.innerHTML =
    '<div class="bg-base-200 rounded-2xl p-5 border border-base-300 space-y-4">' +
    '<div class="flex items-start justify-between flex-wrap gap-2">' +
    '<div><h3 class="text-sm font-black text-base-content">Sức chứa còn lại của cả pool</h3>' +
    '<p class="text-[11px] text-base-content/70 mt-0.5">Tính theo việc cỡ ' +
    escapeHtml(cap.difficultyName) +
    '</p></div>' +
    (cap.derivedFromRouter
      ? '<span class="text-[10px] px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30">suy ra từ 9router</span>'
      : '') +
    '</div>' +
    '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">' +
    tile(
      'Lượt việc còn lại',
      known > 0 ? Math.floor(s.tasksRemaining) : 'chưa rõ',
      known > 0 ? 'text-brand' : 'text-base-content/70',
      known > 0 ? 'trên ' + known + ' model đã khai hạn mức' : 'chưa model nào khai hạn mức'
    ) +
    tile('Model đủ năng lực', String(s.sufficient), 'text-emerald-400', 'trên tổng ' + s.total) +
    tile(
      'Sắp cạn',
      String(s.atRisk),
      s.atRisk > 0 ? 'text-rose-400' : 'text-emerald-400',
      s.atRisk > 0 ? 'còn dưới 2 lượt việc' : 'không có model nào sắp cạn'
    ) +
    tile(
      'Bay mù',
      String(s.unknownBudget),
      s.unknownBudget > 0 ? 'text-amber-400' : 'text-emerald-400',
      'chưa khai hạn mức token'
    ) +
    '</div>' +
    (s.unknownBudget > 0
      ? '<div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200">' +
        'Chưa khai hạn mức thì không tính được còn bao nhiêu lượt việc. Khai ' +
        '<span class="font-mono">tokensPerDay</span> hoặc <span class="font-mono">tokensPerMonth</span> ' +
        'cho từng tài khoản để bảng này có ý nghĩa.</div>'
      : '') +
    '</div>';

  renderVendorQuota(cap.vendorQuota);

  const rows = cap.rows.slice().sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.runway === null) return 1;
    if (b.runway === null) return -1;
    return b.runway - a.runway;
  });

  const statusChip = (row) => {
    const map = {
      open: ['bg-emerald-500/20 text-emerald-300 border-emerald-500/30', 'còn dư'],
      tight: ['bg-amber-500/20 text-amber-300 border-amber-500/30', 'sắp chạm'],
      exhausted: ['bg-rose-500/20 text-rose-300 border-rose-500/30', 'đã cạn'],
      cooling: ['bg-sky-500/20 text-sky-300 border-sky-500/30', 'đang nguội'],
      unknown: ['bg-base-200 text-base-content/70 border-base-300', 'chưa rõ'],
    };
    const entry = map[row.status] || map.unknown;
    const extra = row.boundBy && row.status !== 'unknown' ? ' · ' + row.boundBy : '';
    return (
      '<span class="text-[10px] px-2 py-0.5 rounded border ' +
      entry[0] +
      '">' +
      entry[1] +
      extra +
      '</span>'
    );
  };

  const bar = (row) => {
    if (row.runway === null) return '<span class="text-[11px] text-base-content/70">chưa rõ</span>';
    const pct = Math.min(100, (row.runway / 10) * 100);
    const colour = row.atRisk ? 'bg-rose-500' : row.runway < 5 ? 'bg-amber-500' : 'bg-emerald-500';
    return (
      '<div class="flex items-center gap-2">' +
      '<div class="flex-1 h-1.5 rounded-full bg-base-200 overflow-hidden min-w-[60px]">' +
      '<div class="h-full ' +
      colour +
      '" style="width:' +
      pct.toFixed(0) +
      '%"></div></div>' +
      '<span class="text-[11px] font-mono ' +
      (row.atRisk ? 'text-rose-300' : 'text-base-content/70') +
      '">' +
      row.runway.toFixed(1) +
      '</span></div>'
    );
  };

  tableEl.innerHTML =
    '<div class="bg-base-200 rounded-2xl border border-base-300 overflow-hidden">' +
    '<div class="overflow-x-auto"><table class="w-full text-xs min-w-[640px]">' +
    '<thead><tr class="bg-base-200 text-base-content/70 uppercase text-[10px]">' +
    '<th class="text-left px-4 py-2.5 font-semibold">Model</th>' +
    '<th class="text-left px-4 py-2.5 font-semibold">Bậc</th>' +
    '<th class="text-left px-4 py-2.5 font-semibold">Cấp độ</th>' +
    '<th class="text-left px-4 py-2.5 font-semibold">Trạng thái</th>' +
    '<th class="text-left px-4 py-2.5 font-semibold">Cỡ việc</th>' +
    '<th class="text-left px-4 py-2.5 font-semibold w-40">Còn mấy lượt</th>' +
    '</tr></thead><tbody>' +
    rows
      .map(
        (row) =>
          '<tr class="border-t border-base-300' +
          (row.atRisk ? ' bg-rose-500/5' : '') +
          '">' +
          '<td class="px-4 py-2.5"><div class="font-mono text-base-content/70">' +
          escapeHtml(row.model) +
          '</div>' +
          '<div class="text-[10px] text-base-content/70 font-mono">' +
          escapeHtml(row.accountId) +
          '</div></td>' +
          '<td class="px-4 py-2.5 font-mono text-base-content/70">' +
          row.tier +
          '</td>' +
          '<td class="px-4 py-2.5"><span class="' +
          (row.sufficient ? 'text-base-content/70' : 'text-base-content/70 line-through') +
          '">' +
          escapeHtml(row.gradeName) +
          '</span></td>' +
          '<td class="px-4 py-2.5">' +
          statusChip(row) +
          '</td>' +
          '<td class="px-4 py-2.5 font-mono text-base-content/70">' +
          Math.round(row.tokensPerTask / 1000) +
          'K</td>' +
          '<td class="px-4 py-2.5">' +
          bar(row) +
          '</td>' +
          '</tr>'
      )
      .join('') +
    '</tbody></table></div></div>';

  if (claudeEl) {
    const c = cap.claude;
    claudeEl.innerHTML =
      c && c.available
        ? '<div class="bg-base-200 rounded-2xl p-5 border border-base-300">' +
          '<h3 class="text-sm font-black text-base-content mb-1">Claude Code (ngoài pool)</h3>' +
          '<p class="text-[11px] text-base-content/70 mb-3">Việc Claude Code làm trực tiếp không đi qua 9router, nên báo riêng — cộng vào sẽ ngụ ý một ngân sách chung không tồn tại.</p>' +
          '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">' +
          tile('Lượt trả lời', String(c.messages), 'text-base-content/70', 'đọc từ transcript') +
          tile(
            'Token',
            (c.tokens / 1e6).toFixed(1) + 'M',
            'text-base-content/70',
            'gồm cả đọc cache'
          ) +
          tile(
            'Tỉ lệ cache',
            (c.cacheHitRate * 100).toFixed(1) + '%',
            'text-emerald-400',
            'rẻ hơn ~10 lần nhập mới'
          ) +
          '</div></div>'
        : '';
  }
}

function renderDiagnostics() {
  const container = document.getElementById('diagnosticsPanel');
  if (!container || !state || !state.sources) return;

  container.innerHTML = Object.entries(state.sources)
    .map(
      ([key, src]) => `
    <div class="card bg-base-100 border border-base-300 p-4 space-y-2 text-xs font-mono">
      <div class="flex items-center justify-between pb-2 border-b border-base-300">
        <span class="font-bold uppercase">${escapeHtml(src.name || key)}</span>
        <span class="${src.status === 'live' ? 'badge badge-success badge-sm' : 'badge badge-warning badge-sm'}">${escapeHtml(freshnessLabel(src.status))}</span>
      </div>
      <div><span class="opacity-60">Nguồn:</span> ${escapeHtml(src.provenance || '—')}</div>
      <div><span class="opacity-60">Đo lúc:</span> ${escapeHtml(src.observedAt || '—')} (${typeof src.latencyMs === 'number' ? src.latencyMs + 'ms' : 'không đo độ trễ'})</div>
      <div><span class="opacity-60">Độ mới:</span> ${escapeHtml(freshnessLabel(src.freshness))} (Tuổi: ${escapeHtml(formatSourceAge(src.ageMs))})</div>
      <div><span class="opacity-60">Ảnh hưởng:</span> ${escapeHtml(src.impact || '—')}</div>
      ${src.error ? `<div class="text-error"><span class="opacity-60">Lỗi:</span> ${escapeHtml(src.error)}</div>` : ''}
    </div>
  `
    )
    .join('');
}

function switchTab(tabId) {
  activeTab = tabId;

  // Toggle active button styles
  const tabs = ['roster', 'progress', 'system'];
  tabs.forEach((t) => {
    const btn = document.getElementById(`tabBtn-${t}`);
    const pane = document.getElementById(`tabPane-${t}`);
    if (btn) {
      if (t === tabId) {
        btn.className = 'tab tab-active font-bold';
      } else {
        btn.className = 'tab font-bold';
      }
    }
    if (pane) {
      if (t === tabId) pane.classList.remove('hidden');
      else pane.classList.add('hidden');
    }
  });
}

function renderMinimalStaticTasks(tasks) {
  state = {
    schemaVersion: '3.3.0',
    revision: 1,
    observedAt: new Date().toISOString(),
    overallStatus: 'partial',
    sources: {
      register: {
        status: 'live',
        provenance: 'Static Embedded Register',
        latencyMs: 0,
        impact: 'Offline Snapshot',
      },
      git: { status: 'unavailable', impact: 'Server offline' },
      paseo: { status: 'unavailable', impact: 'Server offline' },
      github: { status: 'unavailable', impact: 'Server offline' },
    },
    workItems: {
      total: tasks.length,
      mergedCount: tasks.filter((t) => t.status === 'MERGED').length,
      completionPercent: (
        (tasks.filter((t) => t.status === 'MERGED').length / tasks.length) *
        100
      ).toFixed(1),
      items: tasks,
      activeItem:
        tasks.find((t) => t.status === 'IN_PROGRESS') ||
        tasks.find((t) => t.status === 'READY_FOR_CODEX') ||
        tasks[0],
    },
    sessions: [],
    pullRequests: [],
    conflicts: [],
    activity: [],
  };
  applyState(state);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Exposed for the Node test suite only — a no-op in the browser, where
// `module` is undefined and this branch never runs.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { deriveWriterState, GATE_STAGE_LABELS, formatSourceAge, FRESHNESS_BADGE };
}
