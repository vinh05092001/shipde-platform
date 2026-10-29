'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Package,
  Truck,
  FileSpreadsheet,
  AlertTriangle,
  DollarSign,
  X,
  RefreshCw,
  ShieldAlert,
  ExternalLink,
  ChevronRight,
  CornerDownLeft,
} from 'lucide-react';
import { SearchEntityType, SearchResultItem, SearchResponse } from '@shipde/contracts';
import { StatusBadge } from './ui/OperationalComponents';

export interface GlobalSearchProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSelectResult?: (item: SearchResultItem) => void;
  initialQuery?: string;
  initialType?: SearchEntityType;
  initialLoading?: boolean;
  initialItems?: SearchResultItem[];
  initialTotal?: number;
  initialError?: string | null;
  initialForbidden?: boolean;
  initialForbiddenMessage?: string | null;
  initialValidationMessage?: string | null;
  initialHasSearched?: boolean;
  initialIsPartial?: boolean;
  initialCanAccessRecon?: boolean;
  apiBase?: string;
  standalone?: boolean;
}

const FILTER_TABS: Array<{
  id: SearchEntityType;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'ALL', label: 'Tất cả', icon: Search },
  { id: 'ORDER', label: 'Đơn hàng', icon: Package },
  { id: 'WAYBILL', label: 'Vận đơn', icon: Truck },
  { id: 'BATCH', label: 'Bảng kê', icon: FileSpreadsheet },
  { id: 'CASE', label: 'Khiếu nại / Ngoại lệ', icon: AlertTriangle },
  { id: 'TRANSACTION', label: 'Lệch cước', icon: DollarSign },
];

