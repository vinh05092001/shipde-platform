/**
 * @shipde/config
 * Shared workspace configuration, environment validation, correlation, and structured logging.
 */
import { randomUUID } from 'node:crypto';

export const WORKSPACE_ENV = {
  DEFAULT_NODE_VERSION: '24',
  DEFAULT_PNPM_VERSION: '11.23.0',
  DEFAULT_TIMEZONE: 'Asia/Ho_Chi_Minh',
  DEFAULT_CURRENCY: 'VND',
} as const;

export type WorkspaceEnvironment = typeof WORKSPACE_ENV;

export type EnvironmentMode = 'development' | 'production' | 'test';
export type CarrierMode = 'disabled' | 'mock' | 'live';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  NODE_ENV: EnvironmentMode;
  PORT: number;
  WORKER_HEALTH_PORT: number;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_BUCKET: string;
  S3_FORCE_PATH_STYLE: boolean;
  CARRIER_MODE: CarrierMode;
  LOG_LEVEL: LogLevel;
}

export class ConfigValidationError extends Error {
  public readonly invalidFields: string[];

  constructor(invalidFields: string[], message?: string) {
    super(message || `Configuration validation failed for fields: ${invalidFields.join(', ')}`);
    this.name = 'ConfigValidationError';
    this.invalidFields = invalidFields;
  }
}

function parseStrictPort(val: string | undefined, defaultVal: number): number | null {
  if (val === undefined || val === '') return defaultVal;
  if (!/^\d+$/.test(val)) return null;
  const num = Number(val);
  if (!Number.isSafeInteger(num) || num < 1 || num > 65535) return null;
  return num;
}

/**
 * Validates runtime environment configuration fail-closed.
 * Guarantees that sensitive values are NEVER exposed in error messages.
 */
