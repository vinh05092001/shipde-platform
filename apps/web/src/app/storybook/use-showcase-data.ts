/**
 * Storybook showcase data derivation, row selection, and fixture actions.
 */

'use client';

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { ColumnSort } from '../../components/data-table';
import type { FixtureShipment } from './fixtures';

interface UseShowcaseRowsOptions {
  filters: Record<string, string[]>;
  simulatedEmpty: boolean;
  fixtureShipmentsList: FixtureShipment[];
  searchValue: string;
  sort: ColumnSort | null;
  pageSize: number;
  pageIndex: number;
  setPagination: (page: number) => void;
}

export function useShowcaseRows({
  filters,
  simulatedEmpty,
  fixtureShipmentsList,
  searchValue,
  sort,
  pageSize,
  pageIndex,
  setPagination,
}: UseShowcaseRowsOptions) {
  const selectedStatus = useMemo(() => filters['status'] || [], [filters]);
  const selectedCarriers = useMemo(() => filters['carrier'] || [], [filters]);

  // Filter & Sort Logic driven by URL search params
  const filteredData = useMemo(() => {
    if (simulatedEmpty) return [];

    let list = [...fixtureShipmentsList];

    // Search filter
    if (searchValue.trim()) {
      const q = searchValue.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.trackingCode.toLowerCase().includes(q) ||
          item.orderNumber.toLowerCase().includes(q) ||
          item.recipientName.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (selectedStatus.length > 0) {
      list = list.filter((item) => selectedStatus.includes(item.status));
    }

    // Carrier filter
    if (selectedCarriers.length > 0) {
      list = list.filter((item) => selectedCarriers.includes(item.carrier));
    }

    // Sorting
    const sortCol = sort?.id || 'createdAt';
    const sortDesc = sort ? sort.desc : true;

    list.sort((a, b) => {
      const valA: any = (a as any)[sortCol];
      const valB: any = (b as any)[sortCol];

      if (typeof valA === 'string') {
        return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
      }
      return sortDesc ? valB - valA : valA - valB;
    });

    return list;
  }, [simulatedEmpty, fixtureShipmentsList, searchValue, selectedStatus, selectedCarriers, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredData.length / pageSize));

  // Clamp out-of-range deep links against available count (Finding 12 P2)
  useEffect(() => {
    if (pageIndex > pageCount && pageCount > 0) {
      setPagination(pageCount);
    }
  }, [pageIndex, pageCount, setPagination]);

  const safePageIndex = Math.max(1, Math.min(pageIndex, pageCount));

  // Pagination slice
  const paginatedData = useMemo(() => {
    const start = (safePageIndex - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, safePageIndex, pageSize]);

  return {
    selectedStatus,
    selectedCarriers,
    filteredData,
    pageCount,
    safePageIndex,
    paginatedData,
  };
}

export function useShowcaseSelection(paginatedData: FixtureShipment[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select-all verifies current page membership instead of raw counts (Finding 10 P2)
  const isAllCurrentPageSelected =
    paginatedData.length > 0 && paginatedData.every((item) => selectedIds.has(item.id));

  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllCurrentPageSelected) {
        paginatedData.forEach((item) => next.delete(item.id));
      } else {
        paginatedData.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  return { selectedIds, handleToggleSelect, handleSelectAll };
}

interface CreateShowcaseActionsOptions {
  filteredData: FixtureShipment[];
  fixtureShipmentsList: FixtureShipment[];
  setFixtureShipmentsList: React.Dispatch<React.SetStateAction<FixtureShipment[]>>;
  setActionFeedback: React.Dispatch<React.SetStateAction<string | null>>;
}

export function createShowcaseActions({
  filteredData,
  fixtureShipmentsList,
  setFixtureShipmentsList,
  setActionFeedback,
}: CreateShowcaseActionsOptions) {
  // Explicit fixture interactions for primary buttons (Finding 4 P2)
  const handleExportExcel = () => {
    const csvRows = [
      'Mã vận đơn,Mã đơn hàng,Người nhận,Số điện thoại,Hãng,Thu hộ COD,Cước phí,Trạng thái,Ngày tạo',
      ...filteredData.map(
        (item) =>
          `"${item.trackingCode}","${item.orderNumber}","${item.recipientName}","${item.recipientPhone}","${item.carrier}",${item.codAmount},${item.feeAmount},"${item.status}","${item.createdAt}"`
      ),
    ];
    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csvRows.join('\n'));
    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.setAttribute('href', csvContent);
      link.setAttribute('download', 'fixture_shipments.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setActionFeedback(
      `[FIXTURE] Đã xuất thành công ${filteredData.length} bản ghi sang file fixture_shipments.csv`
    );
  };

  const handleCreateDemoShipment = () => {
    const nextIdx = fixtureShipmentsList.length + 1;
    const newOrder: FixtureShipment = {
      id: `fix-ship-${String(nextIdx).padStart(3, '0')}`,
      trackingCode: `VN${Math.floor(100000000 + Math.random() * 900000000)}`,
      orderNumber: `ORD-DEMO-${Date.now().toString().slice(-4)}`,
      recipientName: 'Khách Thử Nghiệm',
      recipientPhone: '0987***999',
      carrier: 'GHN',
      codAmount: 250000,
      feeAmount: 22000,
      weightGrams: 500,
      status: 'PENDING',
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setFixtureShipmentsList((prev) => [newOrder, ...prev]);
    setActionFeedback(
      `[FIXTURE] Đã tạo đơn thử nghiệm mới: ${newOrder.trackingCode} (${newOrder.orderNumber})`
    );
  };

  return { handleExportExcel, handleCreateDemoShipment };
}
