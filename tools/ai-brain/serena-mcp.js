'use strict';

/**
 * Real oraios/serena backend for the read-only code retrieval pilot.
 *
 * Starts the pinned Serena MCP server over stdio against a project whose
 * `.serena/project.yml` sets `read_only: true`, so Serena itself drops every
 * editing tool. The answer is Serena's language-server result, not a regex scan.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERENA_REF = 'git+https://github.com/oraios/serena@v2.1.0';
const READ_TOOLS = new Set(['find_symbol', 'find_referencing_symbols', 'get_symbols_overview']);
const EDIT_TOOLS = [
  'replace_in_files',
  'rename_symbol',
  'safe_delete_symbol',
  'replace_symbol_body',
];

function assertReadOnlyProject(root) {
  const file = path.join(root, '.serena', 'project.yml');
  if (!fs.existsSync(file)) throw new Error('SERENA_PROJECT_MISSING: ' + file);
  if (!/^read_only:\s*true\s*$/m.test(fs.readFileSync(file, 'utf8'))) {
    throw new Error('SERENA_NOT_READ_ONLY: .serena/project.yml must set read_only: true');
  }
}

function serverCommand(root) {
  // uv runs Serena in its own cache; nothing is installed into the workspace.
  const python = process.env.SERENA_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  return {
    command: python,
    args: [
      '-m',
      'uv',
      'tool',
      'run',
      '--from',
      process.env.SERENA_FROM || SERENA_REF,
      'serena',
      'start-mcp-server',
      '--project',
      root,
      '--context',
      'ide',
      '--mode',
      'planning',
      '--mode',
      'no-onboarding',
      '--mode',
      'no-memories',
      '--agent-interface',
      'tools',
      '--transport',
      'stdio',
      '--enable-web-dashboard',
      'false',
      '--enable-gui-log-window',
      'false',
    ],
  };
}

/**
 * Runs read-only Serena tool calls in one MCP session.
 * @param {string} root project root containing .serena/project.yml
 * @param {({name: string, arguments: object} | ((results: object[]) => {name: string, arguments: object}))[]} calls
 *   a function entry builds its call from the results so far (e.g. an exact name_path)
 * @returns {Promise<{tools: string[], results: {name: string, ok: boolean, value: any}[]}>}
 */
function callSerena(root, calls, { timeoutMs = 600000 } = {}) {
  assertReadOnlyProject(root);
  for (const c of calls) {
    if (typeof c !== 'function' && !READ_TOOLS.has(c.name)) {
      return Promise.reject(new Error('MUTATION_REFUSED: ' + c.name));
    }
  }
  const { command, args } = serverCommand(root);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '';
  let nextId = 0;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // Serena may log non-JSON lines before the session starts.
      }
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });
  const send = (message) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = (method, params) =>
    new Promise((resolve) => {
      nextId += 1;
      pending.set(nextId, resolve);
      send({ id: nextId, method, params });
    });

  const session = (async () => {
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'shipde-controller', version: '1' },
    });
    if (init.error) throw new Error('SERENA_INIT_FAILED: ' + init.error.message);
    send({ method: 'notifications/initialized' });
    const listed = await request('tools/list', {});
    const tools = (listed.result?.tools || []).map((t) => t.name);
    const exposedEdits = EDIT_TOOLS.filter((t) => tools.includes(t));
    if (exposedEdits.length)
      throw new Error('SERENA_NOT_READ_ONLY: exposes ' + exposedEdits.join(','));
    const results = [];
    for (const entry of calls) {
      const call = typeof entry === 'function' ? entry(results) : entry;
      if (!READ_TOOLS.has(call.name)) throw new Error('MUTATION_REFUSED: ' + call.name);
      const reply = await request('tools/call', call);
      const ok = !reply.error && !reply.result?.isError;
      const text =
        reply.error?.message ?? reply.result?.content?.map((c) => c.text).join('\n') ?? '';
      let value = text;
      try {
        value = JSON.parse(text);
      } catch {
        // Serena returns plain text for errors and some summaries.
      }
      results.push({ name: call.name, ok, value });
    }
    return { tools, results };
  })();

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('SERENA_TIMEOUT')), timeoutMs);
  });
  const exited = new Promise((_, reject) => {
    child.on('error', (err) => reject(new Error('SERENA_LAUNCH_FAILED: ' + err.message)));
    child.on('exit', (code) => reject(new Error('SERENA_EXITED: ' + code)));
  });
  return Promise.race([session, timeout, exited]).finally(() => {
    clearTimeout(timer);
    child.kill();
  });
}

module.exports = { SERENA_REF, READ_TOOLS, assertReadOnlyProject, serverCommand, callSerena };
