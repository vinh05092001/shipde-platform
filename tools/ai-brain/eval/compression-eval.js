'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CATEGORIES = {
  SPEC_DOCS: 'spec docs',
  CI_LOGS: 'CI logs',
  JSON: 'JSON',
  CODE_DIFFS: 'code diffs',
};

const ENGINE_STATUS = {
  INSTALLED: 'INSTALLED',
  NOT_INSTALLED: 'NOT_INSTALLED',
};

/**
 * Deterministic token estimation for code, diffs, JSON, logs, and markdown.
 * Uses standard LLM estimation heuristic (~4 characters per token).
 *
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Strict safety guard: compression is strictly forbidden on review, diagnosis, and triage paths
 * per AGENTS.md, AI-TOOLCHAIN-DECISIONS.md, and BR-COMP-02.
 *
 * @param {object} context
 * @returns {boolean}
 */
function isCompressionForbidden(context = {}) {
  const role = String(context.role || '').toLowerCase();
  const taskType = String(context.taskType || '').toLowerCase();
  const category = String(context.category || '').toLowerCase();
  const filePath = String(context.filePath || context.path || '').toLowerCase();

  const isReview =
    role.includes('review') ||
    taskType.includes('review') ||
    category.includes('review') ||
    filePath.includes('review');
  const isDiagnosis =
    role.includes('diagnos') ||
    role.includes('diag') ||
    taskType.includes('diagnos') ||
    taskType.includes('diag') ||
    category.includes('diagnos') ||
    category.includes('diag') ||
    filePath.includes('diag');
  const isTriage =
    role.includes('triage') ||
    taskType.includes('triage') ||
    category.includes('triage') ||
    filePath.includes('triage');

  return isReview || isDiagnosis || isTriage;
}

/**
 * Detect the evaluation category based on file path or content signatures.
 *
 * @param {string} filePath
 * @param {string} [content]
 * @returns {string}
 */
function detectCategory(filePath, content = '') {
  const normalizedPath = String(filePath || '')
    .replace(/\\/g, '/')
    .toLowerCase();
  const baseName = path.posix.basename(normalizedPath);

  // 1. Code diffs
  if (
    baseName.endsWith('.diff') ||
    baseName.endsWith('.patch') ||
    baseName.startsWith('diff-') ||
    /^(?:diff --git|--- [ab]\/|\+\+\+ [ab]\/|@@\s+-\d+)/m.test(content)
  ) {
    return CATEGORIES.CODE_DIFFS;
  }

  // 2. JSON
  if (baseName.endsWith('.json')) {
    return CATEGORIES.JSON;
  }
  const trimmed = content.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return CATEGORIES.JSON;
    } catch (_) {
      // not valid JSON, continue checking
    }
  }

  // 3. CI logs
  if (
    baseName.startsWith('ci-') ||
    baseName.includes('-ci') ||
    baseName.endsWith('.log') ||
    baseName.endsWith('.out') ||
    baseName.includes('ci-') ||
    /##\[group\]|##\[endgroup\]|\b(?:pnpm|npm|turbo|node)\s+(?:test|run|check)|\bexit code:\s*\d+/i.test(
      content
    )
  ) {
    return CATEGORIES.CI_LOGS;
  }

  // 4. Spec docs
  if (
    baseName.endsWith('.md') ||
    baseName.includes('spec') ||
    baseName.startsWith('job-') ||
    /^#{1,6}\s+.+/m.test(content)
  ) {
    return CATEGORIES.SPEC_DOCS;
  }

  return 'unknown';
}

/**
 * Lossless check for code diffs:
 * Line-faithfully verifies that EVERY diff hunk header (@@ ... @@) and EVERY changed line (+ or -)
 * in the original diff remains present in the compressed output without substring false positives.
 *
 * @param {string} originalDiff
 * @param {string} compressedDiff
 * @returns {{ passed: boolean, totalHunks: number, missingHunks: string[], totalChangedLines: number, missingChangedLines: string[] }}
 */
