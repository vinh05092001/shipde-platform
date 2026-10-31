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
  NOT_ENABLED: 'NOT_ENABLED',
  FAILED: 'FAILED',
};

/**
 * Check whether compression engines are explicitly opted in.
 * Default is false (offline, disabled, reporting NOT_ENABLED).
 *
 * @param {object} [options]
 * @returns {boolean}
 */
function isOptedIn(options = {}) {
  if (options.optIn === true || options.enableCompression === true) {
    return true;
  }
  const envVal = String(process.env.ENABLE_COMPRESSION || process.env.COMPRESSION_OPT_IN || '')
    .trim()
    .toLowerCase();
  return envVal === '1' || envVal === 'true';
}

/**
 * Validate that a proxy URL strictly points to loopback (127.0.0.1 or localhost)
 * to prevent remote network access per BR-COMP-05.
 *
 * @param {string} urlStr
 * @returns {boolean}
 */
function isLoopbackUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch (_) {
    return false;
  }
}

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
 * Extract diff hunk headers and changed lines (+ and -).
 * Strictly skips file headers (lines immediately after 'diff --git' or before the first '@@',
 * or between hunks when remaining old/new counts are zero),
 * while preserving changed lines inside hunks even if they match header patterns like '+++ b/x'
 * or '--- a/x'.
 *
 * @param {string} diffText
 * @returns {{ hunks: string[], changedLines: string[] }}
 */
function extractDiffHunksAndChangedLines(diffText) {
  if (typeof diffText !== 'string') return { hunks: [], changedLines: [] };

  const lines = diffText.split(/\r?\n/);
  const hunks = [];
  const changedLines = [];
  let inHunk = false;
  let remOld = 0;
  let remNew = 0;

  const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  for (const line of lines) {
    if (!inHunk) {
      if (line.startsWith('diff --git')) {
        continue;
      }
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        continue;
      }
      const hunkMatch = line.match(hunkHeaderRegex);
      if (hunkMatch) {
        hunks.push(line.trim());
        remOld = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
        remNew = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
        inHunk = remOld > 0 || remNew > 0;
        continue;
      }
      continue;
    }

    // Inside a hunk:
    // Only detect diff --git at column 0 to force-reset if hunk was somehow truncated
    if (line.startsWith('diff --git')) {
      inHunk = false;
      remOld = 0;
      remNew = 0;
      continue;
    }

    // Inside a hunk (remOld > 0 || remNew > 0): lines starting with + or -
    // (including lines like '+++ b/x' or '--- a/x') are real changes that must be verified
    if (line.startsWith('+')) {
      changedLines.push(line);
      remNew = Math.max(0, remNew - 1);
    } else if (line.startsWith('-')) {
      changedLines.push(line);
      remOld = Math.max(0, remOld - 1);
    } else if (line.startsWith(' ') || line === '') {
      remOld = Math.max(0, remOld - 1);
      remNew = Math.max(0, remNew - 1);
    } else if (line.startsWith('\\')) {
      // Diff metadata marker such as "\ No newline at end of file"
    }

    if (remOld <= 0 && remNew <= 0) {
      inHunk = false;
    }
  }

  return { hunks, changedLines };
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

  const { hunks: origHunks, changedLines } = extractDiffHunksAndChangedLines(originalDiff);
  const { hunks: compHunkLines, changedLines: compChangedLines } =
    extractDiffHunksAndChangedLines(compressedDiff);

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
 * Must run ONLY with explicit opt-in; otherwise reports NOT_ENABLED without contacting network.
 * HEADROOM_URL must be restricted to loopback (127.0.0.1 or localhost).
 *
 * @param {object} [options]
 * @returns {{ installed: boolean, status: string, mode?: string, version?: string, url?: string, reason?: string }}
 */
