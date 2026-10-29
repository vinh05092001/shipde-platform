import { ExportGenerationMetadata } from '@shipde/contracts';

/**
 * Escapes a cell value strictly according to RFC 4180.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC 4180 CSV string with UTF-8 BOM and metadata header comment banner.
 */
export function generateCsv(
  metadata: ExportGenerationMetadata,
  headers: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): Buffer {
  const metadataLines = [
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
    `# Checksum: ${metadata.checksum_sha256}`,
    '# --------------------------------',
  ];

  const headerRow = headers.map((h) => escapeCsvCell(h.label)).join(',');
  const dataRows = rows.map((row) => headers.map((h) => escapeCsvCell(row[h.key])).join(','));

  const fullContent = [...metadataLines, headerRow, ...dataRows].join('\r\n');

  // Prefix with UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility with Vietnamese diacritics
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fullContent, 'utf-8')]);
}
