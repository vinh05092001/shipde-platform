import { ExportGenerationMetadata } from '@shipde/contracts';

/**
 * Transliterates Vietnamese diacritics to clean, readable ASCII Latin characters (Finding 8).
 * Prevents corrupted multi-byte UTF-8 glyph sequences when rendered via PDF WinAnsi Helvetica font.
 */
export function normalizeVietnameseText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Escapes characters for PDF literal text strings in content streams.
 * Sanitizes multi-byte characters to WinAnsi-safe ASCII and escapes PDF special characters.
 */
export function escapePdfText(str: unknown): string {
  if (str === null || str === undefined) return '';
  const normalized = normalizeVietnameseText(String(str));
  return normalized
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');
}

/**
 * Truncates text with ellipsis to strictly fit inside a column width, preventing
 * overflow and overlapping adjacent columns (Finding 8).
 */
export function fitCellText(text: string, maxWidthPt: number, fontSizePt: number = 8): string {
  const avgCharWidthPt = fontSizePt * 0.52;
  const maxChars = Math.max(3, Math.floor((maxWidthPt - 6) / avgCharWidthPt));
  if (text.length > maxChars) {
    return text.substring(0, Math.max(1, maxChars - 2)) + '..';
  }
  return text;
}

/**
 * Dynamically distributes column widths across the available 535pt table area (Finding 8).
 */
