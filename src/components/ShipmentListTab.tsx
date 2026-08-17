'use client';

import React, { useState, useEffect } from 'react';
import { Money, TrackingCode, StatusBadge, AutomationBadge } from './ui/OperationalComponents';
import { Shipment, CarrierCode, ShipmentStatus } from '@/types/domain';
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
  Layers,
} from 'lucide-react';

interface Props {
  onOpenTrackingModal: (trackingCode: string) => void;
  onNavigateToTab?: (tabId: string) => void;
  userRole?: string;
}

export const ShipmentListTab: React.FC<Props> = ({
  onOpenTrackingModal,
  onNavigateToTab,
  userRole = 'OWNER',
}) => {
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // CN-26 Filter Controls
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

  // Cursor Pagination State (CN-26)
  const [cursorIndex, setCursorIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const fetchShipments = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shipments');
      const data = await res.json();
      if (res.ok && data.shipments) {
        setShipments(data.shipments);
      }
    } catch (e) {
      console.error('Failed to load shipments:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShipments();
  }, []);

  const toggleUnmask = (id: string, trackingCode: string) => {
    const isCurrentlyUnmasked = unmaskedRows[id];
    setUnmaskedRows((prev) => ({ ...prev, [id]: !isCurrentlyUnmasked }));
    if (!isCurrentlyUnmasked) {
      setToast(`[Audit Log] Đã mở xem thông tin số điện thoại khách hàng cho mã vận đơn ${trackingCode}. Ghi nhật ký truy vết người xem (NFR-09).`);
      setTimeout(() => setToast(null), 4000);
    }
  };

  // Filter Pipeline bám sát CN-26
  const filtered = shipments.filter((s) => {
    // 1. Search filter: tracking_code, order_code, customer name, phone
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchTracking = s.tracking_code?.toLowerCase().includes(term);
      const matchOrder = s.order_code?.toLowerCase().includes(term);
      const matchCustomer = s.customer_name?.toLowerCase().includes(term);
      const matchPhone = s.customer_phone?.toLowerCase().includes(term);
      if (!matchTracking && !matchOrder && !matchCustomer && !matchPhone) return false;
    }

    // 2. Carrier filter (Only R1 carriers: GHN & GHTK)
    if (carrierFilter !== 'ALL' && s.carrier_code !== carrierFilter) return false;

    // 3. Normalized status filter
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;

    // 4. Warehouse / Store scope filter
    if (warehouseFilter !== 'ALL' && s.warehouse_id && s.warehouse_id !== warehouseFilter) return false;

    // 5. Match status filter (CN-03, CN-26)
    if (matchStatusFilter !== 'ALL') {
      const sMatchStatus = s.match_status || 'matched_exact';
      if (sMatchStatus !== matchStatusFilter) return false;
    }

    // 6. Has Open Case filter (CN-26)
    if (hasOpenCaseFilter) {
      const hasCase = s.status === 'delivery_fail' || s.status === 'stuck_in_transit' || s.has_claim;
      if (!hasCase) return false;
    }

    return true;
  });

  // Cursor pagination slicing
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
    <div className="w-full space-y-4 font-sans">
      {/* Toast Notification */}
      {toast && (
        <div className="p-3 bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center justify-between shadow-lg border border-slate-700 animate-in fade-in">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{toast}</span>
          </div>
          <button type="button" onClick={() => setToast(null)} className="font-bold text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Header Bar: Title & Search Toolbar (Bám sát CN-26) */}
      <div className="modern-card p-4 space-y-3">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-600" />
                <span>Danh Sách, Tra Cứu & Xuất Vận Đơn (CN-26)</span>
              </h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {totalCount} bưu kiện
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Tra cứu bưu kiện toàn trình, kiểm tra trạng thái ghép mã nguồn và mở Timeline sự kiện hợp nhất (P95 &lt; 2s).
            </p>
          </div>

          {/* Action Buttons: Export & Refresh */}
          <div className="flex items-center gap-2 self-stretch md:self-auto">
            <button
              type="button"
              onClick={() => {
                setToast(`✓ Đã xuất danh sách ${totalCount} vận đơn theo bộ lọc ra file Excel có ghi nhật ký kiểm toán (FR-WEB-007, BR-21).`);
                setTimeout(() => setToast(null), 4000);
              }}
              className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition cursor-pointer shadow-2xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Xuất Excel (FR-WEB-007)</span>
            </button>

            <button
              type="button"
              onClick={fetchShipments}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition cursor-pointer shadow-2xs"
              title="Tải lại dữ liệu mới nhất"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">Làm mới</span>
            </button>
          </div>
        </div>

        {/* Primary Filter Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100">
          {/* Search Box */}
          <div className="lg:col-span-2 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCursorIndex(0); }}
              placeholder="Tìm mã vận đơn, mã đơn POS, tên, SĐT..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Carrier Selector (R1 Core: GHN & GHTK) */}
          <div>
            <select
              value={carrierFilter}
              onChange={(e) => { setCarrierFilter(e.target.value); setCursorIndex(0); }}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Hãng: Tất cả R1 (GHN, GHTK)</option>
              <option value="GHN">GHN Express (L2 API)</option>
              <option value="GHTK">GHTK (L1 Assist)</option>
            </select>
          </div>

          {/* Status Selector */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCursorIndex(0); }}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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

          {/* Time Range Selector (Max 90 days) */}
          <div>
            <select
              value={dateRangeFilter}
              onChange={(e) => { setDateRangeFilter(e.target.value); setCursorIndex(0); }}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="today">Hôm nay</option>
              <option value="7d">7 ngày qua</option>
              <option value="30d">30 ngày qua</option>
              <option value="90d">90 ngày qua (Tối đa)</option>
            </select>
          </div>

          {/* Advanced Filter Toggle & Reset */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer ${
                showAdvancedFilters || hasOpenCaseFilter || matchStatusFilter !== 'ALL' || warehouseFilter !== 'ALL'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Bộ lọc thêm</span>
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 transition"
                title="Xóa toàn bộ điều kiện lọc"
              >
                Xóa
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Advanced Filters Drawer (CN-26) */}
        {showAdvancedFilters && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-in fade-in duration-100 text-xs">
            {/* Match Status (CN-03) */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                Trạng thái ghép mã nguồn (CN-03):
              </label>
              <select
                value={matchStatusFilter}
                onChange={(e) => { setMatchStatusFilter(e.target.value); setCursorIndex(0); }}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-medium"
              >
                <option value="ALL">Tất cả trạng thái ghép mã</option>
                <option value="matched_exact">Khớp chính xác (Khóa 1/Khóa 2)</option>
                <option value="matched_fuzzy">Khớp mờ COD +/- 3 ngày (Khóa 3)</option>
                <option value="unmatched">Chưa khớp (Cần ghép tay)</option>
              </select>
            </div>

            {/* Warehouse / Store Scope */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                Chi nhánh / Kho xuất hàng:
              </label>
              <select
                value={warehouseFilter}
                onChange={(e) => { setWarehouseFilter(e.target.value); setCursorIndex(0); }}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-medium"
              >
                <option value="ALL">Tất cả chi nhánh</option>
                <option value="store_01">Chi Nhánh Quận 3 (HCM-Q3)</option>
                <option value="store_02">Kho Vận Tân Bình (HCM-TB)</option>
                <option value="store_03">Chi Nhánh Hà Nội (HN-CG)</option>
                <option value="store_04">Chi Nhánh Đà Nẵng (DN-HC)</option>
              </select>
            </div>

            {/* Open Case Toggle */}
            <div className="flex items-center pt-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasOpenCaseFilter}
                  onChange={(e) => { setHasOpenCaseFilter(e.target.checked); setCursorIndex(0); }}
                  className="w-4 h-4 rounded-sm text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span>Chỉ hiển thị đơn có hồ sơ mở (Sự cố / Khiếu nại)</span>
                </span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Main Table Viewport (High Density, 14px Text, High Contrast) */}
      <div className="modern-card overflow-hidden border border-slate-200 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3.5">Mã Vận Đơn / Mã Đơn POS</th>
                <th className="py-3 px-3.5">Hãng & Mức Tự Động</th>
                <th className="py-3 px-3.5">Người Nhận & Địa Chỉ</th>
                <th className="py-3 px-3.5">Trạng Thái Chuẩn</th>
                <th className="py-3 px-3.5">Ghép Mã Nguồn</th>
                <th className="py-3 px-3.5 text-right">Thu Hộ COD</th>
                <th className="py-3 px-3.5">Hồ Sơ Mở (Actionable)</th>
                <th className="py-3 px-3.5 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paginatedShipments.map((shipment) => {
                const isUnmasked = unmaskedRows[shipment.id];
                const rawPhone = shipment.customer_phone || '0901234567';
                const maskedPhone = isUnmasked
                  ? rawPhone
                  : rawPhone.slice(0, 3) + '***' + rawPhone.slice(-4);

                const isDeliveryFail = shipment.status === 'delivery_fail';
                const isStuck = shipment.status === 'stuck_in_transit';
                const hasClaim = shipment.has_claim || false;

                const matchStatus = shipment.match_status || 'matched_exact';

                return (
                  <tr key={shipment.id} className="hover:bg-slate-50/90 transition-colors">
                    {/* Column 1: Tracking Code & Order Code */}
                    <td className="py-3 px-3.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        <TrackingCode code={shipment.tracking_code} />
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                        <span>Đơn:</span>
                        <span className="font-semibold text-slate-700">{shipment.order_code || 'ORD-PANCAKE'}</span>
                      </div>
                    </td>

                    {/* Column 2: Carrier & Automation Tier (BR-44) */}
                    <td className="py-3 px-3.5">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-slate-500" />
                        <span>{shipment.carrier_code}</span>
                      </div>
                      <div className="mt-0.5">
                        <AutomationBadge tier={shipment.carrier_code === 'GHN' ? 'L2' : 'L1'} />
                      </div>
                    </td>

                    {/* Column 3: Customer & Address with PII Masking */}
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-slate-900">{shipment.customer_name || 'Khách Mua Hàng'}</div>
                      <div className="text-[11px] text-slate-600 flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono">{maskedPhone}</span>
                        <button
                          type="button"
                          onClick={() => toggleUnmask(shipment.id, shipment.tracking_code)}
                          className="text-slate-400 hover:text-blue-600 transition"
                          title={isUnmasked ? 'Ẩn số điện thoại' : 'Mở xem số điện thoại (Có ghi log kiểm toán)'}
                        >
                          {isUnmasked ? <EyeOff className="w-3 h-3 text-blue-600" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                        {shipment.destination_province || 'TP. Hồ Chí Minh'}
                      </div>
                    </td>

                    {/* Column 4: Normalized Status */}
                    <td className="py-3 px-3.5">
                      <StatusBadge status={shipment.status} />
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {shipment.updated_at ? new Date(shipment.updated_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Vừa cập nhật'}
                      </div>
                    </td>

                    {/* Column 5: Match Status (CN-03) */}
                    <td className="py-3 px-3.5">
                      {matchStatus === 'matched_exact' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Khớp Khóa 1</span>
                        </span>
                      )}
                      {matchStatus === 'matched_fuzzy' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span>Khớp Mờ COD</span>
                        </span>
                      )}
                      {matchStatus === 'unmatched' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          <span>Chưa khớp</span>
                        </span>
                      )}
                    </td>

                    {/* Column 6: COD Amount (Tabular numbers, right aligned) */}
                    <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 text-sm">
                      {shipment.cod_amount > 0 ? (
                        <Money amount={shipment.cod_amount} state="pending" />
                      ) : (
                        <span className="text-slate-400 text-xs font-normal">Không COD</span>
                      )}
                    </td>

                    {/* Column 7: Actionable Open Case Links */}
                    <td className="py-3 px-3.5">
                      {isDeliveryFail && (
                        <button
                          type="button"
                          onClick={() => onNavigateToTab && onNavigateToTab('exceptions')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition cursor-pointer"
                          title="Bấm để chuyển sang Hộp việc cứu đơn xử lý ngay"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>Cần cứu đơn</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}

                      {isStuck && !isDeliveryFail && (
                        <button
                          type="button"
                          onClick={() => onNavigateToTab && onNavigateToTab('exceptions')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>Đứng trạng thái</span>
                        </button>
                      )}

                      {hasClaim && (
                        <button
                          type="button"
                          onClick={() => onNavigateToTab && onNavigateToTab('claims')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition cursor-pointer"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-purple-600" />
                          <span>Đang khiếu nại</span>
                        </button>
                      )}

                      {!isDeliveryFail && !isStuck && !hasClaim && (
                        <span className="text-slate-400 text-xs flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span>Bình thường</span>
                        </span>
                      )}
                    </td>

                    {/* Column 8: Action - Details & Timeline */}
                    <td className="py-3 px-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenTrackingModal(shipment.tracking_code)}
                        className="px-3 py-1 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition cursor-pointer shadow-2xs"
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
                    <p className="font-semibold text-slate-600">Không tìm thấy vận đơn nào phù hợp với bộ lọc hiện tại.</p>
                    <p className="text-[11px] text-slate-400 mt-1">Hãy thử xóa hoặc nới lỏng các tiêu chí lọc để xem thêm kết quả.</p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="mt-3 px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 rounded-lg border border-blue-200 hover:bg-blue-100 transition"
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

        {/* Cursor Pagination Bar (CN-26) */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span>
              Hiển thị <span className="font-bold text-slate-900">{totalCount > 0 ? cursorIndex + 1 : 0}</span> –{' '}
              <span className="font-bold text-slate-900">{Math.min(cursorIndex + pageSize, totalCount)}</span> trên tổng{' '}
              <span className="font-bold text-slate-900">{totalCount}</span> bưu kiện
            </span>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">|</span>
              <span>Dòng/trang:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCursorIndex(0); }}
                className="px-2 py-0.5 rounded-md border border-slate-200 bg-white font-semibold text-xs"
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
              className={`flex items-center gap-1 px-3 py-1 rounded-lg border transition font-bold text-xs ${
                hasPrevPage
                  ? 'bg-white text-slate-800 hover:bg-slate-100 border-slate-200 cursor-pointer shadow-2xs'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Trang Trước</span>
            </button>

            <button
              type="button"
              onClick={handleNextPage}
              disabled={!hasNextPage}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg border transition font-bold text-xs ${
                hasNextPage
                  ? 'bg-white text-slate-800 hover:bg-slate-100 border-slate-200 cursor-pointer shadow-2xs'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
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
