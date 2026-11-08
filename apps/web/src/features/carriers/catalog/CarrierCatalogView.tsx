'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  Info,
  X,
  Calculator,
} from 'lucide-react';
import {
  CarrierResponse,
  CarrierDetailResponseEnvelope,
  CanonicalStatusListResponse,
  FeeComponentListResponse,
  CarrierEvidenceLevel,
} from './types';
import { fetchCarriers, fetchCarrierDetail, fetchStatuses, fetchFeeComponents } from './api';
import { CarrierGrid } from './CarrierGrid';
import { CarrierServiceList } from './CarrierServiceList';
import { CanonicalStatusReferenceModal } from './CanonicalStatusReferenceModal';
import { FeeTaxonomyReferenceModal } from './FeeTaxonomyReferenceModal';

export interface CarrierCatalogViewProps {
  initialCarriers?: CarrierResponse[] | null;
  initialLoading?: boolean;
  initialError?: string | null;
  initialForbidden?: boolean;
  initialCorrelationId?: string | null;
}

export type CarrierCatalogUIState =
  'loading' | 'empty' | 'validation' | 'error' | 'forbidden' | 'partial' | 'success' | 'recovery';

export const EVIDENCE_LEVEL_OPTIONS = [
  { value: 'ALL', label: 'Tất cả mức độ' },
  { value: 'VERIFIED_OFFICIAL', label: 'Đã xác thực chính thức' },
  { value: 'CONFIRMATION_REQUIRED', label: 'Cần xác nhận đối tác' },
] as const;

export const ACTIVE_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'true', label: 'Đang hoạt động' },
  { value: 'false', label: 'Tạm ngưng' },
] as const;

export function resolveUIState(params: {
  isForbidden: boolean;
  error: string | null;
  loading: boolean;
  itemCount: number;
  hasFilters: boolean;
}): CarrierCatalogUIState {
  if (params.isForbidden) return 'forbidden';
  if (params.error) return 'error';
  if (params.loading) return 'loading';
  if (params.itemCount === 0 && params.hasFilters) return 'empty';
  if (params.itemCount === 0) return 'empty';
  return 'success';
}

export function shouldDisplayEmptyState(params: {
  error: string | null;
  loading: boolean;
  itemCount: number;
  hasFilters: boolean;
}): boolean {
  return !params.error && !params.loading && params.itemCount === 0;
}

function getInitials(code: string): string {
  if (code === 'VIETTEL_POST') return 'VP';
  if (code === 'GHN') return 'GHN';
  if (code === 'GHTK') return 'GHTK';
  if (code === 'JT') return 'J&T';
  return code.slice(0, 2).toUpperCase();
}