function calculateColumnWidths(headers: { key: string; label: string }[]): number[] {
  const totalTableWidth = 535;
  if (headers.length === 0) return [];

  const weights = headers.map((h) => {
    const k = h.key.toLowerCase();
    if (k === 'id') return 1.4;
    if (k === 'created_at' || k === 'generated_at') return 1.4;
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
 * Renders all exported rows across paginated pages without dropping records or overlapping cells.
 */
export function generatePdf(
  metadata: ExportGenerationMetadata,
  headers: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): Buffer {
  const colWidths = calculateColumnWidths(headers);

  // Compute column X positions
  const colPositions: number[] = [];
  let currentX = 35;
  for (let c = 0; c < headers.length; c++) {
    colPositions.push(currentX);
    currentX += colWidths[c];
  }

  // Determine pagination: Page 1 holds up to 32 rows (due to metadata header block).
  // Subsequent pages hold up to 45 rows.
  const page1Capacity = 32;
  const subsequentPageCapacity = 45;

  const pagesData: Record<string, unknown>[][] = [];
  if (rows.length === 0) {
    pagesData.push([]);
  } else {
    pagesData.push(rows.slice(0, page1Capacity));
    let currentIdx = page1Capacity;
    while (currentIdx < rows.length) {
      pagesData.push(rows.slice(currentIdx, currentIdx + subsequentPageCapacity));
      currentIdx += subsequentPageCapacity;
    }
  }

  const numPages = pagesData.length;
  const pageStreams: string[] = [];

  for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
    const pageRows = pagesData[pageIdx];
    const commands: string[] = [];

    if (pageIdx === 0) {
      // --- PAGE 1 HEADER & METADATA ---
      // Header Box
      commands.push('0.9 0.95 1 rg 30 755 535 55 re f'); // Light blue background
      commands.push('0.2 0.3 0.5 RG 1 w 30 755 535 55 re S'); // Border

      // Title
      commands.push('BT /F2 15 Tf 0.1 0.2 0.4 rg 45 788 Td (SHIP DE - EXPORT REPORT) Tj ET');

      // Metadata Subtitle
      commands.push(
        `BT /F1 9 Tf 0.3 0.3 0.3 rg 45 768 Td (Resource: ${escapePdfText(
          metadata.resource
        )} | Format: ${metadata.format.toUpperCase()} | Generated: ${escapePdfText(
          metadata.generated_at
        )}) Tj ET`
      );

      // Metadata Details Box
      const metaRows = [
        `Export ID: ${metadata.export_id}`,
        `Tenant ID: ${metadata.merchant_id}`,
        `Requested By: ${metadata.requested_by} (${metadata.user_role})`,
        `Rule Version: ${metadata.rule_version} | Records: ${metadata.total_rows} (Succeeded: ${metadata.succeeded_rows}, Failed: ${metadata.failed_rows})`,
        `Filters: ${JSON.stringify(metadata.filters || {})}`,
        `Data Payload Checksum (SHA-256): ${metadata.checksum_sha256}`,
      ];

      if (metadata.truncation_note) {
        metaRows.push(`Truncation Note: ${metadata.truncation_note}`);
      }

      const metaBoxHeight = 15 + metaRows.length * 11;
      const metaBoxY = 745 - metaBoxHeight;
      commands.push(`0.96 0.96 0.96 rg 30 ${metaBoxY} 535 ${metaBoxHeight} re f`);
      commands.push(`0.8 0.8 0.8 RG 0.5 w 30 ${metaBoxY} 535 ${metaBoxHeight} re S`);

      let metaY = metaBoxY + metaBoxHeight - 14;
      for (const item of metaRows) {
        const safeItem = fitCellText(escapePdfText(item), 515, 8);
        commands.push(
          `BT /F1 8 Tf 0.2 0.2 0.2 rg 40 ${metaY} Td (${escapePdfText(safeItem)}) Tj ET`
        );
        metaY -= 11;
      }

      // Table Header row (Page 1)
      const tableTopY = metaBoxY - 20;
      commands.push(`0.85 0.9 0.95 rg 30 ${tableTopY - 15} 535 18 re f`);
      commands.push(`0.6 0.7 0.8 RG 1 w 30 ${tableTopY - 15} 535 18 re S`);

      for (let c = 0; c < headers.length; c++) {
        const colX = colPositions[c];
        const width = colWidths[c];
        const safeHeader = fitCellText(escapePdfText(headers[c].label), width - 4, 9);
        commands.push(
          `BT /F2 9 Tf 0.1 0.2 0.3 rg ${colX} ${tableTopY - 11} Td (${escapePdfText(
            safeHeader
          )}) Tj ET`
        );
      }

      // Data Rows (Page 1)
      let rowY = tableTopY - 30;
      for (let r = 0; r < pageRows.length; r++) {
        const row = pageRows[r];
        if (r % 2 === 1) {
          commands.push(`0.98 0.98 0.98 rg 30 ${rowY - 4} 535 14 re f`);
        }
        commands.push(`0.9 0.9 0.9 RG 0.5 w 30 ${rowY - 4} 535 14 re S`);

        for (let c = 0; c < headers.length; c++) {
          const colX = colPositions[c];
          const width = colWidths[c];
          const val = row[headers[c].key];
          const rawCell = String(val === null || val === undefined ? '' : val);
          const safeCell = fitCellText(escapePdfText(rawCell), width - 4, 8);
          commands.push(
            `BT /F1 8 Tf 0.2 0.2 0.2 rg ${colX} ${rowY} Td (${escapePdfText(safeCell)}) Tj ET`
          );
        }
        rowY -= 15;
      }
    } else {
      // --- SUBSEQUENT PAGES (2..N) ---
      // Compact top banner
      commands.push(
        `BT /F2 10 Tf 0.2 0.3 0.5 rg 35 800 Td (SHIP DE - EXPORT REPORT [${escapePdfText(
          metadata.resource
        ).toUpperCase()}]) Tj ET`
      );
      commands.push(
        `BT /F1 8 Tf 0.4 0.4 0.4 rg 450 800 Td (Export ID: ${escapePdfText(
          metadata.export_id.substring(0, 8)
        )}) Tj ET`
      );

      // Table Header row (Subsequent pages)
      const tableTopY = 780;
      commands.push(`0.85 0.9 0.95 rg 30 ${tableTopY - 15} 535 18 re f`);
      commands.push(`0.6 0.7 0.8 RG 1 w 30 ${tableTopY - 15} 535 18 re S`);

      for (let c = 0; c < headers.length; c++) {
        const colX = colPositions[c];
        const width = colWidths[c];
        const safeHeader = fitCellText(escapePdfText(headers[c].label), width - 4, 9);
        commands.push(
          `BT /F2 9 Tf 0.1 0.2 0.3 rg ${colX} ${tableTopY - 11} Td (${escapePdfText(
            safeHeader
          )}) Tj ET`
        );
      }

      // Data Rows (Subsequent pages)
      let rowY = tableTopY - 30;
      for (let r = 0; r < pageRows.length; r++) {
        const row = pageRows[r];
        if (r % 2 === 1) {
          commands.push(`0.98 0.98 0.98 rg 30 ${rowY - 4} 535 14 re f`);
        }
        commands.push(`0.9 0.9 0.9 RG 0.5 w 30 ${rowY - 4} 535 14 re S`);

        for (let c = 0; c < headers.length; c++) {
          const colX = colPositions[c];
          const width = colWidths[c];
          const val = row[headers[c].key];
          const rawCell = String(val === null || val === undefined ? '' : val);
          const safeCell = fitCellText(escapePdfText(rawCell), width - 4, 8);
          commands.push(
            `BT /F1 8 Tf 0.2 0.2 0.2 rg ${colX} ${rowY} Td (${escapePdfText(safeCell)}) Tj ET`
          );
        }
        rowY -= 15;
      }
    }

    // Page Footer (on every page)
    commands.push('0.7 0.7 0.7 RG 0.5 w 30 40 535 0.5 re S');
    commands.push(
      `BT /F1 8 Tf 0.4 0.4 0.4 rg 35 28 Td (Generated by Ship De Export Engine - Trang ${
        pageIdx + 1
      }/${numPages} - SHA256: ${metadata.checksum_sha256.substring(0, 16)}...) Tj ET`
    );

    pageStreams.push(commands.join('\n'));
  }

  // Build PDF 1.4 Objects
  const parts: string[] = [];
  const byteOffsets: number[] = [];

  parts.push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  function addObject(objNum: number, content: string) {
    const currentOffset = Buffer.byteLength(parts.join(''), 'latin1');
    byteOffsets[objNum] = currentOffset;
    parts.push(`${objNum} 0 obj\n${content}\nendobj\n`);
  }

  // Object 1: Catalog
  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');

  // Page object numbers:
  // For each page i (0..numPages-1):
  // Page object number: 5 + i * 2
  // Contents object number: 6 + i * 2
  const pageKidsRefs: string[] = [];
  for (let i = 0; i < numPages; i++) {
    pageKidsRefs.push(`${5 + i * 2} 0 R`);
  }

  // Object 2: Pages
  addObject(2, `<< /Type /Pages /Kids [${pageKidsRefs.join(' ')}] /Count ${numPages} >>`);

  // Object 3: Font F1 (Helvetica)
  addObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  // Object 4: Font F2 (Helvetica-Bold)
  addObject(
    4,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  // Add Page and Content objects for each page
  for (let i = 0; i < numPages; i++) {
    const pageObjNum = 5 + i * 2;
    const contentsObjNum = 6 + i * 2;
    const streamBody = pageStreams[i];
    const streamLength = Buffer.byteLength(streamBody, 'latin1');

    // Page object
    addObject(
      pageObjNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${contentsObjNum} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );

    // Contents object
    addObject(contentsObjNum, `<< /Length ${streamLength} >>\nstream\n${streamBody}\nendstream`);
  }

  const totalObjects = 4 + numPages * 2;

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
