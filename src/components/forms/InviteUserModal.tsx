'use client';

import React, { useState } from 'react';
import { UserPlus, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUserInvited: (user: any) => void;
}

export const InviteUserModal: React.FC<Props> = ({ isOpen, onClose, onUserInvited }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('OPS_CSKH');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'INVITE_USER',
          full_name: name,
          email,
          role,
        }),
      });

      const data = await res.json();
      onUserInvited({ name, email, role });
      onClose();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Mời Thành Viên Mới (CN-24)</h3>
              <p className="text-[11px] text-slate-500">Tách quyền tài chính và cấp quyền truy cập theo vai trò</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="font-bold text-slate-700 block mb-1">Họ và Tên:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trần Thị B"
              className="modern-input w-full text-xs"
              required
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Địa Chỉ Email:</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cskh2@ananboutique.vn"
              className="modern-input w-full text-xs"
              required
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Vai Trò Phân Quyền:</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="modern-input w-full text-xs font-semibold"
            >
              <option value="OPS_CSKH">CSKH / Vận Hành (Cứu đơn)</option>
              <option value="ACCOUNTANT">Kế Toán (Duyệt đối soát & Maker-Checker)</option>
              <option value="WAREHOUSE">Thủ Kho (Quét hoàn ngoại tuyến)</option>
              <option value="OWNER">Đồng Quản Trị (Owner)</option>
            </select>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary text-xs"
            >
              {loading ? 'Đang gửi...' : 'Gửi Lời Mời'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
