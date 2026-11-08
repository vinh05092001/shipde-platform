'use client';

import React from 'react';
import { Truck, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react';
import { CarrierResponse, CarrierEvidenceLevel } from './types';
import { EVIDENCE_LEVEL_LABELS, CARRIER_MONOGRAM_COLORS } from './types';

export interface CarrierCardProps {
  carrier: CarrierResponse;
  onClick?: () => void;
  onViewServices?: () => void;
  showServicesButton?: boolean;
  className?: string;
}

function getInitials(code: string): string {
  if (code === 'VIETTEL_POST') return 'VP';
  if (code === 'GHN') return 'GHN';
  if (code === 'GHTK') return 'GHTK';
  if (code === 'JT') return 'J&T';
  return code.slice(0, 2).toUpperCase();
}

export const CarrierCard: React.FC<CarrierCardProps> = ({
  carrier,
  onClick,
  onViewServices,
  showServicesButton = true,
  className = '',
}) => {
  const isConfirmationRequired = carrier.evidence_level === 'CONFIRMATION_REQUIRED';
  const monogramColor =
    CARRIER_MONOGRAM_COLORS[carrier.code as keyof typeof CARRIER_MONOGRAM_COLORS] || 'bg-slate-600';
  const evidenceLabel = EVIDENCE_LEVEL_LABELS[carrier.evidence_level] || carrier.evidence_level;

  return (
    <article
      data-testid={`carrier-card-${carrier.code}`}
      className={`group relative bg-white border rounded-2xl p-5 shadow-xs transition-all duration-200 hover:shadow-sm hover:border-slate-300 ${className}`}
    >
      {isConfirmationRequired && (
        <div
          className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-amber-50 border border-amber-200 text-amber-800 rounded-full"
          data-testid="confirmation-required-badge"
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          <span>Cần xác nhận</span>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div
          className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${monogramColor} text-white font-bold text-lg select-none`}
          data-testid={`carrier-monogram-${carrier.code}`}
          aria-label={carrier.code}
        >
          {getInitials(carrier.code)}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-slate-900 truncate">{carrier.name}</h3>
              <span className="font-mono text-[11px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                {carrier.code}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md ${
                carrier.is_active
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-100 text-slate-500 border border-slate-200'
              }`}
              data-testid={`carrier-status-${carrier.code}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${carrier.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`}
              />
              <span>{carrier.is_active ? 'Đang hoạt động' : 'Tạm ngưng'}</span>
            </span>

            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md ${
                isConfirmationRequired
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}
              data-testid={`carrier-evidence-${carrier.code}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isConfirmationRequired ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
              <span>{evidenceLabel}</span>
            </span>
          </div>

          {carrier.description && (
            <p
              className="text-xs text-slate-500 line-clamp-2"
              data-testid={`carrier-description-${carrier.code}`}
            >
              {carrier.description}
            </p>
          )}

          {showServicesButton && onViewServices && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewServices();
              }}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
              data-testid={`view-services-${carrier.code}`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Xem dịch vụ ({carrier.code})</span>
            </button>
          )}
        </div>
      </div>

      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
          aria-label={`Chi tiết ${carrier.name}`}
          title="Chi tiết"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
};

export const CarrierCardSkeleton: React.FC = () => (
  <article
    className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse"
    aria-busy="true"
  >
    <div className="flex items-start gap-4">
      <div className="w-14 h-14 rounded-xl bg-slate-200 shrink-0" />
      <div className="flex-1 space-y-3">
        <div className="h-4 bg-slate-200 rounded w-3/4" />
        <div className="h-3 bg-slate-100 rounded w-1/2" />
        <div className="flex gap-2">
          <div className="h-5 bg-slate-200 rounded-full w-24" />
          <div className="h-5 bg-slate-200 rounded-full w-28" />
        </div>
        <div className="h-3 bg-slate-100 rounded w-full" />
        <div className="h-3 bg-slate-100 rounded w-2/3" />
      </div>
    </div>
  </article>
);
