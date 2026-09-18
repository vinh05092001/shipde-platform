/* TASK-AI-47 — rotation panel inside the Capacity & Quota tab.
   Draws the dispatcher hub, one node per configured source, and an animated
   arrow to every source currently serving a run. Nothing is invented: a value
   the aggregator reports as UNKNOWN is printed as UNKNOWN. */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CX = 350, CY = 310, R = 225;
  var POLL_MS = 5000;

  function el(tag, attrs, text) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function num(v) {
    if (v === 'UNKNOWN' || v == null) return 'UNKNOWN';
    return Number(v).toLocaleString('vi-VN');
  }

  // One accent per source, the way 9Router gives every provider its own mark.
  var ACCENT = {
    '9router': '#8b5cf6',
    xkiro: '#0ea5e9',
    'agy-local': '#10b981',
    'agy-docker': '#0d9488',
    cline: '#f97316',
    autoclaw: '#e11d48',
    ao: '#6366f1',
    codex: '#334155',
  };

  function accent(id) { return ACCENT[id] || '#64748b'; }

  function statusColor(status) {
    if (status === 'live') return '#16a34a';
    if (status === 'exhausted' || status === 'cooldown') return '#dc2626';
    return '#64748b';
  }

  function kpi(label, value, color) {
    return '<div class="rounded-xl border p-3" style="border-color:var(--line);background:var(--panel);border-top:3px solid ' + color + '">' +
      '<div class="text-[10px] uppercase tracking-wide opacity-60">' + label + '</div>' +
      '<div class="text-xl font-bold" style="color:' + color + '">' + value + '</div></div>';
  }

  function outcomeDot(outcome) {
    var c = outcome === 'live' ? '#16a34a' : outcome === 'quota-refused' ? '#dc2626' : outcome === 'done' ? '#0f766e' : '#94a3b8';
    return '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + c + '"></span>';
  }

  function renderKpis(t) {
    var box = document.getElementById('rotation-kpis');
    if (!box || !t) return;
    box.innerHTML =
      kpi('Lượt chạy', t.attempts, '#3f3a33') +
      kpi('Đang chạy', t.live, t.live > 0 ? '#16a34a' : '#857b6e') +
      kpi('Bị từ chối quota', t.quotaRefused, t.quotaRefused > 0 ? '#b45309' : '#857b6e') +
      kpi('Nguồn hết hạn mức', t.exhausted + '/' + t.sourcesConfigured, t.exhausted > 0 ? '#dc2626' : '#16a34a');
  }

  function renderRuns(runs) {
    var box = document.getElementById('rotation-runs');
    if (!box) return;
    if (!runs || !runs.length) { box.innerHTML = '<div class="p-3 opacity-60">chưa có lượt chạy nào</div>'; return; }
    box.innerHTML = runs.slice(0, 12).map(function (r) {
      return '<div class="flex items-center gap-2 px-3 py-1.5 border-b" style="border-color:var(--line)">' +
        outcomeDot(r.outcome) +
        '<span class="font-mono">' + (r.at || '--:--:--') + '</span>' +
        '<span class="font-bold">' + r.runId + '</span>' +
        '<span class="font-bold" style="color:' + accent(r.sourceId) + '">' + r.sourceId + '</span>' +
        '<span class="opacity-70 truncate">' + r.modelId + '</span>' +
        '<span class="ml-auto opacity-60">' + (r.tokens === 'UNKNOWN' ? '' : num(r.tokens) + ' tk') + '</span>' +
        '</div>';
    }).join('');
  }

  function render(data) {
    renderKpis(data && data.totals);
    renderRuns(data && data.runs);
    var svg = document.getElementById('rotation-svg');
    var cards = document.getElementById('rotation-cards');
    var stamp = document.getElementById('rotationObservedAt');
    if (!svg || !cards) return;
    svg.innerHTML = '';
    cards.innerHTML = '';
    if (stamp && data && data.observedAt) stamp.textContent = 'đo lúc ' + data.observedAt.slice(11, 19);
    var sources = (data && data.sources ? data.sources : []).filter(function (s) { return s.configured; });
    if (!sources.length) return;

    // Hub: a card, not a bubble, so it reads like the rest of the cockpit.
    svg.appendChild(el('rect', { x: CX - 62, y: CY - 22, width: 124, height: 44, rx: 12, fill: '#fff7ed', stroke: '#ea4b12', 'stroke-width': 2 }));
    svg.appendChild(el('text', { x: CX, y: CY + 5, 'text-anchor': 'middle', fill: '#9a3412', 'font-size': 13, 'font-weight': 'bold' }, 'Dispatcher'));

    sources.forEach(function (src, i) {
      var a = (2 * Math.PI * i) / sources.length - Math.PI / 2;
      var nx = CX + R * Math.cos(a), ny = CY + R * Math.sin(a);
      var live = src.status === 'live';
      var down = src.status === 'exhausted' || src.status === 'cooldown';
      var g = el('g', down ? { class: 'rot-dim' } : null);
      var W = 116, H = 40;

      // Edge: idle links recede, the serving link is amber and flows.
      var edge = el('path', {
        d: 'M' + (CX + 62 * Math.cos(a)) + ',' + (CY + 22 * Math.sin(a)) +
           ' Q' + (CX + nx) / 2 + ',' + (CY + ny) / 2 + ' ' + (nx - (W / 2) * Math.cos(a)) + ',' + (ny - (H / 2) * Math.sin(a)),
        fill: 'none',
        stroke: live ? '#f59e0b' : accent(src.id),
        'stroke-width': live ? 2.5 : 1,
        opacity: live ? 0.9 : 0.35,
      });
      if (live) edge.setAttribute('class', 'rot-flow');
      g.appendChild(edge);

      if (live && src.activeRun && src.activeRun.modelId) {
        var label = src.activeRun.modelId.split('/').pop();
        if (src.activeRun.tokensSoFar !== 'UNKNOWN') label += ' · ' + num(src.activeRun.tokensSoFar) + ' tk';
        g.appendChild(el('text', {
          x: (CX + nx) / 2, y: (CY + ny) / 2 - 8, 'text-anchor': 'middle',
          fill: '#b45309', 'font-size': 11, 'font-weight': 'bold',
        }, label));
      }

      g.appendChild(el('rect', {
        x: nx - W / 2, y: ny - H / 2, width: W, height: H, rx: 10,
        fill: live ? '#fffbeb' : '#fffdf7',
        stroke: live ? '#f59e0b' : accent(src.id), 'stroke-width': live ? 2.5 : 1.5,
      }));
      g.appendChild(el('circle', { cx: nx - W / 2 + 14, cy: ny, r: 4, fill: statusColor(src.status) }));
      g.appendChild(el('rect', { x: nx - W / 2, y: ny - H / 2, width: 4, height: H, rx: 2, fill: accent(src.id) }));
      g.appendChild(el('text', { x: nx - W / 2 + 26, y: ny - 1, fill: '#3f3a33', 'font-size': 12, 'font-weight': 'bold' }, src.label));
      g.appendChild(el('text', { x: nx - W / 2 + 26, y: ny + 12, fill: '#857b6e', 'font-size': 10 },
        down ? (src.cooldown.reason || 'hết hạn mức').slice(0, 18) : src.status));
      svg.appendChild(g);

      var lim = src.limits || {};
      var runs = src.recentRuns || [];
      var counts = { done: 0, failed: 0, 'quota-refused': 0 };
      runs.forEach(function (r) { if (counts[r.outcome] != null) counts[r.outcome]++; });
      var pct = null;
      if (lim.declaredLimit !== 'UNKNOWN' && lim.consumption !== 'UNKNOWN' && lim.declaredLimit > 0) {
        pct = Math.min(100, Math.round((lim.consumption / lim.declaredLimit) * 100));
      }
      var card = document.createElement('div');
      card.className = 'rounded-xl border p-3 text-[11px] leading-5' + (down ? ' opacity-70' : '');
      card.style.borderColor = 'var(--line)';
      card.style.borderLeft = '4px solid ' + accent(src.id);
      card.style.background = live ? '#fffbeb' : 'var(--panel)';
      card.innerHTML =
        '<div class="flex items-center gap-2 mb-1">' +
          '<span style="width:7px;height:7px;border-radius:50%;display:inline-block;background:' + statusColor(src.status) + '"></span>' +
          '<span class="font-bold text-[12px]">' + src.label + '</span>' +
          '<span class="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold" style="color:' + statusColor(src.status) + ';background:' + statusColor(src.status) + '1a">' + src.status + '</span>' +
        '</div>' +
        (live && src.activeRun.modelId
          ? '<div class="truncate" style="color:#b45309">▶ ' + src.activeRun.modelId + '</div>'
          : down && src.cooldown.reason
            ? '<div class="truncate" style="color:#dc2626">' + src.cooldown.reason + '</div>'
            : '') +
        '<div class="opacity-80"><span class="opacity-60">đã dùng </span><span class="font-mono">' + num(lim.consumption) + ' / ' + num(lim.declaredLimit) + '</span></div>' +
        (pct === null
          ? '<div class="opacity-50">còn lại UNKNOWN (chưa khai hạn mức)</div>'
          : '<div class="mt-1 h-1.5 rounded-full" style="background:#ece3d2">' +
            '<div class="h-1.5 rounded-full" style="width:' + pct + '%;background:' + (pct >= 100 ? '#dc2626' : accent(src.id)) + '"></div></div>' +
            '<div class="opacity-60 mt-0.5">còn lại ' + num(lim.headroom) + '</div>') +
        '<div class="mt-1 flex gap-2 opacity-70">' +
          '<span style="color:#0f766e">' + counts.done + ' xong</span>' +
          '<span style="color:#b91c1c">' + counts.failed + ' hỏng</span>' +
          '<span style="color:#b45309">' + counts['quota-refused'] + ' hết quota</span>' +
        '</div>';
      cards.appendChild(card);
    });
  }

  function poll() {
    fetch('/api/rotation')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) render(d); })
      .catch(function () { /* the panel simply keeps its last measured state */ });
  }

  poll();
  setInterval(poll, POLL_MS);
})();
