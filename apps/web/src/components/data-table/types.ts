/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 *
 * MIT License
 * Copyright (c) 2024 Sadman Sakib
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
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
  sort?: ColumnSort | null;
}
