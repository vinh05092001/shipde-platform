/* TASK-AI-47 — rotation panel inside the Capacity & Quota tab.
   Draws the dispatcher hub, one node per configured source, and an animated
   arrow to every source currently serving a run. Nothing is invented: a value
   the aggregator reports as UNKNOWN is printed as UNKNOWN. */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CX = 330,
    CY = 260,
    RX = 340,
    RY = 195,
    STAGGER = 40;
  var POLL_MS = 5000;

  function el(tag, attrs, text) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        e.setAttribute(k, attrs[k]);
      });
    if (text != null) e.textContent = text;
    return e;
  }

  function num(v) {
    if (v === 'UNKNOWN' || v == null) return 'UNKNOWN';
    return Number(v).toLocaleString('vi-VN');
  }

  // One accent per source, the way 9Router gives every provider its own mark.
  var ACCENT = {
    tencent: '#0ea5e9',
    rqsty: '#8b5cf6',
    thb: '#f97316',
    '9router': '#8b5cf6',
    xkiro: '#0ea5e9',
    bai: '#2563eb',
    'agy-local': '#10b981',
    paseo: '#0d9488',
    cline: '#f97316',
    autoclaw: '#e11d48',
    codex: '#334155',
  };

  function accent(id) {
    return ACCENT[id] || '#64748b';
  }

  function statusColor(status) {
    if (status === 'live') return '#16a34a';
    if (status === 'quota-exhausted' || status === 'cooldown') return '#dc2626';
    return '#64748b';
  }

  function statusLabelVi(status) {
    if (status === 'live') return 'đang chạy';
    if (status === 'idle') return 'rảnh';
    if (status === 'quota-exhausted') return 'hết hạn mức';
    if (status === 'cooldown') return 'tạm nghỉ';
    return status || 'chưa rõ';
  }

  function kpi(label, value, color) {
    return (
      '<div class="rounded-xl border p-3" style="border-color:var(--line);background:var(--panel);border-top:3px solid ' +
      color +
      '">' +
      '<div class="text-[10px] uppercase tracking-wide opacity-60">' +
      label +
      '</div>' +
      '<div class="text-xl font-bold" style="color:' +
      color +
      '">' +
      value +
      '</div></div>'
    );
  }

  function outcomeDot(outcome) {
    var c =
      outcome === 'live'
        ? '#16a34a'
        : outcome === 'quota-refused'
          ? '#dc2626'
          : outcome === 'done'
            ? '#0f766e'
            : '#94a3b8';
    return (
      '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' +
      c +
      '"></span>'
    );
  }

  function renderKpis(t, log) {
    var box = document.getElementById('rotation-kpis');
    if (!box || !t) return;
    // A dispatcher log that cannot be read is reported as UNKNOWN, never as a
    // comfortable zero.
    var unreadable = log && log.exists === false;
    box.innerHTML =
      kpi('Lượt chạy', num(t.attempts), '#3f3a33') +
      kpi('Bị bỏ qua trước khi chạy', num(t.skipped), '#94a3b8') +
      kpi('Đang chạy', num(t.live), t.live > 0 ? '#16a34a' : '#5c5349') +
      kpi('Bị từ chối hạn mức', num(t.quotaRefused), t.quotaRefused > 0 ? '#b45309' : '#5c5349') +
      kpi(
        'Nguồn hết hạn mức',
        t.exhausted + '/' + t.sourcesConfigured,
        t.exhausted > 0 ? '#dc2626' : '#16a34a'
      ) +
      (unreadable
        ? '<div class="rounded-xl border p-3 text-xs" style="border-color:#dc2626;background:#fef2f2;color:#b91c1c">' +
          'Không đọc được log dispatcher — số lượt chạy là UNKNOWN, không phải 0.</div>'
        : '');
  }

  function renderRuns(runs) {
    var box = document.getElementById('rotation-runs');
    if (!box) return;
    if (!runs || !runs.length) {
      box.innerHTML = '<div class="p-3 opacity-60">chưa có lượt chạy nào</div>';
      return;
    }
    box.innerHTML = runs
      .slice(0, 12)
      .map(function (r) {
        var skipped = r.outcome === 'quota-refused' && r.reason;
        return (
          '<div class="flex items-center gap-2 px-3 py-1.5 border-b" style="border-color:var(--line)">' +
          outcomeDot(r.outcome) +
          '<span class="font-mono">' +
          (r.at || '--:--:--') +
          '</span>' +
          '<span class="font-bold">' +
          r.runId +
          '</span>' +
          '<span class="font-bold" style="color:' +
          accent(r.sourceId) +
          '">' +
          r.sourceId +
          '</span>' +
          '<span class="opacity-70 truncate">' +
          r.modelId +
          '</span>' +
          '<span class="ml-auto opacity-60">' +
          (skipped ? 'bỏ qua: ' + r.reason : r.tokens === 'UNKNOWN' ? '' : num(r.tokens) + ' tk') +
          '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function render(data) {
    renderKpis(data && data.totals, data && data.log);
    renderRuns(data && data.runs);
    var svg = document.getElementById('rotation-svg');
    var cards = document.getElementById('rotation-cards');
    var stamp = document.getElementById('rotationObservedAt');
    if (!svg || !cards) return;
    svg.innerHTML = '';
    cards.innerHTML = '';
    svg.setAttribute('viewBox', '-135 -75 930 675');
    if (stamp && data && data.observedAt)
      stamp.textContent = 'đo lúc ' + data.observedAt.slice(11, 19);
    var sources = (data && data.sources ? data.sources : []).filter(function (s) {
      return s.configured;
    });
    if (!sources.length) return;

    // Hub: a card, not a bubble, so it reads like the rest of the cockpit.
    svg.appendChild(
      el('rect', {
        x: CX - 78,
        y: CY - 30,
        width: 156,
        height: 60,
        rx: 14,
        fill: '#fff7ed',
        stroke: '#ea4b12',
        'stroke-width': 2,
      })
    );
    svg.appendChild(
      el(
        'text',
        {
          x: CX,
          y: CY + 6,
          'text-anchor': 'middle',
          fill: '#9a3412',
          'font-size': 15,
          'font-weight': 'bold',
        },
        'Điều phối'
      )
    );

    sources.forEach(function (src, i) {
      var a = (2 * Math.PI * i) / sources.length - Math.PI / 2;
      var out = sources.length > 10 && i % 2 ? STAGGER : 0;
      // Near the top and bottom of the ring neighbours are almost side by side, which is
      // where wide cards collide. Push those further out along y in proportion to how
      // vertical they sit, so the crowd thins exactly where it forms.
      var vert = Math.abs(Math.sin(a));
      var nx = CX + (RX + out) * Math.cos(a),
        ny = CY + (RY + out + vert * 52) * Math.sin(a);
      var live = src.status === 'live';
      var down = src.status === 'quota-exhausted' || src.status === 'cooldown';
      var g = el('g', down ? { class: 'rot-dim' } : null);
      var W = 148,
        H = 50;

      // Edge: idle links recede, the serving link is amber and flows.
      var edge = el('path', {
        d:
          'M' +
          (CX + 78 * Math.cos(a)) +
          ',' +
          (CY + 30 * Math.sin(a)) +
          ' Q' +
          (CX + nx) / 2 +
          ',' +
          (CY + ny) / 2 +
          ' ' +
          (nx - (W / 2) * Math.cos(a)) +
          ',' +
          (ny - (H / 2) * Math.sin(a)),
        fill: 'none',
        stroke: live ? '#f59e0b' : accent(src.id),
        'stroke-width': live ? 2.5 : 1,
        opacity: live ? 0.9 : 0.35,
      });
      if (live) edge.setAttribute('class', 'rot-flow');
      g.appendChild(edge);

      if (live && src.activeRun && src.activeRun.modelId) {
        var label = src.activeRun.modelId.split('/').pop();
        if (src.activeRun.tokensSoFar !== 'UNKNOWN')
          label += ' · ' + num(src.activeRun.tokensSoFar) + ' tk';
        g.appendChild(
          el(
            'text',
            {
              x: (CX + nx) / 2,
              y: (CY + ny) / 2 - 8,
              'text-anchor': 'middle',
              fill: '#b45309',
              'font-size': 11,
              'font-weight': 'bold',
            },
            label
          )
        );
      }

      g.appendChild(
        el('rect', {
          x: nx - W / 2,
          y: ny - H / 2,
          width: W,
          height: H,
          rx: 10,
          fill: live ? '#fffbeb' : '#fffdf7',
          stroke: live ? '#f59e0b' : accent(src.id),
          'stroke-width': live ? 2.5 : 1.5,
        })
      );
      g.appendChild(
        el('circle', { cx: nx - W / 2 + 14, cy: ny, r: 4, fill: statusColor(src.status) })
      );
      g.appendChild(
        el('rect', {
          x: nx - W / 2,
          y: ny - H / 2,
          width: 4,
          height: H,
          rx: 2,
          fill: accent(src.id),
        })
      );
      var nodeText = src.id === 'bai' && src.nodeLabel ? src.nodeLabel : src.label;
      g.appendChild(
        el(
          'text',
          {
            x: nx - W / 2 + 26,
            y: ny - 1,
            fill: '#3f3a33',
            'font-size': src.id === 'bai' ? 11 : 12,
            'font-weight': 'bold',
          },
          nodeText
        )
      );
      g.appendChild(
        el(
          'text',
          { x: nx - W / 2 + 26, y: ny + 12, fill: '#5c5349', 'font-size': 10 },
          statusLabelVi(src.status)
        )
      );
      svg.appendChild(g);

      var lim = src.limits || {};
      var runs = src.recentRuns || [];
      var counts = { done: 0, failed: 0, 'quota-refused': 0 };
      runs.forEach(function (r) {
        if (counts[r.outcome] != null) counts[r.outcome]++;
      });
      var pct = null;
      if (
        lim.declaredLimit !== 'UNKNOWN' &&
        lim.consumption !== 'UNKNOWN' &&
        lim.declaredLimit > 0
      ) {
        pct = Math.min(100, Math.round((lim.consumption / lim.declaredLimit) * 100));
      }
      var cardTitle = src.id === 'bai' && src.nodeLabel ? src.nodeLabel : src.label;
      var warningHtml =
        src.warnings && src.warnings.length > 0
          ? '<div class="truncate text-[10px] mt-0.5" style="color:#b45309" title="' +
            src.warnings.join(', ') +
            '">⚠️ ' +
            src.warnings[0] +
            '</div>'
          : '';
      var card = document.createElement('div');
      card.className = 'rounded-xl border p-3 text-[11px] leading-5' + (down ? ' opacity-70' : '');
      card.style.borderColor = 'var(--line)';
      card.style.borderLeft = '4px solid ' + accent(src.id);
      card.style.background = live ? '#fffbeb' : 'var(--panel)';
      card.innerHTML =
        '<div class="flex items-center gap-2 mb-1">' +
        '<span style="width:7px;height:7px;border-radius:50%;display:inline-block;background:' +
        statusColor(src.status) +
        '"></span>' +
        '<span class="font-bold text-[12px]">' +
        cardTitle +
        '</span>' +
        '<span class="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold" style="color:' +
        statusColor(src.status) +
        ';background:' +
        statusColor(src.status) +
        '1a">' +
        statusLabelVi(src.status) +
        '</span>' +
        '</div>' +
        (live && src.activeRun && src.activeRun.modelId
          ? '<div class="truncate" style="color:#b45309">▶ ' + src.activeRun.modelId + '</div>'
          : down && src.cooldown && src.cooldown.reason
            ? '<div class="truncate" style="color:#dc2626">' + src.cooldown.reason + '</div>'
            : '') +
        '<div class="font-mono opacity-75">' +
        num(lim.consumption) +
        ' / ' +
        num(lim.declaredLimit) +
        '</div>' +
        (pct === null
          ? '<div class="opacity-60 mt-0.5">' +
            (lim.headroom !== 'UNKNOWN'
              ? 'còn ' + num(lim.headroom)
              : '<span class="opacity-45">chưa khai hạn mức</span>') +
            '</div>'
          : '<div class="mt-1 h-1.5 rounded-full" style="background:#ece3d2">' +
            '<div class="h-1.5 rounded-full" style="width:' +
            pct +
            '%;background:' +
            (pct >= 100 ? '#dc2626' : accent(src.id)) +
            '"></div></div>' +
            '<div class="opacity-60 mt-0.5">còn ' +
            num(lim.headroom) +
            '</div>') +
        warningHtml +
        '<div class="mt-1 flex gap-2 opacity-70">' +
        '<span style="color:#0f766e" title="Thành công">✓ ' +
        counts.done +
        '</span>' +
        '<span style="color:#b91c1c" title="Thất bại">✕ ' +
        counts.failed +
        '</span>' +
        '<span style="color:#b45309" title="Hết hạn mức">⃠ ' +
        counts['quota-refused'] +
        '</span>' +
        '</div>';
      cards.appendChild(card);
    });
  }

  function poll() {
    fetch('/api/rotation')
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d) render(d);
      })
      .catch(function () {
        /* the panel simply keeps its last measured state */
      });
  }

  poll();
  setInterval(poll, POLL_MS);
})();
