/**
 * Custom markdownlint rules for ready-check.
 * Reference: github.com/DavidAnson/markdownlint (MIT License)
 */
import { getSections, hasSourceLink, extractTables, tableCells, concrete, checkListBehaviours } from './ready-check-helpers.mjs';

const IGNORED_SOURCE_BLOCKS = new Set(['fence', 'code_block', 'html_block']);
const IGNORED_SOURCE_INLINES = new Set(['html_inline']);

export const customRules = [
  {
    names: ['source-link', 'source-document', 'READY-04'],
    description: 'missing source-document link in Source references',
    tags: ['ready-check'],
    parser: 'markdownit',
    function: (params, onError) => {
      const tokens = params.parsers.markdownit.tokens;
      const sections = getSections(tokens, params.lines.length);
      const sources = sections.filter((s) => /^source (references|documents)$/.test(s.title));
      if (!sources.length) {
        onError({
          lineNumber: 1,
          detail: 'missing source-document link in Source references',
        });
        return;
      }
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
      if (!hasSource) {
        onError({
          lineNumber: (sources[0]?.index ?? 0) + 1,
          detail: 'missing source-document link in Source references',
        });
      }
    },
  },
  {
    names: ['acceptance-proof', 'Proof', 'acceptance-matrix', 'READY-02'],
    description: 'acceptance table has non-empty Proof',
    tags: ['ready-check'],
    parser: 'markdownit',
    function: (params, onError) => {
      const tokens = params.parsers.markdownit.tokens;
      const sections = getSections(tokens, params.lines.length);
      const acceptance = sections.filter((s) => /^acceptance\b/.test(s.title));
      if (!acceptance.length) {
        onError({
          lineNumber: 1,
          detail: 'missing Acceptance matrix with rows and a Proof column',
        });
        return;
      }
      const allTables = extractTables(tokens);
      const sectionTableCount = new Map(acceptance.map((s) => [s, 0]));

      for (const table of allTables) {
        const matchingSections = acceptance.filter(
          (s) => table.headerLine > s.index && table.headerLine < s.end
        );
        if (!matchingSections.length) continue;
        for (const s of matchingSections) {
          sectionTableCount.set(s, (sectionTableCount.get(s) ?? 0) + 1);
        }

        const proofColumns = table.header
          ? table.header.flatMap((cell, index) =>
              cell.replace(/[`*_]/g, '').toLowerCase() === 'proof' ? [index] : []
            )
          : [];

        if (proofColumns.length !== 1) {
          onError({
            lineNumber: table.headerLine + 1,
            detail: 'acceptance table must have exactly one Proof column',
          });
        }

        if (table.rows.length === 0) {
          onError({
            lineNumber: table.headerLine + 1,
            detail: 'acceptance table must contain at least one row with Proof',
          });
        }

        for (const row of table.rows) {
          const raw = tableCells(params.lines[row.line]);
          if (
            proofColumns.length === 1 &&
            (!raw ||
              raw.length !== table.header.length ||
              !concrete(row.cells[proofColumns[0]] ?? ''))
          ) {
            onError({
              lineNumber: row.line + 1,
              detail: 'acceptance row needs concrete Proof and cells matching its header',
            });
          }
        }
      }

      for (const s of acceptance) {
        if (!sectionTableCount.get(s)) {
          onError({
            lineNumber: s.index + 1,
            detail: 'missing Acceptance matrix with rows and a Proof column',
          });
        }
      }
    },
  },
  {
    names: ['open-questions', 'Open questions'],
    description: 'Open questions must be empty before authoring',
    tags: ['ready-check'],
    parser: 'markdownit',
    function: (params, onError) => {
      const tokens = params.parsers.markdownit.tokens;
      const sections = getSections(tokens, params.lines.length);
      for (const section of sections.filter((s) => s.title === 'open questions')) {
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
          onError({
            lineNumber: section.index + 1,
            detail: 'Open questions must be empty before authoring',
          });
        }
      }
    },
  },
  {
    names: ['unchanged-behaviour', 'Unchanged behaviour'],
    description: 'Unchanged behaviour must name preserved behaviour and regression tests',
    tags: ['ready-check'],
    parser: 'markdownit',
    function: (params, onError) => {
      const tokens = params.parsers.markdownit.tokens;
      const sections = getSections(tokens, params.lines.length);
      const unchanged = sections.filter((s) => /^unchanged behavio[u]?r$/.test(s.title));
      if (!unchanged.length) {
        onError({
          lineNumber: 1,
          detail: 'missing Unchanged behaviour section',
        });
        return;
      }
      const allTables = extractTables(tokens);
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
              const rawCells = tableCells(params.lines[row.line]);
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
          if (ignoredBlockLines.has(l)) {
            listLines.push('');
            continue;
          }
          const isSubheading = sections.some((s) => s.index === l);
          if (isSubheading) {
            listLines.push('');
            continue;
          }
          listLines.push(params.lines[l]);
        }

        const listText = listLines.join('\n').replace(/<!--[\s\S]*?-->/g, '');
        const entryLines = listText.split('\n');
        const hasListEntries = entryLines.some((l) => l.trim());
        const listOk = hasListEntries ? checkListBehaviours(entryLines) : true;
        const tableOk = foundTable ? tableValid : true;
        const ok = (hasListEntries || foundTable) && listOk && tableOk;

        if (!ok) {
          onError({
            lineNumber: section.index + 1,
            detail: 'Unchanged behaviour must name preserved behaviour and regression tests',
          });
        }
      }
    },
  },
];
