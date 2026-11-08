'use client';

import React from 'react';
import { useDialogFocus } from './useDialogFocus';
import { X, Truck, Zap, ShieldCheck, AlertTriangle, Info } from 'lucide-react';
import { CarrierServiceResponse, CarrierEvidenceLevel } from './types';
import { SERVICE_TYPE_LABELS, EVIDENCE_LEVEL_LABELS } from './types';

export interface CarrierServiceListProps {
  carrierCode: string;
  carrierName: string;
  services: CarrierServiceResponse[];
  isOpen: boolean;
  onClose: () => void;
  evidenceLevel: CarrierEvidenceLevel;
  className?: string;
  requestFeedback?: React.ReactNode;
}

export const CarrierServiceList: React.FC<CarrierServiceListProps> = ({
  carrierCode,
  carrierName,
  services,
  isOpen,
  onClose,
  evidenceLevel,
  className = '',
  requestFeedback,
}) => {
  const dialogRef = useDialogFocus(isOpen, onClose);
  if (!isOpen) return null;

  const isConfirmationRequired = evidenceLevel === 'CONFIRMATION_REQUIRED';

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-list-title"
      className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 ${className}`}
      data-testid="carrier-service-list-modal"
    >
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h3 id="service-list-title" className="text-sm font-bold text-slate-900">
                Dịch vụ của {carrierName} ({carrierCode})
              </h3>
              <p className="text-[11px] text-slate-500">Thông tin dịch vụ tham khảo</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
            aria-label="Đóng danh sách dịch vụ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {requestFeedback}
        {!requestFeedback && (
          <>
            {isConfirmationRequired && (
              <div className="mx-5 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <span className="font-bold">Cần xác nhận đối tác: </span>
                  <span>
                    Hãng vận chuyển này đang ở mức bằng chứng <strong>CONFIRMATION_REQUIRED</strong>
                    . Việc kết nối tài khoản và sử dụng dịch vụ thực tế cần xác nhận từ đối tác
                    (OI-001/OI-002). Danh mục này chỉ mang tính tham khảo.
                  </span>
                </div>
              </div>
            )}

            <div className="p-5 space-y-3 max-h-[50vh] overflow-y-auto">
              {services.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Info className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm">Hãng vận chuyển này chưa có dịch vụ nào trong danh mục.</p>
                </div>
              ) : (
                services.map((service) => (
                  <article
                    key={service.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 transition hover:border-slate-300"
                    data-testid={`service-item-${service.code}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="font-bold text-sm text-slate-900 truncate">
                            {service.name}
                          </h4>
                          <span className="font-mono text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            {service.code}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2">{service.description}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded ${
                            service.service_type === 'FAST'
                              ? 'bg-orange-50 text-orange-700 border border-orange-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {service.service_type === 'FAST' ? (
                            <Zap className="w-3 h-3" />
                          ) : (
                            <Truck className="w-3 h-3" />
                          )}
                          <span>{SERVICE_TYPE_LABELS[service.service_type]}</span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded ${
                            service.evidence_level === 'CONFIRMATION_REQUIRED'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {service.evidence_level === 'CONFIRMATION_REQUIRED' ? (
                            <AlertTriangle className="w-3 h-3" />
                          ) : (
                            <ShieldCheck className="w-3 h-3" />
                          )}
                          <span>{EVIDENCE_LEVEL_LABELS[service.evidence_level]}</span>
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                      <div>
                        <span className="font-medium text-slate-700">Trạng thái: </span>
                        <span className={service.is_active ? 'text-emerald-600' : 'text-slate-500'}>
                          {service.is_active ? 'Đang hoạt động' : 'Tạm ngưng'}
                        </span>
                      </div>
                      <div>
                        <span className="font-medium text-slate-700">Nguồn: </span>
                        <span className="font-mono">{service.source_revision}</span>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
