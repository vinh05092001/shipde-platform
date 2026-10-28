'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Merchant, Role } from '@/types/domain';

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** 403 status gate returned by the login APIs, rendered as a full state on SCR-AUTH-01 (FEAT-AUTH-03 CD-6). */
export interface AuthStatusBlock {
  code: string;
  message: string;
  nextAction?: string;
}

interface AuthContextType {
  user: User | null;
  merchant: Merchant | null;
  isAuthenticated: boolean;
  /** True only during the single localStorage restore tick. Screens return null while this is set. */
  isHydrating: boolean;
  token: string | null;
  login: (
    emailOrPhone: string,
    pass: string,
    rememberDevice?: boolean
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    retryAfterSeconds?: number;
    statusBlock?: AuthStatusBlock;
    mfaRequired?: boolean;
    challengeId?: string;
    expiresIn?: number;
    mfaEnrollmentRequired?: boolean;
    setupToken?: string;
  }>;
  requestLoginOtp: (identifier: string) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    retryAfterSeconds?: number;
    maskedIdentifier?: string;
    channel?: string;
    expiresIn?: number;
    cooldownSeconds?: number;
  }>;
  verifyLoginOtp: (
    identifier: string,
    otp: string,
    rememberDevice?: boolean
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    retryAfterSeconds?: number;
    maskedIdentifier?: string;
    statusBlock?: AuthStatusBlock;
    mfaRequired?: boolean;
    challengeId?: string;
    expiresIn?: number;
    mfaEnrollmentRequired?: boolean;
    setupToken?: string;
  }>;
  register: (payload: {
    merchantName: string;
    fullName: string;
    email?: string;
    phone?: string;
    password: string;
    termsAccepted: boolean;
    termsVersion?: string;
  }) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    fields?: FieldError[];
    nextAction?: string;
    data?: any;
  }>;
  verifyEmail: (token: string) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    data?: any;
    nextAction?: string;
  }>;
  verifyPhone: (
    phone: string,
    otp: string
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    data?: any;
    nextAction?: string;
  }>;
  resendVerification: (
    identifier: string,
    channel: 'email' | 'phone'
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    cooldownSeconds?: number;
    nextAction?: string;
  }>;
  forgotPassword: (identifier: string) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    data?: { status: string; channel: string };
    cooldownSeconds?: number;
    nextAction?: string;
  }>;
  verifyResetToken: (token: string) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    data?: { valid: boolean; identifier: string; channel: string };
    nextAction?: string;
  }>;
  resetPassword: (dto: { token: string; password: string; password_confirm: string }) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    data?: { message: string };
    nextAction?: string;
    fields?: FieldError[];
  }>;
  verifyMfaChallenge: (
    challengeId: string,
    code: string
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    retryAfterSeconds?: number;
  }>;
  verifyMfaRecovery: (
    challengeId: string,
    recoveryCode: string
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    retryAfterSeconds?: number;
    recoveryCodesRemaining?: number;
  }>;
  getMfaStatus: () => Promise<{
    success: boolean;
    data?: {
      status: 'NOT_ENROLLED' | 'PENDING' | 'ACTIVE' | 'RESET';
      required: boolean;
      recovery_codes_remaining: number;
      mfa_verified_at: string | null;
    };
    error?: string;
  }>;
  startMfaSetup: (password: string) => Promise<{
    success: boolean;
    data?: {
      secret_key: string;
      provisioning_uri: string;
      expires_at: string;
      expires_in_seconds: number;
    };
    error?: string;
    code?: string;
  }>;
  verifyMfaSetup: (code: string) => Promise<{
    success: boolean;
    data?: {
      status: string;
      recovery_codes: string[];
    };
    error?: string;
    code?: string;
  }>;
  regenerateMfaRecoveryCodes: (
    password: string,
    code: string
  ) => Promise<{
    success: boolean;
    data?: {
      recovery_codes: string[];
    };
    error?: string;
    code?: string;
    retryAfterSeconds?: number;
  }>;
  logout: () => void;
  switchRole: (role: Role) => void;
  getProfile: () => Promise<{ success: boolean; data?: any; error?: string }>;
  updateProfile: (payload: any) => Promise<{
    success: boolean;
    data?: any;
    error?: string;
    code?: string;
  }>;
  updatePreferences: (payload: any) => Promise<{
    success: boolean;
    data?: any;
    error?: string;
    code?: string;
  }>;
}

