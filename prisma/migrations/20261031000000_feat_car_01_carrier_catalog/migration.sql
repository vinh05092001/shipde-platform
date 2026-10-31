-- FEAT-CAR-01: Carrier catalog, canonical shipment statuses, and fee component taxonomy
--

-- CreateTable
CREATE TABLE IF NOT EXISTS "carriers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "catalog_revision" VARCHAR(40) NOT NULL,
    "code" "CarrierCodeEnum" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "logo_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "evidence_level" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "carrier_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_id" UUID NOT NULL,
    "catalog_revision" VARCHAR(40) NOT NULL,
    "carrier_code" "CarrierCodeEnum" NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "service_type" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "evidence_level" VARCHAR(50) NOT NULL,
    "source_revision" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "canonical_status_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "catalog_revision" VARCHAR(40) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "stage_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_status_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fee_component_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "catalog_revision" VARCHAR(40) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "is_refundable" BOOLEAN NOT NULL DEFAULT false,
    "vat_applicable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_component_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "catalog_compatibility_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "catalog_revision" VARCHAR(40) NOT NULL,
    "carrier_code" "CarrierCodeEnum",
    "domain" VARCHAR(20) NOT NULL,
    "raw_key" VARCHAR(100) NOT NULL,
    "canonical_code" VARCHAR(50),
    "disposition" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_compatibility_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "carriers_catalog_revision_code_key" ON "carriers"("catalog_revision", "code");
CREATE INDEX IF NOT EXISTS "carriers_catalog_revision_idx" ON "carriers"("catalog_revision");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "carrier_services_catalog_revision_carrier_code_code_key" ON "carrier_services"("catalog_revision", "carrier_code", "code");
CREATE INDEX IF NOT EXISTS "carrier_services_carrier_id_idx" ON "carrier_services"("carrier_id");
CREATE INDEX IF NOT EXISTS "carrier_services_catalog_revision_carrier_code_idx" ON "carrier_services"("catalog_revision", "carrier_code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "canonical_status_references_catalog_revision_code_key" ON "canonical_status_references"("catalog_revision", "code");
CREATE INDEX IF NOT EXISTS "canonical_status_references_catalog_revision_idx" ON "canonical_status_references"("catalog_revision");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fee_component_references_catalog_revision_code_key" ON "fee_component_references"("catalog_revision", "code");
CREATE INDEX IF NOT EXISTS "fee_component_references_catalog_revision_idx" ON "fee_component_references"("catalog_revision");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_compatibility_mappings_catalog_revision_carrier_code_domain_raw_key_key" ON "catalog_compatibility_mappings"("catalog_revision", "carrier_code", "domain", "raw_key");
CREATE INDEX IF NOT EXISTS "catalog_compatibility_mappings_catalog_revision_domain_idx" ON "catalog_compatibility_mappings"("catalog_revision", "domain");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'carrier_services_carrier_id_fkey'
    ) THEN
        ALTER TABLE "carrier_services" ADD CONSTRAINT "carrier_services_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
