'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ShopProfileForm } from '@/components/ShopProfileForm';
import { useAuth } from '@/context/AuthContext';
import type { ShopProfile, UpdateShopProfileInput } from '@shipde/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ShopSettingsPageProps {
  initialProfile?: ShopProfile | null;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialError?: string | null;
}

export default function ShopSettingsPage({
  initialProfile = null,
  initialLoading = false,
  initialCanEdit,
  initialError = null,
}: ShopSettingsPageProps) {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;

  // By default, OWNER and OPS_CSKH can edit, WAREHOUSE/ORDER_OPERATOR cannot
  const derivedCanEdit =
    initialCanEdit !== undefined
      ? initialCanEdit
      : user
        ? user.role === 'OWNER' || user.role === 'OPS_CSKH'
        : true;

  const [profile, setProfile] = useState<ShopProfile | null>(initialProfile);
  const [loading, setLoading] = useState<boolean>(
    initialProfile ? false : (initialLoading ?? true)
  );
  const [error, setError] = useState<string | null>(initialError);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/v1/shops/profile`, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Bạn không có quyền truy cập cấu hình cửa hàng.');
        }
        if (res.status === 401) {
          throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải hồ sơ shop');
      }

      const json = await res.json();
      if (json.success && json.data) {
        setProfile(json.data);
      }
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tải thông tin cửa hàng');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!initialProfile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial shop profile fetch
      void fetchProfile();
    }
  }, [initialProfile, fetchProfile]);

  const handleSave = async (data: UpdateShopProfileInput) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/shops/profile`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể lưu hồ sơ shop');
    }

    const json = await res.json();
    if (json.success && json.data) {
      setProfile(json.data);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại Bảng Điều Khiển</span>
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-xs font-bold text-slate-700">Hồ sơ Cửa hàng (SCR-SHOP-01)</span>
        </div>

        {/* Main Form Component with full states */}
        <ShopProfileForm
          initialProfile={profile}
          initialLoading={loading}
          initialCanEdit={derivedCanEdit}
          initialError={error}
          onSave={handleSave}
          onRefresh={fetchProfile}
        />
      </div>
    </div>
  );
}
