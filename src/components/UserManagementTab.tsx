'use client';

import React, { useState } from 'react';
import {
  UserCheck,
  UserPlus,
  Smartphone,
  Trash2,
  Key,
  CheckCircle2,
  ShieldAlert,
  Shield,
  Store,
  Lock,
  Eye,
  Sliders,
  Check,
  RotateCcw,
  Building2,
  MapPin,
  Plus,
  Edit,
  ChevronRight,
  Filter,
  Layers,
} from 'lucide-react';
import { InviteUserModal } from './forms/InviteUserModal';

// Available Stores in the system
export interface StoreItem {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  manager: string;
  active_orders_count: number;
  status: 'ACTIVE' | 'INACTIVE';
}

// User with Store Scoping & Custom Overrides
export interface UserWithStores {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: 'OWNER' | 'STORE_MANAGER' | 'OPS_CSKH' | 'ACCOUNTANT' | 'WAREHOUSE';
  assigned_stores: string[]; // ['*'] for all, or store IDs ['store_01', 'store_02']
  custom_permissions?: { [key: string]: boolean };
  status: 'ACTIVE' | 'LOCKED' | 'INVITED';
  last_login?: string;
  created_at: string;
}

export const UserManagementTab: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'matrix' | 'stores' | 'members' | 'devices'>('members');
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal edit user state
  const [editingUser, setEditingUser] = useState<UserWithStores | null>(null);

  // Modal new store state
  const [isNewStoreModalOpen, setIsNewStoreModalOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreCode, setNewStoreCode] = useState('');
  const [newStoreAddress, setNewStoreAddress] = useState('');
  const [newStorePhone, setNewStorePhone] = useState('0908889999');

  // Stores List
  const [stores, setStores] = useState<StoreItem[]>([
    {
      id: 'store_01',
      code: 'HCM-Q3',
      name: 'Chi Nhánh Quận 3 (Trụ Sở Chính)',
      address: '128 Nguyễn Trãi, P.3, Q.5, TP. Hồ Chí Minh',
      phone: '0901234567',
      manager: 'Nguyễn Văn An',
      active_orders_count: 1420,
      status: 'ACTIVE',
    },
    {
      id: 'store_02',
      code: 'HCM-TB',
      name: 'Kho Vận & Cửa Hàng Tân Bình',
      address: '123 Cộng Hòa, P.12, Q. Tân Bình, TP. Hồ Chí Minh',
      phone: '0909876543',
      manager: 'Phạm Văn Kho',
      active_orders_count: 890,
      status: 'ACTIVE',
    },
    {
      id: 'store_03',
      code: 'HN-CG',
      name: 'Chi Nhánh Hà Nội (Cầu Giấy)',
      address: '45 Trần Thái Tông, Cầu Giấy, Hà Nội',
      phone: '0903334444',
      manager: 'Lê Minh Kế Toán',
      active_orders_count: 650,
      status: 'ACTIVE',
    },
    {
      id: 'store_04',
      code: 'DN-HC',
      name: 'Chi Nhánh Đà Nẵng (Hải Châu)',
      address: '88 Nguyễn Văn Linh, Hải Châu, Đà Nẵng',
      phone: '0905556666',
      manager: 'Trần Thị Hoa',
      active_orders_count: 320,
      status: 'ACTIVE',
    },
  ]);

  // Users List with Store Scoping
  const [users, setUsers] = useState<UserWithStores[]>([
    {
      id: 'usr_01',
      full_name: 'Nguyễn Văn An',
      email: 'owner@ananboutique.vn',
      phone: '0901234567',
      role: 'OWNER',
      assigned_stores: ['*'], // All stores
      status: 'ACTIVE',
      last_login: 'Vừa xong (IP: 118.69.182.10)',
      created_at: '01/01/2026',
    },
    {
      id: 'usr_02',
      full_name: 'Trần Thị Hoa',
      email: 'cskh_hoa@ananboutique.vn',
      phone: '0909876543',
      role: 'OPS_CSKH',
      assigned_stores: ['store_01', 'store_04'], // Q3 & Da Nang
      status: 'ACTIVE',
      last_login: '10 phút trước',
      created_at: '15/01/2026',
    },
    {
      id: 'usr_03',
      full_name: 'Lê Minh Kế Toán',
      email: 'ketoan_minh@ananboutique.vn',
      phone: '0903334444',
      role: 'ACCOUNTANT',
      assigned_stores: ['*'], // Accountant audits all stores
      status: 'ACTIVE',
      last_login: '1 giờ trước',
      created_at: '02/02/2026',
    },
    {
      id: 'usr_04',
      full_name: 'Phạm Văn Kho',
      email: 'thukho_tb@ananboutique.vn',
      phone: '0904445555',
      role: 'WAREHOUSE',
      assigned_stores: ['store_02'], // Only Tan Binh Warehouse
      status: 'ACTIVE',
      last_login: 'Hôm nay lúc 08:30',
      created_at: '10/02/2026',
    },
    {
      id: 'usr_05',
      full_name: 'Vũ Quốc Quản Lý',
      email: 'manager_hn@ananboutique.vn',
      phone: '0906667777',
      role: 'STORE_MANAGER',
      assigned_stores: ['store_03'], // Only Hanoi Branch
      status: 'ACTIVE',
      last_login: 'Hôm qua',
      created_at: '20/03/2026',
    },
  ]);

  // RBAC Granular Matrix State
  const [permissionsMatrix, setPermissionsMatrix] = useState([
    {
      id: 'p_pii',
      feature: 'Xem & Mở che số điện thoại khách hàng (PII)',
      rule: 'BR-42 · Ghi nhật ký Audit Trail',
      owner: true,
      manager: true,
      cskh: true,
      accountant: false,
      warehouse: false,
    },
    {
      id: 'p_reattempt',
      feature: 'Gửi lệnh cứu đơn & yêu cầu giao lại qua Open API',
      rule: 'CN-10 · L2 Execute / L1 Assist',
      owner: true,
      manager: true,
      cskh: true,
      accountant: false,
      warehouse: false,
    },
    {
      id: 'p_discrepancy',
      feature: 'Duyệt xử lý sai lệch đối soát (Maker-Checker)',
      rule: 'BR-12 · Tách quyền tài chính cấp bản ghi',
      owner: true,
      manager: false,
      cskh: false, // Strictly false for CSKH (Maker-Checker invariant)
      accountant: true,
      warehouse: false,
    },
    {
      id: 'p_close_period',
      feature: 'Khóa sổ kỳ đối soát COD & Cước',
      rule: 'BR-11 · Bất biến không sửa đổi sau khi chốt',
      owner: true,
      manager: false,
      cskh: false,
      accountant: true,
      warehouse: false,
    },
    {
      id: 'p_return_scan',
      feature: 'Quét nhận hàng hoàn kho ngoại tuyến SQLite',
      rule: 'BR-40 / BR-36 · Khử trùng lặp lũy đẳng',
      owner: true,
      manager: true,
      cskh: false,
      accountant: false,
      warehouse: true,
    },
    {
      id: 'p_api_config',
      feature: 'Khai báo API Hãng, Webhook Key & Biểu giá',
      rule: 'BR-51 · Quyền quản trị kết nối cấp Shop',
      owner: true,
      manager: false,
      cskh: false,
      accountant: false,
      warehouse: false,
    },
    {
      id: 'p_export_ledgers',
      feature: 'Xuất dữ liệu Ba Sổ Giá Trị & File Báo Cáo',
      rule: 'BR-45 · Quyền truy xuất số liệu kế toán',
      owner: true,
      manager: true,
      cskh: false,
      accountant: true,
      warehouse: false,
    },
  ]);

  // Active Device Sessions
  const [deviceSessions, setDeviceSessions] = useState([
    {
      id: 'dev_01',
      user_name: 'Nguyễn Văn An (Chủ Shop)',
      device_name: 'MacBook Pro 16" (macOS 15.1 · Chrome 128)',
      store_scope: 'Toàn hệ thống (4 Chi nhánh)',
      ip_address: '118.69.182.10',
      location: 'Quận 1, TP. Hồ Chí Minh',
      last_active: 'Đang hoạt động',
      is_current: true,
    },
    {
      id: 'dev_02',
      user_name: 'Trần Thị Hoa (CSKH)',
      device_name: 'Windows 11 PC (Edge 127)',
      store_scope: 'Chi Nhánh Quận 3 & Đà Nẵng',
      ip_address: '14.232.208.45',
      location: 'Quận 3, TP. Hồ Chí Minh',
      last_active: '12 phút trước',
      is_current: false,
    },
    {
      id: 'dev_03',
      user_name: 'Phạm Văn Kho (Thủ Kho)',
      device_name: 'PDA Máy Quét Honeywell EDA51 (Android 11)',
      store_scope: 'Kho Vận Tân Bình',
      ip_address: '115.78.14.92',
      location: 'Tân Bình, TP. Hồ Chí Minh',
      last_active: '35 phút trước (Offline Sync)',
      is_current: false,
    },
  ]);

  const handleRevokeDevice = (deviceId: string, userName: string) => {
    setDeviceSessions(prev => prev.filter(d => d.id !== deviceId));
    setToastMessage(`[BR-08]: Đã thu hồi quyền truy cập của thiết bị [${userName}]. Mọi lệnh quét offline từ máy này sẽ bị từ chối với mã 401 device_revoked.`);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleTogglePermission = (featureId: string, roleKey: 'owner' | 'manager' | 'cskh' | 'accountant' | 'warehouse') => {
    // Invariant check: CSKH cannot have p_discrepancy (Maker-Checker BR-12)
    if (featureId === 'p_discrepancy' && roleKey === 'cskh') {
      alert('[Bất biến Maker-Checker BR-12]: Nhân viên CSKH can thiệp đơn hàng KHÔNG ĐƯỢC PHÉP tự duyệt chênh lệch tài chính. Hệ thống chặn thay đổi quyền này.');
      return;
    }

    setPermissionsMatrix(prev =>
      prev.map(item => {
        if (item.id === featureId) {
          return { ...item, [roleKey]: !item[roleKey] };
        }
        return item;
      })
    );

    setToastMessage('Đã cập nhật ma trận phân quyền RBAC thời gian thực.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSaveUserPermissions = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setUsers(prev => prev.map(u => (u.id === editingUser.id ? editingUser : u)));
    setToastMessage(`Đã cập nhật phạm vi cửa hàng và phân quyền cho nhân viên [${editingUser.full_name}].`);
    setEditingUser(null);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleCreateStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName || !newStoreCode) return;

    const newStore: StoreItem = {
      id: `store_${Date.now().toString().slice(-4)}`,
      code: newStoreCode.toUpperCase(),
      name: newStoreName,
      address: newStoreAddress,
      phone: newStorePhone,
      manager: 'Nguyễn Văn An',
      active_orders_count: 0,
      status: 'ACTIVE',
    };

    setStores(prev => [...prev, newStore]);
    setIsNewStoreModalOpen(false);
    setNewStoreName('');
    setNewStoreCode('');
    setNewStoreAddress('');
    setToastMessage(`Đã thêm chi nhánh mới [${newStore.name}].`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="w-full space-y-5">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button type="button" onClick={() => setToastMessage(null)} className="font-bold text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Trung Tâm Phân Quyền & Quản Trị Cửa Hàng (Multi-Store RBAC)
            </h2>
            <span className="badge-ok text-xs">Chuẩn Tách Quyền BR-12</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Phân quyền chi tiết theo từng người dùng, giới hạn phạm vi truy cập theo chi nhánh/kho, và thu hồi thiết bị từ xa (BR-08)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsNewStoreModalOpen(true)}
            className="btn-secondary text-xs"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>+ Thêm Chi Nhánh</span>
          </button>
          <button
            type="button"
            onClick={() => setIsInviteOpen(true)}
            className="btn-primary text-xs"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Mời Thành Viên Mới</span>
          </button>
        </div>
      </div>

      {/* 4-SubTab Navigation */}
      <div className="flex border-b border-slate-200 space-x-2 text-xs font-bold">
        {[
          { id: 'members', label: '1. Phân Quyền Nhân Viên & Cửa Hàng', icon: UserCheck, count: users.length },
          { id: 'stores', label: '2. Quản Lý Cửa Hàng / Chi Nhánh', icon: Store, count: stores.length },
          { id: 'matrix', label: '3. Ma Trận Quyền Nghiệp Vụ (RBAC)', icon: Sliders },
          { id: 'devices', label: '4. Phiên Thiết Bị & Thu Hồi Từ Xa (BR-08)', icon: Smartphone, count: deviceSessions.length },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition cursor-pointer ${
                isActive
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SUBTAB 1: MEMBERS & STORE SCOPING */}
      {activeSubTab === 'members' && (
        <div className="space-y-4">
          <div className="modern-card p-4 flex justify-between items-center bg-slate-50/60">
            <div className="text-xs text-slate-600">
              Tổng số <strong>{users.length}</strong> nhân sự trong hệ thống · Mỗi nhân sự được giới hạn truy cập theo chi nhánh chỉ định để bảo mật dữ liệu khách hàng.
            </div>
          </div>

          <div className="modern-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-4">Nhân Viên / Email</th>
                    <th className="py-3 px-4">Vai Trò Chính</th>
                    <th className="py-3 px-4">Phạm Vi Cửa Hàng / Chi Nhánh</th>
                    <th className="py-3 px-4">Đăng Nhập Gần Nhất</th>
                    <th className="py-3 px-4">Trạng Thái</th>
                    <th className="py-3 px-4 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(u => {
                    const isAllStores = u.assigned_stores.includes('*');
                    const assignedStoreObjs = isAllStores
                      ? stores
                      : stores.filter(s => u.assigned_stores.includes(s.id));

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                              {u.full_name.charAt(0)}
                            </div>
                            <div>
                              <strong className="text-slate-900 text-xs block">{u.full_name}</strong>
                              <span className="font-mono text-[11px] text-slate-500">{u.email}</span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`badge-muted text-[11px] font-bold ${
                              u.role === 'OWNER'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : u.role === 'ACCOUNTANT'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : u.role === 'OPS_CSKH'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : u.role === 'STORE_MANAGER'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {u.role === 'OWNER'
                              ? '👑 Chủ Shop (Owner)'
                              : u.role === 'ACCOUNTANT'
                              ? '💼 Kế Toán (Maker-Checker)'
                              : u.role === 'OPS_CSKH'
                              ? '🎧 CSKH / Cứu Đơn'
                              : u.role === 'STORE_MANAGER'
                              ? '🏢 Quản Lý Chi Nhánh'
                              : '📦 Thủ Kho'}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1">
                            {isAllStores ? (
                              <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-[10px] flex items-center gap-1">
                                <Building2 className="w-3 h-3" />
                                <span>Toàn Hệ Thống (Tất cả 4 chi nhánh)</span>
                              </span>
                            ) : (
                              assignedStoreObjs.map(s => (
                                <span
                                  key={s.id}
                                  className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium text-[10px] flex items-center gap-1"
                                >
                                  <Store className="w-3 h-3 text-slate-400" />
                                  <span>{s.name.split('(')[0]}</span>
                                </span>
                              ))
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                          {u.last_login || 'Chưa đăng nhập'}
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="badge-ok text-[10px]">Hoạt động</span>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setEditingUser(u)}
                            className="btn-secondary text-xs py-1 px-2.5 text-blue-600 hover:text-blue-700"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>Phân Quyền</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: STORES / BRANCHES MANAGEMENT */}
      {activeSubTab === 'stores' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {stores.map(store => (
              <div key={store.id} className="modern-card p-5 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {store.code}
                    </span>
                    <span className="badge-ok text-[10px]">Đang hoạt động</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">{store.name}</h4>
                  <div className="space-y-1 text-xs text-slate-500">
                    <p className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{store.address}</span>
                    </p>
                    <p className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span>Hotline: {store.phone}</span>
                    </p>
                    <p className="text-slate-600">
                      Quản lý: <strong>{store.manager}</strong>
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                  <span className="text-slate-500">Đơn hàng active:</span>
                  <strong className="font-mono text-slate-900 font-bold">{store.active_orders_count.toLocaleString()} đơn</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUBTAB 3: RBAC MATRIX */}
      {activeSubTab === 'matrix' && (
        <div className="space-y-4">
          <div className="modern-card p-4 bg-slate-50/70 border border-slate-200 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <ShieldAlert className="w-4 h-4 text-blue-600" />
              <span>Bảo Vệ Tính Toàn Vẹn Quyền Hạn (Invariants Guard)</span>
            </div>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Hệ thống thực thi nguyên tắc phân chia trách nhiệm (Segregation of Duties). 
              Quy tắc <strong>Maker-Checker (BR-12)</strong> khóa cứng không cho phép vai trò CSKH tự duyệt sai lệch đối soát tài chính nhằm phòng ngừa gian lận.
            </p>
          </div>

          <div className="modern-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-4 w-1/3">Tính Năng & Nghiệp Vụ</th>
                    <th className="py-3 px-4">Quy Tắc Ràng Buộc</th>
                    <th className="py-3 px-3 text-center">Chủ Shop</th>
                    <th className="py-3 px-3 text-center">Quản Lý</th>
                    <th className="py-3 px-3 text-center">CSKH</th>
                    <th className="py-3 px-3 text-center">Kế Toán</th>
                    <th className="py-3 px-3 text-center">Thủ Kho</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {permissionsMatrix.map(row => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {row.feature}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                        {row.rule}
                      </td>
                      {['owner', 'manager', 'cskh', 'accountant', 'warehouse'].map((roleKey: any) => {
                        const hasPerm = (row as any)[roleKey];
                        const isCskhDiscrepancy = row.id === 'p_discrepancy' && roleKey === 'cskh';

                        return (
                          <td key={roleKey} className="py-3 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleTogglePermission(row.id, roleKey)}
                              disabled={isCskhDiscrepancy}
                              className={`w-6 h-6 rounded-md inline-flex items-center justify-center transition cursor-pointer ${
                                isCskhDiscrepancy
                                  ? 'bg-rose-50 text-rose-300 border border-rose-200 cursor-not-allowed'
                                  : hasPerm
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                                  : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200'
                              }`}
                              title={isCskhDiscrepancy ? 'Bị khóa bởi quy tắc Maker-Checker BR-12' : 'Bấm để đổi quyền'}
                            >
                              {hasPerm ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '✕'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 4: REMOTE DEVICE SESSIONS */}
      {activeSubTab === 'devices' && (
        <div className="space-y-4">
          <div className="modern-card p-4 bg-slate-50/70 text-xs space-y-1">
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-blue-600" />
              <span>Cơ Chế Thu Hồi Quyền Thiết Bị Từ Xa (CN-25 · BR-08)</span>
            </h4>
            <p className="text-slate-600 text-[11px]">
              Khi thiết bị PDA của nhân viên kho bị thất lạc, Chủ Shop có thể thu hồi phiên tức thì. Máy bị thu hồi khi có mạng sẽ nhận mã <strong>401 device_revoked</strong> và bị hủy quyền đồng bộ dữ liệu.
            </p>
          </div>

          <div className="space-y-3">
            {deviceSessions.map(session => (
              <div key={session.id} className="modern-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-slate-900 text-xs">{session.device_name}</strong>
                      {session.is_current && <span className="badge-ok text-[10px]">Thiết bị này</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 space-x-2">
                      <span>Người dùng: <strong>{session.user_name}</strong></span>
                      <span>·</span>
                      <span>Chi nhánh: <strong>{session.store_scope}</strong></span>
                      <span>·</span>
                      <span className="font-mono">IP: {session.ip_address} ({session.location})</span>
                    </div>
                  </div>
                </div>

                {!session.is_current && (
                  <button
                    type="button"
                    onClick={() => handleRevokeDevice(session.id, session.user_name)}
                    className="btn-danger text-xs py-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Thu Hồi Quyền (Revoke)</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER PERMISSIONS & STORE SCOPES */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Phân Quyền & Cửa Hàng Cho Nhân Viên</h3>
                  <p className="text-[11px] text-slate-500 font-mono">{editingUser.full_name} ({editingUser.email})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUserPermissions} className="space-y-4">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Vai Trò Phân Quyền:</label>
                <select
                  value={editingUser.role}
                  onChange={(e: any) => setEditingUser({ ...editingUser, role: e.target.value })}
                  className="modern-input w-full text-xs font-semibold"
                >
                  <option value="OWNER">👑 Chủ Shop (Owner - Toàn quyền)</option>
                  <option value="STORE_MANAGER">🏢 Quản Lý Cửa Hàng (Store Manager)</option>
                  <option value="OPS_CSKH">🎧 CSKH / Vận Hành (Cứu đơn)</option>
                  <option value="ACCOUNTANT">💼 Kế Toán Đối Soát (Maker-Checker)</option>
                  <option value="WAREHOUSE">📦 Thủ Kho (Quét hoàn)</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1.5">
                  Phạm Vi Cửa Hàng / Chi Nhánh Được Phép Truy Cập:
                </label>
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-900 pb-1.5 border-b border-slate-200">
                    <input
                      type="checkbox"
                      checked={editingUser.assigned_stores.includes('*')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditingUser({ ...editingUser, assigned_stores: ['*'] });
                        } else {
                          setEditingUser({ ...editingUser, assigned_stores: ['store_01'] });
                        }
                      }}
                      className="rounded text-blue-600"
                    />
                    <span>Toàn Hệ Thống (Tất Cả Chi Nhánh)</span>
                  </label>

                  {!editingUser.assigned_stores.includes('*') && (
                    <div className="space-y-1.5 pt-1">
                      {stores.map(s => {
                        const isChecked = editingUser.assigned_stores.includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-2 text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                let newStores = [...editingUser.assigned_stores];
                                if (e.target.checked) {
                                  newStores.push(s.id);
                                } else {
                                  newStores = newStores.filter(id => id !== s.id);
                                }
                                setEditingUser({ ...editingUser, assigned_stores: newStores });
                              }}
                              className="rounded text-blue-600"
                            />
                            <span>{s.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="btn-secondary text-xs"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn-primary text-xs"
                >
                  Lưu Phân Quyền
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE NEW STORE */}
      {isNewStoreModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Thêm Cửa Hàng / Chi Nhánh Mới</h3>
                  <p className="text-[11px] text-slate-500">Mở rộng mạng lưới cửa hàng và kho vận</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewStoreModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Mã Chi Nhánh:</label>
                  <input
                    type="text"
                    value={newStoreCode}
                    onChange={(e) => setNewStoreCode(e.target.value)}
                    placeholder="HCM-BT"
                    className="modern-input w-full font-mono uppercase font-bold text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Số Hotline:</label>
                  <input
                    type="tel"
                    value={newStorePhone}
                    onChange={(e) => setNewStorePhone(e.target.value)}
                    className="modern-input w-full font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Tên Cửa Hàng / Kho:</label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  placeholder="Chi Nhánh Bình Thạnh - Kho Phụ"
                  className="modern-input w-full text-xs"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Địa Chỉ Chi Tiết:</label>
                <input
                  type="text"
                  value={newStoreAddress}
                  onChange={(e) => setNewStoreAddress(e.target.value)}
                  placeholder="345 Bạch Đằng, P.14, Bình Thạnh, HCM"
                  className="modern-input w-full text-xs"
                  required
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsNewStoreModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn-primary text-xs"
                >
                  Tạo Chi Nhánh
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: INVITE USER */}
      <InviteUserModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        onUserInvited={(newUser: any) => {
          setUsers(prev => [
            ...prev,
            {
              id: `usr_${Date.now().toString().slice(-4)}`,
              full_name: newUser.name,
              email: newUser.email,
              phone: '0901234888',
              role: newUser.role,
              assigned_stores: ['store_01'],
              status: 'ACTIVE',
              last_login: 'Vừa mời',
              created_at: new Date().toLocaleDateString('vi-VN'),
            },
          ]);
          setToastMessage(`Đã gửi thư mời kèm link kích hoạt cho [${newUser.email}]. Token hết hạn sau 7 ngày (CN-24).`);
          setTimeout(() => setToastMessage(null), 5000);
        }}
      />
    </div>
  );
};
