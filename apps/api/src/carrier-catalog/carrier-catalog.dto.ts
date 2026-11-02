import { CarrierCodeEnum } from '@prisma/client';
import {
  CarrierCode,
  CATALOG_REVISION,
  StatusCategory,
  FeeComponentCategory,
  CompatibilityDomain,
  CompatibilityDisposition,
} from '@shipde/contracts';

export interface CarrierResponse {
  id: string;
  code: CarrierCode;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  evidence_level: string;
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
  evidence_level: string;
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
  category: string;
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
  category: string;
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
