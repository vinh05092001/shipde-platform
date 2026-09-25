'use strict';

/**
 * Ship Dễ — Probe Runner HTTP Client
 *
 * Handles HTTP requests with separate connect and read timeouts.
 * Parses both JSON completion responses and SSE streams (lines beginning "data: ",
 * chunks with delta.content or delta.reasoning_content).
 *
 * Rules:
 * - Dead endpoint / network failure fails in ~1 second (connect timeout).
 * - A network failure with no HTTP response carries NO httpStatus.
 * - HTTP 200 with empty content is FAIL.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_CONNECT_TIMEOUT_MS = 1000;
const DEFAULT_READ_TIMEOUT_MS = 15000;

/**
 * Joins a gateway base URL and an endpoint path safely.
 */
function resolveUrl(baseUrl, endpointPath) {
  const base = String(baseUrl || 'http://127.0.0.1:20128').replace(/\/+$/, '');
  const cleanPath = String(endpointPath || '').replace(/^\/+/, '');

  if (base.endsWith('/v1') && cleanPath.startsWith('v1/')) {
    return `${base}/${cleanPath.slice(3)}`;
  }
  if (!base.endsWith('/v1') && !cleanPath.startsWith('v1/')) {
    return `${base}/v1/${cleanPath}`;
  }
  return `${base}/${cleanPath}`;
}

/**
 * Parses response body text, supporting both standard JSON and Server-Sent Events (SSE).
 */
function parseResponseContent(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') {
    return { content: '', reasoningContent: '' };
  }

  let content = '';
  let reasoningContent = '';

  const isSSE = bodyText.includes('data: ') || bodyText.startsWith('data:');
  if (isSSE) {
    const lines = bodyText.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const choices = parsed.choices || [];
        for (const choice of choices) {
          if (choice.delta) {
            if (typeof choice.delta.content === 'string') {
              content += choice.delta.content;
            }
            if (typeof choice.delta.reasoning_content === 'string') {
              reasoningContent += choice.delta.reasoning_content;
            }
          } else if (choice.text) {
            content += choice.text;
          }
        }
      } catch (e) {
        // Skip unparseable SSE chunk
      }
    }
  } else {
    // Standard JSON
    try {
      const parsed = JSON.parse(bodyText);
      const choices = parsed.choices || [];
      if (choices.length > 0) {
        const choice = choices[0];
        if (choice.message) {
          if (typeof choice.message.content === 'string') {
            content = choice.message.content;
          }
          if (typeof choice.message.reasoning_content === 'string') {
            reasoningContent = choice.message.reasoning_content;
          }
        } else if (typeof choice.text === 'string') {
          content = choice.text;
        }
      }
    } catch (e) {
      // Body is not JSON
    }
  }

  return { content, reasoningContent };
}

/**
 * Executes a single probe request to a model via the gateway.
 *
 * @param {Object} opts
 * @param {string} opts.gatewayUrl
 * @param {string} opts.apiKey - Bearer token
 * @param {string} opts.modelId - The model to probe
 * @param {boolean} [opts.stream=false]
 * @param {number} [opts.connectTimeoutMs=1000]
 * @param {number} [opts.readTimeoutMs=15000]
 * @returns {Promise<Object>} Probe result
 */
function probeModelRequest(opts) {
  return new Promise((resolve) => {
    const {
      gatewayUrl = 'http://127.0.0.1:20128',
      apiKey,
      modelId,
      stream = false,
      connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
      readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
    } = opts || {};

    const targetUrl = resolveUrl(gatewayUrl, 'chat/completions');
    const urlObj = new URL(targetUrl);
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;

    const payload = JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 16,
      stream: Boolean(stream),
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (stream) {
      headers['Accept'] = 'text/event-stream';
    }

    const startTime = Date.now();
    let connected = false;
    let connectTimer = null;
    let readTimer = null;
    let req = null;

    function cleanupTimers() {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (readTimer) {
        clearTimeout(readTimer);
        readTimer = null;
      }
    }

    connectTimer = setTimeout(() => {
      if (!connected) {
        cleanupTimers();
        const err = new Error('CONNECT_TIMEOUT: Gateway connection timed out');
        err.code = 'ETIMEDOUT';
        err.isConnectTimeout = true;
        if (req) {
          req.destroy(err);
        }
      }
    }, connectTimeoutMs);

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers,
    };

    req = transport.request(reqOptions, (res) => {
      cleanupTimers();

      // Start read timer for streaming body
      readTimer = setTimeout(() => {
        cleanupTimers();
        const err = new Error('READ_TIMEOUT: Gateway response read timed out');
        err.code = 'ETIMEDOUT';
        err.isReadTimeout = true;
        res.destroy(err);
      }, readTimeoutMs);

      let body = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        body += chunk;
        // Refresh read timer on active data arrival
        if (readTimer) {
          clearTimeout(readTimer);
          readTimer = setTimeout(() => {
            cleanupTimers();
            const err = new Error('READ_TIMEOUT: Gateway response read timed out');
            err.code = 'ETIMEDOUT';
            err.isReadTimeout = true;
            res.destroy(err);
          }, readTimeoutMs);
        }
      });

      res.on('end', () => {
        cleanupTimers();
        const latencyMs = Date.now() - startTime;
        const httpStatus = res.statusCode;

        if (httpStatus === 200) {
          const { content, reasoningContent } = parseResponseContent(body);
          const fullContent = (content + reasoningContent).trim();

          if (fullContent.length === 0) {
            resolve({
              ok: false,
              httpStatus: 200,
              status: 'FAIL',
              reason: 'HTTP 200 returned empty content',
              body,
              content: '',
              latencyMs,
            });
          } else {
            resolve({
              ok: true,
              httpStatus: 200,
              status: 'PASS',
              content: fullContent,
              body,
              latencyMs,
            });
          }
        } else {
          resolve({
            ok: false,
            httpStatus,
            status: 'FAIL',
            body,
            latencyMs,
          });
        }
      });

      res.on('error', (err) => {
        cleanupTimers();
        const latencyMs = Date.now() - startTime;
        resolve({
          ok: false,
          httpStatus: res.statusCode,
          status: 'FAIL',
          error: err.message,
          isReadTimeout: Boolean(err.isReadTimeout),
          latencyMs,
          body,
        });
      });
    });

    req.on('socket', (socket) => {
      if (socket.connecting) {
        socket.once('connect', () => {
          connected = true;
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
          }
          readTimer = setTimeout(() => {
            cleanupTimers();
            const err = new Error('READ_TIMEOUT: Gateway response headers timed out');
            err.code = 'ETIMEDOUT';
            err.isReadTimeout = true;
            req.destroy(err);
          }, readTimeoutMs);
        });
      } else {
        connected = true;
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        readTimer = setTimeout(() => {
          cleanupTimers();
          const err = new Error('READ_TIMEOUT: Gateway response headers timed out');
          err.code = 'ETIMEDOUT';
          err.isReadTimeout = true;
          req.destroy(err);
        }, readTimeoutMs);
      }
    });

    req.on('error', (err) => {
      cleanupTimers();
      const latencyMs = Date.now() - startTime;
      // Process or network failure with no HTTP response carries NO httpStatus
      resolve({
        ok: false,
        httpStatus: undefined,
        status: 'FAIL',
        networkError: true,
        error: err.message,
        isConnectTimeout: Boolean(err.isConnectTimeout),
        isReadTimeout: Boolean(err.isReadTimeout),
        latencyMs,
        body: '',
      });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_READ_TIMEOUT_MS,
  resolveUrl,
  parseResponseContent,
  probeModelRequest,
};
