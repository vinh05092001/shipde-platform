import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { SessionStatusEnum } from '@prisma/client';

describe('FEAT-AUTH-06 Session Management Unit & Concurrency Suite', () => {
  // ---------------------------------------------------------------------------
  // Finding 2: AC-SESS-06 next_action must be 'LOGIN' on SESSION_INVALID
  // ---------------------------------------------------------------------------
  describe('SessionGuard (AC-SESS-06 / Finding 2)', () => {
    it('returns next_action: LOGIN when session is not found in database (expired/revoked)', async () => {
      const mockSessionService: any = {
        validateSession: async () => null,
      };
      const guard = new SessionGuard(mockSessionService);

      const mockReq: any = {
        headers: {
          authorization: 'Bearer valid-format-session-token-64-bytes-abc-def',
        },
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockReq,
        }),
      };

      await assert.rejects(
        async () => {
          await guard.canActivate(mockContext);
        },
        (err: any) => {
          assert.ok(err instanceof UnauthorizedException);
          const response = err.getResponse();
          assert.strictEqual(response.error.code, 'SESSION_INVALID');
          assert.strictEqual(
            response.error.next_action,
            'LOGIN',
            'next_action must be LOGIN per AC-SESS-06'
          );
          return true;
        }
      );
    });

    it('returns next_action: LOGIN when signed JWT token has invalid signature or claims', async () => {
      const mockSessionService: any = {
        validateSession: async () => null,
      };
      const guard = new SessionGuard(mockSessionService);

      const mockReq: any = {
        headers: {
          authorization: 'Bearer v1.invalid-payload.bad-signature',
        },
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockReq,
        }),
      };

      await assert.rejects(
        async () => {
          await guard.canActivate(mockContext);
        },
        (err: any) => {
          assert.ok(err instanceof UnauthorizedException);
          const response = err.getResponse();
          assert.strictEqual(response.error.code, 'SESSION_INVALID');
          assert.strictEqual(
            response.error.next_action,
            'LOGIN',
            'next_action must be LOGIN per AC-SESS-06'
          );
          return true;
        }
      );
    });

    it('rejects unauthenticated requests without Bearer header', async () => {
      const mockSessionService: any = {
        validateSession: async () => null,
      };
      const guard = new SessionGuard(mockSessionService);

      const mockReq: any = { headers: {} };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockReq,
        }),
      };

      await assert.rejects(
        async () => {
          await guard.canActivate(mockContext);
        },
        (err: any) => {
          assert.ok(err instanceof UnauthorizedException);
          const response = err.getResponse();
          assert.strictEqual(response.error.code, 'UNAUTHENTICATED');
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 3: Concurrency safety in session revocation (BR-SESS-06 / AC-SESS-08)
  // ---------------------------------------------------------------------------
  describe('SessionService Concurrency Safety (BR-SESS-06 / AC-SESS-08 / Finding 3)', () => {
    it('concurrent revocations result in atomic state update and exactly ONE audit log', async () => {
      process.env.AUDIT_IDENTIFIER_HMAC_KEY = 'test-audit-hmac-key-placeholder-32-chars';

      const sessionId = 'session-uuid-concurrent-1';
      const userId = 'user-uuid-1';
      const merchantId = 'merchant-uuid-1';
      let auditLogCalls = 0;
      let sessionState: SessionStatusEnum = SessionStatusEnum.ACTIVE;

      // Mock Prisma that simulates two transactions competing on the active session
      const mockPrisma: any = {
        deviceSession: {
          findUnique: async () => ({
            id: sessionId,
            user_id: userId,
            merchant_id: merchantId,
            status: sessionState,
            device_id: 'test-device-1',
          }),
        },
        $transaction: async (callback: any) => {
          const tx: any = {
            deviceSession: {
              updateMany: async (args: any) => {
                // If status: ACTIVE is requested and session is ACTIVE, atomically transition
                if (args.where.status === SessionStatusEnum.ACTIVE) {
                  if (sessionState === SessionStatusEnum.ACTIVE) {
                    sessionState = SessionStatusEnum.REVOKED;
                    return { count: 1 };
                  }
                  return { count: 0 };
                }
                return { count: 0 };
              },
              findUnique: async () => ({
                id: sessionId,
                status: sessionState,
              }),
            },
            auditLog: {
              create: async () => {
                auditLogCalls += 1;
                return { id: `audit-${auditLogCalls}` };
              },
            },
          };
          return callback(tx);
        },
      };

      const service = new SessionService(mockPrisma);

      // Simulate 2 simultaneous revocation requests
      const [result1, result2] = await Promise.all([
        service.revoke(sessionId, userId, merchantId, 'corr-conc-1', 'Revoke 1', '1.2.3.4'),
        service.revoke(sessionId, userId, merchantId, 'corr-conc-2', 'Revoke 2', '1.2.3.4'),
      ]);

      assert.strictEqual(result1.status, SessionStatusEnum.REVOKED);
      assert.strictEqual(result2.status, SessionStatusEnum.REVOKED);

      // Exactly ONE audit log must have been created
      assert.strictEqual(
        auditLogCalls,
        1,
        'Only 1 audit record must be inserted across concurrent revocations'
      );

      // One must be primary revoked, one must be idempotent message
      const messages = [result1.message, result2.message];
      assert.ok(messages.includes('Phiên đã được thu hồi'));
      assert.ok(messages.includes('Phiên đã được thu hồi trước đó'));
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 4: No predictable hard-coded HMAC fallback (fail-closed)
  // ---------------------------------------------------------------------------
  describe('SessionService Secret Enforcement (BR-SESS-09 / Finding 4)', () => {
    it('fails closed when AUDIT_IDENTIFIER_HMAC_KEY is absent', async () => {
      const savedKey = process.env.AUDIT_IDENTIFIER_HMAC_KEY;
      delete process.env.AUDIT_IDENTIFIER_HMAC_KEY;

      const mockPrisma: any = {
        deviceSession: {
          findUnique: async () => ({
            id: 'sess-1',
            user_id: 'user-1',
            merchant_id: 'merchant-1',
            status: SessionStatusEnum.ACTIVE,
            device_id: 'dev-1',
          }),
        },
        $transaction: async (callback: any) => {
          const tx: any = {
            deviceSession: {
              updateMany: async () => ({ count: 1 }),
              findUnique: async () => ({ id: 'sess-1', status: SessionStatusEnum.REVOKED }),
            },
            auditLog: {
              create: async () => ({ id: 'audit-1' }),
            },
          };
          return callback(tx);
        },
      };

      const service = new SessionService(mockPrisma);

      try {
        await assert.rejects(
          async () => {
            await service.revoke(
              'sess-1',
              'user-1',
              'merchant-1',
              'corr-1',
              'Revoke',
              '198.51.100.1'
            );
          },
          (err: any) => {
            assert.match(
              err.message,
              /AUDIT_IDENTIFIER_HMAC_KEY is required for IP pseudonymization/
            );
            return true;
          }
        );
      } finally {
        process.env.AUDIT_IDENTIFIER_HMAC_KEY = savedKey;
      }
    });

    it('fails closed when AUDIT_IDENTIFIER_HMAC_KEY is empty or whitespace', async () => {
      const savedKey = process.env.AUDIT_IDENTIFIER_HMAC_KEY;
      process.env.AUDIT_IDENTIFIER_HMAC_KEY = '   ';

      const mockPrisma: any = {
        deviceSession: {
          findUnique: async () => ({
            id: 'sess-1',
            user_id: 'user-1',
            merchant_id: 'merchant-1',
            status: SessionStatusEnum.ACTIVE,
            device_id: 'dev-1',
          }),
        },
        $transaction: async (callback: any) => {
          const tx: any = {
            deviceSession: {
              updateMany: async () => ({ count: 1 }),
            },
            auditLog: {
              create: async () => ({ id: 'audit-1' }),
            },
          };
          return callback(tx);
        },
      };

      const service = new SessionService(mockPrisma);

      try {
        await assert.rejects(
          async () => {
            await service.revoke(
              'sess-1',
              'user-1',
              'merchant-1',
              'corr-1',
              'Revoke',
              '198.51.100.1'
            );
          },
          (err: any) => {
            assert.match(
              err.message,
              /AUDIT_IDENTIFIER_HMAC_KEY is required for IP pseudonymization/
            );
            return true;
          }
        );
      } finally {
        process.env.AUDIT_IDENTIFIER_HMAC_KEY = savedKey;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 6: Keyed pseudonymization verification (AC-SESS-21 / Finding 6)
  // ---------------------------------------------------------------------------
  describe('Audit IP Keyed Pseudonymization (AC-SESS-21 / Finding 6)', () => {
    it('verifies that IP pseudonymization strictly uses keyed HMAC-SHA256', async () => {
      const key1 = 'test-audit-hmac-key-placeholder-32-chars';
      const key2 = 'different-audit-hmac-key-32-chars-xyz';
      const rawIp = '203.0.113.195';

      process.env.AUDIT_IDENTIFIER_HMAC_KEY = key1;

      let loggedIp1: string | null = null;
      let loggedIp2: string | null = null;

      const createMockService = (capture: (ip: string) => void) => {
        const mockPrisma: any = {
          deviceSession: {
            findUnique: async () => ({
              id: 'sess-k',
              user_id: 'user-k',
              merchant_id: 'merchant-k',
              status: SessionStatusEnum.ACTIVE,
              device_id: 'dev-k',
            }),
          },
          $transaction: async (callback: any) => {
            const tx: any = {
              deviceSession: {
                updateMany: async () => ({ count: 1 }),
              },
              auditLog: {
                create: async (args: any) => {
                  capture(args.data.ip_address);
                  return { id: 'audit-k' };
                },
              },
            };
            return callback(tx);
          },
        };
        return new SessionService(mockPrisma);
      };

      const service1 = createMockService((ip) => {
        loggedIp1 = ip;
      });
      await service1.revoke('sess-k', 'user-k', 'merchant-k', 'c-1', 'Revoke', rawIp);

      process.env.AUDIT_IDENTIFIER_HMAC_KEY = key2;
      const service2 = createMockService((ip) => {
        loggedIp2 = ip;
      });
      await service2.revoke('sess-k', 'user-k', 'merchant-k', 'c-2', 'Revoke', rawIp);

      const expectedHmac1 = createHmac('sha256', key1).update(rawIp).digest('hex');
      const expectedHmac2 = createHmac('sha256', key2).update(rawIp).digest('hex');
      const plainSha256 = createHash('sha256').update(rawIp).digest('hex');

      assert.strictEqual(loggedIp1, expectedHmac1, 'Must strictly match HMAC with key 1');
      assert.strictEqual(loggedIp2, expectedHmac2, 'Must strictly match HMAC with key 2');
      assert.notStrictEqual(loggedIp1, loggedIp2, 'Different keys must yield different pseudonyms');
      assert.notStrictEqual(loggedIp1, plainSha256, 'Must not be plain unkeyed SHA-256');
      assert.notStrictEqual(loggedIp1, rawIp, 'Must not be raw IP');
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 1: AC-SESS-01 Session creation with SHA-256 hash and 90-day expiry
  // ---------------------------------------------------------------------------
  describe('SessionService Creation (AC-SESS-01 / Finding 1)', () => {
    it('creates active session with SHA-256 token hash, 90-day expiry, and last_active_at', async () => {
      process.env.AUDIT_IDENTIFIER_HMAC_KEY = 'test-audit-hmac-key-placeholder-32-chars';
      const rawToken = 'test-raw-bearer-token-random-value-xyz';
      const expectedHash = createHash('sha256').update(rawToken).digest('hex');
      let createdPayload: any = null;

      const mockPrisma: any = {
        deviceSession: {
          create: async ({ data }: any) => {
            createdPayload = data;
            return { ...data, id: data.id || 'created-session-uuid-1' };
          },
        },
      };

      const service = new SessionService(mockPrisma);
      const created = await service.create({
        userId: 'user-uuid-1',
        merchantId: 'merchant-uuid-1',
        token: rawToken,
        deviceId: 'web-desktop-chrome',
        deviceModel: 'Chrome 128',
      });

      assert.strictEqual(created.id, 'created-session-uuid-1');
      assert.strictEqual(createdPayload.user_id, 'user-uuid-1');
      assert.strictEqual(createdPayload.merchant_id, 'merchant-uuid-1');
      assert.strictEqual(createdPayload.session_token_hash, expectedHash);
      assert.strictEqual(createdPayload.status, SessionStatusEnum.ACTIVE);
      assert.ok(createdPayload.last_active_at instanceof Date);
      assert.ok(createdPayload.expires_at instanceof Date);

      const now = Date.now();
      const diffDays = (createdPayload.expires_at.getTime() - now) / (1000 * 60 * 60 * 24);
      assert.ok(diffDays >= 89 && diffDays <= 91, 'Expiry must be approximately 90 days');
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 3: BR-SESS-01 / BR-SESS-05 Heartbeat Scoped Persistence & Expiry
  // ---------------------------------------------------------------------------
  describe('SessionService Heartbeat Scoped Persistence (BR-SESS-01 / BR-SESS-05 / Finding 3)', () => {
    it('scopes heartbeat update to user_id, merchant_id, and ACTIVE status, and rejects concurrent revoke', async () => {
      let updateWhere: any = null;
      let updateData: any = null;

      const mockPrisma: any = {
        deviceSession: {
          findUnique: async () => ({
            id: 'sess-active-1',
            user_id: 'user-1',
            merchant_id: 'merchant-1',
            status: SessionStatusEnum.ACTIVE,
            last_active_at: new Date(),
            expires_at: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000),
          }),
          updateMany: async ({ where, data }: any) => {
            updateWhere = where;
            updateData = data;
            return { count: 1 };
          },
        },
      };

      const service = new SessionService(mockPrisma);
      const res = await service.heartbeat('sess-active-1', 'user-1', 'merchant-1', 'sess-active-1');
      assert.strictEqual(res.session_id, 'sess-active-1');
      assert.strictEqual(updateWhere.id, 'sess-active-1');
      assert.strictEqual(updateWhere.user_id, 'user-1');
      assert.strictEqual(updateWhere.merchant_id, 'merchant-1');
      assert.strictEqual(updateWhere.status, SessionStatusEnum.ACTIVE);
      assert.ok(updateData.last_active_at instanceof Date);
    });

    it('rejects concurrent revoke when updateMany count is 0', async () => {
      const mockPrisma: any = {
        deviceSession: {
          findUnique: async () => ({
            id: 'sess-concurrent-1',
            user_id: 'user-1',
            merchant_id: 'merchant-1',
            status: SessionStatusEnum.ACTIVE,
            last_active_at: new Date(),
            expires_at: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000),
          }),
          updateMany: async () => ({ count: 0 }), // Concurrently revoked
        },
      };

      const service = new SessionService(mockPrisma);
      await assert.rejects(
        async () => {
          await service.heartbeat('sess-concurrent-1', 'user-1', 'merchant-1', 'sess-concurrent-1');
        },
        (err: any) => {
          assert.strictEqual(err.getResponse()?.error?.code, 'SESSION_NOT_ACTIVE');
          return true;
        }
      );
    });

    it('stores expired row as EXPIRED in DB before throwing SESSION_NOT_ACTIVE (BR-SESS-03)', async () => {
      let expiredStatusSet = false;
      const mockPrisma: any = {
        deviceSession: {
          findUnique: async () => ({
            id: 'sess-expired-1',
            user_id: 'user-1',
            merchant_id: 'merchant-1',
            status: SessionStatusEnum.ACTIVE,
            last_active_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // > 30 days
            expires_at: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000),
          }),
          updateMany: async ({ data }: any) => {
            if (data.status === SessionStatusEnum.EXPIRED) {
              expiredStatusSet = true;
            }
            return { count: 1 };
          },
        },
      };

      const service = new SessionService(mockPrisma);
      await assert.rejects(
        async () => {
          await service.heartbeat('sess-expired-1', 'user-1', 'merchant-1', 'sess-expired-1');
        },
        (err: any) => {
          assert.strictEqual(err.getResponse()?.error?.code, 'SESSION_NOT_ACTIVE');
          return true;
        }
      );
      assert.strictEqual(
        expiredStatusSet,
        true,
        'Expired session must be updated to EXPIRED status in DB'
      );
    });
  });
});