function losslessCheckDiff(originalDiff, compressedDiff) {
  if (typeof originalDiff !== 'string' || typeof compressedDiff !== 'string') {
    return {
      passed: false,
      totalHunks: 0,
      missingHunks: ['Invalid input type'],
      totalChangedLines: 0,
      missingChangedLines: ['Invalid input type'],
    };
  }

  const origHunks = [];
  const hunkHeaderRegex = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@.*$/gm;
  let match;
  while ((match = hunkHeaderRegex.exec(originalDiff)) !== null) {
    origHunks.push(match[0].trim());
  }

  const origLines = originalDiff.split(/\r?\n/);
  const changedLines = [];
  for (const line of origLines) {
    if (
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---'))
    ) {
      changedLines.push(line);
    }
  }

  const compLines = compressedDiff.split(/\r?\n/);
  const compHunkLines = compLines.filter((l) =>
    /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(l.trim())
  );
  const compChangedLines = compLines.filter(
    (l) =>
      (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
  );

  const compHunkPool = [...compHunkLines];
  const missingHunks = [];
  for (const hunk of origHunks) {
    const idx = compHunkPool.findIndex((l) => l.trim() === hunk.trim());
    if (idx !== -1) {
      compHunkPool.splice(idx, 1);
    } else {
      missingHunks.push(hunk);
    }
  }

  const compChangedPool = [...compChangedLines];
  const missingChangedLines = [];
  for (const changed of changedLines) {
    let idx = compChangedPool.indexOf(changed);
    if (idx === -1) {
      idx = compChangedPool.findIndex((l) => l.trim() === changed.trim());
    }
    if (idx !== -1) {
      compChangedPool.splice(idx, 1);
    } else {
      missingChangedLines.push(changed);
    }
  }

  const passed = missingHunks.length === 0 && missingChangedLines.length === 0;

  return {
    passed,
    totalHunks: origHunks.length,
    missingHunks,
    totalChangedLines: changedLines.length,
    missingChangedLines,
  };
}

/**
 * Deep structural comparison for JSON data structures.
 *
 * @param {*} orig
 * @param {*} comp
 * @param {string} [currentPath]
 * @returns {{ passed: boolean, error?: string }}
 */
function deepCompareJson(orig, comp, currentPath = '') {
  if (orig === comp) return { passed: true };

  const pathLabel = currentPath || 'root';

  if (orig === null || comp === null) {
    return {
      passed: false,
      error: `Value mismatch at '${pathLabel}': expected ${JSON.stringify(orig)}, got ${JSON.stringify(comp)}`,
    };
  }

  const origType = typeof orig;
  const compType = typeof comp;
  if (origType !== compType) {
    return {
      passed: false,
      error: `Type mismatch at '${pathLabel}': expected ${origType}, got ${compType}`,
    };
  }

  if (Array.isArray(orig) || Array.isArray(comp)) {
    if (!Array.isArray(orig) || !Array.isArray(comp)) {
      return {
        passed: false,
        error: `Structure mismatch at '${pathLabel}': array vs non-array`,
      };
    }
    if (orig.length !== comp.length) {
      return {
        passed: false,
        error: `Array length mismatch at '${pathLabel}': expected ${orig.length}, got ${comp.length}`,
      };
    }
    for (let i = 0; i < orig.length; i++) {
      const childPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
      const res = deepCompareJson(orig[i], comp[i], childPath);
      if (!res.passed) return res;
    }
    return { passed: true };
  }

  if (origType === 'object') {
    const origKeys = Object.keys(orig);
    const compKeySet = new Set(Object.keys(comp));
    const missingKeys = origKeys.filter((k) => !compKeySet.has(k));
    if (missingKeys.length > 0) {
      const p = currentPath ? `${currentPath}.` : '';
      return {
        passed: false,
        error: `Missing keys at '${pathLabel}': ${missingKeys.map((k) => p + k).join(', ')}`,
      };
    }

    const origKeySet = new Set(origKeys);
    const extraKeys = Object.keys(comp).filter((k) => !origKeySet.has(k));
    if (extraKeys.length > 0) {
      const p = currentPath ? `${currentPath}.` : '';
      return {
        passed: false,
        error: `Unexpected extra keys at '${pathLabel}': ${extraKeys.map((k) => p + k).join(', ')}`,
      };
    }

    for (const key of origKeys) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      const res = deepCompareJson(orig[key], comp[key], childPath);
      if (!res.passed) return res;
    }
    return { passed: true };
  }

  return {
    passed: false,
    error: `Value mismatch at '${pathLabel}': expected ${JSON.stringify(orig)}, got ${JSON.stringify(comp)}`,
  };
}