export const CarrierCatalogView: React.FC<CarrierCatalogViewProps> = ({
  initialCarriers = null,
  initialLoading = false,
  initialError = null,
  initialForbidden = false,
  initialCorrelationId = null,
}) => {
  const [carriers, setCarriers] = useState<CarrierResponse[]>(initialCarriers || []);
  const [loading, setLoading] = useState<boolean>(
    initialCarriers ? false : (initialLoading ?? true)
  );
  const [error, setError] = useState<string | null>(initialError);
  const [correlationId, setCorrelationId] = useState<string | null>(initialCorrelationId);
  const [isForbidden, setIsForbidden] = useState<boolean>(initialForbidden);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [evidenceFilter, setEvidenceFilter] = useState<'ALL' | CarrierEvidenceLevel>('ALL');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'true' | 'false'>('ALL');

  const [selectedCarrierDetail, setSelectedCarrierDetail] =
    useState<CarrierDetailResponseEnvelope | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [statuses, setStatuses] = useState<CanonicalStatusListResponse['data']>([]);
  const [feeComponents, setFeeComponents] = useState<FeeComponentListResponse['data']>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showFeeModal, setShowFeeModal] = useState(false);

  const hasFilters =
    searchQuery.trim().length > 0 || evidenceFilter !== 'ALL' || activeFilter !== 'ALL';

  const filteredCarriers = useMemo(() => {
    return carriers.filter((carrier) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = carrier.name.toLowerCase().includes(q);
        const matchCode = carrier.code.toLowerCase().includes(q);
        const matchDescription = carrier.description?.toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchDescription) return false;
      }
      if (evidenceFilter !== 'ALL' && carrier.evidence_level !== evidenceFilter) {
        return false;
      }
      if (activeFilter !== 'ALL' && carrier.is_active !== (activeFilter === 'true')) {
        return false;
      }
      return true;
    });
  }, [carriers, searchQuery, evidenceFilter, activeFilter]);

  const uiState = resolveUIState({
    isForbidden,
    error,
    loading,
    itemCount: filteredCarriers.length,
    hasFilters,
  });

  const fetchCarriersList = useCallback(async () => {
    if (isForbidden) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setCorrelationId(null);
    try {
      const response = await fetchCarriers();
      setCarriers(response.data);
      setCorrelationId(response.catalog_revision);
    } catch (err: any) {
      if (err.status === 403) {
        setIsForbidden(true);
        setError(
          'Bạn không có quyền truy cập danh mục hãng vận chuyển (yêu cầu quyền iam:carrier_catalog:read).'
        );
      } else if (err.status === 401) {
        setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      } else {
        setError(err.message || 'Không thể tải danh mục hãng vận chuyển');
        setCorrelationId(err.correlationId);
      }
    } finally {
      setLoading(false);
    }
  }, [isForbidden]);

  const fetchTaxonomyData = useCallback(async () => {
    setTaxonomyLoading(true);
    try {
      const [statusesRes, feesRes] = await Promise.all([fetchStatuses(), fetchFeeComponents()]);
      setStatuses(statusesRes.data);
      setFeeComponents(feesRes.data);
    } catch (err: any) {
      console.warn('Failed to load taxonomy data:', err);
    } finally {
      setTaxonomyLoading(false);
    }
  }, []);

  const handleViewServices = async (carrier: CarrierResponse) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const detail = await fetchCarrierDetail(carrier.code);
      setSelectedCarrierDetail(detail);
    } catch (err: any) {
      setDetailError(err.message || 'Không thể tải chi tiết dịch vụ');
    } finally {
      setDetailLoading(false);
    }
  };

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setEvidenceFilter('ALL');
    setActiveFilter('ALL');
  }, []);

  const handleRetry = useCallback(() => {
    fetchCarriersList();
    fetchTaxonomyData();
  }, [fetchCarriersList, fetchTaxonomyData]);

  useEffect(() => {
    if (!initialCarriers) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial carriers fetch
      fetchCarriersList();
    }
  }, [initialCarriers, fetchCarriersList]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial taxonomy fetch
    fetchTaxonomyData();
  }, [fetchTaxonomyData]);

  if (isForbidden) {
    return (
      <div className="space-y-5" data-testid="carrier-catalog-view">
        <div
          className="p-6 text-center bg-amber-50/60 border border-amber-200 rounded-2xl space-y-2 animate-in fade-in"
          data-testid="catalog-forbidden-banner"
        >
          <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto" />
          <h4 className="font-bold text-sm text-slate-800">403 — Không Có Quyền Truy Cập</h4>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            Tài khoản của bạn không có quyền <code>iam:carrier_catalog:read</code> để xem danh mục
            hãng vận chuyển. Vui lòng liên hệ Chủ cửa hàng (OWNER) hoặc Quản trị viên để được cấp
            quyền.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="carrier-catalog-view">
      {/* Toast/Notifications */}
      {error && !loading && !isForbidden && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 animate-in fade-in"
          data-testid="catalog-error-banner"
        >
          <div className="flex items-center gap-2.5 flex-1">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <div className="text-xs">
              <span className="font-bold">Lỗi tải danh mục: </span>
              <span>{error}</span>
              {correlationId && (
                <span className="ml-2 font-mono text-[10px] bg-rose-100 px-1.5 py-0.5 rounded">
                  Correlation ID: {correlationId}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRetry}
              disabled={loading}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-rose-300 rounded-lg text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
              data-testid="catalog-retry-button"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Thử lại</span>
            </button>
            <button
              type="button"
              onClick={() => setError(null)}
              className="p-1 hover:bg-rose-100 rounded-lg text-rose-600 transition"
              aria-label="Đóng thông báo lỗi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800">Danh mục Hãng Vận Chuyển</h1>
            <p className="text-xs text-slate-500">
              Tham khảo 4 hãng vận chuyển chuẩn, dịch vụ, trạng thái canonical và hệ thống phí Ship
              Dễ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition disabled:opacity-50"
            aria-label="Làm mới danh mục"
            title="Làm mới danh mục"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowStatusModal(true)}
              disabled={taxonomyLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition disabled:opacity-50"
            >
              <Info className="w-3.5 h-3.5" />
              <span>Trạng thái Canonical</span>
            </button>
            <button
              type="button"
              onClick={() => setShowFeeModal(true)}
              disabled={taxonomyLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition disabled:opacity-50"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>Hệ thống Phí</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            id="input-search-carrier"
            aria-label="Tìm kiếm hãng vận chuyển"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên, mã hãng, mô tả..."
            data-testid="input-search-carrier"
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            id="filter-evidence"
            aria-label="Lọc theo mức độ bằng chứng"
            value={evidenceFilter}
            onChange={(e) => setEvidenceFilter(e.target.value as any)}
            data-testid="filter-evidence"
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium focus:bg-white focus:outline-hidden focus:border-blue-500 transition"
          >
            {EVIDENCE_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            id="filter-active"
            aria-label="Lọc theo trạng thái hoạt động"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as any)}
            data-testid="filter-active"
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium focus:bg-white focus:outline-hidden focus:border-blue-500 transition"
          >
            {ACTIVE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition"
              data-testid="clear-filters-button"
            >
              <X className="w-3.5 h-3.5" />
              <span>Xóa bộ lọc</span>
            </button>
          )}
        </div>
      </div>

      {/* Carrier Grid */}
      {!error && (
        <div className="space-y-4" role="region" aria-label="Danh sách hãng vận chuyển">
          <CarrierGrid
            carriers={filteredCarriers}
            loading={loading && !initialCarriers}
            onViewServices={handleViewServices}
            onCardClick={() => {}}
            emptyMessage={
              hasFilters
                ? 'Không tìm thấy hãng vận chuyển phù hợp với bộ lọc'
                : 'Chưa có hãng vận chuyển nào trong danh mục'
            }
            clearFiltersAction={clearFilters}
            clearFiltersLabel="Xóa bộ lọc"
          />

          {uiState === 'success' && filteredCarriers.length > 0 && (
            <div className="text-xs text-slate-500 text-center">
              Hiển thị <strong>{filteredCarriers.length}</strong> /{' '}
              <strong>{carriers.length}</strong> hãng vận chuyển
              {hasFilters && <span className="ml-2">(đã lọc)</span>}
            </div>
          )}
        </div>
      )}

      {/* Service Detail Modal */}
      {selectedCarrierDetail && (
        <CarrierServiceList
          carrierCode={selectedCarrierDetail.data.code}
          carrierName={selectedCarrierDetail.data.name}
          services={selectedCarrierDetail.data.services}
          isOpen={true}
          onClose={() => setSelectedCarrierDetail(null)}
          evidenceLevel={selectedCarrierDetail.data.evidence_level}
        />
      )}

      {/* Canonical Status Reference Modal */}
      <CanonicalStatusReferenceModal
        statuses={statuses}
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
      />

      {/* Fee Taxonomy Reference Modal */}
      <FeeTaxonomyReferenceModal
        feeComponents={feeComponents}
        isOpen={showFeeModal}
        onClose={() => setShowFeeModal(false)}
      />
    </div>
  );
};
