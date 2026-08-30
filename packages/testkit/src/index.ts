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
