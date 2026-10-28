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
  // Finding 3 / AC-SESS-20: Post-commit audit emission & explicit rollback logging
  // ---------------------------------------------------------------------------
  describe('Transactional Audit Logging & Explicit Rollback (BR-SESS-07 / AC-SESS-20)', () => {
    it('emits AUDIT: SESSION_REVOKED to stdout only after transaction commit', async () => {
      process.env.AUDIT_IDENTIFIER_HMAC_KEY = 'test-audit-hmac-key-placeholder-32-chars';
      const stdoutEvents: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => {
        stdoutEvents.push(args.join(' '));
        origLog(...args);
      };

      try {
        let committed = false;
        const mockPrisma: any = {
          deviceSession: {
            findUnique: async () => ({
              id: 'sess-commit-1',
              user_id: 'user-1',
              merchant_id: 'merchant-1',
              status: SessionStatusEnum.ACTIVE,
              device_id: 'dev-1',
            }),
          },
          $transaction: async (cb: any) => {
            const tx: any = {
              deviceSession: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                  id: 'sess-commit-1',
                  status: SessionStatusEnum.REVOKED,
                }),
              },
              auditLog: {
                create: async () => {
                  // Inside transaction: stdout must NOT have emitted the success audit yet!
                  assert.strictEqual(
                    stdoutEvents.some((l) => l.includes('AUDIT: SESSION_REVOKED')),
                    false,
                    'stdout must NOT log AUDIT: SESSION_REVOKED before transaction commits'
                  );
                  return { id: 'audit-1' };
                },
              },
            };
            const res = await cb(tx);
            committed = true;
            return res;
          },
        };

        const service = new SessionService(mockPrisma);
        const res = await service.revoke('sess-commit-1', 'user-1', 'merchant-1', 'c-1');
        assert.strictEqual(res.status, SessionStatusEnum.REVOKED);
        assert.strictEqual(committed, true);
        assert.ok(
          stdoutEvents.some((l) => l.includes('AUDIT: SESSION_REVOKED')),
          'stdout must emit AUDIT: SESSION_REVOKED after transaction commits'
        );
      } finally {
        console.log = origLog;
      }
    });

    it('does not emit stdout success audit and logs AUDIT_ROLLBACK when audit creation fails', async () => {
      process.env.AUDIT_IDENTIFIER_HMAC_KEY = 'test-audit-hmac-key-placeholder-32-chars';
      const stdoutEvents: string[] = [];
      const stderrEvents: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args: any[]) => {
        stdoutEvents.push(args.join(' '));
        origLog(...args);
      };
      console.error = (...args: any[]) => {
        stderrEvents.push(args.join(' '));
        origErr(...args);
      };

      try {
        const mockPrisma: any = {
          deviceSession: {
            findUnique: async () => ({
              id: 'sess-fail-1',
              user_id: 'user-1',
              merchant_id: 'merchant-1',
              status: SessionStatusEnum.ACTIVE,
              device_id: 'dev-1',
            }),
          },
          $transaction: async (cb: any) => {
            const tx: any = {
              deviceSession: {
                updateMany: async () => ({ count: 1 }),
              },
              auditLog: {
                create: async () => {
                  throw new Error('Database disk full');
                },
              },
            };
            return cb(tx);
          },
        };

        const service = new SessionService(mockPrisma);
        await assert.rejects(
          async () => service.revoke('sess-fail-1', 'user-1', 'merchant-1', 'c-fail-1'),
          /Database disk full/
        );

        assert.strictEqual(
          stdoutEvents.some((l) => l.includes('AUDIT: SESSION_REVOKED')),
          false,
          'stdout must not record a successful audit when write fails'
        );
        assert.ok(
          stderrEvents.some((l) => l.includes('AUDIT_FAILED') || l.includes('AUDIT_ROLLBACK')),
          'stderr must explicitly log failure and rollback'
        );
      } finally {
        console.log = origLog;
        console.error = origErr;
      }
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

  describe('Finding 1: AUDIT_IDENTIFIER_HMAC_KEY validation and graceful session creation', () => {
    it('throws on application bootstrap in production if AUDIT_IDENTIFIER_HMAC_KEY is unset', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevKey = process.env.AUDIT_IDENTIFIER_HMAC_KEY;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.AUDIT_IDENTIFIER_HMAC_KEY;
        const service = new SessionService({} as any);
        assert.throws(
          () => service.onApplicationBootstrap(),
          /AUDIT_IDENTIFIER_HMAC_KEY is required in production/
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevKey !== undefined) process.env.AUDIT_IDENTIFIER_HMAC_KEY = prevKey;
      }
    });

    it('creates session gracefully with null ip_address when AUDIT_IDENTIFIER_HMAC_KEY is unset without 500', async () => {
      const prevKey = process.env.AUDIT_IDENTIFIER_HMAC_KEY;
      try {
        delete process.env.AUDIT_IDENTIFIER_HMAC_KEY;
        let createdData: any = null;
        const mockPrisma: any = {
          deviceSession: {
            create: async ({ data }: any) => {
              createdData = data;
              return { id: 'sess-new', ...data };
            },
          },
        };
        const service = new SessionService(mockPrisma);
        const result = await service.create({
          userId: 'user-1',
          merchantId: 'merch-1',
          token: 'test-raw-token',
          ipAddress: '192.168.1.100',
        });
        assert.ok(result);
        assert.strictEqual(createdData.ip_address, null, 'ip_address should be null when key is absent');
        assert.strictEqual(createdData.status, SessionStatusEnum.ACTIVE);
      } finally {
        if (prevKey !== undefined) process.env.AUDIT_IDENTIFIER_HMAC_KEY = prevKey;
      }
    });
  });

  describe('Finding 3: Single audit log emission on non-transactional revocation path', () => {
    it('emits structured audit log exactly once in revokeTargetUserSessions without transaction', async () => {
      const logs: string[] = [];
      const origConsoleLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(' '));
        origConsoleLog(...args);
      };

      try {
        const mockPrisma: any = {
          deviceSession: {
            findMany: async () => [
              { id: 'sess-target-1', status: SessionStatusEnum.ACTIVE },
            ],
            updateMany: async () => ({ count: 1 }),
          },
          auditLog: {
            create: async () => ({ id: 'audit-target-1' }),
          },
        };
        const service = new SessionService(mockPrisma);
        const count = await service.revokeTargetUserSessions(
          'user-target-1',
          'merchant-1',
          'actor-1',
          'Admin reset',
          'corr-single-emit'
        );

        assert.strictEqual(count, 1);
        const auditLogs = logs.filter((l) => l.includes('AUDIT: SESSIONS_REVOKED_ALL'));
        assert.strictEqual(
          auditLogs.length,
          1,
          'Audit log must be emitted exactly once on non-transactional path (no double emission)'
        );
      } finally {
        console.log = origConsoleLog;
      }
    });
  });

  describe('Finding 6: Persist EXPIRED status to DB at guard validation time (BR-SESS-03 / BR-SESS-04)', () => {
    it('persists EXPIRED status in DB when validateSession detects 30-day inactivity', async () => {
      let updatedStatus: SessionStatusEnum | null = null;
      const mockPrisma: any = {
        deviceSession: {
          findFirst: async () => ({
            id: 'sess-inactive-31d',
            user_id: 'user-1',
            merchant_id: 'merch-1',
            status: SessionStatusEnum.ACTIVE,
            last_active_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
            expires_at: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000),
          }),
          updateMany: async ({ data }: any) => {
            updatedStatus = data.status;
            return { count: 1 };
          },
        },
      };

      const service = new SessionService(mockPrisma);
      const res = await service.validateSession('token-hash-inactive');
      assert.strictEqual(res, null, 'validateSession must return null for inactive session');
      assert.strictEqual(
        updatedStatus,
        SessionStatusEnum.EXPIRED,
        'Database record must be transitioned to EXPIRED status at guard validation time'
      );
    });

    it('persists EXPIRED status in DB when validateSession detects 90-day absolute expiry', async () => {
      let updatedStatus: SessionStatusEnum | null = null;
      const mockPrisma: any = {
        deviceSession: {
          findFirst: async () => ({
            id: 'sess-lifetime-91d',
            user_id: 'user-1',
            merchant_id: 'merch-1',
            status: SessionStatusEnum.ACTIVE,
            last_active_at: new Date(),
            expires_at: new Date(Date.now() - 1000), // past expiry
          }),
          updateMany: async ({ data }: any) => {
            updatedStatus = data.status;
            return { count: 1 };
          },
        },
      };

      const service = new SessionService(mockPrisma);
      const res = await service.validateSession('token-hash-expired');
      assert.strictEqual(res, null, 'validateSession must return null for lifetime-expired session');
      assert.strictEqual(
        updatedStatus,
        SessionStatusEnum.EXPIRED,
        'Database record must be transitioned to EXPIRED status at guard validation time'
      );
    });
  });

  describe('Finding 8: Differentiate audit rollback from general mutation rollback', () => {
    it('logs SESSION_REVOCATION_ROLLBACK when error originates outside audit logging', async () => {
      const errorLogs: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => {
        errorLogs.push(args.join(' '));
        origConsoleError(...args);
      };

      try {
        const mockPrisma: any = {
          deviceSession: {
            findUnique: async () => ({
              id: 'sess-db-err',
              user_id: 'user-1',
              merchant_id: 'merch-1',
              status: SessionStatusEnum.ACTIVE,
            }),
          },
          $transaction: async () => {
            throw new Error('Connection pool exhausted');
          },
        };
        const service = new SessionService(mockPrisma);
        await assert.rejects(
          async () => service.revoke('sess-db-err', 'user-1', 'merch-1', 'c-err'),
          /Connection pool exhausted/
        );
        const rollbackLog = errorLogs.find((l) => l.includes('SESSION_REVOCATION_ROLLBACK'));
        assert.ok(rollbackLog, 'Error log must specify SESSION_REVOCATION_ROLLBACK rather than AUDIT_ROLLBACK');
      } finally {
        console.error = origConsoleError;
      }
    });
  });
});
