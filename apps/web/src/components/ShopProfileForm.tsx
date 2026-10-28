'use client';

import React, { useState } from 'react';
import {
  Store,
  Building2,
  Receipt,
  CreditCard,
  Settings,
  Edit3,
  Save,
  X,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Clock,
  Coins,
  Package,
  FileText,
  Mail,
  Phone,
  MapPin,
} from 'lucide-react';
import type { ShopProfile, UpdateShopProfileInput } from '@shipde/contracts';

export interface ShopProfileFormState {
  name: string;
  legal_name: string;
  tax_code: string;
  contact_email: string;
  contact_phone: string;
  legal_address: string;
  billing_email: string;
  billing_address: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  bank_branch: string;
  timezone: string;
  currency: string;
  default_fee_payer: 'SHOP' | 'RECIPIENT';
  default_weight_unit: 'g' | 'kg';
  auto_routing_enabled: boolean;
  operating_notes: string;
}

export interface ShopProfileFormProps {
  initialProfile?: ShopProfile | null;
  initialLoading?: boolean;
  initialMode?: 'view' | 'edit';
  initialCanEdit?: boolean;
  initialError?: string | null;
  initialSuccess?: string | null;
  initialValidationErrors?: Record<string, string>;
  initialFormState?: Partial<ShopProfileFormState>;
  onSave?: (data: UpdateShopProfileInput) => Promise<void>;
  onRefresh?: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAX_CODE_REGEX = /^[0-9]{10}(-[0-9]{3})?$/;
const PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;
const BANK_ACCOUNT_REGEX = /^[0-9A-Za-z]{6,30}$/;

export function validateShopProfileForm(form: ShopProfileFormState): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!form.name || form.name.trim().length < 2) {
    errors.name = 'Tên cửa hàng phải có ít nhất 2 ký tự';
  } else if (form.name.trim().length > 255) {
    errors.name = 'Tên cửa hàng không được vượt quá 255 ký tự';
  }

  if (form.tax_code && form.tax_code.trim()) {
    const trimmed = form.tax_code.trim();
    if (!TAX_CODE_REGEX.test(trimmed)) {
      errors.tax_code = 'Mã số thuế không hợp lệ (10 số hoặc 13 số định dạng 0123456789-001)';
    }
  }

  if (form.contact_email && form.contact_email.trim()) {
    if (!EMAIL_REGEX.test(form.contact_email.trim())) {
      errors.contact_email = 'Email liên hệ không hợp lệ';
    }
  }

  if (form.contact_phone && form.contact_phone.trim()) {
    const cleanPhone = form.contact_phone.trim().replace(/[\s.-]/g, '');
    if (!PHONE_REGEX.test(cleanPhone)) {
      errors.contact_phone = 'Số điện thoại không hợp lệ theo định dạng Việt Nam';
    }
  }

  if (form.billing_email && form.billing_email.trim()) {
    if (!EMAIL_REGEX.test(form.billing_email.trim())) {
      errors.billing_email = 'Email nhận hóa đơn không hợp lệ';
    }
  }

  if (form.bank_account_number && form.bank_account_number.trim()) {
    const cleanAcc = form.bank_account_number.trim().replace(/[\s-]/g, '');
    if (!BANK_ACCOUNT_REGEX.test(cleanAcc)) {
      errors.bank_account_number = 'Số tài khoản ngân hàng không hợp lệ (từ 6 đến 30 ký tự)';
    }
  }

  if (form.operating_notes && form.operating_notes.length > 1000) {
    errors.operating_notes = 'Ghi chú vận hành không được vượt quá 1000 ký tự';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function ShopProfileForm({
  initialProfile = null,
  initialLoading = false,
  initialMode = 'view',
  initialCanEdit = true,
  initialError = null,
  initialSuccess = null,
  initialValidationErrors = {},
  initialFormState = {},
  onSave,
  onRefresh,
}: ShopProfileFormProps) {
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [profile, setProfile] = useState<ShopProfile | null>(initialProfile);
  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [canEdit] = useState<boolean>(initialCanEdit);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  const [successMessage, setSuccessMessage] = useState<string | null>(initialSuccess);
  const [validationErrors, setValidationErrors] =
    useState<Record<string, string>>(initialValidationErrors);

  const defaultState: ShopProfileFormState = {
    name: profile?.name || '',
    legal_name: profile?.legal_name || '',
    tax_code: profile?.tax_code || '',
    contact_email: profile?.contact_email || '',
    contact_phone: profile?.contact_phone || '',
    legal_address: profile?.legal_address || '',
    billing_email: profile?.billing_email || '',
    billing_address: profile?.billing_address || '',
    bank_name: profile?.bank_name || '',
    bank_account_number: profile?.bank_account_number || '',
    bank_account_name: profile?.bank_account_name || '',
    bank_branch: profile?.bank_branch || '',
    timezone: profile?.timezone || 'Asia/Ho_Chi_Minh',
    currency: profile?.currency || 'VND',
    default_fee_payer: profile?.default_fee_payer || 'SHOP',
    default_weight_unit: profile?.default_weight_unit || 'g',
    auto_routing_enabled: profile?.auto_routing_enabled ?? false,
    operating_notes: profile?.operating_notes || '',
    ...initialFormState,
  };

  const [formState, setFormState] = useState<ShopProfileFormState>(defaultState);

  const handleChange = (field: keyof ShopProfileFormState, value: string | boolean) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleCancel = () => {
    if (profile) {
      setFormState({
        name: profile.name || '',
        legal_name: profile.legal_name || '',
        tax_code: profile.tax_code || '',
        contact_email: profile.contact_email || '',
        contact_phone: profile.contact_phone || '',
        legal_address: profile.legal_address || '',
        billing_email: profile.billing_email || '',
        billing_address: profile.billing_address || '',
        bank_name: profile.bank_name || '',
        bank_account_number: profile.bank_account_number || '',
        bank_account_name: profile.bank_account_name || '',
        bank_branch: profile.bank_branch || '',
        timezone: profile.timezone || 'Asia/Ho_Chi_Minh',
        currency: profile.currency || 'VND',
        default_fee_payer: profile.default_fee_payer || 'SHOP',
        default_weight_unit: profile.default_weight_unit || 'g',
        auto_routing_enabled: profile.auto_routing_enabled ?? false,
        operating_notes: profile.operating_notes || '',
      });
    }
    setValidationErrors({});
    setErrorMessage(null);
    setMode('view');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const { isValid, errors } = validateShopProfileForm(formState);
    if (!isValid) {
      setValidationErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      if (onSave) {
        await onSave({
          name: formState.name,
          legal_name: formState.legal_name || null,
          tax_code: formState.tax_code || null,
          contact_email: formState.contact_email || null,
          contact_phone: formState.contact_phone || null,
          legal_address: formState.legal_address || null,
          billing_email: formState.billing_email || null,
          billing_address: formState.billing_address || null,
          bank_name: formState.bank_name || null,
          bank_account_number: formState.bank_account_number || null,
          bank_account_name: formState.bank_account_name
            ? formState.bank_account_name.toUpperCase()
            : null,
          bank_branch: formState.bank_branch || null,
          timezone: formState.timezone,
          currency: formState.currency,
          default_fee_payer: formState.default_fee_payer,
          default_weight_unit: formState.default_weight_unit,
          auto_routing_enabled: formState.auto_routing_enabled,
          operating_notes: formState.operating_notes || null,
        });
      }
      setSuccessMessage('Đã cập nhật hồ sơ shop thành công');
      setMode('view');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể lưu hồ sơ shop. Vui lòng thử lại sau.');
    } finally {
      setSubmitting(false);
    }
  };

  // 1. Loading Skeleton State
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" data-testid="shop-profile-loading">
        <div className="h-20 bg-slate-200 rounded-2xl w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-slate-200 rounded-2xl" />
          <div className="h-64 bg-slate-200 rounded-2xl" />
        </div>
        <div className="h-48 bg-slate-200 rounded-2xl w-full" />
        <div className="text-center text-xs font-semibold text-slate-400">
          Đang tải hồ sơ cửa hàng...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="shop-profile-container">
      {/* Top Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900" data-testid="shop-name-title">
                {profile?.name || formState.name || 'Cửa hàng'}
              </h1>
              {profile?.code && (
                <span className="text-xs font-mono font-bold bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-md border border-slate-200">
                  {profile.code}
                </span>
              )}
              <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md">
                {profile?.status === 'active' ? 'Đang hoạt động' : profile?.status || 'Active'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Hồ sơ pháp lý doanh nghiệp, tài khoản nhận đối soát COD và cấu hình giao vận mặc định.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {mode === 'view' && canEdit && (
            <button
              type="button"
              onClick={() => setMode('edit')}
              data-testid="edit-shop-button"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Chỉnh sửa hồ sơ</span>
            </button>
          )}

          {mode === 'edit' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCancel}
                data-testid="cancel-edit-button"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                <span>Hủy bỏ</span>
              </button>
              <button
                type="submit"
                form="shop-profile-form"
                data-testid="save-shop-button"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Lưu thay đổi</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Forbidden Notice when non-authorized role accesses */}
      {!canEdit && (
        <div
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3"
          data-testid="shop-profile-forbidden-banner"
        >
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-amber-900">Giới hạn quyền cấu hình cửa hàng</h4>
            <p className="text-xs text-amber-700 mt-0.5">
              Tài khoản của bạn chỉ có quyền xem thông tin. Vui lòng liên hệ Chủ Shop để được cấp
              quyền thực hiện thay đổi hồ sơ tổ chức.
            </p>
          </div>
        </div>
      )}

      {/* Persistent Server Error Banner with Retry */}
      {errorMessage && (
        <div
          className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center justify-between gap-3"
          data-testid="shop-profile-error-banner"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="text-xs font-semibold text-rose-800">{errorMessage}</span>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              data-testid="retry-error-button"
              className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 hover:text-rose-900 underline cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Thử lại</span>
            </button>
          )}
        </div>
      )}

      {/* Success Notification Banner */}
      {successMessage && (
        <div
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-2.5"
          data-testid="shop-profile-success-banner"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="text-xs font-semibold text-emerald-800">{successMessage}</span>
        </div>
      )}

      {/* Main Content: View Mode vs Edit Form */}
      {mode === 'view' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="shop-profile-view-grid">
          {/* Section 1: Legal Profile */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Building2 className="w-4 h-4 text-orange-600" />
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                1. Thông Tin Pháp Lý
              </h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 block font-medium">
                  Tên thương hiệu / Cửa hàng:
                </span>
                <span className="font-bold text-slate-800" data-testid="view-name">
                  {profile?.name || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Tên pháp lý công ty:</span>
                <span className="font-bold text-slate-800" data-testid="view-legal-name">
                  {profile?.legal_name || 'Chưa thiết lập'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Mã số thuế (MST):</span>
                <span className="font-mono font-bold text-slate-800" data-testid="view-tax-code">
                  {profile?.tax_code || 'Chưa thiết lập'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Email liên hệ:</span>
                <span className="font-medium text-slate-800 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  {profile?.contact_email || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Hotline hỗ trợ:</span>
                <span className="font-medium text-slate-800 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  {profile?.contact_phone || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Địa chỉ trụ sở pháp lý:</span>
                <span className="text-slate-800 flex items-start gap-1.5 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>{profile?.legal_address || 'Chưa thiết lập'}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Billing & Bank Settlement */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <CreditCard className="w-4 h-4 text-emerald-600" />
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                2. Thanh Toán & Đối Soát COD
              </h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 block font-medium">Email nhận hóa đơn GTGT:</span>
                <span className="font-medium text-slate-800 flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-slate-400" />
                  {profile?.billing_email || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Địa chỉ xuất hóa đơn:</span>
                <span className="text-slate-800">{profile?.billing_address || '—'}</span>
              </div>
              <div className="pt-2 border-t border-slate-100">
                <span className="text-slate-400 block font-medium">Ngân hàng thụ hưởng COD:</span>
                <span className="font-bold text-slate-800 text-sm">
                  {profile?.bank_name || 'Chưa thiết lập'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Số tài khoản nhận tiền:</span>
                <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 inline-block">
                  {profile?.bank_account_number || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Tên chủ tài khoản:</span>
                <span className="font-mono font-bold text-slate-800 uppercase">
                  {profile?.bank_account_name || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Chi nhánh:</span>
                <span className="text-slate-800">{profile?.bank_branch || '—'}</span>
              </div>
            </div>
          </div>

          {/* Section 3: Operating Defaults */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Settings className="w-4 h-4 text-blue-600" />
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                3. Cấu Hình Vận Hành Mặc Định
              </h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 block font-medium">Múi giờ vận hành:</span>
                <span className="font-medium text-slate-800 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {profile?.timezone || 'Asia/Ho_Chi_Minh'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Tiền tệ thanh toán:</span>
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-slate-400" />
                  {profile?.currency || 'VND'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Bên trả cước mặc định:</span>
                <span className="font-bold text-slate-800">
                  {profile?.default_fee_payer === 'RECIPIENT'
                    ? 'Người nhận thanh toán (RECIPIENT)'
                    : 'Shop thanh toán (SHOP)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Đơn vị trọng lượng chuẩn:</span>
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-slate-400" />
                  {profile?.default_weight_unit === 'kg' ? 'Kilogram (kg)' : 'Gram (g)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Tự động định tuyến hãng:</span>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${
                    profile?.auto_routing_enabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {profile?.auto_routing_enabled ? 'Đang bật' : 'Tắt'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">
                  Ghi chú giao hàng mặc định:
                </span>
                <span className="text-slate-800 italic block mt-0.5">
                  {profile?.operating_notes || 'Không có ghi chú'}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Edit Form */
        <form
          id="shop-profile-form"
          onSubmit={handleSubmit}
          className="space-y-6"
          data-testid="shop-profile-edit-form"
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Edit Section 1: Legal Profile */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <Building2 className="w-4 h-4 text-orange-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  1. Thông Tin Pháp Lý
                </h3>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label htmlFor="name-input" className="block font-bold text-slate-700 mb-1">
                    Tên hiển thị shop <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="name-input"
                    type="text"
                    value={formState.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    data-testid="input-name"
                    placeholder="VD: Gumac Flagship"
                    className={`w-full px-3 py-2 border rounded-xl outline-hidden text-xs transition ${
                      validationErrors.name
                        ? 'border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-50/20'
                        : 'border-slate-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                    }`}
                  />
                  {validationErrors.name && (
                    <span className="text-rose-600 text-[11px] font-semibold mt-1 block">
                      {validationErrors.name}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="legal-name-input" className="block font-bold text-slate-700 mb-1">
                    Tên pháp lý công ty / hộ kinh doanh
                  </label>
                  <input
                    id="legal-name-input"
                    type="text"
                    value={formState.legal_name}
                    onChange={(e) => handleChange('legal_name', e.target.value)}
                    data-testid="input-legal-name"
                    placeholder="VD: Công ty Cổ phần Thời trang Gumac"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label htmlFor="tax-code-input" className="block font-bold text-slate-700 mb-1">
                    Mã số thuế (10 hoặc 13 số)
                  </label>
                  <input
                    id="tax-code-input"
                    type="text"
                    value={formState.tax_code}
                    onChange={(e) => handleChange('tax_code', e.target.value)}
                    data-testid="input-tax-code"
                    placeholder="VD: 0312345678 hoặc 0312345678-001"
                    className={`w-full px-3 py-2 border rounded-xl outline-hidden text-xs font-mono transition ${
                      validationErrors.tax_code
                        ? 'border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-50/20'
                        : 'border-slate-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                    }`}
                  />
                  {validationErrors.tax_code && (
                    <span className="text-rose-600 text-[11px] font-semibold mt-1 block">
                      {validationErrors.tax_code}
                    </span>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="contact-email-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Email liên hệ
                  </label>
                  <input
                    id="contact-email-input"
                    type="email"
                    value={formState.contact_email}
                    onChange={(e) => handleChange('contact_email', e.target.value)}
                    data-testid="input-contact-email"
                    placeholder="support@gumac.vn"
                    className={`w-full px-3 py-2 border rounded-xl outline-hidden text-xs transition ${
                      validationErrors.contact_email
                        ? 'border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-50/20'
                        : 'border-slate-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                    }`}
                  />
                  {validationErrors.contact_email && (
                    <span className="text-rose-600 text-[11px] font-semibold mt-1 block">
                      {validationErrors.contact_email}
                    </span>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="contact-phone-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Hotline / SĐT liên hệ
                  </label>
                  <input
                    id="contact-phone-input"
                    type="text"
                    value={formState.contact_phone}
                    onChange={(e) => handleChange('contact_phone', e.target.value)}
                    data-testid="input-contact-phone"
                    placeholder="0901234567"
                    className={`w-full px-3 py-2 border rounded-xl outline-hidden text-xs transition ${
                      validationErrors.contact_phone
                        ? 'border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-50/20'
                        : 'border-slate-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                    }`}
                  />
                  {validationErrors.contact_phone && (
                    <span className="text-rose-600 text-[11px] font-semibold mt-1 block">
                      {validationErrors.contact_phone}
                    </span>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="legal-address-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Địa chỉ trụ sở
                  </label>
                  <textarea
                    id="legal-address-input"
                    rows={2}
                    value={formState.legal_address}
                    onChange={(e) => handleChange('legal_address', e.target.value)}
                    data-testid="input-legal-address"
                    placeholder="Số 128 Nguyễn Trãi, P.3, Q.5, TP.HCM"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>
            </div>

            {/* Edit Section 2: Billing & Bank Settlement */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <CreditCard className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  2. Thanh Toán & Đối Soát COD
                </h3>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label
                    htmlFor="billing-email-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Email nhận hóa đơn GTGT
                  </label>
                  <input
                    id="billing-email-input"
                    type="email"
                    value={formState.billing_email}
                    onChange={(e) => handleChange('billing_email', e.target.value)}
                    data-testid="input-billing-email"
                    placeholder="ketoan@gumac.vn"
                    className={`w-full px-3 py-2 border rounded-xl outline-hidden text-xs transition ${
                      validationErrors.billing_email
                        ? 'border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-50/20'
                        : 'border-slate-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                    }`}
                  />
                  {validationErrors.billing_email && (
                    <span className="text-rose-600 text-[11px] font-semibold mt-1 block">
                      {validationErrors.billing_email}
                    </span>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="billing-address-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Địa chỉ xuất hóa đơn
                  </label>
                  <textarea
                    id="billing-address-input"
                    rows={2}
                    value={formState.billing_address}
                    onChange={(e) => handleChange('billing_address', e.target.value)}
                    data-testid="input-billing-address"
                    placeholder="128 Nguyễn Trãi, P.3, Q.5, TP.HCM"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <label htmlFor="bank-name-input" className="block font-bold text-slate-700 mb-1">
                    Tên ngân hàng thụ hưởng
                  </label>
                  <input
                    id="bank-name-input"
                    type="text"
                    value={formState.bank_name}
                    onChange={(e) => handleChange('bank_name', e.target.value)}
                    data-testid="input-bank-name"
                    placeholder="Vietcombank, MBBank, Techcombank..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="bank-account-number-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Số tài khoản nhận COD
                  </label>
                  <input
                    id="bank-account-number-input"
                    type="text"
                    value={formState.bank_account_number}
                    onChange={(e) => handleChange('bank_account_number', e.target.value)}
                    data-testid="input-bank-account-number"
                    placeholder="0071001234567"
                    className={`w-full px-3 py-2 border rounded-xl outline-hidden text-xs font-mono transition ${
                      validationErrors.bank_account_number
                        ? 'border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-50/20'
                        : 'border-slate-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                    }`}
                  />
                  {validationErrors.bank_account_number && (
                    <span className="text-rose-600 text-[11px] font-semibold mt-1 block">
                      {validationErrors.bank_account_number}
                    </span>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="bank-account-name-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Tên chủ tài khoản (in hoa không dấu)
                  </label>
                  <input
                    id="bank-account-name-input"
                    type="text"
                    value={formState.bank_account_name}
                    onChange={(e) =>
                      handleChange('bank_account_name', e.target.value.toUpperCase())
                    }
                    data-testid="input-bank-account-name"
                    placeholder="CTY CP GUMAC"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs font-mono uppercase focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="bank-branch-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Chi nhánh ngân hàng
                  </label>
                  <input
                    id="bank-branch-input"
                    type="text"
                    value={formState.bank_branch}
                    onChange={(e) => handleChange('bank_branch', e.target.value)}
                    data-testid="input-bank-branch"
                    placeholder="Chi nhánh Nam Sài Gòn"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>
            </div>

            {/* Edit Section 3: Operating Defaults */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <Settings className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  3. Cấu Hình Vận Hành Mặc Định
                </h3>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label htmlFor="timezone-select" className="block font-bold text-slate-700 mb-1">
                    Múi giờ chuẩn
                  </label>
                  <select
                    id="timezone-select"
                    value={formState.timezone}
                    onChange={(e) => handleChange('timezone', e.target.value)}
                    data-testid="select-timezone"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500 bg-white"
                  >
                    <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
                    <option value="UTC">UTC (UTC+0)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="default-fee-payer-select"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Bên trả cước mặc định
                  </label>
                  <select
                    id="default-fee-payer-select"
                    value={formState.default_fee_payer}
                    onChange={(e) =>
                      handleChange('default_fee_payer', e.target.value as 'SHOP' | 'RECIPIENT')
                    }
                    data-testid="select-fee-payer"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500 bg-white"
                  >
                    <option value="SHOP">Shop thanh toán (SHOP)</option>
                    <option value="RECIPIENT">Người nhận thanh toán (RECIPIENT)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="default-weight-unit-select"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Đơn vị trọng lượng chuẩn
                  </label>
                  <select
                    id="default-weight-unit-select"
                    value={formState.default_weight_unit}
                    onChange={(e) =>
                      handleChange('default_weight_unit', e.target.value as 'g' | 'kg')
                    }
                    data-testid="select-weight-unit"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500 bg-white"
                  >
                    <option value="g">Gram (g)</option>
                    <option value="kg">Kilogram (kg)</option>
                  </select>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formState.auto_routing_enabled}
                      onChange={(e) => handleChange('auto_routing_enabled', e.target.checked)}
                      data-testid="checkbox-auto-routing"
                      className="w-4 h-4 text-orange-600 border-slate-300 rounded-md focus:ring-orange-500"
                    />
                    <span className="font-bold text-slate-800">
                      Bật tự động đề xuất hãng vận chuyển tối ưu
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-0.5 ml-6">
                    Hệ thống sẽ tự động phân tích biểu giá hợp đồng và SLA để gợi ý gói cước rẻ
                    nhất.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="operating-notes-input"
                    className="block font-bold text-slate-700 mb-1"
                  >
                    Ghi chú giao hàng mặc định cho bưu tá
                  </label>
                  <textarea
                    id="operating-notes-input"
                    rows={3}
                    value={formState.operating_notes}
                    onChange={(e) => handleChange('operating_notes', e.target.value)}
                    data-testid="input-operating-notes"
                    placeholder="VD: Cho khách xem hàng trước khi nhận, không cho thử..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-hidden text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
