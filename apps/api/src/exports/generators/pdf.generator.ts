import { ExportGenerationMetadata } from '@shipde/contracts';

/**
 * Encodes any string into PDF UTF-16BE hex string format for Type 0 CID font rendering.
 * Preserves 100% of Unicode characters including Vietnamese diacritics without data loss.
 */
export function toPdfHex(str: unknown): string {
  if (str === null || str === undefined) return '<>';
  const s = String(str);
  const buf = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    buf.writeUInt16BE(s.charCodeAt(i), i * 2);
  }
  return `<${buf.toString('hex')}>`;
}

/**
 * Wraps text into multiple lines based on measured column width and font size.
 * Prevents truncation, data loss, or ellipsis shortening (Finding 8).
 */
export function wrapText(text: string, maxWidthPt: number, fontSizePt: number = 8): string[] {
  if (!text) return [''];
  const avgCharWidth = fontSizePt * 0.55;
  const maxCharsPerLine = Math.max(4, Math.floor((maxWidthPt - 6) / avgCharWidth));

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      for (let i = 0; i < word.length; i += maxCharsPerLine) {
        lines.push(word.substring(i, i + maxCharsPerLine));
      }
      continue;
    }

    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Dynamically distributes column widths across the available 535pt table area.
 */
export function calculateColumnWidths(headers: { key: string; label: string }[]): number[] {
  const totalTableWidth = 535;
  if (headers.length === 0) return [];

  const weights = headers.map((h) => {
    const k = h.key.toLowerCase();
    if (k === 'id') return 1.4;
    if (k === 'created_at' || k === 'generated_at') return 1.3;
    if (k === 'address_line' || k === 'rule_note') return 2.2;
    if (
      k === 'email' ||
      k === 'contact_email' ||
      k === 'name' ||
      k === 'full_name' ||
      k === 'metric_name'
    )
      return 1.8;
    if (k === 'code' || k === 'metric_code') return 1.2;
    if (k === 'phone' || k === 'contact_phone') return 1.2;
    if (k === 'city' || k === 'district' || k === 'ledger_group') return 1.3;
    if (k === 'status' || k === 'is_default' || k === 'role' || k === 'unit') return 0.9;
    return 1.0;
  });

  const sumWeights = weights.reduce((acc, w) => acc + w, 0);
  return weights.map((w) => Math.max(35, Math.floor((w / sumWeights) * totalTableWidth)));
}

/**
 * Generates a valid conformant multi-page PDF 1.4 document buffer with exact xref offsets.
 * Renders all exported rows with measured text wrapping, pagination, and Unicode diacritics.
 */
