'use strict';

/**
 * Ship Dễ — Serena Read-Only Pilot for Code Retrieval (TASK-AI-32)
 *
 * Implements symbol and reference lookup for authors (Gemini, Claude, 9Router)
 * to retrieve focused code context rather than whole files, measured against
 * the TokenPerMergedItem efficiency metric (AI-TOOL-01, AI-32-R01..R06).
 *
 * Invariants:
 * 1. Read-only invariant (AI-32-R01): Serena code retrieval never mutates source
 *    files or repository state. Passing mutation flags throws MUTATION_REFUSED.
 * 2. Source of truth boundary (AI-32-R02): Code analysis assistant; output is
 *    implementation evidence, never business authority.
 * 3. Measured against TokenPerMergedItem (AI-32-R03): Focused AST retrieval is
 *    measured against full-file context ingestion, targeting prompt token reduction
 *    under TOKENS_PER_MERGED_CEILING (500,000 tokens from TASK-AI-25).
 * 4. Deterministic extraction (AI-32-R04): Symbol definitions report accurate line
 *    bounds (startLine, endLine), declarations, and code slices.
 * 5. Reference resolution (AI-32-R05): Usages across codebase files are located
 *    by identifier boundary scanning.
 * 6. Fail-closed on missing sources (AI-32-R06): Non-existent files/roots fail
 *    cleanly with SOURCE_MISSING rather than empty agreement.
 */

const fs = require('fs');
const path = require('path');

const TOKENS_PER_MERGED_CEILING = 500000;
const SNAPSHOT_PATH = path.join(__dirname, '..', 'snapshots', 'serena');

const SUPPORTED_EXTENSIONS = new Set([
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.py',
  '.mjs',
  '.cjs',
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.ai-local',
  '.worktrees',
  'coverage',
]);

/**
 * Estimates token count from text using standard 4 chars/token heuristic.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * Asserts the read-only invariant. Throws MUTATION_REFUSED if any write or
 * mutation parameter is requested.
 */
function assertReadOnly(options) {
  if (!options) return;
  if (options.write || options.mutate || options.edit || options.modify) {
    const err = new Error(
      'MUTATION_REFUSED: Serena code retrieval is strictly read-only; mutation is prohibited'
    );
    err.code = 'MUTATION_REFUSED';
    throw err;
  }
}

/**
 * Walks directory recursively, collecting files matching supported extensions.
 */
