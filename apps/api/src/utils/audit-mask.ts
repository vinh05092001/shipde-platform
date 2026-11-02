import { maskIdentifier } from '../invitations/invitations.service';

/** Mask sensitive fields recursively before passing audit metadata to persistence. */
export function maskSensitiveAuditValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const key = field.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    /(password|secret|token|credential|authorization|apikey|bankaccount|accountnumber|iban)/.test(
      key
    )
  ) {
    return '[REDACTED]';
  }
  if (/(phone|email)/.test(key)) {
    if (Array.isArray(value)) return value.map((item) => maskSensitiveAuditValue(field, item));
    return typeof value === 'string' ? maskIdentifier(value) : '[REDACTED]';
  }
  if (Array.isArray(value)) return value.map((item) => maskSensitiveAuditValue(field, item));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskSensitiveAuditValue(key, item)])
    );
  }
  return value;
}
