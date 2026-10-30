'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Store, GitBranch, Users, Shield } from 'lucide-react';
import { BranchManagementView } from '@/components/BranchManagementView';
import { useAuth } from '@/context/AuthContext';
import type { Branch, CreateBranchInput, UpdateBranchInput } from '@shipde/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface BranchesSettingsPageProps {
  initialBranches?: Branch[] | null;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialError?: string | null;
  initialScopedStores?: string[] | null;
}

export default function BranchesSettingsPage({
  initialBranches = null,
  initialLoading,
  initialCanEdit,
  initialError = null,
  initialScopedStores = null,
}: BranchesSettingsPageProps) {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;

  // Edit rights are server-authoritative: the branches list endpoint returns
  // `can_edit`, derived from the actor's `iam:shop_config` permission. We never
  // infer capability from hardcoded role names, and we fail closed (false) until
  // the server resolves the actor's permissions.
  const derivedScopedStores =
    initialScopedStores !== null ? initialScopedStores : user?.store_scopes || null;

  const [branches, setBranches] = useState<Branch[]>(initialBranches || []);
  const [canEdit, setCanEdit] = useState<boolean>(initialCanEdit ?? false);
  const [loading, setLoading] = useState<boolean>(initialLoading ?? initialBranches === null);
  const [error, setError] = useState<string | null>(initialError);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/v1/branches`, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Bạn không có quyền truy cập danh sách chi nhánh.');
        }
        if (res.status === 401) {
          throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải danh sách chi nhánh');
      }

      const json = await res.json();
      if (json.success && json.data?.branches) {
        setBranches(json.data.branches);
        setCanEdit(Boolean(json.data.can_edit));
      }
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi kết nối với máy chủ quản lý chi nhánh');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!initialBranches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial branches fetch
      void fetchBranches();
    }
  }, [initialBranches, fetchBranches]);

  // Create Branch Handler
  const handleCreate = async (input: CreateBranchInput) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/branches`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể tạo mới chi nhánh');
    }

    // Refresh list to preserve single default ordering and tenant consistency
    await fetchBranches();
  };

  // Update Branch Handler
  const handleUpdate = async (id: string, input: UpdateBranchInput) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/branches/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể cập nhật chi nhánh');
    }

    await fetchBranches();
  };

  // Activate Branch Handler
  const handleActivate = async (id: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/branches/${id}/activate`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể kích hoạt chi nhánh');
    }

    await fetchBranches();
  };

  // Deactivate Branch Handler
  const handleDeactivate = async (id: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/branches/${id}/deactivate`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể tạm ngưng chi nhánh');
    }

    await fetchBranches();
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
              Chi nhánh &amp; Điểm gửi hàng (SCR-WH-01 / FEAT-ORG-02)
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
              <GitBranch className="w-3.5 h-3.5 text-orange-600" />
              <span>Chi nhánh</span>
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

        {/* Main Branches Management View */}
        <BranchManagementView
          branches={branches}
          loading={loading}
          canEdit={canEdit}
          scopedStores={derivedScopedStores}
          error={error}
          onRefresh={fetchBranches}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
        />
      </div>
    </div>
  );
}
