import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import { TemplateDefinition } from './imports.constants';

/**
 * Standard RFC-4180 CSV parser supporting quoted values, commas, and CRLF.
 */
export function parseCsv(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM if present
  let text = csvText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rawRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++; // Skip next quote
        } else {
          // Closing quote
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++; // Consume \n
        }
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rawRows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rawRows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rawRows.push(currentRow);
    }
  }

  if (rawRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rawRows[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const rowValues = rawRows[r];
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (header) {
        rowObj[header] = rowValues[c] !== undefined ? rowValues[c] : '';
      }
    }
    // Only keep rows that have at least one non-empty value
    if (Object.values(rowObj).some((v) => v.length > 0)) {
      rows.push(rowObj);
    }
  }

  return { headers, rows };
}

/**
 * Standard RFC-4180 CSV serializer
 */
export function generateCsv(headers: string[], rows: Record<string, string>[]): string {
  const escapeCell = (cell: string | undefined | null): string => {
    const str = cell === null || cell === undefined ? '' : String(cell);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [];
  lines.push(headers.map(escapeCell).join(','));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Helper to construct a standard PKZIP archive in memory without external dependencies.
 */
function createZipArchive(files: Array<{ name: string; data: Buffer | string }>): Buffer {
  const parts: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compBuf = zlib.deflateRawSync(dataBuf);

    // Local file header (30 bytes)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // general purpose flag
    lh.writeUInt16LE(8, 8); // compression method (deflate)
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0, 12); // mod date
    lh.writeUInt32LE(0, 14); // crc32 placeholder
    lh.writeUInt32LE(compBuf.length, 18); // compressed size
    lh.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26); // file name length
    lh.writeUInt16LE(0, 28); // extra field length

    const localEntry = Buffer.concat([lh, nameBuf, compBuf]);
    parts.push(localEntry);

    // Central directory header (46 bytes)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(compBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42); // relative offset of local header

    cdEntries.push(Buffer.concat([cd, nameBuf]));
    offset += localEntry.length;
  }

  const cdBuf = Buffer.concat(cdEntries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuf, eocd]);
}

/**
 * Extracts all files from a standard ZIP buffer into a dictionary.
 */
function unpackZipArchive(buf: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {};
  let offset = 0;

  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);

    const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 8) {
      data = zlib.inflateRawSync(compData);
    } else if (method === 0) {
      data = Buffer.from(compData);
    } else {
      // Unsupported compression method
      data = Buffer.from(compData);
    }

    entries[name] = data;
    offset = dataStart + compSize;
  }

  return entries;
}

/**
 * Converts column index (0-based) to Excel column letters (A, B, ..., Z, AA, etc.)
 */
function columnIndexToLetters(idx: number): string {
  let letters = '';
  let temp = idx;
  while (temp >= 0) {
    letters = String.fromCharCode((temp % 26) + 65) + letters;
    temp = Math.floor(temp / 26) - 1;
  }
  return letters;
}

/**
 * Generates an XLSX workbook buffer for a given template definition.
 */
export function generateXlsxTemplate(template: TemplateDefinition): Buffer {
  const headers = template.columns.map((c) => c.key);
  const rows = template.sampleRows;

  // Build sheet1.xml
  let sheetRowsXml = '';
  // Row 1: Headers
  sheetRowsXml += `<row r="1">`;
  headers.forEach((h, colIdx) => {
    const cellRef = `${columnIndexToLetters(colIdx)}1`;
    sheetRowsXml += `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  sheetRowsXml += `</row>`;

  // Subsequent rows: Sample data
  rows.forEach((row, rowIdx) => {
    const rNum = rowIdx + 2;
    sheetRowsXml += `<row r="${rNum}">`;
    headers.forEach((h, colIdx) => {
      const cellRef = `${columnIndexToLetters(colIdx)}${rNum}`;
      const val = row[h] || '';
      sheetRowsXml += `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
    });
    sheetRowsXml += `</row>`;
  });

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetRowsXml}
  </sheetData>
</worksheet>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(template.name)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  return createZipArchive([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1Xml },
  ]);
}

/**
 * Parses XLSX buffer into headers and row objects without third-party dependencies.
 */
