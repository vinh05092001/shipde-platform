'use client';

import React, { useState } from 'react';
import {
  PackagePlus,
  X,
  Check,
  Truck,
  DollarSign,
  Clock,
  ShieldCheck,
  MapPin,
  Scale,
  Sparkles,
  ArrowRight,
  Info,
  Store,
} from 'lucide-react';
import { Money, AutomationBadge } from './ui/OperationalComponents';
import { MASTER_SHIPMENTS, UnifiedShipment } from '@/services/unifiedDataStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated: (newShipment: UnifiedShipment) => void;
}

export const CreateOrderModal: React.FC<Props> = ({ isOpen, onClose, onOrderCreated }) => {
  // Order information
  const [orderCode, setOrderCode] = useState(
    () => `ORD_${Math.floor(Math.random() * 89999) + 10000}`
  );
  const [pickupWarehouse, setPickupWarehouse] = useState('store_01');
  const [recipientName, setRecipientName] = useState('Nguyễn Văn Khách');
  const [recipientPhone, setRecipientPhone] = useState('0901234567');
  const [recipientProvince, setRecipientProvince] = useState<'HCM' | 'HN' | 'OTHER'>('HCM');
  const [recipientDistrict, setRecipientDistrict] = useState('Quận 3');
  const [recipientAddress, setRecipientAddress] = useState('128 Nguyễn Trãi, Phường 3');
  const [itemName, setItemName] = useState('Váy lụa thiết kế cao cấp (Size M)');

  // Package specifications
  const [weightGram, setWeightGram] = useState<number>(350);
  const [lengthCm, setLengthCm] = useState<number>(20);
  const [widthCm, setWidthCm] = useState<number>(15);
  const [heightCm, setHeightCm] = useState<number>(5);
  const [codAmount, setCodAmount] = useState<number>(450000);
  const [insuranceValue, setInsuranceValue] = useState<number>(450000);
  const [payer, setPayer] = useState<'SENDER' | 'RECEIVER'>('RECEIVER');
  const [inspectionNote, setInspectionNote] = useState<
    'CHO_XEM_HANG' | 'CHO_THU_HANG' | 'KHONG_CHO_XEM'
  >('CHO_XEM_HANG');

  // Selected Carrier
  const [selectedCarrier, setSelectedCarrier] = useState<'GHN' | 'GHTK'>('GHN');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Volumetric weight formula: (L x W x H) / 5000 * 1000 (in grams)
  const volumetricWeightGram = Math.round(((lengthCm * widthCm * heightCm) / 5000) * 1000);
  const chargeableWeightGram = Math.max(weightGram, volumetricWeightGram);

  // Dynamic Rate Comparison Engine across Connected Carriers
  const isIntraProvince = recipientProvince === 'HCM';

  const carriersComparison = [
    {
      id: 'GHN' as const,
      name: 'Giao Hàng Nhanh (GHN Express)',
      baseFee: isIntraProvince ? 22000 : 32000,
      addWeightFee:
        chargeableWeightGram > 1000 ? Math.ceil((chargeableWeightGram - 1000) / 500) * 5000 : 0,
      insuranceFee: insuranceValue > 1000000 ? Math.round(insuranceValue * 0.005) : 0,
      codFee: 0,
      deliveryTime: isIntraProvince ? 'Hỏa tốc trong 24h (Sáng mai)' : '1 - 2 ngày làm việc',
      tier: 'L2' as const,
      tierLabel: 'Tự động gọi API (L2)',
      badge: '⚡ Giao Nhanh Nhất',
      badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      logoBg: 'bg-[#FFF5F0] text-[#EA4B12]',
    },
    {
      id: 'GHTK' as const,
      name: 'Giao Hàng Tiết Kiệm (GHTK)',
      baseFee: isIntraProvince ? 24000 : 34000,
      addWeightFee:
        chargeableWeightGram > 1000 ? Math.ceil((chargeableWeightGram - 1000) / 500) * 6000 : 0,
      insuranceFee: insuranceValue > 1000000 ? Math.round(insuranceValue * 0.005) : 0,
      codFee: 0,
      deliveryTime: isIntraProvince ? '1 - 2 ngày làm việc' : '2 - 3 ngày làm việc',
      tier: 'L1' as const,
      tierLabel: 'Hỗ trợ cổng hãng (L1)',
      badge: 'Phổ Biến Tuyến Huyện',
      badgeColor: 'bg-slate-100 text-slate-700 border-slate-200',
      logoBg: 'bg-emerald-50 text-emerald-700',
    },
  ].map((c) => ({
    ...c,
    totalFee: c.baseFee + c.addWeightFee + c.insuranceFee + c.codFee,
  }));

  const activeCarrierInfo =
    carriersComparison.find((c) => c.id === selectedCarrier) || carriersComparison[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientName.trim() || !recipientPhone.trim()) {
      setErrorMsg('Vui lòng điền họ tên và số điện thoại người nhận.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const generatedTracking = `${selectedCarrier}8829${Math.floor(Math.random() * 89999) + 10000}`;
    const provinceName =
      recipientProvince === 'HCM'
        ? 'TP. Hồ Chí Minh'
        : recipientProvince === 'HN'
          ? 'Hà Nội'
          : 'Đà Nẵng';

    const newShipment: UnifiedShipment = {
      id: `shp_${Date.now()}`,
      tracking_code: generatedTracking,
      order_code: orderCode,
      carrier_code: selectedCarrier,
      carrier_account: selectedCarrier === 'GHN' ? 'acc_ghn_01' : 'acc_ghtk_01',
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      recipient_address: `${recipientAddress}, ${recipientDistrict}`,
      destination_province: provinceName,
      cod_amount: Number(codAmount),
      quoted_fee: activeCarrierInfo.totalFee,
      declared_weight_g: Number(chargeableWeightGram),
      status: 'picking',
      match_status: 'matched_exact',
      warehouse_id: pickupWarehouse,
      created_at:
        new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN'),
      updated_at:
        new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN'),
      has_open_exception: false,
      has_open_discrepancy: false,
      has_open_claim: false,
      timeline: [
        {
          title: 'Đã tạo vận đơn mới',
          description: `Đơn hàng ${orderCode} đã tạo thành công và đẩy thông tin sang hãng ${selectedCarrier}`,
          occurred_at: new Date().toLocaleTimeString('vi-VN'),
          source_label: 'Hệ thống Ship Dễ',
        },
      ],
    };

    // Prepend to Master Shipments
    MASTER_SHIPMENTS.unshift(newShipment);

    setTimeout(() => {
      setLoading(false);
      onOrderCreated(newShipment);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl text-xs animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-[#FDFCFB] flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EA4B12] text-white flex items-center justify-center shadow-xs">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-slate-900">
                  Tạo Vận Đơn Mới & So Sánh Cước Phí
                </h2>
                <span className="badge-ok text-xs">So Cước Tự Động</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhập thông tin giao hàng để hệ thống tính cước theo biểu giá hợp đồng và đẩy đơn
                sang hãng vận chuyển.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs cursor-pointer transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Body: 2-Column Split */}
        <div className="overflow-y-auto flex-1 p-4 sm:p-6 custom-scrollbar">
          {errorMsg && (
            <div className="p-3 mb-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form
            id="create-order-form"
            onSubmit={handleSubmit}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            {/* LEFT COLUMN (7 Cols): Order & Package Info */}
            <div className="lg:col-span-7 space-y-4">
              {/* Section 1: Receiver & Address */}
              <div className="space-y-3 p-4 bg-slate-50/70 rounded-xl border border-slate-200/80">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#EA4B12]" />
                    <span>1. Thông Tin Người Nhận & Nơi Giao</span>
                  </span>
                  <span className="text-xs font-mono text-slate-500 font-semibold">
                    Mã đơn: {orderCode}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Tên Người Nhận:
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Nguyễn Văn Khách"
                      className="modern-input w-full text-xs font-medium"
                      required
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Số Điện Thoại:
                    </label>
                    <input
                      type="tel"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="0901234567"
                      className="modern-input w-full font-mono text-xs font-medium"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Tỉnh / Thành Phố:
                    </label>
                    <select
                      value={recipientProvince}
                      onChange={(e: any) => setRecipientProvince(e.target.value)}
                      className="modern-input w-full font-semibold text-xs text-slate-800"
                    >
                      <option value="HCM">TP. Hồ Chí Minh (Nội Tỉnh)</option>
                      <option value="HN">Hà Nội (Liên Tỉnh)</option>
                      <option value="OTHER">Đà Nẵng / Tỉnh khác (Liên Tỉnh)</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Quận / Huyện:
                    </label>
                    <input
                      type="text"
                      value={recipientDistrict}
                      onChange={(e) => setRecipientDistrict(e.target.value)}
                      placeholder="Quận 3"
                      className="modern-input w-full text-xs font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-xs">
                    Địa Chỉ Chi Tiết (Số nhà, Tên đường, Phường):
                  </label>
                  <input
                    type="text"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder="128 Nguyễn Trãi, Phường 3"
                    className="modern-input w-full text-xs font-medium"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-xs">
                    Kho / Chi Nhánh Xuất Hàng:
                  </label>
                  <select
                    value={pickupWarehouse}
                    onChange={(e) => setPickupWarehouse(e.target.value)}
                    className="modern-input w-full font-semibold text-xs text-slate-800"
                  >
                    <option value="store_01">Chi Nhánh Quận 3 (128 Nguyễn Trãi, HCM)</option>
                    <option value="store_02">Kho Vận Tân Bình (55 CMT8, HCM)</option>
                    <option value="store_03">Chi Nhánh Hà Nội (320 Cầu Giấy)</option>
                    <option value="store_04">Chi Nhánh Đà Nẵng (102 Hoàng Văn Thụ)</option>
                  </select>
                </div>
              </div>

              {/* Section 2: Package Weight, Dimensions & COD */}
              <div className="space-y-3 p-4 bg-slate-50/70 rounded-xl border border-slate-200/80">
                <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-[#EA4B12]" />
                  <span>2. Thông Số Kiện Hàng & Thu Tiền (COD)</span>
                </span>

                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-xs">
                    Tên Sản Phẩm / Hàng Hóa:
                  </label>
                  <input
                    type="text"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="Quần áo, phụ kiện thời trang..."
                    className="modern-input w-full text-xs font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Cân Nặng (g):
                    </label>
                    <input
                      type="number"
                      value={weightGram}
                      onChange={(e) => setWeightGram(Number(e.target.value) || 0)}
                      className="modern-input w-full font-mono font-bold text-xs"
                      min={10}
                      step={50}
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">Dài (cm):</label>
                    <input
                      type="number"
                      value={lengthCm}
                      onChange={(e) => setLengthCm(Number(e.target.value) || 0)}
                      className="modern-input w-full font-mono text-xs"
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Rộng (cm):
                    </label>
                    <input
                      type="number"
                      value={widthCm}
                      onChange={(e) => setWidthCm(Number(e.target.value) || 0)}
                      className="modern-input w-full font-mono text-xs"
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">Cao (cm):</label>
                    <input
                      type="number"
                      value={heightCm}
                      onChange={(e) => setHeightCm(Number(e.target.value) || 0)}
                      className="modern-input w-full font-mono text-xs"
                      min={1}
                    />
                  </div>
                </div>

                {/* Chargeable Weight Indicator */}
                <div className="flex justify-between items-center p-2.5 bg-[#FFF5F0] rounded-lg border border-[#FDDDD0] text-xs text-slate-800">
                  <span>
                    Cân thực: <strong>{weightGram}g</strong> · Thể tích quy đổi (D×R×C/5000):{' '}
                    <strong>{volumetricWeightGram}g</strong>
                  </span>
                  <span className="font-bold text-[#EA4B12]">
                    Tính cước: {chargeableWeightGram}g
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Tiền Thu Hộ COD (VND):
                    </label>
                    <input
                      type="number"
                      value={codAmount}
                      onChange={(e) => setCodAmount(Number(e.target.value) || 0)}
                      className="modern-input w-full font-mono font-bold text-xs text-slate-900"
                      min={0}
                      step={10000}
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-xs">
                      Khai Giá Hàng Hóa:
                    </label>
                    <input
                      type="number"
                      value={insuranceValue}
                      onChange={(e) => setInsuranceValue(Number(e.target.value) || 0)}
                      className="modern-input w-full font-mono text-xs"
                      min={0}
                      step={50000}
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Delivery Options */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50/70 rounded-xl border border-slate-200/80">
                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-xs">
                    Lưu Ý Xem Hàng:
                  </label>
                  <select
                    value={inspectionNote}
                    onChange={(e: any) => setInspectionNote(e.target.value)}
                    className="modern-input w-full text-xs font-semibold"
                  >
                    <option value="CHO_XEM_HANG">Cho xem hàng không cho thử</option>
                    <option value="CHO_THU_HANG">Cho thử hàng</option>
                    <option value="KHONG_CHO_XEM">Không cho xem hàng</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-xs">
                    Người Trả Cước Phí:
                  </label>
                  <select
                    value={payer}
                    onChange={(e: any) => setPayer(e.target.value)}
                    className="modern-input w-full text-xs font-semibold"
                  >
                    <option value="RECEIVER">Người nhận trả cước</option>
                    <option value="SENDER">Người gửi trả cước (Shop)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN (5 Cols): REALTIME MULTI-CARRIER RATE COMPARISON */}
            <div className="lg:col-span-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                    <Truck className="w-4 h-4 text-[#EA4B12]" />
                    <span>So Sánh Cước Phí Theo Biểu Giá Hợp Đồng:</span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {carriersComparison.map((carrier) => {
                    const isSelected = selectedCarrier === carrier.id;

                    return (
                      <div
                        key={carrier.id}
                        onClick={() => setSelectedCarrier(carrier.id)}
                        className={`p-3.5 rounded-xl border transition cursor-pointer flex flex-col justify-between space-y-2.5 ${
                          isSelected
                            ? 'bg-[#FFF5F0] border-[#EA4B12] ring-2 ring-[#EA4B12]/20 shadow-xs'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-lg ${carrier.logoBg} flex items-center justify-center font-black text-xs shrink-0 border border-slate-200`}
                            >
                              {carrier.id}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 text-xs leading-tight">
                                {carrier.name}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  {carrier.deliveryTime}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-mono text-base font-black text-slate-900">
                              <Money amount={carrier.totalFee} state="confirmed" />
                            </div>
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded border ${carrier.badgeColor}`}
                            >
                              {carrier.badge}
                            </span>
                          </div>
                        </div>

                        {/* Fee breakdown on selected */}
                        {isSelected && (
                          <div className="pt-2 border-t border-[#FDDDD0] flex justify-between items-center text-xs text-slate-700 font-medium">
                            <span>
                              Cước gốc:{' '}
                              <Money
                                amount={carrier.baseFee}
                                state="confirmed"
                                className="inline text-xs"
                              />
                            </span>
                            <span>
                              Phụ phí:{' '}
                              <Money
                                amount={carrier.addWeightFee}
                                state="confirmed"
                                className="inline text-xs"
                              />
                            </span>
                            <AutomationBadge tier={carrier.tier} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Selected Summary Card */}
              <div className="p-5 bg-slate-900 text-white rounded-2xl space-y-4 shadow-lg">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2 text-xs">
                  <span className="text-slate-400">Hãng vận chuyển:</span>
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    {activeCarrierInfo.name}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-xs text-slate-400 uppercase tracking-wider block">
                      Cước Tạm Tính:
                    </span>
                    <div className="font-mono text-2xl font-black text-emerald-400">
                      <Money
                        amount={activeCarrierInfo.totalFee}
                        state="confirmed"
                        className="text-emerald-400 text-2xl"
                      />
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-slate-400 uppercase tracking-wider block">
                      Tiền Thu Hộ COD:
                    </span>
                    <div className="font-mono text-lg font-bold text-white">
                      <Money amount={codAmount} state="confirmed" className="text-white text-lg" />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  form="create-order-form"
                  disabled={loading}
                  className="btn-primary w-full h-11 justify-center text-xs font-bold shadow-md"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Đang tạo vận đơn & đẩy sang hãng...</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span>Xác Nhận Tạo Đơn & Đẩy Sang {selectedCarrier}</span>
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