/**
 * Lossless check for JSON:
 * Verifies that the compressed text parses as valid JSON and retains deep structural equivalence
 * (all nested keys, nested values, and arrays by position).
 * Fails closed on invalid original or compressed JSON.
 *
 * @param {string} originalJson
 * @param {string} compressedJson
 * @returns {{ passed: boolean, error?: string }}
 */
function losslessCheckJson(originalJson, compressedJson) {
  if (typeof originalJson !== 'string' || originalJson.trim().length === 0) {
    return { passed: false, error: 'Empty or invalid original JSON input' };
  }
  if (typeof compressedJson !== 'string' || compressedJson.trim().length === 0) {
    return { passed: false, error: 'Empty compressed output' };
  }

  let parsedOriginal;
  try {
    parsedOriginal = JSON.parse(originalJson);
  } catch (err) {
    return { passed: false, error: `Original JSON parse failure: ${err.message}` };
  }

  let parsedCompressed;
  try {
    parsedCompressed = JSON.parse(compressedJson);
  } catch (err) {
    return { passed: false, error: `Compressed JSON parse failure: ${err.message}` };
  }

  return deepCompareJson(parsedOriginal, parsedCompressed);
}

/**
 * Lossless check for markdown spec docs:
 * Verifies that all major markdown headings (# or ##) are preserved.
 *
 * @param {string} originalDoc
 * @param {string} compressedDoc
 * @returns {{ passed: boolean, totalHeadings: number, missingHeadings: string[] }}
 */
function losslessCheckSpecDoc(originalDoc, compressedDoc) {
  const headingRegex = /^#{1,3}\s+.+$/gm;
  const headings = [];
  let m;
  while ((m = headingRegex.exec(originalDoc)) !== null) {
    headings.push(m[0].trim());
  }

  const missingHeadings = [];
  for (const h of headings) {
    if (!compressedDoc.includes(h)) {
      missingHeadings.push(h);
    }
  }

  return {
    passed: missingHeadings.length === 0,
    totalHeadings: headings.length,
    missingHeadings,
  };
}

/**
 * Lossless check for CI logs:
 * Verifies that failure and exit code markers are preserved.
 *
 * @param {string} originalLogs
 * @param {string} compressedLogs
 * @returns {{ passed: boolean, missingMarkers: string[] }}
 */
function losslessCheckCiLogs(originalLogs, compressedLogs) {
  const origLines = originalLogs.split(/\r?\n/);
  const criticalMarkers = origLines
    .filter((l) => /(?:FAIL|Error:|exit code:?\s*[1-9]|ERR_)/i.test(l))
    .map((l) => l.trim());

  const missingMarkers = [];
  for (const marker of criticalMarkers) {
    if (!compressedLogs.includes(marker)) {
      missingMarkers.push(marker);
    }
  }

  return {
    passed: missingMarkers.length === 0,
    missingMarkers,
  };
}

/**
 * Dispatch lossless verification according to category.
 *
 * @param {string} category
 * @param {string} originalText
 * @param {string} compressedText
 * @returns {{ passed: boolean, details?: object, error?: string }}
 */
function verifyLossless(category, originalText, compressedText) {
  if (category === CATEGORIES.CODE_DIFFS) {
    return losslessCheckDiff(originalText, compressedText);
  }
  if (category === CATEGORIES.JSON) {
    return losslessCheckJson(originalText, compressedText);
  }
  if (category === CATEGORIES.SPEC_DOCS) {
    return losslessCheckSpecDoc(originalText, compressedText);
  }
  if (category === CATEGORIES.CI_LOGS) {
    return losslessCheckCiLogs(originalText, compressedText);
  }
  return {
    passed: false,
    error: `Unsupported or unknown category '${category}' for lossless check`,
  };
}

/**
 * Probe Headroom availability.
 * Honestly verifies CLI binary (runs --version), npm package, or reachable local running proxy.
 *
 * @param {object} [options]
 * @returns {{ installed: boolean, status: string, mode?: string, version?: string, url?: string, reason?: string }}
 */
