import type { ExportGenerationMetadata } from '@shipde/contracts';
import { EMBEDDED_FONTS, type EmbeddedFont } from '../fonts/embedded-fonts';
import { parseTtf, type TtfFont } from '../fonts/ttf';

/**
 * Wraps text into multiple lines based on measured column width and font size.
 * Prevents truncation, data loss, or ellipsis shortening.
 */
export function wrapText(text: string, maxWidthPt: number, fontSizePt: number = 8): string[] {
  if (!text) return [''];
  const availableWidth = Math.max(1, maxWidthPt - 6);
  const font = parsedFonts.regular;
  const widthOf = (value: string): number =>
    Array.from(value).reduce((width, ch) => {
      const gid = font.unicodeToGid.get(ch.codePointAt(0) ?? 0) ?? 0;
      return width + (font.advanceWidths[gid] * fontSizePt) / font.unitsPerEm;
    }, 0);
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let currentLine = '';
    for (const word of paragraph.split(' ')) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (widthOf(nextLine) <= availableWidth) {
        currentLine = nextLine;
        continue;
      }
      if (currentLine) lines.push(currentLine);
      currentLine = '';
      for (const ch of word) {
        if (currentLine && widthOf(currentLine + ch) > availableWidth) {
          lines.push(currentLine);
          currentLine = '';
        }
        currentLine += ch;
      }
    }
    lines.push(currentLine);
  }
  return lines;
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

// Parse the embedded Unicode-capable fonts once at module load.
const REGULAR_ID = 'noto-sans-regular';
const BOLD_ID = 'noto-sans-bold';

function resolveEmbedded(id: string): EmbeddedFont {
  const found = EMBEDDED_FONTS.find((f) => f.id === id);
  if (!found) throw new Error(`Embedded font not found: ${id}`);
  return found;
}

const parsedFonts: { regular: TtfFont; bold: TtfFont } = {
  regular: parseTtf(resolveEmbedded(REGULAR_ID).bytes),
  bold: parseTtf(resolveEmbedded(BOLD_ID).bytes),
};

/**
 * Encodes a string as a PDF hex string of 2-byte glyph ids for the given font.
 *
 * Uses the font's cmap (Unicode code point -> glyph id) so the Identity-H CID
 * font renders the actual glyphs (including Vietnamese diacritics) instead of
 * treating Unicode code points as glyph ids. Unknown code points fall back to
 * the .notdef glyph (id 0).
 */
function encodeGlyphHex(str: unknown, font: TtfFont): string {
  if (str === null || str === undefined) return '<>';
  const s = String(str);
  const bytes: number[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const gid = font.unicodeToGid.get(code) ?? 0;
    bytes.push((gid >> 8) & 0xff, gid & 0xff);
  }
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `<${hex}>`;
}

/**
 * Builds a ToUnicode CMap that maps each glyph id back to its Unicode code
 * point, enabling faithful text extraction/search for the embedded font.
 */
