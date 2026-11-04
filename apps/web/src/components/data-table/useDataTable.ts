// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table
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
 * URL search params helpers and the dual-mode useDataTable dispatcher.
 */

'use client';

import type { RowData } from '@tanstack/react-table';

import type { TablecnUseDataTableProps } from './use-tablecn-helpers';
import type { UseDataTableProps, UseDataTableReturn } from './use-shipde-data-table';
import { useShipdeDataTable } from './use-shipde-data-table';
import { useTablecnDataTable } from './use-tablecn-data-table';

export { formatSortParam, normalizeParamsString, parseSortParam } from './data-table-url-params';
export type { UseDataTableProps, UseDataTableReturn } from './use-shipde-data-table';
export type { TablecnUseDataTableProps } from './use-tablecn-helpers';

export function useDataTable<TData extends RowData>(
  props: TablecnUseDataTableProps<TData>
): { table: any };
export function useDataTable(props?: UseDataTableProps): UseDataTableReturn;
export function useDataTable(props: any = {}): any {
  if (
    props &&
    'columns' in props &&
    Array.isArray(props.columns) &&
    !('filterableColumns' in props)
  ) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useTablecnDataTable(props);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useShipdeDataTable(props);
}