function probeHeadroom(options = {}) {
  const proxyUrl = options.headroomUrl || process.env.HEADROOM_URL || null;
  if (proxyUrl) {
    try {
      const probe = spawnSync(
        process.execPath,
        [
          '-e',
          `fetch(${JSON.stringify(proxyUrl)}, { signal: AbortSignal.timeout(1000) })
            .then(r => process.exit(0))
            .catch(() => process.exit(1))`,
        ],
        { timeout: 2000, encoding: 'utf8' }
      );
      if (probe.status === 0) {
        return {
          installed: true,
          status: ENGINE_STATUS.INSTALLED,
          mode: 'proxy',
          url: proxyUrl,
        };
      }
    } catch (_) {
      // unreachable proxy
    }
    return {
      installed: false,
      status: ENGINE_STATUS.NOT_INSTALLED,
      reason: `Headroom proxy at ${proxyUrl} is not reachable or not responding`,
    };
  }

  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where.exe' : 'which';
    const probe = spawnSync(checkCmd, ['headroom'], { encoding: 'utf8', timeout: 2000 });
    if (probe.status === 0 && probe.stdout && probe.stdout.trim().length > 0) {
      const binPath = probe.stdout.trim().split(/\r?\n/)[0];
      const verProbe = spawnSync('headroom', ['--version'], { encoding: 'utf8', timeout: 3000 });
      if (verProbe.status === 0) {
        return {
          installed: true,
          status: ENGINE_STATUS.INSTALLED,
          mode: 'cli',
          binaryPath: binPath,
          version: (verProbe.stdout || '').trim(),
        };
      }
    }
  } catch (_) {
    // binary check failed
  }

  try {
    const resolved = require.resolve('headroom');
    const mod = require(resolved);
    if (mod && (typeof mod === 'function' || typeof mod === 'object')) {
      return {
        installed: true,
        status: ENGINE_STATUS.INSTALLED,
        mode: 'module',
        modulePath: resolved,
      };
    }
  } catch (_) {
    // module not installed
  }

  return {
    installed: false,
    status: ENGINE_STATUS.NOT_INSTALLED,
    reason: 'Headroom CLI, npm package, and proxy URL not available in current environment',
  };
}

/**
 * Probe LLMLingua-2 availability.
 * Checks Python runtime and llmlingua module import.
 *
 * @param {object} [options]
 * @returns {{ installed: boolean, status: string, pythonPath?: string, reason?: string }}
 */
function probeLlmLingua(options = {}) {
  const pythonCmds =
    process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'];

  for (const py of pythonCmds) {
    try {
      const probe = spawnSync(py, ['-c', 'import llmlingua; print("OK")'], {
        encoding: 'utf8',
        timeout: 3000,
      });
      if (probe.status === 0 && probe.stdout && probe.stdout.includes('OK')) {
        return {
          installed: true,
          status: ENGINE_STATUS.INSTALLED,
          pythonPath: py,
        };
      }
    } catch (_) {
      // try next python command
    }
  }

  return {
    installed: false,
    status: ENGINE_STATUS.NOT_INSTALLED,
    reason: 'Python runtime with llmlingua module not found in system PATH',
  };
}

/**
 * Invoke Headroom compression if installed and not forbidden.
 *
 * @param {string} text
 * @param {object} context
 * @param {object} headroomInfo
 * @returns {{ compressedText: string, error?: string }}
 */
function compressWithHeadroom(text, context = {}, headroomInfo = {}) {
  if (isCompressionForbidden(context)) {
    return { compressedText: text };
  }
  if (!headroomInfo.installed) {
    return { compressedText: text, error: 'Headroom is not installed' };
  }

  if (headroomInfo.mode === 'proxy' && headroomInfo.url) {
    try {
      const script = `
        const url = ${JSON.stringify(headroomInfo.url)};
        const text = ${JSON.stringify(text)};
        fetch(url + '/compress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(5000),
        })
        .then(r => r.json())
        .then(data => {
          process.stdout.write(data.compressedText || data.text || text);
          process.exit(0);
        })
        .catch(err => {
          process.stderr.write(err.message);
          process.exit(1);
        });
      `;
      const res = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        timeout: 6000,
      });
      if (res.status === 0 && res.stdout) {
        return { compressedText: res.stdout };
      }
      return { compressedText: text, error: res.stderr || 'Proxy compression failed' };
    } catch (err) {
      return { compressedText: text, error: err.message };
    }
  }

  if (headroomInfo.mode === 'cli') {
    try {
      const res = spawnSync('headroom', ['compress'], {
        input: text,
        encoding: 'utf8',
        timeout: 5000,
      });
      if (res.status === 0 && res.stdout) {
        return { compressedText: res.stdout };
      }
      return { compressedText: text, error: res.stderr || 'CLI compression failed' };
    } catch (err) {
      return { compressedText: text, error: err.message };
    }
  }

  if (headroomInfo.mode === 'module' && headroomInfo.modulePath) {
    try {
      const mod = require(headroomInfo.modulePath);
      const compressFn = typeof mod === 'function' ? mod : mod.compress;
      if (typeof compressFn === 'function') {
        const out = compressFn(text);
        return { compressedText: typeof out === 'string' ? out : text };
      }
    } catch (err) {
      return { compressedText: text, error: err.message };
    }
  }

  return { compressedText: text };
}

