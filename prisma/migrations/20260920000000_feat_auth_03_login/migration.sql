-- FEAT-AUTH-03: login OTP tokens are separated from account-verification tokens.
-- Existing rows are all verification tokens (register/resend), hence the default.
ALTER TABLE "verification_tokens" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'VERIFICATION';

CREATE INDEX "verification_tokens_purpose_idx" ON "verification_tokens"("purpose");
