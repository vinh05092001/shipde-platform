'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Plus,
  Edit2,
  Trash2,
  Users,
  Check,
  Loader2,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Search,
  CheckCircle2,
  X,
  Sliders,
} from 'lucide-react';
import { PermissionItem, RoleItem, CanonicalPermissionCode } from '@shipde/contracts';

interface FormState {
  name: string;
  description: string;
  permissions: string[];
}

export interface RolesSettingsPageProps {
  initialRoles?: RoleItem[];
  initialPermissions?: PermissionItem[];
  initialCategories?: string[];
  initialLoading?: boolean;
  initialCanManageRoles?: boolean;
  initialError?: string | null;
  initialSuccess?: string | null;
  initialCreateOpen?: boolean;
  initialEditingRole?: RoleItem | null;
  initialViewingRole?: RoleItem | null;
  initialDeletingRole?: RoleItem | null;
  initialModalError?: string | null;
  initialDeleteModalError?: string | null;
  initialFormState?: FormState;
  initialHasLoadedSuccessfully?: boolean;
}

export function validateRoleForm(
  name: string,
  permissions: string[],
  existingRoles: RoleItem[] = [],
  editingRoleId?: string
): { isValid: boolean; errors: { name?: string; permissions?: string } } {
  const errors: { name?: string; permissions?: string } = {};
  if (!name.trim()) {
    errors.name = 'Vui lòng nhập tên vai trò';
  } else {
    const duplicate = existingRoles.find(
      (r) => r.name.trim().toLowerCase() === name.trim().toLowerCase() && r.id !== editingRoleId
    );
    if (duplicate) {
      errors.name = 'Tên vai trò đã tồn tại trong cửa hàng';
    }
  }

  if (permissions.length === 0) {
    errors.permissions = 'Cần chọn ít nhất một quyền hạn từ danh mục';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

export default function RolesSettingsPage({
  initialRoles,
  initialPermissions,
  initialCategories,
  initialLoading,
  initialCanManageRoles,
  initialError,
  initialSuccess,
  initialCreateOpen,
  initialEditingRole,
  initialViewingRole,
  initialDeletingRole,
  initialModalError,
  initialDeleteModalError,
  initialFormState,
  initialHasLoadedSuccessfully,
}: RolesSettingsPageProps = {}) {
  const { user, merchant } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  // Role & permission catalog data
  const [loading, setLoading] = useState<boolean>(initialLoading ?? initialRoles === undefined);
  const [hasLoadedSuccessfully, setHasLoadedSuccessfully] = useState<boolean>(
    initialHasLoadedSuccessfully ?? (initialRoles !== undefined && !initialError)
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError ?? null);
  const [successMsg, setSuccessMsg] = useState<string | null>(initialSuccess ?? null);

  const [roles, setRoles] = useState<RoleItem[]>(initialRoles ?? []);
  const [permissions, setPermissions] = useState<PermissionItem[]>(initialPermissions ?? []);
  const [categories, setCategories] = useState<string[]>(initialCategories ?? []);

  // Search & filter
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(initialCreateOpen ?? false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(initialEditingRole ?? null);
  const [viewingRole, setViewingRole] = useState<RoleItem | null>(initialViewingRole ?? null);
  const [deletingRole, setDeletingRole] = useState<RoleItem | null>(initialDeletingRole ?? null);
  const [modalError, setModalError] = useState<string | null>(initialModalError ?? null);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(
    initialDeleteModalError ?? null
  );

  // Form input state
  const [formState, setFormState] = useState<FormState>(
    initialFormState ?? {
      name: '',
      description: '',
      permissions: [],
    }
  );
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; permissions?: string }>({});
  const [canManageRoles, setCanManageRoles] = useState<boolean>(initialCanManageRoles ?? false);

  // Fetch roles and permissions catalog
  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const [permsRes, rolesRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/permissions`, { headers }),
        fetch(`${API_BASE}/api/v1/roles`, { headers }),
      ]);

      if (!permsRes.ok) {
        const errJson = await permsRes.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải danh mục quyền hạn');
      }

      if (!rolesRes.ok) {
        const errJson = await rolesRes.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải danh sách vai trò');
      }

      const permsJson = await permsRes.json();
      const rolesJson = await rolesRes.json();

      setPermissions(permsJson.data.permissions || []);
      setCategories(permsJson.data.categories || []);
      setRoles(rolesJson.data.roles || []);
      // Trust only the server-authoritative boolean (Finding 3 / Round 7)
      setCanManageRoles(Boolean(rolesJson.data?.can_manage_roles));
      setHasLoadedSuccessfully(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi kết nối máy chủ khi tải dữ liệu phân quyền');
      // Do not reset hasLoadedSuccessfully to false on refresh error (Finding 3 / Round 7);
      // keeps the last successful list and form values mounted beside the error banner with retry.
    } finally {
      setLoading(false);
    }
  }, [API_BASE, token]);

  useEffect(() => {
    if (initialRoles === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial roles and permissions catalog fetch
      void fetchData();
    }
  }, [fetchData, initialRoles]);

  const handleOpenCreate = () => {
    if (!canManageRoles) {
      setErrorMsg('Bạn không có quyền quản lý vai trò và phân quyền (Cần quyền iam:manage_users)');
      return;
    }
    setFormState({
      name: '',
      description: '',
      permissions: [],
    });
    setFieldErrors({});
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (role: RoleItem) => {
    if (role.is_system) {
      setErrorMsg('Vai trò mặc định của hệ thống không thể chỉnh sửa hoặc xóa');
      return;
    }
    if (!canManageRoles) {
      setErrorMsg('Bạn không có quyền quản lý vai trò và phân quyền (Cần quyền iam:manage_users)');
      return;
    }
    setEditingRole(role);
    setFormState({
      name: role.name,
      description: role.description || '',
      permissions: role.permissions.map((p) => p.code),
    });
    setFieldErrors({});
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleTogglePermission = (code: string) => {
    setFormState((prev) => {
      const exists = prev.permissions.includes(code);
      return {
        ...prev,
        permissions: exists
          ? prev.permissions.filter((c) => c !== code)
          : [...prev.permissions, code],
      };
    });
    if (fieldErrors.permissions) {
      setFieldErrors((prev) => ({ ...prev, permissions: undefined }));
    }
  };

  const handleSelectAllCategory = (cat: string) => {
    const catCodes = permissions.filter((p) => p.category === cat).map((p) => p.code);
    const allSelected = catCodes.every((c) => formState.permissions.includes(c));

    setFormState((prev) => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter((c) => !catCodes.includes(c))
        : Array.from(new Set([...prev.permissions, ...catCodes])),
    }));
  };

  const validateForm = (): boolean => {
    const { isValid, errors } = validateRoleForm(
      formState.name,
      formState.permissions,
      roles,
      editingRole?.id
    );
    setFieldErrors(errors);
    return isValid;
  };

  const handleSaveRole = async (e?: React.FormEvent) => {
    e?.preventDefault?.();
    if (!validateForm()) return;

    setSubmitting(true);
    setModalError(null);
    setSuccessMsg(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const isEdit = Boolean(editingRole);
      const url = isEdit
        ? `${API_BASE}/api/v1/roles/${editingRole!.id}`
        : `${API_BASE}/api/v1/roles`;
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({
          name: formState.name.trim(),
          description: formState.description.trim() || undefined,
          permissions: formState.permissions,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const errorFields =
          json?.error?.fields || (Array.isArray(json?.error?.details) ? json.error.details : null);
        if (errorFields && Array.isArray(errorFields)) {
          const fieldMap: Record<string, string> = {};
          errorFields.forEach((f: any) => {
            if (f.field) fieldMap[f.field] = f.message;
          });
          setFieldErrors(fieldMap);
        }
        throw new Error(json?.error?.message || 'Không thể lưu vai trò phân quyền');
      }

      setSuccessMsg('Đã lưu vai trò phân quyền thành công');
      setIsCreateOpen(false);
      setEditingRole(null);
      setModalError(null);
      void fetchData();
    } catch (err: any) {
      setModalError(err.message || 'Lỗi khi lưu vai trò');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!deletingRole) return;
    setSubmitting(true);
    setDeleteModalError(null);
    setSuccessMsg(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/v1/roles/${deletingRole.id}`, {
        method: 'DELETE',
        headers,
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error?.message || 'Không thể xóa vai trò phân quyền');
      }

      setSuccessMsg('Đã xóa vai trò tùy chỉnh thành công');
      setDeletingRole(null);
      setDeleteModalError(null);
      void fetchData();
    } catch (err: any) {
      setDeleteModalError(err.message || 'Lỗi khi xóa vai trò');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRoles = roles.filter((role) => {
    const matchesSearch =
      role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (role.description && role.description.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSearch;
  });

  const totalCustomRoles = roles.filter((r) => !r.is_system);
  const totalSystemRoles = roles.filter((r) => r.is_system);
  const customRoles = filteredRoles.filter((r) => !r.is_system);
  const systemRoles = filteredRoles.filter((r) => r.is_system);

  return (
    <div className="space-y-6">
      {/* Header & Navigation */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/settings"
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 font-medium"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Cài đặt hệ thống</span>
            </Link>
          </div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <span>Vai Trò & Phân Quyền (Roles & RBAC)</span>
          </h1>
          <p className="text-xs text-slate-500">
            Quản lý vai trò mặc định của hệ thống và thiết lập các vai trò tùy chỉnh theo nguyên tắc
            đặc quyền tối thiểu (Least Privilege).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
            title="Làm mới dữ liệu"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>

          {canManageRoles && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="btn-primary text-xs py-2 px-3.5 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo vai trò mới</span>
            </button>
          )}
        </div>
      </div>

      {/* Persistent Feedback Banners */}
      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start justify-between gap-3 animate-in fade-in"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchData}
              className="font-bold underline text-rose-700 hover:text-rose-900"
            >
              Thử lại
            </button>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-rose-400 hover:text-rose-600 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3 animate-in fade-in"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-500 hover:text-emerald-700 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Non-authorized Warning Callout (Finding 4 / Round 8: hide until successful load) */}
      {!loading && hasLoadedSuccessfully && !canManageRoles && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Bạn chỉ có quyền <strong>xem</strong> danh mục vai trò. Thao tác tạo hoặc chỉnh sửa
            quyền hạn yêu cầu quyền <strong>iam:manage_users</strong> hoặc tài khoản{' '}
            <strong>Chủ Shop (Owner)</strong>.
          </span>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên vai trò, mô tả..."
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <span>Tổng số:</span>
          <strong className="text-slate-900 font-bold">{roles.length} vai trò</strong>
          <span>
            ({totalSystemRoles.length} vai trò hệ thống, {totalCustomRoles.length} tùy chỉnh)
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        // UI State: LOADING (Skeleton)
        <div className="space-y-4 animate-pulse">
          <div className="h-28 bg-slate-100 rounded-xl border border-slate-200" />
          <div className="h-28 bg-slate-100 rounded-xl border border-slate-200" />
          <div className="h-28 bg-slate-100 rounded-xl border border-slate-200" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 1: Custom Roles */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-600" />
                <span>Vai Trò Tùy Chỉnh Của Cửa Hàng</span>
              </h2>
            </div>

            {!hasLoadedSuccessfully && errorMsg ? null : totalCustomRoles.length === 0 ? (
              // UI State: EMPTY
              <div className="modern-card p-8 text-center bg-slate-50/60 border border-dashed border-slate-200 rounded-xl space-y-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <Shield className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-800">
                    Chưa có vai trò tùy chỉnh nào
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Cửa hàng của bạn hiện đang dùng các vai trò mặc định của hệ thống. Bạn có thể
                    tạo vai trò tùy chỉnh mới để phân quyền chi tiết cho từng nghiệp vụ.
                  </p>
                </div>
                {canManageRoles && (
                  <button
                    type="button"
                    onClick={handleOpenCreate}
                    className="btn-primary text-xs py-2 px-3.5 inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tạo vai trò tùy chỉnh đầu tiên</span>
                  </button>
                )}
              </div>
            ) : customRoles.length === 0 ? (
              // UI State: SEARCH EMPTY (custom roles exist, but search filter produced zero matches)
              <div className="modern-card p-8 text-center bg-slate-50/40 border border-slate-200 rounded-xl text-slate-500 text-xs space-y-1">
                <p className="font-semibold text-slate-700">
                  Không tìm thấy vai trò tùy chỉnh nào phù hợp với từ khóa &ldquo;{searchTerm}
                  &rdquo;
                </p>
                <p className="text-[11px] text-slate-400">
                  Tổng cộng có {totalCustomRoles.length} vai trò tùy chỉnh trong cửa hàng.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customRoles.map((role) => (
                  <div
                    key={role.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <h4 className="font-bold text-sm text-slate-900">{role.name}</h4>
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold shrink-0">
                          Tùy chỉnh
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">
                        {role.description || 'Không có mô tả chi tiết'}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                      <div className="flex justify-between items-center text-slate-600">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span>Người dùng gán:</span>
                        </span>
                        <strong className="font-bold text-slate-900">
                          {role.user_count} tài khoản
                        </strong>
                      </div>

                      <div className="flex justify-between items-center text-slate-600">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                          <span>Quyền kích hoạt:</span>
                        </span>
                        <strong className="font-bold text-blue-600">
                          {role.permissions_count} quyền
                        </strong>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-2">
                        <button
                          type="button"
                          onClick={() => setViewingRole(role)}
                          className="px-2 py-1 text-[11px] rounded bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium"
                        >
                          Chi tiết
                        </button>
                        {canManageRoles && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(role)}
                              className="px-2 py-1 text-[11px] rounded bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium flex items-center gap-1"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Sửa</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingRole(role)}
                              className="px-2 py-1 text-[11px] rounded bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Xóa</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Built-in System Roles */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-purple-600" />
                <span>Vai Trò Mặc Định Của Hệ Thống (Bất biến)</span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {systemRoles.map((role) => (
                <div
                  key={role.id}
                  className="bg-slate-50/60 border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <h4 className="font-bold text-sm text-slate-900">{role.name}</h4>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold shrink-0">
                        Hệ thống
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {role.description || 'Vai trò bảo vệ cốt lõi của nền tảng'}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 space-y-2 text-xs">
                    <div className="flex justify-between items-center text-slate-600">
                      <span className="flex items-center gap-1.5 text-slate-500">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        <span>Người dùng:</span>
                      </span>
                      <strong className="font-bold text-slate-900">
                        {role.user_count} tài khoản
                      </strong>
                    </div>

                    <div className="flex justify-between items-center text-slate-600">
                      <span className="flex items-center gap-1.5 text-slate-500">
                        <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                        <span>Quyền hạn:</span>
                      </span>
                      <strong className="font-bold text-purple-700">
                        {role.permissions_count} quyền
                      </strong>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 pt-2">
                      <button
                        type="button"
                        onClick={() => setViewingRole(role)}
                        className="px-2 py-1 text-[11px] rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-medium"
                      >
                        Xem chi tiết
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: VIEW ROLE DETAILS */}
      {viewingRole && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-role-title"
            className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 shadow-2xl text-xs max-h-[90vh] flex flex-col animate-in zoom-in-95"
          >
            <div className="flex justify-between items-start pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    viewingRole.is_system
                      ? 'bg-purple-50 text-purple-600'
                      : 'bg-blue-50 text-blue-600'
                  }`}
                >
                  {viewingRole.is_system ? (
                    <Lock className="w-5 h-5" />
                  ) : (
                    <Sliders className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 id="view-role-title" className="font-bold text-base text-slate-900">
                    {viewingRole.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {viewingRole.is_system
                      ? 'Vai trò bảo vệ hệ thống'
                      : 'Vai trò tùy chỉnh cửa hàng'}{' '}
                    · {viewingRole.permissions.length} quyền được gán
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingRole(null)}
                aria-label="Đóng chi tiết vai trò"
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1 flex-1">
              <div>
                <h4 className="font-bold text-slate-700 mb-1">Mô tả nhiệm vụ:</h4>
                <p className="text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  {viewingRole.description || 'Không có mô tả chi tiết'}
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-700 mb-2">Danh sách quyền hạn đã kích hoạt:</h4>
                <div className="space-y-3">
                  {categories.map((cat) => {
                    const permsInCat = viewingRole.permissions.filter((p) => p.category === cat);
                    if (permsInCat.length === 0) return null;

                    return (
                      <div key={cat} className="space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Phân hệ {cat} ({permsInCat.length})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {permsInCat.map((p) => (
                            <div
                              key={p.code}
                              className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2"
                            >
                              <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                              <div className="space-y-0.5">
                                <strong className="text-slate-900 block font-semibold">
                                  {p.name}
                                </strong>
                                <span className="text-[10px] text-slate-500 block leading-tight">
                                  {p.description}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingRole(null)}
                className="btn-secondary text-xs py-1.5 px-4"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE OR EDIT CUSTOM ROLE */}
      {(isCreateOpen || editingRole) && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-edit-role-title"
            className="bg-white rounded-2xl border border-slate-200 max-w-3xl w-full p-6 space-y-4 shadow-2xl text-xs max-h-[92vh] flex flex-col animate-in zoom-in-95"
          >
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="create-edit-role-title" className="font-bold text-base text-slate-900">
                    {editingRole ? 'Chỉnh Sửa Vai Trò Tùy Chỉnh' : 'Tạo Vai Trò Tùy Chỉnh Mới'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Chọn các quyền hạn phù hợp với phạm vi trách nhiệm của vị trí công việc
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false);
                  setEditingRole(null);
                }}
                aria-label="Đóng cửa sổ vai trò"
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="overflow-y-auto pr-1 flex-1 space-y-4">
              {/* Modal Save Error Banner with In-Dialog Resubmit Retry */}
              {modalError && (
                <div
                  role="alert"
                  className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-semibold block">Lỗi lưu vai trò</strong>
                      <p className="text-[11px] text-rose-700">{modalError}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSaveRole()}
                    disabled={submitting}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-[11px] shrink-0"
                  >
                    Thử lại
                  </button>
                </div>
              )}

              {/* Role Name */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Tên vai trò <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={formState.name}
                  onChange={(e) => {
                    setFormState({ ...formState, name: e.target.value });
                    if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: undefined });
                  }}
                  placeholder="Ví dụ: Nhân viên cứu đơn, Thủ kho ca đêm..."
                  className={`modern-input w-full text-xs font-semibold ${
                    fieldErrors.name ? 'border-rose-400 bg-rose-50/20' : ''
                  }`}
                />
                {fieldErrors.name && (
                  <p className="text-rose-600 text-[11px] mt-1 font-medium">{fieldErrors.name}</p>
                )}
              </div>

              {/* Role Description */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Mô tả chức năng & phạm vi:
                </label>
                <textarea
                  rows={2}
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  placeholder="Mô tả tóm tắt quyền hạn và trách nhiệm của vai trò này..."
                  className="modern-input w-full text-xs"
                />
              </div>

              {/* Permissions Selection Matrix */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="font-bold text-slate-700 block">
                    Phân bổ danh mục quyền hạn <span className="text-rose-500">*</span>:
                  </label>
                  <span className="text-slate-500 text-[11px]">
                    Đã chọn:{' '}
                    <strong className="text-blue-600 font-bold">
                      {formState.permissions.length}
                    </strong>{' '}
                    / {permissions.length} quyền
                  </span>
                </div>

                {fieldErrors.permissions && (
                  <p className="text-rose-600 text-[11px] mb-2 font-medium bg-rose-50 p-2 rounded border border-rose-200">
                    {fieldErrors.permissions}
                  </p>
                )}

                <div className="space-y-4">
                  {categories.map((cat) => {
                    const catPerms = permissions.filter((p) => p.category === cat);
                    const allSelected =
                      catPerms.length > 0 &&
                      catPerms.every((p) => formState.permissions.includes(p.code));

                    return (
                      <div
                        key={cat}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5"
                      >
                        <div className="flex justify-between items-center pb-1.5 border-b border-slate-200/60">
                          <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                            Phân Hệ {cat} ({catPerms.length})
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSelectAllCategory(cat)}
                            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 underline"
                          >
                            {allSelected ? 'Bỏ chọn toàn bộ' : 'Chọn tất cả phân hệ'}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {catPerms.map((perm) => {
                            const isChecked = formState.permissions.includes(perm.code);

                            return (
                              <label
                                key={perm.code}
                                className={`p-2.5 rounded-lg border text-xs flex items-start gap-2.5 cursor-pointer transition select-none ${
                                  isChecked
                                    ? 'bg-blue-50 border-blue-200 text-blue-900 shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleTogglePermission(perm.code)}
                                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                                />
                                <div className="space-y-0.5">
                                  <strong className="block font-semibold text-slate-900">
                                    {perm.name}
                                  </strong>
                                  <span className="text-[10px] text-slate-500 block leading-tight">
                                    {perm.description}
                                  </span>
                                  <span className="text-[9px] font-mono text-slate-400 block pt-0.5">
                                    {perm.code}
                                  </span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2 sticky bottom-0 bg-white py-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setEditingRole(null);
                  }}
                  className="btn-secondary text-xs py-2 px-4"
                  disabled={submitting}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary text-xs py-2 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingRole ? 'Cập nhật vai trò' : 'Lưu vai trò mới'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DELETE ROLE CONFIRMATION */}
      {deletingRole && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-role-title"
            className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <h3 id="delete-role-title" className="font-bold text-sm text-slate-900">
                    Xác Nhận Xóa Vai Trò Tùy Chỉnh
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">{deletingRole.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeletingRole(null);
                  setDeleteModalError(null);
                }}
                aria-label="Đóng cửa sổ xác nhận xóa"
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            {/* Delete Modal Error Banner with In-Dialog Retry */}
            {deleteModalError && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold block">Lỗi xóa vai trò</strong>
                    <p className="text-[11px] text-rose-700">{deleteModalError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDeleteRole}
                  disabled={submitting}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-[11px] shrink-0"
                >
                  Thử lại
                </button>
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-slate-600">
              <p>
                Bạn có chắc chắn muốn xóa vai trò <strong>{deletingRole.name}</strong>?
              </p>
              {deletingRole.user_count > 0 ? (
                <p className="text-rose-600 font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>
                    Vai trò này đang được gán cho {deletingRole.user_count} người dùng đang hoạt
                    động. Bạn phải chuyển vai trò của họ trước khi xóa (BR-RBAC-03).
                  </span>
                </p>
              ) : (
                <p className="text-slate-500 text-[11px]">
                  Thao tác này sẽ xóa vĩnh viễn vai trò khỏi hệ thống và lưu vết kiểm toán bất biến
                  (Audit Trail).
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeletingRole(null);
                  setDeleteModalError(null);
                }}
                className="btn-secondary text-xs py-1.5 px-3.5"
                disabled={submitting}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleDeleteRole}
                disabled={submitting || deletingRole.user_count > 0}
                className="btn-danger text-xs py-1.5 px-4 flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Xác nhận xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
