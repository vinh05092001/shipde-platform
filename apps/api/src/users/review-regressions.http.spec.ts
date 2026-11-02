import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { BranchesController } from '../branches/branches.controller';
import { BranchesService } from '../branches/branches.service';
import { WarehousesController } from '../warehouses/warehouses.controller';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CarrierCatalogController } from '../carrier-catalog/carrier-catalog.controller';
import { CarrierCatalogModule } from '../carrier-catalog/carrier-catalog.module';
import { CarrierCatalogService } from '../carrier-catalog/carrier-catalog.service';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { SessionGuard } from '../session/session.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { CATALOG_REVISION } from '@shipde/contracts';

type Row = Record<string, unknown>;
type Query = { where?: Row; data?: Row; skip?: number; take?: number };
type Membership = {
  merchant_id: string;
  role: string;
  store_scopes: string[];
  warehouse_scopes: string[];
};

/** Persistence fixture only: HTTP controllers, permission guards and mutation/audit code are real. */
async function createReviewApp(membership: Membership | null) {
  const actor: ActorContext = {
    userId: 'actor-a',
    merchantId: 'tenant-a',
    role: membership?.role ?? 'OWNER',
  };
  const audits: Row[] = [];
  let writes = 0;
  let listReads = 0;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const timestamp = new Date('2026-10-30T00:00:00.000Z');
  const branches: Row[] = [
    {
      id: branchId,
      merchant_id: 'tenant-a',
      code: 'BR-A',
      name: 'Branch A',
      phone: '0901234567',
      address: 'Test address',
      is_default: false,
      status: 'ACTIVE',
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];
  const warehouses: Row[] = [
    {
      id: warehouseId,
      merchant_id: 'tenant-a',
      code: 'WH-A',
      name: 'Warehouse A',
      contact_name: 'Test contact',
      contact_phone: '0901234567',
      contact_email: 'old@example.test',
      return_contact_phone: '0907654321',
      use_different_return_address: true,
      address_line: 'Test address',
      district: 'Test district',
      city: 'Test city',
      address_json: { contact_phone: '0901234567', contact_email: 'old@example.test' },
      return_address_json: { return_contact_phone: '0907654321' },
      contacts_json: [
        { phone: '0901234567', email: 'old@example.test', bank_account: 'old-account' },
      ],
      printer_config: { api_key: 'old-key', nested: [{ token: 'old-token' }] },
      operating_hours: { nested: [{ secret: 'old-secret' }] },
      is_default: false,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id_merchant_id' || key === 'merchant_id_code') return matches(row, value as Row);
      if (value && typeof value === 'object' && 'not' in value)
        return row[key] !== (value as Row).not;
      return row[key] === value;
    });
  const table = (rows: Row[]) => ({
    findFirst: async ({ where }: Query) => rows.find((row) => matches(row, where)) ?? null,
    findUnique: async ({ where }: Query) => rows.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where, skip = 0, take }: Query) => {
      listReads++;
      return rows
        .filter((row) => matches(row, where))
        .slice(skip, take === undefined ? undefined : skip + take);
    },
    count: async ({ where }: Query) => rows.filter((row) => matches(row, where)).length,
    create: async ({ data }: Query) => {
      writes++;
      const row = { id: randomUUID(), created_at: timestamp, updated_at: timestamp, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: Query) => {
      writes++;
      const index = rows.findIndex((row) => matches(row, where));
      assert.ok(index >= 0);
      rows[index] = { ...rows[index], ...data };
      return rows[index];
    },
    updateMany: async ({ where, data }: Query) => {
      writes++;
      const selected = rows.filter((row) => matches(row, where));
      selected.forEach((row) => Object.assign(row, data));
      return { count: selected.length };
    },
    delete: async ({ where }: Query) => {
      writes++;
      const index = rows.findIndex((row) => matches(row, where));
      assert.ok(index >= 0);
      return rows.splice(index, 1)[0];
    },
  });
  const lookupMembership = async ({ where }: Query) =>
    membership && where?.id === actor.userId && where.merchant_id === membership.merchant_id
      ? membership
      : null;
  const carrier = {
    id: 'carrier-jt',
    code: 'JT',
    name: 'J&T Express',
    catalogRevision: CATALOG_REVISION,
    isActive: true,
    services: [],
  };
  const prisma = {
    branch: table(branches),
    warehouse: table(warehouses),
    user: { findUnique: lookupMembership, findFirst: lookupMembership },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        audits.push(structuredClone(data));
        return data;
      },
    },
    $queryRaw: async () => [{ id: actor.merchantId }],
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(prisma),
    carrier: { findMany: async () => [carrier], findUnique: async () => carrier },
    canonicalStatusReference: { findMany: async () => [] },
    feeComponentReference: { findMany: async () => [] },
    catalogCompatibilityMapping: { findMany: async () => [] },
  };
  let permission = true;
  const rbac = {
    assertPlatformSeedReady: () => undefined,
    resolveActorFromSession: async () => actor,
    actorHasPermissions: async () => permission,
  };
  const module = await Test.createTestingModule({
    controllers: [BranchesController, WarehousesController, CarrierCatalogController],
    providers: [
      BranchesService,
      WarehousesService,
      CarrierCatalogService,
      { provide: PrismaService, useValue: prisma },
      { provide: RbacService, useValue: rbac },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(context: ExecutionContext) {
        if (!context.switchToHttp().getRequest().headers.authorization)
          throw new UnauthorizedException();
        return true;
      },
    })
    .compile();
  const app = module.createNestApplication();
  app.useGlobalFilters(new CanonicalExceptionFilter());
  await app.init();
  return {
    app,
    audits,
    branches,
    warehouses,
    branchId,
    warehouseId,
    writes: () => writes,
    listReads: () => listReads,
    denyPermission: () => {
      permission = false;
    },
  };
}