/**
 * Invoke LLMLingua compression if installed and not forbidden.
 *
 * @param {string} text
 * @param {object} context
 * @param {object} llmLinguaInfo
 * @returns {{ compressedText: string, error?: string }}
 */
function compressWithLlmLingua(text, context = {}, llmLinguaInfo = {}) {
  if (isCompressionForbidden(context)) {
    return { compressedText: text };
  }
  if (!llmLinguaInfo.installed || !llmLinguaInfo.pythonPath) {
    return { compressedText: text, error: 'LLMLingua-2 is not installed' };
  }

  try {
    const pyScript = `
import sys, json
from llmlingua import PromptCompressor
compressor = PromptCompressor()
text = sys.stdin.read()
result = compressor.compress_prompt(text, rate=0.5)
sys.stdout.write(result.get('compressed_prompt', text))
`;
    const res = spawnSync(llmLinguaInfo.pythonPath, ['-c', pyScript], {
      input: text,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (res.status === 0 && res.stdout) {
      return { compressedText: res.stdout };
    }
    return { compressedText: text, error: res.stderr || 'LLMLingua compression failed' };
  } catch (err) {
    return { compressedText: text, error: err.message };
  }
}

/**
 * Discover input files for evaluation from target directory.
 * Targets recorded worker inputs: job-*.txt prompts, ci-*.txt logs, quota JSON, code diffs, spec docs.
 *
 * @param {string} dirPath
 * @param {object} [options]
 * @returns {Array<{ filePath: string, relativePath: string, category: string, sizeBytes: number }>}
 */
function scanInputFiles(dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) return [];

  const maxFileBytes = options.maxFileBytes || 2 * 1024 * 1024;
  const results = [];

  function checkAndAdd(fullPath, relPath) {
    let stat;
    try {
      stat = fs.statSync(fullPath);
      if (stat.size === 0 || stat.size > maxFileBytes) return;
    } catch (_) {
      return;
    }

    const baseName = path.basename(fullPath).toLowerCase();
    const relNorm = relPath.replace(/\\/g, '/').toLowerCase();
    let category = 'unknown';

    // Infer role or taskType from path conventions
    let role = '';
    let taskType = '';
    if (relNorm.includes('review') || baseName.includes('review')) {
      role = 'reviewer';
      taskType = 'review';
    } else if (relNorm.includes('diag') || baseName.includes('diag')) {
      taskType = 'diagnosis';
    } else if (relNorm.includes('triage') || baseName.includes('triage')) {
      taskType = 'triage';
    }

    if (
      baseName.endsWith('.diff') ||
      baseName.endsWith('.patch') ||
      baseName.startsWith('diff-') ||
      baseName.includes('-delta')
    ) {
      category = CATEGORIES.CODE_DIFFS;
    } else if (baseName.endsWith('.json')) {
      category = CATEGORIES.JSON;
    } else if (
      baseName.startsWith('ci-') ||
      baseName.includes('-ci') ||
      baseName.endsWith('.log') ||
      baseName.endsWith('.out')
    ) {
      category = CATEGORIES.CI_LOGS;
    } else if (
      baseName.startsWith('job-') ||
      baseName.endsWith('.md') ||
      baseName.includes('spec')
    ) {
      category = CATEGORIES.SPEC_DOCS;
    } else {
      let sample = '';
      try {
        const fd = fs.openSync(fullPath, 'r');
        const buf = Buffer.alloc(1024);
        const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
        fs.closeSync(fd);
        sample = buf.toString('utf8', 0, bytesRead);
      } catch (_) {
        sample = '';
      }
      category = detectCategory(fullPath, sample);
    }

    if (category !== 'unknown') {
      results.push({
        filePath: fullPath,
        relativePath: relPath.replace(/\\/g, '/'),
        category,
        sizeBytes: stat.size,
        role,
        taskType,
      });
    }
  }

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      checkAndAdd(path.join(dirPath, entry.name), entry.name);
    }
  }

  const coreSpecsDir = path.join(dirPath, 'core-specs');
  if (fs.existsSync(coreSpecsDir)) {
    try {
      const specEntries = fs.readdirSync(coreSpecsDir, { withFileTypes: true });
      for (const entry of specEntries) {
        if (entry.isFile()) {
          checkAndAdd(path.join(coreSpecsDir, entry.name), path.join('core-specs', entry.name));
        }
      }
    } catch (_) {
      // ignore read error
    }
  }

  return results;
}

