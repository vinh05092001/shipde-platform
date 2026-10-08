/* TASK-AI-47 — executive band at the top of the cockpit.
   Four pictures that answer, without reading: how far the delivery is, where the
   open PRs are stuck, which sources still have capacity, and what is running now.
   Every figure is read from /api/state and /api/rotation; a figure that cannot be
   measured is left out rather than guessed. */
(function () {
  'use strict';

  var C = {
    done: '#16a34a',
    review: '#0ea5e9',
    fix: '#b45309',
    blocked: '#dc2626',
    idle: '#c7bda8',
    ink: '#3f3a33',
    muted: '#5c5349',
  };

  function card(title, body, foot) {
    return (
      '<div class="card bg-base-100 border border-base-300"><div class="card-body p-3 gap-2">' +
      '<div class="text-[10px] font-bold uppercase tracking-wide opacity-70">' +
      title +
      '</div>' +
      body +
      (foot ? '<div class="text-[11px] opacity-70">' + foot + '</div>' : '') +
      '</div></div>'
    );
  }

  function ring(pct, label, sub, color) {
    var R = 34,
      CIRC = 2 * Math.PI * R;
    return (
      '<div class="flex items-center gap-3">' +
      '<svg viewBox="0 0 84 84" class="w-20 h-20 shrink-0">' +
      '<circle cx="42" cy="42" r="' +
      R +
      '" fill="none" stroke="#ece3d2" stroke-width="10"/>' +
      '<circle cx="42" cy="42" r="' +
      R +
      '" fill="none" stroke="' +
      color +
      '" stroke-width="10"' +
      ' stroke-linecap="round" stroke-dasharray="' +
      (pct / 100) * CIRC +
      ' ' +
      CIRC +
      '" transform="rotate(-90 42 42)"/>' +
      '<text x="42" y="47" text-anchor="middle" font-size="17" font-weight="bold" fill="' +
      C.ink +
      '">' +
      pct +
      '%</text>' +
      '</svg>' +
      '<div><div class="text-lg font-bold leading-tight">' +
      label +
      '</div>' +
      '<div class="text-[11px] opacity-70">' +
      sub +
      '</div></div></div>'
    );
  }

  function stack(segments, total) {
    var bars = segments
      .filter(function (s) {
        return s.n > 0;
      })
      .map(function (s) {
        return (
          '<div title="' +
          s.label +
          ': ' +
          s.n +
          '" style="width:' +
          (s.n / total) * 100 +
          '%;background:' +
          s.color +
          '"></div>'
        );
      })
      .join('');
    var legend = segments
      .filter(function (s) {
        return s.n > 0;
      })
      .map(function (s) {
        return (
          '<span class="inline-flex items-center gap-1 mr-3">' +
          '<span style="width:8px;height:8px;border-radius:2px;background:' +
          s.color +
          ';display:inline-block"></span>' +
          s.label +
          ' <b>' +
          s.n +
          '</b></span>'
        );
      })
      .join('');
    return (
      '<div class="flex h-3 rounded-full overflow-hidden border border-base-300">' +
      bars +
      '</div>' +
      '<div class="text-[11px] mt-1 opacity-80">' +
      legend +
      '</div>'
    );
  }

  function render(state, rot) {
    var host = document.getElementById('exec-summary');
    if (!host || !state || !state.workItems) return;
    var w = state.workItems;
    var byStatus = w.byStatus || {};
    var pct = Math.round((w.mergedCount / w.total) * 100);

    // 1. delivery
    var delivery = card(
      'Tiến độ giao việc',
      ring(pct, w.mergedCount + '/' + w.total, 'Work Item đã merge', C.done)
    );

    // 2. open PRs by where they are stuck — measured from the register's own statuses
    var prSeg = [
      { label: 'chờ review', n: byStatus.READY_FOR_CODEX || 0, color: C.review },
      { label: 'cần sửa', n: byStatus.CHANGES_REQUIRED || 0, color: C.fix },
      { label: 'đang làm', n: byStatus.IN_PROGRESS || 0, color: '#8b5cf6' },
      {
        label: 'bị chặn',
        n: (byStatus.BLOCKED_DEPENDENCY || 0) + (byStatus.BLOCKED_BY_FOUNDATION || 0),
        color: C.blocked,
      },
      { label: 'chưa bắt đầu', n: byStatus.BACKLOG || 0, color: C.idle },
    ];
    var openTotal =
      prSeg.reduce(function (a, s) {
        return a + s.n;
      }, 0) || 1;
    var pipeline = card('Việc chưa xong đang nằm ở đâu', stack(prSeg, openTotal));

    // 3. capacity of the lanes
    var sources = (rot && rot.sources) || [];
    var out = sources.filter(function (s) {
      return s.status === 'quota-exhausted' || s.status === 'cooldown';
    }).length;
    var capSeg = [
      { label: 'còn dùng được', n: sources.length - out, color: C.done },
      { label: 'hết hạn mức', n: out, color: C.blocked },
    ];
    var capacity = card(
      'Nguồn model',
      sources.length
        ? stack(capSeg, sources.length || 1)
        : '<div class="opacity-60 text-[11px]">UNKNOWN</div>',
      sources
        .filter(function (s) {
          return s.status === 'quota-exhausted';
        })
        .map(function (s) {
          return s.label;
        })
        .join(', ') || ''
    );

    // 4. what is running right now
    var live = sources.filter(function (s) {
      return s.status === 'live';
    });
    var running = card(
      'Đang chạy',
      '<div class="text-3xl font-bold" style="color:' +
        (live.length ? C.done : C.muted) +
        '">' +
        live.length +
        '</div>' +
        '<div class="text-[11px] opacity-70">' +
        (live.length
          ? live
              .map(function (s) {
                return s.label + ' · ' + (s.activeRun.modelId || '').split('/').pop();
              })
              .join('<br>')
          : 'không có lượt nào') +
        '</div>',
      rot && rot.totals
        ? rot.totals.attempts + ' lượt · ' + rot.totals.quotaRefused + ' bị từ chối quota'
        : ''
    );

    host.innerHTML =
      '<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">' +
      delivery +
      pipeline +
      capacity +
      running +
      '</div>';
  }

  function load() {
    Promise.all([
      fetch('/api/state')
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
      fetch('/api/rotation')
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
    ]).then(function (res) {
      render(res[0], res[1]);
    });
  }

  load();
  setInterval(load, 15000);
})();
