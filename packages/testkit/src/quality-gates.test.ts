import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { scanFileForA11y } from '../../../scripts/verify-a11y.js';
import { checkContractDrift, validateOpenApiSpec } from '../../../scripts/verify-contracts.js';

async function runQualityGatesNegativeFixtureTests() {
  console.log('🧪 Testing Fail-Closed Quality Gates (Negative Fixtures)...');

  // 1. Deliberately broken OpenAPI spec fails validateOpenApiSpec
  const tempBrokenSpec = path.resolve(process.cwd(), 'temp-broken-openapi.yaml');
  try {
    fs.writeFileSync(
      tempBrokenSpec,
      'openapi: 2.0\ninfo:\n  title: Broken Spec\npaths: {}\n',
      'utf8'
    );
    const specResult = await validateOpenApiSpec(tempBrokenSpec);
    assert.equal(specResult.valid, false, 'Broken OpenAPI spec must fail validation');
    assert.ok(
      specResult.errors.some((e) => e.includes('Spec must be OpenAPI 3.x')),
      'Must flag non-3.x spec'
    );
  } finally {
    if (fs.existsSync(tempBrokenSpec)) fs.unlinkSync(tempBrokenSpec);
  }

  // 2. Deliberate contract drift fails checkContractDrift
  const tempDriftTypes = path.resolve(process.cwd(), 'temp-drift-types.ts');
  try {
    fs.writeFileSync(tempDriftTypes, 'export interface Outdated { foo: string; }', 'utf8');
    const driftResult = await checkContractDrift(undefined, tempDriftTypes);
    assert.equal(driftResult.drift, true, 'Contract drift must be detected and fail');
  } finally {
    if (fs.existsSync(tempDriftTypes)) fs.unlinkSync(tempDriftTypes);
  }

  // 3. Accessibility negative fixture: <img> without alt attribute
  const tempA11yViolation = path.resolve(process.cwd(), 'temp-a11y-fixture.tsx');
  try {
    fs.writeFileSync(
      tempA11yViolation,
      'export const BadImg = () => <img src="/logo.png" />;',
      'utf8'
    );
    const violations = scanFileForA11y(tempA11yViolation);
    assert.ok(
      violations.length > 0,
      'Accessibility scanner must catch <img> without alt attribute'
    );
  } finally {
    if (fs.existsSync(tempA11yViolation)) fs.unlinkSync(tempA11yViolation);
  }

  // 4. Accessibility negative fixture: empty <button> without text/label
  const tempEmptyBtn = path.resolve(process.cwd(), 'temp-empty-btn.tsx');
  try {
    fs.writeFileSync(
      tempEmptyBtn,
      'export const BadBtn = () => <button className="icon-btn"></button>;',
      'utf8'
    );
    const btnViolations = scanFileForA11y(tempEmptyBtn);
    assert.ok(btnViolations.length > 0, 'Accessibility scanner must catch empty <button>');
  } finally {
    if (fs.existsSync(tempEmptyBtn)) fs.unlinkSync(tempEmptyBtn);
  }

  console.log('✅ All Negative Quality Gate tests correctly failed closed.');
}

runQualityGatesNegativeFixtureTests().catch((err) => {
  console.error('❌ Quality Gate negative fixture test failed:', err);
  process.exit(1);
});
