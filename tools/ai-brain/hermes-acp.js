'use strict';

const { spawn, execFile } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

// ACP is newline-delimited JSON-RPC over stdio. Keep only lifecycle metadata:
// prompts, reasoning, tool arguments/results and stderr never enter status files.
function runAcpTurn(command, args, options = {}, deps = {}) {
  if (typeof options.prompt !== 'string' || !options.prompt.trim()) {
    return Promise.reject(new Error('ACP_PROMPT_REQUIRED'));
  }
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('ACP_INVALID_TIMEOUT'));
  }
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let settled = false;
    let buffer = '';
    let nextId = 0;
    let sessionId = null;
    const pending = new Map();
    const decoder = new StringDecoder('utf8');
    const status = { transport: 'acp', state: 'starting', eventCount: 0 };
    const emit = (state, extra = {}) => {
      Object.assign(status, extra, { state, updatedAt: new Date().toISOString() });
      if (options.onStatus) options.onStatus({ ...status });
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const { reject: fail } of pending.values()) fail(new Error('ACP_CLOSED'));
      pending.clear();
      const done = () => {
        try {
          child?.stdin.end();
        } catch {}
        try {
          emit(error ? 'failed' : result.state);
        } catch (err) {
          error ||= err;
        }
        if (error) reject(error);
        else resolve({ ...status, stopReason: result.stopReason });
      };
      // The npm Hermes executable wraps Python. Killing only the wrapper leaves
      // its agent running; terminate the owned process tree before returning.
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          (deps.execFile || execFile)(
            'taskkill.exe',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 },
            (err) => {
              if (err && child.exitCode === null && child.signalCode === null)
                error ||= new Error('ACP_CLEANUP_FAILED');
              done();
            }
          );
          return;
        }
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (err) {
          if (err.code !== 'ESRCH') error ||= new Error('ACP_CLEANUP_FAILED');
        }
      }
      done();
    };
    const send = (message) =>
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    const request = (method, params) =>
      new Promise((yes, no) => {
        const id = ++nextId;
        pending.set(id, { resolve: yes, reject: no });
        try {
          send({ id, method, params });
        } catch (err) {
          pending.delete(id);
          no(err);
        }
      });
    const receive = (message) => {
      if (settled) return;
      if (!message || message.jsonrpc !== '2.0') throw new Error('ACP_INVALID_MESSAGE');
      if (message.method) {
        if (Object.hasOwn(message, 'id')) {
          // Observation never grants execution, file access, or terminal permissions.
          if (message.method === 'session/request_permission') {
            send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
          } else {
            send({ id: message.id, error: { code: -32601, message: 'Unsupported client method' } });
          }
          return;
        }
        if (message.method !== 'session/update' || message.params?.sessionId !== sessionId) return;
        const update = message.params.update;
        const kind = update?.sessionUpdate;
        if (
          ![
            'agent_message_chunk',
            'agent_thought_chunk',
            'tool_call',
            'tool_call_update',
            'usage_update',
          ].includes(kind)
        )
          return;
        status.eventCount += 1;
        const extra = { lastEvent: kind };
        if (
          ['tool_call', 'tool_call_update'].includes(kind) &&
          ['pending', 'in_progress', 'completed', 'failed'].includes(update.status)
        ) {
          extra.toolStatus = update.status;
        }
        if (kind === 'usage_update' && Number.isFinite(update.used) && update.used >= 0)
          extra.contextUsed = update.used;
        emit('running', extra);
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error)
        entry.reject(
          new Error(
            'ACP_RPC_ERROR_' +
              (Number.isInteger(message.error.code) ? message.error.code : 'UNKNOWN')
          )
        );
      else if (Object.hasOwn(message, 'result')) entry.resolve(message.result);
      else entry.reject(new Error('ACP_INVALID_RESPONSE'));
    };
    try {
      child = (deps.spawn || spawn)(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      child.on('error', () => finish(new Error('ACP_PROCESS_ERROR')));
      child.on('close', () => finish(new Error('ACP_PROCESS_CLOSED')));
      child.stdin.on('error', () => finish(new Error('ACP_STDIN_ERROR')));
      child.stderr.on('data', () => {});
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        try {
          buffer += decoder.write(chunk);
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            if (newline > 1024 * 1024) throw new Error('ACP_FRAME_TOO_LARGE');
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) {
              let message;
              try {
                message = JSON.parse(line);
              } catch {
                throw new Error('ACP_INVALID_JSON');
              }
              receive(message);
            }
          }
          if (buffer.length > 1024 * 1024) throw new Error('ACP_FRAME_TOO_LARGE');
        } catch (err) {
          finish(err);
        }
      });
      timer = setTimeout(() => finish(new Error('ACP_TIMEOUT')), timeoutMs);
      emit('starting');
    } catch (err) {
      finish(err);
      return;
    }
    (async () => {
      const init = await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'shipde-controller', version: '1' },
      });
      if (init?.protocolVersion !== 1) throw new Error('ACP_PROTOCOL_UNSUPPORTED');
      // A fresh ACP session reads the Controller-owned model/provider config.
      // Do not load a chat session whose stored provider could override that config.
      const session = await request('session/new', { cwd: options.cwd, mcpServers: [] });
      const expectedModels = [
        `${options.providerName}:${options.modelId}`,
        `custom:${options.providerName}:${options.modelId}`,
      ];
      if (
        typeof session?.sessionId !== 'string' ||
        !session.sessionId ||
        !expectedModels.includes(session.models?.currentModelId)
      ) {
        throw new Error('ACP_MODEL_BINDING_UNVERIFIED');
      }
      sessionId = session.sessionId;
      emit('ready');
      const result = await request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: options.prompt }],
      });
      const states = {
        end_turn: 'turn_ended',
        cancelled: 'cancelled',
        refusal: 'refused',
        max_tokens: 'limited',
        max_turn_requests: 'limited',
      };
      if (!result || !Object.hasOwn(states, result.stopReason))
        throw new Error('ACP_STOP_REASON_UNRECOGNIZED');
      finish(null, { state: states[result.stopReason], stopReason: result.stopReason });
    })().catch((err) => finish(err));
  });
}

module.exports = { runAcpTurn };
