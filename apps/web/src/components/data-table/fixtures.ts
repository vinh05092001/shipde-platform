/**
 * MIT License
 *
 * Fixture dataset for Storybook / UI showcase & deterministic unit testing of
 * the sadmann7/shadcn-table server-driven data table port in Ship Dễ.
 *
 * IMPORTANT: All records in this file are explicitly marked with `isFixture: true`
 * and `[FIXTURE]` labels. They are ONLY used by the Storybook/test page
 * (`/storybook/data-table-shell`) and automated unit tests.
 */

import type { DataTableFilterField, DataTableOption } from './types';

export interface ShipmentTableFixtureRow extends Record<string, unknown> {
  id: string;
  trackingCode: string;
  orderCode: string;
  carrierId: 'GHN' | 'GHTK' | 'VIETTEL_POST' | 'JT_EXPRESS' | 'SPX';
  carrierName: string;
  status:
    | 'READY_TO_PICK'
    | 'IN_TRANSIT'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERY_FAILED'
    | 'DELIVERED'
    | 'RETURNING';
  reconciliationState: 'UNVERIFIED' | 'SUSPECTED_VARIANCE' | 'CARRIER_ACCEPTED' | 'BANK_RECEIVED';
  recipientName: string;
  destinationProvince: string;
  codAmountVnd: number;
  shippingFeeVnd: number;
  chargedWeightGrams: number;
  createdAtIso: string;
  slaWarning?: string;
  isFixture: true;
  fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]';
}

export const SHIPMENT_STATUS_FACET_OPTIONS: DataTableOption[] = [
  { label: 'Chờ lấy hàng', value: 'READY_TO_PICK' },
  { label: 'Đang trung chuyển', value: 'IN_TRANSIT' },
  { label: 'Đang giao hàng', value: 'OUT_FOR_DELIVERY' },
  { label: 'Giao thất bại (Cần xử lý)', value: 'DELIVERY_FAILED' },
  { label: 'Giao thành công', value: 'DELIVERED' },
  { label: 'Đang hoàn hàng', value: 'RETURNING' },
];

export const CARRIER_FACET_OPTIONS: DataTableOption[] = [
  { label: 'Giao Hàng Nhanh (GHN)', value: 'GHN' },
  { label: 'Giao Hàng Tiết Kiệm (GHTK)', value: 'GHTK' },
  { label: 'Viettel Post (VTP)', value: 'VIETTEL_POST' },
  { label: 'J&T Express', value: 'JT_EXPRESS' },
  { label: 'SPX Express', value: 'SPX' },
];

export const RECONCILIATION_FACET_OPTIONS: DataTableOption[] = [
  { label: 'Chưa đối soát', value: 'UNVERIFIED' },
  { label: 'Nghi ngờ lệch phí', value: 'SUSPECTED_VARIANCE' },
  { label: 'Hãng đã xác nhận', value: 'CARRIER_ACCEPTED' },
  { label: 'Đã nhận tiền ngân hàng', value: 'BANK_RECEIVED' },
];

export const SHIPMENT_TABLE_FILTER_FIELDS: DataTableFilterField<ShipmentTableFixtureRow>[] = [
  {
    id: 'search',
    label: 'Tìm mã vận đơn, mã đơn hoặc người nhận',
    placeholder: 'Tìm mã vận đơn, mã đơn, người nhận...',
    variant: 'text',
  },
  {
    id: 'status',
    label: 'Trạng thái vận đơn',
    variant: 'faceted',
    options: SHIPMENT_STATUS_FACET_OPTIONS,
  },
  {
    id: 'carrierId',
    label: 'Hãng vận chuyển',
    variant: 'faceted',
    options: CARRIER_FACET_OPTIONS,
  },
  {
    id: 'reconciliationState',
    label: 'Trạng thái đối soát',
    variant: 'faceted',
    options: RECONCILIATION_FACET_OPTIONS,
  },
];