export function parseXlsx(buf: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const entries = unpackZipArchive(buf);

  // 1. Parse shared strings if present
  const sharedStrings: string[] = [];
  const sstBuf = entries['xl/sharedStrings.xml'];
  if (sstBuf) {
    const sstXml = sstBuf.toString('utf8');
    const siMatches = sstXml.match(/<si>([\s\S]*?)<\/si>/g);
    if (siMatches) {
      for (const si of siMatches) {
        const tMatch = si.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        sharedStrings.push(tMatch ? unescapeXml(tMatch[1]) : '');
      }
    }
  }

  // 2. Parse sheet1.xml
  const sheetBuf = entries['xl/worksheets/sheet1.xml'] || entries['xl/worksheets/sheet.xml'];
  if (!sheetBuf) {
    return { headers: [], rows: [] };
  }

  const sheetXml = sheetBuf.toString('utf8');
  const rowMatches = sheetXml.match(/<row[^>]*>([\s\S]*?)<\/row>/g);
  if (!rowMatches || rowMatches.length === 0) {
    return { headers: [], rows: [] };
  }

  const matrix: string[][] = [];

  for (const rowXml of rowMatches) {
    const rowValues: string[] = [];
    const cellMatches = rowXml.match(/<c[^>]*>([\s\S]*?)<\/c>/g);
    if (cellMatches) {
      for (const cellXml of cellMatches) {
        const isShared = /t="s"/.test(cellXml);
        const isInline = /t="inlineStr"/.test(cellXml);

        if (isShared) {
          const vMatch = cellXml.match(/<v>(\d+)<\/v>/);
          if (vMatch) {
            const idx = parseInt(vMatch[1], 10);
            rowValues.push(sharedStrings[idx] !== undefined ? sharedStrings[idx] : '');
          } else {
            rowValues.push('');
          }
        } else if (isInline) {
          const tMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          rowValues.push(tMatch ? unescapeXml(tMatch[1]) : '');
        } else {
          const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
          rowValues.push(vMatch ? unescapeXml(vMatch[1]) : '');
        }
      }
    }
    matrix.push(rowValues);
  }

  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = matrix[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const rowValues = matrix[r];
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (header) {
        rowObj[header] = rowValues[c] !== undefined ? rowValues[c].trim() : '';
      }
    }
    if (Object.values(rowObj).some((v) => v.length > 0)) {
      rows.push(rowObj);
    }
  }

  return { headers, rows };
}

/**
 * Normalizes input rows against the canonical template column keys.
 * Handles both Vietnamese human-readable headers and English keys.
 */
export function normalizeRowsWithTemplate(
  template: TemplateDefinition,
  rawHeaders: string[],
  rawRows: Record<string, string>[]
): {
  normalizedRows: Array<{
    rowNumber: number;
    rawData: Record<string, string>;
    mappedData: Record<string, string>;
  }>;
} {
  // Build header mapping: lowercased header -> canonical column key
  const headerMap = new Map<string, string>();
  for (const col of template.columns) {
    headerMap.set(col.key.toLowerCase(), col.key);
    headerMap.set(col.header.toLowerCase(), col.key);
    // Also strip diacritics for flexible matching
    headerMap.set(stripDiacritics(col.header.toLowerCase()), col.key);
  }

  const normalizedRows = rawRows.map((rawRow, idx) => {
    const mapped: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawRow)) {
      const cleanKey = key.trim().toLowerCase();
      const canonicalKey =
        headerMap.get(cleanKey) || headerMap.get(stripDiacritics(cleanKey)) || cleanKey;
      mapped[canonicalKey] = typeof val === 'string' ? val.trim() : String(val ?? '').trim();
    }
    return {
      rowNumber: idx + 1,
      rawData: rawRow,
      mappedData: mapped,
    };
  });

  return { normalizedRows };
}

/**
 * Calculates SHA-256 hash of a buffer.
 */
export function calculateFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Deep buffer scanning for malware signatures, malicious executable formats, and injection.
 */
export function scanBufferForMalware(buffer: Buffer): { safe: boolean; reason?: string } {
  if (!buffer || buffer.length === 0) {
    return { safe: false, reason: 'Empty buffer' };
  }

  // 1. Magic byte checks for executables:
  // Windows PE (MZ)
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { safe: false, reason: 'Detected Windows PE/EXE executable signature' };
  }
  // Linux ELF (\x7fELF)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return { safe: false, reason: 'Detected Linux ELF executable signature' };
  }
  // Mach-O (0xFEEDFACE, 0xFEEDFACF, 0xCEFAEDFE, 0xCFFAEDFE)
  if (buffer.length >= 4) {
    const u32 = buffer.readUInt32BE(0);
    if (u32 === 0xfeedface || u32 === 0xfeedfacf || u32 === 0xcefaedfe || u32 === 0xcffaedfe) {
      return { safe: false, reason: 'Detected Mach-O executable signature' };
    }
  }

  // 2. Check for EICAR standard antivirus test file
  const bufferString = buffer.toString('utf8');
  if (bufferString.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
    return { safe: false, reason: 'Detected EICAR antivirus test signature' };
  }

  // 3. Check for script injection, dangerous macros, or command execution payloads
  const lower = bufferString.toLowerCase();
  if (
    lower.includes('<script') ||
    lower.includes('javascript:') ||
    lower.includes('=cmd|') ||
    lower.includes('=powershell|') ||
    lower.includes('=dde(')
  ) {
    return { safe: false, reason: 'Detected potentially malicious script or formula injection' };
  }

  return { safe: true };
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(safe: string): string {
  return safe
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
