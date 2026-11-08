import {
  CarrierCode,
  CarrierEvidenceLevel,
  StatusCategory,
  FeeComponentCategory,
} from '@shipde/contracts';

export type { CarrierCode, CarrierEvidenceLevel, StatusCategory, FeeComponentCategory };

export interface CarrierResponse {
  id: string;
  code: CarrierCode;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  evidence_level: CarrierEvidenceLevel;
  description: string | null;
  catalog_revision: string;
}

export interface CarrierServiceResponse {
  id: string;
  code: string;
  name: string;
  service_type: 'STANDARD' | 'FAST';
  description: string;
  is_active: boolean;
  evidence_level: CarrierEvidenceLevel;
  source_revision: string;
}

export interface CarrierDetailResponse extends CarrierResponse {
  services: CarrierServiceResponse[];
}

export interface CarrierListResponse {
  catalog_revision: string;
  data: CarrierResponse[];
}

export interface CarrierDetailResponseEnvelope {
  catalog_revision: string;
  data: CarrierDetailResponse;
}

export interface CanonicalStatusResponse {
  code: string;
  category: StatusCategory;
  label: string;
  description: string;
  stage_order: number;
  catalog_revision: string;
}

export interface CanonicalStatusListResponse {
  catalog_revision: string;
  data: CanonicalStatusResponse[];
}

export interface FeeComponentResponse {
  code: string;
  name: string;
  category: FeeComponentCategory;
  description: string;
  is_refundable: boolean;
  vat_applicable: boolean;
  catalog_revision: string;
}

export interface FeeComponentListResponse {
  catalog_revision: string;
  data: FeeComponentResponse[];
}

export interface CompatibilityMappingResponse {
  catalog_revision: string;
  carrier_code: string | null;
  domain: string;
  raw_key: string;
  canonical_code: string | null;
  disposition: string;
}

export interface CompatibilityMappingListResponse {
  catalog_revision: string;
  data: CompatibilityMappingResponse[];
}

export type CarrierCatalogUIState =
  'loading' | 'empty' | 'validation' | 'error' | 'forbidden' | 'partial' | 'success' | 'recovery';

export interface CarrierSearchFilters {
  search?: string;
  evidence_level?: CarrierEvidenceLevel | 'ALL';
  is_active?: boolean | 'ALL';
}

export const EVIDENCE_LEVEL_LABELS: Record<CarrierEvidenceLevel, string> = {
  VERIFIED_OFFICIAL: 'Đã xác thực chính thức',
  CONFIRMATION_REQUIRED: 'Cần xác nhận đối tác',
};

export const SERVICE_TYPE_LABELS: Record<'STANDARD' | 'FAST', string> = {
  STANDARD: 'Tiêu chuẩn',
  FAST: 'Nhanh / Hoả tốc',
};

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  COMMAND: 'Trạng thái lệnh (Pre-transit)',
  OPERATIONAL_PRE_TRANSIT: 'Vận hành - Trước luân chuyển',
  OPERATIONAL_IN_TRANSIT: 'Vận hành - Đang luân chuyển',
  OPERATIONAL_TERMINAL: 'Vận hành - Trạng thái cuối',
};

export const FEE_CATEGORY_LABELS: Record<FeeComponentCategory, string> = {
  BASE: 'Cước cơ bản',
  SURCHARGE: 'Phụ phí',
  COD: 'Thu hộ (COD)',
  INSURANCE: 'Bảo hiểm',
  RETURN: 'Hoàn trả',
  VAT: 'Thuế GTGT',
};

export const CARRIER_MONOGRAM_COLORS: Record<CarrierCode, string> = {
  GHN: 'bg-blue-600',
  GHTK: 'bg-green-600',
  VIETTEL_POST: 'bg-red-600',
  JT: 'bg-orange-600',
};
