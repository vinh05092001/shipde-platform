'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  Lock,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  Store,
  Warehouse as WarehouseIcon,
  Users,
  Truck,
  Sliders,
  PackageCheck,
  ChevronDown,
  ChevronUp,
  X,
  ShieldAlert,
} from 'lucide-react';
import {
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingOverallStatus,
  type OnboardingStateResponseDto,
  type OnboardingStepDto,
} from '@shipde/contracts';

export interface WarehouseFormData {
  name: string;
  phone: string;
  address: string;
  city: string;
  district: string;
}

export function validateWarehouseInput(input: WarehouseFormData): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!input.name || input.name.trim().length < 2) {
    errors.name = 'Tên kho phải có ít nhất 2 ký tự';
  }
  const cleanPhone = (input.phone || '').trim().replace(/[\s.-]/g, '');
  const vnPhoneRegex = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/;
  if (!cleanPhone || !vnPhoneRegex.test(cleanPhone)) {
    errors.phone = 'Số điện thoại kho không đúng định dạng Việt Nam (VD: 0901234567)';
  }
  if (!input.address || input.address.trim().length < 3) {
    errors.address = 'Địa chỉ kho phải có ít nhất 3 ký tự';
  }
  for (const field of ['city', 'district'] as const) {
    if (!input[field]?.trim())
      errors[field] =
        field === 'city' ? 'Vui lòng nhập tỉnh/thành phố' : 'Vui lòng nhập quận/huyện';
  }
  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface OnboardingFlowProps {
  state?: OnboardingStateResponseDto | null;
  loading?: boolean;
  error?: string | null;
  initialState?: OnboardingStateResponseDto | null;
  initialLoading?: boolean;
  initialError?: string | null;
  initialSuccess?: string | null;
  initialCanEdit?: boolean;
  initialWarehouseFormOpen?: boolean;
  initialResetConfirmOpen?: boolean;
  onRefresh?: () => Promise<void> | void;
  onCompleteStep?: (stepId: OnboardingStepId, data?: Record<string, any>) => Promise<void>;
  onSkipStep?: (stepId: OnboardingStepId) => Promise<void>;
  onReset?: () => Promise<void>;
  onDismiss?: () => Promise<void>;
}

