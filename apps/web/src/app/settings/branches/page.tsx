'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Store,
  GitBranch,
  Warehouse as WarehouseIcon,
  Users,
  Shield,
} from 'lucide-react';
import {
  BranchManagementView,
  BranchItem,
  DEFAULT_BRANCHES,
  BranchManagementViewProps,
} from '@/components/BranchManagementView';
import { useAuth } from '@/context/AuthContext';

export interface BranchesSettingsPageProps extends Partial<BranchManagementViewProps> {
  initialBranches?: BranchItem[] | null;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialForbidden?: boolean;
  initialError?: string | null;
}

export default function BranchesSettingsPage({
  initialBranches = null,
  initialLoading = false,
  initialCanEdit,
  initialForbidden = false,
  initialError = null,
  ...restProps
}: BranchesSettingsPageProps) {
  const { user } = useAuth();

  // Permission-based edit rights from API (Rule 9: never hardcoded roles, unknown user means no edit)
  const derivedCanEdit =
    initialCanEdit !== undefined
      ? initialCanEdit
      : Boolean(
          user &&
          Array.isArray((user as any).permissions) &&
          (user as any).permissions.includes('iam:shop_config')
        );

  const [branches, setBranches] = useState<BranchItem[]>(initialBranches || DEFAULT_BRANCHES);
  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [error, setError] = useState<string | null>(initialError);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      // Refresh branches list
      setBranches(DEFAULT_BRANCHES);
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tải danh sách chi nhánh');
    } finally {
      setLoading(false);
    }
  }, []);

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
              Cửa hàng &amp; Chi nhánh (SCR-WH-01 / SCR-SHOP-01)
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
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-bold">
              <GitBranch className="w-3.5 h-3.5 text-blue-600" />
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

        {/* Main Branch Management View */}
        <BranchManagementView
          branches={branches}
          loading={loading}
          canEdit={derivedCanEdit}
          isForbidden={initialForbidden}
          error={error}
          onRefresh={handleRefresh}
          {...restProps}
        />
      </div>
    </div>
  );
}
