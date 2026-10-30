'use client';

import React, { useState } from 'react';
import {
  X,
  Download,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  Calendar,
  ShieldAlert,
  FileQuestion,
  RefreshCw,
  FileSpreadsheet,
} from 'lucide-react';
import {
  ExportResource,
  ExportFormat,
  ExportJobStatus,
  type ExportJobItem,
} from '@shipde/contracts';

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultResource?: ExportResource;
  defaultFormat?: ExportFormat;
  defaultFilters?: Record<string, unknown>;
  userPermissions?: string[];
  userRole?: string;
  onSuccess?: (job: ExportJobItem) => void;
  onToast?: (message: string) => void;
  // Controlled state injection for deterministic testing across all required states
  forcedState?:
    | 'idle'
    | 'loading'
    | 'empty'
    | 'validation_error'
    | 'forbidden'
    | 'partial'
    | 'success'
    | 'error';
  forcedErrorMessage?: string;
  forcedJob?: ExportJobItem;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  defaultResource = ExportResource.WAREHOUSES,
  defaultFormat = ExportFormat.CSV,
  defaultFilters = {},
  userPermissions = [],
  userRole,
  onSuccess,
  onToast,
  forcedState,
  forcedErrorMessage,
  forcedJob,
}) => {
  const [resource, setResource] = useState<ExportResource>(defaultResource);
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [dateFrom, setDateFrom] = useState<string>((defaultFilters.date_from as string) || '');
  const [dateTo, setDateTo] = useState<string>((defaultFilters.date_to as string) || '');
  const [carrierCode, setCarrierCode] = useState<string>(
    (defaultFilters.carrier_code as string) || ''
  );
  const [clamp, setClamp] = useState<boolean>(defaultFilters.clamp !== false);

  const [internalState, setInternalState] = useState<
    | 'idle'
    | 'loading'
    | 'empty'
    | 'validation_error'
    | 'forbidden'
    | 'partial'
    | 'success'
    | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [completedJob, setCompletedJob] = useState<ExportJobItem | null>(null);

  if (!isOpen) return null;

  const currentState = forcedState || internalState;
  const currentError = forcedErrorMessage || errorMessage;
  const activeJob = forcedJob || completedJob;

  const handleStartExport = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client validation
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      setInternalState('validation_error');
      setErrorMessage('Khoảng thời gian không hợp lệ: Ngày bắt đầu phải trước ngày kết thúc.');
      return;
    }

    setInternalState('loading');
    setErrorMessage('');

    try {
      const payload = {
        resource,
        format,
        sync: true,
        filters: {
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
          ...(carrierCode ? { carrier_code: carrierCode } : {}),
          clamp,
        },
      };

      const res = await fetch('/api/v1/exports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 403) {
          setInternalState('forbidden');
          setErrorMessage(
            json?.message ||
              'Tài khoản không có quyền thực hiện xuất dữ liệu cho tài nguyên này hoặc phạm vi yêu cầu.'
          );
        } else if (res.status === 400 && json?.code === 'VALIDATION_ERROR') {
          setInternalState('validation_error');
          setErrorMessage(json?.message || 'Thông tin yêu cầu xuất dữ liệu không hợp lệ.');
        } else {
          setInternalState('error');
          setErrorMessage(json?.message || 'Có lỗi xảy ra khi tạo yêu cầu xuất dữ liệu.');
        }
        return;
      }

      const job: ExportJobItem = json?.data;
      setCompletedJob(job);

      if (job.total_rows === 0) {
        setInternalState('empty');
      } else if (job.metadata?.truncation_note) {
        setInternalState('partial');
        if (onSuccess) onSuccess(job);
        if (onToast) onToast('Dữ liệu đã được xuất và giới hạn theo số lượng tối đa.');
      } else {
        setInternalState('success');
        if (onSuccess) onSuccess(job);
        if (onToast) onToast('Tác vụ xuất dữ liệu hoàn tất thành công!');
      }
    } catch (err: unknown) {
      setInternalState('error');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.'
      );
    }
  };

  const handleResetToConfig = () => {
    setInternalState('idle');
    setErrorMessage('');
    setCompletedJob(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 id="export-modal-title" className="text-lg font-bold text-slate-800">
                Xuất Dữ Liệu Hệ Thống
              </h2>
              <p className="text-xs text-slate-500">
                FEAT-COM-05: Xuất dữ liệu bảo mật, toàn vẹn và có chữ ký xác thực
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ xuất dữ liệu"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* STATE 1: LOADING */}
          {currentState === 'loading' && (
            <div
              className="py-12 flex flex-col items-center justify-center text-center space-y-4"
              aria-busy="true"
            >
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Đang xử lý xuất dữ liệu...
                </h3>
                <p className="text-sm text-slate-500 mt-1 max-w-sm">
                  Hệ thống đang kiểm tra quyền truy cập, bảo vệ thông tin PII và tạo tệp dữ liệu có
                  chữ ký xác thực.
                </p>
              </div>
            </div>
          )}

          {/* STATE 2: EMPTY */}
          {currentState === 'empty' && (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-full">
                <FileQuestion className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Không tìm thấy dữ liệu để xuất
                </h3>
                <p className="text-sm text-slate-500 mt-1 max-w-sm">
                  Không có bản ghi nào phù hợp với các tiêu chí bộ lọc đã chọn trong khoảng thời
                  gian này.
                </p>
              </div>
              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleResetToConfig}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Điều chỉnh bộ lọc</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          )}

          {/* STATE 3: FORBIDDEN */}
          {currentState === 'forbidden' && (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-full">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Quyền truy cập bị từ chối
                </h3>
                <p className="text-sm text-rose-600 mt-1 max-w-sm font-medium">
                  {currentError ||
                    'Tài khoản không có quyền xuất dữ liệu tài nguyên này hoặc phạm vi kho/chi nhánh được yêu cầu.'}
                </p>
              </div>
              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleResetToConfig}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  <span>Chọn tài nguyên khác</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          )}

          {/* STATE 4: ERROR */}
          {currentState === 'error' && (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-full">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Đã xảy ra lỗi khi xuất dữ liệu
                </h3>
                <p className="text-sm text-slate-500 mt-1 max-w-sm">
                  {currentError || 'Không thể hoàn thành tác vụ xuất dữ liệu. Vui lòng thử lại.'}
                </p>
              </div>
              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleResetToConfig}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Thử lại</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          )}

          {/* STATE 5: SUCCESS OR PARTIAL (CLOCKED/CLAMPED) */}
          {(currentState === 'success' || currentState === 'partial') && activeJob && (
            <div className="py-4 space-y-5">
              <div className="flex items-center space-x-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-900">
                    Tệp xuất dữ liệu đã sẵn sàng!
                  </h3>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Đã xuất thành công {activeJob.succeeded_rows.toLocaleString()} /{' '}
                    {activeJob.total_rows.toLocaleString()} bản ghi.
                  </p>
                </div>
              </div>

              {/* Truncation warning if clamped / partial state */}
              {(currentState === 'partial' || activeJob.metadata?.truncation_note) && (
                <div
                  className="flex items-start space-x-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs"
                  role="alert"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Lưu ý giới hạn bản ghi:</span>{' '}
                    {activeJob.metadata?.truncation_note ||
                      'Kết quả đã được giới hạn ở số lượng tối đa theo cấu hình hệ thống.'}
                  </div>
                </div>
              )}

              {/* Metadata details card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Tài nguyên xuất:</span>
                  <span className="font-semibold text-slate-800 uppercase">
                    {activeJob.resource}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Định dạng tệp:</span>
                  <span className="font-semibold text-slate-800 uppercase">{activeJob.format}</span>
                </div>
                {activeJob.file_name && (
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500 font-medium">Tên tệp:</span>
                    <span className="font-mono text-slate-700">{activeJob.file_name}</span>
                  </div>
                )}
                {activeJob.file_size_bytes !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500 font-medium">Kích thước:</span>
                    <span className="text-slate-700">
                      {(activeJob.file_size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                )}
                {activeJob.checksum_sha256 && (
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500 font-medium">Mã băm SHA-256:</span>
                    <span
                      className="font-mono text-[11px] text-slate-600 truncate max-w-[240px]"
                      title={activeJob.checksum_sha256}
                    >
                      {activeJob.checksum_sha256}
                    </span>
                  </div>
                )}
              </div>

              {/* Download Action */}
              <div className="pt-2 flex space-x-3">
                <a
                  href={`/api/v1/exports/${activeJob.id}/download`}
                  download={activeJob.file_name || true}
                  className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center space-x-2 transition-colors shadow-sm shadow-indigo-200 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Tải Xuống Tệp Dữ Liệu</span>
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-medium transition-colors cursor-pointer"
                >
                  Hoàn tất
                </button>
              </div>
            </div>
          )}

          {/* STATE 0: IDLE / CONFIGURATION FORM */}
          {(currentState === 'idle' || currentState === 'validation_error') && (
            <form onSubmit={handleStartExport} className="space-y-4">
              {/* Validation alert banner if validation error */}
              {currentState === 'validation_error' && (
                <div
                  className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center space-x-2"
                  role="alert"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{currentError || 'Vui lòng kiểm tra lại các thông tin bộ lọc.'}</span>
                </div>
              )}

              {/* Resource Selector */}
              <div>
                <label
                  htmlFor="export-resource-select"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Tài nguyên dữ liệu cần xuất <span className="text-rose-500">*</span>
                </label>
                <select
                  id="export-resource-select"
                  value={resource}
                  onChange={(e) => setResource(e.target.value as ExportResource)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value={ExportResource.WAREHOUSES}>Danh sách kho hàng (Warehouses)</option>
                  <option value={ExportResource.USERS}>Danh sách nhân viên (Users / Staff)</option>
                  <option value={ExportResource.LEDGERS}>Báo cáo 3 sổ đối soát (Ledgers)</option>
                  <option value={ExportResource.AUDIT_LOGS}>
                    Nhật ký kiểm toán hệ thống (Audit Logs)
                  </option>
                </select>
              </div>

              {/* Format Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Định dạng tệp <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setFormat(ExportFormat.CSV)}
                    className={`p-2.5 rounded-xl border text-left flex items-center space-x-2 transition-all cursor-pointer ${
                      format === ExportFormat.CSV
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-bold ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 font-medium'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-slate-500" />
                    <span className="text-xs">CSV (.csv)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat(ExportFormat.XLSX)}
                    className={`p-2.5 rounded-xl border text-left flex items-center space-x-2 transition-all cursor-pointer ${
                      format === ExportFormat.XLSX
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-bold ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 font-medium'
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs">Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat(ExportFormat.PDF)}
                    className={`p-2.5 rounded-xl border text-left flex items-center space-x-2 transition-all cursor-pointer ${
                      format === ExportFormat.PDF
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-bold ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 font-medium'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-rose-600" />
                    <span className="text-xs">PDF (.pdf)</span>
                  </button>
                </div>
              </div>

              {/* Date Filter Range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="export-date-from"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Từ ngày
                  </label>
                  <div className="relative">
                    <input
                      id="export-date-from"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      aria-invalid={currentState === 'validation_error'}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="export-date-to"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Đến ngày
                  </label>
                  <div className="relative">
                    <input
                      id="export-date-to"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      aria-invalid={currentState === 'validation_error'}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Resource-specific filter (e.g. Carrier for ledgers) */}
              {resource === ExportResource.LEDGERS && (
                <div>
                  <label
                    htmlFor="export-carrier-select"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Hãng vận chuyển (Tùy chọn)
                  </label>
                  <select
                    id="export-carrier-select"
                    value={carrierCode}
                    onChange={(e) => setCarrierCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Tất cả các hãng vận chuyển</option>
                    <option value="GHN">Giao Hàng Nhanh (GHN)</option>
                    <option value="GHTK">Giao Hàng Tiết Kiệm (GHTK)</option>
                    <option value="VTP">Viettel Post (VTP)</option>
                    <option value="SPX">Shopee Xpress (SPX)</option>
                  </select>
                </div>
              )}

              {/* Clamp to limit toggle */}
              <div className="pt-1">
                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clamp}
                    onChange={(e) => setClamp(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-700 font-medium">
                    Tự động giới hạn số dòng tối đa nếu vượt ngưỡng (tránh lỗi ngắt quãng)
                  </span>
                </label>
              </div>

              {/* Submit / Cancel Buttons */}
              <div className="pt-4 flex space-x-3">
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-indigo-200 cursor-pointer flex items-center justify-center space-x-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Bắt Đầu Xuất Dữ Liệu</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-medium transition-colors cursor-pointer"
                >
                  Hủy
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
