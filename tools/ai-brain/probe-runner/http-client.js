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
 * - HTTP 200 with tool_calls only is PASS with responseKind=tool_calls.
 * - Length-truncated empty response (finish_reason=length/max_tokens) is PROBE_INVALID.
 * - Models unsupported by chat/completions (decisions, embeddings, image) return UNSUPPORTED_BY_PROBE.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_CONNECT_TIMEOUT_MS = 1000;
const DEFAULT_READ_TIMEOUT_MS = 15000;
const DEFAULT_MAX_TOKENS = 128;

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
 * Extracts tool_calls from a choice object.
 */
function extractToolCalls(choice) {
  const calls = [];
  if (choice.message && Array.isArray(choice.message.tool_calls)) {
    for (const tc of choice.message.tool_calls) {
      if (tc.function && typeof tc.function.name === 'string') {
        calls.push(tc.function.name);
      }
    }
  } else if (choice.delta && Array.isArray(choice.delta.tool_calls)) {
    for (const tc of choice.delta.tool_calls) {
      if (tc.function && typeof tc.function.name === 'string') {
        calls.push(tc.function.name);
      }
    }
  }
  return calls;
}

/**
 * Parses response body text, supporting both standard JSON and Server-Sent Events (SSE).
 * Returns { content, reasoningContent, toolCalls, finishReason }.
 */
function parseResponseContent(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') {
    return { content: '', reasoningContent: '', toolCalls: [], finishReason: null };
  }

  let content = '';
  let reasoningContent = '';
  let toolCalls = [];
  let finishReason = null;

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
          if (choice.finish_reason && !finishReason) {
            finishReason = choice.finish_reason;
          }
          if (choice.delta) {
            if (typeof choice.delta.content === 'string') {
              content += choice.delta.content;
            }
            if (typeof choice.delta.reasoning_content === 'string') {
              reasoningContent += choice.delta.reasoning_content;
            }
            const tc = extractToolCalls(choice);
            if (tc.length) toolCalls.push(...tc);
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
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
        if (choice.message) {
          if (typeof choice.message.content === 'string') {
            content = choice.message.content;
          }
          if (typeof choice.message.reasoning_content === 'string') {
            reasoningContent = choice.message.reasoning_content;
          }
          const tc = extractToolCalls(choice);
          if (tc.length) toolCalls.push(...tc);
        } else if (typeof choice.text === 'string') {
          content = choice.text;
        }
      }
    } catch (e) {
      // Body is not JSON
    }
  }

  return { content, reasoningContent, toolCalls, finishReason };
}

/**
 * Extracts innermost HTTP status and error message from gateway-wrapped error bodies.
 * Gateway wraps errors as: "[402]: {\"error\":...}" or "503 Service Unavailable: [403]: {...}"
 * Returns { innerStatus, innerMessage, innerCode } or null if not found.
 */
