import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { DataTable, ColumnDef } from './DataTable';

interface ShipmentRow {
  id: string;
  code: string;
  recipient: string;
  cod: number;
  status: string;
}

const mockData: ShipmentRow[] = [
  {
    id: 'waybill-1',
    code: 'SD89218201',
    recipient: 'Nguyễn Văn An (Hà Nội)',
    cod: 450000,
    status: 'Giao Thành Công',
  },
  {
    id: 'waybill-2',
    code: 'SD89218202',
    recipient: 'Trần Thị Bình (Đà Nẵng)',
    cod: 1200000,
    status: 'Đang Trung Chuyển',
  },
  {
    id: 'waybill-3',
    code: 'SD89218203',
    recipient: 'Phạm Minh Cường (TP.HCM)',
    cod: 0,
    status: 'Chờ Lấy Hàng',
  },
  {
    id: 'waybill-4',
    code: 'SD89218204',
    recipient: 'Hoàng Kim Dung (Cần Thơ)',
    cod: 320000,
    status: 'Lệch Cước Hợp Đồng',
  },
];

const columns: ColumnDef<ShipmentRow>[] = [
  { header: 'Mã Vận Đơn', accessorKey: 'code', width: '180px' },
  { header: 'Người Nhận', accessorKey: 'recipient' },
  {
    header: 'Tiền COD',
    accessorKey: 'cod',
    align: 'right',
    width: '140px',
    cell: (item) => `${item.cod.toLocaleString('vi-VN')} đ`,
  },
  { header: 'Trạng Thái', accessorKey: 'status', width: '180px' },
];

const meta: Meta<typeof DataTable<ShipmentRow>> = {
  title: 'UI/DataTable',
  component: DataTable,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof DataTable<ShipmentRow>>;

function DataTableSuccessStory() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(['waybill-1']));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === mockData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(mockData.map((d) => d.id)));
    }
  };

  return (
    <DataTable
      data={mockData}
      columns={columns}
      keyExtractor={(item) => item.id}
      selectedIds={selectedIds}
      onToggleSelect={toggleSelect}
      onSelectAll={selectAll}
      hasPrev={false}
      hasNext={true}
      totalRecords={48}
    />
  );
}

export const Success: Story = {
  render: () => <DataTableSuccessStory />,
};

export const Loading: Story = {
  args: {
    data: [],
    columns,
    keyExtractor: (item) => item.id,
    loading: true,
  },
};

export const Empty: Story = {
  args: {
    data: [],
    columns,
    keyExtractor: (item) => item.id,
    loading: false,
    emptyTitle: 'Chưa có đơn hàng nào trong khoảng thời gian này',
    emptyReason:
      'Bộ lọc hiện tại không tìm thấy dữ liệu đối soát. Vui lòng thử chọn khoảng ngày khác.',
    emptyActionLabel: 'Xóa bộ lọc',
    onEmptyAction: () => alert('Đã đặt lại bộ lọc tìm kiếm'),
  },
};
