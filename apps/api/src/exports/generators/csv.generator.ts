import { ExportGenerationMetadata } from '@shipde/contracts';

/**
 * Neutralizes spreadsheet formula injection (Finding 12).
 * Values starting with =, +, -, @, tab, or carriage return are prefixed with a single quote
 * so spreadsheet software (e.g. Microsoft Excel, LibreOffice Calc) treats them strictly as literal text.
 */
export function sanitizeCsvFormula(str: string): string {
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Recursively neutralizes spreadsheet formula injection prefixes in nested objects/filters (Finding 12).
 */
export function sanitizeObjectFormulas(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return sanitizeCsvFormula(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObjectFormulas);
  }
  if (obj && typeof obj === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = sanitizeObjectFormulas(v);
    }
    return res;
  }
  return obj;
}

/**
 * Escapes a cell value strictly according to RFC 4180 with spreadsheet formula neutralization (Finding 12).
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  str = sanitizeCsvFormula(str);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC 4180 CSV string with UTF-8 BOM, metadata header banner, and formula neutralization.
 */
export function generateCsv(
  metadata: ExportGenerationMetadata,
  headers: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): Buffer {
  const safeFiltersJson = JSON.stringify(sanitizeObjectFormulas(metadata.filters || {}));
  const rawMetadataLines = [
    '# --- SHIP DE EXPORT METADATA ---',
    `# Export ID: ${metadata.export_id}`,
    `# Generated At: ${metadata.generated_at}`,
    `# Tenant ID: ${metadata.merchant_id}`,
    `# Requested By: ${metadata.requested_by} (${metadata.user_role})`,
    `# Resource: ${metadata.resource}`,
    `# Rule Version: ${metadata.rule_version}`,
    `# Total Records: ${metadata.total_rows}`,
    `# Succeeded Records: ${metadata.succeeded_rows}`,
    `# Failed Records: ${metadata.failed_rows}`,
    `# Filters: ${safeFiltersJson}`,
    `# Data Payload Checksum (SHA-256): ${metadata.checksum_sha256}`,
  ];

  if (metadata.truncation_note) {
    rawMetadataLines.push(`# Truncation Note: ${metadata.truncation_note}`);
  }

  rawMetadataLines.push('# --------------------------------');

  const metadataLines = rawMetadataLines.map((line) => escapeCsvCell(line));

  const headerRow = headers.map((h) => escapeCsvCell(h.label)).join(',');
  const dataRows = rows.map((row) => headers.map((h) => escapeCsvCell(row[h.key])).join(','));

  const fullContent = [...metadataLines, headerRow, ...dataRows].join('\r\n');

  // Prefix with UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility with Vietnamese diacritics
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fullContent, 'utf-8')]);
}
