'use strict';

/**
 * Ship Dễ — Probe Runner Preflight
 *
 * Checks once per batch:
 * 1. Bearer token auth is present via NINEROUTER_API_KEY environment variable.
 *    (Fails clearly when absent; never reads from a file, never logs the token).
 * 2. Gateway listener is alive and GET /v1/models answers with HTTP 200.
 *
 * Gateway dead or HTTP 000 aborts the batch immediately without writing any model FAIL rows.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { resolveUrl, DEFAULT_CONNECT_TIMEOUT_MS } = require('./http-client');

/**
 * Executes the preflight verification.
 *
 * @param {Object} [opts]
 * @param {string} [opts.gatewayUrl]
 * @param {string} [opts.apiKey]
 * @param {number} [opts.connectTimeoutMs]
 * @returns {Promise<Object>} { ok: true, apiKey, gatewayUrl, models }
 * @throws {Error} if auth is missing, gateway is dead, or models list fails.
 */
function runPreflight(opts) {
  return new Promise((resolve, reject) => {
    const gatewayUrl = (opts && opts.gatewayUrl) || 'http://127.0.0.1:20128';
    const apiKey = (opts && opts.apiKey) || process.env.NINEROUTER_API_KEY;
    const connectTimeoutMs = (opts && opts.connectTimeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS;

    // 1. Auth presence check
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      return reject(
        new Error(
          'PREFLIGHT_AUTH_MISSING: NINEROUTER_API_KEY environment variable is missing or empty. ' +
            'The runner must read the key from the environment of whoever runs it and fail clearly if it is absent.'
        )
      );
    }

    // 2. Gateway listener and GET /v1/models check
    const targetUrl = resolveUrl(gatewayUrl, 'models');
    let urlObj;
    try {
      urlObj = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`PREFLIGHT_INVALID_URL: Invalid gateway URL \`${gatewayUrl}\``));
    }

    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;

    let connected = false;
    let connectTimer = null;
    let req = null;

    function cleanup() {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    }

    connectTimer = setTimeout(() => {
      if (!connected) {
        cleanup();
        if (req) {
          const err = new Error('PREFLIGHT_CONNECT_TIMEOUT');
          err.code = 'ETIMEDOUT';
          req.destroy(err);
        }
      }
    }, connectTimeoutMs);

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    };

    req = transport.request(reqOptions, (res) => {
      cleanup();
      let body = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `PREFLIGHT_MODELS_FAILED: GET /v1/models returned HTTP ${res.statusCode}. Aborting batch immediately.`
            )
          );
        }

        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          return reject(
            new Error(
              'PREFLIGHT_MODELS_INVALID_JSON: GET /v1/models did not return valid JSON. Aborting batch immediately.'
            )
          );
        }

        const models = Array.isArray(parsed) ? parsed : parsed.data || [];
        return resolve({
          ok: true,
          apiKey,
          gatewayUrl,
          models,
        });
      });

      res.on('error', (err) => {
        cleanup();
        return reject(
          new Error(
            `PREFLIGHT_GATEWAY_DEAD: Gateway listener at ${gatewayUrl} connection error (${err.message}). Aborting batch immediately.`
          )
        );
      });
    });

    req.on('socket', (socket) => {
      if (socket.connecting) {
        socket.once('connect', () => {
          connected = true;
          cleanup();
        });
      } else {
        connected = true;
        cleanup();
      }
    });

    req.on('error', (err) => {
      cleanup();
      return reject(
        new Error(
          `PREFLIGHT_GATEWAY_DEAD: Gateway listener at ${gatewayUrl} is unreachable or dead (${err.message}). Aborting batch immediately.`
        )
      );
    });

    req.end();
  });
}

module.exports = {
  runPreflight,
};
