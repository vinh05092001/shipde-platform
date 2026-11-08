'use client';

import React from 'react';
import { CarrierResponse } from './types';
import { CarrierCard, CarrierCardSkeleton } from './CarrierCard';

export interface CarrierGridProps {
  carriers: CarrierResponse[];
  loading?: boolean;
  onViewServices?: (carrier: CarrierResponse) => void;
  onCardClick?: (carrier: CarrierResponse) => void;
  emptyMessage?: string;
  clearFiltersAction?: () => void;
  clearFiltersLabel?: string;
}

export const CarrierGrid: React.FC<CarrierGridProps> = ({
  carriers,
  loading = false,
  onViewServices,
  onCardClick,
  emptyMessage = 'Không tìm thấy hãng vận chuyển phù hợp với bộ lọc',
  clearFiltersAction,
  clearFiltersLabel = 'Xóa bộ lọc',
}) => {
  if (loading) {
    return (
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        role="status"
        aria-busy="true"
        aria-label="Đang tải danh mục hãng vận chuyển"
        data-testid="carrier-grid-loading"
      >
        {[1, 2, 3, 4].map((i) => (
          <CarrierCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (carriers.length === 0) {
    return (
      <div
        className="p-8 bg-white border border-dashed border-slate-300 rounded-2xl text-center space-y-4"
        data-testid="carrier-grid-empty"
      >
        <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-800">Không tìm thấy hãng vận chuyển</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">{emptyMessage}</p>
        </div>
        {clearFiltersAction && (
          <button
            type="button"
            onClick={clearFiltersAction}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition"
            data-testid="clear-filters-button"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span>{clearFiltersLabel}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      data-testid="carrier-grid"
    >
      {carriers.map((carrier) => (
        <CarrierCard
          key={carrier.id}
          carrier={carrier}
          onClick={() => onCardClick?.(carrier)}
          onViewServices={() => onViewServices?.(carrier)}
          showServicesButton={true}
        />
      ))}
    </div>
  );
};
