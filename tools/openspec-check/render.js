// Renders each Work Item acceptance matrix as an ephemeral OpenSpec spec so
// `openspec validate --strict` checks it. The Work Item stays the only spec
// authority; nothing here is committed.
'use strict';
const fs = require('fs');
const path = require('path');

function cells(line) {
  // Split on unescaped pipes; Markdown writes a literal pipe in a cell as \|.
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

function acceptanceRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Acceptance matrix/i.test(l));
  if (start < 0) return null;
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trim().startsWith('|') || /^\|\s*-/.test(line.trim())) continue;
    const [id, scenario, expected] = cells(line);
    if (!id || /^AC\/Test ID$/i.test(id)) continue;
    rows.push({ id, scenario, expected });
  }
  return rows;
}

function oneLine(text) {
  return String(text || '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderSpec(workItemId, rows) {
  const out = [
    `# ${workItemId} Specification`,
    '',
    '## Purpose',
    `Acceptance matrix of Work Item ${workItemId}, rendered for OpenSpec validation.`,
    '',
    '## Requirements',
  ];
  for (const row of rows) {
    out.push(`### Requirement: ${oneLine(row.id)}`);
    out.push(`The Work Item SHALL satisfy: ${oneLine(row.expected) || 'MISSING'}`, '');
    out.push(`#### Scenario: ${oneLine(row.id)}`);
    out.push(`- **WHEN** ${oneLine(row.scenario) || 'MISSING'}`);
    out.push(`- **THEN** ${oneLine(row.expected) || 'MISSING'}`, '');
  }
  return out.join('\n');
}

function render(workItemsDir, outRoot) {
  const specsDir = path.join(outRoot, 'openspec', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const rendered = [];
  const skipped = [];
  for (const name of fs
    .readdirSync(workItemsDir)
    .filter((n) => n.endsWith('.md'))
    .sort()) {
    const id = name.replace(/\.md$/, '');
    const rows = acceptanceRows(fs.readFileSync(path.join(workItemsDir, name), 'utf8'));
    if (!rows) {
      skipped.push(id);
      continue;
    }
    const dir = path.join(specsDir, id.toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), renderSpec(id, rows));
    rendered.push({ id, requirements: rows.length });
  }
  return { rendered, skipped };
}

module.exports = { acceptanceRows, renderSpec, render };
