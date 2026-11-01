-- FEAT-COM-04: Persist actual source-header mapping captured from uploaded files
--
-- Forward Notes:
-- - Adds "header_mapping" JSONB column to "imports" storing the real source-header to
--   canonical-field mapping recorded during parsing (review finding: mapping metadata
--   must describe the uploaded headers, not only the template)

ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "header_mapping" JSONB;