function getItemIcon(type: string) {
  switch (type) {
    case 'ORDER':
      return { icon: Package, color: 'text-blue-600 bg-blue-50 border-blue-200' };
    case 'WAYBILL':
      return { icon: Truck, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' };
    case 'BATCH':
      return { icon: FileSpreadsheet, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' };
    case 'CASE':
      return { icon: AlertTriangle, color: 'text-amber-600 bg-amber-50 border-amber-200' };
    case 'TRANSACTION':
      return { icon: DollarSign, color: 'text-teal-600 bg-teal-50 border-teal-200' };
    default:
      return { icon: Package, color: 'text-slate-600 bg-slate-50 border-slate-200' };
  }
}

export const GlobalSearchContent: React.FC<GlobalSearchProps> = ({
  onClose,
  onSelectResult,
  initialQuery = '',
  initialType = 'ALL',
  initialLoading = false,
  initialItems,
  initialTotal,
  initialError = null,
  initialForbidden = false,
  initialForbiddenMessage = null,
  initialValidationMessage = null,
  initialHasSearched,
  initialIsPartial = false,
  initialCanAccessRecon = true,
  apiBase,
  standalone = false,
}) => {
  const [query, setQuery] = useState<string>(initialQuery);
  const [activeType, setActiveType] = useState<SearchEntityType>(initialType);
  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [items, setItems] = useState<SearchResultItem[]>(initialItems ?? []);
  const [total, setTotal] = useState<number>(
    initialTotal ?? (initialItems ? initialItems.length : 0)
  );
  const [hasSearched, setHasSearched] = useState<boolean>(
    initialHasSearched ?? (initialItems !== undefined || initialError !== null || initialForbidden)
  );
  const [validationError, setValidationError] = useState<string | null>(initialValidationMessage);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError);
  const [isForbidden, setIsForbidden] = useState<boolean>(initialForbidden);
  const [forbiddenMsg, setForbiddenMsg] = useState<string | null>(initialForbiddenMessage);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isPartialNotice, setIsPartialNotice] = useState<boolean>(initialIsPartial);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resolvedApiBase =
    apiBase ||
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
    'http://localhost:3001';

  // Execute search API request
  const executeSearch = useCallback(
    async (searchTerm: string, filterType: SearchEntityType) => {
      const trimmed = searchTerm.trim();
      if (!trimmed) {
        setItems([]);
        setTotal(0);
        setValidationError(null);
        setErrorMsg(null);
        setIsForbidden(false);
        setHasSearched(false);
        setLoading(false);
        return;
      }

      if (trimmed.length < 2) {
        setValidationError('Vui lòng nhập ít nhất 2 ký tự để bắt đầu tìm kiếm');
        setItems([]);
        setTotal(0);
        setLoading(false);
        return;
      }

      setValidationError(null);
      setErrorMsg(null);
      setIsForbidden(false);
      setForbiddenMsg(null);
      setLoading(true);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;
        const url = new URL(`${resolvedApiBase}/api/v1/search`);
        url.searchParams.set('q', trimmed);
        if (filterType && filterType !== 'ALL') {
          url.searchParams.set('type', filterType);
        }

        const headers: Record<string, string> = {
          Accept: 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(url.toString(), {
          headers,
          signal: controller.signal,
        });

        if (res.status === 403) {
          const errData = await res.json().catch(() => null);
          setIsForbidden(true);
          setForbiddenMsg(
            errData?.error?.message ||
              'Bạn không có quyền truy cập dữ liệu đối soát bảng kê hoặc lệch cước tài chính (yêu cầu quyền reconciliation:view_contract_rates hoặc reconciliation:run_review_audit).'
          );
          setItems([]);
          setTotal(0);
          setHasSearched(true);
          return;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          setErrorMsg(
            errData?.error?.message ||
              'Không thể tải kết quả tìm kiếm từ máy chủ. Vui lòng thử lại.'
          );
          setItems([]);
          setTotal(0);
          setHasSearched(true);
          return;
        }

        const data: SearchResponse = await res.json();
        const returnedItems = data.data?.items || [];
        const returnedTotal = data.data?.total || returnedItems.length;

        setItems(returnedItems);
        setTotal(returnedTotal);
        setHasSearched(true);
        setSelectedIndex(0);

        // Check if partial results notice is appropriate
        const isLimited = returnedTotal > returnedItems.length;
        setIsPartialNotice(isLimited);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setErrorMsg(
          'Lỗi kết nối mạng khi tìm kiếm. Vui lòng kiểm tra lại đường truyền và thử lại.'
        );
        setItems([]);
        setTotal(0);
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [resolvedApiBase]
  );

  // Debounced input change
  useEffect(() => {
    // Skip automatic live query when initial values are provided in test mode without user interaction
    if (initialItems !== undefined || initialError !== null || initialForbidden) {
      return;
    }

    const timeout = setTimeout(() => {
      const trimmed = query.trim();
      if (!trimmed) {
        setItems([]);
        setTotal(0);
        setValidationError(null);
        setErrorMsg(null);
        setIsForbidden(false);
        setHasSearched(false);
        return;
      }

      if (trimmed.length < 2) {
        setValidationError('Vui lòng nhập ít nhất 2 ký tự để bắt đầu tìm kiếm');
        setItems([]);
        setTotal(0);
        return;
      }

      setValidationError(null);
      executeSearch(query, activeType);
    }, 250);

    return () => clearTimeout(timeout);
  }, [query, activeType, executeSearch, initialItems, initialError, initialForbidden]);

  // Handle item click / enter activation
  const handleSelectItem = (item: SearchResultItem) => {
    if (onSelectResult) {
      onSelectResult(item);
    } else if (item.url && typeof window !== 'undefined') {
      window.location.assign(item.url);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
        handleSelectItem(items[selectedIndex]);
      } else if (query.trim().length >= 2) {
        executeSearch(query, activeType);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeEl?.scrollIntoView) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Handle retry recovery action
  const handleRetry = () => {
    executeSearch(query, activeType);
  };

  // Handle forbidden recovery action (reset to ALL)
  const handleResetToAll = () => {
    setActiveType('ALL');
    setIsForbidden(false);
    setForbiddenMsg(null);
    executeSearch(query, 'ALL');
  };

  // Handle clear query
  const handleClearQuery = () => {
    setQuery('');
    setValidationError(null);
    setErrorMsg(null);
    setIsForbidden(false);
    setItems([]);
    setTotal(0);
    setHasSearched(false);
    inputRef.current?.focus();
  };

  return (
    <div
      data-testid="search-dialog"
      className={`flex flex-col bg-white overflow-hidden text-xs ${
        standalone
          ? 'rounded-2xl border border-slate-200 shadow-xl'
          : 'rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full'
      }`}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal={!standalone ? 'true' : undefined}
      aria-label="Tìm kiếm toàn hệ thống"
    >
      {/* Search Header & Input */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/70">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-[#c23807] absolute left-3.5 top-1/2 -translate-y-1/2 shrink-0 pointer-events-none" />
          <input
            ref={inputRef}
            data-testid="search-input"
            type="text"
            role="searchbox"
            aria-label="Từ khóa tìm kiếm toàn hệ thống"
            aria-invalid={validationError ? 'true' : 'false'}
            aria-autocomplete="list"
            aria-controls="search-results-list"
            aria-activedescendant={
              items.length > 0 && selectedIndex >= 0
                ? `search-item-${items[selectedIndex]?.id}`
                : undefined
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo mã đơn hàng, mã vận đơn, bảng kê, ngoại lệ, khách hàng..."
            className="w-full pl-10 pr-20 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#c23807]/20 focus:border-[#c23807] text-xs font-medium transition shadow-2xs"
            autoFocus
          />

          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {query && (
              <button
                type="button"
                data-testid="search-clear-button"
                onClick={handleClearQuery}
                aria-label="Xóa từ khóa tìm kiếm"
                className="w-5 h-5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            {!standalone && (
              <button
                type="button"
                data-testid="search-close-button"
                onClick={() => onClose?.()}
                aria-label="Đóng hộp thoại tìm kiếm"
                className="px-2 py-1 text-[11px] font-mono text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 transition cursor-pointer"
              >
                Esc
              </button>
            )}
          </div>
        </div>

        {/* Validation Error Feedback */}
        {validationError && (
          <div
            data-testid="search-validation-error"
            role="alert"
            className="mt-2.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] font-medium flex items-center justify-between animate-in fade-in duration-100"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>{validationError}</span>
            </div>
            <span className="text-[10px] text-amber-600 font-normal">Tối thiểu 2 ký tự</span>
          </div>
        )}

        {/* Entity Category Filter Tabs */}
        <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1 no-scrollbar">
          {FILTER_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`type-filter-${tab.id}`}
                aria-pressed={isActive}
                onClick={() => {
                  setActiveType(tab.id);
                  if (query.trim().length >= 2) {
                    executeSearch(query, tab.id);
                  }
                }}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#c23807] text-white shadow-2xs'
                    : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area: Driven by Current UI State */}
      <div className="p-4 max-h-[460px] overflow-y-auto" aria-busy={loading ? 'true' : 'false'}>
        {/* 1. LOADING STATE */}
        {loading && (
          <div
            data-testid="search-loading-state"
            className="space-y-3 py-4 animate-in fade-in duration-100"
          >
            <div className="flex items-center justify-center gap-2 text-slate-500 text-xs font-medium pb-2">
              <RefreshCw className="w-4 h-4 text-[#c23807] animate-spin" />
              <span>Đang tìm kiếm dữ liệu trên toàn hệ thống...</span>
            </div>
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                data-testid="search-loading-skeleton"
                className="p-3 border border-slate-100 rounded-xl bg-slate-50/50 flex items-center gap-3 animate-pulse"
              >
                <div className="w-9 h-9 rounded-lg bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-slate-200 rounded w-1/3" />
                  <div className="h-3 bg-slate-200 rounded w-2/3" />
                </div>
                <div className="h-5 w-16 bg-slate-200 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* 2. FORBIDDEN STATE (403) */}
        {!loading && isForbidden && (
          <div
            data-testid="search-forbidden-state"
            role="alert"
            className="p-5 bg-rose-50/60 border border-rose-200 rounded-2xl text-center space-y-3 animate-in fade-in duration-150"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-xs">Quyền Truy Cập Bị Từ Chối (403)</h3>
              <p className="text-[11px] text-slate-600 mt-1 max-w-md mx-auto">
                {forbiddenMsg ||
                  'Bạn không có quyền truy cập dữ liệu đối soát bảng kê hoặc lệch cước tài chính (yêu cầu quyền reconciliation:view_contract_rates hoặc reconciliation:run_review_audit).'}
              </p>
            </div>
            {/* Recovery Action: Reset Filter */}
            <div className="pt-1">
              <button
                type="button"
                data-testid="forbidden-reset-filter-button"
                onClick={handleResetToAll}
                className="px-3 py-1.5 bg-[#c23807] hover:bg-[#a02e06] text-white font-semibold rounded-lg text-xs transition cursor-pointer shadow-2xs"
              >
                Quay lại danh mục Tất Cả
              </button>
            </div>
          </div>
        )}

        {/* 3. SERVER / NETWORK ERROR STATE */}
        {!loading && !isForbidden && errorMsg && (
          <div
            data-testid="search-error-state"
            role="alert"
            className="p-5 bg-amber-50/60 border border-amber-200 rounded-2xl text-center space-y-3 animate-in fade-in duration-150"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-xs">Lỗi Truy Vấn Dữ Liệu</h3>
              <p className="text-[11px] text-slate-600 mt-1 max-w-md mx-auto">{errorMsg}</p>
            </div>
            {/* Recovery Action: Retry Button */}
            <div className="pt-1">
              <button
                type="button"
                data-testid="search-retry-button"
                onClick={handleRetry}
                className="px-3.5 py-1.5 bg-[#c23807] hover:bg-[#a02e06] text-white font-semibold rounded-lg text-xs transition cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Thử Lại</span>
              </button>
            </div>
          </div>
        )}

        {/* 4. EMPTY INITIAL STATE (No query entered yet) */}
        {!loading && !isForbidden && !errorMsg && !hasSearched && query.trim().length === 0 && (
          <div data-testid="search-empty-state" className="py-6 px-4 text-center space-y-4">
            <div className="w-11 h-11 rounded-2xl bg-[#FFF5F0] text-[#c23807] flex items-center justify-center mx-auto shadow-2xs border border-[#FDE8E0]">
              <Search className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-slate-900 text-sm">Tra Cứu Nhanh Toàn Hệ Thống</h3>
              <p className="text-slate-500 text-xs max-w-md mx-auto">
                Nhập ít nhất 2 ký tự để tìm kiếm tức thì theo mã đơn, mã vận đơn hãng, bảng kê đối
                soát, ngoại lệ giao hàng và lệch cước tài chính.
              </p>
            </div>

            {/* Quick Suggestions / Sample Tags */}
            <div className="pt-2">
              <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-2">
                Gợi ý tra cứu nhanh:
              </span>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {['ORD-', 'GHN', 'GHTK', 'Bảng kê', 'Ngoại lệ'].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setQuery(chip);
                      inputRef.current?.focus();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Keyboard Guide */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-center gap-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">
                  ↑
                </kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">
                  ↓
                </kbd>
                <span>chọn kết quả</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">
                  Enter
                </kbd>
                <span>mở hồ sơ</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">
                  Esc
                </kbd>
                <span>đóng</span>
              </span>
            </div>
          </div>
        )}

        {/* 5. NO-RESULTS STATE (Search completed with 0 matches) */}
        {!loading &&
          !isForbidden &&
          !errorMsg &&
          hasSearched &&
          items.length === 0 &&
          !validationError && (
            <div data-testid="search-no-results-state" className="py-8 px-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-xs">
                  Không tìm thấy kết quả phù hợp cho &quot;{query}&quot;
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                  Kiểm tra lại chính tả từ khóa hoặc thử chuyển bộ lọc sang danh mục khác.
                </p>
              </div>

              {/* Recovery Action: Clear Filter or Query */}
              <div className="flex items-center justify-center gap-2 pt-2">
                {activeType !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveType('ALL');
                      executeSearch(query, 'ALL');
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs transition cursor-pointer"
                  >
                    Tìm trong Tất Cả danh mục
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearQuery}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-xs transition cursor-pointer"
                >
                  Xóa từ khóa
                </button>
              </div>
            </div>
          )}

        {/* 6. SUCCESS & PARTIAL STATES (Results found) */}
        {!loading && !isForbidden && !errorMsg && items.length > 0 && (
          <div
            data-testid="search-success-state"
            className="space-y-3 animate-in fade-in duration-100"
          >
            {/* Results Header with Counts & Partial Indicator */}
            <div className="flex items-center justify-between pb-1 text-slate-500 text-[11px] font-medium border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span>
                  Tìm thấy <strong className="text-slate-900">{total}</strong> kết quả cho &quot;
                  {query}&quot;
                </span>
                {/* 7. PARTIAL STATE INDICATOR */}
                {isPartialNotice && (
                  <span
                    data-testid="search-partial-state"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold"
                  >
                    <span>
                      Hiển thị {items.length}/{total} kết quả
                    </span>
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">Dùng ↑ ↓ để duyệt</span>
            </div>

            {/* Results List */}
            <div
              ref={listRef}
              data-testid="search-results-list"
              id="search-results-list"
              role="listbox"
              aria-label="Danh sách kết quả tìm kiếm"
              className="space-y-1.5"
            >
              {items.map((item, index) => {
                const { icon: ItemIcon, color: iconStyle } = getItemIcon(item.type);
                const isSelected = index === selectedIndex;

                return (
                  <div
                    key={item.id}
                    data-testid={`search-item-${item.id}`}
                    id={`search-item-${item.id}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectItem(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`p-3 rounded-xl border transition flex items-center justify-between gap-3 cursor-pointer select-none ${
                      isSelected
                        ? 'bg-[#FFF5F0] border-[#c23807] ring-1 ring-[#c23807]'
                        : 'bg-white hover:bg-slate-50 border-slate-100'
                    }`}
                  >
                    {/* Left Icon */}
                    <div
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${iconStyle}`}
                    >
                      <ItemIcon className="w-4 h-4" />
                    </div>

                    {/* Middle Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 truncate text-xs">
                          {item.title}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                          {item.code}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>

                    {/* Right Status & Action */}
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={item.status} />
                      <div className="text-slate-400">
                        {isSelected ? (
                          <CornerDownLeft className="w-3.5 h-3.5 text-[#c23807]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Status & Recovery Guide */}
      <div className="px-4 py-2.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Cách ly đa người thuê: Tự động lọc theo Shop đang đăng nhập</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Bảo vệ PII</span>
          <span>Kiểm soát phân quyền</span>
        </div>
      </div>
    </div>
  );
};

export const GlobalSearchModal: React.FC<GlobalSearchProps> = (props) => {
  const { isOpen = false, onClose } = props;

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl">
        <GlobalSearchContent {...props} standalone={false} />
      </div>
    </div>
  );
};
