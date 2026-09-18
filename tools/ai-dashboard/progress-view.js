/* TASK-AI-47 — visual summary at the top of "Tiến độ & Nhật ký".
   Replaces the paragraphs the gates tab used to carry: a status bar for the whole
   register, per-slice progress, and the gate pipeline as a row of steps. Every
   number comes from /api/state; nothing is filled in when a field is missing. */
(function () {
  'use strict';

  var STATUS = [
    ['MERGED', '#16a34a', 'đã merge'],
    ['CODEX_PASS', '#0d9488', 'Codex PASS'],
    ['READY_FOR_CODEX', '#0ea5e9', 'chờ review'],
    ['CHANGES_REQUIRED', '#b45309', 'cần sửa'],
    ['IN_PROGRESS', '#8b5cf6', 'đang làm'],
    ['READY_FOR_AUTHOR', '#6366f1', 'chờ tác giả'],
    ['BLOCKED_DEPENDENCY', '#dc2626', 'bị chặn'],
    ['BLOCKED_BY_FOUNDATION', '#be123c', 'chờ nền móng'],
    ['BACKLOG', '#a8a29e', 'chưa bắt đầu'],
    ['SUPERSEDED', '#78716c', 'bị thay thế'],
  ];

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function statusBar(byStatus, total) {
    var segs = STATUS.filter(function (s) { return byStatus[s[0]]; }).map(function (s) {
      var pct = (byStatus[s[0]] / total) * 100;
      return '<div title="' + s[2] + ': ' + byStatus[s[0]] + '" style="width:' + pct + '%;background:' + s[1] + '"></div>';
    }).join('');
    var legend = STATUS.filter(function (s) { return byStatus[s[0]]; }).map(function (s) {
      return '<span class="inline-flex items-center gap-1">' +
        '<span style="width:8px;height:8px;border-radius:2px;background:' + s[1] + ';display:inline-block"></span>' +
        s[2] + ' <b>' + byStatus[s[0]] + '</b></span>';
    }).join('');
    return '<div class="flex h-3 rounded-full overflow-hidden border border-base-300">' + segs + '</div>' +
      '<div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mt-2 opacity-80">' + legend + '</div>';
  }

  function mergedPerSlice(items) {
    // Counted from the register rows the API already ships, so the bar is measured
    // rather than assumed.
    var out = {};
    (items || []).forEach(function (it) {
      if (it && it.status === 'MERGED' && it.slice) out[it.slice] = (out[it.slice] || 0) + 1;
    });
    return out;
  }

  function sliceBars(bySlice, byStatusPerSlice) {
    var keys = Object.keys(bySlice).sort();
    return keys.map(function (k) {
      var total = bySlice[k];
      var done = (byStatusPerSlice && byStatusPerSlice[k]) || 0;
      var pct = total ? Math.round((done / total) * 100) : 0;
      return '<div class="flex items-center gap-2 text-[11px]">' +
        '<span class="font-mono w-8">' + k + '</span>' +
        '<div class="flex-1 h-2 rounded-full" style="background:#ece3d2">' +
        '<div class="h-2 rounded-full" style="width:' + pct + '%;background:#16a34a"></div></div>' +
        '<span class="w-16 text-right opacity-70">' + done + '/' + total + '</span>' +
        '</div>';
    }).join('');
  }

  function timeline(activity) {
    // Activity as a strip of hours instead of a wall of lines: each bar is one hour,
    // height is the number of events, colour tells git commits from AO events apart.
    var items = Array.isArray(activity) ? activity : Object.keys(activity || {}).map(function (k) { return activity[k]; });
    if (!items.length) return '';
    var buckets = {};
    items.forEach(function (it) {
      var t = new Date(it.timestamp || it.at || 0);
      if (isNaN(t)) return;
      var key = t.toISOString().slice(0, 13);
      var b = (buckets[key] = buckets[key] || { git: 0, ao: 0 });
      if (String(it.type || '').indexOf('GIT') === 0) b.git++; else b.ao++;
    });
    var keys = Object.keys(buckets).sort().slice(-24);
    if (!keys.length) return '';
    var max = keys.reduce(function (m, k) { return Math.max(m, buckets[k].git + buckets[k].ao); }, 1);
    var bars = keys.map(function (k) {
      var b = buckets[k];
      var hg = Math.round((b.git / max) * 46), ha = Math.round((b.ao / max) * 46);
      return '<div class="flex flex-col justify-end items-center gap-0.5" style="width:14px" title="' + k.replace('T', ' ') + 'h · git ' + b.git + ' · AO ' + b.ao + '">' +
        (ha ? '<div style="height:' + ha + 'px;width:10px;background:#8b5cf6;border-radius:2px"></div>' : '') +
        (hg ? '<div style="height:' + hg + 'px;width:10px;background:#16a34a;border-radius:2px"></div>' : '') +
        '<span class="text-[9px] opacity-60">' + k.slice(11) + '</span></div>';
    }).join('');
    return '<div><div class="text-[11px] font-bold uppercase tracking-wide opacity-70 mb-1">Hoạt động theo giờ ' +
      '<span class="font-normal normal-case"><span style="color:#16a34a">▮</span> commit · <span style="color:#8b5cf6">▮</span> AO</span></div>' +
      '<div class="flex items-end gap-1 h-16">' + bars + '</div></div>';
  }

  function render(state) {
    var host = document.getElementById('progress-visual');
    if (!host || !state || !state.workItems) return;
    var w = state.workItems;
    var byStatus = w.byStatus || {};
    var bySlice = w.bySlice || {};

    host.innerHTML = '';
    var card = el('div', 'card bg-base-100 border border-base-300');
    var body = el('div', 'card-body p-4 gap-4');

    body.appendChild(el('div', '', '<div class="flex items-baseline justify-between">' +
      '<h3 class="card-title text-sm">Tiến độ ' + w.total + ' đầu việc</h3>' +
      '<span class="text-xs opacity-70">' + w.mergedCount + ' đã merge · ' + w.completionPercent + '%</span></div>' +
      statusBar(byStatus, w.total)));

    body.appendChild(el('div', '', '<div class="text-[11px] font-bold uppercase tracking-wide opacity-60 mb-2">Theo slice</div>' +
      '<div class="grid gap-1.5 sm:grid-cols-2">' + sliceBars(bySlice, mergedPerSlice(w.items)) + '</div>'));

    var tl = timeline(state.activity);
    if (tl) body.appendChild(el('div', '', tl));

    card.appendChild(body);
    host.appendChild(card);
  }

  function load() {
    fetch('/api/state')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { if (s) render(s); })
      .catch(function () { /* the panel keeps whatever it last drew */ });
  }

  load();
  setInterval(load, 15000);
})();
