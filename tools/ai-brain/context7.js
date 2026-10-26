'use strict';
// upstash/context7 docs lookup for tasks that need a library API the author is
// unsure of. Uses the anonymous ctx7 CLI (no login, no key). The library is the
// first match in Context7's own ranking unless the caller passes --library-id.
// Every returned snippet carries its source URL so the author can cite it.
const { spawn } = require('node:child_process');

const CTX7_VERSION = '0.5.9';

function ctx7Command(env = process.env) {
  if (env.SHIPDE_CTX7_BIN) return { cmd: env.SHIPDE_CTX7_BIN, prefix: [] };
  return { cmd: 'npx', prefix: ['--yes', 'ctx7@' + CTX7_VERSION] };
}

function runCtx7(args, { env = process.env, timeoutMs = 60000 } = {}) {
  const { cmd, prefix } = ctx7Command(env);
  return new Promise((resolve) => {
    const child = spawn(quoteForShell(cmd), [...prefix, ...args].map(quoteForShell), {
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err.message || err) });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Windows runs the .cmd shim through cmd.exe; drop the characters cmd.exe would
// interpret inside quotes (" and %) so a query can never become a command.
function quoteForShell(arg) {
  if (process.platform !== 'win32') return arg;
  const value = String(arg).replace(/["%]/g, '');
  return /[\s&|<>^()]/.test(value) ? '"' + value + '"' : value;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Returns { ok, library, snippets[{title, source, language, code}], error }.
async function lookupDocs(library, query, { libraryId, run = runCtx7, maxSnippets = 5 } = {}) {
  if (!query) return { ok: false, error: 'CONTEXT7_QUERY_REQUIRED' };
  let resolved = libraryId ? { id: libraryId } : null;
  if (!resolved) {
    const res = await run(['library', library, query, '--json']);
    const list = res.code === 0 ? parseJson(res.stdout) : null;
    if (!Array.isArray(list))
      return { ok: false, error: 'CONTEXT7_UNAVAILABLE', detail: res.stderr.trim() };
    if (!list.length) return { ok: false, error: 'CONTEXT7_LIBRARY_NOT_FOUND' };
    resolved = list[0];
  }
  const res = await run(['docs', resolved.id, query, '--json']);
  const docs = res.code === 0 ? parseJson(res.stdout) : null;
  if (!docs || typeof docs !== 'object') {
    return { ok: false, error: 'CONTEXT7_UNAVAILABLE', detail: res.stderr.trim() };
  }
  const snippets = (docs.codeSnippets || [])
    .filter((s) => s && s.codeId)
    .slice(0, maxSnippets)
    .map((s) => ({
      title: s.codeTitle,
      source: s.codeId,
      language: s.codeLanguage,
      code: (s.codeList || []).map((c) => c.code).join('\n'),
    }));
  if (!snippets.length) return { ok: false, error: 'CONTEXT7_NO_CITED_DOCS', library: resolved };
  return {
    ok: true,
    library: { id: resolved.id, title: resolved.title || null },
    query,
    snippets,
  };
}

// cli: docs <library> <query...> [--library-id <id>] [--json]
async function runDocsCli(argv) {
  const json = argv.includes('--json');
  const idIndex = argv.indexOf('--library-id');
  const libraryId = idIndex >= 0 ? argv[idIndex + 1] : null;
  const rest = argv.filter(
    (a, i) => a !== '--json' && (idIndex < 0 || (i !== idIndex && i !== idIndex + 1))
  );
  const [library, ...queryParts] = rest;
  if (!library || !queryParts.length) {
    console.error('Usage: cli.js docs <library> <query> [--library-id <id>] [--json]');
    return 2;
  }
  const result = await lookupDocs(library, queryParts.join(' '), { libraryId });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`CONTEXT7_DOCS: ${result.library.id}, ${result.snippets.length} cited snippets`);
    for (const s of result.snippets) console.log(`- ${s.title} <${s.source}>`);
  } else {
    console.error(
      `CONTEXT7_DOCS_FAILED: ${result.error}${result.detail ? ' ' + result.detail : ''}`
    );
  }
  return result.ok ? 0 : 1;
}

module.exports = { CTX7_VERSION, ctx7Command, lookupDocs, runDocsCli };
