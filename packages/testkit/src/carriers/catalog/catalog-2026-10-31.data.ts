import { CarrierCodeEnum } from '@prisma/client';

export const CATALOG_REVISION_2026_10_31 = 'CATALOG-2026-10-31';

export interface CarrierSeedItem {
  id: string;
  catalog_revision: string;
  code: CarrierCodeEnum;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  evidence_level: string;
  description: string;
}

export interface CarrierServiceSeedItem {
  id: string;
  carrier_id: string;
  catalog_revision: string;
  carrier_code: CarrierCodeEnum;
  code: string;
  name: string;
  service_type: 'STANDARD' | 'FAST';
  description: string;
  is_active: boolean;
  evidence_level: string;
  source_revision: string;
}

export interface CanonicalStatusSeedItem {
  id: string;
  catalog_revision: string;
  code: string;
  category:
    'COMMAND' | 'OPERATIONAL_PRE_TRANSIT' | 'OPERATIONAL_IN_TRANSIT' | 'OPERATIONAL_TERMINAL';
  label: string;
  description: string;
  stage_order: number;
}

export interface FeeComponentSeedItem {
  id: string;
  catalog_revision: string;
  code: string;
  name: string;
  category: 'BASE' | 'SURCHARGE' | 'COD' | 'INSURANCE' | 'RETURN' | 'VAT';
  description: string;
  is_refundable: boolean;
  vat_applicable: boolean;
}

export interface CatalogCompatibilityMappingSeedItem {
  id: string;
  catalog_revision: string;
  carrier_code: CarrierCodeEnum | null;
  domain: 'CARRIER_ALIAS' | 'STATUS' | 'FEE';
  raw_key: string;
  canonical_code: string | null;
  disposition: 'MAPPED' | 'UNMAPPED';
}

export const SEED_CARRIERS: CarrierSeedItem[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: CarrierCodeEnum.GHN,
    name: 'Giao Hàng Nhanh',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description:
      'Official public API surface recorded in docs/product-spec/docs/05-api-integrations/GHN.md. Catalog membership is not an account grant.',
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: CarrierCodeEnum.GHTK,
    name: 'Giao Hàng Tiết Kiệm',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description:
      'Official public OpenAPI surface recorded in docs/product-spec/docs/05-api-integrations/GHTK.md. Catalog membership is not an account grant.',
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: CarrierCodeEnum.VIETTEL_POST,
    name: 'Viettel Post',
    logo_url: null,
    is_active: true,
    evidence_level: 'CONFIRMATION_REQUIRED',
    description: 'Partner confirmation required (OI-001). Reference identity only.',
  },
  {
    id: 'c0000000-0000-0000-0000-000000000004',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: CarrierCodeEnum.JT,
    name: 'J&T Express Vietnam',
    logo_url: null,
    is_active: true,
    evidence_level: 'CONFIRMATION_REQUIRED',
    description: 'Partner confirmation required (OI-002). Reference identity only.',
  },
];

