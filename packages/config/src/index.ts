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

/**
 * Validates environment variables fail-closed.
 * Guarantees that sensitive values are NEVER exposed in error messages.
 */
export function validateConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
  const invalidFields: string[] = [];

  const nodeEnvRaw = rawEnv.NODE_ENV || 'development';
  if (!['development', 'production', 'test'].includes(nodeEnvRaw)) {
    invalidFields.push('NODE_ENV (must be development, production, or test)');
  }
  const NODE_ENV = nodeEnvRaw as EnvironmentMode;

  const portRaw = rawEnv.PORT || '3001';
  const PORT = Number.parseInt(portRaw, 10);
  if (Number.isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    invalidFields.push('PORT (must be a valid port number 1-65535)');
  }

  const workerHealthPortRaw = rawEnv.WORKER_HEALTH_PORT || '3002';
  const WORKER_HEALTH_PORT = Number.parseInt(workerHealthPortRaw, 10);
  if (Number.isNaN(WORKER_HEALTH_PORT) || WORKER_HEALTH_PORT <= 0 || WORKER_HEALTH_PORT > 65535) {
    invalidFields.push('WORKER_HEALTH_PORT (must be a valid port number 1-65535)');
  }

  const databaseUrlRaw = rawEnv.DATABASE_URL;
  if (
    !databaseUrlRaw ||
    (!databaseUrlRaw.startsWith('postgresql://') && !databaseUrlRaw.startsWith('postgres://'))
  ) {
    invalidFields.push('DATABASE_URL (must be a valid postgresql:// connection string)');
  }
  const DATABASE_URL = databaseUrlRaw || '';

  const REDIS_HOST = rawEnv.REDIS_HOST || 'localhost';
  if (!REDIS_HOST || REDIS_HOST.trim().length === 0) {
    invalidFields.push('REDIS_HOST (cannot be empty)');
  }

  const redisPortRaw = rawEnv.REDIS_PORT || '6379';
  const REDIS_PORT = Number.parseInt(redisPortRaw, 10);
  if (Number.isNaN(REDIS_PORT) || REDIS_PORT <= 0 || REDIS_PORT > 65535) {
    invalidFields.push('REDIS_PORT (must be a valid port number 1-65535)');
  }

  const REDIS_PASSWORD = rawEnv.REDIS_PASSWORD || undefined;

  const S3_ENDPOINT = rawEnv.S3_ENDPOINT || 'http://localhost:9000';
  if (!S3_ENDPOINT.startsWith('http://') && !S3_ENDPOINT.startsWith('https://')) {
    invalidFields.push('S3_ENDPOINT (must start with http:// or https://)');
  }

  const S3_REGION = rawEnv.S3_REGION || 'us-east-1';

  const rawAccessKey = rawEnv['S3_ACCESS_KEY'];
  if (!rawAccessKey || rawAccessKey.trim().length === 0) {
    invalidFields.push('S3_ACCESS_KEY (cannot be empty)');
  }
  const S3_ACCESS_KEY = rawAccessKey || '';

  const rawSecretKey = rawEnv['S3_SECRET_KEY'];
  if (!rawSecretKey || rawSecretKey.trim().length === 0) {
    invalidFields.push('S3_SECRET_KEY (cannot be empty)');
  }
  const S3_SECRET_KEY = rawSecretKey || '';

  const S3_BUCKET = rawEnv.S3_BUCKET || 'shipde-local';

  const s3ForcePathStyleRaw = rawEnv.S3_FORCE_PATH_STYLE;
  const S3_FORCE_PATH_STYLE = s3ForcePathStyleRaw !== 'false';

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

const REDACTED_MARKER = '[REDACTED]';

/**
 * Recursively redacts sensitive keys and values from objects, arrays, and error metadata.
 */
export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Redact potential postgres/http passwords in connection strings
    if (data.includes('://') && data.includes('@')) {
      return data.replace(/(:\/\/[^:]+:)[^@]+(@)/g, `$1${REDACTED_MARKER}$2`);
    }
    return data;
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
    } else if (typeof value === 'string' && value.includes('://') && value.includes('@')) {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface StructuredLogEntry {
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Formats a log entry into a single line of sanitized, machine-parseable JSON.
 */
export function formatStructuredLog(entry: StructuredLogEntry): string {
  const sanitizedMetadata = entry.metadata
    ? (redactSensitiveData(entry.metadata) as Record<string, unknown>)
    : undefined;

  const logObject = {
    level: entry.level,
    time: entry.timestamp || new Date().toISOString(),
    service: entry.service,
    correlationId: entry.correlationId,
    message: entry.message,
    ...(sanitizedMetadata && Object.keys(sanitizedMetadata).length > 0
      ? { metadata: sanitizedMetadata }
      : {}),
  };

  return JSON.stringify(logObject);
}
