import { createHmac, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

/**
 * FEAT-AUTH-03 access-token utilities.
 *
 * Stateless `v1.<payload>.<signature>` format:
 * - payload:   base64url JSON claims (JWT-compatible subset: sub, sid, mid, role, st, iat, exp, jti)
 * - signature: base64url HMAC-SHA256(payload) keyed by the configured token secret
 *
 * No new runtime dependencies; `node:crypto` only. Refresh/revocation is owned by FEAT-AUTH-06.
 */

const TOKEN_VERSION = 'v1';
const HMAC_ALGORITHM = 'sha256';

export interface AccessTokenClaims {
  /** User id */
  sub: string;
  /** Device session id (device_sessions.id) */
  sid: string;
  /** Merchant id */
  mid: string;
  /** Canonical role (OWNER | OPS_CSKH | WAREHOUSE | ACCOUNTANT) */
  role: string;
  /** User status at issuance */
  st: string;
  /** Issued at (epoch seconds) */
  iat: number;
  /** Expiry (epoch seconds) */
  exp: number;
  /** Unique token id */
  jti: string;
}

export type AccessTokenIssuanceInput = Omit<AccessTokenClaims, 'iat' | 'exp' | 'jti'>;

export class TokenVerificationError extends Error {
  constructor(
    public readonly reason:
      'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'UNSUPPORTED_VERSION' | 'INCOMPLETE_CLAIMS'
  ) {
    super(`Access token verification failed: ${reason}`);
    this.name = 'TokenVerificationError';
  }
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecodeToObject(input: string): Record<string, unknown> {
  const json = Buffer.from(input, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Resolves the signing secret. Production requires an explicit secret via config
 * validation (fail-closed, >= 32 chars); dev/test fall back to an ephemeral
 * process-lifetime secret so local runs never sign with a hard-coded value.
 */
let ephemeralSecret: string | undefined;
export function resolveAccessTokenSecret(configuredSecret?: string): string {
  if (configuredSecret && configuredSecret.trim().length > 0) {
    return configuredSecret.trim();
  }
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString('hex');
  }
  return ephemeralSecret;
}

export function signAccessToken(
  input: AccessTokenIssuanceInput,
  secret: string,
  ttlSeconds: number
): { token: string; claims: AccessTokenClaims } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = {
    ...input,
    iat: issuedAt,
    exp: issuedAt + Math.floor(ttlSeconds),
    jti: randomUUID(),
  };

  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = base64UrlEncode(
    createHmac(HMAC_ALGORITHM, secret).update(`${TOKEN_VERSION}.${payload}`).digest()
  );

  return { token: `${TOKEN_VERSION}.${payload}.${signature}`, claims };
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenVerificationError('MALFORMED');
  }
  const [version, payload, signature] = parts;
  if (version !== TOKEN_VERSION) {
    throw new TokenVerificationError('UNSUPPORTED_VERSION');
  }

  const expectedSignature = createHmac(HMAC_ALGORITHM, secret)
    .update(`${version}.${payload}`)
    .digest();
  const providedSignature = Buffer.from(signature, 'base64url');
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new TokenVerificationError('BAD_SIGNATURE');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = base64UrlDecodeToObject(payload);
  } catch {
    throw new TokenVerificationError('MALFORMED');
  }

  const { sub, sid, mid, role, st, iat, exp, jti } = parsed as Partial<AccessTokenClaims>;
  if (
    !sub ||
    !sid ||
    !mid ||
    !role ||
    !st ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    !jti
  ) {
    throw new TokenVerificationError('INCOMPLETE_CLAIMS');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (exp <= nowSeconds) {
    throw new TokenVerificationError('EXPIRED');
  }

  return { sub, sid, mid, role, st, iat, exp, jti };
}
