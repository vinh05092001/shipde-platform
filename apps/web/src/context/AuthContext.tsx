'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Merchant, Role } from '@/types/domain';

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

interface AuthContextType {
  user: User | null;
  merchant: Merchant | null;
  isAuthenticated: boolean;
  token: string | null;
  login: (emailOrPhone: string, pass: string) => Promise<{ success: boolean; error?: string }>;
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

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Initialize with persisted or default authenticated state
  useEffect(() => {
    const savedUser = localStorage.getItem('shipde_user');
    const savedMerchant = localStorage.getItem('shipde_merchant');
    const savedToken = localStorage.getItem('shipde_token');

    if (savedUser && savedMerchant && savedToken) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Legacy prototype localStorage hydration pattern
        setUser(JSON.parse(savedUser));
        setMerchant(JSON.parse(savedMerchant));
        setToken(savedToken);
        return;
      } catch (e) {
        // Fallback
      }
    }

    // Default mock initial session for instant usability
    const defaultMerchant: Merchant = {
      id: 'merc_prod_01',
      name: 'Thời Trang An An Boutique',
      business_code: '0318928192',
      phone: '0901234567',
      email: 'contact@ananboutique.vn',
      address: '128 Nguyễn Trãi, Phường 3, Quận 5, TP. Hồ Chí Minh',
      subscription_plan: 'BUSINESS_CONTROL',
      status: 'ACTIVE',
      created_at: new Date('2026-01-01'),
    };

    const defaultUser: User = {
      id: 'usr_01',
      merchant_id: 'merc_prod_01',
      full_name: 'Nguyễn Văn An',
      email: 'owner@ananboutique.vn',
      phone: '0901234567',
      role: Role.OWNER,
      status: 'ACTIVE',
      created_at: new Date('2026-01-01'),
    };

    const defaultToken = 'jwt_shipde_session_token_prod_9981';

    setUser(defaultUser);
    setMerchant(defaultMerchant);
    setToken(defaultToken);

    localStorage.setItem('shipde_user', JSON.stringify(defaultUser));
    localStorage.setItem('shipde_merchant', JSON.stringify(defaultMerchant));
    localStorage.setItem('shipde_token', defaultToken);
  }, []);

  const login = async (emailOrPhone: string, pass: string) => {
    if (!emailOrPhone || !pass) {
      return { success: false, error: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu' };
    }

    // Map role based on email hint or default
    let role: Role = Role.OWNER;
    let name = 'Nguyễn Văn An (Chủ Shop)';
    if (emailOrPhone.includes('cskh')) {
      role = Role.OPS_CSKH;
      name = 'Trần Thị Hoa (CSKH)';
    } else if (emailOrPhone.includes('ketoan') || emailOrPhone.includes('acc')) {
      role = Role.ACCOUNTANT;
      name = 'Lê Minh Kế Toán';
    } else if (emailOrPhone.includes('kho')) {
      role = Role.WAREHOUSE;
      name = 'Phạm Văn Kho (Thủ Kho)';
    }

    const authMerchant: Merchant = {
      id: 'merc_prod_01',
      name: 'Thời Trang An An Boutique',
      business_code: '0318928192',
      phone: '0901234567',
      email: 'contact@ananboutique.vn',
      address: '128 Nguyễn Trãi, Phường 3, Quận 5, TP. Hồ Chí Minh',
      subscription_plan: 'BUSINESS_CONTROL',
      status: 'ACTIVE',
      created_at: new Date('2026-01-01'),
    };

    const authUser: User = {
      id: `usr_${Date.now()}`,
      merchant_id: 'merc_prod_01',
      full_name: name,
      email: emailOrPhone.includes('@') ? emailOrPhone : `${emailOrPhone}@shipde.net`,
      phone: emailOrPhone.startsWith('0') ? emailOrPhone : '0901234567',
      role,
      status: 'ACTIVE',
      created_at: new Date(),
    };

    const authToken = `jwt_token_${Date.now()}`;

    setUser(authUser);
    setMerchant(authMerchant);
    setToken(authToken);

    localStorage.setItem('shipde_user', JSON.stringify(authUser));
    localStorage.setItem('shipde_merchant', JSON.stringify(authMerchant));
    localStorage.setItem('shipde_token', authToken);

    return { success: true };
  };

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
        token,
        login,
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
