import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { CarrierCatalogService } from './carrier-catalog.service';
import {
  CATALOG_REVISION_2026_10_31,
  SEED_CARRIERS,
  SEED_CARRIER_SERVICES,
  SEED_CANONICAL_STATUSES,
  SEED_FEE_COMPONENTS,
  SEED_COMPATIBILITY_MAPPINGS,
} from '@shipde/testkit';
import { CarrierCodeEnum } from '@prisma/client';
import { HttpStatus } from '@nestjs/common';
import { CanonicalApiException } from '../auth/auth.service';
import {
  redactDatabaseUrl,
  buildDatabaseReadinessFailureMessage,
} from './carrier-catalog.supertest.spec';

function createMockPrismaService() {
  const carriers = SEED_CARRIERS.map((c) => ({
    id: c.id,
    catalogRevision: c.catalog_revision,
    code: c.code,
    name: c.name,
    logoUrl: c.logo_url,
    isActive: c.is_active,
    evidenceLevel: c.evidence_level,
    description: c.description,
  }));

  const carrierServices = SEED_CARRIER_SERVICES.map((s) => ({
    id: s.id,
    carrierId: s.carrier_id,
    catalogRevision: s.catalog_revision,
    carrierCode: s.carrier_code,
    code: s.code,
    name: s.name,
    serviceType: s.service_type,
    description: s.description,
    isActive: s.is_active,
    evidenceLevel: s.evidence_level,
    sourceRevision: s.source_revision,
  }));

  const canonicalStatuses = SEED_CANONICAL_STATUSES.map((st) => ({
    id: st.id,
    catalogRevision: st.catalog_revision,
    code: st.code,
    category: st.category,
    label: st.label,
    description: st.description,
    stageOrder: st.stage_order,
  }));

  const feeComponents = SEED_FEE_COMPONENTS.map((fc) => ({
    id: fc.id,
    catalogRevision: fc.catalog_revision,
    code: fc.code,
    name: fc.name,
    category: fc.category,
    description: fc.description,
    isRefundable: fc.is_refundable,
    vatApplicable: fc.vat_applicable,
  }));

  const compatibilityMappings = SEED_COMPATIBILITY_MAPPINGS.map((m) => ({
    id: m.id,
    catalogRevision: m.catalog_revision,
    carrierCode: m.carrier_code,
    domain: m.domain,
    rawKey: m.raw_key,
    canonicalCode: m.canonical_code,
    disposition: m.disposition,
  }));

  return {
    carrier: {
      findMany: async (args?: any) => {
        let result = [...carriers];
        if (args?.where) {
          if (args.where.catalogRevision) {
            result = result.filter((c) => c.catalogRevision === args.where.catalogRevision);
          }
          if (args.where.isActive !== undefined) {
            result = result.filter((c) => c.isActive === args.where.isActive);
          }
        }
        return result;
      },
      findUnique: async ({ where }: any) => {
        const { catalogRevision, code } = where.catalogRevision_code;
        const found = carriers.find(
          (c) => c.catalogRevision === catalogRevision && c.code === code
        );
        if (!found) return null;
        return {
          ...found,
          services: carrierServices.filter(
            (s) => s.catalogRevision === catalogRevision && s.carrierCode === code
          ),
        };
      },
    },
    carrierService: {
      findMany: async (args?: any) => {
        let result = [...carrierServices];
        if (args?.where?.catalogRevision) {
          result = result.filter((s) => s.catalogRevision === args.where.catalogRevision);
        }
        return result;
      },
    },
    canonicalStatusReference: {
      findMany: async (args?: any) => {
        let result = [...canonicalStatuses];
        if (args?.where?.catalogRevision) {
          result = result.filter((st) => st.catalogRevision === args.where.catalogRevision);
        }
        return result.sort((a, b) => a.stageOrder - b.stageOrder);
      },
    },
    feeComponentReference: {
      findMany: async (args?: any) => {
        let result = [...feeComponents];
        if (args?.where?.catalogRevision) {
          result = result.filter((fc) => fc.catalogRevision === args.where.catalogRevision);
        }
        return result;
      },
    },
    catalogCompatibilityMapping: {
      findMany: async (args?: any) => {
        let result = [...compatibilityMappings];
        if (args?.where) {
          if (args.where.catalogRevision) {
            result = result.filter((m) => m.catalogRevision === args.where.catalogRevision);
          }
          if (args.where.domain) {
            result = result.filter((m) => m.domain === args.where.domain);
          }
          if (args.where.carrierCode !== undefined) {
            result = result.filter((m) => m.carrierCode === args.where.carrierCode);
          }
          if (args.where.rawKey) {
            result = result.filter((m) => m.rawKey === args.where.rawKey);
          }
        }
        return result;
      },
      findUnique: async ({ where }: any) => {
        const { catalogRevision, carrierCode, domain, rawKey } =
          where.catalogRevision_carrierCode_domain_rawKey;
        return (
          compatibilityMappings.find(
            (m) =>
              m.catalogRevision === catalogRevision &&
              m.carrierCode === carrierCode &&
              m.domain === domain &&
              m.rawKey === rawKey
          ) || null
        );
      },
      findFirst: async ({ where }: any) => {
        return (
          compatibilityMappings.find((m) => {
            if (where.catalogRevision && m.catalogRevision !== where.catalogRevision) return false;
            if (where.carrierCode !== undefined && m.carrierCode !== where.carrierCode)
              return false;
            if (where.domain && m.domain !== where.domain) return false;
            if (where.rawKey && m.rawKey !== where.rawKey) return false;
            return true;
          }) || null
        );
      },
    },
  };
}

