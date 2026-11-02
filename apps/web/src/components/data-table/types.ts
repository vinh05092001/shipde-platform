/**
 * MIT License
 *
 * Portions of this file are adapted from sadmann7/shadcn-table
 * (https://github.com/sadmann7/shadcn-table)
 * Copyright (c) 2023 Sadman Sakib
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
 */

import type React from 'react';

export interface DataTableOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
}

export type DataTableFilterVariant = 'text' | 'faceted';

export interface DataTableFilterField<TData> {
  id: Extract<keyof TData, string> | string;
  label: string;
  placeholder?: string;
  options?: DataTableOption[];
  variant?: DataTableFilterVariant;
}

export type SortDirection = 'asc' | 'desc';

export interface ColumnSort {
  id: string;
  desc: boolean;
}

export type SortingState = ColumnSort[];

export interface ColumnFilter {
  id: string;
  value: string | string[];
}

export type ColumnFiltersState = ColumnFilter[];

export type VisibilityState = Record<string, boolean>;

export interface PaginationState {
  pageIndex: number;
  pageSize: number;
}

export type TableDensity = 'compact' | 'comfortable';

export interface ServerDataTableColumnDef<TData> {
  id: string;
  header: string;
  accessorKey?: Extract<keyof TData, string>;
  accessorFn?: (row: TData) => string | number | boolean | null | undefined;
  cell?: (row: TData, rowIndex: number) => React.ReactNode;
  enableSorting?: boolean;
  enableHiding?: boolean;
  align?: 'left' | 'center' | 'right';
  tabularNums?: boolean;
  width?: string;
  minWidth?: string;
}

export interface DataTableSearchParamsConfig<TData> {
  filterFields?: DataTableFilterField<TData>[];
  allowedSortIds?: string[];
  defaultPage?: number;
  defaultPerPage?: number;
  allowedPageSizes?: number[];
  defaultSort?: ColumnSort[];
  defaultDensity?: TableDensity;
}

export interface ParsedTableUrlState {
  page: number;
  perPage: number;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  columnVisibility: VisibilityState;
  density: TableDensity;
  validationErrors: string[];
}

export interface ServerDataTableInstance<TData> {
  data: TData[];
  columns: ServerDataTableColumnDef<TData>[];
  visibleColumns: ServerDataTableColumnDef<TData>[];
  pageCount: number;
  totalCount?: number;
  page: number;
  perPage: number;
  pageSizeOptions: number[];
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  columnVisibility: VisibilityState;
  density: TableDensity;
  selectedRowIds: Record<string, boolean>;
  validationErrors: string[];
  isFiltered: boolean;
  getRowId: (row: TData, index: number) => string;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSorting: (sorting: SortingState) => void;
  toggleColumnSort: (columnId: string, desc?: boolean) => void;
  clearColumnSort: (columnId: string) => void;
  getFilterValue: (columnId: string) => string | string[] | undefined;
  setFilterValue: (columnId: string, value: string | string[] | undefined) => void;
  resetFilters: () => void;
  setColumnVisibility: (columnId: string, visible: boolean) => void;
  setDensity: (density: TableDensity) => void;
  toggleRowSelected: (rowId: string, selected?: boolean) => void;
  toggleAllPageRowsSelected: (selected?: boolean) => void;
  clearRowSelection: () => void;
  buildQueryString: (overrides?: Partial<ParsedTableUrlState>) => string;
}
