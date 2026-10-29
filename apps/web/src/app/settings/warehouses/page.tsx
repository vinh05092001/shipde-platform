'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Store,
  GitBranch,
  Users,
  Shield,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { WarehouseManagementView } from '@/components/WarehouseManagementView';
import { useAuth } from '@/context/AuthContext';
import type { Warehouse, CreateWarehouseInput, UpdateWarehouseInput } from '@shipde/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface WarehousesSettingsPageProps {
  initialWarehouses?: Warehouse[] | null;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialError?: string | null;
  initialScopedWarehouses?: string[] | null;
}

export default function WarehousesSettingsPage({
  initialWarehouses = null,
  initialLoading = false,
  initialCanEdit,
  initialError = null,
  initialScopedWarehouses = null,
}: WarehousesSettingsPageProps) {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;

  // Mutation access strictly requires the iam:shop_config permission, never defaults to true
  const derivedCanEdit =
    initialCanEdit !== undefined
      ? initialCanEdit
      : Boolean(
          user &&
          Array.isArray((user as any).permissions) &&
          (user as any).permissions.includes('iam:shop_config')
        );

  const derivedScopedWarehouses =
    initialScopedWarehouses !== null ? initialScopedWarehouses : user?.warehouse_scopes || null;

  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses || []);
  const [loading, setLoading] = useState<boolean>(
    initialWarehouses ? false : (initialLoading ?? true)
  );
  const [error, setError] = useState<string | null>(initialError);

  const fetchWarehouses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/v1/warehouses`, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Bạn không có quyền truy cập danh sách kho hàng.');
        }
        if (res.status === 401) {
          throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải danh sách kho hàng');
      }

      const json = await res.json();
      if (json.success && json.data) {
        setWarehouses(json.data);
      }
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi kết nối với máy chủ quản lý kho hàng');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!initialWarehouses) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial warehouses fetch
      void fetchWarehouses();
    }
  }, [initialWarehouses, fetchWarehouses]);

  // Create Warehouse Handler
  const handleCreate = async (input: CreateWarehouseInput) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/warehouses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể tạo mới kho hàng');
    }

    await fetchWarehouses();
  };

  // Update Warehouse Handler
  const handleUpdate = async (id: string, input: UpdateWarehouseInput) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/warehouses/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể cập nhật kho hàng');
    }

    await fetchWarehouses();
  };

  // Set Default Warehouse Handler
  const handleSetDefault = async (id: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/warehouses/${id}/default`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể đặt kho mặc định');
    }

    await fetchWarehouses();
  };

  // Deactivate Warehouse Handler
  const handleDeactivate = async (id: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/warehouses/${id}`, {
      method: 'DELETE',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể tạm ngưng kho hàng');
    }

    await fetchWarehouses();
  };

  // Activate Warehouse Handler
  const handleActivate = async (id: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/warehouses/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'active' }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể kích hoạt lại kho hàng');
    }

    await fetchWarehouses();
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Navigation Breadcrumb and Sub-nav */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay lại Bảng Điều Khiển</span>
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-bold text-slate-700">
              Chi nhánh &amp; Kho hàng (SCR-WH-01 / FEAT-WH-01)
            </span>
          </div>

          {/* Quick Settings Switcher Tabs */}
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/settings/shop"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 transition font-medium"
            >
              <Store className="w-3.5 h-3.5 text-slate-500" />
              <span>Hồ sơ Shop</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 font-bold">
              <WarehouseIcon className="w-3.5 h-3.5 text-orange-600" />
              <span>Kho hàng</span>
            </span>
            <Link
              href="/settings/users"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 transition font-medium"
            >
              <Users className="w-3.5 h-3.5 text-slate-500" />
              <span>Nhân sự</span>
            </Link>
            <Link
              href="/settings/roles"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 transition font-medium"
            >
              <Shield className="w-3.5 h-3.5 text-slate-500" />
              <span>Phân quyền</span>
            </Link>
          </div>
        </div>

        {/* Main Warehouse Management View */}
        <WarehouseManagementView
          warehouses={warehouses}
          loading={loading}
          canEdit={derivedCanEdit}
          scopedWarehouses={derivedScopedWarehouses}
          error={error}
          onRefresh={fetchWarehouses}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onSetDefault={handleSetDefault}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
        />
      </div>
    </div>
  );
}
