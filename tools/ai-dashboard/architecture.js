/* TASK-AI-47 — Kiến trúc hệ thống & Vòng đời Work Item.
   Diagram 1: Sơ đồ container (C4 mức 2) với 3 ranh giới (Máy của bạn, Docker, Dịch vụ ngoài).
   Diagram 2: Sơ đồ làn (swimlane) vòng đời một Work Item qua 5 làn ngang.
   Toàn bộ nhãn tiếng Việt. Số liệu badge đọc trực tiếp từ /api/state và /api/rotation. */
(function () {
  'use strict';

  var C = {
    machine: '#2563eb',
    docker: '#0284c7',
    cloud: '#7c3aed',
    operator: '#8b5cf6',
    dispatch: '#ea4b12',
    worker: '#0ea5e9',
    gate: '#ca8a04',
    result: '#16a34a',
    alert: '#dc2626',
    ink: '#1e293b',
    muted: '#64748b',
    line: '#cbd5e1',
    panel: '#ffffff',
    wash: '#faf6ec',
  };

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function node(x, y, w, h, label, tech, color, badge) {
    var hasTech = Boolean(tech && tech.trim() !== '');
    var badgeW = badge ? Math.max(50, badge.length * 6.5 + 14) : 0;
    return (
      '<g>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8" fill="' + C.panel + '" stroke="' + color + '" stroke-width="1.6"/>' +
      '<rect x="' + x + '" y="' + y + '" width="4" height="' + h + '" rx="2" fill="' + color + '"/>' +
      '<text x="' + (x + 12) + '" y="' + (y + (hasTech ? 20 : Math.round(h / 2) + 5)) + '" font-size="12.5" font-weight="bold" fill="' + C.ink + '">' + esc(label) + '</text>' +
      (hasTech ? '<text x="' + (x + 12) + '" y="' + (y + 36) + '" font-size="10.5" fill="' + C.muted + '">[' + esc(tech) + ']</text>' : '') +
      (badge ? (
        '<rect x="' + (x + w - badgeW - 8) + '" y="' + (y + 6) + '" width="' + badgeW + '" height="18" rx="4" fill="' + color + '" fill-opacity="0.12"/>' +
        '<text x="' + (x + w - 8 - badgeW / 2) + '" y="' + (y + 19) + '" font-size="10" font-weight="bold" text-anchor="middle" fill="' + color + '">' + esc(badge) + '</text>'
      ) : '') +
      '</g>'
    );
  }

  function arrow(x1, y1, x2, y2, label, color, dashed, pathD, labelX, labelY) {
    var markerId = color === C.dispatch ? 'arch-arr-dispatch'
      : color === C.machine ? 'arch-arr-machine'
      : color === C.docker ? 'arch-arr-docker'
      : color === C.cloud ? 'arch-arr-cloud'
      : color === C.result ? 'arch-arr-result'
      : color === C.operator ? 'arch-arr-operator'
      : color === C.alert ? 'arch-arr-alert'
      : 'arch-arr-default';

    var d = pathD;
    if (!d) {
      if (x1 === x2 || y1 === y2) {
        d = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
      } else {
        var mx = (x1 + x2) / 2;
        d = 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
      }
    }

    var lx = labelX != null ? labelX : (x1 + x2) / 2;
    var ly = labelY != null ? labelY : (y1 + y2) / 2;
    var pill = '';
    if (label) {
      var tw = label.length * 6.2 + 14;
      pill = (
        '<g>' +
        '<rect x="' + (lx - tw / 2) + '" y="' + (ly - 9) + '" width="' + tw + '" height="18" rx="4" fill="#fffdfa" stroke="' + C.line + '" stroke-width="1"/>' +
        '<text x="' + lx + '" y="' + (ly + 4) + '" font-size="9.5" font-weight="600" text-anchor="middle" fill="' + (color || C.ink) + '">' + esc(label) + '</text>' +
        '</g>'
      );
    }

    return (
      '<g>' +
      '<path d="' + d + '" fill="none" stroke="' + (color || C.line) + '" stroke-width="1.6" ' +
      (dashed ? 'stroke-dasharray="5 4" ' : '') +
      'marker-end="url(#' + markerId + ')"/>' +
      pill +
      '</g>'
    );
  }

  function defs() {
    return (
      '<defs>' +
      '<marker id="arch-arr-default" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.line + '"/></marker>' +
      '<marker id="arch-arr-machine" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.machine + '"/></marker>' +
      '<marker id="arch-arr-docker" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.docker + '"/></marker>' +
      '<marker id="arch-arr-cloud" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.cloud + '"/></marker>' +
      '<marker id="arch-arr-dispatch" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.dispatch + '"/></marker>' +
      '<marker id="arch-arr-result" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.result + '"/></marker>' +
      '<marker id="arch-arr-operator" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.operator + '"/></marker>' +
      '<marker id="arch-arr-alert" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' + C.alert + '"/></marker>' +
      '</defs>'
    );
  }

  /* =========================================================================
     DIAGRAM 1: Sơ đồ container (C4 mức 2)
     viewBox="0 0 1240 560"
     3 Ranh giới: Máy của bạn, Docker, Dịch vụ ngoài
     ========================================================================= */
  function renderDiagram1(m) {
    var W = 1240, H = 560;
    var p = [
      defs(),
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>',
    ];

    // --- Ranh giới 1: "Máy của bạn" (x: 16..735, y: 16..545) ---
    p.push(
      '<rect x="16" y="16" width="720" height="528" rx="14" fill="#faf8f5" stroke="' + C.machine + '" stroke-width="1.8" stroke-dasharray="6 5"/>' +
      '<rect x="30" y="8" width="165" height="20" rx="4" fill="' + C.machine + '"/>' +
      '<text x="112" y="22" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">Ranh giới: Máy của bạn</text>'
    );

    // --- Ranh giới 2: "Docker" (x: 755..975, y: 16..245) ---
    p.push(
      '<rect x="755" y="16" width="220" height="230" rx="14" fill="#f0f9ff" stroke="' + C.docker + '" stroke-width="1.8" stroke-dasharray="6 5"/>' +
      '<rect x="770" y="8" width="135" height="20" rx="4" fill="' + C.docker + '"/>' +
      '<text x="837" y="22" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">Ranh giới: Docker</text>'
    );

    // --- Ranh giới 3: "Dịch vụ ngoài" (x: 995..1225, y: 16..545) ---
    p.push(
      '<rect x="995" y="16" width="230" height="528" rx="14" fill="#faf5ff" stroke="' + C.cloud + '" stroke-width="1.8" stroke-dasharray="6 5"/>' +
      '<rect x="1010" y="8" width="160" height="20" rx="4" fill="' + C.cloud + '"/>' +
      '<text x="1090" y="22" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">Ranh giới: Dịch vụ ngoài</text>'
    );

    // Nodes trong Ranh giới "Máy của bạn"
    p.push(node(36, 44, 180, 50, 'Người vận hành', 'người', C.operator));
    p.push(node(270, 44, 190, 50, 'Claude Code', 'CLI điều phối', C.dispatch));
    p.push(node(510, 44, 210, 50, 'dispatch.sh', 'bash, chọn thợ và đổi model', C.dispatch, m.dispatchBadge));
    p.push(node(510, 140, 210, 50, 'ai-brain', 'Node, quota · fitness · cooldown', C.dispatch));

    p.push(node(36, 215, 180, 50, 'AO daemon', ':4317, tạo phiên', C.worker));

    // Khung nhóm CLI thợ
    p.push(
      '<rect x="252" y="132" width="225" height="198" rx="10" fill="#f0f9ff" stroke="' + C.worker + '" stroke-width="1.2" stroke-dasharray="4 3"/>' +
      '<text x="264" y="150" font-size="11" font-weight="bold" fill="' + C.worker + '">CLI thợ</text>'
    );
    p.push(node(262, 160, 205, 46, 'xKiro', 'cline + endpoint xKiro', C.worker));
    p.push(node(262, 216, 205, 46, 'agy', 'CLI', C.worker));
    p.push(node(262, 272, 205, 46, 'Cline', 'CLI', C.worker));

    p.push(node(510, 240, 210, 50, '9Router', ':20128, định tuyến model', C.worker));

    // Nhóm phía dưới: Dashboard, Sổ việc, runner.sh
    p.push(node(36, 452, 190, 52, 'Dashboard', 'Node HTTP :3333, chỉ đọc', C.docker));
    p.push(node(270, 452, 190, 52, 'Sổ việc & log', 'REGISTER.csv, log cục bộ', C.operator, m.registerBadge));
    p.push(node(510, 452, 210, 52, 'runner.sh', 'bash, luật merge', C.result));

    // Nodes trong Ranh giới "Docker"
    p.push(node(770, 50, 190, 52, 'agy (Docker)', 'container', C.docker));
    p.push(node(770, 138, 190, 52, 'Claude (tài khoản 2)', 'container dự phòng', C.docker));

    // Nodes trong Ranh giới "Dịch vụ ngoài"
    p.push(node(1010, 50, 200, 68, 'GitHub', 'PR, CI, API REST', C.cloud, m.reviewBadge || m.mergedBadge));
    p.push(node(1010, 240, 200, 80, 'Nhà cung cấp model', 'xKiro · Anthropic · Google · MiniMax', C.cloud));

    // --- Mũi tên và hành động ---
    // 1. Người vận hành → Claude Code
    p.push(arrow(216, 69, 270, 69, 'giao việc', C.operator));

    // 2. Claude Code → dispatch.sh
    p.push(arrow(460, 69, 510, 69, 'gọi CLI', C.dispatch));

    // 3. dispatch.sh → ai-brain
    p.push(arrow(615, 94, 615, 140, 'hỏi hạn mức', C.dispatch, false, null, 615, 117));

    // 4. dispatch.sh → CLI thợ
    p.push(arrow(510, 75, 467, 180, 'chạy lệnh', C.dispatch, false, 'M510,75 C480,75 480,180 467,180', 484, 118));

    // 5. dispatch.sh → agy (Docker)
    p.push(arrow(720, 69, 770, 69, 'chạy lệnh', C.docker));

    // 6. AO daemon → CLI thợ
    p.push(arrow(216, 240, 252, 240, 'spawn phiên', C.worker));

    // 7. CLI thợ → 9Router
    p.push(arrow(467, 255, 510, 255, 'gọi model', C.worker));

    // 8. 9Router → Nhà cung cấp model
    p.push(arrow(720, 265, 1010, 265, 'định tuyến', C.worker));

    // 9. CLI thợ → Nhà cung cấp model (gọi API)
    p.push(arrow(467, 295, 1010, 305, 'gọi API', C.cloud, false, 'M467,295 C560,350 820,350 1010,305', 730, 348));

    // 10. CLI thợ → GitHub (commit, push, mở PR)
    p.push(arrow(467, 165, 1010, 75, 'commit, push, mở PR (gh REST)', C.cloud, false, 'M467,165 C580,110 820,40 1010,75', 720, 62));

    // 11. runner.sh → GitHub (quét PR, merge khi đủ điều kiện)
    p.push(arrow(720, 478, 1010, 105, 'quét PR, merge khi đủ điều kiện', C.result, false, 'M720,478 C880,478 950,260 1010,105', 860, 395));

    // 12. Dashboard → đọc register, log, quota (nét đứt mảnh)
    p.push(arrow(226, 478, 270, 478, 'đọc register, log, quota', C.muted, true));
    p.push(arrow(131, 452, 510, 85, '', C.muted, true, 'M131,452 C131,390 490,390 510,85'));
    p.push(arrow(131, 504, 1010, 115, '', C.muted, true, 'M131,504 C131,540 920,540 1010,115'));

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full h-auto block">' + p.join('') + '</svg>';
  }

  /* =========================================================================
     DIAGRAM 2: Sơ đồ làn (swimlane) vòng đời một Work Item
     viewBox="0 0 1240 420"
     5 làn: Người vận hành · Điều phối · Thợ · Kiểm chứng · Kết quả
     ========================================================================= */
  function renderDiagram2(m) {
    var W = 1240, H = 420;
    var p = [
      defs(),
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>',
    ];

    var lanes = [
      { name: 'Người vận hành', sub: 'giao việc & nhận kết quả', color: C.operator, bg: '#faf8ff', y: 20 },
      { name: 'Điều phối', sub: 'Claude Code & dispatch.sh', color: C.dispatch, bg: '#fffaf5', y: 92 },
      { name: 'Thợ', sub: 'xKiro · agy · Cline', color: C.worker, bg: '#f8fcff', y: 164 },
      { name: 'Kiểm chứng', sub: 'CI & review chéo', color: C.gate, bg: '#fffdf2', y: 236 },
      { name: 'Kết quả', sub: 'runner.sh merge & main', color: C.result, bg: '#f6fef9', y: 308 },
    ];

    var laneH = 68;
    var leftW = 158;
    var laneLeft = 18;
    var contentLeft = laneLeft + leftW + 6;
    var contentW = W - contentLeft - 18;

    // Vẽ 5 làn
    lanes.forEach(function (l) {
      // Vùng nội dung làn
      p.push(
        '<rect x="' + contentLeft + '" y="' + l.y + '" width="' + contentW + '" height="' + laneH + '" rx="8" fill="' + l.bg + '" stroke="' + C.line + '" stroke-width="1"/>'
      );
      // Tiêu đề nhãn làn bên trái
      p.push(
        '<rect x="' + laneLeft + '" y="' + l.y + '" width="' + leftW + '" height="' + laneH + '" rx="8" fill="' + C.panel + '" stroke="' + l.color + '" stroke-width="1.6"/>' +
        '<rect x="' + laneLeft + '" y="' + l.y + '" width="4" height="' + laneH + '" rx="2" fill="' + l.color + '"/>' +
        '<text x="' + (laneLeft + 14) + '" y="' + (l.y + 28) + '" font-size="13" font-weight="bold" fill="' + l.color + '">' + esc(l.name) + '</text>' +
        '<text x="' + (laneLeft + 14) + '" y="' + (l.y + 48) + '" font-size="10" fill="' + C.muted + '">' + esc(l.sub) + '</text>'
      );
    });

    // Các bước hộp nhỏ đặt trong đúng làn:
    // Làn 1: chọn việc
    p.push(node(196, 32, 100, 44, 'chọn việc', '', C.operator, m.registerBadge));

    // Làn 2: giao dispatch.sh
    p.push(node(316, 104, 130, 44, 'giao dispatch.sh', '', C.dispatch, m.dispatchBadge));

    // Làn 3: chạy trong worktree riêng, commit + mở PR
    p.push(node(466, 176, 154, 44, 'chạy trong worktree riêng', '', C.worker));
    p.push(node(640, 176, 120, 44, 'commit + mở PR', '', C.worker));

    // Làn 4: CI, review chéo
    p.push(node(780, 248, 64, 44, 'CI', '', C.gate));
    p.push(node(864, 248, 116, 44, 'review chéo', '', C.gate, m.reviewBadge));

    // Làn 5: runner.sh merge, main, cập nhật register
    p.push(node(946, 320, 124, 44, 'runner.sh merge', '', C.result, m.mergedBadge));
    p.push(node(1090, 320, 56, 44, 'main', '', C.result));
    p.push(node(1164, 320, 54, 44, 'cập nhật', 'register', C.operator));

    // --- Mũi tên nối các bước nối từ trái sang phải ---
    // 1. chọn việc → giao dispatch.sh
    p.push(arrow(296, 54, 316, 126, 'giao việc', C.operator, false, 'M296,54 C308,54 304,126 316,126', 305, 90));

    // 2. giao dispatch.sh → chạy trong worktree riêng
    p.push(arrow(446, 126, 466, 198, 'tạo việc', C.dispatch, false, 'M446,126 C458,126 454,198 466,198', 455, 162));

    // 3. chạy trong worktree riêng → commit + mở PR
    p.push(arrow(620, 198, 640, 198, 'xong mã', C.worker));

    // 4. commit + mở PR → CI
    p.push(arrow(760, 198, 780, 270, 'kích hoạt', C.worker, false, 'M760,198 C772,198 768,270 780,270', 769, 234));

    // 5. CI → review chéo
    p.push(arrow(844, 270, 864, 270, 'đạt CI', C.gate));

    // 6. Quay lui nếu CHANGES_REQUIRED về làn Thợ (sửa theo review)
    p.push(arrow(922, 248, 543, 220, 'nếu CHANGES_REQUIRED: sửa theo review', C.alert, false, 'M922,248 C922,230 543,230 543,220', 732, 228));

    // 7. review chéo → runner.sh merge
    p.push(arrow(980, 270, 1008, 320, 'duyệt', C.gate, false, 'M980,270 C995,270 1008,295 1008,320', 994, 295));

    // 8. runner.sh merge → main
    p.push(arrow(1070, 342, 1090, 342, 'gộp', C.result));

    // 9. main → cập nhật register
    p.push(arrow(1146, 342, 1164, 342, 'ghi nhận', C.result));

    // 10. cập nhật register → quay về làn Người vận hành (mũi tên đứt, mở khoá việc kế tiếp)
    p.push(arrow(
      1191, 364, 246, 76, 'mở khoá việc kế tiếp', C.operator, true,
      'M1191,364 C1191,400 1150,400 1050,400 L 320,400 C 246,400 246,380 246,76',
      680, 400
    ));

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full h-auto block">' + p.join('') + '</svg>';
  }

  function render(m) {
    var host = document.getElementById('architecture-diagram');
    if (!host) return;

    var badgesHtml = '';
    var badgeItems = [];
    if (m.totalWorkItems != null) {
      badgeItems.push('<span class="badge badge-sm badge-neutral">Tổng việc: <b>' + esc(m.totalWorkItems) + '</b></span>');
    }
    if (m.dispatchCount != null) {
      badgeItems.push('<span class="badge badge-sm badge-neutral">Lượt dispatch: <b>' + esc(m.dispatchCount) + '</b></span>');
    }
    if (m.reviewCount != null) {
      badgeItems.push('<span class="badge badge-sm badge-warning">Chờ review: <b>' + esc(m.reviewCount) + '</b></span>');
    }
    if (m.mergedCount != null) {
      badgeItems.push('<span class="badge badge-sm badge-success text-white">Đã gộp: <b>' + esc(m.mergedCount) + '</b></span>');
    }
    if (badgeItems.length > 0) {
      badgesHtml = '<div class="flex flex-wrap gap-2 pt-1 pb-2 border-b border-base-300">' + badgeItems.join('') + '</div>';
    }

    var html = (
      '<div class="space-y-6">' +
      badgesHtml +
      // Khối Sơ đồ 1
      '<div class="space-y-2">' +
      '  <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-base-300 pb-2">' +
      '    <div class="flex items-center gap-2">' +
      '      <span class="badge badge-sm badge-outline font-bold">Sơ đồ 1</span>' +
      '      <h4 class="font-bold text-sm text-base-content">Sơ đồ container (C4 mức 2)</h4>' +
      '    </div>' +
      '    <div class="flex flex-wrap gap-3 text-[11px] opacity-80">' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.machine + '"></span> Máy của bạn</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.docker + '"></span> Docker</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.cloud + '"></span> Dịch vụ ngoài</span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="overflow-x-auto rounded-xl border border-base-300 bg-base-100 p-2">' +
      renderDiagram1(m) +
      '  </div>' +
      '</div>' +
      // Khối Sơ đồ 2
      '<div class="space-y-2">' +
      '  <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-base-300 pb-2">' +
      '    <div class="flex items-center gap-2">' +
      '      <span class="badge badge-sm badge-outline font-bold">Sơ đồ 2</span>' +
      '      <h4 class="font-bold text-sm text-base-content">Sơ đồ làn — Vòng đời một Work Item</h4>' +
      '    </div>' +
      '    <div class="flex flex-wrap gap-3 text-[11px] opacity-80">' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.operator + '"></span> Người vận hành</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.dispatch + '"></span> Điều phối</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.worker + '"></span> Thợ</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.gate + '"></span> Kiểm chứng</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' + C.result + '"></span> Kết quả</span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="overflow-x-auto rounded-xl border border-base-300 bg-base-100 p-2">' +
      renderDiagram2(m) +
      '  </div>' +
      '</div>' +
      '</div>'
    );

    host.innerHTML = html;
  }

  function load() {
    Promise.all([
      fetch('/api/state').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/rotation').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (res) {
      var state = res[0], rot = res[1], m = {};
      if (state && state.workItems) {
        if (typeof state.workItems.total === 'number') {
          m.totalWorkItems = state.workItems.total;
          m.registerBadge = state.workItems.total + ' việc';
        }
        if (typeof state.workItems.mergedCount === 'number') {
          m.mergedCount = state.workItems.mergedCount;
          m.mergedBadge = state.workItems.mergedCount + ' đã gộp';
        }
        var byStatus = state.workItems.byStatus || {};
        if (typeof byStatus.READY_FOR_CODEX === 'number' && byStatus.READY_FOR_CODEX > 0) {
          m.reviewCount = byStatus.READY_FOR_CODEX;
          m.reviewBadge = byStatus.READY_FOR_CODEX + ' chờ review';
        }
      }
      if (rot && rot.totals && typeof rot.totals.attempts === 'number') {
        m.dispatchCount = rot.totals.attempts;
        m.dispatchBadge = rot.totals.attempts + ' lượt';
      }
      render(m);
    });
  }

  load();
  setInterval(load, 15000);
})();
