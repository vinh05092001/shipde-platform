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
    var hasSub = Boolean(sub && sub.trim() !== '' && sub.trim().toLowerCase() !== label.trim().toLowerCase());
    return (
      '<g>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + C.panel + '" stroke="' + color + '" stroke-width="1.6"/>' +
      '<rect x="' + x + '" y="' + y + '" width="4" height="' + h + '" rx="2" fill="' + color + '"/>' +
      '<text x="' + (x + 14) + '" y="' + (y + (hasSub ? 21 : Math.round(h / 2) + 5)) + '" font-size="13" font-weight="bold" fill="' + C.ink + '">' + esc(label) + '</text>' +
      (hasSub ? '<text x="' + (x + 14) + '" y="' + (y + 37) + '" font-size="11" fill="' + C.muted + '">' + esc(sub) + '</text>' : '') +
      (badge ? '<text x="' + (x + w - 12) + '" y="' + (y + (hasSub ? 21 : Math.round(h / 2) + 5)) + '" font-size="11" font-weight="bold" text-anchor="end" fill="' + color + '">' + esc(badge) + '</text>' : '') +
      '</g>'
    );
  }

  function link(x1, y1, x2, y2, color, dashed) {
    var mx = (x1 + x2) / 2;
    var markerId = color === C.truth ? 'arch-arrow-truth' : color === C.control ? 'arch-arrow-control' : color === C.lane ? 'arch-arrow-lane' : color === C.gate ? 'arch-arrow-gate' : 'arch-arrow';
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
      '<path d="M0,0.5 L8,4.5 L0,8.5 z" fill="' + C.line + '"/></marker>' +
      '<marker id="arch-arrow-truth" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,0.5 L8,4.5 L0,8.5 z" fill="' + C.truth + '"/></marker>' +
      '<marker id="arch-arrow-control" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,0.5 L8,4.5 L0,8.5 z" fill="' + C.control + '"/></marker>' +
      '<marker id="arch-arrow-lane" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,0.5 L8,4.5 L0,8.5 z" fill="' + C.lane + '"/></marker>' +
      '<marker id="arch-arrow-gate" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">' +
      '<path d="M0,0.5 L8,4.5 L0,8.5 z" fill="' + C.gate + '"/></marker>' +
      '</defs>',
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>',
    ];

    // Four equal-width planes across the full width (16 to 1184 within 1200px)
    p.push(plane(16, 16, 280, 385, 'Nguồn sự thật', C.truth));
    p.push(plane(312, 16, 280, 385, 'Điều phối', C.control));
    p.push(plane(608, 16, 280, 385, 'Tác nhân', C.lane));
    p.push(plane(904, 16, 280, 385, 'Cổng chất lượng', C.gate));

    // Plane 0: Nguồn sự thật
    p.push(node(31, 46, 250, 48, 'REGISTER.csv', 'trạng thái mọi việc', C.truth, m.register));
    p.push(node(31, 110, 250, 48, 'work-items/*.md', 'phạm vi · nghiệm thu', C.truth));
    p.push(node(31, 174, 250, 48, 'AGENTS.md', 'một người ghi · không tự duyệt', C.truth));
    p.push(node(31, 238, 250, 48, 'ecosystem-manifest', 'công cụ đã duyệt', C.truth));

    // Plane 1: Điều phối
    p.push(node(327, 46, 250, 48, 'dispatch.sh', 'chọn nhánh · đổi model', C.control, m.dispatch));
    p.push(node(327, 110, 250, 48, 'runner.sh', 'quét PR · tự gộp', C.control));
    p.push(node(327, 174, 250, 48, 'control.ps1', 'giám sát tiến trình', C.control));
    p.push(node(327, 238, 250, 48, 'ai-brain', 'hạn mức · độ phù hợp · trần', C.control));

    // Plane 2: Tác nhân
    var lanes = [
      ['xKiro', m.xkiro],
      ['agy (nội bộ)', m['agy-local']],
      ['agy (docker)', m['agy-docker']],
      ['Cline', m.cline],
      ['Codex', m.codex],
      ['AO + 9Router', m['9router']],
    ];
    lanes.forEach(function (l, i) {
      p.push(node(623, 46 + i * 54, 250, 42, l[0], '', C.lane, l[1] || ''));
    });

    // Plane 3: Cổng chất lượng
    p.push(node(919, 46, 250, 46, 'worktree riêng', 'mỗi việc một nhánh', C.gate));
    p.push(node(919, 108, 250, 46, 'Pull Request', 'hợp đồng · kiểm thử · tài liệu', C.gate, m.pr));
    p.push(node(919, 170, 250, 46, 'Review chéo', 'tác nhân khác tác giả', C.gate, m.review));
    p.push(node(919, 232, 250, 46, 'CI', 'kiểm tra tự động đạt', C.gate));
    p.push(node(919, 294, 250, 46, 'main', 'mở khoá việc phụ thuộc', C.gate, m.main));

    // Flow left to right between planes
    p.push(link(281, 70, 327, 70, C.truth));
    p.push(link(281, 134, 327, 134, C.truth));
    p.push(link(281, 198, 327, 262, C.truth));

    p.push(link(577, 70, 623, 67, C.control));
    p.push(link(577, 70, 623, 121, C.control));
    p.push(link(577, 70, 623, 175, C.control));
    p.push(link(577, 134, 623, 229, C.control));
    p.push(link(577, 134, 623, 283, C.control));
    p.push(link(577, 262, 623, 337, C.control));

    p.push(link(873, 121, 919, 69, C.lane));
    p.push(link(873, 229, 919, 131, C.lane));

    // Step-by-step gate pipeline progression
    p.push('<path d="M1044,92 L1044,106" fill="none" stroke="' + C.gate + '" stroke-width="1.6" marker-end="url(#arch-arrow-gate)"/>');
    p.push('<path d="M1044,154 L1044,168" fill="none" stroke="' + C.gate + '" stroke-width="1.6" marker-end="url(#arch-arrow-gate)"/>');
    p.push('<path d="M1044,216 L1044,230" fill="none" stroke="' + C.gate + '" stroke-width="1.6" marker-end="url(#arch-arrow-gate)"/>');
    p.push('<path d="M1044,278 L1044,292" fill="none" stroke="' + C.gate + '" stroke-width="1.6" marker-end="url(#arch-arrow-gate)"/>');

    // Dashed feedback arrow: merged work in main returns to the register
    p.push(
      '<path d="M1044,340 L1044,430 L156,430 L156,98" fill="none" stroke="' + C.truth +
      '" stroke-width="1.8" stroke-dasharray="6 5" marker-end="url(#arch-arrow-truth)"/>' +
      '<rect x="420" y="418" width="360" height="24" rx="6" fill="' + C.wash + '" stroke="' + C.truth + '" stroke-opacity=".3"/>' +
      '<text x="600" y="434" font-size="12" font-weight="bold" text-anchor="middle" fill="' + C.muted + '">đã gộp → cập nhật sổ việc → mở khoá việc kế tiếp</text>'
    );

    // Dashboard node: monitors register, logs, and quota
    p.push(node(460, 480, 280, 46, 'Bảng điều khiển', 'sổ việc · nhật ký · hạn mức', C.control));
    p.push('<path d="M452,385 C452,503 456,503 460,503" fill="none" stroke="' + C.line + '" stroke-width="1.4" stroke-dasharray="4 4"/>');
    p.push('<path d="M740,503 C744,503 1044,480 1044,340" fill="none" stroke="' + C.line + '" stroke-width="1.4" stroke-dasharray="4 4"/>');

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
        if (byStatus.READY_FOR_CODEX) m.review = byStatus.READY_FOR_CODEX + ' chờ duyệt';
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
