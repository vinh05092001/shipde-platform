'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Store,
  RefreshCw,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';

interface ShopOwner {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
}

interface AdminShop {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  owner: ShopOwner;
}

interface AdminShopListResponse {
  data: AdminShop[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

type ApiError = {
  code: string;
  message: string;
};

export default function AdminShopsPage() {
  const [shops, setShops] = useState<AdminShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const fetchShops = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('page', String(currentPage));
      params.set('page_size', String(pageSize));

      const res = await fetch(`/api/admin/shops?${params.toString()}`);

      if (!res.ok) {
        const body: ErrorBody = await res.json().catch(() => ({}));
        const code = body.error?.code || 'UNKNOWN_ERROR';
        const message = body.error?.message || 'Không thể tải danh sách cửa hàng.';
        throw { code, message };
      }

      const json: AdminShopListResponse = await res.json();
      setShops(json.data || []);
      setTotal(json.meta?.total || 0);
    } catch (err: any) {
      if (err.code && err.message) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: 'NETWORK_ERROR',
          message: 'Không thể kết nối đến máy chủ. Vui lòng thử lại.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchShops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      ACTIVE: 'Hoạt động',
      SUSPENDED: 'Tạm ngưng',
      PENDING_VERIFICATION: 'Chờ xác minh',
      DISABLED: 'Vô hiệu hóa',
    };
    return map[status] || status;
  };

  const filteredShops = shops.filter(
    (shop) =>
      shop.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shop.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shop.owner?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shop.owner?.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ---- Render states -------------------------------------------------

  if (loading && shops.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-slate-200 animate-pulse" />
            <div className="h-6 w-48 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-slate-200 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- 403 / FORBIDDEN: admin key not configured -----------------------

  if (error?.code === 'FORBIDDEN') {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Store className="w-6 h-6 text-slate-700" />
            <h1 className="text-2xl font-bold text-slate-900">Cửa Hàng</h1>
          </div>

          <div className="modern-card p-8 text-center">
            <div className="w-14 h-14 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Truy cập bị từ chối</h2>
            <p className="text-sm text-slate-600 mb-4">{error.message}</p>
            <p className="text-xs text-slate-500">
              Liên hệ với quản trị viên nền tảng để cấu hình
              <code className="mx-1 px-2 py-1 bg-slate-100 rounded text-slate-700">
                PLATFORM_ADMIN_KEY
              </code>
              trên máy chủ.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Other errors --------------------------------------------------

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Store className="w-6 h-6 text-slate-700" />
            <h1 className="text-2xl font-bold text-slate-900">Cửa Hàng</h1>
          </div>

          <div className="modern-card p-6">
            <div className="flex items-center gap-3 text-rose-700">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-medium">{error.message}</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchShops()}
              className="btn-primary mt-4 text-xs py-1.5 px-3"
            >
              Thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Empty state ---------------------------------------------------

  if (shops.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Store className="w-6 h-6 text-slate-700" />
              <h1 className="text-2xl font-bold text-slate-900">Cửa Hàng</h1>
            </div>
            <Link href="/admin/shops/create">
              <button
                type="button"
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Tạo Cửa Hàng
              </button>
            </Link>
          </div>

          <div className="modern-card p-12 text-center">
            <div className="w-14 h-14 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
              <Store className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Chưa có cửa hàng nào</h2>
            <p className="text-sm text-slate-500 mb-4">Hãy tạo cửa hàng đầu tiên để bắt đầu.</p>
            <Link href="/admin/shops/create">
              <button type="button" className="btn-primary text-xs py-2 px-4">
                Tạo Cửa Hàng Mới
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---- Data table ----------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header Bar */}
        <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Store className="w-5 h-5 text-slate-700" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">Cửa Hàng</h1>
              <p className="text-xs text-slate-500">
                Tổng cộng {total} cửa hàng • Trang {currentPage}/{totalPages}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm kiếm tên, mã, chủ cửa hàng..."
                className="modern-input pl-8 pr-3 py-1.5 text-xs w-56"
              />
            </div>
            <button
              type="button"
              onClick={() => void fetchShops()}
              className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Làm mới"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <Link href="/admin/shops/create">
              <button
                type="button"
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Tạo Cửa Hàng
              </button>
            </Link>
          </div>
        </div>

        {/* Search Filters (below header bar) */}
        <div className="mb-4 flex items-center gap-2 text-xs">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Tìm theo tên cửa hàng, mã số, email hoặc tên chủ..."
            className="modern-input text-xs py-1.5 px-3 w-full sm:w-80"
          />
        </div>

        {/* Shops Table */}
        <div className="modern-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-slate-700">Tên Cửa Hàng</th>
                  <th className="text-left py-2.5 px-4 font-medium text-slate-700">Mã Số</th>
                  <th className="text-left py-2.5 px-4 font-medium text-slate-700">Trạng Thái</th>
                  <th className="text-left py-2.5 px-4 font-medium text-slate-700">Chủ Cửa Hàng</th>
                  <th className="text-left py-2.5 px-4 font-medium text-slate-700">Ngày Tạo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredShops.map((shop) => (
                  <tr key={shop.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                          <Store className="w-3.5 h-3.5 text-slate-700" />
                        </div>
                        <span className="font-medium text-slate-900">{shop.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <code className="text-xs text-slate-600">{shop.code}</code>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            shop.status === 'ACTIVE'
                              ? 'bg-emerald-400'
                              : shop.status === 'SUSPENDED'
                                ? 'bg-amber-400'
                                : shop.status === 'PENDING_VERIFICATION'
                                  ? 'bg-sky-400'
                                  : 'bg-slate-400'
                          }`}
                        />
                        {getStatusLabel(shop.status)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">
                      {shop.owner?.full_name || '—'}
                      {shop.owner?.email && (
                        <span className="block text-xs text-slate-400">{shop.owner.email}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">
                      {new Date(shop.created_at).toLocaleDateString('vi-VN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Table Footer */}
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Hiển thị {filteredShops.length} / {total} cửa hàng
          </div>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 mt-4 text-xs">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || loading}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded disabled:opacity-50"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-600 px-2 py-1">
              Trang {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || loading}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded disabled:opacity-50"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
