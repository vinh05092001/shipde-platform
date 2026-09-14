/**
 * Ship Dễ — AI Cockpit Security & Redaction Utility
 * TASK-AI-15: AI15-R05, AI15-AC07
 * Redacts secrets, credentials, tokens, private environment values,
 * and unsafe absolute-path detail from API responses, UI, logs, and fixtures.
 */

const TOKEN_PATTERNS = [
  /gho_[A-Za-z0-9_]{10,}/g,
  /ghp_[A-Za-z0-9_]{10,}/g,
  /ghu_[A-Za-z0-9_]{10,}/g,
  /ghs_[A-Za-z0-9_]{10,}/g,
  /ghr_[A-Za-z0-9_]{10,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /Bearer\s+[A-Za-z0-9_\-.]{16,}/gi,
  // Token boundary required: without it, "sk-" mid-word (e.g. "task-ai-...")
  // false-positive matches and corrupts legitimate branch/id text.
  /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_\-.]{20,}/g,
  /AGENTROUTER_API_KEY=[^\s,;]+/gi,
  /OPENAI_API_KEY=[^\s,;]+/gi,
  /ANTHROPIC_API_KEY=[^\s,;]+/gi,
  /GEMINI_API_KEY=[^\s,;]+/gi,
];

// Normalize and redact sensitive user home path segments
function redactPath(filePath) {
  if (typeof filePath !== 'string') return filePath;
  // Match Windows user profile e.g. C:\Users\<username>\ or C:/Users/<username>/
  let cleaned = filePath.replace(/[A-Za-z]:[\\\/]Users[\\\/][^\\\/]+[\\\/]/gi, '~/');
  cleaned = cleaned.replace(/\/home\/[^\/]+\//gi, '~/');
  cleaned = cleaned.replace(/\/Users\/[^\/]+\//gi, '~/');
  return cleaned;
}

function redactSensitive(text) {
  if (typeof text !== 'string') return text;
  let sanitized = text;

  // Redact token patterns
  for (const pattern of TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith('bearer ')) {
        return 'Bearer [REDACTED_TOKEN]';
      }
      if (match.includes('=')) {
        const prefix = match.split('=')[0];
        return `${prefix}=[REDACTED_SECRET]`;
      }
      return '[REDACTED_SECRET]';
    });
  }

  // Redact local path details
  sanitized = redactPath(sanitized);

  return sanitized;
}

function redactObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactSensitive(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item));
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      // If key looks like a secret or credential field, redact entirely.
      // Numbers are exempt: a credential is never a number, while token
      // COUNTS legitimately live under keys like tokens and promptTokens.
      // Without this exemption the whole usage ledger reads as redacted.
      if (
        typeof value !== 'number' &&
        /token|secret|password|credential|apiKey|authHeader/i.test(key)
      ) {
        result[key] = '[REDACTED_CONFIDENTIAL]';
      } else {
        result[key] = redactObject(value);
      }
    }
    return result;
  }
  return obj;
}

module.exports = {
  redactSensitive,
  redactPath,
  redactObject,
};
