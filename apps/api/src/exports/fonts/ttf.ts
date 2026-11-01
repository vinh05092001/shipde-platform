/**
 * Minimal, dependency-free TrueType (sfnt) table reader for the PDF export generator.
 *
 * It extracts only what is required to embed a Unicode-capable font correctly:
 *  - the `cmap` (Unicode code point -> glyph id) mapping,
 *  - `head` metrics (unitsPerEm, font bounding box),
 *  - `hhea` metrics (ascender, descender, numberOfHMetrics),
 *  - `hmtx` advance widths (per glyph id).
 *
 * All multi-byte integers are read big-endian, per the sfnt specification.
 */

export interface TtfFont {
  /** Unicode code point -> glyph id (from the best cmap subtable). */
  unicodeToGid: Map<number, number>;
  /** Glyph id -> Unicode code point (reverse of the best cmap subtable). */
  gidToUnicode: Map<number, number>;
  unitsPerEm: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  ascender: number;
  descender: number;
  numGlyphs: number;
  /** Advance width (font units) indexed by glyph id. */
  advanceWidths: number[];
}

interface TableEntry {
  tag: string;
  offset: number;
  length: number;
}

function readTables(buf: Buffer): Map<string, TableEntry> {
  const numTables = buf.readUInt16BE(4);
  const tables = new Map<string, TableEntry>();
  let pos = 12;
  for (let i = 0; i < numTables; i++) {
    const tag = buf.toString('ascii', pos, pos + 4);
    const offset = buf.readUInt32BE(pos + 8);
    const length = buf.readUInt32BE(pos + 12);
    tables.set(tag, { tag, offset, length });
    pos += 16;
  }
  return tables;
}

function parseCmapFormat4(
  buf: Buffer,
  tableOffset: number,
  subOffset: number
): Map<number, number> {
  const base = tableOffset + subOffset;
  // The field is segCountX2 (twice the actual segment count).
  const segCountX2 = buf.readUInt16BE(base + 6);
  const numSegments = segCountX2 / 2;
  const segBase = base + 14; // after searchRange(2) entrySelector(2) rangeShift(2)
  const endCodes: number[] = [];
  for (let i = 0; i < numSegments; i++) endCodes.push(buf.readUInt16BE(segBase + i * 2));
  // reservedPad(2) then startCodes
  const startBase = segBase + numSegments * 2 + 2;
  const idDeltaBase = startBase + numSegments * 2;
  const idRangeOffsetBase = idDeltaBase + numSegments * 2;

  const map = new Map<number, number>();
  for (let i = 0; i < numSegments; i++) {
    const endCode = endCodes[i];
    const startCode = buf.readUInt16BE(startBase + i * 2);
    const idDelta = buf.readInt16BE(idDeltaBase + i * 2);
    const idRangeOffsetRaw = buf.readUInt16BE(idRangeOffsetBase + i * 2);
    if (startCode === 0xffff) continue; // reserved terminator segment
    for (let code = startCode; code <= endCode; code++) {
      let gid: number;
      if (idRangeOffsetRaw === 0) {
        gid = (code + idDelta) & 0xffff;
      } else {
        const glyphIndexOffset =
          idRangeOffsetBase + i * 2 + idRangeOffsetRaw + (code - startCode) * 2;
        const glyphIndex = buf.readUInt16BE(glyphIndexOffset);
        gid = glyphIndex === 0 ? 0 : (glyphIndex + idDelta) & 0xffff;
      }
      if (gid > 0) map.set(code, gid);
    }
  }
  return map;
}

function parseCmapFormat12(
  buf: Buffer,
  tableOffset: number,
  subOffset: number
): Map<number, number> {
  const base = tableOffset + subOffset;
  const numGroups = buf.readUInt32BE(base + 12);
  const map = new Map<number, number>();
  let pos = base + 16;
  for (let i = 0; i < numGroups; i++) {
    const startCharCode = buf.readUInt32BE(pos);
    const endCharCode = buf.readUInt32BE(pos + 4);
    const startGlyphId = buf.readUInt32BE(pos + 8);
    for (let code = startCharCode; code <= endCharCode; code++) {
      const gid = startGlyphId + (code - startCharCode);
      if (gid > 0) map.set(code, gid);
    }
    pos += 12;
  }
  return map;
}