function buildToUnicodeCMap(font: TtfFont): string {
  const entries: string[] = [];
  for (const [gid, code] of font.gidToUnicode) {
    entries.push(`<${gid.toString(16).padStart(4, '0')}> <${code.toString(16).padStart(4, '0')}>`);
  }
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const block = entries.slice(i, i + 100);
    blocks.push(`${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Embedded-ToUnicode def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${blocks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

/**
 * Builds the CIDFontType2 /W widths array (per-glyph advance widths in
 * 1/1000 text-space units) so embedded text advances with the real metrics.
 */
function buildWidthsArray(font: TtfFont): string {
  // Emit a flat array of 3-element [cidFirst cidLast width] range entries, the
  // unambiguous form used by conforming PDF producers (ISO 32000-1 9.7.4.3).
  // Consecutive CIDs sharing a width are coalesced into one range; a width that
  // changes every CID yields a single-CID range [cid cid width].
  const flat: number[] = [];
  let i = 0;
  while (i < font.advanceWidths.length) {
    const w1000 = Math.round((font.advanceWidths[i] * 1000) / font.unitsPerEm);
    let j = i + 1;
    while (
      j < font.advanceWidths.length &&
      Math.round((font.advanceWidths[j] * 1000) / font.unitsPerEm) === w1000
    ) {
      j++;
    }
    flat.push(i, j - 1, w1000);
    i = j;
  }
  return `[${flat.join(' ')}]`;
}

/**
 * Generates a valid, conformant multi-page PDF 1.4 document buffer with exact
 * xref offsets. Renders all exported rows with measured text wrapping,
 * pagination, and an embedded Unicode-capable (Noto Sans, Vietnamese) font so
 * diacritics render reliably.
 */
export function generatePdf(
  metadata: ExportGenerationMetadata,
  headers: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): Buffer {
  const colWidths = calculateColumnWidths(headers);
  const regular = parsedFonts.regular;
  const bold = parsedFonts.bold;

  // Compute column X positions
  const colPositions: number[] = [];
  let currentX = 30;
  for (let c = 0; c < headers.length; c++) {
    colPositions.push(currentX);
    currentX += colWidths[c];
  }

  interface PageData {
    commands: string[];
  }

  const pages: PageData[] = [];
  let currentPageCommands: string[] = [];
  let currentY = 0;

  function startNewPage(isFirst: boolean) {
    if (currentPageCommands.length > 0) {
      pages.push({ commands: currentPageCommands });
    }
    currentPageCommands = [];

    if (isFirst) {
      // Header Box on Page 1
      currentPageCommands.push('0.9 0.95 1 rg 30 755 535 55 re f');
      currentPageCommands.push('0.2 0.3 0.5 RG 1 w 30 755 535 55 re S');
      currentPageCommands.push(
        `BT /F2 15 Tf 0.1 0.2 0.4 rg 45 788 Td ${encodeGlyphHex('SHIP DỄ — BÁO CÁO XUẤT DỮ LIỆU', bold)} Tj ET`
      );
      currentPageCommands.push(
        `BT /F1 9 Tf 0.3 0.3 0.3 rg 45 768 Td ${encodeGlyphHex(
          `Tài nguyên: ${metadata.resource.toUpperCase()} | Định dạng: ${metadata.format.toUpperCase()} | Ngày tạo: ${metadata.generated_at}`,
          regular
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
          `BT /F1 8 Tf 0.2 0.2 0.2 rg 38 ${metaY} Td ${encodeGlyphHex(item, regular)} Tj ET`
        );
        metaY -= 12;
      }

      currentY = metaBoxY - 15;
    } else {
      // Subsequent page compact header
      currentPageCommands.push(
        `BT /F2 10 Tf 0.2 0.3 0.5 rg 30 805 Td ${encodeGlyphHex(
          `SHIP DỄ — BÁO CÁO XUẤT [${metadata.resource.toUpperCase()}]`,
          bold
        )} Tj ET`
      );
      currentPageCommands.push(
        `BT /F1 8 Tf 0.4 0.4 0.4 rg 430 805 Td ${encodeGlyphHex(
          `Mã: ${metadata.export_id.substring(0, 8)}...`,
          regular
        )} Tj ET`
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
        `BT /F2 8.5 Tf 0.1 0.2 0.3 rg ${colX} ${currentY - 13} Td ${encodeGlyphHex(
          headers[c].label,
          bold
        )} Tj ET`
      );
    }
    currentY -= headerHeight + 4;
  }

  // Start initial page
  startNewPage(true);

  // Render Data Rows with dynamic measured wrapping and multi-page overflow (Finding 11b)
  const PAGE_BOTTOM_MARGIN = 45;
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

    // If the entire row fits on the current page, render it in one shot
    if (currentY - rowHeight >= PAGE_BOTTOM_MARGIN) {
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
            `BT /F1 7.5 Tf 0.15 0.15 0.15 rg ${colX} ${lineY} Td ${encodeGlyphHex(
              line,
              regular
            )} Tj ET`
          );
          lineY -= 10;
        }
      }

      currentY -= rowHeight;
    } else {
      // Oversized or overflowing row: split lines across pages (Finding 11b)
      let lineIndex = 0;
      while (lineIndex < maxLinesInRow) {
        // A continuation page starts at Y=790. Never force a line onto a page
        // that cannot hold it above the footer (PAGE_BOTTOM_MARGIN = 45).
        const availableHeight = currentY - PAGE_BOTTOM_MARGIN;
        const linesAvailable = Math.floor((availableHeight - 6) / 10);
        if (linesAvailable < 1) {
          startNewPage(false);
          continue;
        }
        const linesThisSlice = Math.min(linesAvailable, maxLinesInRow - lineIndex);
        const sliceHeight = linesThisSlice * 10 + 6;

        // Row background and border for this slice
        if (r % 2 === 1) {
          currentPageCommands.push(
            `0.98 0.98 0.98 rg 30 ${currentY - sliceHeight} 535 ${sliceHeight} re f`
          );
        }
        currentPageCommands.push(
          `0.9 0.9 0.9 RG 0.5 w 30 ${currentY - sliceHeight} 535 ${sliceHeight} re S`
        );

        // Render the lines for this slice from each column
        for (let c = 0; c < headers.length; c++) {
          const colX = colPositions[c] + 4;
          const lines = cellWrappedLines[c];
          let lineY = currentY - 10;
          for (let li = lineIndex; li < lineIndex + linesThisSlice && li < lines.length; li++) {
            currentPageCommands.push(
              `BT /F1 7.5 Tf 0.15 0.15 0.15 rg ${colX} ${lineY} Td ${encodeGlyphHex(
                lines[li],
                regular
              )} Tj ET`
            );
            lineY -= 10;
          }
        }

        currentY -= sliceHeight;
        lineIndex += linesThisSlice;
      }
    }
  }

  if (currentPageCommands.length > 0) {
    pages.push({ commands: currentPageCommands });
  }

  const numPages = Math.max(1, pages.length);

  // Add Footers with exact total page numbers
  const finalPageStreams: string[] = [];
  for (let p = 0; p < numPages; p++) {
    const cmds = pages[p] ? [...pages[p].commands] : [];
    cmds.push('0.7 0.7 0.7 RG 0.5 w 30 35 535 0.5 re S');
    cmds.push(
      `BT /F1 8 Tf 0.4 0.4 0.4 rg 35 24 Td ${encodeGlyphHex(
        `Tạo bởi Ship Dễ Export Engine — Trang ${p + 1}/${numPages} — Băm dữ liệu: ${metadata.checksum_sha256.substring(
          0,
          16
        )}...`,
        regular
      )} Tj ET`
    );
    finalPageStreams.push(cmds.join('\n'));
  }

  // ---- Binary-safe PDF 1.4 assembly (embedded TrueType fonts) ----
  const parts: Buffer[] = [];
  const objOffsets = new Map<number, number>();
  let totalLen = 0;
  const push = (b: Buffer): void => {
    parts.push(b);
    totalLen += b.length;
  };
  const addDictObj = (num: number, dict: string): void => {
    objOffsets.set(num, totalLen);
    push(Buffer.from(`${num} 0 obj\n${dict}\nendobj\n`, 'latin1'));
  };
  const addStreamObj = (num: number, dict: string, stream: Buffer): void => {
    objOffsets.set(num, totalLen);
    push(Buffer.from(`${num} 0 obj\n${dict}\nstream\n`, 'latin1'));
    push(stream);
    push(Buffer.from(`\nendstream\nendobj\n`, 'latin1'));
  };

  // Object numbering:
  // 1 Catalog, 2 Pages,
  // 3 F1(Type0), 4 F2(Type0), 5 CID(F1), 6 CID(F2),
  // 7 ToUnicode(F1), 8 ToUnicode(F2), 9 FontDescriptor(F1), 10 FontDescriptor(F2),
  // 11 FontFile2(F1), 12 FontFile2(F2),
  // 13+2i Page(i), 14+2i Contents(i)

  const regularFont = resolveEmbedded(REGULAR_ID);
  const boldFont = resolveEmbedded(BOLD_ID);

  // Header
  push(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n% SHIP DE - EXPORT REPORT\n', 'latin1'));

  // Object 1: Catalog
  addDictObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

  // Object 2: Pages
  const pageKidsRefs: string[] = [];
  for (let i = 0; i < numPages; i++) {
    pageKidsRefs.push(`${13 + i * 2} 0 R`);
  }
  addDictObj(2, `<< /Type /Pages /Kids [${pageKidsRefs.join(' ')}] /Count ${numPages} >>`);

  // Object 3: Font F1 (Type 0 composite, regular)
  addDictObj(
    3,
    '<< /Type /Font /Subtype /Type0 /BaseFont /NotoSans-Regular /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>'
  );

  // Object 4: Font F2 (Type 0 composite, bold)
  addDictObj(
    4,
    '<< /Type /Font /Subtype /Type0 /BaseFont /NotoSans-Bold /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>'
  );

  // Object 5: CIDFontType2 for F1
  addDictObj(
    5,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSans-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /DW 1000 /W ${buildWidthsArray(
      regular
    )} >>`
  );

  // Object 6: CIDFontType2 for F2
  addDictObj(
    6,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSans-Bold /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 10 0 R /DW 1000 /W ${buildWidthsArray(
      bold
    )} >>`
  );

  // Object 7: ToUnicode CMap for F1
  const toUnicodeRegular = buildToUnicodeCMap(regular);
  addStreamObj(
    7,
    `<< /Length ${Buffer.byteLength(toUnicodeRegular, 'latin1')} >>`,
    Buffer.from(toUnicodeRegular, 'latin1')
  );

  // Object 8: ToUnicode CMap for F2
  const toUnicodeBold = buildToUnicodeCMap(bold);
  addStreamObj(
    8,
    `<< /Length ${Buffer.byteLength(toUnicodeBold, 'latin1')} >>`,
    Buffer.from(toUnicodeBold, 'latin1')
  );

  // Object 9: FontDescriptor for F1 (regular) with embedded font program
  addDictObj(
    9,
    `<< /Type /FontDescriptor /FontName /NotoSans-Regular /Flags 32 /FontBBox [${regular.xMin} ${regular.yMin} ${regular.xMax} ${regular.yMax}] /ItalicAngle 0 /Ascent ${regular.ascender} /Descent ${regular.descender} /CapHeight ${regular.ascender} /StemV 80 /FontFile2 11 0 R >>`
  );

  // Object 10: FontDescriptor for F2 (bold) with embedded font program
  addDictObj(
    10,
    `<< /Type /FontDescriptor /FontName /NotoSans-Bold /Flags 32 /FontBBox [${bold.xMin} ${bold.yMin} ${bold.xMax} ${bold.yMax}] /ItalicAngle 0 /Ascent ${bold.ascender} /Descent ${bold.descender} /CapHeight ${bold.ascender} /StemV 110 /FontFile2 12 0 R >>`
  );

  // Object 11: FontFile2 (regular TrueType program, uncompressed)
  addStreamObj(
    11,
    `<< /Length ${regularFont.bytes.length} /Length1 ${regularFont.bytes.length} >>`,
    regularFont.bytes
  );

  // Object 12: FontFile2 (bold TrueType program, uncompressed)
  addStreamObj(
    12,
    `<< /Length ${boldFont.bytes.length} /Length1 ${boldFont.bytes.length} >>`,
    boldFont.bytes
  );

  // Page and Content objects for each page
  for (let i = 0; i < numPages; i++) {
    const pageObjNum = 13 + i * 2;
    const contentsObjNum = 14 + i * 2;
    const streamBody = finalPageStreams[i];
    const streamBuffer = Buffer.from(streamBody, 'latin1');

    addDictObj(
      pageObjNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${contentsObjNum} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );

    addStreamObj(contentsObjNum, `<< /Length ${streamBuffer.length} >>`, streamBuffer);
  }

  const totalObjects = 12 + numPages * 2;

  // Cross-reference table
  const startXref = totalLen;
  push(Buffer.from(`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`, 'latin1'));
  for (let i = 1; i <= totalObjects; i++) {
    const offset = objOffsets.get(i) ?? 0;
    push(Buffer.from(`${String(offset).padStart(10, '0')} 00000 n \n`, 'latin1'));
  }

  // Trailer
  push(
    Buffer.from(
      `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`,
      'latin1'
    )
  );

  return Buffer.concat(parts);
}
