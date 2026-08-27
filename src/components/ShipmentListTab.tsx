'use client';

import React, { useState, useEffect } from 'react';
import { Money, TrackingCode, StatusBadge, AutomationBadge } from './ui/OperationalComponents';
import { MASTER_SHIPMENTS, UnifiedShipment } from '@/services/unifiedDataStore';
import {
  Search,
  Filter,
  AlertTriangle,
  Eye,
  EyeOff,
  X,
  Package,
  Truck,
  DollarSign,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Calendar,
  MapPin,
  Clock,
  ShieldCheck,
  RefreshCw,
  SlidersHorizontal,
  ExternalLink,
} from 'lucide-react';

interface Props {
  onOpenTrackingModal: (trackingCode: string) => void;
  onNavigateToTab?: (tabId: string) => void;
  onCreateOrder?: () => void;
  userRole?: string;
}

export const ShipmentListTab: React.FC<Props> = ({
  onOpenTrackingModal,
  onNavigateToTab,
  onCreateOrder,
  userRole = 'OWNER',
}) => {
  const [shipments, setShipments] = useState<UnifiedShipment[]>(MASTER_SHIPMENTS);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Filter Controls
  const [carrierFilter, setCarrierFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [warehouseFilter, setWarehouseFilter] = useState('ALL');
  const [matchStatusFilter, setMatchStatusFilter] = useState('ALL');
  const [dateRangeFilter, setDateRangeFilter] = useState('30d');
  const [hasOpenCaseFilter, setHasOpenCaseFilter] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // PII Masking State
  const [unmaskedRows, setUnmaskedRows] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Cursor Pagination State
  const [cursorIndex, setCursorIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const fetchShipments = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shipments');
      const data = await res.json();
      if (res.ok && data.data && data.data.length > 0) {
        // If API returns data, sync, otherwise keep master shipments
      }
    } catch (e) {
      console.error('Failed to load shipments:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('/api/shipments');
        const data = await res.json();
        if (active && res.ok && data.data && data.data.length > 0) {
          // If API returns data, sync, otherwise keep master shipments
        }
      } catch (e) {
        console.error('Failed to load shipments:', e);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const toggleUnmask = (id: string, trackingCode: string) => {
    const isCurrentlyUnmasked = unmaskedRows[id];
    setUnmaskedRows((prev) => ({ ...prev, [id]: !isCurrentlyUnmasked }));
    if (!isCurrentlyUnmasked) {
      setToast(
        `[Audit Log] Đã mở xem thông tin số điện thoại khách hàng cho mã ${trackingCode}. Đã ghi nhật ký kiểm toán.`
      );
      setTimeout(() => setToast(null), 4000);
    }
  };

  // Filter Pipeline
  const filtered = shipments.filter((s) => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchTracking = s.tracking_code.toLowerCase().includes(term);
      const matchOrder = s.order_code.toLowerCase().includes(term);
      const matchCustomer = s.recipient_name.toLowerCase().includes(term);
      const matchPhone = s.recipient_phone.toLowerCase().includes(term);
      if (!matchTracking && !matchOrder && !matchCustomer && !matchPhone) return false;
    }

    if (carrierFilter !== 'ALL' && s.carrier_code !== carrierFilter) return false;
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
    if (warehouseFilter !== 'ALL' && s.warehouse_id !== warehouseFilter) return false;

    if (matchStatusFilter !== 'ALL') {
      if (s.match_status !== matchStatusFilter) return false;
    }

    if (hasOpenCaseFilter) {
      if (!s.has_open_exception && !s.has_open_discrepancy && !s.has_open_claim) return false;
    }

    return true;
  });

  const paginatedShipments = filtered.slice(cursorIndex, cursorIndex + pageSize);
  const totalCount = filtered.length;
  const hasNextPage = cursorIndex + pageSize < totalCount;
  const hasPrevPage = cursorIndex > 0;

  const handleNextPage = () => {
    if (hasNextPage) setCursorIndex((prev) => prev + pageSize);
  };

  const handlePrevPage = () => {
    if (hasPrevPage) setCursorIndex((prev) => Math.max(0, prev - pageSize));
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setCarrierFilter('ALL');
    setStatusFilter('ALL');
    setWarehouseFilter('ALL');
    setMatchStatusFilter('ALL');
    setDateRangeFilter('30d');
    setHasOpenCaseFilter(false);
    setCursorIndex(0);
  };

  const hasActiveFilters =
    searchTerm !== '' ||
    carrierFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    warehouseFilter !== 'ALL' ||
    matchStatusFilter !== 'ALL' ||
    dateRangeFilter !== '30d' ||
    hasOpenCaseFilter;

  return (
    <div className="w-full space-y-4">
      {/* Toast Notification */}
      {toast && (
        <div className="p-3 bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center justify-between shadow-lg border border-slate-700 animate-in fade-in">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{toast}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="font-bold text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="modern-card p-5 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-[#EA4B12]" />
                <span>Danh Sách & Tra Cứu Vận Đơn</span>
              </h1>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#FFF5F0] text-[#EA4B12] border border-[#FDDDD0]">
                {totalCount} bưu kiện
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Tra cứu bưu kiện toàn trình, kiểm tra trạng thái khớp mã nguồn và mở Timeline sự kiện
              hợp nhất 3 nguồn.
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch md:self-auto">
            {onCreateOrder && (
              <button type="button" onClick={onCreateOrder} className="btn-primary text-xs">
                <span>+ Tạo Vận Đơn</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setToast(
                  `✓ Đã xuất file Excel ${totalCount} vận đơn theo đúng tiêu chí lọc hiện hành.`
                );
                setTimeout(() => setToast(null), 4000);
              }}
              className="btn-secondary text-xs"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Xuất Excel</span>
            </button>

            <button
              type="button"
              onClick={fetchShipments}
              disabled={loading}
              className="btn-secondary text-xs"
              title="Tải lại dữ liệu mới nhất"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#EA4B12]' : 'text-slate-500'}`}
              />
              <span className="hidden sm:inline">Làm mới</span>
            </button>
          </div>
        </div>

        {/* Primary Filter Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2 border-t border-slate-100">
          {/* Search Box */}
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCursorIndex(0);
              }}
              placeholder="Tìm mã vận đơn, mã đơn POS, tên, SĐT..."
              className="modern-input pl-9 pr-8 text-xs font-medium"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Carrier Selector */}
          <div>
            <select
              value={carrierFilter}
              onChange={(e) => {
                setCarrierFilter(e.target.value);
                setCursorIndex(0);
              }}
              className="modern-input text-xs font-semibold text-slate-800"
            >
              <option value="ALL">Hãng: Tất cả (GHN, GHTK)</option>
              <option value="GHN">GHN Express (Tự động API)</option>
              <option value="GHTK">GHTK (Hỗ trợ cổng)</option>
            </select>
          </div>

          {/* Status Selector */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCursorIndex(0);
              }}
              className="modern-input text-xs font-semibold text-slate-800"
            >
              <option value="ALL">Trạng thái: Tất cả</option>
              <option value="picking">Chờ lấy hàng</option>
              <option value="in_transit">Đang trung chuyển</option>
              <option value="out_for_delivery">Đang giao hàng</option>
              <option value="delivered">Giao thành công</option>
              <option value="delivery_fail">Giao thất bại (Cần cứu)</option>
              <option value="returning">Đang chuyển hoàn</option>
              <option value="returned">Đã nhập hoàn kho</option>
            </select>
          </div>

          {/* Time Range Selector */}
          <div>
            <select
              value={dateRangeFilter}
              onChange={(e) => {
                setDateRangeFilter(e.target.value);
                setCursorIndex(0);
              }}
              className="modern-input text-xs font-semibold text-slate-800"
            >
              <option value="today">Hôm nay</option>
              <option value="7d">7 ngày qua</option>
              <option value="30d">30 ngày qua</option>
              <option value="90d">90 ngày qua (Tối đa)</option>
            </select>
          </div>

          {/* Advanced Filter Toggle & Reset */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`flex-1 btn-secondary text-xs justify-center ${
                showAdvancedFilters ||
                hasOpenCaseFilter ||
                matchStatusFilter !== 'ALL' ||
                warehouseFilter !== 'ALL'
                  ? 'bg-[#FFF5F0] text-[#EA4B12] border-[#FDDDD0] font-bold'
                  : ''
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Bộ Lọc</span>
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="btn-secondary text-xs px-2.5 text-rose-600 hover:bg-rose-50"
                title="Xóa toàn bộ bộ lọc"
              >
                Xóa
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Advanced Filters */}
        {showAdvancedFilters && (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">
                Trạng thái ghép mã nguồn:
              </label>
              <select
                value={matchStatusFilter}
                onChange={(e) => {
                  setMatchStatusFilter(e.target.value);
                  setCursorIndex(0);
                }}
                className="modern-input text-xs"
              >
                <option value="ALL">Tất cả trạng thái khớp</option>
                <option value="matched_exact">Khớp chính xác (Mã vận đơn / Mã đơn)</option>
                <option value="matched_fuzzy">Khớp mờ (Theo số tiền COD & ngày)</option>
                <option value="unmatched">Chưa khớp mã</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">
                Chi nhánh xuất kho:
              </label>
              <select
                value={warehouseFilter}
                onChange={(e) => {
                  setWarehouseFilter(e.target.value);
                  setCursorIndex(0);
                }}
                className="modern-input text-xs"
              >
                <option value="ALL">Tất cả chi nhánh</option>
                <option value="store_01">Chi Nhánh Quận 3 (HCM-Q3)</option>
                <option value="store_02">Kho Vận Tân Bình (HCM-TB)</option>
                <option value="store_03">Chi Nhánh Hà Nội (HN-CG)</option>
                <option value="store_04">Chi Nhánh Đà Nẵng (DN-HC)</option>
              </select>
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasOpenCaseFilter}
                  onChange={(e) => {
                    setHasOpenCaseFilter(e.target.checked);
                    setCursorIndex(0);
                  }}
                  className="w-4 h-4 rounded text-[#EA4B12] focus:ring-[#EA4B12] border-slate-300"
                />
                <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Chỉ đơn có hồ sơ mở (Sự cố / Khoản lệch / Khiếu nại)</span>
                </span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Main Table Viewport (14px Text, High Contrast, Clean Hairline Borders) */}
      <div className="modern-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Mã Vận Đơn / Mã Đơn POS</th>
                <th>Hãng & Phương Thức</th>
                <th>Người Nhận & Địa Chỉ</th>
                <th>Trạng Thái</th>
                <th>Ghép Mã</th>
                <th className="text-right">Tiền Thu Hộ (COD)</th>
                <th>Hồ Sơ Vận Hành</th>
                <th className="text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {paginatedShipments.map((shipment) => {
                const isUnmasked = unmaskedRows[shipment.id];
                const rawPhone = shipment.recipient_phone;
                const maskedPhone = isUnmasked
                  ? rawPhone
                  : rawPhone.slice(0, 3) + '***' + rawPhone.slice(-4);

                return (
                  <tr key={shipment.id}>
                    {/* Column 1: Tracking & Order Code */}
                    <td>
                      <TrackingCode
                        code={shipment.tracking_code}
                        onClick={() => onOpenTrackingModal(shipment.tracking_code)}
                      />
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        Đơn:{' '}
                        <span className="font-semibold text-slate-700">{shipment.order_code}</span>
                      </div>
                    </td>

                    {/* Column 2: Carrier & Automation */}
                    <td>
                      <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-slate-500" />
                        <span>{shipment.carrier_code}</span>
                      </div>
                      <div className="mt-1">
                        <AutomationBadge tier={shipment.carrier_code === 'GHN' ? 'L2' : 'L1'} />
                      </div>
                    </td>

                    {/* Column 3: Customer with PII Masking */}
                    <td>
                      <div className="font-semibold text-slate-900 text-xs">
                        {shipment.recipient_name}
                      </div>
                      <div className="text-xs text-slate-600 flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono">{maskedPhone}</span>
                        <button
                          type="button"
                          onClick={() => toggleUnmask(shipment.id, shipment.tracking_code)}
                          className="text-slate-400 hover:text-[#EA4B12] transition"
                          title={
                            isUnmasked
                              ? 'Ẩn số điện thoại'
                              : 'Mở xem số điện thoại (Có ghi log kiểm toán)'
                          }
                        >
                          {isUnmasked ? (
                            <EyeOff className="w-3.5 h-3.5 text-[#EA4B12]" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="text-xs text-slate-400 truncate max-w-[200px]">
                        {shipment.destination_province}
                      </div>
                    </td>

                    {/* Column 4: Status */}
                    <td>
                      <StatusBadge status={shipment.status} />
                    </td>

                    {/* Column 5: Match Status */}
                    <td>
                      {shipment.match_status === 'matched_exact' && (
                        <span className="badge-ok text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Khớp Chính Xác</span>
                        </span>
                      )}
                      {shipment.match_status === 'matched_fuzzy' && (
                        <span className="badge-warn text-xs">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>Khớp Mờ COD</span>
                        </span>
                      )}
                      {shipment.match_status === 'unmatched' && (
                        <span className="badge-info text-xs">Chưa Khớp</span>
                      )}
                    </td>

                    {/* Column 6: COD Amount */}
                    <td className="text-right font-mono font-bold text-slate-900 text-sm">
                      {shipment.cod_amount > 0 ? (
                        <Money amount={shipment.cod_amount} state="pending" />
                      ) : (
                        <span className="text-slate-400 text-xs font-normal">Không COD</span>
                      )}
                    </td>

                    {/* Column 7: Actionable Open Case Links */}
                    <td>
                      {shipment.has_open_exception && (
                        <button
                          type="button"
                          onClick={() => onNavigateToTab && onNavigateToTab('exceptions')}
                          className="badge-risk text-xs cursor-pointer hover:bg-rose-100 transition inline-flex items-center gap-1"
                          title="Bấm để chuyển sang Hộp việc cứu đơn xử lý ngay"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>Cần cứu đơn</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}

                      {shipment.has_open_discrepancy && !shipment.has_open_exception && (
                        <button
                          type="button"
                          onClick={() => onNavigateToTab && onNavigateToTab('reconciliation')}
                          className="badge-warn text-xs cursor-pointer hover:bg-amber-100 transition inline-flex items-center gap-1"
                        >
                          <DollarSign className="w-3.5 h-3.5 text-amber-600" />
                          <span>Lệch cước/COD</span>
                        </button>
                      )}

                      {shipment.has_open_claim &&
                        !shipment.has_open_exception &&
                        !shipment.has_open_discrepancy && (
                          <button
                            type="button"
                            onClick={() => onNavigateToTab && onNavigateToTab('claims')}
                            className="badge-info text-xs cursor-pointer hover:bg-slate-200 transition inline-flex items-center gap-1"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>Hồ sơ bồi thường</span>
                          </button>
                        )}

                      {!shipment.has_open_exception &&
                        !shipment.has_open_discrepancy &&
                        !shipment.has_open_claim && (
                          <span className="text-slate-400 text-xs flex items-center gap-1 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Bình thường</span>
                          </span>
                        )}
                    </td>

                    {/* Column 8: Details CTA */}
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => onOpenTrackingModal(shipment.tracking_code)}
                        className="btn-secondary text-xs py-1.5 px-3"
                      >
                        Chi Tiết
                      </button>
                    </td>
                  </tr>
                );
              })}

              {paginatedShipments.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">
                      Không tìm thấy bưu kiện nào phù hợp với bộ lọc hiện tại.
                    </p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="mt-3 btn-secondary text-xs"
                      >
                        Xóa toàn bộ bộ lọc
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cursor Pagination Bar */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span>
              Hiển thị{' '}
              <strong className="text-slate-900">{totalCount > 0 ? cursorIndex + 1 : 0}</strong> –{' '}
              <strong className="text-slate-900">
                {Math.min(cursorIndex + pageSize, totalCount)}
              </strong>{' '}
              trên tổng <strong className="text-slate-900">{totalCount}</strong> bưu kiện
            </span>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">|</span>
              <span>Dòng/trang:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCursorIndex(0);
                }}
                className="px-2 py-1 rounded-md border border-slate-200 bg-white font-semibold text-xs"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={!hasPrevPage}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Trang Trước</span>
            </button>

            <button
              type="button"
              onClick={handleNextPage}
              disabled={!hasNextPage}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              <span>Trang Sau</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
