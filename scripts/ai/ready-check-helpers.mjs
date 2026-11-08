/**
 * Helper functions for ready-check.
 * Reference: github.com/DavidAnson/markdownlint (MIT License)
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true });
const origHtmlBlock = md.block.ruler.__rules__.find((r) => r.name === 'html_block').fn;
md.block.ruler.at('html_block', function (state, startLine, endLine, silent) {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const lineText = state.src.slice(pos, state.eMarks[startLine]);
  if (silent && /^<!--/.test(lineText)) return false;
  return origHtmlBlock(state, startLine, endLine, silent);
});

export const CLARIFICATION = /\[NEEDS\s+CLARIFICATION(?:\s*:[^\]]*)?\s*\]/gi;

export function tableCells(line) {
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

export function concrete(value) {
  if (/<[a-zA-Z][\w\s-]*>/.test(value)) return false;
  const text = value
    .replace(/<!--[\s\S]*?-->/g, '')
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

export function isValidBehaviourPair(entry) {
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

export function checkListBehaviours(lines) {
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

export function hasSourceLink(text) {
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>)`]+/gi)) {
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

export function extractTables(tokens) {
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

export function getSections(tokens, totalLines) {
  const sections = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.slice(1), 10);
      const index = token.map ? token.map[0] : 0;
      const next = tokens[i + 1];
      const title = next && next.type === 'inline' ? next.content.trim().toLowerCase() : '';
      sections.push({ index, level, title, tokenIndex: i });
    }
  }
  for (let i = 0; i < sections.length; i++) {
    const nextHeading = sections.slice(i + 1).find((next) => next.level <= sections[i].level);
    sections[i].end = nextHeading ? nextHeading.index : totalLines;
    sections[i].endTokenIndex = nextHeading ? nextHeading.tokenIndex : tokens.length;
  }
  return sections;
}

export { md };
