/**
 * Ship Dễ — Static Dashboard Renderer
 * Generates self-contained DASHBOARD.html with truthful embedded snapshot from CSV
 * and integrated client script.
 */

const fs = require('fs');
const path = require('path');
const { loadRegister } = require('./register-adapter');
const { redactObject } = require('./redaction');
const { computeSourceFreshness } = require('./aggregator');

function withFreshness(health) {
  const { ageMs, freshness } = computeSourceFreshness(health.observedAt, health.status);
  return Object.assign({}, health, { ageMs, freshness });
}

function renderStaticDashboard(rootDir, options = {}) {
  const baseDir = rootDir || path.resolve(__dirname, '../..');
  const port = options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3333);
  const csvPath = path.join(
    baseDir,
    'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
  );
  const indexHtmlPath = path.join(__dirname, 'index.html');
  const clientJsPath = path.join(__dirname, 'client.js');
  const outputHtmlPath = options.outputPath || path.join(baseDir, 'DASHBOARD.html');

  const regResult = loadRegister(csvPath, null, baseDir);
  const staticState = redactObject({
    schemaVersion: '3.3.0',
    revision: 1,
    observedAt: new Date().toISOString(),
    overallStatus: 'partial',
    sources: {
      register: withFreshness(regResult.health),
      git: withFreshness({
        name: 'git',
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        latencyMs: 0,
        provenance: 'Offline file mode',
        impact: 'Khởi động server để quan sát git live',
        error: null,
      }),
      ao: withFreshness({
        name: 'ao',
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        latencyMs: 0,
        provenance: 'Offline file mode',
        impact: 'Khởi động server để quan sát AO live',
        error: null,
      }),
      github: withFreshness({
        name: 'github',
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        latencyMs: 0,
        provenance: 'Offline file mode',
        impact: 'Khởi động server để quan sát GitHub live',
        error: null,
      }),
    },
    conflicts: [],
    workItems: regResult.data,
    sessions: [],
    daemon: { ready: false, state: 'offline' },
    git: {
      currentBranch: 'unknown',
      headOid: '',
      headOidShort: '',
      dirtyCount: 0,
      worktrees: [],
      recentCommits: [],
    },
    github: { authenticated: false, repo: 'vinh05092001/shipde-platform', pullRequests: [] },
    activity: [],
  });

  let html = fs.readFileSync(indexHtmlPath, 'utf-8');
  const clientJs = fs.readFileSync(clientJsPath, 'utf-8');

  // Inject snapshot state into head
  const stateScript = `\n  <script>\n    window.__STATIC_STATE__ = ${JSON.stringify(staticState)};\n  </script>\n`;
  html = html.replace('</head>', `${stateScript}</head>`);

  // Replace external client.js script with inline script adjusted for file:// mode
  const clientInline = `
  <script>
    // In standalone file:// mode, point fetch and SSE to local server
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      if (typeof input === 'string' && input.startsWith('/')) {
        return origFetch('http://127.0.0.1:${port}' + input, init);
      }
      return origFetch(input, init);
    };

    const OrigEventSource = window.EventSource;
    window.EventSource = function(url, opts) {
      if (typeof url === 'string' && url.startsWith('/')) {
        return new OrigEventSource('http://127.0.0.1:${port}' + url, opts);
      }
      return new OrigEventSource(url, opts);
    };

    ${clientJs}
  </script>
  `;

  html = html.replace('<script src="/client.js"></script>', clientInline);

  // Trailing whitespace is stripped before writing. The template indents its
  // blocks, so interpolating an empty value leaves a line of spaces behind -
  // invisible in the browser and invisible in review, but `git diff --check`
  // rejects it, which failed the whitespace gate on a file nobody hand-edited.
  // Fixing it here means every regeneration is clean, rather than each one
  // needing the same manual pass.
  const clean = html.replace(/[ 	]+$/gm, '');
  fs.writeFileSync(outputHtmlPath, clean, 'utf-8');
  console.log(`[OK] Generated self-contained DASHBOARD.html (${html.length} bytes)`);
  return outputHtmlPath;
}

if (require.main === module) {
  renderStaticDashboard();
}

module.exports = {
  renderStaticDashboard,
};
