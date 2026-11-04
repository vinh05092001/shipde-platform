/**
 * Storybook showcase column definitions (Vietnamese localized headers).
 */

'use client';

import type React from 'react';
import { useMemo } from 'react';

import {
  DataTableColumnHeader,
  type ColumnDef,
  type ColumnSort,
} from '../../components/data-table';
import type { FixtureShipment } from './fixtures';

interface UseShowcaseColumnsOptions {
  sort: ColumnSort | null;
  setSort: (columnId: string, desc?: boolean) => void;
  setHiddenColumns: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useShowcaseColumns({ sort, setSort, setHiddenColumns }: UseShowcaseColumnsOptions) {
  // Column definitions with Vietnamese localized title (Finding 12 P2 / BR-UI-04)
  const columns: ColumnDef<FixtureShipment>[] = useMemo(
    () => [
      {
        id: 'trackingCode',
        title: 'Mã vận đơn',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Mã vận đơn"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono font-bold text-[var(--primary)]">{row.trackingCode}</span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              {row.orderNumber}
            </span>
          </div>
        ),
      },
      {
        id: 'carrier',
        title: 'Hãng vận chuyển',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Hãng vận chuyển"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => {
          let badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
          if (row.carrier === 'GHTK') {
            badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
          } else if (row.carrier === 'VTP') {
            badgeColor = 'bg-red-50 text-red-700 border-red-200';
          }

          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-bold border ${badgeColor}`}
            >
              {row.carrier}
            </span>
          );
        },
      },
      {
        id: 'recipientName',
        title: 'Người nhận & SĐT',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Người nhận"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--text-primary)]">{row.recipientName}</span>
            <span className="text-[11px] text-[var(--text-dim)] font-mono">
              {row.recipientPhone}
            </span>
          </div>
        ),
      },
      {
        id: 'codAmount',
        title: 'Thu hộ COD',
        align: 'right',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Thu hộ COD"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-mono font-medium text-[var(--text-primary)]">
            {row.codAmount.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
      {
        id: 'feeAmount',
        title: 'Cước vận chuyển',
        align: 'right',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Cước phí"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-mono text-[var(--text-secondary)]">
            {row.feeAmount.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
      {
        id: 'status',
        title: 'Trạng thái giao hàng',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Trạng thái"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => {
          const statusMap: Record<string, { label: string; class: string }> = {
            PENDING: {
              label: 'Chờ lấy hàng',
              class: 'bg-amber-50 text-amber-700 border-amber-200',
            },
            IN_TRANSIT: {
              label: 'Đang giao',
              class: 'bg-blue-50 text-blue-700 border-blue-200',
            },
            DELIVERED: {
              label: 'Đã giao hàng',
              class: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            },
            FAILED: {
              label: 'Giao thất bại',
              class: 'bg-rose-50 text-rose-700 border-rose-200',
            },
            CLAIM_PENDING: {
              label: 'Chờ bồi thường',
              class: 'bg-purple-50 text-purple-700 border-purple-200',
            },
          };
          const info = statusMap[row.status] || {
            label: row.status,
            class: 'bg-gray-50 text-gray-700 border-gray-200',
          };

          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${info.class}`}
            >
              {info.label}
            </span>
          );
        },
      },
      {
        id: 'createdAt',
        title: 'Ngày tạo',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Ngày tạo"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-mono text-[11px] text-[var(--text-muted)]">
            {row.createdAt}
          </span>
        ),
      },
    ],
    [sort, setSort, setHiddenColumns]
  );

  return columns;
}
