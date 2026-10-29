'use client';

import React, { useState, useMemo } from 'react';
import {
  Warehouse as WarehouseIcon,
  Plus,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  X,
  Save,
  Star,
  Phone,
  Mail,
  MapPin,
  Clock,
  Printer,
  Search,
  Power,
  RotateCcw,
  FileText,
} from 'lucide-react';
import type {
  Warehouse,
  CreateWarehouseInput,
  UpdateWarehouseInput,
  WarehouseFormState,
} from '@shipde/contracts';
import {
  validateWarehouseForm,
  ALLOWED_WAREHOUSE_PAPER_SIZES,
  ALLOWED_WAREHOUSE_DPIS,
} from '@shipde/contracts';

export interface WarehouseManagementViewProps {
  warehouses?: Warehouse[];
  loading?: boolean;
  canEdit?: boolean;
  scopedWarehouses?: string[] | null;
  error?: string | null;
  success?: string | null;
  initialFormOpen?: boolean;
  initialEditingWarehouse?: Warehouse | null;
  initialFormState?: Partial<WarehouseFormState>;
  initialValidationErrors?: Record<string, string>;
  initialActiveTab?: 'pickup' | 'return' | 'schedule' | 'printer';
  onRefresh?: () => void;
  onCreate?: (input: CreateWarehouseInput) => Promise<void>;
  onUpdate?: (id: string, input: UpdateWarehouseInput) => Promise<void>;
  onSetDefault?: (id: string) => Promise<void>;
  onActivate?: (id: string) => Promise<void>;
  onDeactivate?: (id: string) => Promise<void>;
}

