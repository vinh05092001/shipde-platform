'use client';

import React, { useState, useMemo } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  ArrowRight,
  ShieldAlert,
  Info,
  Clock,
  Archive,
  ChevronRight,
  Layers,
} from 'lucide-react';
import type {
  ImportSummary,
  ImportRow,
  ImportControlTotals,
  ImportTemplateType,
} from '@shipde/contracts';
import { ImportStatus, ImportRowStatus, ImportIssueSeverity } from '@shipde/contracts';

export interface ImportManagementViewProps {
  imports?: ImportSummary[];
  selectedImport?: ImportSummary | null;
  selectedImportRows?: ImportRow[];
  revisions?: ImportSummary[];
  loading?: boolean;
  canEdit?: boolean;
  error?: string | null;
  success?: string | null;
  onRefresh?: () => void;
  onSelectImport?: (id: string) => void;
  onDownloadTemplate?: (type: 'branches' | 'warehouses', format: 'csv' | 'xlsx') => void;
  onUpload?: (templateType: 'branches' | 'warehouses', file: File) => Promise<void>;
  onPromote?: (id: string) => Promise<void>;
  onExportIssues?: (id: string) => void;
}

export function ImportManagementView({
  imports = [],
  selectedImport = null,
  selectedImportRows = [],
  revisions = [],
  loading = false,
  canEdit = false,
  error = null,
  success = null,
  onRefresh,
  onSelectImport,
  onDownloadTemplate,
  onUpload,
  onPromote,
  onExportIssues,
}: ImportManagementViewProps) {
  const [activeTab, setActiveTab] = useState<'rows' | 'mapping' | 'revisions'>('rows');
  const [templateFilter, setTemplateFilter] = useState<'ALL' | 'branches' | 'warehouses'>('ALL');
  const [rowStatusFilter, setRowStatusFilter] = useState<'ALL' | 'VALID' | 'ERROR' | 'WARNING'>(
    'ALL'
  );
  const [selectedTemplateForUpload, setSelectedTemplateForUpload] = useState<
    'branches' | 'warehouses'
  >('branches');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const viewError = localError ?? error;
  const viewSuccess = localSuccess ?? success;

  const filteredImports = useMemo(() => {
    return imports.filter((imp) => {
      if (templateFilter !== 'ALL' && imp.template_type !== templateFilter) {
        return false;
      }
      return true;
    });
  }, [imports, templateFilter]);

  const filteredRows = useMemo(() => {
    return selectedImportRows.filter((row) => {
      if (rowStatusFilter !== 'ALL' && row.status !== rowStatusFilter) {
        return false;
      }
      return true;
    });
  }, [selectedImportRows, rowStatusFilter]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setLocalError('Vui lòng chọn tệp tin cần tải lên.');
      return;
    }
    setLocalError(null);
    setLocalSuccess(null);
    setUploading(true);
    try {
      if (onUpload) {
        await onUpload(selectedTemplateForUpload, uploadFile);
      }
      setUploadFile(null);
      setLocalSuccess('Tải lên và xử lý kiểm tra tệp tin thành công.');
    } catch (err: any) {
      setLocalError(err.message || 'Lỗi khi tải lên tệp tin.');
    } finally {
      setUploading(false);
    }
  };

  const handlePromoteClick = async (id: string) => {
    setLocalError(null);
    setLocalSuccess(null);
    setPromoting(true);
    try {
      if (onPromote) {
        await onPromote(id);
      }
      setLocalSuccess('Áp dụng dữ liệu nhập vào hệ thống thành công (PROMOTED).');
    } catch (err: any) {
      setLocalError(err.message || 'Lỗi khi áp dụng dữ liệu nhập.');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="import-management-view">
      {/* Top Banner / Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <Layers className="w-7 h-7 text-indigo-600" />
            Nhập Dữ Liệu Hệ Thống (SCR-IMPORT-01)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Tải mẫu, tải lên tệp tin chi nhánh và kho hàng, kiểm tra lỗi từng dòng và áp dụng dữ
            liệu có kiểm toán.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={() => {
                setLocalError(null);
                setLocalSuccess(null);
                onRefresh();
              }}
              disabled={loading}
              aria-label="Làm mới danh sách nhập liệu"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
          )}
        </div>
      </div>

      {/* Forbidden Warning Banner */}
      {!canEdit && (
        <div
          data-testid="import-forbidden-banner"
          className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800"
          role="alert"
        >
          <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900">Quyền truy cập bị giới hạn</p>
            <p className="mt-0.5">
              Tài khoản hiện tại chỉ có quyền xem danh sách và kết quả kiểm toán nhập liệu. Để thực
              hiện tải lên tệp hoặc áp dụng dữ liệu, cần quyền quản trị cấu hình cửa hàng (
              <code className="text-xs bg-amber-100 px-1 py-0.5 rounded font-mono">
                iam:shop_config
              </code>
              ).
            </p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {viewError && (
        <div
          data-testid="import-error-banner"
          className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800"
          role="alert"
        >
          <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-rose-900">Đã xảy ra lỗi</p>
            <p className="mt-0.5">{viewError}</p>
          </div>
          <button
            onClick={() => setLocalError(null)}
            aria-label="Đóng thông báo lỗi"
            className="text-rose-500 hover:text-rose-700 p-1"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Success Banner */}
      {viewSuccess && (
        <div
          data-testid="import-success-banner"
          className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800"
          role="status"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-emerald-900">Thành công</p>
            <p className="mt-0.5">{viewSuccess}</p>
          </div>
          <button
            onClick={() => setLocalSuccess(null)}
            aria-label="Đóng thông báo thành công"
            className="text-emerald-500 hover:text-emerald-700 p-1"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Template Download & Upload Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Template Download Card */}
        <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-gray-900 font-semibold text-base">
            <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            Tải Mẫu Nhập Liệu
          </div>
          <p className="text-xs text-gray-500">
            Tải tệp mẫu định dạng chuẩn có sẵn tiêu đề cột và dữ liệu mẫu để nhập thông tin chi
            nhánh hoặc kho hàng.
          </p>
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-800">Chi nhánh (Branches)</p>
                <p className="text-xs text-gray-500">
                  Mã chi nhánh, tên, địa chỉ, người liên hệ, số điện thoại
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onDownloadTemplate && onDownloadTemplate('branches', 'csv')}
                  aria-label="Tải mẫu chi nhánh CSV"
                  className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded"
                >
                  CSV
                </button>
                <button
                  onClick={() => onDownloadTemplate && onDownloadTemplate('branches', 'xlsx')}
                  aria-label="Tải mẫu chi nhánh XLSX"
                  className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded"
                >
                  XLSX
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-800">Kho hàng (Warehouses)</p>
                <p className="text-xs text-gray-500">
                  Mã kho, tên kho, địa chỉ, quận/huyện, người liên hệ
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onDownloadTemplate && onDownloadTemplate('warehouses', 'csv')}
                  aria-label="Tải mẫu kho hàng CSV"
                  className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded"
                >
                  CSV
                </button>
                <button
                  onClick={() => onDownloadTemplate && onDownloadTemplate('warehouses', 'xlsx')}
                  aria-label="Tải mẫu kho hàng XLSX"
                  className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded"
                >
                  XLSX
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Upload Form Card */}
        <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-gray-900 font-semibold text-base">
            <Upload className="w-5 h-5 text-indigo-600" />
            Tải Lên Tệp Nhập Liệu
          </div>
          <form onSubmit={handleUploadSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="import-template-select"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                Loại dữ liệu nhập
              </label>
              <select
                id="import-template-select"
                value={selectedTemplateForUpload}
                onChange={(e) => setSelectedTemplateForUpload(e.target.value as any)}
                disabled={!canEdit || uploading}
                aria-label="Chọn loại dữ liệu nhập"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="branches">Chi nhánh (Branches)</option>
                <option value="warehouses">Kho hàng (Warehouses)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="import-file-input"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                Chọn tệp (.csv, .xlsx, tối đa 10MB)
              </label>
              <input
                id="import-file-input"
                type="file"
                accept=".csv, .xlsx, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                disabled={!canEdit || uploading}
                aria-label="Chọn tệp tin nhập liệu"
                className="w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={!canEdit || !uploadFile || uploading}
                aria-label="Tải lên và kiểm tra tệp tin"
                className="w-full inline-flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                <Upload className={`w-4 h-4 ${uploading ? 'animate-spin' : ''}`} />
                {uploading ? 'Đang kiểm tra và tải lên...' : 'Tải lên & Kiểm tra dữ liệu'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Loading state indicator */}
      {loading && (
        <div
          className="p-8 text-center bg-white rounded-xl border border-gray-200"
          data-testid="import-loading-state"
        >
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">Đang tải lịch sử nhập liệu...</p>
        </div>
      )}

      {/* Imports History & Selected Detail Section */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: List of Imports */}
          <div className="lg:col-span-1 bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                Lịch sử nhập ({filteredImports.length})
              </h2>
              <select
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.target.value as any)}
                aria-label="Lọc lịch sử theo loại"
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="ALL">Tất cả loại</option>
                <option value="branches">Chi nhánh</option>
                <option value="warehouses">Kho hàng</option>
              </select>
            </div>

            {filteredImports.length === 0 ? (
              <div className="py-8 text-center text-gray-500" data-testid="import-empty-state">
                <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium">Chưa có lượt nhập nào</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Tải tệp mẫu ở trên để thực hiện lượt nhập đầu tiên.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {filteredImports.map((imp) => {
                  const isSelected = selectedImport?.id === imp.id;
                  const isBlocked = imp.status === ImportStatus.BLOCKED;
                  const isPromoted = imp.status === ImportStatus.PROMOTED;
                  const isStaged = imp.status === ImportStatus.STAGED;

                  return (
                    <div
                      key={imp.id}
                      onClick={() => onSelectImport && onSelectImport(imp.id)}
                      data-testid={`import-item-${imp.id}`}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/50 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase text-indigo-700">
                          {imp.template_type}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isPromoted
                              ? 'bg-emerald-100 text-emerald-800'
                              : isBlocked
                                ? 'bg-rose-100 text-rose-800'
                                : isStaged
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {imp.status}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-gray-900 mt-1 truncate">
                        {imp.file_name}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-gray-500 mt-2">
                        <span>Rev {imp.revision}</span>
                        <span>
                          {imp.total_rows} dòng ({imp.valid_rows} hợp lệ, {imp.error_rows} lỗi)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Detail of Selected Import */}
          <div className="lg:col-span-2 space-y-4">
            {selectedImport ? (
              <div
                className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-5"
                data-testid="import-detail-panel"
              >
                {/* Detail Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-gray-100 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-gray-900">
                        {selectedImport.file_name}
                      </h2>
                      <span className="text-xs px-2 py-0.5 font-bold rounded-full bg-indigo-100 text-indigo-800">
                        Rev {selectedImport.revision}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 font-bold rounded-full ${
                          selectedImport.status === ImportStatus.PROMOTED
                            ? 'bg-emerald-100 text-emerald-800'
                            : selectedImport.status === ImportStatus.BLOCKED
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {selectedImport.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 font-mono">
                      Checksum: {selectedImport.file_hash.substring(0, 16)}... | Kích thước:{' '}
                      {(selectedImport.file_size / 1024).toFixed(1)} KB
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedImport.error_rows > 0 && onExportIssues && (
                      <button
                        onClick={() => onExportIssues(selectedImport.id)}
                        aria-label="Tải báo cáo lỗi CSV"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Tải báo cáo lỗi
                      </button>
                    )}

                    {selectedImport.status === ImportStatus.STAGED && (
                      <button
                        onClick={() => handlePromoteClick(selectedImport.id)}
                        disabled={!canEdit || promoting}
                        aria-label="Áp dụng dữ liệu nhập vào hệ thống"
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                      >
                        <CheckCircle2
                          className={`w-3.5 h-3.5 ${promoting ? 'animate-spin' : ''}`}
                        />
                        {promoting ? 'Đang áp dụng...' : 'Áp dụng dữ liệu (Promote)'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Control Totals Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg text-center">
                    <p className="text-[11px] text-gray-500 uppercase font-bold">Tổng số dòng</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {selectedImport.total_rows}
                    </p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg text-center">
                    <p className="text-[11px] text-emerald-700 uppercase font-bold">Hợp lệ</p>
                    <p className="text-xl font-bold text-emerald-700 mt-1">
                      {selectedImport.valid_rows}
                    </p>
                  </div>
                  <div className="bg-rose-50 border border-rose-100 p-3 rounded-lg text-center">
                    <p className="text-[11px] text-rose-700 uppercase font-bold">Lỗi (Chặn)</p>
                    <p className="text-xl font-bold text-rose-700 mt-1">
                      {selectedImport.error_rows}
                    </p>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg text-center">
                    <p className="text-[11px] text-amber-700 uppercase font-bold">Cảnh báo</p>
                    <p className="text-xl font-bold text-amber-700 mt-1">
                      {selectedImport.warning_rows}
                    </p>
                  </div>
                </div>

                {/* Navigation Tabs for SCR-IMPORT-01: Rows, Mapping Preview, Revision History */}
                <div className="flex border-b border-gray-200 gap-6 text-xs font-medium">
                  <button
                    onClick={() => setActiveTab('rows')}
                    className={`pb-2.5 transition-colors border-b-2 ${
                      activeTab === 'rows'
                        ? 'border-indigo-600 text-indigo-600 font-semibold'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Dữ liệu từng dòng ({filteredRows.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('mapping')}
                    className={`pb-2.5 transition-colors border-b-2 ${
                      activeTab === 'mapping'
                        ? 'border-indigo-600 text-indigo-600 font-semibold'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Xem trước ánh xạ cột (Mapping Preview)
                  </button>
                  <button
                    onClick={() => setActiveTab('revisions')}
                    className={`pb-2.5 transition-colors border-b-2 ${
                      activeTab === 'revisions'
                        ? 'border-indigo-600 text-indigo-600 font-semibold'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Lịch sử phiên bản (Revision History)
                  </button>
                </div>

                {activeTab === 'mapping' ? (
                  /* Mapping Preview Section (SCR-IMPORT-01) */
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Bảng ánh xạ các cột từ tệp nguồn vào cấu trúc thực thể{' '}
                      <strong>
                        {selectedImport.template_type === 'branches' ? 'Chi nhánh' : 'Kho hàng'}
                      </strong>
                      .
                    </p>
                    <div className="border border-gray-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                          <tr>
                            <th className="py-2 px-3">Cột tệp tải lên</th>
                            <th className="py-2 px-3">Trường hệ thống</th>
                            <th className="py-2 px-3">Quy định</th>
                            <th className="py-2 px-3">Giá trị mẫu (Dòng đầu)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {((selectedImport as any)?.mapping &&
                          Array.isArray((selectedImport as any).mapping)
                            ? (selectedImport as any).mapping.map((m: any) => ({
                                col: m.header || m.col || m.field,
                                field: m.field || m.col,
                                rule: m.required ? 'Bắt buộc' : m.rule || 'Tùy chọn',
                                description: m.description,
                                sample:
                                  selectedImportRows[0]?.raw_data?.[m.header] ??
                                  selectedImportRows[0]?.raw_data?.[m.col] ??
                                  selectedImportRows[0]?.raw_data?.[m.field] ??
                                  (selectedImportRows[0]?.normalized_data as any)?.[m.field],
                              }))
                            : selectedImport.template_type === 'branches'
                              ? [
                                  {
                                    col: 'Mã chi nhánh (code)',
                                    field: 'code',
                                    rule: 'Bắt buộc (Định danh scope)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Mã chi nhánh'] ??
                                      selectedImportRows[0]?.raw_data?.code ??
                                      (selectedImportRows[0]?.normalized_data as any)?.code,
                                  },
                                  {
                                    col: 'Tên chi nhánh (name)',
                                    field: 'name',
                                    rule: 'Bắt buộc (2-255 ký tự)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Tên chi nhánh'] ??
                                      selectedImportRows[0]?.raw_data?.name ??
                                      (selectedImportRows[0]?.normalized_data as any)?.name,
                                  },
                                  {
                                    col: 'Trạng thái (status)',
                                    field: 'status',
                                    rule: 'Tùy chọn (ACTIVE/INACTIVE)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Trạng thái'] ??
                                      selectedImportRows[0]?.raw_data?.status ??
                                      (selectedImportRows[0]?.normalized_data as any)?.status,
                                  },
                                  {
                                    col: 'Mặc định (is_default)',
                                    field: 'is_default',
                                    rule: 'Tùy chọn (true/false, tối đa 1 mặc định)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Mặc định'] ??
                                      selectedImportRows[0]?.raw_data?.is_default ??
                                      (selectedImportRows[0]?.normalized_data as any)?.is_default,
                                  },
                                  {
                                    col: 'Người liên hệ (contact_name)',
                                    field: 'contact_name',
                                    rule: 'Tùy chọn',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Người liên hệ'] ??
                                      selectedImportRows[0]?.raw_data?.contact_name ??
                                      (selectedImportRows[0]?.normalized_data as any)?.contact_name,
                                  },
                                  {
                                    col: 'Số điện thoại (contact_phone)',
                                    field: 'contact_phone',
                                    rule: 'Tùy chọn (Cảnh báo nếu thiếu)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Số điện thoại'] ??
                                      selectedImportRows[0]?.raw_data?.contact_phone ??
                                      (selectedImportRows[0]?.normalized_data as any)
                                        ?.contact_phone,
                                  },
                                  {
                                    col: 'Địa chỉ (address_line)',
                                    field: 'address_line',
                                    rule: 'Bắt buộc (Địa chỉ chi tiết)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Địa chỉ'] ??
                                      selectedImportRows[0]?.raw_data?.address_line ??
                                      (selectedImportRows[0]?.normalized_data as any)?.address_line,
                                  },
                                  {
                                    col: 'Phường/Xã (ward)',
                                    field: 'ward',
                                    rule: 'Tùy chọn (Cảnh báo nếu thiếu)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Phường/Xã'] ??
                                      selectedImportRows[0]?.raw_data?.ward ??
                                      (selectedImportRows[0]?.normalized_data as any)?.ward,
                                  },
                                  {
                                    col: 'Quận/Huyện (district)',
                                    field: 'district',
                                    rule: 'Bắt buộc (Quận hoặc Huyện)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Quận/Huyện'] ??
                                      selectedImportRows[0]?.raw_data?.district ??
                                      (selectedImportRows[0]?.normalized_data as any)?.district,
                                  },
                                  {
                                    col: 'Tỉnh/Thành phố (city)',
                                    field: 'city',
                                    rule: 'Bắt buộc (Tỉnh hoặc Thành phố)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Tỉnh/Thành phố'] ??
                                      selectedImportRows[0]?.raw_data?.city ??
                                      (selectedImportRows[0]?.normalized_data as any)?.city,
                                  },
                                ]
                              : [
                                  {
                                    col: 'Mã kho (code)',
                                    field: 'code',
                                    rule: 'Bắt buộc (Định danh scope)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Mã kho'] ??
                                      selectedImportRows[0]?.raw_data?.code ??
                                      (selectedImportRows[0]?.normalized_data as any)?.code,
                                  },
                                  {
                                    col: 'Tên kho hàng (name)',
                                    field: 'name',
                                    rule: 'Bắt buộc (2-255 ký tự)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Tên kho hàng'] ??
                                      selectedImportRows[0]?.raw_data?.name ??
                                      (selectedImportRows[0]?.normalized_data as any)?.name,
                                  },
                                  {
                                    col: 'Trạng thái (status)',
                                    field: 'status',
                                    rule: 'Tùy chọn (active/inactive)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Trạng thái'] ??
                                      selectedImportRows[0]?.raw_data?.status ??
                                      (selectedImportRows[0]?.normalized_data as any)?.status,
                                  },
                                  {
                                    col: 'Mặc định (is_default)',
                                    field: 'is_default',
                                    rule: 'Tùy chọn (true/false, tối đa 1 mặc định)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Mặc định'] ??
                                      selectedImportRows[0]?.raw_data?.is_default ??
                                      (selectedImportRows[0]?.normalized_data as any)?.is_default,
                                  },
                                  {
                                    col: 'Người liên hệ (contact_name)',
                                    field: 'contact_name',
                                    rule: 'Bắt buộc (Họ tên người phụ trách)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Người liên hệ'] ??
                                      selectedImportRows[0]?.raw_data?.contact_name ??
                                      (selectedImportRows[0]?.normalized_data as any)?.contact_name,
                                  },
                                  {
                                    col: 'Số điện thoại (contact_phone)',
                                    field: 'contact_phone',
                                    rule: 'Bắt buộc (Định dạng SĐT)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Số điện thoại'] ??
                                      selectedImportRows[0]?.raw_data?.contact_phone ??
                                      (selectedImportRows[0]?.normalized_data as any)
                                        ?.contact_phone,
                                  },
                                  {
                                    col: 'Email liên hệ (contact_email)',
                                    field: 'contact_email',
                                    rule: 'Tùy chọn (Email hợp lệ)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Email liên hệ'] ??
                                      selectedImportRows[0]?.raw_data?.contact_email ??
                                      (selectedImportRows[0]?.normalized_data as any)
                                        ?.contact_email,
                                  },
                                  {
                                    col: 'Địa chỉ lấy hàng (address_line)',
                                    field: 'address_line',
                                    rule: 'Bắt buộc (Địa chỉ kho chi tiết)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Địa chỉ lấy hàng'] ??
                                      selectedImportRows[0]?.raw_data?.address_line ??
                                      (selectedImportRows[0]?.normalized_data as any)?.address_line,
                                  },
                                  {
                                    col: 'Phường/Xã (ward)',
                                    field: 'ward',
                                    rule: 'Tùy chọn (Phường/Xã)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Phường/Xã'] ??
                                      selectedImportRows[0]?.raw_data?.ward ??
                                      (selectedImportRows[0]?.normalized_data as any)?.ward,
                                  },
                                  {
                                    col: 'Quận/Huyện (district)',
                                    field: 'district',
                                    rule: 'Bắt buộc (Quận hoặc Huyện)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Quận/Huyện'] ??
                                      selectedImportRows[0]?.raw_data?.district ??
                                      (selectedImportRows[0]?.normalized_data as any)?.district,
                                  },
                                  {
                                    col: 'Tỉnh/Thành phố (city)',
                                    field: 'city',
                                    rule: 'Bắt buộc (Tỉnh hoặc Thành phố)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Tỉnh/Thành phố'] ??
                                      selectedImportRows[0]?.raw_data?.city ??
                                      (selectedImportRows[0]?.normalized_data as any)?.city,
                                  },
                                  {
                                    col: 'Mã bưu chính (postal_code)',
                                    field: 'postal_code',
                                    rule: 'Tùy chọn',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Mã bưu chính'] ??
                                      selectedImportRows[0]?.raw_data?.postal_code ??
                                      (selectedImportRows[0]?.normalized_data as any)?.postal_code,
                                  },
                                  {
                                    col: 'Giờ chốt đơn (cutoff_time)',
                                    field: 'cutoff_time',
                                    rule: 'Tùy chọn (HH:MM)',
                                    sample:
                                      selectedImportRows[0]?.raw_data?.['Giờ chốt đơn'] ??
                                      selectedImportRows[0]?.raw_data?.cutoff_time ??
                                      (selectedImportRows[0]?.normalized_data as any)?.cutoff_time,
                                  },
                                ]
                          ).map((m: any, idx: number) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="py-2 px-3 font-mono font-medium text-gray-800">
                                {m.col}
                              </td>
                              <td className="py-2 px-3 font-mono text-indigo-600 font-medium">
                                {m.field}
                              </td>
                              <td className="py-2 px-3 text-gray-600">{m.rule}</td>
                              <td className="py-2 px-3 font-mono text-gray-700">
                                {m.sample !== undefined && m.sample !== null ? (
                                  String(m.sample)
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : activeTab === 'revisions' ? (
                  /* Revision History Section (SCR-IMPORT-01) */
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Danh sách các phiên bản của mẫu nhập liệu{' '}
                      <strong>{selectedImport.template_type}</strong>.
                    </p>
                    <div className="border border-gray-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                          <tr>
                            <th className="py-2 px-3">Phiên bản</th>
                            <th className="py-2 px-3">Tệp tin</th>
                            <th className="py-2 px-3">Trạng thái</th>
                            <th className="py-2 px-3">Dòng hợp lệ / lỗi</th>
                            <th className="py-2 px-3">Thời gian tạo</th>
                            <th className="py-2 px-3 text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(revisions.length > 0
                            ? revisions
                            : imports.filter(
                                (i) => i.template_type === selectedImport.template_type
                              )
                          ).map((rev) => (
                            <tr
                              key={rev.id}
                              className={`hover:bg-gray-50 ${rev.id === selectedImport.id ? 'bg-indigo-50/50' : ''}`}
                            >
                              <td className="py-2 px-3 font-mono font-bold text-indigo-700">
                                Rev {rev.revision}
                              </td>
                              <td className="py-2 px-3 font-medium text-gray-900">
                                {rev.file_name}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    rev.status === ImportStatus.PROMOTED
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : rev.status === ImportStatus.SUPERSEDED
                                        ? 'bg-gray-100 text-gray-700'
                                        : rev.status === ImportStatus.BLOCKED
                                          ? 'bg-rose-100 text-rose-800'
                                          : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {rev.status}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-gray-600">
                                {rev.valid_rows} / {rev.total_rows} ({rev.error_rows} lỗi)
                              </td>
                              <td className="py-2 px-3 text-gray-500">
                                {new Date(rev.created_at).toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2 px-3 text-right">
                                {rev.id !== selectedImport.id && onSelectImport && (
                                  <button
                                    onClick={() => onSelectImport(rev.id)}
                                    aria-label={`Xem phiên bản ${rev.revision}`}
                                    className="px-2.5 py-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded"
                                  >
                                    Xem
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  /* Rows Table */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800">
                        Chi tiết dữ liệu từng dòng ({filteredRows.length})
                      </h3>
                      <select
                        value={rowStatusFilter}
                        onChange={(e) => setRowStatusFilter(e.target.value as any)}
                        aria-label="Lọc theo trạng thái dòng"
                        className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                      >
                        <option value="ALL">Tất cả trạng thái</option>
                        <option value="VALID">Chỉ dòng hợp lệ (VALID)</option>
                        <option value="ERROR">Chỉ dòng lỗi (ERROR)</option>
                        <option value="WARNING">Chỉ dòng cảnh báo (WARNING)</option>
                      </select>
                    </div>

                    {/* Truncation disclosure banner (Finding 16) */}
                    {selectedImport.total_rows > selectedImportRows.length && (
                      <div
                        data-testid="import-rows-truncation-notice"
                        className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center justify-between"
                      >
                        <span>
                          Đang hiển thị {selectedImportRows.length} trên tổng số{' '}
                          {selectedImport.total_rows} dòng. Để xem và khắc phục toàn bộ lỗi (bao gồm
                          các dòng sau dòng {selectedImportRows.length}), vui lòng sử dụng nút
                          &quot;Tải báo cáo lỗi&quot;.
                        </span>
                      </div>
                    )}

                    {filteredRows.length === 0 ? (
                      <div className="py-6 text-center text-gray-400 text-xs">
                        Không có dòng nào phù hợp với bộ lọc đã chọn.
                      </div>
                    ) : (
                      <div className="border border-gray-200 rounded-lg overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                            <tr>
                              <th className="py-2 px-3">Dòng #</th>
                              <th className="py-2 px-3">Mã scope</th>
                              <th className="py-2 px-3">Trạng thái</th>
                              <th className="py-2 px-3">Chi tiết & Lỗi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredRows.map((row) => {
                              const isError = row.status === ImportRowStatus.ERROR;
                              const isWarning = row.status === ImportRowStatus.WARNING;
                              // Support both issues and issues_json from API or mocks (Finding 1)
                              const issues =
                                (row.issues as any[]) || ((row as any).issues_json as any[]) || [];

                              return (
                                <tr key={row.id} className="hover:bg-gray-50">
                                  <td className="py-2 px-3 font-mono font-medium text-gray-700">
                                    {row.row_number}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-gray-900">
                                    {row.scope_identifier || '-'}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        isError
                                          ? 'bg-rose-100 text-rose-800'
                                          : isWarning
                                            ? 'bg-amber-100 text-amber-800'
                                            : 'bg-emerald-100 text-emerald-800'
                                      }`}
                                    >
                                      {row.status}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3">
                                    {issues.length === 0 ? (
                                      <span className="text-gray-400 text-[11px]">Hợp lệ</span>
                                    ) : (
                                      <div className="space-y-1">
                                        {issues.map((issue, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-start gap-1 text-[11px]"
                                          >
                                            <span
                                              className={`font-mono font-bold ${
                                                issue.severity === ImportIssueSeverity.BLOCKING
                                                  ? 'text-rose-600'
                                                  : 'text-amber-600'
                                              }`}
                                            >
                                              [{issue.code}]
                                            </span>
                                            <span className="text-gray-700">{issue.message}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500 shadow-sm">
                <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-base font-semibold text-gray-700">
                  Chọn một lượt nhập để xem chi tiết
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Nhấn vào bất kỳ lượt nhập nào từ danh sách bên trái để xem kết quả kiểm tra và
                  tiến hành áp dụng.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
