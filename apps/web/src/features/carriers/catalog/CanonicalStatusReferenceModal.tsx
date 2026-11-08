'use client';

import React, { useMemo } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { X, ChevronRight, Info, AlertTriangle } from 'lucide-react';
import { CanonicalStatusResponse, StatusCategory } from './types';
import { STATUS_CATEGORY_LABELS } from './types';

export interface CanonicalStatusReferenceModalProps {
  statuses: CanonicalStatusResponse[];
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  requestFeedback?: React.ReactNode;
}

const CATEGORY_ORDER: StatusCategory[] = [
  'COMMAND',
  'OPERATIONAL_PRE_TRANSIT',
  'OPERATIONAL_IN_TRANSIT',
  'OPERATIONAL_TERMINAL',
];

const CATEGORY_ICONS: Record<StatusCategory, React.ReactNode> = {
  COMMAND: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  ),
  OPERATIONAL_PRE_TRANSIT: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  ),
  OPERATIONAL_IN_TRANSIT: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
      />
    </svg>
  ),
  OPERATIONAL_TERMINAL: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  ),
};

const CATEGORY_COLORS: Record<StatusCategory, string> = {
  COMMAND: 'bg-purple-100 text-purple-700 border-purple-200',
  OPERATIONAL_PRE_TRANSIT: 'bg-blue-100 text-blue-700 border-blue-200',
  OPERATIONAL_IN_TRANSIT: 'bg-sky-100 text-sky-700 border-sky-200',
  OPERATIONAL_TERMINAL: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export const CanonicalStatusReferenceModal: React.FC<CanonicalStatusReferenceModalProps> = ({
  statuses,
  isOpen,
  onClose,
  className = '',
  requestFeedback,
}) => {
  const groupedStatuses = useMemo(() => {
    const groups: Record<StatusCategory, CanonicalStatusResponse[]> = {
      COMMAND: [],
      OPERATIONAL_PRE_TRANSIT: [],
      OPERATIONAL_IN_TRANSIT: [],
      OPERATIONAL_TERMINAL: [],
    };
    statuses.forEach((status) => {
      if (groups[status.category]) {
        groups[status.category].push(status);
      }
    });
    return groups;
  }, [statuses]);

  const dialogRef = useDialogFocus(isOpen, onClose);
  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-reference-title"
      className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 ${className}`}
      data-testid="canonical-status-reference-modal"
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[80vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h3 id="status-reference-title" className="text-sm font-bold text-slate-900">
                Tham chiếu Trạng thái Canonical
              </h3>
              <p className="text-[11px] text-slate-500">
                Tách biệt trạng thái lệnh (Pre-transit) và trạng thái vận hành (Shipment lifecycle)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
            aria-label="Đóng tham chiếu trạng thái"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {requestFeedback}
        {!requestFeedback && (
          <>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="mb-5 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold mb-1">Quy tắc tách biệt quan trọng (BR-CAR-04)</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>
                        <strong>Trạng thái lệnh (COMMAND):</strong> CREATING, CREATED,
                        CREATE_FAILED, CREATE_OUTCOME_UNKNOWN — chỉ tồn tại trước khi vận đơn được
                        tạo thành công.
                      </li>
                      <li>
                        <strong>Trạng thái vận hành:</strong> DRAFT → READY_TO_PICK → PICKING →
                        PICKED → IN_TRANSIT → OUT_FOR_DELIVERY →
                        DELIVERED/DELIVERY_FAILED/RETURNING/RETURNED/CANCELLED/LOST/DAMAGED — vòng
                        đời thực của kiện hàng.
                      </li>
                      <li>
                        Không bao giờ gộp hoặc ánh xạ trạng thái lệnh sang trạng thái vận hành.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {CATEGORY_ORDER.map((category) => {
                const categoryStatuses = groupedStatuses[category];
                if (categoryStatuses.length === 0) return null;

                return (
                  <section
                    key={category}
                    className="mb-6"
                    data-testid={`status-category-${category.toLowerCase()}`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border ${CATEGORY_COLORS[category]}`}
                      >
                        {CATEGORY_ICONS[category]}
                        <span>{STATUS_CATEGORY_LABELS[category]}</span>
                        <span className="px-1.5 py-0.5 bg-white/50 rounded text-[10px] font-mono">
                          {categoryStatuses.length}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {categoryStatuses.map((status) => (
                        <article
                          key={status.code}
                          className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 transition hover:border-slate-300"
                          data-testid={`status-item-${status.code}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                                  {status.code}
                                </span>
                                <h4 className="font-bold text-sm text-slate-900">{status.label}</h4>
                                <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-white border border-slate-200 rounded">
                                  Stage: {status.stage_order}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500">{status.description}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}

              <div className="pt-4 border-t border-slate-200">
                <h4 className="font-bold text-sm text-slate-700 mb-3">
                  Nguyên tắc ánh xạ (BR-CAR-05, BR-CAR-06)
                </h4>
                <ul className="space-y-2 text-xs text-slate-600">
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Không bao giờ mặc định:</strong> Trạng thái raw không xác định →
                      UNMAPPED (null), không bao giờ rơi vào IN_TRANSIT.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Giữ nguyên raw status:</strong> Downstream tracking và settlement phải
                      giữ nguyên chuỗi raw của hãng.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Độ tin cậy bằng chứng:</strong> GHN/GHTK = VERIFIED_OFFICIAL;
                      VIETTEL_POST/JT = CONFIRMATION_REQUIRED (cần xác nhận đối tác).
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
