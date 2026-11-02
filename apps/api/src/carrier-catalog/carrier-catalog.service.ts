import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CarrierCodeEnum } from '@prisma/client';
import { CATALOG_REVISION, CARRIER_BOUNDARY_ALIASES, CarrierCode } from '@shipde/contracts';
import { CanonicalApiException } from '../auth/auth.service';
import {
  CarrierResponse,
  CarrierDetailResponse,
  CarrierListResponse,
  CarrierDetailResponseEnvelope,
  CanonicalStatusResponse,
  CanonicalStatusListResponse,
  FeeComponentResponse,
  FeeComponentListResponse,
  CompatibilityMappingResponse,
  CompatibilityMappingListResponse,
} from './carrier-catalog.dto';

const CARRIER_SORT_ORDER: Record<string, number> = {
  GHN: 1,
  GHTK: 2,
  VIETTEL_POST: 3,
  JT: 4,
};

const FEE_SORT_ORDER: Record<string, number> = {
  BASE_FREIGHT: 1,
  SURCHARGE: 2,
  REMOTE_AREA_SURCHARGE: 3,
  COD_FEE: 4,
  INSURANCE_FEE: 5,
  RETURN_FEE: 6,
  OTHER_FEE: 7,
  VAT: 8,
};

@Injectable()
export class CarrierCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * List platform carriers in canonical revision CATALOG-2026-10-31.
   * Optional is_active filter. Order matches the approved pinned dataset.
   */
  async listCarriers(isActive?: boolean): Promise<CarrierListResponse> {
    const carriers = await this.prisma.carrier.findMany({
      where: {
        catalogRevision: CATALOG_REVISION,
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    const sorted = [...carriers].sort(
      (a, b) => (CARRIER_SORT_ORDER[a.code] || 99) - (CARRIER_SORT_ORDER[b.code] || 99)
    );

    const data: CarrierResponse[] = sorted.map((c) => ({
      id: c.id,
      code: c.code as CarrierCode,
      name: c.name,
      logo_url: c.logoUrl,
      is_active: c.isActive,
      evidence_level: c.evidenceLevel,
      description: c.description,
      catalog_revision: c.catalogRevision,
    }));

    return {
      catalog_revision: CATALOG_REVISION,
      data,
    };
  }

  /**
   * Get carrier details by canonical code or supported legacy alias.
   * Normalizes VTP -> VIETTEL_POST and JT_EXPRESS -> JT with case-sensitive matching.
   * Unrecognized codes throw canonical 404 RESOURCE_NOT_FOUND.
   */
  async getCarrierDetail(code: string): Promise<CarrierDetailResponseEnvelope> {
    if (!code || typeof code !== 'string') {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'RESOURCE_NOT_FOUND',
        'Không tìm thấy hãng vận chuyển với mã đã cung cấp'
      );
    }

    // Exact case-sensitive alias or canonical code resolution
    const canonicalCode = CARRIER_BOUNDARY_ALIASES[code];
    if (!canonicalCode) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'RESOURCE_NOT_FOUND',
        'Không tìm thấy hãng vận chuyển với mã đã cung cấp'
      );
    }

    const carrier = await this.prisma.carrier.findUnique({
      where: {
        catalogRevision_code: {
          catalogRevision: CATALOG_REVISION,
          code: canonicalCode as CarrierCodeEnum,
        },
      },
      include: {
        services: true,
      },
    });

    if (!carrier) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'RESOURCE_NOT_FOUND',
        'Không tìm thấy hãng vận chuyển với mã đã cung cấp'
      );
    }

    // Sort services: STANDARD first, FAST second
    const sortedServices = [...carrier.services].sort((a, b) => {
      if (a.serviceType === b.serviceType) {
        return a.code.localeCompare(b.code);
      }
      return a.serviceType === 'STANDARD' ? -1 : 1;
    });

    const detail: CarrierDetailResponse = {
      id: carrier.id,
      code: carrier.code as CarrierCode,
      name: carrier.name,
      logo_url: carrier.logoUrl,
      is_active: carrier.isActive,
      evidence_level: carrier.evidenceLevel,
      description: carrier.description,
      catalog_revision: carrier.catalogRevision,
      services: sortedServices.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        service_type: s.serviceType as 'STANDARD' | 'FAST',
        description: s.description,
        is_active: s.isActive,
        evidence_level: s.evidenceLevel,
        source_revision: s.sourceRevision,
      })),
    };

    return {
      catalog_revision: CATALOG_REVISION,
      data: detail,
    };
  }

  /**
   * List canonical shipment statuses distinguishing command states from operational states.
   * Sorted strictly by stage_order ASC.
   */
  async listStatuses(): Promise<CanonicalStatusListResponse> {
    const statuses = await this.prisma.canonicalStatusReference.findMany({
      where: { catalogRevision: CATALOG_REVISION },
      orderBy: { stageOrder: 'asc' },
    });

    const data: CanonicalStatusResponse[] = statuses.map((st) => ({
      code: st.code,
      category: st.category,
      label: st.label,
      description: st.description,
      stage_order: st.stageOrder,
      catalog_revision: st.catalogRevision,
    }));

    return {
      catalog_revision: CATALOG_REVISION,
      data,
    };
  }

  /**
   * List canonical fee components with categories, VAT applicability, and refundability.
   * Sorted by the pinned table order.
   */
  async listFeeComponents(): Promise<FeeComponentListResponse> {
    const feeComponents = await this.prisma.feeComponentReference.findMany({
      where: { catalogRevision: CATALOG_REVISION },
    });

    const sorted = [...feeComponents].sort(
      (a, b) => (FEE_SORT_ORDER[a.code] || 99) - (FEE_SORT_ORDER[b.code] || 99)
    );

    const data: FeeComponentResponse[] = sorted.map((fc) => ({
      code: fc.code,
      name: fc.name,
      category: fc.category,
      description: fc.description,
      is_refundable: fc.isRefundable,
      vat_applicable: fc.vatApplicable,
      catalog_revision: fc.catalogRevision,
    }));

    return {
      catalog_revision: CATALOG_REVISION,
      data,
    };
  }

  /**
   * List compatibility mappings matching optional query filters.
   * Normalizes carrier_code alias before querying. Returns 200 with empty array if no matches.
   */
  async listCompatibility(
    domain?: string,
    carrierCode?: string,
    rawKey?: string
  ): Promise<CompatibilityMappingListResponse> {
    let normalizedCarrierCode: CarrierCodeEnum | null | undefined = undefined;
    if (carrierCode !== undefined) {
      const canonical = CARRIER_BOUNDARY_ALIASES[carrierCode];
      normalizedCarrierCode = canonical
        ? (canonical as CarrierCodeEnum)
        : (carrierCode as CarrierCodeEnum);
    }

    const mappings = await this.prisma.catalogCompatibilityMapping.findMany({
      where: {
        catalogRevision: CATALOG_REVISION,
        ...(domain ? { domain } : {}),
        ...(carrierCode !== undefined ? { carrierCode: normalizedCarrierCode } : {}),
        ...(rawKey ? { rawKey } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const data: CompatibilityMappingResponse[] = mappings.map((m) => ({
      catalog_revision: m.catalogRevision,
      carrier_code: m.carrierCode ? (m.carrierCode as string) : null,
      domain: m.domain,
      raw_key: m.rawKey,
      canonical_code: m.canonicalCode,
      disposition: m.disposition,
    }));

    return {
      catalog_revision: CATALOG_REVISION,
      data,
    };
  }

  /**
   * Authoritative lookup rule (BR-CAR-05 / AC-CAR-01-06):
   * 1. Exact (catalog_revision, carrier_code, domain, raw_key) first
   * 2. If none, exact (catalog_revision, null, domain, raw_key)
   * 3. If none, result is { canonical_code: null, disposition: "UNMAPPED" }
   * Never substitute IN_TRANSIT, BASE_FREIGHT or 0.
   */
  async resolveCompatibility(
    domain: string,
    rawKey: string,
    carrierCode?: string | null
  ): Promise<CompatibilityMappingResponse> {
    let canonicalCarrier: CarrierCodeEnum | null = null;
    if (carrierCode) {
      const mapped = CARRIER_BOUNDARY_ALIASES[carrierCode];
      canonicalCarrier = mapped ? (mapped as CarrierCodeEnum) : (carrierCode as CarrierCodeEnum);
    }

    // 1. Try carrier-specific mapping first
    if (canonicalCarrier) {
      const carrierMatch = await this.prisma.catalogCompatibilityMapping.findUnique({
        where: {
          catalogRevision_carrierCode_domain_rawKey: {
            catalogRevision: CATALOG_REVISION,
            carrierCode: canonicalCarrier,
            domain,
            rawKey,
          },
        },
      });

      if (carrierMatch) {
        return {
          catalog_revision: CATALOG_REVISION,
          carrier_code: carrierMatch.carrierCode as string | null,
          domain: carrierMatch.domain,
          raw_key: carrierMatch.rawKey,
          canonical_code: carrierMatch.canonicalCode,
          disposition: carrierMatch.disposition,
        };
      }
    }

    // 2. Try carrier-independent mapping (carrier_code: null)
    // Note: composite unique with carrierCode null in Prisma can be found via findFirst
    const globalMatch = await this.prisma.catalogCompatibilityMapping.findFirst({
      where: {
        catalogRevision: CATALOG_REVISION,
        carrierCode: null,
        domain,
        rawKey,
      },
    });

    if (globalMatch) {
      return {
        catalog_revision: CATALOG_REVISION,
        carrier_code: null,
        domain: globalMatch.domain,
        raw_key: globalMatch.rawKey,
        canonical_code: globalMatch.canonicalCode,
        disposition: globalMatch.disposition,
      };
    }

    // 3. Fallback to unmapped: explicit null, never default to IN_TRANSIT or 0
    return {
      catalog_revision: CATALOG_REVISION,
      carrier_code: canonicalCarrier,
      domain,
      raw_key: rawKey,
      canonical_code: null,
      disposition: 'UNMAPPED',
    };
  }
}
