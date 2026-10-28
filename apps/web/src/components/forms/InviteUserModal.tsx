'use client';

import React, { useState } from 'react';
import {
  UserPlus,
  X,
  Loader2,
  AlertCircle,
  Mail,
  Phone,
  ShieldCheck,
  MapPin,
  Warehouse,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUserInvited: (user: any) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function parseScopeInput(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function canRetryInviteSubmission(params: {
  loading: boolean;
  errorMsg: string | null;
}): boolean {
  return !params.loading && Boolean(params.errorMsg);
}

export interface GrantableRoleOption {
  value: 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'OWNER';
  label: string;
}

export const ALL_ROLES: GrantableRoleOption[] = [
  { value: 'OPS_CSKH', label: 'CSKH / Vận Hành (Cứu đơn & xử lý sự cố)' },
  { value: 'WAREHOUSE', label: 'Thủ Kho (Xuất nhập kho, quét hoàn)' },
  { value: 'ACCOUNTANT', label: 'Kế Toán (Đối soát COD, ký nhận công nợ)' },
  { value: 'OWNER', label: 'Chủ Cửa Hàng (Toàn quyền quản trị)' },
];

/**
 * BR-INV-01 Privilege Ceiling helper: Returns only roles and scopes at or below actor's live role.
 * Non-owners cannot grant roles they do not possess.
 */
export function getGrantableRoles(actorRole?: string | null): GrantableRoleOption[] {
  if (actorRole === 'OWNER') {
    return ALL_ROLES;
  }
  if (actorRole === 'OPS_CSKH') {
    return [{ value: 'OPS_CSKH', label: 'CSKH / Vận Hành (Cứu đơn & xử lý sự cố)' }];
  }
  if (actorRole === 'WAREHOUSE') {
    return [{ value: 'WAREHOUSE', label: 'Thủ Kho (Xuất nhập kho, quét hoàn)' }];
  }
  if (actorRole === 'ACCOUNTANT') {
    return [{ value: 'ACCOUNTANT', label: 'Kế Toán (Đối soát COD, ký nhận công nợ)' }];
  }
  return [];
}

export function validateInviteForm(params: {
  channel: 'email' | 'phone';
  email: string;
  phone: string;
}): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (params.channel === 'email') {
    if (!params.email.trim()) {
      errors.email = 'Vui lòng nhập địa chỉ email';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.email.trim())) {
      errors.email = 'Địa chỉ email không đúng định dạng';
    }
  } else {
    if (!params.phone.trim()) {
      errors.phone = 'Vui lòng nhập số điện thoại';
    } else if (!/^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/.test(params.phone.trim().replace(/[\s-]/g, ''))) {
      errors.phone = 'Số điện thoại không đúng định dạng Việt Nam';
    }
  }
  return { isValid: Object.keys(errors).length === 0, errors };
}

