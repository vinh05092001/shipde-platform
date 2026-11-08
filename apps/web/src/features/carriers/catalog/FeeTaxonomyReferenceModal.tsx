'use client';

import React, { useMemo } from 'react';
import { X, Info, AlertTriangle, Calculator, ShieldCheck, MinusCircle } from 'lucide-react';
import { FeeComponentResponse, FeeComponentCategory } from './types';
import { FEE_CATEGORY_LABELS } from './types';

export interface FeeTaxonomyReferenceModalProps {
  feeComponents: FeeComponentResponse[];
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

const CATEGORY_ORDER: FeeComponentCategory[] = [
  'BASE',
  'SURCHARGE',
  'COD',
  'INSURANCE',
  'RETURN',
  'VAT',
];

const CATEGORY_ICONS: Record<FeeComponentCategory, React.ReactNode> = {
  BASE: <Calculator className="w-4 h-4" />,
  SURCHARGE: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
      />
    </svg>
  ),
  COD: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  INSURANCE: <ShieldCheck className="w-4 h-4" />,
  RETURN: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M7 14l5-5 5 5M3 10l5 5M3 10l5-5"
      />
    </svg>
  ),
  VAT: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  ),
};

const CATEGORY_COLORS: Record<FeeComponentCategory, string> = {
  BASE: 'bg-blue-100 text-blue-700 border-blue-200',
  SURCHARGE: 'bg-orange-100 text-orange-700 border-orange-200',
  COD: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  INSURANCE: 'bg-purple-100 text-purple-700 border-purple-200',
  RETURN: 'bg-sky-100 text-sky-700 border-sky-200',
  VAT: 'bg-amber-100 text-amber-700 border-amber-200',
};

export const FeeTaxonomyReferenceModal: React.FC<FeeTaxonomyReferenceModalProps> = ({
  feeComponents,
  isOpen,
  onClose,
  className = '',
}) => {
  const groupedFees = useMemo(() => {
    const groups: Record<FeeComponentCategory, FeeComponentResponse[]> = {
      BASE: [],
      SURCHARGE: [],
      COD: [],
      INSURANCE: [],
      RETURN: [],
      VAT: [],
    };
    feeComponents.forEach((fee) => {
      if (groups[fee.category]) {
        groups[fee.category].push(fee);
      }
    });
    return groups;
  }, [feeComponents]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fee-taxonomy-title"
      className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 ${className}`}
      data-testid="fee-taxonomy-reference-modal"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h3 id="fee-taxonomy-title" className="text-sm font-bold text-slate-900">
                Hệ thống Phí Canonical (Fee Taxonomy)
              </h3>
              <p className="text-[11px] text-slate-500">
                8 thành phần phí chuẩn — không chứa số tiền, tỷ lệ hoặc tiền tệ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
            aria-label="Đóng tham chiếu phí"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold mb-2">Quy tắc ngữ nghĩa phí (BR-CAR-08)</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>
                    <strong>is_refundable=true:</strong> Thành phần có thể được hoàn lại trong đối
                    soát sau này. Không có nghĩa là luôn được hoàn.
                  </li>
                  <li>
                    <strong>vat_applicable=true:</strong> Thành phần là cơ sở tính VAT (VAT base).
                    VAT line (mã VAT) có <strong>vat_applicable=false</strong>.
                  </li>
                  <li>
                    <strong>Không lưu số tiền:</strong> Danh mục chỉ định nghĩa mã, tên, loại, khả
                    năng hoàn và tính VAT. Mức phí thực do báo giá/đối soát cung cấp.
                  </li>
                  <li>
                    <strong>Raw fee không khớp:</strong> Giữ nguyên UNMAPPED, không bao giờ ép thành
                    BASE_FREIGHT hoặc 0.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {CATEGORY_ORDER.map((category) => {
            const categoryFees = groupedFees[category];
            if (categoryFees.length === 0) return null;

            return (
              <section
                key={category}
                className="mb-6"
                data-testid={`fee-category-${category.toLowerCase()}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border ${CATEGORY_COLORS[category]}`}
                  >
                    {CATEGORY_ICONS[category]}
                    <span>{FEE_CATEGORY_LABELS[category]}</span>
                    <span className="px-1.5 py-0.5 bg-white/50 rounded text-[10px] font-mono">
                      {categoryFees.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {categoryFees.map((fee) => (
                    <article
                      key={fee.code}
                      className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 transition hover:border-slate-300"
                      data-testid={`fee-item-${fee.code}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                              {fee.code}
                            </span>
                            <h4 className="font-bold text-sm text-slate-900">{fee.name}</h4>
                          </div>
                          <p className="text-xs text-slate-500">{fee.description}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded ${
                            fee.is_refundable
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {fee.is_refundable ? (
                            <ShieldCheck className="w-3 h-3" />
                          ) : (
                            <MinusCircle className="w-3 h-3" />
                          )}
                          <span>{fee.is_refundable ? 'Có thể hoàn' : 'Không hoàn'}</span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded ${
                            fee.vat_applicable
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          <Calculator className="w-3 h-3" />
                          <span>{fee.vat_applicable ? 'Cơ sở VAT' : 'Không tính VAT'}</span>
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}

          <div className="pt-4 border-t border-slate-200">
            <h4 className="font-bold text-sm text-slate-700 mb-3">
              Danh sách 8 mã phí chuẩn (CATALOG-2026-10-31)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {CATEGORY_ORDER.map((category) => (
                <div key={category} className="p-2 bg-slate-50 rounded-lg">
                  <div className="font-mono font-semibold text-slate-700">{category}</div>
                  <div className="text-slate-500">{FEE_CATEGORY_LABELS[category]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
