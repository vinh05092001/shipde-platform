import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import {
  EmptyState,
  StatusBadge,
  AutomationBadge,
  Money,
  TrackingCode,
  ConfirmDialog,
} from './OperationalComponents';
import { AlertCircle, FileSearch } from 'lucide-react';

const meta: Meta = {
  title: 'UI/OperationalComponents',
  tags: ['autodocs'],
};

export default meta;

export const StatusBadges: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="font-bold text-sm text-slate-800">
        1. Thành công & Đã đối soát (Success / Resolved)
      </h3>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="DELIVERED" />
        <StatusBadge status="RESOLVED" />
        <StatusBadge status="MATCHED" />
        <StatusBadge status="ACCEPTED" />
        <StatusBadge status="ACTIVE" />
      </div>

      <h3 className="font-bold text-sm text-slate-800">
        2. Đang luân chuyển & Chờ xử lý (In-Transit / Loading)
      </h3>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="OUT_FOR_DELIVERY" />
        <StatusBadge status="IN_TRANSIT" />
        <StatusBadge status="PICKING" />
        <StatusBadge status="PICKED" />
        <StatusBadge status="RETURNING" />
      </div>

      <h3 className="font-bold text-sm text-slate-800">
        3. Cảnh báo & Chậm trễ (Warning / Delayed)
      </h3>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="PICKUP_DELAY" />
        <StatusBadge status="OPEN" />
        <StatusBadge status="PENDING" />
        <StatusBadge status="ASSIGNED" />
      </div>

      <h3 className="font-bold text-sm text-slate-800">
        4. Thất bại, Khiếu nại & Lệch đối soát (Error / Discrepancy)
      </h3>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="DELIVERY_FAIL" />
        <StatusBadge status="DISPUTED" />
        <StatusBadge status="DAMAGED" />
        <StatusBadge status="LOST" />
        <StatusBadge status="D1_WEIGHT" />
        <StatusBadge status="D2_FREIGHT" />
        <StatusBadge status="D5_COD_MISMATCH" />
      </div>
    </div>
  ),
};

export const EmptyStates: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h3 className="font-bold text-sm text-slate-800 mb-2">Trạng thái rỗng mặc định (Empty)</h3>
        <EmptyState
          title="Chưa có dữ liệu phiên đối soát"
          description="Hệ thống chưa ghi nhận phiên đối soát nào được tạo trong tuần này."
          actionLabel="Tạo phiên đối soát mới"
          onAction={() => alert('Bắt đầu tạo phiên')}
        />
      </div>

      <div>
        <h3 className="font-bold text-sm text-slate-800 mb-2">
          Trạng thái rỗng do bộ lọc không khớp (Filtered Empty)
        </h3>
        <EmptyState
          icon={<FileSearch className="w-6 h-6 text-slate-400" />}
          title="Không tìm thấy vận đơn phù hợp"
          reason="Không có vận đơn nào khớp với tiêu chí tìm kiếm hoặc trạng thái đã chọn."
          actionLabel="Xóa toàn bộ bộ lọc"
          onAction={() => alert('Reset filters')}
        />
      </div>

      <div>
        <h3 className="font-bold text-sm text-slate-800 mb-2">
          Trạng thái lỗi / Cảnh báo cần kiểm tra (Error State)
        </h3>
        <EmptyState
          icon={<AlertCircle className="w-6 h-6 text-rose-500" />}
          title="Không thể tải báo cáo sao kê"
          reason="Mất kết nối tạm thời tới máy chủ lưu trữ sao kê MinIO. Vui lòng thử lại sau giây lát."
          actionLabel="Thử lại kết nối"
          onAction={() => alert('Retrying')}
        />
      </div>
    </div>
  ),
};