const branchInput = { name: 'New branch', code: 'BR-NEW', phone: '0909876543' };
const warehouseInput = {
  name: 'New warehouse',
  code: 'WH-NEW',
  contact_name: 'Test contact',
  contact_phone: '0909876543',
  contact_email: 'new@example.test',
  address_line: 'Test address',
  district: 'Test district',
  city: 'Test city',
  use_different_return_address: true,
  return_contact_name: 'Return contact',
  return_contact_phone: '0908765432',
  return_address_line: 'Return address',
  return_district: 'Return district',
  return_city: 'Return city',
};

test('review HTTP: tenant A cannot read or mutate tenant B entities, even with wildcard scopes', async () => {
  const fixture = await createReviewApp({
    merchant_id: 'tenant-a',
    role: 'OWNER',
    store_scopes: ['*'],
    warehouse_scopes: ['*'],
  });
  const foreignBranchId = randomUUID();
  const foreignWarehouseId = randomUUID();
  fixture.branches.push({ ...fixture.branches[0], id: foreignBranchId, merchant_id: 'tenant-b' });
  fixture.warehouses.push({
    ...fixture.warehouses[0],
    id: foreignWarehouseId,
    merchant_id: 'tenant-b',
  });
  const http = request(fixture.app.getHttpServer());
  try {
    for (const [method, path] of [
      ['get', `branches/${foreignBranchId}`],
      ['patch', `branches/${foreignBranchId}`],
      ['post', `branches/${foreignBranchId}/activate`],
      ['post', `branches/${foreignBranchId}/deactivate`],
      ['delete', `branches/${foreignBranchId}`],
      ['get', `warehouses/${foreignWarehouseId}`],
      ['patch', `warehouses/${foreignWarehouseId}`],
      ['post', `warehouses/${foreignWarehouseId}/default`],
      ['delete', `warehouses/${foreignWarehouseId}`],
    ] as const) {
      await http[method](`/api/v1/${path}`)
        .set('Authorization', 'Bearer fixture')
        .send({ name: 'Must not change' })
        .expect(404);
      assert.equal(fixture.writes(), 0);
      assert.equal(fixture.audits.length, 0);
    }
    for (const resource of ['branches', 'warehouses']) {
      const response = await http
        .get(`/api/v1/${resource}`)
        .set('Authorization', 'Bearer fixture')
        .expect(200);
      assert.equal(response.body.meta.total, 1, 'tenant B must not contribute to the count');
      assert.ok(!JSON.stringify(response.body).includes('tenant-b'));
    }
  } finally {
    await fixture.app.close();
  }
});