/**
 * Execute compression evaluation on recorded worker inputs or provided samples.
 *
 * @param {object} [options]
 * @param {string} [options.inputsDir]
 * @param {Array<object>} [options.samples]
 * @param {Function} [options.mockCompressor]
 * @param {object} [options.headroomProbe]
 * @param {object} [options.llmLinguaProbe]
 * @returns {object}
 */
function runCompressionEval(options = {}) {
  const inputsDir =
    options.inputsDir || path.resolve(__dirname, '..', '..', '..', '.worktrees', 'logs', 'night');
  const headroomInfo = options.headroomProbe || probeHeadroom(options);
  const llmLinguaInfo = options.llmLinguaProbe || probeLlmLingua(options);

  // Load input candidates
  let samples = [];
  if (Array.isArray(options.samples) && options.samples.length > 0) {
    samples = options.samples;
  } else if (fs.existsSync(inputsDir)) {
    const discovered = scanInputFiles(inputsDir, options);
    for (const item of discovered) {
      try {
        const text = fs.readFileSync(item.filePath, 'utf8');
        samples.push({
          filePath: item.filePath,
          relativePath: item.relativePath,
          category: item.category,
          role: item.role,
          taskType: item.taskType,
          text,
        });
      } catch (_) {
        // Skip unreadable files
      }
    }
  }

  // Group samples by category
  const categoriesList = [
    CATEGORIES.SPEC_DOCS,
    CATEGORIES.CI_LOGS,
    CATEGORIES.JSON,
    CATEGORIES.CODE_DIFFS,
  ];

  const categoryStats = {};
  for (const cat of categoriesList) {
    categoryStats[cat] = {
      fileCount: 0,
      totalChars: 0,
      originalTokens: 0,
      engines: {
        headroom: {
          status: headroomInfo.status,
          compressedTokens: null,
          tokenReductionPercent: null,
          losslessPassed: headroomInfo.installed ? null : ENGINE_STATUS.NOT_INSTALLED,
          details: headroomInfo.installed ? null : headroomInfo.reason,
        },
        llmlingua2: {
          status: llmLinguaInfo.status,
          compressedTokens: null,
          tokenReductionPercent: null,
          losslessPassed: llmLinguaInfo.installed ? null : ENGINE_STATUS.NOT_INSTALLED,
          details: llmLinguaInfo.installed ? null : llmLinguaInfo.reason,
        },
      },
    };

    if (options.mockCompressor) {
      categoryStats[cat].engines.mock = {
        status: ENGINE_STATUS.INSTALLED,
        compressedTokens: 0,
        tokenReductionPercent: 0,
        losslessPassed: true,
        losslessFailures: 0,
      };
    }
  }

  // Aggregate original metrics per sample
  for (const sample of samples) {
    const cat = sample.category;
    if (!categoryStats[cat]) continue;

    const tokens = countTokens(sample.text);
    categoryStats[cat].fileCount += 1;
    categoryStats[cat].totalChars += (sample.text || '').length;
    categoryStats[cat].originalTokens += tokens;

    // Guard check: review and diagnosis paths MUST NEVER be compressed
    const forbidden = isCompressionForbidden({
      category: sample.category,
      filePath: sample.filePath || sample.relativePath,
      role: sample.role,
      taskType: sample.taskType,
    });

    // Aggregate engines if installed
    if (headroomInfo.installed) {
      if (categoryStats[cat].engines.headroom.compressedTokens === null) {
        categoryStats[cat].engines.headroom.compressedTokens = 0;
        categoryStats[cat].engines.headroom.losslessPassed = true;
        categoryStats[cat].engines.headroom.losslessFailures = 0;
      }
      const res = compressWithHeadroom(
        sample.text,
        {
          category: sample.category,
          filePath: sample.filePath || sample.relativePath,
          role: sample.role,
          taskType: sample.taskType,
        },
        headroomInfo
      );
      const compTokens = countTokens(res.compressedText);
      categoryStats[cat].engines.headroom.compressedTokens += compTokens;
      const lossless = verifyLossless(sample.category, sample.text, res.compressedText);
      if (!lossless.passed) {
        categoryStats[cat].engines.headroom.losslessPassed = false;
        categoryStats[cat].engines.headroom.losslessFailures =
          (categoryStats[cat].engines.headroom.losslessFailures || 0) + 1;
      }
    }

    if (llmLinguaInfo.installed) {
      if (categoryStats[cat].engines.llmlingua2.compressedTokens === null) {
        categoryStats[cat].engines.llmlingua2.compressedTokens = 0;
        categoryStats[cat].engines.llmlingua2.losslessPassed = true;
        categoryStats[cat].engines.llmlingua2.losslessFailures = 0;
      }
      const res = compressWithLlmLingua(
        sample.text,
        {
          category: sample.category,
          filePath: sample.filePath || sample.relativePath,
          role: sample.role,
          taskType: sample.taskType,
        },
        llmLinguaInfo
      );
      const compTokens = countTokens(res.compressedText);
      categoryStats[cat].engines.llmlingua2.compressedTokens += compTokens;
      const lossless = verifyLossless(sample.category, sample.text, res.compressedText);
      if (!lossless.passed) {
        categoryStats[cat].engines.llmlingua2.losslessPassed = false;
        categoryStats[cat].engines.llmlingua2.losslessFailures =
          (categoryStats[cat].engines.llmlingua2.losslessFailures || 0) + 1;
      }
    }

    // Run mock compressor if provided for tests/verification
    if (options.mockCompressor && categoryStats[cat].engines.mock) {
      let compressedText = sample.text;
      if (!forbidden) {
        compressedText = options.mockCompressor(sample.text, sample.category);
      }
      const compTokens = countTokens(compressedText);
      categoryStats[cat].engines.mock.compressedTokens += compTokens;

      const losslessResult = verifyLossless(sample.category, sample.text, compressedText);
      if (!losslessResult.passed) {
        categoryStats[cat].engines.mock.losslessPassed = false;
        categoryStats[cat].engines.mock.losslessFailures =
          (categoryStats[cat].engines.mock.losslessFailures || 0) + 1;
      }
    }
  }

  // Calculate final reduction percentages for active engines
  for (const cat of categoriesList) {
    const stats = categoryStats[cat];
    for (const engKey of ['headroom', 'llmlingua2', 'mock']) {
      const eng = stats.engines[engKey];
      if (eng && typeof eng.compressedTokens === 'number' && stats.originalTokens > 0) {
        const orig = stats.originalTokens;
        const comp = eng.compressedTokens;
        const diff = orig - comp;
        eng.tokenReductionPercent = Math.round((diff / orig) * 1000) / 10;
      }
    }
  }

  // Total baseline original tokens across all categories
  let grandTotalOriginalTokens = 0;
  let grandTotalFiles = 0;
  for (const cat of categoriesList) {
    grandTotalOriginalTokens += categoryStats[cat].originalTokens;
    grandTotalFiles += categoryStats[cat].fileCount;
  }

  return {
    environment: {
      platform: process.platform,
      inputsDir,
      headroom: headroomInfo,
      llmlingua2: llmLinguaInfo,
    },
    summary: {
      totalFiles: grandTotalFiles,
      totalOriginalTokens: grandTotalOriginalTokens,
    },
    categories: categoryStats,
  };
}