export const SHIPMENT_TABLE_FIXTURE_ROWS: ShipmentTableFixtureRow[] = [
  {
    id: 'FIX-SHP-001',
    trackingCode: 'GHN-FIX-884012',
    orderCode: 'DH-FIX-2026-001',
    carrierId: 'GHN',
    carrierName: 'Giao Hàng Nhanh',
    status: 'DELIVERY_FAILED',
    reconciliationState: 'SUSPECTED_VARIANCE',
    recipientName: 'Nguyễn Thị Minh Thư [FIXTURE]',
    destinationProvince: 'TP. Hồ Chí Minh',
    codAmountVnd: 485000,
    shippingFeeVnd: 32000,
    chargedWeightGrams: 1200,
    createdAtIso: '2026-10-30T08:15:00.000Z',
    slaWarning: 'Quá hạn xử lý giao lại 4 giờ',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-002',
    trackingCode: 'GHTK-FIX-992104',
    orderCode: 'DH-FIX-2026-002',
    carrierId: 'GHTK',
    carrierName: 'Giao Hàng Tiết Kiệm',
    status: 'IN_TRANSIT',
    reconciliationState: 'UNVERIFIED',
    recipientName: 'Trần Quốc Bảo [FIXTURE]',
    destinationProvince: 'Hà Nội',
    codAmountVnd: 1250000,
    shippingFeeVnd: 45000,
    chargedWeightGrams: 2500,
    createdAtIso: '2026-10-30T09:20:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-003',
    trackingCode: 'VTP-FIX-771209',
    orderCode: 'DH-FIX-2026-003',
    carrierId: 'VIETTEL_POST',
    carrierName: 'Viettel Post',
    status: 'DELIVERED',
    reconciliationState: 'BANK_RECEIVED',
    recipientName: 'Lê Hoàng Nam [FIXTURE]',
    destinationProvince: 'Đà Nẵng',
    codAmountVnd: 320000,
    shippingFeeVnd: 28000,
    chargedWeightGrams: 800,
    createdAtIso: '2026-10-29T14:10:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-004',
    trackingCode: 'JTE-FIX-663190',
    orderCode: 'DH-FIX-2026-004',
    carrierId: 'JT_EXPRESS',
    carrierName: 'J&T Express',
    status: 'OUT_FOR_DELIVERY',
    reconciliationState: 'UNVERIFIED',
    recipientName: 'Phạm Thu Hà [FIXTURE]',
    destinationProvince: 'Hải Phòng',
    codAmountVnd: 790000,
    shippingFeeVnd: 35000,
    chargedWeightGrams: 1500,
    createdAtIso: '2026-10-30T11:05:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-005',
    trackingCode: 'SPX-FIX-551028',
    orderCode: 'DH-FIX-2026-005',
    carrierId: 'SPX',
    carrierName: 'SPX Express',
    status: 'READY_TO_PICK',
    reconciliationState: 'UNVERIFIED',
    recipientName: 'Võ Đăng Khoa [FIXTURE]',
    destinationProvince: 'Cần Thơ',
    codAmountVnd: 215000,
    shippingFeeVnd: 22000,
    chargedWeightGrams: 500,
    createdAtIso: '2026-10-31T07:30:00.000Z',
    slaWarning: 'Sắp tới giờ hẹn bưu tá lấy hàng',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-006',
    trackingCode: 'GHN-FIX-884089',
    orderCode: 'DH-FIX-2026-006',
    carrierId: 'GHN',
    carrierName: 'Giao Hàng Nhanh',
    status: 'RETURNING',
    reconciliationState: 'SUSPECTED_VARIANCE',
    recipientName: 'Đặng Ngọc Ánh [FIXTURE]',
    destinationProvince: 'Bình Dương',
    codAmountVnd: 0,
    shippingFeeVnd: 38000,
    chargedWeightGrams: 1800,
    createdAtIso: '2026-10-28T16:45:00.000Z',
    slaWarning: 'Hoàn hàng sau 3 lần phát không thành công',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-007',
    trackingCode: 'GHTK-FIX-992178',
    orderCode: 'DH-FIX-2026-007',
    carrierId: 'GHTK',
    carrierName: 'Giao Hàng Tiết Kiệm',
    status: 'DELIVERED',
    reconciliationState: 'CARRIER_ACCEPTED',
    recipientName: 'Bùi Thanh Tùng [FIXTURE]',
    destinationProvince: 'Đồng Nai',
    codAmountVnd: 640000,
    shippingFeeVnd: 30000,
    chargedWeightGrams: 1100,
    createdAtIso: '2026-10-29T10:00:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-008',
    trackingCode: 'VTP-FIX-771305',
    orderCode: 'DH-FIX-2026-008',
    carrierId: 'VIETTEL_POST',
    carrierName: 'Viettel Post',
    status: 'IN_TRANSIT',
    reconciliationState: 'UNVERIFIED',
    recipientName: 'Hoàng Minh Châu [FIXTURE]',
    destinationProvince: 'Khánh Hòa',
    codAmountVnd: 950000,
    shippingFeeVnd: 41000,
    chargedWeightGrams: 2100,
    createdAtIso: '2026-10-30T15:20:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-009',
    trackingCode: 'JTE-FIX-663244',
    orderCode: 'DH-FIX-2026-009',
    carrierId: 'JT_EXPRESS',
    carrierName: 'J&T Express',
    status: 'DELIVERY_FAILED',
    reconciliationState: 'SUSPECTED_VARIANCE',
    recipientName: 'Ngô Phương Linh [FIXTURE]',
    destinationProvince: 'Nghệ An',
    codAmountVnd: 530000,
    shippingFeeVnd: 36000,
    chargedWeightGrams: 1400,
    createdAtIso: '2026-10-30T17:50:00.000Z',
    slaWarning: 'Người nhận hẹn giao lại sáng mai',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-010',
    trackingCode: 'GHN-FIX-884150',
    orderCode: 'DH-FIX-2026-010',
    carrierId: 'GHN',
    carrierName: 'Giao Hàng Nhanh',
    status: 'DELIVERED',
    reconciliationState: 'BANK_RECEIVED',
    recipientName: 'Lý Gia Hân [FIXTURE]',
    destinationProvince: 'TP. Hồ Chí Minh',
    codAmountVnd: 1580000,
    shippingFeeVnd: 26000,
    chargedWeightGrams: 950,
    createdAtIso: '2026-10-27T13:15:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-011',
    trackingCode: 'SPX-FIX-551109',
    orderCode: 'DH-FIX-2026-011',
    carrierId: 'SPX',
    carrierName: 'SPX Express',
    status: 'OUT_FOR_DELIVERY',
    reconciliationState: 'UNVERIFIED',
    recipientName: 'Trương Đình Phúc [FIXTURE]',
    destinationProvince: 'Hà Nội',
    codAmountVnd: 390000,
    shippingFeeVnd: 24000,
    chargedWeightGrams: 600,
    createdAtIso: '2026-10-31T08:05:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
  {
    id: 'FIX-SHP-012',
    trackingCode: 'GHTK-FIX-992290',
    orderCode: 'DH-FIX-2026-012',
    carrierId: 'GHTK',
    carrierName: 'Giao Hàng Tiết Kiệm',
    status: 'READY_TO_PICK',
    reconciliationState: 'UNVERIFIED',
    recipientName: 'Đỗ Thanh Huyền [FIXTURE]',
    destinationProvince: 'Bắc Ninh',
    codAmountVnd: 870000,
    shippingFeeVnd: 33000,
    chargedWeightGrams: 1350,
    createdAtIso: '2026-10-31T09:10:00.000Z',
    isFixture: true,
    fixtureBannerTag: '[DỮ LIỆU MẪU / FIXTURE]',
  },
];
