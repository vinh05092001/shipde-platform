-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleEnum" AS ENUM ('OWNER', 'OPS_CSKH', 'WAREHOUSE', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "CarrierCodeEnum" AS ENUM ('GHN', 'GHTK', 'VIETTEL_POST', 'JT');

-- CreateEnum
CREATE TYPE "CarrierTierEnum" AS ENUM ('L0_OBSERVE', 'L1_ASSIST', 'L2_EXECUTE');

-- CreateEnum
CREATE TYPE "ShipmentStatusEnum" AS ENUM ('DRAFT', 'PICKING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ExceptionTypeEnum" AS ENUM ('PICKUP_DELAY', 'STUCK_IN_TRANSIT', 'DELIVERY_FAIL', 'STATUS_MISMATCH');

-- CreateEnum
CREATE TYPE "ExceptionCaseStatusEnum" AS ENUM ('OPEN', 'ASSIGNED', 'CONTACTING', 'WAITING_CUSTOMER', 'REATTEMPT_REQUESTED', 'WAITING_REATTEMPT', 'RESCUED', 'RETURNING', 'RETURNED', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "MatchingStatusEnum" AS ENUM ('MATCHED_EXACT', 'MATCHED_FUZZY', 'UNMATCHED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "DiscrepancyTypeEnum" AS ENUM ('D1_WEIGHT', 'D2_FREIGHT', 'D3_SURCHARGE', 'D4_DUPLICATE', 'D5_COD_MISMATCH', 'D6_OVERDUE_COD', 'D7_MISSING');

-- CreateEnum
CREATE TYPE "DiscrepancyStatusEnum" AS ENUM ('OPEN', 'CONFIRMED', 'DISPUTED', 'WAIVED', 'CARRIED_FORWARD', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ClaimStatusEnum" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACCEPTED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OutboxStatusEnum" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "RoleEnum" NOT NULL,
    "store_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warehouse_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(255) NOT NULL,
    "device_model" VARCHAR(255),
    "fcm_token" TEXT,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_accounts" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "carrier_code" "CarrierCodeEnum" NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "encrypted_credentials" TEXT NOT NULL,
    "tier" "CarrierTierEnum" NOT NULL DEFAULT 'L1_ASSIST',
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "carrier_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "carrier_account_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "volumetric_divisor" INTEGER NOT NULL DEFAULT 5000,
    "cod_payout_sla_days" INTEGER NOT NULL DEFAULT 3,
    "checksum" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_tiers" (
    "id" UUID NOT NULL,
    "rate_card_id" UUID NOT NULL,
    "route_type" VARCHAR(32) NOT NULL,
    "weight_from_g" INTEGER NOT NULL,
    "weight_to_g" INTEGER NOT NULL,
    "base_fee" BIGINT NOT NULL,
    "step_fee" BIGINT NOT NULL DEFAULT 0,
    "step_weight_g" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "source_type" VARCHAR(32) NOT NULL DEFAULT 'pancake',
    "order_code" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "cod_amount" BIGINT NOT NULL DEFAULT 0,
    "declared_weight_g" INTEGER NOT NULL DEFAULT 0,
    "dimensions" JSONB,
    "recipient_name" VARCHAR(255) NOT NULL,
    "recipient_phone" VARCHAR(32) NOT NULL,
    "recipient_province" VARCHAR(128) NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "item_value" BIGINT DEFAULT 0,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_code" VARCHAR(128) NOT NULL,
    "carrier_code" "CarrierCodeEnum" NOT NULL,
    "carrier_account_id" UUID NOT NULL,
    "tracking_code" VARCHAR(128) NOT NULL,
    "current_status" "ShipmentStatusEnum" NOT NULL DEFAULT 'DRAFT',
    "declared_weight_g" INTEGER NOT NULL DEFAULT 0,
    "charged_weight_g" INTEGER,
    "dimensions" JSONB,
    "quoted_fee" BIGINT NOT NULL DEFAULT 0,
    "charged_fee" BIGINT,
    "cod_amount" BIGINT NOT NULL DEFAULT 0,
    "cod_collected" BIGINT,
    "cod_paid_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_modified_by" VARCHAR(255),

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "raw_status" VARCHAR(128) NOT NULL,
    "normalized_status" "ShipmentStatusEnum" NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(32) NOT NULL,
    "raw_payload" JSONB,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception_cases" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "tracking_code" VARCHAR(128) NOT NULL,
    "exception_type" "ExceptionTypeEnum" NOT NULL,
    "status" "ExceptionCaseStatusEnum" NOT NULL DEFAULT 'OPEN',
    "assigned_to" UUID,
    "locked_until" TIMESTAMPTZ,
    "deadline_at" TIMESTAMPTZ NOT NULL,
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "carrier_raw_reason" TEXT,
    "standard_reason" VARCHAR(255),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exception_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception_contact_logs" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "result" VARCHAR(32) NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exception_contact_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_records" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "tracking_code" VARCHAR(128) NOT NULL,
    "return_warehouse_id" VARCHAR(128),
    "expected_return_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "condition" VARCHAR(32),
    "evidence_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence_checksum" VARCHAR(64),
    "received_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_statements" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "carrier_account_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "file_storage_key" VARCHAR(512) NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "total_cod_collected" BIGINT NOT NULL DEFAULT 0,
    "total_fees" BIGINT NOT NULL DEFAULT 0,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "closed_at" TIMESTAMPTZ,
    "closed_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_rows" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "tracking_code" VARCHAR(128) NOT NULL,
    "order_code" VARCHAR(128),
    "fee_type" VARCHAR(64) NOT NULL,
    "charged_weight_g" INTEGER NOT NULL DEFAULT 0,
    "charged_fee" BIGINT NOT NULL DEFAULT 0,
    "cod_collected" BIGINT NOT NULL DEFAULT 0,
    "cod_paid_at" DATE,
    "raw_data" JSONB NOT NULL,
    "match_status" "MatchingStatusEnum" NOT NULL DEFAULT 'UNMATCHED',
    "matched_shipment_id" UUID,

    CONSTRAINT "statement_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discrepancies" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "statement_row_id" UUID,
    "shipment_id" UUID NOT NULL,
    "tracking_code" VARCHAR(128) NOT NULL,
    "type" "DiscrepancyTypeEnum" NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "status" "DiscrepancyStatusEnum" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "resolved_by" VARCHAR(255),
    "resolved_at" TIMESTAMPTZ,
    "evidence_files" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "discrepancy_id" UUID,
    "claim_type" VARCHAR(32) NOT NULL,
    "carrier_ticket" VARCHAR(128),
    "requested_amount" BIGINT NOT NULL DEFAULT 0,
    "accepted_amount" BIGINT NOT NULL DEFAULT 0,
    "recovered_amount" BIGINT NOT NULL DEFAULT 0,
    "status" "ClaimStatusEnum" NOT NULL DEFAULT 'DRAFT',
    "deadline_at" TIMESTAMPTZ NOT NULL,
    "evidence_pack_url" VARCHAR(512),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "user_id" VARCHAR(255),
    "action" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(255) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "status" "OutboxStatusEnum" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "idempotency_key" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"("code");

-- CreateIndex
CREATE INDEX "users_merchant_id_role_idx" ON "users"("merchant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_merchant_id_email_key" ON "users"("merchant_id", "email");

-- CreateIndex
CREATE INDEX "device_sessions_user_id_is_revoked_idx" ON "device_sessions"("user_id", "is_revoked");

-- CreateIndex
CREATE INDEX "carrier_accounts_merchant_id_carrier_code_idx" ON "carrier_accounts"("merchant_id", "carrier_code");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_accounts_merchant_id_label_key" ON "carrier_accounts"("merchant_id", "label");

-- CreateIndex
CREATE INDEX "rate_cards_carrier_account_id_effective_from_effective_to_idx" ON "rate_cards"("carrier_account_id", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "rate_tiers_rate_card_id_route_type_weight_from_g_weight_to__idx" ON "rate_tiers"("rate_card_id", "route_type", "weight_from_g", "weight_to_g");

-- CreateIndex
CREATE INDEX "orders_merchant_id_created_at_idx" ON "orders"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_merchant_id_order_code_key" ON "orders"("merchant_id", "order_code");

-- CreateIndex
CREATE INDEX "shipments_merchant_id_current_status_idx" ON "shipments"("merchant_id", "current_status");

-- CreateIndex
CREATE INDEX "shipments_merchant_id_delivered_at_idx" ON "shipments"("merchant_id", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_merchant_id_tracking_code_key" ON "shipments"("merchant_id", "tracking_code");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_occurred_at_idx" ON "shipment_events"("shipment_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_events_shipment_id_raw_status_occurred_at_key" ON "shipment_events"("shipment_id", "raw_status", "occurred_at");

-- CreateIndex
CREATE INDEX "exception_cases_merchant_id_status_deadline_at_idx" ON "exception_cases"("merchant_id", "status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "exception_cases_shipment_id_exception_type_key" ON "exception_cases"("shipment_id", "exception_type");

-- CreateIndex
CREATE INDEX "exception_contact_logs_case_id_created_at_idx" ON "exception_contact_logs"("case_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "return_records_shipment_id_key" ON "return_records"("shipment_id");

-- CreateIndex
CREATE INDEX "return_records_merchant_id_expected_return_at_idx" ON "return_records"("merchant_id", "expected_return_at");

-- CreateIndex
CREATE INDEX "carrier_statements_merchant_id_period_start_period_end_idx" ON "carrier_statements"("merchant_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_statements_merchant_id_carrier_account_id_checksum_key" ON "carrier_statements"("merchant_id", "carrier_account_id", "checksum");

-- CreateIndex
CREATE INDEX "statement_rows_statement_id_tracking_code_idx" ON "statement_rows"("statement_id", "tracking_code");

-- CreateIndex
CREATE INDEX "discrepancies_merchant_id_status_type_idx" ON "discrepancies"("merchant_id", "status", "type");

-- CreateIndex
CREATE INDEX "claims_merchant_id_status_deadline_at_idx" ON "claims"("merchant_id", "status", "deadline_at");

-- CreateIndex
CREATE INDEX "audit_logs_merchant_id_entity_type_entity_id_idx" ON "audit_logs"("merchant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_merchant_id_created_at_idx" ON "audit_logs"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_scheduled_at_idx" ON "outbox_events"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "outbox_events_correlation_id_idx" ON "outbox_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "carrier_accounts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_carrier_account_id_fkey" FOREIGN KEY ("carrier_account_id") REFERENCES "carrier_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_tiers" ADD CONSTRAINT "rate_tiers_rate_card_id_fkey" FOREIGN KEY ("rate_card_id") REFERENCES "rate_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_account_id_fkey" FOREIGN KEY ("carrier_account_id") REFERENCES "carrier_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_contact_logs" ADD CONSTRAINT "exception_contact_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "exception_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_contact_logs" ADD CONSTRAINT "exception_contact_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_records" ADD CONSTRAINT "return_records_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_records" ADD CONSTRAINT "return_records_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_statements" ADD CONSTRAINT "carrier_statements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_statements" ADD CONSTRAINT "carrier_statements_carrier_account_id_fkey" FOREIGN KEY ("carrier_account_id") REFERENCES "carrier_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_rows" ADD CONSTRAINT "statement_rows_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "carrier_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_statement_row_id_fkey" FOREIGN KEY ("statement_row_id") REFERENCES "statement_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_discrepancy_id_fkey" FOREIGN KEY ("discrepancy_id") REFERENCES "discrepancies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