/**
 * Format evaluation results as a human-readable markdown table.
 *
 * @param {object} evalResult
 * @returns {string}
 */
function formatReportMarkdown(evalResult) {
  const { environment, summary, categories } = evalResult;

  const lines = [];
  lines.push('# Context Compression Evaluation Report (TASK-AI-151)');
  lines.push('');
  lines.push(`- Total recorded inputs evaluated: ${summary.totalFiles} files`);
  lines.push(`- Total baseline original tokens: ${summary.totalOriginalTokens.toLocaleString()}`);
  lines.push(`- Headroom status: ${environment.headroom.status}`);
  lines.push(`- LLMLingua-2 status: ${environment.llmlingua2.status}`);
  lines.push('');
  lines.push('## Category Evaluation Summary');
  lines.push('');
  lines.push(
    '| Category | Files | Original Tokens | Headroom Status | LLMLingua-2 Status | Lossless Check |'
  );
  lines.push('|---|---|---|---|---|---|');

  for (const [catName, data] of Object.entries(categories)) {
    const hrStatus = data.engines.headroom.status;
    const llmStatus = data.engines.llmlingua2.status;
    let lossless = 'N/A';
    if (hrStatus === ENGINE_STATUS.NOT_INSTALLED && llmStatus === ENGINE_STATUS.NOT_INSTALLED) {
      lossless = 'NOT_INSTALLED';
    } else if (data.engines.mock) {
      lossless = data.engines.mock.losslessPassed ? 'PASS' : 'FAIL';
    }

    lines.push(
      `| ${catName} | ${data.fileCount} | ${data.originalTokens.toLocaleString()} | ${hrStatus} | ${llmStatus} | ${lossless} |`
    );
  }

  lines.push('');
  lines.push('## Tool Installation Commands');
  lines.push('');
  lines.push('### Headroom (CCR Compression Proxy)');
  lines.push('```bash');
  lines.push('# Repository: https://github.com/chopratejas/headroom');
  lines.push('# Install Headroom proxy / CLI (pinned):');
  lines.push('npm install -g headroom@0.0.1');
  lines.push('# Start local CCR compression proxy on port 8787:');
  lines.push('headroom proxy --port 8787');
  lines.push('```');
  lines.push('');
  lines.push('### LLMLingua-2 (Microsoft Research Prompt Compressor)');
  lines.push('```bash');
  lines.push('# Repository: https://github.com/microsoft/LLMLingua');
  lines.push('# Requires Python >= 3.9 (pinned):');
  lines.push('pip install llmlingua==0.2.2');
  lines.push('```');
  lines.push('');
  let anyInstalled = false;
  for (const data of Object.values(categories)) {
    if (
      data.engines.headroom.status === ENGINE_STATUS.INSTALLED ||
      data.engines.llmlingua2.status === ENGINE_STATUS.INSTALLED
    ) {
      anyInstalled = true;
      break;
    }
  }

  lines.push('## Recommendation');
  lines.push('');
  if (!anyInstalled) {
    lines.push(
      'Neither Headroom nor LLMLingua-2 is currently installed in this execution environment. ' +
        'Per AGENTS.md rule 3, synthetic or faked metrics are forbidden. ' +
        'AI-TOOLCHAIN-DECISIONS.md "Headroom semantic compression: DEFER" should REMAIN DEFERRED ' +
        'until the external packages are installed, evaluated against real worker tasks, and proven lossless on code diffs and JSON payloads.'
    );
  } else {
    lines.push(
      'Evaluation completed with installed compression engine(s). Review lossless check results per category.'
    );
  }

  return lines.join('\n');
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  let inputsDir = null;
  let asJson = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--inputs-dir' && args[i + 1]) {
      inputsDir = args[i + 1];
      i++;
    } else if (args[i] === '--fixtures') {
      inputsDir = path.join(__dirname, '..', 'test', 'fixtures', 'compression-eval');
    } else if (args[i] === '--json') {
      asJson = true;
    }
  }

  const result = runCompressionEval({ inputsDir });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatReportMarkdown(result));
  }
}

module.exports = {
  CATEGORIES,
  ENGINE_STATUS,
  countTokens,
  isCompressionForbidden,
  detectCategory,
  losslessCheckDiff,
  deepCompareJson,
  losslessCheckJson,
  losslessCheckSpecDoc,
  losslessCheckCiLogs,
  verifyLossless,
  compressWithHeadroom,
  compressWithLlmLingua,
  probeHeadroom,
  probeLlmLingua,
  scanInputFiles,
  runCompressionEval,
  formatReportMarkdown,
};
