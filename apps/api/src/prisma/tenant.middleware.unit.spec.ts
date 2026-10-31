import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { TenantMiddleware } from './tenant.middleware';
import { getTenantId, runWithTenant } from './tenant-context';
import { signAccessToken } from '../auth/token.util';

const SECRET = 'task-ai-154-test-secret-32chars!!';
process.env.AUTH_TOKEN_SECRET = SECRET;

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

function signToken(
  mid: string | null,
  role: 'OWNER' | 'PLATFORM_ADMIN' = 'OWNER',
  ttlSeconds = 3600,
  secret: string = SECRET,
  scope?: string
): string {
  const { token } = signAccessToken(
    {
      sub: 'usr-rls-test',
      sid: 'sid-rls-test',
      mid,
      role,
      st: 'active',
      scope,
    },
    secret,
    ttlSeconds
  );
  return token;
}

/**
 * Runs the middleware with a fake request and captures getTenantId() after an
 * async boundary (timer tick) inside the next() continuation — the same
 * mechanism by which guards and controller handlers inherit the context.
 */
function runMiddleware(authHeader?: string): Promise<string | undefined> {
  const middleware = new TenantMiddleware();
  return new Promise((resolve) => {
    const req = {
      headers: authHeader === undefined ? {} : { authorization: authHeader },
    };
    const next: NextFunction = () => {
      setTimeout(() => resolve(getTenantId()), 0);
    };
    middleware.use(req as unknown as Request, {} as Response, next);
  });
}

describe('TASK-AI-154: TenantMiddleware tenant context establishment', () => {
  it('establishes the tenant context from a signature-verified mid claim', async () => {
    const tenant = await runMiddleware(`Bearer ${signToken(MERCHANT_A)}`);
    assert.equal(tenant, MERCHANT_A);
  });

  it('propagates the tenant context across async continuations of next()', async () => {
    const tenant = await runMiddleware(`Bearer ${signToken(MERCHANT_B)}`);
    assert.equal(tenant, MERCHANT_B);
  });

  it('runs without a tenant context for platform operator tokens (no mid)', async () => {
    const tenant = await runMiddleware(`Bearer ${signToken(null, 'PLATFORM_ADMIN')}`);
    assert.equal(tenant, undefined);
  });

  it('runs without a tenant context when no Authorization header is present', async () => {
    const tenant = await runMiddleware();
    assert.equal(tenant, undefined);
  });

  it('does not trust tokens signed with a different secret', async () => {
    const forged = signToken(MERCHANT_A, 'OWNER', 3600, 'attacker-secret-32-chars-minimum!');
    const tenant = await runMiddleware(`Bearer ${forged}`);
    assert.equal(tenant, undefined);
  });

  it('does not trust expired tokens', async () => {
    const expired = signToken(MERCHANT_A, 'OWNER', -10);
    const tenant = await runMiddleware(`Bearer ${expired}`);
    assert.equal(tenant, undefined);
  });

  it('does not trust non-v1 token formats', async () => {
    const tenant = await runMiddleware('Bearer not-a-v1-token');
    assert.equal(tenant, undefined);
  });

  it('establishes the token tenant even when an outer context already exists', async () => {
    const tenant = await runWithTenant(MERCHANT_A, () =>
      runMiddleware(`Bearer ${signToken(MERCHANT_B)}`)
    );
    assert.equal(tenant, MERCHANT_B);
  });

  it('does not establish tenant context for setup tokens (scope: setup)', async () => {
    const setupToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, 'setup');
    const tenant = await runMiddleware(`Bearer ${setupToken}`);
    assert.equal(tenant, undefined, 'setup scoped tokens must not establish merchant tenant context');
  });

  it('does not establish tenant context for empty or whitespace-only mid claims', async () => {
    const emptyMidToken = signToken('   ', 'OWNER', 3600, SECRET);
    const tenant = await runMiddleware(`Bearer ${emptyMidToken}`);
    assert.equal(tenant, undefined, 'empty mid must not establish tenant context');
  });

  it('does not establish tenant context for empty scope claims', async () => {
    const emptyScopeToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, '');
    const tenant = await runMiddleware(`Bearer ${emptyScopeToken}`);
    assert.equal(tenant, undefined, 'empty scope must not establish merchant tenant context');
  });

  it('does not establish tenant context for whitespace-only scope claims', async () => {
    const whitespaceScopeToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, '   ');
    const tenant = await runMiddleware(`Bearer ${whitespaceScopeToken}`);
    assert.equal(
      tenant,
      undefined,
      'whitespace-only scope must not establish merchant tenant context'
    );
  });
});