describe('FEAT-CAR-01 Carrier Catalog Unit Test Suite', () => {
  let service: CarrierCatalogService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new CarrierCatalogService(mockPrisma as any);
  });

  describe('AC-CAR-01-01: List Carriers', () => {
    it('returns 200 OK with the 4 canonical carriers in pinned sort order', async () => {
      const res = await service.listCarriers();
      assert.strictEqual(res.catalog_revision, CATALOG_REVISION_2026_10_31);
      assert.strictEqual(res.data.length, 4);

      const codes = res.data.map((c) => c.code);
      assert.deepStrictEqual(codes, ['GHN', 'GHTK', 'VIETTEL_POST', 'JT']);

      // Check GHN
      const ghn = res.data[0];
      assert.strictEqual(ghn.code, 'GHN');
      assert.strictEqual(ghn.name, 'Giao Hàng Nhanh');
      assert.strictEqual(ghn.evidence_level, 'VERIFIED_OFFICIAL');
      assert.strictEqual(ghn.is_active, true);
      assert.strictEqual(ghn.logo_url, null);

      // Check GHTK
      const ghtk = res.data[1];
      assert.strictEqual(ghtk.code, 'GHTK');
      assert.strictEqual(ghtk.name, 'Giao Hàng Tiết Kiệm');
      assert.strictEqual(ghtk.evidence_level, 'VERIFIED_OFFICIAL');

      // Check VIETTEL_POST
      const vtp = res.data[2];
      assert.strictEqual(vtp.code, 'VIETTEL_POST');
      assert.strictEqual(vtp.name, 'Viettel Post');
      assert.strictEqual(vtp.evidence_level, 'CONFIRMATION_REQUIRED');

      // Check JT
      const jt = res.data[3];
      assert.strictEqual(jt.code, 'JT');
      assert.strictEqual(jt.name, 'J&T Express Vietnam');
      assert.strictEqual(jt.evidence_level, 'CONFIRMATION_REQUIRED');
    });

    it('filters by is_active boolean flag', async () => {
      const activeRes = await service.listCarriers(true);
      assert.strictEqual(activeRes.data.length, 4);

      const inactiveRes = await service.listCarriers(false);
      assert.strictEqual(inactiveRes.data.length, 0);
    });
  });

  describe('AC-CAR-01-02: Carrier Details and Services', () => {
    it('returns carrier details with associated services for GHN', async () => {
      const res = await service.getCarrierDetail('GHN');
      assert.strictEqual(res.catalog_revision, CATALOG_REVISION_2026_10_31);
      assert.strictEqual(res.data.code, 'GHN');
      assert.strictEqual(res.data.name, 'Giao Hàng Nhanh');
      assert.strictEqual(res.data.evidence_level, 'VERIFIED_OFFICIAL');
      assert.strictEqual(res.data.services.length, 2);

      const sCodes = res.data.services.map((s) => s.code);
      assert.ok(sCodes.includes('GHN_STANDARD'));
      assert.ok(sCodes.includes('GHN_FAST'));

      const stdService = res.data.services.find((s) => s.code === 'GHN_STANDARD')!;
      assert.strictEqual(stdService.service_type, 'STANDARD');
      assert.strictEqual(stdService.evidence_level, 'VERIFIED_OFFICIAL');
      assert.strictEqual(stdService.source_revision, 'GHN-PUBLIC-API-2026-08-24');
    });

    it('returns carrier details with confirmation-required services for VIETTEL_POST', async () => {
      const res = await service.getCarrierDetail('VIETTEL_POST');
      assert.strictEqual(res.data.code, 'VIETTEL_POST');
      assert.strictEqual(res.data.evidence_level, 'CONFIRMATION_REQUIRED');
      assert.strictEqual(res.data.services.length, 2);

      const std = res.data.services.find((s) => s.code === 'VTP_STANDARD')!;
      assert.strictEqual(std.service_type, 'STANDARD');
      assert.strictEqual(std.evidence_level, 'CONFIRMATION_REQUIRED');
      assert.strictEqual(std.source_revision, 'OI-001-UNCONFIRMED');
    });
  });

  describe('AC-CAR-01-03: Alias Resolution & Case-Sensitivity', () => {
    it('normalizes VTP to VIETTEL_POST with identical canonical payload', async () => {
      const vtpRes = await service.getCarrierDetail('VTP');
      const canonicalRes = await service.getCarrierDetail('VIETTEL_POST');

      assert.strictEqual(vtpRes.data.code, 'VIETTEL_POST');
      assert.strictEqual(vtpRes.data.name, 'Viettel Post');
      assert.deepStrictEqual(vtpRes.data, canonicalRes.data);
    });

    it('normalizes JT_EXPRESS to JT with identical canonical payload', async () => {
      const jtExpressRes = await service.getCarrierDetail('JT_EXPRESS');
      const canonicalRes = await service.getCarrierDetail('JT');

      assert.strictEqual(jtExpressRes.data.code, 'JT');
      assert.strictEqual(jtExpressRes.data.name, 'J&T Express Vietnam');
      assert.deepStrictEqual(jtExpressRes.data, canonicalRes.data);
    });

    it('rejects case mismatches (vtp, ViettelPost, J&T) with 404 RESOURCE_NOT_FOUND', async () => {
      const invalidTokens = ['vtp', 'ViettelPost', 'J&T', 'jt_express', 'ghn', 'GHTk', 'UNKNOWN'];
      for (const token of invalidTokens) {
        try {
          await service.getCarrierDetail(token);
          assert.fail(`Expected 404 RESOURCE_NOT_FOUND for token: ${token}`);
        } catch (err: any) {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.NOT_FOUND);
          assert.strictEqual(err.code, 'RESOURCE_NOT_FOUND');
        }
      }
    });
  });

  describe('AC-CAR-01-04: Canonical Shipment Statuses', () => {
    it('returns all 17 canonical statuses sorted by stage_order ASC', async () => {
      const res = await service.listStatuses();
      assert.strictEqual(res.catalog_revision, CATALOG_REVISION_2026_10_31);
      assert.strictEqual(res.data.length, 17);

      // Verify strict stage_order ASC
      for (let i = 1; i < res.data.length; i++) {
        assert.ok(
          res.data[i].stage_order >= res.data[i - 1].stage_order,
          `Status order violation: ${res.data[i].code} (${res.data[i].stage_order}) precedes ${res.data[i - 1].code}`
        );
      }

      // Verify category decoupling: command states vs operational states
      const commandStatuses = res.data.filter((s) => s.category === 'COMMAND');
      assert.strictEqual(commandStatuses.length, 4);
      assert.deepStrictEqual(
        commandStatuses.map((s) => s.code),
        ['CREATING', 'CREATED', 'CREATE_FAILED', 'CREATE_OUTCOME_UNKNOWN']
      );

      const preTransit = res.data.filter((s) => s.category === 'OPERATIONAL_PRE_TRANSIT');
      assert.strictEqual(preTransit.length, 4);
      assert.deepStrictEqual(
        preTransit.map((s) => s.code),
        ['DRAFT', 'READY_TO_PICK', 'PICKING', 'PICKED']
      );

      const inTransit = res.data.filter((s) => s.category === 'OPERATIONAL_IN_TRANSIT');
      assert.strictEqual(inTransit.length, 2);
      assert.deepStrictEqual(
        inTransit.map((s) => s.code),
        ['IN_TRANSIT', 'OUT_FOR_DELIVERY']
      );

      const terminal = res.data.filter((s) => s.category === 'OPERATIONAL_TERMINAL');
      assert.strictEqual(terminal.length, 7);
      assert.deepStrictEqual(
        terminal.map((s) => s.code),
        ['DELIVERY_FAILED', 'RETURNING', 'RETURNED', 'DELIVERED', 'CANCELLED', 'LOST', 'DAMAGED']
      );

      // Verify description contract: label + ': canonical shipment status. Not a provider raw status.'
      for (const st of res.data) {
        assert.strictEqual(
          st.description,
          `${st.label}: canonical shipment status. Not a provider raw status.`
        );
      }
    });
  });

  describe('AC-CAR-01-05: Canonical Fee Components', () => {
    it('returns the 8 approved canonical fee component definitions', async () => {
      const res = await service.listFeeComponents();
      assert.strictEqual(res.catalog_revision, CATALOG_REVISION_2026_10_31);
      assert.strictEqual(res.data.length, 8);

      const expectedCodes = [
        'BASE_FREIGHT',
        'SURCHARGE',
        'REMOTE_AREA_SURCHARGE',
        'COD_FEE',
        'INSURANCE_FEE',
        'RETURN_FEE',
        'OTHER_FEE',
        'VAT',
      ];
      assert.deepStrictEqual(
        res.data.map((fc) => fc.code),
        expectedCodes
      );

      // Verify VAT semantics: VAT is category VAT, not refundable, and vat_applicable=false (never a tax base itself)
      const vat = res.data.find((fc) => fc.code === 'VAT')!;
      assert.strictEqual(vat.category, 'VAT');
      assert.strictEqual(vat.is_refundable, false);
      assert.strictEqual(vat.vat_applicable, false);

      // Verify RETURN_FEE is not refundable
      const returnFee = res.data.find((fc) => fc.code === 'RETURN_FEE')!;
      assert.strictEqual(returnFee.is_refundable, false);
      assert.strictEqual(returnFee.vat_applicable, true);

      // Verify BASE_FREIGHT is refundable and vat applicable
      const base = res.data.find((fc) => fc.code === 'BASE_FREIGHT')!;
      assert.strictEqual(base.is_refundable, true);
      assert.strictEqual(base.vat_applicable, true);
    });
  });

  describe('AC-CAR-01-06: Golden Raw-to-Canonical Compatibility Mapping Rules', () => {
    it('GHN: delivery_fail maps to canonical DELIVERY_FAILED (must not map to RETURNING)', async () => {
      const mapping = await service.resolveCompatibility('STATUS', 'delivery_fail', 'GHN');
      assert.strictEqual(mapping.canonical_code, 'DELIVERY_FAILED');
      assert.strictEqual(mapping.disposition, 'MAPPED');
      assert.notStrictEqual(mapping.canonical_code, 'RETURNING');
    });

    it('GHN: unknown raw status resolves to UNMAPPED / null (never defaults to IN_TRANSIT)', async () => {
      const mapping = await service.resolveCompatibility(
        'STATUS',
        'some_weird_unknown_status_xyz',
        'GHN'
      );
      assert.strictEqual(mapping.canonical_code, null);
      assert.strictEqual(mapping.disposition, 'UNMAPPED');
      assert.notStrictEqual(mapping.canonical_code, 'IN_TRANSIT');
    });

    it('GHTK: unknown raw status 9999 resolves to UNMAPPED / null (never defaults to IN_TRANSIT)', async () => {
      const mapping = await service.resolveCompatibility('STATUS', '9999', 'GHTK');
      assert.strictEqual(mapping.canonical_code, null);
      assert.strictEqual(mapping.disposition, 'UNMAPPED');
      assert.notStrictEqual(mapping.canonical_code, 'IN_TRANSIT');
    });

    it('GHTK: raw status 9 maps to canonical DELIVERY_FAILED (undeliverable is not yet RETURNING)', async () => {
      const mapping = await service.resolveCompatibility('STATUS', '9', 'GHTK');
      assert.strictEqual(mapping.canonical_code, 'DELIVERY_FAILED');
      assert.strictEqual(mapping.disposition, 'MAPPED');
    });

    it('GHTK: raw status 13 (compensation) resolves to UNMAPPED / null (preserves raw status without coercing to DAMAGED or LOST)', async () => {
      const mapping = await service.resolveCompatibility('STATUS', '13', 'GHTK');
      assert.strictEqual(mapping.canonical_code, null);
      assert.strictEqual(mapping.disposition, 'UNMAPPED');
      assert.notStrictEqual(mapping.canonical_code, 'DAMAGED');
      assert.notStrictEqual(mapping.canonical_code, 'LOST');
    });

    it('GHTK: raw status 20 maps to canonical RETURNING (per official GHTK docs; must not map to LOST)', async () => {
      const mapping = await service.resolveCompatibility('STATUS', '20', 'GHTK');
      assert.strictEqual(mapping.canonical_code, 'RETURNING');
      assert.strictEqual(mapping.disposition, 'MAPPED');
      assert.notStrictEqual(mapping.canonical_code, 'LOST');
    });

    it('FEE: mystery_fee resolves to UNMAPPED / null (never defaults to BASE_FREIGHT or 0)', async () => {
      const mapping = await service.resolveCompatibility('FEE', 'mystery_fee');
      assert.strictEqual(mapping.canonical_code, null);
      assert.strictEqual(mapping.disposition, 'UNMAPPED');
      assert.notStrictEqual(mapping.canonical_code, 'BASE_FREIGHT');
    });

    it('FEE: VAT maps to itself with disposition MAPPED', async () => {
      const mapping = await service.resolveCompatibility('FEE', 'VAT');
      assert.strictEqual(mapping.canonical_code, 'VAT');
      assert.strictEqual(mapping.disposition, 'MAPPED');
    });

    it('CARRIER_ALIAS: VTP maps to VIETTEL_POST with disposition MAPPED', async () => {
      const mapping = await service.resolveCompatibility('CARRIER_ALIAS', 'VTP');
      assert.strictEqual(mapping.canonical_code, 'VIETTEL_POST');
      assert.strictEqual(mapping.disposition, 'MAPPED');
    });

    it('CARRIER_ALIAS: lowercase vtp resolves to UNMAPPED / null (case-sensitive match)', async () => {
      const mapping = await service.resolveCompatibility('CARRIER_ALIAS', 'vtp');
      assert.strictEqual(mapping.canonical_code, null);
      assert.strictEqual(mapping.disposition, 'UNMAPPED');
    });
  });

  describe('Compatibility Mapping List Endpoint', () => {
    it('returns mappings filtered by domain', async () => {
      const res = await service.listCompatibility('STATUS');
      assert.strictEqual(res.catalog_revision, CATALOG_REVISION_2026_10_31);
      assert.ok(res.data.length > 0);
      assert.ok(res.data.every((m) => m.domain === 'STATUS'));
    });

    it('returns empty array when filter matches nothing (does not 404)', async () => {
      const res = await service.listCompatibility('STATUS', 'VIETTEL_POST', 'non_existent_key');
      assert.strictEqual(res.catalog_revision, CATALOG_REVISION_2026_10_31);
      assert.deepStrictEqual(res.data, []);
    });
  });

  describe('P1 Finding: Diagnostic Credential Redaction in Failure Paths', () => {
    it('redacts raw password and sensitive parameters from connection strings', () => {
      const secretPass = 'super_secret_pg_pwd_456';
      const secretToken = 'secret_access_token_789';
      const sensitiveUrl = `postgresql://shipde_user:${secretPass}@db.internal:5432/shipde_db?schema=public&token=${secretToken}&auth_key=key123`;

      const redacted = redactDatabaseUrl(sensitiveUrl);
      assert.strictEqual(redacted.includes(secretPass), false);
      assert.strictEqual(redacted.includes(secretToken), false);
      assert.strictEqual(redacted.includes('key123'), false);
      assert.ok(redacted.includes('shipde_user:***@db.internal:5432/shipde_db'));

      const ciError = buildDatabaseReadinessFailureMessage(sensitiveUrl, true);
      assert.strictEqual(ciError.includes(secretPass), false);
      assert.strictEqual(ciError.includes(secretToken), false);
      assert.ok(
        ciError.includes(
          'Database must be reachable in CI environment at postgresql://shipde_user:***@db.internal:5432/shipde_db'
        )
      );

      const warnMsg = buildDatabaseReadinessFailureMessage(sensitiveUrl, false);
      assert.strictEqual(warnMsg.includes(secretPass), false);
      assert.strictEqual(warnMsg.includes(secretToken), false);
      assert.ok(
        warnMsg.includes(
          'PostgreSQL is not reachable at postgresql://shipde_user:***@db.internal:5432/shipde_db'
        )
      );
    });

    it('fails closed to the redaction marker for unparseable URLs (no partial-regex fallback leak)', () => {
      const secretPass = 'malformed_pg_password_000';
      const secretToken = 'malformed_query_secret_111';
      // Opaque host containing a colon is rejected by new URL() for the postgresql scheme,
      // forcing the parse-failure branch that previously fell back to a password-only regex
      // and leaked query secrets such as token=...
      const malformedUrl = `postgresql://u:${secretPass}@db:bad/db?token=${secretToken}`;

      let parsed = true;
      try {
        new URL(malformedUrl);
      } catch {
        parsed = false;
      }
      assert.strictEqual(parsed, false, 'Precondition: malformed URL must not parse');

      const redacted = redactDatabaseUrl(malformedUrl);
      assert.strictEqual(
        redacted,
        '[REDACTED_DATABASE_URL]',
        'Unparseable URL must be replaced wholesale with the redaction marker'
      );
      assert.strictEqual(redacted.includes(secretPass), false);
      assert.strictEqual(redacted.includes(secretToken), false);

      const ciError = buildDatabaseReadinessFailureMessage(malformedUrl, true);
      assert.strictEqual(ciError.includes(secretPass), false);
      assert.strictEqual(ciError.includes(secretToken), false);
      assert.ok(ciError.includes('[REDACTED_DATABASE_URL]'));

      const warnMsg = buildDatabaseReadinessFailureMessage(malformedUrl, false);
      assert.strictEqual(warnMsg.includes(secretPass), false);
      assert.strictEqual(warnMsg.includes(secretToken), false);
      assert.ok(warnMsg.includes('[REDACTED_DATABASE_URL]'));
    });
  });
});