export const InviteUserModal: React.FC<Props> = ({ isOpen, onClose, onUserInvited }) => {
  const { token, user } = useAuth();

  const grantableRoles = getGrantableRoles(user?.role);
  const isOwner = user?.role === 'OWNER';

  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'OWNER'>(
    grantableRoles[0]?.value || 'OPS_CSKH'
  );
  const [storeScopeInput, setStoreScopeInput] = useState('');
  const [whScopeInput, setWhScopeInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Ensure role is bounded to live grantable roles (BR-INV-01 / Round 10 Finding 5)
  const effectiveRole = grantableRoles.some((r) => r.value === role)
    ? role
    : grantableRoles[0]?.value || 'OPS_CSKH';

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setFieldErrors({});

    // Client validation
    const { isValid, errors } = validateInviteForm({ channel, email, phone });
    if (!isValid) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    try {
      const payload = {
        email: channel === 'email' ? email.trim() : undefined,
        phone: channel === 'phone' ? phone.trim().replace(/[\s-]/g, '') : undefined,
        role: effectiveRole,
        store_scopes: parseScopeInput(storeScopeInput),
        warehouse_scopes: parseScopeInput(whScopeInput),
      };

      const res = await fetch(`${API_BASE}/api/v1/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        const message = json.error?.message || 'Không thể gửi lời mời. Vui lòng thử lại.';
        const mapped: Record<string, string> = {};
        if (json.error?.fields && Array.isArray(json.error.fields)) {
          for (const f of json.error.fields) {
            mapped[f.field] = f.message;
          }
        }
        // Round 10 Finding 5: Surface API 403 as a field error without implying unheld roles/scopes are grantable
        if (res.status === 403 || json.error?.code === 'FORBIDDEN') {
          if (message.includes('chi nhánh') || message.includes('store')) {
            mapped.store_scopes = message;
          } else if (message.includes('kho hàng') || message.includes('warehouse')) {
            mapped.warehouse_scopes = message;
          } else {
            mapped.role = message;
          }
        }
        if (Object.keys(mapped).length > 0) {
          setFieldErrors(mapped);
        }
        throw new Error(message);
      }

      onUserInvited(json.data);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Mời Thành Viên Mới (FEAT-USR-01)</h3>
              <p className="text-[11px] text-slate-500">
                Phân quyền vai trò và giới hạn phạm vi chi nhánh / kho hàng
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="font-medium">{errorMsg}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => void handleSubmit(e as any)}
                disabled={loading}
                className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-semibold transition flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                <span>Thử lại</span>
              </button>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-red-500 hover:text-red-700 text-xs font-semibold px-1"
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="font-bold text-slate-700 block mb-1.5">Hình Thức Nhận Lời Mời:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannel('email')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border font-medium text-xs transition ${
                  channel === 'email'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Qua Email
              </button>
              <button
                type="button"
                onClick={() => setChannel('phone')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border font-medium text-xs transition ${
                  channel === 'phone'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                <Phone className="w-3.5 h-3.5" /> Qua Số Điện Thoại
              </button>
            </div>
          </div>

          {channel === 'email' ? (
            <div>
              <label htmlFor="invite-email" className="font-bold text-slate-700 block mb-1">
                Địa Chỉ Email:
              </label>
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cskh2@cuahang.vn"
                className={`w-full px-3 py-2 border rounded-lg text-xs outline-none transition ${
                  fieldErrors.email
                    ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                    : 'border-slate-200 focus:border-blue-500'
                }`}
              />
              {fieldErrors.email && (
                <p className="text-red-500 text-[11px] mt-1">{fieldErrors.email}</p>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="invite-phone" className="font-bold text-slate-700 block mb-1">
                Số Điện Thoại (Việt Nam):
              </label>
              <input
                id="invite-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0901234567"
                className={`w-full px-3 py-2 border rounded-lg text-xs outline-none transition ${
                  fieldErrors.phone
                    ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                    : 'border-slate-200 focus:border-blue-500'
                }`}
              />
              {fieldErrors.phone && (
                <p className="text-red-500 text-[11px] mt-1">{fieldErrors.phone}</p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="invite-role" className="font-bold text-slate-700 block mb-1">
              Vai Trò Phân Quyền:
            </label>
            <select
              id="invite-role"
              value={effectiveRole}
              onChange={(e) => setRole(e.target.value as any)}
              className={`w-full px-3 py-2 border rounded-lg text-xs font-semibold outline-none focus:border-blue-500 bg-white ${
                fieldErrors.role
                  ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                  : 'border-slate-200'
              }`}
            >
              {grantableRoles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {fieldErrors.role && (
              <p className="text-red-500 text-[11px] mt-1">{fieldErrors.role}</p>
            )}
            {!isOwner && (
              <p className="text-[11px] text-slate-500 mt-1 italic">
                * Theo hạn mức phân quyền (BR-INV-01), bạn chỉ có thể mời thành viên với vai trò và
                phạm vi không vượt quá tài khoản của mình.
              </p>
            )}
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-500" /> Phạm Vi Chi Nhánh / Cửa Hàng:
            </label>
            <p className="text-[11px] text-slate-500 mb-1.5">
              Nhập mã chi nhánh ngăn cách bởi dấu phẩy (VD: store-01, store-02) hoặc để trống nếu
              không gán phạm vi.
            </p>
            <input
              type="text"
              placeholder="VD: store-01, store-02 (để trống: không gán phạm vi)"
              value={storeScopeInput}
              onChange={(e) => setStoreScopeInput(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-xs outline-none focus:border-blue-500 bg-white ${
                fieldErrors.store_scopes
                  ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                  : 'border-slate-200'
              }`}
            />
            {fieldErrors.store_scopes && (
              <p className="text-red-500 text-[11px] mt-1">{fieldErrors.store_scopes}</p>
            )}
            {!isOwner &&
              user?.store_scopes &&
              user.store_scopes.length > 0 &&
              !user.store_scopes.includes('*') && (
                <p className="text-[11px] text-slate-500 mt-1 italic">
                  * Phạm vi chi nhánh tối đa bạn có thể phân quyền: {user.store_scopes.join(', ')}
                </p>
              )}
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1 flex items-center gap-1.5">
              <Warehouse className="w-3.5 h-3.5 text-slate-500" /> Phạm Vi Kho Hàng:
            </label>
            <p className="text-[11px] text-slate-500 mb-1.5">
              Nhập mã kho hàng ngăn cách bởi dấu phẩy (VD: wh-north, wh-south) hoặc để trống nếu
              không gán phạm vi.
            </p>
            <input
              type="text"
              placeholder="VD: wh-north, wh-south (để trống: không gán phạm vi)"
              value={whScopeInput}
              onChange={(e) => setWhScopeInput(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-xs outline-none focus:border-blue-500 bg-white ${
                fieldErrors.warehouse_scopes
                  ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                  : 'border-slate-200'
              }`}
            />
            {fieldErrors.warehouse_scopes && (
              <p className="text-red-500 text-[11px] mt-1">{fieldErrors.warehouse_scopes}</p>
            )}
            {!isOwner &&
              user?.warehouse_scopes &&
              user.warehouse_scopes.length > 0 &&
              !user.warehouse_scopes.includes('*') && (
                <p className="text-[11px] text-slate-500 mt-1 italic">
                  * Phạm vi kho hàng tối đa bạn có thể phân quyền:{' '}
                  {user.warehouse_scopes.join(', ')}
                </p>
              )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 font-medium text-xs transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Đang gửi lời mời...' : 'Gửi Lời Mời'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
