/* TASK-AI-47 — "Kiến trúc hệ thống": the structure Ship Dễ is built with, drawn.
   Four planes (sự thật → điều phối → tác nhân → cổng chất lượng) plus the feedback
   loop back into the register. Labels are short on purpose; numbers only appear
   where this dashboard already measures them. */
(function () {
  'use strict';

  var C = {
    truth: '#8b5cf6',
    control: '#ea4b12',
    lane: '#0ea5e9',
    gate: '#16a34a',
    ink: '#3f3a33',
    muted: '#5c5349',
    line: '#ded3bd',
    panel: '#fffdf7',
    wash: '#faf6ec',
  };

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function plane(x, y, w, h, title, color) {
    return (
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="14" fill="' + C.wash + '" stroke="' + color + '" stroke-opacity=".35" stroke-dasharray="5 4"/>' +
      '<text x="' + (x + 12) + '" y="' + (y + 18) + '" font-size="11" font-weight="bold" fill="' + color + '">' + esc(title) + '</text>'
    );
  }

  function node(x, y, w, h, label, sub, color, badge) {
    return (
      '<g>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + C.panel + '" stroke="' + color + '" stroke-width="1.6"/>' +
      '<rect x="' + x + '" y="' + y + '" width="4" height="' + h + '" rx="2" fill="' + color + '"/>' +
      '<text x="' + (x + 14) + '" y="' + (y + (sub ? 22 : h / 2 + 4)) + '" font-size="12" font-weight="bold" fill="' + C.ink + '">' + esc(label) + '</text>' +
      (sub ? '<text x="' + (x + 14) + '" y="' + (y + 38) + '" font-size="10" fill="' + C.muted + '">' + esc(sub) + '</text>' : '') +
      (badge ? '<text x="' + (x + w - 12) + '" y="' + (y + 22) + '" font-size="11" font-weight="bold" text-anchor="end" fill="' + color + '">' + esc(badge) + '</text>' : '') +
      '</g>'
    );
  }

  function link(x1, y1, x2, y2, color, dashed) {
    var mx = (x1 + x2) / 2;
    return (
      '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" ' +
      'fill="none" stroke="' + (color || C.line) + '" stroke-width="1.6" ' +
      (dashed ? 'stroke-dasharray="5 4" ' : '') +
      'marker-end="url(#arch-arrow)"/>'
    );
  }

  function render(m) {
    var host = document.getElementById('architecture-diagram');
    if (!host) return;
    var W = 980, H = 520;
    var p = [
      '<defs><marker id="arch-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,0 L9,4.5 L0,9 z" fill="' + C.line + '"/></marker></defs>',
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>',
    ];

    // Planes
    p.push(plane(16, 16, 220, 250, 'Nguồn sự thật', C.truth));
    p.push(plane(268, 16, 200, 250, 'Điều phối', C.control));
    p.push(plane(500, 16, 210, 330, 'Tác nhân', C.lane));
    p.push(plane(742, 16, 222, 330, 'Cổng chất lượng', C.gate));

    // Truth plane
    p.push(node(32, 40, 188, 46, 'REGISTER.csv', 'trạng thái mọi Work Item', C.truth, m.register));
    p.push(node(32, 100, 188, 46, 'work-items/*.md', 'phạm vi · nghiệm thu', C.truth));
    p.push(node(32, 160, 188, 46, 'AGENTS.md', 'một người ghi · không tự duyệt', C.truth));
    p.push(node(32, 214, 188, 40, 'ecosystem-manifest', 'công cụ đã duyệt', C.truth));

    // Control plane
    p.push(node(284, 40, 168, 46, 'dispatch.sh', 'chọn nhánh · đổi model', C.control, m.dispatch));
    p.push(node(284, 100, 168, 46, 'runner.sh', 'quét PR · tự merge', C.control));
    p.push(node(284, 160, 168, 46, 'control.ps1', 'supervisor có sẵn', C.control));
    p.push(node(284, 214, 168, 40, 'ai-brain', 'quota · fitness · ceiling', C.control));

    // Lanes
    var lanes = [
      ['xKiro', m.xkiro],
      ['agy (local)', m['agy-local']],
      ['agy (docker)', m['agy-docker']],
      ['Cline', m.cline],
      ['Codex', m.codex],
      ['AO + 9Router', m['9router']],
    ];
    lanes.forEach(function (l, i) {
      p.push(node(516, 40 + i * 48, 178, 40, l[0], '', C.lane, l[1] || ''));
    });

    // Gates
    p.push(node(758, 40, 190, 46, 'worktree riêng', 'mỗi việc một nhánh', C.gate));
    p.push(node(758, 100, 190, 46, 'Pull Request', 'contract · tests · docs', C.gate, m.pr));
    p.push(node(758, 160, 190, 46, 'Review chéo', 'agent khác tác giả', C.gate, m.review));
    p.push(node(758, 220, 190, 46, 'CI', 'xanh mới được merge', C.gate));
    p.push(node(758, 280, 190, 46, 'main', 'mở khoá việc phụ thuộc', C.gate, m.main));

    // Links between planes
    p.push(link(220, 63, 284, 63, C.truth));
    p.push(link(220, 123, 284, 123, C.truth));
    p.push(link(452, 63, 516, 100, C.control));
    p.push(link(452, 123, 516, 180, C.control));
    p.push(link(694, 120, 758, 63, C.lane));
    p.push(link(948, 123, 960, 160, C.gate));

    // Feedback loop: merged work returns to the register, and the dashboard reads both.
    p.push(
      '<path d="M853,332 C853,404 420,404 126,404 L126,272" fill="none" stroke="' + C.truth +
      '" stroke-width="1.6" stroke-dasharray="6 5" marker-end="url(#arch-arrow)"/>' +
      '<rect x="360" y="390" width="262" height="18" rx="6" fill="' + C.wash + '"/>' +
      '<text x="491" y="403" font-size="11" text-anchor="middle" fill="' + C.muted + '">merge → register → mở khoá việc kế tiếp</text>'
    );

    p.push(node(390, 452, 210, 42, 'Dashboard', 'register · log · quota', C.control));
    p.push('<path d="M300,254 C300,468 360,473 390,473" fill="none" stroke="' + C.line + '" stroke-width="1.4" stroke-dasharray="4 4"/>');
    p.push('<path d="M600,473 C700,473 880,470 880,348" fill="none" stroke="' + C.line + '" stroke-width="1.4" stroke-dasharray="4 4"/>');

    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full">' + p.join('') + '</svg>';
  }

  function load() {
    Promise.all([
      fetch('/api/state').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/rotation').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (res) {
      var state = res[0], rot = res[1], m = {};
      if (state && state.workItems) {
        m.register = state.workItems.total;
        m.main = state.workItems.mergedCount + ' merged';
        var byStatus = state.workItems.byStatus || {};
        if (byStatus.READY_FOR_CODEX) m.review = byStatus.READY_FOR_CODEX + ' chờ';
      }
      if (rot) {
        if (rot.totals) m.dispatch = rot.totals.attempts + ' lượt';
        (rot.sources || []).forEach(function (s) {
          m[s.id] = s.status === 'live' ? '● chạy' : s.status === 'exhausted' || s.status === 'cooldown' ? '○ hết' : '';
        });
      }
      render(m);
    });
  }

  load();
  setInterval(load, 15000);
})();