export function validateConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
  const invalidFields: string[] = [];

  const nodeEnvRaw = rawEnv.NODE_ENV || 'development';
  if (!['development', 'production', 'test'].includes(nodeEnvRaw)) {
    invalidFields.push('NODE_ENV (must be development, production, or test)');
  }
  const NODE_ENV = nodeEnvRaw as EnvironmentMode;

  const portParsed = parseStrictPort(rawEnv.PORT, 3001);
  if (portParsed === null) {
    invalidFields.push(
      'PORT (must be a valid port number 1-65535 without trailing characters or whitespace)'
    );
  }
  const PORT = portParsed ?? 3001;

  const workerHealthPortParsed = parseStrictPort(rawEnv.WORKER_HEALTH_PORT, 3002);
  if (workerHealthPortParsed === null) {
    invalidFields.push(
      'WORKER_HEALTH_PORT (must be a valid port number 1-65535 without trailing characters or whitespace)'
    );
  }
  const WORKER_HEALTH_PORT = workerHealthPortParsed ?? 3002;

  const databaseUrlRaw = rawEnv.DATABASE_URL;
  if (!databaseUrlRaw) {
    invalidFields.push('DATABASE_URL (must be a valid postgresql:// connection string)');
  } else {
    try {
      const parsedUrl = new URL(databaseUrlRaw);
      if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
        invalidFields.push('DATABASE_URL (protocol must be postgresql: or postgres:)');
      } else if (!parsedUrl.hostname || parsedUrl.hostname.trim().length === 0) {
        invalidFields.push('DATABASE_URL (must specify a valid host)');
      }
    } catch {
      invalidFields.push('DATABASE_URL (must be a valid postgresql:// connection string)');
    }
  }
  const DATABASE_URL = databaseUrlRaw || '';

  if (NODE_ENV === 'production') {
    if (!rawEnv.REDIS_HOST || rawEnv.REDIS_HOST.trim().length === 0) {
      invalidFields.push('REDIS_HOST (required in production)');
    }
    if (!rawEnv.REDIS_PORT || rawEnv.REDIS_PORT.trim().length === 0) {
      invalidFields.push('REDIS_PORT (required in production)');
    }
    if (!rawEnv.S3_ENDPOINT || rawEnv.S3_ENDPOINT.trim().length === 0) {
      invalidFields.push('S3_ENDPOINT (required in production)');
    }
    if (!rawEnv.S3_REGION || rawEnv.S3_REGION.trim().length === 0) {
      invalidFields.push('S3_REGION (required in production)');
    }
    if (!rawEnv.S3_ACCESS_KEY || rawEnv.S3_ACCESS_KEY.trim().length === 0) {
      invalidFields.push('S3_ACCESS_KEY (required in production)');
    }
    if (!rawEnv.S3_SECRET_KEY || rawEnv.S3_SECRET_KEY.trim().length === 0) {
      invalidFields.push('S3_SECRET_KEY (required in production)');
    }
    if (!rawEnv.S3_BUCKET || rawEnv.S3_BUCKET.trim().length === 0) {
      invalidFields.push('S3_BUCKET (required in production)');
    }
  }

  const REDIS_HOST = rawEnv.REDIS_HOST || 'localhost';
  if (!REDIS_HOST || REDIS_HOST.trim().length === 0) {
    invalidFields.push('REDIS_HOST (cannot be empty)');
  }

  const redisPortParsed = parseStrictPort(rawEnv.REDIS_PORT, 6379);
  if (redisPortParsed === null) {
    invalidFields.push(
      'REDIS_PORT (must be a valid port number 1-65535 without trailing characters or whitespace)'
    );
  }
  const REDIS_PORT = redisPortParsed ?? 6379;

  const REDIS_PASSWORD = rawEnv.REDIS_PASSWORD || undefined;

  const S3_ENDPOINT = rawEnv.S3_ENDPOINT || 'http://localhost:9000';
  try {
    const parsedS3 = new URL(S3_ENDPOINT);
    if (parsedS3.protocol !== 'http:' && parsedS3.protocol !== 'https:') {
      invalidFields.push('S3_ENDPOINT (must start with http:// or https://)');
    } else if (!parsedS3.hostname || parsedS3.hostname.trim().length === 0) {
      invalidFields.push('S3_ENDPOINT (must specify a valid host)');
    }
  } catch {
    invalidFields.push('S3_ENDPOINT (must be a valid, parseable URL)');
  }

  const S3_REGION = rawEnv.S3_REGION || 'us-east-1';

  const rawAccessKey = rawEnv['S3_ACCESS_KEY'];
  if (NODE_ENV !== 'production' && (!rawAccessKey || rawAccessKey.trim().length === 0)) {
    invalidFields.push('S3_ACCESS_KEY (cannot be empty)');
  }
  const S3_ACCESS_KEY = rawAccessKey || '';

  const rawSecretKey = rawEnv['S3_SECRET_KEY'];
  if (NODE_ENV !== 'production' && (!rawSecretKey || rawSecretKey.trim().length === 0)) {
    invalidFields.push('S3_SECRET_KEY (cannot be empty)');
  }
  const S3_SECRET_KEY = rawSecretKey || '';

  const S3_BUCKET = rawEnv.S3_BUCKET || 'shipde-local';

  const s3ForcePathStyleRaw = rawEnv.S3_FORCE_PATH_STYLE;
  if (
    s3ForcePathStyleRaw !== undefined &&
    s3ForcePathStyleRaw !== 'true' &&
    s3ForcePathStyleRaw !== 'false'
  ) {
    invalidFields.push('S3_FORCE_PATH_STYLE (must be explicit true or false)');
  }
  const S3_FORCE_PATH_STYLE =
    s3ForcePathStyleRaw === undefined ? true : s3ForcePathStyleRaw === 'true';

  const carrierModeRaw = (rawEnv.CARRIER_MODE || 'disabled').toLowerCase();
  if (!['disabled', 'mock', 'live'].includes(carrierModeRaw)) {
    invalidFields.push('CARRIER_MODE (must be disabled, mock, or live)');
  }
  // Production must strictly reject mock mode
  if (NODE_ENV === 'production' && carrierModeRaw === 'mock') {
    invalidFields.push('CARRIER_MODE (mock mode is strictly prohibited in production)');
  }
  const CARRIER_MODE = carrierModeRaw as CarrierMode;

  const logLevelRaw = (rawEnv.LOG_LEVEL || 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(logLevelRaw)) {
    invalidFields.push('LOG_LEVEL (must be debug, info, warn, or error)');
  }
  const LOG_LEVEL = logLevelRaw as LogLevel;

  if (invalidFields.length > 0) {
    throw new ConfigValidationError(invalidFields);
  }

  return {
    NODE_ENV,
    PORT,
    WORKER_HEALTH_PORT,
    DATABASE_URL,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASSWORD,
    S3_ENDPOINT,
    S3_REGION,
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_BUCKET,
    S3_FORCE_PATH_STYLE,
    CARRIER_MODE,
    LOG_LEVEL,
  };
}

