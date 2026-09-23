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
  logout: () => void;
  switchRole: (role: Role) => void;
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
    retryAfter: body?.error?.retry_after,
  };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // isHydrating is true until the localStorage restore effect completes.
  // Callers use this to avoid showing a loading skeleton when the user is
  // simply not signed in — the skeleton must resolve to the login screen
  // after hydration, never stay stuck (BRAIN.md rule 4).
  const [isHydrating, setIsHydrating] = useState(true);

  // Restore a persisted session when present. No fabricated default session:
  // FEAT-AUTH-03 (CD-10) removes the prototype's mock auto-login.
  useEffect(() => {
    const savedUser = localStorage.getItem('shipde_user');
    const savedMerchant = localStorage.getItem('shipde_merchant');
    const savedToken = localStorage.getItem('shipde_token');

    if (!savedUser || !savedMerchant || !savedToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration gate only
      setIsHydrating(false);
      return;
    }

    try {
      setUser(mapUser(JSON.parse(savedUser)));
      setMerchant(mapMerchant(JSON.parse(savedMerchant)));
      setToken(savedToken);
    } catch {
      localStorage.removeItem('shipde_user');
      localStorage.removeItem('shipde_merchant');
      localStorage.removeItem('shipde_token');
    } finally {
      setIsHydrating(false);
    }
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
          error: err.message || 'Xác thực mã OTP thất bại.',
          code: err.code || 'VALIDATION_ERROR',
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
        logout,
        switchRole,
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
