#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Controller No-Hardcode Guard (TASK-AI-142)
 *
 * Operator rule: NO hardcoded model ids, model lists, benchmark/quality scores,
 * provider/account lists, or numeric attempt/probe caps in the Controller.
 * These must come from live sources (provider /models, leaderboards, route health, config).
 *
 * Scans changed files (default: git diff --name-only origin/main...HEAD) or all files (--all)
 * under tools/ai-brain (excluding test/ and fixtures) and tools/ai-brain/data/*.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import parser from '@typescript-eslint/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const DEFAULT_BASELINE_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'ai',
  'hardcode-baseline.json'
);
export const DEFAULT_ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'ai',
  'hardcode-allowlist.json'
);

export const MODEL_FAMILY_RE =
  /gpt-|claude-|gemini-|deepseek|qwen|glm-|grok-|kimi|mistral|llama|mercury|muse-/i;

export const CAP_NAME_RE = /max_?(Attempts|Probes)|probe_?Budget|attempt(s)?_?Limit|quality/i;

export const SCORE_KEY_RE =
  /score|quality|grade|index|rating|livebench|aacodingindex|aaagenticindex/i;

export const AI_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'meta',
  'mistral',
  'deepseek',
  'groq',
  'azure',
  'cohere',
  'together',
  'openrouter',
  'ninerouter',
  'cbai',
  'cl',
  'ocz',
  'xmtp',
  'kimchi',
  'siliconflow',
  'kc',
  'kr',
  'ag',
  'gh',
  'cc',
  'rqsty',
  'thb',
  'bai',
  'poolside',
  'internlm',
  'minimax',
  'tencent',
  'baseten',
  'inception',
  'regolo',
  'amd',
  'dahl',
  'bedrock',
  'vertex',
  'aws',
  'ollama',
  'vllm',
  'fireworks',
  'ai21',
  'perplexity',
  'replicate',
  'xai',
  'cline',
  'openclaw',
  'codex',
  'zai',
  'cline-free',
]);

const NON_MODEL_PATH_PREFIXES = [
  './',
  '../',
  '/',
  'node:',
  'http:',
  'https:',
  'origin/',
  'refs/',
  'heads/',
  'feat/',
  'fix/',
  'chore/',
  'docs/',
  'application/',
  'text/',
  'image/',
  'tools/',
  'scripts/',
  'apps/',
  'packages/',
  'infra/',
  'data/',
];

const NON_MODEL_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonl',
  '.md',
  '.txt',
  '.csv',
  '.yml',
  '.yaml',
  '.ps1',
  '.sh',
  '.lock',
  '.html',
  '.css',
  '.ts',
];

export function normalizePath(p) {
  if (!p) return '';
  let rel = path.isAbsolute(p) ? path.relative(REPO_ROOT, p) : p;
  return rel
    .split(path.sep)
    .join('/')
    .replace(/^[./]+/, '');
}

export function isTargetFile(relPath) {
  const norm = normalizePath(relPath);
  if (!norm.startsWith('tools/ai-brain/')) return false;
  if (norm.includes('/test/') || norm.includes('/fixtures/')) return false;

  // Under tools/ai-brain/data/, only direct JSON files match
  if (norm.startsWith('tools/ai-brain/data/')) {
    const afterData = norm.slice('tools/ai-brain/data/'.length);
    if (afterData.includes('/') || !afterData.endsWith('.json')) {
      return false;
    }
    return true;
  }

  // Under tools/ai-brain/, match code and json files
  return /\.(js|mjs|cjs|json)$/i.test(norm);
}

export function isModelId(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!s || s.length > 120) return false;
  if (s.includes(' ') || s.includes('\n') || s.includes('\t')) return false;

  if (MODEL_FAMILY_RE.test(s)) {
    if (s.startsWith('http://') || s.startsWith('https://')) return false;
    if (NON_MODEL_EXTENSIONS.some((ext) => s.endsWith(ext))) return false;
    if (s.startsWith('./') || s.startsWith('../') || s.startsWith('/')) return false;
    return true;
  }

  if (s.includes('/')) {
    if (NON_MODEL_PATH_PREFIXES.some((pre) => s.startsWith(pre))) return false;
    if (NON_MODEL_EXTENSIONS.some((ext) => s.endsWith(ext))) return false;
    if (s.startsWith('@') || s.endsWith('/') || s.toLowerCase() === 'n/a') return false;
    if (s.includes('*') || s.includes('^') || s.includes('[') || s.includes('(')) return false;
    if (
      s.startsWith('vinh05092001/') ||
      s.startsWith('shipde/') ||
      s.startsWith('shipde-model-evaluation/')
    ) {
      return false;
    }

    const parts = s.split('/');
    if (AI_PROVIDERS.has(parts[0].toLowerCase())) {
      return true;
    }
  }

  return false;
}

function getPropertyName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return null;
}

function isNumericLiteral(node) {
  if (!node) return false;
  if (node.type === 'Literal' && typeof node.value === 'number') return true;
  if (
    node.type === 'UnaryExpression' &&
    (node.operator === '-' || node.operator === '+') &&
    node.argument &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number'
  ) {
    return true;
  }
  return false;
}

function getNumericValue(node) {
  if (!node) return null;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'UnaryExpression' && node.argument) {
    return node.operator === '-' ? -node.argument.value : node.argument.value;
  }
  return null;
}

export function scanFile(filePath) {
  const normFile = normalizePath(filePath);
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Cannot read target file: ${normFile}`);

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  let ast;
  try {
    const isJson = normFile.endsWith('.json');
    ast = parser.parse(isJson ? '(' + content + ')' : content, {
      loc: true,
      range: true,
      ecmaVersion: 'latest',
    });
  } catch (err) {
    throw new Error(`Cannot parse target file ${normFile}: ${err.message}`);
  }

  const violations = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    // Rule 1: String literal that looks like a model ID
    if (node.type === 'Literal' && typeof node.value === 'string') {
      if (isModelId(node.value)) {
        violations.push({
          file: normFile,
          line: node.loc.start.line,
          rule: 'MODEL_ID_LITERAL',
          matched: node.value,
          lineText: lines[node.loc.start.line - 1] || '',
        });
      }
    }

    // Rule 2: Object or array literal pairing model id with number (score)
    if (node.type === 'ObjectExpression' && node.properties) {
      let hasModel = false;
      let modelName = '';
      let hasScore = false;
      let scoreVal = null;

      for (const prop of node.properties) {
        if (prop.type !== 'Property') continue;
        const keyName = getPropertyName(prop.key);

        // Key itself looks like model id and value is numeric
        if (keyName && isModelId(keyName) && isNumericLiteral(prop.value)) {
          violations.push({
            file: normFile,
            line: prop.loc.start.line,
            rule: 'MODEL_SCORE_PAIR',
            matched: keyName + ': ' + getNumericValue(prop.value),
            lineText: lines[prop.loc.start.line - 1] || '',
          });
        }

        // Key indicates model
        if (keyName && /^(model|modelId|model_id|canonical)$/i.test(keyName)) {
          if (prop.value && prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
            hasModel = true;
            modelName = prop.value.value;
          }
        } else if (
          prop.value &&
          prop.value.type === 'Literal' &&
          typeof prop.value.value === 'string' &&
          isModelId(prop.value.value)
        ) {
          hasModel = true;
          modelName = prop.value.value;
        }

        // Key indicates score or is numeric score
        if (keyName && SCORE_KEY_RE.test(keyName) && isNumericLiteral(prop.value)) {
          hasScore = true;
          scoreVal = getNumericValue(prop.value);
        }
      }

      if (hasModel && hasScore) {
        violations.push({
          file: normFile,
          line: node.loc.start.line,
          rule: 'MODEL_SCORE_PAIR',
          matched: modelName + ' -> score: ' + scoreVal,
          lineText: lines[node.loc.start.line - 1] || '',
        });
      }
    }

    if (node.type === 'ArrayExpression' && node.elements && node.elements.length === 2) {
      const [e1, e2] = node.elements;
      if (e1 && e2) {
        if (
          e1.type === 'Literal' &&
          typeof e1.value === 'string' &&
          isModelId(e1.value) &&
          isNumericLiteral(e2)
        ) {
          violations.push({
            file: normFile,
            line: node.loc.start.line,
            rule: 'MODEL_SCORE_PAIR',
            matched: e1.value + ' -> ' + getNumericValue(e2),
            lineText: lines[node.loc.start.line - 1] || '',
          });
        }
      }
    }

    // Rule 3: Numeric literal assigned to names matching /max(Attempts|Probes)|probeBudget|attempt(s)?Limit|quality/i
    if (node.type === 'VariableDeclarator' && node.id && node.id.name) {
      if (CAP_NAME_RE.test(node.id.name) && isNumericLiteral(node.init)) {
        violations.push({
          file: normFile,
          line: node.loc.start.line,
          rule: 'NUMERIC_CAP',
          matched: node.id.name + ' = ' + getNumericValue(node.init),
          lineText: lines[node.loc.start.line - 1] || '',
        });
      }
    }

    if (node.type === 'AssignmentExpression' || node.type === 'AssignmentPattern') {
      const targetName =
        getPropertyName(node.left) || (node.left.property && getPropertyName(node.left.property));
      if (targetName && CAP_NAME_RE.test(targetName) && isNumericLiteral(node.right)) {
        violations.push({
          file: normFile,
          line: node.loc.start.line,
          rule: 'NUMERIC_CAP',
          matched: targetName + ' = ' + getNumericValue(node.right),
          lineText: lines[node.loc.start.line - 1] || '',
        });
      }
    }

    if (node.type === 'Property' && node.key) {
      const keyName = getPropertyName(node.key);
      if (
        keyName &&
        CAP_NAME_RE.test(keyName) &&
        node.value?.type === 'AssignmentPattern' &&
        node.value.left.name !== keyName &&
        isNumericLiteral(node.value.right)
      ) {
        violations.push({
          file: normFile,
          line: node.loc.start.line,
          rule: 'NUMERIC_CAP',
          matched: keyName + ' = ' + getNumericValue(node.value.right),
          lineText: lines[node.loc.start.line - 1] || '',
        });
      }
      if (keyName && CAP_NAME_RE.test(keyName) && isNumericLiteral(node.value)) {
        violations.push({
          file: normFile,
          line: node.loc.start.line,
          rule: 'NUMERIC_CAP',
          matched: keyName + ': ' + getNumericValue(node.value),
          lineText: lines[node.loc.start.line - 1] || '',
        });
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'parent' || k === 'loc' || k === 'range') continue;
      const child = node[k];
      if (Array.isArray(child)) {
        child.forEach(walk);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }

  walk(ast);
  return violations;
}

export function loadAllowlist(allowlistPath = DEFAULT_ALLOWLIST_PATH) {
  if (!fs.existsSync(allowlistPath)) return [];
  try {
    const raw = fs.readFileSync(allowlistPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    for (const entry of parsed) {
      if (
        !entry.file ||
        !entry.pattern ||
        !entry.reason ||
        typeof entry.reason !== 'string' ||
        !entry.reason.trim()
      ) {
        throw new Error(
          `Invalid allowlist entry: missing required reason, file, or pattern in ${JSON.stringify(entry)}`
        );
      }
    }
    return parsed;
  } catch (err) {
    throw new Error(`Failed to load allowlist from ${allowlistPath}: ${err.message}`);
  }
}

export function loadBaseline(baselinePath = DEFAULT_BASELINE_PATH) {
  if (!fs.existsSync(baselinePath)) throw new Error(`Cannot read baseline: ${baselinePath}`);
  try {
    const raw = fs.readFileSync(baselinePath, 'utf8');
    const parsed = JSON.parse(raw);
    validateBaseline(parsed);
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    return {
      total: typeof parsed.total === 'number' ? parsed.total : violations.length,
      violations,
    };
  } catch (err) {
    throw new Error(`Failed to load baseline from ${baselinePath}: ${err.message}`);
  }
}

export function isAllowlisted(violation, allowlist) {
  if (!allowlist || !Array.isArray(allowlist)) return false;
  return allowlist.some((entry) => {
    const entryFile = normalizePath(entry.file);
    if (entryFile !== violation.file) return false;
    const re = new RegExp(entry.pattern, 'i');
    return re.test(violation.matched);
  });
}

export function getTargetFiles(baseDir = path.join(REPO_ROOT, 'tools', 'ai-brain')) {
  const result = [];
  function collect(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name === 'test' ||
          ent.name === 'fixtures' ||
          ent.name === 'node_modules' ||
          ent.name === '.git'
        ) {
          continue;
        }
        if (path.basename(dir) === 'ai-brain' && ent.name === 'data') {
          // Direct children only of data
          for (const dEnt of fs.readdirSync(full, { withFileTypes: true })) {
            if (!dEnt.isDirectory() && dEnt.name.endsWith('.json')) {
              result.push(path.join(full, dEnt.name));
            }
          }
          continue;
        }
        collect(full);
      } else if (/\.(?:js|mjs|cjs|json)$/.test(ent.name)) {
        result.push(full);
      }
    }
  }
  collect(baseDir);
  return result;
}

export function scanFiles(fileList) {
  const all = [];
  for (const f of fileList) {
    const v = scanFile(f);
    all.push(...v);
  }
  return all;
}

export function checkViolations(scannedViolations, allowlist, baseline) {
  const unallowlisted = scannedViolations.filter((v) => !isAllowlisted(v, allowlist));
  const allowlistedCount = scannedViolations.length - unallowlisted.length;

  const baselineList = [...(baseline && baseline.violations ? baseline.violations : [])];
  const matchedBaselineIndices = new Set();
  const newViolations = [];
  const baselineHits = [];

  for (const v of unallowlisted) {
    // Exact match (file, line, rule, matched)
    let foundIndex = baselineList.findIndex(
      (b, idx) =>
        !matchedBaselineIndices.has(idx) &&
        normalizePath(b.file) === v.file &&
        b.line === v.line &&
        b.rule === v.rule &&
        b.matched === v.matched
    );

    // Fallback match (file, rule, matched) if line shifted
    if (foundIndex === -1) {
      foundIndex = baselineList.findIndex(
        (b, idx) =>
          !matchedBaselineIndices.has(idx) &&
          normalizePath(b.file) === v.file &&
          b.rule === v.rule &&
          b.matched === v.matched
      );
    }

    if (foundIndex !== -1) {
      matchedBaselineIndices.add(foundIndex);
      baselineHits.push(v);
    } else {
      newViolations.push(v);
    }
  }

  return {
    scannedCount: scannedViolations.length,
    allowlistedCount,
    baselineHitsCount: baselineHits.length,
    newViolations,
  };
}

export function generateBaseline(
  targetFiles,
  allowlistPath = DEFAULT_ALLOWLIST_PATH,
  outPath = DEFAULT_BASELINE_PATH
) {
  const allowlist = loadAllowlist(allowlistPath);
  const rawViolations = scanFiles(targetFiles);
  const unallowlisted = rawViolations
    .filter((v) => !isAllowlisted(v, allowlist))
    .map((v) => ({
      file: v.file,
      line: v.line,
      rule: v.rule,
      matched: v.matched,
    }))
    .sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      if (a.line !== b.line) return a.line - b.line;
      if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
      return a.matched.localeCompare(b.matched);
    });

  const report = {
    total: unallowlisted.length,
    generatedAt: new Date().toISOString(),
    violations: unallowlisted,
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw new Error('Git failed (' + args.join(' ') + '): ' + (err.stderr || err.message));
  }
}
function baseRef() {
  return 'origin/' + (process.env.GITHUB_BASE_REF || 'main');
}
function getChangedFiles(mode) {
  const base = git(['merge-base', baseRef(), 'HEAD']);
  return git(
    mode === 'staged'
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
      : ['diff', '--name-only', '--diff-filter=ACMR', base]
  )
    .split('\n')
    .filter(Boolean);
}
function validateBaseline(parsed) {
  if (!parsed || !Array.isArray(parsed.violations) || parsed.total !== parsed.violations.length)
    throw new Error('Invalid baseline: total must equal violations.length');
}
export function enforceBaselineShrink(baseline, previous) {
  validateBaseline(baseline);
  validateBaseline(previous);
  const key = (v) => JSON.stringify([normalizePath(v.file), v.rule, v.matched]);
  const remaining = previous.violations.map(key);
  for (const entry of baseline.violations) {
    const index = remaining.indexOf(key(entry));
    if (index === -1) throw new Error('Baseline can only shrink: added violation entry');
    remaining.splice(index, 1);
  }
}
function checkBaseBaseline(baseline, baselinePath) {
  const ref = baseRef();
  const base = git(['merge-base', ref, 'HEAD']);
  const relative = normalizePath(baselinePath);
  if (!git(['ls-tree', ref, '--', relative])) {
    if (
      git(['ls-tree', base, '--', relative]) ||
      !git(['diff', '--name-only', '--diff-filter=A', base, '--', relative])
    )
      throw new Error('Cannot read base baseline: file is not new in this PR: ' + relative);
    validateBaseline(baseline);
    return;
  }
  enforceBaselineShrink(baseline, JSON.parse(git(['show', ref + ':' + relative])));
}

export async function runCli(argv = process.argv.slice(2)) {
  const isAll = argv.includes('--all');
  const isStaged = argv.includes('--staged');
  const isGenerateBaseline = argv.includes('--generate-baseline');
  const isJson = argv.includes('--json');

  let baselinePath = DEFAULT_BASELINE_PATH;
  const bIndex = argv.indexOf('--baseline');
  if (bIndex !== -1 && argv[bIndex + 1]) {
    baselinePath = path.resolve(process.cwd(), argv[bIndex + 1]);
  }

  let allowlistPath = DEFAULT_ALLOWLIST_PATH;
  const aIndex = argv.indexOf('--allowlist');
  if (aIndex !== -1 && argv[aIndex + 1]) {
    allowlistPath = path.resolve(process.cwd(), argv[aIndex + 1]);
  }

  const explicitFiles = argv.filter(
    (arg) =>
      !arg.startsWith('--') &&
      (bIndex === -1 || arg !== argv[bIndex + 1]) &&
      (aIndex === -1 || arg !== argv[aIndex + 1])
  );

  let filesToScan = [];
  if (isAll || isGenerateBaseline) {
    filesToScan = getTargetFiles();
  } else if (explicitFiles.length > 0) {
    filesToScan = explicitFiles;
  } else if (isStaged) {
    filesToScan = getChangedFiles('staged').filter(isTargetFile);
  } else {
    filesToScan = getChangedFiles('default').filter(isTargetFile);
  }

  const allowlist = loadAllowlist(allowlistPath);

  if (isGenerateBaseline) {
    const report = generateBaseline(filesToScan, allowlistPath, baselinePath);
    console.log(
      `[hardcode-guard] Baseline generated with ${report.total} violations: ${baselinePath}`
    );
    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    }
    return 0;
  }

  const baseline = loadBaseline(baselinePath);

  checkBaseBaseline(baseline, baselinePath);

  const scannedViolations = scanFiles(filesToScan);
  const result = checkViolations(scannedViolations, allowlist, baseline);

  // In --all mode, also verify total violations count does not exceed baseline total
  let totalExceeded = false;
  if (isAll) {
    const allUnallowlisted = scannedViolations.filter((v) => !isAllowlisted(v, allowlist));
    if (allUnallowlisted.length > baseline.total) {
      totalExceeded = true;
      console.error(
        `\x1b[31m[ERROR] Total violations (${allUnallowlisted.length}) exceeds baseline (${baseline.total}). The baseline can only shrink.\x1b[0m`
      );
    }
  }

  if (result.newViolations.length > 0 || totalExceeded) {
    console.error(
      `\x1b[31m[ERROR] No-hardcode guard failed! Found ${result.newViolations.length} new violations not in baseline:\x1b[0m\n`
    );
    for (const v of result.newViolations) {
      console.error(
        `  \x1b[33m${v.file}:${v.line}\x1b[0m [\x1b[36m${v.rule}\x1b[0m]: ${v.matched}`
      );
      if (v.lineText) {
        console.error(`    > ${v.lineText.trim()}`);
      }
    }
    console.error(
      `\nOperator rule: Model IDs, scores, and numeric caps must come from live sources (provider /models, leaderboards, route health, config).\n`
    );
    return 1;
  }

  console.log(
    `[hardcode-guard] PASS: ${filesToScan.length} files scanned, ${result.scannedCount} raw instances (${result.allowlistedCount} allowlisted, ${result.baselineHitsCount} in baseline, 0 new). Baseline: ${baseline.total}.`
  );
  return 0;
}

// Run CLI when executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(`[hardcode-guard] ERROR: ${err.message}`);
      process.exit(1);
    });
}
