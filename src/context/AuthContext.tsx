'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Merchant, Role } from '@/types/domain';

interface AuthContextType {
  user: User | null;
  merchant: Merchant | null;
  isAuthenticated: boolean;
  token: string | null;
  login: (emailOrPhone: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  register: (payload: { merchantName: string; fullName: string; email: string; phone: string; password: string }) => Promise<{ success: boolean; error?: string }>;
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
    let role = Role.OWNER;
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

  const register = async (payload: { merchantName: string; fullName: string; email: string; phone: string; password: string }) => {
    if (!payload.merchantName || !payload.fullName || !payload.email || !payload.password) {
      return { success: false, error: 'Vui lòng điền đầy đủ các trường thông tin bắt buộc' };
    }

    const newMerchant: Merchant = {
      id: `merc_${Date.now()}`,
      name: payload.merchantName,
      business_code: `03${Math.floor(Math.random() * 89999999) + 10000000}`,
      phone: payload.phone,
      email: payload.email,
      address: 'TP. Hồ Chí Minh, Việt Nam',
      subscription_plan: 'STARTER_TRIAL',
      status: 'ACTIVE',
      created_at: new Date(),
    };

    const newUser: User = {
      id: `usr_${Date.now()}`,
      merchant_id: newMerchant.id,
      full_name: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      role: Role.OWNER,
      status: 'ACTIVE',
      created_at: new Date(),
    };

    const authToken = `jwt_token_${Date.now()}`;

    setUser(newUser);
    setMerchant(newMerchant);
    setToken(authToken);

    localStorage.setItem('shipde_user', JSON.stringify(newUser));
    localStorage.setItem('shipde_merchant', JSON.stringify(newMerchant));
    localStorage.setItem('shipde_token', authToken);

    return { success: true };
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
