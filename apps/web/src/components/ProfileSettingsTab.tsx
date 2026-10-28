'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  User as UserIcon,
  Phone,
  Mail,
  Shield,
  Globe,
  Clock,
  Warehouse,
  Bell,
  Save,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RotateCcw,
  Lock,
} from 'lucide-react';

const VIETNAMESE_PHONE_REGEX = /^(0|\+84)[3|5|7|8|9][0-9]{8}$/;

interface NotificationSubscriptionsState {
  delivery_fail: boolean;
  rate_discrepancy: boolean;
  cod_overdue: boolean;
  abnormal_return: boolean;
  security_alerts: boolean;
  create_unknown: boolean;
  claim_deadline_warning: boolean;
}

interface NotificationPreferencesState {
  channels: {
    email: boolean;
    in_app: boolean;
    push: boolean;
  };
  digest_window_minutes: number;
  subscriptions: NotificationSubscriptionsState;
}

interface ProfileFormState {
  full_name: string;
  phone: string;
  avatar_url: string;
  language: string;
  timezone: string;
  default_warehouse_id: string;
  notification_preferences: NotificationPreferencesState;
}

export function validateProfileForm(form: ProfileFormState): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!form.full_name || !form.full_name.trim()) {
    errors.full_name = 'Họ và tên không được để trống';
  } else if (form.full_name.trim().length > 255) {
    errors.full_name = 'Họ và tên tối đa 255 ký tự';
  }

  if (form.phone && form.phone.trim()) {
    if (!VIETNAMESE_PHONE_REGEX.test(form.phone.trim())) {
      errors.phone = 'Số điện thoại không đúng định dạng Việt Nam';
    }
  }

  if (form.avatar_url && form.avatar_url.trim().length > 512) {
    errors.avatar_url = 'Đường dẫn ảnh đại diện tối đa 512 ký tự';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export const ProfileSettingsTab: React.FC<{
  initialProfile?: any;
  mockLoading?: boolean;
}> = ({ initialProfile, mockLoading = false }) => {
  const { user, getProfile, updateProfile } = useAuth();

  const [loading, setLoading] = useState(mockLoading || (!initialProfile && !user));
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<ProfileFormState>(() => {
    const u = initialProfile || user || {};
    const prefs = u.notification_preferences || {};
    return {
      full_name: u.full_name || '',
      phone: u.phone || '',
      avatar_url: u.avatar_url || '',
      language: u.language || 'vi',
      timezone: u.timezone || 'Asia/Ho_Chi_Minh',
      default_warehouse_id: u.default_warehouse_id || '',
      notification_preferences: {
        channels: {
          email: prefs.channels?.email ?? true,
          in_app: prefs.channels?.in_app ?? true,
          push: prefs.channels?.push ?? false,
        },
        digest_window_minutes: prefs.digest_window_minutes ?? 15,
        subscriptions: {
          delivery_fail: prefs.subscriptions?.delivery_fail ?? true,
          rate_discrepancy: prefs.subscriptions?.rate_discrepancy ?? true,
          cod_overdue: prefs.subscriptions?.cod_overdue ?? true,
          abnormal_return: prefs.subscriptions?.abnormal_return ?? true,
          security_alerts: true,
          create_unknown: true,
          claim_deadline_warning: true,
        },
      },
    };
  });

  const populateFromUser = useCallback((u: any) => {
    const prefs = u.notification_preferences || {};
    setFormData({
      full_name: u.full_name || '',
      phone: u.phone || '',
      avatar_url: u.avatar_url || '',
      language: u.language || 'vi',
      timezone: u.timezone || 'Asia/Ho_Chi_Minh',
      default_warehouse_id: u.default_warehouse_id || '',
      notification_preferences: {
        channels: {
          email: prefs.channels?.email ?? true,
          in_app: prefs.channels?.in_app ?? true,
          push: prefs.channels?.push ?? false,
        },
        digest_window_minutes: prefs.digest_window_minutes ?? 15,
        subscriptions: {
          delivery_fail: prefs.subscriptions?.delivery_fail ?? true,
          rate_discrepancy: prefs.subscriptions?.rate_discrepancy ?? true,
          cod_overdue: prefs.subscriptions?.cod_overdue ?? true,
          abnormal_return: prefs.subscriptions?.abnormal_return ?? true,
          security_alerts: true, // Always enforced
          create_unknown: true, // Always enforced
          claim_deadline_warning: true, // Always enforced
        },
      },
    });
  }, []);

  const loadData = useCallback(async () => {
    if (initialProfile) {
      populateFromUser(initialProfile);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await getProfile();
      if (res.success && res.data) {
        populateFromUser(res.data);
      } else if (user) {
        populateFromUser(user);
      } else {
        setErrorMsg(res.error || 'Không thể tải thông tin hồ sơ.');
      }
    } catch {
      if (user) {
        populateFromUser(user);
      } else {
        setErrorMsg('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  }, [initialProfile, getProfile, user, populateFromUser]);

  useEffect(() => {
    if (!mockLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial profile fetch
      void loadData();
    }
  }, [loadData, mockLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    const validation = validateProfileForm(formData);
    if (!validation.isValid) {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const payload: any = {
        full_name: formData.full_name.trim(),
        phone: formData.phone.trim() || null,
        avatar_url: formData.avatar_url.trim() || null,
        language: formData.language,
        timezone: formData.timezone,
        default_warehouse_id: formData.default_warehouse_id || null,
        notification_preferences: formData.notification_preferences,
      };

      const res = await updateProfile(payload);
      if (res.success) {
        setSuccessMsg('Đã cập nhật thông tin cá nhân thành công');
      } else {
        setErrorMsg(res.error || 'Cập nhật thất bại. Vui lòng kiểm tra lại.');
      }
    } catch (err: any) {
      setErrorMsg('Đã xảy ra lỗi không xác định khi lưu thông tin.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-6 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-slate-200 rounded-full" />
          <div className="space-y-2">
            <div className="h-5 w-48 bg-slate-200 rounded" />
            <div className="h-4 w-32 bg-slate-100 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          <div className="h-10 bg-slate-100 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notifications / Alerts */}
      {successMsg && (
        <div
          role="status"
          className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 underline hover:text-rose-900"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Thử lại</span>
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Section 1: Thông tin cơ bản */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-semibold text-slate-800">
                Thông tin cá nhân & Liên hệ
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                <Shield className="w-3 h-3 mr-1" />
                {user?.role || 'THÀNH VIÊN'}
              </span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Họ và tên */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Họ và tên <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="Nguyễn Văn A"
                    className={`w-full px-3.5 py-2 rounded-lg border text-sm transition focus:outline-none focus:ring-2 ${
                      fieldErrors.full_name
                        ? 'border-rose-300 focus:ring-rose-200 text-rose-900'
                        : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'
                    }`}
                  />
                </div>
                {fieldErrors.full_name && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.full_name}</p>
                )}
              </div>

              {/* Số điện thoại */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Số điện thoại
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="0901234567"
                    className={`w-full pl-9 pr-3.5 py-2 rounded-lg border text-sm transition focus:outline-none focus:ring-2 ${
                      fieldErrors.phone
                        ? 'border-rose-300 focus:ring-rose-200 text-rose-900'
                        : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'
                    }`}
                  />
                </div>
                {fieldErrors.phone && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.phone}</p>
                )}
              </div>

              {/* Email (Read-only) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Email đăng nhập
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    disabled
                    value={user?.email || 'user@shipde.net'}
                    className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm cursor-not-allowed"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Email định danh được quản lý bởi Quản trị viên
                </p>
              </div>

              {/* Avatar URL */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Đường dẫn ảnh đại diện (Avatar URL)
                </label>
                <input
                  type="url"
                  value={formData.avatar_url}
                  onChange={(e) => setFormData({ ...formData, avatar_url: e.target.value })}
                  placeholder="https://example.com/avatar.jpg"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Khu vực & Mặc định vận hành */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">Khu vực & Mặc định vận hành</h2>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Ngôn ngữ */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Ngôn ngữ hiển thị
                </label>
                <select
                  value={formData.language}
                  onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                >
                  <option value="vi">Tiếng Việt (Mặc định)</option>
                  <option value="en">English</option>
                </select>
              </div>

              {/* Múi giờ */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Múi giờ làm việc
                </label>
                <div className="relative">
                  <select
                    value={formData.timezone}
                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                  >
                    <option value="Asia/Ho_Chi_Minh">Giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7)</option>
                    <option value="Asia/Bangkok">Bangkok (Asia/Bangkok, UTC+7)</option>
                    <option value="UTC">Giờ chuẩn quốc tế (UTC+0)</option>
                  </select>
                </div>
              </div>

              {/* Kho mặc định */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Kho lấy hàng mặc định
                </label>
                <div className="relative">
                  <select
                    value={formData.default_warehouse_id}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        default_warehouse_id: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                  >
                    <option value="">-- Mặc định theo cửa hàng --</option>
                    <option value="wh_q3_hcm">Chi nhánh Quận 3 (Trụ sở chính)</option>
                    <option value="wh_tanbinh_hcm">Kho vận Tân Bình</option>
                    <option value="wh_caugiay_hn">Chi nhánh Cầu Giấy Hà Nội</option>
                  </select>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Tự động điền kho xuất hàng khi bạn tạo đơn mới
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Tùy chọn thông báo (BR-PRO-03) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-semibold text-slate-800">
                Tùy chọn thông báo & Cảnh báo vận hành
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              Tuân thủ NOTIFICATIONS-REPORTS
            </span>
          </div>

          <div className="p-6 space-y-6">
            {/* Channels & Digest */}
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-4">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Kênh nhận thông báo
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.channels.in_app}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notification_preferences: {
                          ...formData.notification_preferences,
                          channels: {
                            ...formData.notification_preferences.channels,
                            in_app: e.target.checked,
                          },
                        },
                      })
                    }
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span>Thông báo trong ứng dụng (In-app)</span>
                </label>

                <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.channels.email}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notification_preferences: {
                          ...formData.notification_preferences,
                          channels: {
                            ...formData.notification_preferences.channels,
                            email: e.target.checked,
                          },
                        },
                      })
                    }
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span>Email tóm tắt</span>
                </label>

                <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.channels.push}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notification_preferences: {
                          ...formData.notification_preferences,
                          channels: {
                            ...formData.notification_preferences.channels,
                            push: e.target.checked,
                          },
                        },
                      })
                    }
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span>Trình duyệt (Web Push)</span>
                </label>
              </div>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Khoảng thời gian gộp báo cáo (Digest interval):
                </span>
                <select
                  value={formData.notification_preferences.digest_window_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      notification_preferences: {
                        ...formData.notification_preferences,
                        digest_window_minutes: Number(e.target.value),
                      },
                    })
                  }
                  className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white"
                >
                  <option value={15}>15 phút</option>
                  <option value={30}>30 phút</option>
                  <option value={60}>60 phút</option>
                </select>
              </div>
            </div>

            {/* Subscriptions Table */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Sự kiện đăng ký nhận tin
              </h3>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                {/* Non-critical subscriptions */}
                <div className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Giao hàng thất bại (Delivery Fail)
                    </p>
                    <p className="text-xs text-slate-500">
                      Cảnh báo sự cố đơn hàng giao không thành công cần cứu đơn
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.subscriptions.delivery_fail}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notification_preferences: {
                          ...formData.notification_preferences,
                          subscriptions: {
                            ...formData.notification_preferences.subscriptions,
                            delivery_fail: e.target.checked,
                          },
                        },
                      })
                    }
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                </div>

                <div className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Phát hiện lệch cước vận chuyển
                    </p>
                    <p className="text-xs text-slate-500">
                      Cảnh báo sai lệch cước thực tế từ hãng so với bảng giá hợp đồng
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.subscriptions.rate_discrepancy}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notification_preferences: {
                          ...formData.notification_preferences,
                          subscriptions: {
                            ...formData.notification_preferences.subscriptions,
                            rate_discrepancy: e.target.checked,
                          },
                        },
                      })
                    }
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                </div>

                <div className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      COD quá hạn đối soát theo SLA
                    </p>
                    <p className="text-xs text-slate-500">
                      Đơn hàng đã giao thành công nhưng chưa nhận được đối soát thanh toán
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.subscriptions.cod_overdue}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notification_preferences: {
                          ...formData.notification_preferences,
                          subscriptions: {
                            ...formData.notification_preferences.subscriptions,
                            cod_overdue: e.target.checked,
                          },
                        },
                      })
                    }
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                </div>

                <div className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Hàng hoàn về kho bất thường
                    </p>
                    <p className="text-xs text-slate-500">
                      Hàng hư hỏng, thiếu phụ kiện hoặc mất dấu vết khi hoàn
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.subscriptions.abnormal_return}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notification_preferences: {
                          ...formData.notification_preferences,
                          subscriptions: {
                            ...formData.notification_preferences.subscriptions,
                            abnormal_return: e.target.checked,
                          },
                        },
                      })
                    }
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                </div>

                {/* Critical locked subscriptions per BR-PRO-03 */}
                <div className="p-3.5 flex items-center justify-between bg-amber-50/30">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-slate-800">
                        Cảnh báo bảo mật & tài khoản (Security alerts)
                      </p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        <Lock className="w-2.5 h-2.5 mr-0.5" />
                        Bắt buộc
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Thay đổi mật khẩu, thiết bị đăng nhập lạ, đặt lại xác thực hai yếu tố
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    disabled
                    checked={true}
                    className="w-4 h-4 text-indigo-600 rounded opacity-60 cursor-not-allowed"
                  />
                </div>

                <div className="p-3.5 flex items-center justify-between bg-amber-50/30">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-slate-800">
                        Sự cố tạo đơn chưa rõ kết quả hãng (Unknown create outcome)
                      </p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        <Lock className="w-2.5 h-2.5 mr-0.5" />
                        Bắt buộc
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Lệnh tạo đơn bị timeout cần đối soát từ xa để tránh tạo trùng vận đơn
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    disabled
                    checked={true}
                    className="w-4 h-4 text-indigo-600 rounded opacity-60 cursor-not-allowed"
                  />
                </div>

                <div className="p-3.5 flex items-center justify-between bg-amber-50/30">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-slate-800">
                        Hạn chót khiếu nại sắp tới hạn (Claim deadline approaching)
                      </p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        <Lock className="w-2.5 h-2.5 mr-0.5" />
                        Bắt buộc
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Nhắc nhở nộp chứng từ trước khi hãng vận chuyển đóng quyền khiếu nại
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    disabled
                    checked={true}
                    className="w-4 h-4 text-indigo-600 rounded opacity-60 cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang lưu...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Lưu thay đổi</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
