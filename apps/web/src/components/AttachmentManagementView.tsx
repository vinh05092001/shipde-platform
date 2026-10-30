'use client';

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Upload,
  Download,
  Trash2,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  X,
  File,
  Image as ImageIcon,
  Check,
  Ban,
  Clock,
  Layers,
} from 'lucide-react';
import type { FormattedAttachment, AttachmentBulkActionResult } from '@shipde/contracts';

export interface AttachmentManagementViewProps {
  attachments?: FormattedAttachment[];
  total?: number;
  loading?: boolean;
  canEdit?: boolean;
  error?: string | null;
  success?: string | null;
  initialSearchQuery?: string;
  initialStatusFilter?: string;
  initialEntityTypeFilter?: string;
  initialUploadOpen?: boolean;
  initialValidationErrors?: Record<string, string>;
  onRefresh?: () => void;
  onUpload?: (data: {
    file_name: string;
    mime_type: string;
    content_base64: string;
    entity_type?: string;
    entity_id?: string;
    warehouse_id?: string;
    branch_id?: string;
  }) => Promise<void>;
  onDownload?: (id: string, fileName: string) => Promise<void>;
  onDelete?: (id: string, confirm: boolean) => Promise<void>;
  onBulkDelete?: (ids: string[], confirm: boolean) => Promise<AttachmentBulkActionResult | void>;
  onPurgeRetention?: (dryRun: boolean) => Promise<{ success_count: number; failure_count: number }>;
  onQuarantine?: (id: string, reason: string) => Promise<void>;
  /** Seeds the partial-failure state (recovery view) for the bulk delete operation. */
  initialBulkPartialFailure?: AttachmentBulkActionResult | null;
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AttachmentManagementView({
  attachments = [],
  total,
  loading = false,
  canEdit = false,
  error = null,
  success = null,
  initialSearchQuery = '',
  initialStatusFilter = 'ALL',
  initialEntityTypeFilter = 'ALL',
  initialUploadOpen = false,
  initialValidationErrors = {},
  onRefresh,
  onUpload,
  onDownload,
  onDelete,
  onBulkDelete,
  onPurgeRetention,
  onQuarantine,
  initialBulkPartialFailure = null,
}: AttachmentManagementViewProps) {
  // Search and filter states
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [entityTypeFilter, setEntityTypeFilter] = useState(initialEntityTypeFilter);

  // Selection state for bulk operations
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modals & form state
  const [isUploadOpen, setIsUploadOpen] = useState(initialUploadOpen);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [isQuarantineModalOpen, setIsQuarantineModalOpen] = useState(false);

  const [activeAttachment, setActiveAttachment] = useState<FormattedAttachment | null>(null);
  const [quarantineReason, setQuarantineReason] = useState('');
  const [purgeDryRun, setPurgeDryRun] = useState(true);
  // Partial-failure recovery state for bulk deletion: an HTTP-success response may
  // still contain failed items; they must be explained and kept selectable for retry.
  const [bulkPartialFailure, setBulkPartialFailure] =
    useState<AttachmentBulkActionResult | null>(initialBulkPartialFailure);
  const [purgeResult, setPurgeResult] = useState<{
    success_count: number;
    failure_count: number;
  } | null>(null);

  // Upload form fields
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('image/png');
  const [contentBase64, setContentBase64] = useState('');
  const [entityType, setEntityType] = useState('GENERAL');
  const [entityId, setEntityId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [branchId, setBranchId] = useState('');

  // Processing & feedback state
  const [actionLoading, setActionLoading] = useState(false);
  const [validationErrors, setValidationErrors] =
    useState<Record<string, string>>(initialValidationErrors);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const displayError = localError ?? error;
  const displaySuccess = localSuccess ?? success;

  // Filter attachments client-side when provided
  const filteredAttachments = useMemo(() => {
    return attachments.filter((att) => {
      if (statusFilter !== 'ALL' && att.status !== statusFilter) {
        return false;
      }
      if (entityTypeFilter !== 'ALL' && att.entity_type !== entityTypeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = att.file_name.toLowerCase().includes(q);
        const matchesEntity = att.entity_id ? att.entity_id.toLowerCase().includes(q) : false;
        const matchesId = att.id.toLowerCase().includes(q);
        if (!matchesName && !matchesEntity && !matchesId) {
          return false;
        }
      }
      return true;
    });
  }, [attachments, statusFilter, entityTypeFilter, searchQuery]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredAttachments.map((a) => a.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const validateUpload = (): boolean => {
    const errs: Record<string, string> = {};
    if (!fileName.trim()) {
      errs.file_name = 'Tên tệp không được để trống.';
    }
    if (!contentBase64.trim()) {
      errs.content_base64 = 'Nội dung tệp không được để trống.';
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateUpload()) return;
    if (!onUpload) return;

    setActionLoading(true);
    setLocalError(null);
    try {
      await onUpload({
        file_name: fileName.trim(),
        mime_type: mimeType,
        content_base64: contentBase64.trim(),
        entity_type: entityType.trim(),
        entity_id: entityId.trim() || undefined,
        warehouse_id: warehouseId.trim() || undefined,
        branch_id: branchId.trim() || undefined,
      });
      setLocalSuccess('Tải tệp lên thành công.');
      setIsUploadOpen(false);
      setFileName('');
      setContentBase64('');
      setValidationErrors({});
    } catch (err: any) {
      setLocalError(err.message || 'Không thể tải tệp lên.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!activeAttachment || !onDelete) return;
    setActionLoading(true);
    setLocalError(null);
    try {
      await onDelete(activeAttachment.id, true);
      setLocalSuccess(`Đã xóa tệp '${activeAttachment.file_name}'.`);
      setIsDeleteModalOpen(false);
      setActiveAttachment(null);
      setSelectedIds((prev) => prev.filter((id) => id !== activeAttachment.id));
    } catch (err: any) {
      setLocalError(err.message || 'Không thể xóa tệp.');
    } finally {
      setActionLoading(false);
    }
  };

  const applyBulkDeleteOutcome = (
    requestedCount: number,
    outcome: AttachmentBulkActionResult | void
  ) => {
    if (outcome && outcome.failed_ids.length > 0) {
      // Partial failure: surface the per-item results, keep the failed ids selected
      // so the operator can retry exactly the items that were not deleted.
      setBulkPartialFailure(outcome);
      setSelectedIds(outcome.failed_ids);
      setLocalSuccess(
        `Đã xóa ${outcome.success_count} tệp; ${outcome.failure_count} tệp không thành công. Xem chi tiết và thử lại.`
      );
    } else {
      setBulkPartialFailure(null);
      setSelectedIds([]);
      setLocalSuccess(`Đã xử lý xóa ${requestedCount} tệp đính kèm.`);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.length === 0 || !onBulkDelete) return;
    setActionLoading(true);
    setLocalError(null);
    try {
      const outcome = await onBulkDelete(selectedIds, true);
      applyBulkDeleteOutcome(selectedIds.length, outcome);
      setIsBulkDeleteModalOpen(false);
    } catch (err: any) {
      setLocalError(err.message || 'Không thể xóa hàng loạt tệp.');
    } finally {
      setActionLoading(false);
    }
  };

  const retryFailedBulkDelete = async () => {
    if (!onBulkDelete) return;
    const ids =
      selectedIds.length > 0
        ? selectedIds
        : (bulkPartialFailure?.failed_ids ?? []);
    if (ids.length === 0) {
      setBulkPartialFailure(null);
      return;
    }
    setActionLoading(true);
    setLocalError(null);
    try {
      const outcome = await onBulkDelete(ids, true);
      applyBulkDeleteOutcome(ids.length, outcome);
    } catch (err: any) {
      setLocalError(err.message || 'Không thể xóa hàng loạt tệp.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmQuarantine = async () => {
    if (!activeAttachment || !onQuarantine) return;
    setActionLoading(true);
    setLocalError(null);
    try {
      await onQuarantine(activeAttachment.id, quarantineReason || 'Nghi vấn mã độc');
      setLocalSuccess(`Đã cách ly tệp '${activeAttachment.file_name}'.`);
      setIsQuarantineModalOpen(false);
      setActiveAttachment(null);
    } catch (err: any) {
      setLocalError(err.message || 'Không thể cách ly tệp.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunPurge = async () => {
    if (!onPurgeRetention) return;
    setActionLoading(true);
    setLocalError(null);
    try {
      const res = await onPurgeRetention(purgeDryRun);
      setPurgeResult(res);
      setLocalSuccess(
        purgeDryRun
          ? `Kiểm tra dọn dẹp: ${res.success_count} tệp hết hạn.`
          : `Đã dọn dẹp ${res.success_count} tệp hết hạn.`
      );
    } catch (err: any) {
      setLocalError(err.message || 'Không thể chạy dọn dẹp thời hạn lưu trữ.');
    } finally {
      setActionLoading(false);
    }
  };

  // Render Status Badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Hoạt động
          </span>
        );
      case 'QUARANTINED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <ShieldAlert className="w-3 h-3" /> Cách ly
          </span>
        );
      case 'PENDING_DELETION':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3" /> Chờ xóa
          </span>
        );
      case 'DELETED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <Ban className="w-3 h-3" /> Đã xóa
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  // Render Icon according to MIME type
  const renderMimeIcon = (mime: string) => {
    if (mime.startsWith('image/')) {
      return <ImageIcon className="w-5 h-5 text-indigo-500" />;
    }
    if (mime === 'application/pdf') {
      return <FileText className="w-5 h-5 text-rose-500" />;
    }
    return <File className="w-5 h-5 text-slate-500" />;
  };

  return (
    <div className="space-y-6" data-testid="attachment-management-view">
      {/* Top Banner / Feedback Alerts */}
      {displayError && (
        <div
          data-testid="attachment-error-state"
          className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start justify-between gap-3"
          role="alert"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <div className="text-sm font-medium">{displayError}</div>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Thử lại tải dữ liệu"
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-rose-100 text-rose-800 rounded-lg hover:bg-rose-200 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Thử lại
            </button>
          )}
        </div>
      )}

      {displaySuccess && (
        <div
          data-testid="attachment-success-banner"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-between gap-3"
          role="status"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <div className="text-sm font-medium">{displaySuccess}</div>
          </div>
          <button
            type="button"
            onClick={() => setLocalSuccess(null)}
            aria-label="Đóng thông báo"
            className="text-emerald-600 hover:text-emerald-800 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Partial-Failure Recovery State (bulk deletion with per-item failures) */}
      {bulkPartialFailure && (
        <div
          data-testid="attachment-partial-failure-banner"
          className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start justify-between gap-3"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm space-y-1">
              <div className="font-semibold">
                Xóa hàng loạt hoàn thành một phần: {bulkPartialFailure.success_count} tệp thành
                công, {bulkPartialFailure.failure_count} tệp lỗi.
              </div>
              <ul className="text-xs space-y-0.5 list-disc list-inside">
                {bulkPartialFailure.results
                  .filter((r) => r.status === 'FAILED')
                  .map((r) => (
                    <li key={r.id} className="font-mono">
                      {r.id} — {r.code || 'LỖI'}
                    </li>
                  ))}
              </ul>
              <div className="text-xs text-amber-800">
                Các tệp lỗi vẫn được giữ ở trạng thái đã chọn để bạn thử lại.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => void retryFailedBulkDelete()}
              disabled={actionLoading}
              aria-label="Thử lại xóa các tệp lỗi"
              data-testid="retry-failed-bulk-delete"
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg hover:bg-amber-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Thử lại
            </button>
            <button
              type="button"
              onClick={() => setBulkPartialFailure(null)}
              aria-label="Đóng thông báo lỗi một phần"
              className="text-amber-600 hover:text-amber-900 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Access Guard State */}
      {!canEdit && (
        <div
          data-testid="attachment-forbidden-state"
          className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span>
            Bạn đang ở chế độ xem giới hạn. Quyền tải lên và xóa tệp yêu cầu quyền quản trị viên tổ
            chức.
          </span>
        </div>
      )}

      {/* Control Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm tệp, mã thực thể, ID..."
                data-testid="attachment-search-input"
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                aria-label="Làm mới danh sách"
                className="p-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => setIsPurgeModalOpen(true)}
                  aria-label="Dọn dẹp tệp hết hạn"
                  data-testid="open-purge-modal-button"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 transition-colors"
                >
                  <Clock className="w-3.5 h-3.5 text-slate-500" /> Dọn dẹp lưu trữ
                </button>

                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsBulkDeleteModalOpen(true)}
                    aria-label={`Xóa ${selectedIds.length} tệp đã chọn`}
                    data-testid="open-bulk-delete-modal-button"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 rounded-xl hover:bg-rose-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Xóa ({selectedIds.length})
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsUploadOpen(true)}
                  aria-label="Tải tệp mới"
                  data-testid="open-upload-modal-button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-sm transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" /> Tải tệp mới
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-4 text-xs text-slate-600 border-t border-slate-100 pt-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-500">Trạng thái:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              data-testid="status-filter-select"
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="ALL">Tất cả</option>
              <option value="ACTIVE">Hoạt động</option>
              <option value="QUARANTINED">Cách ly</option>
              <option value="PENDING_DELETION">Chờ xóa</option>
              <option value="DELETED">Đã xóa</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-500">Loại thực thể:</span>
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              data-testid="entity-type-filter-select"
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="ALL">Tất cả thực thể</option>
              <option value="GENERAL">Chung (GENERAL)</option>
              <option value="ORDER">Đơn hàng (ORDER)</option>
              <option value="SHIPMENT">Vận đơn (SHIPMENT)</option>
              <option value="CLAIM">Khiếu nại (CLAIM)</option>
              <option value="RETURN">Đơn hoàn (RETURN)</option>
              <option value="STATEMENT">Đối soát (STATEMENT)</option>
              <option value="DISCREPANCY">Lệch soát (DISCREPANCY)</option>
            </select>
          </div>

          {total !== undefined && (
            <div className="ml-auto text-slate-500">
              Tổng số tệp: <span className="font-semibold text-slate-800">{total}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div
          data-testid="attachment-loading-state"
          className="bg-white border border-slate-200 rounded-2xl p-12 text-center"
        >
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent" />
          <p className="mt-3 text-sm text-slate-600 font-medium">
            Đang tải danh sách tệp đính kèm...
          </p>
        </div>
      ) : filteredAttachments.length === 0 ? (
        <div
          data-testid="attachment-empty-state"
          className="bg-white border border-slate-200 rounded-2xl p-12 text-center"
        >
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400 mb-3">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-800">Chưa có tệp đính kèm nào</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Không tìm thấy tệp đính kèm phù hợp với tiêu chí lọc hoặc chưa có tệp nào được tải lên.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              aria-label="Tải tệp đầu tiên"
              data-testid="empty-upload-button"
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> Tải tệp đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div
          data-testid="attachment-list-grid"
          className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider">
                <tr>
                  {canEdit && (
                    <th scope="col" className="p-4 w-4">
                      <input
                        type="checkbox"
                        checked={
                          filteredAttachments.length > 0 &&
                          selectedIds.length === filteredAttachments.length
                        }
                        onChange={handleSelectAll}
                        aria-label="Chọn tất cả tệp"
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3">
                    Tệp tin
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Thực thể
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Kho / Chi nhánh
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Kích thước
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Trạng thái
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Thời gian tạo
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAttachments.map((att) => (
                  <tr
                    key={att.id}
                    data-testid={`attachment-row-${att.id}`}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    {canEdit && (
                      <td className="p-4 w-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(att.id)}
                          onChange={() => handleToggleSelect(att.id)}
                          aria-label={`Chọn tệp ${att.file_name}`}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-slate-800">
                      <div className="flex items-center gap-2.5">
                        {renderMimeIcon(att.mime_type)}
                        <div>
                          <div className="font-semibold truncate max-w-xs">{att.file_name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {att.mime_type}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1 font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                        <Layers className="w-3 h-3 text-slate-500" />
                        <span>{att.entity_type}</span>
                        {att.entity_id && (
                          <span className="text-slate-400">#{att.entity_id.slice(0, 8)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {att.warehouse_id || att.branch_id ? (
                        <div className="space-y-0.5">
                          {att.warehouse_id && (
                            <div className="text-[11px]">
                              Kho: <span className="font-mono">{att.warehouse_id}</span>
                            </div>
                          )}
                          {att.branch_id && (
                            <div className="text-[11px]">
                              Chi nhánh: <span className="font-mono">{att.branch_id}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Toàn tổ chức</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px]">
                      {formatFileSize(att.file_size)}
                    </td>
                    <td className="px-4 py-3">{renderStatusBadge(att.status)}</td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {new Date(att.created_at).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {onDownload && att.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => onDownload(att.id, att.file_name)}
                            aria-label={`Tải xuống tệp ${att.file_name}`}
                            data-testid={`download-button-${att.id}`}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}

                        {canEdit && onQuarantine && att.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveAttachment(att);
                              setIsQuarantineModalOpen(true);
                            }}
                            aria-label={`Cách ly tệp ${att.file_name}`}
                            data-testid={`quarantine-button-${att.id}`}
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <ShieldAlert className="w-4 h-4" />
                          </button>
                        )}

                        {canEdit && onDelete && att.status !== 'DELETED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveAttachment(att);
                              setIsDeleteModalOpen(true);
                            }}
                            aria-label={`Xóa tệp ${att.file_name}`}
                            data-testid={`delete-button-${att.id}`}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {isUploadOpen && (
        <div
          data-testid="upload-attachment-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2
                id="upload-modal-title"
                className="text-base font-semibold text-slate-800 flex items-center gap-2"
              >
                <Upload className="w-5 h-5 text-indigo-600" /> Tải tệp đính kèm mới
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsUploadOpen(false);
                  setValidationErrors({});
                }}
                aria-label="Đóng cửa sổ tải lên"
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {Object.keys(validationErrors).length > 0 && (
              <div
                data-testid="attachment-validation-error"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs space-y-1"
                role="alert"
              >
                {Object.entries(validationErrors).map(([key, msg]) => (
                  <div key={key}>• {msg}</div>
                ))}
              </div>
            )}

            <form onSubmit={handleFileUpload} className="space-y-4">
              <div>
                <label
                  htmlFor="file_name_input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Tên tệp tin *
                </label>
                <input
                  id="file_name_input"
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="vi_du_don_hang.pdf"
                  data-testid="upload-filename-input"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="mime_type_select"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Định dạng MIME *
                  </label>
                  <select
                    id="mime_type_select"
                    value={mimeType}
                    onChange={(e) => setMimeType(e.target.value)}
                    data-testid="upload-mimetype-select"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="image/png">image/png</option>
                    <option value="image/jpeg">image/jpeg</option>
                    <option value="image/webp">image/webp</option>
                    <option value="application/pdf">application/pdf</option>
                    <option value="text/csv">text/csv</option>
                    <option value="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                      Excel (.xlsx)
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="entity_type_select"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Loại thực thể *
                  </label>
                  <select
                    id="entity_type_select"
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value)}
                    data-testid="upload-entity-type-select"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="GENERAL">GENERAL</option>
                    <option value="ORDER">ORDER</option>
                    <option value="SHIPMENT">SHIPMENT</option>
                    <option value="CLAIM">CLAIM</option>
                    <option value="RETURN">RETURN</option>
                    <option value="STATEMENT">STATEMENT</option>
                    <option value="DISCREPANCY">DISCREPANCY</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="entity_id_input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Mã thực thể (UUID hoặc Tracking Code)
                </label>
                <input
                  id="entity_id_input"
                  type="text"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  placeholder="Tùy chọn: order_123, ret-12345..."
                  data-testid="upload-entity-id-input"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="warehouse_id_input"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Kho hàng (Tùy chọn)
                  </label>
                  <input
                    id="warehouse_id_input"
                    type="text"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    placeholder="wh-hcm-01"
                    data-testid="upload-warehouse-id-input"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="branch_id_input"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Chi nhánh (Tùy chọn)
                  </label>
                  <input
                    id="branch_id_input"
                    type="text"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    placeholder="branch-hcm"
                    data-testid="upload-branch-id-input"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="content_base64_input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Dữ liệu Base64 *
                </label>
                <textarea
                  id="content_base64_input"
                  rows={3}
                  value={contentBase64}
                  onChange={(e) => setContentBase64(e.target.value)}
                  placeholder="iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
                  data-testid="upload-base64-input"
                  className="w-full px-3 py-2 font-mono text-[11px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  aria-label="Hủy tải lên"
                  className="px-4 py-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  aria-label="Thực hiện tải tệp"
                  data-testid="submit-upload-button"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? 'Đang tải lên...' : 'Tải lên ngay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && activeAttachment && (
        <div
          data-testid="delete-attachment-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 rounded-xl bg-rose-50 border border-rose-200">
                <Trash2 className="w-5 h-5" />
              </div>
              <h2 id="delete-modal-title" className="text-base font-semibold text-slate-800">
                Xác nhận xóa tệp đính kèm
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Bạn có chắc chắn muốn xóa tệp{' '}
              <strong className="text-slate-800">{activeAttachment.file_name}</strong>? Hành động
              này sẽ xóa dữ liệu khỏi lưu trữ đám mây và đánh dấu tệp là đã xóa vĩnh viễn trong nhật
              ký kiểm toán.
            </p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setActiveAttachment(null);
                }}
                aria-label="Hủy xóa tệp"
                className="px-4 py-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmDelete}
                aria-label="Xác nhận xóa tệp"
                data-testid="confirm-delete-button"
                className="px-4 py-2 text-xs font-semibold bg-rose-600 text-white rounded-xl hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {isBulkDeleteModalOpen && (
        <div
          data-testid="bulk-delete-attachment-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 rounded-xl bg-rose-50 border border-rose-200">
                <Trash2 className="w-5 h-5" />
              </div>
              <h2 id="bulk-delete-title" className="text-base font-semibold text-slate-800">
                Xác nhận xóa hàng loạt
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Bạn đang chuẩn bị xóa đồng thời{' '}
              <strong className="text-slate-800">{selectedIds.length}</strong> tệp đính kèm. Hành
              động này không thể hoàn tác.
            </p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsBulkDeleteModalOpen(false)}
                aria-label="Hủy xóa hàng loạt"
                className="px-4 py-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmBulkDelete}
                aria-label="Xác nhận xóa hàng loạt tệp"
                data-testid="confirm-bulk-delete-button"
                className="px-4 py-2 text-xs font-semibold bg-rose-600 text-white rounded-xl hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? 'Đang xóa...' : `Xóa ${selectedIds.length} tệp`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quarantine Modal */}
      {isQuarantineModalOpen && activeAttachment && (
        <div
          data-testid="quarantine-attachment-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quarantine-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <h2 id="quarantine-modal-title" className="text-base font-semibold text-slate-800">
                Cách ly tệp nghi vấn
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Cách ly tệp <strong className="text-slate-800">{activeAttachment.file_name}</strong>{' '}
              sẽ ngăn chặn người dùng khác tải xuống cho đến khi được kiểm tra an toàn.
            </p>
            <div>
              <label
                htmlFor="quarantine_reason_input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Lý do cách ly
              </label>
              <input
                id="quarantine_reason_input"
                type="text"
                value={quarantineReason}
                onChange={(e) => setQuarantineReason(e.target.value)}
                placeholder="Nghi vấn tệp độc hại hoặc vi phạm chính sách"
                data-testid="quarantine-reason-input"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsQuarantineModalOpen(false);
                  setActiveAttachment(null);
                }}
                aria-label="Hủy cách ly tệp"
                className="px-4 py-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmQuarantine}
                aria-label="Xác nhận cách ly tệp"
                data-testid="confirm-quarantine-button"
                className="px-4 py-2 text-xs font-semibold bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? 'Đang xử lý...' : 'Cách ly ngay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retention Purge Modal */}
      {isPurgeModalOpen && (
        <div
          data-testid="purge-retention-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purge-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-slate-700">
              <div className="p-2 rounded-xl bg-slate-100 border border-slate-200">
                <Clock className="w-5 h-5 text-indigo-600" />
              </div>
              <h2 id="purge-modal-title" className="text-base font-semibold text-slate-800">
                Dọn dẹp thời hạn lưu trữ
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Quá trình này quét và dọn dẹp các tệp đính kèm đã vượt quá thời hạn lưu trữ quy định
              (`expires_at &lt;= Hiện tại`).
            </p>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  Chế độ kiểm tra (Dry run)
                </div>
                <div className="text-[11px] text-slate-500">
                  Chỉ thống kê số lượng mà không thực sự xóa tệp.
                </div>
              </div>
              <input
                type="checkbox"
                checked={purgeDryRun}
                onChange={(e) => setPurgeDryRun(e.target.checked)}
                data-testid="purge-dry-run-checkbox"
                aria-label="Kích hoạt chế độ kiểm tra dọn dẹp"
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
            </div>

            {purgeResult && (
              <div
                data-testid="purge-result-banner"
                className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-900 space-y-1"
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-indigo-600" /> Kết quả quét dọn dẹp:
                </div>
                <div>• Số tệp thành công: {purgeResult.success_count}</div>
                <div>• Số tệp lỗi: {purgeResult.failure_count}</div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsPurgeModalOpen(false);
                  setPurgeResult(null);
                }}
                aria-label="Đóng cửa sổ dọn dẹp"
                className="px-4 py-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleRunPurge}
                aria-label="Thực hiện quét dọn dẹp"
                data-testid="run-purge-button"
                className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading
                  ? 'Đang quét...'
                  : purgeDryRun
                    ? 'Quét kiểm tra'
                    : 'Thực hiện dọn dẹp'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