test('review HTTP: scoped default changes cannot mutate an unassigned existing default', async () => {
  const fixture = await createReviewApp({
    merchant_id: 'tenant-a',
    role: 'OPS_CSKH',
    store_scopes: ['BR-A', 'BR-NEW'],
    warehouse_scopes: ['WH-A', 'WH-NEW'],
  });
  fixture.branches.push({
    ...fixture.branches[0],
    id: randomUUID(),
    code: 'BR-OTHER',
    is_default: true,
  });
  fixture.warehouses.push({
    ...fixture.warehouses[0],
    id: randomUUID(),
    code: 'WH-OTHER',
    is_default: true,
  });
  const http = request(fixture.app.getHttpServer());
  try {
    for (const [method, path, body] of [
      ['post', 'branches', { ...branchInput, is_default: true }],
      ['patch', `branches/${fixture.branchId}`, { is_default: true }],
      ['post', 'warehouses', { ...warehouseInput, is_default: true }],
      ['patch', `warehouses/${fixture.warehouseId}`, { is_default: true }],
      ['post', `warehouses/${fixture.warehouseId}/default`, {}],
    ] as const) {
      await http[method](`/api/v1/${path}`)
        .set('Authorization', 'Bearer fixture')
        .send(body)
        .expect(403);
      assert.equal(fixture.writes(), 0, 'the unassigned default must remain untouched');
      assert.equal(fixture.audits.length, 0);
    }
    assert.equal(fixture.branches[1].is_default, true);
    assert.equal(fixture.warehouses[1].is_default, true);
  } finally {
    await fixture.app.close();
  }
});

test('review HTTP: scoped warehouse default replacement succeeds when every affected warehouse is assigned', async () => {
  const fixture = await createReviewApp({
    merchant_id: 'tenant-a',
    role: 'OPS_CSKH',
    store_scopes: [],
    warehouse_scopes: ['WH-A', 'WH-OTHER'],
  });
  fixture.warehouses.push({
    ...fixture.warehouses[0],
    id: randomUUID(),
    code: 'WH-OTHER',
    is_default: true,
  });
  try {
    await request(fixture.app.getHttpServer())
      .post(`/api/v1/warehouses/${fixture.warehouseId}/default`)
      .set('Authorization', 'Bearer fixture')
      .expect(200);
    assert.equal(fixture.warehouses[0].is_default, true);
    assert.equal(fixture.warehouses[1].is_default, false);
    assert.equal(fixture.audits.length, 1);
  } finally {
    await fixture.app.close();
  }
});

