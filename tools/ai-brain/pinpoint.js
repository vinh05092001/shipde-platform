'use strict';

/**
 * Ship Dễ — Writer Target Pinpointing (TASK-AI-142)
 *
 * Automatically locates the precise files, functions, and line ranges for a
 * Work Item before writer dispatch, producing a concise brief with file:line
 * references so the writer avoids token-heavy codebase exploration.
 */

const fs = require('fs');
const path = require('path');

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'must',
  'should',
  'when',
  'where',
  'which',
  'will',
  'does',
  'each',
  'more',
  'some',
  'such',
  'then',
  'than',
  'only',
  'also',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'above',
  'without',
  'within',
  'across',
  'against',
  'during',
  'through',
  'true',
  'false',
  'null',
  'undefined',
  'function',
  'const',
  'return',
  'class',
  'import',
  'export',
  'require',
  'module',
  'exports',
  'type',
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'void',
  'test',
  'tests',
  'item',
  'spec',
  'pass',
]);

const EXPLICIT_LOCATION_REGEX =
  /(?:Chỗ|Target location|Location|File):\s*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?/gi;

/**
 * Extract keywords from text, filtering out stop words.
 */
function extractKeywords(texts) {
  const words = new Set();
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    const tokens = text.match(/[A-Za-z_$][A-Za-z0-9_$-]{2,}/g) || [];
    for (const t of tokens) {
      const lower = t.toLowerCase();
      if (!STOP_WORDS.has(lower) && t.length >= 3) {
        words.add(t);
      }
    }
  }
  return Array.from(words);
}

/**
 * Parses explicit file:line annotations if present in specText or notes.
 */
function extractExplicitLocations(text) {
  if (typeof text !== 'string') return [];
  const locations = [];
  const matches = text.matchAll(EXPLICIT_LOCATION_REGEX);
  for (const match of matches) {
    const file = match[1].replace(/\\/g, '/');
    const startLine = match[2] ? parseInt(match[2], 10) : null;
    const endLine = match[3] ? parseInt(match[3], 10) : startLine;
    locations.push({ file, startLine, endLine, explicit: true });
  }
  return locations;
}

/**
 * Scan a source file for keyword occurrences and cluster them into line ranges.
 */
function scanFileForRanges(filePath, keywords, options = {}) {
  const maxSpan = options.maxSpan || 25;
  const padding = options.padding || 3;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const hits = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const line = lines[idx];
    const matched = [];
    for (const kw of keywords) {
      if (line.includes(kw)) {
        matched.push(kw);
      }
    }
    if (matched.length > 0) {
      hits.push({ lineNum, matched });
    }
  }

  if (hits.length === 0) return [];

  // Cluster hits within maxSpan lines
  const clusters = [];
  let curCluster = null;

  for (const hit of hits) {
    if (!curCluster) {
      curCluster = {
        start: Math.max(1, hit.lineNum - padding),
        end: Math.min(lines.length, hit.lineNum + padding),
        symbols: new Set(hit.matched),
      };
    } else if (hit.lineNum - curCluster.end <= maxSpan) {
      curCluster.end = Math.min(lines.length, hit.lineNum + padding);
      for (const m of hit.matched) curCluster.symbols.add(m);
    } else {
      clusters.push(curCluster);
      curCluster = {
        start: Math.max(1, hit.lineNum - padding),
        end: Math.min(lines.length, hit.lineNum + padding),
        symbols: new Set(hit.matched),
      };
    }
  }
  if (curCluster) clusters.push(curCluster);

  return clusters.map((c) => ({
    startLine: c.start,
    endLine: c.end,
    symbols: Array.from(c.symbols),
  }));
}

/**
 * Pinpoints target code locations for a Work Item.
 */
function pinpointTarget(item, options = {}, deps = {}) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || (d && d.rootDir) || process.cwd());
  const i = item || {};

  const allowedPaths = Array.isArray(i.allowedPaths) ? i.allowedPaths : [];
  const specText = String(i.specText || i.sourceText || '');
  const criteria = Array.isArray(i.acceptanceCriteria) ? i.acceptanceCriteria : [];
  const outcome = String(i.businessOutcome || i.title || '');

  // 1. Explicit locations mentioned in specText
  const explicit = extractExplicitLocations(specText);
  const locations = [];

  for (const exp of explicit) {
    locations.push({
      file: exp.file,
      startLine: exp.startLine,
      endLine: exp.endLine,
      symbols: [],
      explicit: true,
      action: 'EDIT',
    });
  }

  // 2. Keyword discovery across allowedPaths
  const keywords = extractKeywords([...criteria, outcome, specText]);

  for (const relPath of allowedPaths) {
    if (!relPath || typeof relPath !== 'string') continue;
    const normalized = relPath.replace(/\\/g, '/');

    // Skip docs and register from code range scanning unless explicitly target
    if (normalized.endsWith('.md') || normalized.endsWith('.csv') || normalized.endsWith('.json')) {
      continue;
    }

    // Already explicitly located?
    if (locations.some((loc) => loc.file === normalized)) {
      continue;
    }

    const fullPath = path.resolve(rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      locations.push({
        file: normalized,
        startLine: null,
        endLine: null,
        symbols: [],
        explicit: false,
        action: 'CREATE',
      });
      continue;
    }

    const ranges = scanFileForRanges(fullPath, keywords, opts);
    if (ranges.length > 0) {
      for (const r of ranges.slice(0, 3)) {
        locations.push({
          file: normalized,
          startLine: r.startLine,
          endLine: r.endLine,
          symbols: r.symbols,
          explicit: false,
          action: 'EDIT',
        });
      }
    } else {
      locations.push({
        file: normalized,
        startLine: 1,
        endLine: 50,
        symbols: [],
        explicit: false,
        action: 'EDIT',
      });
    }
  }

  const promptHeader = formatPinpointPromptHeader(i, locations);

  return {
    workItemId: i.id || null,
    locations,
    keywords,
    promptHeader,
  };
}

/**
 * Formats the concise pinpointed brief to be placed at the top of the prompt.
 */
function formatPinpointPromptHeader(item, locations) {
  if (!locations || locations.length === 0) return '';
  const i = item || {};
  const lines = [];

  lines.push('=== TARGET LOCATION & PINPOINTED BRIEF ===');
  lines.push(
    'FOCUSED EDITING: Jump directly to the target locations below. Do NOT spend tokens scanning or exploring unrelated files.'
  );
  lines.push('');
  lines.push('Target files & lines:');
  for (const loc of locations) {
    if (loc.action === 'CREATE') {
      lines.push(`- ${loc.file} (New file to create)`);
    } else if (loc.startLine && loc.endLine) {
      const sym =
        loc.symbols && loc.symbols.length > 0 ? ` [${loc.symbols.slice(0, 5).join(', ')}]` : '';
      lines.push(`- ${loc.file}:${loc.startLine}-${loc.endLine}${sym}`);
    } else {
      lines.push(`- ${loc.file}`);
    }
  }
  lines.push('');
  lines.push('=== END OF TARGET LOCATION ===');
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  pinpointTarget,
  formatPinpointPromptHeader,
  extractKeywords,
  extractExplicitLocations,
  scanFileForRanges,
};
