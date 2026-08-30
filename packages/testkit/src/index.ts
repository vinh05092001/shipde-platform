/**
 * @shipde/testkit
 * Shared test fixtures, assertion helpers, and workspace boundary validation.
 */

export interface TestFixtureMeta {
  name: string;
  category: string;
  createdAt: Date;
}

export function createMockId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
}

export function assertValidMonorepoPackage(pkgName: string): boolean {
  const validPrefixes = ['@shipde/'];
  return validPrefixes.some((prefix) => pkgName.startsWith(prefix));
}