export const SEED_CARRIER_SERVICES: CarrierServiceSeedItem[] = [
  {
    id: 'd0000000-0000-0000-0000-000000000001',
    carrier_id: 'c0000000-0000-0000-0000-000000000001',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    code: 'GHN_STANDARD',
    name: 'GHN tiêu chuẩn',
    service_type: 'STANDARD',
    evidence_level: 'VERIFIED_OFFICIAL',
    source_revision: 'GHN-PUBLIC-API-2026-08-24',
    description:
      'Reference bucket for GHN available-service results whose delivery class is standard. Not a pinned GHN service_id.',
    is_active: true,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000002',
    carrier_id: 'c0000000-0000-0000-0000-000000000001',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    code: 'GHN_FAST',
    name: 'GHN hoả tốc',
    service_type: 'FAST',
    evidence_level: 'VERIFIED_OFFICIAL',
    source_revision: 'GHN-PUBLIC-API-2026-08-24',
    description:
      'Reference bucket for GHN available-service results whose delivery class is express. Not a pinned GHN service_id.',
    is_active: true,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000003',
    carrier_id: 'c0000000-0000-0000-0000-000000000002',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    code: 'GHTK_STANDARD',
    name: 'GHTK tiết kiệm',
    service_type: 'STANDARD',
    evidence_level: 'VERIFIED_OFFICIAL',
    source_revision: 'GHTK-OPENAPI-2026-08-24',
    description:
      'Reference bucket for GHTK solution/service-list results whose class is standard. Not a pinned GHTK solution id.',
    is_active: true,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000004',
    carrier_id: 'c0000000-0000-0000-0000-000000000002',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    code: 'GHTK_FAST',
    name: 'GHTK nhanh',
    service_type: 'FAST',
    evidence_level: 'VERIFIED_OFFICIAL',
    source_revision: 'GHTK-OPENAPI-2026-08-24',
    description:
      'Reference bucket for GHTK solution/service-list results whose class is express. Not a pinned GHTK solution id.',
    is_active: true,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000005',
    carrier_id: 'c0000000-0000-0000-0000-000000000003',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.VIETTEL_POST,
    code: 'VTP_STANDARD',
    name: 'Viettel Post tiêu chuẩn',
    service_type: 'STANDARD',
    evidence_level: 'CONFIRMATION_REQUIRED',
    source_revision: 'OI-001-UNCONFIRMED',
    description:
      'Placeholder identity pending partner service master. Do not call a Viettel Post API to fill it.',
    is_active: true,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000006',
    carrier_id: 'c0000000-0000-0000-0000-000000000003',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.VIETTEL_POST,
    code: 'VTP_FAST',
    name: 'Viettel Post hoả tốc',
    service_type: 'FAST',
    evidence_level: 'CONFIRMATION_REQUIRED',
    source_revision: 'OI-001-UNCONFIRMED',
    description:
      'Placeholder identity pending partner service master. Do not call a Viettel Post API to fill it.',
    is_active: true,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000007',
    carrier_id: 'c0000000-0000-0000-0000-000000000004',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.JT,
    code: 'JT_STANDARD',
    name: 'J&T tiêu chuẩn',
    service_type: 'STANDARD',
    evidence_level: 'CONFIRMATION_REQUIRED',
    source_revision: 'OI-002-UNCONFIRMED',
    description:
      "Placeholder identity pending Vietnam partner service master. Do not copy another country's J&T service id.",
    is_active: true,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000008',
    carrier_id: 'c0000000-0000-0000-0000-000000000004',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.JT,
    code: 'JT_FAST',
    name: 'J&T nhanh',
    service_type: 'FAST',
    evidence_level: 'CONFIRMATION_REQUIRED',
    source_revision: 'OI-002-UNCONFIRMED',
    description:
      "Placeholder identity pending Vietnam partner service master. Do not copy another country's J&T service id.",
    is_active: true,
  },
];

export const SEED_CANONICAL_STATUSES: CanonicalStatusSeedItem[] = [
  // Command category
  {
    id: 'e0000000-0000-0000-0000-000000000001',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'CREATING',
    category: 'COMMAND',
    stage_order: 10,
    label: 'Đang tạo vận đơn',
    description: 'Đang tạo vận đơn: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000002',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'CREATED',
    category: 'COMMAND',
    stage_order: 20,
    label: 'Đã tạo vận đơn',
    description: 'Đã tạo vận đơn: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000003',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'CREATE_FAILED',
    category: 'COMMAND',
    stage_order: 30,
    label: 'Tạo vận đơn thất bại',
    description: 'Tạo vận đơn thất bại: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000004',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'CREATE_OUTCOME_UNKNOWN',
    category: 'COMMAND',
    stage_order: 40,
    label: 'Chưa xác định kết quả tạo',
    description: 'Chưa xác định kết quả tạo: canonical shipment status. Not a provider raw status.',
  },

  // Operational Pre-Transit
  {
    id: 'e0000000-0000-0000-0000-000000000005',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'DRAFT',
    category: 'OPERATIONAL_PRE_TRANSIT',
    stage_order: 110,
    label: 'Nháp',
    description: 'Nháp: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000006',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'READY_TO_PICK',
    category: 'OPERATIONAL_PRE_TRANSIT',
    stage_order: 120,
    label: 'Sẵn sàng lấy',
    description: 'Sẵn sàng lấy: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000007',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'PICKING',
    category: 'OPERATIONAL_PRE_TRANSIT',
    stage_order: 130,
    label: 'Đang lấy',
    description: 'Đang lấy: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000008',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'PICKED',
    category: 'OPERATIONAL_PRE_TRANSIT',
    stage_order: 140,
    label: 'Đã lấy',
    description: 'Đã lấy: canonical shipment status. Not a provider raw status.',
  },

  // Operational In-Transit
  {
    id: 'e0000000-0000-0000-0000-000000000009',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'IN_TRANSIT',
    category: 'OPERATIONAL_IN_TRANSIT',
    stage_order: 210,
    label: 'Đang luân chuyển',
    description: 'Đang luân chuyển: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000010',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'OUT_FOR_DELIVERY',
    category: 'OPERATIONAL_IN_TRANSIT',
    stage_order: 220,
    label: 'Đang giao',
    description: 'Đang giao: canonical shipment status. Not a provider raw status.',
  },

  // Operational Terminal
  {
    id: 'e0000000-0000-0000-0000-000000000011',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'DELIVERY_FAILED',
    category: 'OPERATIONAL_TERMINAL',
    stage_order: 310,
    label: 'Giao thất bại',
    description: 'Giao thất bại: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000012',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'RETURNING',
    category: 'OPERATIONAL_TERMINAL',
    stage_order: 320,
    label: 'Đang hoàn',
    description: 'Đang hoàn: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000013',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'RETURNED',
    category: 'OPERATIONAL_TERMINAL',
    stage_order: 330,
    label: 'Đã hoàn',
    description: 'Đã hoàn: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000014',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'DELIVERED',
    category: 'OPERATIONAL_TERMINAL',
    stage_order: 340,
    label: 'Đã giao',
    description: 'Đã giao: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000015',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'CANCELLED',
    category: 'OPERATIONAL_TERMINAL',
    stage_order: 350,
    label: 'Đã huỷ',
    description: 'Đã huỷ: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000016',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'LOST',
    category: 'OPERATIONAL_TERMINAL',
    stage_order: 360,
    label: 'Thất lạc',
    description: 'Thất lạc: canonical shipment status. Not a provider raw status.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000017',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'DAMAGED',
    category: 'OPERATIONAL_TERMINAL',
    stage_order: 370,
    label: 'Hư hỏng',
    description: 'Hư hỏng: canonical shipment status. Not a provider raw status.',
  },
];