for (const [label, membership] of [
  ['missing actor', null],
  [
    'foreign actor with wildcard',
    { merchant_id: 'tenant-b', role: 'OWNER', store_scopes: ['*'], warehouse_scopes: ['*'] },
  ],
  [
    'OWNER with empty scopes',
    { merchant_id: 'tenant-a', role: 'OWNER', store_scopes: [], warehouse_scopes: [] },
  ],
  [
    'operator with empty scopes',
    { merchant_id: 'tenant-a', role: 'OPS_CSKH', store_scopes: [], warehouse_scopes: [] },
  ],
  [
    'operator with other scopes',
    {
      merchant_id: 'tenant-a',
      role: 'OPS_CSKH',
      store_scopes: ['BR-OTHER'],
      warehouse_scopes: ['WH-OTHER'],
    },
  ],
] as const) {
  test(`review HTTP: ${label} cannot mutate branches or warehouses`, async () => {
    const fixture = await createReviewApp(membership as Membership | null);
    const http = request(fixture.app.getHttpServer());
    try {
      for (const [method, path, body, code] of [
        ['post', '/branches', branchInput, 'FORBIDDEN'],
        ['patch', `/branches/${fixture.branchId}`, { phone: '0909876543' }, 'FORBIDDEN'],
        ['post', `/branches/${fixture.branchId}/activate`, {}, 'FORBIDDEN'],
        ['post', `/branches/${fixture.branchId}/deactivate`, {}, 'FORBIDDEN'],
        ['delete', `/branches/${fixture.branchId}`, {}, 'FORBIDDEN'],
        ['post', '/warehouses', warehouseInput, 'WAREHOUSE_SCOPE_UNAUTHORIZED'],
        [
          'patch',
          `/warehouses/${fixture.warehouseId}`,
          { contact_phone: '0909876543' },
          'WAREHOUSE_SCOPE_UNAUTHORIZED',
        ],
        ['post', `/warehouses/${fixture.warehouseId}/default`, {}, 'WAREHOUSE_SCOPE_UNAUTHORIZED'],
        ['delete', `/warehouses/${fixture.warehouseId}`, {}, 'WAREHOUSE_SCOPE_UNAUTHORIZED'],
      ] as const) {
        const response = await http[method](`/api/v1${path}`)
          .set('Authorization', 'Bearer fixture')
          .send(body)
          .expect(403);
        assert.equal(response.body.error.code, code);
        assert.equal(fixture.writes(), 0, `${method} ${path} must not mutate persistence`);
        assert.equal(fixture.audits.length, 0, 'denied mutations must not write success audits');
      }
      if (label !== 'operator with other scopes') {
        for (const resource of ['branches', 'warehouses']) {
          const response = await http
            .get(`/api/v1/${resource}`)
            .set('Authorization', 'Bearer fixture')
            .expect(200);
          assert.equal(response.body.meta.total, 0);
          assert.deepEqual(
            resource === 'branches' ? response.body.data.branches : response.body.data,
            []
          );
        }
        assert.equal(fixture.listReads(), 0, 'empty scopes must not query tenant rows');
      }
      for (const path of [`branches/${fixture.branchId}`, `warehouses/${fixture.warehouseId}`]) {
        await http.get(`/api/v1/${path}`).set('Authorization', 'Bearer fixture').expect(403);
      }
    } finally {
      await fixture.app.close();
    }
  });
}

