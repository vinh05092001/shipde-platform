'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Store,
  GitBranch,
  Warehouse as WarehouseIcon,
  Users,
  Shield,
} from 'lucide-react';
import { BranchManagementView } from '@/components/BranchManagementView';
import { useAuth } from '@/context/AuthContext';
import { useServerList } from '@/hooks/useServerList';
import { BRANCHES_LIST_POLICY } from '@/lib/list-contract';
import type { Branch, CreateBranchInput, UpdateBranchInput } from '@shipde/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface BranchesSettingsPageProps {
  initialBranches?: Branch[] | null;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialForbidden?: boolean;
  initialError?: string | null;
  initialScopedStores?: string[] | null;
}

export default function BranchesSettingsPage({
  initialBranches = null,
  initialLoading,
  initialCanEdit,
  initialForbidden = false,
  initialError = null,
  initialScopedStores = null,
}: BranchesSettingsPageProps) {
  const { user, token, isHydrating } = useAuth();

  // Edit rights are server-authoritative: the branches list endpoint returns
  // `can_edit`, derived from the actor's `iam:shop_config` permission. We never
  // infer capability from hardcoded role names, and we fail closed (false) until
  // the server resolves the actor's permissions.
  const derivedScopedStores =
    initialScopedStores !== null ? initialScopedStores : user?.store_scopes || null;

  const list = useServerList<Branch>({
    baseUrl: API_BASE,
    resource: 'branches',
    policy: BRANCHES_LIST_POLICY,
    token,
    tenantId: user?.merchant_id,
    userId: user?.id,
    isHydrating,
    initialRows: initialBranches ?? undefined,
    initialLoading,
    initialError,
    initialCanEdit,
    initialForbidden,
  });
  const { rows: branches, loading, error, refresh: fetchBranches } = list;

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
            <span className="sr-only">Cửa hàng &amp; Chi nhánh</span>
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
              href="/settings/warehouses"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 transition font-medium"
            >
              <WarehouseIcon className="w-3.5 h-3.5 text-slate-500" />
              <span>Kho hàng</span>
            </Link>
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
          canEdit={initialCanEdit ?? list.canEdit}
          isForbidden={list.forbidden}
          scopedStores={derivedScopedStores}
          error={error}
          onRefresh={() => fetchBranches()}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
          serverTotal={list.meta.total}
          serverTotalPages={list.meta.total_pages}
          onQueryChange={list.onQueryChange}
          tenantId={user?.merchant_id}
          userId={user?.id}
        />
      </div>
    </div>
  );
}
