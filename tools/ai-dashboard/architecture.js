/* TASK-AI-47 — "Kiến trúc hệ thống" tab.
   Draws the delivery pipeline Ship Dễ is actually built with, and labels each box
   with a measured count where the dashboard already has one. Nothing is invented:
   a box with nothing measured shows no number. */
(function () {
  'use strict';

  var LANES = [
    { id: 'register', label: 'FEATURE-DELIVERY-REGISTER.csv', note: 'nguồn sự thật của mọi Work Item' },
    { id: 'spec', label: 'work-items/TASK-*.md', note: 'spec: phạm vi, allowed paths, nghiệm thu' },
    { id: 'dispatch', label: 'dispatch.sh', note: 'chọn nhánh, tự đổi model khi hết quota' },
    { id: 'agents', label: 'xKiro · agy · Cline · Codex · AO', note: 'mỗi việc một worktree riêng' },
    { id: 'pr', label: 'Pull Request + CI', note: 'contract gate, tests, validate_docs' },
    { id: 'review', label: 'Review chéo', note: 'agent khác tác giả, verdict PASS / CHANGES_REQUIRED' },
    { id: 'runner', label: 'runner.sh', note: 'merge khi PASS mới hơn commit và CI xanh' },
    { id: 'main', label: 'main', note: 'mở khoá các Work Item phụ thuộc' },
  ];

  function box(x, y, w, h, lane, badge) {
    return (
      '<g>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12" fill="var(--color-base-100)" stroke="var(--color-base-300)" stroke-width="1.5"/>' +
      '<rect x="' + x + '" y="' + y + '" width="5" height="' + h + '" rx="2" fill="var(--color-primary)"/>' +
      '<text x="' + (x + 18) + '" y="' + (y + 26) + '" font-size="13" font-weight="bold" fill="var(--color-base-content)">' + lane.label + '</text>' +
      '<text x="' + (x + 18) + '" y="' + (y + 46) + '" font-size="11" fill="#857b6e">' + lane.note + '</text>' +
      (badge
        ? '<text x="' + (x + w - 16) + '" y="' + (y + 26) + '" font-size="12" font-weight="bold" text-anchor="end" fill="var(--color-primary)">' + badge + '</text>'
        : '') +
      '</g>'
    );
  }

  function arrow(x, y1, y2) {
    return '<path d="M' + x + ',' + y1 + ' L' + x + ',' + y2 + '" stroke="var(--color-base-300)" stroke-width="2" marker-end="url(#arrowhead)"/>';
  }

  function render(counts) {
    var host = document.getElementById('architecture-diagram');
    if (!host) return;
    var W = 620, BH = 62, GAP = 28, X = 40, BW = 540;
    var parts = [
      '<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">' +
      '<path d="M0,0 L8,4 L0,8 z" fill="var(--color-base-300)"/></marker></defs>',
    ];
    LANES.forEach(function (lane, i) {
      var y = 20 + i * (BH + GAP);
      parts.push(box(X, y, BW, BH, lane, counts[lane.id] || ''));
      if (i < LANES.length - 1) parts.push(arrow(X + BW / 2, y + BH + 4, y + BH + GAP - 4));
    });
    var H = 20 + LANES.length * (BH + GAP);
    host.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full max-w-2xl mx-auto">' + parts.join('') + '</svg>';
  }

  function load() {
    var counts = {};
    Promise.all([
      fetch('/api/state').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/rotation').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (res) {
      var state = res[0], rot = res[1];
      if (state && state.workItems) {
        counts.register = state.workItems.total + ' Work Item';
        counts.main = state.workItems.mergedCount + ' đã merge';
        var pr = state.workItems.byStatus && state.workItems.byStatus.READY_FOR_CODEX;
        if (pr) counts.pr = pr + ' chờ review';
      }
      if (rot && rot.totals) {
        counts.dispatch = rot.totals.attempts + ' lượt chạy';
        counts.agents = rot.totals.live + ' đang chạy';
      }
      render(counts);
    });
  }

  load();
  setInterval(load, 15000);
})();
