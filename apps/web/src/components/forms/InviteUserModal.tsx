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
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUserInvited: (user: any) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const InviteUserModal: React.FC<Props> = ({ isOpen, onClose, onUserInvited }) => {
  const { token, user } = useAuth();

  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'OWNER'>('OPS_CSKH');
  const [selectedStores, setSelectedStores] = useState<string[]>(['HCM-Q3']);
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>(['KHO-TONG']);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const isOwner = user?.role === 'OWNER';

  const toggleStore = (storeCode: string) => {
    setSelectedStores((prev) =>
      prev.includes(storeCode) ? prev.filter((s) => s !== storeCode) : [...prev, storeCode]
    );
  };

  const toggleWarehouse = (whCode: string) => {
    setSelectedWarehouses((prev) =>
      prev.includes(whCode) ? prev.filter((w) => w !== whCode) : [...prev, whCode]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setFieldErrors({});

    // Client validation
    const errors: Record<string, string> = {};
    if (channel === 'email') {
      if (!email.trim()) {
        errors.email = 'Vui lòng nhập địa chỉ email';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        errors.email = 'Địa chỉ email không đúng định dạng';
      }
    } else {
      if (!phone.trim()) {
        errors.phone = 'Vui lòng nhập số điện thoại';
      } else if (!/^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/.test(phone.trim().replace(/[\s-]/g, ''))) {
        errors.phone = 'Số điện thoại không đúng định dạng Việt Nam';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    try {
      const payload = {
        email: channel === 'email' ? email.trim() : undefined,
        phone: channel === 'phone' ? phone.trim().replace(/[\s-]/g, '') : undefined,
        role,
        store_scopes: selectedStores,
        warehouse_scopes: selectedWarehouses,
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
        if (json.error?.fields && Array.isArray(json.error.fields)) {
          const mapped: Record<string, string> = {};
          for (const f of json.error.fields) {
            mapped[f.field] = f.message;
          }
          setFieldErrors(mapped);
        }
        throw new Error(json.error?.message || 'Không thể gửi lời mời. Vui lòng thử lại.');
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
            <div className="flex-1">
              <p className="font-medium">{errorMsg}</p>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-red-500 hover:text-red-700 text-xs font-semibold"
            >
              Đóng
            </button>
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
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold outline-none focus:border-blue-500 bg-white"
            >
              <option value="OPS_CSKH">CSKH / Vận Hành (Cứu đơn & xử lý sự cố)</option>
              <option value="WAREHOUSE">Thủ Kho (Xuất nhập kho, quét hoàn)</option>
              <option value="ACCOUNTANT">Kế Toán (Đối soát COD, ký nhận công nợ)</option>
              {isOwner && <option value="OWNER">Chủ Cửa Hàng (Toàn quyền quản trị)</option>}
            </select>
            {!isOwner && (
              <p className="text-[11px] text-slate-500 mt-1 italic">
                * Chỉ Chủ cửa hàng mới có quyền mời thành viên với vai trò Đồng Quản Trị (OWNER).
              </p>
            )}
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-500" /> Phạm Vi Chi Nhánh / Cửa Hàng:
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { code: 'HCM-Q3', name: 'Chi Nhánh Quận 3' },
                { code: 'HCM-TB', name: 'Chi Nhánh Tân Bình' },
                { code: 'HN-CG', name: 'Chi Nhánh Cầu Giấy' },
              ].map((store) => (
                <button
                  key={store.code}
                  type="button"
                  onClick={() => toggleStore(store.code)}
                  className={`px-2.5 py-1 rounded-md text-[11px] border font-medium transition ${
                    selectedStores.includes(store.code)
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {selectedStores.includes(store.code) ? '✓ ' : '+ '}
                  {store.name} ({store.code})
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1.5 flex items-center gap-1.5">
              <Warehouse className="w-3.5 h-3.5 text-slate-500" /> Phạm Vi Kho Hàng:
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { code: 'KHO-TONG', name: 'Kho Tổng Miền Nam' },
                { code: 'KHO-TB', name: 'Kho Vận Tân Bình' },
                { code: 'KHO-CG', name: 'Kho Vận Cầu Giấy' },
              ].map((wh) => (
                <button
                  key={wh.code}
                  type="button"
                  onClick={() => toggleWarehouse(wh.code)}
                  className={`px-2.5 py-1 rounded-md text-[11px] border font-medium transition ${
                    selectedWarehouses.includes(wh.code)
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {selectedWarehouses.includes(wh.code) ? '✓ ' : '+ '}
                  {wh.name} ({wh.code})
                </button>
              ))}
            </div>
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
