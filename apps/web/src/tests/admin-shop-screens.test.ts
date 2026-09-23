import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function assertContains(source: string, marker: string, state: string): void {
  assert.ok(source.includes(marker), `Admin shop screen must expose its ${state} state`);
}

const listPage = readSource('../app/admin/shops/page.tsx');
const createPage = readSource('../app/admin/shops/create/page.tsx');

const signedOutListGuard = listPage.indexOf('if (!isAuthenticated)');
const listLoadingState = listPage.indexOf('if (loading && shops.length === 0)');

assert.ok(signedOutListGuard >= 0, 'List screen must explicitly guard signed-out users');
assert.ok(listLoadingState >= 0, 'List screen must expose an authenticated loading state');
assert.ok(
  signedOutListGuard < listLoadingState,
  'Signed-out users must reach the forbidden state before the loading skeleton'
);
assertContains(listPage, "error?.code === 'FORBIDDEN'", 'forbidden');
assertContains(listPage, 'if (error)', 'recoverable error');
assertContains(listPage, 'if (shops.length === 0)', 'empty');
assertContains(listPage, 'filteredShops.map', 'success');
assertContains(listPage, 'void fetchShops()', 'retry');

const signedOutCreateGuard = createPage.indexOf('if (!isAuthenticated)');
const createSubmittingState = createPage.indexOf('setIsSubmitting(true)');

assert.ok(signedOutCreateGuard >= 0, 'Create screen must explicitly guard signed-out users');
assert.ok(createSubmittingState >= 0, 'Create screen must expose an in-flight submission state');
assert.ok(
  signedOutCreateGuard < createSubmittingState,
  'Signed-out users must reach the forbidden state before any loading state'
);
assertContains(createPage, "submitError?.code === 'FORBIDDEN'", 'forbidden');
assertContains(createPage, 'const validate = (): boolean', 'validation');
assertContains(createPage, 'if (submitError)', 'recoverable error');
assertContains(createPage, 'if (result?.success)', 'success');
assertContains(createPage, "useState('')", 'empty form');
assertContains(createPage, 'disabled={isSubmitting}', 'submit lock');

console.log('Admin shop screen-state acceptance tests passed.');
