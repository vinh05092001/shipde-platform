'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Plus,
  Search,
} from 'lucide-react';
import { ExportJobItem, ExportJobStatus, ExportResource, ExportFormat } from '@shipde/contracts';
import { ExportModal } from '@/components/ExportModal';

export default function ExportsSettingsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [jobs, setJobs] = useState<ExportJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterResource, setFilterResource] = useState<string>('');

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filterResource ? `/api/v1/exports?resource=${filterResource}` : '/api/v1/exports';
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Không thể tải danh sách tác vụ xuất dữ liệu');
      }
      const json = await res.json();
      setJobs(json.data || []);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Có lỗi xảy ra khi tải danh sách tác vụ xuất dữ liệu'
      );
    } finally {
      setLoading(false);
    }
  }, [filterResource]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch jobs on filter change
    void fetchJobs();
  }, [fetchJobs]);

  const getStatusBadge = (status: ExportJobStatus) => {
    switch (status) {
      case ExportJobStatus.COMPLETED:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mr-1" />
            Hoàn tất
          </span>
        );
      case ExportJobStatus.PENDING:
      case ExportJobStatus.PROCESSING:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            <Clock className="w-3.5 h-3.5 text-amber-600 mr-1" />
            Đang xử lý
          </span>
        );
      case ExportJobStatus.FAILED:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 mr-1" />
            Thất bại
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
            {status}
          </span>
        );
    }
  };

  const getFormatIcon = (format: ExportFormat) => {
    switch (format) {
      case ExportFormat.XLSX:
        return <FileSpreadsheet className="w-4 h-4 text-emerald-600" />;
      case ExportFormat.PDF:
        return <FileText className="w-4 h-4 text-rose-600" />;
      default:
        return <FileText className="w-4 h-4 text-slate-600" />;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Lịch Sử Xuất Dữ Liệu</h1>
          <p className="text-sm text-slate-500 mt-1">
            Theo dõi, tải xuống và quản lý các tác vụ xuất dữ liệu hệ thống (FEAT-COM-05).
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={fetchJobs}
            aria-label="Làm mới danh sách"
            className="p-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-600 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center space-x-2 transition-colors shadow-sm shadow-indigo-200 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Xuất Dữ Liệu Mới</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center space-x-3 bg-white p-3.5 rounded-xl border border-slate-200 text-xs">
        <span className="font-semibold text-slate-600">Lọc theo tài nguyên:</span>
        <button
          type="button"
          onClick={() => setFilterResource('')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            filterResource === ''
              ? 'bg-indigo-100 text-indigo-700 font-bold'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Tất cả
        </button>
        <button
          type="button"
          onClick={() => setFilterResource(ExportResource.WAREHOUSES)}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            filterResource === ExportResource.WAREHOUSES
              ? 'bg-indigo-100 text-indigo-700 font-bold'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Kho hàng
        </button>
        <button
          type="button"
          onClick={() => setFilterResource(ExportResource.USERS)}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            filterResource === ExportResource.USERS
              ? 'bg-indigo-100 text-indigo-700 font-bold'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Nhân viên
        </button>
        <button
          type="button"
          onClick={() => setFilterResource(ExportResource.LEDGERS)}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            filterResource === ExportResource.LEDGERS
              ? 'bg-indigo-100 text-indigo-700 font-bold'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          3 Sổ đối soát
        </button>
        <button
          type="button"
          onClick={() => setFilterResource(ExportResource.AUDIT_LOGS)}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            filterResource === ExportResource.AUDIT_LOGS
              ? 'bg-indigo-100 text-indigo-700 font-bold'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Nhật ký kiểm toán
        </button>
      </div>

      {/* Main Table / States */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {loading ? (
          <div className="py-16 text-center text-slate-500 space-y-3" aria-busy="true">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-600" />
            <p className="text-sm font-medium">Đang tải lịch sử xuất dữ liệu...</p>
          </div>
        ) : error ? (
          <div className="py-12 text-center text-slate-500 space-y-3">
            <AlertCircle className="w-8 h-8 mx-auto text-rose-500" />
            <p className="text-sm text-rose-600 font-medium">{error}</p>
            <button
              type="button"
              onClick={fetchJobs}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-16 text-center text-slate-400 space-y-3">
            <Download className="w-10 h-10 mx-auto text-slate-300" />
            <div>
              <p className="text-base font-semibold text-slate-700">
                Chưa có tác vụ xuất dữ liệu nào
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Nhấn vào nút &quot;Xuất Dữ Liệu Mới&quot; để tạo tệp xuất đầu tiên.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo tác vụ xuất ngay</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200 font-semibold tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Thời gian</th>
                  <th className="px-5 py-3.5">Tài nguyên</th>
                  <th className="px-5 py-3.5">Định dạng</th>
                  <th className="px-5 py-3.5">Trạng thái</th>
                  <th className="px-5 py-3.5">Số bản ghi</th>
                  <th className="px-5 py-3.5">Tên tệp</th>
                  <th className="px-5 py-3.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 text-slate-600 font-medium">
                      {new Date(job.created_at).toLocaleString('vi-VN')}
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-800 uppercase">
                      {job.resource}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center space-x-1.5">
                        {getFormatIcon(job.format)}
                        <span className="font-semibold uppercase text-slate-700">{job.format}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{getStatusBadge(job.status)}</td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {job.succeeded_rows.toLocaleString()} / {job.total_rows.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-slate-500 max-w-[200px] truncate">
                      {job.file_name || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {job.status === ExportJobStatus.COMPLETED && job.download_url ? (
                        <a
                          href={job.download_url}
                          download={job.file_name || true}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải về</span>
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Export Modal Component */}
      <ExportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => fetchJobs()}
      />
    </div>
  );
}