function collectSourceFiles(rootDir, maxFiles = 2000) {
  const results = [];

  function walk(currentDir) {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const name = entry.name;
      if (IGNORED_DIRECTORIES.has(name)) continue;

      const fullPath = path.join(currentDir, name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Extracts symbols from a single file with startLine, endLine, declaration, and slice.
 */
function extractSymbolsFromFile(filePath, rootDir = process.cwd()) {
  if (!fs.existsSync(filePath)) {
    const err = new Error('SOURCE_MISSING: ' + filePath);
    err.code = 'SOURCE_MISSING';
    throw err;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const symbols = [];

  const fnPattern = /^(?:export\s+)?(?:async\s+)?function(?:\s+|\s*\*\s*)([a-zA-Z0-9_$]+)\s*\(/;
  const classPattern = /^(?:export\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends|\s*\{|\s*$)/;
  const varFnPattern =
    /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/;
  const varFnExprPattern =
    /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?function\b/;
  const methodPattern = /^\s*(?:async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/;
  const interfacePattern = /^(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)(?:\s+extends|\s*\{|\s*$)/;
  const typePattern = /^(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/;
  const pyDefPattern = /^(?:async\s+)?def\s+([a-zA-Z0-9_$]+)\s*\(/;
  const pyClassPattern = /^class\s+([a-zA-Z0-9_$]+)(?:\s*\(|\s*:)/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      continue;
    }

    let match = null;
    let kind = null;

    if ((match = fnPattern.exec(trimmed))) {
      kind = 'function';
    } else if ((match = classPattern.exec(trimmed))) {
      kind = 'class';
    } else if ((match = varFnPattern.exec(trimmed)) || (match = varFnExprPattern.exec(trimmed))) {
      kind = 'function';
    } else if (
      (match = methodPattern.exec(line)) &&
      !trimmed.startsWith('if') &&
      !trimmed.startsWith('for') &&
      !trimmed.startsWith('while') &&
      !trimmed.startsWith('switch')
    ) {
      kind = 'method';
    } else if ((match = interfacePattern.exec(trimmed))) {
      kind = 'interface';
    } else if ((match = typePattern.exec(trimmed))) {
      kind = 'type';
    } else if ((match = pyDefPattern.exec(trimmed))) {
      kind = 'function';
    } else if ((match = pyClassPattern.exec(trimmed))) {
      kind = 'class';
    }

    if (match) {
      const name = match[1];
      const startLine = i + 1;
      let endLine = startLine;

      if (filePath.endsWith('.py')) {
        const baseIndent = line.search(/\S/);
        for (let j = i + 1; j < lines.length; j += 1) {
          const nextTrimmed = lines[j].trim();
          if (!nextTrimmed || nextTrimmed.startsWith('#')) continue;
          const nextIndent = lines[j].search(/\S/);
          if (nextIndent <= baseIndent) {
            endLine = j;
            break;
          }
          endLine = j + 1;
        }
      } else {
        let openBraces = 0;
        let started = false;
        for (let j = i; j < lines.length; j += 1) {
          const l = lines[j];
          for (let k = 0; k < l.length; k += 1) {
            const char = l[k];
            if (char === '{') {
              openBraces += 1;
              started = true;
            } else if (char === '}') {
              openBraces -= 1;
            }
          }
          if (started && openBraces <= 0) {
            endLine = j + 1;
            break;
          }
          if (j === i && !started && (trimmed.endsWith(';') || trimmed.includes('=>'))) {
            endLine = startLine;
            break;
          }
          endLine = j + 1;
        }
      }

      const symbolLines = lines.slice(startLine - 1, endLine);
      const symbolContent = symbolLines.join('\n');

      symbols.push({
        name,
        kind,
        file: relPath,
        startLine,
        endLine,
        declaration: trimmed,
        content: symbolContent,
        tokens: estimateTokens(symbolContent),
      });
    }
  }

  return symbols;
}

/**
 * Searches for symbol definition(s) across target file or codebase.
 */
function lookupSymbols(options) {
  assertReadOnly(options);
  const opts = options || {};
  const symbol = String(opts.symbol || '').trim();
  if (!symbol) {
    const err = new Error('SOURCE_MISSING: symbol name is required');
    err.code = 'SOURCE_MISSING';
    throw err;
  }

  const rootDir = path.resolve(opts.root || process.cwd());
  if (!fs.existsSync(rootDir)) {
    const err = new Error('SOURCE_MISSING: root directory ' + rootDir);
    err.code = 'SOURCE_MISSING';
    throw err;
  }

  let filesToScan = [];
  if (opts.file) {
    const targetPath = path.resolve(rootDir, opts.file);
    if (!fs.existsSync(targetPath)) {
      const err = new Error('SOURCE_MISSING: file ' + opts.file);
      err.code = 'SOURCE_MISSING';
      throw err;
    }
    filesToScan = [targetPath];
  } else {
    filesToScan = collectSourceFiles(rootDir);
  }

  const definitions = [];
  for (const filePath of filesToScan) {
    const symbols = extractSymbolsFromFile(filePath, rootDir);
    for (const sym of symbols) {
      if (sym.name === symbol) {
        if (!opts.kind || sym.kind === opts.kind) {
          definitions.push(sym);
        }
      }
    }
  }

  return {
    symbol,
    count: definitions.length,
    definitions,
  };
}

/**
 * Searches for references to a symbol across codebase files.
 */
function lookupReferences(options) {
  assertReadOnly(options);
  const opts = options || {};
  const symbol = String(opts.symbol || '').trim();
  if (!symbol) {
    const err = new Error('SOURCE_MISSING: symbol name is required');
    err.code = 'SOURCE_MISSING';
    throw err;
  }

  const rootDir = path.resolve(opts.root || process.cwd());
  if (!fs.existsSync(rootDir)) {
    const err = new Error('SOURCE_MISSING: root directory ' + rootDir);
    err.code = 'SOURCE_MISSING';
    throw err;
  }

  let filesToScan = [];
  if (opts.file) {
    const targetPath = path.resolve(rootDir, opts.file);
    if (!fs.existsSync(targetPath)) {
      const err = new Error('SOURCE_MISSING: file ' + opts.file);
      err.code = 'SOURCE_MISSING';
      throw err;
    }
    filesToScan = [targetPath];
  } else {
    filesToScan = collectSourceFiles(rootDir);
  }

  const refRegex = new RegExp('\\b' + symbol.replace(/[$]/g, '\\$') + '\\b');
  const references = [];

  for (const filePath of filesToScan) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (refRegex.test(line)) {
        const trimmed = line.trim();
        const isDef =
          trimmed.startsWith('function ' + symbol) ||
          trimmed.startsWith('async function ' + symbol) ||
          trimmed.startsWith('class ' + symbol) ||
          trimmed.includes('const ' + symbol) ||
          trimmed.includes('let ' + symbol);

        references.push({
          file: relPath,
          line: i + 1,
          lineText: trimmed,
          isDefinition: isDef,
        });
      }
    }
  }

  return {
    symbol,
    count: references.length,
    references,
  };
}

/**
 * Measures token efficiency of symbol retrieval vs full-file context loading.
 * Compares focused context against full-file context and TOKENS_PER_MERGED_CEILING.
 */
function measureTokenEfficiency(options) {
  assertReadOnly(options);
  const opts = options || {};
  const symbolLookup = lookupSymbols(opts);
  const refLookup = lookupReferences(opts);

  const rootDir = path.resolve(opts.root || process.cwd());
  const filesSet = new Set();
  const focusedChunks = [];

  for (const def of symbolLookup.definitions) {
    filesSet.add(path.resolve(rootDir, def.file));
    focusedChunks.push(def.content);
  }

  for (const ref of refLookup.references) {
    filesSet.add(path.resolve(rootDir, ref.file));
    focusedChunks.push(ref.lineText);
  }

  const focusedText = focusedChunks.join('\n');
  const focusedTokens = estimateTokens(focusedText);

  let fullFilesText = '';
  const fileDetails = [];
  for (const f of filesSet) {
    if (fs.existsSync(f)) {
      const text = fs.readFileSync(f, 'utf8');
      fullFilesText += text + '\n';
      fileDetails.push({
        file: path.relative(rootDir, f).replace(/\\/g, '/'),
        tokens: estimateTokens(text),
      });
    }
  }

  const fullFilesTokens = estimateTokens(fullFilesText);
  const tokensSaved = Math.max(0, fullFilesTokens - focusedTokens);
  const savingsPercent =
    fullFilesTokens > 0 ? Number(((tokensSaved / fullFilesTokens) * 100).toFixed(1)) : 0;

  return {
    symbol: opts.symbol,
    definitionCount: symbolLookup.count,
    referenceCount: refLookup.count,
    filesInvolvedCount: filesSet.size,
    filesInvolved: fileDetails,
    focusedTokens,
    fullFilesTokens,
    tokensSaved,
    savingsPercent,
    tokenCeiling: TOKENS_PER_MERGED_CEILING,
    withinCeiling: focusedTokens <= TOKENS_PER_MERGED_CEILING,
    impactAssessment:
      'Focused retrieval consumed ' +
      focusedTokens +
      ' tokens vs ' +
      fullFilesTokens +
      ' tokens for full files (' +
      savingsPercent +
      '% reduction), reducing TokenPerMergedItem toward the ' +
      TOKENS_PER_MERGED_CEILING +
      ' ceiling.',
  };
}

/**
 * Checks health of the Serena pinned snapshot and ecosystem manifest alignment.
 */
function checkHealth(options) {
  const rootDir = path.resolve((options && options.root) || process.cwd());
  const snapshotDir = path.resolve(rootDir, 'tools/snapshots/serena');
  const readmePath = path.join(snapshotDir, 'README.md');
  const ecoManifestPath = path.resolve(rootDir, 'tools/ecosystem-manifest.json');

  const snapshotPresent = fs.existsSync(snapshotDir) && fs.existsSync(readmePath);
  let ecoEntry = null;

  if (fs.existsSync(ecoManifestPath)) {
    try {
      const eco = JSON.parse(fs.readFileSync(ecoManifestPath, 'utf8'));
      const adopted = eco.adopted || [];
      ecoEntry = adopted.find((item) => item.id === 'serena') || null;
    } catch {
      // Manifest unreadable
    }
  }

  const healthy = Boolean(
    snapshotPresent &&
    ecoEntry &&
    ecoEntry.permissions === 'ast-index-read' &&
    Array.isArray(ecoEntry.profiles) &&
    ecoEntry.profiles.includes('RESEARCH_ONLY')
  );

  return {
    healthy,
    snapshotPresent,
    snapshotDir: path.relative(rootDir, snapshotDir).replace(/\\/g, '/'),
    manifestEntryPresent: Boolean(ecoEntry),
    permissions: ecoEntry ? ecoEntry.permissions : null,
    profiles: ecoEntry ? ecoEntry.profiles : [],
  };
}

/**
 * Parses argv and dispatches Serena CLI subcommands.
 */
function runSerenaCli(argv) {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    console.log('Serena Code Retrieval Pilot (TASK-AI-32)');
    console.log('Usage: node tools/ai-brain/cli.js serena <subcommand> [options]');
    console.log('Subcommands:');
    console.log('  lookup       --symbol <name> [--file <path>] [--root <dir>] [--json]');
    console.log('  references   --symbol <name> [--file <path>] [--root <dir>] [--json]');
    console.log('  measure      --symbol <name> [--file <path>] [--root <dir>] [--json]');
    console.log('  health       [--root <dir>] [--json]');
    return 0;
  }

  const options = {};
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--symbol') {
      options.symbol = argv[i + 1];
      i += 1;
    } else if (arg === '--file') {
      options.file = argv[i + 1];
      i += 1;
    } else if (arg === '--root') {
      options.root = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--write' || arg === '--mutate' || arg === '--edit') {
      options.write = true;
    } else if (arg.startsWith('--')) {
      console.error('Unknown option: ' + arg);
      return 1;
    }
  }

  if (options.write) {
    console.error(
      'MUTATION_REFUSED: Serena code retrieval is strictly read-only; mutation is prohibited'
    );
    return 1;
  }

  if (sub === 'health') {
    options.root =
      options.root || path.resolve(path.dirname(require.resolve('./serena.js')), '..', '..');
    const health = checkHealth(options);
    if (options.json) {
      console.log(JSON.stringify(health, null, 2));
    } else {
      console.log('Serena Health: ' + (health.healthy ? 'HEALTHY' : 'UNHEALTHY'));
      console.log('  Snapshot present: ' + health.snapshotPresent);
      console.log('  Manifest entry:   ' + health.manifestEntryPresent);
      console.log('  Permissions:      ' + health.permissions);
      console.log('  Profiles:         ' + (health.profiles || []).join(', '));
    }
    return health.healthy ? 0 : 1;
  }

  if (sub === 'lookup' || sub === 'references' || sub === 'measure') {
    if (!options.symbol) {
      console.error('Missing required option: --symbol <name>');
      return 2;
    }

    try {
      if (sub === 'lookup') {
        const result = lookupSymbols(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('Symbol definitions found for ' + result.symbol + ': ' + result.count);
          for (const d of result.definitions) {
            console.log(
              '  ' +
                d.kind +
                ' ' +
                d.name +
                ' in ' +
                d.file +
                ':' +
                d.startLine +
                '-' +
                d.endLine +
                ' (~' +
                d.tokens +
                ' tokens)'
            );
          }
        }
        return 0;
      }

      if (sub === 'references') {
        const result = lookupReferences(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('References found for ' + result.symbol + ': ' + result.count);
          for (const r of result.references) {
            console.log(
              '  ' + r.file + ':' + r.line + (r.isDefinition ? ' [DEF]' : '') + '  ' + r.lineText
            );
          }
        }
        return 0;
      }

      if (sub === 'measure') {
        const result = measureTokenEfficiency(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('Token Efficiency for ' + result.symbol + ':');
          console.log('  Definitions:       ' + result.definitionCount);
          console.log('  References:        ' + result.referenceCount);
          console.log('  Files involved:    ' + result.filesInvolvedCount);
          console.log('  Focused retrieval: ~' + result.focusedTokens + ' tokens');
          console.log('  Full file context: ~' + result.fullFilesTokens + ' tokens');
          console.log(
            '  Tokens saved:      ~' +
              result.tokensSaved +
              ' tokens (' +
              result.savingsPercent +
              '%)'
          );
          console.log('  Ceiling:           ' + result.tokenCeiling + ' tokens');
          console.log('  Assessment: ' + result.impactAssessment);
        }
        return 0;
      }
    } catch (err) {
      if (err.code === 'SOURCE_MISSING') {
        console.error(err.message);
        return 2;
      }
      if (err.code === 'MUTATION_REFUSED') {
        console.error(err.message);
        return 1;
      }
      console.error('Error: ' + err.message);
      return 1;
    }
  }

  console.error('Unknown subcommand: ' + sub);
  return 2;
}

module.exports = {
  TOKENS_PER_MERGED_CEILING,
  SNAPSHOT_PATH,
  SUPPORTED_EXTENSIONS,
  estimateTokens,
  assertReadOnly,
  extractSymbolsFromFile,
  lookupSymbols,
  lookupReferences,
  measureTokenEfficiency,
  checkHealth,
  runSerenaCli,
};