export const MoneyFormats: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4 p-4 font-mono">
      <div className="flex items-center justify-between border-b pb-2 max-w-sm">
        <span className="text-xs text-slate-600">Đã xác nhận (Dương / Thu hộ COD):</span>
        <Money amount={1500000} state="confirmed" showSign={true} />
      </div>
      <div className="flex items-center justify-between border-b pb-2 max-w-sm">
        <span className="text-xs text-slate-600">Đã xác nhận (Âm / Cước vận chuyển):</span>
        <Money amount={-42000} state="confirmed" />
      </div>
      <div className="flex items-center justify-between border-b pb-2 max-w-sm">
        <span className="text-xs text-slate-600">Đang chờ đối soát (Pending):</span>
        <Money amount={380000} state="pending" />
      </div>
      <div className="flex items-center justify-between border-b pb-2 max-w-sm">
        <span className="text-xs text-slate-600">Ước tính tạm tính (Estimated):</span>
        <Money amount={620000} state="estimated" />
      </div>
    </div>
  ),
};

export const TrackingCodes: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 w-32">Giao Hàng Nhanh:</span>
        <TrackingCode code="GHN83921820VN" onClick={() => alert('Mở chi tiết GHN83921820VN')} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 w-32">Giao Hàng Tiết Kiệm:</span>
        <TrackingCode code="S192837.GHTK.HN" onClick={() => alert('Mở chi tiết S192837.GHTK.HN')} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 w-32">Viettel Post:</span>
        <TrackingCode code="VT902192819" onClick={() => alert('Mở chi tiết VT902192819')} />
      </div>
    </div>
  ),
};

export const AutomationTiers: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-4">
        <span className="text-xs text-slate-500 w-44">Tự động mức L2 (API):</span>
        <AutomationBadge tier="L2" carrierCode="GHN" />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-slate-500 w-44">Bán tự động mức L1 (Portal):</span>
        <AutomationBadge tier="L1" carrierCode="GHTK" />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-slate-500 w-44">Thủ công mức L0:</span>
        <AutomationBadge tier="L0" carrierCode="CHÀNH XE" />
      </div>
    </div>
  ),
};

function DialogsDemoStory() {
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap gap-3 p-4">
      <button
        type="button"
        onClick={() => setDialogOpen('confirm')}
        className="btn-primary text-xs"
      >
        Mở Xác Nhận Thường
      </button>
      <button type="button" onClick={() => setDialogOpen('danger')} className="btn-danger text-xs">
        Mở Xác Nhận Cảnh Báo Nguy Hiểm
      </button>
      <button
        type="button"
        onClick={() => setDialogOpen('reason')}
        className="btn-secondary text-xs"
      >
        Mở Xác Nhận Bắt Buộc Lý Do
      </button>

      <ConfirmDialog
        isOpen={dialogOpen === 'confirm'}
        title="Chốt phiên đối soát COD"
        message="Bạn có chắc chắn muốn chốt số liệu đối soát đợt này và chuyển kế toán giải ngân?"
        confirmLabel="Chốt số liệu"
        onConfirm={() => {
          alert('Đã chốt phiên đối soát!');
          setDialogOpen(null);
        }}
        onCancel={() => setDialogOpen(null)}
      />

      <ConfirmDialog
        isOpen={dialogOpen === 'danger'}
        title="Hủy kết nối tài khoản hãng vận chuyển"
        message="Hành động này sẽ ngắt toàn bộ tự động hóa và đồng bộ trạng thái đơn hàng từ cổng đối tác."
        isDanger={true}
        confirmLabel="Xóa kết nối"
        onConfirm={() => {
          alert('Đã xóa kết nối hãng');
          setDialogOpen(null);
        }}
        onCancel={() => setDialogOpen(null)}
      />

      <ConfirmDialog
        isOpen={dialogOpen === 'reason'}
        title="Điều chỉnh số liệu chênh lệch cước"
        message="Theo quy tắc kiểm toán tài chính, mọi can thiệp thủ công vào dòng cước đều phải ghi nhận lý do."
        requireReason={true}
        confirmLabel="Lưu điều chỉnh"
        onConfirm={(reason) => {
          alert(`Đã lưu với lý do giải trình: ${reason}`);
          setDialogOpen(null);
        }}
        onCancel={() => setDialogOpen(null)}
      />
    </div>
  );
}

export const Dialogs: StoryObj = {
  render: () => <DialogsDemoStory />,
};