function probeHeadroom(options = {}) {
  if (!isOptedIn(options)) {
    return {
      installed: false,
      status: ENGINE_STATUS.NOT_ENABLED,
      reason:
        'Compression engines disabled by default (opt-in required via --enable-compression or ENABLE_COMPRESSION=1)',
    };
  }

  const proxyUrl = options.headroomUrl || process.env.HEADROOM_URL || null;
  if (proxyUrl) {
    if (!isLoopbackUrl(proxyUrl)) {
      return {
        installed: false,
        status: ENGINE_STATUS.NOT_INSTALLED,
        reason: `HEADROOM_URL (${proxyUrl}) must be restricted to loopback (127.0.0.1 or localhost)`,
      };
    }

    let initialProbeUrl = proxyUrl;
    try {
      const p = new URL(proxyUrl);
      if (p.pathname === '' || p.pathname === '/') {
        p.pathname = '/health';
        initialProbeUrl = p.href;
      }
    } catch (_) {}

    try {
      const probeScript = `
        function isLoopback(u) {
          try {
            const p = new URL(u);
            if (p.protocol !== 'http:' && p.protocol !== 'https:') return false;
            const h = p.hostname.toLowerCase();
            return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
          } catch (_) {
            return false;
          }
        }

        async function probe(targetUrl) {
          let curr = targetUrl;
          let hops = 0;
          const maxHops = 5;

          while (hops < maxHops) {
            if (!isLoopback(curr)) {
              process.stderr.write('Refused non-loopback redirect target: ' + curr);
              process.exitCode = 1;
              return;
            }

            const res = await fetch(curr, {
              signal: AbortSignal.timeout(1000),
              redirect: 'manual',
            });

            if (res.status >= 300 && res.status < 400) {
              const loc = res.headers.get('location');
              if (!loc) {
                process.stderr.write('Redirect response missing Location header');
                process.exitCode = 1;
                return;
              }
              const nextUrl = new URL(loc, curr).href;
              if (!isLoopback(nextUrl)) {
                process.stderr.write('Refused non-loopback redirect target: ' + nextUrl);
                process.exitCode = 1;
                return;
              }
              curr = nextUrl;
              hops++;
              continue;
            }

            if (res.ok || (res.status >= 200 && res.status < 300)) {
              let pathname = '/';
              try {
                pathname = new URL(curr).pathname;
              } catch (_) {}
              // Only Headroom's documented health endpoint is a valid probe target.
              const isExpectedEndpoint = pathname === '/health';
              if (!isExpectedEndpoint) {
                process.stderr.write(
                  'Endpoint ' + curr + ' is not the documented Headroom health endpoint (/health)'
                );
                process.exitCode = 1;
                return;
              }

              // Identity is taken only from the documented /health response shape:
              // JSON with Headroom's exact product identifier. Response headers
              // (X-Powered-By, X-Service, ...) are spoofable and are never trusted.
              let isHeadroom = false;
              try {
                const text = await res.text();
                const data = JSON.parse(text);
                if (data && typeof data === 'object' && data.service === 'headroom-proxy') {
                  isHeadroom = true;
                }
              } catch (_) {
                // Not valid JSON or missing the documented product identifier
              }

              if (isHeadroom) {
                process.exitCode = 0;
                return;
              } else {
                process.stderr.write(
                  'Server at ' +
                    curr +
                    ' is not a Headroom instance (documented /health response shape with product identifier not found)'
                );
                process.exitCode = 1;
                return;
              }
            } else {
              process.stderr.write('HTTP ' + res.status);
              process.exitCode = 1;
              return;
            }
          }

          process.stderr.write('Too many redirects');
          process.exitCode = 1;
        }

        probe(${JSON.stringify(initialProbeUrl)}).catch(err => {
          process.stderr.write(err.message || 'fetch failed');
          process.exitCode = 1;
        });
      `;
      const probe = spawnSync(process.execPath, ['-e', probeScript], {
        timeout: 2000,
        encoding: 'utf8',
      });
      if (probe.status === 0) {
        return {
          installed: true,
          status: ENGINE_STATUS.INSTALLED,
          mode: 'proxy',
          url: proxyUrl,
        };
      }
      return {
        installed: false,
        status: ENGINE_STATUS.NOT_INSTALLED,
        reason: `Headroom proxy at ${proxyUrl} is not responding or failed capability check (${probe.stderr.trim() || 'connection refused'})`,
      };
    } catch (err) {
      return {
        installed: false,
        status: ENGINE_STATUS.NOT_INSTALLED,
        reason: `Headroom proxy probe error: ${err.message}`,
      };
    }
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
 * Must run ONLY with explicit opt-in; otherwise reports NOT_ENABLED.
 *
 * @param {object} [options]
 * @returns {{ installed: boolean, status: string, pythonPath?: string, reason?: string }}
 */
function probeLlmLingua(options = {}) {
  if (!isOptedIn(options)) {
    return {
      installed: false,
      status: ENGINE_STATUS.NOT_ENABLED,
      reason:
        'Compression engines disabled by default (opt-in required via --enable-compression or ENABLE_COMPRESSION=1)',
    };
  }

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
 * Requires explicit opt-in; proxy URL must be loopback only.
 *
 * @param {string} text
 * @param {object} context
 * @param {object} headroomInfo
 * @param {object} [options]
 * @returns {{ compressedText: string, skipped?: boolean, error?: string }}
 */
function compressWithHeadroom(text, context = {}, headroomInfo = {}, options = {}) {
  if (isCompressionForbidden(context)) {
    return {
      compressedText: text,
      skipped: true,
      reason: 'Compression forbidden on review/diagnosis/triage context',
    };
  }
  if (!isOptedIn(options)) {
    return { compressedText: text, error: 'Compression engines disabled (opt-in required)' };
  }
  if (!headroomInfo.installed) {
    return { compressedText: text, error: 'Headroom is not installed' };
  }

  if (headroomInfo.mode === 'proxy' && headroomInfo.url) {
    if (!isLoopbackUrl(headroomInfo.url)) {
      return {
        compressedText: text,
        error: `Headroom proxy URL (${headroomInfo.url}) must be restricted to loopback (127.0.0.1 or localhost)`,
      };
    }
    try {
      const script = `
        const url = ${JSON.stringify(headroomInfo.url)};
        const text = ${JSON.stringify(text)};
        fetch(url + '/compress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        })
        .then(r => {
          if (!r.ok) {
            throw new Error('HTTP ' + r.status + ': ' + r.statusText);
          }
          return r.json();
        })
        .then(data => {
          if (data && typeof data.compressedText === 'string') {
            process.stdout.write(data.compressedText);
            process.exit(0);
          } else if (data && typeof data.text === 'string' && data.text !== text) {
            process.stdout.write(data.text);
            process.exit(0);
          } else {
            throw new Error('Invalid or uncompressed response from Headroom proxy');
          }
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
        if (typeof out === 'string') {
          return { compressedText: out };
        }
      }
      return { compressedText: text, error: 'Headroom module did not return compressed string' };
    } catch (err) {
      return { compressedText: text, error: err.message };
    }
  }

  return { compressedText: text, error: 'Headroom mode not supported or failed' };
}

/**
 * Invoke LLMLingua compression if installed and not forbidden.
 * Requires explicit opt-in.
 *
 * @param {string} text
 * @param {object} context
 * @param {object} llmLinguaInfo
 * @param {object} [options]
 * @returns {{ compressedText: string, skipped?: boolean, error?: string }}
 */
function compressWithLlmLingua(text, context = {}, llmLinguaInfo = {}, options = {}) {
  if (isCompressionForbidden(context)) {
    return {
      compressedText: text,
      skipped: true,
      reason: 'Compression forbidden on review/diagnosis/triage context',
    };
  }
  if (!isOptedIn(options)) {
    return { compressedText: text, error: 'Compression engines disabled (opt-in required)' };
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
 * @param {boolean} [options.optIn]
 * @param {boolean} [options.enableCompression]
 * @returns {object}
 */
function runCompressionEval(options = {}) {
  const inputsDir =
    options.inputsDir || path.resolve(__dirname, '..', '..', '..', '.worktrees', 'logs', 'night');
  const optedIn = isOptedIn(options);
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

  const hrStatus = optedIn ? headroomInfo.status : ENGINE_STATUS.NOT_ENABLED;
  const llmStatus = optedIn ? llmLinguaInfo.status : ENGINE_STATUS.NOT_ENABLED;

  const categoryStats = {};
  for (const cat of categoriesList) {
    categoryStats[cat] = {
      fileCount: 0,
      totalChars: 0,
      originalTokens: 0,
      engines: {
        headroom: {
          status: hrStatus,
          compressedTokens: null,
          tokenReductionPercent: null,
          losslessPassed: optedIn && headroomInfo.installed ? null : hrStatus,
          details: optedIn
            ? headroomInfo.installed
              ? null
              : headroomInfo.reason
            : 'Compression engines disabled by default (opt-in required)',
        },
        llmlingua2: {
          status: llmStatus,
          compressedTokens: null,
          tokenReductionPercent: null,
          losslessPassed: optedIn && llmLinguaInfo.installed ? null : llmStatus,
          details: optedIn
            ? llmLinguaInfo.installed
              ? null
              : llmLinguaInfo.reason
            : 'Compression engines disabled by default (opt-in required)',
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

    // Aggregate headroom engine if opted in and installed
    if (optedIn && headroomInfo.installed) {
      if (!categoryStats[cat].engines.headroom.failed) {
        const res = compressWithHeadroom(
          sample.text,
          {
            category: sample.category,
            filePath: sample.filePath || sample.relativePath,
            role: sample.role,
            taskType: sample.taskType,
          },
          headroomInfo,
          options
        );

        if (res.skipped) {
          // Review guard skipped compression: do not compress
          if (categoryStats[cat].engines.headroom.compressedTokens === null) {
            categoryStats[cat].engines.headroom.compressedTokens = 0;
            categoryStats[cat].engines.headroom.losslessPassed = true;
            categoryStats[cat].engines.headroom.losslessFailures = 0;
          }
          categoryStats[cat].engines.headroom.compressedTokens += tokens;
        } else if (res.error) {
          // A failed compressor must be reported as FAILED and never counted in aggregates
          categoryStats[cat].engines.headroom.status = ENGINE_STATUS.FAILED;
          categoryStats[cat].engines.headroom.error = res.error;
          categoryStats[cat].engines.headroom.details = res.error;
          categoryStats[cat].engines.headroom.compressedTokens = null;
          categoryStats[cat].engines.headroom.tokenReductionPercent = null;
          categoryStats[cat].engines.headroom.losslessPassed = ENGINE_STATUS.FAILED;
          categoryStats[cat].engines.headroom.failed = true;
        } else {
          if (categoryStats[cat].engines.headroom.compressedTokens === null) {
            categoryStats[cat].engines.headroom.compressedTokens = 0;
            categoryStats[cat].engines.headroom.losslessPassed = true;
            categoryStats[cat].engines.headroom.losslessFailures = 0;
          }
          const compTokens = countTokens(res.compressedText);
          categoryStats[cat].engines.headroom.compressedTokens += compTokens;
          const lossless = verifyLossless(sample.category, sample.text, res.compressedText);
          if (!lossless.passed) {
            categoryStats[cat].engines.headroom.losslessPassed = false;
            categoryStats[cat].engines.headroom.losslessFailures =
              (categoryStats[cat].engines.headroom.losslessFailures || 0) + 1;
          }
        }
      }
    }

    // Aggregate llmlingua2 engine if opted in and installed
    if (optedIn && llmLinguaInfo.installed) {
      if (!categoryStats[cat].engines.llmlingua2.failed) {
        const res = compressWithLlmLingua(
          sample.text,
          {
            category: sample.category,
            filePath: sample.filePath || sample.relativePath,
            role: sample.role,
            taskType: sample.taskType,
          },
          llmLinguaInfo,
          options
        );

        if (res.skipped) {
          // Review guard skipped compression: do not compress
          if (categoryStats[cat].engines.llmlingua2.compressedTokens === null) {
            categoryStats[cat].engines.llmlingua2.compressedTokens = 0;
            categoryStats[cat].engines.llmlingua2.losslessPassed = true;
            categoryStats[cat].engines.llmlingua2.losslessFailures = 0;
          }
          categoryStats[cat].engines.llmlingua2.compressedTokens += tokens;
        } else if (res.error) {
          // A failed compressor must be reported as FAILED and never counted in aggregates
          categoryStats[cat].engines.llmlingua2.status = ENGINE_STATUS.FAILED;
          categoryStats[cat].engines.llmlingua2.error = res.error;
          categoryStats[cat].engines.llmlingua2.details = res.error;
          categoryStats[cat].engines.llmlingua2.compressedTokens = null;
          categoryStats[cat].engines.llmlingua2.tokenReductionPercent = null;
          categoryStats[cat].engines.llmlingua2.losslessPassed = ENGINE_STATUS.FAILED;
          categoryStats[cat].engines.llmlingua2.failed = true;
        } else {
          if (categoryStats[cat].engines.llmlingua2.compressedTokens === null) {
            categoryStats[cat].engines.llmlingua2.compressedTokens = 0;
            categoryStats[cat].engines.llmlingua2.losslessPassed = true;
            categoryStats[cat].engines.llmlingua2.losslessFailures = 0;
          }
          const compTokens = countTokens(res.compressedText);
          categoryStats[cat].engines.llmlingua2.compressedTokens += compTokens;
          const lossless = verifyLossless(sample.category, sample.text, res.compressedText);
          if (!lossless.passed) {
            categoryStats[cat].engines.llmlingua2.losslessPassed = false;
            categoryStats[cat].engines.llmlingua2.losslessFailures =
              (categoryStats[cat].engines.llmlingua2.losslessFailures || 0) + 1;
          }
        }
      }
    }

    // Run mock compressor if provided for tests/verification
    if (options.mockCompressor && categoryStats[cat].engines.mock) {
      if (!categoryStats[cat].engines.mock.failed) {
        if (forbidden) {
          // Review guard: compressor must NOT be called for review/diagnosis/triage context
          categoryStats[cat].engines.mock.compressedTokens += tokens;
        } else {
          try {
            const mockResult = options.mockCompressor(sample.text, sample.category, sample);
            const isObj = typeof mockResult === 'object' && mockResult !== null;
            const compText = isObj ? mockResult.compressedText : mockResult;
            const mockErr = isObj ? mockResult.error : null;

            if (mockErr) {
              categoryStats[cat].engines.mock.status = ENGINE_STATUS.FAILED;
              categoryStats[cat].engines.mock.error = mockErr;
              categoryStats[cat].engines.mock.details = mockErr;
              categoryStats[cat].engines.mock.compressedTokens = null;
              categoryStats[cat].engines.mock.tokenReductionPercent = null;
              categoryStats[cat].engines.mock.losslessPassed = ENGINE_STATUS.FAILED;
              categoryStats[cat].engines.mock.failed = true;
            } else {
              const compTokens = countTokens(compText);
              categoryStats[cat].engines.mock.compressedTokens += compTokens;
              const losslessResult = verifyLossless(sample.category, sample.text, compText);
              if (!losslessResult.passed) {
                categoryStats[cat].engines.mock.losslessPassed = false;
                categoryStats[cat].engines.mock.losslessFailures =
                  (categoryStats[cat].engines.mock.losslessFailures || 0) + 1;
              }
            }
          } catch (err) {
            categoryStats[cat].engines.mock.status = ENGINE_STATUS.FAILED;
            categoryStats[cat].engines.mock.error = err.message;
            categoryStats[cat].engines.mock.details = err.message;
            categoryStats[cat].engines.mock.compressedTokens = null;
            categoryStats[cat].engines.mock.tokenReductionPercent = null;
            categoryStats[cat].engines.mock.losslessPassed = ENGINE_STATUS.FAILED;
            categoryStats[cat].engines.mock.failed = true;
          }
        }
      }
    }
  }

  // Calculate final reduction percentages for active engines
  for (const cat of categoriesList) {
    const stats = categoryStats[cat];
    for (const engKey of ['headroom', 'llmlingua2', 'mock']) {
      const eng = stats.engines[engKey];
      if (
        eng &&
        !eng.failed &&
        typeof eng.compressedTokens === 'number' &&
        stats.originalTokens > 0
      ) {
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
      optedIn,
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
    const hrSt = data.engines.headroom.status;
    const llmSt = data.engines.llmlingua2.status;
    let lossless = 'N/A';
    if (hrSt === ENGINE_STATUS.NOT_INSTALLED && llmSt === ENGINE_STATUS.NOT_INSTALLED) {
      lossless = 'NOT_INSTALLED';
    } else if (hrSt === ENGINE_STATUS.NOT_ENABLED && llmSt === ENGINE_STATUS.NOT_ENABLED) {
      lossless = 'NOT_ENABLED';
    } else if (hrSt === ENGINE_STATUS.FAILED || llmSt === ENGINE_STATUS.FAILED) {
      lossless = 'FAILED';
    } else if (data.engines.mock) {
      lossless =
        data.engines.mock.status === ENGINE_STATUS.FAILED
          ? 'FAILED'
          : data.engines.mock.losslessPassed
            ? 'PASS'
            : 'FAIL';
    }

    lines.push(
      `| ${catName} | ${data.fileCount} | ${data.originalTokens.toLocaleString()} | ${hrSt} | ${llmSt} | ${lossless} |`
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
  let anyFailed = false;
  let anyOptedIn = environment.optedIn === true;
  for (const data of Object.values(categories)) {
    if (
      data.engines.headroom.status === ENGINE_STATUS.FAILED ||
      data.engines.llmlingua2.status === ENGINE_STATUS.FAILED ||
      (data.engines.mock && data.engines.mock.status === ENGINE_STATUS.FAILED)
    ) {
      anyFailed = true;
    }
    if (
      data.engines.headroom.status === ENGINE_STATUS.INSTALLED ||
      data.engines.llmlingua2.status === ENGINE_STATUS.INSTALLED
    ) {
      anyInstalled = true;
    }
  }

  lines.push('## Recommendation');
  lines.push('');
  if (anyFailed) {
    lines.push(
      'Compression evaluation encountered execution failure(s). ' +
        'Failed compressors are reported as FAILED with unavailable metrics. ' +
        'AI-TOOLCHAIN-DECISIONS.md "Headroom semantic compression: DEFER" must REMAIN DEFERRED.'
    );
  } else if (!anyOptedIn) {
    lines.push(
      'Compression engines are disabled by default (opt-in required via --enable-compression or ENABLE_COMPRESSION=1). ' +
        'Evaluation ran in offline zero-effect mode. ' +
        'AI-TOOLCHAIN-DECISIONS.md "Headroom semantic compression: DEFER" should REMAIN DEFERRED ' +
        'until dependencies are installed, opted in, and proven lossless on code diffs and JSON payloads.'
    );
  } else if (!anyInstalled) {
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
  let optIn = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--inputs-dir' && args[i + 1]) {
      inputsDir = args[i + 1];
      i++;
    } else if (args[i] === '--fixtures') {
      inputsDir = path.join(__dirname, '..', 'test', 'fixtures', 'compression-eval');
    } else if (args[i] === '--json') {
      asJson = true;
    } else if (args[i] === '--enable-compression' || args[i] === '--opt-in') {
      optIn = true;
    }
  }

  const result = runCompressionEval({ inputsDir, optIn });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatReportMarkdown(result));
  }
}

module.exports = {
  CATEGORIES,
  ENGINE_STATUS,
  isOptedIn,
  isLoopbackUrl,
  countTokens,
  isCompressionForbidden,
  detectCategory,
  extractDiffHunksAndChangedLines,
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
