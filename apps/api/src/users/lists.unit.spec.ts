import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestingModule, Test } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { ListContractError, parseListQuery } from '../../../../packages/contracts/src/lists';
import {
  USERS_LIST_POLICY,
  BRANCHES_LIST_POLICY,
  WAREHOUSES_LIST_POLICY,
} from '../../../../packages/config/src/list-policies';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { BranchesService } from '../branches/branches.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { SessionGuard } from '../session/session.guard';
import { PermissionsGuard } from '../rbac/rbac.guard';
import { parseCanonicalListQuery, requireListTenant } from './list-scope';
import { CanonicalApiException, type ActorContext } from '../auth/auth.service';

test('missing policy and authorized tenant fail closed with canonical errors', () => {
  assert.throws(
    () => parseCanonicalListQuery({}, undefined as any),
    (error: unknown) => {
      assert.ok(error instanceof CanonicalApiException);
      assert.equal(error.getStatus(), 503);
      assert.equal(error.code, 'TEMPORARILY_UNAVAILABLE');
      assert.equal(error.retryable, true);
      return true;
    }
  );
  for (const value of [undefined, null, '', ' ', [], {}, ' tenant-a ']) {
    assert.throws(
      () => requireListTenant(value),
      (error: unknown) => {
        assert.ok(error instanceof CanonicalApiException);
        assert.equal(error.getStatus(), 403);
        assert.equal(error.code, 'FORBIDDEN');
        return true;
      }
    );
  }
});

