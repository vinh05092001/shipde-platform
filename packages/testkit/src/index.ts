/**
 * @shipde/testkit
 * Shared test fixtures, assertion helpers, and workspace boundary validation.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

export interface TestFixtureMeta {
  name: string;
  category: string;
  createdAt: Date;
}

export function createMockId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Resolves a monorepo package entrypoint or manifest using standard Node module resolution.
 * Throws an error if the package cannot be resolved.
 */
export function resolveMonorepoPackage(pkgName: string, fromUrl?: string): string {
  const req = createRequire(fromUrl || import.meta.url);
  try {
    return req.resolve(pkgName);
  } catch (err: unknown) {
    throw new Error(`Failed to resolve package "${pkgName}": ${(err as Error).message}`);
  }
}

/**
 * Asserts that a package name resolves to a valid, existing entry point on disk
 * through real Node package export/entry resolution rather than prefix matching.
 */
export function assertValidMonorepoPackage(pkgName: string, fromUrl?: string): boolean {
  try {
    const resolvedPath = resolveMonorepoPackage(pkgName, fromUrl);
    return typeof resolvedPath === 'string' && resolvedPath.length > 0 && existsSync(resolvedPath);
  } catch {
    return false;
  }
}

import type { LivenessResponse, ReadinessResponse } from '@shipde/contracts';
import type { AppConfig } from '@shipde/config';

/**
 * Asserts that the given response conforms strictly to the LivenessResponse contract.
 * Fails if missing required fields, if status is not 'ok', or if any sensitive fields leak.
 */
export function assertValidLivenessResponse(data: unknown): asserts data is LivenessResponse {
  if (!data || typeof data !== 'object') {
    throw new Error('Liveness response must be a non-null object');
  }
  const obj = data as Record<string, unknown>;
  if (obj.status !== 'ok') {
    throw new Error(`Expected liveness status 'ok', received '${String(obj.status)}'`);
  }
  if (typeof obj.service !== 'string' || obj.service.trim().length === 0) {
    throw new Error('Liveness response missing or invalid service name');
  }
  if (typeof obj.timestamp !== 'string' || Number.isNaN(Date.parse(obj.timestamp))) {
    throw new Error('Liveness response missing or invalid ISO-8601 timestamp');
  }
  if (typeof obj.correlationId !== 'string' || obj.correlationId.trim().length === 0) {
    throw new Error('Liveness response missing or invalid correlationId');
  }

  assertNoSensitiveData(data);
}

/**
 * Asserts that the given response conforms strictly to the ReadinessResponse contract.
 * Fails if missing required fields or if any sensitive fields leak.
 */
export function assertValidReadinessResponse(
  data: unknown,
  expectedStatus?: 'ok' | 'degraded' | 'error'
): asserts data is ReadinessResponse {
  if (!data || typeof data !== 'object') {
    throw new Error('Readiness response must be a non-null object');
  }
  const obj = data as Record<string, unknown>;
  if (!['ok', 'degraded', 'error'].includes(String(obj.status))) {
    throw new Error(`Invalid readiness status '${String(obj.status)}'`);
  }
  if (expectedStatus && obj.status !== expectedStatus) {
    throw new Error(`Expected readiness status '${expectedStatus}', got '${String(obj.status)}'`);
  }
  if (typeof obj.service !== 'string' || obj.service.trim().length === 0) {
    throw new Error('Readiness response missing or invalid service name');
  }
  if (typeof obj.timestamp !== 'string' || Number.isNaN(Date.parse(obj.timestamp))) {
    throw new Error('Readiness response missing or invalid ISO-8601 timestamp');
  }
  if (typeof obj.correlationId !== 'string' || obj.correlationId.trim().length === 0) {
    throw new Error('Readiness response missing or invalid correlationId');
  }
  if (!obj.checks || typeof obj.checks !== 'object') {
    throw new Error('Readiness response missing checks map');
  }

  assertNoSensitiveData(data);
}

/**
 * Sensitive key patterns and substring patterns that must never appear in responses or sanitized logs.
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /apikey/i,
  /connection.*string/i,
  /postgres:\/\//i,
  /redis:\/\//i,
  /minioadmin/i,
];

/**
 * Recursively asserts that an object contains no sensitive information in keys or values.
 */
export function assertNoSensitiveData(data: unknown, path = ''): void {
  if (data === null || data === undefined) {
    return;
  }
  if (typeof data === 'string') {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(data)) {
        throw new Error(`Sensitive data leaked at "${path}": matches pattern ${pattern}`);
      }
    }
    return;
  }
  if (typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const currentPath = path ? `${path}.${key}` : key;
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(key)) {
          throw new Error(`Sensitive key leaked at "${currentPath}": matches pattern ${pattern}`);
        }
      }
      assertNoSensitiveData(value, currentPath);
    }
  }
}

/**
 * Asserts that none of the provided secret values appear as substrings within text.
 */
export function assertNoSecretValues(text: string, secretValues: string[]): void {
  for (const secret of secretValues) {
    if (secret && text.includes(secret)) {
      throw new Error(`Secret value was leaked in text: ${secret}`);
    }
  }
}

/**
 * Generates a valid test configuration object with safe local defaults.
 */
export function createValidTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    WORKER_HEALTH_PORT: 3002,
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: process.env.S3_BUCKET || 'shipde-local',
    S3_FORCE_PATH_STYLE: true,
    CARRIER_MODE: 'mock',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}

// --- Carrier Mocks ---
export * from './carriers/index.js';

// --- MSW Canonical State Handlers ---
export * from './msw/index.js';
