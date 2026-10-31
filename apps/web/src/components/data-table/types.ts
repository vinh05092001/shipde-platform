/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 * License: MIT
 *
 * Reusable server-driven data table type definitions.
 * Respects DESIGN-SYSTEM-UX-RULES.md and Vietnamese localization.
 */

import React from 'react';

export type SortDirection = 'asc' | 'desc';

export interface ColumnSort {
  id: string;
  desc: boolean;
}

export interface ColumnDef<TData = any> {
  id: string;
  header: string | ((props: { column: ColumnDef<any> }) => React.ReactNode);
  accessorKey?: keyof TData | string;
  cell?: (props: { row: TData; index: number }) => React.ReactNode;
  enableSorting?: boolean;
  enableHiding?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export interface DataTableFilterOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
}

export interface DataTableFilterableColumn {
  id: string;
  title: string;
  options: DataTableFilterOption[];
}

export interface DataTableSearchableColumn {
  id: string;
  title: string;
  placeholder?: string;
}

export interface DataTablePaginationProps {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  selectedCount?: number;
}

export interface DataTableProps<TData = any> {
  data: TData[];
  columns: ColumnDef<TData>[];
  keyExtractor: (item: TData) => string;
  loading?: boolean;
  error?: Error | string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  toolbar?: React.ReactNode;
  pagination?: React.ReactNode;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string, shiftKey?: boolean) => void;
  onSelectAll?: () => void;
  onRowClick?: (item: TData) => void;
  visibleColumns?: Set<string>;
}