test('shared policy defaults, family keys, clamping and strict invalid input', () => {
  assert.equal(parseListQuery({}, USERS_LIST_POLICY).limit, 20);
  assert.equal(parseListQuery({ limit: '101' }, USERS_LIST_POLICY).limit, 100);
  const policy = { ...USERS_LIST_POLICY, sizeKey: 'page_size', defaultPage: 2, defaultSize: 3 };
  assert.deepEqual(parseListQuery({}, policy), {
    page: 2,
    limit: 3,
    skip: 3,
    filters: {},
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  for (const value of [
    '',
    null,
    false,
    -1,
    0,
    '1.5',
    '1e2',
    ' 2',
    '2x',
    [],
    ['2', '3'],
    {},
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    for (const key of [policy.pageKey, policy.sizeKey])
      assert.throws(
        () => parseListQuery({ [key]: value }, policy),
        (e: unknown) => e instanceof ListContractError && e.code === 'VALIDATION_ERROR'
      );
  }
  assert.throws(() => parseListQuery({ page: Number.MAX_SAFE_INTEGER }, policy));
  for (const broken of [
    undefined,
    {},
    { ...policy, maxSize: 0 },
    { ...policy, defaultSize: 999 },
    { ...policy, filters: [] },
    { ...policy, filters: { page: null } },
    { ...policy, sortFields: [] },
    { ...policy, tieBreaker: 'missing' },
    { ...policy, defaultDirection: 'bad' },
  ]) {
    assert.throws(
      () => parseListQuery({}, broken as any),
      (e: unknown) => e instanceof ListContractError && e.code === 'CONFIGURATION_ERROR'
    );
  }
});

test('HTTP list effects: filters, counts, deterministic pages, isolation, canonical failures', async () => {
  const rows = [
    {
      id: 'a',
      merchant_id: 'tenant-a',
      full_name: 'Same',
      role: 'OWNER',
      status: 'ACTIVE',
      custom_role_id: 'role-a',
    },
    {
      id: 'b',
      merchant_id: 'tenant-a',
      full_name: 'Same',
      role: 'OWNER',
      status: 'ACTIVE',
      custom_role_id: 'role-b',
    },
    {
      id: 'c',
      merchant_id: 'tenant-a',
      full_name: 'Other',
      role: 'WAREHOUSE',
      status: 'SUSPENDED',
    },
    { id: 'd', merchant_id: 'tenant-b', full_name: 'Same', role: 'OWNER', status: 'ACTIVE' },
  ].map((u) => ({ ...u, created_at: new Date('2026-01-01'), password_hash: 'private-value' }));
  const roles = [
    { id: 'role-a', merchant_id: 'tenant-a', name: 'Local' },
    { id: 'role-b', merchant_id: 'tenant-b', name: 'Private role' },
  ];
  let reads = 0;
  let fail = false;
  const matches = (row: any, where: any): boolean => {
    assert.equal(where.merchant_id, 'tenant-a');
    return (
      row.merchant_id === where.merchant_id &&
      (!where.role || row.role === where.role) &&
      (!where.status || row.status.toLowerCase() === where.status.equals.toLowerCase()) &&
      (!where.OR ||
        where.OR.some((condition: any) =>
          Object.entries(condition).some(([field, filter]: any) =>
            row[field]?.toLowerCase().includes(filter.contains.toLowerCase())
          )
        ))
    );
  };
  const readRows = (where: any) => {
    reads++;
    if (fail) throw new Error('sensitive database credentials and PII');
    return rows.filter((row) => matches(row, where));
  };
  const prisma = {
    user: {
      count: async ({ where }: any) => readRows(where).length,
      findMany: async ({ where, orderBy, skip, take }: any) =>
        readRows(where)
          .sort((a: any, b: any) => {
            for (const order of orderBy) {
              const [field, direction] = Object.entries(order)[0];
              if (a[field] < b[field]) return direction === 'asc' ? -1 : 1;
              if (a[field] > b[field]) return direction === 'asc' ? 1 : -1;
            }
            return 0;
          })
          .slice(skip, skip + take),
    },
    role: {
      findMany: async ({ where }: any) => {
        reads++;
        assert.equal(where.merchant_id, 'tenant-a');
        return roles.filter(
          (r) => r.merchant_id === where.merchant_id && where.id.in.includes(r.id)
        );
      },
    },
  };
  const service = new UsersService(prisma as any, {} as any);
  const module: TestingModule = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [{ provide: UsersService, useValue: service }],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(ctx: any) {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers.authorization)
          throw new UnauthorizedException({ error: { code: 'UNAUTHENTICATED' } });
        req.merchantId = req.headers['x-test-no-tenant'] ? undefined : 'tenant-a';
        return true;
      },
    })
    .overrideGuard(PermissionsGuard)
    .useValue({
      canActivate(ctx: any) {
        if (ctx.switchToHttp().getRequest().headers['x-test-forbidden'])
          throw new ForbiddenException({ error: { code: 'FORBIDDEN' } });
        return true;
      },
    })
    .compile();
  const app = module.createNestApplication();
  await app.init();
  const get = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/users${query}`)
      .set('authorization', 'Bearer fixture');
  try {
    const query = '?search=Same&role=OWNER&status=ACTIVE&sort_by=full_name&sort_order=asc&limit=1';
    const first = await get(query).expect(200);
    const second = await get(query + '&page=2').expect(200);
    assert.deepEqual(
      first.body.data.map((u: any) => u.id),
      ['a']
    );
    assert.deepEqual(
      second.body.data.map((u: any) => u.id),
      ['b']
    );
    assert.deepEqual(
      [first.body.meta.total, first.body.meta.total_pages, second.body.meta.total],
      [2, 2, 2]
    );
    assert.equal(first.body.data[0].custom_role.name, 'Local');
    assert.ok(!JSON.stringify(second.body).includes('Private role'));
    assert.ok(!JSON.stringify(first.body).includes('private-value'));
    const descending = await get(query.replace('sort_order=asc', 'sort_order=desc')).expect(200);
    assert.equal(descending.body.data[0].id, 'b');
    const defaults = await get().expect(200);
    assert.deepEqual(
      defaults.body.data.map((u: any) => u.id),
      ['c', 'b', 'a']
    );
    assert.equal(defaults.body.meta.limit, USERS_LIST_POLICY.defaultSize);
    const empty = await get('?search=missing').expect(200);
    assert.deepEqual(empty.body.data, []);
    assert.equal(empty.body.meta.total, 0);
    assert.equal(empty.body.meta.total_pages, 1);
    for (const invalid of [
      '?page=-1',
      '?page=1.1',
      '?page=1&page=2',
      '?limit=oops',
      '?limit=1.5',
      '?limit=0',
      '?limit=1&limit=2',
      '?page=9007199254740992',
      '?merchant_id=tenant-b',
      '?search[x]=private',
      '?sort_by=password_hash',
      '?sort_order=random',
      '?role=BAD',
      '?status=BAD',
      '?search[]=x',
    ]) {
      const before = reads;
      const result = await get(invalid).expect(400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.equal(reads, before);
      assert.ok(!JSON.stringify(result.body).includes('private'));
    }
    let before = reads;
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    await get().set('x-test-forbidden', 'true').expect(403);
    const missingTenant = await get().set('x-test-no-tenant', 'true').expect(403);
    assert.equal(missingTenant.body.error.code, 'FORBIDDEN');
    assert.equal(reads, before);
    fail = true;
    const failure = await get().expect(503);
    assert.equal(failure.body.error.code, 'TEMPORARILY_UNAVAILABLE');
    assert.equal(failure.body.error.retryable, true);
    assert.equal(failure.body.error.message, 'Danh sách tạm thời không khả dụng');
    assert.ok(!JSON.stringify(failure.body).includes('sensitive'));
  } finally {
    await app.close();
  }
});

test('Branches and Warehouses list policy contracts: defaults, clamping, validation', () => {
  // Branches policy
  assert.equal(parseListQuery({}, BRANCHES_LIST_POLICY).limit, 10);
  assert.equal(parseListQuery({ limit: '101' }, BRANCHES_LIST_POLICY).limit, 100);
  assert.deepEqual(
    parseListQuery(
      { page: '2', limit: '5', sort_by: 'code', sort_order: 'desc' },
      BRANCHES_LIST_POLICY
    ),
    {
      page: 2,
      limit: 5,
      skip: 5,
      filters: {},
      orderBy: [{ code: 'desc' }, { id: 'desc' }],
    }
  );
  assert.throws(
    () => parseListQuery({ status: 'INVALID_STATUS' }, BRANCHES_LIST_POLICY),
    (e: unknown) => e instanceof ListContractError && e.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => parseListQuery({ unknown_prop: 'injected' }, BRANCHES_LIST_POLICY),
    (e: unknown) => e instanceof ListContractError && e.code === 'VALIDATION_ERROR'
  );

  // Warehouses policy
  assert.equal(parseListQuery({}, WAREHOUSES_LIST_POLICY).limit, 10);
  assert.equal(parseListQuery({ limit: '150' }, WAREHOUSES_LIST_POLICY).limit, 100);
  assert.deepEqual(
    parseListQuery({ page: '3', limit: '10', status: 'active' }, WAREHOUSES_LIST_POLICY),
    {
      page: 3,
      limit: 10,
      skip: 20,
      filters: { status: 'active' },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    }
  );
  assert.throws(
    () => parseListQuery({ status: 'DELETED' }, WAREHOUSES_LIST_POLICY),
    (e: unknown) => e instanceof ListContractError && e.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => parseListQuery({ page: '0' }, WAREHOUSES_LIST_POLICY),
    (e: unknown) => e instanceof ListContractError && e.code === 'VALIDATION_ERROR'
  );
});

test('BranchesService.listBranches scoped database reads, counts, pagination, and tenant isolation', async () => {
  const branches = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      merchant_id: 'tenant-a',
      name: 'Chi Nhanh A1',
      code: 'CN-A1',
      address: '123 Le Loi',
      phone: '0901234567',
      is_default: true,
      status: 'ACTIVE',
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      merchant_id: 'tenant-a',
      name: 'Chi Nhanh A2',
      code: 'CN-A2',
      address: '456 Tran Hung Dao',
      phone: '0901234568',
      is_default: false,
      status: 'INACTIVE',
      created_at: new Date('2026-01-02'),
      updated_at: new Date('2026-01-02'),
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      merchant_id: 'tenant-b',
      name: 'Chi Nhanh B1',
      code: 'CN-B1',
      address: '789 Nguyen Hue',
      phone: '0901234569',
      is_default: true,
      status: 'ACTIVE',
      created_at: new Date('2026-01-03'),
      updated_at: new Date('2026-01-03'),
    },
  ];

  let countCalls = 0;
  let findManyCalls = 0;
  let lastWhereClause: any = null;

  const prisma: any = {
    branch: {
      count: async ({ where }: any) => {
        countCalls++;
        lastWhereClause = where;
        assert.equal(where.merchant_id, 'tenant-a');
        return branches.filter(
          (b) => b.merchant_id === where.merchant_id && (!where.status || b.status === where.status)
        ).length;
      },
      findMany: async ({ where, skip, take, orderBy }: any) => {
        findManyCalls++;
        assert.equal(where.merchant_id, 'tenant-a');
        const filtered = branches.filter(
          (b) => b.merchant_id === where.merchant_id && (!where.status || b.status === where.status)
        );
        return filtered.slice(skip, skip + take);
      },
    },
    user: {
      findUnique: async () => ({ role: 'OWNER', store_scopes: ['*'] }),
    },
  };

  const rbacService: any = {
    actorHasPermissions: async () => true,
  };

  const service = new BranchesService(prisma, rbacService);
  const actor: ActorContext = {
    userId: 'u1',
    merchantId: 'tenant-a',
    role: 'OWNER',
    email: 'owner@tenant-a.com',
  };

  // 1. Scoped query with pagination
  const res = await service.listBranches('tenant-a', actor, { page: '1', limit: '1' }, 'corr-1');
  assert.equal(res.success, true);
  assert.equal(res.data.branches.length, 1);
  assert.equal(res.data.branches[0].id, '00000000-0000-0000-0000-000000000001');
  assert.equal(res.meta.total, 2);
  assert.equal(res.meta.total_pages, 2);
  assert.equal(countCalls, 1);
  assert.equal(findManyCalls, 1);
  assert.equal(lastWhereClause.merchant_id, 'tenant-a');

  // 2. Status filter
  const resFiltered = await service.listBranches('tenant-a', actor, { status: 'ACTIVE' }, 'corr-2');
  assert.equal(resFiltered.meta.total, 1);
  assert.equal(resFiltered.data.branches[0].code, 'CN-A1');

  // 3. Missing merchantId fails closed
  await assert.rejects(
    () => service.listBranches('', actor, {}, 'corr-3'),
    (err: any) => err instanceof CanonicalApiException && err.getStatus() === 403
  );
});

test('WarehousesService.listWarehouses scoped database reads, counts, pagination, and tenant isolation', async () => {
  const warehouses = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      merchant_id: 'tenant-a',
      name: 'Kho Tong A1',
      code: 'WH-A1',
      address_line: '123 Duong A',
      city: 'TP.HCM',
      status: 'active',
      is_default: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      merchant_id: 'tenant-a',
      name: 'Kho Phu A2',
      code: 'WH-A2',
      address_line: '456 Duong B',
      city: 'Ha Noi',
      status: 'inactive',
      is_default: false,
      created_at: new Date('2026-01-02'),
      updated_at: new Date('2026-01-02'),
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      merchant_id: 'tenant-b',
      name: 'Kho B1',
      code: 'WH-B1',
      address_line: '789 Duong C',
      city: 'Da Nang',
      status: 'active',
      is_default: true,
      created_at: new Date('2026-01-03'),
      updated_at: new Date('2026-01-03'),
    },
  ];

  let countCalls = 0;
  let findManyCalls = 0;
  let lastWhereClause: any = null;

  const prisma: any = {
    warehouse: {
      count: async ({ where }: any) => {
        countCalls++;
        lastWhereClause = where;
        assert.equal(where.merchant_id, 'tenant-a');
        return warehouses.filter(
          (w) => w.merchant_id === where.merchant_id && (!where.status || w.status === where.status)
        ).length;
      },
      findMany: async ({ where, skip, take, orderBy }: any) => {
        findManyCalls++;
        assert.equal(where.merchant_id, 'tenant-a');
        const filtered = warehouses.filter(
          (w) => w.merchant_id === where.merchant_id && (!where.status || w.status === where.status)
        );
        return filtered.slice(skip, skip + take);
      },
    },
    user: {
      findFirst: async () => ({ role: 'OWNER', warehouse_scopes: ['*'] }),
    },
  };

  const service = new WarehousesService(prisma);
  const actor: ActorContext = {
    userId: 'u1',
    merchantId: 'tenant-a',
    role: 'OWNER',
    email: 'owner@tenant-a.com',
  };

  // 1. Scoped query with pagination
  const res = await service.listWarehouses('tenant-a', actor, true, 'corr-1', {
    page: '1',
    limit: '1',
  });
  assert.equal(res.success, true);
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].id, '00000000-0000-0000-0000-000000000001');
  assert.equal(res.meta.total, 2);
  assert.equal(res.meta.total_pages, 2);
  assert.equal(countCalls, 1);
  assert.equal(findManyCalls, 1);
  assert.equal(lastWhereClause.merchant_id, 'tenant-a');

  // 2. Status filter
  const resFiltered = await service.listWarehouses('tenant-a', actor, true, 'corr-2', {
    status: 'active',
  });
  assert.equal(resFiltered.meta.total, 1);
  assert.equal(resFiltered.data[0].code, 'WH-A1');

  // 3. Missing merchantId fails closed
  await assert.rejects(
    () => service.listWarehouses('', actor, true, 'corr-3', {}),
    (err: any) => err instanceof CanonicalApiException && err.getStatus() === 403
  );
});
