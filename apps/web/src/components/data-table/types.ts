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
 * Types for DataTable component family, URL synchronization, and pagination.
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

export type SortOrder = 'asc' | 'desc';

export interface ColumnSort {
  id: string;
  desc: boolean;
}

export interface ColumnDef<TData = any> {
  id: string;
  header: React.ReactNode | ((props: { column: ColumnDef<TData> }) => React.ReactNode);
  title?: string;
  cell?: (props: { row: TData; index: number }) => React.ReactNode;
  accessorKey?: keyof TData | string;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  enableSorting?: boolean;
  enableHiding?: boolean;
}

export interface DataTableFilterOption {
  label: string;
  value: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
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
  forbidden?: boolean | string | null;
  forbiddenTitle?: string;
  forbiddenDescription?: string;
  forbiddenActionLabel?: string;
  onForbiddenAction?: () => void;
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
  maxHeight?: string | number;
}