export function OnboardingFlow({
  state: propState,
  loading: propLoading,
  error: propError,
  initialState = null,
  initialLoading = false,
  initialError = null,
  initialSuccess = null,
  initialCanEdit,
  initialWarehouseFormOpen = false,
  initialResetConfirmOpen = false,
  onRefresh,
  onCompleteStep,
  onSkipStep,
  onReset,
  onDismiss,
}: OnboardingFlowProps) {
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [submittingStep, setSubmittingStep] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(initialSuccess);

  // Directly derive live server state, loading and error from props
  const state = propState !== undefined ? propState : initialState;
  const loading = (propLoading !== undefined ? propLoading : initialLoading) || refreshing;

  const rawError =
    localError !== null ? localError : propError !== undefined ? propError : initialError;
  const errorMessage = errorDismissed ? null : rawError;

  const setErrorMessage = (msg: string | null) => {
    setLocalError(msg);
    setErrorDismissed(false);
  };

  const dismissErrorMessage = () => {
    setErrorDismissed(true);
    setLocalError(null);
  };

  // Edit rights: server-authoritative boolean from API response or prop.
  // Unknown or undefined user/state fails closed to false (no edit).
  const canEdit =
    initialCanEdit !== undefined
      ? initialCanEdit
      : state?.can_edit !== undefined
        ? Boolean(state.can_edit)
        : false;

  // Warehouse inline form state
  const [warehouseFormOpen, setWarehouseFormOpen] = useState<boolean>(initialWarehouseFormOpen);
  const [warehouseData, setWarehouseData] = useState<WarehouseFormData>({
    name: '',
    phone: '',
    address: '',
    city: 'Hồ Chí Minh',
    district: '',
  });
  const [warehouseFieldErrors, setWarehouseFieldErrors] = useState<Record<string, string>>({});

  // Reset confirmation modal state
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(initialResetConfirmOpen);

  // Map step IDs to navigation links & icons
  const getStepMetadata = (stepId: OnboardingStepId) => {
    switch (stepId) {
      case OnboardingStepId.SHOP_PROFILE:
        return {
          icon: Store,
          linkText: 'Cài đặt Hồ sơ Cửa hàng',
          href: '/settings/shop',
        };
      case OnboardingStepId.WAREHOUSE:
        return {
          icon: WarehouseIcon,
          linkText: 'Quản lý Chi nhánh & Kho vận',
          href: '/settings/shop',
        };
      case OnboardingStepId.INVITE_USERS:
        return {
          icon: Users,
          linkText: 'Quản lý Thành viên & Phân quyền',
          href: '/settings/users',
        };
      case OnboardingStepId.CARRIER_ACCOUNT:
        return {
          icon: Truck,
          linkText: 'Kết nối Hãng vận chuyển (SCR-CAR-01)',
          href: '/paseo',
        };
      case OnboardingStepId.OPERATING_DEFAULTS:
        return {
          icon: Sliders,
          linkText: 'Cấu hình Vận hành & Cước phí',
          href: '/settings/shop',
        };
      case OnboardingStepId.TEST_ORDER:
        return {
          icon: PackageCheck,
          linkText: 'Tạo đơn thử nghiệm (SCR-ORD-02)',
          href: '/',
        };
      default:
        return {
          icon: Store,
          linkText: 'Đi đến cài đặt',
          href: '/settings/shop',
        };
    }
  };

  const handleRefresh = async () => {
    if (onRefresh) {
      setRefreshing(true);
      setErrorMessage(null);
      try {
        await onRefresh();
      } catch (err: any) {
        setErrorMessage(err?.message || 'Lỗi khi tải lại dữ liệu thiết lập ban đầu');
      } finally {
        setRefreshing(false);
      }
    }
  };

  const handleComplete = async (stepId: OnboardingStepId, data?: Record<string, any>) => {
    if (!canEdit) {
      setErrorMessage('Bạn không có quyền thực hiện thao tác này (cần quyền iam:shop_config).');
      return;
    }
    setSubmittingStep(stepId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (onCompleteStep) {
        await onCompleteStep(stepId, data);
        setSuccessMessage(`Đã đánh dấu hoàn thành bước ${stepId}!`);
        if (stepId === OnboardingStepId.WAREHOUSE) {
          setWarehouseFormOpen(false);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || `Không thể hoàn thành bước ${stepId}`);
    } finally {
      setSubmittingStep(null);
    }
  };

  const handleWarehouseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      setErrorMessage('Bạn không có quyền thêm kho hàng (cần quyền iam:shop_config).');
      return;
    }
    const { isValid, errors } = validateWarehouseInput(warehouseData);
    if (!isValid) {
      setWarehouseFieldErrors(errors);
      return;
    }
    setWarehouseFieldErrors({});
    await handleComplete(OnboardingStepId.WAREHOUSE, warehouseData);
  };

  const handleSkip = async (stepId: OnboardingStepId) => {
    if (!canEdit) {
      setErrorMessage('Bạn không có quyền bỏ qua bước này (cần quyền iam:shop_config).');
      return;
    }
    setSubmittingStep(stepId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (onSkipStep) {
        await onSkipStep(stepId);
        setSuccessMessage(`Đã bỏ qua bước ${stepId}. Bạn có thể thiết lập lại bất cứ lúc nào.`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || `Không thể bỏ qua bước ${stepId}`);
    } finally {
      setSubmittingStep(null);
    }
  };

  const handleResetConfirm = async () => {
    if (!canEdit) {
      setErrorMessage('Bạn không có quyền khởi tạo lại (cần quyền iam:shop_config).');
      return;
    }
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (onReset) {
        await onReset();
        setSuccessMessage('Đã khởi tạo lại tiến trình thiết lập ban đầu thành công!');
        setShowResetConfirm(false);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể khởi tạo lại tiến trình');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDismiss = async () => {
    if (!canEdit) {
      setErrorMessage('Bạn không có quyền đóng hướng dẫn (cần quyền iam:shop_config).');
      return;
    }
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (onDismiss) {
        await onDismiss();
        setSuccessMessage('Đã đóng hướng dẫn thiết lập ban đầu!');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể đóng hướng dẫn thiết lập');
    } finally {
      setActionLoading(false);
    }
  };

  // 1. Loading State
  if (loading) {
    return (
      <div
        className="w-full max-w-5xl mx-auto p-8 modern-card space-y-6"
        role="status"
        aria-live="polite"
        data-testid="onboarding-loading"
      >
        <div className="flex items-center justify-between animate-pulse">
          <div className="space-y-2">
            <div className="h-6 w-64 bg-slate-200 rounded-md" />
            <div className="h-4 w-96 bg-slate-100 rounded-md" />
          </div>
          <div className="h-10 w-24 bg-slate-200 rounded-lg" />
        </div>
        <div className="h-4 w-full bg-slate-100 rounded-full animate-pulse" />
        <div className="grid gap-4 mt-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="p-5 border border-slate-200 rounded-xl bg-slate-50/50 animate-pulse flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-200" />
                <div className="space-y-2">
                  <div className="h-4 w-48 bg-slate-200 rounded" />
                  <div className="h-3 w-72 bg-slate-100 rounded" />
                </div>
              </div>
              <div className="h-8 w-28 bg-slate-200 rounded-lg" />
            </div>
          ))}
        </div>
        <span className="sr-only">Đang tải danh sách thiết lập ban đầu...</span>
      </div>
    );
  }

  // 2. Empty State
  if (!state && !errorMessage) {
    return (
      <div
        className="w-full max-w-5xl mx-auto p-12 modern-card text-center space-y-4"
        data-testid="onboarding-empty"
      >
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <Store className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Chưa Khởi Tạo Quy Trình Thiết Lập</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Cửa hàng của bạn chưa có thông tin quy trình thiết lập ban đầu. Nhấn nút bên dưới để bắt
          đầu tải dữ liệu hoặc cấu hình shop.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={handleRefresh}
            className="btn-primary text-xs px-5 py-2.5"
            aria-label="Khởi tạo thiết lập ban đầu"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            <span>Khởi tạo thiết lập ban đầu</span>
          </button>
        </div>
      </div>
    );
  }

  const steps = state?.steps || [];
  const progressPercentage = state?.progress_percentage ?? 0;
  const isCompletedOverall = state?.status === OnboardingOverallStatus.COMPLETED;
  const isDismissed = state?.status === OnboardingOverallStatus.DISMISSED;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6" data-testid="onboarding-container">
      {/* View-Only / Forbidden Banner when user lacks iam:shop_config */}
      {!canEdit && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="onboarding-forbidden-banner"
          className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3 shadow-xs"
        >
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-bold">Chế độ Chỉ Xem (View-Only)</div>
            <div>
              Tài khoản của bạn không có quyền cập nhật cấu hình cửa hàng (yêu cầu quyền{' '}
              <code className="px-1.5 py-0.5 bg-amber-100 rounded text-amber-800 font-mono font-bold">
                iam:shop_config
              </code>
              ). Bạn có thể xem tiến độ và liên kết hướng dẫn nhưng không thể hoàn thành hoặc bỏ qua
              các bước.
            </div>
          </div>
        </div>
      )}

      {/* Error Alert Banner with Recovery */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="onboarding-error-banner"
          className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start justify-between gap-3 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <div className="font-bold">Không thể hoàn tất thao tác</div>
              <div>{errorMessage}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-rose-100 hover:bg-rose-200 text-rose-800 transition"
              aria-label="Thử lại tải dữ liệu"
            >
              Thử lại
            </button>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="p-1 rounded text-rose-500 hover:text-rose-800"
              aria-label="Đóng thông báo lỗi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Success Alert Banner */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="onboarding-success-banner"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start justify-between gap-3 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <div className="font-bold">Thao tác thành công</div>
              <div>{successMessage}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="p-1 rounded text-emerald-500 hover:text-emerald-800"
            aria-label="Đóng thông báo thành công"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Overall Completed Celebration Banner */}
      {isCompletedOverall && !isDismissed && (
        <div
          className="p-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg space-y-4"
          data-testid="onboarding-completed-banner"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold text-lg">
                🎉
              </div>
              <div>
                <h2 className="text-base font-bold">Chúc Mừng! Cửa Hàng Đã Sẵn Sàng Vận Hành</h2>
                <p className="text-xs text-white/80 mt-0.5">
                  Tất cả các bước thiết lập bắt buộc đã hoàn tất. Bạn có thể bắt đầu tạo đơn hàng
                  hoặc đóng hướng dẫn này.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="px-3.5 py-1.5 bg-white text-emerald-800 hover:bg-slate-100 rounded-lg text-xs font-bold transition shadow-xs"
              >
                Tạo Đơn Ngay
              </Link>
              {canEdit && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={actionLoading}
                  className="px-3.5 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg text-xs font-bold transition"
                  aria-label="Đóng hướng dẫn thiết lập"
                >
                  Đóng Hướng Dẫn
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header & Progress Card */}
      <div className="modern-card p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-[#c23807] uppercase tracking-wider">
                SCR-ONB-01
              </span>
              <span className="text-slate-300">•</span>
              <h1 className="text-lg font-bold text-slate-900">Thiết Lập Ban Đầu (Onboarding)</h1>
            </div>
            <p className="text-xs text-slate-500">
              Hoàn thành các bước chuẩn bị bên dưới để kích hoạt đầy đủ khả năng so sánh cước và tạo
              vận đơn tự động.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="btn-secondary text-xs px-3 py-1.5"
              aria-label="Làm mới tiến trình thiết lập"
              title="Cập nhật lại trạng thái thực tế từ hệ thống"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Làm mới</span>
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-lg transition"
                aria-label="Khởi tạo lại toàn bộ quy trình"
              >
                <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                <span>Khởi tạo lại</span>
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar & Summary */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs font-semibold">
            <div className="flex items-center gap-2">
              <span className="text-slate-700">Tiến độ hoàn thành:</span>
              <span className="font-bold text-[#c23807]">{progressPercentage}%</span>
            </div>
            <div className="text-slate-500">
              Đã hoàn thành {state?.completed_count || 0} / {steps.length} bước (
              {state?.completed_required_steps || 0} / {state?.total_required_steps || 0} bắt buộc)
            </div>
          </div>
          <div
            className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden"
            role="progressbar"
            aria-valuenow={progressPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Tiến độ thiết lập ban đầu"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                progressPercentage === 100
                  ? 'bg-emerald-500'
                  : progressPercentage > 50
                    ? 'bg-[#c23807]'
                    : 'bg-amber-500'
              }`}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      </div>

      {/* Step Cards List */}
      <div className="space-y-4" data-testid="onboarding-steps-list">
        {steps.map((step: OnboardingStepDto, index: number) => {
          const meta = getStepMetadata(step.id);
          const IconComp = meta.icon;
          const isCurrent = step.status === OnboardingStepStatus.IN_PROGRESS;
          const isCompleted = step.status === OnboardingStepStatus.COMPLETED;
          const isSkipped = step.status === OnboardingStepStatus.SKIPPED;
          const isBlocked = step.status === OnboardingStepStatus.BLOCKED;
          const isSubmitting = submittingStep === step.id;

          return (
            <div
              key={step.id}
              data-testid={`step-card-${step.id}`}
              className={`modern-card p-5 transition border ${
                isCurrent
                  ? 'border-[#c23807]/30 ring-2 ring-[#c23807]/10 bg-white'
                  : isCompleted
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : isBlocked
                      ? 'border-amber-200 bg-amber-50/10'
                      : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                {/* Step Info & Header */}
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      isCompleted
                        ? 'bg-emerald-100 text-emerald-700'
                        : isCurrent
                          ? 'bg-[#FFF5F0] text-[#c23807] font-bold'
                          : isBlocked
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isBlocked ? (
                      <Lock className="w-4 h-4" />
                    ) : (
                      <IconComp className="w-4 h-4" />
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-400">
                        Bước {step.order}:
                      </span>
                      <h2 className="text-sm font-bold text-slate-900">{step.title}</h2>

                      {/* Required / Optional Badge */}
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          step.required
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {step.required ? 'Bắt buộc' : 'Tùy chọn'}
                      </span>

                      {/* Status Badge */}
                      {isCompleted && (
                        <span className="badge-ok text-xs font-semibold inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Đã Hoàn Thành</span>
                        </span>
                      )}
                      {isCurrent && (
                        <span className="badge-info text-xs font-semibold inline-flex items-center gap-1 bg-sky-50 text-sky-700 border border-sky-200">
                          <Clock className="w-3 h-3" />
                          <span>Đang Thực Hiện</span>
                        </span>
                      )}
                      {isSkipped && (
                        <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          Đã Bỏ Qua
                        </span>
                      )}
                      {isBlocked && (
                        <span className="badge-warning text-xs font-semibold inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Bị Khóa (Thiếu Tiền Đề)</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{step.description}</p>
                  </div>
                </div>

                {/* Step Actions */}
                <div className="flex flex-wrap items-center gap-2 self-end sm:self-center shrink-0">
                  {/* Link to related settings */}
                  <Link
                    href={meta.href}
                    className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1"
                    aria-label={`Đi đến ${meta.linkText}`}
                  >
                    <span>{meta.linkText}</span>
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </Link>

                  {/* Warehouse specific toggle */}
                  {step.id === OnboardingStepId.WAREHOUSE && !isCompleted && canEdit && (
                    <button
                      type="button"
                      onClick={() => setWarehouseFormOpen(!warehouseFormOpen)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 transition"
                      aria-label="Nhập thông tin kho hàng nhanh"
                    >
                      {warehouseFormOpen ? (
                        <>
                          <span>Thu gọn</span>
                          <ChevronUp className="w-3 h-3 inline ml-1" />
                        </>
                      ) : (
                        <>
                          <span>Nhập kho nhanh</span>
                          <ChevronDown className="w-3 h-3 inline ml-1" />
                        </>
                      )}
                    </button>
                  )}

                  {/* Mark complete button */}
                  {!isCompleted && canEdit && (
                    <button
                      type="button"
                      disabled={isBlocked || isSubmitting}
                      onClick={() => handleComplete(step.id)}
                      className={`btn-primary text-xs px-3 py-1.5 ${
                        isBlocked ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                      aria-label={`Đánh dấu hoàn thành bước ${step.title}`}
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin mr-1 inline" />
                          <span>Đang lưu...</span>
                        </>
                      ) : (
                        <span>Hoàn thành</span>
                      )}
                    </button>
                  )}

                  {/* Skip button for optional steps */}
                  {!step.required && !isCompleted && !isSkipped && canEdit && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleSkip(step.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
                      aria-label={`Bỏ qua bước ${step.title}`}
                    >
                      Bỏ qua
                    </button>
                  )}
                </div>
              </div>

              {/* Blocking Dependencies Alert */}
              {isBlocked && step.blocking_reasons && step.blocking_reasons.length > 0 && (
                <div
                  role="alert"
                  className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1"
                  data-testid={`blocking-alert-${step.id}`}
                >
                  <div className="font-bold flex items-center gap-1.5 text-amber-800">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Điều kiện tiên quyết chưa đáp ứng:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-amber-700 pl-1">
                    {step.blocking_reasons.map((reason, rIdx) => (
                      <li key={rIdx}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Inline Warehouse Form */}
              {step.id === OnboardingStepId.WAREHOUSE && warehouseFormOpen && !isCompleted && (
                <form
                  onSubmit={handleWarehouseSubmit}
                  className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4"
                  data-testid="inline-warehouse-form"
                >
                  <div className="font-bold text-xs text-slate-800 pb-1 border-b border-slate-200">
                    Thêm Nhanh Kho Hàng Đầu Tiên (AC-ONB-01-03, AC-ONB-01-14)
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Warehouse Name */}
                    <div className="space-y-1">
                      <label
                        htmlFor="wh-name"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Tên kho hàng <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="wh-name"
                        type="text"
                        value={warehouseData.name}
                        onChange={(e) => {
                          setWarehouseData((prev) => ({ ...prev, name: e.target.value }));
                          if (warehouseFieldErrors.name) {
                            setWarehouseFieldErrors((prev) => ({ ...prev, name: '' }));
                          }
                        }}
                        placeholder="VD: Kho Tân Bình (Trụ sở)"
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs ${
                          warehouseFieldErrors.name
                            ? 'border-rose-400 bg-rose-50/50'
                            : 'border-slate-300 bg-white'
                        }`}
                      />
                      {warehouseFieldErrors.name && (
                        <p className="text-[11px] text-rose-600 font-medium">
                          {warehouseFieldErrors.name}
                        </p>
                      )}
                    </div>

                    {/* Warehouse Contact Phone */}
                    <div className="space-y-1">
                      <label
                        htmlFor="wh-phone"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Số điện thoại liên hệ <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="wh-phone"
                        type="tel"
                        value={warehouseData.phone}
                        onChange={(e) => {
                          setWarehouseData((prev) => ({ ...prev, phone: e.target.value }));
                          if (warehouseFieldErrors.phone) {
                            setWarehouseFieldErrors((prev) => ({ ...prev, phone: '' }));
                          }
                        }}
                        placeholder="VD: 0901234567"
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs ${
                          warehouseFieldErrors.phone
                            ? 'border-rose-400 bg-rose-50/50'
                            : 'border-slate-300 bg-white'
                        }`}
                      />
                      {warehouseFieldErrors.phone && (
                        <p className="text-[11px] text-rose-600 font-medium">
                          {warehouseFieldErrors.phone}
                        </p>
                      )}
                    </div>

                    {/* Warehouse Address */}
                    <div className="space-y-1 sm:col-span-2">
                      <label
                        htmlFor="wh-address"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Địa chỉ chi tiết kho (Lấy hàng & Trả hàng){' '}
                        <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="wh-address"
                        type="text"
                        value={warehouseData.address}
                        onChange={(e) => {
                          setWarehouseData((prev) => ({ ...prev, address: e.target.value }));
                          if (warehouseFieldErrors.address) {
                            setWarehouseFieldErrors((prev) => ({ ...prev, address: '' }));
                          }
                        }}
                        placeholder="VD: 128 Nguyễn Trãi, Phường 3, Quận 5"
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs ${
                          warehouseFieldErrors.address
                            ? 'border-rose-400 bg-rose-50/50'
                            : 'border-slate-300 bg-white'
                        }`}
                      />
                      {warehouseFieldErrors.address && (
                        <p className="text-[11px] text-rose-600 font-medium">
                          {warehouseFieldErrors.address}
                        </p>
                      )}
                    </div>
                  </div>

                  {(['city', 'district'] as const).map((field) => (
                    <div key={field} className="space-y-1">
                      <label
                        htmlFor={`wh-${field}`}
                        className="block text-xs font-semibold text-slate-700"
                      >
                        {field === 'city' ? 'Tỉnh/thành phố' : 'Quận/huyện'}{' '}
                        <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id={`wh-${field}`}
                        type="text"
                        required
                        value={warehouseData[field]}
                        onChange={(e) =>
                          setWarehouseData((prev) => ({ ...prev, [field]: e.target.value }))
                        }
                        aria-invalid={Boolean(warehouseFieldErrors[field])}
                        aria-describedby={
                          warehouseFieldErrors[field] ? `wh-${field}-error` : undefined
                        }
                        className="w-full px-3 py-1.5 rounded-lg border text-xs border-slate-300 bg-white"
                      />
                      {warehouseFieldErrors[field] && (
                        <p id={`wh-${field}-error`} className="text-[11px] text-rose-600">
                          {warehouseFieldErrors[field]}
                        </p>
                      )}
                    </div>
                  ))}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setWarehouseFormOpen(false)}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
                      aria-label="Hủy nhập nhanh kho hàng"
                    >
                      Đóng
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="btn-primary text-xs px-4 py-1.5"
                      aria-label="Lưu và hoàn thành bước kho hàng"
                    >
                      {isSubmitting ? 'Đang lưu...' : 'Lưu Kho & Hoàn Thành Bước'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-modal-title"
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 border border-slate-100">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h2 id="reset-modal-title" className="text-base font-bold text-slate-900">
                Khởi tạo lại Quy trình Thiết lập?
              </h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Thao tác này sẽ đặt lại tiến trình các bước thiết lập ban đầu về 0% và ghi nhận nhật
              ký kiểm toán. Dữ liệu hồ sơ shop và người dùng đã lưu sẽ không bị xóa.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                disabled={actionLoading}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                aria-label="Hủy bỏ khởi tạo lại"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleResetConfirm}
                disabled={actionLoading}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition shadow-xs"
                aria-label="Xác nhận khởi tạo lại"
              >
                {actionLoading ? 'Đang xử lý...' : 'Xác nhận Đặt lại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