export function generatePdf(
  metadata: ExportGenerationMetadata,
  headers: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): Buffer {
  const colWidths = calculateColumnWidths(headers);

  // Compute column X positions
  const colPositions: number[] = [];
  let currentX = 30;
  for (let c = 0; c < headers.length; c++) {
    colPositions.push(currentX);
    currentX += colWidths[c];
  }

  interface PageData {
    commands: string[];
    isFirstPage: boolean;
  }

  const pages: PageData[] = [];
  let currentPageCommands: string[] = [];
  let currentY = 0;

  function startNewPage(isFirst: boolean) {
    if (currentPageCommands.length > 0) {
      pages.push({ commands: currentPageCommands, isFirstPage: pages.length === 0 });
    }
    currentPageCommands = [];

    if (isFirst) {
      // Header Box on Page 1
      currentPageCommands.push('0.9 0.95 1 rg 30 755 535 55 re f');
      currentPageCommands.push('0.2 0.3 0.5 RG 1 w 30 755 535 55 re S');
      currentPageCommands.push(
        `BT /F2 15 Tf 0.1 0.2 0.4 rg 45 788 Td ${toPdfHex('SHIP DỄ — BÁO CÁO XUẤT DỮ LIỆU')} Tj ET`
      );
      currentPageCommands.push(
        `BT /F1 9 Tf 0.3 0.3 0.3 rg 45 768 Td ${toPdfHex(
          `Tài nguyên: ${metadata.resource.toUpperCase()} | Định dạng: ${metadata.format.toUpperCase()} | Ngày tạo: ${metadata.generated_at}`
        )} Tj ET`
      );

      // Metadata Banner Box
      const metaRows: string[] = [
        `Mã xuất (ID): ${metadata.export_id}`,
        `Cửa hàng (Tenant): ${metadata.merchant_id} | Người yêu cầu: ${metadata.requested_by} (${metadata.user_role})`,
        `Phiên bản quy tắc: ${metadata.rule_version} | Tổng số dòng: ${metadata.total_rows} (Thành công: ${metadata.succeeded_rows}, Lỗi/Bỏ qua: ${metadata.failed_rows})`,
        `Bộ lọc: ${JSON.stringify(metadata.filters || {})}`,
        `Mã băm dữ liệu (SHA-256): ${metadata.checksum_sha256}`,
      ];

      if (metadata.truncation_note) {
        metaRows.push(`Ghi chú giới hạn: ${metadata.truncation_note}`);
      }

      const metaBoxHeight = metaRows.length * 12 + 10;
      const metaBoxY = 740 - metaBoxHeight;
      currentPageCommands.push(`0.96 0.96 0.96 rg 30 ${metaBoxY} 535 ${metaBoxHeight} re f`);
      currentPageCommands.push(`0.8 0.8 0.8 RG 0.5 w 30 ${metaBoxY} 535 ${metaBoxHeight} re S`);

      let metaY = metaBoxY + metaBoxHeight - 12;
      for (const item of metaRows) {
        currentPageCommands.push(
          `BT /F1 8 Tf 0.2 0.2 0.2 rg 38 ${metaY} Td ${toPdfHex(item)} Tj ET`
        );
        metaY -= 12;
      }

      currentY = metaBoxY - 15;
    } else {
      // Subsequent page compact header
      currentPageCommands.push(
        `BT /F2 10 Tf 0.2 0.3 0.5 rg 30 805 Td ${toPdfHex(`SHIP DỄ — BÁO CÁO XUẤT [${metadata.resource.toUpperCase()}]`)} Tj ET`
      );
      currentPageCommands.push(
        `BT /F1 8 Tf 0.4 0.4 0.4 rg 430 805 Td ${toPdfHex(`Mã: ${metadata.export_id.substring(0, 8)}...`)} Tj ET`
      );
      currentY = 790;
    }

    // Render Table Header Row on every page
    const headerHeight = 18;
    currentPageCommands.push(
      `0.85 0.9 0.95 rg 30 ${currentY - headerHeight} 535 ${headerHeight} re f`
    );
    currentPageCommands.push(
      `0.6 0.7 0.8 RG 1 w 30 ${currentY - headerHeight} 535 ${headerHeight} re S`
    );

    for (let c = 0; c < headers.length; c++) {
      const colX = colPositions[c] + 4;
      currentPageCommands.push(
        `BT /F2 8.5 Tf 0.1 0.2 0.3 rg ${colX} ${currentY - 13} Td ${toPdfHex(headers[c].label)} Tj ET`
      );
    }
    currentY -= headerHeight + 4;
  }

  // Start initial page
  startNewPage(true);

  // Render Data Rows with dynamic measured wrapping
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];

    // Compute wrapped lines for every cell in this row
    const cellWrappedLines: string[][] = [];
    let maxLinesInRow = 1;
    for (let c = 0; c < headers.length; c++) {
      const width = colWidths[c];
      const val = row[headers[c].key];
      const rawCell = String(val === null || val === undefined ? '' : val);
      const lines = wrapText(rawCell, width - 6, 7.5);
      cellWrappedLines.push(lines);
      if (lines.length > maxLinesInRow) {
        maxLinesInRow = lines.length;
      }
    }

    const rowHeight = Math.max(16, maxLinesInRow * 10 + 6);

    // If row exceeds available page height, move to next page
    if (currentY - rowHeight < 45) {
      startNewPage(false);
    }

    // Row background and border
    if (r % 2 === 1) {
      currentPageCommands.push(
        `0.98 0.98 0.98 rg 30 ${currentY - rowHeight} 535 ${rowHeight} re f`
      );
    }
    currentPageCommands.push(
      `0.9 0.9 0.9 RG 0.5 w 30 ${currentY - rowHeight} 535 ${rowHeight} re S`
    );

    // Render cell text lines
    for (let c = 0; c < headers.length; c++) {
      const colX = colPositions[c] + 4;
      const lines = cellWrappedLines[c];
      let lineY = currentY - 10;
      for (const line of lines) {
        currentPageCommands.push(
          `BT /F1 7.5 Tf 0.15 0.15 0.15 rg ${colX} ${lineY} Td ${toPdfHex(line)} Tj ET`
        );
        lineY -= 10;
      }
    }

    currentY -= rowHeight;
  }

  if (currentPageCommands.length > 0) {
    pages.push({ commands: currentPageCommands, isFirstPage: pages.length === 0 });
  }

  const numPages = Math.max(1, pages.length);

  // Add Footers with exact total page numbers
  const finalPageStreams: string[] = [];
  for (let p = 0; p < numPages; p++) {
    const cmds = pages[p] ? [...pages[p].commands] : [];
    cmds.push('0.7 0.7 0.7 RG 0.5 w 30 35 535 0.5 re S');
    cmds.push(
      `BT /F1 8 Tf 0.4 0.4 0.4 rg 35 24 Td ${toPdfHex(
        `Tạo bởi Ship Dễ Export Engine — Trang ${p + 1}/${numPages} — Băm dữ liệu: ${metadata.checksum_sha256.substring(
          0,
          16
        )}...`
      )} Tj ET`
    );
    finalPageStreams.push(cmds.join('\n'));
  }

  // Build PDF 1.4 Objects with Type 0 Composite Font & ToUnicode CMap
  const parts: string[] = [];
  const byteOffsets: number[] = [];

  parts.push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n% SHIP DE - EXPORT REPORT\n');

  function addObject(objNum: number, content: string) {
    const currentOffset = Buffer.byteLength(parts.join(''), 'latin1');
    byteOffsets[objNum] = currentOffset;
    parts.push(`${objNum} 0 obj\n${content}\nendobj\n`);
  }

  // Object 1: Catalog
  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');

  // Object 2: Pages
  const pageKidsRefs: string[] = [];
  for (let i = 0; i < numPages; i++) {
    pageKidsRefs.push(`${10 + i * 2} 0 R`);
  }
  addObject(2, `<< /Type /Pages /Kids [${pageKidsRefs.join(' ')}] /Count ${numPages} >>`);

  // Object 3: Font F1 (Type 0 composite font)
  addObject(
    3,
    '<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>'
  );

  // Object 4: Font F2 (Type 0 composite font bold)
  addObject(
    4,
    '<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica-Bold /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'
  );

  // Object 5: CIDFontType2 for F1
  addObject(
    5,
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 600 >>'
  );

  // Object 6: CIDFontType2 for F2
  addObject(
    6,
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica-Bold /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /DW 600 >>'
  );

  // Object 7: ToUnicode CMap
  const toUnicodeCMap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Custom-ToUnicode def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  addObject(7, `<< /Length ${toUnicodeCMap.length} >>\nstream\n${toUnicodeCMap}\nendstream`);

  // Object 8: FontDescriptor for F1
  addObject(
    8,
    '<< /Type /FontDescriptor /FontName /Helvetica /Flags 32 /FontBBox [-100 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>'
  );

  // Object 9: FontDescriptor for F2
  addObject(
    9,
    '<< /Type /FontDescriptor /FontName /Helvetica-Bold /Flags 32 /FontBBox [-100 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 120 >>'
  );

  // Add Page and Content objects for each page (objects 10, 11, 12, 13...)
  for (let i = 0; i < numPages; i++) {
    const pageObjNum = 10 + i * 2;
    const contentsObjNum = 11 + i * 2;
    const streamBody = finalPageStreams[i];
    const streamLength = Buffer.byteLength(streamBody, 'latin1');

    // Page object
    addObject(
      pageObjNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${contentsObjNum} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );

    // Contents object
    addObject(contentsObjNum, `<< /Length ${streamLength} >>\nstream\n${streamBody}\nendstream`);
  }

  const totalObjects = 9 + numPages * 2;

  // Cross-reference table
  const startXref = Buffer.byteLength(parts.join(''), 'latin1');
  parts.push(`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= totalObjects; i++) {
    const offsetStr = String(byteOffsets[i]).padStart(10, '0');
    parts.push(`${offsetStr} 00000 n \n`);
  }

  // Trailer
  parts.push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`
  );

  return Buffer.from(parts.join(''), 'latin1');
}