function parseCmap(buf: Buffer): Map<number, number> {
  const tables = readTables(buf);
  const cmap = tables.get('cmap');
  if (!cmap) return new Map();

  const version = buf.readUInt16BE(cmap.offset);
  if (version !== 0) return new Map();
  const numSubtables = buf.readUInt16BE(cmap.offset + 2);

  // Prefer: (platform 3, encoding 10) format 12 full Unicode,
  // then (platform 3, encoding 4) format 4 BMP, then (platform 0, any).
  const candidates: Array<{
    platform: number;
    encoding: number;
    offset: number;
    priority: number;
  }> = [];
  let pos = cmap.offset + 4;
  for (let i = 0; i < numSubtables; i++) {
    const platform = buf.readUInt16BE(pos);
    const encoding = buf.readUInt16BE(pos + 2);
    const subOffset = buf.readUInt32BE(pos + 4);
    let priority = -1;
    if (platform === 3 && encoding === 10) priority = 4;
    else if (platform === 0 && (encoding === 3 || encoding === 4 || encoding === 10)) priority = 3;
    else if (platform === 3 && encoding === 4) priority = 2;
    else if (platform === 3 && encoding === 1) priority = 1; // commonly the primary Unicode BMP subtable
    if (priority >= 0) candidates.push({ platform, encoding, offset: subOffset, priority });
    pos += 8;
  }
  candidates.sort((a, b) => b.priority - a.priority);

  for (const c of candidates) {
    const format = buf.readUInt16BE(cmap.offset + c.offset);
    try {
      if (format === 12) return parseCmapFormat12(buf, cmap.offset, c.offset);
      if (format === 4) return parseCmapFormat4(buf, cmap.offset, c.offset);
    } catch {
      // Fall through to the next candidate subtable.
    }
  }
  return new Map();
}

export function parseTtf(buf: Buffer): TtfFont {
  const tables = readTables(buf);

  const unicodeToGid = parseCmap(buf);
  const gidToUnicode = new Map<number, number>();
  for (const [code, gid] of unicodeToGid) {
    if (!gidToUnicode.has(gid)) gidToUnicode.set(gid, code);
  }

  let unitsPerEm = 2048;
  let xMin = -200;
  let yMin = -200;
  let xMax = 2000;
  let yMax = 2200;
  const head = tables.get('head');
  if (head) {
    unitsPerEm = buf.readUInt16BE(head.offset + 18);
    xMin = buf.readInt16BE(head.offset + 36);
    yMin = buf.readInt16BE(head.offset + 38);
    xMax = buf.readInt16BE(head.offset + 40);
    yMax = buf.readInt16BE(head.offset + 42);
  }

  let ascender = 1500;
  let descender = -500;
  let numberOfHMetrics = 0;
  const hhea = tables.get('hhea');
  if (hhea) {
    ascender = buf.readInt16BE(hhea.offset + 4);
    descender = buf.readInt16BE(hhea.offset + 6);
    numberOfHMetrics = buf.readUInt16BE(hhea.offset + 34);
  }

  let numGlyphs = 0;
  const maxp = tables.get('maxp');
  if (maxp) numGlyphs = buf.readUInt16BE(maxp.offset + 4);

  const advanceWidths: number[] = new Array(numGlyphs).fill(Math.round(unitsPerEm * 0.5));
  const hmtx = tables.get('hmtx');
  if (hmtx && numGlyphs > 0) {
    const metrics = Math.min(numberOfHMetrics > 0 ? numberOfHMetrics : numGlyphs, numGlyphs);
    let pos = hmtx.offset;
    for (let i = 0; i < metrics; i++) {
      advanceWidths[i] = buf.readUInt16BE(pos);
      pos += 4; // advanceWidth(2) + lsbearing(2)
    }
    if (metrics < numGlyphs) {
      // Remaining glyphs share the last advance width.
      const lastWidth = metrics > 0 ? advanceWidths[metrics - 1] : advanceWidths[0];
      for (let i = metrics; i < numGlyphs; i++) advanceWidths[i] = lastWidth;
    }
  }

  return {
    unicodeToGid,
    gidToUnicode,
    unitsPerEm,
    xMin,
    yMin,
    xMax,
    yMax,
    ascender,
    descender,
    numGlyphs,
    advanceWidths,
  };
}