export function WarehouseManagementView({
  warehouses = [],
  loading = false,
  canEdit = false,
  scopedWarehouses = null,
  error = null,
  success = null,
  initialFormOpen = false,
  initialEditingWarehouse = null,
  initialFormState = {},
  initialValidationErrors = {},
  initialActiveTab = 'pickup',
  onRefresh,
  onCreate,
  onUpdate,
  onSetDefault,
  onActivate,
  onDeactivate,
}: WarehouseManagementViewProps) {
  // Filter & Search states
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal / Form state
  const [isFormOpen, setIsFormOpen] = useState(initialFormOpen);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(
    initialEditingWarehouse
  );
  const [activeTab, setActiveTab] = useState<'pickup' | 'return' | 'schedule' | 'printer'>(
    initialActiveTab
  );
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Form field states
  const [formState, setFormState] = useState<WarehouseFormState>({
    name: initialEditingWarehouse?.name || initialFormState.name || '',
    code: initialEditingWarehouse?.code || initialFormState.code || '',
    status:
      (initialEditingWarehouse?.status as 'active' | 'inactive') ||
      initialFormState.status ||
      'active',
    is_default:
      initialEditingWarehouse?.is_default ?? initialFormState.is_default ?? warehouses.length === 0,
    contact_name: initialEditingWarehouse?.contact_name || initialFormState.contact_name || '',
    contact_phone: initialEditingWarehouse?.contact_phone || initialFormState.contact_phone || '',
    contact_email: initialEditingWarehouse?.contact_email || initialFormState.contact_email || '',
    address_line: initialEditingWarehouse?.address_line || initialFormState.address_line || '',
    ward: initialEditingWarehouse?.ward || initialFormState.ward || '',
    district: initialEditingWarehouse?.district || initialFormState.district || '',
    city: initialEditingWarehouse?.city || initialFormState.city || '',
    postal_code: initialEditingWarehouse?.postal_code || initialFormState.postal_code || '',
    use_different_return_address:
      initialEditingWarehouse?.use_different_return_address ??
      initialFormState.use_different_return_address ??
      false,
    return_contact_name:
      initialEditingWarehouse?.return_contact_name || initialFormState.return_contact_name || '',
    return_contact_phone:
      initialEditingWarehouse?.return_contact_phone || initialFormState.return_contact_phone || '',
    return_address_line:
      initialEditingWarehouse?.return_address_line || initialFormState.return_address_line || '',
    return_ward: initialEditingWarehouse?.return_ward || initialFormState.return_ward || '',
    return_district:
      initialEditingWarehouse?.return_district || initialFormState.return_district || '',
    return_city: initialEditingWarehouse?.return_city || initialFormState.return_city || '',
    cutoff_time: initialEditingWarehouse?.cutoff_time || initialFormState.cutoff_time || '',
    schedule_notes:
      initialEditingWarehouse?.schedule_notes || initialFormState.schedule_notes || '',
    printer_paper_size:
      (initialEditingWarehouse?.printer_paper_size as 'A6' | 'A5' | 'A4' | 'K80') ||
      initialFormState.printer_paper_size ||
      'A6',
    printer_dpi:
      (initialEditingWarehouse?.printer_dpi as 203 | 300) || initialFormState.printer_dpi || 203,
    printer_name: initialEditingWarehouse?.printer_name || initialFormState.printer_name || '',
    printer_auto_print:
      initialEditingWarehouse?.printer_auto_print ?? initialFormState.printer_auto_print ?? false,
  });

  const [validationErrors, setValidationErrors] =
    useState<Record<string, string>>(initialValidationErrors);
  const [modalError, setModalError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const viewError = localError ?? error;
  const viewSuccess = localSuccess ?? success;
  const setViewError = (val: string | null) => setLocalError(val);
  const setViewSuccess = (val: string | null) => setLocalSuccess(val);

  // Filtered warehouses
  const filteredWarehouses = useMemo(() => {
    return warehouses.filter((wh) => {
      if (statusFilter !== 'ALL' && wh.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = wh.name.toLowerCase().includes(q);
        const matchCode = wh.code.toLowerCase().includes(q);
        const matchContact = wh.contact_name.toLowerCase().includes(q);
        const matchPhone = wh.contact_phone.includes(q);
        const matchCity = wh.city.toLowerCase().includes(q);
        const matchDistrict = wh.district.toLowerCase().includes(q);
        const matchAddress = wh.address_line.toLowerCase().includes(q);
        return (
          matchName ||
          matchCode ||
          matchContact ||
          matchPhone ||
          matchCity ||
          matchDistrict ||
          matchAddress
        );
      }
      return true;
    });
  }, [warehouses, statusFilter, searchQuery]);

  const activeCount = useMemo(
    () => warehouses.filter((w) => w.status === 'active').length,
    [warehouses]
  );
  const inactiveCount = useMemo(
    () => warehouses.filter((w) => w.status === 'inactive').length,
    [warehouses]
  );

  const isRestrictedScope = useMemo(() => {
    return (
      Array.isArray(scopedWarehouses) &&
      scopedWarehouses.length > 0 &&
      !scopedWarehouses.includes('*')
    );
  }, [scopedWarehouses]);

  // Open Create Form
  const handleOpenCreate = () => {
    if (!canEdit) return;
    setEditingWarehouse(null);
    setActiveTab('pickup');
    setFormState({
      name: '',
      code: '',
      status: 'active',
      is_default: warehouses.length === 0,
      contact_name: '',
      contact_phone: '',
      contact_email: '',
      address_line: '',
      ward: '',
      district: '',
      city: '',
      postal_code: '',
      use_different_return_address: false,
      return_contact_name: '',
      return_contact_phone: '',
      return_address_line: '',
      return_ward: '',
      return_district: '',
      return_city: '',
      cutoff_time: '',
      schedule_notes: '',
      printer_paper_size: 'A6',
      printer_dpi: 203,
      printer_name: '',
      printer_auto_print: false,
    });
    setValidationErrors({});
    setModalError(null);
    setIsFormOpen(true);
  };

  // Open Edit Form
  const handleOpenEdit = (wh: Warehouse) => {
    if (!canEdit) return;
    setEditingWarehouse(wh);
    setActiveTab('pickup');
    setFormState({
      name: wh.name,
      code: wh.code,
      status: wh.status as 'active' | 'inactive',
      is_default: wh.is_default,
      contact_name: wh.contact_name,
      contact_phone: wh.contact_phone,
      contact_email: wh.contact_email || '',
      address_line: wh.address_line,
      ward: wh.ward || '',
      district: wh.district,
      city: wh.city,
      postal_code: wh.postal_code || '',
      use_different_return_address: wh.use_different_return_address,
      return_contact_name: wh.return_contact_name || '',
      return_contact_phone: wh.return_contact_phone || '',
      return_address_line: wh.return_address_line || '',
      return_ward: wh.return_ward || '',
      return_district: wh.return_district || '',
      return_city: wh.return_city || '',
      cutoff_time: wh.cutoff_time || '',
      schedule_notes: wh.schedule_notes || '',
      printer_paper_size: (wh.printer_paper_size as 'A6' | 'A5' | 'A4' | 'K80') || 'A6',
      printer_dpi: (wh.printer_dpi as 203 | 300) || 203,
      printer_name: wh.printer_name || '',
      printer_auto_print: wh.printer_auto_print,
    });
    setValidationErrors({});
    setModalError(null);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingWarehouse(null);
    setValidationErrors({});
    setModalError(null);
  };

  const handleFormFieldChange = <K extends keyof WarehouseFormState>(
    field: K,
    value: WarehouseFormState[K]
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    const validation = validateWarehouseForm(formState);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      // Switch to tab with first error
      if (
        validation.errors.name ||
        validation.errors.code ||
        validation.errors.contact_name ||
        validation.errors.contact_phone ||
        validation.errors.contact_email ||
        validation.errors.address_line ||
        validation.errors.district ||
        validation.errors.city
      ) {
        setActiveTab('pickup');
      } else if (
        validation.errors.return_contact_name ||
        validation.errors.return_contact_phone ||
        validation.errors.return_address_line ||
        validation.errors.return_district ||
        validation.errors.return_city
      ) {
        setActiveTab('return');
      } else if (validation.errors.cutoff_time) {
        setActiveTab('schedule');
      } else if (validation.errors.printer_paper_size || validation.errors.printer_dpi) {
        setActiveTab('printer');
      }
      return;
    }

    setSubmitting(true);
    setModalError(null);

    try {
      if (editingWarehouse) {
        const updatePayload: UpdateWarehouseInput = {
          name: formState.name.trim(),
          code: formState.code.trim() || undefined,
          status: formState.status,
          is_default: formState.is_default,
          contact_name: formState.contact_name.trim(),
          contact_phone: formState.contact_phone.trim(),
          contact_email: formState.contact_email.trim() || null,
          address_line: formState.address_line.trim(),
          ward: formState.ward.trim() || null,
          district: formState.district.trim(),
          city: formState.city.trim(),
          postal_code: formState.postal_code.trim() || null,
          use_different_return_address: formState.use_different_return_address,
          return_contact_name: formState.use_different_return_address
            ? formState.return_contact_name.trim() || null
            : null,
          return_contact_phone: formState.use_different_return_address
            ? formState.return_contact_phone.trim() || null
            : null,
          return_address_line: formState.use_different_return_address
            ? formState.return_address_line.trim() || null
            : null,
          return_ward: formState.use_different_return_address
            ? formState.return_ward.trim() || null
            : null,
          return_district: formState.use_different_return_address
            ? formState.return_district.trim() || null
            : null,
          return_city: formState.use_different_return_address
            ? formState.return_city.trim() || null
            : null,
          cutoff_time: formState.cutoff_time.trim() || null,
          schedule_notes: formState.schedule_notes.trim() || null,
          printer_paper_size: formState.printer_paper_size,
          printer_dpi: formState.printer_dpi,
          printer_name: formState.printer_name.trim() || null,
          printer_auto_print: formState.printer_auto_print,
        };

        if (!onUpdate) {
          throw new Error('Chức năng cập nhật kho hàng chưa được hỗ trợ.');
        }
        await onUpdate(editingWarehouse.id, updatePayload);
        setViewSuccess(`Đã cập nhật kho hàng "${formState.name}" thành công.`);
      } else {
        const createPayload: CreateWarehouseInput = {
          name: formState.name.trim(),
          code: formState.code.trim() || undefined,
          is_default: formState.is_default,
          contact_name: formState.contact_name.trim(),
          contact_phone: formState.contact_phone.trim(),
          contact_email: formState.contact_email.trim() || null,
          address_line: formState.address_line.trim(),
          ward: formState.ward.trim() || null,
          district: formState.district.trim(),
          city: formState.city.trim(),
          postal_code: formState.postal_code.trim() || null,
          use_different_return_address: formState.use_different_return_address,
          return_contact_name: formState.use_different_return_address
            ? formState.return_contact_name.trim() || null
            : null,
          return_contact_phone: formState.use_different_return_address
            ? formState.return_contact_phone.trim() || null
            : null,
          return_address_line: formState.use_different_return_address
            ? formState.return_address_line.trim() || null
            : null,
          return_ward: formState.use_different_return_address
            ? formState.return_ward.trim() || null
            : null,
          return_district: formState.use_different_return_address
            ? formState.return_district.trim() || null
            : null,
          return_city: formState.use_different_return_address
            ? formState.return_city.trim() || null
            : null,
          cutoff_time: formState.cutoff_time.trim() || null,
          schedule_notes: formState.schedule_notes.trim() || null,
          printer_paper_size: formState.printer_paper_size,
          printer_dpi: formState.printer_dpi,
          printer_name: formState.printer_name.trim() || null,
          printer_auto_print: formState.printer_auto_print,
        };

        if (!onCreate) {
          throw new Error('Chức năng thêm mới kho hàng chưa được hỗ trợ.');
        }
        await onCreate(createPayload);
        setViewSuccess(`Đã thêm mới kho hàng "${formState.name}" thành công.`);
      }

      handleCloseForm();
    } catch (err: any) {
      setModalError(err?.message || 'Có lỗi xảy ra khi lưu kho hàng.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefaultAction = async (wh: Warehouse) => {
    if (!canEdit || wh.is_default || !onSetDefault) return;
    setActionLoadingId(wh.id);
    setViewError(null);
    try {
      await onSetDefault(wh.id);
      setViewSuccess(`Đã đặt kho "${wh.name}" làm kho mặc định.`);
    } catch (err: any) {
      setViewError(err?.message || 'Không thể đặt kho mặc định.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleStatusAction = async (wh: Warehouse) => {
    if (!canEdit) return;
    setActionLoadingId(wh.id);
    setViewError(null);
    try {
      if (wh.status === 'active') {
        if (onDeactivate) {
          await onDeactivate(wh.id);
          setViewSuccess(`Đã tạm ngưng kho hàng "${wh.name}".`);
        }
      } else {
        if (onActivate) {
          await onActivate(wh.id);
          setViewSuccess(`Đã kích hoạt kho hàng "${wh.name}".`);
        }
      }
    } catch (err: any) {
      setViewError(err?.message || 'Không thể thay đổi trạng thái kho hàng.');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications: Server Error Banner */}
      {viewError && (
        <div
          data-testid="warehouse-error-banner"
          className="flex items-start justify-between gap-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <div className="text-xs">
              <span className="font-bold">Lỗi vận hành: </span>
              <span>{viewError}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                data-testid="retry-error-button"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-rose-300 rounded-lg text-rose-700 hover:bg-rose-100 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Thử lại</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewError(null)}
              data-testid="dismiss-error-button"
              className="p-1 hover:bg-rose-100 rounded-lg text-rose-600 transition cursor-pointer"
              aria-label="Đóng thông báo lỗi"
              title="Đóng thông báo lỗi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Notifications: Success Notification Banner */}
      {viewSuccess && (
        <div
          data-testid="warehouse-success-banner"
          className="flex items-start justify-between gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="text-xs font-semibold">{viewSuccess}</div>
          </div>
          <button
            type="button"
            onClick={() => setViewSuccess(null)}
            data-testid="dismiss-success-button"
            className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-600 transition cursor-pointer"
            aria-label="Đóng thông báo thành công"
            title="Đóng thông báo thành công"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Scoped Access Banner */}
      {isRestrictedScope && (
        <div
          data-testid="warehouse-scoped-banner"
          className="flex items-center gap-3 p-3.5 bg-sky-50 border border-sky-200 rounded-2xl text-sky-800 text-xs"
        >
          <ShieldAlert className="w-4 h-4 text-sky-600 shrink-0" />
          <div>
            <span className="font-bold">Phạm vi kho hàng theo phân quyền: </span>
            <span>
              Tài khoản của bạn được giới hạn thao tác trong danh sách kho được phân quyền (
              {scopedWarehouses?.join(', ')}).
            </span>
          </div>
        </div>
      )}

      {/* Forbidden Banner (View-Only Mode) */}
      {!canEdit && (
        <div
          data-testid="warehouse-forbidden-banner"
          className="flex items-center gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs"
        >
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <span className="font-bold">Giới hạn quyền cấu hình kho hàng: </span>
            <span>
              Bạn chỉ có quyền xem danh sách kho. Quyền tạo, cập nhật hoặc thay đổi kho mặc định yêu
              cầu quyền quản trị viên hoặc iam:shop_config.
            </span>
          </div>
        </div>
      )}

      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
            <WarehouseIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800">Quản lý Chi nhánh &amp; Kho hàng</h1>
            <p className="text-xs text-slate-500">
              Thiết lập địa chỉ lấy hàng, địa chỉ hoàn, lịch lấy hàng và cấu hình in nhãn bưu gửi
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              data-testid="refresh-warehouses-button"
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer disabled:opacity-50"
              aria-label="Làm mới danh sách kho hàng"
              title="Làm mới danh sách"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={handleOpenCreate}
              data-testid="create-warehouse-button"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm kho mới</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            id="input-search-warehouse"
            aria-label="Tìm kiếm kho hàng"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên kho, mã kho, người liên hệ, địa chỉ..."
            data-testid="input-search-warehouse"
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-status" className="text-xs text-slate-500 font-medium">
            Trạng thái:
          </label>
          <select
            id="filter-status"
            aria-label="Lọc theo trạng thái kho hàng"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            data-testid="filter-status"
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium focus:bg-white focus:outline-hidden focus:border-orange-500 transition"
          >
            <option value="ALL">Tất cả ({warehouses.length})</option>
            <option value="active">Đang hoạt động ({activeCount})</option>
            <option value="inactive">Tạm ngưng ({inactiveCount})</option>
          </select>
        </div>
      </div>

      {/* Loading Skeleton State */}
      {loading && (
        <div data-testid="warehouse-loading-state" className="space-y-4">
          <div className="p-8 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
            <p className="text-xs font-semibold text-slate-600">Đang tải danh sách kho hàng...</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 animate-pulse"
              >
                <div className="h-4 bg-slate-200 rounded-md w-1/3" />
                <div className="h-3 bg-slate-100 rounded-md w-2/3" />
                <div className="h-3 bg-slate-100 rounded-md w-1/2" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredWarehouses.length === 0 && (
        <div
          data-testid="warehouse-empty-state"
          className="p-12 bg-white border border-dashed border-slate-300 rounded-2xl text-center space-y-4"
        >
          <div className="w-12 h-12 mx-auto rounded-full bg-orange-50 text-orange-500 flex items-center justify-center">
            <WarehouseIcon className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-800">
              {searchQuery || statusFilter !== 'ALL'
                ? 'Không tìm thấy kho hàng phù hợp'
                : 'Chưa có kho hàng nào được thiết lập'}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {searchQuery || statusFilter !== 'ALL'
                ? 'Thử thay đổi từ khóa tìm kiếm hoặc bỏ bộ lọc trạng thái để xem đầy đủ.'
                : 'Tạo kho hàng đầu tiên để bắt đầu tạo vận đơn, thiết lập điểm lấy hàng và địa chỉ hoàn trả.'}
            </p>
          </div>
          {canEdit && !searchQuery && statusFilter === 'ALL' && (
            <button
              type="button"
              onClick={handleOpenCreate}
              data-testid="empty-create-warehouse-button"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm kho hàng đầu tiên</span>
            </button>
          )}
        </div>
      )}

      {/* List / Grid Cards */}
      {!loading && filteredWarehouses.length > 0 && (
        <div data-testid="warehouse-list-state" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredWarehouses.map((wh) => {
            const isActionBusy = actionLoadingId === wh.id;
            return (
              <div
                key={wh.id}
                data-testid={`warehouse-card-${wh.id}`}
                className={`bg-white border rounded-2xl p-5 shadow-xs transition space-y-4 ${
                  wh.is_default
                    ? 'border-orange-300/80 ring-1 ring-orange-200/50'
                    : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900">{wh.name}</span>
                      <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 text-slate-600 rounded-md">
                        {wh.code}
                      </span>
                      {wh.is_default && (
                        <span
                          data-testid={`badge-default-warehouse-${wh.id}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 rounded-md"
                        >
                          <Star className="w-3 h-3 fill-orange-500 text-orange-500" />
                          <span>Kho mặc định</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        data-testid={`badge-status-warehouse-${wh.id}`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md ${
                          wh.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            wh.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        <span>{wh.status === 'active' ? 'Đang hoạt động' : 'Tạm ngưng'}</span>
                      </span>
                    </div>
                  </div>

                  {/* Top Action Buttons */}
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(wh)}
                        data-testid={`edit-warehouse-button-${wh.id}`}
                        className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                        aria-label={`Chỉnh sửa kho ${wh.name}`}
                        title="Chỉnh sửa kho"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Pickup Address Section */}
                <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-orange-600" />
                    <span>Địa chỉ lấy hàng (Pickup):</span>
                  </div>
                  <p className="pl-5 text-slate-700 font-medium">
                    {wh.address_line}
                    {wh.ward ? `, ${wh.ward}` : ''}, {wh.district}, {wh.city}
                    {wh.postal_code ? ` (Mã bưu chính: ${wh.postal_code})` : ''}
                  </p>
                  <div className="pl-5 flex items-center gap-4 text-slate-500 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <span className="font-medium text-slate-700">{wh.contact_name}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" />
                      <span>{wh.contact_phone}</span>
                    </span>
                    {wh.contact_email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-400" />
                        <span>{wh.contact_email}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Return Address Section */}
                <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Địa chỉ nhận hoàn (Return):</span>
                  </div>
                  {wh.use_different_return_address ? (
                    <div className="pl-5 space-y-1">
                      <p className="text-slate-700 font-medium">
                        {wh.return_address_line}
                        {wh.return_ward ? `, ${wh.return_ward}` : ''}, {wh.return_district},{' '}
                        {wh.return_city}
                      </p>
                      <div className="flex items-center gap-4 text-slate-500">
                        {wh.return_contact_name && (
                          <span className="font-medium text-slate-700">
                            {wh.return_contact_name}
                          </span>
                        )}
                        {wh.return_contact_phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{wh.return_contact_phone}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="pl-5 text-slate-500 italic">Cùng địa chỉ với điểm lấy hàng</p>
                  )}
                </div>

                {/* Schedule & Printer Settings Overview */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                  {/* Schedule */}
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-700 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Lịch lấy hàng:</span>
                    </div>
                    <div>
                      {wh.cutoff_time ? (
                        <span>
                          Giờ cắt ca lấy:{' '}
                          <span className="font-bold text-slate-800">{wh.cutoff_time}</span>
                        </span>
                      ) : (
                        <span className="italic">Chưa cài đặt giờ cắt ca</span>
                      )}
                    </div>
                    {wh.schedule_notes && (
                      <p className="text-slate-600 line-clamp-1" title={wh.schedule_notes}>
                        Ghi chú: {wh.schedule_notes}
                      </p>
                    )}
                  </div>

                  {/* Printer */}
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-700 flex items-center gap-1">
                      <Printer className="w-3 h-3 text-slate-400" />
                      <span>In nhãn nhiệt:</span>
                    </div>
                    <div>
                      Khổ giấy:{' '}
                      <span className="font-bold text-slate-800">{wh.printer_paper_size}</span> (
                      {wh.printer_dpi} DPI)
                      {wh.printer_name && (
                        <span className="text-slate-500 font-normal"> - {wh.printer_name}</span>
                      )}
                    </div>
                    {wh.printer_auto_print && (
                      <div className="text-emerald-600 font-semibold">Tự động in khi duyệt đơn</div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                {canEdit && (
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
                    <div>
                      {!wh.is_default && (
                        <button
                          type="button"
                          onClick={() => handleSetDefaultAction(wh)}
                          data-testid={`set-default-warehouse-button-${wh.id}`}
                          disabled={isActionBusy}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-lg transition cursor-pointer disabled:opacity-50"
                        >
                          <Star className="w-3.5 h-3.5" />
                          <span>Đặt làm mặc định</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleStatusAction(wh)}
                        data-testid={
                          wh.status === 'active'
                            ? `deactivate-warehouse-button-${wh.id}`
                            : `activate-warehouse-button-${wh.id}`
                        }
                        disabled={isActionBusy}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer disabled:opacity-50 ${
                          wh.status === 'active'
                            ? 'text-slate-600 hover:text-rose-700 hover:bg-rose-50'
                            : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{wh.status === 'active' ? 'Tạm ngưng' : 'Kích hoạt lại'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Dialog Form (Create / Edit) */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="warehouse-modal-title"
          data-testid="warehouse-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
                  <WarehouseIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="warehouse-modal-title" className="text-sm font-bold text-slate-900">
                    {editingWarehouse ? 'Chỉnh sửa kho hàng' : 'Thêm mới kho hàng'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {editingWarehouse
                      ? `Cập nhật thông tin kho ${editingWarehouse.name} (${editingWarehouse.code})`
                      : 'Khai báo thông tin kho gửi hàng, nhận hoàn và cấu hình in nhãn'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseForm}
                data-testid="close-modal-button"
                disabled={submitting}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                aria-label="Đóng cửa sổ"
                title="Đóng cửa sổ"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Error Notification */}
            {modalError && (
              <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Modal Navigation Tabs */}
            <div className="flex items-center border-b border-slate-200 px-6 bg-white overflow-x-auto text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('pickup')}
                data-testid="tab-pickup"
                className={`py-3 px-3 font-bold border-b-2 transition whitespace-nowrap cursor-pointer ${
                  activeTab === 'pickup'
                    ? 'border-orange-600 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                1. Thông tin &amp; Địa chỉ lấy
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('return')}
                data-testid="tab-return"
                className={`py-3 px-3 font-bold border-b-2 transition whitespace-nowrap cursor-pointer ${
                  activeTab === 'return'
                    ? 'border-orange-600 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                2. Địa chỉ hoàn hàng
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                data-testid="tab-schedule"
                className={`py-3 px-3 font-bold border-b-2 transition whitespace-nowrap cursor-pointer ${
                  activeTab === 'schedule'
                    ? 'border-orange-600 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                3. Lịch hoạt động
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('printer')}
                data-testid="tab-printer"
                className={`py-3 px-3 font-bold border-b-2 transition whitespace-nowrap cursor-pointer ${
                  activeTab === 'printer'
                    ? 'border-orange-600 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                4. Cấu hình in nhãn
              </button>
            </div>

            {/* Form Container */}
            <form
              onSubmit={handleSubmitForm}
              className="p-6 space-y-4 max-h-[60vh] overflow-y-auto"
            >
              {/* TAB 1: Pickup Information & Address */}
              {activeTab === 'pickup' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Warehouse Name */}
                    <div>
                      <label
                        htmlFor="input-warehouse-name"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Tên kho hàng <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        id="input-warehouse-name"
                        value={formState.name}
                        onChange={(e) => handleFormFieldChange('name', e.target.value)}
                        placeholder="VD: Kho Tổng TP.HCM, Kho Hà Nội..."
                        data-testid="input-warehouse-name"
                        className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                          validationErrors.name
                            ? 'border-rose-400 bg-rose-50/20'
                            : 'border-slate-300'
                        }`}
                      />
                      {validationErrors.name && (
                        <p
                          className="text-[11px] font-semibold text-rose-600 mt-1"
                          data-testid="error-warehouse-name"
                        >
                          {validationErrors.name}
                        </p>
                      )}
                    </div>

                    {/* Warehouse Code */}
                    <div>
                      <label
                        htmlFor="input-warehouse-code"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Mã kho hàng (Mã định danh)
                      </label>
                      <input
                        type="text"
                        id="input-warehouse-code"
                        value={formState.code}
                        onChange={(e) => handleFormFieldChange('code', e.target.value)}
                        placeholder="VD: KHO_HCM_01 (tự sinh nếu để trống)"
                        data-testid="input-warehouse-code"
                        className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                          validationErrors.code
                            ? 'border-rose-400 bg-rose-50/20'
                            : 'border-slate-300'
                        }`}
                      />
                      {validationErrors.code && (
                        <p
                          className="text-[11px] font-semibold text-rose-600 mt-1"
                          data-testid="error-warehouse-code"
                        >
                          {validationErrors.code}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Contact Name & Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="input-warehouse-contact-name"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Người liên hệ tại kho <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        id="input-warehouse-contact-name"
                        value={formState.contact_name}
                        onChange={(e) => handleFormFieldChange('contact_name', e.target.value)}
                        placeholder="Họ và tên thủ kho / quản lý"
                        data-testid="input-warehouse-contact-name"
                        className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                          validationErrors.contact_name
                            ? 'border-rose-400 bg-rose-50/20'
                            : 'border-slate-300'
                        }`}
                      />
                      {validationErrors.contact_name && (
                        <p
                          className="text-[11px] font-semibold text-rose-600 mt-1"
                          data-testid="error-warehouse-contact-name"
                        >
                          {validationErrors.contact_name}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="input-warehouse-contact-phone"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Số điện thoại liên hệ <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        id="input-warehouse-contact-phone"
                        value={formState.contact_phone}
                        onChange={(e) => handleFormFieldChange('contact_phone', e.target.value)}
                        placeholder="VD: 0901234567"
                        data-testid="input-warehouse-contact-phone"
                        className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                          validationErrors.contact_phone
                            ? 'border-rose-400 bg-rose-50/20'
                            : 'border-slate-300'
                        }`}
                      />
                      {validationErrors.contact_phone && (
                        <p
                          className="text-[11px] font-semibold text-rose-600 mt-1"
                          data-testid="error-warehouse-contact-phone"
                        >
                          {validationErrors.contact_phone}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Contact Email */}
                  <div>
                    <label
                      htmlFor="input-warehouse-contact-email"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Email liên hệ kho (tùy chọn)
                    </label>
                    <input
                      type="email"
                      id="input-warehouse-contact-email"
                      value={formState.contact_email}
                      onChange={(e) => handleFormFieldChange('contact_email', e.target.value)}
                      placeholder="kho@example.com"
                      data-testid="input-warehouse-contact-email"
                      className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                        validationErrors.contact_email
                          ? 'border-rose-400 bg-rose-50/20'
                          : 'border-slate-300'
                      }`}
                    />
                    {validationErrors.contact_email && (
                      <p
                        className="text-[11px] font-semibold text-rose-600 mt-1"
                        data-testid="error-warehouse-contact-email"
                      >
                        {validationErrors.contact_email}
                      </p>
                    )}
                  </div>

                  {/* Street Address */}
                  <div>
                    <label
                      htmlFor="input-warehouse-address-line"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Địa chỉ số nhà, tên đường lấy hàng <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      id="input-warehouse-address-line"
                      value={formState.address_line}
                      onChange={(e) => handleFormFieldChange('address_line', e.target.value)}
                      placeholder="Số nhà, tên đường, tòa nhà hoặc cụm công nghiệp..."
                      data-testid="input-warehouse-address-line"
                      className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                        validationErrors.address_line
                          ? 'border-rose-400 bg-rose-50/20'
                          : 'border-slate-300'
                      }`}
                    />
                    {validationErrors.address_line && (
                      <p
                        className="text-[11px] font-semibold text-rose-600 mt-1"
                        data-testid="error-warehouse-address-line"
                      >
                        {validationErrors.address_line}
                      </p>
                    )}
                  </div>

                  {/* Ward, District, City */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label
                        htmlFor="input-warehouse-ward"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Phường / Xã
                      </label>
                      <input
                        type="text"
                        id="input-warehouse-ward"
                        value={formState.ward}
                        onChange={(e) => handleFormFieldChange('ward', e.target.value)}
                        placeholder="Phường/Xã"
                        data-testid="input-warehouse-ward"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="input-warehouse-district"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Quận / Huyện <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        id="input-warehouse-district"
                        value={formState.district}
                        onChange={(e) => handleFormFieldChange('district', e.target.value)}
                        placeholder="Quận/Huyện"
                        data-testid="input-warehouse-district"
                        className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                          validationErrors.district
                            ? 'border-rose-400 bg-rose-50/20'
                            : 'border-slate-300'
                        }`}
                      />
                      {validationErrors.district && (
                        <p
                          className="text-[11px] font-semibold text-rose-600 mt-1"
                          data-testid="error-warehouse-district"
                        >
                          {validationErrors.district}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="input-warehouse-city"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Tỉnh / Thành phố <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        id="input-warehouse-city"
                        value={formState.city}
                        onChange={(e) => handleFormFieldChange('city', e.target.value)}
                        placeholder="Tỉnh/Thành phố"
                        data-testid="input-warehouse-city"
                        className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                          validationErrors.city
                            ? 'border-rose-400 bg-rose-50/20'
                            : 'border-slate-300'
                        }`}
                      />
                      {validationErrors.city && (
                        <p
                          className="text-[11px] font-semibold text-rose-600 mt-1"
                          data-testid="error-warehouse-city"
                        >
                          {validationErrors.city}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Default & Status Checkboxes */}
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <label
                      htmlFor="checkbox-warehouse-default"
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        id="checkbox-warehouse-default"
                        checked={formState.is_default}
                        onChange={(e) => handleFormFieldChange('is_default', e.target.checked)}
                        data-testid="checkbox-warehouse-default"
                        className="w-4 h-4 rounded-sm border-slate-300 text-orange-600 focus:ring-orange-500"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-800">
                          Đặt làm kho lấy hàng mặc định
                        </span>
                        <p className="text-[10px] text-slate-500">
                          Kho này sẽ được tự động chọn khi tạo vận đơn mới.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 2: Return Address Configuration */}
              {activeTab === 'return' && (
                <div className="space-y-4">
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <label
                      htmlFor="checkbox-warehouse-different-return"
                      className="flex items-center gap-2.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        id="checkbox-warehouse-different-return"
                        checked={formState.use_different_return_address}
                        onChange={(e) =>
                          handleFormFieldChange('use_different_return_address', e.target.checked)
                        }
                        data-testid="checkbox-warehouse-different-return"
                        className="w-4 h-4 rounded-sm border-slate-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        Sử dụng địa chỉ hoàn hàng riêng biệt
                      </span>
                    </label>
                    <p className="text-[11px] text-slate-500 pl-6.5">
                      Nếu không kích hoạt, khi phát sinh bưu gửi trả hàng/thất bại, bưu tá sẽ trả
                      hàng về chính địa chỉ lấy hàng ở Bước 1.
                    </p>
                  </div>

                  {formState.use_different_return_address && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="input-warehouse-return-contact-name"
                            className="block text-xs font-bold text-slate-700 mb-1"
                          >
                            Người nhận hàng hoàn <span className="text-rose-600">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-warehouse-return-contact-name"
                            value={formState.return_contact_name}
                            onChange={(e) =>
                              handleFormFieldChange('return_contact_name', e.target.value)
                            }
                            placeholder="Tên bộ phận / người nhận hoàn"
                            data-testid="input-warehouse-return-contact-name"
                            className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                              validationErrors.return_contact_name
                                ? 'border-rose-400 bg-rose-50/20'
                                : 'border-slate-300'
                            }`}
                          />
                          {validationErrors.return_contact_name && (
                            <p
                              className="text-[11px] font-semibold text-rose-600 mt-1"
                              data-testid="error-warehouse-return-contact-name"
                            >
                              {validationErrors.return_contact_name}
                            </p>
                          )}
                        </div>

                        <div>
                          <label
                            htmlFor="input-warehouse-return-contact-phone"
                            className="block text-xs font-bold text-slate-700 mb-1"
                          >
                            SĐT nhận hoàn <span className="text-rose-600">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-warehouse-return-contact-phone"
                            value={formState.return_contact_phone}
                            onChange={(e) =>
                              handleFormFieldChange('return_contact_phone', e.target.value)
                            }
                            placeholder="VD: 0909888999"
                            data-testid="input-warehouse-return-contact-phone"
                            className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                              validationErrors.return_contact_phone
                                ? 'border-rose-400 bg-rose-50/20'
                                : 'border-slate-300'
                            }`}
                          />
                          {validationErrors.return_contact_phone && (
                            <p
                              className="text-[11px] font-semibold text-rose-600 mt-1"
                              data-testid="error-warehouse-return-contact-phone"
                            >
                              {validationErrors.return_contact_phone}
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="input-warehouse-return-address-line"
                          className="block text-xs font-bold text-slate-700 mb-1"
                        >
                          Địa chỉ hoàn hàng chi tiết <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="text"
                          id="input-warehouse-return-address-line"
                          value={formState.return_address_line}
                          onChange={(e) =>
                            handleFormFieldChange('return_address_line', e.target.value)
                          }
                          placeholder="Số nhà, đường điểm nhận hoàn..."
                          data-testid="input-warehouse-return-address-line"
                          className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                            validationErrors.return_address_line
                              ? 'border-rose-400 bg-rose-50/20'
                              : 'border-slate-300'
                          }`}
                        />
                        {validationErrors.return_address_line && (
                          <p
                            className="text-[11px] font-semibold text-rose-600 mt-1"
                            data-testid="error-warehouse-return-address-line"
                          >
                            {validationErrors.return_address_line}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label
                            htmlFor="input-warehouse-return-ward"
                            className="block text-xs font-bold text-slate-700 mb-1"
                          >
                            Phường / Xã
                          </label>
                          <input
                            type="text"
                            id="input-warehouse-return-ward"
                            value={formState.return_ward}
                            onChange={(e) => handleFormFieldChange('return_ward', e.target.value)}
                            placeholder="Phường/Xã"
                            data-testid="input-warehouse-return-ward"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="input-warehouse-return-district"
                            className="block text-xs font-bold text-slate-700 mb-1"
                          >
                            Quận / Huyện <span className="text-rose-600">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-warehouse-return-district"
                            value={formState.return_district}
                            onChange={(e) =>
                              handleFormFieldChange('return_district', e.target.value)
                            }
                            placeholder="Quận/Huyện"
                            data-testid="input-warehouse-return-district"
                            className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                              validationErrors.return_district
                                ? 'border-rose-400 bg-rose-50/20'
                                : 'border-slate-300'
                            }`}
                          />
                          {validationErrors.return_district && (
                            <p
                              className="text-[11px] font-semibold text-rose-600 mt-1"
                              data-testid="error-warehouse-return-district"
                            >
                              {validationErrors.return_district}
                            </p>
                          )}
                        </div>

                        <div>
                          <label
                            htmlFor="input-warehouse-return-city"
                            className="block text-xs font-bold text-slate-700 mb-1"
                          >
                            Tỉnh / Thành phố <span className="text-rose-600">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-warehouse-return-city"
                            value={formState.return_city}
                            onChange={(e) => handleFormFieldChange('return_city', e.target.value)}
                            placeholder="Tỉnh/Thành phố"
                            data-testid="input-warehouse-return-city"
                            className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                              validationErrors.return_city
                                ? 'border-rose-400 bg-rose-50/20'
                                : 'border-slate-300'
                            }`}
                          />
                          {validationErrors.return_city && (
                            <p
                              className="text-[11px] font-semibold text-rose-600 mt-1"
                              data-testid="error-warehouse-return-city"
                            >
                              {validationErrors.return_city}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Operating Schedule & Instructions */}
              {activeTab === 'schedule' && (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="input-warehouse-cutoff-time"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Giờ cắt ca lấy hàng (Cutoff Time)
                    </label>
                    <input
                      type="text"
                      id="input-warehouse-cutoff-time"
                      value={formState.cutoff_time}
                      onChange={(e) => handleFormFieldChange('cutoff_time', e.target.value)}
                      placeholder="VD: 16:00 hoặc 18:30 (định dạng HH:mm)"
                      data-testid="input-warehouse-cutoff-time"
                      className={`w-full max-w-xs px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                        validationErrors.cutoff_time
                          ? 'border-rose-400 bg-rose-50/20'
                          : 'border-slate-300'
                      }`}
                    />
                    {validationErrors.cutoff_time && (
                      <p
                        className="text-[11px] font-semibold text-rose-600 mt-1"
                        data-testid="error-warehouse-cutoff-time"
                      >
                        {validationErrors.cutoff_time}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1">
                      Sau giờ này, các đơn hàng tạo mới sẽ tự động được xếp lịch lấy hàng vào ca
                      sáng hôm sau.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="textarea-warehouse-schedule-notes"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Chỉ dẫn &amp; Ghi chú cho bưu tá đến lấy
                    </label>
                    <textarea
                      rows={3}
                      id="textarea-warehouse-schedule-notes"
                      value={formState.schedule_notes}
                      onChange={(e) => handleFormFieldChange('schedule_notes', e.target.value)}
                      placeholder="VD: Bấm chuông cửa sau, kho nằm trong hẻm xe tải 2.5T, gọi trước 15 phút..."
                      data-testid="textarea-warehouse-schedule-notes"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
                    />
                  </div>
                </div>
              )}

              {/* TAB 4: Printer Defaults */}
              {activeTab === 'printer' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="select-warehouse-printer-paper-size"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Khổ giấy in nhãn chuẩn
                      </label>
                      <select
                        id="select-warehouse-printer-paper-size"
                        value={formState.printer_paper_size}
                        onChange={(e) =>
                          handleFormFieldChange('printer_paper_size', e.target.value as any)
                        }
                        data-testid="select-warehouse-printer-paper-size"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:border-orange-500 transition"
                      >
                        {ALLOWED_WAREHOUSE_PAPER_SIZES.map((size) => (
                          <option key={size} value={size}>
                            Khổ {size} {size === 'A6' ? '(Chuẩn máy in nhiệt Hãng)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="select-warehouse-printer-dpi"
                        className="block text-xs font-bold text-slate-700 mb-1"
                      >
                        Độ phân giải máy in (DPI)
                      </label>
                      <select
                        id="select-warehouse-printer-dpi"
                        value={formState.printer_dpi}
                        onChange={(e) =>
                          handleFormFieldChange('printer_dpi', parseInt(e.target.value, 10) as any)
                        }
                        data-testid="select-warehouse-printer-dpi"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:border-orange-500 transition"
                      >
                        {ALLOWED_WAREHOUSE_DPIS.map((dpi) => (
                          <option key={dpi} value={dpi}>
                            {dpi} DPI {dpi === 203 ? '(Tiêu chuẩn máy in nhiệt)' : '(Sắc nét)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="input-warehouse-printer-name"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Tên máy in nhãn liên kết (tùy chọn)
                    </label>
                    <input
                      type="text"
                      id="input-warehouse-printer-name"
                      value={formState.printer_name}
                      onChange={(e) => handleFormFieldChange('printer_name', e.target.value)}
                      placeholder="VD: Xprinter XP-420B, HPRT N41..."
                      data-testid="input-warehouse-printer-name"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
                    />
                  </div>

                  <div className="pt-2">
                    <label
                      htmlFor="checkbox-warehouse-printer-auto-print"
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        id="checkbox-warehouse-printer-auto-print"
                        checked={formState.printer_auto_print}
                        onChange={(e) =>
                          handleFormFieldChange('printer_auto_print', e.target.checked)
                        }
                        data-testid="checkbox-warehouse-printer-auto-print"
                        className="w-4 h-4 rounded-sm border-slate-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        Tự động đẩy lệnh in nhiệt khi đơn hàng được duyệt mã vận đơn
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Form Action Buttons */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  data-testid="cancel-warehouse-button"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  data-testid="submit-warehouse-button"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{editingWarehouse ? 'Lưu thay đổi' : 'Thêm kho hàng'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