// --- Correlation Identification ---
export const CORRELATION_ID_HEADER = 'x-correlation-id' as const;

/**
 * Validates whether an incoming correlation identifier adheres to format and safety constraints.
 * Safe format: 8 to 128 characters, alphanumeric, hyphen, underscore.
 */
export function isValidCorrelationId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length < 8 || id.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Normalizes an incoming correlation ID, or generates a new secure UUID v4 if absent or invalid.
 */
export function normalizeCorrelationId(candidate?: string | null): string {
  if (candidate && isValidCorrelationId(candidate.trim())) {
    return candidate.trim();
  }
  return randomUUID();
}

// --- Structured Logging & Secret Redaction ---
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /auth/i,
  /credential/i,
  /key/i,
  /bearer/i,
  /cookie/i,
  /connection.*string/i,
];

import { getCurrentTraceAndSpanId } from './telemetry.js';

const REDACTED_MARKER = '[REDACTED]';

/**
 * Recursively redacts sensitive keys and values from objects, arrays, and error metadata.
 * Completely redacts database connection strings (PostgreSQL, Redis, etc.) and credential URIs (Finding 8).
 */
export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    let sanitized = data;
    // Redact complete connection string URIs (PostgreSQL, Redis, MongoDB, AMQP)
    sanitized = sanitized.replace(
      /(postgresql|postgres|redis|rediss|mongodb|mongodb\+srv|amqp|amqps):\/\/[^\s"',;]+/gi,
      REDACTED_MARKER
    );
    // Redact any other URI containing credentials (user:pass@host)
    if (sanitized.includes('://') && sanitized.includes('@')) {
      sanitized = sanitized.replace(
        /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"',;]*@[^\s"',;]+/g,
        REDACTED_MARKER
      );
    }
    // Redact Bearer tokens
    sanitized = sanitized.replace(/(bearer\s+)([^\s,;]+)/gi, `$1${REDACTED_MARKER}`);
    // Redact inline secrets, passwords, and tokens
    sanitized = sanitized.replace(
      /(password|passwd|secret|token|api_?key|access_?key|credential)([:=\s]+)([^\s,;]+)/gi,
      `$1$2${REDACTED_MARKER}`
    );
    return sanitized;
  }
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const isSensitiveKey = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitiveKey) {
      result[key] = REDACTED_MARKER;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    } else if (typeof value === 'string') {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Safely sanitizes an error message or object by stripping passwords, tokens, and credentials (P1 Finding 2)
 */
export function sanitizeErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  const rawMsg = err instanceof Error ? err.message : String(err);
  return redactSensitiveData(rawMsg) as string;
}

export interface StructuredLogEntry {
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Formats a log entry into a single line of sanitized, machine-parseable JSON.
 * Redacts both metadata AND message text to prevent accidental credential leakage (Finding 2).
 * Integrates distributed tracing correlation with traceId and spanId (Finding 10).
 */
export function formatStructuredLog(entry: StructuredLogEntry): string {
  const sanitizedMetadata = entry.metadata
    ? (redactSensitiveData(entry.metadata) as Record<string, unknown>)
    : undefined;

  const sanitizedMessage =
    typeof entry.message === 'string'
      ? (redactSensitiveData(entry.message) as string)
      : entry.message;

  const activeIds = getCurrentTraceAndSpanId();
  const traceId = entry.traceId || activeIds.traceId;
  const spanId = entry.spanId || activeIds.spanId;

  const logObject = {
    level: entry.level,
    time: entry.timestamp || new Date().toISOString(),
    service: entry.service,
    correlationId: entry.correlationId,
    ...(traceId ? { traceId } : {}),
    ...(spanId ? { spanId } : {}),
    message: sanitizedMessage,
    ...(sanitizedMetadata && Object.keys(sanitizedMetadata).length > 0
      ? { metadata: sanitizedMetadata }
      : {}),
  };

  return JSON.stringify(logObject);
}

export * from './telemetry.js';