/** 403 status codes that must surface as dedicated login states (FEAT-AUTH-03 CD-6). */
const STATUS_GATE_CODES = [
  'AUTH_PENDING_VERIFICATION',
  'AUTH_ACCOUNT_SUSPENDED',
  'AUTH_ACCOUNT_DISABLED',
  'AUTH_INVITATION_PENDING',
];

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function mapUser(raw: any): User {
  if (!raw) return raw;
  return { ...raw, created_at: parseDate(raw.created_at ?? raw.createdAt) };
}

function mapMerchant(raw: any): Merchant {
  if (!raw) return raw;
  return { ...raw, created_at: parseDate(raw.created_at ?? raw.createdAt) };
}

interface ExtractedError {
  code?: string;
  message?: string;
  nextAction?: string;
  retryAfter?: number;
}

function extractError(body: any): ExtractedError {
  return {
    code: body?.error?.code,
    message: body?.error?.message,
    nextAction: body?.error?.next_action,
    retryAfter: body?.error?.retry_after ?? body?.error?.cooldown_seconds,
  };
}

// A stored (setup or access) token whose exp claim is in the past must never be replayed.
function isStoredTokenExpired(jwt: string): boolean {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' && json.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  // Restore a persisted session when present. No fabricated default session:
  // FEAT-AUTH-03 (CD-10) removes the prototype's mock auto-login.
  // isHydrating starts true and resolves false in finally, so a signed-out
  // visitor never sits on a loading skeleton (BRAIN.md rule 4).
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const savedUser = localStorage.getItem('shipde_user');
        const savedMerchant = localStorage.getItem('shipde_merchant');
        const savedToken = localStorage.getItem('shipde_token');

        if (savedToken && isStoredTokenExpired(savedToken)) {
          localStorage.removeItem('shipde_user');
          localStorage.removeItem('shipde_merchant');
          localStorage.removeItem('shipde_token');
        } else if (savedUser && savedMerchant && savedToken) {
          setUser(mapUser(JSON.parse(savedUser)));
          setMerchant(mapMerchant(JSON.parse(savedMerchant)));
          setToken(savedToken);
        }
      } catch {
        localStorage.removeItem('shipde_user');
        localStorage.removeItem('shipde_merchant');
        localStorage.removeItem('shipde_token');
      } finally {
        setIsHydrating(false);
      }
    });
  }, []);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  const applySession = (data: any) => {
    const nextUser = mapUser(data?.user);
    const nextMerchant = mapMerchant(data?.merchant);
    const accessToken = String(data?.access_token ?? '');

    setUser(nextUser);
    setMerchant(nextMerchant);
    setToken(accessToken);

    localStorage.setItem('shipde_user', JSON.stringify(nextUser));
    localStorage.setItem('shipde_merchant', JSON.stringify(nextMerchant));
    localStorage.setItem('shipde_token', accessToken);
  };

  const login = async (emailOrPhone: string, pass: string, rememberDevice = true) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: emailOrPhone,
          password: pass,
          remember_device: rememberDevice,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = extractError(body);
        if (err.code === 'MFA_ENROLLMENT_REQUIRED') {
          const setupTok = (body?.error?.setup_token || body?.error?.access_token || '') as string;
          if (setupTok) {
            setToken(setupTok);
            localStorage.setItem('shipde_token', setupTok);
          }
          return {
            success: false,
            code: 'MFA_ENROLLMENT_REQUIRED',
            error: err.message || 'Tài khoản yêu cầu thiết lập xác thực hai yếu tố (MFA).',
            mfaEnrollmentRequired: true,
            setupToken: setupTok,
            expiresIn: body?.error?.expires_in,
          };
        }
        if (STATUS_GATE_CODES.includes(err.code ?? '')) {
          return {
            success: false,
            error: err.message || 'Tài khoản của bạn hiện không thể đăng nhập.',
            code: err.code,
            statusBlock: {
              code: err.code ?? '',
              message: err.message ?? '',
              nextAction: err.nextAction,
            },
          };
        }
        return {
          success: false,
          error: err.message || 'Đăng nhập không thành công.',
          code: err.code || 'VALIDATION_ERROR',
          retryAfterSeconds: err.retryAfter,
        };
      }

      if (body?.data?.status === 'MFA_REQUIRED') {
        return {
          success: false,
          mfaRequired: true,
          challengeId: body.data.challenge_id,
          expiresIn: body.data.expires_in,
        };
      }

      applySession(body.data);
      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const requestLoginOtp = async (identifier: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = extractError(body);
        return {
          success: false,
          error: err.message || 'Không gửi được mã OTP.',
          code: err.code || 'VALIDATION_ERROR',
          retryAfterSeconds: err.retryAfter,
        };
      }

      return {
        success: true,
        maskedIdentifier: body.data?.recipient_masked,
        channel: body.data?.channel,
        expiresIn: body.data?.expires_in_seconds,
        cooldownSeconds: body.data?.cooldown_seconds,
      };
    } catch {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const verifyLoginOtp = async (identifier: string, otp: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, otp }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = extractError(body);
        if (err.code === 'MFA_ENROLLMENT_REQUIRED') {
          const setupTok = (body?.error?.setup_token || body?.error?.access_token || '') as string;
          if (setupTok) {
            setToken(setupTok);
            localStorage.setItem('shipde_token', setupTok);
          }
          return {
            success: false,
            code: 'MFA_ENROLLMENT_REQUIRED',
            error: err.message || 'Tài khoản yêu cầu thiết lập xác thực hai yếu tố (MFA).',
            mfaEnrollmentRequired: true,
            setupToken: setupTok,
            expiresIn: body?.error?.expires_in,
          };
        }
        if (STATUS_GATE_CODES.includes(err.code ?? '')) {
          return {
            success: false,
            error: err.message || 'Tài khoản của bạn hiện không thể đăng nhập.',
            code: err.code,
            statusBlock: {
              code: err.code ?? '',
              message: err.message ?? '',
              nextAction: err.nextAction,
            },
          };
        }
        return {
          success: false,
          error: err.message || 'Mã OTP không chính xác hoặc đã hết hạn.',
          code: err.code || 'INVALID_OTP',
          retryAfterSeconds: err.retryAfter,
        };
      }

      if (body?.data?.status === 'MFA_REQUIRED') {
        return {
          success: false,
          mfaRequired: true,
          challengeId: body.data.challenge_id,
          expiresIn: body.data.expires_in,
        };
      }

      applySession(body.data);
      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const register = async (payload: {
    merchantName: string;
    fullName: string;
    email?: string;
    phone?: string;
    password: string;
    termsAccepted: boolean;
    termsVersion?: string;
  }) => {
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_name: payload.merchantName,
          full_name: payload.fullName,
          email: payload.email || undefined,
          phone: payload.phone || undefined,
          password: payload.password,
          terms_accepted: payload.termsAccepted,
          terms_version: payload.termsVersion || '2026.1',
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          success: false,
          error: body?.error?.message || 'Đăng ký không thành công. Vui lòng thử lại.',
          code: body?.error?.code || 'VALIDATION_ERROR',
          fields: body?.error?.fields || [],
          nextAction: body?.error?.next_action,
        };
      }

      return {
        success: true,
        data: body.data,
      };
    } catch (err: any) {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const verifyEmail = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: body?.error?.message || 'Xác thực email thất bại',
          code: body?.error?.code || 'VALIDATION_ERROR',
          nextAction: body?.error?.next_action,
        };
      }

      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Lỗi kết nối máy chủ', code: 'NETWORK_ERROR' };
    }
  };

  const verifyPhone = async (phone: string, otp: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/verify-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: body?.error?.message || 'Xác thực số điện thoại thất bại',
          code: body?.error?.code || 'VALIDATION_ERROR',
          nextAction: body?.error?.next_action,
        };
      }

      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Lỗi kết nối máy chủ', code: 'NETWORK_ERROR' };
    }
  };

  const forgotPassword = async (identifier: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: body?.error?.message || 'Gửi liên kết đặt lại mật khẩu thất bại',
          code: body?.error?.code || 'VALIDATION_ERROR',
          cooldownSeconds: body?.error?.cooldown_seconds,
          nextAction: body?.error?.next_action,
        };
      }

      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Lỗi kết nối máy chủ', code: 'NETWORK_ERROR' };
    }
  };

  const verifyResetToken = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/verify-reset-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: body?.error?.message || 'Liên kết đặt lại mật khẩu không hợp lệ',
          code: body?.error?.code || 'INVALID_TOKEN',
          nextAction: body?.error?.next_action,
        };
      }

      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Lỗi kết nối máy chủ', code: 'NETWORK_ERROR' };
    }
  };

  const resetPassword = async (dto: {
    token: string;
    password: string;
    password_confirm: string;
  }) => {
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dto),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: body?.error?.message || 'Đặt lại mật khẩu thất bại',
          code: body?.error?.code || 'VALIDATION_ERROR',
          nextAction: body?.error?.next_action,
          fields: body?.error?.fields,
        };
      }

      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Lỗi kết nối máy chủ', code: 'NETWORK_ERROR' };
    }
  };

  const resendVerification = async (identifier: string, channel: 'email' | 'phone') => {
    try {
      const res = await fetch(`${API_BASE}/auth/verify/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, channel }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: body?.error?.message || 'Gửi lại mã xác thực thất bại',
          code: body?.error?.code || 'VALIDATION_ERROR',
          nextAction: body?.error?.next_action,
        };
      }

      return {
        success: true,
        data: body.data,
        cooldownSeconds: body.data?.cooldown_seconds || 60,
      };
    } catch {
      return { success: false, error: 'Lỗi kết nối máy chủ', code: 'NETWORK_ERROR' };
    }
  };

  const verifyMfaChallenge = async (challengeId: string, code: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/mfa/challenge/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = extractError(body);
        return {
          success: false,
          error: err.message || 'Mã xác thực không chính xác.',
          code: err.code,
          retryAfterSeconds: err.retryAfter,
        };
      }
      applySession(body.data);
      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const verifyMfaRecovery = async (challengeId: string, recoveryCode: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/mfa/recovery/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: challengeId, recovery_code: recoveryCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = extractError(body);
        return {
          success: false,
          error: err.message || 'Mã dự phòng không chính xác hoặc đã được sử dụng.',
          code: err.code,
          retryAfterSeconds: err.retryAfter,
        };
      }
      applySession(body.data);
      return {
        success: true,
        recoveryCodesRemaining: body.data.recovery_codes_remaining,
      };
    } catch {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const getMfaStatus = async () => {
    try {
      const currentToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null);
      const res = await fetch(`${API_BASE}/auth/mfa/status`, {
        headers: {
          Authorization: `Bearer ${currentToken}`,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body?.error?.code === 'UNAUTHENTICATED') {
        // Expired/invalid (e.g. setup-only) token: drop it so the user is sent back to login.
        logout();
      }
      if (!res.ok) {
        return { success: false, error: body?.error?.message || 'Không thể lấy thông tin MFA' };
      }
      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Không thể kết nối đến máy chủ' };
    }
  };

  const startMfaSetup = async (password: string) => {
    try {
      const currentToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null);
      const res = await fetch(`${API_BASE}/auth/mfa/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body?.error?.code === 'UNAUTHENTICATED') {
        // Expired/invalid (e.g. setup-only) token: drop it so the user is sent back to login.
        logout();
      }
      if (!res.ok) {
        const err = extractError(body);
        return { success: false, error: err.message, code: err.code };
      }
      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Không thể kết nối đến máy chủ' };
    }
  };

  const verifyMfaSetup = async (code: string) => {
    try {
      const currentToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null);
      const res = await fetch(`${API_BASE}/auth/mfa/setup/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body?.error?.code === 'UNAUTHENTICATED') {
        // Expired/invalid (e.g. setup-only) token: drop it so the user is sent back to login.
        logout();
      }
      if (!res.ok) {
        const err = extractError(body);
        return { success: false, error: err.message, code: err.code };
      }
      applySession(body.data);
      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Không thể kết nối đến máy chủ' };
    }
  };

  const regenerateMfaRecoveryCodes = async (password: string, code: string) => {
    try {
      const currentToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null);
      const res = await fetch(`${API_BASE}/auth/mfa/recovery-codes/regenerate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ password, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body?.error?.code === 'UNAUTHENTICATED') {
        // Expired/invalid (e.g. setup-only) token: drop it so the user is sent back to login.
        logout();
      }
      if (!res.ok) {
        const err = extractError(body);
        return {
          success: false,
          error: err.message,
          code: err.code,
          retryAfterSeconds: err.retryAfter,
        };
      }
      return { success: true, data: body.data };
    } catch {
      return { success: false, error: 'Không thể kết nối đến máy chủ' };
    }
  };
  const logout = () => {
    setUser(null);
    setMerchant(null);
    setToken(null);
    localStorage.removeItem('shipde_user');
    localStorage.removeItem('shipde_merchant');
    localStorage.removeItem('shipde_token');
  };

  const switchRole = (newRole: Role) => {
    if (!user) return;
    let newName = user.full_name;
    if (newRole === Role.OWNER) newName = 'Nguyễn Văn An (Chủ Shop)';
    if (newRole === Role.OPS_CSKH) newName = 'Trần Thị Hoa (CSKH)';
    if (newRole === Role.ACCOUNTANT) newName = 'Lê Minh (Kế Toán)';
    if (newRole === Role.WAREHOUSE) newName = 'Phạm Văn Kho (Thủ Kho)';

    const updated = { ...user, role: newRole, full_name: newName };
    setUser(updated);
    localStorage.setItem('shipde_user', JSON.stringify(updated));
  };

  const getProfile = async () => {
    try {
      const res = await fetch('/api/v1/me', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data?.error?.message || 'Không thể tải thông tin hồ sơ' };
      }
      return { success: true, data: data.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'Lỗi mạng khi tải hồ sơ' };
    }
  };

  const updateProfile = async (payload: any) => {
    try {
      const res = await fetch('/api/v1/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data?.error?.message || 'Không thể cập nhật hồ sơ',
          code: data?.error?.code,
        };
      }
      if (data.data) {
        const updated = mapUser({ ...user, ...data.data });
        setUser(updated);
        localStorage.setItem('shipde_user', JSON.stringify(updated));
      }
      return { success: true, data: data.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'Lỗi kết nối máy chủ' };
    }
  };

  const updatePreferences = async (payload: any) => {
    try {
      const res = await fetch('/api/v1/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data?.error?.message || 'Không thể cập nhật tùy chọn',
          code: data?.error?.code,
        };
      }
      if (data.data && user) {
        const updated = mapUser({ ...user, ...data.data });
        setUser(updated);
        localStorage.setItem('shipde_user', JSON.stringify(updated));
      }
      return { success: true, data: data.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'Lỗi kết nối máy chủ' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        merchant,
        isAuthenticated: !!user && !!token,
        isHydrating,
        token,
        login,
        requestLoginOtp,
        verifyLoginOtp,
        register,
        verifyEmail,
        verifyPhone,
        resendVerification,
        forgotPassword,
        verifyResetToken,
        resetPassword,
        logout,
        switchRole,
        verifyMfaChallenge,
        verifyMfaRecovery,
        getMfaStatus,
        startMfaSetup,
        verifyMfaSetup,
        regenerateMfaRecoveryCodes,
        getProfile,
        updateProfile,
        updatePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
