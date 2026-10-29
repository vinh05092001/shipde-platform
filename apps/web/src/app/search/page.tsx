'use client';

import React, { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { GlobalSearchContent } from '@/components/GlobalSearchModal';
import { SearchEntityType, SearchResultItem } from '@shipde/contracts';
import { Search } from 'lucide-react';

export interface SearchPageProps {
  initialQuery?: string;
  initialType?: SearchEntityType;
  initialLoading?: boolean;
  initialError?: string | null;
  initialForbidden?: boolean;
  initialItems?: SearchResultItem[];
  initialTotal?: number;
  initialValidationMessage?: string | null;
  initialIsPartial?: boolean;
  initialHasSearched?: boolean;
  onNavigate?: (url: string) => void;
}

export const SearchPageContent: React.FC<SearchPageProps> = ({
  initialQuery = '',
  initialType = 'ALL',
  initialLoading,
  initialError,
  initialForbidden,
  initialItems,
  initialTotal,
  initialValidationMessage,
  initialIsPartial,
  initialHasSearched,
  onNavigate,
}) => {
  return (
    <div className="min-h-screen bg-[#FDFCFB] text-slate-900 selection:bg-[#c23807] selection:text-white p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Navigation Breadcrumb & Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#EAE7E4] gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#c23807] text-white flex items-center justify-center font-black text-xs shadow-2xs">
                S
              </span>
              <h1 className="text-lg font-black text-slate-900 tracking-tight">
                Tìm Kiếm Toàn Hệ Thống (FEAT-COM-01)
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Tra cứu đồng thời đơn hàng, vận đơn, bảng kê đối soát, khiếu nại ngoại lệ và lệch cước
              tài chính
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate?.('/')}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-[#EAE7E4] hover:bg-[#F6F5F3] transition self-start sm:self-auto cursor-pointer"
          >
            ← Trở về Bảng Điều Khiển
          </button>
        </header>

        {/* Global Search Component in Standalone Mode */}
        <main>
          <GlobalSearchContent
            standalone={true}
            initialQuery={initialQuery}
            initialType={initialType}
            initialLoading={initialLoading}
            initialError={initialError}
            initialForbidden={initialForbidden}
            initialItems={initialItems}
            initialTotal={initialTotal}
            initialValidationMessage={initialValidationMessage}
            initialIsPartial={initialIsPartial}
            initialHasSearched={initialHasSearched}
            onSelectResult={(item) => {
              if (item.url) {
                onNavigate?.(item.url);
              }
            }}
          />
        </main>
      </div>
    </div>
  );
};

export const SearchPageInner: React.FC<SearchPageProps> = (props) => {
  const searchParams = useSearchParams();
  const router = useRouter();

  const queryFromUrl = searchParams ? searchParams.get('q') || '' : '';
  const typeFromUrl =
    (searchParams ? (searchParams.get('type') as SearchEntityType) : null) || 'ALL';

  return (
    <SearchPageContent
      {...props}
      initialQuery={props.initialQuery !== undefined ? props.initialQuery : queryFromUrl}
      initialType={props.initialType !== undefined ? props.initialType : typeFromUrl}
      onNavigate={props.onNavigate || ((url: string) => router.push(url))}
    />
  );
};

export const SearchPage: React.FC<SearchPageProps> = (props = {}) => {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center p-8 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-[#c23807] animate-pulse" />
            <span>Đang chuẩn bị trang tìm kiếm...</span>
          </div>
        </div>
      }
    >
      <SearchPageInner {...props} />
    </Suspense>
  );
};

export default SearchPage;
