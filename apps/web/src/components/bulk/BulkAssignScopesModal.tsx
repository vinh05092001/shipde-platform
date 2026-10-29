'use client';

import React, { useState } from 'react';
import { Store, Warehouse, X, Loader2, Info } from 'lucide-react';
import type { StoreItem } from '../UserManagementTab';
import type { WarehouseItem } from './bulk-types';

export interface BulkAssignScopesModalProps {
  isOpen: boolean;
  selectedCount: number;
  availableStores: StoreItem[];
  availableWarehouses: WarehouseItem[];
  loading?: boolean;
  onConfirm: (scopes: { store_scopes: string[]; warehouse_scopes: string[] }) => void;
  onCancel: () => void;
}

export const BulkAssignScopesModal: React.FC<BulkAssignScopesModalProps> = ({
  isOpen,
  selectedCount,
  availableStores,
  availableWarehouses,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const [allStores, setAllStores] = useState(false);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [allWarehouses, setAllWarehouses] = useState(false);
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleToggleStore = (storeId: string) => {
    if (selectedStores.includes(storeId)) {
      setSelectedStores(selectedStores.filter((id) => id !== storeId));
    } else {
      setSelectedStores([...selectedStores, storeId]);
    }
  };

  const handleToggleWarehouse = (whId: string) => {
    if (selectedWarehouses.includes(whId)) {
      setSelectedWarehouses(selectedWarehouses.filter((id) => id !== whId));
    } else {
      setSelectedWarehouses([...selectedWarehouses, whId]);
    }
  };

  const handleSubmit = () => {
    const finalStoreScopes = allStores ? ['*'] : selectedStores;
    const finalWhScopes = allWarehouses ? ['*'] : selectedWarehouses;
    onConfirm({
      store_scopes: finalStoreScopes,
      warehouse_scopes: finalWhScopes,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-assign-scopes-title"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      data-testid="bulk-assign-scopes-modal"
    >
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between border-b border-slate-100">
          <div>
            <h3
              id="bulk-assign-scopes-title"
              className="text-base font-bold text-slate-900"
              data-testid="bulk-assign-scopes-title"
            >
              Gán phạm vi hàng loạt cho {selectedCount} nhân sự
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cập nhật quyền hạn chi nhánh &amp; kho hàng cho các tài khoản đã chọn
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Đóng hộp thoại gán phạm vi"
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
          {/* Privilege ceiling notice */}
          <div className="p-3 bg-blue-50 border border-blue-200/80 rounded-xl flex items-start gap-2.5 text-xs text-blue-800">
            <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
            <span>
              <strong>Bảo vệ trần quyền hạn:</strong> Bạn chỉ có thể gán các chi nhánh và kho mà bạn
              đang có thẩm quyền quản lý.
            </span>
          </div>

          {/* STORE SCOPES SECTION */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-slate-500" />
                <span>Phạm vi Chi Nhánh (Store Scopes):</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allStores}
                  onChange={(e) => setAllStores(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                  data-testid="bulk-scope-all-stores"
                />
                <span className="font-semibold text-[11px]">Tất cả chi nhánh (*)</span>
              </label>
            </div>

            {!allStores && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                {availableStores.map((store) => (
                  <label
                    key={store.id}
                    className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer transition text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStores.includes(store.id)}
                      onChange={() => handleToggleStore(store.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                      data-testid={`bulk-scope-store-${store.id}`}
                    />
                    <span className="truncate">
                      <strong>{store.code}</strong> - {store.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* WAREHOUSE SCOPES SECTION */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Warehouse className="w-3.5 h-3.5 text-slate-500" />
                <span>Phạm vi Kho Hàng (Warehouse Scopes):</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allWarehouses}
                  onChange={(e) => setAllWarehouses(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                  data-testid="bulk-scope-all-warehouses"
                />
                <span className="font-semibold text-[11px]">Tất cả kho hàng (*)</span>
              </label>
            </div>

            {!allWarehouses && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                {availableWarehouses.map((wh) => (
                  <label
                    key={wh.id}
                    className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer transition text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedWarehouses.includes(wh.id)}
                      onChange={() => handleToggleWarehouse(wh.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                      data-testid={`bulk-scope-warehouse-${wh.id}`}
                    />
                    <span className="truncate">
                      <strong>{wh.code}</strong> - {wh.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary text-xs px-4 py-2"
            data-testid="bulk-assign-scopes-cancel"
          >
            Hủy Bỏ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5 cursor-pointer"
            data-testid="bulk-assign-scopes-submit"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Áp Dụng Phạm Vi</span>
          </button>
        </div>
      </div>
    </div>
  );
};
