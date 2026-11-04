import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { TenantMiddleware } from './tenant.middleware';
import { getTenantId, runWithTenant } from './tenant-context';
import { signAccessToken } from '../auth/token.util';

const SECRET = 'task-ai-154-test-secret-32chars!!';
process.env.AUTH_TOKEN_SECRET = SECRET;

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

/**
 * Repository-root-relative path resolution (tests run from apps/api or the
 * repository root). The Work Item is published as the Pull Request body, so
 * the test reads the committed document rather than a build artifact.
 */
function repoRootFrom(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const WORK_ITEM_PATH = path.join(
  repoRootFrom(__dirname),
  'docs',
  'product-spec',
  'work-items',
  'TASK-AI-154.md'
);

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
function runMiddleware(
  authHeader?: string,
  requestPath = '/api/v1/orders'
): Promise<string | undefined> {
  const middleware = new TenantMiddleware();
  return new Promise((resolve, reject) => {
    const req = {
      path: requestPath,
      headers: authHeader === undefined ? {} : { authorization: authHeader },
    };
    const next: NextFunction = () => {
      setTimeout(() => resolve(getTenantId()), 0);
    };
    const res = {
      status(code: number) {
        return {
          json(payload: any) {
            reject({
              status: code,
              ...payload,
            });
          },
        };
      },
    };
    try {
      middleware.use(req as unknown as Request, res as unknown as Response, next);
    } catch (err) {
      reject(err);
    }
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

  it('does not establish tenant context for setup tokens on setup routes', async () => {
    const setupToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, 'setup');
    const tenant = await runMiddleware(`Bearer ${setupToken}`, '/auth/mfa/setup');
    assert.equal(
      tenant,
      undefined,
      'setup scoped tokens on setup routes must not establish merchant tenant context'
    );
  });

  it('rejects setup tokens on protected resource routes with 403 Forbidden', async () => {
    const setupToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, 'setup');
    await assert.rejects(
      runMiddleware(`Bearer ${setupToken}`, '/api/v1/orders'),
      (err: any) => {
        const status = err.status ?? err.getStatus?.();
        const code = err.response?.error?.code ?? err.error?.code;
        assert.equal(status, 403);
        assert.equal(code, 'FORBIDDEN');
        return true;
      },
      'setup scoped tokens must reject on protected resource routes'
    );
  });

  it('does not establish tenant context for empty or whitespace-only mid claims', async () => {
    const emptyMidToken = signToken('   ', 'OWNER', 3600, SECRET);
    const tenant = await runMiddleware(`Bearer ${emptyMidToken}`);
    assert.equal(tenant, undefined, 'empty mid must not establish tenant context');
  });

  it('rejects empty scope claims with 403 Forbidden', async () => {
    const emptyScopeToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, '');
    await assert.rejects(
      runMiddleware(`Bearer ${emptyScopeToken}`),
      (err: any) => {
        const status = err.status ?? err.getStatus?.();
        const code = err.response?.error?.code ?? err.error?.code;
        assert.equal(status, 403);
        assert.equal(code, 'FORBIDDEN');
        return true;
      },
      'empty scope must reject with 403 FORBIDDEN'
    );
  });

  it('rejects whitespace-only scope claims with 403 Forbidden', async () => {
    const whitespaceScopeToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, '   ');
    await assert.rejects(
      runMiddleware(`Bearer ${whitespaceScopeToken}`),
      (err: any) => {
        const status = err.status ?? err.getStatus?.();
        const code = err.response?.error?.code ?? err.error?.code;
        assert.equal(status, 403);
        assert.equal(code, 'FORBIDDEN');
        return true;
      },
      'whitespace-only scope must reject with 403 FORBIDDEN'
    );
  });

  // TASK-AI-154 review round 8: the Work Item file is published as the Pull
  // Request body, and the PR contract gate rejects any angle-bracket template
  // placeholder. Documentation must never reintroduce one.
  it('Work Item text contains no angle-bracket template placeholder', () => {
    const body = fs.readFileSync(WORK_ITEM_PATH, 'utf8');
    const placeholders = body.match(/<[^>\n]+>/g) || [];
    assert.deepEqual(placeholders, [], `placeholders: ${placeholders.join(', ')}`);
  });

  it('rejects empty array scope claims with 403 Forbidden', async () => {
    const emptyArrayScopeToken = signToken(
      MERCHANT_A,
      'OWNER',
      3600,
      SECRET,
      [] as unknown as string
    );
    await assert.rejects(
      runMiddleware(`Bearer ${emptyArrayScopeToken}`),
      (err: any) => {
        const status = err.status ?? err.getStatus?.();
        const code = err.response?.error?.code ?? err.error?.code;
        assert.equal(status, 403);
        assert.equal(code, 'FORBIDDEN');
        return true;
      },
      'empty array scope must reject with 403 FORBIDDEN'
    );
  });

  it('does not establish tenant context for PLATFORM_ADMIN tokens even if mid is present', async () => {
    const adminWithMid = signToken(MERCHANT_A, 'PLATFORM_ADMIN');
    const tenant = await runMiddleware(`Bearer ${adminWithMid}`);
    assert.equal(
      tenant,
      undefined,
      'PLATFORM_ADMIN tokens must never establish merchant tenant context even if mid is set'
    );
  });

  it('rejects setup prefixed scope array claims with 403 Forbidden', async () => {
    const setupArrayScopeToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, [
      'setup-invite',
    ] as unknown as string);
    await assert.rejects(
      runMiddleware(`Bearer ${setupArrayScopeToken}`),
      (err: any) => {
        const status = err.status ?? err.getStatus?.();
        const code = err.response?.error?.code ?? err.error?.code;
        assert.equal(status, 403);
        assert.equal(code, 'FORBIDDEN');
        return true;
      },
      'setup-x scope must reject with 403 FORBIDDEN'
    );
  });

  it('rejects null/invalid scope array claims with 403 Forbidden', async () => {
    const nullArrayScopeToken = signToken(MERCHANT_A, 'OWNER', 3600, SECRET, [
      null,
    ] as unknown as string);
    await assert.rejects(
      runMiddleware(`Bearer ${nullArrayScopeToken}`),
      (err: any) => {
        const status = err.status ?? err.getStatus?.();
        const code = err.response?.error?.code ?? err.error?.code;
        assert.equal(status, 403);
        assert.equal(code, 'FORBIDDEN');
        return true;
      },
      '[null] scope must reject with 403 FORBIDDEN'
    );
  });

  it('rejects non-string scope claims with 403 Forbidden', async () => {
    const numberScopeToken = signToken(
      MERCHANT_A,
      'OWNER',
      3600,
      SECRET,
      12345 as unknown as string
    );
    await assert.rejects(
      runMiddleware(`Bearer ${numberScopeToken}`),
      (err: any) => {
        const status = err.status ?? err.getStatus?.();
        const code = err.response?.error?.code ?? err.error?.code;
        assert.equal(status, 403);
        assert.equal(code, 'FORBIDDEN');
        return true;
      },
      'non-string scope must reject with 403 FORBIDDEN'
    );
  });
});
