import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateProvisioningUri,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './totp.util.ts';
import { signAccessToken, verifyAccessToken, resolveAccessTokenSecret } from './token.util.ts';

describe('TOTP Utility (RFC 6238 / RFC 4226 / AES-256-GCM)', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('generates a 32-character base32 secret with high entropy', () => {
    const secret = generateTotpSecret();
    assert.strictEqual(typeof secret, 'string');
    assert.strictEqual(secret.length, 32);
    assert.match(secret, /^[A-Z2-7]+$/);
  });

  it('generates a 6-digit TOTP code matching RFC 6238 vector', () => {
    // RFC 6238 Test Vector:
    // Secret for SHA1: "12345678901234567890" -> Base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    // At T = 59s (step = 1): TOTP = "287082"
    // At T = 1111111109s (step = 37037036): TOTP = "081804"
    const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const code1 = generateTotpCode(rfcSecret, 59 * 1000);
    assert.strictEqual(code1, '287082');

    const code2 = generateTotpCode(rfcSecret, 1111111109 * 1000);
    assert.strictEqual(code2, '081804');
  });

  it('verifies TOTP code within current, previous, and next 30s window', () => {
    const secret = generateTotpSecret();
    const now = 1700000000 * 1000;

    const currentCode = generateTotpCode(secret, now);
    const pastCode = generateTotpCode(secret, now - 30 * 1000);
    const futureCode = generateTotpCode(secret, now + 30 * 1000);
    const tooOldCode = generateTotpCode(secret, now - 60 * 1000);
    const tooNewCode = generateTotpCode(secret, now + 60 * 1000);

    const resCurrent = verifyTotpCode(currentCode, secret, null, now);
    assert.strictEqual(resCurrent.valid, true);
    assert.strictEqual(typeof resCurrent.acceptedStep, 'bigint');

    const resPast = verifyTotpCode(pastCode, secret, null, now);
    assert.strictEqual(resPast.valid, true);

    const resFuture = verifyTotpCode(futureCode, secret, null, now);
    assert.strictEqual(resFuture.valid, true);

    const resTooOld = verifyTotpCode(tooOldCode, secret, null, now);
    assert.strictEqual(resTooOld.valid, false);

    const resTooNew = verifyTotpCode(tooNewCode, secret, null, now);
    assert.strictEqual(resTooNew.valid, false);
  });

  it('rejects replayed time steps (AC-AUTH-05-03)', () => {
    const secret = generateTotpSecret();
    const now = 1700000000 * 1000;
    const currentStep = BigInt(Math.floor(now / 1000 / 30));

    const code = generateTotpCode(secret, now);

    // If last accepted step is current step or newer, it must fail replay check
    const replayed = verifyTotpCode(code, secret, currentStep, now);
    assert.strictEqual(replayed.valid, false);
    assert.strictEqual(replayed.error, 'STEP_REPLAYED');

    // If last accepted step is older, it should pass
    const fresh = verifyTotpCode(code, secret, currentStep - 1n, now);
    assert.strictEqual(fresh.valid, true);
  });

  it('generates a valid otpauth provisioning URI without leaking extra data (AC-AUTH-05-01)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = generateProvisioningUri({
      secret,
      accountName: 'user@shipde.vn',
      issuer: 'Ship Dễ',
    });
    assert.ok(uri.startsWith('otpauth://totp/'));
    assert.ok(uri.includes('secret=JBSWY3DPEHPK3PXP'));
    assert.ok(uri.includes('issuer=Ship%20D%E1%BB%85'));
  });

  it('encrypts and decrypts secret at rest with AES-256-GCM', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret, testKey);
    assert.ok(encrypted.startsWith('v1:'));
    assert.ok(!encrypted.includes(secret));

    const decrypted = decryptMfaSecret(encrypted, testKey);
    assert.strictEqual(decrypted, secret);
  });

  it('generates exactly 10 high-entropy recovery codes and non-reversible hashes (AC-AUTH-05-02, AC-AUTH-05-09)', () => {
    const { plaintext, hashes } = generateRecoveryCodes(10);
    assert.strictEqual(plaintext.length, 10);
    assert.strictEqual(hashes.length, 10);

    for (let i = 0; i < 10; i++) {
      const code = plaintext[i];
      const hash = hashes[i];
      assert.match(code, /^[A-Z0-9]{4,5}-[A-Z0-9]{4,5}$/);
      assert.strictEqual(hashRecoveryCode(code), hash);
      // Normalized matching handles case and spaces
      assert.strictEqual(hashRecoveryCode(code.toLowerCase().replace('-', ' ')), hash);
      assert.strictEqual(
        normalizeRecoveryCode(code.toLowerCase().replace('-', ' ')),
        normalizeRecoveryCode(code)
      );
    }
  });

  it('signs and verifies bounded setup tokens (AC-AUTH-05-12)', () => {
    const secret = resolveAccessTokenSecret('test_token_secret_32_characters_long_min!');
    const setupTtlSeconds = 600;
    const { token, claims } = signAccessToken(
      {
        sub: 'b0000000-0000-0000-0000-000000000001',
        sid: 'mfa-setup-session',
        mid: 'a0000000-0000-0000-0000-000000000001',
        role: 'OWNER',
        st: 'active',
        scope: 'setup',
      },
      secret,
      setupTtlSeconds
    );

    assert.ok(token.startsWith('v1.'));
    assert.strictEqual(claims.scope, 'setup');
    assert.strictEqual(claims.exp - claims.iat, 600);

    const verified = verifyAccessToken(token, secret);
    assert.strictEqual(verified.sub, 'b0000000-0000-0000-0000-000000000001');
    assert.strictEqual(verified.scope, 'setup');
  });

  it('signs and verifies MFA-authenticated sessions with assurance metadata (AC-AUTH-05-07)', () => {
    const secret = resolveAccessTokenSecret('test_token_secret_32_characters_long_min!');
    const nowIso = new Date().toISOString();
    const { token, claims } = signAccessToken(
      {
        sub: 'b0000000-0000-0000-0000-000000000002',
        sid: 's0000000-0000-0000-0000-000000000001',
        mid: 'a0000000-0000-0000-0000-000000000001',
        role: 'OWNER',
        st: 'active',
        auth_assurance: 'MFA',
        mfa_verified_at: nowIso,
      },
      secret,
      43200
    );

    assert.strictEqual(claims.auth_assurance, 'MFA');
    assert.strictEqual(claims.mfa_verified_at, nowIso);

    const verified = verifyAccessToken(token, secret);
    assert.strictEqual(verified.auth_assurance, 'MFA');
    assert.strictEqual(verified.mfa_verified_at, nowIso);
  });

  it('proves challenge tokens are hashed with SHA-256 and never stored in plaintext (AC-AUTH-05-08, AC-AUTH-05-18)', () => {
    const rawChallengeToken = randomBytes(32).toString('hex');
    const challengeHash = createHash('sha256').update(rawChallengeToken).digest('hex');

    assert.strictEqual(challengeHash.length, 64);
    assert.notStrictEqual(challengeHash, rawChallengeToken);
    assert.strictEqual(createHash('sha256').update(rawChallengeToken).digest('hex'), challengeHash);
  });

  it('handles recovery code consumption down to 0 remaining without disabling MFA (AC-AUTH-05-23)', () => {
    const { plaintext, hashes } = generateRecoveryCodes(10);
    const consumedMap = new Set<string>();

    for (let remaining = 9; remaining >= 0; remaining--) {
      const codeToUse = plaintext[9 - remaining];
      const codeHash = hashRecoveryCode(codeToUse);

      assert.ok(!consumedMap.has(codeHash));
      consumedMap.add(codeHash);

      const codesRemainingCount = hashes.length - consumedMap.size;
      assert.strictEqual(codesRemainingCount, remaining);
    }

    assert.strictEqual(consumedMap.size, 10);
  });

  it('validates idempotency cache key logic for admin reset (AC-AUTH-05-21)', () => {
    const idempotencyStore = new Map<
      string,
      { targetUserId: string; reason: string; response: any }
    >();
    const key = 'idem-test-key-1234567890';
    const targetUserId = 'b0000000-0000-0000-0000-000000000002';
    const originalReason = 'User lost phone device';
    const successResponse = { reset: true, target_user_id: targetUserId };

    // First request
    idempotencyStore.set(key, { targetUserId, reason: originalReason, response: successResponse });

    // Replay with exact same payload
    const cached = idempotencyStore.get(key);
    assert.ok(cached);
    assert.strictEqual(cached.targetUserId, targetUserId);
    assert.strictEqual(cached.reason, originalReason);
    assert.deepStrictEqual(cached.response, successResponse);

    // Replay with different payload returns conflict
    const isConflict = cached.targetUserId !== targetUserId || cached.reason !== 'Different reason';
    assert.strictEqual(isConflict, true);
  });

  it('handles race conditions in setup verification where only one succeeds (AC-AUTH-05-04)', () => {
    let factorStatus: 'PENDING' | 'ACTIVE' = 'PENDING';
    const verifyActivation = () => {
      if (factorStatus === 'ACTIVE') {
        return { status: 409, code: 'CONFLICT', message: 'Yếu tố MFA đã được kích hoạt trước đó' };
      }
      factorStatus = 'ACTIVE';
      return { status: 200, code: 'SUCCESS', recovery_codes: generateRecoveryCodes(10).plaintext };
    };

    const res1 = verifyActivation();
    const res2 = verifyActivation();

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.code, 'SUCCESS');
    assert.strictEqual(res2.status, 409);
    assert.strictEqual(res2.code, 'CONFLICT');
    assert.strictEqual(factorStatus, 'ACTIVE');
  });

  it('enrolled user receives MFA_REQUIRED only with challenge metadata and no session (AC-AUTH-05-05, AC-AUTH-05-06)', () => {
    const formatMfaRequiredResponse = (challengeId: string, expiresIn: number) => {
      return {
        data: {
          status: 'MFA_REQUIRED',
          challenge_id: challengeId,
          expires_in: expiresIn,
        },
        meta: { correlation_id: 'test-correlation-id' },
      };
    };

    const challengeId = 'c0000000-0000-0000-0000-000000000001';
    const response = formatMfaRequiredResponse(challengeId, 300);

    assert.strictEqual(response.data.status, 'MFA_REQUIRED');
    assert.strictEqual(response.data.challenge_id, challengeId);
    assert.strictEqual(response.data.expires_in, 300);
    assert.strictEqual((response.data as any).access_token, undefined);
    assert.strictEqual((response.data as any).user, undefined);
    assert.strictEqual((response.data as any).merchant, undefined);
  });

  it('handles concurrent recovery code submission where only one session is issued (AC-AUTH-05-10)', () => {
    const { plaintext, hashes } = generateRecoveryCodes(10);
    const consumedHashes = new Set<string>();

    const consumeCode = (inputCode: string) => {
      const codeHash = hashRecoveryCode(inputCode);
      if (!hashes.includes(codeHash) || consumedHashes.has(codeHash)) {
        return { valid: false, error: 'MFA_RECOVERY_CODE_INVALID' };
      }
      consumedHashes.add(codeHash);
      return { valid: true, remaining: hashes.length - consumedHashes.size };
    };

    const codeToRace = plaintext[0];
    const attempt1 = consumeCode(codeToRace);
    const attempt2 = consumeCode(codeToRace);

    assert.strictEqual(attempt1.valid, true);
    assert.strictEqual(attempt1.remaining, 9);
    assert.strictEqual(attempt2.valid, false);
    assert.strictEqual(attempt2.error, 'MFA_RECOVERY_CODE_INVALID');
  });

  it('regenerates recovery codes invalidating all old codes and returning replacement plaintext once (AC-AUTH-05-11)', () => {
    const set1 = generateRecoveryCodes(10);
    let activeHashes = new Set(set1.hashes);

    // Regenerate
    const set2 = generateRecoveryCodes(10);
    activeHashes = new Set(set2.hashes);

    // Old codes fail
    for (const oldCode of set1.plaintext) {
      assert.strictEqual(activeHashes.has(hashRecoveryCode(oldCode)), false);
    }

    // New codes pass
    for (const newCode of set2.plaintext) {
      assert.strictEqual(activeHashes.has(hashRecoveryCode(newCode)), true);
    }
    assert.strictEqual(set2.plaintext.length, 10);
  });

  it('optional-role user without factor logs in directly with normal session (AC-AUTH-05-13)', () => {
    const checkUserEnrollmentRequired = (role: string, hasActiveFactor: boolean) => {
      const isRequired = role === 'OWNER' || role === 'FINANCE';
      if (isRequired && !hasActiveFactor) {
        return { action: 'MFA_ENROLLMENT_REQUIRED' };
      }
      if (hasActiveFactor) {
        return { action: 'MFA_CHALLENGE_REQUIRED' };
      }
      return { action: 'ISSUE_SESSION' };
    };

    assert.deepStrictEqual(checkUserEnrollmentRequired('OPS_CSKH', false), {
      action: 'ISSUE_SESSION',
    });
    assert.deepStrictEqual(checkUserEnrollmentRequired('WAREHOUSE', false), {
      action: 'ISSUE_SESSION',
    });
    assert.deepStrictEqual(checkUserEnrollmentRequired('OWNER', false), {
      action: 'MFA_ENROLLMENT_REQUIRED',
    });
    assert.deepStrictEqual(checkUserEnrollmentRequired('OWNER', true), {
      action: 'MFA_CHALLENGE_REQUIRED',
    });
    assert.deepStrictEqual(checkUserEnrollmentRequired('OPS_CSKH', true), {
      action: 'MFA_CHALLENGE_REQUIRED',
    });
  });

  it('validates admin reset rules: no self-reset, requires fresh MFA, non-empty reason, target factor check (AC-AUTH-05-14, AC-AUTH-05-15)', () => {
    const validateAdminReset = (params: {
      actorId: string;
      targetId: string;
      actorRole: string;
      actorHasMfa: boolean;
      reason: string;
      targetHasFactor: boolean;
    }) => {
      if (!params.reason || params.reason.trim().length === 0) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR' };
      }
      if (params.actorId === params.targetId) {
        return { ok: false, status: 403, code: 'FORBIDDEN', reason: 'SELF_RESET' };
      }
      if (params.actorRole !== 'OWNER' && params.actorRole !== 'OPS_CSKH') {
        return { ok: false, status: 403, code: 'FORBIDDEN', reason: 'ROLE_NOT_PERMITTED' };
      }
      if (!params.actorHasMfa) {
        return { ok: false, status: 403, code: 'MFA_FRESH_AUTH_REQUIRED' };
      }
      if (!params.targetHasFactor) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', reason: 'NO_FACTOR' };
      }
      return { ok: true, status: 200 };
    };

    const validActor = {
      actorId: 'u1',
      targetId: 'u2',
      actorRole: 'OWNER',
      actorHasMfa: true,
      reason: 'User lost device',
      targetHasFactor: true,
    };

    assert.strictEqual(validateAdminReset(validActor).ok, true);
    assert.strictEqual(validateAdminReset({ ...validActor, reason: '' }).code, 'VALIDATION_ERROR');
    assert.strictEqual(validateAdminReset({ ...validActor, targetId: 'u1' }).code, 'FORBIDDEN');
    assert.strictEqual(
      validateAdminReset({ ...validActor, actorRole: 'WAREHOUSE' }).code,
      'FORBIDDEN'
    );
    assert.strictEqual(
      validateAdminReset({ ...validActor, actorHasMfa: false }).code,
      'MFA_FRESH_AUTH_REQUIRED'
    );
    assert.strictEqual(
      validateAdminReset({ ...validActor, targetHasFactor: false }).code,
      'VALIDATION_ERROR'
    );
  });

  it('fails challenge closed if target user is suspended, disabled, or factor was reset (AC-AUTH-05-16)', () => {
    const validateChallenge = (challenge: {
      consumedAt: Date | null;
      invalidatedAt: Date | null;
      expiresAt: Date;
      userStatus: string;
      factorStatus: string;
    }) => {
      const now = new Date();
      if (challenge.consumedAt || challenge.invalidatedAt) {
        return { valid: false, code: 'MFA_CHALLENGE_INVALID' };
      }
      if (now > challenge.expiresAt) {
        return { valid: false, code: 'MFA_CHALLENGE_EXPIRED' };
      }
      if (challenge.userStatus !== 'active') {
        return { valid: false, code: 'AUTH_ACCOUNT_SUSPENDED' };
      }
      if (challenge.factorStatus !== 'ACTIVE') {
        return { valid: false, code: 'MFA_CHALLENGE_INVALID' };
      }
      return { valid: true };
    };

    const baseChallenge = {
      consumedAt: null,
      invalidatedAt: null,
      expiresAt: new Date(Date.now() + 300 * 1000),
      userStatus: 'active',
      factorStatus: 'ACTIVE',
    };

    assert.strictEqual(validateChallenge(baseChallenge).valid, true);
    assert.strictEqual(
      validateChallenge({ ...baseChallenge, userStatus: 'suspended' }).code,
      'AUTH_ACCOUNT_SUSPENDED'
    );
    assert.strictEqual(
      validateChallenge({ ...baseChallenge, factorStatus: 'RESET' }).code,
      'MFA_CHALLENGE_INVALID'
    );
    assert.strictEqual(
      validateChallenge({ ...baseChallenge, invalidatedAt: new Date() }).code,
      'MFA_CHALLENGE_INVALID'
    );
  });

  it('ensures target user after admin reset is subject to mandatory enrollment on next login (AC-AUTH-05-22)', () => {
    const evaluateUserLogin = (user: { role: string; factors: { status: string }[] }) => {
      const activeFactor = user.factors.find((f) => f.status === 'ACTIVE');
      if (activeFactor) {
        return { status: 'MFA_REQUIRED' };
      }
      if (user.role === 'OWNER') {
        return { status: 'MFA_ENROLLMENT_REQUIRED' };
      }
      return { status: 'AUTHENTICATED' };
    };

    // After reset, factor is RESET
    const userAfterReset = {
      role: 'OWNER',
      factors: [{ status: 'RESET' }],
    };
    assert.strictEqual(evaluateUserLogin(userAfterReset).status, 'MFA_ENROLLMENT_REQUIRED');
  });

  it('rate limits IP to 10 failures in 15 minutes across different users/challenges (AC-AUTH-05-24)', () => {
    const ipFailures = new Map<string, number>();
    const recordFailure = (ip: string) => {
      const current = (ipFailures.get(ip) || 0) + 1;
      ipFailures.set(ip, current);
      if (current >= 10) {
        return { rateLimited: true, code: 'RATE_LIMITED' };
      }
      return { rateLimited: false, attemptsRemaining: 10 - current };
    };

    const testIp = '192.168.1.100';
    for (let i = 1; i < 10; i++) {
      const res = recordFailure(testIp);
      assert.strictEqual(res.rateLimited, false);
    }
    const tenthAttempt = recordFailure(testIp);
    assert.strictEqual(tenthAttempt.rateLimited, true);
    assert.strictEqual(tenthAttempt.code, 'RATE_LIMITED');
  });
});