function extractInnerError(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return null;

  // Pattern: [402]: {...} or [403]: {...} etc.
  const bracketMatch = bodyText.match(/[\[(]\s*(401|402|403|404|410|429)\s*[\])]\s*:\s*(\{.+\})/);
  if (bracketMatch) {
    const innerStatus = parseInt(bracketMatch[1], 10);
    let innerMessage = '';
    let innerCode = '';
    try {
      const innerJson = JSON.parse(bracketMatch[2]);
      innerMessage = innerJson.error?.message || innerJson.error || JSON.stringify(innerJson);
      innerCode = innerJson.error?.code || '';
    } catch (e) {
      innerMessage = bracketMatch[2];
    }
    return { innerStatus, innerMessage, innerCode };
  }

  // Pattern: "503 Service Unavailable: [402]: out of credit"
  const plainMatch = bodyText.match(/[\[(]\s*(401|402|403|404|410|429)\s*[\])]\s*:\s*([^\n\{]+)/);
  if (plainMatch) {
    const innerStatus = parseInt(plainMatch[1], 10);
    return { innerStatus, innerMessage: plainMatch[2].trim(), innerCode: '' };
  }

  return null;
}

/**
 * Determines if a model type is unsupported by the chat/completions probe.
 * Returns the unsupported reason or null if supported.
 */
function detectUnsupportedModelType(bodyText, httpStatus) {
  if (!bodyText || typeof bodyText !== 'string') return null;
  const text = bodyText.toLowerCase();

  // Decisions models
  if (
    text.includes('decisions model') &&
    text.includes('cannot be used with the chat/completions')
  ) {
    return 'decisions_endpoint_required';
  }
  if (text.includes('decisions') && text.includes('endpoint')) {
    return 'decisions_endpoint_required';
  }

  // Embeddings models
  if (
    text.includes('embedding') &&
    (text.includes('not supported') ||
      text.includes('wrong endpoint') ||
      text.includes('use /embeddings'))
  ) {
    return 'embeddings_endpoint_required';
  }

  // Image generation models
  if (
    text.includes('image') &&
    (text.includes('not supported') ||
      text.includes('wrong endpoint') ||
      text.includes('use /images'))
  ) {
    return 'images_endpoint_required';
  }

  // Audio/transcription models
  if (
    (text.includes('audio') || text.includes('transcription') || text.includes('tts')) &&
    (text.includes('not supported') || text.includes('wrong endpoint'))
  ) {
    return 'audio_endpoint_required';
  }

  return null;
}

/**
 * Executes a single probe request to a model via the gateway.
 *
 * Implements max_tokens=128 by default. Retries once with max_completion_tokens if model rejects max_tokens.
 * Returns status: PASS, FAIL, PROBE_INVALID, UNSUPPORTED_BY_PROBE.
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
async function probeModelRequest(opts) {
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

  // Base params
  const baseParams = {
    model: modelId,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: DEFAULT_MAX_TOKENS,
    stream: Boolean(stream),
  };

  async function doRequest(params) {
    return await new Promise((resolve) => {
      const payload = JSON.stringify(params);

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
            const { content, reasoningContent, toolCalls, finishReason } =
              parseResponseContent(body);
            const textContent = content.trim();
            const fullContent = (content + reasoningContent).trim();
            const hasToolCalls = toolCalls.length > 0;

            // Check for unsupported model type in successful response (unlikely but possible)
            const unsupportedReason = detectUnsupportedModelType(body, httpStatus);
            if (unsupportedReason) {
              resolve({
                ok: false,
                httpStatus: 200,
                status: 'UNSUPPORTED_BY_PROBE',
                reason: unsupportedReason,
                body,
                latencyMs,
              });
              return;
            }

            // PASS: has text content
            if (textContent.length > 0) {
              resolve({
                ok: true,
                httpStatus: 200,
                status: 'PASS',
                content: fullContent,
                body,
                latencyMs,
                responseKind: hasToolCalls ? 'tool_calls' : 'text',
                toolCalls: hasToolCalls ? toolCalls : undefined,
                finishReason,
              });
              return;
            }

            // PASS: tool_calls only (agent models)
            if (hasToolCalls) {
              resolve({
                ok: true,
                httpStatus: 200,
                status: 'PASS',
                content: '',
                body,
                latencyMs,
                responseKind: 'tool_calls',
                toolCalls,
                finishReason,
              });
              return;
            }

            // PROBE_INVALID: length-truncated empty response (reasoning models with too small budget)
            // Only trigger if finish_reason indicates truncation (reasoning models return empty text content)
            if (finishReason === 'length' || finishReason === 'max_tokens') {
              resolve({
                ok: false,
                httpStatus: 200,
                status: 'PROBE_INVALID',
                reason: `Length-truncated empty response (finish_reason=${finishReason}), increase token budget`,
                body,
                latencyMs,
                finishReason,
                probeInvalid: true,
              });
              return;
            }

            // FAIL: truly empty with no tool_calls and no truncation indicator
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
            // Non-200: extract inner error for classification (pass raw body to classifier)
            const innerError = extractInnerError(body);

            // Check for unsupported model type in error response
            const unsupportedReason = detectUnsupportedModelType(body, httpStatus);
            if (unsupportedReason) {
              resolve({
                ok: false,
                httpStatus,
                status: 'UNSUPPORTED_BY_PROBE',
                reason: unsupportedReason,
                body,
                latencyMs,
              });
              return;
            }

            resolve({
              ok: false,
              httpStatus,
              status: 'FAIL',
              body,
              latencyMs,
              innerError,
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
            body: '',
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

  // Run first with max_tokens
  let params = { ...baseParams };
  let result = await doRequest(params);

  // Retry if model errors on max_tokens
  const modelRejectsToken =
    result &&
    !result.ok &&
    result.body &&
    /invalid(\s|_)max_tokens|max_tokens.*(not supported|unsupported|unrecognized|unknown)/i.test(
      result.body
    );
  if (modelRejectsToken) {
    // swap param
    delete params.max_tokens;
    params.max_completion_tokens = DEFAULT_MAX_TOKENS;
    const retryRes = await doRequest(params);
    if (retryRes && retryRes.ok) return retryRes;
    // else fall through, report both
    return {
      ...retryRes,
      failedBothTokenFormats: true,
      priorBody: result.body,
    };
  }

  return result;
}

module.exports = {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  resolveUrl,
  parseResponseContent,
  extractInnerError,
  detectUnsupportedModelType,
  probeModelRequest,
};
