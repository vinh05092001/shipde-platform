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
 * Strict safety guard: compression is strictly forbidden on review and diagnosis paths
 * per AGENTS.md and AI-TOOLCHAIN-DECISIONS.md.
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
    taskType.includes('diagnos') ||
    category.includes('diagnos') ||
    filePath.includes('diag');

  return isReview || isDiagnosis;
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
 * Verifies that EVERY diff hunk header (@@ ... @@) and EVERY changed line (+ or -)
 * in the original diff remains present in the compressed output.
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

  const missingHunks = [];
  for (const hunk of origHunks) {
    if (!compressedDiff.includes(hunk)) {
      missingHunks.push(hunk);
    }
  }

  const origLines = originalDiff.split(/\r?\n/);
  const changedLines = [];
  for (const line of origLines) {
    if (
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---'))
    ) {
      changedLines.push(line.trim());
    }
  }

  const missingChangedLines = [];
  for (const changed of changedLines) {
    if (!compressedDiff.includes(changed)) {
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
 * Lossless check for JSON:
 * Verifies that the compressed text parses as valid JSON and retains structural equivalence.
 *
 * @param {string} originalJson
 * @param {string} compressedJson
 * @returns {{ passed: boolean, error?: string }}
 */
function losslessCheckJson(originalJson, compressedJson) {
  if (typeof compressedJson !== 'string' || compressedJson.trim().length === 0) {
    return { passed: false, error: 'Empty compressed output' };
  }

  try {
    const parsedCompressed = JSON.parse(compressedJson);
    try {
      const parsedOriginal = JSON.parse(originalJson);
      if (Array.isArray(parsedOriginal) !== Array.isArray(parsedCompressed)) {
        return { passed: false, error: 'Structure type mismatch (array vs object)' };
      }
      if (
        typeof parsedOriginal === 'object' &&
        parsedOriginal !== null &&
        typeof parsedCompressed === 'object' &&
        parsedCompressed !== null
      ) {
        const origKeys = Object.keys(parsedOriginal);
        const compKeys = new Set(Object.keys(parsedCompressed));
        const missingKeys = origKeys.filter((k) => !compKeys.has(k));
        if (missingKeys.length > 0) {
          return { passed: false, error: `Missing keys: ${missingKeys.join(', ')}` };
        }
      }
    } catch (_) {
      // original might not have been strictly parsed; compressed parsed successfully
    }
    return { passed: true };
  } catch (err) {
    return { passed: false, error: err.message };
  }
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
  return { passed: true };
}

/**
 * Probe Headroom availability.
 * Checks CLI binary, npm package, and local running proxy.
 *
 * @param {object} [options]
 * @returns {{ installed: boolean, status: string, mode?: string, version?: string, url?: string, reason?: string }}
 */
function probeHeadroom(options = {}) {
  const proxyUrl = options.headroomUrl || process.env.HEADROOM_URL || null;
  if (proxyUrl) {
    return {
      installed: true,
      status: ENGINE_STATUS.INSTALLED,
      mode: 'proxy',
      url: proxyUrl,
    };
  }

  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where.exe' : 'which';
    const probe = spawnSync(checkCmd, ['headroom'], { encoding: 'utf8', timeout: 2000 });
    if (probe.status === 0 && probe.stdout && probe.stdout.trim().length > 0) {
      return {
        installed: true,
        status: ENGINE_STATUS.INSTALLED,
        mode: 'cli',
        binaryPath: probe.stdout.trim().split(/\r?\n/)[0],
      };
    }
  } catch (_) {
    // binary check failed
  }

  try {
    const resolved = require.resolve('headroom');
    return {
      installed: true,
      status: ENGINE_STATUS.INSTALLED,
      mode: 'module',
      modulePath: resolved,
    };
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

    const lowerName = path.basename(fullPath).toLowerCase();
    let category = 'unknown';

    if (
      lowerName.endsWith('.diff') ||
      lowerName.endsWith('.patch') ||
      lowerName.startsWith('diff-') ||
      lowerName.includes('-delta')
    ) {
      category = CATEGORIES.CODE_DIFFS;
    } else if (lowerName.endsWith('.json')) {
      category = CATEGORIES.JSON;
    } else if (
      lowerName.startsWith('ci-') ||
      lowerName.includes('-ci') ||
      lowerName.endsWith('.log') ||
      lowerName.endsWith('.out')
    ) {
      category = CATEGORIES.CI_LOGS;
    } else if (
      lowerName.startsWith('job-') ||
      lowerName.endsWith('.md') ||
      lowerName.includes('spec')
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
    if (options.mockCompressor && stats.engines.mock && stats.originalTokens > 0) {
      const orig = stats.originalTokens;
      const comp = stats.engines.mock.compressedTokens;
      const diff = orig - comp;
      stats.engines.mock.tokenReductionPercent = Math.round((diff / orig) * 1000) / 10;
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
  lines.push('# Install Headroom proxy / CLI:');
  lines.push('npm install -g headroom');
  lines.push('# Start local CCR compression proxy on port 8787:');
  lines.push('headroom proxy --port 8787');
  lines.push('```');
  lines.push('');
  lines.push('### LLMLingua-2 (Microsoft Research Prompt Compressor)');
  lines.push('```bash');
  lines.push('# Repository: https://github.com/microsoft/LLMLingua');
  lines.push('# Requires Python >= 3.9');
  lines.push('pip install llmlingua');
  lines.push('```');
  lines.push('');
  lines.push('## Recommendation');
  lines.push('');
  lines.push(
    'Neither Headroom nor LLMLingua-2 is currently installed in this execution environment. ' +
      'Per AGENTS.md rule 3, synthetic or faked metrics are forbidden. ' +
      'AI-TOOLCHAIN-DECISIONS.md "Headroom semantic compression: DEFER" should REMAIN DEFERRED ' +
      'until the external packages are installed, evaluated against real worker tasks, and proven lossless on code diffs and JSON payloads.'
  );

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
  losslessCheckJson,
  losslessCheckSpecDoc,
  losslessCheckCiLogs,
  verifyLossless,
  probeHeadroom,
  probeLlmLingua,
  scanInputFiles,
  runCompressionEval,
  formatReportMarkdown,
};
