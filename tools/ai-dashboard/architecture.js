/* TASK-AI-47 — Kiến trúc hệ thống & Vòng đời Work Item.
   Diagram 1: Sơ đồ container (C4 mức 2) với 3 ranh giới (Máy của bạn, Dịch vụ nền, Dịch vụ ngoài).
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

  /* Ước lượng bề rộng chữ để hộp và nhãn không bao giờ tràn ra ngoài.
     Hệ số px/ký tự: nhãn đậm 12.5 -> 7.1; kỹ thuật 10.5 -> 6.0;
     nhãn cạnh 9.5 -> 6.2; badge 10 -> 6.5. */
  function textUnits(t) {
    return String(t == null ? '' : t).length;
  }
  function labelW(t) {
    return textUnits(t) * 7.1;
  }
  function techW(t) {
    return (textUnits(t) + 2) * 6;
  }
  function edgeLabelW(t) {
    return textUnits(t) * 6.2 + 16;
  }
  function badgeW(t) {
    return Math.max(50, textUnits(t) * 6.5 + 14);
  }

  function node(x, y, w, h, label, tech, color, badge) {
    var hasTech = Boolean(tech && tech.trim() !== '');
    var bW = badge ? badgeW(badge) : 0;
    /* Tự nới hộp khi chữ (hoặc badge lấy từ API) dài hơn chỗ dự kiến. */
    var need = Math.max(12 + labelW(label) + 12, 12 + techW(tech) + 12);
    if (bW) need = Math.max(need, 12 + labelW(label) + 10 + bW + 8);
    w = Math.max(w, Math.ceil(need));
    return (
      '<g>' +
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      w +
      '" height="' +
      h +
      '" rx="8" fill="' +
      C.panel +
      '" stroke="' +
      color +
      '" stroke-width="1.6"/>' +
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="4" height="' +
      h +
      '" rx="2" fill="' +
      color +
      '"/>' +
      '<text x="' +
      (x + 12) +
      '" y="' +
      (y + (hasTech ? 20 : Math.round(h / 2) + 5)) +
      '" font-size="12.5" font-weight="bold" fill="' +
      C.ink +
      '">' +
      esc(label) +
      '</text>' +
      (hasTech
        ? '<text x="' +
          (x + 12) +
          '" y="' +
          (y + 36) +
          '" font-size="10.5" fill="' +
          C.muted +
          '">[' +
          esc(tech) +
          ']</text>'
        : '') +
      (badge
        ? '<rect x="' +
          (x + w - bW - 8) +
          '" y="' +
          (y + 6) +
          '" width="' +
          bW +
          '" height="18" rx="4" fill="' +
          color +
          '" fill-opacity="0.12"/>' +
          '<text x="' +
          (x + w - 8 - bW / 2) +
          '" y="' +
          (y + 19) +
          '" font-size="10" font-weight="bold" text-anchor="middle" fill="' +
          color +
          '">' +
          esc(badge) +
          '</text>'
        : '') +
      '</g>'
    );
  }

  /* Đường gấp khúc vuông góc từ danh sách điểm; bo góc mềm nhờ linejoin. */
  function poly(pts) {
    return (
      'M' +
      pts
        .map(function (q) {
          return q[0] + ',' + q[1];
        })
        .join(' L')
    );
  }

  /* Hộp bước trong sơ đồ làn: nhãn căn giữa, badge nằm ở góc trên phải và
     không đè lên chữ (chữ hạ xuống dưới khi có badge). */
  function stepBox(x, y, w, h, label, tech, color, badge) {
    var bW = badge ? badgeW(badge) : 0;
    var hasTech = !!tech && tech.trim() !== '';
    var labelY = badge ? y + 40 : hasTech ? y + 24 : Math.round(y + h / 2 + 5);
    return (
      '<g>' +
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      w +
      '" height="' +
      h +
      '" rx="8" fill="' +
      C.panel +
      '" stroke="' +
      color +
      '" stroke-width="1.6"/>' +
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="4" height="' +
      h +
      '" rx="2" fill="' +
      color +
      '"/>' +
      '<text x="' +
      (x + w / 2) +
      '" y="' +
      labelY +
      '" font-size="12.5" font-weight="bold" text-anchor="middle" fill="' +
      C.ink +
      '">' +
      esc(label) +
      '</text>' +
      (hasTech
        ? '<text x="' +
          (x + w / 2) +
          '" y="' +
          (y + 42) +
          '" font-size="10" text-anchor="middle" fill="' +
          C.muted +
          '">[' +
          esc(tech) +
          ']</text>'
        : '') +
      (badge
        ? '<rect x="' +
          Math.round(x + w - bW - 8) +
          '" y="' +
          (y + 6) +
          '" width="' +
          bW +
          '" height="16" rx="4" fill="' +
          color +
          '" fill-opacity="0.14"/>' +
          '<text x="' +
          Math.round(x + w - 8 - bW / 2) +
          '" y="' +
          (y + 18) +
          '" font-size="10" font-weight="bold" text-anchor="middle" fill="' +
          color +
          '">' +
          esc(badge) +
          '</text>'
        : '') +
      '</g>'
    );
  }

  function arrow(x1, y1, x2, y2, label, color, dashed, pathD, labelX, labelY) {
    var markerId =
      color === C.dispatch
        ? 'arch-arr-dispatch'
        : color === C.machine
          ? 'arch-arr-machine'
          : color === C.docker
            ? 'arch-arr-docker'
            : color === C.cloud
              ? 'arch-arr-cloud'
              : color === C.result
                ? 'arch-arr-result'
                : color === C.operator
                  ? 'arch-arr-operator'
                  : color === C.alert
                    ? 'arch-arr-alert'
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
      var tw = edgeLabelW(label);
      pill =
        '<g>' +
        '<rect x="' +
        (lx - tw / 2) +
        '" y="' +
        (ly - 9) +
        '" width="' +
        tw +
        '" height="18" rx="4" fill="#ffffff" stroke="' +
        C.line +
        '" stroke-width="1"/>' +
        '<text x="' +
        lx +
        '" y="' +
        (ly + 4) +
        '" font-size="9.5" font-weight="600" text-anchor="middle" fill="' +
        (color || C.ink) +
        '">' +
        esc(label) +
        '</text>' +
        '</g>';
    }

    return (
      '<g>' +
      '<path d="' +
      d +
      '" fill="none" stroke="' +
      (color || C.line) +
      '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" ' +
      (dashed ? 'stroke-dasharray="5 4" ' : '') +
      'marker-end="url(#' +
      markerId +
      ')"/>' +
      pill +
      '</g>'
    );
  }

  function defs() {
    return (
      '<defs>' +
      '<marker id="arch-arr-default" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.line +
      '"/></marker>' +
      '<marker id="arch-arr-machine" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.machine +
      '"/></marker>' +
      '<marker id="arch-arr-docker" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.docker +
      '"/></marker>' +
      '<marker id="arch-arr-cloud" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.cloud +
      '"/></marker>' +
      '<marker id="arch-arr-dispatch" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.dispatch +
      '"/></marker>' +
      '<marker id="arch-arr-result" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.result +
      '"/></marker>' +
      '<marker id="arch-arr-operator" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.operator +
      '"/></marker>' +
      '<marker id="arch-arr-alert" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
      '<path d="M0,1 L7,4 L0,7 z" fill="' +
      C.alert +
      '"/></marker>' +
      '</defs>'
    );
  }

  /* =========================================================================
     DIAGRAM 1: Sơ đồ container (C4 mức 2)
     viewBox="0 0 1640 780"
     3 Ranh giới: Máy của bạn, Dịch vụ nền (native, thay Docker từ 22/9), Dịch vụ ngoài
     Bố cục:
       - Cột trái: Người vận hành (trên) -> Claude Code (dưới)
       - Cột giữa: dispatch.sh (trên) -> ai-brain (dưới)
       - Nhóm "CLI thợ" nằm giữa dispatch.sh và GitHub
       - Paseo (thay AO từ 22/9) và 9Router đặt dưới nhóm CLI thợ
       - Hàng dưới cùng: Dashboard, Sổ việc & log, runner.sh
     Cạnh đi vòng theo đường gấp khúc theo hành lang trống, không cắt xuyên qua hộp.
     Mỗi nhãn cạnh có nền trắng bo góc vẽ trước chữ, không đè lên bất kỳ hộp nào.
     Khoảng cách tối thiểu giữa hai hộp >= 24px.
     ========================================================================= */
  function renderDiagram1(m) {
    var W = 1640,
      H = 780;
    var p = [defs(), '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>'];

    // --- Ranh giới 1: "Máy của bạn" (x: 16..950, y: 16..764) ---
    p.push(
      '<rect x="16" y="16" width="934" height="748" rx="14" fill="#faf8f5" stroke="' +
        C.machine +
        '" stroke-width="1.8" stroke-dasharray="6 5"/>' +
        '<rect x="30" y="8" width="165" height="20" rx="4" fill="' +
        C.machine +
        '"/>' +
        '<text x="112" y="22" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">Ranh giới: Máy của bạn</text>'
    );

    // --- Ranh giới 2: "Dịch vụ nền" (x: 974..1234, y: 16..186) ---
    // Docker Desktop was removed; these run as native Windows processes (NativeStack.ps1).
    p.push(
      '<rect x="974" y="16" width="260" height="170" rx="14" fill="#f0f9ff" stroke="' +
        C.docker +
        '" stroke-width="1.8" stroke-dasharray="6 5"/>' +
        '<rect x="989" y="8" width="150" height="20" rx="4" fill="' +
        C.docker +
        '"/>' +
        '<text x="1064" y="22" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">Ranh giới: Dịch vụ nền</text>'
    );

    // --- Ranh giới 3: "Dịch vụ ngoài" (x: 1258..1624, y: 16..764) ---
    p.push(
      '<rect x="1258" y="16" width="366" height="748" rx="14" fill="#faf5ff" stroke="' +
        C.cloud +
        '" stroke-width="1.8" stroke-dasharray="6 5"/>' +
        '<rect x="1273" y="8" width="165" height="20" rx="4" fill="' +
        C.cloud +
        '"/>' +
        '<text x="1355" y="22" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">Ranh giới: Dịch vụ ngoài</text>'
    );

    // Nodes trong Ranh giới "Máy của bạn"
    // Cột 1
    p.push(node(40, 60, 160, 52, 'Người vận hành', 'người', C.operator));
    p.push(node(40, 180, 160, 52, 'Claude Code', 'CLI điều phối', C.dispatch));

    // Cột 2
    p.push(
      node(
        280,
        180,
        210,
        52,
        'dispatch.sh',
        'bash, chọn thợ và đổi model',
        C.dispatch,
        m.dispatchBadge
      )
    );
    p.push(node(280, 300, 230, 52, 'ai-brain', 'Node, quota · fitness · cooldown', C.dispatch));

    // Nhóm "CLI thợ": nằm giữa dispatch.sh và GitHub
    p.push(
      '<rect x="580" y="160" width="350" height="236" rx="10" fill="#f0f9ff" stroke="' +
        C.worker +
        '" stroke-width="1.2" stroke-dasharray="4 3"/>' +
        '<text x="595" y="180" font-size="11" font-weight="bold" fill="' +
        C.worker +
        '">CLI thợ</text>'
    );
    // Every author lane runs the Cline CLI; lanes differ only in the endpoint
    // config they pass (dispatch.sh), so the boxes are endpoints, not tools.
    p.push(node(598, 188, 314, 44, 'cline → 9Router', 'phần lớn lane tác giả', C.worker));
    p.push(node(598, 258, 314, 44, 'cline → endpoint riêng', 'xKiro · TokenHarbor · Requesty · Tencent', C.worker));
    p.push(node(598, 328, 314, 44, 'codex · AutoClaw', 'lane review & dự phòng', C.worker));

    // Paseo (thay AO) và 9Router đặt dưới nhóm CLI thợ
    p.push(node(580, 446, 160, 52, 'Paseo', ':6767, daemon agent', C.worker));
    p.push(node(770, 446, 160, 52, '9Router', ':20128, định tuyến model', C.worker));

    // Hàng dưới cùng: Dashboard, Sổ việc & log, runner.sh
    p.push(node(40, 596, 175, 52, 'Dashboard', 'Node HTTP :3333, chỉ đọc', C.operator));
    p.push(
      node(
        280,
        596,
        210,
        52,
        'Sổ việc & log',
        'REGISTER.csv, log cục bộ',
        C.operator,
        m.registerBadge
      )
    );
    p.push(node(580, 596, 160, 52, 'runner.sh', 'bash, luật merge', C.result));

    // Nodes trong Ranh giới "Dịch vụ nền"
    p.push(node(1000, 38, 208, 40, 'PostgreSQL 16', ':5433, shipde_dev', C.docker));
    p.push(node(1000, 88, 208, 40, 'Redis', ':6379', C.docker));
    p.push(node(1000, 138, 208, 40, 'SeaweedFS (S3)', ':9000, thay MinIO', C.docker));

    // Nodes trong Ranh giới "Dịch vụ ngoài"
    p.push(
      node(
        1285,
        210,
        210,
        52,
        'GitHub',
        'PR, CI, API REST',
        C.cloud,
        m.reviewBadge || m.mergedBadge
      )
    );
    p.push(
      node(
        1285,
        446,
        275,
        52,
        'Nhà cung cấp model',
        'Copilot · Antigravity · Kiro · Cloudflare · …',
        C.cloud
      )
    );

    // --- Mũi tên và hành động ---
    // 1. Người vận hành → Claude Code
    p.push(arrow(120, 112, 120, 180, 'giao việc', C.operator, false, undefined, 120, 146));

    // 2. Claude Code → dispatch.sh
    p.push(arrow(200, 206, 280, 206, 'gọi CLI', C.dispatch, false, undefined, 240, 206));

    // 3. dispatch.sh → ai-brain
    p.push(arrow(385, 232, 385, 300, 'hỏi hạn mức', C.dispatch, false, undefined, 385, 266));

    // 4. dispatch.sh → CLI thợ
    p.push(arrow(490, 206, 580, 206, 'chạy lệnh', C.dispatch, false, undefined, 535, 206));

    // 6. Paseo → CLI thợ: đi thẳng lên nhóm CLI thợ
    p.push(arrow(660, 446, 660, 396, 'tạo agent', C.worker, false, undefined, 660, 421));

    // 7. CLI thợ → 9Router: đi thẳng xuống 9Router
    p.push(arrow(850, 396, 850, 446, 'gọi model', C.worker, false, undefined, 850, 421));

    // 8. 9Router → Nhà cung cấp model: đi thẳng sang phải qua hành lang trống
    p.push(arrow(930, 472, 1285, 472, 'định tuyến', C.worker, false, undefined, 1105, 472));

    // 9. CLI thợ → Nhà cung cấp model (gọi API): đi vòng qua hành lang giữa Máy và Dịch vụ ngoài
    p.push(
      arrow(
        930,
        350,
        1285,
        458,
        'gọi API',
        C.cloud,
        false,
        poly([
          [930, 350],
          [1220, 350],
          [1220, 458],
          [1285, 458],
        ]),
        1075,
        350
      )
    );

    // 10. CLI thợ → GitHub (commit, push, mở PR gh REST)
    p.push(
      arrow(
        930,
        236,
        1285,
        236,
        'commit, push, mở PR (gh REST)',
        C.cloud,
        false,
        undefined,
        1105,
        236
      )
    );

    // 11. runner.sh → GitHub: đi qua hành lang dưới đáy rồi lên cạnh phải của GitHub
    p.push(
      arrow(
        660,
        648,
        1495,
        225,
        'quét PR, merge khi đủ điều kiện',
        C.result,
        false,
        poly([
          [660, 648],
          [660, 715],
          [1585, 715],
          [1585, 225],
          [1495, 225],
        ]),
        1050,
        715
      )
    );

    // 12. Dashboard → Sổ việc & log (đọc register, log, quota)
    p.push(
      arrow(
        127,
        648,
        385,
        648,
        'đọc register, log, quota',
        C.muted,
        true,
        poly([
          [127, 648],
          [127, 685],
          [385, 685],
          [385, 648],
        ]),
        256,
        685
      )
    );

    // 13. Dashboard → dispatch.sh: lên hành lang x=245 giữa cột 1 và cột 2
    p.push(
      arrow(
        180,
        596,
        280,
        206,
        '',
        C.muted,
        true,
        poly([
          [180, 596],
          [180, 550],
          [245, 550],
          [245, 206],
          [280, 206],
        ])
      )
    );

    // 14. Dashboard → GitHub: đi vòng qua hành lang đáy dưới cùng rồi lên cạnh phải của GitHub
    p.push(
      arrow(
        80,
        648,
        1495,
        245,
        '',
        C.muted,
        true,
        poly([
          [80, 648],
          [80, 740],
          [1605, 740],
          [1605, 245],
          [1495, 245],
        ])
      )
    );

    return (
      '<svg viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" class="w-full h-auto block" style="min-width:' +
      Math.round(W * 0.8) +
      'px">' +
      p.join('') +
      '</svg>'
    );
  }

  /* =========================================================================
     DIAGRAM 2: Sơ đồ làn (swimlane) vòng đời một Work Item
     5 làn: Người vận hành · Điều phối · Thợ · Kiểm chứng · Kết quả
     Bề rộng hộp bước tính theo nhãn (~8px mỗi ký tự + 28px đệm), khoảng cách
     giữa hai hộp tối thiểu 40px theo chiều ngang, không hộp nào tràn khỏi làn,
     badge nằm ở góc trên phải hộp không đè lên chữ, nhãn trên cạnh đặt giữa
     hai hộp có nền trắng, mũi tên CHANGES_REQUIRED vòng dưới làn Kiểm chứng
     rồi đi lên làn Thợ không cắt qua hộp nào.
     ========================================================================= */
  function renderDiagram2(m) {
    var laneH = 68;
    var laneGap = 34; // hành lang trống giữa hai làn — nơi đặt nhãn cạnh
    var firstLaneY = 20;
    var leftW = 158;
    var laneLeft = 18;
    var contentLeft = laneLeft + leftW + 8;
    var boxH = 52;
    var boxPad = 12;
    var minGap = 40;
    var loopBand = 50; // chỗ cho mũi tên vòng về làn đầu

    var lanes = [
      { name: 'Người vận hành', sub: 'giao việc & nhận kết quả', color: C.operator, bg: '#faf8ff' },
      { name: 'Điều phối', sub: 'Claude Code & dispatch.sh', color: C.dispatch, bg: '#fffaf5' },
      { name: 'Thợ', sub: 'cline qua 9Router & endpoint riêng', color: C.worker, bg: '#f8fcff' },
      { name: 'Kiểm chứng', sub: 'CI & review chéo', color: C.gate, bg: '#fffdf2' },
      { name: 'Kết quả', sub: 'runner.sh merge & main', color: C.result, bg: '#f6fef9' },
    ];
    lanes.forEach(function (l, i) {
      l.y = firstLaneY + i * (laneH + laneGap);
    });
    var H = firstLaneY + lanes.length * laneH + (lanes.length - 1) * laneGap + loopBand;

    /* Chín hộp bước giữ nguyên nhãn và badge như trước; inLabel là nhãn của
       cạnh đi vào hộp đó. */
    var steps = [
      {
        lane: 0,
        label: 'chọn việc',
        tech: '',
        color: C.operator,
        badge: m.registerBadge,
        inLabel: '',
      },
      {
        lane: 1,
        label: 'giao dispatch.sh',
        tech: '',
        color: C.dispatch,
        badge: m.dispatchBadge,
        inLabel: 'giao việc',
      },
      {
        lane: 2,
        label: 'chạy trong worktree riêng',
        tech: '',
        color: C.worker,
        badge: '',
        inLabel: 'tạo việc',
      },
      {
        lane: 2,
        label: 'commit + mở PR',
        tech: '',
        color: C.worker,
        badge: '',
        inLabel: 'xong mã',
      },
      { lane: 3, label: 'CI', tech: '', color: C.gate, badge: '', inLabel: 'kích hoạt' },
      {
        lane: 3,
        label: 'review chéo',
        tech: '',
        color: C.gate,
        badge: m.reviewBadge,
        inLabel: 'đạt CI',
      },
      {
        lane: 4,
        label: 'runner.sh merge',
        tech: '',
        color: C.result,
        badge: m.mergedBadge,
        inLabel: 'duyệt',
      },
      { lane: 4, label: 'main', tech: '', color: C.result, badge: '', inLabel: 'gộp' },
      {
        lane: 4,
        label: 'cập nhật',
        tech: 'register',
        color: C.operator,
        badge: '',
        inLabel: 'ghi nhận',
      },
    ];

    var cursor = contentLeft + boxPad;
    steps.forEach(function (s, i) {
      if (i > 0) {
        s.gap = Math.max(minGap, Math.round(edgeLabelW(s.inLabel) + 20));
        cursor += s.gap;
      }
      s.w = Math.max(
        Math.round(textUnits(s.label) * 8 + 28),
        s.badge ? Math.round(badgeW(s.badge) + 24) : 0
      );
      s.x = cursor;
      s.y = lanes[s.lane].y + Math.round((laneH - boxH) / 2);
      cursor += s.w;
    });
    var contentRight = cursor + boxPad;
    var W = contentRight + laneLeft;
    var contentW = contentRight - contentLeft;
    var p = [defs(), '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>'];

    // Vẽ 5 làn
    lanes.forEach(function (l) {
      // Vùng nội dung làn
      p.push(
        '<rect x="' +
          contentLeft +
          '" y="' +
          l.y +
          '" width="' +
          contentW +
          '" height="' +
          laneH +
          '" rx="8" fill="' +
          l.bg +
          '" stroke="' +
          C.line +
          '" stroke-width="1"/>'
      );
      // Tiêu đề nhãn làn bên trái
      p.push(
        '<rect x="' +
          laneLeft +
          '" y="' +
          l.y +
          '" width="' +
          leftW +
          '" height="' +
          laneH +
          '" rx="8" fill="' +
          C.panel +
          '" stroke="' +
          l.color +
          '" stroke-width="1.6"/>' +
          '<rect x="' +
          laneLeft +
          '" y="' +
          l.y +
          '" width="4" height="' +
          laneH +
          '" rx="2" fill="' +
          l.color +
          '"/>' +
          '<text x="' +
          (laneLeft + 14) +
          '" y="' +
          (l.y + 28) +
          '" font-size="13" font-weight="bold" fill="' +
          l.color +
          '">' +
          esc(l.name) +
          '</text>' +
          '<text x="' +
          (laneLeft + 14) +
          '" y="' +
          (l.y + 48) +
          '" font-size="10" fill="' +
          C.muted +
          '">' +
          esc(l.sub) +
          '</text>'
      );
    });

    // Các hộp bước: toạ độ đã tính ở trên, mỗi hộp nằm gọn trong làn của nó
    steps.forEach(function (s) {
      p.push(stepBox(s.x, s.y, s.w, boxH, s.label, s.tech, s.color, s.badge));
    });

    /* Nối các hộp bước: cùng làn thì đi thẳng, khác làn thì gấp vuông góc
       ngay giữa hai hộp; nhãn cạnh nằm ở hành lang giữa hai làn. */
    function link(a, b, label, color) {
      var ax = a.x + a.w,
        ay = a.y + Math.round(boxH / 2),
        bx = b.x,
        by = b.y + Math.round(boxH / 2);
      if (a.lane === b.lane) {
        return arrow(ax, ay, bx, by, label, color, false, undefined, Math.round((ax + bx) / 2), ay);
      }
      var cx = Math.round((ax + bx) / 2);
      return arrow(
        ax,
        ay,
        bx,
        by,
        label,
        color,
        false,
        poly([
          [ax, ay],
          [cx, ay],
          [cx, by],
          [bx, by],
        ]),
        cx,
        Math.round((ay + by) / 2)
      );
    }

    p.push(link(steps[0], steps[1], 'giao việc', C.operator));
    p.push(link(steps[1], steps[2], 'tạo việc', C.dispatch));
    p.push(link(steps[2], steps[3], 'xong mã', C.worker));
    p.push(link(steps[3], steps[4], 'kích hoạt', C.worker));
    p.push(link(steps[4], steps[5], 'đạt CI', C.gate));
    p.push(link(steps[5], steps[6], 'duyệt', C.gate));
    p.push(link(steps[6], steps[7], 'gộp', C.result));
    p.push(link(steps[7], steps[8], 'ghi nhận', C.result));

    // 6. Quay lui nếu CHANGES_REQUIRED về làn Thợ (sửa theo review):
    // xuất phát từ đáy hộp review, chạy ngang dưới làn Kiểm chứng rồi
    // đi lên gặp đáy hộp "chạy trong worktree riêng" ở làn Thợ — không cắt qua hộp nào.
    var fbFrom = steps[5],
      fbTo = steps[2];
    var fbX1 = fbFrom.x + Math.round(fbFrom.w / 2),
      fbX2 = fbTo.x + Math.round(fbTo.w / 2);
    var fbY = lanes[3].y + laneH + Math.round(laneGap / 2);
    p.push(
      arrow(
        fbX1,
        fbFrom.y + boxH,
        fbX2,
        fbTo.y + boxH,
        'nếu CHANGES_REQUIRED: sửa theo review',
        C.alert,
        false,
        poly([
          [fbX1, fbFrom.y + boxH],
          [fbX1, fbY],
          [fbX2, fbY],
          [fbX2, fbTo.y + boxH],
        ]),
        Math.round((fbX1 + fbX2) / 2),
        fbY
      )
    );

    // 10. cập nhật register → quay về làn Người vận hành (mũi tên đứt,
    // mở khoá việc kế tiếp): đi dưới mọi làn rồi lên lại hộp đầu tiên.
    var lpFrom = steps[8],
      lpTo = steps[0];
    var lpX1 = lpFrom.x + Math.round(lpFrom.w / 2),
      lpX2 = lpTo.x + Math.round(lpTo.w / 2);
    var lpY = lanes[4].y + laneH + 24;
    p.push(
      arrow(
        lpX1,
        lpFrom.y + boxH,
        lpX2,
        lpTo.y + boxH,
        'mở khoá việc kế tiếp',
        C.operator,
        true,
        poly([
          [lpX1, lpFrom.y + boxH],
          [lpX1, lpY],
          [lpX2, lpY],
          [lpX2, lpTo.y + boxH],
        ]),
        Math.round((lpX1 + lpX2) / 2),
        lpY
      )
    );

    return (
      '<svg viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" class="w-full h-auto block" style="min-width:' +
      Math.round(W * 0.8) +
      'px">' +
      p.join('') +
      '</svg>'
    );
  }

  function render(m) {
    var host = document.getElementById('architecture-diagram');
    if (!host) return;

    // Tự dọn dẹp nhãn 4 cột cũ nếu còn sót lại ở tiêu đề thẻ cha
    var prev = host.previousElementSibling;
    if (prev) {
      var oldLegend = prev.querySelector('.flex.gap-3');
      if (oldLegend) oldLegend.innerHTML = '';
    }

    var badgesHtml = '';
    var badgeItems = [];
    if (m.totalWorkItems != null) {
      badgeItems.push(
        '<span class="badge badge-sm badge-neutral">Tổng việc: <b>' +
          esc(m.totalWorkItems) +
          '</b></span>'
      );
    }
    if (m.dispatchCount != null) {
      badgeItems.push(
        '<span class="badge badge-sm badge-neutral">Lượt dispatch: <b>' +
          esc(m.dispatchCount) +
          '</b></span>'
      );
    }
    if (m.reviewCount != null) {
      badgeItems.push(
        '<span class="badge badge-sm badge-warning">Chờ review: <b>' +
          esc(m.reviewCount) +
          '</b></span>'
      );
    }
    if (m.mergedCount != null) {
      badgeItems.push(
        '<span class="badge badge-sm badge-success text-white">Đã gộp: <b>' +
          esc(m.mergedCount) +
          '</b></span>'
      );
    }
    if (badgeItems.length > 0) {
      badgesHtml =
        '<div class="flex flex-wrap gap-2 pt-1 pb-2 border-b border-base-300">' +
        badgeItems.join('') +
        '</div>';
    }

    var html =
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
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.machine +
      '"></span> Máy của bạn</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.docker +
      '"></span> Dịch vụ nền</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.cloud +
      '"></span> Dịch vụ ngoài</span>' +
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
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.operator +
      '"></span> Người vận hành</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.dispatch +
      '"></span> Điều phối</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.worker +
      '"></span> Thợ</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.gate +
      '"></span> Kiểm chứng</span>' +
      '      <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:' +
      C.result +
      '"></span> Kết quả</span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="overflow-x-auto rounded-xl border border-base-300 bg-base-100 p-2">' +
      renderDiagram2(m) +
      '  </div>' +
      '</div>' +
      '</div>';

    host.innerHTML = html;
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
      var state = res[0],
        rot = res[1],
        m = {};
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