export const SEED_FEE_COMPONENTS: FeeComponentSeedItem[] = [
  {
    id: 'f0000000-0000-0000-0000-000000000001',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'BASE_FREIGHT',
    name: 'Cước chính',
    category: 'BASE',
    is_refundable: true,
    vat_applicable: true,
    description: 'Core transport charge before surcharges and tax.',
  },
  {
    id: 'f0000000-0000-0000-0000-000000000002',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'SURCHARGE',
    name: 'Phụ phí',
    category: 'SURCHARGE',
    is_refundable: true,
    vat_applicable: true,
    description: 'Catch-all surcharge that has no narrower approved key.',
  },
  {
    id: 'f0000000-0000-0000-0000-000000000003',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'REMOTE_AREA_SURCHARGE',
    name: 'Phụ phí vùng xa',
    category: 'SURCHARGE',
    is_refundable: true,
    vat_applicable: true,
    description: 'Remote-area surcharge. Not part of BASE_FREIGHT.',
  },
  {
    id: 'f0000000-0000-0000-0000-000000000004',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'COD_FEE',
    name: 'Phí thu hộ',
    category: 'COD',
    is_refundable: true,
    vat_applicable: true,
    description: 'Carrier fee for collecting COD. Not the COD principal.',
  },
  {
    id: 'f0000000-0000-0000-0000-000000000005',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'INSURANCE_FEE',
    name: 'Phí bảo hiểm',
    category: 'INSURANCE',
    is_refundable: true,
    vat_applicable: true,
    description: 'Declared-value insurance charge.',
  },
  {
    id: 'f0000000-0000-0000-0000-000000000006',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'RETURN_FEE',
    name: 'Phí hoàn',
    category: 'RETURN',
    is_refundable: false,
    vat_applicable: true,
    description: 'Return-shipping charge. Not refundable in this revision.',
  },
  {
    id: 'f0000000-0000-0000-0000-000000000007',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'OTHER_FEE',
    name: 'Phí khác',
    category: 'SURCHARGE',
    is_refundable: true,
    vat_applicable: true,
    description: 'Provider component recognised as a fee but not classified more narrowly.',
  },
  {
    id: 'f0000000-0000-0000-0000-000000000008',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    code: 'VAT',
    name: 'Thuế GTGT',
    category: 'VAT',
    is_refundable: false,
    vat_applicable: false,
    description: 'VAT amount line. Not itself a VAT base. Never store a VAT rate here.',
  },
];

