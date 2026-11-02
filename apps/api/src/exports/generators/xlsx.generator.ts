import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';
import type { ExportGenerationMetadata } from '@shipde/contracts';

/**
 * Escapes characters for XML attributes and text nodes.
 */
export function escapeXml(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts a 0-based column index to Excel column letters (0 -> A, 25 -> Z, 26 -> AA).
 */
export function getColumnLetter(colIndex: number): string {
  let letter = '';
  let temp = colIndex + 1;
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * Packs multiple named files into a standard PKZIP archive buffer using deflate compression.
 */
export function packZip(files: Array<{ name: string; data: Buffer | string }>): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const dataBuf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf-8');
    const compData = deflateRawSync(dataBuf);
    const nameBuf = Buffer.from(f.name, 'utf-8');
    const crc = crc32(dataBuf);

    // Local file header (30 bytes + filename)
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // Local header signature: PK\x03\x04
    lh.writeUInt16LE(20, 4); // Minimum version needed to extract (2.0)
    lh.writeUInt16LE(0, 6); // General purpose bit flag
    lh.writeUInt16LE(8, 8); // Compression method (8 = Deflate)
    lh.writeUInt16LE(0, 10); // File last modification time
    lh.writeUInt16LE(0, 12); // File last modification date
    lh.writeUInt32LE(crc, 14); // CRC-32 of uncompressed data
    lh.writeUInt32LE(compData.length, 18); // Compressed size
    lh.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26); // Filename length
    lh.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(lh, 30);

    localHeaders.push(lh, compData);

    // Central directory header (46 bytes + filename)
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // Central directory signature: PK\x01\x02
    cd.writeUInt16LE(20, 4); // Version made by (2.0)
    cd.writeUInt16LE(20, 6); // Minimum version needed to extract (2.0)
    cd.writeUInt16LE(0, 8); // General purpose bit flag
    cd.writeUInt16LE(8, 10); // Compression method (8 = Deflate)
    cd.writeUInt16LE(0, 12); // File last modification time
    cd.writeUInt16LE(0, 14); // File last modification date
    cd.writeUInt32LE(crc, 16); // CRC-32
    cd.writeUInt32LE(compData.length, 20); // Compressed size
    cd.writeUInt32LE(dataBuf.length, 24); // Uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28); // Filename length
    cd.writeUInt16LE(0, 30); // Extra field length
    cd.writeUInt16LE(0, 32); // File comment length
    cd.writeUInt16LE(0, 34); // Disk number start
    cd.writeUInt16LE(0, 36); // Internal file attributes
    cd.writeUInt32LE(0, 38); // External file attributes
    cd.writeUInt32LE(offset, 42); // Relative offset of local header
    nameBuf.copy(cd, 46);

    cdHeaders.push(cd);

    offset += lh.length + compData.length;
  }

  const cdOffset = offset;
  const cdSize = cdHeaders.reduce((sum, h) => sum + h.length, 0);

  // End of Central Directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature: PK\x05\x06
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(cdSize, 12); // Size of central directory (bytes)
  eocd.writeUInt32LE(cdOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

/**
 * Unpacks a ZIP archive into a map of filename -> uncompressed string content.
 */
export function unpackZip(buf: Buffer): Record<string, string> {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Invalid XLSX package: not an OOXML ZIP archive (missing PK signature)');
  }

  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid XLSX package: Corrupted ZIP archive, EOCD record not found');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const files: Record<string, string> = {};
  let cur = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(cur) !== 0x02014b50) {
      throw new Error('Invalid XLSX package: Corrupted central directory signature');
    }

    const compMethod = buf.readUInt16LE(cur + 10);
    const compSize = buf.readUInt32LE(cur + 20);
    const nameLen = buf.readUInt16LE(cur + 28);
    const extraLen = buf.readUInt16LE(cur + 30);
    const commentLen = buf.readUInt16LE(cur + 32);
    const localHeaderOffset = buf.readUInt32LE(cur + 42);
    const name = buf.toString('utf-8', cur + 46, cur + 46 + nameLen);
    cur += 46 + nameLen + extraLen + commentLen;

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compBytes = buf.subarray(dataOffset, dataOffset + compSize);

    let fileBytes: Buffer;
    if (compMethod === 8) {
      fileBytes = inflateRawSync(compBytes);
    } else if (compMethod === 0) {
      fileBytes = compBytes;
    } else {
      throw new Error(`Unsupported compression method in XLSX package: ${compMethod}`);
    }

    files[name] = fileBytes.toString('utf-8');
  }

  return files;
}

/**
 * Formats a cell XML element in an OOXML worksheet.
 * Inlines strings with <is><t>...</t></is> to avoid separate sharedStrings table complexity.
 * Implements formula injection prevention for cell strings.
 */
function renderOoxmlCell(colIdx: number, rowIdx: number, val: unknown, styleId?: number): string {
  const cellRef = `${getColumnLetter(colIdx)}${rowIdx}`;
  const styleAttr = styleId !== undefined ? ` s="${styleId}"` : '';

  if (val === null || val === undefined) {
    return `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t></t></is></c>`;
  }

  if (typeof val === 'number' && Number.isFinite(val)) {
    return `<c r="${cellRef}"${styleAttr}><v>${val}</v></c>`;
  }

  let strVal = String(val);
  // Formula injection defense: neutralize spreadsheet formula execution triggers
  if (/^[=+\-@\t\r]/.test(strVal)) {
    strVal = `'${strVal}`;
  }

  return `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(strVal)}</t></is></c>`;
}

/**
 * Generates an ISO/IEC 29500 conformant OOXML XLSX ZIP workbook package.
 * Contains both 'Data' and 'Metadata' worksheets with styles and schema definitions.
 */
