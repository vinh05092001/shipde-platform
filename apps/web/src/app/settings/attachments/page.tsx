'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, UploadCloud, Shield } from 'lucide-react';
import { AttachmentManagementView } from '@/components/AttachmentManagementView';
import { useAuth } from '@/context/AuthContext';
import type { FormattedAttachment } from '@shipde/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface AttachmentsSettingsPageProps {
  initialAttachments?: FormattedAttachment[] | null;
  initialTotal?: number;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialError?: string | null;
}

export default function AttachmentsSettingsPage({
  initialAttachments = null,
  initialTotal,
  initialLoading,
  initialCanEdit,
  initialError = null,
}: AttachmentsSettingsPageProps) {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;

  const [attachments, setAttachments] = useState<FormattedAttachment[]>(initialAttachments || []);
  const [total, setTotal] = useState<number | undefined>(initialTotal);
  const [canEdit, setCanEdit] = useState<boolean>(initialCanEdit ?? user?.role === 'OWNER');
  const [loading, setLoading] = useState<boolean>(initialLoading ?? initialAttachments === null);
  const [error, setError] = useState<string | null>(initialError);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/v1/attachments`, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Bạn không có quyền truy cập danh sách tệp đính kèm.');
        }
        if (res.status === 401) {
          throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải danh sách tệp đính kèm.');
      }

      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setAttachments(json.data);
        if (json.meta?.total !== undefined) {
          setTotal(json.meta.total);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi kết nối với máy chủ quản lý tệp đính kèm.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!initialAttachments) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial attachments fetch
      void fetchAttachments();
    }
  }, [initialAttachments, fetchAttachments]);

  const handleUpload = async (data: {
    file_name: string;
    mime_type: string;
    content_base64: string;
    entity_type?: string;
    entity_id?: string;
    warehouse_id?: string;
    branch_id?: string;
  }) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/attachments/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể tải tệp lên máy chủ.');
    }

    await fetchAttachments();
  };

  const handleDownload = async (id: string, fileName: string) => {
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/attachments/${id}/download`, { headers });
    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể tải xuống tệp tin.');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleDelete = async (id: string, confirm: boolean) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/attachments/${id}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ confirm }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể xóa tệp.');
    }

    await fetchAttachments();
  };

  const handleBulkDelete = async (ids: string[], confirm: boolean) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/attachments/bulk-delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids, confirm }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể thực hiện xóa hàng loạt.');
    }

    await fetchAttachments();
  };

  const handlePurgeRetention = async (dryRun: boolean) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/attachments/retention-purge`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dry_run: dryRun }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể thực hiện dọn dẹp lưu trữ.');
    }

    const json = await res.json();
    if (!dryRun) {
      await fetchAttachments();
    }
    return json.data;
  };

  const handleQuarantine = async (id: string, reason: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/attachments/${id}/quarantine`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || 'Không thể cách ly tệp.');
    }

    await fetchAttachments();
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Cài đặt hệ thống</span>
          </Link>
          <span>/</span>
          <span className="text-slate-800 font-semibold">Tệp đính kèm &amp; Bằng chứng</span>
        </div>

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <FileText className="w-6 h-6 text-indigo-600" />
              Quản lý Tệp đính kèm &amp; Bằng chứng
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Lưu trữ bằng chứng hình ảnh đơn hàng, vận đơn, phiếu giao nhận, khiếu nại và sao kê
              đối soát.
            </p>
          </div>
        </div>

        {/* Core Component */}
        <AttachmentManagementView
          attachments={attachments}
          total={total}
          loading={loading}
          canEdit={canEdit}
          error={error}
          onRefresh={fetchAttachments}
          onUpload={handleUpload}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onBulkDelete={handleBulkDelete}
          onPurgeRetention={handlePurgeRetention}
          onQuarantine={handleQuarantine}
        />
      </div>
    </div>
  );
}
