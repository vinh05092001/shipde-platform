import { ExportGenerationMetadata } from '@shipde/contracts';

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
 * Determines cell type and XML element for SpreadsheetML.
 */
function renderCell(val: unknown, styleId?: string): string {
  const styleAttr = styleId ? ` ss:StyleID="${styleId}"` : '';
  if (val === null || val === undefined) {
    return `<Cell${styleAttr}><Data ss:Type="String"></Data></Cell>`;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return `<Cell${styleAttr}><Data ss:Type="Number">${val}</Data></Cell>`;
  }
  return `<Cell${styleAttr}><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`;
}

/**
 * Generates a valid SpreadsheetML XML workbook with Data and Metadata sheets.
 */
export function generateXlsx(
  metadata: ExportGenerationMetadata,
  headers: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): Buffer {
  const xmlParts: string[] = [];

  xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlParts.push('<?mso-application progid="Excel.Sheet"?>');
  xmlParts.push(
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
      'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:html="http://www.w3.org/TR/REC-html40">'
  );

  // Styles
  xmlParts.push('  <Styles>');
  xmlParts.push(
    '    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/></Style>'
  );
  xmlParts.push(
    '    <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style>'
  );
  xmlParts.push(
    '    <Style ss:ID="MetaKey"><Font ss:Bold="1" ss:Color="#334155"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/></Style>'
  );
  xmlParts.push('  </Styles>');

  // Sheet 1: Data
  xmlParts.push('  <Worksheet ss:Name="Data">');
  xmlParts.push('    <Table>');
  // Header row
  xmlParts.push('      <Row>');
  for (const h of headers) {
    xmlParts.push(`        ${renderCell(h.label, 'Header')}`);
  }
  xmlParts.push('      </Row>');

  // Data rows
  for (const row of rows) {
    xmlParts.push('      <Row>');
    for (const h of headers) {
      xmlParts.push(`        ${renderCell(row[h.key])}`);
    }
    xmlParts.push('      </Row>');
  }
  xmlParts.push('    </Table>');
  xmlParts.push('  </Worksheet>');

  // Sheet 2: Metadata
  xmlParts.push('  <Worksheet ss:Name="Metadata">');
  xmlParts.push('    <Table>');
  xmlParts.push('      <Row>');
  xmlParts.push(`        ${renderCell('Metadata Field', 'Header')}`);
  xmlParts.push(`        ${renderCell('Value', 'Header')}`);
  xmlParts.push('      </Row>');

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
    ['Filters', JSON.stringify(metadata.filters)],
    ['Checksum (SHA-256)', metadata.checksum_sha256],
  ];

  for (const [key, val] of metaEntries) {
    xmlParts.push('      <Row>');
    xmlParts.push(`        ${renderCell(key, 'MetaKey')}`);
    xmlParts.push(`        ${renderCell(val)}`);
    xmlParts.push('      </Row>');
  }
  xmlParts.push('    </Table>');
  xmlParts.push('  </Worksheet>');

  xmlParts.push('</Workbook>');

  return Buffer.from(xmlParts.join('\r\n'), 'utf-8');
}