export function generateXlsx(
  metadata: ExportGenerationMetadata,
  headers: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): Buffer {
  // 1. [Content_Types].xml
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  // 2. _rels/.rels
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  // 3. xl/_rels/workbook.xml.rels
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // 4. xl/workbook.xml
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
    <sheet name="Metadata" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  // 5. xl/styles.xml
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><name val="Calibri"/><family val="2"/><sz val="11"/></font>
    <font><b/><name val="Calibri"/><family val="2"/><sz val="11"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

  // 6. xl/worksheets/sheet1.xml (Data Sheet)
  const sheet1Rows: string[] = [];

  // Header row (row 1)
  const headerCells = headers.map((h, colIdx) => renderOoxmlCell(colIdx, 1, h.label, 1)).join('');
  sheet1Rows.push(`<row r="1">${headerCells}</row>`);

  // Data rows (row 2..N)
  let rowNum = 2;
  for (const r of rows) {
    const cells = headers.map((h, colIdx) => renderOoxmlCell(colIdx, rowNum, r[h.key], 0)).join('');
    sheet1Rows.push(`<row r="${rowNum}">${cells}</row>`);
    rowNum++;
  }

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheet1Rows.join('\n    ')}
  </sheetData>
</worksheet>`;

  // 7. xl/worksheets/sheet2.xml (Metadata Sheet)
  const metaEntries: [string, string][] = [
    ['Export ID', metadata.export_id],
    ['Generated At', metadata.generated_at],
    ['Tenant ID', metadata.merchant_id],
    ['Requested By', `${metadata.requested_by} (${metadata.user_role})`],
    ['Resource', metadata.resource],
    ['Format', metadata.format],
    ['Rule Version', metadata.rule_version],
    ['Total Records', String(metadata.total_rows)],
    ['Succeeded Records', String(metadata.succeeded_rows)],
    ['Failed Records', String(metadata.failed_rows)],
    ['Filters', JSON.stringify(metadata.filters || {})],
    ['Data Payload Checksum (SHA-256)', metadata.checksum_sha256],
  ];

  if (metadata.truncation_note) {
    metaEntries.push(['Truncation Note', metadata.truncation_note]);
  }

  const sheet2Rows: string[] = [];
  // Meta header
  sheet2Rows.push(
    `<row r="1">${renderOoxmlCell(0, 1, 'Metadata Field', 1)}${renderOoxmlCell(1, 1, 'Value', 1)}</row>`
  );

  let metaRowNum = 2;
  for (const [key, val] of metaEntries) {
    sheet2Rows.push(
      `<row r="${metaRowNum}">${renderOoxmlCell(0, metaRowNum, key, 2)}${renderOoxmlCell(1, metaRowNum, val, 0)}</row>`
    );
    metaRowNum++;
  }

  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheet2Rows.join('\n    ')}
  </sheetData>
</worksheet>`;

  return packZip([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1Xml },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2Xml },
  ]);
}

/**
 * Parsed representation of an OOXML XLSX workbook.
 */
export interface ParsedXlsxWorkbook {
  sheets: {
    [sheetName: string]: {
      headers: string[];
      rows: Record<string, string>[];
    };
  };
  metadata: Record<string, string>;
}

/**
 * Reads and verifies an OOXML XLSX buffer package using an internal ZIP and XML parser.
 * Throws if the file is not a valid OOXML ZIP archive.
 */
export function readXlsx(buffer: Buffer): ParsedXlsxWorkbook {
  const files = unpackZip(buffer);

  // Validate essential OOXML package components
  if (!files['[Content_Types].xml']) {
    throw new Error('Invalid XLSX package: missing [Content_Types].xml');
  }
  if (!files['xl/workbook.xml']) {
    throw new Error('Invalid XLSX package: missing xl/workbook.xml');
  }
  if (!files['xl/worksheets/sheet1.xml']) {
    throw new Error('Invalid XLSX package: missing Data worksheet xl/worksheets/sheet1.xml');
  }

  function parseWorksheetRows(xml: string): string[][] {
    const result: string[][] = [];
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(xml)) !== null) {
      const rowContent = rowMatch[1];
      const cellRegex = /<c\b[^>]*>([\s\S]*?)<\/c>/g;
      let cellMatch: RegExpExecArray | null;
      const rowCells: string[] = [];

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellXml = cellMatch[0];
        let val = '';
        const isMatch = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(cellXml);
        if (isMatch) {
          val = isMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
        } else {
          const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
          if (vMatch) {
            val = vMatch[1];
          }
        }
        rowCells.push(val);
      }
      result.push(rowCells);
    }
    return result;
  }

  // Parse Sheet 1 (Data)
  const sheet1Data = parseWorksheetRows(files['xl/worksheets/sheet1.xml']);
  const headers = sheet1Data.length > 0 ? sheet1Data[0] : [];
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < sheet1Data.length; i++) {
    const rowValues = sheet1Data[i];
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = rowValues[c] !== undefined ? rowValues[c] : '';
    }
    rows.push(rowObj);
  }

  // Parse Sheet 2 (Metadata)
  const metadataMap: Record<string, string> = {};
  if (files['xl/worksheets/sheet2.xml']) {
    const sheet2Data = parseWorksheetRows(files['xl/worksheets/sheet2.xml']);
    for (let i = 1; i < sheet2Data.length; i++) {
      const r = sheet2Data[i];
      if (r[0]) {
        metadataMap[r[0]] = r[1] !== undefined ? r[1] : '';
      }
    }
  }

  return {
    sheets: {
      Data: {
        headers,
        rows,
      },
    },
    metadata: metadataMap,
  };
}
