import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { BranchesService, maskAuditValue } from '../branches/branches.service';
import { WarehousesService, maskWarehouseAuditValue } from '../warehouses/warehouses.service';
import type { ActorContext } from '../rbac/rbac.dto';

test('FEAT-COM-02 review: missing, foreign and empty branch scopes never grant access', async () => {
  for (const user of [
    null,
    { merchant_id: 'tenant-b', role: 'OPS_CSKH', store_scopes: ['*'] },
    { merchant_id: 'tenant-a', role: 'OWNER', store_scopes: [] },
    { merchant_id: 'tenant-a', role: 'OPS_CSKH', store_scopes: [] },
  ]) {
    let branchReads = 0;
    const actor: ActorContext = {
      userId: 'actor-a',
      merchantId: 'tenant-a',
      role: user?.role || 'OPS_CSKH',
    };
    const prisma = {
      user: {
        findUnique: async ({ where }: { where: { id: string; merchant_id?: string } }) =>
          user && (!where.merchant_id || where.merchant_id === user.merchant_id) ? user : null,
      },
      branch: {
        findMany: async () => {
          branchReads++;
          return [{ id: 'private-branch', merchant_id: 'tenant-a' }];
        },
        count: async () => {
          branchReads++;
          return 1;
        },
      },
    };
    const service = new BranchesService(
      prisma as never,
      { actorHasPermissions: async () => true } as never
    );
    const result = await service.listBranches('tenant-a', actor, {}, 'review-scope');
    assert.deepEqual(
      result.data.branches,
      [],
      'an absent or empty authorized scope must not expose branch rows'
    );
    assert.equal(result.meta.total, 0, 'counts must not reveal unassigned branches');
    assert.equal(branchReads, 0, 'denied scopes must not run branch queries');
    assert.equal(
      await service.checkActorBranchScope(actor, { id: 'private-branch', code: 'PRIVATE' }),
      false
    );
  }
});

test('FEAT-COM-02 review: missing warehouse membership identity never reads global scopes', async () => {
  let membershipReads = 0;
  const prisma = {
    user: {
      findFirst: async () => {
        membershipReads++;
        return { warehouse_scopes: ['*'] };
      },
    },
  };
  const service = new WarehousesService(prisma as never);
  assert.deepEqual(
    await service.getActorWarehouseScopes({
      userId: 'global-actor',
      role: 'OWNER',
    } as ActorContext),
    []
  );
  assert.equal(
    membershipReads,
    0,
    'missing tenant identity must not broaden a Prisma membership query'
  );
});

test('FEAT-COM-02 review: audit masks nested bank, token, secret and contact values', () => {
  const sensitive = {
    contact_phone: '0901234567',
    email: 'private@example.test',
    bank_account_number: '0071001234567',
    token: 'private-token-value',
    secret: 'private-secret-value',
    children: [[{ apiKey: 'private-api-key', phone: ['0909876543'] }]],
  };
  for (const mask of [maskAuditValue, maskWarehouseAuditValue]) {
    const serialized = JSON.stringify(mask('metadata', sensitive));
    for (const value of [
      '0901234567',
      'private@example.test',
      '0071001234567',
      'private-token-value',
      'private-secret-value',
      'private-api-key',
      '0909876543',
    ]) {
      assert.ok(!serialized.includes(value), 'audit metadata contains an unmasked sensitive value');
    }
  }
});

test('FEAT-COM-02 review: carrier catalog and immutable migration remain available', () => {
  const root = resolve(__dirname, '../../../..');
  const appModule = readFileSync(resolve(root, 'apps/api/src/app.module.ts'), 'utf8');
  assert.match(
    appModule,
    /CarrierCatalogModule/,
    'list delivery must not remove the carrier catalog module'
  );
  const migration = readFileSync(
    resolve(root, 'prisma/migrations/20261031000000_feat_car_01_carrier_catalog/migration.sql'),
    'utf8'
  );
  const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
  for (const [model, table] of [
    ['Carrier', 'carriers'],
    ['CarrierService', 'carrier_services'],
    ['CanonicalStatusReference', 'canonical_status_references'],
    ['FeeComponentReference', 'fee_component_references'],
    ['CatalogCompatibilityMapping', 'catalog_compatibility_mappings'],
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`), `missing persisted model ${model}`);
    assert.ok(
      migration.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      `missing migration for ${table}`
    );
  }
});

test('FEAT-COM-02 review: unrelated approved delivery records and Work Items cannot disappear or return to backlog', () => {
  const root = resolve(__dirname, '../../../..');
  const register = readFileSync(
    resolve(root, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'),
    'utf8'
  );
  for (const id of ['FEAT-COM-09', 'FEAT-CAR-01', 'TASK-AI-153', 'TASK-AI-156', 'TASK-AI-157']) {
    const row = register.split(/\r?\n/).find((line) => line.includes(`"${id}"`));
    assert.ok(row, `approved delivery record ${id} is missing`);
    assert.ok(!row.includes('"BACKLOG"'), `approved delivery record ${id} was rolled back`);
    assert.ok(
      readFileSync(resolve(root, `docs/product-spec/work-items/${id}.md`), 'utf8').includes(id)
    );
  }
  const traceability = readFileSync(
    resolve(root, 'docs/product-spec/docs/00-control/TRACEABILITY.md'),
    'utf8'
  );
  for (const id of ['FEAT-COM-09', 'FEAT-CAR-01']) {
    assert.match(
      traceability,
      new RegExp(`\\| ${id} +\\|`),
      'approved feature traceability must remain'
    );
  }
});

test('FEAT-COM-02 review: mandatory tenant, audit and UI author checklists cannot disappear', () => {
  const root = resolve(__dirname, '../../../..');
  const apiInstructions = readFileSync(resolve(root, 'apps/api/AGENTS.md'), 'utf8');
  for (const requirement of [
    /An empty scope array denies/,
    /Audit metadata is always masked/,
    /cross-tenant negative supertest/,
  ]) {
    assert.match(apiInstructions, requirement, 'approved API author requirements must remain');
  }
  const webInstructions = readFileSync(resolve(root, 'apps/web/AGENTS.md'), 'utf8');
  assert.match(webInstructions, /loading, empty, error, forbidden and success/);
  assert.match(webInstructions, /Forbidden is a dedicated state/);
  for (const prompt of ['CODEX-PLANNING-PROMPT.md', 'GEMINI-START-PROMPT.md']) {
    const instructions = readFileSync(
      resolve(root, 'docs/product-spec/docs/10-ai-collaboration', prompt),
      'utf8'
    );
    assert.match(instructions, /Ambiguity check/, 'approved ambiguity gate must remain');
    assert.match(
      instructions,
      /Constitution check/,
      'approved security and product gate must remain'
    );
    assert.match(instructions, /Task breakdown/, 'approved executable task gate must remain');
  }
});

test('FEAT-COM-02 review: the handoff cannot assign UI acceptance to a different PR', () => {
  const root = resolve(__dirname, '../../../..');
  const workItem = readFileSync(
    resolve(root, 'docs/product-spec/work-items/FEAT-COM-02.md'),
    'utf8'
  );
  assert.ok(
    workItem.includes('feat/feat-com-02-api'),
    'handoff must name the current implementation branch'
  );
  assert.match(workItem, /Pull Request[^\n]*#479/, 'handoff must identify this PR');
  assert.ok(
    !workItem.includes('#467'),
    'connected consumer acceptance must not be delegated to another PR'
  );
  assert.ok(
    workItem.includes('shared-lists-browser.test.ts'),
    'handoff must identify executable browser acceptance evidence'
  );
});
