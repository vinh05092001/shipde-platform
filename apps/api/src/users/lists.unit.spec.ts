import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestingModule, Test } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { ListContractError, parseListQuery } from '../../../../packages/contracts/src/lists';
import { USERS_LIST_POLICY } from '../../../../packages/config/src/list-policies';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { SessionGuard } from '../session/session.guard';
import { PermissionsGuard } from '../rbac/rbac.guard';
import { parseCanonicalListQuery, requireListTenant } from './list-scope';
import { CanonicalApiException } from '../auth/auth.service';

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
