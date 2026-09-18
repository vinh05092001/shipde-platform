/* TASK-AI-47 — rotation panel inside the Capacity & Quota tab.
   Draws the dispatcher hub, one node per configured source, and an animated
   arrow to every source currently serving a run. Nothing is invented: a value
   the aggregator reports as UNKNOWN is printed as UNKNOWN. */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CX = 320, CY = 300, R = 210;
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

  function statusColor(status) {
    if (status === 'live') return '#16a34a';
    if (status === 'exhausted' || status === 'cooldown') return '#dc2626';
    return '#64748b';
  }

  function render(data) {
    var svg = document.getElementById('rotation-svg');
    var cards = document.getElementById('rotation-cards');
    var stamp = document.getElementById('rotationObservedAt');
    if (!svg || !cards) return;
    svg.innerHTML = '';
    cards.innerHTML = '';
    if (stamp && data && data.observedAt) stamp.textContent = 'đo lúc ' + data.observedAt.slice(11, 19);
    var sources = (data && data.sources ? data.sources : []).filter(function (s) { return s.configured; });
    if (!sources.length) return;

    svg.appendChild(el('circle', { cx: CX, cy: CY, r: 50, fill: '#fff7ed', stroke: '#ea4b12', 'stroke-width': 3 }));
    svg.appendChild(el('text', { x: CX, y: CY + 5, 'text-anchor': 'middle', fill: '#7c2d12', 'font-size': 15, 'font-weight': 'bold' }, 'Dispatcher'));

    sources.forEach(function (src, i) {
      var a = (2 * Math.PI * i) / sources.length - Math.PI / 2;
      var nx = CX + R * Math.cos(a), ny = CY + R * Math.sin(a);
      var live = src.status === 'live';
      var down = src.status === 'exhausted' || src.status === 'cooldown';
      var g = el('g', down ? { class: 'rot-dim' } : null);

      var line = el('line', {
        x1: CX + 50 * Math.cos(a), y1: CY + 50 * Math.sin(a),
        x2: nx - 32 * Math.cos(a), y2: ny - 32 * Math.sin(a),
        stroke: live ? '#16a34a' : '#d6cdbb', 'stroke-width': live ? 3 : 2,
      });
      if (live) line.setAttribute('class', 'rot-flow');
      g.appendChild(line);

      if (live && src.activeRun && src.activeRun.modelId) {
        var label = src.activeRun.modelId.split('/').pop();
        if (src.activeRun.tokensSoFar !== 'UNKNOWN') label += ' · ' + num(src.activeRun.tokensSoFar) + ' tk';
        g.appendChild(el('text', {
          x: (CX + nx) / 2, y: (CY + ny) / 2 - 8, 'text-anchor': 'middle',
          fill: '#3f3a33', 'font-size': 12,
        }, label));
      }

      g.appendChild(el('circle', { cx: nx, cy: ny, r: 32, fill: '#fffdf7', stroke: statusColor(src.status), 'stroke-width': 3 }));
      g.appendChild(el('text', { x: nx, y: ny + 4, 'text-anchor': 'middle', fill: '#3f3a33', 'font-size': 12, 'font-weight': 'bold' }, src.id));
      if (down && src.cooldown && src.cooldown.reason) {
        g.appendChild(el('text', { x: nx, y: ny + 48, 'text-anchor': 'middle', fill: '#dc2626', 'font-size': 11 }, src.cooldown.reason.slice(0, 22)));
      }
      svg.appendChild(g);

      var lim = src.limits || {};
      var runs = src.recentRuns || [];
      var counts = { done: 0, failed: 0, 'quota-refused': 0 };
      runs.forEach(function (r) { if (counts[r.outcome] != null) counts[r.outcome]++; });
      var card = document.createElement('div');
      card.className = 'rounded-xl border p-3 text-xs' + (down ? ' opacity-60' : '');
      card.style.borderColor = statusColor(src.status);
      card.innerHTML =
        '<div class="font-bold text-sm mb-1">' + src.label + ' <span class="opacity-60 font-normal">' + src.status + '</span></div>' +
        '<div class="font-mono">đã dùng ' + num(lim.consumption) + ' / ' + num(lim.declaredLimit) + '</div>' +
        '<div class="font-mono">còn lại ' + num(lim.headroom) + '</div>' +
        '<div class="mt-1 opacity-70">' + counts.done + ' xong · ' + counts.failed + ' hỏng · ' + counts['quota-refused'] + ' hết quota</div>';
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