export const SEED_COMPATIBILITY_MAPPINGS: CatalogCompatibilityMappingSeedItem[] = [
  // CARRIER_ALIAS domain (carrier_code: null)
  {
    id: 'ba000000-0000-0000-0000-000000000001',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'CARRIER_ALIAS',
    raw_key: 'VTP',
    canonical_code: 'VIETTEL_POST',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000002',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'CARRIER_ALIAS',
    raw_key: 'JT_EXPRESS',
    canonical_code: 'JT',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000003',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'CARRIER_ALIAS',
    raw_key: 'GHN',
    canonical_code: 'GHN',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000004',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'CARRIER_ALIAS',
    raw_key: 'GHTK',
    canonical_code: 'GHTK',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000005',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'CARRIER_ALIAS',
    raw_key: 'VIETTEL_POST',
    canonical_code: 'VIETTEL_POST',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000006',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'CARRIER_ALIAS',
    raw_key: 'JT',
    canonical_code: 'JT',
    disposition: 'MAPPED',
  },

  // GHN STATUS domain
  {
    id: 'ba000000-0000-0000-0000-000000000007',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'ready_to_pick',
    canonical_code: 'READY_TO_PICK',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000008',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'picking',
    canonical_code: 'PICKING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000009',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'money_collect_picking',
    canonical_code: 'PICKING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000010',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'picked',
    canonical_code: 'PICKED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000011',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'storing',
    canonical_code: 'IN_TRANSIT',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000012',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'sorting',
    canonical_code: 'IN_TRANSIT',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000013',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'transporting',
    canonical_code: 'IN_TRANSIT',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000014',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'delivering',
    canonical_code: 'OUT_FOR_DELIVERY',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000015',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'money_collect_delivering',
    canonical_code: 'OUT_FOR_DELIVERY',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000016',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'delivered',
    canonical_code: 'DELIVERED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000017',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'delivery_fail',
    canonical_code: 'DELIVERY_FAILED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000018',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'waiting_to_return',
    canonical_code: 'RETURNING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000019',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'return',
    canonical_code: 'RETURNING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000020',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'returned',
    canonical_code: 'RETURNED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000021',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'cancel',
    canonical_code: 'CANCELLED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000022',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'lost',
    canonical_code: 'LOST',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000023',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHN,
    domain: 'STATUS',
    raw_key: 'damage',
    canonical_code: 'DAMAGED',
    disposition: 'MAPPED',
  },

  // GHTK STATUS domain
  {
    id: 'ba000000-0000-0000-0000-000000000024',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '1',
    canonical_code: 'READY_TO_PICK',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000025',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '2',
    canonical_code: 'PICKING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000026',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '3',
    canonical_code: 'IN_TRANSIT',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000027',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '4',
    canonical_code: 'OUT_FOR_DELIVERY',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000028',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '5',
    canonical_code: 'DELIVERED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000029',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '6',
    canonical_code: 'DELIVERED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000030',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '7',
    canonical_code: 'DELIVERY_FAILED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000031',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '8',
    canonical_code: 'DELIVERY_FAILED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000032',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '9',
    canonical_code: 'DELIVERY_FAILED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000033',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '10',
    canonical_code: 'RETURNING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000034',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '11',
    canonical_code: 'RETURNING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000035',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '12',
    canonical_code: 'IN_TRANSIT',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000036',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '13',
    canonical_code: null,
    disposition: 'UNMAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000037',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '20',
    canonical_code: 'RETURNING',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000038',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '21',
    canonical_code: 'RETURNED',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000039',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: CarrierCodeEnum.GHTK,
    domain: 'STATUS',
    raw_key: '-1',
    canonical_code: 'CANCELLED',
    disposition: 'MAPPED',
  },

  // FEE domain (carrier_code: null)
  {
    id: 'ba000000-0000-0000-0000-000000000040',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'BASE_FREIGHT',
    canonical_code: 'BASE_FREIGHT',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000041',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'SURCHARGE',
    canonical_code: 'SURCHARGE',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000042',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'REMOTE_AREA_SURCHARGE',
    canonical_code: 'REMOTE_AREA_SURCHARGE',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000043',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'COD_FEE',
    canonical_code: 'COD_FEE',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000044',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'INSURANCE_FEE',
    canonical_code: 'INSURANCE_FEE',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000045',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'RETURN_FEE',
    canonical_code: 'RETURN_FEE',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000046',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'OTHER_FEE',
    canonical_code: 'OTHER_FEE',
    disposition: 'MAPPED',
  },
  {
    id: 'ba000000-0000-0000-0000-000000000047',
    catalog_revision: CATALOG_REVISION_2026_10_31,
    carrier_code: null,
    domain: 'FEE',
    raw_key: 'VAT',
    canonical_code: 'VAT',
    disposition: 'MAPPED',
  },
];
