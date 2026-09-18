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
      '<text x="' + (x + 14) + '" y="' + (y + 22) + '" font-size="14" font-weight="bold" fill="' + color + '">' + esc(title) + '</text>'
    );
  }

  function node(x, y, w, h, label, sub, color, badge) {
    var hasSub = sub && sub.trim().toLowerCase() !== label.trim().toLowerCase() && sub.trim().length > 0;
    return (
      '<g>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + C.panel + '" stroke="' + color + '" stroke-width="1.6"/>' +
      '<rect x="' + x + '" y="' + y + '" width="5" height="' + h + '" rx="2" fill="' + color + '"/>' +
      '<text x="' + (x + 16) + '" y="' + (y + (hasSub ? 22 : Math.round(h / 2) + 5)) + '" font-size="13" font-weight="bold" fill="' + C.ink + '">' + esc(label) + '</text>' +
      (hasSub ? '<text x="' + (x + 16) + '" y="' + (y + 38) + '" font-size="11" fill="' + C.muted + '">' + esc(sub) + '</text>' : '') +
      (badge ? '<text x="' + (x + w - 12) + '" y="' + (y + (hasSub ? 22 : Math.round(h / 2) + 5)) + '" font-size="11" font-weight="bold" text-anchor="end" fill="' + color + '">' + esc(badge) + '</text>' : '') +
      '</g>'
    );
  }

  function link(x1, y1, x2, y2, color, dashed) {
    var mx = (x1 + x2) / 2;
    var markerId = color === C.truth ? 'arch-arrow-truth' :
                   color === C.control ? 'arch-arrow-control' :
                   color === C.lane ? 'arch-arrow-lane' :
                   color === C.gate ? 'arch-arrow-gate' : 'arch-arrow';
    return (
      '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" ' +
      'fill="none" stroke="' + (color || C.line) + '" stroke-width="1.6" ' +
      (dashed ? 'stroke-dasharray="5 4" ' : '') +
      'marker-end="url(#' + markerId + ')"/>'
    );
  }

  function render(m) {
    var host = document.getElementById('architecture-diagram');
    if (!host) return;
    var W = 1200, H = 560;
    var p = [
      '<defs>' +
      '<marker id="arch-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,1 L7,4.5 L0,8 z" fill="' + C.line + '"/></marker>' +
      '<marker id="arch-arrow-truth" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,1 L7,4.5 L0,8 z" fill="' + C.truth + '"/></marker>' +
      '<marker id="arch-arrow-control" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,1 L7,4.5 L0,8 z" fill="' + C.control + '"/></marker>' +
      '<marker id="arch-arrow-lane" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,1 L7,4.5 L0,8 z" fill="' + C.lane + '"/></marker>' +
      '<marker id="arch-arrow-gate" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,1 L7,4.5 L0,8 z" fill="' + C.gate + '"/></marker>' +
      '</defs>',
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>',
    ];

    // Four planes: equal width columns across full 1200 width
    p.push(plane(20, 16, 275, 390, '1. Nguồn sự thật', C.truth));
    p.push(plane(315, 16, 275, 390, '2. Điều phối', C.control));
    p.push(plane(610, 16, 275, 390, '3. Tác nhân', C.lane));
    p.push(plane(905, 16, 275, 390, '4. Cổng chất lượng', C.gate));

    // Plane 0: Truth plane
    p.push(node(32, 50, 251, 50, 'REGISTER.csv', 'trạng thái mọi Work Item', C.truth, m.register));
    p.push(node(32, 124, 251, 50, 'work-items/*.md', 'phạm vi · nghiệm thu', C.truth));
    p.push(node(32, 198, 251, 50, 'AGENTS.md', 'vai trò · không tự duyệt', C.truth));
    p.push(node(32, 272, 251, 50, 'ecosystem-manifest', 'công cụ đã duyệt', C.truth));

    // Plane 1: Control plane
    p.push(node(327, 50, 251, 50, 'dispatch.sh', 'chọn nhánh · đổi model', C.control, m.dispatch));
    p.push(node(327, 124, 251, 50, 'runner.sh', 'quét PR · tự động merge', C.control));
    p.push(node(327, 198, 251, 50, 'control.ps1', 'giám sát thực thi', C.control));
    p.push(node(327, 272, 251, 50, 'ai-brain', 'hạn mức · độ phù hợp · trần', C.control));

    // Plane 2: Lanes (Agents)
    var lanes = [
      ['xKiro', m.xkiro],
      ['agy (local)', m['agy-local']],
      ['agy (docker)', m['agy-docker']],
      ['Cline', m.cline],
      ['Codex', m.codex],
      ['AO + 9Router', m['9router']],
    ];
    lanes.forEach(function (l, i) {
      p.push(node(622, 50 + i * 54, 251, 44, l[0], '', C.lane, l[1] || ''));
    });

    // Plane 3: Quality Gates
    p.push(node(917, 50, 251, 46, 'worktree riêng', 'mỗi việc một nhánh', C.gate));
    p.push(node(917, 114, 251, 46, 'Pull Request', 'hợp đồng · kiểm thử · tài liệu', C.gate, m.pr));
    p.push(node(917, 178, 251, 46, 'Thẩm định độc lập', 'tác nhân khác tác giả', C.gate, m.review));
    p.push(node(917, 242, 251, 46, 'CI', 'kiểm thử tự động thành công', C.gate));
    p.push(node(917, 306, 251, 46, 'main', 'mở khoá việc phụ thuộc', C.gate, m.main));

    // Flow links left to right: Truth -> Control
    p.push(link(283, 75, 327, 75, C.truth));
    p.push(link(283, 149, 327, 149, C.truth));
    p.push(link(283, 223, 327, 223, C.truth));
    p.push(link(283, 297, 327, 297, C.truth));

    // Control -> Lanes
    p.push(link(578, 75, 622, 72, C.control));
    p.push(link(578, 75, 622, 126, C.control));
    p.push(link(578, 149, 622, 180, C.control));
    p.push(link(578, 223, 622, 234, C.control));
    p.push(link(578, 223, 622, 288, C.control));
    p.push(link(578, 297, 622, 342, C.control));

    // Lanes -> Gates
    p.push(link(873, 72, 917, 73, C.lane));
    p.push(link(873, 180, 917, 137, C.lane));
    p.push(link(873, 260, 917, 201, C.lane));
    p.push(link(873, 342, 917, 201, C.lane));

    // Within Quality Gates: top-to-bottom pipeline
    p.push(link(1042, 96, 1042, 114, C.gate));
    p.push(link(1042, 160, 1042, 178, C.gate));
    p.push(link(1042, 224, 1042, 242, C.gate));
    p.push(link(1042, 288, 1042, 306, C.gate));

    // Feedback loop: one dashed feedback arrow back to the register
    p.push(
      '<path d="M1042,352 C1042,438 600,438 157,438 L157,100" fill="none" stroke="' + C.truth +
      '" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#arch-arrow-truth)"/>' +
      '<rect x="380" y="426" width="440" height="24" rx="6" fill="' + C.wash + '" stroke="' + C.truth + '" stroke-opacity=".35"/>' +
      '<text x="600" y="442" font-size="12" font-weight="bold" text-anchor="middle" fill="' + C.truth + '">Gộp vào main ➔ Cập nhật REGISTER.csv ➔ Mở khoá việc kế tiếp</text>'
    );

    // Dashboard node and observation links
    p.push(node(460, 486, 280, 48, 'Bảng điều khiển', 'quan sát register · nhật ký · hạn mức', C.control));
    p.push('<path d="M283,75 C360,75 360,510 460,510" fill="none" stroke="' + C.line + '" stroke-width="1.4" stroke-dasharray="4 4"/>');
    p.push('<path d="M740,510 C840,510 840,201 917,201" fill="none" stroke="' + C.line + '" stroke-width="1.4" stroke-dasharray="4 4"/>');

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
        m.main = state.workItems.mergedCount + ' đã gộp';
        var byStatus = state.workItems.byStatus || {};
        if (byStatus.READY_FOR_CODEX) m.review = byStatus.READY_FOR_CODEX + ' chờ';
      }
      if (rot) {
        if (rot.totals) m.dispatch = rot.totals.attempts + ' lượt';
        (rot.sources || []).forEach(function (s) {
          m[s.id] = s.status === 'live' ? '● đang chạy' : (s.status === 'exhausted' || s.status === 'quota-exhausted' || s.status === 'cooldown') ? '○ hết hạn mức' : '';
        });
      }
      render(m);
    });
  }

  load();
  setInterval(load, 15000);
})();
