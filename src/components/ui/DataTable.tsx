'use client';

import React from 'react';
import { EmptyState } from './OperationalComponents';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface ColumnDef<T> {
  header: string;
  accessorKey?: keyof T | string;
  cell?: (item: T, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (item: T) => string;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string, shiftKey: boolean) => void;
  onSelectAll?: () => void;
  onRowClick?: (item: T) => void;
  loading?: boolean;
  emptyTitle?: string;
  emptyReason?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  // Cursor Pagination Props
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  totalRecords?: number;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onRowClick,
  loading = false,
  emptyTitle = 'Không tìm thấy bản ghi nào',
  emptyReason = 'Hãy kiểm tra lại bộ lọc tìm kiếm hoặc nạp thêm đơn hàng từ nguồn POS.',
  emptyActionLabel,
  onEmptyAction,
  hasPrev = false,
  hasNext = false,
  onPrevPage,
  onNextPage,
  totalRecords,
}: DataTableProps<T>) {
  const isAllSelected = data.length > 0 && selectedIds && data.every((item) => selectedIds.has(keyExtractor(item)));

  return (
    <div className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-[5px] flex flex-col overflow-hidden">
      {/* Table Viewport */}
      <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar">
        <table className="op-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {onToggleSelect && (
                <th style={{ width: '36px' }} className="text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={onSelectAll}
                    className="w-3.5 h-3.5 rounded-[2px] border-[var(--line-str)] text-[var(--accent)] focus:ring-0 cursor-pointer"
                  />
                </th>
              )}
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  style={{ width: col.width }}
                  className={
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  }
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Static gray loading cells (No blinking skeleton)
              Array.from({ length: 8 }).map((_, rIdx) => (
                <tr key={rIdx}>
                  {onToggleSelect && <td className="text-center"><div className="w-3.5 h-3.5 bg-[var(--line)] mx-auto rounded-[2px]" /></td>}
                  {columns.map((_, cIdx) => (
                    <td key={cIdx}>
                      <div className="h-4 bg-[var(--line)] rounded-[2px] w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (onToggleSelect ? 1 : 0)} className="p-0">
                  <EmptyState
                    title={emptyTitle}
                    reason={emptyReason}
                    actionLabel={emptyActionLabel}
                    onAction={onEmptyAction}
                  />
                </td>
              </tr>
            ) : (
              data.map((item, index) => {
                const id = keyExtractor(item);
                const isSelected = selectedIds?.has(id);
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick && onRowClick(item)}
                    className={`${isSelected ? 'selected' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}
                  >
                    {onToggleSelect && (
                      <td
                        className="text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSelect(id, e.shiftKey);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded-[2px] border-[var(--line-str)] text-[var(--accent)] focus:ring-0 cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map((col, cIdx) => (
                      <td
                        key={cIdx}
                        className={
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                        }
                      >
                        {col.cell ? col.cell(item, index) : (item as any)[col.accessorKey as string]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Cursor Pagination Bar (P2) */}
      <div className="h-10 border-t border-[var(--line)] bg-[var(--canvas)] px-3 flex items-center justify-between text-[12px] text-[var(--ink-600)]">
        <div>
          {totalRecords !== undefined ? (
            <span>Tổng số: <strong className="text-[var(--ink-900)] tabular-nums">{totalRecords}</strong> bản ghi</span>
          ) : (
            <span>Hiển thị <strong className="text-[var(--ink-900)] tabular-nums">{data.length}</strong> dòng</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={onPrevPage}
            className="op-btn h-[26px] px-2 text-[11px] disabled:opacity-40"
            title="Trang trước"
          >
            <ChevronLeft className="w-3 h-3 mr-0.5" /> Trước
          </button>

          <span className="text-[11px] font-mono text-[var(--ink-400)]">Phân trang bằng con trỏ</span>

          <button
            type="button"
            disabled={!hasNext}
            onClick={onNextPage}
            className="op-btn h-[26px] px-2 text-[11px] disabled:opacity-40"
            title="Trang sau"
          >
            Sau <ChevronRight className="w-3 h-3 ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
