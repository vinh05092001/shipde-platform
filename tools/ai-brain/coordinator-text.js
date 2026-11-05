'use strict';

const CREDENTIAL_KEY =
  /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|cookie)$/i;

function redactText(text) {
  return text
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi, '$1?[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, '[REDACTED_AUTH]')
    .replace(
      /(["']?\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|cookie)["']?\s*[:=]\s*)(?:"(?:\\[^\r\n]|[^"\\\r\n])*(?:"|$)|'(?:\\[^\r\n]|[^'\\\r\n])*(?:'|$)|[^"'\s,}]+)/gim,
      '$1"[REDACTED]"'
    )
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED_EMAIL]');
}

// Decode structured output before masking string values, then serialize it again.
// Masking JSON's escaped quotes directly can leak values or corrupt the envelope
// that carries review text and measured token usage.
function safeText(value) {
  const text = String(value ?? '');
  if (/^\s*(?:\{|\[)/.test(text)) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Partial JSON and ordinary diagnostics still need text redaction.
    }
    if (parsed && typeof parsed === 'object') {
      try {
        return JSON.stringify(parsed, (key, entry) => {
          if (CREDENTIAL_KEY.test(key)) return '[REDACTED]';
          return typeof entry === 'string' ? safeText(entry) : entry;
        });
      } catch {
        return '[TRUNCATED: STRUCTURED_OUTPUT_LIMIT_EXCEEDED]';
      }
    }
  }
  return redactText(text);
}

function errorText(error) {
  return safeText(
    [error?.code, error?.message || 'UNKNOWN_ERROR'].filter(Boolean).join(': ')
  ).slice(0, 4000);
}

module.exports = { safeText, errorText };
