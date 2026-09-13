import { DomainError, DomainErrorDetail } from './errors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Vietnamese mobile numbers, accepted as 0xxxxxxxxx or +84xxxxxxxxx.
const PHONE_RE = /^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Collects field errors so a request reports every problem at once. */
export class Validator {
  private readonly errors: DomainErrorDetail[] = [];
  constructor(private readonly body: Record<string, unknown>) {}

  private fail(field: string, message: string): void {
    this.errors.push({ field, message });
  }

  private raw(field: string): unknown {
    return this.body ? this.body[field] : undefined;
  }

  string(field: string, opts: { min?: number; max?: number; required?: boolean } = {}): string {
    const { min = 0, max = 512, required = true } = opts;
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) this.fail(field, 'Bắt buộc');
      return '';
    }
    if (typeof value !== 'string') {
      this.fail(field, 'Phải là chuỗi');
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length < min) this.fail(field, `Tối thiểu ${min} ký tự`);
    if (trimmed.length > max) this.fail(field, `Tối đa ${max} ký tự`);
    return trimmed;
  }

  email(field = 'email', required = true): string {
    const value = this.string(field, { required, max: 255 });
    if (value && !EMAIL_RE.test(value)) this.fail(field, 'Email không hợp lệ');
    return value.toLowerCase();
  }

  phone(field = 'phone', required = true): string {
    const value = this.string(field, { required, max: 32 });
    if (!value) return value;
    const compact = value.replace(/[\s.-]/g, '');
    if (!PHONE_RE.test(compact)) this.fail(field, 'Số điện thoại Việt Nam không hợp lệ');
    return compact.startsWith('+84') ? `0${compact.slice(3)}` : compact;
  }

  uuid(field: string, required = true): string {
    const value = this.string(field, { required, max: 36 });
    if (value && !UUID_RE.test(value)) this.fail(field, 'Định danh không hợp lệ');
    return value;
  }

  enum<T extends string>(field: string, allowed: readonly T[], required = true): T {
    const value = this.string(field, { required, max: 64 });
    if (value && !allowed.includes(value as T)) {
      this.fail(field, `Chỉ nhận: ${allowed.join(', ')}`);
    }
    return value as T;
  }

  bool(field: string, fallback = false): boolean {
    const value = this.raw(field);
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    this.fail(field, 'Phải là true hoặc false');
    return fallback;
  }

  stringArray(field: string, max = 64): string[] {
    const value = this.raw(field);
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.fail(field, 'Phải là danh sách');
      return [];
    }
    if (value.length > max) this.fail(field, `Tối đa ${max} phần tử`);
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') {
        this.fail(field, 'Mọi phần tử phải là chuỗi');
        return [];
      }
      out.push(item.trim());
    }
    return out;
  }

  /**
   * Rejected outright rather than silently truncated: a password the caller
   * believes was accepted but was cut short is worse than a clear refusal.
   */
  password(field = 'password'): string {
    const value = this.string(field, { required: true, max: 200 });
    if (!value) return value;
    if (value.length < 10) this.fail(field, 'Mật khẩu tối thiểu 10 ký tự');
    if (!/[a-z]/.test(value)) this.fail(field, 'Cần ít nhất một chữ thường');
    if (!/[A-Z]/.test(value)) this.fail(field, 'Cần ít nhất một chữ hoa');
    if (!/\d/.test(value)) this.fail(field, 'Cần ít nhất một chữ số');
    return value;
  }

  throwIfInvalid(): void {
    if (this.errors.length > 0) {
      throw DomainError.validation('Dữ liệu gửi lên không hợp lệ', this.errors);
    }
  }
}

export function validate(body: unknown): Validator {
  return new Validator((body ?? {}) as Record<string, unknown>);
}