test('review HTTP: actual audit writes mask contacts and nested sensitive metadata for every mutation path', async () => {
  const fixture = await createReviewApp({
    merchant_id: 'tenant-a',
    role: 'OWNER',
    store_scopes: ['*'],
    warehouse_scopes: ['*'],
  });
  const http = request(fixture.app.getHttpServer());
  const authorized = (method: 'post' | 'patch' | 'delete', path: string) =>
    http[method](`/api/v1/${path}`).set('Authorization', 'Bearer fixture');
  try {
    await authorized('post', 'branches').send(branchInput).expect(201);
    await authorized('patch', `branches/${fixture.branchId}`)
      .send({ phone: '0909876543' })
      .expect(200);
    await authorized('post', `branches/${fixture.branchId}/deactivate`).expect(200);
    await authorized('post', `branches/${fixture.branchId}/activate`).expect(200);
    await authorized('delete', `branches/${fixture.branchId}`).expect(200);
    await authorized('post', 'warehouses').send(warehouseInput).expect(201);
    await authorized('patch', `warehouses/${fixture.warehouseId}`)
      .send({
        contact_phone: '0909876543',
        contact_email: 'new@example.test',
        return_contact_phone: '0908765432',
        contacts_json: [
          [{ phone: ['0909876543'], email: 'new@example.test', bank_account: 'new-account' }],
        ],
        printer_config: {
          api_key: 'new-key',
          nested: [[{ token: 'new-token', authorization: 'private-authorization' }]],
        },
        operating_hours: {
          nested: [{ secret: 'new-secret', credentials: { password: 'private-password' } }],
        },
      })
      .expect(200);
    await authorized('post', `warehouses/${fixture.warehouseId}/default`).expect(200);
    await authorized('delete', `warehouses/${fixture.warehouseId}`).expect(200);
    assert.equal(fixture.audits.length, 9, 'each successful mutation must persist an audit');
    const rawValues = [
      '0901234567',
      '0909876543',
      '0907654321',
      '0908765432',
      'old@example.test',
      'new@example.test',
      'old-account',
      'new-account',
      'old-key',
      'new-key',
      'old-token',
      'new-token',
      'old-secret',
      'new-secret',
      'private-authorization',
      'private-password',
    ];
    for (const audit of fixture.audits) {
      assert.equal(audit.merchant_id, 'tenant-a');
      assert.equal(audit.user_id, 'actor-a');
      for (const value of rawValues)
        assert.ok(
          !JSON.stringify(audit).includes(value),
          'audit persistence received raw sensitive metadata'
        );
    }
    const branchAudit = fixture.audits.find((audit) => audit.action === 'BRANCH_UPDATED');
    assert.equal((branchAudit?.old_value as Row).phone, '090****567');
    assert.equal((branchAudit?.new_value as Row).phone, '090****543');
    const warehouseAudit = fixture.audits.find((audit) => audit.action === 'WAREHOUSE_UPDATED');
    assert.ok((warehouseAudit?.old_value as Row).contacts_json);
    assert.ok((warehouseAudit?.new_value as Row).printer_config);
    assert.ok(JSON.stringify(warehouseAudit).includes('[REDACTED]'));
    assert.equal(
      fixture.warehouses.find((row) => row.id === fixture.warehouseId)?.contact_phone,
      '0909876543',
      'audit masking must not corrupt the business record'
    );
  } finally {
    await fixture.app.close();
  }
});

test('review HTTP: catalog remains registered, preserves JT and denies unauthorized access on all five endpoints', async () => {
  assert.ok(
    (Reflect.getMetadata('imports', AppModule) as unknown[]).includes(CarrierCatalogModule)
  );
  const fixture = await createReviewApp({
    merchant_id: 'tenant-a',
    role: 'OWNER',
    store_scopes: ['*'],
    warehouse_scopes: ['*'],
  });
  const http = request(fixture.app.getHttpServer());
  try {
    for (const path of ['carriers', 'carriers/JT', 'statuses', 'fee-components', 'compatibility']) {
      const response = await http
        .get(`/api/v1/carrier-catalog/${path}`)
        .set('Authorization', 'Bearer fixture')
        .expect(200);
      assert.equal(response.body.catalog_revision, CATALOG_REVISION);
      await http.get(`/api/v1/carrier-catalog/${path}`).expect(401);
    }
    const jt = await http
      .get('/api/v1/carrier-catalog/carriers/JT_EXPRESS')
      .set('Authorization', 'Bearer fixture')
      .expect(200);
    assert.equal(jt.body.data.code, 'JT');
    await http
      .get('/api/v1/carrier-catalog/carriers/unknown')
      .set('Authorization', 'Bearer fixture')
      .expect(404);
    fixture.denyPermission();
    for (const path of ['carriers', 'carriers/JT', 'statuses', 'fee-components', 'compatibility']) {
      await http
        .get(`/api/v1/carrier-catalog/${path}`)
        .set('Authorization', 'Bearer fixture')
        .expect(403);
    }
  } finally {
    await fixture.app.close();
  }
});
