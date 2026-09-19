/* TASK-AI-47 — diagrams for the "Phiên làm việc" tab.
   Two pictures the table could not give: how sessions split by state, and which
   branch each live session holds (the writer-claim map AGENTS.md cares about).
   Everything is counted from /api/state; nothing is assumed. */
(function () {
  'use strict';

  var STATE_COLOR = {
    ACTIVE: '#16a34a',
    IDLE: '#0ea5e9',
    MERGED: '#8b5cf6',
    EXITED: '#a8a29e',
    TERMINATED: '#78716c',
    UNKNOWN: '#d6cdbb',
  };

  function color(s) {
    return STATE_COLOR[String(s || '').toUpperCase()] || STATE_COLOR.UNKNOWN;
  }

  function donut(counts, total) {
    var R = 54,
      C = 2 * Math.PI * R,
      off = 0;
    var rings = Object.keys(counts)
      .map(function (k) {
        var frac = counts[k] / total;
        var seg =
          '<circle cx="70" cy="70" r="' +
          R +
          '" fill="none" stroke="' +
          color(k) +
          '" stroke-width="18"' +
          ' stroke-dasharray="' +
          frac * C +
          ' ' +
          C +
          '" stroke-dashoffset="' +
          -off * C +
          '" transform="rotate(-90 70 70)"/>';
        off += frac;
        return seg;
      })
      .join('');
    return (
      '<svg viewBox="0 0 140 140" class="w-36 h-36">' +
      rings +
      '<text x="70" y="66" text-anchor="middle" font-size="22" font-weight="bold" fill="#3f3a33">' +
      total +
      '</text>' +
      '<text x="70" y="84" text-anchor="middle" font-size="10" fill="#6b6257">phiên</text></svg>'
    );
  }

  function legend(counts) {
    return Object.keys(counts)
      .map(function (k) {
        return (
          '<div class="flex items-center gap-2 text-[11px]">' +
          '<span style="width:9px;height:9px;border-radius:3px;background:' +
          color(k) +
          ';display:inline-block"></span>' +
          '<span class="font-bold">' +
          k +
          '</span><span class="opacity-60">' +
          counts[k] +
          '</span></div>'
        );
      })
      .join('');
  }

  function claimMap(sessions) {
    // One row per branch that a session holds, so a double claim is visible as two
    // chips on the same row rather than as two rows far apart in a table.
    var byBranch = {};
    sessions.forEach(function (s) {
      var b = s.branch || s.worktree || '(không rõ nhánh)';
      (byBranch[b] = byBranch[b] || []).push(s);
    });
    var rows = Object.keys(byBranch)
      .sort()
      .map(function (b) {
        var chips = byBranch[b]
          .map(function (s) {
            var writer = s.isWriter === true;
            return (
              '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold" style="color:' +
              color(s.status || s.state) +
              ';background:' +
              color(s.status || s.state) +
              '1a;border:1px solid ' +
              color(s.status || s.state) +
              '55">' +
              (s.id || s.sessionId || '?').replace('shipde-platform-', '#') +
              (writer ? ' ✍' : '') +
              '</span>'
            );
          })
          .join(' ');
        // Two writers on one branch is the thing AGENTS.md forbids; mark it in place.
        var dup =
          byBranch[b].filter(function (s) {
            return s.isWriter === true && !s.isTerminated;
          }).length > 1;
        return (
          '<div class="flex items-center gap-2 py-1 border-b border-base-300 last:border-0">' +
          '<span class="font-mono text-[11px] truncate flex-1' +
          (dup ? ' text-error font-bold' : '') +
          '">' +
          b +
          '</span>' +
          '<span class="flex flex-wrap gap-1 justify-end">' +
          chips +
          '</span></div>'
        );
      })
      .join('');
    return rows || '<div class="opacity-60 text-[11px]">chưa có phiên nào</div>';
  }

  function render(state) {
    var host = document.getElementById('roster-visual');
    if (!host) return;
    var sessions = (state && state.sessions) || [];
    if (!sessions.length) {
      host.innerHTML = '';
      return;
    }

    var counts = {};
    sessions.forEach(function (s) {
      var k = String(s.status || s.state || 'UNKNOWN').toUpperCase();
      counts[k] = (counts[k] || 0) + 1;
    });

    host.innerHTML =
      '<div class="card bg-base-100 border border-base-300"><div class="card-body p-4 gap-4">' +
      '<div class="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)] items-start">' +
      '<div class="flex items-center gap-3">' +
      donut(counts, sessions.length) +
      '<div class="space-y-1">' +
      legend(counts) +
      '</div></div>' +
      '<div>' +
      '<div class="text-[11px] font-bold uppercase tracking-wide opacity-70 mb-1">Nhánh đang bị giữ (✍ = quyền ghi)</div>' +
      '<div class="max-h-56 overflow-auto pr-1">' +
      claimMap(sessions) +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div></div>';
  }

  function load() {
    fetch('/api/state')
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (s) {
        if (s) render(s);
      })
      .catch(function () {
        /* keep the last drawing */
      });
  }

  load();
  setInterval(load, 15000);
})();
