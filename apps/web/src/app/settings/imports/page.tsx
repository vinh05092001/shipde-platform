'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Layers, Shield } from 'lucide-react';
import { ImportManagementView } from '@/components/ImportManagementView';
import { useAuth } from '@/context/AuthContext';
import type { ImportSummary, ImportRow } from '@shipde/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ImportsSettingsPageProps {
  initialImports?: ImportSummary[] | null;
  initialSelectedImport?: ImportSummary | null;
  initialSelectedRows?: ImportRow[] | null;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialError?: string | null;
}

export default function ImportsSettingsPage({
  initialImports = null,
  initialSelectedImport = null,
  initialSelectedRows = null,
  initialLoading,
  initialCanEdit,
  initialError = null,
}: ImportsSettingsPageProps) {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;

  // Edit rights are derived server-side. Unknown user or missing permissions means no edit.
  const [imports, setImports] = useState<ImportSummary[]>(initialImports || []);
  const [selectedImport, setSelectedImport] = useState<ImportSummary | null>(initialSelectedImport);
  const [selectedRows, setSelectedRows] = useState<ImportRow[]>(initialSelectedRows || []);
  const [revisions, setRevisions] = useState<ImportSummary[]>([]);
  const [canEdit, setCanEdit] = useState<boolean>(initialCanEdit ?? false);
  const [loading, setLoading] = useState<boolean>(initialLoading ?? initialImports === null);
  const [error, setError] = useState<string | null>(initialError);

  const fetchImports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/v1/imports`, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Bạn không có quyền truy cập dữ liệu nhập khẩu.');
        }
        if (res.status === 401) {
          throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải danh sách lượt nhập');
      }

      const json = await res.json();
      if (json.success) {
        // Handle both json.data as array and json.data.items for flexibility (Finding 1)
        const items = Array.isArray(json.data) ? json.data : json.data?.items || [];
        setImports(items);
        // Server-side permission check: never hardcode OWNER role (Finding 10)
        setCanEdit(Boolean(user?.permissions?.includes('iam:shop_config')));
      }
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi kết nối với máy chủ quản lý nhập liệu');
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  const fetchImportDetail = useCallback(
    async (importId: string) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const [detailRes, rowsRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/imports/${importId}`, { headers }),
          fetch(`${API_BASE}/api/v1/imports/${importId}/rows?limit=100`, { headers }),
        ]);

        if (detailRes.ok) {
          const detailJson = await detailRes.json();
          if (detailJson.success) {
            const imp = detailJson.data?.import || detailJson.data;
            setSelectedImport(imp);
            setRevisions(detailJson.data?.revisions || []);
          }
        }

        if (rowsRes.ok) {
          const rowsJson = await rowsRes.json();
          if (rowsJson.success) {
            const rowItems = Array.isArray(rowsJson.data)
              ? rowsJson.data
              : rowsJson.data?.items || [];
            setSelectedRows(rowItems);
          }
        }
      } catch (err: any) {
        setError(err?.message || 'Lỗi khi tải chi tiết lượt nhập');
      }
    },
    [token]
  );

  useEffect(() => {
    if (!initialImports) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial imports fetch
      void fetchImports();
    }
  }, [initialImports, fetchImports]);

  const handleDownloadTemplate = async (
    templateType: 'branches' | 'warehouses',
    format: 'csv' | 'xlsx'
  ) => {
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(
        `${API_BASE}/api/v1/imports/templates/${templateType}?format=${format}`,
        { headers }
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải mẫu nhập liệu');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition');
      let filename = `template_${templateType}.${format}`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tải mẫu nhập liệu');
    }
  };

  const handleUpload = async (templateType: 'branches' | 'warehouses', file: File) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Convert file to base64
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await fetch(`${API_BASE}/api/v1/imports/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        template_type: templateType,
        file_name: file.name,
        file_base64: base64,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Tải lên tệp tin thất bại');
    }

    const json = await res.json();
    await fetchImports();
    if (json.data?.import?.id) {
      await fetchImportDetail(json.data.import.id);
    }
  };

  const handlePromote = async (id: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/imports/${id}/promote`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Áp dụng dữ liệu nhập thất bại');
    }

    await fetchImports();
    await fetchImportDetail(id);
  };

  const handleExportIssues = async (id: string) => {
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(`${API_BASE}/api/v1/imports/${id}/issues/export`, {
        headers,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải báo cáo lỗi');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition');
      let filename = `import_${id}_issues.csv`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tải báo cáo lỗi');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Quay lại Bảng điều khiển
            </Link>
            <div className="h-4 w-px bg-gray-200" />
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="text-gray-400">Cấu hình</span>
              <span>/</span>
              <span className="font-semibold text-gray-900">Nhập dữ liệu</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ImportManagementView
          imports={imports}
          selectedImport={selectedImport}
          selectedImportRows={selectedRows}
          revisions={revisions}
          loading={loading}
          canEdit={canEdit}
          error={error}
          onRefresh={fetchImports}
          onSelectImport={fetchImportDetail}
          onDownloadTemplate={handleDownloadTemplate}
          onUpload={handleUpload}
          onPromote={handlePromote}
          onExportIssues={handleExportIssues}
        />
      </main>
    </div>
  );
}
