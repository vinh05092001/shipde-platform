#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true });
const CLARIFICATION = /\[NEEDS\s+CLARIFICATION(?:\s*:[^\]]*)?\s*\]/gi;

function tableCells(line) {
  const text = line.trim();
  const cells = [''];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      cells[cells.length - 1] += text[i] + text[++i];
    } else if (text[i] === '|') {
      cells.push('');
    } else {
      cells[cells.length - 1] += text[i];
    }
  }
  if (cells.length === 1) return null;
  if (text.startsWith('|')) cells.shift();
  if (text.endsWith('|') && cells.at(-1) === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

function concrete(value) {
  if (/<[^>]*>/.test(value)) return false;
  const text = value
    .replace(/[`*_~]/g, '')
    .trim();
  const stripped = text
    .replace(/^[-—:;~#/*[({<"'`\s]+/, '')
    .replace(/[-—:;~#/*\])}>'"`;?!,\s]+$/, '');
  return (
    /[\p{L}\p{N}]/u.test(text) &&
    !/^(?:n\/a|none|todo|tbd|tbc|tba|wip|fixme|pending|placeholder|not applicable)(?![\p{L}\p{N}])/iu.test(
      stripped
    )
  );
}

const REGRESSION_SPLIT =
  /(?:[;:,]\s*|\s+[-—]\s*|\s*[[(]\s*|\n\s*)\bregression[\s-]+(?:tests?|proofs?|commands?)\b\s*[:=-]?\s*|\bregression(?:[\s-]+(?:tests?|proofs?|commands?))?\b\s*[:=]\s*/i;

function isValidBehaviourPair(entry) {
  const text = entry.replace(/[`*_~]/g, '');
  const match = text.match(REGRESSION_SPLIT);
  if (!match || match.index === undefined) return false;
  const behaviour = text.slice(0, match.index).trim();
  const proof = text
    .slice(match.index + match[0].length)
    .replace(/[\])]\s*$/, '')
    .trim();
  return concrete(behaviour) && concrete(proof);
}

function checkListBehaviours(lines) {
  const entries = [];
  let current = '';
  let currentIndent = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current) {
        entries.push(current);
        current = '';
      }
      continue;
    }
    const bullet = rawLine.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/);
    const isNestedProof =
      bullet &&
      current &&
      bullet[1].length > currentIndent &&
      /^regression(?:[\s-]+(?:tests?|proofs?|commands?)\b|\s*[:=])/i.test(
        bullet[2].replace(/[`*_~]/g, '')
      );
    if (bullet && !isNestedProof) {
      if (current) entries.push(current);
      current = bullet[2].trim();
      currentIndent = bullet[1].length;
    } else if (current) {
      current += '\n' + (isNestedProof ? bullet[2] : line);
    } else {
      current = line;
      currentIndent = rawLine.length - rawLine.trimStart().length;
    }
  }
  if (current) entries.push(current);

  if (entries.length === 0) return false;
  return entries.every((entry) => isValidBehaviourPair(entry));
}

function hasSourceLink(text) {
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>()`]+/gi)) {
    try {
      if (new URL(match[0]).hostname) return true;
    } catch {
      // An incomplete URL is not a source reference.
    }
  }
  return /(?:^|[\s`[(])(?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:md|mdx|rst|adoc|txt|pdf|ya?ml|json|html?)(?:#[^\s`)\]]*)?(?=$|[\s`)\],.;])/im.test(
    text
  );
}

function extractTables(tokens) {
  const tables = [];
  let currentTable = null;
  let inThead = false;
  let currentTr = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'table_open') {
      currentTable = {
        tokenIndex: i,
        map: token.map,
        header: null,
        headerLine: token.map ? token.map[0] : 0,
        rows: [],
      };
      inThead = false;
      continue;
    }
    if (!currentTable) continue;

    if (token.type === 'thead_open') {
      inThead = true;
      continue;
    }
    if (token.type === 'thead_close') {
      inThead = false;
      continue;
    }
    if (token.type === 'tr_open') {
      currentTr = {
        line: token.map ? token.map[0] : currentTable.headerLine,
        cells: [],
      };
      continue;
    }
    if (token.type === 'tr_close') {
      if (inThead) {
        currentTable.header = currentTr.cells;
        currentTable.headerLine = currentTr.line;
      } else {
        currentTable.rows.push(currentTr);
      }
      currentTr = null;
      continue;
    }
    if (token.type === 'th_open' || token.type === 'td_open') {
      const next = tokens[i + 1];
      const cellContent = next && next.type === 'inline' ? next.content : '';
      if (currentTr) {
        currentTr.cells.push(cellContent);
      }
      continue;
    }
    if (token.type === 'table_close') {
      tables.push(currentTable);
      currentTable = null;
      continue;
    }
  }
  return tables;
}

const IGNORED_SOURCE_BLOCKS = new Set(['fence', 'code_block', 'html_block']);
const IGNORED_SOURCE_INLINES = new Set(['html_inline']);

export function checkWorkItemReady(content) {
  const text = content.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const problems = [];
  const report = (index, message) => problems.push(`line ${index + 1}: ${message}`);

  // Markers are checked in the original text, including comments and code blocks.
  for (const match of text.matchAll(CLARIFICATION)) {
    report(
      text.slice(0, match.index).split('\n').length - 1,
      'unresolved NEEDS CLARIFICATION marker'
    );
  }

  const tokens = md.parse(text, {});

  const allSections = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.slice(1), 10);
      const index = token.map ? token.map[0] : 0;
      const next = tokens[i + 1];
      const title = next && next.type === 'inline' ? next.content.trim().toLowerCase() : '';
      allSections.push({ index, level, title, tokenIndex: i });
    }
  }
  for (let i = 0; i < allSections.length; i++) {
    const nextHeading = allSections.slice(i + 1).find((next) => next.level <= allSections[i].level);
    allSections[i].end = nextHeading ? nextHeading.index : lines.length;
    allSections[i].endTokenIndex = nextHeading ? nextHeading.tokenIndex : tokens.length;
  }

  // 1. Open questions
  for (const section of allSections.filter((entry) => entry.title === 'open questions')) {
    const sectionTokens = tokens.slice(section.tokenIndex + 3, section.endTokenIndex);
    let hasContent = false;
    for (const token of sectionTokens) {
      if (token.type === 'html_block') {
        const withoutComment = token.content.replace(/<!--[\s\S]*?-->/g, '').trim();
        if (withoutComment) hasContent = true;
      } else if (token.type.endsWith('_close')) {
        continue;
      } else if (token.type === 'inline') {
        const nonComment = token.children?.filter((c) => c.type !== 'html_inline');
        if (nonComment && nonComment.some((c) => c.content?.trim())) hasContent = true;
      } else {
        hasContent = true;
      }
    }
    if (hasContent) {
      report(section.index, 'Open questions must be empty before authoring');
    }
  }

  const allTables = extractTables(tokens);

  // 2. Unchanged behaviour
  const unchanged = allSections.filter((section) => /^unchanged behavio[u]?r$/.test(section.title));
  if (!unchanged.length) report(0, 'missing Unchanged behaviour section');
  for (const section of unchanged) {
    const sectionTables = allTables.filter(
      (t) => t.headerLine > section.index && t.headerLine < section.end
    );
    let foundTable = false;
    let tableValid = false;

    if (sectionTables.length > 0) {
      foundTable = true;
      tableValid = true;
      for (const t of sectionTables) {
        if (!t.header || t.header.length < 2) {
          tableValid = false;
          break;
        }
        let bCol = t.header.findIndex((c) => /behavio[u]?r/i.test(c));
        let pCol = t.header.findIndex((c) => /regression|proof|test/i.test(c));
        if (bCol === -1 && t.header.length >= 2) bCol = 0;
        if (pCol === -1 && t.header.length >= 2) pCol = 1;
        if (bCol === -1 || pCol === -1 || bCol === pCol) {
          tableValid = false;
          break;
        }
        if (t.rows.length === 0) {
          tableValid = false;
          break;
        }
        for (const row of t.rows) {
          const rawCells = tableCells(lines[row.line]);
          if (!rawCells || rawCells.length !== t.header.length) {
            tableValid = false;
            break;
          }
          const behaviour = row.cells[bCol] ?? '';
          const proof = row.cells[pCol] ?? '';
          if (!concrete(behaviour) || !concrete(proof)) {
            tableValid = false;
            break;
          }
        }
        if (!tableValid) break;
      }
    }

    const listLines = [];
    const ignoredBlockLines = new Set();
    const sectionTokens = tokens.slice(section.tokenIndex + 3, section.endTokenIndex);
    for (const token of sectionTokens) {
      if (token.type === 'table_open' && token.map) {
        for (let l = token.map[0]; l < token.map[1]; l++) ignoredBlockLines.add(l);
      } else if (
        (token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') &&
        token.map
      ) {
        for (let l = token.map[0]; l < token.map[1]; l++) ignoredBlockLines.add(l);
      }
    }

    for (let l = section.index + 1; l < section.end; l++) {
      if (ignoredBlockLines.has(l)) continue;
      const isSubheading = allSections.some((s) => s.index === l);
      if (isSubheading) {
        listLines.push('');
        continue;
      }
      listLines.push(lines[l]);
    }

    const hasListEntries = listLines.some((l) => l.trim());
    let ok = false;
    if (hasListEntries) {
      ok = checkListBehaviours(listLines);
    } else if (foundTable) {
      ok = tableValid;
    }

    if (!ok) {
      report(
        section.index,
        'Unchanged behaviour must name preserved behaviour and regression tests'
      );
    }
  }

  // 3. Source references / documents
  const sources = allSections.filter((section) =>
    /^source (references|documents)$/.test(section.title)
  );
  let hasSource = false;
  for (const section of sources) {
    const sectionTokens = tokens.slice(section.tokenIndex + 3, section.endTokenIndex);
    for (const token of sectionTokens) {
      if (IGNORED_SOURCE_BLOCKS.has(token.type)) continue;
      if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (IGNORED_SOURCE_INLINES.has(child.type)) continue;
          if (child.attrs) {
            for (const [name, val] of child.attrs) {
              if (name === 'href' && hasSourceLink(val)) hasSource = true;
            }
          }
          if (child.content && hasSourceLink(child.content)) hasSource = true;
        }
      } else if (token.content && hasSourceLink(token.content)) {
        hasSource = true;
      }
      if (hasSource) break;
    }
    if (hasSource) break;
  }
  if (!sources.length || !hasSource) {
    report(sources[0]?.index ?? 0, 'missing source-document link in Source references');
  }

  // 4. Acceptance matrix
  const acceptance = allSections.filter((section) => /^acceptance\b/.test(section.title));
  if (!acceptance.length) {
    report(0, 'missing Acceptance matrix with rows and a Proof column');
  }
  const sectionTableCount = new Map(acceptance.map((section) => [section, 0]));

  for (const table of allTables) {
    const matchingSections = acceptance.filter(
      (section) => table.headerLine > section.index && table.headerLine < section.end
    );
    if (!matchingSections.length) continue;
    for (const section of matchingSections) {
      sectionTableCount.set(section, sectionTableCount.get(section) + 1);
    }

    const proofColumns = table.header
      ? table.header.flatMap((cell, index) =>
          cell.replace(/[`*_]/g, '').toLowerCase() === 'proof' ? [index] : []
        )
      : [];

    if (proofColumns.length !== 1) {
      report(table.headerLine, 'acceptance table must have exactly one Proof column');
    }

    if (table.rows.length === 0) {
      report(table.headerLine, 'acceptance table must contain at least one row with Proof');
    }

    for (const row of table.rows) {
      const raw = tableCells(lines[row.line]);
      if (
        proofColumns.length === 1 &&
        (!raw || raw.length !== table.header.length || !concrete(row.cells[proofColumns[0]] ?? ''))
      ) {
        report(row.line, 'acceptance row needs concrete Proof and cells matching its header');
      }
    }
  }

  for (const section of acceptance) {
    if (!sectionTableCount.get(section)) {
      report(section.index, 'missing Acceptance matrix with rows and a Proof column');
    }
  }

  return { ok: problems.length === 0, problems };
}

function runCli(args) {
  if (args.length !== 1) {
    console.error('Usage: pnpm ai:ready <work-item>');
    return 1;
  }
  let content;
  try {
    content = readFileSync(args[0], 'utf8');
  } catch (error) {
    console.error(
      `Cannot read Work Item (${error.code ?? 'ERROR'}): check the path and permissions`
    );
    return 1;
  }
  const result = checkWorkItemReady(content);
  if (!result.ok) {
    for (const problem of result.problems) console.error(problem);
    return 1;
  }
  console.log('[ready-check] PASS: Work Item is ready for authoring');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
