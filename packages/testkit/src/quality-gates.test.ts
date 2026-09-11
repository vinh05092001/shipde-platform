import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { scanFileForA11y } from '../../../scripts/verify-a11y.js';
import { checkContractDrift, validateOpenApiSpec } from '../../../scripts/verify-contracts.js';
import { verifyPerformanceBudgets } from '../../../scripts/verify-perf.js';
import { runVisualVerification } from '../../../scripts/verify-visual.js';
import { scanFile, parseGitleaksConfig } from '../../../scripts/verify-secrets.js';
import { seedDatabase } from '../../../infra/docker/seed.js';

function findMonorepoRoot(dir: string = process.cwd()): string {
  let curr = dir;
  while (curr && curr !== path.dirname(curr)) {
    if (
      fs.existsSync(path.join(curr, '.gitleaks.toml')) ||
      fs.existsSync(path.join(curr, 'pnpm-workspace.yaml'))
    ) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return dir;
}

async function runQualityGatesNegativeFixtureTests() {
  console.log('🧪 Testing Fail-Closed Quality Gates (Negative Fixtures)...');
  const monorepoRoot = findMonorepoRoot();

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

  // 5. Secret scan negative fixture: simulated live secret caught and failed (AC-FOUND-04-08)
  const tempSecretFile = path.resolve(process.cwd(), 'temp-secret-fixture.txt');
  try {
    fs.writeFileSync(
      tempSecretFile,
      'carrier_api_key = "ghn_secret_token_1234567890abcdef1234567890"',
      'utf8'
    );
    const config = parseGitleaksConfig(path.resolve(monorepoRoot, '.gitleaks.toml'));
    const findings = scanFile(tempSecretFile, config.rules);
    assert.ok(findings.length > 0, 'Secret scanner must catch leaked secret in negative fixture');
    assert.equal(findings[0].ruleId, 'generic-api-key');
  } finally {
    if (fs.existsSync(tempSecretFile)) fs.unlinkSync(tempSecretFile);
  }

  // 6. Performance budget negative fixture: exceeded budget fails closed (AC-FOUND-04-08)
  const tempManifestDir = path.resolve(process.cwd(), 'temp-perf-fixture');
  const tempManifestPath = path.join(tempManifestDir, 'build-manifest.json');
  const tempChunkPath = path.join(tempManifestDir, 'chunk.js');
  try {
    fs.mkdirSync(tempManifestDir, { recursive: true });
    fs.writeFileSync(
      tempChunkPath,
      'console.log("giant chunk payload for budget overrun");'.repeat(50),
      'utf8'
    );
    fs.writeFileSync(
      tempManifestPath,
      JSON.stringify({
        rootMainFiles: ['chunk.js'],
        polyfillFiles: [],
      }),
      'utf8'
    );
    const perfResult = verifyPerformanceBudgets({
      manifestPath: tempManifestPath,
      budgets: [{ route: '/', maxInitialJsBytes: 100 }], // 100 bytes budget vs >1000 bytes chunk
    });
    assert.equal(
      perfResult.passed,
      false,
      'Performance gate must fail closed when budget is exceeded'
    );
    assert.ok(
      perfResult.errors.some((e) => e.includes('exceeded JS performance budget')),
      'Must report exact performance budget overrun'
    );
  } finally {
    if (fs.existsSync(tempManifestDir))
      fs.rmSync(tempManifestDir, { recursive: true, force: true });
  }

  // 7. Visual regression negative fixture: missing visual token fails closed (AC-FOUND-04-08)
  const tempVisualCatalog = path.resolve(process.cwd(), 'temp-visual-baseline.json');
  try {
    fs.writeFileSync(
      tempVisualCatalog,
      JSON.stringify({
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        surfaces: [
          {
            id: 'SMOKE-CORRUPTED',
            component: 'NonExistentComponent',
            filePath: 'apps/web/src/components/NonExistentComponent.tsx',
            viewport: { width: 1280, height: 800 },
            requiredVisualTokens: ['TOKEN_NEVER_PRESENT'],
            layoutType: 'test',
          },
        ],
      }),
      'utf8'
    );
    const visualResult = runVisualVerification(tempVisualCatalog);
    assert.equal(
      visualResult.passed,
      false,
      'Visual regression gate must fail closed on missing surface/token'
    );
    assert.ok(visualResult.errors.length > 0, 'Must record visual regression error');
  } finally {
    if (fs.existsSync(tempVisualCatalog)) fs.unlinkSync(tempVisualCatalog);
  }

  // 8. Database seed fixture verification (AC-FOUND-04-06)
  const mockPrismaClient: any = {
    merchant: {
      upsert: async () => ({}),
      count: async () => 1,
    },
    user: {
      upsert: async () => ({}),
      count: async () => 3,
    },
    carrierAccount: {
      upsert: async () => ({}),
      count: async () => 3,
    },
  };
  const seedResult = await seedDatabase(mockPrismaClient);
  assert.equal(seedResult.merchantsCount, 1, 'Seeded merchants count must match');
  assert.equal(seedResult.usersCount, 3, 'Seeded users count must match');
  assert.equal(seedResult.accountsCount, 3, 'Seeded carrier accounts count must match');

  console.log(
    '✅ All Negative Quality Gate tests correctly failed closed (Contracts, A11y, Secrets, Perf, Visual, Seed).'
  );
}

runQualityGatesNegativeFixtureTests().catch((err) => {
  console.error('❌ Quality Gate negative fixture test failed:', err);
  process.exit(1);
});
